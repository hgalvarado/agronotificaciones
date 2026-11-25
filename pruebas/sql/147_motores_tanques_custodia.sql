-- =====================================================================
-- PRUEBAS de sql/147 · Motores: tanques fijos, custodia por tramos, diésel solo en el tanque, semáforo y señales
-- Réplica local con 91–145 y 147 y los datos de prueba de 96/99/115 (estación Papalon-1, e1 = estacionero, chofer 10000000-...-0001).
-- Correr DESDE LA RAÍZ DEL REPO con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/147_motores_tanques_custodia.sql
-- Autosuficiente (crea su propio admin, diésel y motores T147-M1). NO ejecutada todavía (la corre Opus).
-- Órdenes a probar: 144 > 147; 145 > 147; 147 > 147 (dos veces); 130…145 > 147 > 144 > 147 (la 144 redefine
-- _mot_op_diesel_recibir: hay que volver a correr la 147) y 147 > 136/138/140 (deben saltar sus parches: marcas incluidas).
-- Cubre: tanque fijo (no viaja con el motor), diésel al tanque sin tocar la bodega, rebaje por gastado, diferencia contra el
-- visor, señales (hueco, retroceso, visor que falta), semáforo de mantenimiento, historial por tramos y que mover el motor no
-- lo deja ver al destino, anulación del traslado, modo de pruebas aislado e idempotencia de la siembra.
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('147a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.dia(p_atras integer) returns text language sql as $$ select (pg_temp.hoy() - p_atras)::text $$;
create or replace function pg_temp.ts(p_atras integer) returns text language sql as $$
    select case when p_atras = 0 then least(((pg_temp.hoy())::timestamp + time '12:00') at time zone 'America/Tegucigalpa', now() - interval '2 minutes')::text
                else ((pg_temp.hoy() - p_atras)::timestamp + time '12:00')::text || '-06' end $$;
create or replace function pg_temp.falla(p_sql text, p_texto text) returns boolean language plpgsql as $$
begin
    execute p_sql;
    return false;
exception when others then
    return sqlerrm like '%' || p_texto || '%';
end $$;
create or replace function pg_temp.reg(p_id uuid, p_equipo uuid, p_atras integer, hi numeric, hf numeric, vi numeric, vf numeric, extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'motor_registro_diario', jsonb_build_object('equipo_id', p_equipo, 'fecha', pg_temp.dia(p_atras), 'fecha_hora', pg_temp.ts(p_atras),
        'horo_ini', hi, 'horo_fin', hf, 'visor_ini', vi, 'visor_fin', vf, 'rpm', 1450, 'caudal_ini', 10, 'caudal_fin', 12, 'operador', 'Operador Prueba') || extra, p_atras)
$$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T147_ADM', 'P147 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T147_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000014701', 'adm@147') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000014701', 'Admin 147', r, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000014701', r) on conflict do nothing;
    insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
    values ('QA-DIESEL-147', 'Diésel QA 147', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true) on conflict (codigo) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from estaciones_riego where activo and prueba_de is null and nombre <> 'Papalon-1' order by nombre limit 1) as est2,
    (select id from materiales where codigo = 'QA-DIESEL-147') as dsl,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000014701'::uuid as adm;
create or replace function pg_temp.bodega() returns numeric language sql as $$
    select coalesce((select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select dsl from k)), 0)
$$;

-- ---------------------------------------------------------------- 0 · estructura y siembra
select pg_temp.ok(to_regclass('public.mot_custodias') is not null and to_regclass('public.mot_tanque_historial') is not null, 'existen mot_custodias y mot_tanque_historial');
select pg_temp.ok((select count(*) = 5 from information_schema.columns where table_schema = 'public' and table_name = 'mot_registros'
                    and column_name in ('caudal_ini', 'caudal_fin', 'operador', 'dif_visor_gal', 'custodia_id')), 'mot_registros trae caudal, operador, diferencia del visor y tramo');
select pg_temp.ok(exists (select 1 from acciones where codigo = 'auditar') and (select 'auditar' = any(acciones) from pantallas where codigo = 'motores'),
                  'la acción «auditar» existe y está en la pantalla Motores');
