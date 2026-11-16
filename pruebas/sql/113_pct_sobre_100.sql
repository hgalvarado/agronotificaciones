-- =====================================================================
-- PRUEBAS de sql/113 · % de fertilización sobre 100
-- Correr en una base con la 112 y la 113 (réplica con 99..104 + datos de pruebas/sql/99). Opcional: antes, 112_pct_fertilizacion_antes.sql.
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
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb) returns jsonb language sql as $$
    select jsonb_build_object('id', p_id, 'tipo', p_tipo, 'creado_en', now(), 'enviado_en', now(), 'inmediato', true,
        'dispositivo', 'prueba', 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2, 'precision', 8), 'datos', p_datos)
$$;
create or replace function pg_temp.tc() returns uuid language sql as $$ select id from turnos_ciclo where agl_id = 'TR-QA-1' $$;
create or replace function pg_temp.real() returns uuid language sql as $$ select id from estaciones_riego where nombre = 'Papalon-1' $$;
create or replace function pg_temp.bit(p_id uuid, p_fecha date, p_extra jsonb) returns jsonb language sql as $$
    select fn_fert_sincronizar(jsonb_build_array(pg_temp.op(p_id, 'bitacora',
        jsonb_build_object('estacion_id', pg_temp.real(), 'turno_ciclo_id', pg_temp.tc(), 'fecha', p_fecha) || p_extra)))
$$;
create or replace function pg_temp.res(p_id uuid) returns text language sql as $$ select resultado from fert_operaciones where id = p_id $$;
create or replace function pg_temp.pct(p_fecha date) returns numeric language sql as
$$ select pct_fertilizacion from fert_bitacora_riego where turno_ciclo_id = pg_temp.tc() and fecha = p_fecha $$;
set client_min_messages = notice;
\set AGL '''00000000-0000-0000-0000-00000000000b'''
\set E1 '''00000000-0000-0000-0000-0000000000e1'''

-- ---------------------------------------------------------------- 0 · si el turno quedó archivado ANTES de la 112 (paquete del paso 1), se reactiva ya con la 113
select pg_temp.como(:AGL);
do $$ begin
    if to_regclass('public.qa112_paquete') is not null and (select archivado_at is not null from turnos_ciclo where agl_id = 'TR-QA-1') then
        perform fn_fert_restaurar_turno((select x from public.qa112_paquete));
        raise notice 'ok  turno archivado antes de la 112 reactivado con la 113 (huella cuadra)';
    end if;
end $$;
drop table if exists public.qa112_paquete;
select pg_temp.ok((select archivado_at is null from turnos_ciclo where agl_id = 'TR-QA-1'), 'TR-QA-1 activo');

-- ---------------------------------------------------------------- 1 · tipo y restricción
select pg_temp.ok((select numeric_precision >= 12 and numeric_scale = 2 from information_schema.columns
                   where table_name = 'fert_bitacora_riego' and column_name = 'pct_fertilizacion'), 'la columna es numeric(12,2) o más ancha');
select pg_temp.ok((select count(*) = 1 from pg_constraint where conrelid = 'public.fert_bitacora_riego'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) ilike '%pct_fertilizacion%'
                   and pg_get_constraintdef(oid) ilike '%>= (0)%' and pg_get_constraintdef(oid) not ilike '%100%'), 'un solo CHECK: >= 0, sin 100');

