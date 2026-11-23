-- =====================================================================
-- PRUEBAS de sql/142 · Inyección: plan de lotes SIN turno (fecha estimada)
-- Réplica local con 91–141 y los datos de prueba de 96/99/115 (E1, Papalon-1, QA-SOLCA).
-- Correr DESDE LA RAÍZ DEL REPO sobre un CLON nuevo CON la 141 y SIN la 142 (la corre ella, dos veces; deja datos):
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/142_inyeccion_lotes_sin_turno.sql
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('142a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T142_ADM', 'P142 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T142_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000014201', 'adm@142') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000014201', 'Admin 142', r, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000014201', r) on conflict do nothing;
    insert into zonas (nombre) values ('Z142-X') on conflict (nombre) do nothing;
    insert into zonas (nombre) values ('Z142-Y') on conflict (nombre) do nothing;
    insert into temporadas (nombre, fecha_inicio, fecha_fin, activa) values ('Temp 26-27', date '2026-01-01', date '2026-12-31', false) on conflict (nombre) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L142-A', 'Lote 142 con turno') on conflict (nomenclatura) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L142-B', 'Lote 142 sin turno zona X') on conflict (nomenclatura) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L142-C', 'Lote 142 sin turno zona Y') on conflict (nomenclatura) do nothing;
    insert into lotes_temporada (lote_id, temporada_id, area_neta, zona_id)
    select l.id, t.id, 5, case l.nomenclatura when 'L142-C' then (select id from zonas where nombre = 'Z142-Y') else (select id from zonas where nombre = 'Z142-X') end
      from lotes l, temporadas t
     where l.nomenclatura in ('L142-A', 'L142-B', 'L142-C') and t.nombre = 'Temp 26-27'
    on conflict (lote_id, temporada_id) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000014201'::uuid as adm,
    (select id from zonas where nombre = 'Z142-X') as zx;
create temp table e1_antes as select todas_las_zonas from perfiles where id = (select e1 from k);
create temp table e1_zonas_antes as select zona_id from perfiles_zonas where perfil_id = (select e1 from k);

-- plan: con_sin = incluir las líneas de lotes sin turno; viejo = sin la clave fecha_estimada (AGL antes de la 142);
-- real = el lote L142-B ya tiene turno real
create or replace function pg_temp.pub(con_sin boolean, real boolean default false) returns jsonb language sql as $$
    select fn_iny_publicar(jsonb_build_object('temporada', 'Temp 26-27', 'completo', true,
        'categorias', '[{"clave":"ferti-riego|inyeccion","departamento":"Ferti-Riego","categoria":"Inyección","tipo":"inyeccion","etiqueta":"Inyección","activo":true}]'::jsonb,
        'materiales', jsonb_build_array(jsonb_build_object('codigo', 'QA-SOLCA')),
        'plan', jsonb_build_array(
            jsonb_build_object('temporada', 'Temp 26-27', 'ciclo', 'Ciclo 1', 'turno_agl_id', 'T-142-A', 'turno', 'T-142-A',
                'estacion', 'Papalon-1', 'lote', 'L142-A', 'categoria_clave', 'ferti-riego|inyeccion', 'ddt', 5,
                'fecha_plan', pg_temp.hoy(), 'material', 'QA-SOLCA', 'dosis_mz', 2, 'area_mz', 5, 'cantidad_plan', 10))
        || case when con_sin then jsonb_build_array(
            jsonb_build_object('temporada', 'Temp 26-27', 'ciclo', 'Ciclo 1',
                'turno_agl_id', case when real then 'T-142-B' else 'SIN-TURNO|l142-b' end, 'turno', case when real then 'T-142-B' end,
                'estacion', case when real then 'Papalon-1' end, 'lote', 'L142-B', 'categoria_clave', 'ferti-riego|inyeccion', 'ddt', 5,
                'fecha_plan', pg_temp.hoy() + 2, 'fecha_estimada', not real, 'material', 'QA-SOLCA', 'dosis_mz', 2, 'area_mz', 5, 'cantidad_plan', 10),
            jsonb_build_object('temporada', 'Temp 26-27', 'ciclo', 'Ciclo 1', 'turno_agl_id', 'SIN-TURNO|l142-c', 'turno', null,
                'estacion', null, 'lote', 'L142-C', 'categoria_clave', 'ferti-riego|inyeccion', 'ddt', 5,
                'fecha_plan', null, 'fecha_estimada', true, 'material', 'QA-SOLCA', 'dosis_mz', 2, 'area_mz', 5, 'cantidad_plan', 10))
          else '[]'::jsonb end))
