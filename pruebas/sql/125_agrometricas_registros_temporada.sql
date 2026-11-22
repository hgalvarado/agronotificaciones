-- =====================================================================
-- PRUEBAS de sql/125 · AgroMétricas: registros de la temporada (histórico de AppSheet en Supabase, ver/editar/eliminar)
-- (ESCRITAS, SIN CORRER). Base: réplica con 91-123 (con 102 para «archivado») + 125. Desde la raíz del repo:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/125_agrometricas_registros_temporada.sql
-- Todo corre dentro de una transacción y termina con ROLLBACK. Al final repite migraciones en otros órdenes:
--   125>125, 122>125 (122 sola revierte lo de la 125: se verifica que no se pierde nada y la 125 lo restaura),
--   109>110>122>123>125, 125>109>125.
-- NOTA: pruebas/sql/122_agrometricas_bajar.sql describe el comportamiento ANTERIOR a la 125 (purga de parámetros de un turno
-- activo a los 7 días; huella calculada sin ignorar claves nuevas): no se corre sobre una base con la 125.
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
/** Mensaje de confirmación a partir de lo que devolvió fn_agm_exportar. */
create or replace function pg_temp.mk(p_exp jsonb) returns jsonb language sql as $$
    with f as (select e ->> 'tabla' as tabla, e ->> 'id' as id, e ->> 'huella' as huella, e ->> 'cursor' as cursor
                 from jsonb_array_elements(p_exp -> 'filas') e)
    select jsonb_build_object(
        'lote', coalesce((select jsonb_agg(jsonb_build_object('tabla', tabla, 'id', id, 'huella', huella) order by cursor collate "C") from f), '[]'::jsonb),
        'cuantos', (select count(*) from f),
        'sha256_lote', encode(sha256(convert_to(coalesce((select string_agg(huella, '|' order by cursor collate "C") from f), ''), 'UTF8')), 'hex'))
$$;
/** Solo lo de esta prueba (turnos cuyo agl_id empieza por T125-). */
create or replace function pg_temp.exp() returns jsonb language sql as $$
    select jsonb_set(x, '{filas}', coalesce((select jsonb_agg(e) from jsonb_array_elements(x -> 'filas') e where e ->> 'turno_agl_id' like 'T125-%'), '[]'::jsonb))
      from (select fn_agm_exportar('{"limite":1000}') as x) q
