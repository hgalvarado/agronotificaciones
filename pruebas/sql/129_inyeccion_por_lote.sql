-- =====================================================================
-- PRUEBAS de sql/129 · Inyección / Drench / Calidad por lote
-- Réplica local con 91–128 y los datos de prueba de 96/99/115 (E1/E2, Papalon-1, QA-SOLCA, 101478).
-- Correr DESDE LA RAÍZ DEL REPO (usa \i) con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/129_inyeccion_por_lote.sql
-- Al final repite la 129 y la corre en otros órdenes (128>129>128, 116>129>116, 121>129, 129>121, 102>129>102).
-- NO ejecutada todavía (la corre Opus, Task 6 del plan).
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('129a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.saldo(p_est uuid, p_mat uuid) returns numeric language sql as $$
    select coalesce((select disponible from fert_saldos where estacion_id = p_est and material_id = p_mat), 0) $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint; r2 smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T129_ADM', 'P129 Admin', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, acceso_total) values ('T129_SIN', 'P129 Sin permisos', false) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T129_ADM';
    select id into r2 from roles where codigo = 'T129_SIN';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000012901', 'adm@129') on conflict do nothing;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000012902', 'sin@129') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000012901', 'Admin 129', r, true) on conflict (id) do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000012902', 'Sin permisos 129', r2, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000012901', r) on conflict do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000012902', r2) on conflict do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    (select id from materiales where codigo = '101478') as b,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1, '00000000-0000-0000-0000-0000000000e2'::uuid as e2,
    '00000000-0000-0000-0000-000000012901'::uuid as adm, '00000000-0000-0000-0000-000000012902'::uuid as sin;

create or replace function pg_temp.l(p_mat uuid, p_cant numeric) returns jsonb language sql as $$
    select jsonb_build_object('material_id', p_mat, 'cantidad', p_cant) $$;
-- publicación base: una categoría activa, un lote con plan de A y B (DDT 5, hoy), otro turno/cohorte del mismo lote (DDT 5, hace 20 días)
create or replace function pg_temp.pub(p_categorias jsonb) returns jsonb language sql as $$
    select fn_iny_publicar(jsonb_build_object('temporada', 'Temp 26-27', 'completo', true, 'categorias', p_categorias,
        'materiales', jsonb_build_array(
            jsonb_build_object('codigo', 'QA-SOLCA', 'ingrediente_activo', 'Abamectina', 'carencia_dias', 3),
            jsonb_build_object('codigo', '101478')),
        'plan', jsonb_build_array(
            jsonb_build_object('temporada', 'Temp 26-27', 'ciclo', 'Ciclo 1', 'turno_agl_id', 'T-INY-1', 'turno', 'T-INY-1',
                'estacion', 'Papalon-1', 'lote', 'L129-1', 'categoria_clave', 'ferti-riego|inyeccion', 'ddt', 5,
                'fecha_plan', pg_temp.hoy(), 'material', 'QA-SOLCA', 'dosis_mz', 2, 'area_mz', 5, 'cantidad_plan', 10),
            jsonb_build_object('temporada', 'Temp 26-27', 'ciclo', 'Ciclo 1', 'turno_agl_id', 'T-INY-1', 'turno', 'T-INY-1',
                'estacion', 'Papalon-1', 'lote', 'L129-1', 'categoria_clave', 'ferti-riego|inyeccion', 'ddt', 5,
                'fecha_plan', pg_temp.hoy(), 'material', '101478', 'dosis_mz', 0.4, 'area_mz', 5, 'cantidad_plan', 2),
            jsonb_build_object('temporada', 'Temp 26-27', 'ciclo', 'Ciclo 1', 'turno_agl_id', 'T-INY-0', 'turno', 'T-INY-0',
                'estacion', 'Papalon-1', 'lote', 'L129-1', 'categoria_clave', 'ferti-riego|inyeccion', 'ddt', 5,
                'fecha_plan', pg_temp.hoy() - 20, 'material', 'QA-SOLCA', 'dosis_mz', 2, 'area_mz', 3, 'cantidad_plan', 6))))
