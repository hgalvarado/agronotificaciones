-- =====================================================================
-- PRUEBAS de sql/102 · terminar el ciclo de un turno: AGL lo baja, se borra de aquí y se puede volver a subir
-- (réplica con 99, 100, 101 y los datos de pruebas/sql/99; turno TR-QA-1 en Papalon-1 con aplicaciones,
-- devolución, anulación, bitácora y plan)
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
create or replace function pg_temp.falla(p_sql text, p_msg text, p_texto text default null) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: %', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    if p_texto is not null and position(p_texto in sqlerrm) = 0 then
        raise exception 'FALLA: % (mensaje inesperado: %)', p_msg, sqlerrm;
    end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_inmediato boolean default true) returns jsonb language sql as $$
    select jsonb_build_object('id', p_id, 'tipo', p_tipo, 'creado_en', now(), 'enviado_en', now(), 'inmediato', p_inmediato,
        'dispositivo', 'prueba', 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2, 'precision', 8), 'datos', p_datos)
$$;
create or replace function pg_temp.tc() returns uuid language sql as $$ select id from turnos_ciclo where agl_id = 'TR-QA-1' $$;
create or replace function pg_temp.real() returns uuid language sql as $$ select id from estaciones_riego where nombre = 'Papalon-1' $$;
create or replace function pg_temp.prueba() returns uuid language sql as $$ select id from estaciones_riego where prueba_de = pg_temp.real() $$;
create or replace function pg_temp.mat(p text) returns uuid language sql as $$ select id from materiales where codigo = p $$;
/** Saldo del libro y de fert_saldos de las estaciones reales, por estación × producto. */
create or replace function pg_temp.saldos() returns jsonb language sql as $$
    select jsonb_build_object(
        'libro', (select jsonb_object_agg(k, v) from (select m.estacion_id || '|' || m.material_id as k, sum(m.cantidad) as v
                  from fert_movimientos m join estaciones_riego e on e.id = m.estacion_id and e.prueba_de is null group by 1) x),
        'tabla', (select jsonb_object_agg(s.estacion_id || '|' || s.material_id, s.disponible)
                  from fert_saldos s join estaciones_riego e on e.id = s.estacion_id and e.prueba_de is null))
$$;
set client_min_messages = notice;

\set ADM '''00000000-0000-0000-0000-000000009901'''
\set AGL '''00000000-0000-0000-0000-00000000000b'''
\set E1 '''00000000-0000-0000-0000-0000000000e1'''
\set E2 '''00000000-0000-0000-0000-0000000000e2'''

-- ---------------------------------------------------------------- modo de pruebas: algo de prueba sobre el mismo turno
select pg_temp.como(:ADM);
select fn_fert_pruebas_activar(array[pg_temp.real()], array[:E2::uuid]);
insert into perfiles_estaciones (perfil_id, estacion_id) values (:E2, pg_temp.prueba()) on conflict do nothing;
select fn_fert_asignar_custodia(pg_temp.prueba(), :E2, 'Prueba 102');
select pg_temp.como(:E2);
select fn_fert_sincronizar(jsonb_build_array(
    pg_temp.op('10200000-0000-4000-8000-0000000000a1', 'recepcion', jsonb_build_object(
        'estacion_id', pg_temp.prueba(), 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('QA-SOLCA'), 'cantidad', 50)))),
    pg_temp.op('10200000-0000-4000-8000-0000000000a2', 'aplicacion', jsonb_build_object(
        'estacion_id', pg_temp.prueba(), 'turno_ciclo_id', pg_temp.tc(), 'fecha', current_date - 1, 'extra', true,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('QA-SOLCA'), 'cantidad', 8))))));
select pg_temp.ok((select count(*) = 2 from fert_operaciones where id in ('10200000-0000-4000-8000-0000000000a1', '10200000-0000-4000-8000-0000000000a2')
                   and resultado like 'ACEPTADO%'), 'modo de pruebas: aplicación de prueba sobre el turno real');
create temp table prueba_antes as
    select (select count(*) from fert_movimientos where estacion_id = pg_temp.prueba()) as movs,
           (select count(*) from fert_aplicaciones where estacion_id = pg_temp.prueba()) as aplic;

