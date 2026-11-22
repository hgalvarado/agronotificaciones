-- =====================================================================
-- PRUEBAS de sql/122 · AgroMétricas: AGL baja, verifica la huella y recién entonces se borra de Supabase
-- Base: réplica con 91-121 + 109 y 110 + 122 (hay un turno en turnos_ciclo y una zona). Desde la raíz del repo:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/122_agrometricas_bajar.sql
-- Todo corre dentro de una transacción y termina con ROLLBACK (no deja nada). Al final repite migraciones
-- (122>122, 109>110>122>122) dentro de la misma transacción.
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
/** Arma el mensaje de confirmación a partir de lo que devolvió fn_agm_exportar (opcional: solo estas ids). */
create or replace function pg_temp.mk(p_exp jsonb, p_solo uuid[] default null) returns jsonb language sql as $$
    with f as (select e ->> 'tabla' as tabla, e ->> 'id' as id, e ->> 'huella' as huella, e ->> 'cursor' as cursor
                 from jsonb_array_elements(p_exp -> 'filas') e
                where p_solo is null or (e ->> 'id')::uuid = any (p_solo))
    select jsonb_build_object(
        'lote', coalesce((select jsonb_agg(jsonb_build_object('tabla', tabla, 'id', id, 'huella', huella) order by cursor collate "C") from f), '[]'::jsonb),
        'cuantos', (select count(*) from f),
        'sha256_lote', encode(sha256(convert_to(coalesce((select string_agg(huella, '|' order by cursor collate "C") from f), ''), 'UTF8')), 'hex'))
$$;
set client_min_messages = notice;

