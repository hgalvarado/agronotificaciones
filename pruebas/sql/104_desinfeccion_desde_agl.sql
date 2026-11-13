-- =====================================================================
-- PRUEBAS de sql/104 · Desinfección toma la siembra de AGL (turnos_ciclo) y se retiran Trasplante y Riego
-- Réplica local: copia de t99r (91–99 + datos de prueba) + 100 + 101 + 104.
-- T1002-T36 = «Ciclo-1», siembra 29-oct; T1001-T01 = «Ciclo 1», siembra 04-nov (Temporada 2026-2027).
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
create or replace function pg_temp.tem() returns uuid language sql as
$$ select id from temporadas where nombre = 'Temporada 2026-2027' $$;
create or replace function pg_temp.tur(p text) returns uuid language sql as
$$ select id from turnos where codigo = p $$;
create or replace function pg_temp.sie(p_turno text, p_ciclo integer, p_ref date) returns date language sql as
$$ select fecha_siembra from public._desinf_siembra_turno(pg_temp.tur(p_turno), pg_temp.tem(), p_ciclo, p_ref) $$;
set client_min_messages = notice;

-- Personas: administrador y alguien sin ningún permiso de Desinfección
do $$
declare r smallint; n smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T104_ADM', 'P104 Admin', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, acceso_total) values ('T104_NADA', 'P104 Sin permisos', false) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T104_ADM';
    select id into n from roles where codigo = 'T104_NADA';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000010401', 'adm@104'),
                                              ('00000000-0000-0000-0000-000000010402', 'nada@104') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000010401', 'Admin 104', r, true),
        ('00000000-0000-0000-0000-000000010402', 'Nada 104', n, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000010401', r), ('00000000-0000-0000-0000-000000010402', n) on conflict do nothing;
end $$;

\set ADM '''00000000-0000-0000-0000-000000010401'''
\set NADA '''00000000-0000-0000-0000-000000010402'''

-- ------------------------------------------------------------------
-- 0 · Retiro: lo viejo ya no está, lo que se conserva sí
-- ------------------------------------------------------------------
select pg_temp.ok(to_regclass('public.' || t) is null, 'retirada: ' || t)
from unnest(array['siembras', 'siembra_productos', 'siembras_terminadas', 'planes_siembra', 'recepcion_plantulas',
                  'turnos_riego', 'turnos_riego_detalle', 'planes_nutricionales', 'v_siembras', 'v_turnos_riego',
                  'v_recepcion_plantulas', 'v_trasplante_avance_diario']) t;
select pg_temp.ok(to_regclass('interno.v_siembras_crudo') is null and to_regclass('interno.v_turnos_riego_crudo') is null,
                  'retiradas las vistas crudas de interno');
select pg_temp.ok(not exists (select 1 from pg_proc where proname in ('fn_siembras_de_lotes', 'fn_lotes_regables',
                  'fn_area_regable', 'fn_tope_riego_lote_ciclo', 'fn_origen_tope_riego', 'fn_origen_area_lote_ciclo',
                  'fn_guardar_turno_riego', 'fn_editar_turno_riego', 'fn_cargar_plan_siembra', 'fn_validar_area_turno',
                  'fn_responsable_del_turno', 'fn_sincronizar_catalogos_turno')
                  or proname like 'fn_trasplante\_%'), 'retiradas las funciones de Trasplante y Riego');
select pg_temp.ok(to_regtype('public.estado_turno_riego') is null and to_regtype('public.fuente_agua') is null,
                  'retirados los tipos de Turnos de riego');
select pg_temp.ok(not exists (select 1 from pantallas where codigo in ('trasplante_plan', 'trasplante_diario', 'turnos_riego'))
                  and not exists (select 1 from permisos where recurso in ('trasplante_plan', 'trasplante_diario', 'turnos_riego')),
                  'retiradas las pantallas y sus permisos');
select pg_temp.ok(to_regclass('public.turnos') is not null and to_regclass('public.estaciones_riego') is not null
                  and to_regclass('public.turnos_ciclo') is not null and (select count(*) from turnos) > 0,
                  'turnos, estaciones_riego y turnos_ciclo se conservan');
select pg_temp.ok(exists (select 1 from pg_proc where proname = 'fn_exigir_lote_agricola')
                  and exists (select 1 from pg_trigger where tgname = 'trg_planes_lote_agricola' or tgrelid = 'public.planes'::regclass),
                  'fn_exigir_lote_agricola sigue (la usa planes)');
select pg_temp.ok(to_regclass('respaldo.siembras_m104') is not null and to_regclass('respaldo.turnos_riego_m104') is not null
                  and to_regclass('respaldo.planes_siembra_m104') is not null,
                  'con la bandera encendida queda el respaldo en el esquema respaldo');
select pg_temp.ok((select data_type from information_schema.columns where table_schema = 'respaldo'
                   and table_name = 'turnos_riego_m104' and column_name = 'estado') = 'text',
                  'en el respaldo el estado de riego quedó como texto');

-- ------------------------------------------------------------------
-- 1 · La siembra del turno desde AGL
-- ------------------------------------------------------------------
select pg_temp.ok(pg_temp.sie('T1002-T36', 1, null) = '2026-10-29', 'ciclo escrito «Ciclo-1»: T36 siembra 29-oct');
select pg_temp.ok(pg_temp.sie('T1001-T01', 1, null) = '2026-11-04', 'ciclo escrito «Ciclo 1»: T01 siembra 04-nov');
select pg_temp.ok(pg_temp.sie('T1002-T36', null, null) = '2026-10-29', 'sin ciclo también la encuentra');
select pg_temp.ok(pg_temp.sie('T1002-T36', 2, null) is null, 'ciclo 2 no publicado: sin fecha');
select pg_temp.ok((select fecha_siembra from public._desinf_siembra_turno(pg_temp.tur('T1002-T36'),
                   (select id from temporadas where nombre = 'Temporada 2025-2026'), 1, null)) is null,
                  'otra temporada: sin fecha');
select pg_temp.ok(pg_temp.sie('T1001-T03', 1, null) is null, 'un turno publicado en otra temporada (QA-2026) no cuenta');

-- Varias para el mismo turno, temporada y ciclo (+ una inactiva y una sin fecha, que no cuentan)
insert into turnos_ciclo (agl_id, turno_id, temporada, ciclo, fecha_siembra, activo) values
    ('TR-104-A', pg_temp.tur('T1002-T36'), 'Temporada 2026-2027', 'Ciclo 1', '2026-12-15', true),
    ('TR-104-B', pg_temp.tur('T1002-T36'), 'temporada 2026 - 2027', 'CICLO-1', '2027-01-20', true),
    ('TR-104-C', pg_temp.tur('T1002-T36'), 'Temporada 2026-2027', 'Ciclo 1', '2026-12-01', false),
    ('TR-104-D', pg_temp.tur('T1002-T36'), 'Temporada 2026-2027', 'Ciclo 1', null, true);
select pg_temp.ok((select candidatos from public._desinf_siembra_turno(pg_temp.tur('T1002-T36'), pg_temp.tem(), 1, null)) = 3,
                  'cuenta 3 candidatas (ni la inactiva ni la sin fecha)');
select pg_temp.ok(pg_temp.sie('T1002-T36', 1, '2026-10-01') = '2026-10-29', 'referencia 01-oct: la primera siembra después (29-oct)');
select pg_temp.ok(pg_temp.sie('T1002-T36', 1, '2026-11-15') = '2026-12-15', 'referencia 15-nov: la siguiente (15-dic), no la inactiva del 01-dic');
select pg_temp.ok(pg_temp.sie('T1002-T36', 1, '2026-12-15') = '2026-12-15', 'referencia el mismo día de la siembra: esa');
select pg_temp.ok(pg_temp.sie('T1002-T36', 1, '2027-03-01') = '2027-01-20', 'todas antes de la referencia: la más reciente');
delete from turnos_ciclo where agl_id in ('TR-104-A', 'TR-104-B', 'TR-104-C', 'TR-104-D');

-- ------------------------------------------------------------------
-- 2 · La consulta de la pantalla: permiso
-- ------------------------------------------------------------------
select pg_temp.como(:ADM);
select pg_temp.ok((select count(*) from fn_desinfeccion_siembras_agl(pg_temp.tem(), 1)) = 10,
                  'admin: los 10 turnos publicados de la temporada en el ciclo 1');
select pg_temp.ok((select fecha_siembra from fn_desinfeccion_siembras_agl(pg_temp.tem(), 1, array[pg_temp.tur('T1002-T37')])) = '2026-10-30',
                  'admin: filtrar por turno (T37 30-oct)');
select pg_temp.ok((select count(*) from fn_desinfeccion_siembras_agl(pg_temp.tem(), 1, array[(select id from turnos t
                   where not exists (select 1 from turnos_ciclo x where x.turno_id = t.id) limit 1)])) = 0,
                  'un turno que AGL no publicó no devuelve fila');
select pg_temp.como(:NADA);
select pg_temp.ok((select count(*) from fn_desinfeccion_siembras_agl(pg_temp.tem(), 1)) = 0,
                  'sin permiso de Desinfección no ve nada');
select pg_temp.como(null);

-- ------------------------------------------------------------------
-- 3 · Plan: turno guardado y expuesto; área por ciclo sin Trasplante
-- ------------------------------------------------------------------
update desinfeccion_plan set turno_id = pg_temp.tur('T1002-T36') where id = 'e75c8711-dc0d-4948-8eec-454183ef2d47';
select pg_temp.como(:ADM);
select pg_temp.ok((select turno_codigo from v_desinfeccion_plan where id = 'e75c8711-dc0d-4948-8eec-454183ef2d47') = 'T1002-T36',
                  'v_desinfeccion_plan expone el turno de la línea');
select pg_temp.ok((select count(*) from v_desinfeccion_plan) = (select count(*) from desinfeccion_plan),
                  'la vista del plan sigue mostrando todas las líneas al admin');
select pg_temp.como(null);
select pg_temp.ok(fn_area_lote_ciclo('d222d519-c1b6-402a-827f-c20186312448', 1) = 9.23,
                  'área del ciclo = la planificada en el plan de desinfección (9.23, neta 7.91)');
select pg_temp.ok(fn_area_lote_ciclo(lt.id, 1) = lt.area_neta, 'lote sin plan: área neta')
from (select lt.id, lt.area_neta from lotes_temporada lt
      where lt.temporada_id = pg_temp.tem() and lt.activo
        and not exists (select 1 from desinfeccion_plan dp where dp.lote_temporada_id = lt.id) limit 1) lt;
select pg_temp.como(:ADM);
select pg_temp.ok((select mz_planeadas from fn_lotes_desinfeccion(pg_temp.tem(), null, 'desinfeccion_ejecucion', 1)
                   where lote_temporada_id = 'd222d519-c1b6-402a-827f-c20186312448') = 9.23,
                  'fn_lotes_desinfeccion sigue funcionando con el área nueva');
select pg_temp.como(null);

-- ------------------------------------------------------------------
-- 4 · Informe ejecutivo: siembra del turno de AGL (o la del plan si AGL no la tiene)
-- ------------------------------------------------------------------
insert into desinfeccion_ejecucion (id, temporada_id, turno_id, ciclo, fecha_preriego, fecha_aplicacion, usuario_id) values
    ('10400000-0000-4000-8000-000000000001', pg_temp.tem(), pg_temp.tur('T1002-T36'), 1, '2026-08-18', '2026-08-20', :ADM),
    ('10400000-0000-4000-8000-000000000002', pg_temp.tem(),
     (select id from turnos t where not exists (select 1 from turnos_ciclo x where x.turno_id = t.id) order by codigo limit 1),
     1, null, '2026-09-01', :ADM);
insert into desinfeccion_ejecucion_lotes (ejecucion_id, lote_temporada_id, mz_cubiertas) values
    ('10400000-0000-4000-8000-000000000001', 'd222d519-c1b6-402a-827f-c20186312448', 9.23),
    ('10400000-0000-4000-8000-000000000002', '46e350a3-2541-41f2-a1a3-908e2ab997a4', 19.67);
select pg_temp.como(:ADM);
select pg_temp.ok((select fecha_siembra = '2026-10-29' and origen_siembra = 'real' and ddt_aplicacion = -70 and ddt_preriego = -72
                   from v_desinfeccion_informe_ejecutivo where lote_temporada_id = 'd222d519-c1b6-402a-827f-c20186312448' and ciclo = 1),
                  'informe: siembra de AGL (29-oct, ya pasó = real), DDT aplicación −70 y preriego −72');
select pg_temp.ok((select fecha_siembra = fecha_siembra_plan and origen_siembra = 'plan'
                   from v_desinfeccion_informe_ejecutivo where lote_temporada_id = '46e350a3-2541-41f2-a1a3-908e2ab997a4' and ciclo = 1),
                  'informe: turno sin siembra en AGL usa la congelada del plan (origen plan)');
select pg_temp.ok((select variedad is not distinct from (select v.nombre from desinfeccion_plan dp left join variedades v on v.id = dp.variedad_id
                   where dp.lote_temporada_id = 'd222d519-c1b6-402a-827f-c20186312448' and dp.ciclo = 1 order by v.nombre limit 1)
                   from v_desinfeccion_informe_ejecutivo where lote_temporada_id = 'd222d519-c1b6-402a-827f-c20186312448' and ciclo = 1),
                  'informe: la variedad sale del plan de desinfección');
select pg_temp.ok((select count(*) from v_desinfeccion_informe_ejecutivo) = 2, 'informe: una fila por lote y ciclo regado');
select pg_temp.como(null);

-- La siembra futura cuenta como prevista
update turnos_ciclo set fecha_siembra = public.fn_hoy() + 30 where agl_id = 'TR-20261029-221913-F511';
select pg_temp.como(:ADM);
select pg_temp.ok((select origen_siembra from v_desinfeccion_informe_ejecutivo
                   where lote_temporada_id = 'd222d519-c1b6-402a-827f-c20186312448' and ciclo = 1) = 'plan',
                  'informe: siembra de AGL todavía futura = prevista');
select pg_temp.como(null);
update turnos_ciclo set fecha_siembra = '2026-10-29' where agl_id = 'TR-20261029-221913-F511';

-- Limpieza de lo creado
delete from desinfeccion_ejecucion where id in ('10400000-0000-4000-8000-000000000001', '10400000-0000-4000-8000-000000000002');
update desinfeccion_plan set turno_id = null where id = 'e75c8711-dc0d-4948-8eec-454183ef2d47';

\echo '104: TODAS LAS PRUEBAS PASARON'
