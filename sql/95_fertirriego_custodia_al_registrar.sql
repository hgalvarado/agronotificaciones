-- =====================================================================
-- MIGRACIÓN 95 · Fertirriego: la custodia se mira al REGISTRAR, no a la hora del hecho
-- =====================================================================
-- Error encontrado en la QA con clics de la Etapa B (2026-11-11): la base rechazaba una recepción con «La estación
-- no está a tu cargo» porque revisaba la custodia a la hora de la ENTREGA que se escribe en el formulario. Si el
-- estacionero recibe la estación a las 6:00 p. m. y registra un camión que llegó a las 5:50 p. m., se rechazaba.
--
-- Lo correcto: responde por el registro quien tiene la estación a cargo cuando REGISTRA (la hora del teléfono al
-- guardar: creado_en). La hora del hecho (fecha_hora) queda como dato del registro, para el kardex.
-- Igual para anular lo propio: cuenta cuándo se registró, no la hora del hecho.
--
-- Solo cambia cuatro funciones internas de Fertirriego (sin usuarios en producción). Idempotente.
-- =====================================================================

-- ---------- Recepción ----------
create or replace function public._fert_op_recepcion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_chofer   uuid := public._fert_uuid(d->>'chofer_id');
    v_vehiculo uuid := public._fert_uuid(d->>'vehiculo_id');
    v_fecha    timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_obs      text[];
    l          record;
begin
    v_obs := public._fert_autorizar(v_estacion, 'recibir', p_creado, p_inmediato, p_en_nombre);

    if v_chofer is null or not exists (select 1 from public.fert_choferes where id = v_chofer) then
        raise exception 'Indica quién entregó (chofer).';
    end if;
    if v_vehiculo is not null and not exists (select 1 from public.fert_vehiculos where id = v_vehiculo) then
        raise exception 'El vehículo no existe. Actualiza la aplicación.';
    end if;
    if v_fecha > p_creado + interval '5 minutes' then
        raise exception 'La fecha y hora de la recepción no puede ser posterior al momento en que se registra.';
    end if;

    insert into public.fert_recepciones
        (id, estacion_id, fecha_hora, chofer_id, vehiculo_id, lugar, documento, comentario, registrado_por)
    values
        (p_id, v_estacion, v_fecha, v_chofer, v_vehiculo, nullif(btrim(d->>'lugar'), ''),
         nullif(btrim(d->>'documento'), ''), nullif(btrim(d->>'comentario'), ''), (select auth.uid()));

    for l in select * from public._fert_lineas(d->'lineas') loop
        insert into public.fert_recepciones_detalle (recepcion_id, material_id, cantidad)
        values (p_id, l.material_id, l.cantidad);
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'RECEPCION',
                     l.cantidad, v_fecha, null, 'recepcion', p_id, p_inmediato));
    end loop;

    if v_vehiculo is not null then
        insert into public.fert_choferes_vehiculos (chofer_id, vehiculo_id, ultima_vez)
        values (v_chofer, v_vehiculo, v_fecha)
        on conflict (chofer_id, vehiculo_id) do update set ultima_vez = greatest(fert_choferes_vehiculos.ultima_vez, excluded.ultima_vez);
    end if;
    return v_obs;
end;
$$;

-- ---------- Aplicación ----------
create or replace function public._fert_op_aplicacion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_turno    uuid := public._fert_uuid(d->>'turno_ciclo_id');
    v_fecha_h  timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_fecha    date := coalesce((d->>'fecha')::date, (v_fecha_h at time zone 'America/Tegucigalpa')::date);
    v_ejec     uuid := coalesce(public._fert_uuid(d->>'ejecutor_id'), p_en_nombre, (select auth.uid()));
    v_ejec2    uuid := public._fert_uuid(d->>'ejecutor2_id');
    v_tc       public.turnos_ciclo%rowtype;
    v_obs      text[];
    v_en_plan  boolean;
    l          record;