-- ---------------------------------------------------------------- permisos
select pg_temp.como(:E1);
select pg_temp.falla($q$ select fn_fert_exportar_turno('TR-QA-1') $q$, 'un estacionero no exporta el turno', 'Publicar');
select pg_temp.falla($q$ select fn_fert_archivar_turno('TR-QA-1', 'x') $q$, 'un estacionero no archiva', 'Publicar');
select pg_temp.falla($q$ select fn_fert_restaurar_turno('{"agl_id": "TR-QA-1"}') $q$, 'un estacionero no restaura', 'Publicar');
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_fert_exportar_turno('TR-QA-1') $q$, 'sin sesión no se exporta', 'sesión');

-- ---------------------------------------------------------------- paso 1: exportar
select pg_temp.como(:AGL);
create temp table p1 as select fn_fert_exportar_turno('TR-QA-1') as x;
select pg_temp.ok((select (x->>'ya_archivado')::boolean = false and x->>'turno' = 'T1001-T03' from p1), 'el usuario de AGL exporta el turno');
select pg_temp.ok((select x->>'huella' = encode(sha256(convert_to((x->'filas')::text, 'UTF8')), 'hex') from p1), 'la huella es sha256 del texto de las filas');
select pg_temp.ok((select (x->'conteos'->>'aplicaciones')::int = 5 and (x->'conteos'->>'movimientos')::int = 7
                          and (x->'conteos'->>'devoluciones')::int = 1 and (x->'conteos'->>'plan')::int = 2
                          and (x->'conteos'->>'bitacora')::int = 1 from p1),
                  'trae todo: 5 aplicaciones, 7 movimientos, 1 devolución, 1 bitácora, 2 filas de plan');
select pg_temp.ok((select (x->'conteos'->>'operaciones')::int >= 8 from p1), 'y las operaciones de esos registros');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(x->'filas'->'fert_aplicaciones') a
                                     where (a->>'estacion_id')::uuid = pg_temp.prueba()) from p1),
                  'nada del modo de pruebas va en el paquete');
select pg_temp.ok((select jsonb_array_length(x->'agl'->'aplicaciones') = 5 and jsonb_array_length(x->'agl'->'movimientos') = 7
                          and jsonb_array_length(x->'agl'->'bitacora_riego') = 1 from p1),
                  'y la vista para AGL (misma forma que fn_fert_exportar)');
select pg_temp.ok((select fn_fert_exportar_turno('TR-QA-1')->>'huella' = x->>'huella' from p1), 'exportar dos veces da la misma huella');
set timezone = 'America/Tegucigalpa';
select pg_temp.ok((select fn_fert_exportar_turno('TR-QA-1')->>'huella' = x->>'huella' from p1), 'la huella no depende de la zona horaria de la sesión');
reset timezone;

-- ---------------------------------------------------------------- huella distinta = no se borra nada
select pg_temp.falla($q$ select fn_fert_archivar_turno('TR-QA-1', 'otra') $q$, 'huella que no es la de la base: rechazado', 'cambió');
select pg_temp.ok((select count(*) = 5 from fert_aplicaciones where turno_ciclo_id = pg_temp.tc() and estacion_id = pg_temp.real()),
                  'y no se borró nada');

-- Llega algo nuevo del campo entre el paso 1 y el 2 → la huella de AGL ya no sirve
select pg_temp.como(:E1);
select fn_fert_sincronizar(jsonb_build_array(pg_temp.op('10200000-0000-4000-8000-0000000000b1', 'bitacora', jsonb_build_object(
    'estacion_id', pg_temp.real(), 'turno_ciclo_id', pg_temp.tc(), 'fecha', '2026-10-02', 'horas_riego', 3))));
select pg_temp.como(:AGL);
select pg_temp.falla($q$ select fn_fert_archivar_turno('TR-QA-1', (select x->>'huella' from p1)) $q$,
                     'llegó una bitácora después de exportar: no archiva con la huella vieja', 'cambió');

create temp table p2 as select fn_fert_exportar_turno('TR-QA-1') as x;
select pg_temp.ok((select (x->'conteos'->>'bitacora')::int = 2 from p2), 'al exportar de nuevo trae la bitácora nueva');

-- ---------------------------------------------------------------- paso 2: archivar
create temp table saldo_antes as select pg_temp.saldos() as s;
select pg_temp.como(:E1);
create temp table campo_antes as select fn_fert_estado_campo() as e;
select pg_temp.como(:AGL);
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(e->'turnos') t where (t->>'id')::uuid = pg_temp.tc())
                   from campo_antes), 'antes: el teléfono ve el turno');

