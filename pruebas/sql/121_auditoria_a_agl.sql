-- =====================================================================
-- PRUEBAS de sql/121 · la copia de lo eliminado se baja a AGL y se borra de Supabase
-- Base: réplica con 91-121 (clonar t119e y correr 120 y 121). Desde la raíz del repo:
--   psql -d <base con 119, 120 y 121> -v ON_ERROR_STOP=1 -f pruebas/sql/121_auditoria_a_agl.sql
-- Al final repite migraciones en otros órdenes (119>120>121>121, 121>119, 100>101>119>120>121).
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
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_creado timestamptz default now(), p_inmediato boolean default true)
returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', p_creado, 'enviado_en', now(), 'inmediato', p_inmediato,
        'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('12100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
set client_min_messages = notice;

do $$
declare r1 smallint; r2 smallint; r3 smallint;
begin
    insert into roles (codigo, nombre) values ('T121_DEL', 'P121 elimina'), ('T121_VER', 'P121 AGL ver'), ('T121_PUB', 'P121 AGL publicar') on conflict (codigo) do nothing;
    select id into r1 from roles where codigo = 'T121_DEL';
    select id into r2 from roles where codigo = 'T121_VER';
    select id into r3 from roles where codigo = 'T121_PUB';
    insert into permisos (rol_id, recurso, accion, permitido, alcance) values
        (r1, 'fertirriego', 'ver', true, 'global'), (r1, 'fertirriego', 'eliminar_definitivo', true, 'global'),
        (r2, 'fertirriego_agl', 'ver', true, 'global'),
        (r3, 'fertirriego_agl', 'ver', true, 'global'), (r3, 'fertirriego_agl', 'publicar', true, 'global')
    on conflict (rol_id, recurso, accion) do update set permitido = true, alcance = excluded.alcance;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000012102', 'del@121'), ('00000000-0000-0000-0000-000000012103', 'ver@121'),
        ('00000000-0000-0000-0000-000000012104', 'pub@121') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000012102', 'Elimina 121', r1, true), ('00000000-0000-0000-0000-000000012103', 'AGL ver 121', r2, true),
        ('00000000-0000-0000-0000-000000012104', 'AGL publica 121', r3, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000012102', r1), ('00000000-0000-0000-0000-000000012103', r2), ('00000000-0000-0000-0000-000000012104', r3) on conflict do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    '430302c1-3572-4c38-bdcf-155efb0983ab'::uuid as tc,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1, '00000000-0000-0000-0000-0000000000e2'::uuid as e2,
    '00000000-0000-0000-0000-000000012102'::uuid as del, '00000000-0000-0000-0000-000000012103'::uuid as ver,
    '00000000-0000-0000-0000-000000012104'::uuid as pub,
    '10000000-0000-0000-0000-000000000001'::uuid as chofer;
create temp table sv (clave text primary key, v text);
grant all on all tables in schema pg_temp to public;

-- ---- esquema
select pg_temp.ok((select is_nullable = 'YES' from information_schema.columns where table_name = 'fert_eliminaciones' and column_name = 'snapshot'), 'snapshot ahora admite null');
select pg_temp.ok((select count(*) = 3 from information_schema.columns where table_name = 'fert_eliminaciones' and column_name in ('snapshot_huella', 'snapshot_bajado_at', 'movimientos_ids')), 'columnas nuevas presentes');
insert into sv select 'perm', md5(string_agg(p::text, '|' order by p::text)) from permisos p;

-- ---- datos
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(1), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'fecha_hora', now() - interval '1 hour',
    'chofer_id', (select chofer from k), 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 100))))->>'estado') like 'ACEPTADO%', 'recepción');
select pg_temp.ok((pg_temp.op(pg_temp.uid(2), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
    'fecha', ((now() at time zone 'America/Tegucigalpa')::date - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 30))))->>'estado') like 'ACEPTADO%', 'aplicación');
