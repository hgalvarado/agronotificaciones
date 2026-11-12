-- =====================================================================
-- PRUEBAS de sql/98 · modo de pruebas de Fertirriego (réplica local con 91–96 y sus datos de prueba)
-- E1 = participante, E2 = no participante; Papalon-1 = estación real elegida para probar.
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
create or replace function pg_temp.falla(p_sql text, p_msg text) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: %', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 80);
end $$;
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb) returns jsonb language sql as $$
    select jsonb_build_object('id', p_id, 'tipo', p_tipo, 'creado_en', now(), 'enviado_en', now(), 'inmediato', true,
        'dispositivo', 'prueba', 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2, 'precision', 8), 'datos', p_datos)
$$;
create or replace function pg_temp.sync1(p jsonb) returns jsonb language sql as
$$ select (public.fn_fert_sincronizar(jsonb_build_array(p)))->0 $$;
create or replace function pg_temp.real() returns uuid language sql as $$ select id from estaciones_riego where nombre = 'Papalon-1' $$;
create or replace function pg_temp.prueba() returns uuid language sql as $$ select id from estaciones_riego where prueba_de = pg_temp.real() $$;
create or replace function pg_temp.solca() returns uuid language sql as $$ select id from materiales where codigo = 'QA-SOLCA' $$;
set client_min_messages = notice;

-- Administrador de la prueba
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T98_ADM', 'P98 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T98_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000009801', 'adm@98') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000009801', 'Admin 98', r, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000009801', r) on conflict do nothing;
end $$;

-- 0 · Antes: nada cambia
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
create temp table base as select fn_fert_puede(pg_temp.real(), 'ver') as e1_ve_real,
       (select saldo from (select disponible as saldo from fert_saldos where estacion_id = pg_temp.real() and material_id = pg_temp.solca()) x) as saldo_real;
select pg_temp.ok(not fn_fert_en_pruebas(), 'sin activar: nadie está en pruebas');
select pg_temp.falla($q$ select fn_fert_pruebas_activar(array[pg_temp.real()], array['00000000-0000-0000-0000-0000000000e1'::uuid]) $q$,
                     'un estacionero NO puede activar el modo de pruebas');

-- 1 · Activar
select pg_temp.como('00000000-0000-0000-0000-000000009801');
select fn_fert_pruebas_activar(array[pg_temp.real()], array['00000000-0000-0000-0000-0000000000e1'::uuid]);
select pg_temp.ok((select nombre from estaciones_riego where id = pg_temp.prueba()) = 'PRUEBA · Papalon-1', 'se crea «PRUEBA · Papalon-1»');
select pg_temp.ok((fn_fert_pruebas_estado()->>'activo')::boolean and jsonb_array_length(fn_fert_pruebas_estado()->'participantes') = 1,
                  'estado: activo con 1 participante');

-- 2 · El participante solo ve la estación de prueba, con los turnos y el plan de la real
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok(fn_fert_en_pruebas(), 'E1 está en pruebas');
select pg_temp.ok(fn_fert_puede(pg_temp.prueba(), 'aplicar') and not fn_fert_puede(pg_temp.real(), 'ver'), 'E1: opera la de prueba y NO la real');
select pg_temp.ok((select array_agg(x->>'id') from jsonb_array_elements(fn_fert_estado_campo()->'estaciones') x) = array[pg_temp.prueba()::text],
                  'E1 en el teléfono: solo ve «PRUEBA · Papalon-1»');
select pg_temp.ok((select count(*) = 4 and bool_and(x->>'estacion_id' = pg_temp.prueba()::text) from jsonb_array_elements(fn_fert_estado_campo()->'turnos') x),
                  'los 4 turnos de Papalon-1 aparecen en la estación de prueba');
select pg_temp.ok(jsonb_array_length(fn_fert_estado_campo()->'plan') > 0, 'y su plan');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'destinos') d
                              where d->>'id' in (select id::text from estaciones_riego where prueba_de is null)),
                  'para trasladar solo ofrece estaciones de prueba');

-- 3 · El no participante sigue normal y no ve la de prueba
select pg_temp.como('00000000-0000-0000-0000-0000000000e2');
select pg_temp.ok(not fn_fert_en_pruebas() and not fn_fert_puede(pg_temp.prueba(), 'ver'), 'E2 (no participante) no ve la estación de prueba');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'estaciones') x where x->>'id' = pg_temp.prueba()::text),
                  'ni en su teléfono');

