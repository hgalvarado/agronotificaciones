-- =====================================================================
-- PRUEBAS de sql/99 · cambios de la primera prueba piloto (réplica local con 91–98 y sus datos de prueba)
-- E2 = custodio de Papalon-1, E1 = compañero (recibe el relevo). Turno T1002-T36 (siembra 29-oct), DDT 12 = 10-nov.
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
create or replace function pg_temp.falla(p_sql text, p_msg text) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: %', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb) returns jsonb language sql as $$
    select jsonb_build_object('id', p_id, 'tipo', p_tipo, 'creado_en', now(), 'enviado_en', now(), 'inmediato', true,
        'dispositivo', 'prueba', 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2, 'precision', 8), 'datos', p_datos)
$$;
create or replace function pg_temp.sync1(p jsonb) returns jsonb language sql as
$$ select (public.fn_fert_sincronizar(jsonb_build_array(p)))->0 $$;
create or replace function pg_temp.est() returns uuid language sql as $$ select id from estaciones_riego where nombre = 'Papalon-1' $$;
create or replace function pg_temp.mat(p text) returns uuid language sql as $$ select id from materiales where codigo = p $$;
create or replace function pg_temp.t36() returns uuid language sql as $$ select '430302c1-3572-4c38-bdcf-155efb0983ab'::uuid $$;
create or replace function pg_temp.t37() returns uuid language sql as $$ select 'f82c3bac-cb61-4f37-b4a0-39e620c3e34b'::uuid $$;
create or replace function pg_temp.senv(p uuid) returns integer language sql as
$$ select public._fert_saldo_envase(pg_temp.est(), p) $$;
set client_min_messages = notice;

-- Administrador de la prueba
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T99_ADM', 'P99 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T99_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000009901', 'adm@99') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000009901', 'Admin 99', r, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000009901', r) on conflict do nothing;
end $$;

\set E1 '''00000000-0000-0000-0000-0000000000e1'''
\set E2 '''00000000-0000-0000-0000-0000000000e2'''
\set ADM '''00000000-0000-0000-0000-000000009901'''
\set BARRIL '''99000000-0000-4000-8000-000000000001'''
\set CANECA '''99000000-0000-4000-8000-000000000002'''

-- 0 · Nada cambia para lo que ya existía
select pg_temp.ok((select count(*) from materiales where origen = 'MARA') = (select count(*) from materiales), 'todo material existente queda como MARA');
select pg_temp.ok(not exists (select 1 from materiales where fertirriego and not fert_analisis), 'lo publicado hasta hoy (plan) queda como fertilizante');

-- 1 · Producto de campo (sin MARA) y tipo de envase nuevo, creados por el estacionero
select pg_temp.como(:E2);
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-0000000000a1', 'producto',
        '{"material_id":"99000000-0000-4000-8000-0000000000a1","descripcion":"Radio portátil","unidad":"UN","grupo":"Otros objetos"}'))->>'estado'
        like 'ACEPTADO%', 'el estacionero crea un producto de campo');
select pg_temp.ok((select origen = 'CAMPO' and not activo and fertirriego and not validado and not fert_analisis and codigo = 'CAMPO-99000000'
                   and grupo = 'Otros objetos' from materiales where id = '99000000-0000-4000-8000-0000000000a1'),
                  'queda CAMPO, por validar, inactivo para otros módulos, nunca fertilizante');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'materiales') x
                          where x->>'id' = '99000000-0000-4000-8000-0000000000a1' and x->>'origen' = 'CAMPO'),
                  'el teléfono lo recibe en su lista');
select pg_temp.ok((fn_fert_estado_campo()->'materiales'->0->>'analisis')::boolean, 'los fertilizantes van primero en la lista');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-0000000000b1', 'envase_tipo',
        '{"envase_id":"99000000-0000-4000-8000-0000000000b1","nombre":"Tanque azul"}'))->>'estado' like 'ACEPTADO%',
        'el estacionero agrega un tipo de envase');
select pg_temp.ok((select not validado from fert_envases_tipos where id = '99000000-0000-4000-8000-0000000000b1'), 'el envase nuevo queda por validar');
select pg_temp.ok(jsonb_array_length(fn_fert_estado_campo()->'envases_tipos') = 3, 'el teléfono ve Barril, Caneca y Tanque azul');