begin
    v_obs := public._fert_autorizar(v_estacion, 'aplicar', p_creado, p_inmediato, p_en_nombre);

    select * into v_tc from public.turnos_ciclo where id = v_turno;
    if not found then
        raise exception 'El turno no existe. Actualiza la aplicación.';
    end if;
    if v_tc.estacion_id is distinct from v_estacion then
        v_obs := public._fert_obs(v_obs, array['OTRA_ESTACION']);
    end if;
    if v_fecha > (p_creado at time zone 'America/Tegucigalpa')::date + 1 then
        raise exception 'La fecha de la aplicación no puede ser futura.';
    end if;
    if not exists (select 1 from public.perfiles where id = v_ejec)
       or (v_ejec2 is not null and not exists (select 1 from public.perfiles where id = v_ejec2)) then
        raise exception 'El estacionero que ejecutó no existe.';
    end if;

    insert into public.fert_aplicaciones
        (id, estacion_id, turno_ciclo_id, fecha, fecha_hora, ejecutor_id, ejecutor2_id, comentario, registrado_por)
    values
        (p_id, v_estacion, v_turno, v_fecha, v_fecha_h, v_ejec, v_ejec2,
         nullif(btrim(d->>'comentario'), ''), (select auth.uid()));

    for l in select * from public._fert_lineas(d->'lineas') loop
        v_en_plan := exists (select 1 from public.fert_plan p where p.turno_ciclo_id = v_turno and p.material_id = l.material_id);
        if not v_en_plan then
            v_obs := public._fert_obs(v_obs, array['FUERA_DE_PLAN']);
        end if;
        insert into public.fert_aplicaciones_detalle (aplicacion_id, material_id, cantidad, en_plan)
        values (p_id, l.material_id, l.cantidad, v_en_plan);
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'APLICACION',
                     -l.cantidad, v_fecha_h, v_turno, 'aplicacion', p_id, p_inmediato));
    end loop;
    return v_obs;
end;
$$;

-- ---------- Conteo ----------
create or replace function public._fert_op_conteo(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_fecha    timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_obs      text[];
    v_linea    jsonb;
    v_mat      uuid;
    v_real     numeric;
    v_sistema  numeric;
    v_hay      boolean;
    v_vistos   uuid[] := '{}';
begin
    v_obs := public._fert_autorizar(v_estacion, 'contar', p_creado, p_inmediato, p_en_nombre);

    if d->'lineas' is null or jsonb_typeof(d->'lineas') <> 'array' or jsonb_array_length(d->'lineas') = 0 then
        raise exception 'Agrega al menos un producto contado.';
    end if;

    insert into public.fert_conteos (id, estacion_id, fecha_hora, comentario, registrado_por)
    values (p_id, v_estacion, v_fecha, nullif(btrim(d->>'comentario'), ''), (select auth.uid()));

    for v_linea in select value from jsonb_array_elements(d->'lineas') loop
        v_mat := public._fert_uuid(v_linea->>'material_id');
        if v_mat is null or not exists (select 1 from public.materiales where id = v_mat) then
            raise exception 'Un producto no existe en el catálogo. Actualiza la aplicación.';
        end if;
        if v_mat = any(v_vistos) then
            raise exception 'Un producto está repetido en el conteo.';
        end if;
        v_vistos := v_vistos || v_mat;
        begin
            v_real := round(replace(btrim(v_linea->>'cantidad_real'), ',', '')::numeric, 4);
        exception when others then
            raise exception 'La cantidad contada no es un número válido.';
        end;
        if v_real is null or v_real < 0 or v_real > 1000000 then
            raise exception 'La cantidad contada debe estar entre 0 y 1,000,000.';
        end if;

        v_hay := exists (select 1 from public.fert_movimientos m
                         where m.estacion_id = v_estacion and m.material_id = v_mat and m.fecha_hora <= v_fecha);
        v_sistema := public._fert_saldo_en(v_estacion, v_mat, v_fecha);

        insert into public.fert_conteos_detalle (conteo_id, material_id, saldo_sistema, cantidad_real, diferencia)
        values (p_id, v_mat, v_sistema, v_real, v_real - v_sistema);

        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, v_mat,
                     case when v_hay then 'AJUSTE_CONTEO' else 'SALDO_INICIAL' end,
                     v_real - v_sistema, v_fecha, null, 'conteo', p_id, false));
    end loop;
    return v_obs;
end;
$$;

-- ---------- Devolución ----------
create or replace function public._fert_op_devolucion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_aplic   public.fert_aplicaciones%rowtype;
    v_fecha   timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_motivo  text := nullif(btrim(d->>'motivo'), '');
    v_obs     text[];
    v_aplicado numeric;
    v_devuelto numeric;
    l         record;
