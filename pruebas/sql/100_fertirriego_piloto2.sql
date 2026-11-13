-- =====================================================================
-- PRUEBAS de sql/100 · lo que bajan el teléfono y AGL (correr sobre la réplica DESPUÉS de pruebas/sql/99)
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
set client_min_messages = notice;

-- Teléfono (E1 = quien recibió el relevo en la prueba 99; ve Papalon-1)
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
create temp table c as select fn_fert_estado_campo() as x;
select pg_temp.ok((select x ? 'nombres' and x ? 'conteos' and x ? 'envases_movimientos' from c), 'el teléfono recibe nombres, conteos y envases');
select pg_temp.ok((select x->'nombres'->>'00000000-0000-0000-0000-0000000000e2' = 'Estacionero Noche' from c), 'nombres: quien registró aparece con su nombre');
select pg_temp.ok((select bool_and(x->'nombres' ? (m->>'registrado_por')) from c, jsonb_array_elements(x->'movimientos') m),
                  'nombres: están TODAS las personas de los movimientos');
select pg_temp.ok(exists (select 1 from c, jsonb_array_elements(x->'recepciones') r
                          where r->>'chofer' = 'Juan Chofer' and r->'operacion' ? 'recibido_en'), 'cada recepción trae chofer y datos de la operación');
select pg_temp.ok(exists (select 1 from c, jsonb_array_elements(x->'recepciones') r where (r->>'solo_envases')::boolean),
                  'la visita solo de envases se marca «solo envases»');
select pg_temp.ok(exists (select 1 from c, jsonb_array_elements(x->'conteos') k, jsonb_array_elements(k->'lineas') l where l ? 'diferencia')
                  or not exists (select 1 from c, jsonb_array_elements(x->'conteos') k where jsonb_array_length(k->'lineas') > 0),
                  'conteos con su detalle');
select pg_temp.ok((select jsonb_array_length(x->'envases_movimientos') > 0 from c), 'movimientos de envases de la estación');
select pg_temp.ok(exists (select 1 from c, jsonb_array_elements(x->'aplicaciones') a where a->'operacion' ? 'observaciones'), 'aplicaciones con datos de la operación');
select pg_temp.ok((select x ? 'movimientos' and x ? 'saldos' and x ? 'plan' from c), 'lo de antes sigue igual');

-- Sin sesión / sin permiso
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_fert_estado_campo() $q$, 'sin sesión no baja nada');
select pg_temp.falla($q$ select fn_fert_exportar() $q$, 'AGL sin sesión no baja nada');
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
select pg_temp.falla($q$ select fn_fert_exportar() $q$, 'un estacionero no baja lo de AGL');
select pg_temp.ok(not has_function_privilege('authenticated', 'public._fert_estado_campo_base(date)', 'execute')
                  and not has_function_privilege('authenticated', 'public._fert_exportar_base(bigint, integer)', 'execute')
                  and has_function_privilege('authenticated', 'public.fn_fert_estado_campo(date)', 'execute')
                  and not has_function_privilege('anon', 'public.fn_fert_exportar(bigint, integer)', 'execute'),
                  'las funciones internas no se pueden llamar desde la app; las públicas sí (con sesión)');

-- AGL (administrador de la prueba 99)
select pg_temp.como('00000000-0000-0000-0000-000000009901');
create temp table a as select fn_fert_exportar(0, 20000) as x;
select pg_temp.ok((select x ?& array['recepciones','aplicaciones','conteos','envases_movimientos','relevos','traslados','rechazados','movimientos','saldos'] from a),
                  'AGL recibe TODO: recepciones, aplicaciones, conteos, envases, relevos, traslados, rechazados');
select pg_temp.ok(exists (select 1 from a, jsonb_array_elements(x->'recepciones') r
                          where r->>'chofer' = 'Juan Chofer' and jsonb_array_length(r->'lineas') > 0 and r ? 'registrado_por'), 'recepciones con chofer, líneas y quién');
select pg_temp.ok(exists (select 1 from a, jsonb_array_elements(x->'aplicaciones') p
                          where (p->>'ddt_plan')::int = 12 and (p->>'ddt_real')::int = 13 and p->>'ejecutor' is not null), 'aplicaciones con DDT plan/real y ejecutor');
select pg_temp.ok(exists (select 1 from a, jsonb_array_elements(x->'envases_movimientos') m where m->>'envase' = 'Barril' and m->>'chofer' is not null),
                  'envases con chofer');
select pg_temp.ok(exists (select 1 from a, jsonb_array_elements(x->'relevos') r where r->>'metodo' = 'CODIGO_LARGO'), 'todos los relevos (también los sin revisar)');
select pg_temp.ok(not exists (select 1 from a, jsonb_array_elements(x->'recepciones') r where r->>'estacion' like 'PRUEBA ·%'), 'nada de estaciones de prueba');
select pg_temp.ok((select jsonb_typeof(x->'rechazados') = 'array' from a), 'rechazados de los últimos 90 días');

\echo '=== 100: TODAS LAS PRUEBAS PASARON ==='
