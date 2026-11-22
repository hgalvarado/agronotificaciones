-- =====================================================================
-- PRUEBAS de sql/127 · AgroMétricas: índice de crecimiento (IC)   (ESCRITAS, SIN CORRER)
-- Base: réplica con 91-123 y 125 (125 = _agm_puede_*_registro, turno_lotes, _agm_uuid_appsheet) + 127. Desde la raíz del repo:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/127_agrometricas_indice_crecimiento.sql
-- Todo corre en una transacción y termina con ROLLBACK. Al final repite la migración en otros órdenes:
--   127>127, 125>127>125, 109>127, 122>127 (la 127 solo crea objetos agm_ic_*: no debe perderse nada).
-- Fechas relativas a «hoy» en UTC-6 (la regla «solo hoy y ayer sin Corregir parámetros» depende del día).
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function pg_temp.como(p uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false) $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
    if p_cond is distinct from true then raise exception 'FALLA: %', p_msg; end if;
    raise notice 'ok  %', p_msg;
end $$;
create or replace function pg_temp.falla(p_sql text, p_msg text, p_texto text default null, p_code text default null) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: % (no falló)', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    if p_texto is not null and position(p_texto in sqlerrm) = 0 then raise exception 'FALLA: % (mensaje inesperado: %)', p_msg, sqlerrm; end if;
    if p_code is not null and sqlstate <> p_code then raise exception 'FALLA: % (código % y se esperaba %)', p_msg, sqlstate, p_code; end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
/** Mensaje de confirmación a partir de lo que devolvió fn_agm_ic_exportar (solo las filas de esta prueba). */
create or replace function pg_temp.mk(p_exp jsonb) returns jsonb language sql as $$
    with f as (select e ->> 'id' as id, e ->> 'huella' as huella, e ->> 'cursor' as cursor
                 from jsonb_array_elements(p_exp -> 'filas') e)
    select jsonb_build_object(
        'lote', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'huella', huella) order by cursor collate "C") from f), '[]'::jsonb),
        'cuantos', (select count(*) from f),
        'sha256_lote', encode(sha256(convert_to(coalesce((select string_agg(huella, '|' order by cursor collate "C") from f), ''), 'UTF8')), 'hex'))
$$;
create or replace function pg_temp.exp() returns jsonb language sql as $$
    select jsonb_set(x, '{filas}', coalesce((select jsonb_agg(e) from jsonb_array_elements(x -> 'filas') e where e ->> 'turno_agl_id' like 'T127-%'), '[]'::jsonb))
      from (select fn_agm_ic_exportar('{"limite":1000}') as x) q
$$;
create or replace function pg_temp.reg(p jsonb) returns jsonb language sql as $$ select fn_agm_ic_registrar(p) $$;
create or replace function pg_temp.mr(p jsonb) returns jsonb language sql as $$ select fn_agm_ic_mis_registros(p) $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- roles y personas
do $$
declare ra smallint; re smallint; rd smallint; ro smallint; rl smallint; rx smallint; rz smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T127_ADM', 'P127 administrador', true) on conflict (codigo) do update set acceso_total = true;
    insert into roles (codigo, nombre) values ('T127_ENC', 'P127 encargado'), ('T127_DUE', 'P127 dueño'), ('T127_OTRO', 'P127 otro'),
        ('T127_AGL', 'P127 AGL'), ('T127_ELIM', 'P127 elimina'), ('T127_ZB', 'P127 zona B') on conflict (codigo) do nothing;
    select id into ra from roles where codigo = 'T127_ADM';
    select id into re from roles where codigo = 'T127_ENC';
    select id into rd from roles where codigo = 'T127_DUE';
    select id into ro from roles where codigo = 'T127_OTRO';
    select id into rl from roles where codigo = 'T127_AGL';
    select id into rx from roles where codigo = 'T127_ELIM';
    select id into rz from roles where codigo = 'T127_ZB';
    insert into permisos (rol_id, recurso, accion, permitido, alcance) values
        (re, 'agrometricas', 'ver', true, 'zonal'), (re, 'agrometricas', 'registrar_parametros', true, 'zonal'),
        (re, 'agrometricas', 'corregir_parametros', true, 'zonal'), (re, 'agrometricas', 'configurar_rangos', true, 'zonal'),
        (rd, 'agrometricas', 'ver', true, 'zonal'), (rd, 'agrometricas', 'registrar_parametros', true, 'zonal'),
        (ro, 'agrometricas', 'ver', true, 'zonal'), (ro, 'agrometricas', 'registrar_parametros', true, 'zonal'),
        (rz, 'agrometricas', 'ver', true, 'zonal'), (rz, 'agrometricas', 'registrar_parametros', true, 'zonal'),
        (rl, 'fertirriego_agl', 'ver', true, 'global'), (rl, 'fertirriego_agl', 'publicar', true, 'global'),
        (rx, 'agrometricas', 'ver', true, 'global'), (rx, 'agrometricas', 'eliminar_definitivo', true, 'global')
    on conflict (rol_id, recurso, accion) do update set permitido = true, alcance = excluded.alcance;
    insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-000000012701', 'adm@t127.test'), ('00000000-0000-0000-0000-000000012702', 'enc@t127.test'),
        ('00000000-0000-0000-0000-000000012703', 'due@t127.test'), ('00000000-0000-0000-0000-000000012704', 'otro@t127.test'),
        ('00000000-0000-0000-0000-000000012705', 'agl@t127.test'), ('00000000-0000-0000-0000-000000012706', 'elim@t127.test'),
        ('00000000-0000-0000-0000-000000012707', 'zb@t127.test'), ('00000000-0000-0000-0000-000000012708', 'hist@t127.test')
    on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000012701', 'Admin 127', ra, true), ('00000000-0000-0000-0000-000000012702', 'Encargado 127', re, false),
        ('00000000-0000-0000-0000-000000012703', 'Dueño 127', rd, false), ('00000000-0000-0000-0000-000000012704', 'Otro 127', ro, false),
        ('00000000-0000-0000-0000-000000012705', 'AGL 127', rl, true), ('00000000-0000-0000-0000-000000012706', 'Elimina 127', rx, true),
        ('00000000-0000-0000-0000-000000012707', 'Zona B 127', rz, false), ('00000000-0000-0000-0000-000000012708', 'Hist 127', rd, false)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000012701', ra), ('00000000-0000-0000-0000-000000012702', re), ('00000000-0000-0000-0000-000000012703', rd),
        ('00000000-0000-0000-0000-000000012704', ro), ('00000000-0000-0000-0000-000000012705', rl), ('00000000-0000-0000-0000-000000012706', rx),
        ('00000000-0000-0000-0000-000000012707', rz), ('00000000-0000-0000-0000-000000012708', rd) on conflict do nothing;