-- ---------------------------------------------------------------- 2 · 150 y 200 se guardan; −1 se rechaza
select pg_temp.como(:E1);
select pg_temp.bit('11300000-0000-4000-8000-000000000001', '2026-10-05', '{"pct_fertilizacion": 150}');
select pg_temp.ok(pg_temp.res('11300000-0000-4000-8000-000000000001') like 'ACEPTADO%' and pg_temp.pct('2026-10-05') = 150, '150 se guarda');
select pg_temp.bit('11300000-0000-4000-8000-000000000002', '2026-10-06', '{"pct_fertilizacion": "200,5"}');
select pg_temp.ok(pg_temp.res('11300000-0000-4000-8000-000000000002') like 'ACEPTADO%' and pg_temp.pct('2026-10-06') = 200.5, '200,5 (coma) se guarda');
select pg_temp.bit('11300000-0000-4000-8000-000000000003', '2026-10-07', '{"pct_fertilizacion": 1002}');
select pg_temp.ok(pg_temp.res('11300000-0000-4000-8000-000000000003') like 'ACEPTADO%' and pg_temp.pct('2026-10-07') = 1002, '1002 ya no se rechaza (sin tope)');
select pg_temp.bit('11300000-0000-4000-8000-000000000004', '2026-10-05', '{"pct_fertilizacion": "-1"}');
select pg_temp.ok(coalesce(pg_temp.res('11300000-0000-4000-8000-000000000004'), '') not like 'ACEPTADO%'
                  and (select mensaje from fert_operaciones where id = '11300000-0000-4000-8000-000000000004') like '%no puede ser negativo%'
                  and pg_temp.pct('2026-10-05') = 150, '-1 se rechaza con mensaje y no cambia nada');
select pg_temp.bit('11300000-0000-4000-8000-000000000005', '2026-10-08', '{"pct_fertilizacion": 0}');
select pg_temp.ok(pg_temp.pct('2026-10-08') = 0, '0 se acepta');
select pg_temp.bit('11300000-0000-4000-8000-000000000006', '2026-10-05', '{"horas_riego": 3}');
select pg_temp.ok(pg_temp.pct('2026-10-05') = 150, 'completar sin el %: el % se queda');
select pg_temp.bit('11300000-0000-4000-8000-000000000007', '2026-10-09', '{"pct_fertilizacion": "abc"}');
select pg_temp.ok(coalesce(pg_temp.res('11300000-0000-4000-8000-000000000007'), '') not like 'ACEPTADO%', 'texto no numérico se rechaza');
-- reenvío idempotente
select pg_temp.bit('11300000-0000-4000-8000-000000000001', '2026-10-05', '{"pct_fertilizacion": 150}');
select pg_temp.ok((select count(*) = 1 from fert_operaciones where id = '11300000-0000-4000-8000-000000000001'), 'reenvío idempotente');

-- ---------------------------------------------------------------- 3 · teléfono y AGL reciben 150
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo('2026-10-01')->'bitacora_riego') b
                          where b->>'fecha' = '2026-10-05' and (b->>'pct_fertilizacion')::numeric = 150), 'el teléfono recibe 150');
select pg_temp.como(:AGL);
create temp table p3 as select fn_fert_exportar_turno('TR-QA-1') as x;
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(x->'agl'->'bitacora_riego') b
                                  where b->>'fecha' = '2026-10-06' and (b->>'pct_fertilizacion')::numeric = 200.5) from p3), 'Terminar ciclo: el resumen trae 200.5');

-- ---------------------------------------------------------------- 4 · Terminar ciclo / Reactivar con % sobre 100
select fn_fert_archivar_turno('TR-QA-1', (select x->>'huella' from p3));
select pg_temp.ok(pg_temp.pct('2026-10-05') is null and (select archivado_at is not null from turnos_ciclo where id = pg_temp.tc()), 'archivado');
select fn_fert_restaurar_turno((select x from p3));
select pg_temp.ok(pg_temp.pct('2026-10-05') = 150 and pg_temp.pct('2026-10-06') = 200.5 and pg_temp.pct('2026-10-07') = 1002 and pg_temp.pct('2026-10-08') = 0,
                  'reactivado: vuelven 150, 200.5, 1002 y 0');
select pg_temp.ok((select _fert_turno_filas(pg_temp.tc()) = x->'filas' from p3), 'filas idénticas tras reactivar');

-- ---------------------------------------------------------------- 5 · la 113 corre dos veces sin dañar nada (se prueba desde el script de la réplica)
\echo '=== 113: TODAS LAS PRUEBAS PASARON ==='