$$;
create or replace function pg_temp.apl(p_id uuid, p_lote text, p_turno text default null) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'aplicacion_lote', jsonb_build_object('estacion_id', (select est from k), 'lote', p_lote,
        'categoria_clave', 'ferti-riego|inyeccion', 'temporada', 'Temp 26-27', 'area_mz', 2, 'fecha_hora', now(),
        'objetivos', jsonb_build_array('PLAGA'),
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 2)))
        || case when p_turno is null then '{}'::jsonb else jsonb_build_object('turno_agl_id', p_turno) end)
$$;

select pg_temp.como((select adm from k));
do $$
declare v_est uuid := (select est from k);
begin
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 142');
    end if;
    update fert_custodia set desde = now() - interval '2 days' where estacion_id = v_est;
end $$;

-- plan publicado ANTES de la 142 (sin la clave fecha_estimada), y un registro ya bajado a AGL
select pg_temp.pub(false);
select pg_temp.como((select e1 from k));
create temp table v0 as select pg_temp.apl(pg_temp.uid(1), 'L142-A') as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from v0), 'antes de la 142: registro con turno aceptado: ' || (select r::text from v0));
select pg_temp.como((select adm from k));
create temp table h0 as select public._iny_huella(public._iny_fila(a)) as h from iny_aplicaciones a where a.id = pg_temp.uid(1);