$$;
create or replace function pg_temp.mr(p jsonb) returns jsonb language sql as $$ select fn_agm_mis_registros(p) $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- roles y personas
do $$
declare ra smallint; re smallint; rd smallint; ro smallint; rl smallint; rx smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T125_ADM', 'P125 administrador', true) on conflict (codigo) do update set acceso_total = true;
    insert into roles (codigo, nombre) values ('T125_ENC', 'P125 encargado'), ('T125_DUE', 'P125 dueño'), ('T125_OTRO', 'P125 otro'),
        ('T125_AGL', 'P125 AGL'), ('T125_ELIM', 'P125 elimina') on conflict (codigo) do nothing;
    select id into ra from roles where codigo = 'T125_ADM';
    select id into re from roles where codigo = 'T125_ENC';
    select id into rd from roles where codigo = 'T125_DUE';
    select id into ro from roles where codigo = 'T125_OTRO';
    select id into rl from roles where codigo = 'T125_AGL';
    select id into rx from roles where codigo = 'T125_ELIM';
    insert into permisos (rol_id, recurso, accion, permitido, alcance) values
        (re, 'agrometricas', 'ver', true, 'zonal'), (re, 'agrometricas', 'registrar_parametros', true, 'zonal'), (re, 'agrometricas', 'corregir_parametros', true, 'zonal'),
        (rd, 'agrometricas', 'ver', true, 'zonal'), (rd, 'agrometricas', 'registrar_parametros', true, 'zonal'),
        (ro, 'agrometricas', 'ver', true, 'zonal'), (ro, 'agrometricas', 'registrar_parametros', true, 'zonal'),
        (rl, 'fertirriego_agl', 'ver', true, 'global'), (rl, 'fertirriego_agl', 'publicar', true, 'global'),
        (rx, 'agrometricas', 'ver', true, 'global'), (rx, 'agrometricas', 'eliminar_definitivo', true, 'global')
    on conflict (rol_id, recurso, accion) do update set permitido = true, alcance = excluded.alcance;
    insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-000000012501', 'adm@t125.test'), ('00000000-0000-0000-0000-000000012502', 'enc@t125.test'),
        ('00000000-0000-0000-0000-000000012503', 'glopez@t125.test'), ('00000000-0000-0000-0000-000000012504', 'rwlopez@t125.test'),
        ('00000000-0000-0000-0000-000000012505', 'gbetancourth@t125.test'), ('00000000-0000-0000-0000-000000012506', 'otro@t125.test'),
        ('00000000-0000-0000-0000-000000012507', 'agl@t125.test'), ('00000000-0000-0000-0000-000000012508', 'elim@t125.test')
    on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000012501', 'Admin 125', ra, true), ('00000000-0000-0000-0000-000000012502', 'Encargado 125', re, false),
        ('00000000-0000-0000-0000-000000012503', 'Glopez T125', rd, false), ('00000000-0000-0000-0000-000000012504', 'Rwlopez T125', rd, false),
        ('00000000-0000-0000-0000-000000012505', 'Gbetancourth T125', rd, false), ('00000000-0000-0000-0000-000000012506', 'Otro 125', ro, false),
        ('00000000-0000-0000-0000-000000012507', 'AGL 125', rl, true), ('00000000-0000-0000-0000-000000012508', 'Elimina 125', rx, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000012501', ra), ('00000000-0000-0000-0000-000000012502', re), ('00000000-0000-0000-0000-000000012503', rd),
        ('00000000-0000-0000-0000-000000012504', rd), ('00000000-0000-0000-0000-000000012505', rd), ('00000000-0000-0000-0000-000000012506', ro),
        ('00000000-0000-0000-0000-000000012507', rl), ('00000000-0000-0000-0000-000000012508', rx) on conflict do nothing;
end $$;

-- zonas, turnos y turnos de ciclo de la prueba (activos, temporada propia)
insert into zonas (nombre) values ('T125-A'), ('T125-B') on conflict (nombre) do nothing;
insert into turnos (codigo, nombre, zona_id) select 'T125-T1', 'T125 uno', id from zonas where nombre = 'T125-A' on conflict (codigo) do nothing;
insert into turnos (codigo, nombre, zona_id) select 'T125-T2', 'T125 dos', id from zonas where nombre = 'T125-B' on conflict (codigo) do nothing;
insert into turnos_ciclo (agl_id, turno_id, temporada, ciclo, fecha_siembra, zona_id, activo)
select 'T125-TR-A', (select id from turnos where codigo = 'T125-T1'), 'T125-2026-2027', 'Ciclo 1', '2026-08-01', (select id from zonas where nombre = 'T125-A'), true
on conflict (agl_id) do update set activo = true;
insert into turnos_ciclo (agl_id, turno_id, temporada, ciclo, fecha_siembra, zona_id, activo)
select 'T125-TR-B', (select id from turnos where codigo = 'T125-T2'), 'T125-2026-2027', 'Ciclo 1', '2026-08-01', (select id from zonas where nombre = 'T125-B'), true
on conflict (agl_id) do update set activo = true;
insert into perfiles_zonas (perfil_id, zona_id)
select x.p, z.id from (values ('00000000-0000-0000-0000-000000012502'::uuid, 'T125-A'), ('00000000-0000-0000-0000-000000012503', 'T125-A'),
                              ('00000000-0000-0000-0000-000000012504', 'T125-A'), ('00000000-0000-0000-0000-000000012505', 'T125-B'),
                              ('00000000-0000-0000-0000-000000012506', 'T125-A')) x(p, zn)
join zonas z on z.nombre = x.zn on conflict do nothing;

create temp table k as select
    '00000000-0000-0000-0000-000000012501'::uuid as adm, '00000000-0000-0000-0000-000000012502'::uuid as enc,
    '00000000-0000-0000-0000-000000012503'::uuid as glopez, '00000000-0000-0000-0000-000000012504'::uuid as rwlopez,
    '00000000-0000-0000-0000-000000012505'::uuid as gbet, '00000000-0000-0000-0000-000000012506'::uuid as otro,
    '00000000-0000-0000-0000-000000012507'::uuid as agl, '00000000-0000-0000-0000-000000012508'::uuid as elim,
    (select id from turnos_ciclo where agl_id = 'T125-TR-A') as tca, (select id from turnos_ciclo where agl_id = 'T125-TR-B') as tcb,
    (select id from zonas where nombre = 'T125-A') as za, (select id from zonas where nombre = 'T125-B') as zb,
    public._agm_uuid_appsheet('T125-A1') as a1, public._agm_uuid_appsheet('T125-A2') as a2, public._agm_uuid_appsheet('T125-B1') as b1;
create temp table sv (clave text primary key, v text);
grant all on all tables in schema pg_temp to public;
select pg_temp.ok((select tca is not null and tcb is not null and za is not null and zb is not null from k), 'datos de la prueba creados');

-- ---------------------------------------------------------------- esquema y permiso
select pg_temp.ok((select count(*) = 7 from information_schema.columns where table_name = 'agm_parametros'
                   and column_name in ('origen', 'id_appsheet', 'editado_en', 'editado_por', 'eliminado_en', 'eliminado_por', 'eliminado_motivo')), 'columnas nuevas en agm_parametros');
select pg_temp.ok(not exists (select 1 from pg_constraint where conname = 'agm_parametros_turno_dia')
                  and exists (select 1 from pg_indexes where indexname = 'agm_parametros_turno_dia_viva' and indexdef ilike '%eliminado_en IS NULL%')
                  and exists (select 1 from pg_indexes where indexname = 'agm_parametros_id_appsheet_uq' and indexdef ilike '%id_appsheet IS NOT NULL%'),
                  'unicidad (turno, fecha) parcial (solo no eliminados) e índice único parcial por id_appsheet');
select pg_temp.ok((select nivel = 4 from acciones where codigo = 'eliminar_definitivo'), 'acción eliminar_definitivo con nivel 4 (los niveles rápidos no la encienden)');
select pg_temp.ok((select 'eliminar_definitivo' = any (acciones) from pantallas where codigo = 'agrometricas'), 'la pantalla agrometricas tiene la acción eliminar_definitivo');
select pg_temp.ok(not exists (select 1 from permisos where recurso = 'agrometricas' and accion = 'eliminar_definitivo' and permitido
                              and rol_id not in (select id from roles where codigo in ('T125_ELIM'))), 'ningún otro rol tiene el permiso nuevo (solo el administrador por fn_es_admin)');
insert into sv select 'perm', md5(coalesce(string_agg(p::text, '|' order by p::text), '')) from permisos p where recurso = 'agrometricas';

-- ---------------------------------------------------------------- cargar el histórico
select pg_temp.como((select glopez from k));
select pg_temp.falla($q$ select fn_agm_cargar_appsheet('{"registros":[],"mapa_usuarios":{}}') $q$, 'cargar sin permiso AGL: 42501', 'permiso', '42501');
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_agm_cargar_appsheet('{"registros":[]}') $q$, 'cargar sin sesión: 42501', 'sesión', '42501');
select pg_temp.como((select agl from k));
select pg_temp.falla($q$ select fn_agm_cargar_appsheet('{"mapa_usuarios":{}}') $q$, 'cargar sin lista de registros: 22023', 'registros', '22023');
create temp table carga as select jsonb_build_object(
    'mapa_usuarios', jsonb_build_object('GLOPEZ', 'glopez@t125.test', 'Rwlopez', 'RWLOPEZ@t125.test', 'gbetancourth', 'gbetancourth@t125.test'),
    'registros', jsonb_build_array(
        jsonb_build_object('id_appsheet', 'T125-A1', 'fecha', '2026-10-01', 'turno_ciclo_id', 'T125-TR-A', 'usuario_appsheet', 'Glopez', 'ph_agua', 6.5, 'ce_agua', '1,2', 'tensiometro_12_am', 15, 'comentario', 'histórico A1'),
        jsonb_build_object('id_appsheet', 'T125-A2', 'fecha', '2026-10-02', 'turno_ciclo_id', 'T125-TR-A', 'usuario_appsheet', 'Rwlopez', 'ph_agua', 6.1),
        jsonb_build_object('id_appsheet', 'T125-B1', 'fecha', '2026-10-01', 'turno_ciclo_id', 'T125-TR-B', 'usuario_appsheet', 'gbetancourth', 'ph_agua', 6.0, 'ce_agua', 9),
        jsonb_build_object('id_appsheet', 'T125-X1', 'fecha', '2026-10-03', 'turno_ciclo_id', 'T125-TR-A', 'usuario_appsheet', 'Nadie'),
        jsonb_build_object('id_appsheet', 'T125-X2', 'fecha', '2026-10-03', 'turno_ciclo_id', 'NO-EXISTE', 'usuario_appsheet', 'Glopez'),
        jsonb_build_object('id_appsheet', 'T125-X3', 'fecha', '2026-10-01', 'turno_ciclo_id', 'T125-TR-A', 'usuario_appsheet', 'Glopez', 'ph_agua', 5),
        jsonb_build_object('id_appsheet', 'T125-X4', 'fecha', '2026-10-04', 'turno_ciclo_id', 'T125-TR-A', 'usuario_appsheet', 'Glopez', 'ph_agua', '99999999'),
        jsonb_build_object('id_appsheet', 'T125-X5', 'turno_ciclo_id', 'T125-TR-A', 'usuario_appsheet', 'Glopez'))) as p;
