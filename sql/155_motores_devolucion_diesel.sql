-- =====================================================================
-- 155 · MOTORES · DEVOLVER DIÉSEL DEL TANQUE A BODEGA (igual que la devolución a bodega de Fertirriego)
-- =====================================================================
-- Pedido del usuario (2026-11-26): «No tengo cómo registrar la devolución del diésel: se devolvió a bodega. Quiero las mismas
-- opciones que en Fertirriego, que un diésel se pueda devolver a bodega».
--
--   · Operación nueva `diesel_devolver` (teléfono, con cola sin señal): saca galones de un TANQUE de la estación hacia
--     SUMINISTROS, BODEGA o TALLER. Mismo detalle que la devolución de Fertirriego (sql/128 + 131): destino, motivo, fecha y
--     hora, quién lo retiró (catálogo fert_choferes) y en qué vehículo (catálogo fert_vehiculos, con tipo obligatorio), GPS
--     (en fert_operaciones), quién registró y saldo del tanque antes/después. No se puede devolver más de lo que hay.
--     Permiso: «Registrar» de Motores + custodia de la estación (como recibir diésel: _mot_autorizar).
--   · Tabla `mot_devoluciones` (bitácora, baja a AGL). Libro del tanque: movimiento DEVOLUCION_TANQUE (el mismo tipo que ya
--     usaba el retiro de la 130 y que AGL ya resta en el cuadre por sql/135), documento_tipo `diesel_devolucion`.
--   · Anular: `anulacion` con documento_tipo `diesel_devolucion` → `_mot_op_anulacion_devolucion` (motivo obligatorio; quien
--     tiene «Anular» o el propio autor en su jornada, igual que Fertirriego). Revierte el libro del tanque.
--   · Regla del visor: una devolución en un día CON registro del motor se toma como hecha DESPUÉS de las lecturas de ese día
--     (fin de jornada / fin de temporada). Así: (a) `_mot_realinear_tanque` la cuenta como posterior al visor final de ese día;
--     (b) la señal VISOR_FALTA/SOBRA (`_mot_senales`) la resta entre el día anterior (incluido) y el día del registro (excluido).
--     Si se registra tarde (ya hay registros de días posteriores), el tanque se realinea con el visor (el visor manda).
--   · fn_mot_estado_campo: lista `devoluciones` (con nombres de quién registró/anuló) para el historial del teléfono.
--   · AGL: `_mot_filas` baja `tabla = 'devolucion'` (cursor 'd|'); fn_mot_confirmar_bajada la marca; fn_mot_purgar_bajadas la
--     purga pasada la retención (conteo `devoluciones`). AGL debe conocer la tabla «devolucion» (motores_bajada.py) ANTES de
--     correr esta migración en producción; si no, esas filas quedan sin confirmar (no se pierden).
--
-- Correr DESPUÉS de la 153 (y 130, 135, 147, 150). Idempotente. Todo UPDATE/DELETE lleva WHERE. Parches con marcas «155:».
-- ORDEN: si se vuelve a correr la 91/96/99/130 (_fert_procesar), la 130/135/145/147 (_mot_filas, confirmar, purgar),
-- 130/138/145/147/148/149 (fn_mot_estado_campo), 147/150 (_mot_senales) o la 153 (_mot_realinear_tanque) → CORRER LA 155 OTRA VEZ.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

do $$
begin
    if to_regprocedure('public._mot_realinear_tanque(uuid,uuid)') is null then
        raise exception '155: falta correr antes la 153 (integridad del tanque).';
    end if;
    if to_regclass('public.mot_mov_bajada') is null then
        raise exception '155: falta correr antes la 135.';
    end if;
end $$;