select pg_temp.ok(not exists (select 1 from permisos where recurso = 'motores' and accion = 'auditar'), 'a ningún rol se le dio «auditar» por defecto');
select pg_temp.ok((select count(distinct public._mot_norm(nombre)) = 30 from mot_tanques
                    where activo and public._mot_norm(nombre) in (select public._mot_norm(x) from unnest(array[
                        'Carretales','Congolon','Tanque del Fertilizador Congolon','Embarcadero Rio','Embarcadero Pozo','Estiquirin','Vega','Vega Generador',
                        'Espino Laguna Pozo-1','Espino Laguna','Espino Laguna Pozo-2','Espino Mendez Laguna','Espino Mendez Pozo','Tololar','Papalon-1','Papalon-2',
                        'Papalon-3','Tanque Llenar Laguna Papalon','Tanque Generador Papalon','Teresa Cañera','Teresa Aguacate','Tanque Rio Estacion A','Rubio','Zamora',
                        'Tanque Bomba-4y5 Rio','Estacion-C','Glorieta','Tanque Gomez','Sierra Rio-1','Sierra Rio-2']) x)),
                  'los 30 tanques fijos existen (una vez cada uno)');
select pg_temp.ok(not exists (select 1 from mot_tanques where activo group by public._mot_norm(nombre) having count(*) > 1), 'no hay tanques activos con el mismo nombre');
select pg_temp.ok((select capacidad_gal = 600 from mot_tanques where activo and public._mot_norm(nombre) = 'papalon-1'), 'Papalon-1 tiene 600 gal');

-- ---------------------------------------------------------------- 1 · se publica un motor y se instala en el tanque Papalon-1
select pg_temp.como((select adm from k));
select fn_mot_publicar(jsonb_build_object('completo', false, 'material_diesel', 'QA-DIESEL-147',
    'motores', '[{"codigo":"T147-M1","nombre":"Motor 1 prueba 147","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":600}]'::jsonb));
create temp table m as select (select id from equipos where codigo = 'T147-M1') as m1;
do $$
declare v_est uuid := (select est from k);
begin
    perform pg_temp.como((select adm from k));
    -- el tanque Papalon-1 debe estar en la estación Papalon-1 (la siembra lo liga si el nombre coincide)
    perform fn_mot_tanque_asignar((select id from mot_tanques where activo and public._mot_norm(nombre) = 'papalon-1'), v_est, 'prueba 147');
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 147');
    end if;
    update fert_custodia set desde = now() - interval '30 days' where estacion_id = v_est;
    update fert_relevos set recibido_at = now() - interval '30 days', entregado_at = now() - interval '30 days'
    where id = (select id from fert_relevos where estacion_id = v_est and recibe_id = (select e1 from k)
                  and estado in ('RECIBIDO', 'ASIGNADO') order by recibido_at desc limit 1);
    update fert_relevos set estado = 'CANCELADO'
    where estacion_id = v_est and coalesce(recibido_at, entregado_at) > now() - interval '30 days' and estado <> 'CANCELADO';
end $$;
create temp table tk as select id as t from mot_tanques where activo and public._mot_norm(nombre) = 'papalon-1';
create temp table b0 as select pg_temp.bodega() as b;
create temp table i1 as select pg_temp.op(pg_temp.uid(1), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_id', (select t from tk),
    'horometro', 1000, 'diesel_gal', 100, 'horas_base', 0)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from i1), 'recibir el motor en el tanque fijo: ' || (select r::text from i1));
select pg_temp.ok((select motor_equipo_id = (select m1 from m) and estacion_id = (select est from k) from mot_tanques where id = (select t from tk)), 'el tanque queda conectado al motor y sigue en la estación');
select pg_temp.ok(public._mot_saldo_actual((select t from tk)) = 100, 'el diésel declarado al recibir queda como saldo del tanque (100)');
select pg_temp.ok((select count(*) = 1 and bool_and(ubicacion = 'ESTACION' and hasta is null and horo_entrada = 1000 and tanque_id = (select t from tk))
                     from mot_custodias where equipo_id = (select m1 from m)), 'se abrió UN tramo de custodia con horómetro de entrada 1000');
select pg_temp.ok(pg_temp.falla($f$select fn_fert_sincronizar('[]'::jsonb)$f$, 'xx_nunca') is false, 'harness ok');
select pg_temp.ok(((pg_temp.op(pg_temp.uid(2), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO', 'fecha_hora', pg_temp.ts(9),
    'estacion_destino', (select est from k), 'tanque_id', (select t from tk))))->>'estado') not like 'ACEPTADO%', 'no se puede instalar un motor ya instalado');

-- ---------------------------------------------------------------- 2 · registros diarios: gastado = visor inicial − final; el tanque baja por lo gastado
select pg_temp.como((select e1 from k));
create temp table ra as select pg_temp.reg(pg_temp.uid(11), (select m1 from m), 6, 1000, 1005, 100, 90) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from ra), 'día -6 aceptado: ' || (select r::text from ra));
select pg_temp.ok((select gastado_gal = 10 and rendimiento_gal_h = 2 and horas = 5 and caudal_ini = 10 and caudal_fin = 12 and operador = 'Operador Prueba' and rpm = 1450
                     from mot_registros where id = pg_temp.uid(11)), 'gastado 10, rendimiento 2, caudal y operador guardados');