end $$;

insert into zonas (nombre) values ('T127-A'), ('T127-B') on conflict (nombre) do nothing;
insert into turnos (codigo, nombre, zona_id) select 'T127-T1', 'T127 uno', id from zonas where nombre = 'T127-A' on conflict (codigo) do nothing;
insert into turnos (codigo, nombre, zona_id) select 'T127-T2', 'T127 dos', id from zonas where nombre = 'T127-B' on conflict (codigo) do nothing;
-- siembra = hoy − 10 días (UTC-6): ayer = DDT 9, hoy = DDT 10
insert into turnos_ciclo (agl_id, turno_id, temporada, ciclo, fecha_siembra, zona_id, activo)
select 'T127-TR-A', (select id from turnos where codigo = 'T127-T1'), 'T127-2026-2027', 'Ciclo 1',
       (now() at time zone 'America/Tegucigalpa')::date - 10, (select id from zonas where nombre = 'T127-A'), true
on conflict (agl_id) do update set activo = true, fecha_siembra = excluded.fecha_siembra;
insert into turnos_ciclo (agl_id, turno_id, temporada, ciclo, fecha_siembra, zona_id, activo)
select 'T127-TR-B', (select id from turnos where codigo = 'T127-T2'), 'T127-2026-2027', 'Ciclo 1',
       (now() at time zone 'America/Tegucigalpa')::date - 10, (select id from zonas where nombre = 'T127-B'), true
on conflict (agl_id) do update set activo = true, fecha_siembra = excluded.fecha_siembra;
insert into perfiles_zonas (perfil_id, zona_id)
select x.p, z.id from (values ('00000000-0000-0000-0000-000000012702'::uuid, 'T127-A'), ('00000000-0000-0000-0000-000000012703', 'T127-A'),
                              ('00000000-0000-0000-0000-000000012704', 'T127-A'), ('00000000-0000-0000-0000-000000012707', 'T127-B'),
                              ('00000000-0000-0000-0000-000000012708', 'T127-A')) x(p, zn)
join zonas z on z.nombre = x.zn on conflict do nothing;

create temp table k as select
    '00000000-0000-0000-0000-000000012701'::uuid as adm, '00000000-0000-0000-0000-000000012702'::uuid as enc,
    '00000000-0000-0000-0000-000000012703'::uuid as due, '00000000-0000-0000-0000-000000012704'::uuid as otro,
    '00000000-0000-0000-0000-000000012705'::uuid as agl, '00000000-0000-0000-0000-000000012706'::uuid as elim,
    '00000000-0000-0000-0000-000000012707'::uuid as zb,
    (select id from turnos_ciclo where agl_id = 'T127-TR-A') as tca, (select id from turnos_ciclo where agl_id = 'T127-TR-B') as tcb,
    (now() at time zone 'America/Tegucigalpa')::date as hoy;
create temp table sv (clave text primary key, v text);
grant all on all tables in schema pg_temp to public;
select pg_temp.ok((select tca is not null and tcb is not null from k), 'datos de la prueba creados');

-- ---------------------------------------------------------------- esquema y siembra
select pg_temp.ok((select count(*) = 3 from information_schema.tables where table_name in ('agm_ic_formula', 'agm_ic_plan', 'agm_ic_registros')), 'las 3 tablas existen');
select pg_temp.ok(exists (select 1 from pg_indexes where indexname = 'agm_ic_registros_turno_dia_viva' and indexdef ilike '%eliminado_en IS NULL%')
                  and exists (select 1 from pg_indexes where indexname = 'agm_ic_registros_id_appsheet_uq' and indexdef ilike '%id_appsheet IS NOT NULL%'),
                  'un IC por turno y día entre los NO eliminados; id_appsheet único parcial');
select pg_temp.ok((select divisor = 10 and exponente_ddt = 1 from agm_ic_formula where vigente_desde = date '2000-01-01'), 'versión inicial: divisor 10, exponente 1');
select pg_temp.ok((select count(*) = 16 and min(ddt) = 5 and max(ddt) = 20 and min(ic_plan) = 0.30 and max(ic_plan) = 1.30
                   from agm_ic_plan p join agm_ic_formula f on f.id = p.version_id where f.vigente_desde = date '2000-01-01'), 'plan inicial: 16 DDT (5 a 20), de 0.30 a 1.30');
select pg_temp.ok((select ic_plan = 0.38 from agm_ic_plan p join agm_ic_formula f on f.id = p.version_id where f.vigente_desde = date '2000-01-01' and ddt = 10), 'plan DDT 10 = 0.38 (IC_Plan de AppSheet)');
select pg_temp.ok(public._agm_ic_calc(20, 5, 10, 1) = 0.4 and public._agm_ic_calc(30, 7, 10, 1) = 0.4286 and public._agm_ic_calc(36, 6, 1, 2) = 1
                  and public._agm_ic_calc(20, 0, 10, 1) is null and public._agm_ic_calc(null, 5, 10, 1) is null and public._agm_ic_calc(20, 5, 0, 1) is null,
                  'fórmula: hojas / DDT^exp / divisor a 4 decimales; sin datos o DDT ≤ 0 = null');
select pg_temp.ok(not exists (select 1 from permisos where recurso = 'agrometricas' and accion = 'eliminar_definitivo' and permitido
                              and rol_id not in (select id from roles where codigo = 'T127_ELIM')), 'la 127 no concede permisos nuevos');

