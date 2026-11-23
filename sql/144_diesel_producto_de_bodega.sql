-- =====================================================================
-- 144 · DIÉSEL = PRODUCTO DE LA BODEGA DE LA ESTACIÓN (modelo «bodega y tanque»)
-- =====================================================================
-- Pedido del usuario (2026-11-23): «cuando se recepciona diésel, ese diésel tiene que registrarse como un PRODUCTO de la
-- bodega de la estación» y «el suministro se rebaja de la bodega cada vez que se hace el registro diario».
--
--   · RECIBIR diésel (operación `diesel_recibir`) = entra a la bodega de la ESTACIÓN como un producto más, en el libro de
--     Fertirriego (fert_movimientos / fert_saldos, tipo RECEPCION_DIESEL, vía _fert_mover). El producto es el diésel que
--     publica AGL (mot_bajada_config.material_diesel_id): NO se crea otro catálogo. La recepción es a nivel estación: ya no
--     lleva tanque (mot_recepciones.tanque_id pasa a admitir null; se conserva la tabla como bitácora y para AGL).
--     Un envío viejo de la cola que traiga `tanque_id` (sin `estacion_id`) se acepta: la estación sale del tanque.
--     Permiso: «Registrar» de Motores, o «Recibir» de Fertirriego en la estación (el botón también vive en la Bodega).
--   · REGISTRO DIARIO del motor (`motor_registro_diario`): el campo `suministro_gal` (el «suministro de combustible» de la
--     hoja FTR_F-MA-103) REBAJA la bodega (fert_movimientos SUMINISTRO_MOTOR, negativo) y SUBE el tanque del motor
--     (mot_movimientos SUMINISTRO). Gastado = visor inicial − visor final + suministro (mot_registros.recibido_gal guarda el
--     suministro). El tanque, el visor, AJUSTE_VISOR y el rendimiento gal/h siguen igual. Sin inventario suficiente: en línea
--     la base rechaza («No alcanza el saldo…»); con la casilla de confirmación del teléfono (acepta_negativo) o desde la cola se
--     registra con la observación SALDO_NEGATIVO (igual que Aplicar). Registro histórico (historica = true, sql/140): NO mueve
--     bodega ni tanque.
--   · ANULAR y «Eliminar por completo» (sql/140) de un registro diario o de una recepción de diésel revierten también el
--     movimiento de la bodega (saldo coherente).
--   · fn_fert_bodega_general: el diésel de la bodega sale de fert_saldos (como cualquier producto, tipo DIESEL, con
--     última recepción y procedencia del libro de recepciones de diésel). Ya NO se listan los tanques de los motores en la
--     bodega (no se cuenta dos veces); el diésel dentro del tanque se ve en la ficha del motor. Devuelve además
--     `material_diesel_id` para que el teléfono arme el saldo local.
--   · Datos existentes: lo que ya está en los tanques se queda en el tanque (es diésel físicamente en el motor); la bodega de
--     diésel empieza en 0 (no se inventa un saldo inicial: se registra recibiendo o con un conteo).
--   · AGL: mot_registros.recibido_gal = suministro del día; las recepciones bajan con tanque_id null (nivel estación).
--
-- Correr DESPUÉS de la 140 (y de 130, 136, 138, 139). Idempotente. Todo UPDATE/DELETE lleva WHERE.
-- ORDEN: si se vuelve a correr 139 → correr 141, 142, 143 y 144; si se vuelve a correr 130, 136, 138 o 140 → correr 144
-- (redefinen o parchan _mot_op_registro_diario, _mot_op_anulacion, fn_campo_eliminar_documento o fn_fert_bodega_general).
-- Cada parche tiene marca propia «144:» y se salta si ya está puesto.
-- =====================================================================