-- ---- roles y personas (sin permiso / AGL ver / AGL ver+publicar)
do $$
declare r1 smallint; r2 smallint; r3 smallint;
begin
    insert into roles (codigo, nombre) values ('T122_NADA', 'P122 sin AGL'), ('T122_VER', 'P122 AGL ver'), ('T122_PUB', 'P122 AGL publicar') on conflict (codigo) do nothing;
    select id into r1 from roles where codigo = 'T122_NADA';
    select id into r2 from roles where codigo = 'T122_VER';
    select id into r3 from roles where codigo = 'T122_PUB';
    insert into permisos (rol_id, recurso, accion, permitido, alcance) values
        (r1, 'agrometricas', 'ver', true, 'global'), (r1, 'agrometricas', 'registrar_parametros', true, 'global'),
        (r2, 'fertirriego_agl', 'ver', true, 'global'),
        (r3, 'fertirriego_agl', 'ver', true, 'global'), (r3, 'fertirriego_agl', 'publicar', true, 'global')
    on conflict (rol_id, recurso, accion) do update set permitido = true, alcance = excluded.alcance;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000012201', 'nada@122'), ('00000000-0000-0000-0000-000000012202', 'ver@122'),
        ('00000000-0000-0000-0000-000000012203', 'pub@122') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000012201', 'Nada 122', r1, true), ('00000000-0000-0000-0000-000000012202', 'AGL ver 122', r2, true),
        ('00000000-0000-0000-0000-000000012203', 'AGL publica 122', r3, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000012201', r1), ('00000000-0000-0000-0000-000000012202', r2), ('00000000-0000-0000-0000-000000012203', r3) on conflict do nothing;
end $$;

create temp table k as select
    (select id from turnos_ciclo order by activo desc, publicado_at limit 1) as tc,
    (select id from zonas order by nombre limit 1) as zona,
    '00000000-0000-0000-0000-000000012201'::uuid as nada, '00000000-0000-0000-0000-000000012202'::uuid as ver,
    '00000000-0000-0000-0000-000000012203'::uuid as pub,
    '12200000-0000-4000-8000-000000000001'::uuid as p1, '12200000-0000-4000-8000-000000000002'::uuid as p2,
    '12200000-0000-4000-8000-000000000003'::uuid as p3, '12200000-0000-4000-8000-000000000004'::uuid as p4,
    '12200000-0000-4000-8000-000000000005'::uuid as p5, '12200000-0000-4000-8000-0000000000c1'::uuid as c1;
select pg_temp.ok((select tc is not null and zona is not null from k), 'la réplica tiene un turno y una zona');
create temp table sv (clave text primary key, v text);
grant all on all tables in schema pg_temp to public;
insert into sv select 'perm', md5(string_agg(p::text, '|' order by p::text)) from permisos p;

-- ---- esquema
select pg_temp.ok((select count(*) = 6 from information_schema.columns
                   where table_name in ('agm_parametros', 'agm_clima', 'agm_calicatas') and column_name in ('bajado_a_agl_en', 'huella')), 'columnas bajado_a_agl_en y huella en las 3 tablas');
select pg_temp.ok((select retencion_dias = 7 from agm_bajada_config), 'retención por defecto 7 días');

-- ---- datos (se insertan como dueño; el activo del turno queda en true)
update turnos_ciclo set activo = true where id = (select tc from k);
delete from agm_calicatas where turno_ciclo_id = (select tc from k);
delete from agm_parametros where turno_ciclo_id = (select tc from k) and fecha between '2020-01-01' and '2020-01-31';
delete from agm_clima where zona_id = (select zona from k) and fecha between '2020-01-01' and '2020-01-31';
insert into agm_parametros (id, turno_ciclo_id, fecha, ph_agua, ce_agua, foto_calicata, comentario) values
    ((select p1 from k), (select tc from k), '2020-01-10', 6.5, 1.2, 'f122/p1.jpg', 'T122'),
    ((select p2 from k), (select tc from k), '2020-01-11', 6.4, 1.1, 'f122/p2.jpg', 'T122'),
    ((select p3 from k), (select tc from k), '2020-01-12', 6.3, 1.0, null, 'T122');
insert into agm_clima (id, zona_id, fecha, eto, dpv, viento) values ((select c1 from k), (select zona from k), '2020-01-10', 4.5, 1.1, 2.0);
insert into agm_calicatas (turno_ciclo_id, latitud, longitud, precision_m, medido_en)
values ((select tc from k), 13.4087, -87.5359, 5, '2020-01-10 12:00+00');

-- ---- permisos
select pg_temp.como((select nada from k));
select pg_temp.falla($q$ select fn_agm_exportar('{}') $q$, 'exportar sin permiso AGL: 42501', 'permiso', '42501');
select pg_temp.falla($q$ select fn_agm_confirmar_bajada('{}') $q$, 'confirmar sin permiso: 42501', 'permiso', '42501');
select pg_temp.falla($q$ select fn_agm_purgar_bajadas('{}') $q$, 'purgar sin permiso: 42501', 'permiso', '42501');
select pg_temp.falla($q$ select fn_agm_bajada_retencion() $q$, 'retención sin permiso: 42501', 'permiso', '42501');
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_agm_exportar('{}') $q$, 'exportar sin sesión: 42501', 'sesión', '42501');
select pg_temp.como((select ver from k));
select pg_temp.falla($q$ select fn_agm_confirmar_bajada('{"lote":[],"cuantos":0,"sha256_lote":""}') $q$, 'quien solo puede VER no confirma: 42501', 'permiso', '42501');
select pg_temp.falla($q$ select fn_agm_purgar_bajadas('{}') $q$, 'quien solo puede VER no purga: 42501', 'permiso', '42501');
select pg_temp.ok((fn_agm_exportar('{"desde":"2020-01-01","hasta":"2020-01-31"}') ? 'filas'), 'quien puede VER exporta');

-- ---- exportar
select pg_temp.como((select pub from k));
create temp table ex as select fn_agm_exportar('{"desde":"2020-01-01","hasta":"2020-01-31","limite":1000}') as j;
select pg_temp.ok((select (j->>'cuantos')::int = 5 and not (j->>'hay_mas')::boolean from ex), 'exportar: 3 parámetros + 1 clima + 1 calicata');
select pg_temp.ok((select bool_and(encode(sha256(convert_to(e->>'texto', 'UTF8')), 'hex') = e->>'huella' and (e->>'texto')::jsonb = e->'fila'
                   and not (e->'fila' ? 'huella') and not (e->'fila' ? 'bajado_a_agl_en')) from ex, jsonb_array_elements(j->'filas') e), 'exportar: sha256(texto) = huella, la fila no trae las marcas');
