-- =====================================================================
-- Borra SOLO lo sembrado por scripts/sembrar-demo-campo.sql (base de DESARROLLO). Todo por id exacto / prefijo DEMO, siempre con WHERE.
-- Uso:  psql "$SUPABASE_DB_URL_DESARROLLO" -v ON_ERROR_STOP=1 -f scripts/borrar-demo-campo.sql
-- =====================================================================
\set ON_ERROR_STOP 1
select set_config('request.jwt.claim.sub', '242d3401-cbc6-47b6-8272-91ce3533f24d', false);
set client_min_messages = warning;

-- 1) estación de prueba y todo lo suyo (libro, saldos, Inyección, motor de práctica) + apaga el modo de pruebas.
--    Solo si la ÚNICA estación de prueba es la DEMO (si hubiera otras pruebas del usuario no se tocan).
do $$
declare v_otras integer;
begin
    select count(*) into v_otras from estaciones_riego where prueba_de is not null and nombre not like 'PRUEBA · DEMO %';
    if v_otras > 0 then
        raise exception 'Hay % estaciones de prueba que no son DEMO; no se borra el modo de pruebas. Bórralas desde Administración.', v_otras;
    end if;
    perform fn_fert_pruebas_borrar();
end $$;

-- 2) restos DEMO
delete from fert_operaciones where id::text like 'd3a00000-0000-4000-8000-%';
delete from iny_aplicaciones_detalle where aplicacion_id in (select id from iny_aplicaciones where turno_agl_id = 'TR-DEMO-1');
delete from iny_aplicaciones where turno_agl_id = 'TR-DEMO-1';
delete from iny_plan where turno_agl_id = 'TR-DEMO-1';
delete from fert_plan where turno_ciclo_id in (select id from turnos_ciclo where agl_id = 'TR-DEMO-1');
delete from fert_bitacora_riego where turno_ciclo_id in (select id from turnos_ciclo where agl_id = 'TR-DEMO-1');
create temp table tt as select turno_id from turnos_ciclo where agl_id = 'TR-DEMO-1';
delete from turnos_ciclo where agl_id = 'TR-DEMO-1';
delete from turnos where id in (select turno_id from tt);
delete from fert_choferes where id = 'd3a00000-0000-4000-8000-00000000c001';
delete from estaciones_riego where nombre = 'DEMO Campo' and prueba_de is null;
delete from iny_categorias where clave = 'ferti-riego|inyeccion' and not exists (select 1 from iny_plan) and not exists (select 1 from iny_aplicaciones);
delete from materiales where codigo like 'DEMO-%';

select 'restos' as k,
       (select count(*) from estaciones_riego where nombre like '%DEMO Campo%') as estaciones,
       (select count(*) from materiales where codigo like 'DEMO-%') as materiales,
       (select count(*) from iny_plan where turno_agl_id = 'TR-DEMO-1') as plan,
       (select count(*) from fert_operaciones where id::text like 'd3a00000-0000-4000-8000-%') as ops;
-- demo capacidades: delete from fert_capacidad_estandar where material_id in ('8ad99410-1296-46b1-822d-46dd0f3a0b28','7fde9617-6cca-4555-9d47-553ad46864aa','3854ce2b-5ac8-42b2-b8fe-d0c53ebd9621');