do $$
begin
    if to_regclass('public.mot_recepciones') is null or to_regclass('public.mot_bajada_config') is null then
        raise exception '144: falta correr antes la 130 (Motores y combustible).';
    end if;
    if to_regprocedure('public.fn_campo_eliminar_documento(text,uuid,text)') is null then
        raise exception '144: falta correr antes la 140 (eliminar por completo en Campo).';
    end if;
    if to_regprocedure('public.fn_fert_bodega_general()') is null then
        raise exception '144: falta correr antes la 139 (bodega general).';
    end if;
    if position('140:historica' in pg_get_functiondef('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) = 0
       and position('144:sum-mov' in pg_get_functiondef('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) = 0 then
        raise exception '144: _mot_op_registro_diario no trae el parche de la 140: corre la 130, 136 y 140 en ese orden y vuelve a correr la 144.';
    end if;
end $$;


-- ---------------------------------------------------------------- 1 · tablas y tipos de movimiento
-- La recepción de diésel es de la estación, no de un tanque
alter table public.mot_recepciones alter column tanque_id drop not null;
comment on column public.mot_recepciones.tanque_id is
    '144: null = recepción a nivel estación (entra a la bodega, producto diésel). Con valor = recepción anterior a la 144 (iba directo al tanque).';

-- libro del tanque: tipo SUMINISTRO (lo que se pasó de la bodega al tanque en el registro diario)
do $$
declare
    v_nombre text;
    v_def    text;
begin
    select c.conname, pg_get_constraintdef(c.oid) into v_nombre, v_def
      from pg_constraint c
     where c.conrelid = 'public.mot_movimientos'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%RECEPCION_DIESEL%'
     limit 1;
    if v_nombre is null then
        raise exception '144: no se encontró el check de tipo de mot_movimientos.';
    end if;
    if v_def not like '%SUMINISTRO%' then
        if position('''ANULACION''::text' in v_def) = 0 then
            raise exception '144: el check de tipo de mot_movimientos no trae ANULACION: %', v_def;
        end if;
        execute format('alter table public.mot_movimientos drop constraint %I', v_nombre);
        execute format('alter table public.mot_movimientos add constraint %I %s', v_nombre,
                       replace(v_def, '''ANULACION''::text', '''ANULACION''::text, ''SUMINISTRO''::text'));
    end if;
end $$;

-- libro de la bodega: RECEPCION_DIESEL y SUMINISTRO_MOTOR (se conserva TODO lo que ya admite, como hizo la 129)
do $$
declare
    v_nombre text;
    v_def    text;
    v_nuevo  text;
begin
    select c.conname, pg_get_constraintdef(c.oid) into v_nombre, v_def
      from pg_constraint c
     where c.conrelid = 'public.fert_movimientos'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%TRASLADO_SALIDA%'
     limit 1;
    if v_nombre is null then
        raise exception '144: no se encontró el check de tipo de fert_movimientos.';
    end if;
    if v_def not like '%SUMINISTRO_MOTOR%' or v_def not like '%RECEPCION_DIESEL%' then
        if position('''ANULACION''::text' in v_def) = 0 then
            raise exception '144: el check de tipo de fert_movimientos no trae ANULACION: %', v_def;
        end if;
        v_nuevo := v_def;
        if v_nuevo not like '%RECEPCION_DIESEL%' then
            v_nuevo := replace(v_nuevo, '''ANULACION''::text', '''ANULACION''::text, ''RECEPCION_DIESEL''::text');
        end if;
        if v_nuevo not like '%SUMINISTRO_MOTOR%' then
            v_nuevo := replace(v_nuevo, '''ANULACION''::text', '''ANULACION''::text, ''SUMINISTRO_MOTOR''::text');
        end if;
        execute format('alter table public.fert_movimientos drop constraint %I', v_nombre);
        execute format('alter table public.fert_movimientos add constraint %I %s', v_nombre, v_nuevo);
    end if;
end $$;


-- ---------------------------------------------------------------- 2 · recibir diésel = entra a la bodega de la estación
create or replace function public._mot_op_diesel_recibir(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_est     uuid := public._fert_uuid(d->>'estacion_id');
    v_tanque  uuid := public._fert_uuid(d->>'tanque_id');     -- compatibilidad: un envío viejo de la cola traía el tanque
    v_gal     numeric := public._mot_num(d->>'galones');
    v_fecha   timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_obs     text[];
    v_mat     uuid;
    v_chofer  uuid := public._fert_uuid(d->>'chofer_id');
    v_vehiculo uuid := public._fert_uuid(d->>'vehiculo_id');
begin
    if v_chofer is not null and not exists (select 1 from public.fert_choferes where id = v_chofer) then
        raise exception 'El chofer no está en el catálogo. Actualiza la aplicación.';
    end if;
    if v_vehiculo is not null and not exists (select 1 from public.fert_vehiculos where id = v_vehiculo) then
        raise exception 'El vehículo no está en el catálogo. Actualiza la aplicación.';
    end if;
    if v_est is null and v_tanque is not null then
        select t.estacion_id into v_est from public.mot_tanques t where t.id = v_tanque;
    end if;
    if v_est is null or not exists (select 1 from public.estaciones_riego where id = v_est) then
        raise exception 'Elige la estación donde se recibe el diésel. Actualiza la aplicación.';
    end if;
    if v_gal is null or v_gal <= 0 then
        raise exception 'Indica los galones recibidos.';
    end if;
    -- permiso: «Registrar» de Motores, o «Recibir» de Fertirriego en la estación (el diésel es un producto de la bodega)
    if public.fn_es_admin() or public.fn_tiene_permiso('motores', 'registrar') then
        v_obs := public._mot_autorizar(v_est, 'registrar', p_creado, p_inmediato, p_en_nombre);
    else
        v_obs := public._fert_autorizar(v_est, 'recibir', p_creado, p_inmediato, p_en_nombre);
    end if;
    v_mat := (select c.material_diesel_id from public.mot_bajada_config c where c.id);
    if v_mat is null then
        raise exception 'AGL todavía no publica el producto diésel. Avisa a la Torre de Control.';
    end if;

    insert into public.mot_recepciones (id, tanque_id, estacion_id, galones, chofer_id, vehiculo_id, fecha_hora, comentario, registrado_por)
    values (p_id, null, v_est, v_gal, v_chofer, v_vehiculo, v_fecha,
            nullif(btrim(coalesce(d->>'comentario', '')), ''), (select auth.uid()));
    -- 144: el diésel entra a la bodega de la estación (libro de Fertirriego)
    v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_est, v_mat, 'RECEPCION_DIESEL', v_gal, v_fecha, null,
                                                        'diesel_recepcion', p_id, p_inmediato));
    update public.fert_operaciones set estacion_id = v_est where id = p_id;
    return v_obs;
end $$;
revoke execute on function public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------- 3 · parches (marca propia 144)
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
        raise exception '144: en % se esperaba 1 aparición de «%» y hay % (¿faltan 130/136/139/140?)', p_fn, left(v_viejo, 80), v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '144: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- 3a · registro diario: lo recibido en el tanque ese día pasa a ser el suministro que escribe quien registra
select pg_temp.parchar('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)',
$p$    -- lo recibido ese día (hora de Honduras) en ESTE tanque
    select coalesce(sum(r.galones), 0) into v_recib
      from public.mot_recepciones r
     where r.tanque_id = v_tanque and r.anulado_at is null and public._mot_dia(r.fecha_hora) = v_fecha;
$p$,
$p$    -- 144:sum-calc · el suministro de combustible del día (hoja FTR_F-MA-103) lo escribe quien registra; sale de la bodega de la estación
    v_recib := coalesce(public._mot_num(d->>'suministro_gal'), 0);
    if v_recib < 0 then
        raise exception 'El suministro de combustible no puede ser negativo.';
    end if;
$p$,
$p$144:sum-calc$p$);

select pg_temp.parchar('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)',
$p$y no hay diésel recibido ese día: registra la recepción o corrige la lectura.$p$,
$p$y no anotaste suministro de combustible ese día (144:msg): escríbelo o corrige la lectura.$p$,
$p$144:msg$p$);

-- 3b · el suministro baja la bodega y sube el tanque (antes de realinear con el visor; el histórico no mueve nada)
select pg_temp.parchar('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)',
$p$    v_primero := not exists (select 1 from public.mot_movimientos m where m.tanque_id = v_tanque and m.tipo = 'SALDO_INICIAL');
$p$,
$p$    -- 144:sum-mov · el suministro BAJA la bodega de la estación (producto diésel) y SUBE el tanque del motor; el histórico no mueve nada
    if v_recib > 0 and not v_hist then
        perform public._mot_mover(p_id, v_tanque, v_mat, 'SUMINISTRO', v_recib, v_fh, 'motor_registro', p_id);
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_est, v_mat, 'SUMINISTRO_MOTOR', -v_recib, v_fh, null,
                                                            'motor_registro', p_id, p_inmediato));
    end if;
    v_primero := not exists (select 1 from public.mot_movimientos m where m.tanque_id = v_tanque and m.tipo = 'SALDO_INICIAL');
$p$,
$p$144:sum-mov$p$);

-- 3c · anular: revierte también lo que se movió en la bodega
select pg_temp.parchar('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)',
$p$    if v_tipo = 'motor_registro' then
        update public.mot_registros set anulado_at = now()$p$,
$p$    -- 144:bodega · se revierte también el movimiento de la bodega de la estación (suministro del registro o diésel recibido)
    for m in select * from public.fert_movimientos mv
             where mv.documento_id = v_doc and mv.anula_id is null and mv.tipo <> 'ANULACION'
               and not exists (select 1 from public.fert_movimientos z where z.anula_id = mv.id)
             order by mv.cursor loop
        perform public._fert_mover(p_id, m.estacion_id, m.material_id, 'ANULACION', -m.cantidad, p_creado, m.turno_ciclo_id,
                                   v_tipo, v_doc, p_inmediato, m.id);
    end loop;

    if v_tipo = 'motor_registro' then
        update public.mot_registros set anulado_at = now()$p$,
$p$144:bodega$p$);

-- 3d · eliminar por completo (140): también los movimientos de la bodega del registro diario o de la recepción
select pg_temp.parchar('public.fn_campo_eliminar_documento(text, uuid, text)',
$p$        v_movs := array($p$,
$p$        v_fmovs := array(   -- 144:bodega-lista · los movimientos de la bodega que dejó este registro (y sus anulaciones)
            with recursive m as (
                select id from public.fert_movimientos where documento_id = p_documento
                union
                select z.id from public.fert_movimientos z join m on z.anula_id = m.id
            ) select id from m);
        v_movs := array($p$,
$p$144:bodega-lista$p$);

select pg_temp.parchar('public.fn_campo_eliminar_documento(text, uuid, text)',
$p$            delete from public.mot_mov_bajada where movimiento_id = any(v_movs);
$p$,
$p$            if cardinality(v_fmovs) > 0 then   -- 144:bodega-borrar · también el libro de la bodega (y su saldo)
                perform set_config('fert.libro_permitir', 'on', true);
                update public.fert_saldos s
                   set disponible = s.disponible - d.suma, updated_at = now()
                  from (select m.estacion_id, m.material_id, sum(m.cantidad) as suma
                          from public.fert_movimientos m where m.id = any(v_fmovs) group by 1, 2) d
                 where s.estacion_id = d.estacion_id and s.material_id = d.material_id;
                delete from public.fert_movimientos where id = any(v_fmovs);
                perform set_config('fert.libro_permitir', 'off', true);
            end if;
            delete from public.mot_mov_bajada where movimiento_id = any(v_movs);
$p$,
$p$144:bodega-borrar$p$);

select pg_temp.parchar('public.fn_campo_eliminar_documento(text, uuid, text)',
$p$    if p_tipo = 'iny_aplicacion' then
        v_neg := coalesce((
$p$,
$p$    if p_tipo = 'iny_aplicacion' or cardinality(v_fmovs) > 0 then   -- 144:bodega-neg
        v_neg := coalesce((
$p$,
$p$144:bodega-neg$p$);

-- 3e · bodega general: el diésel de la bodega es un producto (fert_saldos); los tanques de los motores ya no se cuentan aquí
select pg_temp.parchar('public.fn_fert_bodega_general()',
$p$        'servidor_en', now(),
        'filas', coalesce((
$p$,
$p$        'servidor_en', now(),
        'material_diesel_id', v_diesel,   -- 144:diesel-id
        'filas', coalesce((
$p$,
$p$144:diesel-id$p$);

select pg_temp.parchar('public.fn_fert_bodega_general()',
$p$case when m.fert_analisis then 'FERTILIZANTE' when m.iny_activo then 'INYECCION' else 'OTRO' end,$p$,
$p$case when m.id = v_diesel then 'DIESEL' when m.fert_analisis then 'FERTILIZANTE' when m.iny_activo then 'INYECCION' else 'OTRO' end,   -- 144:tipo$p$,
$p$144:tipo$p$);

select pg_temp.parchar('public.fn_fert_bodega_general()',
$p$'ultima_recepcion', coalesce(ur.fecha_hora, um.fecha_hora),$p$,
$p$'ultima_recepcion', coalesce(
                               case when m.id = v_diesel then (select max(r.fecha_hora) from public.mot_recepciones r   -- 144:ultima
                                                                where r.estacion_id = s.estacion_id and r.anulado_at is null) end,
                               ur.fecha_hora, um.fecha_hora),$p$,
$p$144:ultima$p$);

select pg_temp.parchar('public.fn_fert_bodega_general()',
$p$'procedencia', case
                               when ur.fecha_hora is not null then$p$,
$p$'procedencia', case
                               when m.id = v_diesel and exists (select 1 from public.mot_recepciones r   -- 144:procedencia
                                                                 where r.estacion_id = s.estacion_id and r.anulado_at is null) then
                                   (select nullif(concat_ws(' · ', nullif(c.nombre, ''), nullif(v.placa, '')), '')
                                      from public.mot_recepciones r
                                      left join public.fert_choferes c on c.id = r.chofer_id
                                      left join public.fert_vehiculos v on v.id = r.vehiculo_id
                                     where r.estacion_id = s.estacion_id and r.anulado_at is null
                                     order by r.fecha_hora desc limit 1)
                               when ur.fecha_hora is not null then$p$,
$p$144:procedencia$p$);

select pg_temp.parchar('public.fn_fert_bodega_general()',
$p$                 where z.estacion_id = any(v_est)
            ) x), '[]'::jsonb)$p$,
$p$                 where z.estacion_id = any(v_est) and false   -- 144:sin-tanques · el diésel de los tanques se ve en la ficha del motor, no en la bodega
            ) x), '[]'::jsonb)$p$,
$p$144:sin-tanques$p$);

notify pgrst, 'reload schema';