create temp table c1 as select fn_agm_cargar_appsheet((select p from carga)) as j;
select pg_temp.ok((select (j->>'insertadas')::int = 3 and (j->>'ya_existian')::int = 0 from c1), 'cargar: 3 insertadas, 0 ya existían');
select pg_temp.ok((select jsonb_array_length(j->'sin_usuario') = 1 and j->'sin_usuario'->0->>'id_appsheet' = 'T125-X1' from c1), 'cargar: sin_usuario informa al usuario del histórico sin correo');
select pg_temp.ok((select jsonb_array_length(j->'sin_turno') = 1 and j->'sin_turno'->0->>'id_appsheet' = 'T125-X2' from c1), 'cargar: sin_turno informa el turno que no existe en la base');
select pg_temp.ok((select jsonb_array_length(j->'en_conflicto') = 1 and j->'en_conflicto'->0->>'id_appsheet' = 'T125-X3'
                          and (j->'en_conflicto'->0->>'existente')::uuid = (select a1 from k) from c1), 'cargar: otro id para el mismo turno y día queda en conflicto (no duplica)');
select pg_temp.ok((select jsonb_array_length(j->'invalidas') = 2 from c1), 'cargar: valor enorme y registro sin fecha = invalidas (el resto se carga igual)');
select pg_temp.ok((select creado_por = (select glopez from k) and origen = 'APPSHEET' and id_appsheet = 'T125-A1' and ddt = date '2026-10-01' - date '2026-08-01'
                          and ph_agua = 6.5 and ce_agua = 1.2 and tensiometro_12_am = 15 and comentario = 'histórico A1'
                   from agm_parametros where id = (select a1 from k)), 'A1: autor por correo (sin mayúsculas), origen, DDT calculado y valores (coma decimal)');
select pg_temp.ok((select creado_por = (select rwlopez from k) from agm_parametros where id = (select a2 from k))
                  and (select creado_por = (select gbet from k) from agm_parametros where id = (select b1 from k)), 'A2 y B1: autores por correo');
select pg_temp.ok((select bajado_a_agl_en is not null and huella = public._agm_huella(to_jsonb(a)) from agm_parametros a where id = (select a1 from k)), 'nacen ya «bajados» (AGL los tiene) con su huella');
select pg_temp.ok((select jsonb_array_length(pg_temp.exp() -> 'filas') = 0), 'exportar: lo cargado de AGL no vuelve a bajar');
select pg_temp.ok((select count(*) = 3 from agm_parametros where id_appsheet like 'T125-%'), 'solo 3 filas cargadas');
-- idempotencia y no pisar ediciones
create temp table c2 as select fn_agm_cargar_appsheet((select p from carga)) as j;
select pg_temp.ok((select (j->>'insertadas')::int = 0 and (j->>'ya_existian')::int = 3 and jsonb_array_length(j->'en_conflicto') = 1 from c2), 'repetir la carga: 0 insertadas, 3 ya existían (idempotente)');
select pg_temp.ok((select count(*) = 3 from agm_parametros where id_appsheet like 'T125-%'), 'repetir no duplica');