$$;
create or replace function pg_temp.apl(p_id uuid, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'aplicacion_lote', jsonb_build_object('estacion_id', (select est from k), 'lote', 'L129-1',
        'categoria_clave', 'ferti-riego|inyeccion', 'temporada', 'Temp 26-27', 'area_mz', 5, 'objetivos', jsonb_build_array('PLAGA'),
        'fecha_hora', now() - make_interval(days => p_dias_atras)) || p_datos, p_dias_atras)
$$;

-- ---------------------------------------------------------------- 0 · estructura, pantalla y permisos
select pg_temp.ok((select ruta = '/inyeccion' and not en_menu and modulo = 'Campo' and acciones = array['ver', 'registrar', 'anular', 'configurar']
                     from pantallas where codigo = 'inyeccion'), 'la pantalla «inyeccion» existe (módulo Campo, fuera del menú, 4 acciones)');
select pg_temp.ok(not exists (select 1 from permisos pm where pm.recurso = 'fertirriego' and pm.accion = 'aplicar' and pm.permitido
                              and not exists (select 1 from permisos c where c.rol_id = pm.rol_id and c.recurso = 'inyeccion' and c.accion in ('ver') )),
                  'todo rol con fertirriego · aplicar tiene inyeccion · ver');
select pg_temp.ok(not exists (select 1 from permisos where recurso = 'inyeccion' and accion = 'configurar'), '«configurar» no se concede a ningún rol');
select pg_temp.ok(exists (select 1 from information_schema.columns where table_name = 'materiales' and column_name = 'iny_activo')
                  and exists (select 1 from information_schema.columns where table_name = 'materiales' and column_name = 'carencia_dias'),
                  'materiales trae las columnas nuevas');
select pg_temp.ok(exists (select 1 from pg_constraint where conrelid = 'public.fert_movimientos'::regclass and pg_get_constraintdef(oid) like '%APLICACION_LOTE%'
                          and pg_get_constraintdef(oid) like '%DEVOLUCION_BODEGA%'),
                  'el check de tipo admite APLICACION_LOTE y conserva DEVOLUCION_BODEGA');

-- ---------------------------------------------------------------- 1 · custodia, saldo y publicación
select pg_temp.como((select adm from k));
do $$
declare v_est uuid := (select est from k);
begin
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 129');
    end if;
    update fert_custodia set desde = now() - interval '2 days' where estacion_id = v_est;
end $$;
select pg_temp.como((select e1 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(1), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'fecha_hora', now() - interval '1 hour', 'lineas', jsonb_build_array(pg_temp.l((select a from k), 100), pg_temp.l((select b from k), 100))))->>'estado')
        like 'ACEPTADO%', 'recepción de 100 y 100 (saldo de partida)');
create temp table s0 as select pg_temp.saldo((select est from k), (select a from k)) as a, pg_temp.saldo((select est from k), (select b from k)) as b;

select pg_temp.como((select adm from k));
select pg_temp.pub('[{"clave":"ferti-riego|inyeccion","departamento":"Ferti-Riego","categoria":"Inyección","tipo":"inyeccion","etiqueta":"Inyección","activo":true}]'::jsonb);
select pg_temp.ok((select count(*) = 3 from iny_plan where turno_agl_id in ('T-INY-1', 'T-INY-0')), 'se publicaron 3 líneas de plan');
select pg_temp.ok((select iny_activo and fertirriego and not fert_analisis and ingrediente_activo = 'Abamectina' and carencia_dias = 3 from materiales where codigo = 'QA-SOLCA'),
                  'QA-SOLCA: iny_activo, fertirriego, sin análisis, con ingrediente activo y carencia');
select pg_temp.ok((select plagas_controla is null and carencia_dias is null from materiales where codigo = '101478'), '101478: datos técnicos vacíos = NULL (sin dato)');
select pg_temp.pub('[{"clave":"ferti-riego|inyeccion","departamento":"Ferti-Riego","categoria":"Inyección","tipo":"inyeccion","etiqueta":"Inyección","activo":true}]'::jsonb);
select pg_temp.ok((select count(*) = 3 from iny_plan where turno_agl_id in ('T-INY-1', 'T-INY-0')), 'publicar dos veces: idempotente (siguen 3 líneas)');
select pg_temp.ok(jsonb_array_length(fn_iny_estado_campo()->'categorias') >= 1 and jsonb_array_length(fn_iny_estado_campo()->'plan') >= 3
                  and fn_iny_estado_campo()->'permisos'->>'registrar' = 'true', 'fn_iny_estado_campo trae categorías, plan y permisos');

