-- =====================================================================
-- PRUEBAS de sql/144 · Diésel = producto de la bodega de la estación
-- Réplica local con 91–144 y los datos de prueba de 96/99/115 (estación Papalon-1, e1 = estacionero, chofer 10000000-...-0001).
-- Correr DESDE LA RAÍZ DEL REPO con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/144_diesel_bodega.sql
-- Autosuficiente (crea su propio admin, diésel y motor T144-M1). NO ejecutada todavía (la corre Opus).
-- Órdenes a probar después: 144 > 130 > 136 > 138 > 139 > 140 > 144 y 130…140 > 144 > 144 (la 144 se corre dos veces).
-- OJO: la prueba 140 (línea «bodega general: diésel del tanque del motor») y la 130 (recepción directo al tanque) describen
-- el modelo ANTERIOR a la 144: se corren ANTES de la 144.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function pg_temp.como(p uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false) $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
    if p_cond is distinct from true then raise exception 'FALLA: %', p_msg; end if;
    raise notice 'ok  %', p_msg;
end $$;
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', now() - make_interval(days => p_dias_atras), 'enviado_en', now(),
        'inmediato', p_dias_atras = 0, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('144a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.dia(p_atras integer) returns text language sql as $$ select (pg_temp.hoy() - p_atras)::text $$;
create or replace function pg_temp.ts(p_atras integer) returns text language sql as $$
    select case when p_atras = 0 then least(((pg_temp.hoy())::timestamp + time '12:00') at time zone 'America/Tegucigalpa', now() - interval '2 minutes')::text
                else ((pg_temp.hoy() - p_atras)::timestamp + time '12:00')::text || '-06' end $$;
create or replace function pg_temp.falla(p_sql text, p_texto text) returns boolean language plpgsql as $$
begin
    execute p_sql;
    return false;
exception when others then
    return sqlerrm like '%' || p_texto || '%';
end $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T144_ADM', 'P144 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T144_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000014401', 'adm@144') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000014401', 'Admin 144', r, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000014401', r) on conflict do nothing;
    insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
    values ('QA-DIESEL-144', 'Diésel QA 144', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true) on conflict (codigo) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-DIESEL-144') as dsl,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000014401'::uuid as adm;
create or replace function pg_temp.bodega() returns numeric language sql as $$
    select coalesce((select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select dsl from k)), 0)
$$;

-- ---------------------------------------------------------------- 0 · estructura
select pg_temp.ok((select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'mot_recepciones' and column_name = 'tanque_id'),
                  'mot_recepciones.tanque_id admite null (recepción a nivel estación)');
select pg_temp.ok((select pg_get_constraintdef(c.oid) like '%SUMINISTRO%' from pg_constraint c where c.conrelid = 'public.mot_movimientos'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%RECEPCION_DIESEL%'),
                  'el libro del tanque admite SUMINISTRO');
select pg_temp.ok((select bool_or(pg_get_constraintdef(c.oid) like '%SUMINISTRO_MOTOR%' and pg_get_constraintdef(c.oid) like '%RECEPCION_DIESEL%'
                                  and pg_get_constraintdef(c.oid) like '%APLICACION_LOTE%' and pg_get_constraintdef(c.oid) like '%DEVOLUCION_BODEGA%')
                     from pg_constraint c where c.conrelid = 'public.fert_movimientos'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%TRASLADO_SALIDA%'),
                  'el libro de la bodega admite RECEPCION_DIESEL y SUMINISTRO_MOTOR y conserva los tipos anteriores');

-- ---------------------------------------------------------------- 1 · AGL publica diésel y un motor; se instala con tanque
select pg_temp.como((select adm from k));
select fn_mot_publicar(jsonb_build_object('completo', false, 'material_diesel', 'QA-DIESEL-144',
    'motores', '[{"codigo":"T144-M1","nombre":"Motor 1 prueba 144","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300}]'::jsonb));
create temp table m as select (select id from equipos where codigo = 'T144-M1') as m1;
do $$
declare v_est uuid := (select est from k);
begin
    perform pg_temp.como((select adm from k));
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 144');
    end if;
    update fert_custodia set desde = now() - interval '30 days' where estacion_id = v_est;
    update fert_relevos set recibido_at = now() - interval '30 days', entregado_at = now() - interval '30 days'
    where id = (select id from fert_relevos where estacion_id = v_est and recibe_id = (select e1 from k)
                  and estado in ('RECIBIDO', 'ASIGNADO') order by recibido_at desc limit 1);
    update fert_relevos set estado = 'CANCELADO'
    where estacion_id = v_est and coalesce(recibido_at, entregado_at) > now() - interval '30 days' and estado <> 'CANCELADO';
end $$;
create temp table i1 as select pg_temp.op(pg_temp.uid(1), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque M1 144', 'capacidad_gal', 300),
    'motivo', 'Inicio', 'motivo_codigo', 'OTRO', 'horas_base', 0)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from i1), 'instalar el motor con su tanque: ' || (select r::text from i1));
