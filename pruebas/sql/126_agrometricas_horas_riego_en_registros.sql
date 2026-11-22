-- =====================================================================
-- PRUEBAS de sql/126 · AgroMétricas: horas de riego y % de fertilización en «Registros de la temporada»
-- (ESCRITAS, SIN CORRER). Base: réplica con 91-125 (con 112) + 126. Desde la raíz del repo:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/126_agrometricas_horas_riego_en_registros.sql
-- Todo corre dentro de una transacción y termina con ROLLBACK. Al final repite la migración y las órdenes 126>126, 125>126.
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
create or replace function pg_temp.mr(p jsonb) returns jsonb language sql as $$ select fn_agm_mis_registros(p) $$;
/** Solo lo de esta prueba (turnos cuyo código empieza por T126). */
create or replace function pg_temp.mi(p jsonb default '{}'::jsonb) returns jsonb language sql as $$
    select jsonb_set(x, '{registros}', coalesce((select jsonb_agg(e) from jsonb_array_elements(x -> 'registros') e where e ->> 'turno' like 'T126-%'), '[]'::jsonb))
      from (select fn_agm_mis_registros(p || '{"limite":1000}') as x) q
$$;
create or replace function pg_temp.fila(p_j jsonb, p_turno text, p_fecha text) returns jsonb language sql as $$
    select e from jsonb_array_elements(p_j -> 'registros') e where e ->> 'turno' = p_turno and e ->> 'fecha' = p_fecha
$$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- roles y personas
do $$
declare ra smallint; rv smallint; rn smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T126_ADM', 'P126 administrador', true) on conflict (codigo) do update set acceso_total = true;
    insert into roles (codigo, nombre) values ('T126_VER', 'P126 ve zona'), ('T126_NADA', 'P126 sin permisos') on conflict (codigo) do nothing;
    select id into ra from roles where codigo = 'T126_ADM';
    select id into rv from roles where codigo = 'T126_VER';
    select id into rn from roles where codigo = 'T126_NADA';
    insert into permisos (rol_id, recurso, accion, permitido, alcance) values
        (rv, 'agrometricas', 'ver', true, 'zonal'), (rv, 'agrometricas', 'registrar_parametros', true, 'zonal')
    on conflict (rol_id, recurso, accion) do update set permitido = true, alcance = excluded.alcance;
    insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-000000012601', 'adm@t126.test'), ('00000000-0000-0000-0000-000000012602', 'vera@t126.test'),
        ('00000000-0000-0000-0000-000000012603', 'verb@t126.test'), ('00000000-0000-0000-0000-000000012604', 'nada@t126.test')
    on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000012601', 'Admin 126', ra, true), ('00000000-0000-0000-0000-000000012602', 'Ve A 126', rv, false),
        ('00000000-0000-0000-0000-000000012603', 'Ve B 126', rv, false), ('00000000-0000-0000-0000-000000012604', 'Nada 126', rn, false)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000012601', ra), ('00000000-0000-0000-0000-000000012602', rv),
        ('00000000-0000-0000-0000-000000012603', rv), ('00000000-0000-0000-0000-000000012604', rn) on conflict do nothing;
end $$;

-- zonas, turnos y turnos de ciclo activos
insert into zonas (nombre) values ('T126-A'), ('T126-B') on conflict (nombre) do nothing;
insert into turnos (codigo, nombre, zona_id) select 'T126-T1', 'T126 uno', id from zonas where nombre = 'T126-A' on conflict (codigo) do nothing;
insert into turnos (codigo, nombre, zona_id) select 'T126-T2', 'T126 dos', id from zonas where nombre = 'T126-B' on conflict (codigo) do nothing;
insert into turnos_ciclo (agl_id, turno_id, temporada, ciclo, fecha_siembra, zona_id, activo)
select 'T126-TR-A', (select id from turnos where codigo = 'T126-T1'), 'T126-2026-2027', 'Ciclo 1', '2026-08-01', (select id from zonas where nombre = 'T126-A'), true
on conflict (agl_id) do update set activo = true;
insert into turnos_ciclo (agl_id, turno_id, temporada, ciclo, fecha_siembra, zona_id, activo)
select 'T126-TR-B', (select id from turnos where codigo = 'T126-T2'), 'T126-2026-2027', 'Ciclo 1', '2026-08-01', (select id from zonas where nombre = 'T126-B'), true
on conflict (agl_id) do update set activo = true;
insert into perfiles_zonas (perfil_id, zona_id)
select x.p, z.id from (values ('00000000-0000-0000-0000-000000012602'::uuid, 'T126-A'), ('00000000-0000-0000-0000-000000012603', 'T126-B'),
                              ('00000000-0000-0000-0000-000000012604', 'T126-A')) x(p, zn)
