-- =====================================================================
-- PRUEBAS de sql/150 · Motores: corrección atómica de recepciones, recálculo del día, sin «días sin registro»
-- Réplica local con 91–150 y los datos de prueba de 96/99/115 (estación Papalon-1, e1 = estacionero, chofer 10000000-...-0001).
-- Correr DESDE LA RAÍZ DEL REPO con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/150_motores_correcciones.sql
-- Autosuficiente (crea su propio admin, diésel y motor T150-M1). NO ejecutada todavía (la corre Opus).
-- Órdenes a probar después: 147 > 150, 150 > 147 > 150, 150 > 150 y 144…149 > 150 (el bloque 7 repite 147/148/149/150).
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
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', now() - make_interval(days => p_dias_atras), 'enviado_en', now(),
        'inmediato', p_dias_atras = 0, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('150a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.dia(p_atras integer) returns text language sql as $$ select (pg_temp.hoy() - p_atras)::text $$;
create or replace function pg_temp.ts(p_atras integer) returns text language sql as $$
    select case when p_atras = 0 then least(((pg_temp.hoy())::timestamp + time '12:00') at time zone 'America/Tegucigalpa', now() - interval '2 minutes')::text
                else ((pg_temp.hoy() - p_atras)::timestamp + time '12:00')::text || '-06' end $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T150_ADM', 'P150 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T150_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000015001', 'adm@150') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000015001', 'Admin 150', r, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000015001', r) on conflict do nothing;
    insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
    values ('QA-DIESEL-150', 'Diésel QA 150', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true) on conflict (codigo) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-DIESEL-150') as dsl,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000015001'::uuid as adm;

-- ---------------------------------------------------------------- 0 · estructura
select pg_temp.ok(to_regprocedure('public._mot_recalcular_recibido(uuid,date,uuid)') is not null, 'existe _mot_recalcular_recibido');
select pg_temp.ok(position('150:corregir' in pg_get_functiondef('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) > 0
              and position('150:recalcular-final' in pg_get_functiondef('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) > 0
              and position('150:recalcular' in pg_get_functiondef('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)'::regprocedure)) > 0
              and position('150:sin-falta-registro' in pg_get_functiondef('public._mot_estado_motor(uuid)'::regprocedure)) > 0
              and position('150:sin-hueco' in pg_get_functiondef('public._mot_senales(uuid[], date, date)'::regprocedure)) > 0,
                  'los parches 150 están en las 4 funciones');
select pg_temp.ok(position('FALTA_REGISTRO' in pg_get_functiondef('public._mot_estado_motor(uuid)'::regprocedure)) = 0,
                  '_mot_estado_motor ya no emite FALTA_REGISTRO');

-- ---------------------------------------------------------------- 1 · motor con tanque y custodia (como la 144)
select pg_temp.como((select adm from k));
select fn_mot_publicar(jsonb_build_object('completo', false, 'material_diesel', 'QA-DIESEL-150',
    'motores', '[{"codigo":"T150-M1","nombre":"Motor 1 prueba 150","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300}]'::jsonb));
create temp table m as select (select id from equipos where codigo = 'T150-M1') as m1;
do $$
declare v_est uuid := (select est from k);
begin
    perform pg_temp.como((select adm from k));
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 150');
    end if;
    update fert_custodia set desde = now() - interval '30 days' where estacion_id = v_est;
    update fert_relevos set recibido_at = now() - interval '30 days', entregado_at = now() - interval '30 days'
    where id = (select id from fert_relevos where estacion_id = v_est and recibe_id = (select e1 from k)
                  and estado in ('RECIBIDO', 'ASIGNADO') order by recibido_at desc limit 1);
    update fert_relevos set estado = 'CANCELADO'
    where estacion_id = v_est and coalesce(recibido_at, entregado_at) > now() - interval '30 days' and estado <> 'CANCELADO';
end $$;
create temp table i1 as select pg_temp.op(pg_temp.uid(1), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque M1 150', 'capacidad_gal', 300),
    'motivo', 'Inicio', 'motivo_codigo', 'OTRO', 'horas_base', 0)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from i1), 'instalar el motor con su tanque: ' || (select r::text from i1));
create temp table tk as select tanque_id as t from mot_motores where equipo_id = (select m1 from m);
create or replace function pg_temp.saldo() returns numeric language sql as $$
    select coalesce((select disponible from mot_saldos where tanque_id = (select t from tk)), 0) $$;

-- ---------------------------------------------------------------- 2 · escenario: 100 gal el día -4; 10 gal el día -3 y un registro de ese día
-- registro día -3: visor 50 → 55 con 10 gal recibidos ese día: gastado = 50 + 10 − 55 = 5; rendimiento 0.5 gal/h
select pg_temp.como((select e1 from k));
create temp table c1 as select pg_temp.op(pg_temp.uid(11), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 100,
    'fecha_hora', pg_temp.ts(4), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 4) as r;
create temp table c2 as select pg_temp.op(pg_temp.uid(12), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 10,
    'fecha_hora', pg_temp.ts(3), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 3) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c1) and (select r->>'estado' like 'ACEPTADO%' from c2) and pg_temp.saldo() = 110,
                  'dos recepciones (100 y 10) entran al tanque: saldo 110');
create temp table r1 as select pg_temp.op(pg_temp.uid(21), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(3),
    'fecha_hora', pg_temp.ts(3), 'horo_ini', 100, 'horo_fin', 110, 'visor_ini', 50, 'visor_fin', 55), 3) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r1), 'registro del día -3: ' || (select r::text from r1));
