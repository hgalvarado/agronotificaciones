-- =====================================================================
-- PRUEBAS de sql/145 · Modo de pruebas también en Inyección y Motores
-- Réplica local con 91–144 y los datos de prueba de 96/99/115 (estación Papalon-1, e1 = estacionero, e2 = otro usuario).
-- Correr DESDE LA RAÍZ DEL REPO sobre un CLON nuevo CON la 144 y SIN la 145 (la corre ella dos veces; deja datos):
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/145_campo_modo_pruebas.sql
-- Autosuficiente (crea su admin, diésel y un motor real T145-M1). NO ejecutada todavía (la corre Opus).
-- Órdenes a probar después: 98>…>144>145, 145>145, y 145 tras volver a correr 129/130/138/144.
-- Requiere que e1 tenga permisos de Inyección y Motores (los da la 129/130 a todo rol con fertirriego · aplicar).
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('145a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.dia(p_atras integer) returns text language sql as $$ select (pg_temp.hoy() - p_atras)::text $$;
create or replace function pg_temp.ts(p_atras integer) returns text language sql as $$
    select case when p_atras = 0 then least(((pg_temp.hoy())::timestamp + time '12:00') at time zone 'America/Tegucigalpa', now() - interval '2 minutes')::text
                else ((pg_temp.hoy() - p_atras)::timestamp + time '12:00')::text || '-06' end $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- 0 · la migración, dos veces
\i sql/145_campo_modo_pruebas.sql
\i sql/145_campo_modo_pruebas.sql
select pg_temp.ok((select count(*) = 8 from (values
        (position('145:campo' in pg_get_functiondef('public.fn_fert_pruebas_activar(uuid[],uuid[])'::regprocedure))),
        (position('145:campo' in pg_get_functiondef('public._fert_pruebas_borrar_todo()'::regprocedure))),
        (position('_iny_plan_de_prueba' in pg_get_functiondef('public.fn_iny_estado_campo(date)'::regprocedure))),
        (position('_iny_estacion_para_mi' in pg_get_functiondef('public.fn_iny_estado_campo(date)'::regprocedure))),
        (position('_fert_es_prueba(a.estacion_id)' in pg_get_functiondef('public._iny_filas()'::regprocedure))),
        (position('_mot_es_prueba(u.equipo_id)' in pg_get_functiondef('public._mot_filas(uuid[])'::regprocedure))),
        (position('prueba_de is null and equipo_id not in' in pg_get_functiondef('public.fn_mot_publicar(jsonb)'::regprocedure))),
        (position('145:otras' in pg_get_functiondef('public.fn_mot_estado_campo(date)'::regprocedure)))
    ) m(p) where p > 0), 'marcas 145 presentes tras correrla dos veces (8/8; el parche no se aplica dos veces)');

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T145_ADM', 'P145 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T145_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000014501', 'adm@145') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000014501', 'Admin 145', r, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000014501', r) on conflict do nothing;
    insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
    values ('QA-DIESEL-145', 'Diésel QA 145', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true) on conflict (codigo) do nothing;
    insert into temporadas (nombre, fecha_inicio, fecha_fin, activa) values ('Temp 26-27', date '2026-01-01', date '2026-12-31', false) on conflict (nombre) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L145-A', 'Lote 145') on conflict (nomenclatura) do nothing;
    insert into lotes_temporada (lote_id, temporada_id, area_neta)
    select l.id, t.id, 5 from lotes l, temporadas t where l.nomenclatura = 'L145-A' and t.nombre = 'Temp 26-27'
    on conflict (lote_id, temporada_id) do nothing;
end $$;
create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as sol,
    (select id from materiales where codigo = 'QA-DIESEL-145') as dsl,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-0000000000e2'::uuid as e2,
    '00000000-0000-0000-0000-000000014501'::uuid as adm;
create temp table e1_antes as select todas_las_zonas from perfiles where id = (select e1 from k);
update perfiles set todas_las_zonas = true where id = (select e1 from k);     -- sin recorte de zonas para esta prueba

-- AGL publica: diésel, un motor REAL, plan de Inyección
select pg_temp.como((select adm from k));
select fn_mot_publicar(jsonb_build_object('completo', false, 'material_diesel', 'QA-DIESEL-145',
    'motores', '[{"codigo":"T145-M1","nombre":"Motor real 145","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300}]'::jsonb));
select fn_iny_publicar(jsonb_build_object('temporada', 'Temp 26-27', 'completo', false,
    'categorias', '[{"clave":"ferti-riego|inyeccion","departamento":"Ferti-Riego","categoria":"Inyección","tipo":"inyeccion","etiqueta":"Inyección","activo":true}]'::jsonb,
    'materiales', jsonb_build_array(jsonb_build_object('codigo', 'QA-SOLCA')),
    'plan', jsonb_build_array(jsonb_build_object('temporada', 'Temp 26-27', 'ciclo', 'Ciclo 1', 'turno_agl_id', 'T-145-A', 'turno', 'T-145-A',
        'estacion', 'Papalon-1', 'lote', 'L145-A', 'categoria_clave', 'ferti-riego|inyeccion', 'ddt', 5, 'fecha_plan', pg_temp.hoy(),
        'material', 'QA-SOLCA', 'dosis_mz', 2, 'area_mz', 5, 'cantidad_plan', 10))));
create temp table m as select (select id from equipos where codigo = 'T145-M1') as real_m;

-- foto de lo REAL antes de activar el modo
create temp table base as select
    (select md5(coalesce(string_agg(mo::text, '|' order by mo.equipo_id), '')) from mot_motores mo where mo.prueba_de is null) as motores,
    (select count(*) from iny_aplicaciones) as iny,
    (select count(*) from mot_registros) as regs,
    (select count(*) from equipos) as equipos,
    (select coalesce(sum(disponible), 0) from fert_saldos where estacion_id = (select est from k)) as bodega_real;

-- ---------------------------------------------------------------- 1 · activar: estación de prueba + motor de práctica
select pg_temp.como((select adm from k));
select fn_fert_pruebas_activar(array[(select est from k)], array[(select e1 from k)]);
create temp table p as select (select id from estaciones_riego where prueba_de = (select est from k)) as est;
select fn_fert_asignar_custodia((select est from p), (select e1 from k), 'Prueba 145');
create temp table pm as select equipo_id as m from mot_motores where prueba_de = (select est from p);
select pg_temp.ok((select count(*) = 1 from pm), 'activar crea UN motor de práctica para la estación de prueba');
select pg_temp.ok((select codigo like 'PRUEBA-M-%' and not activo and not visible_app from equipos where id = (select m from pm)),
                  'el motor de práctica es un equipo oculto (activo=false, visible_app=false, código PRUEBA-M-…)');
select pg_temp.ok((select estado = 'SIN_ASIGNAR' and activo and modelo = 'PRÁCTICA' from mot_motores where equipo_id = (select m from pm)), 'queda SIN_ASIGNAR y activo');
select fn_fert_pruebas_activar(array[(select est from k)], array[(select e1 from k)]);      -- reactivar: no duplica
select pg_temp.ok((select count(*) = 1 from mot_motores where prueba_de = (select est from p)), 'reactivar no duplica el motor de práctica');

-- ---------------------------------------------------------------- 2 · Inyección: plan remapeado, aplicación en la de prueba
select pg_temp.como((select e1 from k));
select pg_temp.ok((select count(*) >= 1 and bool_and(x->>'estacion_id' = (select est from p)::text)
                     from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'lote' = 'L145-A'),
                  'E1 en pruebas: el plan del lote llega con la estación de PRUEBA');
create temp table ci as select pg_temp.op(pg_temp.uid(1), 'conteo', jsonb_build_object('estacion_id', (select est from p),
    'lineas', jsonb_build_array(jsonb_build_object('material_id', (select sol from k), 'cantidad_real', 100)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from ci), 'conteo inicial de Solca en la bodega de prueba: ' || (select r::text from ci));
create temp table a1 as select pg_temp.op(pg_temp.uid(2), 'aplicacion_lote', jsonb_build_object('estacion_id', (select est from p), 'lote', 'L145-A',
    'categoria_clave', 'ferti-riego|inyeccion', 'temporada', 'Temp 26-27', 'area_mz', 2, 'fecha_hora', now(),
    'objetivos', jsonb_build_array('PLAGA'),
    'lineas', jsonb_build_array(jsonb_build_object('material_id', (select sol from k), 'cantidad', 4)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from a1), 'aplicación de Inyección en la estación de prueba: ' || (select r::text from a1));
select pg_temp.ok((select estacion_id = (select est from p) from iny_aplicaciones where id = pg_temp.uid(2)), 'queda en la estación de prueba');
select pg_temp.ok((select en_plan from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(2)), 'cubre la línea del plan de la real (cumplimiento funciona)');
select pg_temp.ok((select disponible = 96 from fert_saldos where estacion_id = (select est from p) and material_id = (select sol from k)), 'rebaja la bodega de PRUEBA (100 → 96)');
select pg_temp.ok((select count(*) = 1 from jsonb_array_elements(fn_iny_estado_campo()->'aplicaciones') x where x->>'id' = pg_temp.uid(2)::text), 'E1 la ve en su historial');
select pg_temp.como((select e2 from k));
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_iny_estado_campo()->'aplicaciones') x where x->>'id' = pg_temp.uid(2)::text)
                  and not exists (select 1 from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'estacion_id' = (select est from p)::text),
                  'E2 (no participante): ni la aplicación de prueba ni el plan remapeado');
