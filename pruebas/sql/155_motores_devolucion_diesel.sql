-- =====================================================================
-- PRUEBAS de sql/155 · Motores: devolver diésel del tanque a bodega (igual que la devolución de Fertirriego)
-- Réplica local con 91–155 y los datos de prueba de 96/99/115 (estación Papalon-1, e1 = estacionero, chofer 10000000-...-0001).
-- Correr DESDE LA RAÍZ DEL REPO con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/155_motores_devolucion_diesel.sql
-- Autosuficiente (crea su admin, su vehículo con tipo, diésel y motor T155-M1). ESCRITA, NO ejecutada (la corre Opus).
-- Órdenes a probar: 155 > 155 (bloque 7), 153 > 155 y 147 > 148 > 149 > 150 > 153 > 155 (bloque 7).
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('155a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.dia(p_atras integer) returns text language sql as $$ select (pg_temp.hoy() - p_atras)::text $$;
create or replace function pg_temp.ts(p_atras integer, p_hora time default time '12:00') returns text language sql as $$
    select case when p_atras = 0 then least(((pg_temp.hoy())::timestamp + p_hora) at time zone 'America/Tegucigalpa', now() - interval '2 minutes')::text
                else ((pg_temp.hoy() - p_atras)::timestamp + p_hora)::text || '-06' end $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T155_ADM', 'P155 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T155_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000015501', 'adm@155') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000015501', 'Admin 155', r, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000015501', r) on conflict do nothing;
    insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
    values ('QA-DIESEL-155', 'Diésel QA 155', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true) on conflict (codigo) do nothing;
    insert into fert_vehiculos (id, placa, tipo) values ('155a0000-0000-4000-8000-000000000901', 'T155-PICK', 'Pick-up') on conflict (id) do nothing;
    insert into fert_vehiculos (id, placa, tipo) values ('155a0000-0000-4000-8000-000000000902', 'T155-SINTIPO', null) on conflict (id) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000015501'::uuid as adm,
    '10000000-0000-0000-0000-000000000001'::uuid as chofer,
    '155a0000-0000-4000-8000-000000000901'::uuid as veh,
    '155a0000-0000-4000-8000-000000000902'::uuid as veh_sin_tipo;

-- ---------------------------------------------------------------- 0 · estructura y parches
select pg_temp.ok(to_regclass('public.mot_devoluciones') is not null, 'existe mot_devoluciones');
select pg_temp.ok(to_regprocedure('public._mot_op_diesel_devolver(uuid,jsonb,timestamptz,boolean,uuid)') is not null
              and to_regprocedure('public._mot_op_anulacion_devolucion(uuid,jsonb,timestamptz,boolean)') is not null, 'existen las dos operaciones');
select pg_temp.ok(position('155:devoluciones' in pg_get_functiondef('public.fn_mot_estado_campo(date)'::regprocedure)) > 0
              and position('155:realinear' in pg_get_functiondef('public._mot_realinear_tanque(uuid,uuid)'::regprocedure)) > 0
              and position('155:senales' in pg_get_functiondef('public._mot_senales(uuid[],date,date)'::regprocedure)) > 0
              and position('155:filas' in pg_get_functiondef('public._mot_filas(uuid[])'::regprocedure)) > 0
              and position('155:confirmar' in pg_get_functiondef('public.fn_mot_confirmar_bajada(jsonb)'::regprocedure)) > 0
              and position('155:purgar' in pg_get_functiondef('public.fn_mot_purgar_bajadas(jsonb)'::regprocedure)) > 0,
                  'los parches 155 están puestos');

-- ---------------------------------------------------------------- 1 · motor con tanque y custodia (igual que la prueba 153)
select pg_temp.como((select adm from k));
select fn_mot_publicar(jsonb_build_object('completo', false, 'material_diesel', 'QA-DIESEL-155',
    'motores', '[{"codigo":"T155-M1","nombre":"Motor 1 prueba 155","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300}]'::jsonb));
create temp table m as select (select id from equipos where codigo = 'T155-M1') as m1;
do $$
declare v_est uuid := (select est from k);
begin
    perform pg_temp.como((select adm from k));
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 155');
    end if;
    update fert_custodia set desde = now() - interval '30 days' where estacion_id = v_est;
end $$;
create temp table i1 as select pg_temp.op(pg_temp.uid(1), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque M1 155', 'capacidad_gal', 300),
    'motivo', 'Inicio', 'motivo_codigo', 'OTRO', 'horas_base', 0)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from i1), 'instalar el motor con su tanque: ' || (select r::text from i1));
