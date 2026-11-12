-- =====================================================================
-- PRUEBAS de sql/91_fertirriego_base.sql · SOLO EN LA RÉPLICA LOCAL (crea usuarios y roles de prueba)
-- =====================================================================
-- Uso (réplica en el puerto 5499, base copiada de «qa»):
--   psql -h localhost -p 5499 -U postgres -d fert_qa -X -v ON_ERROR_STOP=1 -f sql/91_fertirriego_base.sql
--   psql -h localhost -p 5499 -U postgres -d fert_qa -X -v ON_ERROR_STOP=1 -f pruebas/sql/91_fertirriego.sql
-- Cada prueba que falla detiene el script con «FALLA: …». Al final imprime «TODAS LAS PRUEBAS OK».
-- =====================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- auth.uid() de la réplica lee el usuario simulado
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function pg_temp.como(p uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false) $$;

create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
    if p_cond is distinct from true then
        raise exception 'FALLA: %', p_msg;
    end if;
    raise notice 'ok  %', p_msg;
end $$;

/** Una operación de campo con los campos de siempre. */
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_inmediato boolean default true,
                                      p_ubic boolean default true, p_en_nombre uuid default null,
                                      p_creado timestamptz default now()) returns jsonb language sql as $$
    select jsonb_build_object('id', p_id, 'tipo', p_tipo, 'creado_en', p_creado, 'enviado_en', now(),
        'inmediato', p_inmediato, 'dispositivo', 'prueba',
        'ubicacion', case when p_ubic then jsonb_build_object('lat', 13.3, 'lon', -87.2, 'precision', 8) end,
        'en_nombre_de', p_en_nombre, 'datos', p_datos)
$$;

create or replace function pg_temp.sync1(p jsonb) returns jsonb language sql as
$$ select (public.fn_fert_sincronizar(jsonb_build_array(p)))->0 $$;

set client_min_messages = notice;

-- ---------------------------------------------------------------------
-- Datos de prueba: 3 roles (sin nombres en el código: los define la matriz), 5 personas
-- ---------------------------------------------------------------------
do $$
declare
    r_est smallint; r_jefe smallint; r_agl smallint;
    u uuid;
begin
    insert into roles (codigo, nombre) values ('T_EST', 'Prueba estacionero') on conflict (codigo) do nothing;
    insert into roles (codigo, nombre) values ('T_JEFE', 'Prueba jefe') on conflict (codigo) do nothing;
    insert into roles (codigo, nombre) values ('T_AGL', 'Prueba AGL') on conflict (codigo) do nothing;
    select id into r_est from roles where codigo = 'T_EST';
    select id into r_jefe from roles where codigo = 'T_JEFE';
    select id into r_agl from roles where codigo = 'T_AGL';

    insert into permisos (rol_id, recurso, accion, alcance) values
        (r_est, 'fertirriego', 'ver', 'propietario'), (r_est, 'fertirriego', 'recibir', 'propietario'),
        (r_est, 'fertirriego', 'aplicar', 'propietario'), (r_est, 'fertirriego', 'contar', 'propietario'),
        (r_est, 'fertirriego', 'relevo', 'propietario'),
        (r_jefe, 'fertirriego', 'ver', 'zonal'), (r_jefe, 'fertirriego', 'aplicar', 'zonal'),
        (r_jefe, 'fertirriego', 'en_nombre_de', 'zonal'), (r_jefe, 'fertirriego', 'administrar_estaciones', 'zonal'),
        (r_jefe, 'fertirriego', 'anular', 'zonal'), (r_jefe, 'fertirriego', 'gestionar_choferes', 'zonal'),
        (r_agl, 'fertirriego_agl', 'ver', 'global'), (r_agl, 'fertirriego_agl', 'publicar', 'global')
    on conflict (rol_id, recurso, accion) do nothing;

    foreach u in array array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2',
                             '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000a',
                             '00000000-0000-0000-0000-00000000000b']::uuid[] loop
        insert into auth.users (id, email) values (u, u::text || '@prueba.local') on conflict do nothing;
    end loop;
    insert into perfiles (id, nombre, rol_id) values
        ('00000000-0000-0000-0000-0000000000e1', 'Estacionero Día', r_est),
        ('00000000-0000-0000-0000-0000000000e2', 'Estacionero Noche', r_est),
        ('00000000-0000-0000-0000-0000000000e3', 'Estacionero Otra', r_est),
        ('00000000-0000-0000-0000-00000000000a', 'Jefe Zona 1', r_jefe),
        ('00000000-0000-0000-0000-00000000000b', 'Usuario AGL', r_agl)
    on conflict (id) do nothing;
    insert into perfiles_zonas (perfil_id, zona_id)
    select '00000000-0000-0000-0000-00000000000a', id from zonas where nombre = 'Zona 1'
    on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- 1 · Código de relevo: vector oficial RFC 6238 (secreto ASCII «12345678901234567890», t = 59 s)