select pg_temp.ok(public._mot_saldo_actual((select t from tk)) = 90, 'el tanque baja por lo gastado (100 → 90)');
select pg_temp.ok((select dif_visor_gal = 0 from mot_registros where id = pg_temp.uid(11)), 'sin diferencia contra el visor el primer día con saldo conocido');
select pg_temp.ok(pg_temp.bodega() = (select b from b0), 'la bodega de la estación no se movió');

-- recepción de diésel: va al TANQUE, no a la bodega
create temp table c1 as select pg_temp.op(pg_temp.uid(12), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 50,
    'fecha_hora', pg_temp.ts(4), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 4) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c1), 'recibir 50 gal en el tanque: ' || (select r::text from c1));
select pg_temp.ok(public._mot_saldo_actual((select t from tk)) = 140, 'el tanque sube a 140');
select pg_temp.ok(pg_temp.bodega() = (select b from b0), 'recibir diésel NO toca la bodega de la estación');
select pg_temp.ok(not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(12)), 'no hay movimiento de bodega de la recepción');
select pg_temp.ok((select tanque_id = (select t from tk) and galones = 50 from mot_recepciones where id = pg_temp.uid(12)), 'la recepción guarda el tanque');

create temp table rb as select pg_temp.reg(pg_temp.uid(13), (select m1 from m), 3, 1005, 1010, 140, 130) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from rb), 'día -3 aceptado: ' || (select r::text from rb));
select pg_temp.ok((select recibido_gal = 50 and gastado_gal = 10 and dif_visor_gal = 0 from mot_registros where id = pg_temp.uid(13)), 'el suministro del día sale de lo recibido y cuadra con el visor');
select pg_temp.ok(public._mot_saldo_actual((select t from tk)) = 130, 'saldo 130 tras el consumo');

-- el visor no cuadra: faltan 10 gal
create temp table rc as select pg_temp.reg(pg_temp.uid(14), (select m1 from m), 2, 1010, 1015, 120, 110) as r;
select pg_temp.ok((select dif_visor_gal = -10 from mot_registros where id = pg_temp.uid(14)), 'diferencia contra el libro: -10 gal');
select pg_temp.ok((select 'VISOR_MENOR_QUE_SALDO' = any(observaciones) from fert_operaciones where id = pg_temp.uid(14)), 'queda la observación VISOR_MENOR_QUE_SALDO');
select pg_temp.ok(public._mot_saldo_actual((select t from tk)) = 110, 'el tanque se realinea con el visor (110)');
select pg_temp.ok(exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(14) and tipo = 'AJUSTE_VISOR' and cantidad = -10), 'el ajuste es visible en el libro');

-- el horómetro retrocede
create temp table rd as select pg_temp.reg(pg_temp.uid(15), (select m1 from m), 1, 1000, 1004, 110, 106) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from rd), 'día -1 (horómetro retrocede) se acepta con observación: ' || (select r::text from rd));
select pg_temp.ok((select 'HOROMETRO_NO_CONTINUA' = any(observaciones) from fert_operaciones where id = pg_temp.uid(15)), 'observación HOROMETRO_NO_CONTINUA');
select pg_temp.ok((select horas_desde_mant = 19 from mot_motores where equipo_id = (select m1 from m)), 'las horas del mantenimiento suman 19 (5+5+5+4)');

-- el visor final no puede ser mayor que el inicial sin suministro (en línea)
select pg_temp.ok((select r->>'estado' not like 'ACEPTADO%' from (select pg_temp.reg(pg_temp.uid(16), (select m1 from m), 0, 1004, 1006, 100, 120) as r) z),
                  'visor final mayor que el inicial sin suministro: rechazado en línea');

-- ---------------------------------------------------------------- 3 · señales (ayudas visuales)
select pg_temp.como((select adm from k));
create temp table fi as select fn_mot_ficha_completa((select m1 from m)) as f;
select pg_temp.ok((select count(*) = 4 from jsonb_array_elements((select f->'registros' from fi))), 'la ficha trae los 4 registros con todos sus campos');
select pg_temp.ok((select bool_and(x ? 'caudal_ini' and x ? 'caudal_fin' and x ? 'operador' and x ? 'rpm' and x ? 'visor_ini' and x ? 'dif_visor_gal')
                     from jsonb_array_elements((select f->'registros' from fi)) x), 'cada registro lleva todos los campos de la hoja');
