-- =====================================================================
-- PRUEBAS de sql/144 (actualizada a las reglas de la sql/147) · el diésel NO pasa por la bodega: entra al TANQUE
-- Réplica local con 91–147 (y 148–153 si existen; las aserciones del saldo valen con y sin 150/153) y los datos de prueba de
-- 96/99/115 (estación Papalon-1, e1 = estacionero, chofer 10000000-...-0001).
-- Correr DESDE LA RAÍZ DEL REPO con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/144_diesel_bodega.sql
-- Autosuficiente (crea su propio admin, diésel y motor T144-M1). NO ejecutada todavía (la corre Opus).
-- Reglas de la 147 que verifica (la 144 original decía lo contrario): recibir diésel entra al tanque y NO toca la bodega; el
-- suministro declarado en el registro diario sube el tanque y NO rebaja la bodega; gastado = visor inicial − visor final;
-- anular/eliminar revierte solo el libro del tanque; el diésel que quedó en la bodega se etiqueta DIESEL_LEGADO.
-- Órdenes a probar después: la cadena completa 147 > 148 > 149 > 150 > 153 (el bloque 6 la repite y compara las funciones).
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('144a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
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
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T144_ADM', 'P144 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T144_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000014401', 'adm@144') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000014401', 'Admin 144', r, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000014401', r) on conflict do nothing;
    insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
    values ('QA-DIESEL-144', 'Diésel QA 144', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true) on conflict (codigo) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-DIESEL-144') as dsl,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000014401'::uuid as adm;
create or replace function pg_temp.bodega() returns numeric language sql as $$
    select coalesce((select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select dsl from k)), 0)
$$;

-- ---------------------------------------------------------------- 0 · estructura
select pg_temp.ok((select pg_get_constraintdef(c.oid) like '%SUMINISTRO%' from pg_constraint c where c.conrelid = 'public.mot_movimientos'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%RECEPCION_DIESEL%'),
                  'el libro del tanque admite SUMINISTRO');
select pg_temp.ok(position('147:diesel-tanque' in pg_get_functiondef('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) > 0,
                  'recibir diésel es el de la 147 (entra al tanque)');

-- ---------------------------------------------------------------- 1 · AGL publica diésel y un motor; se instala con tanque
select pg_temp.como((select adm from k));
select fn_mot_publicar(jsonb_build_object('completo', false, 'material_diesel', 'QA-DIESEL-144',
    'motores', '[{"codigo":"T144-M1","nombre":"Motor 1 prueba 144","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300}]'::jsonb));
create temp table m as select (select id from equipos where codigo = 'T144-M1') as m1;
do $$
declare v_est uuid := (select est from k);
begin
    perform pg_temp.como((select adm from k));
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 144');
    end if;
    update fert_custodia set desde = now() - interval '30 days' where estacion_id = v_est;
    update fert_relevos set recibido_at = now() - interval '30 days', entregado_at = now() - interval '30 days'
    where id = (select id from fert_relevos where estacion_id = v_est and recibe_id = (select e1 from k)
                  and estado in ('RECIBIDO', 'ASIGNADO') order by recibido_at desc limit 1);
    update fert_relevos set estado = 'CANCELADO'
    where estacion_id = v_est and coalesce(recibido_at, entregado_at) > now() - interval '30 days' and estado <> 'CANCELADO';
end $$;
create temp table i1 as select pg_temp.op(pg_temp.uid(1), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque M1 144', 'capacidad_gal', 300),
    'motivo', 'Inicio', 'motivo_codigo', 'OTRO', 'horas_base', 0)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from i1), 'instalar el motor con su tanque: ' || (select r::text from i1));
create temp table tk as select tanque_id as t from mot_motores where equipo_id = (select m1 from m);
create or replace function pg_temp.saldo() returns numeric language sql as $$
    select coalesce((select disponible from mot_saldos where tanque_id = (select t from tk)), 0) $$;
create temp table b0 as select pg_temp.bodega() as b;

-- ---------------------------------------------------------------- 2 · recibir diésel = al TANQUE (no a la bodega)
select pg_temp.como((select e1 from k));
create temp table c1 as select pg_temp.op(pg_temp.uid(11), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 100,
    'fecha_hora', pg_temp.ts(4), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 4) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c1), 'recibir 100 gal en el tanque: ' || (select r::text from c1));
