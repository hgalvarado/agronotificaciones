-- =====================================================================
-- PRUEBAS de sql/132 · Inyección: catálogo de objetivos + lotes del catálogo
-- Réplica local con 91–129 (y 130/131 si ya existen) y los datos de prueba de 96/99/115 (E1, Papalon-1, QA-SOLCA).
-- Correr DESDE LA RAÍZ DEL REPO (usa \i):  psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/132_inyeccion_objetivos.sql
-- Al final: 132>132, 129>132 y 129>132>129>132. NO ejecutada todavía.
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('132a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- normalización (mismos casos que las unitarias de TS y Python)
select pg_temp.ok(fn_iny_normalizar_texto('  Ácaro  ') = 'acaro', 'normaliza tildes y espacios');
select pg_temp.ok(fn_iny_normalizar_texto('Mosca blanca') = fn_iny_normalizar_texto('MOSCAS  BLANCAS!'), 'plural simple y signos');
select pg_temp.ok(fn_iny_normalizar_texto('Enfermedades') = fn_iny_normalizar_texto('enfermedad'), '-es en palabras largas');
select pg_temp.ok(fn_iny_normalizar_texto('Hongos') = 'hongo' and fn_iny_normalizar_texto('Trips') = 'trip', '-s en palabras de más de 3 letras');
select pg_temp.ok(fn_iny_normalizar_texto('???') = '', 'solo signos = vacío');
select pg_temp.ok(_iny_norm_lote('1002-010 ') = _iny_norm_lote(' 1002-010') and _iny_norm_lote('1002 - 010') = '1002-010', 'nomenclatura de lote normalizada');

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T132_ADM', 'P132 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T132_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000013201', 'adm@132') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000013201', 'Admin 132', r, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000013201', r) on conflict do nothing;
    -- catálogo de lotes de prueba: L132-1 asignado a la temporada T132; L132-SINTEMP existe pero SIN temporada
    insert into temporadas (nombre, fecha_inicio, fecha_fin, activa) values ('T132-Temp', date '2026-01-01', date '2026-12-31', false) on conflict (nombre) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L132-1', 'Lote prueba 132') on conflict (nomenclatura) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L132-SINTEMP', 'Lote sin temporada 132') on conflict (nomenclatura) do nothing;
    insert into lotes_temporada (lote_id, temporada_id, area_neta)
    select l.id, t.id, 10 from lotes l, temporadas t where l.nomenclatura = 'L132-1' and t.nombre = 'T132-Temp' on conflict (lote_id, temporada_id) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000013201'::uuid as adm;

select pg_temp.como((select adm from k));
do $$
declare v_est uuid := (select est from k);
begin
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 132');
    end if;
    update fert_custodia set desde = now() - interval '2 days' where estacion_id = v_est;
end $$;
select pg_temp.como((select e1 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(1), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'fecha_hora', now() - interval '1 hour', 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 100))))->>'estado')
        like 'ACEPTADO%', 'recepción de partida');

create or replace function pg_temp.apl(p_id uuid, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'aplicacion_lote', jsonb_build_object('estacion_id', (select est from k), 'lote', 'L132-1',
        'temporada', 'T132-Temp', 'area_mz', 5, 'objetivos', jsonb_build_array(jsonb_build_object('nombre', 'Plaga')),
        'fecha_hora', now() - make_interval(days => p_dias_atras),
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 1))) || p_datos, p_dias_atras)
$$;

-- ---------------------------------------------------------------- 1 · catálogo y duplicados
select pg_temp.ok((select count(*) = 5 from iny_objetivos where origen = 'AGL' and revisado and nombre in ('Plaga', 'Maleza', 'Bacteria', 'Enfermedad', 'Hongo')),
                  'las 5 clases viejas quedaron como objetivos AGL ya revisados');
