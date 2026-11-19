-- =====================================================================
-- PRUEBAS de sql/120 · fn_fert_eliminados_para_agl
-- Base: réplica con 91-119 (la t119e sirve). Desde la raíz del repo:
--   psql -d <base con la 119 y la 120> -v ON_ERROR_STOP=1 -f pruebas/sql/120_eliminados_para_agl.sql
-- Al final repite migraciones en otros órdenes (119>120>120, 100>101>119>120, 120 repetida).
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
create or replace function pg_temp.falla(p_sql text, p_msg text, p_texto text default null, p_code text default null) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: % (no falló)', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    if p_texto is not null and position(p_texto in sqlerrm) = 0 then raise exception 'FALLA: % (mensaje inesperado: %)', p_msg, sqlerrm; end if;
    if p_code is not null and sqlstate <> p_code then raise exception 'FALLA: % (código % y se esperaba %)', p_msg, sqlstate, p_code; end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_creado timestamptz default now(), p_inmediato boolean default true)
returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', p_creado, 'enviado_en', now(), 'inmediato', p_inmediato,
        'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('12000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
set client_min_messages = notice;

do $$
declare r1 smallint; r2 smallint;
begin
    insert into roles (codigo, nombre) values ('T120_DEL', 'P120 elimina'), ('T120_AGL', 'P120 tecnico AGL') on conflict (codigo) do nothing;
    select id into r1 from roles where codigo = 'T120_DEL';
    select id into r2 from roles where codigo = 'T120_AGL';
    insert into permisos (rol_id, recurso, accion, permitido, alcance) values
        (r1, 'fertirriego', 'ver', true, 'global'), (r1, 'fertirriego', 'eliminar_definitivo', true, 'global'),
        (r2, 'fertirriego_agl', 'ver', true, 'global')
    on conflict (rol_id, recurso, accion) do update set permitido = true, alcance = excluded.alcance;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000012002', 'del@120'), ('00000000-0000-0000-0000-000000012003', 'agl@120') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000012002', 'Elimina 120', r1, true), ('00000000-0000-0000-0000-000000012003', 'Tecnico AGL 120', r2, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000012002', r1), ('00000000-0000-0000-0000-000000012003', r2) on conflict do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    '430302c1-3572-4c38-bdcf-155efb0983ab'::uuid as tc,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1, '00000000-0000-0000-0000-0000000000e2'::uuid as e2,
    '00000000-0000-0000-0000-000000012002'::uuid as del, '00000000-0000-0000-0000-000000012003'::uuid as agl,
    '10000000-0000-0000-0000-000000000001'::uuid as chofer;
create temp table sv (clave text primary key, v text);
grant all on all tables in schema pg_temp to public;

-- ---- sin eliminaciones desde "ahora": lista vacía
select pg_temp.como((select agl from k));
select pg_temp.ok((fn_fert_eliminados_para_agl(now() + interval '1 minute')->'eliminados') = '[]'::jsonb
                  and (fn_fert_eliminados_para_agl(now() + interval '1 minute')->>'hay_mas')::boolean = false, 'sin eliminaciones nuevas: lista vacía y hay_mas=false');
insert into sv select 'antes', coalesce(jsonb_array_length(fn_fert_eliminados_para_agl()->'eliminados'), 0)::text;
insert into sv select 'corte', clock_timestamp()::text;

-- ---- datos: recepción, aplicación con devolución
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(1), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'fecha_hora', now() - interval '1 hour',
    'chofer_id', (select chofer from k), 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 100))))->>'estado') like 'ACEPTADO%', 'recepción');
select pg_temp.ok((pg_temp.op(pg_temp.uid(2), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
    'fecha', ((now() at time zone 'America/Tegucigalpa')::date - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 30))))->>'estado') like 'ACEPTADO%', 'aplicación');
select pg_temp.ok((pg_temp.op(pg_temp.uid(3), 'devolucion', jsonb_build_object('estacion_id', (select est from k), 'aplicacion_id', pg_temp.uid(2),
    'motivo', 'sobró', 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 5))))->>'estado') like 'ACEPTADO%', 'devolución');
create temp table movs_ap as select array_agg(cursor order by cursor) cur, array_agg(id) ids from fert_movimientos where documento_id in (pg_temp.uid(2), pg_temp.uid(3));
create temp table movs_re as select array_agg(cursor order by cursor) cur, array_agg(id) ids from fert_movimientos where documento_id = pg_temp.uid(1);
select pg_temp.ok((select cardinality(cur) = 2 from movs_ap) and (select cardinality(cur) = 1 from movs_re), 'hay 2 movimientos de la aplicación+devolución y 1 de la recepción');