-- ---------------------------------------------------------------------
select pg_temp.ok(fn_fert_totp(convert_to('12345678901234567890', 'UTF8'), 1) = '287082', 'TOTP RFC 6238 (t=59) = 287082');
select pg_temp.ok(fn_fert_totp(convert_to('12345678901234567890', 'UTF8'), 1111111109 / 30) = '081804', 'TOTP RFC 6238 (t=1111111109) = 081804');

-- ---------------------------------------------------------------------
-- 2 · Publicación desde AGL
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
do $$ begin
    perform fn_fert_publicar('{}'::jsonb);
    raise exception 'FALLA: un estacionero pudo publicar';
exception when insufficient_privilege then raise notice 'ok  un estacionero no puede publicar';
end $$;

select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.ok(
    (r->>'turnos')::int = 2 and (r->>'filas_plan')::int = 3 and (r->>'materiales')::int = 2
    and jsonb_array_length(r->'avisos') = 1,
    'AGL publica 2 turnos, 2 materiales y 3 filas de plan (1 aviso por material inexistente)')
from (select fn_fert_publicar(jsonb_build_object(
    'temporada', 'QA-2026', 'completo', true,
    'estaciones', jsonb_build_array(jsonb_build_object('nombre', 'Papalon-1', 'zona', 'Zona-1'),
                                    jsonb_build_object('nombre', 'Zamora', 'zona', 'Zona 2A')),
    'materiales', jsonb_build_array(
        jsonb_build_object('codigo', 'QA-SOLCA', 'descripcion', 'SOLUCION LIQUIDA CALCIO (QA)', 'unidad', 'L', 'grupo', '1800'),
        jsonb_build_object('codigo', 'QA-ACSUL', 'descripcion', 'ACIDO SULFURICO 52% (QA)', 'unidad', 'L', 'grupo', '1800')),
    'turnos', jsonb_build_array(
        jsonb_build_object('agl_id', 'TR-QA-1', 'turno', 'T1001-T03', 'temporada', 'QA-2026', 'ciclo', 'Ciclo 1',
            'fecha_siembra', '2026-11-01', 'estacion', 'Papalon-1', 'zona', 'Zona 1', 'orden_sap', '6442143',
            'plan', 'PLAN QA', 'tipo_plan', 'Solución Líquida', 'area_mz', 10, 'estado', 'Creado'),
        jsonb_build_object('agl_id', 'TR-QA-2', 'turno', 'T2A-QA', 'temporada', 'QA-2026', 'ciclo', 'Ciclo 1',
            'fecha_siembra', '2026-11-01', 'estacion', 'Zamora', 'zona', 'Zona 2A', 'orden_sap', '6442144',
            'plan', 'PLAN QA', 'area_mz', 5, 'estado', 'Creado')),
    'plan', jsonb_build_array(
        jsonb_build_object('agl_id', 'TR-QA-1', 'filas', jsonb_build_array(
            jsonb_build_object('fecha', '2026-11-06', 'ddt', 5, 'material', 'QA-SOLCA', 'cantidad', 120, 'dosis_mz', 12),
            jsonb_build_object('fecha', '2026-11-07', 'ddt', 6, 'material', 'QA-SOLCA', 'cantidad', 120, 'dosis_mz', 12),
            jsonb_build_object('fecha', '2026-11-07', 'ddt', 6, 'material', 'NO-EXISTE', 'cantidad', 5))),
        jsonb_build_object('agl_id', 'TR-QA-2', 'filas', jsonb_build_array(
            jsonb_build_object('fecha', '2026-11-06', 'ddt', 5, 'material', 'QA-SOLCA', 'cantidad', 60))))
))) as x(r);

-- Volver a publicar reemplaza el plan (no duplica)
select fn_fert_publicar(jsonb_build_object('temporada', 'QA-2026', 'turnos', '[]'::jsonb,
    'plan', jsonb_build_array(jsonb_build_object('agl_id', 'TR-QA-2', 'filas', jsonb_build_array(
        jsonb_build_object('fecha', '2026-11-06', 'ddt', 5, 'material', 'QA-SOLCA', 'cantidad', 65))))));