select pg_temp.ok(not exists (select 1 from iny_aplicaciones where objetivo_ids is null), 'toda aplicación vieja quedó con objetivo_ids');
do $$
begin
    begin
        insert into iny_objetivos (nombre, tipo) values ('PLAGAS', 'Plaga');
        raise exception 'FALLA: el índice único dejó duplicar Plagas';
    exception when unique_violation then
        raise notice 'ok  el índice único impide PLAGAS (igual a Plaga)';
    end;
    begin
        insert into iny_objetivos (nombre, tipo) values ('...', 'Otro');
        raise exception 'FALLA: dejó un nombre sin letras';
    exception when others then
        if sqlerrm like 'FALLA%' then raise; end if;
        raise notice 'ok  nombre solo con signos rechazado';
    end;
end $$;

-- ---------------------------------------------------------------- 2 · alta desde el teléfono (con señal)
select pg_temp.como((select e1 from k));
create temp table r1 as select fn_iny_objetivo_agregar('{"nombre":"Ácaro rojo","tipo":"Plaga"}'::jsonb) as r;
select pg_temp.ok((select (r->>'creado')::boolean and r#>>'{objetivo,origen}' = 'CAMPO' and not (r#>>'{objetivo,revisado}')::boolean from r1),
                  'alta nueva: origen CAMPO, por revisar');
create temp table r2 as select fn_iny_objetivo_agregar('{"nombre":" acaros  ROJOS ","tipo":"Maleza"}'::jsonb) as r;
select pg_temp.ok((select not (r->>'creado')::boolean and (r->>'existente')::boolean and r#>>'{objetivo,id}' = (select r#>>'{objetivo,id}' from r1) from r2),
                  'duplicado (plural, mayúsculas, espacios): devuelve el existente y no crea otro');
select pg_temp.ok((select count(*) = 1 from iny_objetivos where nombre_norm = fn_iny_normalizar_texto('acaro rojo')), 'solo un acaro rojo');

-- ---------------------------------------------------------------- 3 · aplicar: objetivos por id y nombre
select pg_temp.como((select e1 from k));
create temp table a1 as select pg_temp.apl(pg_temp.uid(11), jsonb_build_object('objetivos',
    jsonb_build_array(jsonb_build_object('id', (select id from iny_objetivos where nombre = 'Hongo'), 'nombre', 'Hongo'),
                      jsonb_build_object('id', (select r#>>'{objetivo,id}' from r1), 'nombre', 'Ácaro rojo')))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from a1), 'aplicar con 2 objetivos por id: ' || (select r::text from a1));
select pg_temp.ok((select cardinality(objetivo_ids) = 2 and cardinality(objetivos) = 2 and 'Hongo' = any(objetivos) from iny_aplicaciones where id = pg_temp.uid(11)),
                  'guarda ids y nombres');

-- objetivo nuevo creado SIN señal (id del teléfono que aún no existe) = se crea como de campo
create temp table nid as select gen_random_uuid() as id;
create temp table a2 as select pg_temp.apl(pg_temp.uid(12), jsonb_build_object('objetivos',
    jsonb_build_array(jsonb_build_object('id', (select id from nid), 'nombre', 'Gallina ciega', 'tipo', 'Plaga'))), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from a2)
                  and exists (select 1 from iny_objetivos where id = (select id from nid) and origen = 'CAMPO' and not revisado),
                  'objetivo nuevo sin señal: se crea con el id del teléfono, por revisar');
-- otro teléfono manda el MISMO nombre con otro id = se enlaza al existente, no se duplica
create temp table a3 as select pg_temp.apl(pg_temp.uid(13), jsonb_build_object('objetivos',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'nombre', 'Gallinas ciegas', 'tipo', 'Otro'))), 1) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from a3)
                  and (select count(*) = 1 from iny_objetivos where nombre_norm = fn_iny_normalizar_texto('gallina ciega'))
                  and (select objetivo_ids = array[(select id from nid)] from iny_aplicaciones where id = pg_temp.uid(13)),
                  'mismo nombre desde otro teléfono: enlaza al existente');
-- formato viejo (texto) sigue funcionando
create temp table a4 as select pg_temp.apl(pg_temp.uid(14), jsonb_build_object('objetivos', jsonb_build_array('MALEZA'))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from a4) and (select 'Maleza' = any(objetivos) from iny_aplicaciones where id = pg_temp.uid(14)),
                  'objetivos como texto (cola vieja) se resuelven por nombre');
create temp table a5 as select pg_temp.apl(pg_temp.uid(15), jsonb_build_object('objetivos', '[]'::jsonb)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%objetivo%' from a5), 'sin objetivo: rechazada');

-- ---------------------------------------------------------------- 4 · lote del catálogo
create temp table l1 as select pg_temp.apl(pg_temp.uid(21), jsonb_build_object('lote', 'L132-INEXISTENTE')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%no existe en el catálogo de lotes%' from l1), 'lote inexistente: rechazado con mensaje claro');
create temp table l2 as select pg_temp.apl(pg_temp.uid(22), jsonb_build_object('lote', 'L132-SINTEMP')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%no está asignado a la temporada%' from l2), 'lote existente sin temporada: rechazado');
create temp table l3 as select pg_temp.apl(pg_temp.uid(23), jsonb_build_object('lote', ' l132-1 ')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from l3)
                  and (select lote = 'L132-1' and lote_temporada_id is not null from iny_aplicaciones where id = pg_temp.uid(23)),
                  'nomenclatura normalizada: " l132-1 " = L132-1; guarda la canónica y lote_temporada_id');
create temp table l4 as select pg_temp.apl(pg_temp.uid(24), jsonb_build_object('lote', 'L132-1', 'temporada', 'Temp inexistente')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from l4), 'temporada que no existe: rechazado');
select pg_temp.ok((select count(*) = 0 from iny_aplicaciones where id in (pg_temp.uid(21), pg_temp.uid(22), pg_temp.uid(24))), 'lo rechazado no deja aplicación');
select pg_temp.ok((select lote_temporada_id is not null from iny_aplicaciones where id = pg_temp.uid(11)), 'toda aplicación nueva trae lote_temporada_id');

-- ---------------------------------------------------------------- 5 · estado del teléfono
select pg_temp.como((select e1 from k));
select pg_temp.ok(jsonb_array_length(fn_iny_estado_campo()->'objetivos') >= 6 and jsonb_array_length(fn_iny_estado_campo()->'lotes') >= 1
                  and not exists (select 1 from jsonb_array_elements(fn_iny_estado_campo()->'lotes') x where x->>'lote_temporada_id' is null)
                  -- T132-Temp está inactiva y sin plan: por diseño (sql/132 §estado) su lote no va al teléfono
                  and not ((fn_iny_estado_campo()->'lotes') @> '[{"nomenclatura":"L132-1"}]'::jsonb), 'estado: objetivos y lotes del catálogo (temporada activa o del plan)');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_iny_estado_campo()->'aplicaciones') x where x ? 'objetivo_ids' and x->>'id' = pg_temp.uid(11)::text),
                  'estado: aplicaciones con objetivo_ids');