-- ---------------------------------------------------------------- la 142, dos veces
\i sql/142_inyeccion_lotes_sin_turno.sql
\i sql/142_inyeccion_lotes_sin_turno.sql
select pg_temp.ok((select count(*) = 4 from (values
        (position('142:fecha-estimada' in pg_get_functiondef('public.fn_iny_publicar(jsonb)'::regprocedure))),
        (position('coalesce(x.fecha_estimada, false)' in pg_get_functiondef('public.fn_iny_publicar(jsonb)'::regprocedure))),
        (position('fecha_estimada = excluded.fecha_estimada' in pg_get_functiondef('public.fn_iny_publicar(jsonb)'::regprocedure))),
        (position('''fecha_estimada'', coalesce(p.fecha_estimada, false)' in pg_get_functiondef('public.fn_iny_estado_campo(date)'::regprocedure)))
    ) m(p) where p > 0), 'marcas 142 presentes en fn_iny_publicar y fn_iny_estado_campo (4/4)');
select pg_temp.ok(position('141:zona-plan' in pg_get_functiondef('public.fn_iny_estado_campo(date)'::regprocedure)) > 0
                  and position('141:zona' in pg_get_functiondef('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)'::regprocedure)) > 0,
                  'los parches de la 141 (filtro de zonas) siguen presentes');

-- ---------------------------------------------------------------- 1 · compatibilidad
select pg_temp.ok((select public._iny_huella(public._iny_fila(a)) = (select h from h0) from iny_aplicaciones a where a.id = pg_temp.uid(1)),
                  'huella de un registro ya bajado: idéntica antes y después de la 142');
select pg_temp.ok((select fecha_estimada is null from iny_plan where turno_agl_id = 'T-142-A'), 'plan publicado antes de la 142: fecha_estimada null');
select pg_temp.ok((select (x->>'fecha_estimada')::boolean = false from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'turno_agl_id' = 'T-142-A'),
                  'el teléfono recibe fecha_estimada = false para lo anterior');

-- ---------------------------------------------------------------- 2 · lotes sin turno: publicar y entregar
select pg_temp.pub(true);
select pg_temp.ok((select fecha_estimada is true and turno is null and estacion_id is null and fecha_plan = pg_temp.hoy() + 2
                     from iny_plan where turno_agl_id = 'SIN-TURNO|l142-b'), 'lote sin turno: línea SIN estación fija y con fecha estimada');
select pg_temp.ok((select fecha_estimada is true and fecha_plan is null from iny_plan where turno_agl_id = 'SIN-TURNO|l142-c'), 'sin fecha de siembra: fecha_plan null y estimada');
select pg_temp.ok((select fecha_estimada = false from iny_plan where turno_agl_id = 'T-142-A'), 'la línea con turno queda en fecha_estimada false');
select pg_temp.ok((select count(*) = 3 from iny_plan where lote in ('L142-A', 'L142-B', 'L142-C')), 'publicar es idempotente: 3 líneas (con y sin turno)');
select pg_temp.pub(true);
select pg_temp.ok((select count(*) = 3 from iny_plan where lote in ('L142-A', 'L142-B', 'L142-C')), 'republicar no duplica las líneas sin turno');
select pg_temp.ok((select (x->>'fecha_estimada')::boolean from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'lote' = 'L142-B'),
                  'fn_iny_estado_campo entrega el lote sin turno con fecha_estimada = true');

-- ---------------------------------------------------------------- 3 · aplicar un lote sin turno
select pg_temp.como((select e1 from k));
create temp table s1 as select pg_temp.apl(pg_temp.uid(10), 'L142-B', 'SIN-TURNO|l142-b') as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from s1), 'aplicar un lote sin turno (el teléfono manda su clave de plan): aceptado: ' || (select r::text from s1));
select pg_temp.ok((select d.en_plan and d.plan_id = (select id from iny_plan where turno_agl_id = 'SIN-TURNO|l142-b') and d.ddt_plan = 5
                     from iny_aplicaciones_detalle d where d.aplicacion_id = pg_temp.uid(10)), 'la aplicación cubre la línea del plan sin turno (en_plan, plan_id, DDT)');
create temp table s2 as select pg_temp.apl(pg_temp.uid(11), 'L142-C') as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from s2)
                  and (select d.en_plan from iny_aplicaciones_detalle d where d.aplicacion_id = pg_temp.uid(11)), 'sin mandar turno: se empareja igual por lote y producto');

-- ---------------------------------------------------------------- 4 · el lote recibe turno: la línea sin turno desaparece
select pg_temp.como((select adm from k));
select pg_temp.pub(true, true);
select pg_temp.ok(not exists (select 1 from iny_plan where turno_agl_id = 'SIN-TURNO|l142-b'), 'con turno real la línea SIN-TURNO del lote desaparece');
select pg_temp.ok((select fecha_estimada is false and turno_agl_id = 'T-142-B' and estacion_id = (select est from k) from iny_plan where lote = 'L142-B'), 'queda la línea con su turno, su estación y fecha no estimada');
select pg_temp.ok(exists (select 1 from iny_plan where turno_agl_id = 'SIN-TURNO|l142-c'), 'el otro lote sin turno se conserva');
select pg_temp.pub(false);
select pg_temp.ok(not exists (select 1 from iny_plan where turno_agl_id like 'SIN-TURNO|%'), 'una publicación completa sin esas líneas las quita');
select pg_temp.pub(true);

-- ---------------------------------------------------------------- 5 · zonas (141 intacto)
select pg_temp.como(null);
update perfiles set todas_las_zonas = false where id = (select e1 from k);
delete from perfiles_zonas where perfil_id = (select e1 from k);
insert into perfiles_zonas (perfil_id, zona_id) values ((select e1 from k), (select zx from k));
select pg_temp.como((select e1 from k));
select pg_temp.ok((select array_agg(x->>'lote' order by x->>'lote') = array['L142-A', 'L142-B']
                     from jsonb_array_elements(fn_iny_estado_campo()->'plan') x where x->>'lote' like 'L142-%'),
                  'solo zona X: ve el plan de L142-A y del lote sin turno L142-B; NO el de la zona Y (L142-C)');
create temp table z1 as select pg_temp.apl(pg_temp.uid(20), 'L142-C', 'SIN-TURNO|l142-c') as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%otra zona%' from z1), 'lote sin turno de otra zona: rechazado: ' || (select r::text from z1));

-- ---------------------------------------------------------------- 6 · exportar a AGL
select pg_temp.como((select adm from k));
select pg_temp.ok((select count(*) >= 3 from jsonb_array_elements(fn_iny_exportar('{"limite": 1000}'::jsonb)->'filas') f where f->'fila'->>'lote' like 'L142-%'),
                  'la aplicación de un lote sin turno baja a AGL como cualquier otra');

-- ---------------------------------------------------------------- restaurar E1
select pg_temp.como(null);
update perfiles set todas_las_zonas = (select todas_las_zonas from e1_antes) where id = (select e1 from k);
delete from perfiles_zonas where perfil_id = (select e1 from k);
insert into perfiles_zonas (perfil_id, zona_id) select (select e1 from k), zona_id from e1_zonas_antes;
select 'FIN 142 OK' as resultado;
