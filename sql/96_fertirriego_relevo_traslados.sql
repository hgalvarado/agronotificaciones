-- =====================================================================
-- MIGRACIÓN 96 · Fertirriego (Etapa C y D): relevo de estación, traslados y exportación a AGL
-- =====================================================================
-- Diseño aprobado por el usuario (docs/fertirriego-diseno.md §4.2, §4.3, P1, P2, P3):
--
--   RELEVO (cambio de jornada, día ↔ noche)
--     - Quien entrega pulsa «Entregar estación» con su bitácora de novedades (qué turno quedó en aplicación, qué
--       quedó preparado en tanques…) y QUEDA BLOQUEADO: ya no registra en esa estación.
--     - Quien recibe escribe en SU teléfono el código de 6 dígitos (cambia cada 30 s) que le muestra el que entrega.
--       El teléfono lo verifica SIN internet con la llave del compañero; la base lo vuelve a verificar al llegar
--       (fn_fert_totp_valido). Código inválido = rechazado, nunca pasa.
--     - «Recibo conforme» o anotar las diferencias por producto: quedan como DIFERENCIA_RELEVO a nombre del relevo,
--       marcadas para revisar. No se ajusta en silencio.
--     - Los dos registros pueden llegar en cualquier orden (cada teléfono envía cuando tiene señal): se juntan.
--     - Con señal también se puede recibir iniciando sesión en el mismo teléfono (método SESION).
--     - Quien entregó puede cancelar mientras nadie la reciba; quien la iba a recibir puede rechazarla con motivo.
--
--   TRASLADO entre estaciones
--     crear (origen, con motivo y quién autoriza) → POR_AUTORIZAR
--     autorizar (la persona elegida, con «Autorizar traslado», en su teléfono) → EN_TRANSITO: sale de la bodega de
--       origen y queda «en camino» hacia el destino; nadie lo puede usar
--     aceptar (destino, con la cantidad que llegó; la diferencia queda marcada) → ACEPTADO
--     rechazar (destino) → RECHAZADO: vuelve a la bodega de origen
--     cancelar (quien lo creó, antes de autorizar) → ANULADO
--
--   EXPORTACIÓN A AGL (Etapa D): fn_fert_exportar(cursor) para que AGL baje lo nuevo.
--
-- Todo entra por fn_fert_sincronizar (funciona sin señal, idempotente por UUID). Idempotente. Solo Fertirriego.
-- =====================================================================


-- =====================================================================
-- 0 · COLUMNAS NUEVAS
-- =====================================================================

alter table public.fert_relevos
    add column if not exists entrega_registrada boolean not null default true,
    add column if not exists operacion_entrega uuid,
    add column if not exists operacion_recibe uuid;

comment on column public.fert_relevos.entrega_registrada is
'Falso si llegó primero el «recibir» (el teléfono del que entregó aún no enviaba su parte); se completa al llegar.';

alter table public.fert_traslados
    add column if not exists nota_autorizacion text,
    add column if not exists operacion_id uuid;


-- =====================================================================
-- 1 · QUIÉN PUEDE AUTORIZAR TRASLADOS DE UNA ESTACIÓN
-- =====================================================================

create or replace function public._fert_autorizadores(p_estacion uuid)
returns table (id uuid, nombre text)
language sql stable security definer set search_path = public, pg_temp as $$
    select p.id, p.nombre
    from public.perfiles p
    cross join (select e.id as eid, e.zona_id from public.estaciones_riego e where e.id = p_estacion) est
    where p.activo
      and exists (
          select 1 from public._permisos_efectivos(p.id) x
          where x.recurso = 'fertirriego' and x.accion = 'autorizar_traslado'
            and (x.alcance = 'global'
                 or (x.alcance = 'zonal' and (coalesce(p.todas_las_zonas, false)
                       or exists (select 1 from public.perfiles_zonas pz where pz.perfil_id = p.id and pz.zona_id = est.zona_id)))
                 or exists (select 1 from public.perfiles_estaciones pe where pe.perfil_id = p.id and pe.estacion_id = est.eid))
      )
    order by p.nombre
$$;

revoke all on function public._fert_autorizadores(uuid) from public, anon, authenticated;


-- =====================================================================
-- 2 · RELEVO
-- =====================================================================

/** Novedades del relevo, limpias: [{turno_ciclo_id, estado, nota}]. */
create or replace function public._fert_novedades(p jsonb)
returns jsonb
language sql immutable as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'turno_ciclo_id', nullif(x->>'turno_ciclo_id', ''),
               'estado', case when x->>'estado' in ('EN_APLICACION', 'PREPARADO', 'PENDIENTE', 'TERMINADO') then x->>'estado' else 'PENDIENTE' end,
               'nota', left(coalesce(x->>'nota', ''), 500))), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
$$;

