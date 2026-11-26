-- =====================================================================
-- Borra SOLO lo sembrado por scripts/sembrar-demo-motores.sql (base de DESARROLLO). Todo por prefijo DEMO / id exacto, siempre con WHERE.
-- NO toca la demo de Campo (Inyección/Fertirriego): el motor de práctica de «PRUEBA · DEMO Campo» se deja limpio (se recrea vacío).
-- Uso:  psql "$SUPABASE_DB_URL_DESARROLLO" -v ON_ERROR_STOP=1 -f scripts/borrar-demo-motores.sql
-- =====================================================================
\set ON_ERROR_STOP 1
select set_config('request.jwt.claim.sub', '242d3401-cbc6-47b6-8272-91ce3533f24d', false);
set client_min_messages = warning;

create temp table est_d as select id, prueba_de from estaciones_riego where nombre in ('PRUEBA · DEMO Motores B', 'PRUEBA · DEMO Motores C', 'PRUEBA · DEMO Motores D');
create temp table est_t as select id from estaciones_riego where nombre in ('PRUEBA · DEMO Campo', 'PRUEBA · DEMO Motores B', 'PRUEBA · DEMO Motores C', 'PRUEBA · DEMO Motores D');
create temp table mot_d as select m.equipo_id from mot_motores m where m.prueba_de in (select id from est_t);
create temp table tq_d as select id from mot_tanques where nombre like 'DEMO Tanque%';
create temp table op_d as
    select r.id from mot_registros r where r.equipo_id in (select equipo_id from mot_d)
    union select r.id from mot_recepciones r where r.tanque_id in (select id from tq_d)
    union select r.id from mot_mantenimientos r where r.equipo_id in (select equipo_id from mot_d)
    union select r.id from mot_asignaciones r where r.equipo_id in (select equipo_id from mot_d)
    union select o.id from fert_operaciones o where o.id in (select md5('demo-motores-' || x)::uuid from (select unnest(array['a-inst','b-inst','c-inst','d-inst','d-mover']) x) z)
    union select o.id from fert_operaciones o where o.tipo in ('motor_registro_diario', 'motor_asignar', 'diesel_recibir', 'motor_mantenimiento')
                                              and o.estacion_id in (select id from est_t)
                                              and o.id not in (select id from mot_registros union select id from mot_recepciones union select id from mot_asignaciones union select id from mot_mantenimientos);

do $$
begin
    perform set_config('mot.libro_permitir', 'on', true);   -- el libro de tanques es inalterable; solo aquí se permite
    delete from mot_movimientos where tanque_id in (select id from tq_d);
    delete from mot_saldos where tanque_id in (select id from tq_d);
    delete from mot_registros where equipo_id in (select equipo_id from mot_d);
    delete from mot_recepciones where tanque_id in (select id from tq_d);
    delete from mot_mantenimientos where equipo_id in (select equipo_id from mot_d);
    delete from mot_custodias where equipo_id in (select equipo_id from mot_d);
    delete from mot_asignaciones where equipo_id in (select equipo_id from mot_d);
    delete from mot_tanque_historial where tanque_id in (select id from tq_d);
    delete from mot_tanques where id in (select id from tq_d);
    delete from fert_movimientos where operacion_id in (select id from op_d);
    delete from fert_operaciones where id in (select id from op_d);
    -- los motores de práctica se borran (los de B, C y D con su estación; el de DEMO Campo se recrea limpio abajo)
    delete from mot_motores where equipo_id in (select equipo_id from mot_d);
    delete from equipos where id in (select equipo_id from mot_d) and codigo like 'PRUEBA-M-%';
    perform set_config('mot.libro_permitir', 'off', true);
end $$;

-- estaciones B, C y D (de prueba y las reales ocultas que las originan)
delete from perfiles_estaciones where estacion_id in (select id from est_d);
delete from fert_relevos where estacion_id in (select id from est_d);
delete from fert_custodia where estacion_id in (select id from est_d);
delete from fert_saldos where estacion_id in (select id from est_d);
delete from estaciones_riego where id in (select id from est_d);
delete from estaciones_riego where id in (select prueba_de from est_d) and nombre in ('DEMO Motores B', 'DEMO Motores C', 'DEMO Motores D');
delete from fert_choferes where id = 'd3b00000-0000-4000-8000-00000000c001';
-- diésel DEMO solo si la configuración apunta a él y nada más lo usa
update mot_bajada_config set material_diesel_id = null where id and material_diesel_id = (select id from materiales where codigo = 'DEMO-DIESEL');
delete from materiales where codigo = 'DEMO-DIESEL' and not exists (select 1 from mot_tanques where material_id = materiales.id);
-- el motor de práctica de DEMO Campo vuelve a existir, limpio
select _campo_pruebas_preparar();

select 'restos' as k,
       (select count(*) from estaciones_riego where nombre like '%DEMO Motores%') as estaciones,
       (select count(*) from mot_tanques where nombre like 'DEMO Tanque%') as tanques,
       (select count(*) from mot_registros r join equipos e on e.id = r.equipo_id where e.nombre like 'DEMO Motor%') as registros,
       (select count(*) from fert_operaciones where id = md5('demo-motores-a-inst')::uuid) as ops;
