-- =====================================================================
-- 132 · INYECCIÓN · CATÁLOGO DE OBJETIVOS (lo registra AGL, el campo puede agregar) + LOTES DEL CATÁLOGO
-- =====================================================================
-- Pedido del usuario (2026-11-22): «los objetivos los registro yo en AGL y le doy la opción al usuario de registrar
-- más, sin limitarlos, y que no se duplique un objetivo». Y: «el lote tiene que venir de los lotes registrados en el
-- catálogo de lotes, no inventar ni crear otra lista».
--
--   (a) public.iny_objetivos: id, nombre, tipo (clasificación libre: Plaga, Maleza, Bacteria…), origen 'AGL'|'CAMPO',
--       activo, revisado (lo de campo entra revisado = false: «por revisar» en AGL), fusionado_en (apunta al objetivo
--       que lo reemplaza), creado_por/creado_en y nombre_norm con índice ÚNICO (impide duplicados en la base).
--       Normalización (idéntica en SQL, TypeScript y Python): minúsculas, sin tildes, sin signos, espacios colapsados y
--       singular/plural simple por palabra (-es si la palabra tiene más de 4 letras; -s si tiene más de 3).
--       Las 5 clases de la 129 (PLAGA, MALEZA, BACTERIA, ENFERMEDAD, HONGO) se siembran como objetivos de origen AGL.
--   (b) iny_aplicaciones.objetivo_ids (uuid[]): los objetivos elegidos por id; `objetivos` (text[]) queda con los
--       NOMBRES. Se quita el check de lista cerrada de la 129. Las filas viejas se mapean por nombre (no se pierde nada).
--   (c) _iny_op_aplicacion_lote (parchada, marca 132): objetivos por id y nombre (un objetivo desconocido que llega de
--       la cola sin señal se crea como de campo o se enlaza al ya existente por nombre normalizado, nunca se duplica;
--       uno fusionado se redirige al destino) y LOTE del catálogo (public.lotes + lotes_temporada de la temporada):
--       lote inexistente o sin asignar a la temporada = RECHAZADO con mensaje claro; se guarda la nomenclatura
--       canónica y lote_temporada_id siempre resuelto.
--   (d) fn_iny_objetivo_agregar (teléfono, con señal): alta con detección de duplicado, devuelve el existente.
--   (e) AGL: fn_iny_publicar (parchada) reconcilia `objetivos` (con fusiones); fn_iny_objetivos_exportar /
--       fn_iny_objetivos_confirmar bajan lo nuevo/cambiado con huella (patrón de la 129).
--   (f) fn_iny_estado_campo (parchada) trae `objetivos`, `lotes` y `objetivo_ids` de cada aplicación; _iny_fila suma
--       objetivo_ids a la huella solo cuando existe.
--
-- Correr DESPUÉS de la 129. Idempotente. Todo UPDATE/DELETE lleva WHERE. Si se vuelve a correr la 129 (redefine
-- _iny_op_aplicacion_lote, fn_iny_publicar, fn_iny_estado_campo y _iny_fila), CORRER LA 132 OTRA VEZ. Las marcas de los
-- parches son propias de la 132 (otras migraciones no las usan). Las filas viejas de la 129 con lote que no está en el
-- catálogo quedan con lote_temporada_id null (consulta de diagnóstico al final de pruebas/sql/132_*.sql).
-- =====================================================================

do $$
begin
    if to_regclass('public.iny_aplicaciones') is null or to_regprocedure('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)') is null then
        raise exception '132: falta correr la 129 antes.';
    end if;
end $$;