create temp table movs as select array_agg(cursor order by cursor) cur from fert_movimientos where documento_id in (pg_temp.uid(1), pg_temp.uid(2));
select pg_temp.ok((select cardinality(cur) = 2 from movs), 'hay 2 movimientos');
select pg_temp.como((select del from k));
select pg_temp.ok((fn_fert_eliminar_documento('aplicacion', pg_temp.uid(2), 'prueba 121 se registró por error')->>'ok')::boolean, 'eliminar la aplicación');
select pg_temp.ok((fn_fert_eliminar_documento('recepcion', pg_temp.uid(1), 'prueba 121 recepción duplicada')->>'ok')::boolean, 'eliminar la recepción');

-- el disparador puso la huella aunque la función de eliminar no la conoce
select pg_temp.ok((select count(*) = 2 and bool_and(snapshot is not null and snapshot_huella = encode(sha256(convert_to(snapshot::text, 'UTF8')), 'hex') and snapshot_bajado_at is null)
                   from fert_eliminaciones where motivo like 'prueba 121%'), 'las 2 eliminaciones guardan snapshot y huella (sha256 del snapshot::text)');
select pg_temp.ok((select bool_and(jsonb_array_length(movimientos_ids) = 1) from fert_eliminaciones where motivo like 'prueba 121%'), 'movimientos_ids guardados (1 cada una)');

-- ---- bajar
select pg_temp.como((select ver from k));
create temp table b as select fn_fert_eliminaciones_para_bajar(1000) as j;
select pg_temp.ok((select (j->>'hay_mas')::boolean = false and j ? 'generado' from b), 'bajar: forma de la respuesta');
select pg_temp.ok((select count(*) = 2 from b, jsonb_array_elements(j->'eliminaciones') e where e->>'motivo' like 'prueba 121%'), 'bajar: trae las 2 pendientes');
select pg_temp.ok((select bool_and(encode(sha256(convert_to(e->>'snapshot_texto', 'UTF8')), 'hex') = e->>'huella' and (e->>'snapshot_texto')::jsonb = e->'snapshot')
                   from b, jsonb_array_elements(j->'eliminaciones') e), 'bajar: sha256(snapshot_texto) = huella y snapshot_texto = snapshot');
select pg_temp.ok((select bool_and(e ?& array['id','tipo','documento_id','estacion','estacion2','resumen','motivo','eliminado_at','eliminado_por_nombre','registrado_por_nombre','fecha_documento','conteos','snapshot','huella'])
                   from b, jsonb_array_elements(j->'eliminaciones') e), 'bajar: trae todas las claves pedidas');
select pg_temp.ok((select bool_and(jsonb_typeof(e->'materiales') = 'object' and (e->'materiales') ? (select a::text from k)) and bool_and(e->'materiales'->(select a::text from k)->>'codigo' = 'QA-SOLCA')
                   from b, jsonb_array_elements(j->'eliminaciones') e), 'bajar: trae los nombres de los productos del documento');
select pg_temp.ok((select (j->'eliminaciones'->0->>'eliminado_at')::timestamptz <= (j->'eliminaciones'->1->>'eliminado_at')::timestamptz from b), 'bajar: más antiguas primero');
select pg_temp.ok((fn_fert_eliminaciones_para_bajar(1)->>'hay_mas')::boolean and jsonb_array_length(fn_fert_eliminaciones_para_bajar(1)->'eliminaciones') = 1, 'bajar: límite 1 y hay_mas');
select pg_temp.como((select e1 from k));
select pg_temp.falla($q$ select fn_fert_eliminaciones_para_bajar() $q$, 'bajar: estacionero 42501', 'permiso', '42501');
select pg_temp.como((select del from k));
select pg_temp.falla($q$ select fn_fert_eliminaciones_para_bajar() $q$, 'bajar: quien elimina sin «AGL · ver» 42501', 'permiso', '42501');
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_fert_eliminaciones_para_bajar() $q$, 'bajar: sin sesión 42501', 'sesión', '42501');
select pg_temp.ok(not has_function_privilege('anon', 'public.fn_fert_eliminaciones_para_bajar(integer)', 'execute')
                  and has_function_privilege('authenticated', 'public.fn_fert_eliminaciones_para_bajar(integer)', 'execute')
                  and not has_function_privilege('anon', 'public.fn_fert_eliminaciones_confirmar(jsonb)', 'execute')
                  and has_function_privilege('authenticated', 'public.fn_fert_eliminaciones_confirmar(jsonb)', 'execute'), 'grants solo a authenticated');