join zonas z on z.nombre = x.zn on conflict do nothing;
insert into estaciones_riego (codigo, nombre) values ('T126-EST', 'T126 estación') on conflict do nothing;
insert into fert_operaciones (id, tipo, perfil_id, resultado) values
    ('12600000-0000-4000-8000-000000000001', 'bitacora', '00000000-0000-0000-0000-000000012601', 'ACEPTADO') on conflict do nothing;

create temp table k as select
    '00000000-0000-0000-0000-000000012601'::uuid as adm, '00000000-0000-0000-0000-000000012602'::uuid as vera,
    '00000000-0000-0000-0000-000000012603'::uuid as verb, '00000000-0000-0000-0000-000000012604'::uuid as nada,
    (select id from turnos_ciclo where agl_id = 'T126-TR-A') as tca, (select id from turnos_ciclo where agl_id = 'T126-TR-B') as tcb,
    (select id from estaciones_riego where codigo = 'T126-EST') as est,
    '12600000-0000-4000-8000-000000000001'::uuid as op,
    '12600000-0000-4000-8000-0000000000a1'::uuid as a1, '12600000-0000-4000-8000-0000000000a2'::uuid as a2;
grant all on all tables in schema pg_temp to public;

-- parámetros: A el 1 y el 2 de octubre
insert into agm_parametros (id, turno_ciclo_id, fecha, ddt, ph_agua, ce_agua, creado_por)
select a1, tca, '2026-10-01', 61, 6.5, 1.2, vera from k;
insert into agm_parametros (id, turno_ciclo_id, fecha, ddt, ph_agua, creado_por)
select a2, tca, '2026-10-02', 62, 6.1, vera from k;
-- Fertirriego › Horas: A 1-oct (con parámetros), A 3-oct (SIN parámetros), A 4-oct (todo vacío: no cuenta), B 1-oct (SIN parámetros)
insert into fert_bitacora_riego (turno_ciclo_id, fecha, estacion_id, horas_fertilizacion, horas_riego, pct_fertilizacion, ppm_cloro_cabezal, comentario, operacion_id, updated_by)
select tca, '2026-10-01', est, 2, 4, 50, 1.5, null, op, adm from k;
insert into fert_bitacora_riego (turno_ciclo_id, fecha, estacion_id, horas_fertilizacion, horas_riego, pct_fertilizacion, comentario, operacion_id, updated_by)
select tca, '2026-10-03', est, 3, 6, 60, 'solo horas', op, vera from k;
insert into fert_bitacora_riego (turno_ciclo_id, fecha, estacion_id, comentario, operacion_id, updated_by)
select tca, '2026-10-04', est, 'vacío', op, adm from k;
insert into fert_bitacora_riego (turno_ciclo_id, fecha, estacion_id, horas_riego, operacion_id, updated_by)
select tcb, '2026-10-01', est, 3, op, adm from k;
select pg_temp.ok((select tca is not null and tcb is not null and est is not null from k), 'datos de la prueba creados');

-- ---------------------------------------------------------------- sesión y zona
select pg_temp.como(null);
do $$ begin
    perform fn_agm_mis_registros('{}');
    raise exception 'FALLA: sin sesión debía fallar';
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    if sqlstate <> '42501' then raise exception 'FALLA: código % (se esperaba 42501)', sqlstate; end if;
    raise notice 'ok  sin sesión: 42501';
end $$;

-- ---------------------------------------------------------------- Ve A: ve la zona A (2 parámetros + 1 día solo de horas), no la B
select pg_temp.como((select vera from k));
create temp table ra as select pg_temp.mi('{"temporada":"T126-2026-2027"}') as j;
select pg_temp.ok((select (j ->> 'total')::int = 3 and jsonb_array_length(j -> 'registros') = 3 from ra),
                  'Ve A: 3 filas (parámetros del 1 y 2 de oct + día solo con horas del 3 de oct); el 4 de oct vacío no cuenta; nada de la zona B');
select pg_temp.ok((select (f ->> 'horas_riego')::numeric = 4 and (f ->> 'horas_fertilizacion')::numeric = 2 and (f ->> 'pct_fertilizacion')::numeric = 50
                          and f ->> 'solo_horas' = 'false' and (f ->> 'ph_agua')::numeric = 6.5
                   from (select pg_temp.fila((select j from ra), 'T126-T1', '2026-10-01') f) q),
                  'el registro del 1 de oct trae sus parámetros Y las horas, las horas de fertilización y el % del mismo turno y día');
select pg_temp.ok((select f ->> 'horas_riego' is null and f ->> 'pct_fertilizacion' is null and f ->> 'solo_horas' = 'false'
                   from (select pg_temp.fila((select j from ra), 'T126-T1', '2026-10-02') f) q),
                  'el registro del 2 de oct (sin bitácora ese día) trae horas y % vacíos, no los de otro día');