-- ---------------------------------------------------------------- visibilidad (mis registros)
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_agm_mis_registros('{}') $q$, 'mis registros sin sesión: 42501', 'sesión', '42501');
select pg_temp.como((select glopez from k));
select pg_temp.ok((select (j->>'total')::int = 1 and j->'registros'->0->>'id_appsheet' = 'T125-A1' from (select pg_temp.mr('{"temporada":"T125-2026-2027"}') j) q), 'el dueño (Glopez) ve solo los suyos');
select pg_temp.como((select rwlopez from k));
select pg_temp.ok((select (j->>'total')::int = 1 and j->'registros'->0->>'id_appsheet' = 'T125-A2' from (select pg_temp.mr('{"temporada":"T125-2026-2027"}') j) q), 'el dueño (Rwlopez) ve solo los suyos');
select pg_temp.como((select gbet from k));
select pg_temp.ok((select (j->>'total')::int = 1 and j->'registros'->0->>'id_appsheet' = 'T125-B1' from (select pg_temp.mr('{"temporada":"T125-2026-2027"}') j) q), 'el dueño (Gbetancourth) ve solo los suyos');
select pg_temp.como((select otro from k));
select pg_temp.ok((select (j->>'total')::int = 0 from (select pg_temp.mr('{"temporada":"T125-2026-2027"}') j) q), 'otra persona de la misma zona (sin «Corregir parámetros») NO ve los de otros');
select pg_temp.como((select enc from k));
select pg_temp.ok((select (j->>'total')::int = 2 and not exists (select 1 from jsonb_array_elements(j->'registros') e where e->>'id_appsheet' = 'T125-B1') from (select pg_temp.mr('{"temporada":"T125-2026-2027"}') j) q), 'el encargado de la zona A ve A1 y A2, no B1');
select pg_temp.como((select adm from k));
create temp table adm1 as select pg_temp.mr('{"temporada":"T125-2026-2027","limite":1000}') as j;
select pg_temp.ok((select (j->>'total')::int = 3 from adm1), 'el administrador ve todos');
select pg_temp.ok((select bool_and(not (e ? 'huella') and not (e ? 'bajado_a_agl_en') and not (e ? 'eliminado_motivo') and e ?& array['ph_agua','ce_agua','tensiometro_12_am','tensiometro_24_pm','fecha','ddt','turno','zona','creado_por_nombre','creado_por_email','puede_editar','puede_eliminar'])
                   from adm1, jsonb_array_elements(j->'registros') e), 'cada fila trae los valores para graficar, autor y banderas; sin huella ni datos internos');
select pg_temp.ok((select bool_and((e->>'puede_editar')::boolean and (e->>'puede_eliminar')::boolean) from adm1, jsonb_array_elements(j->'registros') e), 'administrador: puede editar y eliminar');
select pg_temp.ok((select e->>'creado_por_email' = 'glopez@t125.test' from adm1, jsonb_array_elements(j->'registros') e where e->>'id_appsheet' = 'T125-A1'), 'trae el correo del autor');
select pg_temp.como((select glopez from k));
select pg_temp.ok((select (e->>'puede_editar')::boolean and not (e->>'puede_eliminar')::boolean from (select pg_temp.mr('{"temporada":"T125-2026-2027"}')->'registros'->0 e) q), 'dueño: puede editar, no eliminar');
select pg_temp.como((select elim from k));
select pg_temp.ok((select (j->>'total')::int = 0 from (select pg_temp.mr('{"temporada":"T125-2026-2027"}') j) q), 'quien solo tiene «Eliminar por completo» (sin ser dueño ni encargado) no ve registros ajenos');
-- filtros (administrador)
select pg_temp.como((select adm from k));
select pg_temp.ok((pg_temp.mr('{"temporada":"T125-2026-2027","turno":"t125-t1"}')->>'total')::int = 2, 'filtro por turno');
select pg_temp.ok((pg_temp.mr(jsonb_build_object('temporada', 'T125-2026-2027', 'zona_id', (select zb from k)))->>'total')::int = 1, 'filtro por zona');
select pg_temp.ok((pg_temp.mr('{"temporada":"T125-2026-2027","desde":"2026-10-02","hasta":"2026-10-02"}')->>'total')::int = 1, 'filtro por fechas');
select pg_temp.ok((pg_temp.mr('{"temporada":"T125-2026-2027","texto":"rwlopez"}')->>'total')::int = 1, 'filtro de texto (nombre del autor)');
select pg_temp.ok((pg_temp.mr('{"temporada":"T125-2026-2027","texto":"histórico a1"}')->>'total')::int = 1, 'filtro de texto (comentario)');
select pg_temp.ok((pg_temp.mr('{"temporada":"otra"}')->>'total')::int = 0, 'filtro de temporada sin resultados');
select pg_temp.ok((select (j->>'total')::int = 3 and jsonb_array_length(j->'registros') = 1 and (j->>'pagina')::int = 1 from (select pg_temp.mr('{"temporada":"T125-2026-2027","limite":1,"pagina":1}') j) q), 'paginación: total 3, 1 por página');
select pg_temp.ok((select j->'registros'->0->>'fecha' = '2026-10-01' and j->'registros'->>0 is not null from (select pg_temp.mr('{"temporada":"T125-2026-2027","orden":"asc","limite":1}') j) q), 'orden ascendente por fecha');
select pg_temp.ok((select j->'registros'->0->>'fecha' = '2026-10-02' from (select pg_temp.mr('{"temporada":"T125-2026-2027","limite":1}') j) q), 'orden descendente por defecto');

