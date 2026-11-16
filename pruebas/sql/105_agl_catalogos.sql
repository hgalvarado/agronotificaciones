-- =====================================================================
-- PRUEBAS de sql/105 · AGL publica zonas, temporadas, estaciones y turnos (vista previa + publicar)
-- Réplica local: copia de un clon de PRODUCCIÓN (prodall = producción + 99..104, opcional 109/110) + la 105,
-- SIN ninguna publicación de catálogos todavía. Correr desde la raíz del repo (lee pruebas/sql/105_paquete_agl.json:
-- los catálogos de AGL de producción del 2026-11-14 con correos y teléfonos quitados).
--   psql -h localhost -p 5499 -U postgres -d <base> -f pruebas/sql/105_agl_catalogos.sql
-- Cada bloque corre dentro de una transacción que se deshace: la base queda como estaba.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
\set paquete `cat pruebas/sql/105_paquete_agl.json`

-- Personas de prueba: administrador y alguien sin permisos de la conexión AGL (se quedan; son de la réplica)
do $$
declare r smallint; n smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T105_ADM', 'P105 Admin', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, acceso_total) values ('T105_NADA', 'P105 Sin permisos', false) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T105_ADM';
    select id into n from roles where codigo = 'T105_NADA';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000010501', 'adm@105'),
                                              ('00000000-0000-0000-0000-000000010502', 'nada@105') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000010501', 'Admin 105', r, true),
        ('00000000-0000-0000-0000-000000010502', 'Nada 105', n, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000010501', r), ('00000000-0000-0000-0000-000000010502', n) on conflict do nothing;
end $$;

create table if not exists public.qa105_paquete (j jsonb);
truncate public.qa105_paquete;
insert into public.qa105_paquete values (:'paquete');

create or replace function public.qa105_ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
    if p_cond is distinct from true then raise exception 'FALLA: %', p_msg; end if;
    raise notice 'ok  %', p_msg;
end $$;
create or replace function public.qa105_como(p text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(p, ''), false) $$;
create or replace function public.qa105_pq(p_extra jsonb default '{}') returns jsonb language sql as
$$ select j || p_extra from public.qa105_paquete $$;
/** Cuántas filas del informe tienen ese catálogo y esa acción. */
create or replace function public.qa105_n(r jsonb, p_cat text, p_acc text) returns integer language sql as
$$ select coalesce((r->'resumen'->p_cat->>p_acc)::integer, 0) $$;
/** La fila del informe de un catálogo por nombre (como queda o como estaba). */
create or replace function public.qa105_fila(r jsonb, p_cat text, p_nombre text) returns jsonb language sql as
$$ select x from jsonb_array_elements(r->'cambios') x
   where x->>'catalogo' = p_cat and (x->>'nombre' = p_nombre or x->>'nombre_local' = p_nombre) limit 1 $$;
/** Publica de verdad: vista previa y luego publicar con su huella. */
create or replace function public.qa105_publicar(p jsonb) returns jsonb language plpgsql as $$
declare v jsonb := public.fn_agl_publicar_catalogos(p || '{"simular": true}');
begin
    return public.fn_agl_publicar_catalogos(p || jsonb_build_object('simular', false, 'huella', v->>'huella'));
end $$;
/** Huella de una tabla entera (para ver que la vista previa no escribe). */
create or replace function public.qa105_foto() returns text language sql as $$
    select md5(concat_ws('|',
        (select string_agg(t::text, ',' order by id) from zonas t),
        (select string_agg(t::text, ',' order by id) from temporadas t),
        (select string_agg(t::text, ',' order by id) from estaciones_riego t),
        (select string_agg(t::text, ',' order by id) from turnos t),
        (select string_agg(t::text, ',' order by id) from historial_tasas_temporada t),
        (select string_agg(t::text, ',' order by perfil_id, zona_id) from perfiles_zonas t),
        (select count(*)::text from seguridad.agl_publicaciones)))
$$;

\set ADM '00000000-0000-0000-0000-000000010501'
\set NADA '00000000-0000-0000-0000-000000010502'
set client_min_messages = notice;

-- ------------------------------------------------------------------
-- 0 · Estructura
-- ------------------------------------------------------------------
select qa105_ok((select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'agl_id'
                   and table_name in ('zonas', 'temporadas', 'estaciones_riego', 'turnos')) = 4, 'agl_id en las 4 tablas');
select qa105_ok(to_regclass('public.agl_publicaciones') is null and to_regclass('seguridad.agl_publicaciones') is not null,
                'bitácora en el esquema seguridad (no en public)');
select qa105_ok(to_regclass('respaldo.zonas_m105') is not null and to_regclass('respaldo.estaciones_riego_m105') is not null
                and to_regclass('respaldo.turnos_m105') is not null and to_regclass('respaldo.temporadas_m105') is not null,
                'respaldo de las 4 tablas');
select qa105_ok((select count(*) from respaldo.estaciones_riego_m105) = (select count(*) from estaciones_riego where agl_id is null or true),
                'respaldo de estaciones completo');
select qa105_ok(exists (select 1 from pantallas where codigo = 'catalogos_agl' and acciones = array['ver', 'publicar']),
                'pantalla de permisos catalogos_agl');
select qa105_ok(pg_get_functiondef('public.fn_fert_publicar(jsonb)'::regprocedure) like '%105: primero por el id de AGL%'
                and pg_get_functiondef('public.fn_fert_publicar(jsonb)'::regprocedure) like '%activo = (turnos_ciclo.archivado_at is null)%',
                'Publicar a campo: parche 105 y conserva el de la 102');
select qa105_ok(not exists (select 1 from materiales where codigo = ' 100019')
                or exists (select 1 from materiales where codigo = '100019'), 'material « 100019» corregido o en espera (si hay dos)');
select qa105_ok(public._agl_parecido('Papalon-1', 'Papalon-2') = 0, 'parecido: números distintos = 0');
select qa105_ok(public._agl_parecido('Sierra', 'Sierra Alta') >= 0.5, 'parecido: Sierra ~ Sierra Alta');
select qa105_ok(public._agl_parecido('Zona-1', 'zona 1') = 1, 'parecido: mismo nombre normalizado = 1');

-- ------------------------------------------------------------------
-- 1 · Permisos
-- ------------------------------------------------------------------
begin;
select qa105_como(:'NADA');
do $$ begin
    perform public.fn_agl_publicar_catalogos(public.qa105_pq());
    raise exception 'FALLA: sin permiso pudo ver la vista previa';
exception when insufficient_privilege then raise notice 'ok  sin «Catálogos · Conexión AGL» no hay vista previa';
end $$;
select qa105_como(null);
do $$ begin
    perform public.fn_agl_publicar_catalogos(public.qa105_pq());
    raise exception 'FALLA: sin sesión respondió';
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'ok  sin sesión: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------------
-- 2 · Vista previa con los catálogos de AGL de producción
-- ------------------------------------------------------------------
begin;
select qa105_como(:'ADM');
create temp table f0 as select qa105_foto() f;
create temp table v as select public.fn_agl_publicar_catalogos(qa105_pq()) r;
select qa105_ok((select f from f0) = qa105_foto(), 'la vista previa NO escribe nada');
select qa105_ok((select r->>'simulado' from v) = 'true', 'por defecto simula');
select qa105_ok(qa105_n(r, 'zonas', 'actualizar') = 4 and qa105_n(r, 'zonas', 'desactivar') = 3 and qa105_n(r, 'zonas', 'crear') = 0,
                'zonas: 4 se emparejan y actualizan, 3 se desactivan, ninguna nueva') from v;
select qa105_ok((select string_agg(x->>'nombre', ',' order by x->>'nombre') from jsonb_array_elements(r->'cambios') x
                 where x->>'catalogo' = 'zonas' and x->>'accion' = 'desactivar') = 'Zona 2B,Zona 2C,Zona 3C',
                'se desactivan Zona 2B, 2C y 3C') from v;
select qa105_ok(qa105_fila(r, 'zonas', 'Zona 1')->>'nombre' = 'Zona-1' and qa105_fila(r, 'zonas', 'Zona 1')->>'por' = 'nombre',
                'Zona 1 ↔ Zona-1 (por nombre normalizado), toma el nombre de AGL') from v;
select qa105_ok(qa105_fila(r, 'zonas', 'Zona 3A')->'despues'->>'responsable' = 'Osman Galindo', 'responsable de AGL (Osman Galindo)') from v;
select qa105_ok(qa105_fila(r, 'zonas', 'Zona 2A')->'despues'->>'correo_electronico' = 'marcoreyes@agrolibano.com',
                'correo vacío en AGL no borra el de aquí') from v;
select qa105_ok(qa105_fila(r, 'zonas', 'Zona 2C')->>'motivo' like '%David Vasquez%', 'aviso: quién tiene asignada la zona 2C') from v;
select qa105_ok(qa105_n(r, 'temporadas', 'actualizar') = 3 and qa105_n(r, 'temporadas', 'crear') = 0, 'temporadas: 3 emparejadas') from v;
select qa105_ok(not exists (select 1 from jsonb_array_elements(r->'cambios') x where x->>'catalogo' = 'tasas'),
                'tasa 27.35 igual a la vigente: no se agrega') from v;
select qa105_ok(qa105_n(r, 'estaciones', 'actualizar') = 17 and qa105_n(r, 'estaciones', 'crear') = 0
                and qa105_n(r, 'estaciones', 'desactivar') = 0, 'estaciones: las 17 se emparejan por nombre') from v;
select qa105_ok(qa105_n(r, 'turnos', 'actualizar') = 124 and qa105_n(r, 'turnos', 'desactivar') = 8 and qa105_n(r, 'turnos', 'crear') = 0,
                'turnos: 124 emparejados, 8 sub-turnos se desactivan') from v;
select qa105_ok((select count(*) from jsonb_array_elements(r->'cambios') x
                 where x->>'catalogo' = 'turnos' and x->'campos' ? 'zona_id' and x->'antes'->>'zona' = 'Zona 3C'
                   and x->'despues'->>'zona' = 'Zona-3B') = 9, 'los 9 turnos de 3C pasan a 3B') from v;
select qa105_ok(length(r->>'huella') = 32, 'trae huella') from v;
rollback;

-- ------------------------------------------------------------------
-- 3 · Publicar: huella obligatoria, ids intactos, idempotente
-- ------------------------------------------------------------------
begin;
select qa105_como(:'ADM');
create temp table ids0 as
    select 'z' t, id, nombre from zonas union all select 'e', id, nombre from estaciones_riego
    union all select 't', id, codigo from turnos union all select 'm', id, nombre from temporadas;
create temp table pz0 as select * from perfiles_zonas;
create temp table pe0 as select * from perfiles_estaciones;
do $$ begin
    perform public.fn_agl_publicar_catalogos(public.qa105_pq('{"simular": false}'));
    raise exception 'FALLA: publicó sin huella';
exception when invalid_parameter_value then raise notice 'ok  sin huella no publica';
end $$;
do $$ begin
    perform public.fn_agl_publicar_catalogos(public.qa105_pq('{"simular": false, "huella": "otra"}'));
    raise exception 'FALLA: publicó con otra huella';
exception when raise_exception then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'ok  huella distinta: %', sqlerrm;
end $$;
create temp table p1 as select qa105_publicar(qa105_pq()) r;
select qa105_ok((select r->>'publicacion' from p1) is not null, 'publicó y anotó en la bitácora');
select qa105_ok((select count(*) from ids0 i where not exists (
                    select 1 from zonas where id = i.id union all select 1 from estaciones_riego where id = i.id
                    union all select 1 from turnos where id = i.id union all select 1 from temporadas where id = i.id)) = 0,
                'ningún id cambió ni se borró');
select qa105_ok((select count(*) from zonas) = 7 and (select count(*) from estaciones_riego) = 17
                and (select count(*) from turnos) = 132 and (select count(*) from temporadas) = 3, 'nada creado de más');
select qa105_ok((select string_agg(nombre, ',' order by nombre) from zonas where activo) = 'Zona-1,Zona-2A,Zona-3A,Zona-3B',
                'zonas activas = las 4 de AGL con su nombre');
select qa105_ok((select count(*) from zonas where not activo) = 3, '2B, 2C, 3C inactivas (no borradas)');
select qa105_ok((select count(*) from turnos where not activo) = 8
                and (select count(*) from turnos t join zonas z on z.id = t.zona_id where z.nombre = 'Zona-3B') = 49,
                '8 sub-turnos inactivos; 3B con sus 40 + los 9 de 3C');
select qa105_ok((select count(*) from estaciones_riego where zona_id is null) = 0
                and (select count(*) from estaciones_riego where agl_id is null) = 0, 'estaciones con zona y id de AGL');
select qa105_ok((select nombre from temporadas where activa) = 'Temporada 2026-2027', 'la activa sigue siendo 2026-2027');
select qa105_ok((select count(*) from perfiles_zonas) = (select count(*) from pz0)
                and not exists (select * from pz0 except select * from perfiles_zonas), 'perfiles_zonas intacto');
select qa105_ok(not exists (select * from pe0 except select * from perfiles_estaciones)
                and (select count(*) from pe0) = (select count(*) from perfiles_estaciones), 'perfiles_estaciones intacto');
select qa105_ok((select jsonb_array_length(cambios) from seguridad.agl_publicaciones order by id desc limit 1) = 4 + 3 + 3 + 17 + 124 + 8,
                'la bitácora guarda cada fila tocada');
select qa105_ok((select c->'antes'->>'nombre' from seguridad.agl_publicaciones p, jsonb_array_elements(p.cambios) c
                 where c->>'catalogo' = 'zonas' and c->'despues'->>'nombre' = 'Zona-1' order by p.id desc limit 1) = 'Zona 1',
                'la bitácora guarda «antes» (para deshacer)');
create temp table v2 as select public.fn_agl_publicar_catalogos(qa105_pq()) r;
select qa105_ok((select count(*) from jsonb_array_elements(r->'cambios') x where x->>'accion' <> 'sin_cambios') = 0,
                'segunda vista previa: todo sin cambios') from v2;
create temp table p2 as select qa105_publicar(qa105_pq()) r;
select qa105_ok((select count(*) from seguridad.agl_publicaciones) = 2, 'publicar otra vez no cambia nada (idempotente)');
select qa105_ok((select jsonb_array_length(cambios) from seguridad.agl_publicaciones order by id desc limit 1) = 0, '… y no toca filas');
-- Un cambio de nombre en AGL renombra (por id), no duplica
create temp table p3 as select qa105_publicar(
    jsonb_set(qa105_pq(), '{estaciones}',
        (select jsonb_agg(case when x->>'nombre' = 'Sierra' then x || '{"nombre": "Sierra Sur"}' else x end) from jsonb_array_elements(qa105_pq()->'estaciones') x))) r;
select qa105_ok((select id from estaciones_riego where nombre = 'Sierra Sur') = (select id from ids0 where t = 'e' and nombre = 'Sierra'),
                'AGL renombra Sierra → Sierra Sur: misma fila (mismo id)');
select qa105_ok((select count(*) from estaciones_riego) = 17, '… sin duplicar');
-- Choque de nombre: AGL llama «Zona 2B» a Zona-1: no se renombra, se avisa
create temp table v4 as select public.fn_agl_publicar_catalogos(jsonb_set(qa105_pq(), '{zonas}',
    (select jsonb_agg(case when x->>'nombre' = 'Zona-1' then x || '{"nombre": "Zona 2B"}' else x end) from jsonb_array_elements(qa105_pq()->'zonas') x))) r;
select qa105_ok(qa105_fila(r, 'zonas', 'Zona-1')->>'motivo' like 'Ya existe otra «Zona 2B»%'
                and qa105_fila(r, 'zonas', 'Zona-1')->'despues'->>'nombre' = 'Zona-1', 'choque de nombre: se avisa y no se renombra') from v4;
-- Publicar a campo con agl_id: renombra por id; sin agl_id (AGL viejo) cruza por nombre como siempre
select fn_fert_publicar(jsonb_build_object('estaciones', jsonb_build_array(jsonb_build_object(
    'nombre', 'Sierra Centro', 'zona', 'Zona-3B', 'agl_id', (select agl_id from estaciones_riego where nombre = 'Sierra Sur')))));
select qa105_ok((select id from estaciones_riego where nombre = 'Sierra Centro') = (select id from ids0 where t = 'e' and nombre = 'Sierra')
                and (select count(*) from estaciones_riego) = 17, 'Publicar a campo: renombra por agl_id, no duplica');
select fn_fert_publicar('{"estaciones": [{"nombre": "Vega", "zona": "Zona-1"}]}');
select qa105_ok((select count(*) from estaciones_riego) = 17, 'Publicar a campo sin agl_id: cruza por nombre');
rollback;

-- ------------------------------------------------------------------
-- 4 · Las 4 estaciones: parecido, dudosa, elegida, nueva y protecciones
-- ------------------------------------------------------------------
begin;
select qa105_como(:'ADM');
-- Bodega con producto, custodio, turno publicado, persona asignada y una estación de prueba
insert into fert_saldos (estacion_id, material_id, disponible) select (select id from estaciones_riego where nombre = 'Carretales'), (select id from materiales limit 1), 5;
insert into fert_custodia (estacion_id, custodio_id, estado, desde)
    select (select id from estaciones_riego where nombre = 'Congolon'), :'ADM', 'ACTIVA', now();
insert into turnos_ciclo (agl_id, turno_id, temporada, estacion_id, activo)
    select 'QA105-TC', (select id from turnos where codigo = 'T1003-T01'), 'Temporada 2026-2027', (select id from estaciones_riego where nombre = 'Embarcadero'), true;
insert into perfiles_estaciones (perfil_id, estacion_id) select :'ADM', (select id from estaciones_riego where nombre = 'Rubio');
insert into estaciones_riego (nombre, zona_id, prueba_de) select 'PRUEBA · Glorieta', zona_id, id from estaciones_riego where nombre = 'Glorieta';
create temp table e4 (x jsonb);
insert into e4 values (jsonb_build_array(
    jsonb_build_object('agl_id', 'N1', 'nombre', 'Papalon', 'zona', 'Zona-2A'),
    jsonb_build_object('agl_id', 'N2', 'nombre', 'Sierra Alta', 'zona', 'Zona-3B'),
    (select x from jsonb_array_elements(qa105_pq()->'estaciones') x where x->>'nombre' = 'Vega'),
    jsonb_build_object('agl_id', 'N4', 'nombre', 'Estacion Nueva', 'zona', 'Zona-1')));
create temp table v as select public.fn_agl_publicar_catalogos(jsonb_set(qa105_pq(), '{estaciones}', (select x from e4))) r;
select qa105_ok(qa105_fila(r, 'estaciones', 'Sierra Alta')->>'por' = 'parecido'
                and qa105_fila(r, 'estaciones', 'Sierra Alta')->>'nombre_local' = 'Sierra', 'Sierra Alta ↔ Sierra (por parecido)') from v;
select qa105_ok(qa105_fila(r, 'estaciones', 'Vega')->>'por' = 'nombre', 'Vega ↔ Vega') from v;
select qa105_ok(qa105_fila(r, 'estaciones', 'Papalon')->>'por' = 'dudosa'
                and jsonb_array_length(qa105_fila(r, 'estaciones', 'Papalon')->'candidatos') = 3,
                'Papalon: dudosa entre Papalon-1/2/3 (3 candidatos)') from v;
select qa105_ok(qa105_fila(r, 'estaciones', 'Estacion Nueva')->>'accion' = 'crear', 'Estacion Nueva se crea') from v;
select qa105_ok(qa105_fila(r, 'estaciones', 'Carretales')->>'accion' = 'protegida'
                and qa105_fila(r, 'estaciones', 'Carretales')->>'motivo' like '%producto en bodega%', 'Carretales con producto: protegida') from v;
select qa105_ok(qa105_fila(r, 'estaciones', 'Congolon')->>'motivo' like '%custodio%', 'Congolon con custodio: protegida') from v;
select qa105_ok(qa105_fila(r, 'estaciones', 'Embarcadero')->>'motivo' like '%turno(s) publicados%', 'Embarcadero con turno publicado: protegida') from v;
select qa105_ok(qa105_fila(r, 'estaciones', 'Rubio')->>'accion' = 'desactivar'
                and qa105_fila(r, 'estaciones', 'Rubio')->>'motivo' like '%persona(s) asignada(s)%', 'Rubio: se desactiva con aviso de personas') from v;
select qa105_ok(qa105_fila(r, 'estaciones', 'Glorieta')->>'motivo' like '%estación de prueba%', 'Glorieta: aviso de su estación de prueba') from v;
select qa105_ok(qa105_fila(r, 'estaciones', 'PRUEBA · Glorieta') is null, 'la estación de prueba no aparece ni se toca') from v;
select qa105_ok(qa105_n(r, 'estaciones', 'desactivar') = 12 and qa105_n(r, 'estaciones', 'protegida') = 3,
                '17 − Sierra − Vega = 15 sin AGL: 12 se desactivan, 3 protegidas') from v;
select qa105_ok((r->>'avisos') like '%dudoso%', 'aviso de emparejamiento dudoso') from v;
do $$ begin
    perform public.qa105_publicar(jsonb_set(public.qa105_pq(), '{estaciones}', (select x from e4)));
    raise exception 'FALLA: publicó con una estación dudosa';
exception when invalid_parameter_value then raise notice 'ok  con una estación dudosa no publica';
end $$;
select qa105_ok(qa105_fila(r, 'estaciones', 'Estacion Nueva')->>'por' = 'dudosa', 'Estacion Nueva: dudosa (Estacion-A/B/C igual de parecidas)') from v;
-- El usuario elige Papalon-1 para «Papalon» y «Crear nueva» para «Estacion Nueva»
update e4 set x = jsonb_set(jsonb_set(x, '{0,local_id}', to_jsonb((select id from estaciones_riego where nombre = 'Papalon-1')::text)),
                            '{3,local_id}', '"nueva"');
create temp table ids4 as select id, nombre from estaciones_riego;
create temp table p4 as select qa105_publicar(jsonb_set(qa105_pq(), '{estaciones}', (select x from e4))) r;
select qa105_ok((select nombre from estaciones_riego where id = (select id from ids4 where nombre = 'Papalon-1')) = 'Papalon',
                'elegida: Papalon-1 pasa a llamarse Papalon (mismo id)');
select qa105_ok((select nombre from estaciones_riego where id = (select id from ids4 where nombre = 'Sierra')) = 'Sierra Alta',
                'Sierra pasa a Sierra Alta (mismo id)');
select qa105_ok((select count(*) from estaciones_riego where activo and prueba_de is null) = 4 + 3,
                'quedan activas las 4 de AGL + las 3 protegidas');
select qa105_ok((select activo from estaciones_riego where nombre = 'PRUEBA · Glorieta'), 'la estación de prueba sigue activa');
select qa105_ok((select count(*) from estaciones_riego) = 17 + 1 + 1, 'nada se borró (17 + prueba + la nueva)');
select qa105_ok((select z.nombre from estaciones_riego e join zonas z on z.id = e.zona_id where e.nombre = 'Estacion Nueva') = 'Zona-1',
                'la nueva con su zona de AGL');
rollback;

-- ------------------------------------------------------------------
-- 5 · Temporadas: una sola activa, cambio de activa, tasa nueva
-- ------------------------------------------------------------------
begin;
select qa105_como(:'ADM');
do $$ begin
    perform public.fn_agl_publicar_catalogos(jsonb_set(public.qa105_pq(), '{temporadas}',
        (select jsonb_agg(x || '{"activa": true}') from jsonb_array_elements(public.qa105_pq()->'temporadas') x)));
    raise exception 'FALLA: aceptó dos activas';
exception when invalid_parameter_value then raise notice 'ok  dos «Activa» en AGL: se detiene';
end $$;
create temp table p5 as select qa105_publicar(jsonb_set(qa105_pq(), '{temporadas}',
    (select jsonb_agg(case x->>'nombre'
                         when 'Temporada 2026-2027' then x || '{"activa": false, "tasa_cambio_usd": 27.50}'
                         when 'Temporada 2027-2028' then x || '{"activa": true}' else x end)
     from jsonb_array_elements(qa105_pq()->'temporadas') x))) r;
select qa105_ok((select string_agg(nombre, ',') from temporadas where activa) = 'Temporada 2027-2028', 'la activa pasa a 2027-2028 (una sola)');
select qa105_ok((select count(*) from historial_tasas_temporada h join temporadas t on t.id = h.temporada_id
                 where t.nombre = 'Temporada 2026-2027') = 2, 'tasa distinta: una vigencia más');
select qa105_ok((select tasa_hnl_usd from historial_tasas_temporada h join temporadas t on t.id = h.temporada_id
                 where t.nombre = 'Temporada 2026-2027' order by h.fecha_inicio limit 1) = 27.35, 'la vigencia anterior no cambia');
select qa105_ok((select h.fecha_inicio from historial_tasas_temporada h join temporadas t on t.id = h.temporada_id
                 where t.nombre = 'Temporada 2026-2027' order by h.fecha_inicio desc limit 1)
                = greatest((now() at time zone 'America/Tegucigalpa')::date, '2026-08-01'), 'la nueva rige desde hoy (UTC-6)');
-- AGL sin ninguna activa: no se cambia cuál es la activa
create temp table v5 as select public.fn_agl_publicar_catalogos(jsonb_set(qa105_pq(), '{temporadas}',
    (select jsonb_agg(x || '{"activa": false}') from jsonb_array_elements(qa105_pq()->'temporadas') x))) r;
select qa105_ok((r->>'avisos') like '%ninguna temporada «Activa»%', 'AGL sin activa: aviso') from v5;
select qa105_ok(qa105_fila(r, 'temporadas', 'Temporada 2027-2028')->'despues'->>'activa' = 'true', '… y la de aquí sigue activa') from v5;
rollback;

-- ------------------------------------------------------------------
-- 6 · Zonas: una persona que solo tiene la zona que se va la protege
-- ------------------------------------------------------------------
begin;
select qa105_como(:'ADM');
delete from perfiles_zonas where zona_id = (select id from zonas where nombre = 'Zona 3B')
   and perfil_id in (select perfil_id from perfiles_zonas where zona_id = (select id from zonas where nombre = 'Zona 3C'));
create temp table v6 as select public.fn_agl_publicar_catalogos(qa105_pq()) r;
select qa105_ok(qa105_fila(r, 'zonas', 'Zona 3C')->>'accion' = 'protegida'
                and qa105_fila(r, 'zonas', 'Zona 3C')->>'motivo' like '%solo tienen esta zona%', 'zona 3C protegida: alguien solo tiene esa') from v6;
-- Una zona con turnos que AGL no mueve queda protegida
create temp table v7 as select public.fn_agl_publicar_catalogos(jsonb_set(qa105_pq(), '{turnos}',
    (select jsonb_agg(x) from jsonb_array_elements(qa105_pq()->'turnos') x where x->>'codigo' not like 'T1003-T5%'))) r;
select qa105_ok(qa105_fila(r, 'turnos', 'T1003-T50')->>'accion' = 'desactivar', 'turno que AGL ya no tiene: se desactiva') from v7;
rollback;

-- ------------------------------------------------------------------
-- 7 · Sin «completo» no se desactiva nada; paquete con repetidos se rechaza
-- ------------------------------------------------------------------
begin;
select qa105_como(:'ADM');
create temp table v8 as select public.fn_agl_publicar_catalogos(qa105_pq('{"completo": false}')) r;
select qa105_ok((select count(*) from jsonb_array_elements(r->'cambios') x where x->>'accion' in ('desactivar', 'protegida')) = 0,
                'sin «completo»: no se desactiva nada') from v8;
create temp table v9 as select public.fn_agl_publicar_catalogos(qa105_pq('{"estaciones": []}')) r;
select qa105_ok(qa105_n(r, 'estaciones', 'desactivar') = 0, 'lista de estaciones vacía: no se desactiva ninguna') from v9;
create temp table v10 as select public.fn_agl_publicar_catalogos(jsonb_build_object('completo', true, 'zonas', qa105_pq()->'zonas')) r;
select qa105_ok(qa105_n(r, 'turnos', 'desactivar') = 0 and qa105_n(r, 'estaciones', 'desactivar') = 0
                and qa105_n(r, 'zonas', 'protegida') = 1 and qa105_n(r, 'zonas', 'desactivar') = 2,
                'solo zonas: no toca turnos ni estaciones; 3C (sus turnos no se mueven) protegida, 2B y 2C se desactivan') from v10;
do $$ begin
    perform public.fn_agl_publicar_catalogos(jsonb_set(public.qa105_pq(), '{zonas}',
        (public.qa105_pq()->'zonas') || jsonb_build_array((public.qa105_pq()->'zonas'->0) || '{"agl_id": "otro"}')));
    raise exception 'FALLA: aceptó repetidos';
exception when invalid_parameter_value then raise notice 'ok  zonas repetidas en AGL: se rechaza';
end $$;
rollback;

select qa105_como(null);
drop function public.qa105_ok(boolean, text), public.qa105_como(text), public.qa105_pq(jsonb), public.qa105_n(jsonb, text, text),
              public.qa105_fila(jsonb, text, text), public.qa105_publicar(jsonb), public.qa105_foto();
drop table public.qa105_paquete;
\echo '105: TODAS LAS PRUEBAS PASARON'