select pg_temp.ok(pg_temp.saldo() = 100, 'el tanque del motor sube 100');
select pg_temp.ok(pg_temp.bodega() = (select b from b0), 'la bodega de la estación NO se mueve con el diésel');
select pg_temp.ok(not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(11)), 'no hay movimiento en el libro de la bodega');
select pg_temp.ok((select count(*) = 1 and bool_and(tipo = 'RECEPCION_DIESEL' and cantidad = 100) from mot_movimientos where documento_id = pg_temp.uid(11)), 'un movimiento RECEPCION_DIESEL en el libro del tanque');
select pg_temp.ok((select tanque_id = (select t from tk) and estacion_id = (select est from k) and galones = 100 from mot_recepciones where id = pg_temp.uid(11)), 'mot_recepciones guarda el tanque y la estación');
create temp table c2 as select pg_temp.op(pg_temp.uid(12), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 20, 'fecha_hora', pg_temp.ts(4)), 4) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c2) and pg_temp.saldo() = 120, 'otra recepción de 20 gal al mismo tanque: saldo 120');
-- un envío con solo la estación (sin tanque): si la estación tiene VARIOS tanques activos se pide elegir (con uno solo entraría a ese)
create temp table c2b as select case when (select count(*) from mot_tanques where estacion_id = (select est from k) and activo) > 1
                                     then pg_temp.op(pg_temp.uid(15), 'diesel_recibir', jsonb_build_object('estacion_id', (select est from k), 'galones', 1, 'fecha_hora', pg_temp.ts(4)), 4) end as r;
select pg_temp.ok((select r is null or (r->>'estado' = 'RECHAZADO' and r::text like '%varios tanques%') from c2b) and pg_temp.saldo() = 120,
                  'solo la estación con varios tanques: rechazado pidiendo elegir y el tanque no se mueve');
-- sin galones
create temp table c3 as select pg_temp.op(pg_temp.uid(13), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 0), 0) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%galones%' from c3), 'sin galones: rechazado');
-- sin tanque ni estación
create temp table c4 as select pg_temp.op(pg_temp.uid(14), 'diesel_recibir', jsonb_build_object('galones', 5), 0) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%tanque%' from c4), 'sin tanque ni estación: rechazado con el mensaje del tanque');

-- ---------------------------------------------------------------- 3 · registro diario: el suministro sube el tanque y NO rebaja la bodega
-- primer registro: visor 120 → 100 (gasta 20); el tanque queda en el visor final
create temp table r1 as select pg_temp.op(pg_temp.uid(21), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(3),
    'fecha_hora', pg_temp.ts(3), 'horo_ini', 100, 'horo_fin', 110, 'visor_ini', 120, 'visor_fin', 100), 3) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r1), 'primer registro (visor 120 → 100, gasta 20): ' || (select r::text from r1));
select pg_temp.ok(pg_temp.saldo() = 100, 'el tanque queda en el visor final (100)');
-- el visor inicial incluye el suministro de ese día: 100 + 40 = 140; visor final 80: gastado = 140 − 80 = 60 (la hoja)
create temp table r2 as select pg_temp.op(pg_temp.uid(22), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(2),
    'fecha_hora', pg_temp.ts(2), 'horo_ini', 110, 'horo_fin', 120, 'visor_ini', 140, 'visor_fin', 80, 'suministro_gal', 40), 2) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r2), 'registro con suministro 40: ' || (select r::text from r2));