-- 2 · Recibir: turnos, comentario, productos (MARA y de campo) y envases
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000101', 'recepcion', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'fecha_hora', now() - interval '1 hour', 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'turnos', jsonb_build_array(pg_temp.t36(), pg_temp.t37(), gen_random_uuid()),
        'comentario', 'Un barril llegó golpeado',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('100019'), 'cantidad', 10),
                                    jsonb_build_object('material_id', '99000000-0000-4000-8000-0000000000a1', 'cantidad', 2)),
        'envases', jsonb_build_array(jsonb_build_object('envase_id', :BARRIL, 'recibidos', 5, 'entregados', 3)))))->>'estado'
        like 'ACEPTADO%', 'recepción con turnos, comentario, producto de campo y envases');
select pg_temp.ok((select cardinality(turnos) = 2 and comentario = 'Un barril llegó golpeado' from fert_recepciones
                   where id = '99000000-0000-4000-8000-000000000101'), 'guarda los 2 turnos que existen (ignora el desconocido) y el comentario');
select pg_temp.ok(pg_temp.senv(:BARRIL) = 2, 'barriles: 5 recibidos − 3 entregados = 2 en la estación');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'recepciones') r,
                                       jsonb_array_elements(r->'envases') e
                          where r->>'id' = '99000000-0000-4000-8000-000000000101'
                            and (e->>'recibidos')::int = 5 and (e->>'entregados')::int = 3 and jsonb_array_length(r->'turnos') = 2),
                  'el teléfono ve los envases y turnos de la recepción');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'envases_saldos') s
                          where s->>'envase_id' = :BARRIL and (s->>'saldo')::int = 2), 'el teléfono ve el saldo de envases');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000102', 'recepcion', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'envases', jsonb_build_array(jsonb_build_object('envase_id', :CANECA, 'entregados', 1)))))->>'estado'
        like 'ACEPTADO%', 'una visita solo de envases (devolvió una caneca) se puede registrar');
select pg_temp.ok((pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000103', 'recepcion', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'chofer_id', '10000000-0000-0000-0000-000000000001', 'lineas', '[]'::jsonb,
        'envases', jsonb_build_array(jsonb_build_object('envase_id', :CANECA, 'recibidos', '', 'entregados', 0)))))->>'estado') = 'RECHAZADO',
        'una recepción vacía se rechaza');
select pg_temp.ok((pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000104', 'recepcion', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'envases', jsonb_build_array(jsonb_build_object('envase_id', :BARRIL, 'recibidos', 1.5)))))->>'estado') = 'RECHAZADO',
        'envases con decimales se rechazan');

-- 3 · Anular la recepción revierte sus envases
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000105', 'anulacion',
        jsonb_build_object('documento_tipo', 'recepcion', 'documento_id', '99000000-0000-4000-8000-000000000101', 'motivo', 'prueba')))->>'estado'
        like 'ACEPTADO%', 'se anula la recepción');
select pg_temp.ok(pg_temp.senv(:BARRIL) = 0, 'al anular, los barriles vuelven a 0');

-- 4 · Aplicar con DDT del plan (antes, producto en bodega)
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000106', 'recepcion', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('100019'), 'cantidad', 50),
                                    jsonb_build_object('material_id', pg_temp.mat('101478'), 'cantidad', 300),
                                    jsonb_build_object('material_id', pg_temp.mat('QA-SOLCA'), 'cantidad', 10)))))->>'estado'
        like 'ACEPTADO%', 'llega producto a la bodega');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000201', 'aplicacion', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'turno_ciclo_id', pg_temp.t36(), 'fecha', '2026-11-11', 'ddt_plan', 12, 'fecha_plan', '2026-11-10',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('100019'), 'cantidad', 14),
                                    jsonb_build_object('material_id', pg_temp.mat('101478'), 'cantidad', 1)))))->>'estado'
        like 'ACEPTADO%', 'aplicación del DDT 12');
select pg_temp.ok((select ddt_plan = 12 and fecha_plan = '2026-11-10' and not extra and ddt_real = 13
                   from fert_aplicaciones where id = '99000000-0000-4000-8000-000000000201'), 'guarda DDT plan 12 y calcula DDT real 13');
select pg_temp.ok((select en_plan from fert_aplicaciones_detalle where aplicacion_id = '99000000-0000-4000-8000-000000000201'
                   and material_id = pg_temp.mat('100019')), 'producto del DDT 12: en plan');
select pg_temp.ok((select not en_plan from fert_aplicaciones_detalle where aplicacion_id = '99000000-0000-4000-8000-000000000201'
                   and material_id = pg_temp.mat('101478')), 'producto de OTRO DDT (15): fuera del plan de ese día');