begin
    select * into v_aplic from public.fert_aplicaciones where id = public._fert_uuid(d->>'aplicacion_id');
    if not found then
        raise exception 'La aplicación no existe. Actualiza la aplicación.';
    end if;
    if v_aplic.anulado_at is not null then
        raise exception 'Esa aplicación está anulada: no tiene nada que devolver.';
    end if;
    if v_motivo is null then
        raise exception 'Indica el motivo de la devolución.';
    end if;

    v_obs := public._fert_autorizar(v_aplic.estacion_id, 'aplicar', p_creado, p_inmediato, p_en_nombre);

    insert into public.fert_devoluciones (id, aplicacion_id, estacion_id, fecha_hora, motivo, registrado_por)
    values (p_id, v_aplic.id, v_aplic.estacion_id, v_fecha, v_motivo, (select auth.uid()));

    for l in select * from public._fert_lineas(d->'lineas') loop
        select coalesce(sum(cantidad), 0) into v_aplicado
        from public.fert_aplicaciones_detalle where aplicacion_id = v_aplic.id and material_id = l.material_id;
        select coalesce(sum(dd.cantidad), 0) into v_devuelto
        from public.fert_devoluciones_detalle dd
        join public.fert_devoluciones dv on dv.id = dd.devolucion_id
        where dv.aplicacion_id = v_aplic.id and dv.anulado_at is null and dd.material_id = l.material_id
          and dv.id <> p_id;
        if l.cantidad > v_aplicado - v_devuelto then
            raise exception 'No se puede devolver % de %: en esa aplicación quedan %.',
                l.cantidad, (select coalesce(descripcion, codigo) from public.materiales where id = l.material_id),
                v_aplicado - v_devuelto;
        end if;
        insert into public.fert_devoluciones_detalle (devolucion_id, material_id, cantidad)
        values (p_id, l.material_id, l.cantidad);
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_aplic.estacion_id, l.material_id, 'DEVOLUCION',
                     l.cantidad, v_fecha, v_aplic.turno_ciclo_id, 'devolucion', p_id, p_inmediato));
    end loop;
    return v_obs;
end;
$$;

-- ---------- Anulación: «su jornada» = registrado después de recibir la estación ----------
create or replace function public._fert_op_anulacion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tipo     text := d->>'documento_tipo';
    v_doc      uuid := public._fert_uuid(d->>'documento_id');
    v_motivo   text := nullif(btrim(d->>'motivo'), '');
    v_estacion uuid;
    v_autor    uuid;
    v_anulado  timestamptz;
    v_registro timestamptz;
    v_custodia public.fert_custodia%rowtype;
    v_obs      text[] := '{}';
    m          record;
begin
    if v_motivo is null then
        raise exception 'Indica el motivo de la anulación.';
    end if;

    case v_tipo
        when 'recepcion' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_recepciones where id = v_doc;
        when 'aplicacion' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_aplicaciones where id = v_doc;
            if exists (select 1 from public.fert_devoluciones where aplicacion_id = v_doc and anulado_at is null) then
                raise exception 'Esa aplicación tiene devoluciones: anúlalas primero.';
            end if;
        when 'conteo' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_conteos where id = v_doc;
        when 'devolucion' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_devoluciones where id = v_doc;
        else
            raise exception 'No se puede anular ese tipo de registro.';
    end case;

    if v_estacion is null then
        raise exception 'El registro a anular no existe.';
    end if;
    if v_anulado is not null then
        raise exception 'Ese registro ya estaba anulado.';
    end if;

    -- Cuándo se REGISTRÓ (el id del documento es el de su operación)
    select coalesce(o.creado_en, o.recibido_en) into v_registro from public.fert_operaciones o where o.id = v_doc;

    if not public.fn_fert_puede(v_estacion, 'anular') then
        select * into v_custodia from public.fert_custodia where estacion_id = v_estacion;
        if not (v_autor = (select auth.uid())
                and v_custodia.custodio_id = (select auth.uid())
                and v_custodia.estado = 'ACTIVA'
                and v_custodia.desde <= coalesce(v_registro, now())) then
            raise exception 'Solo puedes anular tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'
                using errcode = '42501';
        end if;
    end if;

    for m in select * from public.fert_movimientos mv
             where mv.documento_id = v_doc and mv.anula_id is null and mv.tipo <> 'ANULACION'
             order by mv.cursor loop
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, m.estacion_id, m.material_id, 'ANULACION',
                     -m.cantidad, p_creado, m.turno_ciclo_id, v_tipo, v_doc, p_inmediato, m.id));
    end loop;

    execute format('update public.%I set anulado_at = now(), anulado_por = $1, motivo_anulacion = $2 where id = $3',
                   case v_tipo when 'recepcion' then 'fert_recepciones' when 'aplicacion' then 'fert_aplicaciones'
                               when 'conteo' then 'fert_conteos' else 'fert_devoluciones' end)
        using (select auth.uid()), v_motivo, v_doc;
    return v_obs;
end;
$$;

do $$
declare f text;
begin
    foreach f in array array[
        'public._fert_op_recepcion(uuid, jsonb, timestamptz, boolean, uuid)',
        'public._fert_op_aplicacion(uuid, jsonb, timestamptz, boolean, uuid)',
        'public._fert_op_conteo(uuid, jsonb, timestamptz, boolean, uuid)',
        'public._fert_op_devolucion(uuid, jsonb, timestamptz, boolean, uuid)',
        'public._fert_op_anulacion(uuid, jsonb, timestamptz, boolean)']
    loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
    end loop;
end $$;