create or replace function public._fert_op_relevo_entregar(p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_est uuid := public._fert_uuid(d->>'estacion_id');
    v_yo  uuid := (select auth.uid());
    v_obs text[];
    v_r   public.fert_relevos%rowtype;
begin
    v_obs := public._fert_autorizar(v_est, 'relevo', p_creado, p_inmediato, null);

    -- ¿Ya la recibieron (el recibir llegó antes que este entregar)? Se completa ese relevo.
    select * into v_r from public.fert_relevos
     where estacion_id = v_est and entrega_id = v_yo and estado = 'RECIBIDO' and not entrega_registrada
       and recibido_at >= p_creado - interval '1 day'
     order by recibido_at desc limit 1;
    if found then
        update public.fert_relevos
           set entrega_registrada = true, operacion_entrega = p_id, entregado_at = p_creado,
               novedades = public._fert_novedades(d->'novedades'), nota_entrega = nullif(btrim(d->>'nota'), '')
         where id = v_r.id;
        return v_obs;
    end if;

    if exists (select 1 from public.fert_relevos where estacion_id = v_est and entrega_id = v_yo and estado = 'EN_ENTREGA') then
        raise exception 'Ya entregaste esta estación: espera a que la reciban o cancela la entrega.';
    end if;

    insert into public.fert_relevos
        (id, estacion_id, metodo, estado, entrega_id, entregado_at, novedades, nota_entrega, registrado_por, operacion_entrega)
    values
        (p_id, v_est, 'CODIGO', 'EN_ENTREGA', v_yo, p_creado, public._fert_novedades(d->'novedades'),
         nullif(btrim(d->>'nota'), ''), v_yo, p_id);

    update public.fert_custodia
       set estado = 'EN_ENTREGA', relevo_id = p_id, updated_at = now()
     where estacion_id = v_est and custodio_id = v_yo and estado = 'ACTIVA';
    return v_obs;
end;
$$;

create or replace function public._fert_op_relevo_recibir(p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_est     uuid := public._fert_uuid(d->>'estacion_id');
    v_entrega uuid := public._fert_uuid(d->>'entrega_id');
    v_metodo  text := coalesce(nullif(d->>'metodo', ''), 'CODIGO');
    v_momento timestamptz := coalesce(nullif(d->>'momento_codigo', '')::timestamptz, p_creado);
    v_yo      uuid := (select auth.uid());
    v_r       public.fert_relevos%rowtype;
    v_rid     uuid;
    v_obs     text[] := '{}';
    v_linea   jsonb;
    v_mat     uuid;
    v_real    numeric;
    v_sis     numeric;
    v_cust    public.fert_custodia%rowtype;
begin
    if v_est is null or not exists (select 1 from public.estaciones_riego where id = v_est) then
        raise exception 'La estación no existe. Actualiza la aplicación.';
    end if;
    if not public.fn_fert_puede(v_est, 'relevo') then
        raise exception 'Tu rol no tiene «Relevo» en esta estación.' using errcode = '42501';
    end if;
    if v_entrega is null or v_entrega = v_yo then
        raise exception 'Indica quién te entrega la estación (no puedes recibírtela a ti mismo).';
    end if;
    if v_metodo not in ('CODIGO', 'SESION') then
        raise exception 'Método de relevo desconocido.';
    end if;

    select * into v_r from public.fert_relevos
     where estacion_id = v_est and entrega_id = v_entrega and estado = 'EN_ENTREGA'
       and entregado_at <= p_creado + interval '10 minutes'
     order by entregado_at desc limit 1;

    if v_metodo = 'CODIGO' then
        -- La segunda revisión del código (el teléfono ya lo verificó sin internet)
        if abs(extract(epoch from (v_momento - p_creado))) > 900 then
            v_obs := array['RELOJ'];
        end if;
        if not public.fn_fert_totp_valido(v_entrega, coalesce(d->>'codigo', ''), v_momento, 2) then
            raise exception 'El código no corresponde a quien entrega o ya venció. Pide el código otra vez.' using errcode = '42501';
        end if;
    elsif v_r.id is null then
        -- Recibir con sesión en el mismo teléfono: solo si la entrega ya está registrada en la base
        raise exception 'Esa persona no ha entregado la estación todavía.';
    end if;

    if v_r.id is not null then
        update public.fert_relevos
           set estado = 'RECIBIDO', recibe_id = v_yo, recibido_at = p_creado, metodo = v_metodo,
               codigo_verificado = (v_metodo = 'CODIGO'), nota_recibe = nullif(btrim(d->>'nota'), ''), operacion_recibe = p_id
         where id = v_r.id;
        v_rid := v_r.id;
    else
        -- El «entregar» del otro teléfono aún no llega: se crea el relevo y se completa cuando llegue
        insert into public.fert_relevos
            (id, estacion_id, metodo, estado, entrega_id, recibe_id, entregado_at, recibido_at, codigo_verificado,
             nota_recibe, registrado_por, entrega_registrada, operacion_recibe)
        values
            (p_id, v_est, v_metodo, 'RECIBIDO', v_entrega, v_yo, least(v_momento, p_creado), p_creado, true,
             nullif(btrim(d->>'nota'), ''), v_yo, false, p_id);
        v_rid := p_id;
    end if;

    -- Diferencias declaradas (lo demás, «recibo conforme»)
    if jsonb_typeof(d->'diferencias') = 'array' then
        for v_linea in select value from jsonb_array_elements(d->'diferencias') loop
            v_mat := public._fert_uuid(v_linea->>'material_id');
            continue when v_mat is null or not exists (select 1 from public.materiales where id = v_mat);
            begin
                v_real := round(replace(btrim(v_linea->>'cantidad_real'), ',', '')::numeric, 4);
            exception when others then
                raise exception 'Una cantidad del relevo no es un número válido.';
            end;
            continue when v_real is null;
            if v_real < 0 or v_real > 1000000 then
                raise exception 'Las cantidades del relevo deben estar entre 0 y 1,000,000.';
            end if;
            v_sis := public._fert_saldo_en(v_est, v_mat, p_creado);
            continue when v_real = v_sis;
            insert into public.fert_relevos_diferencias (relevo_id, material_id, saldo_sistema, cantidad_real, diferencia)
            values (v_rid, v_mat, v_sis, v_real, v_real - v_sis)
            on conflict (relevo_id, material_id) do update set saldo_sistema = excluded.saldo_sistema,
                cantidad_real = excluded.cantidad_real, diferencia = excluded.diferencia;
            perform public._fert_mover(p_id, v_est, v_mat, 'DIFERENCIA_RELEVO', v_real - v_sis, p_creado, null,
                                       'relevo', v_rid, false);
            v_obs := public._fert_obs(v_obs, array['DIFERENCIA_RELEVO']);
        end loop;
        if 'DIFERENCIA_RELEVO' = any(v_obs) then
            update public.fert_relevos set revisar = true where id = v_rid;
        end if;
    end if;

    -- La custodia pasa a quien recibe (salvo que ya haya una asignación posterior)
    select * into v_cust from public.fert_custodia where estacion_id = v_est for update;
    if v_cust.estacion_id is null or v_cust.desde <= p_creado then
        insert into public.fert_custodia (estacion_id, custodio_id, estado, desde, relevo_id, updated_at)
        values (v_est, v_yo, 'ACTIVA', p_creado, v_rid, now())
        on conflict (estacion_id) do update set custodio_id = excluded.custodio_id, estado = 'ACTIVA',
            desde = excluded.desde, relevo_id = excluded.relevo_id, updated_at = now();
    else
        v_obs := public._fert_obs(v_obs, array['CUSTODIA_POSTERIOR']);
    end if;
    return v_obs;
end;
$$;

create or replace function public._fert_op_relevo_cancelar(p_id uuid, d jsonb) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_r public.fert_relevos%rowtype;
begin
    select * into v_r from public.fert_relevos where id = public._fert_uuid(d->>'relevo_id') for update;
    if not found then
        raise exception 'El relevo no existe.';
    end if;
    if v_r.entrega_id is distinct from (select auth.uid()) then
        raise exception 'Solo quien entregó la estación puede cancelar la entrega.' using errcode = '42501';
    end if;
    if v_r.estado <> 'EN_ENTREGA' then
        raise exception 'La entrega ya no se puede cancelar: %.', case v_r.estado when 'RECIBIDO' then 'ya la recibieron' else lower(v_r.estado) end;
    end if;
    update public.fert_relevos set estado = 'CANCELADO', motivo = nullif(btrim(d->>'motivo'), '') where id = v_r.id;
    update public.fert_custodia set estado = 'ACTIVA', updated_at = now()
     where estacion_id = v_r.estacion_id and custodio_id = v_r.entrega_id and estado = 'EN_ENTREGA';
    return '{}';
end;
$$;

create or replace function public._fert_op_relevo_rechazar(p_id uuid, d jsonb) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_r public.fert_relevos%rowtype;
    v_motivo text := nullif(btrim(d->>'motivo'), '');
begin
    select * into v_r from public.fert_relevos where id = public._fert_uuid(d->>'relevo_id') for update;
    if not found then
        raise exception 'El relevo no existe.';
    end if;
    if not public.fn_fert_puede(v_r.estacion_id, 'relevo') or v_r.entrega_id = (select auth.uid()) then
        raise exception 'No puedes rechazar esta entrega.' using errcode = '42501';
    end if;
    if v_r.estado <> 'EN_ENTREGA' then
        raise exception 'Esa entrega ya no está pendiente.';
    end if;
    if v_motivo is null then
        raise exception 'Indica por qué no recibes la estación.';
    end if;
    update public.fert_relevos set estado = 'RECHAZADO', motivo = v_motivo, recibe_id = (select auth.uid()),
           recibido_at = now(), revisar = true where id = v_r.id;
    update public.fert_custodia set estado = 'ACTIVA', updated_at = now()
     where estacion_id = v_r.estacion_id and custodio_id = v_r.entrega_id and estado = 'EN_ENTREGA';
    return '{}';
end;
$$;


-- =====================================================================
-- 3 · TRASLADOS
-- =====================================================================

create or replace function public._fert_en_transito(p_estacion uuid, p_material uuid, p_cantidad numeric)
returns void
language sql security definer set search_path = public, pg_temp as $$
    insert into public.fert_saldos as s (estacion_id, material_id, disponible, en_transito)
    values (p_estacion, p_material, 0, p_cantidad)
    on conflict (estacion_id, material_id) do update set en_transito = s.en_transito + excluded.en_transito, updated_at = now()
$$;

create or replace function public._fert_op_traslado_crear(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_origen  uuid := public._fert_uuid(d->>'origen_id');
    v_destino uuid := public._fert_uuid(d->>'destino_id');
    v_aut     uuid := public._fert_uuid(d->>'autorizador_id');
    v_motivo  text := nullif(btrim(d->>'motivo'), '');
    v_obs     text[];
    v_saldo   numeric;
    l         record;
begin
    v_obs := public._fert_autorizar(v_origen, 'trasladar', p_creado, p_inmediato, p_en_nombre);
    if v_destino is null or not exists (select 1 from public.estaciones_riego where id = v_destino and activo) then
        raise exception 'Elige la estación de destino.';
    end if;
    if v_destino = v_origen then
        raise exception 'El destino tiene que ser otra estación.';
    end if;
    if v_motivo is null then
        raise exception 'Escribe el motivo del traslado.';
    end if;
    if v_aut is null or not exists (select 1 from public._fert_autorizadores(v_origen) a where a.id = v_aut) then
        raise exception 'Elige quién autoriza el traslado (alguien con «Autorizar traslado» en la estación).';
    end if;
    if v_aut = (select auth.uid()) then
        raise exception 'No puedes autorizarte tu propio traslado: elige a otra persona.';
    end if;

    insert into public.fert_traslados (id, origen_id, destino_id, estado, motivo, autorizador_id, creado_por, creado_at, operacion_id)
    values (p_id, v_origen, v_destino, 'POR_AUTORIZAR', v_motivo, v_aut, (select auth.uid()), p_creado, p_id);

    for l in select * from public._fert_lineas(d->'lineas') loop
        v_saldo := coalesce((select disponible from public.fert_saldos where estacion_id = v_origen and material_id = l.material_id), 0);
        if l.cantidad > v_saldo then
            if p_inmediato then
                raise exception 'No alcanza el saldo de % para trasladar: hay %.',
                    (select coalesce(descripcion, codigo) from public.materiales where id = l.material_id), round(v_saldo, 2);
            end if;
            v_obs := public._fert_obs(v_obs, array['SALDO_NEGATIVO']);
        end if;
        insert into public.fert_traslados_detalle (traslado_id, material_id, cantidad_enviada)
        values (p_id, l.material_id, l.cantidad);
    end loop;
    return v_obs;
end;
$$;

create or replace function public._fert_op_traslado_autorizar(p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t    public.fert_traslados%rowtype;
    v_ok   boolean := coalesce((d->>'aprobar')::boolean, true);
    v_obs  text[] := '{}';
    l      record;
begin
    select * into v_t from public.fert_traslados where id = public._fert_uuid(d->>'traslado_id') for update;
    if not found then
        raise exception 'El traslado no existe.';
    end if;
    if v_t.estado <> 'POR_AUTORIZAR' then
        raise exception 'Ese traslado ya no espera autorización.';
    end if;
    if v_t.creado_por = (select auth.uid()) then
        raise exception 'No puedes autorizar tu propio traslado.' using errcode = '42501';
    end if;
    if not (public.fn_fert_puede(v_t.origen_id, 'autorizar_traslado') or v_t.autorizador_id = (select auth.uid())
            and exists (select 1 from public._fert_autorizadores(v_t.origen_id) a where a.id = (select auth.uid()))) then
        raise exception 'No tienes «Autorizar traslado» en la estación de origen.' using errcode = '42501';
    end if;

    if not v_ok then
        update public.fert_traslados
           set estado = 'ANULADO', autorizado_at = p_creado, autorizador_id = (select auth.uid()),
               nota_autorizacion = coalesce(nullif(btrim(d->>'nota'), ''), 'No autorizado'),
               resuelto_por = (select auth.uid()), resuelto_at = p_creado
         where id = v_t.id;
        return v_obs;
    end if;

    for l in select * from public.fert_traslados_detalle where traslado_id = v_t.id loop
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_t.origen_id, l.material_id, 'TRASLADO_SALIDA',
                     -l.cantidad_enviada, p_creado, null, 'traslado', v_t.id, p_inmediato));
        perform public._fert_en_transito(v_t.destino_id, l.material_id, l.cantidad_enviada);
    end loop;
    update public.fert_traslados
       set estado = 'EN_TRANSITO', autorizado_at = p_creado, autorizador_id = (select auth.uid()),
           nota_autorizacion = nullif(btrim(d->>'nota'), '')
     where id = v_t.id;
    return v_obs;
end;
$$;

create or replace function public._fert_op_traslado_resolver(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid, p_aceptar boolean
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t      public.fert_traslados%rowtype;
    v_obs    text[];
    v_rec    numeric;
    v_linea  jsonb;
    l        record;
begin
    select * into v_t from public.fert_traslados where id = public._fert_uuid(d->>'traslado_id') for update;
    if not found then
        raise exception 'El traslado no existe.';
    end if;
    if v_t.estado <> 'EN_TRANSITO' then
        raise exception 'Ese traslado no está en camino (está %).', lower(v_t.estado);
    end if;
    v_obs := public._fert_autorizar(v_t.destino_id, 'trasladar', p_creado, p_inmediato, p_en_nombre);

    if not p_aceptar and nullif(btrim(d->>'nota'), '') is null then
        raise exception 'Indica por qué rechazas el traslado.';
    end if;

    for l in select * from public.fert_traslados_detalle where traslado_id = v_t.id loop
        perform public._fert_en_transito(v_t.destino_id, l.material_id, -l.cantidad_enviada);
        if p_aceptar then
            v_rec := l.cantidad_enviada;
            if jsonb_typeof(d->'lineas') = 'array' then
                select x into v_linea from jsonb_array_elements(d->'lineas') x where x->>'material_id' = l.material_id::text limit 1;
                if v_linea is not null and nullif(btrim(v_linea->>'cantidad_recibida'), '') is not null then
                    begin
                        v_rec := round(replace(btrim(v_linea->>'cantidad_recibida'), ',', '')::numeric, 4);
                    exception when others then
                        raise exception 'Una cantidad recibida no es un número válido.';
                    end;
                end if;
            end if;
            if v_rec < 0 or v_rec > l.cantidad_enviada then
                raise exception 'Lo recibido de % tiene que estar entre 0 y lo enviado (%).',
                    (select coalesce(descripcion, codigo) from public.materiales where id = l.material_id), l.cantidad_enviada;
            end if;
            update public.fert_traslados_detalle set cantidad_recibida = v_rec
             where traslado_id = v_t.id and material_id = l.material_id;
            if v_rec > 0 then
                perform public._fert_mover(p_id, v_t.destino_id, l.material_id, 'TRASLADO_ENTRADA', v_rec, p_creado,
                                           null, 'traslado', v_t.id, false);
            end if;
            if v_rec < l.cantidad_enviada then
                v_obs := public._fert_obs(v_obs, array['DIFERENCIA_TRASLADO']);
            end if;
        else
            perform public._fert_mover(p_id, v_t.origen_id, l.material_id, 'TRASLADO_DEVUELTO', l.cantidad_enviada,
                                       p_creado, null, 'traslado', v_t.id, false);
        end if;
    end loop;

    update public.fert_traslados
       set estado = case when p_aceptar then 'ACEPTADO' else 'RECHAZADO' end,
           resuelto_por = coalesce(p_en_nombre, (select auth.uid())), resuelto_at = p_creado,
           nota_resolucion = nullif(btrim(d->>'nota'), '')
     where id = v_t.id;
    return v_obs;
end;
$$;

create or replace function public._fert_op_traslado_cancelar(p_id uuid, d jsonb) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_t public.fert_traslados%rowtype;
begin
    select * into v_t from public.fert_traslados where id = public._fert_uuid(d->>'traslado_id') for update;
    if not found then
        raise exception 'El traslado no existe.';
    end if;
    if v_t.creado_por is distinct from (select auth.uid()) and not public.fn_fert_puede(v_t.origen_id, 'anular') then
        raise exception 'Solo quien creó el traslado puede cancelarlo.' using errcode = '42501';
    end if;
    if v_t.estado <> 'POR_AUTORIZAR' then
        raise exception 'Ya fue autorizado o resuelto: no se puede cancelar.';
    end if;
    update public.fert_traslados set estado = 'ANULADO', resuelto_por = (select auth.uid()), resuelto_at = now(),
           nota_resolucion = coalesce(nullif(btrim(d->>'motivo'), ''), 'Cancelado por quien lo creó')
     where id = v_t.id;
    return '{}';
end;
$$;


-- =====================================================================
-- 4 · LA PUERTA: más tipos de registro
-- =====================================================================

create or replace function public._fert_procesar(p_op jsonb)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id        uuid := public._fert_uuid(p_op->>'id');
    v_tipo      text := p_op->>'tipo';
    v_datos     jsonb := coalesce(p_op->'datos', '{}'::jsonb);
    v_creado    timestamptz := coalesce(nullif(p_op->>'creado_en', '')::timestamptz, now());
    v_enviado   timestamptz := nullif(p_op->>'enviado_en', '')::timestamptz;
    v_inmediato boolean := coalesce((p_op->>'inmediato')::boolean, false);
    v_en_nombre uuid := public._fert_uuid(p_op->>'en_nombre_de');
    v_lat       double precision := nullif(p_op->'ubicacion'->>'lat', '')::double precision;
    v_lon       double precision := nullif(p_op->'ubicacion'->>'lon', '')::double precision;
    v_obs       text[] := '{}';
    v_est       uuid;
begin
    if v_id is null then
        raise exception 'El registro no trae identificador.';
    end if;
    if v_tipo is null or v_tipo not in ('recepcion', 'aplicacion', 'bitacora', 'conteo', 'devolucion', 'anulacion',
                                        'chofer', 'vehiculo', 'relevo_entregar', 'relevo_recibir', 'relevo_cancelar',
                                        'relevo_rechazar', 'traslado_crear', 'traslado_autorizar', 'traslado_aceptar',
                                        'traslado_rechazar', 'traslado_cancelar') then
        raise exception 'Tipo de registro desconocido: %. Actualiza la aplicación.', coalesce(v_tipo, '(vacío)');
    end if;

    if v_enviado is not null and abs(extract(epoch from (v_enviado - now()))) > 300
       or v_creado > now() + interval '5 minutes' then
        v_obs := array['RELOJ'];
    end if;
    if v_lat is null or v_lon is null then
        v_obs := public._fert_obs(v_obs, array['SIN_UBICACION']);
    end if;

    v_est := coalesce(public._fert_uuid(v_datos->>'estacion_id'), public._fert_uuid(v_datos->>'origen_id'),
                      (select origen_id from public.fert_traslados where id = public._fert_uuid(v_datos->>'traslado_id')),
                      (select estacion_id from public.fert_relevos where id = public._fert_uuid(v_datos->>'relevo_id')));

    insert into public.fert_operaciones
        (id, tipo, estacion_id, perfil_id, en_nombre_de, dispositivo, creado_en, enviado_en, inmediato,
         lat, lon, precision_m, datos, resultado)
    values
        (v_id, v_tipo, v_est, (select auth.uid()), v_en_nombre,
         left(p_op->>'dispositivo', 200), v_creado, v_enviado, v_inmediato,
         v_lat, v_lon, nullif(p_op->'ubicacion'->>'precision', '')::double precision, v_datos - 'codigo', 'ACEPTADO');

    v_obs := public._fert_obs(v_obs, case v_tipo
        when 'recepcion'          then public._fert_op_recepcion(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'aplicacion'         then public._fert_op_aplicacion(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'bitacora'           then public._fert_op_bitacora(v_id, v_datos, v_creado, v_en_nombre)
        when 'conteo'             then public._fert_op_conteo(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'devolucion'         then public._fert_op_devolucion(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'anulacion'          then public._fert_op_anulacion(v_id, v_datos, v_creado, v_inmediato)
        when 'chofer'             then public._fert_op_chofer(v_id, v_datos)
        when 'vehiculo'           then public._fert_op_vehiculo(v_id, v_datos)
        when 'relevo_entregar'    then public._fert_op_relevo_entregar(v_id, v_datos, v_creado, v_inmediato)
        when 'relevo_recibir'     then public._fert_op_relevo_recibir(v_id, v_datos, v_creado, v_inmediato)
        when 'relevo_cancelar'    then public._fert_op_relevo_cancelar(v_id, v_datos)
        when 'relevo_rechazar'    then public._fert_op_relevo_rechazar(v_id, v_datos)
        when 'traslado_crear'     then public._fert_op_traslado_crear(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'traslado_autorizar' then public._fert_op_traslado_autorizar(v_id, v_datos, v_creado, v_inmediato)
        when 'traslado_aceptar'   then public._fert_op_traslado_resolver(v_id, v_datos, v_creado, v_inmediato, v_en_nombre, true)
        when 'traslado_rechazar'  then public._fert_op_traslado_resolver(v_id, v_datos, v_creado, v_inmediato, v_en_nombre, false)
        when 'traslado_cancelar'  then public._fert_op_traslado_cancelar(v_id, v_datos)
    end);

    update public.fert_operaciones
       set observaciones = v_obs,
           resultado = case when cardinality(v_obs) > 0 then 'ACEPTADO_CON_OBSERVACIONES' else 'ACEPTADO' end
     where id = v_id;
    return v_obs;
end;
$$;


-- =====================================================================
-- 5 · LO QUE BAJA EL TELÉFONO: + relevos, traslados, destinos, autorizadores
-- =====================================================================

create or replace function public.fn_fert_estado_campo(p_desde date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_yo     uuid := (select auth.uid());
    v_est    uuid[];
    v_turnos uuid[];
    v_desde  timestamptz;
    v_zonas  uuid[];
    v_res    jsonb;
begin
    if v_yo is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'ver')) then
        raise exception 'Tu rol no tiene «Ver» en Fertirriego.' using errcode = '42501';
    end if;

    v_est := array(select e.id from public.estaciones_riego e where e.activo and public.fn_fert_puede(e.id, 'ver') order by e.nombre);
    v_turnos := array(select tc.id from public.turnos_ciclo tc where tc.estacion_id = any(v_est) and tc.activo);
    v_zonas := array(select distinct e.zona_id from public.estaciones_riego e where e.id = any(v_est) and e.zona_id is not null);
    v_desde := greatest(
        coalesce(p_desde::timestamptz,
                 (select min(tc.fecha_siembra) - 30 from public.turnos_ciclo tc where tc.id = any(v_turnos))::timestamptz,
                 now() - interval '120 days'),
        now() - interval '365 days');

    select jsonb_build_object(
        'servidor_en', now(),
        'desde', v_desde,
        'yo', (select jsonb_build_object('id', p.id, 'nombre', p.nombre) from public.perfiles p where p.id = v_yo),

        'estaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', e.id, 'nombre', e.nombre, 'zona_id', e.zona_id,
                'zona', (select z.nombre from public.zonas z where z.id = e.zona_id),
                'custodio_id', c.custodio_id,
                'custodio', (select p.nombre from public.perfiles p where p.id = c.custodio_id),
                'custodia_estado', c.estado, 'custodia_desde', c.desde,
                'permisos', jsonb_build_object(
                    'recibir', public.fn_fert_puede(e.id, 'recibir'),
                    'aplicar', public.fn_fert_puede(e.id, 'aplicar'),
                    'contar', public.fn_fert_puede(e.id, 'contar'),
                    'relevo', public.fn_fert_puede(e.id, 'relevo'),
                    'trasladar', public.fn_fert_puede(e.id, 'trasladar'),
                    'autorizar_traslado', public.fn_fert_puede(e.id, 'autorizar_traslado'),
                    'anular', public.fn_fert_puede(e.id, 'anular'),
                    'en_nombre_de', public.fn_fert_puede(e.id, 'en_nombre_de'),
                    'administrar', public.fn_fert_puede(e.id, 'administrar_estaciones'),
                    'gestionar_choferes', public.fn_fert_puede(e.id, 'gestionar_choferes')),
                'personas', coalesce((
                    select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre)
                    from public.perfiles_estaciones pe join public.perfiles p on p.id = pe.perfil_id
                    where pe.estacion_id = e.id and p.activo), '[]'::jsonb),
                'autorizadores', coalesce((
                    select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre))
                    from public._fert_autorizadores(e.id) a where a.id <> v_yo), '[]'::jsonb)
            ) order by e.nombre)
            from public.estaciones_riego e
            left join public.fert_custodia c on c.estacion_id = e.id
            where e.id = any(v_est)), '[]'::jsonb),

        -- Estaciones a las que se puede trasladar (las de sus zonas; si no tiene zonas, todas las activas)
        'destinos', coalesce((
            select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre,
                                                'zona', (select z.nombre from public.zonas z where z.id = e.zona_id),
                                                'misma_zona', e.zona_id = any(v_zonas)) order by (e.zona_id = any(v_zonas)) desc, e.nombre)
            from public.estaciones_riego e where e.activo), '[]'::jsonb),

        'turnos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', tc.id, 'turno', t.codigo, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
                'fecha_siembra', tc.fecha_siembra, 'estacion_id', tc.estacion_id, 'orden_sap', tc.orden_sap,
                'plan', tc.plan, 'area_mz', tc.area_mz, 'activo', tc.activo
            ) order by t.codigo)
            from public.turnos_ciclo tc join public.turnos t on t.id = tc.turno_id
            where tc.id = any(v_turnos)), '[]'::jsonb),

        'plan', coalesce((
            select jsonb_agg(jsonb_build_object(
                'turno_ciclo_id', fp.turno_ciclo_id, 'fecha', fp.fecha, 'ddt', fp.ddt, 'material_id', fp.material_id,
                'cantidad', fp.cantidad, 'horas_riego', fp.horas_riego
            ) order by fp.fecha)
            from public.fert_plan fp where fp.turno_ciclo_id = any(v_turnos)), '[]'::jsonb),

        'materiales', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'codigo', m.codigo, 'descripcion', m.descripcion,
                                                'unidad', m.unidad) order by m.descripcion)
            from public.materiales m where m.fertirriego and m.activo), '[]'::jsonb),

        'choferes', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'validado', c.validado) order by c.nombre)
            from public.fert_choferes c where c.activo), '[]'::jsonb),
        'vehiculos', coalesce((
            select jsonb_agg(jsonb_build_object('id', v.id, 'placa', v.placa, 'tipo', v.tipo, 'marca', v.marca,
                                                'color', v.color, 'validado', v.validado) order by v.placa)
            from public.fert_vehiculos v where v.activo), '[]'::jsonb),
        'choferes_vehiculos', coalesce((
            select jsonb_agg(jsonb_build_object('chofer_id', cv.chofer_id, 'vehiculo_id', cv.vehiculo_id,
                                                'ultima_vez', cv.ultima_vez))
            from public.fert_choferes_vehiculos cv), '[]'::jsonb),

        'saldos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion_id', s.estacion_id, 'material_id', s.material_id,
                                                'disponible', s.disponible, 'en_transito', s.en_transito))
            from public.fert_saldos s where s.estacion_id = any(v_est)), '[]'::jsonb),

        'movimientos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', m.id, 'cursor', m.cursor, 'estacion_id', m.estacion_id, 'material_id', m.material_id,
                'tipo', m.tipo, 'cantidad', m.cantidad, 'fecha_hora', m.fecha_hora, 'turno_ciclo_id', m.turno_ciclo_id,
                'documento_tipo', m.documento_tipo, 'documento_id', m.documento_id, 'anula_id', m.anula_id,
                'registrado_por', m.registrado_por
            ) order by m.fecha_hora, m.cursor)
            from public.fert_movimientos m
            where m.estacion_id = any(v_est) and m.fecha_hora >= v_desde), '[]'::jsonb),

        'saldos_previos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion_id', x.estacion_id, 'material_id', x.material_id, 'saldo', x.saldo))
            from (select m.estacion_id, m.material_id, sum(m.cantidad) as saldo
                  from public.fert_movimientos m
                  where m.estacion_id = any(v_est) and m.fecha_hora < v_desde
                  group by 1, 2) x), '[]'::jsonb),

        'recepciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id, 'estacion_id', r.estacion_id, 'fecha_hora', r.fecha_hora, 'chofer_id', r.chofer_id,
                'vehiculo_id', r.vehiculo_id, 'lugar', r.lugar, 'documento', r.documento, 'comentario', r.comentario,
                'registrado_por', r.registrado_por, 'anulado_at', r.anulado_at, 'motivo_anulacion', r.motivo_anulacion))
            from public.fert_recepciones r where r.estacion_id = any(v_est) and r.fecha_hora >= v_desde), '[]'::jsonb),

        'aplicaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', a.id, 'estacion_id', a.estacion_id, 'turno_ciclo_id', a.turno_ciclo_id, 'fecha', a.fecha,
                'fecha_hora', a.fecha_hora, 'ejecutor_id', a.ejecutor_id, 'ejecutor2_id', a.ejecutor2_id,
                'comentario', a.comentario, 'registrado_por', a.registrado_por, 'anulado_at', a.anulado_at,
                'motivo_anulacion', a.motivo_anulacion,
                'lineas', (select jsonb_agg(jsonb_build_object('material_id', d.material_id, 'cantidad', d.cantidad,
                                                               'en_plan', d.en_plan))
                           from public.fert_aplicaciones_detalle d where d.aplicacion_id = a.id)))
            from public.fert_aplicaciones a where a.estacion_id = any(v_est) and a.fecha_hora >= v_desde), '[]'::jsonb),

        'bitacora_riego', coalesce((
            select jsonb_agg(jsonb_build_object(
                'turno_ciclo_id', b.turno_ciclo_id, 'fecha', b.fecha, 'horas_fertilizacion', b.horas_fertilizacion,
                'horas_riego', b.horas_riego, 'hora_inicio', b.hora_inicio, 'hora_fin', b.hora_fin,
                'ejecutor_id', b.ejecutor_id, 'ejecutor2_id', b.ejecutor2_id, 'comentario', b.comentario))
            from public.fert_bitacora_riego b where b.estacion_id = any(v_est) and b.fecha >= v_desde::date), '[]'::jsonb),

        'relevos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id, 'estacion_id', r.estacion_id, 'estado', r.estado, 'metodo', r.metodo,
                'entrega_id', r.entrega_id, 'entrega', (select p.nombre from public.perfiles p where p.id = r.entrega_id),
                'recibe_id', r.recibe_id, 'recibe', (select p.nombre from public.perfiles p where p.id = r.recibe_id),
                'entregado_at', r.entregado_at, 'recibido_at', r.recibido_at, 'novedades', r.novedades,
                'nota_entrega', r.nota_entrega, 'nota_recibe', r.nota_recibe, 'motivo', r.motivo, 'revisar', r.revisar,
                'diferencias', coalesce((select jsonb_agg(jsonb_build_object('material_id', x.material_id,
                                           'saldo_sistema', x.saldo_sistema, 'cantidad_real', x.cantidad_real, 'diferencia', x.diferencia))
                                         from public.fert_relevos_diferencias x where x.relevo_id = r.id), '[]'::jsonb)
            ) order by coalesce(r.recibido_at, r.entregado_at) desc)
            from (select * from public.fert_relevos
                  where estacion_id = any(v_est)
                    and (estado = 'EN_ENTREGA' or coalesce(recibido_at, entregado_at, created_at) >= v_desde)
                  order by coalesce(recibido_at, entregado_at, created_at) desc limit 60) r), '[]'::jsonb),

        'traslados', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', t.id, 'origen_id', t.origen_id, 'destino_id', t.destino_id,
                'origen', (select e.nombre from public.estaciones_riego e where e.id = t.origen_id),
                'destino', (select e.nombre from public.estaciones_riego e where e.id = t.destino_id),
                'estado', t.estado, 'motivo', t.motivo, 'autorizador_id', t.autorizador_id,
                'autorizador', (select p.nombre from public.perfiles p where p.id = t.autorizador_id),
                'creado_por', t.creado_por, 'creador', (select p.nombre from public.perfiles p where p.id = t.creado_por),
                'creado_at', t.creado_at, 'autorizado_at', t.autorizado_at, 'resuelto_at', t.resuelto_at,
                'nota_autorizacion', t.nota_autorizacion, 'nota_resolucion', t.nota_resolucion,
                'lineas', (select jsonb_agg(jsonb_build_object('material_id', d.material_id, 'cantidad_enviada', d.cantidad_enviada,
                                                               'cantidad_recibida', d.cantidad_recibida))
                           from public.fert_traslados_detalle d where d.traslado_id = t.id)
            ) order by t.creado_at desc)
            from public.fert_traslados t
            where (t.origen_id = any(v_est) or t.destino_id = any(v_est) or t.autorizador_id = v_yo)
              and (t.estado in ('POR_AUTORIZAR', 'EN_TRANSITO') or t.creado_at >= v_desde)), '[]'::jsonb),

        'mis_operaciones', coalesce((
            select jsonb_agg(jsonb_build_object('id', o.id, 'tipo', o.tipo, 'resultado', o.resultado,
                                                'mensaje', o.mensaje, 'observaciones', o.observaciones,
                                                'recibido_en', o.recibido_en) order by o.recibido_en desc)
            from (select * from public.fert_operaciones where perfil_id = v_yo order by recibido_en desc limit 100) o),
            '[]'::jsonb)
    ) into v_res;

    return v_res;