select pg_temp.ok((select recibido_gal = 40 and gastado_gal = 60 and rendimiento_gal_h = 6 from mot_registros where id = pg_temp.uid(22)), 'recibido = suministro 40; gastado 60 (visor inicial − final); rendimiento 6 gal/h');
select pg_temp.ok(pg_temp.bodega() = (select b from b0), 'la bodega NO baja por el suministro');
select pg_temp.ok(not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(22)), 'el registro no deja movimientos en la bodega');
select pg_temp.ok(pg_temp.saldo() = 80, 'el tanque queda en el visor final (80)');
select pg_temp.ok(exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(22) and tipo = 'SUMINISTRO' and cantidad = 40), 'SUMINISTRO +40 en el libro del tanque');
-- mismo UUID dos veces: no duplica
select pg_temp.op(pg_temp.uid(22), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(2),
    'fecha_hora', pg_temp.ts(2), 'horo_ini', 110, 'horo_fin', 120, 'visor_ini', 140, 'visor_fin', 80, 'suministro_gal', 40), 2);
select pg_temp.ok(pg_temp.saldo() = 80 and (select count(*) = 1 from mot_movimientos where documento_id = pg_temp.uid(22) and tipo = 'SUMINISTRO'),
                  'mismo UUID dos veces: el tanque no se mueve otra vez');
-- el visor sube sin suministro, en línea: error con el mensaje de la 147
create temp table r3 as select pg_temp.op(pg_temp.uid(23), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(1),
    'fecha_hora', pg_temp.ts(1), 'horo_ini', 120, 'horo_fin', 130, 'visor_ini', 80, 'visor_fin', 115)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%anota el suministro%' from r3), 'visor sube sin suministro: rechazado con el mensaje de suministro');
-- el visor sube con suministro: gastado = 80 + 40 − 115 = 5 y el tanque sigue al visor (115); la bodega sigue intacta
create temp table r4 as select pg_temp.op(pg_temp.uid(24), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(1),
    'fecha_hora', pg_temp.ts(1), 'horo_ini', 120, 'horo_fin', 130, 'visor_ini', 80, 'visor_fin', 115, 'suministro_gal', 40)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%SUMINISTRO_DURANTE_DIA%' from r4) and (select gastado_gal = 5 from mot_registros where id = pg_temp.uid(24)),
                  'entró diésel durante el día: gastado 5 con SUMINISTRO_DURANTE_DIA: ' || (select r::text from r4));
select pg_temp.ok(pg_temp.saldo() = 115 and pg_temp.bodega() = (select b from b0), 'el tanque queda en 115 y la bodega intacta (aunque el suministro sea mayor que lo que haya en la bodega)');
-- anular ese registro revierte solo el libro del tanque
select pg_temp.como((select adm from k));
create temp table an0 as select pg_temp.op(pg_temp.uid(26), 'anulacion', jsonb_build_object('documento_tipo', 'motor_registro', 'documento_id', pg_temp.uid(24), 'motivo', 'error de prueba'), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an0) and pg_temp.saldo() = 80 and pg_temp.bodega() = (select b from b0),
                  'anular el registro con suministro: el tanque vuelve a 80 y la bodega sigue intacta');
select pg_temp.ok((select coalesce(sum(cantidad), 0) = 0 from mot_movimientos where documento_id = pg_temp.uid(24)), 'el libro del tanque queda neto 0 para ese registro (original + anulación)');

-- ---------------------------------------------------------------- 4 · anular y eliminar
create temp table an2 as select pg_temp.op(pg_temp.uid(32), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(12), 'motivo', 'recepción duplicada'), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an2) and (select anulado_at is not null from mot_recepciones where id = pg_temp.uid(12)) and pg_temp.bodega() = (select b from b0),
                  'anular una recepción de diésel: solo el tanque se mueve (bodega intacta)');