-- ---------------------------------------------------------------- editar
select pg_temp.como((select glopez from k));
create temp table ed1 as select fn_agm_editar_parametro(jsonb_build_object('id', (select a1 from k), 'ph_agua', '7,1', 'comentario', 'corregido por el dueño')) as j;
select pg_temp.ok((select (j->>'cambio')::boolean and (j->'registro'->>'ph_agua')::numeric = 7.1 and j->'registro'->>'editado_por' = (select glopez::text from k)
                          and j->'registro'->>'editado_en' is not null and not (j->'registro' ? 'huella') from ed1), 'el dueño edita lo suyo: marca editado_en/por');
select pg_temp.ok((select ce_agua = 1.2 and tensiometro_12_am = 15 from agm_parametros where id = (select a1 from k)), 'lo que no vino en p no cambia');
select pg_temp.ok((fn_agm_editar_parametro(jsonb_build_object('id', (select a1 from k), 'ph_agua', 7.1))->>'cambio')::boolean = false, 'editar con los mismos valores: cambio = false');
select pg_temp.ok((fn_agm_editar_parametro(jsonb_build_object('id', (select a1 from k), 'ce_agua', ''))->'registro'->>'ce_agua') is null, 'un valor vacío limpia el campo');
select pg_temp.falla(format($q$ select fn_agm_editar_parametro(jsonb_build_object('id', %L, 'ph_agua', 'abc')) $q$, (select a1 from k)), 'valor que no es número: 22023', 'no es un número', '22023');
select pg_temp.falla(format($q$ select fn_agm_editar_parametro(jsonb_build_object('id', %L, 'ph_agua', 99999999)) $q$, (select a1 from k)), 'valor enorme: 22003', 'demasiado grande', '22003');
select pg_temp.falla(format($q$ select fn_agm_editar_parametro(jsonb_build_object('id', %L, 'latitud', 95, 'longitud', 10)) $q$, (select a1 from k)), 'ubicación inválida: 22023', 'ubicación', '22023');
select pg_temp.falla(format($q$ select fn_agm_editar_parametro(jsonb_build_object('id', %L, 'ph_agua', 6)) $q$, (select a2 from k)), 'el dueño NO edita lo de otro (A2 es de Rwlopez): 42501', 'permiso', '42501');
select pg_temp.como((select otro from k));
select pg_temp.falla(format($q$ select fn_agm_editar_parametro(jsonb_build_object('id', %L, 'ph_agua', 6)) $q$, (select a1 from k)), 'otra persona de la zona sin «Corregir» no edita: 42501', 'permiso', '42501');
select pg_temp.como((select gbet from k));
select pg_temp.falla(format($q$ select fn_agm_editar_parametro(jsonb_build_object('id', %L, 'ph_agua', 6)) $q$, (select a1 from k)), 'dueño de otra zona no edita: 42501', 'permiso', '42501');
select pg_temp.como((select enc from k));
select pg_temp.ok((fn_agm_editar_parametro(jsonb_build_object('id', (select a2 from k), 'ph_agua', 6.6))->>'cambio')::boolean, 'el encargado de la zona edita lo de otro');
select pg_temp.falla(format($q$ select fn_agm_editar_parametro(jsonb_build_object('id', %L, 'ph_agua', 6)) $q$, (select b1 from k)), 'el encargado de la zona A no edita la zona B: 42501', 'permiso', '42501');
select pg_temp.como((select adm from k));
select pg_temp.ok((fn_agm_editar_parametro(jsonb_build_object('id', (select b1 from k), 'ph_agua', 6.2))->>'cambio')::boolean, 'el administrador edita cualquiera');
select pg_temp.ok((select fuera_rango is not null from agm_parametros where id = (select b1 from k)), 'fuera_rango recalculado al editar');
select pg_temp.falla($q$ select fn_agm_editar_parametro('{"id":"00000000-0000-0000-0000-00000000dead"}') $q$, 'editar un id que no existe: 22023', 'no existe', '22023');
-- lo editado vuelve a «por bajar»; lo no editado no
select pg_temp.como((select agl from k));
create temp table ex1 as select pg_temp.exp() as j;
select pg_temp.ok((select (select count(*) from jsonb_array_elements(j->'filas')) = 3 from ex1), 'exportar: A1, A2 y B1 (editados) vuelven a «por bajar»');
select pg_temp.ok((select bool_and(encode(sha256(convert_to(e->>'texto', 'UTF8')), 'hex') = e->>'huella' and (e->>'texto')::jsonb = e->'fila' and e->>'eliminado' = 'false') from ex1, jsonb_array_elements(j->'filas') e), 'exportar: sha256(texto) = huella y eliminado = false');
select pg_temp.ok((select e->'fila'->>'editado_en' is not null and e->>'creado_por_email' = 'glopez@t125.test' from ex1, jsonb_array_elements(j->'filas') e where e->>'id' = (select a1::text from k)), 'exportar trae editado_en en la fila y el correo del autor');
select pg_temp.ok((jsonb_array_length(fn_agm_confirmar_bajada(pg_temp.mk((select j from ex1)))->'confirmadas') = 3), 'AGL confirma los 3');
select pg_temp.ok((select jsonb_array_length(j->'filas') = 0 from (select pg_temp.exp() j) q), 'ya no queda nada por bajar');
-- guardar de la 109 no pisa a otros; un id nuevo para el mismo día COMPLETA la fila viva
select pg_temp.como((select enc from k));
select pg_temp.ok((fn_agm_guardar_parametros(jsonb_build_object('id', gen_random_uuid(), 'turno_ciclo_id', (select tca from k), 'fecha', '2026-10-02', 'ce_gotero', 1.7))->>'id')::uuid = (select a2 from k), 'guardar el mismo turno y día completa la fila viva (no duplica)');