select pg_temp.ok((select 'FUERA_DE_PLAN' = any(observaciones) from fert_operaciones where id = '99000000-0000-4000-8000-000000000201'),
                  'marcado FUERA_DE_PLAN');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000202', 'aplicacion', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'turno_ciclo_id', pg_temp.t36(), 'fecha', '2026-11-11', 'ddt_plan', 15,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('101478'), 'cantidad', 200)))))->>'estado'
        like 'ACEPTADO%', 'aplicación con solo el DDT (sin fecha)');
select pg_temp.ok((select fecha_plan = '2026-11-13' from fert_aplicaciones where id = '99000000-0000-4000-8000-000000000202'),
                  'la base completa la fecha del plan desde el DDT');

-- 5 · Aplicación extra
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000203', 'aplicacion', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'turno_ciclo_id', pg_temp.t36(), 'fecha', '2026-11-11', 'extra', true, 'ddt_plan', 12,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('QA-SOLCA'), 'cantidad', 3)))))->>'estado'
        like 'ACEPTADO%', 'aplicación extra');
select pg_temp.ok((select extra and ddt_plan is null and fecha_plan is null and ddt_real = 13 from fert_aplicaciones
                   where id = '99000000-0000-4000-8000-000000000203'), 'extra: sin DDT plan, con DDT real');
select pg_temp.ok((select not ('FUERA_DE_PLAN' = any(observaciones)) from fert_operaciones where id = '99000000-0000-4000-8000-000000000203'),
                  'extra declarada: no se marca FUERA_DE_PLAN');

-- 6 · Teléfono viejo (sin DDT ni extra): igual que antes
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000204', 'aplicacion', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'turno_ciclo_id', pg_temp.t36(), 'fecha', '2026-11-11',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', pg_temp.mat('101478'), 'cantidad', 1)))))->>'estado'
        like 'ACEPTADO%', 'aplicación de un teléfono viejo');
select pg_temp.ok((select ddt_plan is null and not extra and ddt_real = 13 from fert_aplicaciones where id = '99000000-0000-4000-8000-000000000204')
                  and (select en_plan from fert_aplicaciones_detalle where aplicacion_id = '99000000-0000-4000-8000-000000000204'),
                  'teléfono viejo: en plan si el producto está en cualquier día del plan (como antes)');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'aplicaciones') a
                          where a->>'id' = '99000000-0000-4000-8000-000000000201' and (a->>'ddt_plan')::int = 12 and (a->>'ddt_real')::int = 13),
                  'el teléfono ve DDT plan y real');

-- 7 · Horas con cloro
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000301', 'bitacora', jsonb_build_object(
        'turno_ciclo_id', pg_temp.t36(), 'fecha', '2026-11-11', 'horas_riego', 3, 'ppm_cloro_cabezal', '1.5', 'ppm_cloro_campo', 0.8)))->>'estado'
        like 'ACEPTADO%', 'horas con ppm de cloro');
select pg_temp.ok((select ppm_cloro_cabezal = 1.5 and ppm_cloro_campo = 0.8 and horas_riego = 3 from fert_bitacora_riego
                   where turno_ciclo_id = pg_temp.t36() and fecha = '2026-11-11'), 'guarda las ppm');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000302', 'bitacora', jsonb_build_object(
        'turno_ciclo_id', pg_temp.t36(), 'fecha', '2026-11-11', 'horas_fertilizacion', 1)))->>'estado' like 'ACEPTADO%', 'otra vez sin ppm');
select pg_temp.ok((select ppm_cloro_cabezal = 1.5 and horas_fertilizacion = 1 from fert_bitacora_riego
                   where turno_ciclo_id = pg_temp.t36() and fecha = '2026-11-11'), 'no borra las ppm ya guardadas');
select pg_temp.ok((pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000303', 'bitacora', jsonb_build_object(
        'turno_ciclo_id', pg_temp.t36(), 'fecha', '2026-11-11', 'ppm_cloro_campo', 2000)))->>'estado') = 'RECHAZADO', 'ppm fuera de rango se rechaza');

-- 8 · Conteo de envases
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000401', 'conteo', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'envases', jsonb_build_array(jsonb_build_object('envase_id', :BARRIL, 'cantidad_real', 4),
                                                                  jsonb_build_object('envase_id', :CANECA, 'cantidad_real', '')))))->>'estado'
        like 'ACEPTADO%', 'conteo solo de envases');
