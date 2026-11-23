-- =====================================================================
-- PRUEBAS de sql/141 · Inyección: lotes y plan por zona, objetivo por producto, columnas nuevas del plan
-- Réplica local con 91–140 y los datos de prueba de 96/99/115 (E1, Papalon-1, QA-SOLCA, 101478).
-- Correr DESDE LA RAÍZ DEL REPO sobre un CLON nuevo SIN la 141 (la corre ella, dos veces; deja datos):
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/141_inyeccion_zonas_objetivo.sql
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('141a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T141_ADM', 'P141 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T141_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000014101', 'adm@141') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000014101', 'Admin 141', r, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000014101', r) on conflict do nothing;
    insert into zonas (nombre) values ('Z141-2A') on conflict (nombre) do nothing;
    insert into zonas (nombre) values ('Z141-1') on conflict (nombre) do nothing;
    insert into temporadas (nombre, fecha_inicio, fecha_fin, activa) values ('Temp 26-27', date '2026-01-01', date '2026-12-31', false) on conflict (nombre) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L141-A', 'Lote 141 zona 2A') on conflict (nomenclatura) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L141-B', 'Lote 141 zona 1') on conflict (nomenclatura) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L141-C', 'Lote 141 sin zona') on conflict (nomenclatura) do nothing;
    insert into lotes_temporada (lote_id, temporada_id, area_neta, zona_id)
    select l.id, t.id, 5, case l.nomenclatura when 'L141-A' then (select id from zonas where nombre = 'Z141-2A')
                                              when 'L141-B' then (select id from zonas where nombre = 'Z141-1') end
      from lotes l, temporadas t
     where l.nomenclatura in ('L141-A', 'L141-B', 'L141-C') and t.nombre = 'Temp 26-27'
    on conflict (lote_id, temporada_id) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    (select id from materiales where codigo = '101478') as b,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000014101'::uuid as adm,
    (select id from zonas where nombre = 'Z141-2A') as z2a;
create temp table e1_antes as select todas_las_zonas from perfiles where id = (select e1 from k);
create temp table e1_zonas_antes as select zona_id from perfiles_zonas where perfil_id = (select e1 from k);

create or replace function pg_temp.pub() returns jsonb language sql as $$
    select fn_iny_publicar(jsonb_build_object('temporada', 'Temp 26-27', 'completo', true,
        'categorias', '[{"clave":"ferti-riego|inyeccion","departamento":"Ferti-Riego","categoria":"Inyección","tipo":"inyeccion","etiqueta":"Inyección","activo":true}]'::jsonb,
        'materiales', jsonb_build_array(jsonb_build_object('codigo', 'QA-SOLCA'), jsonb_build_object('codigo', '101478')),
        'plan', jsonb_build_array(
            jsonb_build_object('temporada', 'Temp 26-27', 'ciclo', 'Ciclo 1', 'turno_agl_id', 'T-141-A', 'turno', 'T-141-A',
                'estacion', 'Papalon-1', 'lote', 'L141-A', 'categoria_clave', 'ferti-riego|inyeccion', 'ddt', 5,
                'fecha_plan', pg_temp.hoy(), 'material', 'QA-SOLCA', 'dosis_mz', 2, 'area_mz', 5, 'cantidad_plan', 10,
                'variedad', ' Sugar Baby ', 'observaciones', 'Aplicar temprano', 'controla', 'Mosca blanca', 'pct_aplicacion', 75),
            jsonb_build_object('temporada', 'Temp 26-27', 'ciclo', 'Ciclo 1', 'turno_agl_id', 'T-141-B', 'turno', 'T-141-B',
                'estacion', 'Papalon-1', 'lote', 'L141-B', 'categoria_clave', 'ferti-riego|inyeccion', 'ddt', 5,
                'fecha_plan', pg_temp.hoy(), 'material', 'QA-SOLCA', 'dosis_mz', 2, 'area_mz', 5, 'cantidad_plan', 10,
                'variedad', '', 'observaciones', null))))
$$;
create or replace function pg_temp.apl(p_id uuid, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'aplicacion_lote', jsonb_build_object('estacion_id', (select est from k), 'lote', 'L141-A',
        'categoria_clave', 'ferti-riego|inyeccion', 'temporada', 'Temp 26-27', 'area_mz', 2,
        'fecha_hora', now() - make_interval(days => p_dias_atras)) || p_datos, p_dias_atras)
$$;
create or replace function pg_temp.l(p_mat uuid, p_cant numeric, p_obj jsonb default null) returns jsonb language sql as $$
    select jsonb_build_object('material_id', p_mat, 'cantidad', p_cant) || case when p_obj is null then '{}'::jsonb else jsonb_build_object('objetivos', p_obj) end $$;