-- antes de eliminar, AGL (cursor) tiene esos movimientos exportados
select pg_temp.como((select agl from k));
select pg_temp.ok((select count(*) = 3 from jsonb_array_elements(fn_fert_exportar(0, 100000)->'movimientos') m where (m->>'cursor')::bigint = any((select cur from movs_ap) || (select cur from movs_re))),
                  'antes: fn_fert_exportar trae esos 3 movimientos');
select pg_temp.ok((fn_fert_eliminados_para_agl((select v from sv where clave = 'corte')::timestamptz)->'eliminados') = '[]'::jsonb, 'antes de eliminar: nada desde el corte');

-- ---- eliminar
select pg_temp.como((select del from k));
select pg_temp.ok((fn_fert_eliminar_documento('aplicacion', pg_temp.uid(2), 'prueba 120 se registró por error')->>'ok')::boolean, 'eliminar la aplicación (con devolución)');
select pg_temp.ok((fn_fert_eliminar_documento('recepcion', pg_temp.uid(1), 'prueba 120 recepción duplicada')->>'ok')::boolean, 'eliminar la recepción');

-- ---- la función
select pg_temp.como((select agl from k));
create temp table r as select fn_fert_eliminados_para_agl((select v from sv where clave = 'corte')::timestamptz) as j;
select pg_temp.ok((select jsonb_array_length(j->'eliminados') = 2 and (j->>'hay_mas')::boolean = false and j ? 'generado' from r), 'devuelve 2 eliminaciones desde el corte');
select pg_temp.ok((select e->>'tipo' = 'aplicacion' and jsonb_array_length(e->'movimientos') = 2
                   and (select array_agg((m->>'cursor')::bigint order by (m->>'cursor')::bigint) from jsonb_array_elements(e->'movimientos') m) = (select cur from movs_ap)
                   and (select array_agg((m->>'id')::uuid order by (m->>'id')::uuid) from jsonb_array_elements(e->'movimientos') m) = (select array_agg(i order by i) from unnest((select ids from movs_ap)) i)
                   from r, jsonb_array_elements(j->'eliminados') e where (e->>'documento_id')::uuid = pg_temp.uid(2)),
                  'aplicación: tipo, documento_id y los cursores/ids de sus 2 movimientos (aplicación y devolución)');
select pg_temp.ok((select e->>'tipo' = 'recepcion' and jsonb_array_length(e->'movimientos') = 1
                   and (e->'movimientos'->0->>'cursor')::bigint = (select cur[1] from movs_re)
                   and (e->'movimientos'->0->>'id')::uuid = (select ids[1] from movs_re)
                   from r, jsonb_array_elements(j->'eliminados') e where (e->>'documento_id')::uuid = pg_temp.uid(1)),
                  'recepción: cursor e id de su movimiento');
select pg_temp.ok((select jsonb_typeof(e->'operaciones_ids') = 'array' and jsonb_array_length(e->'operaciones_ids') >= 1
                   from r, jsonb_array_elements(j->'eliminados') e where (e->>'documento_id')::uuid = pg_temp.uid(1)), 'trae operaciones_ids');
select pg_temp.ok((select bool_and(e->>'eliminado_at' is not null and (e->>'eliminado_at')::timestamptz >= (select v from sv where clave = 'corte')::timestamptz)
                   from r, jsonb_array_elements(j->'eliminados') e), 'eliminado_at presente y posterior al corte');
select pg_temp.ok((select (j->'eliminados'->0->>'eliminado_at')::timestamptz <= (j->'eliminados'->1->>'eliminado_at')::timestamptz from r), 'ordenadas por eliminado_at');

-- ---- no filtra datos sensibles
select pg_temp.ok(not exists (select 1 from r where j::text ~* '(motivo|snapshot|eliminado_por|registrado_por|prueba 120|Elimina 120|conteos|estacion)'),
                  'la respuesta NO contiene motivo, snapshot, eliminado_por, nombres ni estación');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(j->'eliminados') e, jsonb_object_keys(e) k2
                                      where k2 not in ('eliminacion_id', 'tipo', 'documento_id', 'eliminado_at', 'movimientos', 'operaciones_ids')) from r), 'solo las claves permitidas por eliminación');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(j->'eliminados') e, jsonb_array_elements(e->'movimientos') m, jsonb_object_keys(m) k2 where k2 not in ('cursor', 'id')) from r), 'los movimientos solo traen cursor e id');

-- ---- p_desde filtra
select pg_temp.ok((select jsonb_array_length(fn_fert_eliminados_para_agl((select max((e->>'eliminado_at')::timestamptz) from r, jsonb_array_elements(j->'eliminados') e))->'eliminados') = 0),
                  'p_desde = la última eliminación: lista vacía (estricto >)');
