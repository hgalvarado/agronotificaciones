-- =====================================================================
-- PRUEBAS de sql/112 · PASO 1 (en una base con la 102 y SIN la 112): se archiva el turno TR-QA-1 como lo haría AGL
-- hoy en producción. El paquete queda en la tabla qa112_paquete para que el paso 2 (112_pct_fertilizacion.sql),
-- ya con la 112, compruebe que un turno archivado ANTES de la columna nueva se reactiva igual (misma huella).
-- Réplica con 99..104 y los datos de pruebas/sql/99 (turno TR-QA-1 en Papalon-1). Solo réplica.
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
set client_min_messages = notice;
\set AGL '''00000000-0000-0000-0000-00000000000b'''

select pg_temp.ok(not exists (select 1 from information_schema.columns
                              where table_name = 'fert_bitacora_riego' and column_name = 'pct_fertilizacion'),
                  'la base todavía NO tiene la 112');
select pg_temp.ok((select archivado_at is null from turnos_ciclo where agl_id = 'TR-QA-1'), 'TR-QA-1 está activo');
select pg_temp.ok((select count(*) > 0 from fert_bitacora_riego b join turnos_ciclo t on t.id = b.turno_ciclo_id
                   where t.agl_id = 'TR-QA-1'), 'TR-QA-1 tiene bitácora (para que la huella la incluya)');

select pg_temp.como(:AGL);
drop table if exists public.qa112_paquete;
create table public.qa112_paquete as select fn_fert_exportar_turno('TR-QA-1') as x;
select fn_fert_archivar_turno('TR-QA-1', (select x->>'huella' from public.qa112_paquete));
select pg_temp.ok((select archivado_at is not null from turnos_ciclo where agl_id = 'TR-QA-1'), 'archivado sin la 112');
\echo '=== 112 paso 1: turno archivado sin la columna nueva ==='
