-- =====================================================================
-- PRUEBAS de sql/101 · AGL ve lo del modo de pruebas aparte (réplica con 99 y 100 y los datos de pruebas/sql/99)
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
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb) returns jsonb language sql as $$
    select jsonb_build_object('id', p_id, 'tipo', p_tipo, 'creado_en', now(), 'enviado_en', now(), 'inmediato', true,
        'dispositivo', 'prueba', 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2, 'precision', 8), 'datos', p_datos)
$$;
create or replace function pg_temp.real() returns uuid language sql as $$ select id from estaciones_riego where nombre = 'Papalon-1' $$;
create or replace function pg_temp.prueba() returns uuid language sql as $$ select id from estaciones_riego where prueba_de = pg_temp.real() $$;
set client_min_messages = notice;

\set ADM '''00000000-0000-0000-0000-000000009901'''
\set E2 '''00000000-0000-0000-0000-0000000000e2'''

select pg_temp.como(:ADM);
create temp table antes as select fn_fert_exportar(0, 20000) as x;
select pg_temp.ok((fn_fert_exportar_pruebas()->>'pruebas_activo')::boolean = false, 'sin modo de pruebas: AGL no recibe nada de prueba');

-- Activar y registrar algo en la estación de prueba (E2 participa)
select fn_fert_pruebas_activar(array[pg_temp.real()], array[:E2::uuid]);
insert into perfiles_estaciones (perfil_id, estacion_id) values (:E2, pg_temp.prueba()) on conflict do nothing;
select fn_fert_asignar_custodia(pg_temp.prueba(), :E2, 'Prueba 101');
select pg_temp.como(:E2);
select fn_fert_sincronizar(jsonb_build_array(pg_temp.op('10100000-0000-4000-8000-000000000001', 'recepcion', jsonb_build_object(
    'estacion_id', pg_temp.prueba(), 'chofer_id', '10000000-0000-0000-0000-000000000001', 'comentario', 'recepcion de PRUEBA',
    'lineas', jsonb_build_array(jsonb_build_object('material_id', (select id from materiales where codigo = '100019'), 'cantidad', 7)),
    'envases', jsonb_build_array(jsonb_build_object('envase_id', '99000000-0000-4000-8000-000000000001', 'recibidos', 4))))));
select pg_temp.ok((select resultado like 'ACEPTADO%' from fert_operaciones where id = '10100000-0000-4000-8000-000000000001'), 'el participante registra en la estación de prueba');

select pg_temp.como(:ADM);
create temp table p as select fn_fert_exportar_pruebas(0, 20000) as x;
select pg_temp.ok((select (x->>'pruebas_activo')::boolean and jsonb_array_length(x->'estaciones_prueba') = 1 from p), 'con el modo activo: AGL recibe lo de prueba');
select pg_temp.ok((select bool_and(m->>'estacion' like 'PRUEBA ·%') and count(*) > 0 from p, jsonb_array_elements(x->'movimientos') m), 'SOLO movimientos de la estación de prueba');
select pg_temp.ok(exists (select 1 from p, jsonb_array_elements(x->'recepciones') r where r->>'comentario' = 'recepcion de PRUEBA'), 'con su detalle (recepción y comentario)');
select pg_temp.ok(exists (select 1 from p, jsonb_array_elements(x->'envases_saldos') s where s->>'estacion' like 'PRUEBA ·%'), 'y sus envases');
select pg_temp.ok(not exists (select 1 from p, jsonb_array_elements(x->'saldos') s where s->>'estacion' not like 'PRUEBA ·%'), 'nada real se cuela en lo de prueba');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_fert_exportar(0, 20000)->'movimientos') m where m->>'estacion' like 'PRUEBA ·%')
                  and not exists (select 1 from jsonb_array_elements(fn_fert_exportar(0, 20000)->'recepciones') r where r->>'estacion' like 'PRUEBA ·%'),
                  'lo REAL sigue sin nada de prueba');
select pg_temp.ok(jsonb_array_length(fn_fert_exportar(0, 20000)->'movimientos') = (select jsonb_array_length(x->'movimientos') from antes),
                  'lo real es igual que antes de activar');
select pg_temp.ok(coalesce(current_setting('fert.agl_pruebas', true), '') <> 'on', 'después de bajar lo de prueba, la regla vuelve a «solo real»');

-- Permisos
select pg_temp.como(:E2);
select pg_temp.falla($q$ select fn_fert_exportar_pruebas() $q$, 'un estacionero no baja lo de prueba para AGL');

-- Apagar sin borrar → AGL deja de verlo
select pg_temp.como(:ADM);
select fn_fert_pruebas_desactivar();
select pg_temp.ok((fn_fert_exportar_pruebas()->>'pruebas_activo')::boolean = false, 'apagado (sin borrar): AGL deja de ver lo de prueba');
select fn_fert_pruebas_activar(array[pg_temp.real()], array[:E2::uuid]);
select pg_temp.ok((fn_fert_exportar_pruebas()->>'pruebas_activo')::boolean, 'reactivado: se vuelve a ver');
select fn_fert_pruebas_borrar();
select pg_temp.ok((fn_fert_exportar_pruebas()->>'pruebas_activo')::boolean = false, 'borrado: AGL ya no ve nada de prueba');

\echo '=== 101: TODAS LAS PRUEBAS PASARON ==='