-- ---------------------------------------------------------------- 2 · aplicar con plan
select pg_temp.como((select e1 from k));
create temp table a1 as select pg_temp.apl(pg_temp.uid(11), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select a from k), 10), pg_temp.l((select b from k), 2)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from a1), 'aplicar 2 productos en el lote con área 5: aceptada: ' || (select r::text from a1));
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0) - 10
                  and pg_temp.saldo((select est from k), (select b from k)) = (select b from s0) - 2, 'los saldos bajan 10 y 2');
select pg_temp.ok((select dosis_mz = 2 and en_plan and ddt_plan = 5 from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(11) and material_id = (select a from k)),
                  'dosis/mz = cantidad ÷ 5, en_plan y ddt_plan = 5');
select pg_temp.ok((select count(*) = 2 and sum(cantidad) = -12 from fert_movimientos where documento_id = pg_temp.uid(11) and tipo = 'APLICACION_LOTE'
                   and turno_ciclo_id is null and documento_tipo = 'aplicacion_lote'), 'dos movimientos APLICACION_LOTE sin turno');
select pg_temp.ok((select turno_agl_id = 'T-INY-1' and ciclo = 'Ciclo 1' and objetivos = array['PLAGA'] and fecha = pg_temp.hoy() from iny_aplicaciones where id = pg_temp.uid(11)),
                  'hereda turno y ciclo del plan más cercano (cohorte de hoy, no la de hace 20 días)');

