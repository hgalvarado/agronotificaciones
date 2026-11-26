-- =====================================================================
-- PRUEBAS de sql/153 · Motores: integridad del tanque (corrección en cadena, recepciones consumidas, eliminar sin descuadres)
-- Réplica local con 91–153 y los datos de prueba de 96/99/115 (estación Papalon-1, e1 = estacionero, chofer 10000000-...-0001).
-- Correr DESDE LA RAÍZ DEL REPO con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/153_motores_integridad.sql
-- Autosuficiente (crea su propio admin, un usuario sin permisos, diésel y motor T153-M1). ESCRITA, NO ejecutada (la corre Opus).
-- Órdenes a probar después: 150 > 153, 153 > 153, 147 > 148 > 149 > 150 > 153 (el bloque 8 los repite).
-- La prueba de la 150 describe el estado SIN la 153 (ahí una anulación consumida se acepta con SALDO_NEGATIVO y el saldo no se
-- realinea): con la 153 aplicada, esta prueba la reemplaza.
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('153a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.dia(p_atras integer) returns text language sql as $$ select (pg_temp.hoy() - p_atras)::text $$;
create or replace function pg_temp.ts(p_atras integer) returns text language sql as $$
    select case when p_atras = 0 then least(((pg_temp.hoy())::timestamp + time '12:00') at time zone 'America/Tegucigalpa', now() - interval '2 minutes')::text
                else ((pg_temp.hoy() - p_atras)::timestamp + time '12:00')::text || '-06' end $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint; r0 smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T153_ADM', 'P153 Admin', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, acceso_total) values ('T153_SIN', 'P153 Sin permisos', false) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T153_ADM';
    select id into r0 from roles where codigo = 'T153_SIN';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000015301', 'adm@153') on conflict do nothing;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000015302', 'sin@153') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000015301', 'Admin 153', r, true) on conflict (id) do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000015302', 'Sin permisos 153', r0, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000015301', r) on conflict do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000015302', r0) on conflict do nothing;
    insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
    values ('QA-DIESEL-153', 'Diésel QA 153', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true) on conflict (codigo) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000015301'::uuid as adm,
    '00000000-0000-0000-0000-000000015302'::uuid as sin;

-- ---------------------------------------------------------------- 0 · estructura
select pg_temp.ok(to_regprocedure('public._mot_realinear_tanque(uuid,uuid)') is not null and to_regprocedure('public._mot_op_realineo(text)') is not null,
                  'existen _mot_realinear_tanque y _mot_op_realineo');