select pg_temp.ok((select count(*) = 1 and sum(cantidad) = 65 from fert_plan p join turnos_ciclo t on t.id = p.turno_ciclo_id
                   where t.agl_id = 'TR-QA-2'), 'republicar reemplaza el plan del turno');
select pg_temp.ok((select unidad = 'L' and fertirriego from materiales where codigo = 'QA-SOLCA'), 'material con unidad y marca fertirriego');
select pg_temp.ok((select z.nombre = 'Zona 1' from estaciones_riego e join zonas z on z.id = e.zona_id where e.nombre = 'Papalon-1'),
                  'la estación queda en su zona');

-- ---------------------------------------------------------------------
-- 3 · Asignación de personas y custodia
-- ---------------------------------------------------------------------
create temp table ids as
select (select id from estaciones_riego where nombre = 'Papalon-1') as est,
       (select id from estaciones_riego where nombre = 'Zamora') as est2,
       (select id from materiales where codigo = 'QA-SOLCA') as solca,
       (select id from materiales where codigo = 'QA-ACSUL') as acsul,
       (select id from turnos_ciclo where agl_id = 'TR-QA-1') as tc1,
       (select id from turnos_ciclo where agl_id = 'TR-QA-2') as tc2;
grant select on ids to authenticated;

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
do $$ begin
    perform fn_fert_asignar_persona(est2, '00000000-0000-0000-0000-0000000000e3') from ids;
    raise exception 'FALLA: el jefe asignó en una estación fuera de su zona';
exception when insufficient_privilege then raise notice 'ok  el jefe no administra estaciones de otra zona';
end $$;

select fn_fert_asignar_persona(est, '00000000-0000-0000-0000-0000000000e1') from ids;
select fn_fert_asignar_persona(est, '00000000-0000-0000-0000-0000000000e2') from ids;

-- E3 en Zamora: lo asigna un administrador (aquí, directo como superusuario)
insert into perfiles_estaciones (perfil_id, estacion_id) select '00000000-0000-0000-0000-0000000000e3', est2 from ids;

select pg_temp.ok((select count(*) = 3 from fert_llaves
                   where perfil_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2',
                                       '00000000-0000-0000-0000-0000000000e3')), 'cada persona asignada tiene su llave');

-- Sin custodia nadie registra con señal
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('10000000-0000-0000-0000-000000000001', 'chofer',
                  '{"nombre": "Juan Chofer"}'))->>'estado' = 'ACEPTADO', 'alta rápida de chofer');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('10000000-0000-0000-0000-000000000002', 'vehiculo',
                  '{"placa": "hab 1234", "tipo": "Camión", "color": "Blanco"}'))->>'estado' = 'ACEPTADO', 'alta rápida de vehículo');
select pg_temp.ok((select placa = 'HAB1234' and not validado from fert_vehiculos where id = '10000000-0000-0000-0000-000000000002'),
                  'la placa se normaliza y queda por validar');

select pg_temp.ok(r->>'estado' = 'RECHAZADO' and r->>'mensaje' like '%no está a tu cargo%',
                  'sin custodia: recepción inmediata rechazada')
from (select pg_temp.sync1(pg_temp.op('20000000-0000-0000-0000-000000000001', 'recepcion', jsonb_build_object(
        'estacion_id', est, 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 10)))))
      from ids) x(r);
select pg_temp.ok((select resultado = 'RECHAZADO' from fert_operaciones where id = '20000000-0000-0000-0000-000000000001'),
                  'el rechazo también queda guardado');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select fn_fert_asignar_custodia(est, '00000000-0000-0000-0000-0000000000e1', 'Arranque Fertirriego') from ids;
select pg_temp.ok((select custodio_id = '00000000-0000-0000-0000-0000000000e1' and estado = 'ACTIVA'
                   from fert_custodia c join ids on c.estacion_id = ids.est), 'el jefe asigna la custodia a E1');

-- ---------------------------------------------------------------------
-- 4 · Conteo inicial, recepción, aplicación
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');

select pg_temp.ok(pg_temp.sync1(pg_temp.op('30000000-0000-0000-0000-000000000001', 'conteo', jsonb_build_object(
        'estacion_id', est, 'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad_real', 50)))))->>'estado'
    = 'ACEPTADO', 'conteo inicial (saldo inicial 50)') from ids;