select pg_temp.ok((select recibido_gal = 10 and gastado_gal = 5 and rendimiento_gal_h = 0.5 from mot_registros where id = pg_temp.uid(21)),
                  'registro: recibido 10, gastado 5, rendimiento 0.5');
select pg_temp.ok(pg_temp.saldo() = 55, 'el tanque queda en el visor final (55)');

-- ---------------------------------------------------------------- 3 · sin «días sin registro»
-- el último registro es de hace 3 días: antes sería «Faltan 2 días sin registro»
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(public._mot_estado_motor((select m1 from m))->'ahora') x where x->>'codigo' = 'FALTA_REGISTRO')),
                  'el estado del motor NO trae FALTA_REGISTRO aunque falten días');

-- ---------------------------------------------------------------- 4 · corrección atómica
select pg_temp.como((select adm from k));
-- motivo corto: rechazada y NO queda nada a medias (la vieja sigue vigente, la nueva no existe)
create temp table x0 as select pg_temp.op(pg_temp.uid(17), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 6,
    'fecha_hora', pg_temp.ts(3), 'corrige_id', pg_temp.uid(12), 'motivo', 'corto'), 3) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%10 letras%' from x0), 'corrección con motivo corto: rechazada');
select pg_temp.ok((select anulado_at is null from mot_recepciones where id = pg_temp.uid(12)) and not exists (select 1 from mot_recepciones where id = pg_temp.uid(17))
                  and pg_temp.saldo() = 55, 'rechazada: la recepción vieja sigue vigente, no hay nueva y el saldo no cambió');
-- recepción inexistente
create temp table x1 as select pg_temp.op(pg_temp.uid(14), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 6,
    'fecha_hora', pg_temp.ts(3), 'corrige_id', pg_temp.uid(99), 'motivo', 'corrección de prueba'), 3) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from x1) and not exists (select 1 from mot_recepciones where id = pg_temp.uid(14)), 'corregir una recepción que no existe: rechazado');
-- corrección buena: 10 → 6 gal (el visor subió 5: gastado = 50 + 6 − 55 = 1)
create temp table x2 as select pg_temp.op(pg_temp.uid(13), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 6,
    'fecha_hora', pg_temp.ts(3), 'chofer_id', '10000000-0000-0000-0000-000000000001', 'corrige_id', pg_temp.uid(12),
    'motivo', 'Se anotaron 10 y eran 6'), 3) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from x2), 'corrección aceptada en UNA operación: ' || (select r::text from x2));
select pg_temp.ok((select anulado_at is not null and motivo_anulacion like 'Corrección:%' from mot_recepciones where id = pg_temp.uid(12))
                  and (select galones = 6 and anulado_at is null from mot_recepciones where id = pg_temp.uid(13)),
                  'la vieja quedó anulada con motivo y la nueva (6 gal) vigente');
select pg_temp.ok((select recibido_gal = 6 and gastado_gal = 1 and rendimiento_gal_h = 0.1 from mot_registros where id = pg_temp.uid(21)),
                  'el registro del día se recalculó: recibido 6, gastado 1, rendimiento 0.1');
select pg_temp.ok(pg_temp.saldo() = 55, 'el saldo del tanque sigue = visor final (55): −10 +6 (recepciones) y +4 (consumo recalculado)');
select pg_temp.ok((select count(*) = 1 from mot_recepciones where anulado_at is null and public._mot_dia(fecha_hora) = pg_temp.hoy() - 3 and tanque_id = (select t from tk)),
                  'una sola recepción vigente ese día (sin duplicados)');
-- el mismo UUID dos veces: no duplica ni mueve el saldo
select pg_temp.op(pg_temp.uid(13), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 6,
    'fecha_hora', pg_temp.ts(3), 'corrige_id', pg_temp.uid(12), 'motivo', 'Se anotaron 10 y eran 6'), 3);
select pg_temp.ok((select count(*) = 2 from mot_recepciones where id in (pg_temp.uid(12), pg_temp.uid(13))) and pg_temp.saldo() = 55,
                  'repetir la misma operación no duplica ni mueve el saldo');
-- corregir una ya anulada: rechazado y sin nueva
create temp table x3 as select pg_temp.op(pg_temp.uid(15), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 7,
    'fecha_hora', pg_temp.ts(3), 'corrige_id', pg_temp.uid(12), 'motivo', 'otra corrección de prueba'), 3) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from x3) and not exists (select 1 from mot_recepciones where id = pg_temp.uid(15)),
                  'corregir una recepción ya anulada: rechazado y sin nueva');