select pg_temp.ok(position('153:saldo' in pg_get_functiondef('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)'::regprocedure)) > 0
              and position('153:realinear' in pg_get_functiondef('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)'::regprocedure)) > 0
              and position('153:msg' in pg_get_functiondef('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)'::regprocedure)) > 0
              and position('153:autorizar' in pg_get_functiondef('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) > 0
              and position('153:corregir-saldo' in pg_get_functiondef('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) > 0
              and position('153:realinear' in pg_get_functiondef('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) > 0
              and position('153:recalcular-recepcion' in pg_get_functiondef('public.fn_campo_eliminar_documento(text, uuid, text)'::regprocedure)) > 0,
                  'los parches 153 están en las 4 funciones');
select pg_temp.ok(position('150:saldo' in pg_get_functiondef('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)'::regprocedure)) > 0,
                  'la marca 150:saldo se conserva (la 150 no se pone encima de la 153)');

-- ---------------------------------------------------------------- 1 · motor con tanque y custodia
select pg_temp.como((select adm from k));
select fn_mot_publicar(jsonb_build_object('completo', false, 'material_diesel', 'QA-DIESEL-153',
    'motores', '[{"codigo":"T153-M1","nombre":"Motor 1 prueba 153","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300}]'::jsonb));
create temp table m as select (select id from equipos where codigo = 'T153-M1') as m1;
do $$
declare v_est uuid := (select est from k);
begin
    perform pg_temp.como((select adm from k));
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 153');
    end if;
    update fert_custodia set desde = now() - interval '30 days' where estacion_id = v_est;
    update fert_relevos set recibido_at = now() - interval '30 days', entregado_at = now() - interval '30 days'
    where id = (select id from fert_relevos where estacion_id = v_est and recibe_id = (select e1 from k)
                  and estado in ('RECIBIDO', 'ASIGNADO') order by recibido_at desc limit 1);
    update fert_relevos set estado = 'CANCELADO'
    where estacion_id = v_est and coalesce(recibido_at, entregado_at) > now() - interval '30 days' and estado <> 'CANCELADO';
end $$;
create temp table i1 as select pg_temp.op(pg_temp.uid(1), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque M1 153', 'capacidad_gal', 300),
    'motivo', 'Inicio', 'motivo_codigo', 'OTRO', 'horas_base', 0)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from i1), 'instalar el motor con su tanque: ' || (select r::text from i1));
create temp table tk as select tanque_id as t from mot_motores where equipo_id = (select m1 from m);
create or replace function pg_temp.saldo() returns numeric language sql as $$
    select coalesce((select disponible from mot_saldos where tanque_id = (select t from tk)), 0) $$;
create or replace function pg_temp.suma_libro() returns numeric language sql as $$
    select coalesce((select sum(cantidad) from mot_movimientos where tanque_id = (select t from tk)), 0) $$;

-- ---------------------------------------------------------------- 2 · escenario: 100 gal el día -5 y tres registros seguidos (-4, -3, -2)
select pg_temp.como((select e1 from k));
create temp table c1 as select pg_temp.op(pg_temp.uid(11), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 100,
    'fecha_hora', pg_temp.ts(5), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 5) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c1) and pg_temp.saldo() = 100, 'recepción de 100 gal: saldo 100: ' || (select r::text from c1));
create temp table r1 as select
    pg_temp.op(pg_temp.uid(22), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(4),
        'fecha_hora', pg_temp.ts(4), 'horo_ini', 100, 'horo_fin', 110, 'visor_ini', 100, 'visor_fin', 90), 4) as a;
create temp table r2 as select
    pg_temp.op(pg_temp.uid(23), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(3),
        'fecha_hora', pg_temp.ts(3), 'horo_ini', 110, 'horo_fin', 120, 'visor_ini', 90, 'visor_fin', 80), 3) as a;
create temp table r3 as select
    pg_temp.op(pg_temp.uid(24), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(2),
        'fecha_hora', pg_temp.ts(2), 'horo_ini', 120, 'horo_fin', 130, 'visor_ini', 80, 'visor_fin', 70), 2) as a;
select pg_temp.ok((select (a->>'estado') like 'ACEPTADO%' from r1) and (select (a->>'estado') like 'ACEPTADO%' from r2) and (select (a->>'estado') like 'ACEPTADO%' from r3),
                  'tres registros seguidos aceptados: ' || (select a::text from r3));
select pg_temp.ok(pg_temp.saldo() = 70 and pg_temp.saldo() = pg_temp.suma_libro(), 'el tanque quedó en el visor final del último registro (70) y el saldo vivo = suma del libro');

-- ---------------------------------------------------------------- 3 · corregir un día INTERMEDIO no desplaza el saldo
select pg_temp.como((select adm from k));
create temp table a1 as select pg_temp.op(pg_temp.uid(31), 'anulacion', jsonb_build_object('documento_tipo', 'motor_registro', 'documento_id', pg_temp.uid(23),
    'motivo', 'visor mal anotado, se corrige'), 0) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from a1), 'anular el registro del día -3 (el intermedio): ' || (select r::text from a1));
select pg_temp.ok(pg_temp.saldo() = 70, 'tras anular el intermedio el tanque sigue en el visor del último registro (70), no en 80');
select pg_temp.ok(exists (select 1 from mot_movimientos where tanque_id = (select t from tk) and documento_tipo = 'motor_realineo' and tipo = 'AJUSTE_VISOR' and cantidad = -10),
                  'el realineo quedó asentado como UN ajuste de −10 en el kardex');
select pg_temp.como((select e1 from k));
create temp table r4 as select pg_temp.op(pg_temp.uid(25), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(3),
    'fecha_hora', pg_temp.ts(3), 'horo_ini', 110, 'horo_fin', 118, 'visor_ini', 90, 'visor_fin', 75), 3) as a;