select pg_temp.como((select adm from k));
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_iny_exportar()->'filas') x where x->>'id' = pg_temp.uid(2)::text), 'AGL: fn_iny_exportar no incluye la aplicación de prueba');
select pg_temp.ok(not exists (select 1 from public._iny_filas() f where f.id = pg_temp.uid(2)), '_iny_filas la excluye (confirmar y purgar tampoco la ven)');

-- ---------------------------------------------------------------- 3 · Motores: practicar sin tocar lo real
select pg_temp.como((select e1 from k));
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_mot_estado_campo()->'motores') x where x->>'equipo_id' = (select m from pm)::text),
                  'E1 en pruebas: ve el motor de práctica (SIN_ASIGNAR) para «Recibir motor»');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_mot_estado_campo()->'motores') x where x->>'equipo_id' = (select real_m from m)::text)
                  and jsonb_array_length(fn_mot_estado_campo()->'otras_estaciones') = 0,
                  'E1 en pruebas: NO se le ofrecen motores reales (ni sin asignar ni de otras estaciones)');
select pg_temp.como((select adm from k));
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_mot_estado_campo()->'motores') x where x->>'equipo_id' = (select m from pm)::text and x->>'estado' = 'SIN_ASIGNAR'),
                  'el administrador fuera de pruebas no ve el motor de práctica sin asignar');