select pg_temp.ok(pg_temp.senv(:BARRIL) = 4 and pg_temp.senv(:CANECA) = -1, 'barriles ajustados a 4; caneca sin contar no cambia');

-- 9 · Relevo de noche con código de 12 horas
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000501', 'relevo_entregar',
        jsonb_build_object('estacion_id', pg_temp.est(), 'nota', 'Me voy, queda el T36 preparado')))->>'estado' like 'ACEPTADO%',
        'el de noche entrega la estación');
create temp table cod as
select public.fn_fert_codigo_largo(secreto, floor(extract(epoch from now() - interval '5 hours') / 600)::bigint) as hace5h,
       public.fn_fert_codigo_largo(secreto, floor(extract(epoch from now() - interval '13 hours') / 600)::bigint) as hace13h
from fert_llaves where perfil_id = :E2;
select pg_temp.ok((select hace5h ~ '^\d{8}$' from cod), 'el código de entrega tiene 8 dígitos');
select pg_temp.ok(fn_fert_codigo_largo_valido(:E2, (select hace5h from cod), now()), 'un código de hace 5 horas vale');
select pg_temp.ok(not fn_fert_codigo_largo_valido(:E2, (select hace13h from cod), now()), 'uno de hace 13 horas ya no vale');
select pg_temp.ok(not fn_fert_codigo_largo_valido(:E1, (select hace5h from cod), now()), 'el código de otra persona no vale');
select pg_temp.como(:E1);
select pg_temp.ok((pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000502', 'relevo_recibir', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'entrega_id', :E2, 'metodo', 'CODIGO_LARGO', 'codigo', (select hace13h from cod),
        'momento_codigo', now())))->>'estado') = 'RECHAZADO', 'con un código vencido no se recibe');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000503', 'relevo_recibir', jsonb_build_object(
        'estacion_id', pg_temp.est(), 'entrega_id', :E2, 'metodo', 'CODIGO_LARGO', 'codigo', (select hace5h from cod),
        'momento_codigo', now())))->>'estado' like 'ACEPTADO%', 'el de la mañana recibe con el código que le dejaron');
select pg_temp.ok((select custodio_id = :E1 and estado = 'ACTIVA' from fert_custodia where estacion_id = pg_temp.est()), 'la estación queda a cargo del de la mañana');
select pg_temp.ok((select metodo = 'CODIGO_LARGO' and codigo_verificado and estado = 'RECIBIDO' from fert_relevos where id = '99000000-0000-4000-8000-000000000501'),
                  'el relevo queda RECIBIDO con código largo verificado');
select pg_temp.ok((select not (datos ? 'codigo') from fert_operaciones where id = '99000000-0000-4000-8000-000000000503'), 'el código no se guarda');

-- 10 · AGL: publicar con grupo/fertilizante y exportar
select pg_temp.como(:ADM);
select fn_fert_publicar('{"materiales":[{"codigo":"QA-SURROUND","descripcion":"Surround","unidad":"KG","grupo":"Protectores","analisis":false},
                                       {"codigo":"100019","grupo":"Fertilizantes","analisis":true},
                                       {"codigo":"CAMPO-99000000","descripcion":"no debe tocarlo"}]}'::jsonb);
select pg_temp.ok((select not fert_analisis and grupo = 'Protectores' and origen = 'MARA' and fertirriego from materiales where codigo = 'QA-SURROUND'),
                  'AGL publica Surround como «Protectores», no fertilizante');
select pg_temp.ok((select descripcion = 'Radio portátil' from materiales where codigo = 'CAMPO-99000000'), 'AGL no toca los productos de campo');
create temp table ex as select fn_fert_exportar(0, 20000) as x;
select pg_temp.ok(exists (select 1 from ex, jsonb_array_elements(x->'movimientos') m
                          where m->>'documento_id' = '99000000-0000-4000-8000-000000000201' and (m->>'ddt_plan')::int = 12
                            and (m->>'ddt_real')::int = 13 and m->>'origen' = 'MARA' and (m->>'analisis')::boolean),
                  'AGL baja DDT plan/real, origen y si es fertilizante');
select pg_temp.ok(exists (select 1 from ex, jsonb_array_elements(x->'movimientos') m
                          where m->>'material' = 'CAMPO-99000000' and m->>'origen' = 'CAMPO' and not (m->>'analisis')::boolean),
                  'AGL ve el producto de campo marcado CAMPO (no entra al análisis)');