-- ---------------------------------------------------------------- eliminar
select pg_temp.como((select glopez from k));
select pg_temp.falla(format($q$ select fn_agm_eliminar_parametro(jsonb_build_object('id', %L, 'motivo', 'este motivo es suficientemente largo')) $q$, (select a1 from k)), 'el dueño no elimina: 42501', 'Eliminar por completo', '42501');
select pg_temp.como((select enc from k));
select pg_temp.falla(format($q$ select fn_agm_eliminar_parametro(jsonb_build_object('id', %L, 'motivo', 'este motivo es suficientemente largo')) $q$, (select a1 from k)), 'el encargado no elimina: 42501', 'Eliminar por completo', '42501');
select pg_temp.como((select adm from k));
select pg_temp.falla(format($q$ select fn_agm_eliminar_parametro(jsonb_build_object('id', %L, 'motivo', 'corto')) $q$, (select a1 from k)), 'motivo corto: 22023', 'mínimo 15', '22023');
select pg_temp.falla(format($q$ select fn_agm_eliminar_parametro(jsonb_build_object('id', %L, 'motivo', '              ')) $q$, (select a1 from k)), 'motivo en blanco: 22023', 'mínimo 15', '22023');
select pg_temp.ok((select count(*) = 3 from agm_parametros where id_appsheet like 'T125-%' and eliminado_en is null), 'sin eliminar todavía');
create temp table el1 as select fn_agm_eliminar_parametro(jsonb_build_object('id', (select a1 from k), 'motivo', 'registro duplicado por error de captura')) as j;
select pg_temp.ok((select eliminado_en is not null and eliminado_por = (select adm from k) and eliminado_motivo = 'registro duplicado por error de captura'
                   from agm_parametros where id = (select a1 from k)), 'el administrador elimina: tumba con quién, cuándo y motivo');
select pg_temp.ok((select count(*) = 1 from agm_parametros where id = (select a1 from k)), 'eliminación LÓGICA: la fila sigue (es la tumba)');
select pg_temp.falla(format($q$ select fn_agm_eliminar_parametro(jsonb_build_object('id', %L, 'motivo', 'registro duplicado por error de captura')) $q$, (select a1 from k)), 'eliminar dos veces: 22023', 'ya fue eliminado', '22023');
select pg_temp.falla(format($q$ select fn_agm_editar_parametro(jsonb_build_object('id', %L, 'ph_agua', 6)) $q$, (select a1 from k)), 'editar un eliminado: 22023', 'eliminado', '22023');
select pg_temp.ok((pg_temp.mr('{"temporada":"T125-2026-2027"}')->>'total')::int = 2, 'mis registros ya no lista al eliminado');
select pg_temp.como((select glopez from k));
select pg_temp.ok((pg_temp.mr('{"temporada":"T125-2026-2027"}')->>'total')::int = 0, 'el dueño ya no ve el suyo eliminado');
-- un rol al que el usuario le concedió el permiso (no administrador) también elimina; sin ser dueño tampoco lo veía en la lista
select pg_temp.como((select elim from k));
select pg_temp.ok((fn_agm_eliminar_parametro(jsonb_build_object('id', (select a2 from k), 'motivo', 'se registró en el turno equivocado'))->>'id')::uuid = (select a2 from k), 'quien tenga el permiso concedido en la matriz elimina (sin ser administrador)');
-- re-registrar el mismo turno y día tras la tumba
select pg_temp.como((select enc from k));
select pg_temp.falla(format($q$ select fn_agm_guardar_parametros(jsonb_build_object('id', %L, 'turno_ciclo_id', %L, 'fecha', '2026-10-01', 'ph_agua', 6)) $q$, (select a1 from k), (select tca from k)),
    'reenviar el id de un eliminado: se rechaza, no se resucita', 'eliminado', '22023');
select pg_temp.ok((select (fn_agm_guardar_parametros(jsonb_build_object('id', gen_random_uuid(), 'turno_ciclo_id', (select tca from k), 'fecha', '2026-10-01', 'ph_agua', 6.4))->>'id')::uuid <> (select a1 from k)), 'se puede registrar de nuevo ese turno y día (unicidad solo entre vivos)');
select pg_temp.ok((select count(*) = 2 from agm_parametros where turno_ciclo_id = (select tca from k) and fecha = '2026-10-01'), 'la tumba y el registro nuevo conviven');
select pg_temp.falla(format($q$ insert into agm_parametros (id, turno_ciclo_id, fecha) values (gen_random_uuid(), %L, '2026-10-01') $q$, (select tca from k)), 'dos registros vivos del mismo turno y día: 23505', null, '23505');