select pg_temp.ok((select tipo = 'SALDO_INICIAL' and cantidad = 50 from fert_movimientos
                   where documento_id = '30000000-0000-0000-0000-000000000001'), 'el primer conteo es SALDO_INICIAL');

select pg_temp.ok(pg_temp.sync1(pg_temp.op('20000000-0000-0000-0000-000000000002', 'recepcion', jsonb_build_object(
        'estacion_id', est, 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'vehiculo_id', '10000000-0000-0000-0000-000000000002', 'lugar', 'Estación Papalon-1',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', '1,000')))))->>'estado'
    = 'ACEPTADO', 'recepción de 1,000 L') from ids;
select pg_temp.ok((select disponible = 1050 from fert_saldos s join ids on s.estacion_id = ids.est and s.material_id = ids.solca),
                  'saldo 1,050');
select pg_temp.ok(exists (select 1 from fert_choferes_vehiculos where chofer_id = '10000000-0000-0000-0000-000000000001'),
                  'se aprende qué camión usó el chofer');

-- Reintento del mismo registro (el teléfono no supo si llegó)
select pg_temp.ok(pg_temp.sync1(pg_temp.op('20000000-0000-0000-0000-000000000002', 'recepcion', jsonb_build_object(
        'estacion_id', est, 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 1000)))))->>'estado'
    = 'YA_EXISTIA', 'reenviar no duplica') from ids;
select pg_temp.ok((select disponible = 1050 from fert_saldos s join ids on s.estacion_id = ids.est and s.material_id = ids.solca),
                  'saldo sigue en 1,050');

select pg_temp.ok(pg_temp.sync1(pg_temp.op('40000000-0000-0000-0000-000000000001', 'aplicacion', jsonb_build_object(
        'estacion_id', est, 'turno_ciclo_id', tc1, 'fecha', '2026-11-06',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 120)))))->>'estado'
    = 'ACEPTADO', 'aplicación de 120 L al turno (en plan)') from ids;
select pg_temp.ok((select disponible = 930 from fert_saldos s join ids on s.estacion_id = ids.est and s.material_id = ids.solca),
                  'saldo 930 después de aplicar');

-- Ácido fuera de plan y sin existencia: con señal se rechaza; sin señal se acepta y se marca
select pg_temp.ok(r->>'estado' = 'RECHAZADO' and r->>'mensaje' like 'No alcanza el saldo%',
                  'con señal: aplicar sin existencia se rechaza')