-- ---------------------------------------------------------------- 1 · tabla
create table if not exists public.mot_devoluciones (
    id               uuid primary key,
    tanque_id        uuid not null references public.mot_tanques(id),
    estacion_id      uuid not null references public.estaciones_riego(id),
    material_id      uuid references public.materiales(id),
    galones          numeric(12,2) not null check (galones > 0),
    fecha_hora       timestamptz not null,
    destino          text not null check (destino in ('SUMINISTROS', 'BODEGA', 'TALLER')),
    motivo           text not null,
    chofer_id        uuid references public.fert_choferes(id),
    vehiculo_id      uuid references public.fert_vehiculos(id),
    chofer_nombre    text,
    vehiculo_placa   text,
    vehiculo_tipo    text,
    saldo_antes      numeric(14,4),
    saldo_despues    numeric(14,4),
    registrado_por   uuid,
    creado_en        timestamptz not null default now(),
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text,
    bajado_a_agl_en  timestamptz,
    huella           text
);
create index if not exists mot_devoluciones_estacion_idx on public.mot_devoluciones (estacion_id, fecha_hora desc);
create index if not exists mot_devoluciones_tanque_idx on public.mot_devoluciones (tanque_id, fecha_hora desc);
alter table public.mot_devoluciones enable row level security;   -- sin políticas: solo las funciones
comment on table public.mot_devoluciones is
    '155: diésel devuelto de un tanque a Suministros/Bodega/Taller, con quién lo retiró, vehículo, motivo y saldo antes/después. Baja a AGL.';

