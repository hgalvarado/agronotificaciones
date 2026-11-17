-- =====================================================================
-- PRUEBAS de sql/114 · asignar personas a estaciones con el modo de pruebas activo
-- Réplica con 91–113. Crea sus propios datos (prefijo T114) y los borra al final.
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
-- Debe fallar y el mensaje debe contener p_texto (y NO la frase genérica vieja)
create or replace function pg_temp.falla(p_sql text, p_texto text, p_msg text) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: % (no falló)', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    if sqlerrm not like '%' || p_texto || '%' then raise exception 'FALLA: % (mensaje: %)', p_msg, sqlerrm; end if;
    if sqlerrm like '%Tu rol no tiene esa acción%' then raise exception 'FALLA: % (mensaje genérico viejo)', p_msg; end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
set client_min_messages = notice;

-- Datos: admin (acceso total), un rol sin permisos, una persona a asignar, una estación real y su prueba
do $$
declare ra smallint; rn smallint; z uuid;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T114_ADM', 'P114 Admin', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, acceso_total) values ('T114_NADA', 'P114 Sin permisos', false) on conflict (codigo) do nothing;
    select id into ra from roles where codigo = 'T114_ADM';
    select id into rn from roles where codigo = 'T114_NADA';
    insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-000000011401', 'adm@114'),
        ('00000000-0000-0000-0000-000000011402', 'nada@114'),
        ('00000000-0000-0000-0000-000000011403', 'persona@114') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000011401', 'Admin 114', ra, true),
        ('00000000-0000-0000-0000-000000011402', 'Sin permisos 114', rn, false),
        ('00000000-0000-0000-0000-000000011403', 'Persona 114', rn, false) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000011401', ra),
        ('00000000-0000-0000-0000-000000011402', rn),
        ('00000000-0000-0000-0000-000000011403', rn) on conflict do nothing;
    select id into z from zonas order by id limit 1;
    insert into estaciones_riego (nombre, zona_id, activo) values ('T114-Real', z, true) on conflict do nothing;
end $$;
create or replace function pg_temp.real() returns uuid language sql as $$ select id from estaciones_riego where nombre = 'T114-Real' $$;
create or replace function pg_temp.prueba() returns uuid language sql as $$ select id from estaciones_riego where prueba_de = pg_temp.real() $$;

-- 0 · Sin pruebas: el administrador puede
select pg_temp.como('00000000-0000-0000-0000-000000011401');
select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-000000011403', true);
select pg_temp.ok(exists (select 1 from perfiles_estaciones where estacion_id = pg_temp.real() and perfil_id = '00000000-0000-0000-0000-000000011403'),
                  'sin pruebas: el administrador asigna a una persona a una estación real');
select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-000000011403', false);
select pg_temp.ok(not exists (select 1 from perfiles_estaciones where estacion_id = pg_temp.real() and perfil_id = '00000000-0000-0000-0000-000000011403'),
                  'sin pruebas: y la quita');

-- 1 · Activar el modo de pruebas con el administrador como participante (el caso de producción)
select fn_fert_pruebas_activar(array[pg_temp.real()], array['00000000-0000-0000-0000-000000011401'::uuid]);
select pg_temp.ok(fn_fert_en_pruebas(), 'el administrador está en pruebas');
select pg_temp.ok(not fn_fert_puede(pg_temp.real(), 'administrar_estaciones'),
                  'precondición del defecto: en pruebas fn_fert_puede bloquea la estación REAL (la 98 no cambia)');

-- 2 · EL ARREGLO: aun en pruebas, el administrador asigna y quita personas en la estación real
select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-000000011403', true);
select pg_temp.ok(exists (select 1 from perfiles_estaciones where estacion_id = pg_temp.real() and perfil_id = '00000000-0000-0000-0000-000000011403'),
                  'EN PRUEBAS: el administrador asigna a una persona a la estación real');
select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-000000011403', true);
select pg_temp.ok((select count(*) from perfiles_estaciones where estacion_id = pg_temp.real() and perfil_id = '00000000-0000-0000-0000-000000011403') = 1,
                  'asignar dos veces no duplica');
select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-000000011403', false);
select pg_temp.ok(not exists (select 1 from perfiles_estaciones where estacion_id = pg_temp.real() and perfil_id = '00000000-0000-0000-0000-000000011403'),
                  'EN PRUEBAS: el administrador la quita');
-- también a la estación de prueba
select fn_fert_asignar_persona(pg_temp.prueba(), '00000000-0000-0000-0000-000000011403', true);
select pg_temp.ok(exists (select 1 from perfiles_estaciones where estacion_id = pg_temp.prueba() and perfil_id = '00000000-0000-0000-0000-000000011403'),
                  'el administrador asigna a la estación de PRUEBA');
select fn_fert_asignar_persona(pg_temp.prueba(), '00000000-0000-0000-0000-000000011403', false);

-- 3 · Mensajes claros
select pg_temp.como('00000000-0000-0000-0000-000000011402');
select pg_temp.falla($q$ select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-000000011403', true) $q$,
                     'No tienes el permiso «Administrar estaciones»', 'sin el permiso: dice qué falta y dónde pedirlo');
select pg_temp.como('00000000-0000-0000-0000-000000011401');
select pg_temp.falla($q$ select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-0000000fffff', true) $q$,
                     'La persona no existe o está inactiva', 'persona inexistente: mensaje claro');
select pg_temp.falla($q$ select fn_fert_asignar_persona('00000000-0000-0000-0000-0000000fffff', '00000000-0000-0000-0000-000000011403', true) $q$,
                     'La estación no existe', 'estación inexistente: mensaje claro');
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-000000011403', true) $q$,
                     'Tu sesión ya no es válida', 'sin sesión: mensaje claro');

-- 4 · Lo demás NO cambió: en pruebas, la custodia de una estación real sigue bloqueada
select pg_temp.como('00000000-0000-0000-0000-000000011401');
select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-000000011403', true);
select pg_temp.falla($q$ select fn_fert_asignar_custodia(pg_temp.real(), '00000000-0000-0000-0000-000000011403', 'prueba') $q$,
                     'Administrar estaciones', 'la custodia de lo REAL sigue bloqueada en pruebas (no cambia)');
select fn_fert_asignar_persona(pg_temp.real(), '00000000-0000-0000-0000-000000011403', false);

-- Limpieza
select fn_fert_pruebas_desactivar();
do $$
begin
    delete from perfiles_estaciones where perfil_id in ('00000000-0000-0000-0000-000000011401','00000000-0000-0000-0000-000000011402','00000000-0000-0000-0000-000000011403');
    delete from estaciones_riego where prueba_de = (select id from estaciones_riego where nombre = 'T114-Real');
end $$;
\echo 'PRUEBAS 114 OK (la limpieza de la estación real y los usuarios T114 se hace al borrar la base de prueba)'