select pg_temp.ok((select j->>'sha256_lote' = pg_temp.mk(j)->>'sha256_lote' from ex), 'exportar: sha256_lote = huellas unidas con | en orden de cursor');
select pg_temp.ok((select bool_and(e ?& array['tabla','cursor','id','turno_ciclo_id','turno_agl_id','turno','temporada','ciclo','zona_id','fecha','fila','texto','huella','foto'])
                   from ex, jsonb_array_elements(j->'filas') e), 'exportar: trae todas las claves pedidas');
select pg_temp.ok((select e->>'turno_agl_id' = (select agl_id from turnos_ciclo where id = (select tc from k)) from ex, jsonb_array_elements(j->'filas') e where e->>'tabla' = 'calicatas'), 'exportar: trae el id del turno en AGL');
select pg_temp.ok((select e->'foto'->>'ruta' = 'f122/p1.jpg' from ex, jsonb_array_elements(j->'filas') e where e->>'id' = (select p1::text from k)), 'exportar: la foto trae su ruta de Storage');
select pg_temp.ok((select e->'foto' = 'null'::jsonb from ex, jsonb_array_elements(j->'filas') e where e->>'id' = (select p3::text from k)), 'exportar: sin foto = null');
select pg_temp.ok((select array_agg(e->>'cursor' order by ordinality) = array_agg(e->>'cursor' order by e->>'cursor' collate "C") from ex, jsonb_array_elements(j->'filas') with ordinality as t(e, ordinality)), 'exportar: orden estable por cursor');
-- por lotes
create temp table pg1 as select fn_agm_exportar('{"desde":"2020-01-01","hasta":"2020-01-31","limite":2}') as j;
select pg_temp.ok((select (j->>'hay_mas')::boolean and (j->>'cuantos')::int = 2 and j->>'siguiente' is not null from pg1), 'por lotes: límite 2 y hay_mas');
create temp table pg2 as select fn_agm_exportar(jsonb_build_object('desde', '2020-01-01', 'hasta', '2020-01-31', 'limite', 2, 'despues_de', (select j->>'siguiente' from pg1))) as j;
create temp table pg3 as select fn_agm_exportar(jsonb_build_object('desde', '2020-01-01', 'hasta', '2020-01-31', 'limite', 2, 'despues_de', (select j->>'siguiente' from pg2))) as j;
select pg_temp.ok((select (select j->>'cuantos' from pg1) = '2' and (select j->>'cuantos' from pg2) = '2' and (select j->>'cuantos' from pg3) = '1'
                          and not (select (j->>'hay_mas')::boolean from pg3)), 'por lotes: 2 + 2 + 1 con el cursor');
select pg_temp.ok((select count(distinct e->>'cursor') = 5 from (select j from pg1 union all select j from pg2 union all select j from pg3) x, jsonb_array_elements(x.j->'filas') e), 'por lotes: sin repetir ni perder filas');
select pg_temp.ok((jsonb_array_length(fn_agm_exportar('{"desde":"2020-01-11","hasta":"2020-01-11"}')->'filas') = 1), 'filtro por desde/hasta');

-- ---- confirmar: huella mala
select pg_temp.falla(format($q$ select fn_agm_confirmar_bajada(%L::jsonb) $q$, ((select pg_temp.mk(j) from ex) || '{"sha256_lote":"abc"}'::jsonb)::text),
    'confirmar: sha256_lote que no coincide = error 22023', 'huella del lote', '22023');
select pg_temp.falla(format($q$ select fn_agm_confirmar_bajada(%L::jsonb) $q$, ((select pg_temp.mk(j) from ex) || '{"cuantos":99}'::jsonb)::text),
    'confirmar: cuantos que no coincide = error 22023', 'conteo', '22023');
select pg_temp.falla($q$ select fn_agm_confirmar_bajada('{"lote":[{"tabla":"otra","id":"x","huella":"y"}],"cuantos":1,"sha256_lote":"z"}') $q$,
    'confirmar: tabla desconocida = error 22023', 'tabla', '22023');