-- 4 · Registrar en prueba: bodega propia, sin tocar la real
select pg_temp.como('00000000-0000-0000-0000-000000009801');
select fn_fert_asignar_custodia(pg_temp.prueba(), '00000000-0000-0000-0000-0000000000e1', 'Prueba 98');
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('98000000-0000-0000-0000-000000000001', 'conteo', jsonb_build_object(
        'estacion_id', pg_temp.prueba(), 'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.solca(), 'cantidad_real', 500)))))->>'estado'
    = 'ACEPTADO', 'conteo inicial en la estación de prueba');
select pg_temp.ok((select disponible = 500 from fert_saldos where estacion_id = pg_temp.prueba() and material_id = pg_temp.solca()), 'bodega de prueba: 500');
select pg_temp.ok((select disponible from fert_saldos where estacion_id = pg_temp.real() and material_id = pg_temp.solca()) is not distinct from (select saldo_real from base),
                  'la bodega REAL no cambió');
select pg_temp.ok(r->>'estado' = 'ACEPTADO' and not coalesce((select 'OTRA_ESTACION' = any(observaciones) from fert_operaciones where id = '98000000-0000-0000-0000-000000000002'), false),
                  'aplicar a un turno de la estación real desde la de prueba: aceptado y sin «turno de otra estación»')
from (select pg_temp.sync1(pg_temp.op('98000000-0000-0000-0000-000000000002', 'aplicacion', jsonb_build_object(
        'estacion_id', pg_temp.prueba(), 'turno_ciclo_id', (select id from turnos_ciclo where estacion_id = pg_temp.real() and activo limit 1),
        'fecha', current_date, 'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.solca(), 'cantidad', 20))))) r) x;
select pg_temp.ok(pg_temp.sync1(pg_temp.op('98000000-0000-0000-0000-000000000003', 'conteo', jsonb_build_object(
        'estacion_id', pg_temp.real(), 'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.solca(), 'cantidad_real', 1)))))->>'estado'
    = 'RECHAZADO', 'E1 en pruebas NO puede registrar en la estación real');
select pg_temp.falla($q$ insert into fert_traslados (id, origen_id, destino_id, estado, creado_por)
                         values (gen_random_uuid(), pg_temp.prueba(), (select id from estaciones_riego where nombre = 'Papalon-2'), 'POR_AUTORIZAR',
                                 '00000000-0000-0000-0000-0000000000e1') $q$,
                     'no se puede trasladar de una estación de prueba a una real');

-- 5 · AGL no ve nada de prueba
select pg_temp.como('00000000-0000-0000-0000-000000009801');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_fert_exportar(0, 5000)->'movimientos') m where m->>'estacion' like 'PRUEBA%')
                  and not exists (select 1 from jsonb_array_elements(fn_fert_exportar(0, 5000)->'saldos') s where s->>'estacion' like 'PRUEBA%'),
                  'la exportación a AGL no trae movimientos ni saldos de prueba');

-- 6 · Desactivar sin borrar: todo vuelve a la normalidad y lo de prueba se conserva
select fn_fert_pruebas_desactivar();
select pg_temp.ok(fn_fert_pruebas_estado()->>'se_borra_el' is not null, 'dice cuándo se borra solo (30 días)');
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok(not fn_fert_en_pruebas() and not fn_fert_puede(pg_temp.prueba(), 'ver')
                  and fn_fert_puede(pg_temp.real(), 'ver') is not distinct from (select e1_ve_real from base),
                  'desactivado: E1 vuelve a lo real como antes y no ve la de prueba');
select pg_temp.ok((select count(*) from fert_movimientos where estacion_id = pg_temp.prueba()) > 0, 'lo de prueba se conserva');

-- 7 · Reactivar: sigue donde estaba
select pg_temp.como('00000000-0000-0000-0000-000000009801');
select fn_fert_pruebas_activar(array[pg_temp.real()], array['00000000-0000-0000-0000-0000000000e1'::uuid]);
select pg_temp.ok((select disponible = 480 from fert_saldos where estacion_id = pg_temp.prueba() and material_id = pg_temp.solca()), 'reactivado: la bodega de prueba sigue en 480');
select fn_fert_pruebas_desactivar();

-- 8 · A los 30 días se borra solo (lo dispara la sincronización de cualquier teléfono)
update seguridad.fert_pruebas set desactivado_en = now() - interval '31 days';
select pg_temp.como('00000000-0000-0000-0000-0000000000e2');
select fn_fert_sincronizar('[]'::jsonb);
select pg_temp.ok(not exists (select 1 from estaciones_riego where prueba_de is not null)
                  and not exists (select 1 from fert_operaciones where id in ('98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000002'))
                  and not exists (select 1 from seguridad.fert_pruebas_participantes),
                  'pasados 30 días sin reactivar: se borró todo lo de prueba (estación, registros y participantes)');

-- 9 · «Borrar» ya
select pg_temp.como('00000000-0000-0000-0000-000000009801');
select fn_fert_pruebas_activar(array[pg_temp.real()], array['00000000-0000-0000-0000-0000000000e1'::uuid]);
select pg_temp.como('00000000-0000-0000-0000-000000009801');
select fn_fert_asignar_custodia(pg_temp.prueba(), '00000000-0000-0000-0000-0000000000e1', 'Prueba 98 b');
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
select pg_temp.sync1(pg_temp.op('98000000-0000-0000-0000-000000000004', 'conteo', jsonb_build_object(
        'estacion_id', pg_temp.prueba(), 'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.solca(), 'cantidad_real', 7)))));
select pg_temp.como('00000000-0000-0000-0000-000000009801');
create temp table borrado as select fn_fert_pruebas_borrar() as r;
select pg_temp.ok((select (r->>'estaciones')::int = 1 from borrado) and not exists (select 1 from estaciones_riego where prueba_de is not null)
                  and not (fn_fert_pruebas_estado()->>'activo')::boolean,
                  '«Borrar»: se va todo y el modo queda apagado');
select pg_temp.ok((select disponible from fert_saldos where estacion_id = pg_temp.real() and material_id = pg_temp.solca()) is not distinct from (select saldo_real from base),
                  'la bodega real quedó igual que al principio');

select pg_temp.como(null);
\echo '---- 98: todas las pruebas pasaron'