-- ---------------------------------------------------------------- 3 · sin plan, líneas en 0 y rechazos
create temp table s1 as select pg_temp.saldo((select est from k), (select a from k)) as a, (select count(*) from fert_movimientos) as movs;
create temp table a2 as select pg_temp.apl(pg_temp.uid(12), jsonb_build_object('lote', 'L129-SINPLAN', 'lineas', jsonb_build_array(pg_temp.l((select a from k), 1), pg_temp.l((select b from k), 0)))) as r;
select pg_temp.ok((select r->>'estado' = 'ACEPTADO_CON_OBSERVACIONES' and r::text like '%SIN_PLAN%' from a2), 'lote sin plan: se guarda con SIN_PLAN');
select pg_temp.ok((select count(*) = 1 and bool_and(not en_plan) from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(12)), 'en_plan = false y la línea en 0 se ignora');
create temp table a3 as select pg_temp.apl(pg_temp.uid(13), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select a from k), 0)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%al menos un producto%' from a3), 'todas en 0: «Indica al menos un producto.»');
create temp table a4 as select pg_temp.apl(pg_temp.uid(14), jsonb_build_object('area_mz', 0, 'lineas', jsonb_build_array(pg_temp.l((select a from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%área cubierta%' from a4), 'área 0: «Indica el área cubierta.»');
create temp table a5 as select pg_temp.apl(pg_temp.uid(15), jsonb_build_object('area_mz', null, 'lineas', jsonb_build_array(pg_temp.l((select a from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%área cubierta%' from a5), 'área vacía: rechazada');
create temp table a6 as select pg_temp.apl(pg_temp.uid(16), jsonb_build_object('objetivos', '[]'::jsonb, 'lineas', jsonb_build_array(pg_temp.l((select a from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%objetivo%' from a6), 'sin objetivo: rechazada');
create temp table a7 as select pg_temp.apl(pg_temp.uid(17), jsonb_build_object('objetivos', jsonb_build_array('VIRUS'), 'lineas', jsonb_build_array(pg_temp.l((select a from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Objetivo no válido%' from a7), 'objetivo fuera de la lista: rechazada');
create temp table a8 as select pg_temp.apl(pg_temp.uid(18), jsonb_build_object('area_mz', 50, 'lineas', jsonb_build_array(pg_temp.l((select a from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%mayor que el área del lote%' from a8), 'área mayor que el lote (5 + 3): rechazada en línea');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s1) - 1, 'los rechazos no movieron nada (solo la de sin plan, −1)');
select pg_temp.ok(not exists (select 1 from iny_aplicaciones where id in (pg_temp.uid(13), pg_temp.uid(14), pg_temp.uid(15), pg_temp.uid(16), pg_temp.uid(17), pg_temp.uid(18))),
                  'ni dejaron documentos');
create temp table a9 as select pg_temp.apl(pg_temp.uid(19), jsonb_build_object('area_mz', 50, 'lineas', jsonb_build_array(pg_temp.l((select b from k), 1))), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%AREA_MAYOR_AL_LOTE%' from a9), 'área mayor llegada tarde (sin señal): se acepta con AREA_MAYOR_AL_LOTE');

-- ---------------------------------------------------------------- 4 · saldo
create temp table a10 as select pg_temp.apl(pg_temp.uid(21), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select a from k), 99999)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%No alcanza el saldo%' from a10), 'sin saldo en línea: rechazada con el saldo en el mensaje');
create temp table a11 as select pg_temp.apl(pg_temp.uid(22), jsonb_build_object('acepta_negativo', true, 'lineas', jsonb_build_array(pg_temp.l((select a from k), 99999))), 1) as r;
select pg_temp.ok((select r->>'estado' = 'ACEPTADO_CON_OBSERVACIONES' and r::text like '%SALDO_NEGATIVO%' from a11), 'con «aplicar sin inventario» (no inmediata): pasa con SALDO_NEGATIVO');

-- ---------------------------------------------------------------- 5 · idempotencia
create temp table s2 as select (select count(*) from fert_movimientos where documento_id = pg_temp.uid(11)) as movs, pg_temp.saldo((select est from k), (select a from k)) as a;
create temp table a12 as select pg_temp.apl(pg_temp.uid(11), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select a from k), 10), pg_temp.l((select b from k), 2)))) as r;
select pg_temp.ok((select count(*) = 1 from iny_aplicaciones where id = pg_temp.uid(11)) and (select count(*) = (select movs from s2) from fert_movimientos where documento_id = pg_temp.uid(11))
                  and pg_temp.saldo((select est from k), (select a from k)) = (select a from s2), 'mismo UUID dos veces: una aplicación, un movimiento por producto, mismo saldo');

-- ---------------------------------------------------------------- 6 · custodia y permisos
select pg_temp.como((select adm from k));
create temp table a13 as select pg_temp.apl(pg_temp.uid(31), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select b from k), 1))), 1) as r;
select pg_temp.ok((select r->>'estado' = 'ACEPTADO_CON_OBSERVACIONES' and r::text like '%FUERA_DE_CUSTODIA%' from a13), 'sin la estación a cargo (sin señal): FUERA_DE_CUSTODIA');
select pg_temp.como((select sin from k));
create temp table a14 as select pg_temp.apl(pg_temp.uid(32), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select b from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from a14), 'sin inyeccion · registrar: rechazada');
select pg_temp.ok(not exists (select 1 from iny_aplicaciones where id = pg_temp.uid(32)), 'y no deja nada');

-- ---------------------------------------------------------------- 7 · categoría desactivada
select pg_temp.como((select adm from k));
select pg_temp.pub('[]'::jsonb);
select pg_temp.ok((select not activo from iny_categorias where clave = 'ferti-riego|inyeccion') and (select count(*) = 3 from iny_plan where turno_agl_id in ('T-INY-1', 'T-INY-0')),
                  'una categoría que deja de venir queda activo = false y su plan NO se borra');
select pg_temp.ok(jsonb_array_length(fn_iny_estado_campo()->'categorias') = 0
                  and not exists (select 1 from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'categoria_clave' = 'ferti-riego|inyeccion'),
                  'el teléfono ya no recibe la categoría ni su plan');
select pg_temp.como((select e1 from k));
create temp table a15 as select pg_temp.apl(pg_temp.uid(41), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select b from k), 1))), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%CATEGORIA_INACTIVA%' from a15), 'registro sin señal con la categoría vieja: se acepta con CATEGORIA_INACTIVA');
select pg_temp.ok((select count(*) >= 1 from jsonb_array_elements(fn_iny_estado_campo()->'aplicaciones') x where x->>'id' = pg_temp.uid(11)::text),
                  'lo ya aplicado se sigue mostrando');
select pg_temp.como((select adm from k));
select pg_temp.pub('[{"clave":"ferti-riego|inyeccion","departamento":"Ferti-Riego","categoria":"Inyección","tipo":"inyeccion","etiqueta":"Inyección","activo":true}]'::jsonb);
select pg_temp.ok((select activo from iny_categorias where clave = 'ferti-riego|inyeccion'), 'reactivarla recupera su plan');

-- ---------------------------------------------------------------- 8 · anular
select pg_temp.como((select adm from k));
create temp table s3 as select pg_temp.saldo((select est from k), (select a from k)) as a;
create temp table an1 as select pg_temp.op(pg_temp.uid(51), 'anulacion', jsonb_build_object('estacion_id', (select est from k), 'documento_tipo', 'aplicacion_lote',
        'documento_id', pg_temp.uid(11), 'motivo', 'Se aplicó por error')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an1), 'quien tiene «Anular» anula la aplicación por lote: ' || (select r::text from an1));
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s3) + 10, 'el saldo se repone (+10)');
select pg_temp.ok((select anulado_at is not null and motivo_anulacion = 'Se aplicó por error' from iny_aplicaciones where id = pg_temp.uid(11)), 'queda anulada con su motivo');
create temp table an2 as select pg_temp.op(pg_temp.uid(52), 'anulacion', jsonb_build_object('estacion_id', (select est from k), 'documento_tipo', 'aplicacion_lote',
        'documento_id', pg_temp.uid(11), 'motivo', 'Otra vez')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%ya estaba anulado%' from an2), '2.ª anulación: rechazo claro');
create temp table an3 as select pg_temp.op(pg_temp.uid(53), 'anulacion', jsonb_build_object('estacion_id', (select est from k), 'documento_tipo', 'aplicacion_lote',
        'documento_id', pg_temp.uid(12), 'motivo', '')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from an3), 'anular sin motivo: rechazado');

-- ---------------------------------------------------------------- 9 · RLS
select pg_temp.como((select e1 from k));
set role authenticated;
select pg_temp.ok((select count(*) >= 1 from iny_aplicaciones), 'RLS: quien ve la estación lee las aplicaciones');
reset role;
select pg_temp.como((select sin from k));
set role authenticated;
select pg_temp.ok((select count(*) = 0 from iny_plan), 'RLS: sin inyeccion · ver no lee el plan');
reset role;

-- ---------------------------------------------------------------- 10 · bajada con huella
select pg_temp.como((select adm from k));
create temp table x1 as select fn_iny_exportar('{"limite": 1000}'::jsonb) as x;
select pg_temp.ok((select (x->>'cuantos')::integer >= 3 from x1), 'exportar trae lo «por bajar»');
select pg_temp.ok((select bool_and(f->>'huella' = encode(sha256(convert_to(f->>'texto', 'UTF8')), 'hex')) from x1, jsonb_array_elements(x->'filas') f),
                  'cada huella = sha256 de su texto');
select pg_temp.ok((select bool_and(jsonb_typeof(f->'fila'->'detalle') = 'array') from x1, jsonb_array_elements(x->'filas') f), 'la fila lleva su detalle dentro del texto');
create temp table cf as select jsonb_build_object(
    'lote', (select jsonb_agg(jsonb_build_object('id', f->>'id', 'huella', f->>'huella')) from x1, jsonb_array_elements(x->'filas') f),
    'cuantos', (select (x->>'cuantos')::integer from x1),
    'sha256_lote', (select x->>'sha256_lote' from x1)) as p;
select pg_temp.ok((select jsonb_array_length(fn_iny_confirmar_bajada(p)->'confirmadas') = (select (x->>'cuantos')::integer from x1) from cf), 'confirmar marca todo lo verificado');
select pg_temp.ok((select count(*) = 0 from iny_aplicaciones where bajado_a_agl_en is null), 'todas quedaron con bajado_a_agl_en');
select pg_temp.ok((select (fn_iny_purgar_bajadas('{}'::jsonb)->>'aplicaciones')::integer = 0), 'purgar antes de la retención (30 días): no borra');
select pg_temp.ok((select fn_iny_bajada_retencion('{"dias": 0}'::jsonb)->>'retencion_dias' = '0'), 'la retención se puede cambiar');
-- una fila cambiada entre la lectura y la confirmación vuelve a «por bajar»
create temp table ncf as select pg_temp.apl(pg_temp.uid(61), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select b from k), 1)))) as r;
select pg_temp.como((select adm from k));
create temp table x2 as select fn_iny_exportar('{"limite": 1000}'::jsonb) as x;
update iny_aplicaciones set comentario = 'cambiado después de leer' where id = pg_temp.uid(61);
create temp table cf2 as select jsonb_build_object(
    'lote', (select jsonb_agg(jsonb_build_object('id', f->>'id', 'huella', f->>'huella')) from x2, jsonb_array_elements(x->'filas') f),
    'cuantos', (select (x->>'cuantos')::integer from x2), 'sha256_lote', (select x->>'sha256_lote' from x2)) as p;
select pg_temp.ok((select (fn_iny_confirmar_bajada(p)->'rechazadas') @> jsonb_build_array(jsonb_build_object('id', pg_temp.uid(61)::text)) from cf2),
                  'fila cambiada entre lectura y confirmación: rechazada, sigue «por bajar»');
select pg_temp.ok((select bajado_a_agl_en is null from iny_aplicaciones where id = pg_temp.uid(61)), 'y queda sin marca');
create temp table cf3 as select jsonb_build_object('lote', '[{"id":"x","huella":"y"}]'::jsonb, 'cuantos', 1, 'sha256_lote', 'malo') as p;
create or replace function pg_temp.falla_confirmar(p jsonb) returns boolean language plpgsql as $$
begin perform fn_iny_confirmar_bajada(p); return false; exception when others then return true; end $$;
select pg_temp.ok((select pg_temp.falla_confirmar(p) from cf3), 'lote con huella de lote falsa: error y no confirma nada');
create temp table pu as select fn_iny_purgar_bajadas('{}'::jsonb) as r;
select pg_temp.ok((select (r->>'aplicaciones')::integer >= 1 from pu), 'con retención 0 se purga lo confirmado');
select pg_temp.ok(exists (select 1 from iny_aplicaciones where id = pg_temp.uid(61)), 'la que no se confirmó NO se purga');
select pg_temp.ok(not exists (select 1 from iny_aplicaciones where id = pg_temp.uid(11)) and exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(11)),
                  'lo purgado sale de Supabase pero el libro conserva sus movimientos');
select fn_iny_bajada_retencion('{"dias": 30}'::jsonb);
-- reenvío tardío de un UUID ya purgado: no revive nada
select pg_temp.como((select e1 from k));
create temp table rev as select pg_temp.apl(pg_temp.uid(11), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select a from k), 10), pg_temp.l((select b from k), 2)))) as r;
select pg_temp.ok(not exists (select 1 from iny_aplicaciones where id = pg_temp.uid(11)), 'reenviar el UUID de una aplicación purgada no la revive');

-- ---------------------------------------------------------------- 11 · «Terminar ciclo» (102) ignora iny_*
select pg_temp.ok((select bool_and(position('iny_' in pg_get_functiondef(p.oid)) = 0) from pg_proc p
                   where p.proname in ('_fert_turno_filas', 'fn_fert_exportar_turno', 'fn_fert_archivar_turno', 'fn_fert_restaurar_turno')),
                  '«Terminar ciclo»: ninguna función de la 102 toca iny_*');

-- ---------------------------------------------------------------- 12 · invariantes tras volver a correr / otros órdenes
create or replace function pg_temp.finales(p_etiqueta text) returns void language plpgsql as $$
declare
    v_def text := pg_get_functiondef('public._fert_procesar(jsonb)'::regprocedure);
begin
    if position('_iny_op_aplicacion_lote(' in v_def) = 0 or position('_iny_op_anulacion_aplicacion_lote(' in v_def) = 0
       or position('''aplicacion_lote'', ''devolucion'', ''devolucion_bodega'', ''anulacion''' in v_def) = 0 then
        raise exception 'FALLA [%]: _fert_procesar no tiene los parches de la 129', p_etiqueta;
    end if;
    if position('_fert_op_devolucion_bodega(' in v_def) = 0 then
        raise exception 'FALLA [%]: la 129 deshizo el parche de la 128', p_etiqueta;
    end if;
    if (length(v_def) - length(replace(v_def, '_iny_op_aplicacion_lote(', ''))) / length('_iny_op_aplicacion_lote(') <> 1 then
        raise exception 'FALLA [%]: el parche de la 129 quedó duplicado', p_etiqueta;
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.fert_movimientos'::regclass
                   and pg_get_constraintdef(oid) like '%APLICACION_LOTE%' and pg_get_constraintdef(oid) like '%DEVOLUCION_BODEGA%') then
        raise exception 'FALLA [%]: el check de tipo', p_etiqueta;
    end if;
    raise notice 'ok  finales [%]', p_etiqueta;