-- ---- confirmar: permisos
create temp table c as select
    (select (e->>'id')::uuid from b, jsonb_array_elements(j->'eliminaciones') e where e->>'tipo' = 'aplicacion') as id_ap,
    (select e->>'huella' from b, jsonb_array_elements(j->'eliminaciones') e where e->>'tipo' = 'aplicacion') as h_ap,
    (select (e->>'id')::uuid from b, jsonb_array_elements(j->'eliminaciones') e where e->>'tipo' = 'recepcion') as id_re,
    (select e->>'huella' from b, jsonb_array_elements(j->'eliminaciones') e where e->>'tipo' = 'recepcion') as h_re;
select pg_temp.como((select ver from k));
select pg_temp.falla(format($q$ select fn_fert_eliminaciones_confirmar(jsonb_build_array(jsonb_build_object('id', %L, 'huella', %L))) $q$, (select id_ap from c), (select h_ap from c)),
    'confirmar: solo «AGL · ver» no basta (42501)', 'permiso', '42501');
select pg_temp.como((select del from k));
select pg_temp.falla(format($q$ select fn_fert_eliminaciones_confirmar(jsonb_build_array(jsonb_build_object('id', %L, 'huella', %L))) $q$, (select id_ap from c), (select h_ap from c)),
    'confirmar: quien elimina sin «publicar» (42501)', 'permiso', '42501');
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_fert_eliminaciones_confirmar('[]') $q$, 'confirmar: sin sesión (42501)', 'sesión', '42501');
reset role;
select pg_temp.ok((select count(*) = 2 from fert_eliminaciones where motivo like 'prueba 121%' and snapshot is not null), 'tras los rechazos de permiso nada cambió');

-- ---- confirmar: huella mala
select pg_temp.como((select pub from k));
create temp table r1 as select fn_fert_eliminaciones_confirmar(jsonb_build_array(
    jsonb_build_object('id', (select id_ap from c), 'huella', 'deadbeef'),
    jsonb_build_object('id', gen_random_uuid(), 'huella', (select h_ap from c)))) as j;
select pg_temp.ok((select jsonb_array_length(j->'confirmadas') = 0 and jsonb_array_length(j->'rechazadas') = 2 from r1), 'huella incorrecta / id inexistente: rechazadas');
select pg_temp.ok((select snapshot is not null and snapshot_bajado_at is null from fert_eliminaciones where id = (select id_ap from c)), 'huella incorrecta: el snapshot queda intacto');
select pg_temp.falla($q$ select fn_fert_eliminaciones_confirmar('{}') $q$, 'confirmar: argumento no lista', 'lista', '22023');

-- ---- confirmar: correcta (solo la aplicación)
create temp table r2 as select fn_fert_eliminaciones_confirmar(jsonb_build_array(jsonb_build_object('id', (select id_ap from c), 'huella', (select h_ap from c)))) as j;
select pg_temp.ok((select j->'confirmadas' = jsonb_build_array((select id_ap from c)) and j->'rechazadas' = '[]'::jsonb from r2), 'huella correcta: confirmada');
select pg_temp.ok((select snapshot is null and snapshot_bajado_at is not null and snapshot_huella = (select h_ap from c) and tipo = 'aplicacion' and motivo like 'prueba 121%'
                   and operaciones_ids is not null and cardinality(operaciones_ids) >= 1 and jsonb_array_length(movimientos_ids) = 1
                   from fert_eliminaciones where id = (select id_ap from c)), 'snapshot = null, bajado_at puesto; quedan datos mínimos, operaciones_ids y movimientos_ids');
select pg_temp.ok((select snapshot is not null from fert_eliminaciones where id = (select id_re from c)), 'la otra sigue con snapshot (no se confirmó)');
insert into sv select 'bajado1', snapshot_bajado_at::text from fert_eliminaciones where id = (select id_ap from c);
-- idempotente
create temp table r3 as select fn_fert_eliminaciones_confirmar(jsonb_build_array(jsonb_build_object('id', (select id_ap from c), 'huella', (select h_ap from c)))) as j;
select pg_temp.ok((select jsonb_array_length(j->'confirmadas') = 1 and jsonb_array_length(j->'rechazadas') = 0 from r3), 'confirmar dos veces: idempotente');
select pg_temp.ok((select snapshot_bajado_at::text = (select v from sv where clave = 'bajado1') from fert_eliminaciones where id = (select id_ap from c)), 'la segunda confirmación no cambia bajado_at');
select pg_temp.ok((select count(*) = 0 from jsonb_array_elements(fn_fert_eliminaciones_para_bajar(1000)->'eliminaciones') e where (e->>'id')::uuid = (select id_ap from c)), 'lo confirmado ya no se vuelve a bajar');