select pg_temp.ok((select f ->> 'solo_horas' = 'true' and f ->> 'id' like 'h:%' and (f ->> 'horas_riego')::numeric = 6 and (f ->> 'pct_fertilizacion')::numeric = 60
                          and (f ->> 'ddt')::int = 63 and f ->> 'ph_agua' is null and f ->> 'zona' = 'T126-A' and f ->> 'puede_editar' = 'false' and f ->> 'puede_eliminar' = 'false'
                          and f ->> 'creado_por_nombre' = 'Ve A 126' and f ->> 'comentario' = 'solo horas'
                   from (select pg_temp.fila((select j from ra), 'T126-T1', '2026-10-03') f) q),
                  'el 3 de oct (solo horas): fila del turno con id «h:…», DDT = fecha − siembra, sin parámetros, sin editar ni eliminar, con quien registró');
select pg_temp.ok((select not (f ? 'ppm_cloro_cabezal') and not (f ? 'hora_inicio') and not (f ? 'ejecutor_id') and not (f ? 'operacion_id') and not (f ? 'updated_by')
                   from (select pg_temp.fila((select j from ra), 'T126-T1', '2026-10-03') f) q)
                  and (select not (f ? 'ppm_cloro_cabezal') and not (f ? 'operacion_id') from (select pg_temp.fila((select j from ra), 'T126-T1', '2026-10-01') f) q),
                  'no se expone ninguna otra columna de Fertirriego (cloro, horas de inicio/fin, ejecutores, operación)');
select pg_temp.ok((select puede_editar from (select (f ->> 'puede_editar')::boolean as puede_editar from (select pg_temp.fila((select j from ra), 'T126-T1', '2026-10-01') f) q) z),
                  'el dueño con «Registrar parámetros» sigue pudiendo editar su registro (no cambió respecto a la 125)');

-- ---------------------------------------------------------------- Ve B: solo la zona B (un día solo de horas)
select pg_temp.como((select verb from k));
select pg_temp.ok((select (j ->> 'total')::int = 1 and jsonb_array_length(j -> 'registros') = 1 and j -> 'registros' -> 0 ->> 'turno' = 'T126-T2'
                          and (j -> 'registros' -> 0 ->> 'horas_riego')::numeric = 3 and j -> 'registros' -> 0 ->> 'solo_horas' = 'true'
                   from (select pg_temp.mi('{"temporada":"T126-2026-2027"}') j) q),
                  'Ve B: solo ve las horas de su zona (la B), no las de la zona A');
-- ---------------------------------------------------------------- sin permiso en AgroMétricas: nada (ni siquiera las horas)
select pg_temp.como((select nada from k));
select pg_temp.ok((select (j ->> 'total')::int = 0 and jsonb_array_length(j -> 'registros') = 0 from (select pg_temp.mi('{"temporada":"T126-2026-2027"}') j) q),
                  'un usuario sin «AgroMétricas · ver» no ve ni parámetros ni horas (no se filtra Fertirriego por esta vía)');

-- ---------------------------------------------------------------- administrador: todo, filtros, orden y paginación
select pg_temp.como((select adm from k));
select pg_temp.ok((select (j ->> 'total')::int = 4 from (select pg_temp.mi('{"temporada":"T126-2026-2027"}') j) q), 'administrador: 4 filas (3 de A + 1 de B)');
select pg_temp.ok((select (j ->> 'total')::int = 1 and j -> 'registros' -> 0 ->> 'fecha' = '2026-10-03'
                   from (select pg_temp.mi('{"temporada":"T126-2026-2027","desde":"2026-10-03"}') j) q), 'filtro desde: el día solo de horas entra en el filtro de fechas');
select pg_temp.ok((select (j ->> 'total')::int = 3 from (select pg_temp.mi('{"temporada":"T126-2026-2027","turno":"t126-t1"}') j) q), 'filtro turno exacto (sin distinguir mayúsculas)');
select pg_temp.ok((select (j ->> 'total')::int = 1 from (select pg_temp.mi('{"temporada":"T126-2026-2027","texto":"solo horas"}') j) q), 'filtro de texto encuentra el comentario de la bitácora');
select pg_temp.ok((select (j ->> 'total')::int = 1 and j -> 'registros' -> 0 ->> 'turno' = 'T126-T2'
                   from (select pg_temp.mi('{"temporada":"T126-2026-2027","zona_id":"' || (select zb.id::text from zonas zb where zb.nombre = 'T126-B') || '"}') j) q), 'filtro de zona incluye los días solo de horas');