create temp table tk as select tanque_id as t from mot_motores where equipo_id = (select m1 from m);
create temp table b0 as select pg_temp.bodega() as b;

-- ---------------------------------------------------------------- 2 · recibir diésel = a la bodega de la estación (no al tanque)
select pg_temp.como((select e1 from k));
create temp table c1 as select pg_temp.op(pg_temp.uid(11), 'diesel_recibir', jsonb_build_object('estacion_id', (select est from k), 'galones', 100,
    'fecha_hora', pg_temp.ts(4), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 4) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c1), 'recibir 100 gal a nivel estación: ' || (select r::text from c1));
select pg_temp.ok(pg_temp.bodega() = (select b from b0) + 100, 'la bodega de la estación sube 100 (fert_saldos, producto diésel)');
select pg_temp.ok(coalesce((select disponible from mot_saldos where tanque_id = (select t from tk)), 0) = 0, 'el tanque del motor NO sube con la recepción');
select pg_temp.ok((select count(*) = 1 and bool_and(tipo = 'RECEPCION_DIESEL' and cantidad = 100) from fert_movimientos where documento_id = pg_temp.uid(11)), 'un movimiento RECEPCION_DIESEL en el libro de la bodega');
select pg_temp.ok((select tanque_id is null and estacion_id = (select est from k) and galones = 100 from mot_recepciones where id = pg_temp.uid(11)), 'mot_recepciones queda a nivel estación (tanque null)');
-- compatibilidad: un envío viejo con tanque_id pero sin estación
create temp table c2 as select pg_temp.op(pg_temp.uid(12), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 20, 'fecha_hora', pg_temp.ts(4)), 4) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c2) and pg_temp.bodega() = (select b from b0) + 120, 'un envío viejo con tanque_id entra también a la bodega de la estación');
-- sin diésel publicado / sin galones
create temp table c3 as select pg_temp.op(pg_temp.uid(13), 'diesel_recibir', jsonb_build_object('estacion_id', (select est from k), 'galones', 0), 0) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%galones%' from c3), 'sin galones: rechazado');

-- ---------------------------------------------------------------- 3 · registro diario: el suministro baja la bodega y sube el tanque
-- visor 50 → 30 con suministro 40: gastado = 50 − 30 + 40 = 60; tanque = visor final (30)
create temp table r1 as select pg_temp.op(pg_temp.uid(21), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(3),
    'fecha_hora', pg_temp.ts(3), 'horo_ini', 100, 'horo_fin', 110, 'visor_ini', 50, 'visor_fin', 30, 'suministro_gal', 40), 3) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r1), 'registro con suministro 40: ' || (select r::text from r1));