-- un motor real NO entra a la estación de prueba
create temp table x1 as select pg_temp.op(pg_temp.uid(10), 'motor_asignar', jsonb_build_object('equipo_id', (select real_m from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(1), 'estacion_destino', (select est from p), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque X', 'capacidad_gal', 300),
    'motivo', 'Intento real en prueba', 'motivo_codigo', 'OTRO', 'horas_base', 0)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%motor real%' from x1), 'un motor REAL no puede instalarse en la estación de prueba: ' || (select r::text from x1));
select pg_temp.ok((select estado = 'SIN_ASIGNAR' from mot_motores where equipo_id = (select real_m from m)), 'el motor real sigue SIN_ASIGNAR');
-- instalar el de práctica (como el administrador, que puede operar la estación de prueba)
create temp table i1 as select pg_temp.op(pg_temp.uid(11), 'motor_asignar', jsonb_build_object('equipo_id', (select m from pm), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(1), 'estacion_destino', (select est from p), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque práctica', 'capacidad_gal', 100),
    'motivo', 'Práctica', 'motivo_codigo', 'OTRO', 'horas_base', 0)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from i1), 'instalar el motor de práctica con su tanque: ' || (select r::text from i1));
-- diésel a la bodega de prueba y registro diario con suministro
select pg_temp.como((select e1 from k));
create temp table d1 as select pg_temp.op(pg_temp.uid(12), 'diesel_recibir', jsonb_build_object('estacion_id', (select est from p), 'galones', 100,
    'fecha_hora', pg_temp.ts(0), 'chofer_id', '10000000-0000-0000-0000-000000000001')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from d1), 'recibir 100 gal de diésel en la estación de prueba: ' || (select r::text from d1));