create temp table tk as select tanque_id as t from mot_motores where equipo_id = (select m1 from m);
create or replace function pg_temp.saldo() returns numeric language sql as $$
    select coalesce((select disponible from mot_saldos where tanque_id = (select t from tk)), 0) $$;
create or replace function pg_temp.suma_libro() returns numeric language sql as $$
    select coalesce((select sum(cantidad) from mot_movimientos where tanque_id = (select t from tk)), 0) $$;
create or replace function pg_temp.dev(p_id integer, p_gal numeric, p_atras integer, p_extra jsonb default '{}'::jsonb, p_hora time default time '18:00') returns jsonb language sql as $$
    select pg_temp.op(pg_temp.uid(p_id), 'diesel_devolver', jsonb_build_object('estacion_id', (select est from k), 'tanque_id', (select t from tk),
        'galones', p_gal, 'fecha_hora', pg_temp.ts(p_atras, p_hora), 'destino', 'BODEGA', 'motivo', 'Fin de temporada',
        'chofer_id', (select chofer from k), 'vehiculo_id', (select veh from k)) || p_extra, p_atras) $$;

-- 100 gal el día -6, registro el día -5 (100 → 90)
select pg_temp.como((select e1 from k));
create temp table c1 as select pg_temp.op(pg_temp.uid(11), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 100,
    'fecha_hora', pg_temp.ts(6), 'chofer_id', (select chofer from k)), 6) as r;
create temp table r1 as select pg_temp.op(pg_temp.uid(21), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(5),
    'fecha_hora', pg_temp.ts(5), 'horo_ini', 100, 'horo_fin', 110, 'visor_ini', 100, 'visor_fin', 90), 5) as a;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c1) and (select a->>'estado' like 'ACEPTADO%' from r1) and pg_temp.saldo() = 90,
                  'recepción 100 y registro 100→90: saldo 90');

-- ---------------------------------------------------------------- 2 · validaciones (todo con detalle, como Fertirriego)
create temp table v1 as select pg_temp.dev(31, 500, 4) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%solo hay%' from v1), 'no se devuelve más de lo que hay: ' || (select r::text from v1));
create temp table v2 as select pg_temp.dev(32, 10, 4, jsonb_build_object('destino', 'CASA')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%suministros, bodega o taller%' from v2), 'destino fuera de la lista: rechazado');
create temp table v3 as select pg_temp.dev(33, 10, 4, jsonb_build_object('chofer_id', null)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%quién retiró%' from v3), 'sin chofer: rechazado');
create temp table v4 as select pg_temp.dev(34, 10, 4, jsonb_build_object('vehiculo_id', (select veh_sin_tipo from k))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%no tiene tipo%' from v4), 'vehículo sin tipo en el catálogo: rechazado');
create temp table v5 as select pg_temp.dev(35, 10, 4, jsonb_build_object('motivo', '  ')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%motivo%' from v5), 'sin motivo: rechazado');
select pg_temp.ok(pg_temp.saldo() = 90 and not exists (select 1 from mot_devoluciones where id in (pg_temp.uid(31), pg_temp.uid(32), pg_temp.uid(33), pg_temp.uid(34), pg_temp.uid(35))),
                  'los rechazos no dejan nada');

-- ---------------------------------------------------------------- 3 · devolver 30 gal el día -4 (sin registros después)
create temp table d1 as select pg_temp.dev(41, 30, 4) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from d1), 'devolver 30 gal a bodega: ' || (select r::text from d1));
select pg_temp.ok(pg_temp.saldo() = 60 and pg_temp.saldo() = pg_temp.suma_libro(), 'el tanque baja a 60 y el saldo = suma del libro');
select pg_temp.ok((select saldo_antes = 90 and saldo_despues = 60 and destino = 'BODEGA' and chofer_nombre is not null and vehiculo_placa = 'T155-PICK'
                          and vehiculo_tipo = 'Pick-up' and registrado_por = (select e1 from k) and material_id is not null
                     from mot_devoluciones where id = pg_temp.uid(41)), 'queda el detalle: saldo antes/después, destino, quién, vehículo y tipo');
select pg_temp.ok(exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(41) and tipo = 'DEVOLUCION_TANQUE' and cantidad = -30
                          and documento_tipo = 'diesel_devolucion'), 'movimiento DEVOLUCION_TANQUE de −30 en el libro del tanque');
select pg_temp.ok((select estacion_id = (select est from k) and lat is not null from fert_operaciones where id = pg_temp.uid(41)), 'la operación guarda estación y GPS');
select pg_temp.ok(exists (select 1 from fert_choferes_vehiculos where chofer_id = (select chofer from k) and vehiculo_id = (select veh from k)), 'aprende la pareja chofer-vehículo');
select pg_temp.ok((select o->>'estado' like 'ACEPTADO%' or o->>'estado' = 'YA_EXISTIA' from (select pg_temp.dev(41, 30, 4) as o) z) and pg_temp.saldo() = 60,
                  'reenviar la misma operación (mismo id) no descuenta dos veces');

-- el registro del día -3 empieza en 60: sin señal de visor
create temp table r2 as select pg_temp.op(pg_temp.uid(22), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(3),
    'fecha_hora', pg_temp.ts(3), 'horo_ini', 110, 'horo_fin', 120, 'visor_ini', 60, 'visor_fin', 50), 3) as a;