select pg_temp.ok((select recibido_gal = 40 and gastado_gal = 60 and rendimiento_gal_h = 6 from mot_registros where id = pg_temp.uid(21)), 'recibido_gal = suministro 40; gastado 60; rendimiento 6 gal/h');
select pg_temp.ok(pg_temp.bodega() = (select b from b0) + 120 - 40, 'la bodega baja 40 por el suministro');
select pg_temp.ok((select disponible = 30 from mot_saldos where tanque_id = (select t from tk)), 'el tanque queda en el visor final (30)');
select pg_temp.ok((select exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(21) and tipo = 'SUMINISTRO' and cantidad = 40)
                          and exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(21) and tipo = 'SUMINISTRO_MOTOR' and cantidad = -40)), 'SUMINISTRO en el tanque y SUMINISTRO_MOTOR en la bodega');
-- mismo UUID dos veces: no duplica
select pg_temp.op(pg_temp.uid(21), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(3),
    'fecha_hora', pg_temp.ts(3), 'horo_ini', 100, 'horo_fin', 110, 'visor_ini', 50, 'visor_fin', 30, 'suministro_gal', 40), 3);
select pg_temp.ok(pg_temp.bodega() = (select b from b0) + 80, 'mismo UUID dos veces: la bodega no se rebaja otra vez');
-- sin suministro: la bodega no se mueve
create temp table r2 as select pg_temp.op(pg_temp.uid(22), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(2),
    'fecha_hora', pg_temp.ts(2), 'horo_ini', 110, 'horo_fin', 120, 'visor_ini', 30, 'visor_fin', 20), 2) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r2) and pg_temp.bodega() = (select b from b0) + 80 and not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(22)),
                  'registro sin suministro: la bodega no se mueve');
-- el visor sube sin suministro: error (en línea) con el mensaje nuevo
create temp table r3 as select pg_temp.op(pg_temp.uid(23), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(1),
    'fecha_hora', pg_temp.ts(1), 'horo_ini', 120, 'horo_fin', 130, 'visor_ini', 20, 'visor_fin', 60)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%suministro de combustible%' from r3), 'visor sube sin suministro: rechazado con el mensaje de suministro');
-- no alcanza la bodega: en línea rechaza; desde la cola (o con la confirmación) se guarda con SALDO_NEGATIVO
create temp table r4 as select pg_temp.op(pg_temp.uid(24), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(1),
    'fecha_hora', pg_temp.ts(1), 'horo_ini', 120, 'horo_fin', 130, 'visor_ini', 20, 'visor_fin', 20, 'suministro_gal', 500)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%No alcanza el saldo%' from r4) and pg_temp.bodega() = (select b from b0) + 80,
                  'suministro mayor que la bodega, en línea: rechazado y la bodega intacta');
create temp table r5 as select pg_temp.op(pg_temp.uid(25), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(1),
    'fecha_hora', pg_temp.ts(1), 'horo_ini', 120, 'horo_fin', 130, 'visor_ini', 20, 'visor_fin', 20, 'suministro_gal', 500), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%SALDO_NEGATIVO%' from r5) and pg_temp.bodega() = (select b from b0) + 80 - 500,
                  'desde la cola sin inventario suficiente: se guarda con SALDO_NEGATIVO');
-- anular ese registro devuelve lo de la bodega (en cola no es inmediato: se permite)
select pg_temp.como((select adm from k));
create temp table an0 as select pg_temp.op(pg_temp.uid(26), 'anulacion', jsonb_build_object('documento_tipo', 'motor_registro', 'documento_id', pg_temp.uid(25), 'motivo', 'error de prueba'), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an0) and pg_temp.bodega() = (select b from b0) + 80, 'anular el registro con suministro devuelve la bodega');