-- ---------------------------------------------------------------- tumbas hacia AGL: exportar, confirmar, purgar
select pg_temp.como((select agl from k));
create temp table ex2 as select pg_temp.exp() as j;
select pg_temp.ok((select (select count(*) from jsonb_array_elements(j->'filas') e where (e->>'eliminado')::boolean) = 2 from ex2), 'exportar trae las 2 tumbas (A1 y A2)');
select pg_temp.ok((select e->'fila'->>'eliminado_motivo' = 'registro duplicado por error de captura' from ex2, jsonb_array_elements(j->'filas') e where e->>'id' = (select a1::text from k)), 'la tumba trae el motivo (AGL lo guarda en su copia)');
select pg_temp.ok((select bool_and(encode(sha256(convert_to(e->>'texto', 'UTF8')), 'hex') = e->>'huella') from ex2, jsonb_array_elements(j->'filas') e), 'sha256(texto) = huella también en las tumbas');
select pg_temp.ok((jsonb_array_length(fn_agm_confirmar_bajada(pg_temp.mk((select j from ex2)))->'confirmadas') = (select jsonb_array_length(j->'filas') from ex2)), 'AGL confirma las tumbas (y el registro nuevo)');
select pg_temp.ok((select jsonb_array_length(j->'filas') = 0 from (select pg_temp.exp() j) q), 'confirmadas: ya no se exportan');
select pg_temp.ok(((select count(*) from agm_parametros where id in ((select a1 from k), (select a2 from k))) = 2), 'confirmar NO borra');
-- retención: nada se purga antes de los 7 días; tumbas sí después; vivos de turno ACTIVO nunca
select fn_agm_purgar_bajadas('{}');
select pg_temp.ok((select count(*) = 3 from agm_parametros where id in ((select a1 from k), (select a2 from k), (select b1 from k))), 'antes de la retención no se purga nada de lo nuestro');
update agm_parametros set bajado_a_agl_en = now() - interval '10 days' where id_appsheet like 'T125-%' or turno_ciclo_id in ((select tca from k), (select tcb from k));
select fn_agm_purgar_bajadas('{}');
select pg_temp.ok(not exists (select 1 from agm_parametros where id in ((select a1 from k), (select a2 from k))), 'tumbas confirmadas y pasada la retención: se purgan (fila y tumba)');
select pg_temp.ok(exists (select 1 from agm_parametros where id = (select b1 from k)), 'B1 (viva, confirmada hace 10 días) SE QUEDA: su turno sigue activo');
select pg_temp.ok(exists (select 1 from agm_parametros where turno_ciclo_id = (select tca from k) and fecha = '2026-10-01' and eliminado_en is null), 'el registro nuevo de un turno activo también se queda');
-- turno ya no activo (Terminar ciclo): se purga lo confirmado
update turnos_ciclo set activo = false where id = (select tcb from k);
select fn_agm_purgar_bajadas('{}');
select pg_temp.ok(not exists (select 1 from agm_parametros where id = (select b1 from k)), 'turno archivado/inactivo y AGL ya confirmó con huella: se purga');
-- lo cambiado después de confirmar NO se purga aunque el turno esté inactivo
update turnos_ciclo set activo = true where id = (select tcb from k);
insert into agm_parametros (id, turno_ciclo_id, fecha, ph_agua, creado_por) values ((select b1 from k), (select tcb from k), '2026-10-05', 6.0, (select gbet from k));
select pg_temp.ok((jsonb_array_length(fn_agm_confirmar_bajada(pg_temp.mk((select j from (select pg_temp.exp() j) q)))->'confirmadas') >= 1), 'confirmar la fila nueva de B');
update agm_parametros set bajado_a_agl_en = now() - interval '10 days' where id = (select b1 from k);
update turnos_ciclo set activo = false where id = (select tcb from k);
update agm_parametros set ph_agua = 6.3 where id = (select b1 from k);   -- cambió después de confirmar
select fn_agm_purgar_bajadas('{}');
select pg_temp.ok(exists (select 1 from agm_parametros where id = (select b1 from k)), 'cambiado después de confirmar: no se purga hasta reconfirmar');
update turnos_ciclo set activo = true where id in ((select tca from k), (select tcb from k));

-- ---------------------------------------------------------------- la huella de lo ya bajado ANTES de la 125 no cambia
select pg_temp.como((select agl from k));
insert into agm_parametros (id, turno_ciclo_id, fecha, ph_agua, creado_por) values ('12500000-0000-4000-8000-0000000000f1', (select tca from k), '2026-10-10', 6.8, (select glopez from k));
update agm_parametros a set bajado_a_agl_en = now(),
    huella = encode(sha256(convert_to((((((((to_jsonb(a) - 'bajado_a_agl_en') - 'huella') - 'id_appsheet') - 'editado_en') - 'editado_por') - 'eliminado_en') - 'eliminado_por' - 'eliminado_motivo')::text, 'UTF8')), 'hex')
 where id = '12500000-0000-4000-8000-0000000000f1';
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(pg_temp.exp()->'filas') e where e->>'id' = '12500000-0000-4000-8000-0000000000f1'),
    'una fila confirmada con la huella de antes de la 125 NO vuelve a «por bajar» (las claves nuevas en null se ignoran)');