-- ---------------------------------------------------------------- 6 · AGL: exportar, confirmar, publicar y fusionar
select pg_temp.como((select adm from k));
create temp table x1 as select fn_iny_objetivos_exportar() as r;
select pg_temp.ok((select (r->>'cuantos')::int >= 7
                          and exists (select 1 from jsonb_array_elements(r->'objetivos') o
                                       where o->>'nombre' = 'Gallina ciega' and o->>'origen' = 'CAMPO' and not (o->>'revisado')::boolean) from x1),
                  'exportar: trae los de campo por revisar');
select pg_temp.ok(jsonb_array_length(fn_iny_objetivos_confirmar(jsonb_build_object(
        'lote', (select jsonb_agg(jsonb_build_object('id', o->>'id', 'huella', o->>'huella')) from x1, jsonb_array_elements(r->'objetivos') o),
        'cuantos', (select (r->>'cuantos')::int from x1),
        'sha256_lote', (select encode(sha256(convert_to(string_agg(o->>'huella', '|' order by (o->>'id') collate "C"), 'UTF8')), 'hex')
                          from x1, jsonb_array_elements(r->'objetivos') o)))->'rechazadas') = 0,
        'confirmar con huella: nada rechazado');
select pg_temp.ok((fn_iny_objetivos_exportar()->>'cuantos')::int = 0, 'tras confirmar no queda nada por bajar');
do $$ begin
    begin
        perform fn_iny_objetivos_confirmar('{"lote":[{"id":"00000000-0000-0000-0000-000000000001","huella":"y"}],"cuantos":1,"sha256_lote":"malo"}'::jsonb);
        raise exception 'FALLA: aceptó una huella de lote mala';
    exception when sqlstate '22023' then
        raise notice 'ok  huella de lote mala rechazada';
    end;
