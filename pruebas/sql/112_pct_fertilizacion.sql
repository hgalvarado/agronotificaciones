-- =====================================================================
-- PRUEBAS de sql/112 · % de fertilización en Fertirriego › Horas
-- Correr DESPUÉS de 112_pct_fertilizacion_antes.sql y de la migración 112 (réplica con 99..104 + datos de pruebas/sql/99).
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

-- ---------------------------------------------------------------- 1 · un turno archivado ANTES de la 112 se reactiva
select pg_temp.como(:AGL);
create temp table rs as select fn_fert_restaurar_turno((select x from public.qa112_paquete)) as x;
select pg_temp.ok((select (x->>'restaurado')::boolean from rs), 'turno archivado sin la columna: se reactiva (la huella cuadra)');
select pg_temp.ok((select _fert_turno_filas(pg_temp.tc()) = x->'filas' from public.qa112_paquete), 'y sus filas son idénticas');

-- ---------------------------------------------------------------- 2 · registrar el % (cola idempotente)
select pg_temp.como(:E1);
select pg_temp.bit('11200000-0000-4000-8000-000000000001', '2026-10-05', '{"horas_fertilizacion": 2, "pct_fertilizacion": 85.5}');
select pg_temp.ok(pg_temp.res('11200000-0000-4000-8000-000000000001') like 'ACEPTADO%', 'bitácora con % aceptada');
select pg_temp.ok(pg_temp.pct('2026-10-05') = 85.5, 'se guarda el % (85.5)');
-- reenvío de la misma operación (la cola sin señal): no duplica ni cambia
select pg_temp.bit('11200000-0000-4000-8000-000000000001', '2026-10-05', '{"horas_fertilizacion": 2, "pct_fertilizacion": 85.5}');
select pg_temp.ok((select count(*) = 1 from fert_bitacora_riego where turno_ciclo_id = pg_temp.tc() and fecha = '2026-10-05')
                  and (select count(*) = 1 from fert_operaciones where id = '11200000-0000-4000-8000-000000000001'),
                  'reenvío idempotente: una sola fila y una sola operación');
-- otra operación sin el %: lo vacío no borra lo que ya estaba
select pg_temp.bit('11200000-0000-4000-8000-000000000002', '2026-10-05', '{"horas_riego": 4}');
select pg_temp.ok(pg_temp.pct('2026-10-05') = 85.5
                  and (select horas_riego = 4 and horas_fertilizacion = 2 from fert_bitacora_riego where turno_ciclo_id = pg_temp.tc() and fecha = '2026-10-05'),
                  'completar sin el %: el % se queda');
-- texto con coma decimal
select pg_temp.bit('11200000-0000-4000-8000-000000000003', '2026-10-05', '{"pct_fertilizacion": "90,25"}');
select pg_temp.ok(pg_temp.pct('2026-10-05') = 90.25, 'coma decimal: 90,25 → 90.25 (corrige el anterior)');
-- fuera de rango y no numérico: la operación queda rechazada con mensaje y no cambia nada
select pg_temp.bit('11200000-0000-4000-8000-000000000004', '2026-10-05', '{"pct_fertilizacion": 1002}');
select pg_temp.ok(coalesce(pg_temp.res('11200000-0000-4000-8000-000000000004'), '') not like 'ACEPTADO%'
                  and (select mensaje from fert_operaciones where id = '11200000-0000-4000-8000-000000000004') like '%entre 0 y 100%'
                  and pg_temp.pct('2026-10-05') = 90.25, '1002 % se rechaza («entre 0 y 100») y no cambia nada');
select pg_temp.bit('11200000-0000-4000-8000-000000000005', '2026-10-05', '{"pct_fertilizacion": "-1"}');
select pg_temp.ok(coalesce(pg_temp.res('11200000-0000-4000-8000-000000000005'), '') not like 'ACEPTADO%' and pg_temp.pct('2026-10-05') = 90.25, '-1 se rechaza');
select pg_temp.bit('11200000-0000-4000-8000-000000000006', '2026-10-05', '{"pct_fertilizacion": "abc"}');
select pg_temp.ok(coalesce(pg_temp.res('11200000-0000-4000-8000-000000000006'), '') not like 'ACEPTADO%' and pg_temp.pct('2026-10-05') = 90.25, 'texto no numérico se rechaza');
-- los límites
select pg_temp.bit('11200000-0000-4000-8000-000000000007', '2026-10-06', '{"pct_fertilizacion": 0}');
select pg_temp.bit('11200000-0000-4000-8000-000000000008', '2026-10-07', '{"pct_fertilizacion": 100}');
select pg_temp.ok(pg_temp.pct('2026-10-06') = 0 and pg_temp.pct('2026-10-07') = 100, '0 y 100 se aceptan');
-- un teléfono viejo (sin el campo) sigue funcionando
select pg_temp.bit('11200000-0000-4000-8000-000000000009', '2026-10-08', '{"horas_riego": 3}');
select pg_temp.ok(pg_temp.res('11200000-0000-4000-8000-000000000009') like 'ACEPTADO%' and pg_temp.pct('2026-10-08') is null,
                  'teléfono viejo sin el campo: aceptado, % vacío');

-- ---------------------------------------------------------------- 3 · el teléfono y AGL lo reciben
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo('2026-10-01')->'bitacora_riego') b
                          where b->>'fecha' = '2026-10-05' and (b->>'pct_fertilizacion')::numeric = 90.25),
                  'el teléfono recibe el % (fn_fert_estado_campo)');
select pg_temp.como(:AGL);
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_exportar(0, 50000)->'bitacora_riego') b
                          where b->>'turno_agl_id' = 'TR-QA-1' and b->>'fecha' = '2026-10-05' and (b->>'pct_fertilizacion')::numeric = 90.25),
                  'AGL recibe el % (fn_fert_exportar)');
create temp table p2 as select fn_fert_exportar_turno('TR-QA-1') as x;
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(x->'agl'->'bitacora_riego') b
                                  where b->>'fecha' = '2026-10-05' and (b->>'pct_fertilizacion')::numeric = 90.25) from p2),
                  'Terminar ciclo: el resumen trae el %');

-- ---------------------------------------------------------------- 4 · Terminar ciclo / Reactivar con el % guardado
select fn_fert_archivar_turno('TR-QA-1', (select x->>'huella' from p2));
select pg_temp.ok(pg_temp.pct('2026-10-05') is null and (select archivado_at is not null from turnos_ciclo where id = pg_temp.tc()),
                  'archivado: la bitácora se fue de la base');
select fn_fert_restaurar_turno((select x from p2));
select pg_temp.ok(pg_temp.pct('2026-10-05') = 90.25 and pg_temp.pct('2026-10-06') = 0 and pg_temp.pct('2026-10-08') is null,
                  'reactivado: vuelven los % (incluido el 0 y el vacío)');
select pg_temp.ok((select _fert_turno_filas(pg_temp.tc()) = x->'filas' from p2), 'filas idénticas tras reactivar');

drop table public.qa112_paquete;
\echo '=== 112: TODAS LAS PRUEBAS PASARON ==='