-- ---------------------------------------------------------------- permisos de la fórmula y lectura
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_agm_ic_config() $q$, 'config sin sesión: 42501', 'sesión', '42501');
select pg_temp.como((select due from k));
select pg_temp.ok((select jsonb_array_length(fn_agm_ic_config() -> 'versiones') >= 1), 'quien ve AgroMétricas lee la fórmula (teléfono)');
select pg_temp.ok((select (fn_agm_ic_formula_vigente((select hoy from k)) ->> 'divisor')::numeric = 10), 'fórmula vigente hoy = la inicial');
select pg_temp.falla($q$ select fn_agm_ic_guardar_formula('{"vigente_desde":"2030-01-01","divisor":10}') $q$, 'dueño no guarda fórmula: 42501', 'Configurar rangos', '42501');
select pg_temp.falla($q$ select fn_agm_ic_recalcular('{}') $q$, 'dueño no recalcula: 42501', 'Configurar rangos', '42501');
select pg_temp.como((select zb from k));
select pg_temp.falla($q$ select fn_agm_ic_guardar_formula('{"vigente_desde":"2030-01-01","divisor":10}') $q$, 'zona B sin configurar: 42501', 'Configurar rangos', '42501');

-- ---------------------------------------------------------------- registrar (ayer, con la fórmula inicial)
select pg_temp.como((select due from k));
create temp table r1 as select pg_temp.reg(jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000127001', 'turno_ciclo_id', (select tca from k),
    'fecha', ((select hoy from k) - 1)::text, 'hojas', 27, 'comentario', 'primera')) as j;
select pg_temp.ok((select (j ->> 'ddt')::int = 9 and (j ->> 'hojas')::numeric = 27 and (j ->> 'ic_real')::numeric = 0.3 and (j ->> 'ic_plan')::numeric = 0.36
                          and j ->> 'version_formula_id' = (select id::text from agm_ic_formula where vigente_desde = date '2000-01-01')
                          and j ->> 'origen' = 'CAMPO' and j ->> 'creado_por' = (select due::text from k) and not (j ? 'huella') from r1),
                  'ayer: DDT 9 (siembra del turno), IC 27/9/10 = 0.3, plan DDT 9 = 0.36, versión inicial, sin marcas internas');