-- sin permiso: el estacionero no puede corregir la recepción de otro día/otra persona (no es su jornada ni tiene «Anular»)
select pg_temp.como((select e1 from k));
create temp table x4 as select pg_temp.op(pg_temp.uid(16), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 100,
    'fecha_hora', pg_temp.ts(4), 'chofer_id', '10000000-0000-0000-0000-000000000001', 'corrige_id', pg_temp.uid(11), 'motivo', 'corrección propia en su jornada'), 4) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from x4), 'corrección de un estacionero sobre SU recepción con custodia vigente: aceptada: ' || (select r->>'estado' from x4));
select pg_temp.ok((select (anulado_at is not null) = exists (select 1 from mot_recepciones where id = pg_temp.uid(16)) from mot_recepciones where id = pg_temp.uid(11)),
                  'atómico: o se anuló la vieja Y existe la nueva, o ninguna de las dos');

-- ---------------------------------------------------------------- 5 · anular una recepción recalcula el registro del día
select pg_temp.como((select adm from k));
create temp table a1 as select pg_temp.op(pg_temp.uid(31), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(13),
    'motivo', 'recepción duplicada'), 3) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from a1), 'anular la recepción de 6 gal: ' || (select r::text from a1));
select pg_temp.ok((select recibido_gal = 0 and gastado_gal = 0 and rendimiento_gal_h = 0 from mot_registros where id = pg_temp.uid(21)),
                  'el registro del día quedó recibido 0, gastado 0 (el visor subió sin diésel que lo explique)');
select pg_temp.ok(pg_temp.saldo() = 50, 'saldo 50 = 55 − 6 (recepción) + 1 (consumo recalculado)');
select pg_temp.ok((select not (r::text like '%SALDO_NEGATIVO%') from a1), 'sin saldo negativo no hay observación SALDO_NEGATIVO');

-- ---------------------------------------------------------------- 6 · saldo negativo: se acepta con la observación
create temp table a2 as select pg_temp.op(pg_temp.uid(32), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(16),
    'motivo', 'recepción cargada dos veces'), 3) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%SALDO_NEGATIVO%' from a2), 'anular 100 gal con el tanque en 50: se acepta con SALDO_NEGATIVO: ' || (select r::text from a2));
select pg_temp.ok(pg_temp.saldo() = -50, 'el saldo queda en −50 (el visor es la realidad)');
-- la corrección también avisa: se recibe y se corrige a una cantidad que sigue dejando negativo
create temp table c3 as select pg_temp.op(pg_temp.uid(41), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 20,
    'fecha_hora', pg_temp.ts(2), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 2) as r;
create temp table c4 as select pg_temp.op(pg_temp.uid(42), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 10,
    'fecha_hora', pg_temp.ts(2), 'corrige_id', pg_temp.uid(41), 'motivo', 'eran 10 galones y no 20'), 2) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%SALDO_NEGATIVO%' from c4) and pg_temp.saldo() = -40,
                  'corregir 20 → 10 con el tanque aún negativo: aceptada con SALDO_NEGATIVO, saldo −40');

-- ---------------------------------------------------------------- 7 · «días sin registro» tampoco sale en las señales
select pg_temp.como((select e1 from k));
create temp table r2 as select pg_temp.op(pg_temp.uid(22), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(1),
    'fecha_hora', pg_temp.ts(1), 'horo_ini', 110, 'horo_fin', 120, 'visor_ini', 55, 'visor_fin', 50), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r2), 'registro del día -1 (dos días después del anterior): ' || (select r::text from r2));
select pg_temp.ok(not exists (select 1 from public._mot_senales(array[(select m1 from m)], null, null) s where s.codigo = 'HUECO_DIAS'),
                  '_mot_senales ya no emite HUECO_DIAS');

-- ---------------------------------------------------------------- 8 · idempotencia y orden (147 > 148 > 149 > 150 deja lo mismo)
create temp table h0 as select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) as h
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_anulacion', '_mot_estado_motor', '_mot_senales', '_mot_recalcular_recibido');
\i sql/150_motores_correcciones.sql
select pg_temp.ok((select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_anulacion', '_mot_estado_motor', '_mot_senales', '_mot_recalcular_recibido')) = (select h from h0),
                  'correr la 150 otra vez no cambia ninguna función (idempotente)');
\i sql/147_motores_tanques_custodia.sql
\i sql/148_motores_recepciones_recientes.sql
\i sql/149_motores_general_temporada.sql
\i sql/150_motores_correcciones.sql
select pg_temp.ok((select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_anulacion', '_mot_estado_motor', '_mot_senales', '_mot_recalcular_recibido')) = (select h from h0),
                  'orden 150 > 147 > 148 > 149 > 150: las funciones quedan igual (la 150 trae su parche tras volver a correr la 147)');

\echo 'PRUEBAS 150 TERMINADAS'