-- ---------------------------------------------------------------- 2 · operación: devolver
/** datos = {estacion_id, tanque_id, galones, fecha_hora, destino, motivo, chofer_id, vehiculo_id} */
create or replace function public._mot_op_diesel_devolver(p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t          public.mot_tanques%rowtype;
    v_tanque   uuid := public._fert_uuid(d->>'tanque_id');
    v_gal      numeric := public._mot_num(d->>'galones');
    v_fecha    timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_destino  text := upper(nullif(btrim(coalesce(d->>'destino', '')), ''));
    v_motivo   text := nullif(btrim(coalesce(d->>'motivo', '')), '');
    v_chofer   uuid := public._fert_uuid(d->>'chofer_id');
    v_vehiculo uuid := public._fert_uuid(d->>'vehiculo_id');
    v_chofer_n text;
    v_placa    text;
    v_vtipo    text;
    v_mat      uuid;
    v_saldo    numeric;
    v_obs      text[];
begin
    if v_tanque is null then
        raise exception 'Elige el tanque de donde sale el diésel.';
    end if;
    select * into t from public.mot_tanques where id = v_tanque and activo;
    if not found then
        raise exception 'El tanque no existe o ya no está activo. Actualiza la aplicación.';
    end if;
    if t.estacion_id is null then
        raise exception 'El tanque no está asignado a ninguna estación.';
    end if;
    if v_destino is null or v_destino not in ('SUMINISTROS', 'BODEGA', 'TALLER') then
        raise exception 'Elige el destino de la devolución: suministros, bodega o taller.';
    end if;
    if v_motivo is null then
        raise exception 'Indica el motivo de la devolución.';
    end if;
    if v_gal is null or v_gal <= 0 then
        raise exception 'Indica los galones que se devuelven.';
    end if;
    if v_fecha > now() + interval '5 minutes' then
        raise exception 'La devolución no puede ser en el futuro.';
    end if;
    -- quién lo retiró y en qué vehículo: obligatorios (es diésel = dinero que sale de la estación), del catálogo de campo
    select c.nombre into v_chofer_n from public.fert_choferes c where c.id = v_chofer;
    if v_chofer is null or v_chofer_n is null then
        raise exception 'Indica quién retiró el diésel (chofer o persona).';
    end if;
    select v.placa, nullif(btrim(v.tipo), '') into v_placa, v_vtipo from public.fert_vehiculos v where v.id = v_vehiculo;
    if v_vehiculo is null or v_placa is null then
        raise exception 'Indica en qué vehículo se llevaron el diésel (placa o identificación).';
    end if;
    if v_vtipo is null then
        raise exception 'El vehículo % no tiene tipo (camión, carro, tractor...) en el catálogo: complétalo en Administración › Choferes y catálogos de campo.', v_placa;
    end if;

    v_obs := public._mot_autorizar(t.estacion_id, 'registrar', p_creado, p_inmediato, p_en_nombre);
    v_mat := coalesce(t.material_id, (select c.material_diesel_id from public.mot_bajada_config c where c.id));
    if v_mat is null then
        raise exception 'AGL todavía no publica el producto diésel. Avisa a la Torre de Control.';
    end if;

    -- solo lo que hay en el tanque (bloquea el saldo para que dos envíos a la vez no pasen los dos)
    select s.disponible into v_saldo from public.mot_saldos s where s.tanque_id = t.id for update;
    v_saldo := coalesce(v_saldo, 0);
    if v_gal > v_saldo then
        raise exception 'No se puede devolver % gal: en el tanque % solo hay % gal.', trim_scale(v_gal), t.nombre, trim_scale(round(v_saldo, 2));
    end if;

    insert into public.mot_devoluciones (id, tanque_id, estacion_id, material_id, galones, fecha_hora, destino, motivo,
                                         chofer_id, vehiculo_id, chofer_nombre, vehiculo_placa, vehiculo_tipo,
                                         saldo_antes, saldo_despues, registrado_por)
    values (p_id, t.id, t.estacion_id, v_mat, v_gal, v_fecha, v_destino, v_motivo,
            v_chofer, v_vehiculo, v_chofer_n, v_placa, v_vtipo,
            v_saldo, v_saldo - v_gal, (select auth.uid()));
    perform public._mot_mover(p_id, t.id, v_mat, 'DEVOLUCION_TANQUE', -v_gal, v_fecha, 'diesel_devolucion', p_id);
    update public.fert_operaciones set estacion_id = t.estacion_id where id = p_id;
    -- registrada tarde (ya hay lecturas de días posteriores): el visor manda
    if exists (select 1 from public.mot_registros r where r.tanque_id = t.id and r.anulado_at is null and r.fecha > public._mot_dia(v_fecha)) then
        perform public._mot_realinear_tanque(t.id, p_id);
    end if;
    -- aprende la pareja chofer-vehículo (igual que Fertirriego)
    insert into public.fert_choferes_vehiculos (chofer_id, vehiculo_id, ultima_vez)
    values (v_chofer, v_vehiculo, v_fecha)
    on conflict (chofer_id, vehiculo_id) do update set ultima_vez = greatest(fert_choferes_vehiculos.ultima_vez, excluded.ultima_vez);
    return v_obs;
end $$;
revoke execute on function public._mot_op_diesel_devolver(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3 · operación: anular la devolución
create or replace function public._mot_op_anulacion_devolucion(p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_doc      uuid := public._fert_uuid(d->>'documento_id');
    v_motivo   text := nullif(btrim(coalesce(d->>'motivo', '')), '');
    x          public.mot_devoluciones%rowtype;
    v_registro timestamptz;
    v_custodia public.fert_custodia%rowtype;
    m          record;
begin
    if v_motivo is null then
        raise exception 'Indica el motivo de la anulación.';
    end if;
    select * into x from public.mot_devoluciones where id = v_doc for update;
    if not found then
        raise exception 'El registro a anular no existe.';
    end if;
    if x.anulado_at is not null then
        raise exception 'Ese registro ya estaba anulado.';
    end if;

    select coalesce(o.creado_en, o.recibido_en) into v_registro from public.fert_operaciones o where o.id = v_doc;
    if not (public.fn_es_admin()
            or (public.fn_tiene_permiso('motores', 'anular') and public.fn_fert_puede(x.estacion_id, 'anular'))) then
        select * into v_custodia from public.fert_custodia where estacion_id = x.estacion_id;
        if not (x.registrado_por = (select auth.uid())
                and v_custodia.custodio_id = (select auth.uid())
                and v_custodia.estado = 'ACTIVA'
                and v_custodia.desde <= coalesce(v_registro, now())) then
            raise exception 'Solo puedes anular tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'
                using errcode = '42501';
        end if;
    end if;

    for m in select * from public.mot_movimientos mv
             where mv.documento_id = v_doc and mv.anula_id is null and mv.tipo <> 'ANULACION'
               and not exists (select 1 from public.mot_movimientos z where z.anula_id = mv.id)
             order by mv.id loop
        perform public._mot_mover(p_id, m.tanque_id, m.material_id, 'ANULACION', -m.cantidad, p_creado, 'diesel_devolucion', v_doc, m.id);
    end loop;
    update public.mot_devoluciones set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo where id = v_doc;
    update public.fert_operaciones set estacion_id = x.estacion_id where id = p_id;
    if exists (select 1 from public.mot_registros r where r.tanque_id = x.tanque_id and r.anulado_at is null and r.fecha > public._mot_dia(x.fecha_hora)) then
        perform public._mot_realinear_tanque(x.tanque_id, p_id);
    end if;
    return '{}';
end $$;
revoke execute on function public._mot_op_anulacion_devolucion(uuid, jsonb, timestamptz, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4 · lo que baja al teléfono
create or replace function public._mot_devoluciones_json(p_ests uuid[], p_desde date)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', x.id, 'tanque_id', x.tanque_id, 'estacion_id', x.estacion_id, 'galones', x.galones, 'fecha_hora', x.fecha_hora,
               'destino', x.destino, 'motivo', x.motivo, 'chofer_id', x.chofer_id, 'vehiculo_id', x.vehiculo_id,
               'chofer', x.chofer_nombre, 'vehiculo', x.vehiculo_placa, 'vehiculo_tipo', x.vehiculo_tipo,
               'saldo_antes', x.saldo_antes, 'saldo_despues', x.saldo_despues,
               'registrado_por', x.registrado_por, 'registrado_por_nombre', pr.nombre,
               'anulado_at', x.anulado_at, 'anulado_por_nombre', pa.nombre, 'motivo_anulacion', x.motivo_anulacion,
               'lat', o.lat, 'lon', o.lon))
             order by x.fecha_hora desc), '[]'::jsonb)
      from public.mot_devoluciones x
      left join public.perfiles pr on pr.id = x.registrado_por
      left join public.perfiles pa on pa.id = x.anulado_por
      left join public.fert_operaciones o on o.id = x.id
     where x.estacion_id = any(p_ests)
       and public._mot_dia(x.fecha_hora) >= p_desde