insert into turno_lotes (turno_ciclo_id, lote, nombre) select tca, 'T126-LOTE', 'Lote 126' from k on conflict do nothing;
select pg_temp.ok((select (j ->> 'total')::int = 3 from (select pg_temp.mi('{"temporada":"T126-2026-2027","lotes":["T126-LOTE"]}') j) q), 'filtro por lote incluye los días solo de horas del turno');
select pg_temp.ok((select j -> 'registros' -> 0 ->> 'fecha' = '2026-10-03' and j -> 'registros' -> 2 ->> 'fecha' = '2026-10-01'
                   from (select pg_temp.mi('{"temporada":"T126-2026-2027","turno":"T126-T1"}') j) q), 'orden desc por fecha');
select pg_temp.ok((select (j ->> 'total')::int = 3 and (j ->> 'limite')::int = 2 and jsonb_array_length(j -> 'registros') = 2
                   from (select fn_agm_mis_registros('{"temporada":"T126-2026-2027","turno":"T126-T1","limite":2}') j) q)
                  and (select jsonb_array_length(j -> 'registros') = 1 and j -> 'registros' -> 0 ->> 'fecha' = '2026-10-01'
                      from (select fn_agm_mis_registros('{"temporada":"T126-2026-2027","turno":"T126-T1","limite":2,"pagina":1}') j) q),
                  'paginación: el total cuenta las filas solo-horas y la página 2 trae la última');

-- ---------------------------------------------------------------- si se elimina el parámetro, ese día pasa a ser «solo horas»; un eliminado no se ve
update agm_parametros set eliminado_en = now(), eliminado_por = (select adm from k), eliminado_motivo = 'prueba 126 eliminar'
 where id = (select a1 from k);
select pg_temp.ok((select (j ->> 'total')::int = 3 and (pg_temp.fila(j, 'T126-T1', '2026-10-01') ->> 'solo_horas') = 'true'
                          and (pg_temp.fila(j, 'T126-T1', '2026-10-01') ->> 'horas_riego')::numeric = 4
                   from (select pg_temp.mi('{"temporada":"T126-2026-2027","turno":"T126-T1"}') j) q),
                  'al eliminar el parámetro del 1 de oct, ese día queda como fila solo-horas (la bitácora sigue) y no se duplica');
update agm_parametros set eliminado_en = null, eliminado_por = null, eliminado_motivo = null where id = (select a1 from k);
select pg_temp.ok((select (j ->> 'total')::int = 3 and (pg_temp.fila(j, 'T126-T1', '2026-10-01') ->> 'solo_horas') = 'false'
                   from (select pg_temp.mi('{"temporada":"T126-2026-2027","turno":"T126-T1"}') j) q), 'al restaurar el parámetro vuelve a ser un registro normal (sin duplicar)');
-- un turno con bitácora de horas en 0 también cuenta (0 no es vacío)
update fert_bitacora_riego set horas_riego = 0, horas_fertilizacion = null, pct_fertilizacion = null
 where turno_ciclo_id = (select tca from k) and fecha = '2026-10-04';
select pg_temp.ok((select (j ->> 'total')::int = 4 and (pg_temp.fila(j, 'T126-T1', '2026-10-04') ->> 'horas_riego')::numeric = 0
                   from (select pg_temp.mi('{"temporada":"T126-2026-2027","turno":"T126-T1"}') j) q), '0 horas es un dato (no es vacío)');
update fert_bitacora_riego set horas_riego = null where turno_ciclo_id = (select tca from k) and fecha = '2026-10-04';

-- ---------------------------------------------------------------- migración repetida y órdenes
\i sql/126_agrometricas_horas_riego_en_registros.sql
\i sql/126_agrometricas_horas_riego_en_registros.sql
select pg_temp.ok((select (j ->> 'total')::int = 3 from (select pg_temp.mi('{"temporada":"T126-2026-2027","turno":"T126-T1"}') j) q), '126>126: sigue igual');
-- 125>126 (la 125 deja la versión sin horas; la 126 la vuelve a poner)
\i sql/125_agrometricas_registros_temporada.sql
select pg_temp.ok((select (pg_temp.fila(j, 'T126-T1', '2026-10-03') is null) from (select pg_temp.mi('{"temporada":"T126-2026-2027","turno":"T126-T1"}') j) q),
                  '125 sola: la versión de la 125 no trae filas solo-horas (por eso se corre la 126 después)');
\i sql/126_agrometricas_horas_riego_en_registros.sql
select pg_temp.ok((select (j ->> 'total')::int = 3 and (pg_temp.fila(j, 'T126-T1', '2026-10-03') ->> 'horas_riego')::numeric = 6
                   from (select pg_temp.mi('{"temporada":"T126-2026-2027","turno":"T126-T1"}') j) q), '125>126: las horas vuelven');

select 'FIN 126 OK' as resultado;
rollback;