from (select pg_temp.sync1(pg_temp.op('40000000-0000-0000-0000-000000000002', 'aplicacion', jsonb_build_object(
        'estacion_id', est, 'turno_ciclo_id', tc1, 'fecha', '2026-11-06',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', acsul, 'cantidad', 5))))) from ids) x(r);

select pg_temp.ok(r->>'estado' = 'ACEPTADO_CON_OBSERVACIONES'
                  and r->'observaciones' ?& array['SALDO_NEGATIVO', 'FUERA_DE_PLAN', 'SIN_UBICACION'],
                  'sin señal: se acepta y se marca (saldo negativo, fuera de plan, sin ubicación)')
from (select pg_temp.sync1(pg_temp.op('40000000-0000-0000-0000-000000000003', 'aplicacion', jsonb_build_object(
        'estacion_id', est, 'turno_ciclo_id', tc1, 'fecha', '2026-11-06',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', acsul, 'cantidad', 5))), false, false)) from ids) x(r);

-- Cantidades inválidas
select pg_temp.ok(pg_temp.sync1(pg_temp.op('40000000-0000-0000-0000-000000000004', 'aplicacion', jsonb_build_object(
        'estacion_id', est, 'turno_ciclo_id', tc1,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', -3)))))->>'estado'
    = 'RECHAZADO', 'cantidad negativa rechazada') from ids;
select pg_temp.ok(pg_temp.sync1(pg_temp.op('40000000-0000-0000-0000-000000000005', 'aplicacion', jsonb_build_object(
        'estacion_id', est, 'turno_ciclo_id', tc1,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 'abc')))))->>'estado'
    = 'RECHAZADO', 'cantidad no numérica rechazada') from ids;

-- Un lote con uno bueno y uno malo: el malo no tumba al bueno
select pg_temp.ok(r->0->>'estado' = 'RECHAZADO' and r->1->>'estado' = 'ACEPTADO', 'lote mixto: cada registro por separado')
from (select fn_fert_sincronizar(jsonb_build_array(
        pg_temp.op('40000000-0000-0000-0000-000000000006', 'desconocido', '{}'),
        pg_temp.op('40000000-0000-0000-0000-000000000007', 'aplicacion', jsonb_build_object(
            'estacion_id', est, 'turno_ciclo_id', tc1, 'fecha', '2026-11-07',
            'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 30)))))) from ids) x(r);

-- Reloj del teléfono adelantado
select pg_temp.ok((r->'observaciones') ? 'RELOJ', 'reloj del teléfono fuera de hora se marca')
from (select pg_temp.sync1(jsonb_set(pg_temp.op('40000000-0000-0000-0000-000000000008', 'bitacora', jsonb_build_object(
        'turno_ciclo_id', tc1, 'fecha', '2026-11-06', 'horas_riego', 6)), '{enviado_en}',
        to_jsonb(now() + interval '2 hours'))) from ids) x(r);

-- ---------------------------------------------------------------------
-- 5 · Custodia: E2 no tiene la estación
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-0000000000e2');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('50000000-0000-0000-0000-000000000001', 'aplicacion', jsonb_build_object(
        'estacion_id', est, 'turno_ciclo_id', tc1,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 10)))))->>'estado'
    = 'RECHAZADO', 'E2 sin la estación a cargo: con señal se rechaza') from ids;
select pg_temp.ok((pg_temp.sync1(pg_temp.op('50000000-0000-0000-0000-000000000002', 'aplicacion', jsonb_build_object(
        'estacion_id', est, 'turno_ciclo_id', tc1,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 10))), false))->'observaciones')
    ? 'FUERA_DE_CUSTODIA', 'E2 sin señal: se acepta y se marca FUERA_DE_CUSTODIA') from ids;

-- E2 no puede anular lo de E1
select pg_temp.ok(pg_temp.sync1(pg_temp.op('50000000-0000-0000-0000-000000000003', 'anulacion', jsonb_build_object(
        'documento_tipo', 'recepcion', 'documento_id', '20000000-0000-0000-0000-000000000002', 'motivo', 'boicot')))->>'estado'
    = 'RECHAZADO', 'E2 no puede anular la recepción de E1');

-- E3 (otra estación) no ve nada de Papalon-1
select pg_temp.como('00000000-0000-0000-0000-0000000000e3');
set role authenticated;
select pg_temp.ok((select count(*) = 0 from fert_saldos s where s.estacion_id = (select est from ids)), 'E3 no ve los saldos de otra estación');
select pg_temp.ok((select count(*) = 0 from fert_movimientos m where m.estacion_id = (select est from ids)), 'E3 no ve el kardex de otra estación');
select pg_temp.ok((select count(*) = 1 from fn_fert_mis_llaves()), 'E3 solo recibe su propia llave');
do $$ begin
    insert into fert_saldos (estacion_id, material_id, disponible) select est, solca, 99999 from ids;
    raise exception 'FALLA: se pudo escribir directo en fert_saldos';
exception when insufficient_privilege then raise notice 'ok  nadie escribe directo en las tablas';
end $$;
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select pg_temp.ok((select count(*) = 2 from fn_fert_mis_llaves()), 'E1 recibe su llave y la de su compañero de estación');
select pg_temp.ok((select count(*) > 0 from fert_saldos s where s.estacion_id = (select est from ids)), 'E1 ve los saldos de su estación');
select pg_temp.ok((select count(*) = 0 from fert_llaves), 'nadie lee la tabla de llaves directo');
select pg_temp.ok((select count(*) = 1 from turnos_ciclo), 'E1 solo ve los turnos de su estación');
reset role;

-- ---------------------------------------------------------------------
-- 6 · Devolución, anulación, conteo con diferencia, bitácora
-- ---------------------------------------------------------------------
select pg_temp.ok(pg_temp.sync1(pg_temp.op('60000000-0000-0000-0000-000000000001', 'devolucion', jsonb_build_object(
        'aplicacion_id', '40000000-0000-0000-0000-000000000001', 'motivo', 'Sobró en el tanque',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 200)))))->>'estado'
    = 'RECHAZADO', 'no se devuelve más de lo aplicado') from ids;
select pg_temp.ok(pg_temp.sync1(pg_temp.op('60000000-0000-0000-0000-000000000002', 'devolucion', jsonb_build_object(
        'aplicacion_id', '40000000-0000-0000-0000-000000000001', 'motivo', 'Sobró en el tanque',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 20)))))->>'estado'
    = 'ACEPTADO', 'devolución de 20 L') from ids;

select pg_temp.ok(pg_temp.sync1(pg_temp.op('60000000-0000-0000-0000-000000000003', 'anulacion', jsonb_build_object(
        'documento_tipo', 'aplicacion', 'documento_id', '40000000-0000-0000-0000-000000000001', 'motivo', 'Error')))->>'estado'
    = 'RECHAZADO', 'no se anula una aplicación con devoluciones vivas');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('60000000-0000-0000-0000-000000000004', 'anulacion', jsonb_build_object(
        'documento_tipo', 'aplicacion', 'documento_id', '40000000-0000-0000-0000-000000000007', 'motivo', 'Digité mal')))->>'estado'
    = 'ACEPTADO', 'E1 anula su propia aplicación de su jornada');