$$;
revoke execute on function public._mot_devoluciones_json(uuid[], date) from public, anon, authenticated;

-- ---------------------------------------------------------------- 5 · parches (marca propia 155)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def   text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n     integer;
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '155: en % se esperaba 1 aparición de «%» y hay % (¿faltan 130/135/147/150/153?)', p_fn, left(v_viejo, 80), v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '155: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- 5a · despachador: tipo nuevo, a qué función va y su anulación
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$'motor_mantenimiento', 'diesel_recibir',$p$,
    $p$'motor_mantenimiento', 'diesel_recibir', 'diesel_devolver',$p$,
    $p$'diesel_devolver',$p$);
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$        when 'diesel_recibir'         then public._mot_op_diesel_recibir(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)$p$,
    $p$        when 'diesel_recibir'         then public._mot_op_diesel_recibir(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'diesel_devolver'        then public._mot_op_diesel_devolver(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)$p$,
    $p$_mot_op_diesel_devolver($p$);
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$when v_datos->>'documento_tipo' in ('motor_registro', 'diesel_recepcion', 'motor_mantenimiento', 'motor_asignacion')$p$,
    $p$when v_datos->>'documento_tipo' = 'diesel_devolucion'
                                            then public._mot_op_anulacion_devolucion(v_id, v_datos, v_creado, v_inmediato)
                                            when v_datos->>'documento_tipo' in ('motor_registro', 'diesel_recepcion', 'motor_mantenimiento', 'motor_asignacion')$p$,
    $p$_mot_op_anulacion_devolucion($p$);

-- 5b · teléfono: lista de devoluciones
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$        'asignaciones', coalesce(($p$,
    $p$        'devoluciones', public._mot_devoluciones_json(v_ests, v_desde),   -- 155:devoluciones
        'asignaciones', coalesce(($p$,
    $p$155:devoluciones$p$);

-- 5c · realinear: una devolución del mismo día que el último registro va DESPUÉS de sus lecturas
select pg_temp.parchar('public._mot_realinear_tanque(uuid,uuid)',
    $p$       and public._mot_dia(m.fecha_hora) > r.fecha;$p$,
    $p$       and (public._mot_dia(m.fecha_hora) > r.fecha
            or (m.tipo = 'DEVOLUCION_TANQUE' and public._mot_dia(m.fecha_hora) = r.fecha));   -- 155:realinear$p$,
    $p$155:realinear$p$);

-- 5d · señal del visor: la devolución resta entre el día anterior (incluido) y el día del registro (excluido)
select pg_temp.parchar('public._mot_senales(uuid[],date,date)',
    $p$           where mv.tanque_id = r.tanque_id and mv.tipo in ('RECEPCION_DIESEL', 'SUMINISTRO')
             and r.p_fecha is not null
             and public._mot_dia(mv.fecha_hora) > r.p_fecha and public._mot_dia(mv.fecha_hora) <= r.fecha$p$,
    $p$           where mv.tanque_id = r.tanque_id and r.p_fecha is not null   -- 155:senales
             and ((mv.tipo in ('RECEPCION_DIESEL', 'SUMINISTRO')
                   and public._mot_dia(mv.fecha_hora) > r.p_fecha and public._mot_dia(mv.fecha_hora) <= r.fecha)
                  or (mv.tipo = 'DEVOLUCION_TANQUE'
                   and public._mot_dia(mv.fecha_hora) >= r.p_fecha and public._mot_dia(mv.fecha_hora) < r.fecha))$p$,
    $p$155:senales$p$);

-- 5e · bajada a AGL: filas «devolucion»
select pg_temp.parchar('public._mot_filas(uuid[])',
    $p$          from public.mot_asignaciones r where p_ids is null or r.id = any(p_ids)$p$,
    $p$          from public.mot_asignaciones r where p_ids is null or r.id = any(p_ids)
        union all   -- 155:filas
        select 'd|' || r.id::text, 'devolucion', r.id, r.estacion_id, null::uuid, r.tanque_id, public._mot_dia(r.fecha_hora),
               ((to_jsonb(r) - 'bajado_a_agl_en') - 'huella') || jsonb_build_object('tabla', 'devolucion'), r.huella, r.bajado_a_agl_en
          from public.mot_devoluciones r where p_ids is null or r.id = any(p_ids)$p$,
    $p$155:filas$p$);

select pg_temp.parchar('public.fn_mot_confirmar_bajada(jsonb)',
    $p$            where f.tabla = 'asignacion') c
     where t.id = c.id;$p$,
    $p$            where f.tabla = 'asignacion') c
     where t.id = c.id;
    update public.mot_devoluciones t set bajado_a_agl_en = now(), huella = c.h   -- 155:confirmar
      from (select f.id, f.huella as h from public._mot_filas(v_ids) f
             join jsonb_array_elements(v_lote) x on (x ->> 'id')::uuid = f.id and x ->> 'huella' = f.huella
            where f.tabla = 'devolucion') c
     where t.id = c.id;$p$,
    $p$155:confirmar$p$);

select pg_temp.parchar('public.fn_mot_purgar_bajadas(jsonb)',
    $p$    v_r   integer; v_c integer; v_m integer; v_a integer;$p$,
    $p$    v_r   integer; v_c integer; v_m integer; v_a integer; v_d integer;   -- 155:purgar-var$p$,
    $p$155:purgar-var$p$);
select pg_temp.parchar('public.fn_mot_purgar_bajadas(jsonb)',
    $p$    get diagnostics v_a = row_count;

    return jsonb_build_object('registros', v_r, 'recepciones', v_c, 'mantenimientos', v_m, 'asignaciones', v_a,$p$,
    $p$    get diagnostics v_a = row_count;
    delete from public.mot_devoluciones t where t.id in (select id from _mot_purga where tabla = 'devolucion');   -- 155:purgar
    get diagnostics v_d = row_count;

    return jsonb_build_object('registros', v_r, 'recepciones', v_c, 'mantenimientos', v_m, 'asignaciones', v_a, 'devoluciones', v_d,$p$,
    $p$'devoluciones', v_d$p$);

-- ---------------------------------------------------------------- 6 · comprobación
do $$
begin
    if position('_mot_op_diesel_devolver(' in pg_get_functiondef('public._fert_procesar(jsonb)'::regprocedure)) = 0
       or position('_mot_op_anulacion_devolucion(' in pg_get_functiondef('public._fert_procesar(jsonb)'::regprocedure)) = 0
       or position('155:devoluciones' in pg_get_functiondef('public.fn_mot_estado_campo(date)'::regprocedure)) = 0
       or position('155:realinear' in pg_get_functiondef('public._mot_realinear_tanque(uuid,uuid)'::regprocedure)) = 0
       or position('155:senales' in pg_get_functiondef('public._mot_senales(uuid[],date,date)'::regprocedure)) = 0
       or position('155:filas' in pg_get_functiondef('public._mot_filas(uuid[])'::regprocedure)) = 0
       or position('155:confirmar' in pg_get_functiondef('public.fn_mot_confirmar_bajada(jsonb)'::regprocedure)) = 0
       or position($q$'devoluciones', v_d$q$ in pg_get_functiondef('public.fn_mot_purgar_bajadas(jsonb)'::regprocedure)) = 0 then
        raise exception '155: algún parche no quedó puesto.';
    end if;
end $$;