select pg_temp.ok(exists (select 1 from ex, jsonb_array_elements(x->'movimientos') m
                          where m->>'documento_id' = '99000000-0000-4000-8000-000000000101' and jsonb_array_length(m->'recepcion_turnos') = 2
                            and m->>'comentario' = 'Un barril llegó golpeado'), 'AGL ve turnos y comentario de la recepción');
select pg_temp.ok(exists (select 1 from ex, jsonb_array_elements(x->'bitacora_riego') b where (b->>'ppm_cloro_cabezal')::numeric = 1.5),
                  'AGL ve las ppm de cloro');
select pg_temp.ok(exists (select 1 from ex, jsonb_array_elements(x->'envases_saldos') s where s->>'envase' = 'Barril' and (s->>'saldo')::int = 4),
                  'AGL ve el saldo de envases');

-- 11 · Administración de catálogos de campo
select pg_temp.como(:E2);
select pg_temp.falla($q$ select fn_fert_catalogos_campo() $q$, 'un estacionero no administra catálogos');
select pg_temp.como(:ADM);
select pg_temp.ok(jsonb_array_length(fn_fert_catalogos_campo()->'productos') = 1, 'el administrador ve el producto de campo');
insert into fert_choferes (id, nombre) values ('99000000-0000-4000-8000-0000000000c1', 'juan chofer (repetido)') on conflict do nothing;
update fert_recepciones set chofer_id = '99000000-0000-4000-8000-0000000000c1' where id = '99000000-0000-4000-8000-000000000102';
select fn_fert_unir_chofer('99000000-0000-4000-8000-0000000000c1', '10000000-0000-0000-0000-000000000001');
select pg_temp.ok((select chofer_id = '10000000-0000-0000-0000-000000000001' from fert_recepciones where id = '99000000-0000-4000-8000-000000000102')
                  and (select not activo from fert_choferes where id = '99000000-0000-4000-8000-0000000000c1'),
                  'unir choferes: la recepción pasa al que se deja y el repetido se desactiva');
select fn_fert_unir_envase('99000000-0000-4000-8000-0000000000b1', :CANECA);
select pg_temp.ok((select not activo from fert_envases_tipos where id = '99000000-0000-4000-8000-0000000000b1'), 'unir envases');
select pg_temp.ok(pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000601', 'producto',
        '{"material_id":"99000000-0000-4000-8000-0000000000a1","descripcion":"Radio Motorola","validado":true}'))->>'estado' like 'ACEPTADO%',
        'el administrador corrige y valida el producto de campo');
select pg_temp.ok((select descripcion = 'Radio Motorola' and validado from materiales where id = '99000000-0000-4000-8000-0000000000a1'), 'producto corregido');
select pg_temp.ok((pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000602', 'producto',
        '{"material_id":"99000000-0000-4000-8000-0000000000a1","activo":false}'))->>'estado') like 'ACEPTADO%'
        or exists (select 1 from fert_saldos where material_id = '99000000-0000-4000-8000-0000000000a1' and disponible <> 0),
        'quitar un producto: solo sin saldo');
select pg_temp.ok((pg_temp.sync1(pg_temp.op('99000000-0000-4000-8000-000000000603', 'producto',
        jsonb_build_object('material_id', pg_temp.mat('100019'), 'descripcion', 'otro')))->>'estado') = 'RECHAZADO',
        'un producto de MARA no se corrige aquí');

-- 12 · Modo de pruebas: borrar lo de prueba también se lleva sus envases
select fn_fert_pruebas_activar(array[pg_temp.est()], array[:E1::uuid]);
select pg_temp.como(:E1);
insert into fert_envases_movimientos (estacion_id, envase_id, cantidad, motivo, documento_tipo, documento_id, fecha_hora, registrado_por)
select id, :BARRIL, 7, 'RECEPCION', 'recepcion', gen_random_uuid(), now(), :E1 from estaciones_riego where prueba_de = pg_temp.est();
select pg_temp.como(:ADM);
select fn_fert_pruebas_borrar();
select pg_temp.ok(not exists (select 1 from fert_envases_movimientos where cantidad = 7), 'borrar lo de prueba se lleva sus envases');
select pg_temp.ok(pg_temp.senv(:BARRIL) = 4, 'los envases reales no se tocan');

\echo '=== 99: TODAS LAS PRUEBAS PASARON ==='