select pg_temp.ok((select jsonb_array_length(fn_fert_eliminados_para_agl((select min((e->>'eliminado_at')::timestamptz) from r, jsonb_array_elements(j->'eliminados') e))->'eliminados') = 1),
                  'p_desde = la primera: solo queda la segunda');
select pg_temp.ok(jsonb_array_length(fn_fert_eliminados_para_agl()->'eliminados') = (select v::int from sv where clave = 'antes') + 2, 'p_desde null: todas (antes + 2)');

-- ---- hay_mas: 5001 filas de relleno (se borran después)
reset role;
insert into fert_eliminaciones (tipo, documento_id, motivo, eliminado_por, snapshot, eliminado_at)
select 'conteo', gen_random_uuid(), 'relleno prueba 120', '00000000-0000-0000-0000-000000012002',
       jsonb_build_object('movimientos', jsonb_build_array(jsonb_build_object('cursor', 900000000 + g, 'id', gen_random_uuid()))),
       timestamptz '2099-01-01 00:00:00+00' + (g || ' milliseconds')::interval
from generate_series(1, 5001) g;
select pg_temp.ok((select (j->>'hay_mas')::boolean and jsonb_array_length(j->'eliminados') = 5000 from (select fn_fert_eliminados_para_agl(timestamptz '2098-12-31 00:00:00+00') j) x), 'más de 5000: devuelve 5000 y hay_mas=true');
select pg_temp.ok((select not (j->>'hay_mas')::boolean and jsonb_array_length(j->'eliminados') = 1
                   from (select fn_fert_eliminados_para_agl(timestamptz '2099-01-01 00:00:00+00' + interval '5000 milliseconds') j) x), 'la tanda siguiente trae la fila 5001 y hay_mas=false');
delete from fert_eliminaciones where motivo = 'relleno prueba 120';

-- ---- permisos
select pg_temp.como((select e1 from k));
select pg_temp.falla($q$ select fn_fert_eliminados_para_agl() $q$, 'estacionero sin permiso: 42501', 'permiso', '42501');
select pg_temp.como((select del from k));
select pg_temp.falla($q$ select fn_fert_eliminados_para_agl() $q$, 'quien elimina pero sin «Conexión AGL · ver»: 42501', 'permiso', '42501');
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_fert_eliminados_para_agl() $q$, 'sin sesión: 42501', 'sesión', '42501');
select pg_temp.ok(not has_function_privilege('anon', 'public.fn_fert_eliminados_para_agl(timestamptz)', 'execute')
                  and has_function_privilege('authenticated', 'public.fn_fert_eliminados_para_agl(timestamptz)', 'execute'), 'grant solo a authenticated');

-- ---- idempotencia y órdenes de corrida
create or replace function pg_temp.finales(p_etq text) returns void language plpgsql as $$
declare v jsonb;
begin
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012003', false);
    v := fn_fert_eliminados_para_agl((select s.v from sv s where s.clave = 'corte')::timestamptz);
    if jsonb_array_length(v->'eliminados') <> 2 then raise exception 'FALLA [%]: se esperaban 2 eliminaciones', p_etq; end if;
    if not has_function_privilege('authenticated', 'public.fn_fert_eliminados_para_agl(timestamptz)', 'execute') or has_function_privilege('anon', 'public.fn_fert_eliminados_para_agl(timestamptz)', 'execute') then
        raise exception 'FALLA [%]: grants', p_etq; end if;
    raise notice 'ok  finales [%]', p_etq;
end $$;
select pg_temp.finales('estado actual');
\i sql/120_fertirriego_eliminados_para_agl.sql
select pg_temp.finales('120 repetida');
\i sql/119_fertirriego_eliminar_registros.sql
\i sql/120_fertirriego_eliminados_para_agl.sql
\i sql/120_fertirriego_eliminados_para_agl.sql
select pg_temp.finales('119>120>120');
\i sql/100_fertirriego_piloto2.sql
\i sql/101_fertirriego_pruebas_en_agl.sql
\i sql/119_fertirriego_eliminar_registros.sql
\i sql/120_fertirriego_eliminados_para_agl.sql
select pg_temp.finales('100>101>119>120');
-- la exportación normal ya no trae lo eliminado
select pg_temp.como((select agl from k));
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_fert_exportar(0, 100000)->'movimientos') m where (m->>'cursor')::bigint = any((select cur from movs_ap) || (select cur from movs_re))),
                  'fn_fert_exportar ya no trae los movimientos eliminados');

select 'FIN 120 OK' as resultado;