select pg_temp.ok((select a->>'estado' like 'ACEPTADO%' from r2) and pg_temp.saldo() = 50, 'registro del día -3 (60 → 50): saldo 50');
select pg_temp.ok(not exists (select 1 from public._mot_senales(array[(select m1 from m)], null, null) s where s.registro_id = pg_temp.uid(22) and s.codigo in ('VISOR_FALTA', 'VISOR_SOBRA')),
                  'la devolución explica la bajada del visor (sin VISOR_FALTA)');

-- ---------------------------------------------------------------- 4 · devolución el MISMO día del último registro (después de sus lecturas) y tardía
create temp table d2 as select pg_temp.dev(42, 20, 3) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from d2) and pg_temp.saldo() = 30, 'devolver 20 el mismo día del registro: saldo 30');
select pg_temp.ok(public._mot_realinear_tanque((select t from tk)) = 0 and pg_temp.saldo() = 30, 'realinear no la deshace (va después de las lecturas del día)');
-- devolución registrada TARDE (día -5, ya hay registro del día -3): el visor manda, el tanque no se mueve de más
create temp table d3 as select pg_temp.dev(43, 5, 5) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from d3), 'devolución tardía aceptada: ' || (select r::text from d3));
select pg_temp.ok(pg_temp.saldo() = 30 and pg_temp.saldo() = pg_temp.suma_libro(), 'tardía: el tanque se realinea con el visor (sigue en 30)');

-- ---------------------------------------------------------------- 5 · anular
create temp table a1 as select pg_temp.op(pg_temp.uid(51), 'anulacion', jsonb_build_object('estacion_id', (select est from k), 'documento_tipo', 'diesel_devolucion',
    'documento_id', pg_temp.uid(42), 'motivo', 'Se registró por error'), 0) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from a1), 'el autor anula su devolución en su jornada: ' || (select r::text from a1));
select pg_temp.ok(pg_temp.saldo() = 50 and pg_temp.saldo() = pg_temp.suma_libro(), 'al anular vuelve el diésel al tanque (50)');
select pg_temp.ok((select anulado_at is not null and anulado_por = (select e1 from k) and motivo_anulacion = 'Se registró por error' from mot_devoluciones where id = pg_temp.uid(42)),
                  'queda quién anuló y por qué');
create temp table a2 as select pg_temp.op(pg_temp.uid(52), 'anulacion', jsonb_build_object('estacion_id', (select est from k), 'documento_tipo', 'diesel_devolucion',
    'documento_id', pg_temp.uid(42), 'motivo', 'Otra vez'), 0) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%ya estaba anulado%' from a2), 'anular dos veces: rechazado');
create temp table a3 as select pg_temp.op(pg_temp.uid(53), 'anulacion', jsonb_build_object('estacion_id', (select est from k), 'documento_tipo', 'diesel_devolucion',
    'documento_id', pg_temp.uid(41), 'motivo', ''), 0) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%motivo%' from a3), 'anular sin motivo: rechazado');

-- ---------------------------------------------------------------- 6 · teléfono y AGL
select pg_temp.como((select e1 from k));
select pg_temp.ok((select count(*) >= 3 from jsonb_array_elements(public.fn_mot_estado_campo()->'devoluciones') x where x->>'tanque_id' = (select t from tk)::text),
                  'fn_mot_estado_campo trae las devoluciones del tanque');