select pg_temp.ok((select disponible = 100 from fert_saldos where estacion_id = (select est from p) and material_id = (select dsl from k)), 'la bodega de PRUEBA tiene 100 gal de diésel');
select pg_temp.ok(not exists (select 1 from fert_saldos where estacion_id = (select est from k) and material_id = (select dsl from k)), 'la bodega REAL no recibió diésel');
create temp table r1 as select pg_temp.op(pg_temp.uid(13), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m from pm), 'fecha', pg_temp.dia(0),
    'fecha_hora', pg_temp.ts(0), 'horo_ini', 100, 'horo_fin', 110, 'visor_ini', 50, 'visor_fin', 30, 'suministro_gal', 40)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r1), 'registro diario del motor de práctica con suministro 40: ' || (select r::text from r1));
select pg_temp.ok((select disponible = 60 from fert_saldos where estacion_id = (select est from p) and material_id = (select dsl from k)), 'el suministro rebaja la bodega de prueba (100 → 60)');
select pg_temp.ok((select horo_ultimo = 110 and visor_ultimo = 30 and horas_desde_mant = 10 from mot_motores where equipo_id = (select m from pm)),
                  'los contadores son los del motor de práctica (horo 110, visor 30, 10 h)');
select pg_temp.como((select adm from k));
create temp table mt as select pg_temp.op(pg_temp.uid(14), 'motor_mantenimiento', jsonb_build_object('equipo_id', (select m from pm), 'tipo', 'PREVENTIVO',
    'fecha_hora', now(), 'horometro', 110, 'nota', 'práctica')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from mt), 'mantenimiento del motor de práctica: ' || (select r::text from mt));
-- lo REAL no cambió
select pg_temp.ok((select md5(coalesce(string_agg(mo::text, '|' order by mo.equipo_id), '')) from mot_motores mo where mo.prueba_de is null) = (select motores from base),
                  'motores REALES: contadores y estado idénticos (md5)');
select pg_temp.ok((select count(*) from mot_registros where estacion_id = (select est from k)) = 0 and (select coalesce(sum(disponible), 0) from fert_saldos where estacion_id = (select est from k)) = (select bodega_real from base),
                  'la estación real: sin registros de motor nuevos y su bodega igual');
-- AGL no ve nada de prueba
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_mot_exportar()->'filas') x
                               where x->>'estacion_id' = (select est from p)::text or x->>'equipo_id' = (select m from pm)::text),
                  'AGL: fn_mot_exportar no incluye registros, recepciones, mantenimientos ni asignaciones de prueba');
select pg_temp.ok(not exists (select 1 from public._mot_filas() f where f.estacion_id = (select est from p) or f.equipo_id = (select m from pm)), '_mot_filas los excluye (confirmar y purgar tampoco)');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_fert_exportar()->'movimientos') x where x->>'estacion_id' = (select est from p)::text),
                  'AGL: fn_fert_exportar no incluye la bodega de prueba (98)');