select pg_temp.ok((select anulado_at is not null and motivo_anulacion = 'Digité mal' from fert_aplicaciones
                   where id = '40000000-0000-0000-0000-000000000007'), 'el original queda visible y marcado anulado');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('60000000-0000-0000-0000-000000000005', 'anulacion', jsonb_build_object(
        'documento_tipo', 'aplicacion', 'documento_id', '40000000-0000-0000-0000-000000000007', 'motivo', 'otra vez')))->>'estado'
    = 'RECHAZADO', 'no se anula dos veces');

-- Saldo esperado de SOLCA: 50 + 1000 − 120 − 30 − 10 (E2 sin señal) + 20 + 30 (anulación) = 940
select pg_temp.ok((select disponible = 940 from fert_saldos s join ids on s.estacion_id = ids.est and s.material_id = ids.solca),
                  'saldo SOLCA = 940');
select pg_temp.ok((select k.saldo = 940 from v_fert_kardex k join ids on k.estacion_id = ids.est and k.material_id = ids.solca
                   order by k.fecha_hora desc, k.cursor desc limit 1), 'el kardex termina en el mismo saldo');

select pg_temp.ok(pg_temp.sync1(pg_temp.op('60000000-0000-0000-0000-000000000006', 'conteo', jsonb_build_object(
        'estacion_id', est, 'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad_real', 935)))))->>'estado'
    = 'ACEPTADO', 'conteo físico 935') from ids;
select pg_temp.ok((select tipo = 'AJUSTE_CONTEO' and cantidad = -5 from fert_movimientos
                   where documento_id = '60000000-0000-0000-0000-000000000006'), 'ajuste de −5 por el conteo');

select pg_temp.ok(pg_temp.sync1(pg_temp.op('60000000-0000-0000-0000-000000000007', 'bitacora', jsonb_build_object(
        'turno_ciclo_id', tc1, 'fecha', '2026-11-06', 'horas_fertilizacion', 2.5)))->>'estado' = 'ACEPTADO',
    'bitácora: se agregan horas de fertilización') from ids;
select pg_temp.ok((select horas_riego = 6 and horas_fertilizacion = 2.5 from fert_bitacora_riego b join ids on b.turno_ciclo_id = ids.tc1
                   where b.fecha = '2026-11-06'), 'la bitácora conserva lo anterior y completa lo nuevo');
select pg_temp.ok((select count(*) = 0 from fert_movimientos where operacion_id = '60000000-0000-0000-0000-000000000007'),
                  'la bitácora no toca el inventario');

-- ---------------------------------------------------------------------
-- 7 · El jefe registra por un estacionero sin teléfono y anula con su permiso
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('70000000-0000-0000-0000-000000000001', 'aplicacion', jsonb_build_object(
        'estacion_id', est, 'turno_ciclo_id', tc1, 'fecha', '2026-11-07',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', solca, 'cantidad', 100))),
        true, true, '00000000-0000-0000-0000-0000000000e2'))->>'estado' = 'ACEPTADO', 'el jefe registra en nombre de E2') from ids;
select pg_temp.ok((select ejecutor_id = '00000000-0000-0000-0000-0000000000e2' and registrado_por = '00000000-0000-0000-0000-00000000000a'
                   from fert_aplicaciones where id = '70000000-0000-0000-0000-000000000001'), 'queda quién ejecutó y quién registró');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('70000000-0000-0000-0000-000000000002', 'anulacion', jsonb_build_object(
        'documento_tipo', 'recepcion', 'documento_id', '20000000-0000-0000-0000-000000000002', 'motivo', 'La recepción era de otra estación')))->>'estado'
    = 'RECHAZADO', 'anular una recepción ya consumida dejaría saldo negativo: se rechaza');

select pg_temp.como(null);
select 'TODAS LAS PRUEBAS OK' as resultado;