select pg_temp.ok((select (a->>'estado') like 'ACEPTADO%' and a::text like '%FUERA_DE_ORDEN%' from r4), 'el registro corregido del día -3 entra fuera de orden: ' || (select a::text from r4));
select pg_temp.ok(pg_temp.saldo() = 70 and pg_temp.saldo() = pg_temp.suma_libro(), 'tras guardar el día -3 corregido (gastó 15) el tanque sigue en 70 y no hay duplicados ni huecos');
select pg_temp.ok((select count(*) = 1 from mot_registros where equipo_id = (select m1 from m) and fecha = pg_temp.hoy() - 3 and anulado_at is null),
                  'un solo registro vigente del día -3');
select pg_temp.ok((select fecha_ultimo = pg_temp.hoy() - 2 and horo_ultimo = 130 and visor_ultimo = 70 from mot_motores where equipo_id = (select m1 from m)),
                  'las últimas lecturas del motor siguen siendo las del día -2');
select pg_temp.ok(public._mot_realinear_tanque((select t from tk)) = 0, 'realinear otra vez no asienta nada (idempotente)');

-- ---------------------------------------------------------------- 4 · anular una recepción YA GASTADA
-- el estacionero, aunque marque la señal, no puede aceptar el negativo (solo administrador)
select pg_temp.como((select e1 from k));
create temp table n1 as select pg_temp.op(pg_temp.uid(32), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(11),
    'motivo', 'recepción cargada dos veces', 'acepta_saldo_negativo', true), 0) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Corregir recepción%' from n1),
                  'estacionero con la señal: rechazado y el mensaje dice qué hacer (Corregir recepción): ' || (select r::text from n1));
select pg_temp.como((select adm from k));
create temp table n2 as select pg_temp.op(pg_temp.uid(33), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(11),
    'motivo', 'recepción cargada dos veces'), 0) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Corregir recepción%' from n2), 'administrador SIN la señal: rechazado: ' || (select r::text from n2));
select pg_temp.ok((select anulado_at is null from mot_recepciones where id = pg_temp.uid(11)) and pg_temp.saldo() = 70,
                  'rechazada: la recepción sigue vigente y el saldo no cambió');
create temp table n3 as select pg_temp.op(pg_temp.uid(34), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(11),
    'motivo', 'recepción cargada dos veces', 'acepta_saldo_negativo', true), 0) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%SALDO_NEGATIVO%' from n3), 'administrador CON la señal: aceptada con SALDO_NEGATIVO: ' || (select r::text from n3));
select pg_temp.ok((select anulado_at is not null from mot_recepciones where id = pg_temp.uid(11)) and pg_temp.saldo() = 70,
                  'aceptada: la recepción quedó anulada y el tanque sigue en el visor (70)');

-- ---------------------------------------------------------------- 5 · un usuario SIN permiso no corrige ni anula
select pg_temp.como((select e1 from k));
create temp table c2 as select pg_temp.op(pg_temp.uid(41), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 20,
    'fecha_hora', pg_temp.ts(1), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c2) and pg_temp.saldo() = 90, 'recepción de 20 gal del día -1: saldo 90');
select pg_temp.como((select sin from k));
create temp table s1 as select pg_temp.op(pg_temp.uid(42), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 5,
    'fecha_hora', pg_temp.ts(1), 'corrige_id', pg_temp.uid(41), 'motivo', 'corrección sin permiso'), 1) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from s1) and (select anulado_at is null from mot_recepciones where id = pg_temp.uid(41))
                  and not exists (select 1 from mot_recepciones where id = pg_temp.uid(42)) and pg_temp.saldo() = 90,
                  'sin permiso: corregir se rechaza y no queda nada a medias: ' || (select r::text from s1));
create temp table s2 as select pg_temp.op(pg_temp.uid(43), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(41),
    'motivo', 'anulación sin permiso'), 0) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from s2) and (select anulado_at is null from mot_recepciones where id = pg_temp.uid(41)),
                  'sin permiso: anular se rechaza: ' || (select r::text from s2));

-- ---------------------------------------------------------------- 6 · eliminar por completo recalcula el registro del día y realinea
select pg_temp.como((select adm from k));
-- una recepción del día -2 (el día del último registro): el registro recalcula su «recibido»
create temp table c3 as select pg_temp.op(pg_temp.uid(51), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 20,
    'fecha_hora', pg_temp.ts(2), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 2) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c3) and (select recibido_gal = 20 from mot_registros where id = pg_temp.uid(24)),
                  'la recepción del día -2 entra en el registro de ese día (recibido 20)');