-- ---------------------------------------------------------------- normalización (misma regla en TS y Python)
create or replace function public.fn_iny_normalizar_texto(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
    select coalesce(array_to_string(array(
        select case when length(w) > 4 and w like '%es' then left(w, length(w) - 2)
                    when length(w) > 3 and w like '%s'  then left(w, length(w) - 1)
                    else w end
          from regexp_split_to_table(
                 btrim(regexp_replace(translate(lower(translate(coalesce(p, ''), 'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'AAAAAEEEEIIIIOOOOOUUUUNC')),
                       'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'), '[^a-z0-9]+', ' ', 'g')), ' ')
               with ordinality as t(w, n)
         where w <> ''
         order by n), ' '), '')
$$;

/** Nomenclatura de lote normalizada: sin espacios y en minúsculas («1002-010 » = «1002-010»). */
create or replace function public._iny_norm_lote(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
    select lower(regexp_replace(coalesce(p, ''), '\s+', '', 'g'))
$$;


-- ---------------------------------------------------------------- (a) tabla de objetivos
create table if not exists public.iny_objetivos (
    id               uuid primary key default gen_random_uuid(),
    nombre           text not null check (btrim(nombre) <> '' and length(nombre) <= 80),
    tipo             text not null default 'Otro' check (btrim(tipo) <> '' and length(tipo) <= 40),
    origen           text not null default 'AGL' check (origen in ('AGL', 'CAMPO')),
    activo           boolean not null default true,
    revisado         boolean not null default true,
    fusionado_en     uuid references public.iny_objetivos(id),
    creado_por       uuid,
    creado_en        timestamptz not null default now(),
    nombre_norm      text not null,
    bajado_a_agl_en  timestamptz,
    huella           text,
    check (fusionado_en is null or fusionado_en <> id)
);
create unique index if not exists ux_iny_objetivos_norm on public.iny_objetivos (nombre_norm);

create or replace function public._iny_objetivos_norm_trg()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
    new.nombre := btrim(new.nombre);
    new.nombre_norm := public.fn_iny_normalizar_texto(new.nombre);
    if new.nombre_norm = '' then
        raise exception 'El nombre del objetivo no puede quedar vacío ni solo con signos.';
    end if;
    return new;
end $$;
drop trigger if exists iny_objetivos_norm on public.iny_objetivos;
create trigger iny_objetivos_norm before insert or update of nombre on public.iny_objetivos
    for each row execute function public._iny_objetivos_norm_trg();

alter table public.iny_objetivos enable row level security;
revoke insert, update, delete, truncate on public.iny_objetivos from anon, authenticated;
revoke all on public.iny_objetivos from anon;
grant select on public.iny_objetivos to authenticated;
drop policy if exists fert_leer on public.iny_objetivos;
create policy fert_leer on public.iny_objetivos for select to authenticated
    using (public.fn_es_admin() or public.fn_tiene_permiso('inyeccion', 'ver'));

-- Objetivos iniciales (las 5 clases de la 129), de origen AGL y ya revisados
insert into public.iny_objetivos (nombre, tipo, origen, activo, revisado) values
    ('Plaga', 'Plaga', 'AGL', true, true),
    ('Maleza', 'Maleza', 'AGL', true, true),
    ('Bacteria', 'Bacteria', 'AGL', true, true),
    ('Enfermedad', 'Enfermedad', 'AGL', true, true),
    ('Hongo', 'Hongo', 'AGL', true, true)
on conflict (nombre_norm) do nothing;


-- ---------------------------------------------------------------- (b) aplicaciones: objetivo_ids y fin de la lista cerrada
alter table public.iny_aplicaciones add column if not exists objetivo_ids uuid[];

do $$
declare c record;
begin
    for c in select conname from pg_constraint
              where conrelid = 'public.iny_aplicaciones'::regclass and contype = 'c'
                and pg_get_constraintdef(oid) like '%PLAGA%' loop
        execute format('alter table public.iny_aplicaciones drop constraint %I', c.conname);
    end loop;
    if not exists (select 1 from pg_constraint where conrelid = 'public.iny_aplicaciones'::regclass
                      and conname = 'iny_aplicaciones_objetivos_132') then
        alter table public.iny_aplicaciones add constraint iny_aplicaciones_objetivos_132 check (cardinality(objetivos) > 0);
    end if;
end $$;

-- Mapea las filas viejas por nombre normalizado (el texto de `objetivos` no se toca)
update public.iny_aplicaciones a
   set objetivo_ids = (select array_agg(o.id order by o.nombre)
                         from public.iny_objetivos o
                        where o.nombre_norm in (select public.fn_iny_normalizar_texto(x) from unnest(a.objetivos) x))
 where a.objetivo_ids is null;


-- ---------------------------------------------------------------- ayudas de objetivos
create or replace function public._iny_objetivo_json(o public.iny_objetivos)
returns jsonb language sql stable set search_path = public, pg_temp as $$
    select jsonb_build_object('id', o.id, 'nombre', o.nombre, 'tipo', o.tipo, 'origen', o.origen, 'activo', o.activo,
                              'revisado', o.revisado, 'fusionado_en', o.fusionado_en)
$$;
revoke execute on function public._iny_objetivo_json(public.iny_objetivos) from public, anon, authenticated;

create or replace function public._iny_obj_huella(o public.iny_objetivos)
returns text language sql stable set search_path = public, pg_temp as $$
    select encode(sha256(convert_to(public._iny_objetivo_json(o)::text, 'UTF8')), 'hex')
$$;
revoke execute on function public._iny_obj_huella(public.iny_objetivos) from public, anon, authenticated;

/** Sigue las fusiones hasta el objetivo vigente (tope de 10 saltos). */
create or replace function public._iny_objetivo_destino(p_id uuid)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v uuid := p_id;
    w uuid;
    n integer := 0;
begin
    loop
        select o.fusionado_en into w from public.iny_objetivos o where o.id = v;
        exit when w is null or n >= 10;
        v := w;
        n := n + 1;
    end loop;
    return v;
end $$;
revoke execute on function public._iny_objetivo_destino(uuid) from public, anon, authenticated;

/**
 * Resuelve los objetivos de una aplicación. p = [{id?, nombre?, tipo?} | 'texto'].
 * Por id si existe; si no, por nombre normalizado (enlaza al existente, nunca duplica); si no existe, lo crea como de
 * CAMPO («por revisar») conservando el id que mandó el teléfono. Devuelve ids y nombres vigentes (fusiones resueltas).
 */
create or replace function public._iny_resolver_objetivos(p jsonb, p_user uuid)
returns table (ids uuid[], nombres text[])
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    e      jsonb;
    v_id   uuid;
    v_nom  text;
    v_tipo text;
    v_norm text;
    v_dest uuid;
    v_ids  uuid[] := '{}';
begin
    if p is null or jsonb_typeof(p) <> 'array' then
        raise exception 'Elige al menos un objetivo.';
    end if;
    for e in select x.value from jsonb_array_elements(p) x loop
        v_id := null; v_nom := null; v_tipo := null; v_dest := null;
        if jsonb_typeof(e) = 'string' then
            v_nom := nullif(btrim(e #>> '{}'), '');
        elsif jsonb_typeof(e) = 'object' then
            v_id := public._fert_uuid(e ->> 'id');
            v_nom := nullif(btrim(coalesce(e ->> 'nombre', '')), '');
            v_tipo := nullif(btrim(coalesce(e ->> 'tipo', '')), '');
        else
            continue;
        end if;
        if v_id is not null then
            select o.id into v_dest from public.iny_objetivos o where o.id = v_id;
        end if;
        if v_dest is null and v_nom is not null then
            v_norm := public.fn_iny_normalizar_texto(v_nom);
            if v_norm = '' or length(v_nom) > 80 then
                raise exception 'El objetivo «%» no es válido (sin letras o de más de 80 caracteres).', left(v_nom, 40);
            end if;
            select o.id into v_dest from public.iny_objetivos o where o.nombre_norm = v_norm;
            if v_dest is null then
                insert into public.iny_objetivos (id, nombre, tipo, origen, activo, revisado, creado_por)
                values (coalesce(v_id, gen_random_uuid()), v_nom, left(coalesce(v_tipo, 'Otro'), 40), 'CAMPO', true, false, p_user)
                on conflict do nothing;
                select o.id into v_dest from public.iny_objetivos o where o.nombre_norm = v_norm;
            end if;
        end if;
        if v_dest is null then
            raise exception 'Objetivo no válido: falta el nombre.';
        end if;
        v_dest := public._iny_objetivo_destino(v_dest);
        if not (v_dest = any (v_ids)) then
            v_ids := v_ids || v_dest;
        end if;
    end loop;
    return query
        select v_ids, array(select o.nombre from unnest(v_ids) with ordinality u(x, n)
                              join public.iny_objetivos o on o.id = u.x order by u.n);
end $$;
revoke execute on function public._iny_resolver_objetivos(jsonb, uuid) from public, anon, authenticated;

/** Lo que baja el teléfono: TODOS los objetivos (activos o no) para revisar duplicados sin señal; él filtra los elegibles. */
create or replace function public._iny_objetivos_campo()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(public._iny_objetivo_json(o) order by o.nombre), '[]'::jsonb) from public.iny_objetivos o
$$;
revoke execute on function public._iny_objetivos_campo() from public, anon, authenticated;

/** Lotes del catálogo (lotes + lotes_temporada) de la temporada activa y de las del plan, para el selector del teléfono. */
create or replace function public._iny_lotes_campo()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'lote_temporada_id', lt.id, 'nomenclatura', l.nomenclatura, 'nombre', l.nombre,
               'temporada', t.nombre, 'activa', t.activa) order by l.nomenclatura, t.nombre), '[]'::jsonb)
      from public.lotes_temporada lt
      join public.lotes l on l.id = lt.lote_id and l.activo
      join public.temporadas t on t.id = lt.temporada_id
     where lt.activo
       and (t.activa or exists (select 1 from public.iny_plan p where public._fert_llave(p.temporada) = public._fert_llave(t.nombre)))
$$;
revoke execute on function public._iny_lotes_campo() from public, anon, authenticated;


-- ---------------------------------------------------------------- (d) alta desde el teléfono (con señal)
/**
 * p = {id?: uuid, nombre, tipo?} -> {creado: bool, existente: bool, objetivo: {id, nombre, tipo, origen, activo, revisado, fusionado_en}}
 * Si el nombre normalizado ya existe (activo, inactivo o fusionado) devuelve el vigente SIN crear otro.
 * Permiso: inyeccion · registrar.
 */
create or replace function public.fn_iny_objetivo_agregar(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_nom  text := nullif(btrim(coalesce(p ->> 'nombre', '')), '');
    v_tipo text := left(coalesce(nullif(btrim(coalesce(p ->> 'tipo', '')), ''), 'Otro'), 40);
    v_id   uuid := public._fert_uuid(p ->> 'id');
    v_norm text;
    o      public.iny_objetivos%rowtype;
    v_n    integer;
begin
    perform public._iny_exigir_permiso('registrar');
    if v_nom is null then
        raise exception 'Escribe el nombre del objetivo.' using errcode = '22023';
    end if;
    if length(v_nom) > 80 then
        raise exception 'El nombre del objetivo es muy largo (máximo 80 caracteres).' using errcode = '22023';
    end if;
    v_norm := public.fn_iny_normalizar_texto(v_nom);
    if v_norm = '' then
        raise exception 'El nombre del objetivo debe tener letras o números.' using errcode = '22023';
    end if;
    select * into o from public.iny_objetivos x where x.nombre_norm = v_norm;
    if not found then
        insert into public.iny_objetivos (id, nombre, tipo, origen, activo, revisado, creado_por)
        values (coalesce(v_id, gen_random_uuid()), v_nom, v_tipo, 'CAMPO', true, false, (select auth.uid()))
        on conflict do nothing;
        get diagnostics v_n = row_count;
        select * into o from public.iny_objetivos x where x.nombre_norm = v_norm;
        return jsonb_build_object('creado', v_n > 0, 'existente', v_n = 0, 'objetivo', public._iny_objetivo_json(o));
    end if;
    select * into o from public.iny_objetivos x where x.id = public._iny_objetivo_destino(o.id);
    return jsonb_build_object('creado', false, 'existente', true, 'objetivo', public._iny_objetivo_json(o));
end $$;
revoke execute on function public.fn_iny_objetivo_agregar(jsonb) from public, anon;
grant  execute on function public.fn_iny_objetivo_agregar(jsonb) to authenticated;


-- ---------------------------------------------------------------- (e) AGL publica objetivos y fusiones
/**
 * p = {objetivos: [{id, nombre, tipo, activo, revisado, fusionado_en?}]}
 * Alta/actualización por id (AGL manda); si el nombre normalizado choca con OTRO id, se omite con aviso.
 * «fusionado_en»: el objetivo queda inactivo y todas las aplicaciones que lo usaban apuntan al destino.
 * -> {objetivos: n, fusiones: n, avisos_objetivos: [texto]}. Solo se llama desde fn_iny_publicar (ya validó el permiso).
 */
create or replace function public._iny_publicar_objetivos(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_lista jsonb := p -> 'objetivos';
    v_avisos text[] := '{}';
    v_n   integer := 0;
    v_f   integer := 0;
    v_ids uuid[] := '{}';
    v_id  uuid;
    v_dest uuid;
    v_norm text;
    v_choca text;
    x     record;
begin
    if v_lista is null or jsonb_typeof(v_lista) <> 'array' then
        return jsonb_build_object('objetivos', 0, 'fusiones', 0, 'avisos_objetivos', '[]'::jsonb);
    end if;

    for x in select * from jsonb_to_recordset(v_lista)
             as t(id text, nombre text, tipo text, activo boolean, revisado boolean, fusionado_en text) loop
        v_id := public._fert_uuid(x.id);
        continue when v_id is null or nullif(btrim(coalesce(x.nombre, '')), '') is null;
        v_norm := public.fn_iny_normalizar_texto(x.nombre);
        if v_norm = '' then
            v_avisos := v_avisos || format('Objetivo «%s»: el nombre no tiene letras ni números; se omite.', left(x.nombre, 40));
            continue;
        end if;
        select o.nombre into v_choca from public.iny_objetivos o where o.nombre_norm = v_norm and o.id <> v_id limit 1;
        if v_choca is not null then
            v_avisos := v_avisos || format('Objetivo «%s» choca con «%s» (ya existe): se omite.', btrim(x.nombre), v_choca);
            continue;
        end if;
        begin
            insert into public.iny_objetivos (id, nombre, tipo, origen, activo, revisado)
            values (v_id, btrim(x.nombre), left(coalesce(nullif(btrim(coalesce(x.tipo, '')), ''), 'Otro'), 40), 'AGL',
                    coalesce(x.activo, true), coalesce(x.revisado, true))
            on conflict (id) do update
            set nombre = excluded.nombre, tipo = excluded.tipo, activo = excluded.activo, revisado = excluded.revisado,
                fusionado_en = null;
        exception when unique_violation then
            v_avisos := v_avisos || format('Objetivo «%s» choca con otro ya existente: se omite.', btrim(x.nombre));
            continue;
        end;
        v_ids := v_ids || v_id;
        v_n := v_n + 1;
    end loop;

    -- Fusiones (todos los objetivos ya existen)
    for x in select * from jsonb_to_recordset(v_lista)
             as t(id text, fusionado_en text) where nullif(btrim(coalesce(fusionado_en, '')), '') is not null loop
        v_id := public._fert_uuid(x.id);
        continue when v_id is null or not (v_id = any (v_ids));
        v_dest := public._iny_objetivo_destino(public._fert_uuid(x.fusionado_en));
        if v_dest is null or v_dest = v_id or not exists (select 1 from public.iny_objetivos o where o.id = v_dest) then
            v_avisos := v_avisos || format('Fusión de «%s»: destino no válido; se omite.', coalesce((select o.nombre from public.iny_objetivos o where o.id = v_id), '—'));
            continue;
        end if;
        update public.iny_objetivos set fusionado_en = v_dest, activo = false where id = v_id;
        with src as (
            select a.id as aid, y.dest
              from public.iny_aplicaciones a
             cross join lateral (select distinct case when z = v_id then v_dest else z end as dest from unnest(a.objetivo_ids) z) y
             where v_id = any (a.objetivo_ids)
        ), nuevo as (
            select s.aid, array_agg(s.dest order by o.nombre) as ids, array_agg(o.nombre order by o.nombre) as nombres
              from src s join public.iny_objetivos o on o.id = s.dest
             group by s.aid
        )
        update public.iny_aplicaciones a set objetivo_ids = n.ids, objetivos = n.nombres
          from nuevo n where a.id = n.aid;
        v_f := v_f + 1;
    end loop;

    -- Lo que viene de AGL queda como «ya bajado» (AGL es el dueño del catálogo)
    update public.iny_objetivos o set bajado_a_agl_en = now(), huella = public._iny_obj_huella(o)
     where o.id = any (v_ids);

    return jsonb_build_object('objetivos', v_n, 'fusiones', v_f, 'avisos_objetivos', to_jsonb(v_avisos));
end $$;
revoke execute on function public._iny_publicar_objetivos(jsonb) from public, anon, authenticated;

/**
 * -> {generado, cuantos, sha256_lote, objetivos: [{id, nombre, tipo, origen, activo, revisado, fusionado_en, creado_por,
 *      creado_en, n_aplicaciones, huella}]}   Solo lo nuevo o cambiado desde la última confirmación. Permiso: Conexión AGL · ver.
 * sha256_lote = sha256 de las huellas unidas con '|' ordenadas por id::text (binario).
 */
create or replace function public.fn_iny_objetivos_exportar()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v jsonb;
begin
    perform public._iny_exigir_agl('ver');
    with f as (
        select o.*, public._iny_obj_huella(o) as h
          from public.iny_objetivos o
         where o.bajado_a_agl_en is null or o.huella is distinct from public._iny_obj_huella(o)
    )
    select jsonb_build_object(
               'generado', now(),
               'cuantos', count(*),
               'sha256_lote', encode(sha256(convert_to(coalesce(string_agg(f.h, '|' order by f.id::text collate "C"), ''), 'UTF8')), 'hex'),
               'objetivos', coalesce(jsonb_agg(public._iny_objetivo_json(o2) || jsonb_build_object(
                    'creado_por', f.creado_por, 'creado_en', f.creado_en, 'huella', f.h,
                    'n_aplicaciones', (select count(*) from public.iny_aplicaciones a where f.id = any (a.objetivo_ids)))
                    order by f.id::text collate "C"), '[]'::jsonb))
      into v
      from f join public.iny_objetivos o2 on o2.id = f.id;
    return v;
end $$;
revoke execute on function public.fn_iny_objetivos_exportar() from public, anon;
grant  execute on function public.fn_iny_objetivos_exportar() to authenticated;

/** p = {lote: [{id, huella}], cuantos, sha256_lote} -> {confirmadas: [{id}], rechazadas: [{id}]}. Permiso: Conexión AGL · publicar. */
create or replace function public.fn_iny_objetivos_confirmar(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_lote jsonb := p -> 'lote';
    v_ok   jsonb;
    v_mal  jsonb;
begin
    perform public._iny_exigir_agl('publicar');
    if v_lote is null or jsonb_typeof(v_lote) <> 'array' then
        raise exception 'Se esperaba {lote: [{id, huella}], cuantos, sha256_lote}.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_lote) x where nullif(x ->> 'id', '') is null or nullif(x ->> 'huella', '') is null) then
        raise exception 'El lote trae filas sin id o sin huella.' using errcode = '22023';
    end if;
    if coalesce(nullif(p ->> 'cuantos', '')::integer, -1) <> jsonb_array_length(v_lote) then
        raise exception 'El conteo del lote no coincide con la lista.' using errcode = '22023';
    end if;
    if coalesce(p ->> 'sha256_lote', '') <> encode(sha256(convert_to(coalesce((
            select string_agg(x ->> 'huella', '|' order by (x ->> 'id') collate "C")
              from jsonb_array_elements(v_lote) x), ''), 'UTF8')), 'hex') then
        raise exception 'La huella del lote no coincide: no se confirma nada. Vuelve a bajar y a verificar.' using errcode = '22023';
    end if;

    update public.iny_objetivos o set bajado_a_agl_en = now(), huella = c.h
      from (select (x ->> 'id')::uuid as id, x ->> 'huella' as h from jsonb_array_elements(v_lote) x) c
     where o.id = c.id and public._iny_obj_huella(o) = c.h;

    select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id')), '[]'::jsonb) into v_ok
      from jsonb_array_elements(v_lote) x
     where exists (select 1 from public.iny_objetivos o where o.id = (x ->> 'id')::uuid
                      and o.bajado_a_agl_en is not null and o.huella = x ->> 'huella' and o.huella = public._iny_obj_huella(o));
    select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id')), '[]'::jsonb) into v_mal
      from jsonb_array_elements(v_lote) x
     where not exists (select 1 from public.iny_objetivos o where o.id = (x ->> 'id')::uuid
                      and o.bajado_a_agl_en is not null and o.huella = x ->> 'huella' and o.huella = public._iny_obj_huella(o));
    return jsonb_build_object('confirmadas', v_ok, 'rechazadas', v_mal);
end $$;
revoke execute on function public.fn_iny_objetivos_confirmar(jsonb) from public, anon;
grant  execute on function public.fn_iny_objetivos_confirmar(jsonb) to authenticated;


-- ---------------------------------------------------------------- parches (marca propia 132)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer;
begin
    v_viejo := replace(v_viejo, E'\r\n', E'\n');   -- el archivo puede venir con CRLF
    v_nuevo := replace(v_nuevo, E'\r\n', E'\n');
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    if v_n <> 1 then
        raise exception '132: en % se esperaba 1 aparición de «%» y hay % (¿falta correr la 129?)', p_fn, v_viejo, v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '132: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- (c) la operación: variables nuevas
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    E'    v_obj      text[];\n',
    E'    v_obj      text[];\n    v_obj_ids  uuid[];\n    v_lt       uuid;\n    v_canon    text;\n',
    $p$v_obj_ids  uuid[];$p$);

-- (c) objetivos por id y nombre (sin lista cerrada)
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$    select coalesce(array_agg(distinct upper(btrim(x))), '{}') into v_obj from jsonb_array_elements_text(d->'objetivos') x;
    if cardinality(v_obj) = 0 then
        raise exception 'Elige al menos un objetivo.';
    end if;
    if exists (select 1 from unnest(v_obj) o where o not in ('PLAGA', 'MALEZA', 'BACTERIA', 'ENFERMEDAD', 'HONGO')) then
        raise exception 'Objetivo no válido (usa plaga, maleza, bacteria, enfermedad u hongo).';
    end if;$p$,
    $p$    select r.ids, r.nombres into v_obj_ids, v_obj from public._iny_resolver_objetivos(d->'objetivos', (select auth.uid())) r;
    if cardinality(coalesce(v_obj_ids, '{}')) = 0 then
        raise exception 'Elige al menos un objetivo.';
    end if;$p$,
    $p$_iny_resolver_objetivos($p$);

-- (c) el lote sale del catálogo: existe en public.lotes y está asignado a la temporada
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$    v_dia := (v_fecha at time zone 'America/Tegucigalpa')::date;$p$,
    $p$    v_dia := (v_fecha at time zone 'America/Tegucigalpa')::date;

    -- 132:lote · el lote tiene que ser del catálogo (nomenclatura normalizada) y de la temporada
    select lc.nomenclatura into v_canon from public.lotes lc
     where public._iny_norm_lote(lc.nomenclatura) = public._iny_norm_lote(v_lote)
     order by lc.nomenclatura limit 1;
    if v_canon is null then
        raise exception 'El lote «%» no existe en el catálogo de lotes. Elígelo de la lista.', v_lote;
    end if;
    select lt.id into v_lt
      from public.lotes_temporada lt
      join public.lotes lc on lc.id = lt.lote_id
      join public.temporadas t on t.id = lt.temporada_id
     where lc.nomenclatura = v_canon
       and case when v_temp is null then t.activa else public._fert_llave(t.nombre) = public._fert_llave(v_temp) end
     order by lt.activo desc, t.activa desc, t.fecha_inicio desc
     limit 1;
    if v_lt is null then
        raise exception 'El lote «%» no está asignado a la temporada «%».', v_canon,
            coalesce(v_temp, (select t.nombre from public.temporadas t where t.activa limit 1), 'vigente');
    end if;
    v_lote := v_canon;$p$,
    $p$-- 132:lote$p$);

-- (c) se guardan lote_temporada_id y objetivo_ids
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$area_mz, objetivos, comentario, registrado_por)$p$,
    $p$area_mz, objetivos, comentario, registrado_por, objetivo_ids)$p$,
    $p$registrado_por, objetivo_ids)$p$);
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$public._iny_lote_temporada(v_lote, v_temp), v_temp, v_ciclo,$p$,
    $p$v_lt, v_temp, v_ciclo,$p$,
    $p$(p_id, v_estacion, v_lote, v_lt, v_temp$p$);
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$nullif(btrim(coalesce(d->>'comentario', '')), ''), (select auth.uid()));$p$,
    $p$nullif(btrim(coalesce(d->>'comentario', '')), ''), (select auth.uid()), v_obj_ids);$p$,
    $p$(select auth.uid()), v_obj_ids);$p$);