end $$;

-- publicar: aprobar el de campo, agregar uno de AGL y chocar con un duplicado
create temp table p1 as select fn_iny_publicar(jsonb_build_object('completo', false, 'objetivos', jsonb_build_array(
    jsonb_build_object('id', (select id from nid), 'nombre', 'Gallina ciega', 'tipo', 'Plaga', 'activo', true, 'revisado', true),
    jsonb_build_object('id', gen_random_uuid(), 'nombre', 'Trips', 'tipo', 'Plaga', 'activo', true, 'revisado', true),
    jsonb_build_object('id', gen_random_uuid(), 'nombre', 'GALLINAS CIEGAS', 'tipo', 'Plaga', 'activo', true, 'revisado', true)))) as r;
select pg_temp.ok((select (r->>'objetivos')::int = 2 and jsonb_array_length(r->'avisos_objetivos') = 1
                          and r->'avisos_objetivos'->>0 like '%choca con «Gallina ciega»%' from p1),
                  'publicar: 2 aplicados; el duplicado se omite con aviso que dice con cuál choca');
select pg_temp.ok((select revisado and bajado_a_agl_en is not null from iny_objetivos where id = (select id from nid)), 'publicar: el aprobado queda revisado y ya bajado');
select pg_temp.ok((fn_iny_objetivos_exportar()->>'cuantos')::int = 0, 'lo publicado desde AGL no se vuelve a bajar');