end;
$$;

grant execute on function public.fn_fert_estado_campo(date) to authenticated;


-- =====================================================================
-- 6 · EXPORTACIÓN A AGL (Etapa D): lo nuevo desde un cursor
-- =====================================================================
-- AGL guarda el último cursor que bajó y pide lo posterior. Cada movimiento sale «aplanado» (con códigos y nombres)
-- para que AGL no tenga que conocer los ids de Supabase. También baja la bitácora de riego y los saldos actuales.

create or replace function public.fn_fert_exportar(p_cursor bigint default 0, p_limite integer default 5000)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_lim integer := greatest(1, least(coalesce(p_limite, 5000), 20000));
    v_res jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'ver')) then
        raise exception 'Este usuario no tiene «Ver» en «Fertirriego · Conexión AGL».' using errcode = '42501';
    end if;

    with m as (
        select * from public.fert_movimientos where cursor > coalesce(p_cursor, 0) order by cursor limit v_lim
    )
    select jsonb_build_object(
        'generado', now(),
        'ultimo_cursor', coalesce((select max(cursor) from m), coalesce(p_cursor, 0)),
        'hay_mas', (select count(*) from m) = v_lim,
        'movimientos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'cursor', m.cursor, 'id', m.id, 'fecha_hora', m.fecha_hora, 'tipo', m.tipo, 'cantidad', m.cantidad,
                'estacion', e.nombre, 'zona', z.nombre, 'material', mt.codigo, 'texto_material', mt.descripcion,
                'unidad', mt.unidad,
                'turno', t.codigo, 'turno_agl_id', tc.agl_id, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
                'orden_sap', tc.orden_sap,
                'fecha_turno', (select a.fecha from public.fert_aplicaciones a where a.id = m.documento_id),
                'documento_tipo', m.documento_tipo, 'documento_id', m.documento_id, 'anula_id', m.anula_id,
                'registrado_por', p.nombre,
                'ejecutor', (select pp.nombre from public.fert_aplicaciones a join public.perfiles pp on pp.id = a.ejecutor_id
                             where a.id = m.documento_id),
                'observaciones', (select o.observaciones from public.fert_operaciones o where o.id = m.operacion_id)
            ) order by m.cursor)
            from m
            join public.estaciones_riego e on e.id = m.estacion_id
            left join public.zonas z on z.id = e.zona_id
            join public.materiales mt on mt.id = m.material_id
            left join public.turnos_ciclo tc on tc.id = m.turno_ciclo_id
            left join public.turnos t on t.id = tc.turno_id
            left join public.perfiles p on p.id = m.registrado_por), '[]'::jsonb),
        'bitacora_riego', coalesce((
            select jsonb_agg(jsonb_build_object(
                'turno_agl_id', tc.agl_id, 'turno', t.codigo, 'fecha', b.fecha, 'estacion', e.nombre,
                'horas_fertilizacion', b.horas_fertilizacion, 'horas_riego', b.horas_riego,
                'hora_inicio', b.hora_inicio, 'hora_fin', b.hora_fin,
                'ejecutor', (select p.nombre from public.perfiles p where p.id = b.ejecutor_id)))
            from public.fert_bitacora_riego b
            join public.turnos_ciclo tc on tc.id = b.turno_ciclo_id
            join public.turnos t on t.id = tc.turno_id
            join public.estaciones_riego e on e.id = b.estacion_id), '[]'::jsonb),
        'saldos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'zona', z.nombre, 'material', mt.codigo,
                                                'texto_material', mt.descripcion, 'unidad', mt.unidad,
                                                'disponible', s.disponible, 'en_transito', s.en_transito))
            from public.fert_saldos s
            join public.estaciones_riego e on e.id = s.estacion_id
            left join public.zonas z on z.id = e.zona_id
            join public.materiales mt on mt.id = s.material_id), '[]'::jsonb),
        'relevos_revisar', coalesce((
            select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'entrega', pe.nombre, 'recibe', pr.nombre,
                                                'recibido_at', r.recibido_at, 'estado', r.estado, 'motivo', r.motivo))
            from public.fert_relevos r
            join public.estaciones_riego e on e.id = r.estacion_id
            left join public.perfiles pe on pe.id = r.entrega_id
            left join public.perfiles pr on pr.id = r.recibe_id
            where r.revisar), '[]'::jsonb)
    ) into v_res;
    return v_res;
end;
$$;

grant execute on function public.fn_fert_exportar(bigint, integer) to authenticated;


-- =====================================================================
-- 7 · PERMISOS DE LAS FUNCIONES INTERNAS
-- =====================================================================

do $$
declare f text;
begin
    foreach f in array array[
        'public._fert_op_relevo_entregar(uuid, jsonb, timestamptz, boolean)',
        'public._fert_op_relevo_recibir(uuid, jsonb, timestamptz, boolean)',
        'public._fert_op_relevo_cancelar(uuid, jsonb)',
        'public._fert_op_relevo_rechazar(uuid, jsonb)',
        'public._fert_en_transito(uuid, uuid, numeric)',
        'public._fert_op_traslado_crear(uuid, jsonb, timestamptz, boolean, uuid)',
        'public._fert_op_traslado_autorizar(uuid, jsonb, timestamptz, boolean)',
        'public._fert_op_traslado_resolver(uuid, jsonb, timestamptz, boolean, uuid, boolean)',
        'public._fert_op_traslado_cancelar(uuid, jsonb)',
        'public._fert_procesar(jsonb)']
    loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
    end loop;
end $$;