create temp table a1 as select fn_fert_archivar_turno('TR-QA-1', (select x->>'huella' from p2)) as x;
select pg_temp.ok((select (x->>'archivado')::boolean and x->'conteos' = (select x->'conteos' from p2) from a1),
                  'archivado: devuelve los mismos conteos del paquete');
select pg_temp.ok((select s = pg_temp.saldos() from saldo_antes), 'EL SALDO NO CAMBIA (libro y tabla de saldos, toda estación × producto)');
select pg_temp.ok(not exists (select 1 from fert_aplicaciones where turno_ciclo_id = pg_temp.tc() and estacion_id = pg_temp.real())
                  and not exists (select 1 from fert_movimientos where turno_ciclo_id = pg_temp.tc() and estacion_id = pg_temp.real() and tipo <> 'ARCHIVO_TURNO')
                  and not exists (select 1 from fert_plan where turno_ciclo_id = pg_temp.tc())
                  and not exists (select 1 from fert_bitacora_riego where turno_ciclo_id = pg_temp.tc())
                  and not exists (select 1 from fert_operaciones o, p2 where o.id in (select (y->>'id')::uuid from jsonb_array_elements(p2.x->'filas'->'fert_operaciones') y)),
                  'lo del turno ya no está en la base');
select pg_temp.ok((select count(*) > 0 and bool_and(documento_tipo = 'archivo_turno') from fert_movimientos
                   where turno_ciclo_id = pg_temp.tc() and tipo = 'ARCHIVO_TURNO'), 'en su lugar: un consolidado ARCHIVO_TURNO por estación × producto');
select pg_temp.ok((select jsonb_array_length(x->'consolidado') = (select count(*) from fert_movimientos where turno_ciclo_id = pg_temp.tc() and tipo = 'ARCHIVO_TURNO') from a1),
                  'y AGL recibe sus cursores');
select pg_temp.ok((select not activo and archivado_at is not null and archivo_huella = (select x->>'huella' from p2)
                          and cardinality(archivo_documentos) = 6 from turnos_ciclo where id = pg_temp.tc()),
                  'el turno queda inactivo y archivado (con sus 6 documentos)');
select pg_temp.ok((select movs = (select count(*) from fert_movimientos where estacion_id = pg_temp.prueba())
                          and aplic = (select count(*) from fert_aplicaciones where estacion_id = pg_temp.prueba()) from prueba_antes),
                  'el modo de pruebas no se toca');
select pg_temp.ok((select (x->>'ya_archivado')::boolean from (select fn_fert_archivar_turno('TR-QA-1', (select x->>'huella' from p2)) as x) y),
                  'archivar otra vez con la misma huella: ya estaba (idempotente)');
select pg_temp.ok((select (x->>'ya_archivado')::boolean and x->>'huella' = (select x->>'huella' from p2)
                   from (select fn_fert_exportar_turno('TR-QA-1') as x) y), 'exportar un turno archivado dice que ya está archivado');
select pg_temp.ok((select count(*) > 0 from jsonb_array_elements(fn_fert_exportar(0, 20000)->'movimientos') m where m->>'tipo' = 'ARCHIVO_TURNO'),
                  'fn_fert_exportar (AGL) baja el consolidado');

-- ---------------------------------------------------------------- teléfono
select pg_temp.como(:E1);
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'turnos') t where (t->>'id')::uuid = pg_temp.tc()),
                  'el turno archivado ya no aparece en el teléfono');