do $$
declare v_prev uuid[] := array(select equipo_id from mot_motores where activo and prueba_de is null);
begin
    perform fn_mot_publicar(jsonb_build_object('completo', true, 'motores', '[{"codigo":"T145-M1","nombre":"Motor real 145","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300}]'::jsonb));
    perform pg_temp.ok((select activo from mot_motores where equipo_id = (select m from pm)), 'publicar «completo» desde AGL no desactiva el motor de práctica');
    update mot_motores set activo = true where equipo_id = any(v_prev);          -- devolver el estado a la base de pruebas
end $$;

-- ---------------------------------------------------------------- 4 · apagar conserva; borrar limpia todo
select fn_fert_pruebas_desactivar();
select pg_temp.ok(exists (select 1 from iny_aplicaciones where id = pg_temp.uid(2)) and exists (select 1 from mot_registros where id = pg_temp.uid(13)),
                  'apagar sin borrar: lo de prueba se conserva (30 días)');
select fn_fert_pruebas_borrar();
select pg_temp.ok(not exists (select 1 from estaciones_riego where prueba_de is not null), 'borrar: no quedan estaciones de prueba');
select pg_temp.ok(not exists (select 1 from iny_aplicaciones where id = pg_temp.uid(2)) and not exists (select 1 from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(2)),
                  'borrar: no queda la aplicación de Inyección ni su detalle');
select pg_temp.ok(not exists (select 1 from mot_registros where id = pg_temp.uid(13)) and not exists (select 1 from mot_recepciones where id = pg_temp.uid(12))
                  and not exists (select 1 from mot_mantenimientos where id = pg_temp.uid(14)) and not exists (select 1 from mot_asignaciones where id = pg_temp.uid(11)),
                  'borrar: no quedan registros, recepciones, mantenimientos ni asignaciones de prueba');
select pg_temp.ok(not exists (select 1 from mot_movimientos where documento_id in (pg_temp.uid(13), pg_temp.uid(11)))
                  and not exists (select 1 from mot_tanques where nombre = 'Tanque práctica') and not exists (select 1 from mot_motores where prueba_de is not null),
                  'borrar: no quedan movimientos de tanque, tanques ni motores de práctica');
select pg_temp.ok(not exists (select 1 from equipos where codigo like 'PRUEBA-M-%') and (select count(*) from equipos) = (select equipos from base),
                  'borrar: el equipo oculto de práctica se fue (el catálogo de equipos queda como antes de activar)');
select pg_temp.ok(not exists (select 1 from fert_movimientos where documento_id in (pg_temp.uid(2), pg_temp.uid(12), pg_temp.uid(13)))
                  and not exists (select 1 from fert_operaciones where id in (pg_temp.uid(2), pg_temp.uid(11), pg_temp.uid(12), pg_temp.uid(13), pg_temp.uid(14))),
                  'borrar: no quedan movimientos de bodega ni operaciones de prueba');
select pg_temp.ok((select md5(coalesce(string_agg(mo::text, '|' order by mo.equipo_id), '')) from mot_motores mo where mo.prueba_de is null) = (select motores from base)
                  and (select estado = 'SIN_ASIGNAR' from mot_motores where equipo_id = (select real_m from m)) is not null,
                  'lo real sigue idéntico tras borrar');
-- reactivar después de borrar vuelve a crear el motor de práctica
select pg_temp.como((select adm from k));
select fn_fert_pruebas_activar(array[(select est from k)], array[(select e1 from k)]);
select pg_temp.ok((select count(*) = 1 from mot_motores where prueba_de is not null), 'volver a activar crea de nuevo el motor de práctica');
select fn_fert_pruebas_borrar();

-- limpieza de la prueba
update perfiles set todas_las_zonas = (select todas_las_zonas from e1_antes) where id = (select e1 from k);
select 'FIN 145: todas las comprobaciones pasaron' as resultado;