select pg_temp.ok(exists (select 1 from jsonb_array_elements((select f->'senales' from fi)) s where s->>'codigo' = 'HUECO_DIAS' and s->>'texto' like 'Faltan 2 día(s)%'),
                  'señal HUECO_DIAS: «Faltan 2 día(s) sin registro»');
select pg_temp.ok(exists (select 1 from jsonb_array_elements((select f->'senales' from fi)) s where s->>'codigo' = 'VISOR_FALTA' and s->>'nivel' = 'rojo'), 'señal VISOR_FALTA (rojo)');
select pg_temp.ok(exists (select 1 from jsonb_array_elements((select f->'senales' from fi)) s where s->>'codigo' = 'SALDO_FALTA' and s->>'texto' like '%faltan 10%'), 'señal SALDO_FALTA: faltan 10 gal');
select pg_temp.ok(exists (select 1 from jsonb_array_elements((select f->'senales' from fi)) s where s->>'codigo' = 'HORO_RETROCEDE' and s->>'nivel' = 'rojo'), 'señal HORO_RETROCEDE (rojo)');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements((select f->'senales' from fi)) s where s->>'codigo' = 'VISOR_FALTA' and (s->>'fecha')::date = pg_temp.hoy() - 3),
                  'el día con suministro registrado entre lecturas NO da falsa alarma de visor');

-- ---------------------------------------------------------------- 4 · semáforo de mantenimiento (por horómetro del motor)
select pg_temp.ok((select _mot_semaforo((select m1 from m))->>'nivel' = 'verde'), 'semáforo verde con 19 h de 500');
update mot_motores set horas_desde_mant = 460 where equipo_id = (select m1 from m);
select pg_temp.ok((select _mot_semaforo((select m1 from m))->>'nivel' = 'amarillo' and _mot_semaforo((select m1 from m))->>'texto' like 'Faltan 40%'), 'semáforo amarillo a 40 h del límite (aviso 50)');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(_mot_estado_motor((select m1 from m))->'ahora') x where x->>'codigo' = 'MANTENIMIENTO' and x->>'nivel' = 'amarillo'),
                  '«qué toca ahora» incluye el aviso de mantenimiento amarillo');
update mot_motores set horas_desde_mant = 505 where equipo_id = (select m1 from m);
select pg_temp.ok((select _mot_semaforo((select m1 from m))->>'nivel' = 'rojo' and _mot_semaforo((select m1 from m))->>'texto' like '%VENCIDO hace 5%'), 'semáforo rojo vencido hace 5 h');
update mot_motores set horas_desde_mant = 19 where equipo_id = (select m1 from m);
select pg_temp.ok((select (_mot_estado_motor((select m1 from m))->'registro'->>'nivel') = 'verde'), 'último registro de ayer: el estado de registro está al día (verde)');
select pg_temp.ok(jsonb_array_length((select _mot_estado_motor((select m1 from m))->'ahora')) = 0, 'sin pendientes, «qué toca ahora» viene vacío');

-- ---------------------------------------------------------------- 5 · mover el motor: el tanque se queda; historial por tramos
select pg_temp.como((select adm from k));
select fn_mot_tanque_guardar(jsonb_build_object('nombre', 'T147-TQ2', 'capacidad_gal', 200));
select fn_mot_tanque_asignar((select id from mot_tanques where nombre = 'T147-TQ2'), (select est2 from k), 'prueba 147');
create temp table mv as select pg_temp.op(pg_temp.uid(21), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'TRASLADADO',
    'fecha_hora', pg_temp.ts(0), 'estacion_destino', (select est2 from k), 'tanque_id', (select id from mot_tanques where nombre = 'T147-TQ2'),
    'motivo_codigo', 'CAMBIO_ESTACION', 'horometro', 1004)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from mv), 'traslado aceptado: ' || (select r::text from mv));
select pg_temp.ok((select estacion_id = (select est from k) and motor_equipo_id is null and public._mot_saldo_actual(id) = 106 from mot_tanques where id = (select t from tk)),
                  'el tanque Papalon-1 se queda en su estación, sin motor y con su saldo (106)');
select pg_temp.ok((select estacion_id = (select est2 from k) and tanque_id = (select id from mot_tanques where nombre = 'T147-TQ2') from mot_motores where equipo_id = (select m1 from m)),
                  'el motor ahora está en la estación destino con el tanque del destino');