end $$;
-- una aplicación y su anulación por orden de corrida (sin señal = id nuevo; saldo repuesto con una recepción)
create or replace function pg_temp.ciclo(p_etiqueta text, p_n integer) returns void language plpgsql as $$
declare
    v_r jsonb;
    v_ant numeric := pg_temp.saldo((select est from k), (select a from k));
begin
    perform pg_temp.como((select e1 from k));
    v_r := pg_temp.apl(pg_temp.uid(p_n), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select a from k), 4))));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: aplicar: %', p_etiqueta, v_r; end if;
    if pg_temp.saldo((select est from k), (select a from k)) <> v_ant - 4 then raise exception 'FALLA [%]: saldo', p_etiqueta; end if;
    perform pg_temp.como((select adm from k));
    v_r := pg_temp.op(pg_temp.uid(p_n + 1), 'anulacion', jsonb_build_object('estacion_id', (select est from k), 'documento_tipo', 'aplicacion_lote',
              'documento_id', pg_temp.uid(p_n), 'motivo', 'prueba ' || p_etiqueta));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: anular: %', p_etiqueta, v_r; end if;
    if pg_temp.saldo((select est from k), (select a from k)) <> v_ant then raise exception 'FALLA [%]: saldo tras anular', p_etiqueta; end if;
    perform pg_temp.finales(p_etiqueta);