select pg_temp.ok((select count(*) = 0 from agm_parametros where bajado_a_agl_en is not null) , 'tras los rechazos nada quedó marcado');
-- una huella equivocada en UNA fila (con lote consistente): solo esa se rechaza
create temp table malo as
    select jsonb_set(m, '{lote}', (select jsonb_agg(case when x->>'id' = (select p2::text from k) then jsonb_set(x, '{huella}', to_jsonb(repeat('0', 64))) else x end order by ord)
                                   from jsonb_array_elements(m->'lote') with ordinality t(x, ord))) as m
      from (select pg_temp.mk(j) as m from ex) q;
create temp table malo2 as
    select m || jsonb_build_object('sha256_lote', encode(sha256(convert_to((select string_agg(x->>'huella', '|' order by (case x->>'tabla' when 'parametros' then 'p|' when 'clima' then 'c|' else 'l|' end || (x->>'id')) collate "C")
                                                                              from jsonb_array_elements(m->'lote') x), 'UTF8')), 'hex')) as m from malo;
create temp table cm as select fn_agm_confirmar_bajada((select m from malo2)) as j;
select pg_temp.ok((select jsonb_array_length(j->'confirmadas') = 4 and jsonb_array_length(j->'rechazadas') = 1
                          and j->'rechazadas'->0->>'id' = (select p2::text from k) from cm), 'confirmar: la fila con huella mala se rechaza, las otras 4 se confirman');
select pg_temp.ok((select bajado_a_agl_en is null and huella is null from agm_parametros where id = (select p2 from k)), 'la rechazada sigue «por bajar»');
select pg_temp.ok((select count(*) = 2 and bool_and(bajado_a_agl_en is not null and huella is not null) from agm_parametros where id in ((select p1 from k), (select p3 from k))), 'las confirmadas guardan bajado_a_agl_en y huella');
select pg_temp.ok((select huella = encode(sha256(convert_to(((to_jsonb(a) - 'bajado_a_agl_en') - 'huella')::text, 'UTF8')), 'hex') from agm_parametros a where id = (select p1 from k)), 'la huella guardada es la de la fila sin las marcas');
select pg_temp.ok((select count(*) = 3 from agm_parametros where turno_ciclo_id = (select tc from k) and fecha between '2020-01-01' and '2020-01-31')
                   and (select count(*) = 1 from agm_clima where id = (select c1 from k))
                   and (select count(*) = 1 from agm_calicatas where turno_ciclo_id = (select tc from k)), 'confirmar NO borra nada (parámetros, clima ni calicata)');
select pg_temp.ok((select jsonb_array_length(fn_agm_exportar('{"desde":"2020-01-01","hasta":"2020-01-31"}')->'filas') = 1 and
                          fn_agm_exportar('{"desde":"2020-01-01","hasta":"2020-01-31"}')->'filas'->0->>'id' = (select p2::text from k)), 'exportar ahora solo trae la que falta');
-- confirmar la que falta con huella buena
select pg_temp.ok((jsonb_array_length(fn_agm_confirmar_bajada(pg_temp.mk(fn_agm_exportar('{"desde":"2020-01-01","hasta":"2020-01-31"}')))->'confirmadas') = 1), 'confirmar la que faltaba con huella buena');
select pg_temp.ok((jsonb_array_length(fn_agm_exportar('{"desde":"2020-01-01","hasta":"2020-01-31"}')->'filas') = 0), 'ya no queda nada por bajar');
-- confirmar dos veces es inocuo
select pg_temp.ok((jsonb_array_length(fn_agm_confirmar_bajada(pg_temp.mk((select j from ex)))->'rechazadas') = 0), 'confirmar de nuevo el mismo lote: sin rechazadas (idempotente)');