create temp table e1 as select fn_campo_eliminar_documento('mot_recepcion', pg_temp.uid(51), 'prueba de eliminar por completo 153') as r;
select pg_temp.ok((select (r->>'ok')::boolean from e1) and not exists (select 1 from mot_recepciones where id = pg_temp.uid(51)),
                  'eliminar por completo la recepción de 20 gal: ' || (select r::text from e1));
select pg_temp.ok((select recibido_gal = 0 and gastado_gal = 10 from mot_registros where id = pg_temp.uid(24)),
                  'el registro del día -2 se recalculó: recibido 0, gastado 10');
select pg_temp.ok((select not (r::text like '%no se recalcula solo%') from e1), 'ya no avisa «el gastado no se recalcula solo»');
select pg_temp.ok(pg_temp.saldo() = 90 and pg_temp.saldo() = pg_temp.suma_libro(), 'saldo 90 (70 del visor + 20 de la recepción del día -1) y saldo vivo = libro');
-- eliminar por completo el registro intermedio (día -3): el tanque no se desplaza
create temp table e2 as select fn_campo_eliminar_documento('mot_registro', pg_temp.uid(25), 'prueba de eliminar el registro intermedio 153') as r;
select pg_temp.ok((select (r->>'ok')::boolean from e2) and not exists (select 1 from mot_registros where id = pg_temp.uid(25)),
                  'eliminar por completo el registro del día -3: ' || (select r::text from e2));
select pg_temp.ok(pg_temp.saldo() = 90 and pg_temp.saldo() = pg_temp.suma_libro(), 'tras eliminar el intermedio el tanque sigue en 90 (visor 70 + 20 del día -1)');

-- ---------------------------------------------------------------- 7 · corrección de recepción que empeora el saldo
-- la recepción del día -1 (20 gal) se corrige a 200: sube el tanque (no negativo) → aceptada
create temp table k1 as select pg_temp.op(pg_temp.uid(61), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 200,
    'fecha_hora', pg_temp.ts(1), 'corrige_id', pg_temp.uid(41), 'motivo', 'eran 200 galones y no 20'), 0) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from k1) and pg_temp.saldo() = 270, 'corregir 20 → 200: aceptada, saldo 270: ' || (select r::text from k1));
-- (el rechazo por saldo negativo de una corrección comparte la regla de la anulación, ya probada en el bloque 4)

-- ---------------------------------------------------------------- 8 · idempotencia y orden
create temp table h0 as select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) as h
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_anulacion', '_mot_op_registro_diario', 'fn_campo_eliminar_documento',
                     '_mot_realinear_tanque', '_mot_op_realineo', '_mot_recalcular_recibido');
\i sql/153_motores_integridad.sql
select pg_temp.ok((select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_anulacion', '_mot_op_registro_diario', 'fn_campo_eliminar_documento',
                                     '_mot_realinear_tanque', '_mot_op_realineo', '_mot_recalcular_recibido')) = (select h from h0),
                  'correr la 153 otra vez no cambia ninguna función (idempotente)');
\i sql/150_motores_correcciones.sql
\i sql/153_motores_integridad.sql
select pg_temp.ok((select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_anulacion', '_mot_op_registro_diario', 'fn_campo_eliminar_documento',
                                     '_mot_realinear_tanque', '_mot_op_realineo', '_mot_recalcular_recibido')) = (select h from h0),
                  'orden 153 > 150 > 153: las funciones quedan iguales (la 150 no se pone encima de la 153)');
\i sql/147_motores_tanques_custodia.sql
\i sql/148_motores_recepciones_recientes.sql
\i sql/149_motores_general_temporada.sql
\i sql/150_motores_correcciones.sql
\i sql/153_motores_integridad.sql
select pg_temp.ok((select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_anulacion', '_mot_op_registro_diario', 'fn_campo_eliminar_documento',
                                     '_mot_realinear_tanque', '_mot_op_realineo', '_mot_recalcular_recibido')) = (select h from h0),
                  'orden 147 > 148 > 149 > 150 > 153: las funciones quedan iguales');

\echo 'PRUEBAS 153 TERMINADAS'