end $$;

select pg_temp.finales('estado actual');
\i sql/129_campo_inyeccion_por_lote.sql
select pg_temp.ciclo('129 repetida', 100);
\i sql/128_campo_menu_y_devolucion_bodega.sql
select pg_temp.ciclo('129>128', 110);
\i sql/129_campo_inyeccion_por_lote.sql
select pg_temp.ciclo('128>129>128>129', 120);
\i sql/116_fertirriego_registro_historico.sql
\i sql/129_campo_inyeccion_por_lote.sql
select pg_temp.ciclo('116>129', 130);
\i sql/129_campo_inyeccion_por_lote.sql
\i sql/116_fertirriego_registro_historico.sql
select pg_temp.ciclo('129>116', 140);
\i sql/121_fertirriego_auditoria_a_agl.sql
\i sql/129_campo_inyeccion_por_lote.sql
select pg_temp.ciclo('121>129', 150);
\i sql/129_campo_inyeccion_por_lote.sql
\i sql/121_fertirriego_auditoria_a_agl.sql
select pg_temp.ciclo('129>121', 160);
\i sql/102_fertirriego_archivo_turnos.sql
\i sql/129_campo_inyeccion_por_lote.sql
select pg_temp.ciclo('102>129', 170);
\i sql/129_campo_inyeccion_por_lote.sql
\i sql/102_fertirriego_archivo_turnos.sql
select pg_temp.ciclo('129>102', 180);

select 'FIN 129 OK' as resultado;