select pg_temp.ok((select x->>'registrado_por_nombre' is not null and x->>'chofer' is not null and (x->>'saldo_antes')::numeric = 90
                     from jsonb_array_elements(public.fn_mot_estado_campo()->'devoluciones') x where x->>'id' = pg_temp.uid(41)::text),
                  'cada devolución baja con nombres y saldo antes');
select pg_temp.ok(exists (select 1 from public._mot_filas() f where f.tabla = 'devolucion' and f.id = pg_temp.uid(41) and f.cursor = 'd|' || pg_temp.uid(41)::text
                          and f.fila->>'destino' = 'BODEGA' and f.huella = public._mot_huella(f.fila)), 'la bajada a AGL trae la fila «devolucion» con su huella');
select pg_temp.ok(exists (select 1 from public._mot_filas() f where f.tabla = 'movimiento' and (f.fila->>'documento_id')::uuid = pg_temp.uid(41)),
                  'el asiento DEVOLUCION_TANQUE sigue bajando (cuadre de AGL)');
-- confirmar como lo hace AGL (lote de una fila)
select pg_temp.como((select adm from k));
create temp table bj as select f.cursor, f.id, f.huella from public._mot_filas() f where f.tabla = 'devolucion' and f.id = pg_temp.uid(41);
select pg_temp.ok((select jsonb_array_length(public.fn_mot_confirmar_bajada(jsonb_build_object(
        'lote', (select jsonb_agg(jsonb_build_object('cursor', cursor, 'id', id, 'huella', huella)) from bj), 'cuantos', 1,
        'sha256_lote', (select encode(sha256(convert_to(huella, 'UTF8')), 'hex') from bj)))->'confirmadas') = 1),
                  'AGL confirma la devolución');
select pg_temp.ok((select bajado_a_agl_en is not null and huella is not null from mot_devoluciones where id = pg_temp.uid(41)), 'queda marcada como bajada');
select pg_temp.ok(public.fn_mot_purgar_bajadas('{"limite": 10}'::jsonb) ? 'devoluciones', 'la purga informa el conteo de devoluciones');

-- ---------------------------------------------------------------- 7 · idempotencia y órdenes
create temp table h0 as select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) as h
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('_fert_procesar', 'fn_mot_estado_campo', '_mot_realinear_tanque', '_mot_senales', '_mot_filas', 'fn_mot_confirmar_bajada',
                     'fn_mot_purgar_bajadas', '_mot_op_diesel_devolver', '_mot_op_anulacion_devolucion', '_mot_devoluciones_json');
\i sql/155_motores_devolucion_diesel.sql
select pg_temp.ok((select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('_fert_procesar', 'fn_mot_estado_campo', '_mot_realinear_tanque', '_mot_senales', '_mot_filas', 'fn_mot_confirmar_bajada',
                                     'fn_mot_purgar_bajadas', '_mot_op_diesel_devolver', '_mot_op_anulacion_devolucion', '_mot_devoluciones_json')) = (select h from h0),
                  'correr la 155 otra vez no cambia ninguna función (idempotente)');
\i sql/153_motores_integridad.sql
\i sql/155_motores_devolucion_diesel.sql
select pg_temp.ok(position('155:realinear' in pg_get_functiondef('public._mot_realinear_tanque(uuid,uuid)'::regprocedure)) > 0, 'orden 153 > 155: el parche del realineo vuelve');
\i sql/147_motores_tanques_custodia.sql
\i sql/148_motores_recepciones_recientes.sql
\i sql/149_motores_general_temporada.sql
\i sql/150_motores_correcciones.sql
\i sql/153_motores_integridad.sql
\i sql/155_motores_devolucion_diesel.sql
select pg_temp.ok((select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('_fert_procesar', 'fn_mot_estado_campo', '_mot_realinear_tanque', '_mot_senales', '_mot_filas', 'fn_mot_confirmar_bajada',
                                     'fn_mot_purgar_bajadas', '_mot_op_diesel_devolver', '_mot_op_anulacion_devolucion', '_mot_devoluciones_json')) = (select h from h0),
                  'orden 147 > 148 > 149 > 150 > 153 > 155: las funciones quedan iguales');

\echo 'PRUEBAS 155 TERMINADAS'