select pg_temp.ok(pg_temp.saldo() in (60, 80), 'tras anular la recepción de 20 el tanque queda en 60 (sin la 153) o se realinea con el visor en 80 (con la 153)');
create temp table an1 as select pg_temp.op(pg_temp.uid(31), 'anulacion', jsonb_build_object('documento_tipo', 'motor_registro', 'documento_id', pg_temp.uid(21), 'motivo', 'se registró mal'), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an1) and pg_temp.bodega() = (select b from b0), 'anular el primer registro: la bodega no se toca');
-- eliminar por completo: un registro de hoy con suministro 30 (visor 80 → 85: gastado 80 + 30 − 85 = 25)
select pg_temp.como((select e1 from k));
create temp table r6b as select pg_temp.op(pg_temp.uid(42), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(0),
    'fecha_hora', pg_temp.ts(0), 'horo_ini', 120, 'horo_fin', 130, 'visor_ini', 80, 'visor_fin', 85, 'suministro_gal', 30)) as r;
select pg_temp.como((select adm from k));
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r6b) and pg_temp.bodega() = (select b from b0), 'registro de hoy con suministro 30: aceptado y la bodega intacta: ' || (select r::text from r6b));
select fn_campo_eliminar_documento('mot_registro', pg_temp.uid(42), 'Se eliminó por error de captura');
select pg_temp.ok(not exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(42)) and not exists (select 1 from mot_registros where id = pg_temp.uid(42)) and pg_temp.bodega() = (select b from b0),
                  'eliminar por completo el registro: el libro no conserva el movimiento y la bodega sigue intacta');
select fn_campo_eliminar_documento('mot_recepcion', pg_temp.uid(11), 'Recepción registrada por error de prueba');
select pg_temp.ok(not exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(11)) and not exists (select 1 from mot_recepciones where id = pg_temp.uid(11)) and pg_temp.bodega() = (select b from b0),
                  'eliminar por completo la recepción: sale del libro del tanque y la bodega no cambia');

-- ---------------------------------------------------------------- 5 · bodega general: el diésel NO es un producto de la bodega
select pg_temp.como((select e1 from k));
create temp table c9 as select pg_temp.op(pg_temp.uid(51), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 75,
    'fecha_hora', pg_temp.ts(0), 'chofer_id', '10000000-0000-0000-0000-000000000001')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c9), 'recibir 75 gal en el tanque para la prueba de la bodega general');
create temp table bg as select fn_fert_bodega_general() as r;
select pg_temp.ok((select (r->>'material_diesel_id')::uuid = (select dsl from k) from bg), 'la bodega general trae material_diesel_id');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(r->'filas') x(v) where v->>'tipo' = 'DIESEL') from bg),
                  'bodega general: ninguna fila es de tipo DIESEL (el diésel vive en el tanque; lo que quedó en la bodega sale como DIESEL_LEGADO)');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(r->'filas') x(v) where (v->>'material_id')::uuid = (select dsl from k) and (v->>'estacion_id')::uuid = (select est from k)
                                      and (v->>'saldo')::numeric <> pg_temp.bodega()) from bg),
                  'bodega general: si el diésel aparece en la estación, su saldo es el de la bodega (no el del tanque)');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(r->'filas') x(v) where (v->>'clave')::text = (select t::text from tk)) from bg),
                  'bodega general: el tanque del motor no se lista como bodega');

-- ---------------------------------------------------------------- 6 · idempotencia y orden (147 > 148 > 149 > 150 > 153 deja las funciones iguales)
create temp table h0 as select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) as h
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_registro_diario', '_mot_op_anulacion', 'fn_campo_eliminar_documento', 'fn_fert_bodega_general');
\i sql/147_motores_tanques_custodia.sql
\i sql/148_motores_recepciones_recientes.sql
\i sql/149_motores_general_temporada.sql
\i sql/150_motores_correcciones.sql
\i sql/153_motores_integridad.sql
select pg_temp.ok((select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('_mot_op_diesel_recibir', '_mot_op_registro_diario', '_mot_op_anulacion', 'fn_campo_eliminar_documento', 'fn_fert_bodega_general')) = (select h from h0),
                  'volver a correr 147 > 148 > 149 > 150 > 153 no cambia ninguna función (idempotente)');

\echo 'PRUEBAS 144 TERMINADAS'