-- ---------------------------------------------------------------- órdenes de corrida
create or replace function pg_temp.finales(p_etq text, p_dia integer) returns void language plpgsql as $$
declare j jsonb; v_ia text := 'T125-F-' || p_etq; v_id uuid; v_exp jsonb;
begin
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012507', false);
    if (select nivel from acciones where codigo = 'eliminar_definitivo') is distinct from 4
       or not exists (select 1 from pantallas where codigo = 'agrometricas' and 'eliminar_definitivo' = any (acciones)) then
        raise exception 'FALLA [%]: el permiso nuevo no está en la matriz', p_etq; end if;
    if exists (select 1 from pg_constraint where conname = 'agm_parametros_turno_dia')
       or not exists (select 1 from pg_indexes where indexname = 'agm_parametros_turno_dia_viva') then
        raise exception 'FALLA [%]: unicidad parcial', p_etq; end if;
    if (select md5(coalesce(string_agg(p::text, '|' order by p::text), '')) from permisos p where recurso = 'agrometricas') is distinct from (select v from sv where clave = 'perm') then
        raise exception 'FALLA [%]: la tabla de permisos de agrometricas cambió', p_etq; end if;
    j := fn_agm_cargar_appsheet(jsonb_build_object('mapa_usuarios', jsonb_build_object('glopez', 'glopez@t125.test'),
        'registros', jsonb_build_array(jsonb_build_object('id_appsheet', v_ia, 'fecha', ('2026-09-' || lpad(p_dia::text, 2, '0')), 'turno_ciclo_id', 'T125-TR-A', 'usuario_appsheet', 'glopez', 'ph_agua', 6.6))));
    if (j->>'insertadas')::int <> 1 then raise exception 'FALLA [%]: cargar %', p_etq, j; end if;
    j := fn_agm_cargar_appsheet(jsonb_build_object('mapa_usuarios', jsonb_build_object('glopez', 'glopez@t125.test'),
        'registros', jsonb_build_array(jsonb_build_object('id_appsheet', v_ia, 'fecha', ('2026-09-' || lpad(p_dia::text, 2, '0')), 'turno_ciclo_id', 'T125-TR-A', 'usuario_appsheet', 'glopez', 'ph_agua', 1))));
    if (j->>'insertadas')::int <> 0 or (j->>'ya_existian')::int <> 1 then raise exception 'FALLA [%]: cargar repetido %', p_etq, j; end if;
    v_id := public._agm_uuid_appsheet(v_ia);
    if (select ph_agua from agm_parametros where id = v_id) <> 6.6 then raise exception 'FALLA [%]: la recarga pisó el valor', p_etq; end if;
    -- editar → exportar → confirmar
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012503', false);
    j := fn_agm_editar_parametro(jsonb_build_object('id', v_id, 'ph_agua', 6.7));
    if not (j->>'cambio')::boolean then raise exception 'FALLA [%]: editar', p_etq; end if;
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012507', false);
    v_exp := pg_temp.exp();
    if not exists (select 1 from jsonb_array_elements(v_exp->'filas') e where e->>'id' = v_id::text and e ? 'eliminado' and e ? 'creado_por_email') then
        raise exception 'FALLA [%]: exportar sin las claves de la 125', p_etq; end if;
    perform fn_agm_confirmar_bajada(pg_temp.mk(v_exp));
    -- eliminar (admin) → tumba exportable → purga tras retención
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012501', false);
    perform fn_agm_eliminar_parametro(jsonb_build_object('id', v_id, 'motivo', 'prueba de ' || p_etq || ' con motivo largo'));
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012507', false);
    v_exp := pg_temp.exp();
    if not exists (select 1 from jsonb_array_elements(v_exp->'filas') e where e->>'id' = v_id::text and (e->>'eliminado')::boolean) then
        raise exception 'FALLA [%]: la tumba no se exporta', p_etq; end if;
    perform fn_agm_confirmar_bajada(pg_temp.mk(v_exp));
    update agm_parametros set bajado_a_agl_en = now() - interval '10 days' where id = v_id;
    perform fn_agm_purgar_bajadas('{}');
    if exists (select 1 from agm_parametros where id = v_id) then raise exception 'FALLA [%]: la tumba confirmada no se purgó', p_etq; end if;
    -- un turno activo conserva lo confirmado
    v_id := public._agm_uuid_appsheet(v_ia || '-vivo');
    j := fn_agm_cargar_appsheet(jsonb_build_object('mapa_usuarios', jsonb_build_object('glopez', 'glopez@t125.test'),
        'registros', jsonb_build_array(jsonb_build_object('id_appsheet', v_ia || '-vivo', 'fecha', ('2026-08-' || lpad(p_dia::text, 2, '0')), 'turno_ciclo_id', 'T125-TR-A', 'usuario_appsheet', 'glopez', 'ph_agua', 6.6))));
    update agm_parametros set bajado_a_agl_en = now() - interval '10 days' where id = v_id;
    perform fn_agm_purgar_bajadas('{}');
    if not exists (select 1 from agm_parametros where id = v_id) then raise exception 'FALLA [%]: se purgó un parámetro de un turno activo', p_etq; end if;
    raise notice 'ok  finales [%]', p_etq;
end $$;
select pg_temp.como((select agl from k));
\i sql/125_agrometricas_registros_temporada.sql
\i sql/125_agrometricas_registros_temporada.sql
select pg_temp.finales('125-125', 1);
-- 122 sola revierte huella/exportar/purga a la versión de la 122: no debe perderse ningún dato
create temp table antes122 as select count(*) as n, md5(string_agg(id::text || coalesce(id_appsheet, ''), '|' order by id)) as m from agm_parametros;
\i sql/122_agrometricas_bajar_a_agl.sql
select pg_temp.ok((select n = (select n from antes122) and m = (select m from antes122) from (select count(*) n, md5(string_agg(id::text || coalesce(id_appsheet, ''), '|' order by id)) m from agm_parametros) q), '122 sola: no se pierde ni cambia ninguna fila');
\i sql/125_agrometricas_registros_temporada.sql
select pg_temp.finales('122-125', 2);
-- 109>110>122>123>125
\i sql/109_agrometricas_parametros_riego.sql
\i sql/110_agrometricas_calicatas_fotos.sql
\i sql/122_agrometricas_bajar_a_agl.sql
\i sql/123_agrometricas_storage_borrar.sql
\i sql/125_agrometricas_registros_temporada.sql
select pg_temp.finales('109-110-122-123-125', 3);
-- 125>109>125 (la 109 restaura el constraint de la tabla solo si no existía la tabla: no lo recrea; sí reinicia las acciones de la pantalla)
\i sql/109_agrometricas_parametros_riego.sql
\i sql/125_agrometricas_registros_temporada.sql
select pg_temp.finales('125-109-125', 4);

select 'FIN 125 OK' as resultado;
rollback;
