-- =====================================================================
-- PRUEBAS de sql/152 · capacidad de almacenaje de soluciones (estándar, excepciones, préstamo Veg↔Gen,
-- Calcio nunca, EXCEDE_CAPACIDAD al recibir, publicar y exportar con AGL).
-- Réplica local con 91–151 y los datos de prueba de 96/99/115 (E1, Papalon-1, chofer ...0001).
-- Correr DESDE LA RAÍZ DEL REPO (usa \i) con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/152_capacidad_almacenaje.sql
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
        'inmediato', false, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('152a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.saldo(p_est uuid, p_mat uuid) returns numeric language sql as $$
    select coalesce((select disponible from fert_saldos where estacion_id = p_est and material_id = p_mat), 0) $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
\i sql/152_capacidad_almacenaje.sql
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T152_ADM', 'P152 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T152_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000015201', 'adm@152') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000015201', 'Admin 152', r, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000015201', r) on conflict do nothing;
    insert into materiales (codigo, descripcion, unidad, fertirriego, grupo) values
        ('T152-VEG', 'Solución T152 Vegetativa', 'L', true, '1800'), ('T152-GEN', 'Solución T152 Generativa', 'L', true, '1800'),
        ('T152-CAL', 'Solución T152 Calcio', 'L', true, '1800') on conflict (codigo) do nothing;
end $$;
create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'T152-VEG') as veg,
    (select id from materiales where codigo = 'T152-GEN') as gen,
    (select id from materiales where codigo = 'T152-CAL') as cal,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000015201'::uuid as adm,
    '10000000-0000-0000-0000-000000000001'::uuid as chofer;
create or replace function pg_temp.cap(p_mat uuid) returns numeric language sql as $$
    select capacidad_efectiva from _fert_cap_efectiva((select est from k)) where material_id = p_mat $$;

-- 1 · publicar estándar
select pg_temp.como((select adm from k));
create temp table p1 as select fn_fert_publicar_capacidades(jsonb_build_object('completo', false,
    'estandar', jsonb_build_array(
        jsonb_build_object('material', 'T152-VEG', 'capacidad', 3000, 'prestable_con', 'T152-GEN'),
        jsonb_build_object('material', 'T152-GEN', 'capacidad', 3000, 'prestable_con', 'T152-VEG'),
        jsonb_build_object('material', 'T152-CAL', 'capacidad', 5000)))) as r;
select pg_temp.ok((select (r->>'estandar')::int = 3 from p1), 'estándar publicado (3 soluciones)');
select pg_temp.ok((select prestable_con = (select gen from k) from fert_capacidad_estandar where material_id = (select veg from k)), 'Vegetativa se presta con Generativa');
select pg_temp.ok((select prestable_con is null from fert_capacidad_estandar where material_id = (select cal from k)), 'Calcio no tiene pareja');
select pg_temp.ok(pg_temp.cap((select veg from k)) = 3000 and pg_temp.cap((select cal from k)) = 5000, 'capacidad efectiva = estándar sin excepciones ni préstamo');

-- 2 · pareja sin reciprocidad (Calcio con Vegetativa): ignorada con aviso
create temp table p2 as select fn_fert_publicar_capacidades(jsonb_build_object('completo', false,
    'estandar', jsonb_build_array(
        jsonb_build_object('material', 'T152-CAL', 'capacidad', 5000, 'prestable_con', 'T152-VEG')))) as r;
select pg_temp.ok((select jsonb_array_length(r->'avisos') = 1 from p2), 'pareja de Calcio sin reciprocidad: aviso');
select pg_temp.ok((select prestable_con is null from fert_capacidad_estandar where material_id = (select cal from k)), 'Calcio sigue sin pareja');

-- 3 · excepción por estación
create temp table p3 as select fn_fert_publicar_capacidades(jsonb_build_object('completo', false,
    'estaciones', jsonb_build_array(jsonb_build_object('estacion', 'papalon 1', 'material', 'T152-VEG', 'capacidad', 5000)))) as r;
select pg_temp.ok((select (r->>'excepciones')::int = 1 from p3) and pg_temp.cap((select veg from k)) = 5000, 'excepción de la estación (5000) manda sobre el estándar');
select pg_temp.ok(pg_temp.cap((select gen from k)) = 3000, 'la otra solución sigue con el estándar');