-- ---- la app: copia y listado
select pg_temp.como((select del from k));
select pg_temp.ok(fn_fert_eliminacion_copia((select id_ap from c)) is null, 'fn_fert_eliminacion_copia = null si ya se bajó');
select pg_temp.ok(fn_fert_eliminacion_copia((select id_re from c)) is not null, 'fn_fert_eliminacion_copia sigue entregando la que no se ha bajado');
select pg_temp.ok((select (e->>'copia_en_agl')::boolean from jsonb_array_elements(fn_fert_eliminaciones_listar()) e where (e->>'id')::uuid = (select id_ap from c)), 'listado: copia_en_agl = true');
select pg_temp.ok((select not (e->>'copia_en_agl')::boolean and e->>'snapshot_bajado_at' is null from jsonb_array_elements(fn_fert_eliminaciones_listar()) e where (e->>'id')::uuid = (select id_re from c)), 'listado: copia_en_agl = false para la pendiente');
select pg_temp.ok((select not (fn_fert_eliminaciones_listar()::text ~ '"snapshot"')), 'el listado no expone el snapshot');

-- ---- la 120 sigue funcionando tras confirmar
select pg_temp.como((select ver from k));
select pg_temp.ok((select count(*) = 1 and (min(jsonb_array_length(e->'movimientos'))) = 1
                          and (min((e->'movimientos'->0->>'cursor')::bigint)) = any (array(select unnest(cur) from movs))
                   from jsonb_array_elements(fn_fert_eliminados_para_agl()->'eliminados') e where (e->>'documento_id')::uuid = pg_temp.uid(2)),
                  'fn_fert_eliminados_para_agl devuelve los ids de movimientos de la aplicación ya bajada (sin snapshot)');
select pg_temp.ok((select count(*) = 1 and min(jsonb_array_length(e->'operaciones_ids')) >= 1
                   from jsonb_array_elements(fn_fert_eliminados_para_agl()->'eliminados') e where (e->>'documento_id')::uuid = pg_temp.uid(2)), 'y sus operaciones_ids');
select pg_temp.ok(not fn_fert_eliminados_para_agl()::text ~* '(snapshot|motivo|prueba 121)', 'la 120 no filtra snapshot ni motivo');

-- ---- una operación reenviada tras confirmar no recrea el registro
select pg_temp.como((select e2 from k));
create temp table rep as select pg_temp.op(pg_temp.uid(2), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
    'fecha', ((now() at time zone 'America/Tegucigalpa')::date - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 30)))) as j;
select pg_temp.ok((select j->>'estado' not like 'ACEPTADO%' from rep), 'reenvío de la operación eliminada (ya bajada): se rechaza');
select pg_temp.ok(not exists (select 1 from fert_aplicaciones where id = pg_temp.uid(2)), 'y no se recrea la aplicación');

-- ---- limpieza de 180 días
reset role;
update fert_eliminaciones set snapshot_bajado_at = now() - interval '181 days' where id = (select id_ap from c);
select pg_temp.como((select pub from k));
select fn_fert_eliminaciones_confirmar('[]');
select pg_temp.ok(not exists (select 1 from fert_eliminaciones where id = (select id_ap from c)), 'limpieza: la bajada hace más de 180 días se borra');
select pg_temp.ok(exists (select 1 from fert_eliminaciones where id = (select id_re from c) and snapshot is not null), 'limpieza: la pendiente no se toca');
-- una bajada hace 179 días se queda
create temp table c2 as select fn_fert_eliminaciones_confirmar(jsonb_build_array(jsonb_build_object('id', (select id_re from c), 'huella', (select h_re from c)))) as j;
reset role;
update fert_eliminaciones set snapshot_bajado_at = now() - interval '179 days' where id = (select id_re from c);
select pg_temp.como((select pub from k));
select fn_fert_eliminaciones_confirmar('[]');
select pg_temp.ok(exists (select 1 from fert_eliminaciones where id = (select id_re from c) and snapshot is null), 'limpieza: 179 días se conserva');