-- ---- purgar: retención
create temp table pu0 as select fn_agm_purgar_bajadas('{}') as j;
select pg_temp.ok((select (j->>'parametros')::int = 0 and (j->>'clima')::int = 0 and (j->>'calicatas')::int = 0 and j->'fotos' = '[]'::jsonb from pu0), 'purgar antes de la retención: no borra nada');
select pg_temp.ok((select count(*) = 3 from agm_parametros where comentario = 'T122'), 'los 3 parámetros siguen en Supabase');
-- retención configurable
select pg_temp.ok((fn_agm_bajada_retencion() = 7), 'retención leída = 7');
select pg_temp.falla($q$ select fn_agm_bajada_retencion(400) $q$, 'retención fuera de rango: 22023', 'retención', '22023');
update agm_parametros set bajado_a_agl_en = now() - interval '10 days' where comentario = 'T122';
update agm_clima set bajado_a_agl_en = now() - interval '10 days' where id = (select c1 from k);
update agm_calicatas set bajado_a_agl_en = now() - interval '10 days' where turno_ciclo_id = (select tc from k);
select pg_temp.ok((fn_agm_bajada_retencion(30) = 30), 'retención cambiada a 30 días');
select pg_temp.ok((fn_agm_purgar_bajadas('{}')->>'parametros')::int = 0, 'con retención 30 y 10 días de bajada: no borra');
select pg_temp.ok((fn_agm_bajada_retencion(7) = 7), 'retención vuelve a 7');
select pg_temp.ok((fn_agm_purgar_bajadas('{"retencion_dias":30}')->>'parametros')::int = 0, 'el parámetro retencion_dias solo puede AUMENTAR la configurada');
-- foto compartida con una fila que se queda: P4 (confirmada, vieja) y P5 (sin bajar) usan la misma foto
insert into agm_parametros (id, turno_ciclo_id, fecha, ph_agua, foto_calicata, comentario) values
    ((select p4 from k), (select tc from k), '2020-01-13', 6.0, 'f122/compartida.jpg', 'T122b'),
    ((select p5 from k), (select tc from k), '2020-01-14', 6.1, 'f122/compartida.jpg', 'T122b');
select pg_temp.ok((jsonb_array_length(fn_agm_confirmar_bajada(pg_temp.mk(fn_agm_exportar('{"desde":"2020-01-13","hasta":"2020-01-13"}')))->'confirmadas') = 1), 'P4 confirmada (P5 no)');
update agm_parametros set bajado_a_agl_en = now() - interval '10 days' where id = (select p4 from k);
-- editado después de bajado: P3 cambia
update agm_parametros set ph_agua = 7.7 where id = (select p3 from k);
select pg_temp.ok((select j->'filas'->0->>'id' = (select p3::text from k) and jsonb_array_length(j->'filas') = 1
                   from (select fn_agm_exportar('{"desde":"2020-01-12","hasta":"2020-01-12"}') as j) q), 'editado después de bajado: vuelve a «por bajar»');
create temp table pu1 as select fn_agm_purgar_bajadas('{}') as j;
select pg_temp.ok((select (j->>'parametros')::int = 3 and (j->>'clima')::int = 1 and (j->>'calicatas')::int = 0 from pu1), 'purgar: borra P1, P2 y P4 y el clima; NO P3 (cambió) ni la calicata (turno activo)');
select pg_temp.ok((select not exists (select 1 from agm_parametros where id in ((select p1 from k), (select p2 from k), (select p4 from k)))
                          and exists (select 1 from agm_parametros where id in ((select p3 from k), (select p5 from k)))
                          and exists (select 1 from agm_calicatas where turno_ciclo_id = (select tc from k))), 'quedan P3, P5 y la calicata');