-- 4 · préstamo declarado por la estación
select fn_fert_capacidad_prestamo((select est from k), (select gen from k), (select veg from k), true, null, 'No usa Generativa');
select pg_temp.ok(pg_temp.cap((select veg from k)) = 8000 and pg_temp.cap((select gen from k)) = 0, 'con el préstamo: Vegetativa 5000+3000 y Generativa 0');
select pg_temp.ok((select recibe_de = (select gen from k) and prestamo_origen = 'ESTACION' from _fert_cap_efectiva((select est from k)) where material_id = (select veg from k)), 'el préstamo dice quién lo declaró');
select pg_temp.ok((select jsonb_array_length(x) > 0 from (select fn_fert_estado_campo()->'capacidades' as x) q), 'el teléfono recibe capacidades');
do $$ begin
    begin
        perform fn_fert_capacidad_prestamo((select est from k), (select cal from k), (select veg from k), true);
        raise exception 'FALLA: se prestó Calcio';
    exception when others then
        if sqlerrm like 'FALLA%' then raise; end if;
        raise notice 'ok  Calcio nunca se presta (%)', sqlerrm;
    end;
    begin
        perform fn_fert_capacidad_prestamo((select est from k), (select veg from k), (select gen from k), true);
        raise exception 'FALLA: préstamo en sentido contrario';
    exception when others then
        if sqlerrm like 'FALLA%' then raise; end if;
        raise notice 'ok  sentido contrario rechazado';
    end;
end $$;

-- 5 · recibir pasa de la capacidad: observación EXCEDE_CAPACIDAD (sin bloquear). Se quita el préstamo para usar Calcio (5000).
do $$
declare v_est uuid := (select est from k);
begin
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 152');
    end if;
    update fert_custodia set desde = now() - interval '2 hours' where estacion_id = v_est;
end $$;
select pg_temp.como((select e1 from k));
create temp table r1 as select pg_temp.op(pg_temp.uid(1), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'chofer_id', (select chofer from k),
    'fecha_hora', now() - interval '1 hour', 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select cal from k), 'cantidad', 4000)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text not like '%EXCEDE_CAPACIDAD%' from r1), 'recibir 4000 de Calcio (cabe en 5000): sin aviso');
create temp table r2 as select pg_temp.op(pg_temp.uid(2), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'chofer_id', (select chofer from k),
    'fecha_hora', now() - interval '50 minutes', 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select cal from k), 'cantidad', 2000)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%EXCEDE_CAPACIDAD%' from r2), 'recibir 2000 más de Calcio (6000 > 5000): aceptada con EXCEDE_CAPACIDAD');
select pg_temp.ok(pg_temp.saldo((select est from k), (select cal from k)) = 6000, 'no se bloquea: el saldo quedó en 6000');

-- 6 · quitar el préstamo
select pg_temp.como((select adm from k));
select fn_fert_capacidad_prestamo((select est from k), (select gen from k), null, false);
select pg_temp.ok(pg_temp.cap((select veg from k)) = 5000 and pg_temp.cap((select gen from k)) = 3000, 'sin préstamo vuelve a lo de la estación');

-- 7 · exportar a AGL
select pg_temp.ok((select jsonb_array_length(fn_fert_capacidad_exportar()->'estandar') >= 3), 'AGL puede leer lo vigente');

-- 8 · publicación completa: préstamo declarado por AGL y retiro de lo que ya no se publica
select fn_fert_publicar_capacidades(jsonb_build_object('completo', true,
    'estandar', jsonb_build_array(jsonb_build_object('material', 'T152-VEG', 'capacidad', 3000, 'prestable_con', 'T152-GEN'),
                                  jsonb_build_object('material', 'T152-GEN', 'capacidad', 3000, 'prestable_con', 'T152-VEG')),
    'prestamos', jsonb_build_array(jsonb_build_object('estacion', 'Papalon-1', 'cede', 'T152-VEG', 'recibe', 'T152-GEN'))));
select pg_temp.ok(pg_temp.cap((select gen from k)) = 6000 and pg_temp.cap((select veg from k)) = 0, 'AGL declara el préstamo al revés');
select pg_temp.ok(not exists (select 1 from fert_capacidad_estandar where material_id = (select cal from k)), 'completo=true retira lo que AGL ya no publica');

-- 9 · se puede volver a correr
\i sql/152_capacidad_almacenaje.sql
select pg_temp.ok((select count(*) = 2 from fert_capacidad_estandar where material_id in ((select veg from k), (select gen from k))), 'la 152 repetida no rompe nada');

-- limpieza
delete from fert_capacidad_prestamos where estacion_id = (select est from k);
delete from fert_capacidad_estacion where estacion_id = (select est from k);
select 'PRUEBA 152 COMPLETA' as resultado;