-- ---- permisos: nadie gana nada
select pg_temp.ok((select md5(string_agg(p::text, '|' order by p::text)) from permisos p) = (select v from sv where clave = 'perm'), 'la 121 no cambia la tabla de permisos');

-- ---- órdenes de corrida
create or replace function pg_temp.finales(p_etq text) returns void language plpgsql as $$
declare v jsonb; vid uuid := gen_random_uuid();
begin
    if (select is_nullable from information_schema.columns where table_name = 'fert_eliminaciones' and column_name = 'snapshot') <> 'YES' then
        raise exception 'FALLA [%]: snapshot volvió a NOT NULL', p_etq; end if;
    if (select count(*) from information_schema.columns where table_name = 'fert_eliminaciones' and column_name in ('snapshot_huella', 'snapshot_bajado_at', 'movimientos_ids')) <> 3 then
        raise exception 'FALLA [%]: faltan columnas', p_etq; end if;
    -- el disparador calcula huella y movimientos aunque la 119 redefina la función de eliminar
    insert into fert_eliminaciones (id, tipo, documento_id, motivo, eliminado_por, snapshot)
    values (vid, 'conteo', gen_random_uuid(), 'finales 121', '00000000-0000-0000-0000-000000012102',
            jsonb_build_object('movimientos', jsonb_build_array(jsonb_build_object('cursor', 1, 'id', gen_random_uuid()))));
    if (select snapshot_huella is null or jsonb_array_length(movimientos_ids) <> 1 from fert_eliminaciones where id = vid) then
        raise exception 'FALLA [%]: el disparador no calculó huella/movimientos', p_etq; end if;
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012104', false);
    v := fn_fert_eliminaciones_para_bajar(1000);
    if not exists (select 1 from jsonb_array_elements(v->'eliminaciones') e where (e->>'id')::uuid = vid and e->>'huella' = (select snapshot_huella from fert_eliminaciones where id = vid)) then
        raise exception 'FALLA [%]: bajar no trae la prueba', p_etq; end if;
    v := fn_fert_eliminaciones_confirmar(jsonb_build_array(jsonb_build_object('id', vid, 'huella', (select snapshot_huella from fert_eliminaciones where id = vid))));
    if jsonb_array_length(v->'confirmadas') <> 1 then raise exception 'FALLA [%]: confirmar', p_etq; end if;
    v := fn_fert_eliminados_para_agl();
    if not exists (select 1 from jsonb_array_elements(v->'eliminados') e where (e->>'eliminacion_id')::uuid = vid and jsonb_array_length(e->'movimientos') = 1) then
        raise exception 'FALLA [%]: la 120 perdió los movimientos tras confirmar', p_etq; end if;
    delete from fert_eliminaciones where id = vid;
    raise notice 'ok  finales [%]', p_etq;
end $$;
select pg_temp.finales('estado actual');
\i sql/121_fertirriego_auditoria_a_agl.sql
\i sql/121_fertirriego_auditoria_a_agl.sql
select pg_temp.finales('121 repetida');
\i sql/119_fertirriego_eliminar_registros.sql
select pg_temp.finales('121>119');
\i sql/120_fertirriego_eliminados_para_agl.sql
select pg_temp.finales('121>119>120');
\i sql/121_fertirriego_auditoria_a_agl.sql
select pg_temp.finales('121>119>120>121');
\i sql/100_fertirriego_piloto2.sql
\i sql/101_fertirriego_pruebas_en_agl.sql
\i sql/119_fertirriego_eliminar_registros.sql
\i sql/120_fertirriego_eliminados_para_agl.sql
\i sql/121_fertirriego_auditoria_a_agl.sql
select pg_temp.finales('100>101>119>120>121');
select pg_temp.ok((select md5(string_agg(p::text, '|' order by p::text)) from permisos p) = (select v from sv where clave = 'perm'), 'tras todos los órdenes la tabla de permisos es la misma');

select 'FIN 121 OK' as resultado;