-- (e) AGL: publicar objetivos junto al plan
select pg_temp.parchar('public.fn_iny_publicar(jsonb)',
    $p$return jsonb_build_object('categorias', v_n_cat,$p$,
    $p$return public._iny_publicar_objetivos(v_p) || jsonb_build_object('categorias', v_n_cat,$p$,
    $p$_iny_publicar_objetivos($p$);

-- (f) teléfono: objetivos, lotes del catálogo y objetivo_ids de cada aplicación
select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$'categorias', coalesce(($p$,
    $p$'objetivos', public._iny_objetivos_campo(), 'lotes', public._iny_lotes_campo(), 'categorias', coalesce(($p$,
    $p$_iny_objetivos_campo($p$);
select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$'objetivos', to_jsonb(a.objetivos),$p$,
    $p$'objetivos', to_jsonb(a.objetivos), 'objetivo_ids', to_jsonb(a.objetivo_ids),$p$,
    $p$'objetivo_ids', to_jsonb(a.objetivo_ids)$p$);

-- (f) huella de la bajada: objetivo_ids solo cuando existe (las filas sin él conservan su huella)
select pg_temp.parchar('public._iny_fila(public.iny_aplicaciones)',
    $p$select ((to_jsonb(a) - 'bajado_a_agl_en') - 'huella')$p$,
    $p$select (((to_jsonb(a) - 'bajado_a_agl_en') - 'huella') - 'objetivo_ids')
           || case when a.objetivo_ids is null then '{}'::jsonb else jsonb_build_object('objetivo_ids', to_jsonb(a.objetivo_ids)) end$p$,
    $p$'{}'::jsonb else jsonb_build_object('objetivo_ids'$p$);

notify pgrst, 'reload schema';