select pg_temp.ok((select (pg_temp.reg(j) ->> 'repetido')::boolean from (select j from r1) x), 'reenviar el MISMO id: idempotente (repetido, sin cambios)');
select pg_temp.ok((select count(*) = 1 from agm_ic_registros where turno_ciclo_id = (select tca from k)), 'sigue siendo 1 registro');
select pg_temp.falla(format($q$ select fn_agm_ic_registrar(jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000127002','turno_ciclo_id','%s','fecha','%s','hojas',30)) $q$,
                            (select tca from k), (select hoy - 1 from k)), 'segundo registro del mismo turno y día SIN confirmar: 22023', 'corrección', '22023');
select pg_temp.falla(format($q$ select fn_agm_ic_registrar(jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000127003','turno_ciclo_id','%s','fecha','%s','hojas',31)) $q$,
                            (select tca from k), (select hoy + 1 from k)), 'día futuro: 22023', 'futuros', '22023');
select pg_temp.falla(format($q$ select fn_agm_ic_registrar(jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000127004','turno_ciclo_id','%s','fecha','%s','hojas',-1)) $q$,
                            (select tca from k), (select hoy from k)), 'hojas negativas: 22003', 'hojas', '22003');
select pg_temp.falla(format($q$ select fn_agm_ic_registrar(jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000127004','turno_ciclo_id','%s','fecha','%s','hojas','abc')) $q$,
                            (select tca from k), (select hoy from k)), 'hojas no numéricas: 22P02', 'número', '22P02');
select pg_temp.falla(format($q$ select fn_agm_ic_registrar(jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000127004','turno_ciclo_id','%s','fecha','%s')) $q$,
                            (select tca from k), (select hoy from k)), 'sin hojas: 22023', 'hojas', '22023');
select pg_temp.falla(format($q$ select fn_agm_ic_registrar(jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000127004','turno_ciclo_id','%s','fecha','%s','hojas',5)) $q$,
                            (select tca from k), (select hoy - 5 from k)), 'dueño con día anterior a ayer (sin Corregir): 42501', 'Corregir', '42501');
select pg_temp.falla($q$ select fn_agm_ic_registrar('{"id":"aaaaaaaa-0000-0000-0000-000000127004","turno_ciclo_id":"00000000-0000-0000-0000-000000000000","fecha":"2026-01-01","hojas":5}') $q$,
                     'turno inexistente: 22023', 'turno', '22023');
select pg_temp.como((select zb from k));
select pg_temp.falla(format($q$ select fn_agm_ic_registrar(jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000127005','turno_ciclo_id','%s','fecha','%s','hojas',5)) $q$,
                            (select tca from k), (select hoy from k)), 'usuario de otra zona no registra en el turno A: 42501', 'permiso', '42501');
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_agm_ic_registrar('{}') $q$, 'registrar sin sesión: 42501', 'sesión', '42501');

-- ---------------------------------------------------------------- corrección del mismo día
select pg_temp.como((select otro from k));
select pg_temp.falla(format($q$ select fn_agm_ic_registrar(jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000127006','turno_ciclo_id','%s','fecha','%s','hojas',40,'correccion',true)) $q$,
                            (select tca from k), (select hoy - 1 from k)), 'corregir lo de OTRA persona sin «Corregir parámetros»: 42501', 'Corregir', '42501');
select pg_temp.como((select due from k));
create temp table r2 as select pg_temp.reg(jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000127007', 'turno_ciclo_id', (select tca from k),
    'fecha', ((select hoy from k) - 1)::text, 'hojas', 36, 'correccion', true)) as j;
select pg_temp.ok((select j ->> 'id' = 'aaaaaaaa-0000-0000-0000-000000127001' and (j ->> 'hojas')::numeric = 36 and (j ->> 'ic_real')::numeric = 0.4
                          and (j ->> 'correccion')::boolean and j ->> 'editado_en' is not null and j ->> 'comentario' = 'primera' from r2),
                  'corrección confirmada: reemplaza el registro del día (mismo id), IC 36/9/10 = 0.4, conserva el comentario y marca editado');
select pg_temp.ok((select count(*) = 1 from agm_ic_registros where turno_ciclo_id = (select tca from k) and eliminado_en is null), 'sigue habiendo un solo IC por turno y día');

-- ---------------------------------------------------------------- versiones por fecha (la nueva rige desde HOY)
select pg_temp.como((select enc from k));
create temp table f2 as select fn_agm_ic_guardar_formula(jsonb_build_object('vigente_desde', (select hoy from k)::text, 'divisor', 12, 'exponente_ddt', 1, 'notas', 'prueba 127')) as j;
select pg_temp.ok((select (j ->> 'divisor')::numeric = 12 and jsonb_array_length(j -> 'plan') = 16 from f2), 'versión nueva sin plan: copia el plan de la vigente (16 DDT)');
select pg_temp.ok((select (fn_agm_ic_formula_vigente((select hoy from k)) ->> 'divisor')::numeric = 12
                   and (fn_agm_ic_formula_vigente((select hoy - 1 from k)) ->> 'divisor')::numeric = 10), 'vigente por fecha: hoy divisor 12, ayer divisor 10');
select pg_temp.ok((select ic_real = 0.4 and ic_plan = 0.36 from agm_ic_registros where id = 'aaaaaaaa-0000-0000-0000-000000127001'),
                  'cambiar la fórmula NO recalcula lo ya guardado');
select pg_temp.falla($q$ select fn_agm_ic_guardar_formula('{"vigente_desde":"2031-01-01","divisor":0}') $q$, 'divisor 0: 22023', 'divisor', '22023');
select pg_temp.falla($q$ select fn_agm_ic_guardar_formula('{"vigente_desde":"2031-01-01","divisor":10,"exponente_ddt":4}') $q$, 'exponente 4: 22023', 'exponente', '22023');
select pg_temp.falla($q$ select fn_agm_ic_guardar_formula('{"divisor":10}') $q$, 'sin fecha: 22023', 'fecha', '22023');
select pg_temp.falla($q$ select fn_agm_ic_guardar_formula('{"vigente_desde":"2031-01-01","divisor":10,"plan":[{"ddt":5,"ic_plan":0.3},{"ddt":5,"ic_plan":0.4}]}') $q$, 'DDT repetido en el plan: 22023', 'repetido', '22023');
select pg_temp.falla($q$ select fn_agm_ic_guardar_formula('{"vigente_desde":"2031-01-01","divisor":10,"plan":"x"}') $q$, 'plan que no es lista: 22023', 'plan', '22023');
select pg_temp.ok((select count(*) = 0 from agm_ic_formula where vigente_desde = date '2031-01-01'), 'las validaciones fallidas no dejan versiones a medias');
-- misma fecha = reemplaza (no duplica) y el plan nuevo reemplaza al anterior
select pg_temp.ok((select jsonb_array_length(fn_agm_ic_guardar_formula(jsonb_build_object('vigente_desde', (select hoy from k)::text, 'divisor', 12.5, 'exponente_ddt', 1,
                          'plan', '[{"ddt":5,"ic_plan":0.5},{"ddt":10,"ic_plan":0.9}]'::jsonb)) -> 'plan') = 2
                   and (select count(*) = 1 from agm_ic_formula where vigente_desde = (select hoy from k))), 'misma fecha: reemplaza la versión y su plan (sin duplicar)');
select pg_temp.ok((select (fn_agm_ic_guardar_formula(jsonb_build_object('vigente_desde', (select hoy from k)::text, 'divisor', 12, 'exponente_ddt', 1)) -> 'plan') = '[{"ddt":5,"ic_plan":0.5},{"ddt":10,"ic_plan":0.9}]'::jsonb),
                  'misma fecha sin plan: conserva el plan que ya tenía');

-- hoy con la versión nueva (divisor 12, plan propio: DDT 10 = 0.9)
select pg_temp.como((select due from k));
create temp table r3 as select pg_temp.reg(jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000127008', 'turno_ciclo_id', (select tca from k),
    'fecha', (select hoy from k)::text, 'hojas', 30)) as j;
select pg_temp.ok((select (j ->> 'ddt')::int = 10 and (j ->> 'ic_real')::numeric = 0.25 and (j ->> 'ic_plan')::numeric = 0.9
                          and j ->> 'version_formula_id' = (select id::text from agm_ic_formula where vigente_desde = (select hoy from k)) from r3),
                  'hoy rige la versión nueva: IC 30/10/12 = 0.25, plan DDT 10 = 0.9, version_formula_id = la nueva');
-- DDT fuera de 5–20: solo se avisa en el teléfono; la base lo guarda (turno B, zona B, siembra hace 10 días → DDT 10; ahora otro turno sin siembra)
select pg_temp.como((select zb from k));
create temp table r4 as select pg_temp.reg(jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000127009', 'turno_ciclo_id', (select tcb from k),
    'fecha', ((select hoy from k) - 1)::text, 'hojas', 18)) as j;
select pg_temp.ok((select (j ->> 'ic_real')::numeric = 0.2 and (j ->> 'ddt')::int = 9 from r4), 'turno de la zona B: la persona de B registra (alcance por zona)');
-- lote de la cola
select pg_temp.ok((select (j -> 'resultados' -> 0 ->> 'ok')::boolean and not (j -> 'resultados' -> 1 ->> 'ok')::boolean
                          and j -> 'resultados' -> 1 ->> 'codigo' = '22023' and jsonb_array_length(j -> 'resultados') = 2
                   from (select pg_temp.reg(jsonb_build_object('registros', jsonb_build_array(
                        jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000127010', 'turno_ciclo_id', (select tcb from k), 'fecha', (select hoy from k)::text, 'hojas', 20),
                        jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000127011', 'turno_ciclo_id', (select tcb from k), 'fecha', (select hoy from k)::text, 'hojas', 21)))) as j) q),
                  'lote de la cola: el primero entra, el segundo (mismo turno y día sin confirmar) falla con su código y no frena al resto');

-- ---------------------------------------------------------------- mis registros (visibilidad por zona)
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_agm_ic_mis_registros('{}') $q$, 'mis registros sin sesión: 42501', 'sesión', '42501');
select pg_temp.como((select otro from k));   -- otra persona de la zona A: ve lo de la zona (no solo lo suyo), no lo de B
select pg_temp.ok((select (pg_temp.mr('{"turno":"T127-T1"}') ->> 'total')::int = 2), 'otra persona de la zona A ve los 2 registros del turno A (por zona, aunque no los capturó)');
select pg_temp.ok((select (pg_temp.mr('{"turno":"T127-T2"}') ->> 'total')::int = 0), 'y ninguno de la zona B');
select pg_temp.ok((select every((r ->> 'puede_editar')::boolean = false) and every((r ->> 'puede_eliminar')::boolean = false)
                   from jsonb_array_elements(pg_temp.mr('{"turno":"T127-T1"}') -> 'registros') r), 'sin ser dueño ni encargado no edita; sin el permiso nuevo no elimina');
select pg_temp.como((select due from k));
select pg_temp.ok((select every((r ->> 'puede_editar')::boolean) from jsonb_array_elements(pg_temp.mr('{"turno":"T127-T1"}') -> 'registros') r), 'el dueño puede editar los suyos');
select pg_temp.ok((select (pg_temp.mr('{"turno":"t127-t1","limite":1}') ->> 'total')::int = 2 and jsonb_array_length(pg_temp.mr('{"turno":"T127-T1","limite":1}') -> 'registros') = 1
                          and pg_temp.mr('{"turno":"T127-T1","limite":1,"orden":"desc"}') -> 'registros' -> 0 ->> 'fecha' = (select hoy::text from k)),
                  'filtro de turno exacto (sin mayúsculas), paginación y orden descendente por fecha');
select pg_temp.ok((select (pg_temp.mr(jsonb_build_object('turno_contiene', 'T127-T', 'desde', (select hoy from k)::text)) ->> 'total')::int = 1), 'turno_contiene y filtro de fechas');
select pg_temp.ok((select not (r ? 'huella') and not (r ? 'bajado_a_agl_en') and not (r ? 'eliminado_motivo') and r ->> 'turno' = 'T127-T1' and r ->> 'zona' = 'T127-A'
                   from jsonb_array_elements(pg_temp.mr('{"turno":"T127-T1"}') -> 'registros') r limit 1), 'la lista no trae marcas internas e incluye turno y zona');
select pg_temp.como((select zb from k));
select pg_temp.ok((select (pg_temp.mr('{}') ->> 'total')::int >= 1 and not exists (select 1 from jsonb_array_elements(pg_temp.mr('{}') -> 'registros') r where r ->> 'turno' = 'T127-T1')),
                  'la persona de la zona B no ve lo de la A');
select pg_temp.como((select adm from k));
select pg_temp.ok((select (pg_temp.mr('{"temporada":"T127-2026-2027"}') ->> 'total')::int = 4), 'el administrador ve todo (2 de la zona A + 2 de la B)');
select pg_temp.ok((select count(*) = 4 from agm_ic_registros where turno_ciclo_id in (select tca from k union select tcb from k)), 'en total 4 filas (2 en A, 2 en B)');
select pg_temp.como((select due from k));
select pg_temp.ok((select count(*) = 2 from agm_ic_registros where turno_ciclo_id = (select tca from k)), 'RLS: el dueño lee directo lo de su zona');

-- ---------------------------------------------------------------- editar
create temp table e1 as select fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127001","hojas":45}') as j;
select pg_temp.ok((select (j ->> 'cambio')::boolean and (j -> 'registro' ->> 'ic_real')::numeric = 0.5 and j -> 'registro' ->> 'editado_en' is not null from e1),
                  'dueño edita sus hojas: IC 45/9/10 = 0.5 con la MISMA versión que ya tenía (editar no cambia de versión)');
select pg_temp.ok((select not (fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127001","hojas":45}') ->> 'cambio')::boolean), 'editar sin cambios: cambio = false');
select pg_temp.falla($q$ select fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127001","hojas":"x"}') $q$, 'hojas texto al editar: 22P02', 'número', '22P02');
select pg_temp.falla($q$ select fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127001","hojas":""}') $q$, 'hojas vacías al editar: 22023', 'vacío', '22023');
select pg_temp.falla($q$ select fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127001","hojas":1000000}') $q$, 'hojas enormes al editar: 22003', 'hojas', '22003');
select pg_temp.falla($q$ select fn_agm_ic_editar('{}') $q$, 'editar sin id: 22023', 'registro', '22023');
select pg_temp.como((select otro from k));
select pg_temp.falla($q$ select fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127001","hojas":1}') $q$, 'otra persona sin Corregir no edita lo ajeno: 42501', 'permiso', '42501');
select pg_temp.como((select enc from k));
select pg_temp.ok((select (fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127001","hojas":36,"comentario":"revisado"}') ->> 'cambio')::boolean), 'el encargado de la zona (Corregir) edita lo de otros');
select pg_temp.ok((select comentario = 'revisado' and hojas = 36 and ic_real = 0.4 and editado_por = (select enc from k) from agm_ic_registros where id = 'aaaaaaaa-0000-0000-0000-000000127001'), 'quedó editado por el encargado');

-- ---------------------------------------------------------------- recalcular (explícito, con vista previa)
-- el registro de ayer (versión inicial) NO cambia solo; se cambia la inicial a divisor 20 y se pide recalcular
select fn_agm_ic_guardar_formula('{"vigente_desde":"2000-01-01","divisor":20,"exponente_ddt":1,"notas":"inicial editada en la prueba"}');
select pg_temp.ok((select ic_real = 0.4 from agm_ic_registros where id = 'aaaaaaaa-0000-0000-0000-000000127001'), 'editar la versión inicial tampoco recalcula (sigue 0.4)');
insert into sv select 'antes', md5(string_agg(id::text || coalesce(ic_real::text, '') || coalesce(ic_plan::text, ''), '|' order by id)) from agm_ic_registros;
create temp table p1 as select fn_agm_ic_recalcular(jsonb_build_object('turno_ciclo_id', (select tca from k))) as j;   -- previsualizar por defecto
select pg_temp.ok((select (j ->> 'previsualizacion')::boolean and (j ->> 'total')::int = 2 and (j ->> 'cambian')::int = 1
                          and (j -> 'muestra' -> 0 ->> 'ic_real_antes')::numeric = 0.4 and (j -> 'muestra' -> 0 ->> 'ic_real_despues')::numeric = 0.2 from p1),
                  'vista previa: de 2 registros cambia 1 (ayer: 0.4 → 36/9/20 = 0.2); hoy ya estaba con la versión vigente');
select pg_temp.ok((select v = md5(string_agg(id::text || coalesce(ic_real::text, '') || coalesce(ic_plan::text, ''), '|' order by id)) from agm_ic_registros, sv where clave = 'antes' group by v),
                  'la vista previa NO escribe nada');
select pg_temp.como((select due from k));
select pg_temp.falla($q$ select fn_agm_ic_recalcular('{"previsualizar":false}') $q$, 'aplicar el recálculo sin Configurar rangos: 42501', 'Configurar rangos', '42501');
select pg_temp.como((select zb from k));
select pg_temp.falla($q$ select fn_agm_ic_recalcular('{"previsualizar":false}') $q$, 'otra zona sin Configurar rangos: 42501', 'Configurar rangos', '42501');
select pg_temp.como((select enc from k));
select pg_temp.ok((select (fn_agm_ic_recalcular(jsonb_build_object('previsualizar', false, 'turno_ciclo_id', (select tca from k))) ->> 'actualizados')::int = 1), 'aplicar: actualiza solo lo que cambia (1)');
select pg_temp.ok((select ic_real = 0.2 and ic_plan = 0.36 and editado_en is not null from agm_ic_registros where id = 'aaaaaaaa-0000-0000-0000-000000127001'), 'ayer recalculado con divisor 20');
select pg_temp.ok((select (fn_agm_ic_recalcular(jsonb_build_object('turno_ciclo_id', (select tca from k))) ->> 'cambian')::int = 0), 'repetir la vista previa: ya no cambia nada');
select pg_temp.ok((select (fn_agm_ic_recalcular(('{"turno_ciclo_id":"' || (select tcb from k) || '"}')::jsonb) ->> 'total')::int = 0), 'el encargado de la zona A no toca los registros de la zona B');
select fn_agm_ic_guardar_formula('{"vigente_desde":"2000-01-01","divisor":10,"exponente_ddt":1}');   -- se devuelve el divisor original

-- ---------------------------------------------------------------- eliminar (tumba)
select pg_temp.como((select due from k));
select pg_temp.falla($q$ select fn_agm_ic_eliminar('{"id":"aaaaaaaa-0000-0000-0000-000000127008","motivo":"un motivo largo para eliminar"}') $q$, 'sin «Eliminar por completo»: 42501', 'Eliminar por completo', '42501');
select pg_temp.como((select elim from k));
select pg_temp.falla($q$ select fn_agm_ic_eliminar('{"id":"aaaaaaaa-0000-0000-0000-000000127008","motivo":"corto"}') $q$, 'motivo corto: 22023', '15 letras', '22023');
select pg_temp.falla($q$ select fn_agm_ic_eliminar('{"motivo":"un motivo largo para eliminar"}') $q$, 'sin id: 22023', 'registro', '22023');
select pg_temp.falla($q$ select fn_agm_ic_eliminar('{"id":"aaaaaaaa-0000-0000-0000-0000000fffff","motivo":"un motivo largo para eliminar"}') $q$, 'id inexistente: 22023', 'no existe', '22023');
select pg_temp.ok((select (fn_agm_ic_eliminar('{"id":"aaaaaaaa-0000-0000-0000-000000127008","motivo":"duplicado, se midió dos veces"}') ->> 'eliminado_en') is not null), 'con el permiso nuevo y motivo ≥ 15 letras: eliminado (tumba)');
select pg_temp.falla($q$ select fn_agm_ic_eliminar('{"id":"aaaaaaaa-0000-0000-0000-000000127008","motivo":"duplicado, se midió dos veces"}') $q$, 'eliminar dos veces: 22023', 'ya fue eliminado', '22023');
select pg_temp.ok((select eliminado_motivo = 'duplicado, se midió dos veces' and eliminado_por = (select elim from k) from agm_ic_registros where id = 'aaaaaaaa-0000-0000-0000-000000127008'), 'la fila queda como tumba con motivo y autor');
select pg_temp.ok((select (pg_temp.mr('{"turno":"T127-T1"}') ->> 'total')::int = 1), 'lo eliminado ya no aparece en la lista');
select pg_temp.como((select due from k));
select pg_temp.ok((select count(*) = 1 from agm_ic_registros where turno_ciclo_id = (select tca from k) and eliminado_en is null), 'RLS: lo eliminado no se lee directo');
select pg_temp.falla(format($q$ select fn_agm_ic_registrar(jsonb_build_object('id','aaaaaaaa-0000-0000-0000-000000127008','turno_ciclo_id','%s','fecha','%s','hojas',30)) $q$,
                            (select tca from k), (select hoy from k)), 'reenviar el id de un eliminado: 22023 (no se resucita)', 'eliminado', '22023');
select pg_temp.ok((select pg_temp.reg(jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000127012', 'turno_ciclo_id', (select tca from k), 'fecha', (select hoy from k)::text, 'hojas', 33)) ->> 'hojas')::numeric = 33,
                  'tras eliminar se puede volver a registrar ese turno y día (índice único parcial)');

-- ---------------------------------------------------------------- baja a AGL
select pg_temp.como((select due from k));
select pg_temp.falla($q$ select fn_agm_ic_exportar('{}') $q$, 'exportar sin permiso AGL: 42501', 'permiso', '42501');
select pg_temp.falla($q$ select fn_agm_ic_exportar_formulas() $q$, 'fórmulas sin permiso AGL: 42501', 'permiso', '42501');
select pg_temp.falla($q$ select fn_agm_ic_confirmar_bajada('{"lote":[],"cuantos":0,"sha256_lote":""}') $q$, 'confirmar sin permiso AGL: 42501', 'permiso', '42501');
select pg_temp.falla($q$ select fn_agm_ic_purgar_bajadas('{}') $q$, 'purgar sin permiso AGL: 42501', 'permiso', '42501');
select pg_temp.como((select agl from k));
select pg_temp.ok((select jsonb_array_length(fn_agm_ic_exportar_formulas() -> 'versiones') >= 2), 'AGL lee las versiones de fórmula con su plan');
create temp table x1 as select pg_temp.exp() as j;
select pg_temp.ok((select jsonb_array_length(j -> 'filas') = (select count(*) from agm_ic_registros where bajado_a_agl_en is null and turno_ciclo_id in (select tca from k union select tcb from k)) from x1),
                  'exportar: todo lo que nunca se bajó (incluida la tumba)');
select pg_temp.ok((select count(*) = 1 from x1, jsonb_array_elements(j -> 'filas') e where (e ->> 'eliminado')::boolean and e ->> 'turno' = 'T127-T1'), 'la tumba viaja marcada como eliminada');
select pg_temp.ok((select every(e ->> 'huella' = encode(sha256(convert_to(e ->> 'texto', 'UTF8')), 'hex')) from x1, jsonb_array_elements(j -> 'filas') e),
                  'la huella de cada fila es el sha256 de su texto (AGL puede recalcularla)');
select pg_temp.ok((select every(e ->> 'creado_por_email' is not null) from x1, jsonb_array_elements(j -> 'filas') e), 'cada fila trae el correo del autor');
select pg_temp.falla($q$ select fn_agm_ic_confirmar_bajada('{"lote":[{"id":"aaaaaaaa-0000-0000-0000-000000127001","huella":"x"}],"cuantos":1,"sha256_lote":"mal"}') $q$, 'huella del lote distinta: 22023', 'huella del lote', '22023');
select pg_temp.falla($q$ select fn_agm_ic_confirmar_bajada('{"lote":[{"id":"aaaaaaaa-0000-0000-0000-000000127001","huella":"x"}],"cuantos":2,"sha256_lote":"x"}') $q$, 'conteo distinto: 22023', 'conteo', '22023');
-- cambia una fila entre la lectura y la confirmación: queda rechazada y sigue por bajar
select pg_temp.como((select enc from k));
select fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127012","hojas":34}');
select pg_temp.como((select agl from k));
create temp table cf1 as select fn_agm_ic_confirmar_bajada(pg_temp.mk((select j from x1))) as j;
select pg_temp.ok((select jsonb_array_length(j -> 'rechazadas') = 1 and j -> 'rechazadas' -> 0 ->> 'id' = 'aaaaaaaa-0000-0000-0000-000000127012' from cf1),
                  'la fila que cambió entre la lectura y la confirmación queda rechazada');
select pg_temp.ok((select jsonb_array_length(j -> 'filas') = 1 and j -> 'filas' -> 0 ->> 'id' = 'aaaaaaaa-0000-0000-0000-000000127012' from (select pg_temp.exp() as j) q), 'y es la única que sigue por bajar');
select pg_temp.ok((select jsonb_array_length((fn_agm_ic_confirmar_bajada(pg_temp.mk(pg_temp.exp())) -> 'rechazadas')) = 0), 'se confirma la segunda lectura sin rechazos');
select pg_temp.ok((select jsonb_array_length(pg_temp.exp() -> 'filas') = 0), 'nada por bajar tras confirmar');
-- editar después de bajar la vuelve a poner por bajar
select pg_temp.como((select enc from k));
select fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127012","hojas":35}');
select pg_temp.como((select agl from k));
select pg_temp.ok((select jsonb_array_length(pg_temp.exp() -> 'filas') = 1), 'editar algo ya bajado lo vuelve a «por bajar»');
select fn_agm_ic_confirmar_bajada(pg_temp.mk(pg_temp.exp()));

-- retención y purga: lo confirmado hace más de la retención se borra SOLO si es tumba o su turno ya no está activo
update agm_ic_registros set bajado_a_agl_en = now() - interval '10 days' where turno_ciclo_id in (select tca from k union select tcb from k);
select pg_temp.ok((select (fn_agm_ic_purgar_bajadas('{}') ->> 'registros')::int = 1), 'purga: solo la tumba (los de un turno ACTIVO se quedan en Supabase)');
select pg_temp.ok((select count(*) = 0 from agm_ic_registros where id = 'aaaaaaaa-0000-0000-0000-000000127008')
                   and (select count(*) = 2 from agm_ic_registros where turno_ciclo_id = (select tca from k)), 'la tumba ya no está; lo vivo del turno activo sigue (2)');
update turnos_ciclo set activo = false where id = (select tca from k);
select pg_temp.ok((select (fn_agm_ic_purgar_bajadas('{}') ->> 'registros')::int = 2), 'turno terminado (inactivo): se purgan sus 2 registros confirmados');
select pg_temp.ok((select (fn_agm_ic_purgar_bajadas('{"retencion_dias":3650}') ->> 'registros')::int = 0), 'la retención pedida solo puede aumentar (3650 días: nada que purgar)');
update turnos_ciclo set activo = true where id = (select tca from k);
-- un registro cuya huella cambió después de confirmar no se purga
select pg_temp.como((select zb from k));
select pg_temp.ok((select fn_agm_ic_editar('{"id":"aaaaaaaa-0000-0000-0000-000000127009","hojas":19}') is not null), 'edición en la zona B (turno activo)');
select pg_temp.como((select agl from k));
update agm_ic_registros set bajado_a_agl_en = now() - interval '10 days' where id = 'aaaaaaaa-0000-0000-0000-000000127009';
update turnos_ciclo set activo = false where id = (select tcb from k);
select pg_temp.ok((select (fn_agm_ic_purgar_bajadas('{}') ->> 'registros')::int = 1 and exists (select 1 from agm_ic_registros where id = 'aaaaaaaa-0000-0000-0000-000000127009')
                          and not exists (select 1 from agm_ic_registros where id = 'aaaaaaaa-0000-0000-0000-000000127010')),
                  'turno B terminado: se purga lo confirmado (010) pero lo cambiado después de la confirmación (009, huella distinta) nunca');
update turnos_ciclo set activo = true where id = (select tcb from k);

-- ---------------------------------------------------------------- cargar el histórico de AppSheet
select pg_temp.como((select due from k));
select pg_temp.falla($q$ select fn_agm_ic_cargar_appsheet('{"registros":[],"mapa_usuarios":{}}') $q$, 'cargar sin permiso AGL: 42501', 'permiso', '42501');
select pg_temp.como((select agl from k));
select pg_temp.falla($q$ select fn_agm_ic_cargar_appsheet('{"mapa_usuarios":{}}') $q$, 'cargar sin lista: 22023', 'registros', '22023');
create temp table carga as select jsonb_build_object(
    'mapa_usuarios', jsonb_build_object('GLOPEZ', 'due@t127.test'),
    'registros', jsonb_build_array(
        jsonb_build_object('id_appsheet', 'T127-I1', 'fecha', '2026-01-10', 'turno_ciclo_id', 'T127-TR-A', 'usuario_appsheet', 'Glopez', 'hojas', 20, 'ddt', 5, 'ic_plan', 0.31, 'comentario', 'hist'),
        jsonb_build_object('id_appsheet', 'T127-I2', 'fecha', '2026-01-11', 'turno_ciclo_id', 'T127-TR-A', 'usuario_appsheet', 'Glopez', 'hojas', 30),
        jsonb_build_object('id_appsheet', 'T127-I3', 'fecha', '2026-01-10', 'turno_ciclo_id', 'T127-TR-A', 'usuario_appsheet', 'Glopez', 'hojas', 99),
        jsonb_build_object('id_appsheet', 'T127-X1', 'fecha', '2026-01-12', 'turno_ciclo_id', 'T127-TR-A', 'usuario_appsheet', 'Nadie', 'hojas', 5),
        jsonb_build_object('id_appsheet', 'T127-X2', 'fecha', '2026-01-12', 'turno_ciclo_id', 'NO-EXISTE', 'usuario_appsheet', 'Glopez', 'hojas', 5),
        jsonb_build_object('id_appsheet', 'T127-X3', 'fecha', '2026-01-13', 'turno_ciclo_id', 'T127-TR-A', 'usuario_appsheet', 'Glopez'))) as p;
create temp table c1 as select fn_agm_ic_cargar_appsheet((select p from carga)) as j;
select pg_temp.ok((select (j ->> 'insertadas')::int = 2 and (j ->> 'ya_existian')::int = 0 and jsonb_array_length(j -> 'sin_usuario') = 1
                          and jsonb_array_length(j -> 'sin_turno') = 1 and jsonb_array_length(j -> 'en_conflicto') = 1 and jsonb_array_length(j -> 'invalidas') = 1 from c1),
                  'cargar: 2 insertadas; sin usuario, sin turno, en conflicto (mismo turno y día) e inválida se informan');
select pg_temp.ok((select ddt = 5 and hojas = 20 and ic_plan = 0.31 and ic_real = 0.4 and origen = 'APPSHEET' and creado_por = (select due from k)
                          and version_formula_id = (select id from agm_ic_formula where vigente_desde = date '2000-01-01') and bajado_a_agl_en is not null
                          and huella = public._agm_ic_huella(to_jsonb(a))
                   from agm_ic_registros a where id_appsheet = 'T127-I1'),
                  'histórico: DDT y plan de AppSheet, IC con la fórmula vigente (20/5/10), autor por correo, ya «bajado» con su huella');
select pg_temp.ok((select ddt = date '2026-01-11' - (select fecha_siembra from turnos_ciclo where id = (select tca from k)) and hojas = 30
                   from agm_ic_registros where id_appsheet = 'T127-I2'), 'sin DDT en AppSheet: se calcula con la siembra del turno');
create temp table c2 as select fn_agm_ic_cargar_appsheet((select p from carga)) as j;
select pg_temp.ok((select (j ->> 'insertadas')::int = 0 and (j ->> 'ya_existian')::int = 2 from c2), 'repetir la carga: idempotente');
select pg_temp.ok((select count(*) = 2 from agm_ic_registros where id_appsheet like 'T127-%'), 'repetir no duplica');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(pg_temp.exp() -> 'filas') e where e -> 'fila' ->> 'id_appsheet' like 'T127-I%')), 'lo cargado de AGL no vuelve a bajar');

-- ---------------------------------------------------------------- otros órdenes de corrida (la 127 solo crea agm_ic_*)
create temp table antes as select
    (select count(*) from agm_ic_registros) as nr, (select md5(string_agg(id::text || coalesce(ic_real::text, '') || hojas::text, '|' order by id)) from agm_ic_registros) as mr,
    (select count(*) from agm_ic_formula) as nf, (select count(*) from agm_ic_plan) as np;
create or replace function pg_temp.finales(p_etq text) returns void language plpgsql as $$
declare a record; ahora record;
begin
    select * into a from antes;
    select (select count(*) from agm_ic_registros) as nr, (select md5(string_agg(id::text || coalesce(ic_real::text, '') || hojas::text, '|' order by id)) from agm_ic_registros) as mr,
           (select count(*) from agm_ic_formula) as nf, (select count(*) from agm_ic_plan) as np into ahora;
    if a.nr <> ahora.nr or a.mr <> ahora.mr or a.nf <> ahora.nf or a.np <> ahora.np then raise exception 'FALLA finales [%]: cambió algún dato', p_etq; end if;
    if not exists (select 1 from agm_ic_formula where vigente_desde = date '2000-01-01' and divisor = 10) then raise exception 'FALLA finales [%]: la fórmula inicial', p_etq; end if;
    raise notice 'ok  finales [%]', p_etq;
end $$;
select pg_temp.como((select enc from k));
select fn_agm_ic_guardar_formula('{"vigente_desde":"2000-01-01","divisor":11,"exponente_ddt":1}');   -- el usuario editó la inicial
update antes set np = (select count(*) from agm_ic_plan);
\i sql/127_agrometricas_indice_crecimiento.sql
select pg_temp.ok((select divisor = 11 from agm_ic_formula where vigente_desde = date '2000-01-01'), 'volver a correr la 127 NO pisa la fórmula inicial que el usuario editó');
select pg_temp.finales('127-127');
\i sql/125_agrometricas_registros_temporada.sql
\i sql/127_agrometricas_indice_crecimiento.sql
\i sql/125_agrometricas_registros_temporada.sql
select pg_temp.finales('125-127-125');
\i sql/109_agrometricas_parametros_riego.sql
\i sql/127_agrometricas_indice_crecimiento.sql
select pg_temp.finales('109-127');
\i sql/122_agrometricas_bajar_a_agl.sql
\i sql/127_agrometricas_indice_crecimiento.sql
select pg_temp.finales('122-127');
-- tras re-correr, el registro sigue funcionando
select pg_temp.como((select due from k));
select pg_temp.ok((select (pg_temp.mr('{"turno":"T127-T1"}') ->> 'total')::int >= 1), 'tras re-correr las migraciones, la lista sigue funcionando');

rollback;