-- Capturado sin señal antes de que se cerrara: llega después → rechazado con mensaje claro, guardado
create temp table r1 as select fn_fert_sincronizar(jsonb_build_array(
    pg_temp.op('10200000-0000-4000-8000-0000000000c1', 'aplicacion', jsonb_build_object(
        'estacion_id', pg_temp.real(), 'turno_ciclo_id', pg_temp.tc(), 'fecha', current_date - 1,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('QA-SOLCA'), 'cantidad', 4))), false),
    pg_temp.op('10200000-0000-4000-8000-0000000000c2', 'bitacora', jsonb_build_object(
        'estacion_id', pg_temp.real(), 'turno_ciclo_id', pg_temp.tc(), 'fecha', current_date - 1, 'horas_riego', 2), false),
    pg_temp.op('10200000-0000-4000-8000-0000000000c3', 'devolucion', jsonb_build_object(
        'estacion_id', pg_temp.real(), 'aplicacion_id', '40000000-0000-0000-0000-000000000001', 'motivo', 'sobró',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('QA-SOLCA'), 'cantidad', 1))), false),
    pg_temp.op('10200000-0000-4000-8000-0000000000c4', 'anulacion', jsonb_build_object(
        'estacion_id', pg_temp.real(), 'documento_tipo', 'aplicacion', 'documento_id', '40000000-0000-0000-0000-000000000003', 'motivo', 'error'), false),
    -- reenvío de una aplicación que YA estaba aceptada (el teléfono no recibió la respuesta)
    pg_temp.op('40000000-0000-0000-0000-000000000001', 'aplicacion', jsonb_build_object(
        'estacion_id', pg_temp.real(), 'turno_ciclo_id', pg_temp.tc(), 'fecha', current_date - 1,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('QA-SOLCA'), 'cantidad', 4))), false)
    )) as x;
select pg_temp.ok((select bool_and(e->>'estado' = 'RECHAZADO' and e->>'mensaje' like '%ya terminó su ciclo%' and e->>'mensaje' like '%Envíos%')
                          and count(*) = 5 from r1, jsonb_array_elements(r1.x) e),
                  'aplicación, bitácora, devolución, anulación y reenvío de un turno archivado: rechazados con mensaje claro');
select pg_temp.ok((select count(*) = 5 from fert_operaciones where resultado = 'RECHAZADO' and id in (
                      '10200000-0000-4000-8000-0000000000c1', '10200000-0000-4000-8000-0000000000c2', '10200000-0000-4000-8000-0000000000c3',
                      '10200000-0000-4000-8000-0000000000c4', '40000000-0000-0000-0000-000000000001')),
                  'y quedan guardados como rechazados (no se pierden; AGL los ve)');
select pg_temp.ok((select s = pg_temp.saldos() from saldo_antes), 'los rechazos no movieron el saldo');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'movimientos') m where m->>'tipo' = 'ARCHIVO_TURNO'),
                  'el teléfono ve el consolidado en el kardex de la estación');

-- ---------------------------------------------------------------- el libro no se edita ni se borra
select pg_temp.falla($q$ delete from fert_movimientos where estacion_id = pg_temp.real() and tipo = 'RECEPCION' $q$,
                     'borrar del libro (aun como dueño de la base): bloqueado', 'no se edita ni se borra');
select pg_temp.falla($q$ update fert_movimientos set cantidad = cantidad where estacion_id = pg_temp.real() and tipo = 'RECEPCION' $q$,
                     'editar el libro: bloqueado', 'no se edita ni se borra');

-- ---------------------------------------------------------------- AGL publica: no revive el turno archivado
select pg_temp.como(:AGL);
create temp table pub as select fn_fert_publicar(jsonb_build_object('temporada', (select temporada from turnos_ciclo where id = pg_temp.tc()),
    'turnos', jsonb_build_array(jsonb_build_object('agl_id', 'TR-QA-1', 'turno', 'T1001-T03', 'temporada', (select temporada from turnos_ciclo where id = pg_temp.tc()),
                                                   'estacion', 'Papalon-1', 'fecha_siembra', (select fecha_siembra from turnos_ciclo where id = pg_temp.tc()))),
    'plan', jsonb_build_array(jsonb_build_object('agl_id', 'TR-QA-1', 'filas', jsonb_build_array(
        jsonb_build_object('fecha', current_date, 'ddt', 1, 'material', 'QA-SOLCA', 'cantidad', 9)))))) as x;
select pg_temp.ok((select not activo and archivado_at is not null from turnos_ciclo where id = pg_temp.tc())
                  and not exists (select 1 from fert_plan where turno_ciclo_id = pg_temp.tc()),
                  'publicar desde AGL no reactiva el turno archivado ni le cambia el plan');
select pg_temp.ok((select x->>'avisos' like '%ciclo terminado%' from pub), 'y lo avisa');

-- ---------------------------------------------------------------- reactivar
select pg_temp.falla($q$ select fn_fert_restaurar_turno((select x - 'huella' || '{"huella": "otra"}' from p2)) $q$,
                     'restaurar con una copia que no es la del último cierre: rechazado', 'último cierre');