select pg_temp.ok((select j->'fotos' = '["f122/p1.jpg","f122/p2.jpg"]'::jsonb from pu1), 'fotos para borrar de Storage: solo las de filas purgadas y que ninguna fila restante usa (la compartida NO)');
-- reconfirmar P3 y purgar
select pg_temp.ok((jsonb_array_length(fn_agm_confirmar_bajada(pg_temp.mk(fn_agm_exportar('{"desde":"2020-01-12","hasta":"2020-01-12"}')))->'confirmadas') = 1), 'P3 vuelve a confirmarse con la huella nueva');
update agm_parametros set bajado_a_agl_en = now() - interval '10 days' where id = (select p3 from k);
select pg_temp.ok((fn_agm_purgar_bajadas('{}')->>'parametros')::int = 1, 'P3 reconfirmada y vieja: se purga');
-- calicata: solo con el turno inactivo
update turnos_ciclo set activo = false where id = (select tc from k);
select pg_temp.ok((fn_agm_purgar_bajadas('{}')->>'calicatas')::int = 1, 'calicata se purga cuando su turno ya no está activo');
select pg_temp.ok((select count(*) = 1 from agm_parametros where comentario = 'T122b'), 'P5 (nunca bajada) sigue en Supabase');
-- límite y hay_mas
insert into agm_parametros (id, turno_ciclo_id, fecha, ph_agua, comentario)
select gen_random_uuid(), (select tc from k), d::date, 6, 'T122c' from generate_series('2020-01-20'::date, '2020-01-24'::date, '1 day') d;
select pg_temp.ok((jsonb_array_length(fn_agm_confirmar_bajada(pg_temp.mk(fn_agm_exportar('{"desde":"2020-01-20","hasta":"2020-01-24"}')))->'confirmadas') = 5), '5 filas nuevas confirmadas');
update agm_parametros set bajado_a_agl_en = now() - interval '10 days' where comentario = 'T122c';
create temp table pu2 as select fn_agm_purgar_bajadas('{"limite":2}') as j;
select pg_temp.ok((select (j->>'parametros')::int = 2 and (j->>'hay_mas')::boolean from pu2), 'purgar con límite 2: borra 2 y avisa hay_mas');
select pg_temp.ok((select (fn_agm_purgar_bajadas('{}')->>'parametros')::int = 3), 'la siguiente vuelta borra las 3 restantes');
select pg_temp.ok((select (j->>'parametros')::int = 0 and not (j->>'hay_mas')::boolean from (select fn_agm_purgar_bajadas('{}') as j) q), 'purgar de nuevo: 0 (idempotente)');

-- ---- idempotencia y órdenes de corrida (dentro de la misma transacción)
\i sql/122_agrometricas_bajar_a_agl.sql
\i sql/122_agrometricas_bajar_a_agl.sql
create or replace function pg_temp.finales(p_etq text) returns void language plpgsql as $$
declare v jsonb; vid uuid := gen_random_uuid(); v_tc uuid := (select tc from k);
begin
    if (select count(*) from agm_bajada_config) <> 1 or (select retencion_dias from agm_bajada_config) <> 7 then
        raise exception 'FALLA [%]: la configuración de retención cambió', p_etq; end if;
    if (select count(*) from information_schema.columns where table_name in ('agm_parametros', 'agm_clima', 'agm_calicatas') and column_name in ('bajado_a_agl_en', 'huella')) <> 6 then
        raise exception 'FALLA [%]: faltan columnas', p_etq; end if;
    -- las funciones de guardado de la 109/110 siguen trabajando con las columnas nuevas
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012203', false);
    insert into agm_parametros (id, turno_ciclo_id, fecha, ph_agua, comentario) values (vid, v_tc, '2020-02-01', 6.6, 'T122f');
    v := fn_agm_exportar('{"desde":"2020-02-01","hasta":"2020-02-01"}');
    if jsonb_array_length(v->'filas') <> 1 or v->'filas'->0->>'id' <> vid::text then raise exception 'FALLA [%]: exportar', p_etq; end if;
    v := fn_agm_confirmar_bajada(pg_temp.mk(v));
    if jsonb_array_length(v->'confirmadas') <> 1 then raise exception 'FALLA [%]: confirmar', p_etq; end if;
    update agm_parametros set bajado_a_agl_en = now() - interval '10 days' where id = vid;
    v := fn_agm_purgar_bajadas('{}');
    if (v->>'parametros')::int <> 1 then raise exception 'FALLA [%]: purgar', p_etq; end if;
    raise notice 'ok  finales [%]', p_etq;
end $$;
select pg_temp.finales('122>122');
\i sql/109_agrometricas_parametros_riego.sql
select pg_temp.finales('122>109');
\i sql/110_agrometricas_calicatas_fotos.sql
\i sql/122_agrometricas_bajar_a_agl.sql
\i sql/122_agrometricas_bajar_a_agl.sql
select pg_temp.finales('109>110>122>122');
select pg_temp.ok((select md5(string_agg(p::text, '|' order by p::text)) from permisos p) = (select v from sv where clave = 'perm'), 'la tabla de permisos no cambió (la 122 no crea permisos)');

select 'FIN 122 OK' as resultado;
rollback;