-- custodia de E1 en Papalon-1 y plan publicado ANTES de la 141
select pg_temp.como((select adm from k));
do $$
declare v_est uuid := (select est from k);
begin
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 141');
    end if;
    update fert_custodia set desde = now() - interval '2 days' where estacion_id = v_est;
end $$;
select pg_temp.pub();

-- ---------------------------------------------------------------- 0 · registro «viejo» (antes de la 141), bajado a AGL
select pg_temp.como((select e1 from k));
create temp table v0 as select pg_temp.apl(pg_temp.uid(1), jsonb_build_object('objetivos', jsonb_build_array('PLAGA'),
    'lineas', jsonb_build_array(pg_temp.l((select a from k), 3), pg_temp.l((select b from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from v0), 'antes de la 141: registro con un objetivo para todo el registro: ' || (select r::text from v0));
select pg_temp.como((select adm from k));
create temp table h0 as select public._iny_huella(public._iny_fila(a)) as h, public._iny_fila(a) as f from iny_aplicaciones a where a.id = pg_temp.uid(1);
create temp table x0 as select fn_iny_exportar('{"limite": 1000}'::jsonb) as x;
select fn_iny_confirmar_bajada(jsonb_build_object(
    'lote', (select jsonb_agg(jsonb_build_object('id', f->>'id', 'huella', f->>'huella')) from x0, jsonb_array_elements(x->'filas') f),
    'cuantos', (select (x->>'cuantos')::integer from x0), 'sha256_lote', (select x->>'sha256_lote' from x0)));
select pg_temp.ok((select bajado_a_agl_en is not null from iny_aplicaciones where id = pg_temp.uid(1)), 'el registro viejo quedó bajado a AGL');

-- ---------------------------------------------------------------- la 141, dos veces
\i sql/141_inyeccion_zonas_objetivo_por_producto_y_plan.sql
\i sql/141_inyeccion_zonas_objetivo_por_producto_y_plan.sql
\i pruebas/sql/141_marcas.sql

-- ---------------------------------------------------------------- 1 · huella de lo ya bajado
select pg_temp.como((select adm from k));
select pg_temp.ok((select public._iny_huella(public._iny_fila(a)) = (select h from h0) from iny_aplicaciones a where a.id = pg_temp.uid(1)),
                  'huella de un registro ya bajado: idéntica antes y después de la 141');
select pg_temp.ok((select bool_and(objetivo_ids is null) from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(1)), 'la 141 no rellena el detalle viejo');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_iny_exportar('{"limite": 1000}'::jsonb)->'filas') f where (f->>'id')::uuid = pg_temp.uid(1)),
                  'el registro viejo NO vuelve a «por bajar»');

-- ---------------------------------------------------------------- 2 · columnas nuevas del plan (publicar → teléfono)
select pg_temp.pub();
select pg_temp.ok((select variedad = 'Sugar Baby' and observaciones = 'Aplicar temprano' and controla = 'Mosca blanca' and pct_aplicacion = 75
                     from iny_plan where turno_agl_id = 'T-141-A'), 'iny_plan guarda variedad (sin espacios), observaciones, controla y % de aplicación');
select pg_temp.ok((select variedad is null and observaciones is null from iny_plan where turno_agl_id = 'T-141-B'), 'textos vacíos = NULL');
select pg_temp.ok((select x->>'variedad' = 'Sugar Baby' and x->>'controla' = 'Mosca blanca' and (x->>'pct_aplicacion')::numeric = 75 and x->>'observaciones' = 'Aplicar temprano'
                     from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'turno_agl_id' = 'T-141-A'),
                  'fn_iny_estado_campo entrega las columnas nuevas del plan');

-- ---------------------------------------------------------------- 3 · zonas: admin / todas / solo 2A
select pg_temp.ok((select count(*) = 3 from jsonb_array_elements(fn_iny_estado_campo()->'lotes') x where x->>'nomenclatura' like 'L141-%'),
                  'admin ve los 3 lotes (2A, 1 y sin zona)');
select pg_temp.ok((select count(*) = 2 from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'lote' like 'L141-%'), 'admin ve el plan de las dos zonas');
select pg_temp.ok((select x->>'zona' = 'Z141-2A' from jsonb_array_elements(fn_iny_estado_campo()->'lotes') x where x->>'nomenclatura' = 'L141-A'), 'el lote trae su zona');