select pg_temp.ok((select count(*) = 2 and count(*) filter (where hasta is null) = 1 from mot_custodias where equipo_id = (select m1 from m)), 'dos tramos: uno cerrado y uno abierto');
select pg_temp.ok((select horo_salida = 1004 and estacion_id = (select est from k) from mot_custodias where equipo_id = (select m1 from m) and hasta is not null), 'el tramo de Papalon-1 cerró con el horómetro de salida 1004');
select pg_temp.ok((select horo_entrada = 1004 and estacion_id = (select est2 from k) from mot_custodias where equipo_id = (select m1 from m) and hasta is null), 'el tramo nuevo abrió con el horómetro de entrada 1004');
-- lo registrado en el tramo anterior queda en SU estación: el destino no lo hereda (RLS y estado_campo filtran por estación del registro)
select pg_temp.ok(not exists (select 1 from mot_registros where equipo_id = (select m1 from m) and estacion_id = (select est2 from k)), 'ningún registro del tramo anterior pertenece a la estación destino');
select pg_temp.ok((select count(*) = 4 from mot_registros where equipo_id = (select m1 from m) and estacion_id = (select est from k) and anulado_at is null), 'los 4 registros siguen siendo de Papalon-1');
select pg_temp.ok((select (fn_mot_estado_campo()->'permisos'->>'auditar')::boolean), 'el administrador recibe permisos.auditar = true');
select pg_temp.ok(jsonb_array_length((select fn_mot_ficha_completa((select m1 from m))->'tramos')) = 2, 'la ficha completa del auditor trae los dos tramos');
select pg_temp.ok((select (t->>'registros')::int = 4 and (t->>'horas')::numeric = 19 and (t->>'gal_gastados')::numeric = 34
                     from jsonb_array_elements((select fn_mot_ficha_completa((select m1 from m))->'tramos' )) t where t->>'hasta' is not null),
                  'el resumen del tramo de Papalon-1: 4 registros, 19 h, 34 gal');
-- quien no audita no puede ver la ficha completa
select pg_temp.como((select e1 from k));
select pg_temp.ok(pg_temp.falla($f$select fn_mot_ficha_completa((select m1 from m))$f$, 'Auditar'), 'sin «Auditar» la ficha completa se rechaza');
select pg_temp.ok(pg_temp.falla($f$select fn_mot_tanque_guardar('{"nombre":"X147"}'::jsonb)$f$, 'Configurar') or pg_temp.falla($f$select fn_mot_tanque_guardar('{"nombre":"X147"}'::jsonb)$f$, 'configurar'),
                  'sin «Configurar» no se crean tanques');

-- ---------------------------------------------------------------- 6 · anular el traslado reabre el tramo anterior y reconecta el tanque
select pg_temp.como((select adm from k));
create temp table an as select pg_temp.op(pg_temp.uid(22), 'anulacion', jsonb_build_object('documento_tipo', 'motor_asignacion', 'documento_id', pg_temp.uid(21),
    'motivo', 'Prueba 147: se anula el traslado')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an), 'anulación aceptada: ' || (select r::text from an));
select pg_temp.ok((select count(*) = 1 and bool_and(hasta is null and estacion_id = (select est from k)) from mot_custodias where equipo_id = (select m1 from m)), 'queda un solo tramo, abierto, en Papalon-1');
select pg_temp.ok((select motor_equipo_id = (select m1 from m) from mot_tanques where id = (select t from tk)), 'el tanque Papalon-1 vuelve a estar conectado al motor');

-- ---------------------------------------------------------------- 7 · modo de pruebas (145) sigue aislado
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_mot_tanques_listar()) x where x->>'nombre' like 'PRUEBA-T-%'), 'la lista de tanques no muestra los de práctica');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_mot_catalogo_para_agl()->'tanques') x where x->>'nombre' like 'PRUEBA-T-%'), 'AGL no recibe tanques de práctica');
select pg_temp.ok(not exists (select 1 from mot_tanques t join estaciones_riego e on e.id = t.estacion_id where e.prueba_de is not null and t.nombre not like 'PRUEBA-T-%'),
                  'ningún tanque real quedó asignado a una estación de prueba');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_mot_motores_resumen()) x where x->>'codigo' like 'PRUEBA-M-%'), 'el resumen del auditor no lista motores de práctica');

-- ---------------------------------------------------------------- 8 · limpieza de lo creado por la prueba
do $$
begin
    perform set_config('mot.libro_permitir', 'on', true);
    perform set_config('fert.libro_permitir', 'on', true);
end $$;
\echo 'FIN pruebas 147 (el usuario/Opus debe revisar que no haya FALLA). Los datos T147-* quedan en la réplica de pruebas.'