-- fusión: «Ácaro rojo» dentro de «Plaga»
create temp table p2 as select fn_iny_publicar(jsonb_build_object('completo', false, 'objetivos', jsonb_build_array(
    jsonb_build_object('id', (select r#>>'{objetivo,id}' from r1), 'nombre', 'Ácaro rojo', 'tipo', 'Plaga', 'activo', false, 'revisado', true,
                       'fusionado_en', (select id from iny_objetivos where nombre = 'Plaga'))))) as r;
select pg_temp.ok((select (r->>'fusiones')::int = 1 from p2), 'fusión aplicada');
select pg_temp.ok((select (select id from iny_objetivos where nombre = 'Plaga') = any(objetivo_ids)
                          and not ((select r#>>'{objetivo,id}' from r1)::uuid = any(objetivo_ids))
                          and 'Ácaro rojo' <> all(objetivos)
                     from iny_aplicaciones where id = pg_temp.uid(11)), 'la aplicación apunta al destino (ids y nombres)');
select pg_temp.como((select e1 from k));
create temp table f1 as select pg_temp.apl(pg_temp.uid(31), jsonb_build_object('objetivos',
    jsonb_build_array(jsonb_build_object('id', (select r#>>'{objetivo,id}' from r1), 'nombre', 'Ácaro rojo')))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from f1)
                  and (select objetivo_ids = array[(select id from iny_objetivos where nombre = 'Plaga')] from iny_aplicaciones where id = pg_temp.uid(31)),
                  'un reenvío tardío con el objetivo fusionado se redirige al destino');
select pg_temp.como((select adm from k));
select pg_temp.ok((fn_iny_objetivo_agregar('{"nombre":"acaro rojo"}'::jsonb)#>>'{objetivo,nombre}') = 'Plaga', 'agregar un fusionado devuelve el destino vigente');
select pg_temp.ok((fn_iny_exportar()->>'cuantos')::int >= 1, 'fn_iny_exportar (aplicaciones) sigue andando con objetivo_ids');

-- ---------------------------------------------------------------- diagnóstico: filas viejas (129) con lote fuera del catálogo
select 'DIAGNÓSTICO · aplicaciones con lote_temporada_id null (lote fuera del catálogo o sin temporada)' as aviso;
select a.id, a.lote, a.temporada, a.fecha,
       exists (select 1 from lotes l where _iny_norm_lote(l.nomenclatura) = _iny_norm_lote(a.lote)) as lote_existe
  from iny_aplicaciones a
 where a.lote_temporada_id is null
 order by a.fecha desc;

-- ---------------------------------------------------------------- órdenes de corrida
create or replace function pg_temp.final(p_etiqueta text) returns void language plpgsql as $$
begin
    perform pg_temp.como((select adm from k));
    perform pg_temp.ok(position('_iny_resolver_objetivos(' in pg_get_functiondef('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)'::regprocedure)) > 0
                       and position('132:lote' in pg_get_functiondef('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)'::regprocedure)) > 0,
                       p_etiqueta || ': la operación quedó parchada');
    perform pg_temp.ok(position('_iny_publicar_objetivos(' in pg_get_functiondef('public.fn_iny_publicar(jsonb)'::regprocedure)) > 0
                       and position('_iny_objetivos_campo(' in pg_get_functiondef('public.fn_iny_estado_campo(date)'::regprocedure)) > 0
                       and position('objetivo_ids' in pg_get_functiondef('public._iny_fila(public.iny_aplicaciones)'::regprocedure)) > 0,
                       p_etiqueta || ': publicar, estado y huella parchados');
    perform pg_temp.ok((select count(*) = 1 from iny_objetivos where nombre_norm = 'plaga'), p_etiqueta || ': sin duplicados sembrados');
end $$;
create or replace function pg_temp.ciclo(p_etiqueta text, p_n integer) returns void language plpgsql as $$
declare v_r jsonb;
begin
    perform pg_temp.como((select e1 from k));
    v_r := pg_temp.apl(pg_temp.uid(p_n), jsonb_build_object('objetivos', jsonb_build_array(jsonb_build_object('nombre', 'Hongo'))));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: aplicar: %', p_etiqueta, v_r; end if;
    v_r := pg_temp.apl(pg_temp.uid(p_n + 1), jsonb_build_object('lote', 'NO-EXISTE-132'));
    if v_r->>'estado' <> 'RECHAZADO' then raise exception 'FALLA [%]: lote inexistente aceptado', p_etiqueta; end if;
    perform pg_temp.final(p_etiqueta);
end $$;

select pg_temp.final('estado actual');
\i sql/132_inyeccion_objetivos.sql
select pg_temp.ciclo('132>132', 100);
\i sql/129_campo_inyeccion_por_lote.sql
-- (tras re-correr la 129 la operación vuelve a la lista cerrada: la 132 debe correrse otra vez)
select pg_temp.ok(position('_iny_resolver_objetivos(' in pg_get_functiondef('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)'::regprocedure)) = 0,
                  '129 repetida: queda la versión base (esperado)');
\i sql/132_inyeccion_objetivos.sql
select pg_temp.ciclo('129>132', 110);
\i sql/129_campo_inyeccion_por_lote.sql
\i sql/132_inyeccion_objetivos.sql
select pg_temp.ciclo('129>132>129>132', 120);

select 'FIN 132 OK' as resultado;