select pg_temp.falla($q$ select fn_fert_restaurar_turno((select jsonb_set(x, '{filas,fert_aplicaciones_detalle,0,cantidad}', '1') from p2)) $q$,
                     'restaurar con una copia alterada: no queda idéntica y no se restaura', 'idéntico');
select pg_temp.ok((select archivado_at is not null from turnos_ciclo where id = pg_temp.tc())
                  and (select s = pg_temp.saldos() from saldo_antes), 'tras los rechazos, sigue archivado y el saldo igual');

create temp table rs as select fn_fert_restaurar_turno((select x from p2)) as x;
select pg_temp.ok((select (x->>'restaurado')::boolean and x->'conteos' = (select x->'conteos' from p2) from rs), 'reactivado: mismos conteos');
select pg_temp.ok((select _fert_turno_filas(pg_temp.tc()) = x->'filas' from p2), 'LAS FILAS SON EXACTAMENTE LAS MISMAS (mismos id y cursor)');
select pg_temp.ok((select s = pg_temp.saldos() from saldo_antes), 'el saldo sigue igual');
select pg_temp.ok(not exists (select 1 from fert_movimientos where turno_ciclo_id = pg_temp.tc() and tipo = 'ARCHIVO_TURNO')
                  and not exists (select 1 from fert_operaciones where tipo = 'archivo_turno' and datos->>'agl_id' = 'TR-QA-1'),
                  'el consolidado se quitó');
select pg_temp.ok((select jsonb_array_length(x->'consolidado_quitado') = (select jsonb_array_length(x->'consolidado') from a1) from rs),
                  'y AGL recibe qué cursores quitar');
select pg_temp.ok((select resultado like 'ACEPTADO%' from fert_operaciones where id = '40000000-0000-0000-0000-000000000001'),
                  'el rechazo duplicado del reenvío dejó su lugar a la operación original');
select pg_temp.ok((select activo and archivado_at is null and restaurado_at is not null from turnos_ciclo where id = pg_temp.tc()),
                  'el turno vuelve a estar activo');
select pg_temp.ok((select (x->>'ya_estaba_activo')::boolean from (select fn_fert_restaurar_turno((select x from p2)) as x) y),
                  'restaurar otra vez: ya estaba activo (idempotente)');
select pg_temp.como(:E1);
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'turnos') t where (t->>'id')::uuid = pg_temp.tc()),
                  'el teléfono vuelve a ver el turno');
select fn_fert_sincronizar(jsonb_build_array(pg_temp.op('10200000-0000-4000-8000-0000000000d1', 'bitacora', jsonb_build_object(
    'estacion_id', pg_temp.real(), 'turno_ciclo_id', pg_temp.tc(), 'fecha', '2026-10-03', 'horas_riego', 1))));
select pg_temp.ok((select resultado like 'ACEPTADO%' from fert_operaciones where id = '10200000-0000-4000-8000-0000000000d1'),
                  'y se puede registrar de nuevo en él');

-- Segundo ciclo: archivar otra vez (con lo nuevo) y restaurar
select pg_temp.como(:AGL);
create temp table p3 as select fn_fert_exportar_turno('TR-QA-1') as x;
select pg_temp.ok((select (x->'conteos'->>'bitacora')::int = 3 from p3), 'segundo cierre: incluye lo registrado después de reactivar');
select fn_fert_archivar_turno('TR-QA-1', (select x->>'huella' from p3));
select pg_temp.ok((select s = pg_temp.saldos() from saldo_antes), 'segundo cierre: saldo igual');
select fn_fert_restaurar_turno((select x from p3));
select pg_temp.ok((select _fert_turno_filas(pg_temp.tc()) = x->'filas' from p3), 'segundo regreso: filas idénticas');

-- ---------------------------------------------------------------- el modo de pruebas sigue funcionando (y se borra)
select pg_temp.como(:ADM);
select fn_fert_pruebas_borrar();
select pg_temp.ok(not exists (select 1 from estaciones_riego where prueba_de is not null)
                  and not exists (select 1 from fert_aplicaciones where id = '10200000-0000-4000-8000-0000000000a2'),
                  'borrar el modo de pruebas sigue pudiendo borrar su libro');
select pg_temp.ok((select s = pg_temp.saldos() from saldo_antes), 'y lo real no cambió');

\echo '=== 102: TODAS LAS PRUEBAS PASARON ==='