update perfiles set todas_las_zonas = true where id = (select e1 from k);
select pg_temp.como((select e1 from k));
select pg_temp.ok((select count(*) = 3 from jsonb_array_elements(fn_iny_estado_campo()->'lotes') x where x->>'nomenclatura' like 'L141-%')
                  and (select count(*) = 2 from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'lote' like 'L141-%'),
                  '«Todas las zonas» ve todos los lotes y todo el plan');
create temp table t1 as select pg_temp.apl(pg_temp.uid(10), jsonb_build_object('lote', 'L141-B', 'objetivos', jsonb_build_array('PLAGA'),
    'lineas', jsonb_build_array(pg_temp.l((select a from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from t1), '«Todas las zonas» registra en un lote de la zona 1: ' || (select r::text from t1));

select pg_temp.como(null);
update perfiles set todas_las_zonas = false where id = (select e1 from k);
delete from perfiles_zonas where perfil_id = (select e1 from k);
insert into perfiles_zonas (perfil_id, zona_id) values ((select e1 from k), (select z2a from k));
select pg_temp.como((select e1 from k));
select pg_temp.ok(fn_tiene_zonas(), 'E1 ahora tiene zonas recortadas (solo Z141-2A)');
select pg_temp.ok((select array_agg(x->>'nomenclatura' order by x->>'nomenclatura') = array['L141-A']
                     from jsonb_array_elements(fn_iny_estado_campo()->'lotes') x where x->>'nomenclatura' like 'L141-%'),
                  'solo 2A: ve L141-A; NO ve el lote de la zona 1 ni el lote sin zona');
select pg_temp.ok((select array_agg(x->>'lote') = array['L141-A'] from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'lote' like 'L141-%'),
                  'solo 2A: el plan trae solo el de su zona');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'lote' in ('L129-1')),
                  'solo 2A: tampoco ve el plan de lotes sin zona de otras pruebas');

create temp table z1 as select pg_temp.apl(pg_temp.uid(11), jsonb_build_object('lote', 'L141-B', 'objetivos', jsonb_build_array('PLAGA'),
    'lineas', jsonb_build_array(pg_temp.l((select a from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%L141-B%es de otra zona%' from z1), 'lote de otra zona: rechazado con mensaje claro: ' || (select r::text from z1));
create temp table z2 as select pg_temp.apl(pg_temp.uid(12), jsonb_build_object('lote', 'L141-C', 'objetivos', jsonb_build_array('PLAGA'),
    'lineas', jsonb_build_array(pg_temp.l((select a from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%otra zona%' from z2), 'lote sin zona: rechazado a quien tiene zonas recortadas');
create temp table z3 as select pg_temp.apl(pg_temp.uid(13), jsonb_build_object('lote', 'L141-B', 'objetivos', jsonb_build_array('PLAGA'),
    'lineas', jsonb_build_array(pg_temp.l((select a from k), 1))), 1) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%otra zona%' from z3), 'lote de otra zona llegado tarde (sin señal): también rechazado');
select pg_temp.ok(not exists (select 1 from iny_aplicaciones where id in (pg_temp.uid(11), pg_temp.uid(12), pg_temp.uid(13))), 'los rechazos no dejan documento');

-- ---------------------------------------------------------------- 4 · objetivo por producto
create temp table o1 as select pg_temp.apl(pg_temp.uid(20), jsonb_build_object(
    'lineas', jsonb_build_array(pg_temp.l((select a from k), 2, jsonb_build_array('PLAGA')),
                                pg_temp.l((select b from k), 1, jsonb_build_array(jsonb_build_object('nombre', 'Hongo 141')))))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from o1), 'lote de su zona con objetivo distinto por producto: aceptado: ' || (select r::text from o1));
select pg_temp.ok((select objetivo_ids = array[(select id from iny_objetivos where nombre_norm = 'plaga')]
                     from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(20) and material_id = (select a from k)), 'producto A: objetivo Plaga en su línea');
select pg_temp.ok((select objetivo_ids = array[(select id from iny_objetivos where nombre_norm = fn_iny_normalizar_texto('Hongo 141'))] and objetivos = array['Hongo 141']
                     from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(20) and material_id = (select b from k)), 'producto B: objetivo «Hongo 141» en su línea');
select pg_temp.ok((select cardinality(objetivo_ids) = 2
                          and objetivo_ids @> array[(select id from iny_objetivos where nombre_norm = 'plaga'),
                                                    (select id from iny_objetivos where nombre_norm = fn_iny_normalizar_texto('Hongo 141'))]
                     from iny_aplicaciones where id = pg_temp.uid(20)), 'el registro guarda la UNIÓN de los objetivos de sus productos');
create temp table o2 as select pg_temp.apl(pg_temp.uid(21), jsonb_build_object('objetivos', jsonb_build_array('PLAGA'),
    'lineas', jsonb_build_array(pg_temp.l((select a from k), 1), pg_temp.l((select b from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from o2)
                  and (select bool_and(objetivo_ids = array[(select id from iny_objetivos where nombre_norm = 'plaga')]) and count(*) = 2
                         from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(21)),
                  'envío viejo de la cola (objetivos en la raíz): cada producto hereda el objetivo del registro');
create temp table o3 as select pg_temp.apl(pg_temp.uid(22), jsonb_build_object('lineas', jsonb_build_array(pg_temp.l((select a from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Elige al menos un objetivo%' from o3), 'sin objetivos: «Elige al menos un objetivo…»: ' || (select r::text from o3));
create temp table o4 as select pg_temp.apl(pg_temp.uid(23), jsonb_build_object('lineas', jsonb_build_array(
    pg_temp.l((select a from k), 1, jsonb_build_array('PLAGA')), pg_temp.l((select b from k), 1)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Elige al menos un objetivo para cada producto%' from o4),
                  'un producto sin objetivo y sin objetivo del registro: rechazado: ' || (select r::text from o4));
create temp table o5 as select pg_temp.apl(pg_temp.uid(24), jsonb_build_object('lineas', jsonb_build_array(
    pg_temp.l((select a from k), 1, jsonb_build_array('PLAGA')), pg_temp.l((select b from k), 0, jsonb_build_array('???'))))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from o5), 'una línea en 0 con objetivo inválido se ignora: ' || (select r::text from o5));
select pg_temp.ok(not exists (select 1 from iny_aplicaciones where id in (pg_temp.uid(22), pg_temp.uid(23))), 'los rechazos de objetivo no dejan documento');
select pg_temp.ok((select x->'detalle' @> jsonb_build_array(jsonb_build_object('objetivos', jsonb_build_array('Hongo 141')))
                     from jsonb_array_elements(fn_iny_estado_campo()->'historial') x where (x->>'id')::uuid = pg_temp.uid(20)) is not false,
                  'historial del teléfono: lleva el objetivo de cada producto (si el historial expone detalle)');

-- ---------------------------------------------------------------- 5 · bajada a AGL
select pg_temp.como((select adm from k));
create temp table x1 as select fn_iny_exportar('{"limite": 1000}'::jsonb) as x;
select pg_temp.ok((select bool_and(f->>'huella' = encode(sha256(convert_to(f->>'texto', 'UTF8')), 'hex')) from x1, jsonb_array_elements(x->'filas') f),
                  'exportar: cada huella = sha256 de su texto');
select pg_temp.ok((select f->'fila'->'detalle' @> jsonb_build_array(jsonb_build_object('objetivos', jsonb_build_array('Hongo 141')))
                     from x1, jsonb_array_elements(x->'filas') f where (f->>'id')::uuid = pg_temp.uid(20)),
                  'exportar: el detalle lleva el objetivo de cada producto');
select pg_temp.ok((select (x->>'cuantos')::integer = jsonb_array_length(x->'filas') from x1), 'exportar: cuantos = filas');
create temp table cf as select jsonb_build_object(
    'lote', (select jsonb_agg(jsonb_build_object('id', f->>'id', 'huella', f->>'huella')) from x1, jsonb_array_elements(x->'filas') f),
    'cuantos', (select (x->>'cuantos')::integer from x1), 'sha256_lote', (select x->>'sha256_lote' from x1)) as p;
create temp table cfr as select fn_iny_confirmar_bajada(p) as r from cf;
select pg_temp.ok((select jsonb_array_length(r->'confirmadas') = (select (x->>'cuantos')::integer from x1) and jsonb_array_length(r->'rechazadas') = 0 from cfr),
                  'confirmar: cuadra (todas confirmadas, 0 rechazadas)');
select pg_temp.ok((select (fn_iny_exportar('{"limite": 1000}'::jsonb)->>'cuantos')::integer = 0), 'tras confirmar no queda nada «por bajar»');

-- ---------------------------------------------------------------- restaurar E1
select pg_temp.como(null);
update perfiles set todas_las_zonas = (select todas_las_zonas from e1_antes) where id = (select e1 from k);
delete from perfiles_zonas where perfil_id = (select e1 from k);
insert into perfiles_zonas (perfil_id, zona_id) select (select e1 from k), zona_id from e1_zonas_antes;
select 'FIN 141 OK' as resultado;