-- ---------------------------------------------------------------- 4 · anular y eliminar
create temp table an1 as select pg_temp.op(pg_temp.uid(31), 'anulacion', jsonb_build_object('documento_tipo', 'motor_registro', 'documento_id', pg_temp.uid(21), 'motivo', 'se registró mal'), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an1) and pg_temp.bodega() = (select b from b0) + 120, 'anular el registro del suministro 40: la bodega vuelve a 120');
create temp table an2 as select pg_temp.op(pg_temp.uid(32), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(12), 'motivo', 'recepción duplicada'), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an2) and pg_temp.bodega() = (select b from b0) + 100, 'anular una recepción de diésel baja la bodega');
-- eliminar por completo: el registro diario sin anular (se registra otro y se elimina)
select pg_temp.como((select e1 from k));
create temp table r6b as select pg_temp.op(pg_temp.uid(42), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(0),
    'fecha_hora', pg_temp.ts(0), 'horo_ini', 120, 'horo_fin', 130, 'visor_ini', 20, 'visor_fin', 25, 'suministro_gal', 30)) as r;
select pg_temp.como((select adm from k));
select pg_temp.ok(pg_temp.bodega() = (select b from b0) + 100 - 30, 'registro de hoy con suministro 30: la bodega baja a 70 (' || (select r->>'estado' from r6b) || ')');
select fn_campo_eliminar_documento('mot_registro', pg_temp.uid(42), 'Se eliminó por error de captura');
select pg_temp.ok(pg_temp.bodega() = (select b from b0) + 100 and not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(42)),
                  'eliminar por completo el registro: la bodega vuelve a 100 y el libro no conserva el movimiento');
select fn_campo_eliminar_documento('mot_recepcion', pg_temp.uid(11), 'Recepción registrada por error de prueba');
select pg_temp.ok(pg_temp.bodega() = (select b from b0) and not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(11)),
                  'eliminar por completo la recepción: la bodega vuelve al inicio');

-- ---------------------------------------------------------------- 5 · bodega general
select pg_temp.como((select e1 from k));
create temp table c9 as select pg_temp.op(pg_temp.uid(51), 'diesel_recibir', jsonb_build_object('estacion_id', (select est from k), 'galones', 75,
    'fecha_hora', pg_temp.ts(0), 'chofer_id', '10000000-0000-0000-0000-000000000001')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c9), 'recibir 75 gal para la prueba de la bodega general');
create temp table bg as select fn_fert_bodega_general() as r;
select pg_temp.ok((select (r->>'material_diesel_id')::uuid = (select dsl from k) from bg), 'la bodega general trae material_diesel_id');
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(r->'filas') x(v) where v->>'tipo' = 'DIESEL' and (v->>'material_id')::uuid = (select dsl from k)
                                  and (v->>'estacion_id')::uuid = (select est from k) and (v->>'saldo')::numeric = pg_temp.bodega()) from bg),
                  'bodega general: el diésel sale como producto (tipo DIESEL) con el saldo de la bodega');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(r->'filas') x(v) where (v->>'clave')::text = (select t::text from tk)) from bg),
                  'bodega general: el tanque del motor ya NO se lista (no se cuenta dos veces)');
select pg_temp.ok((select (v->>'ultima_recepcion') is not null and (v->>'procedencia') is not null from bg, jsonb_array_elements(bg.r->'filas') x(v)
                    where v->>'tipo' = 'DIESEL' and (v->>'material_id')::uuid = (select dsl from k) limit 1), 'el diésel trae última recepción y procedencia');

-- ---------------------------------------------------------------- 6 · idempotencia (repetir la 144 deja las funciones iguales)
create temp table h0 as select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) as h
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_registro_diario', '_mot_op_anulacion', 'fn_campo_eliminar_documento', 'fn_fert_bodega_general');
\i sql/144_diesel_producto_de_bodega.sql
select pg_temp.ok((select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_registro_diario', '_mot_op_anulacion', 'fn_campo_eliminar_documento', 'fn_fert_bodega_general')) = (select h from h0),
                  'correr la 144 otra vez no cambia ninguna función (idempotente)');

-- ---------------------------------------------------------------- limpieza (el diésel de prueba y los registros se quedan en la réplica; ver nota)
\echo 'PRUEBAS 144 TERMINADAS'
