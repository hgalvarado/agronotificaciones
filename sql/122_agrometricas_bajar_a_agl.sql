-- =====================================================================
-- 122 · AGROMÉTRICAS · AGL BAJA LOS PARÁMETROS, VERIFICA LA HUELLA Y RECIÉN ENTONCES SE BORRAN DE SUPABASE
-- =====================================================================
-- Regla del usuario: Supabase es solo un intermediario. Mismo patrón que la 102 / 121 de Fertirriego.
-- Tablas: agm_parametros, agm_clima, agm_calicatas (+ la foto de calicata, ruta en el bucket «agrometricas»).
--
--   1. fn_agm_exportar(p)          AGL lee en lotes lo que está «por bajar» (nunca bajado, o cambiado después de bajarlo).
--                                  Cada fila trae su texto exacto y su sha256 (huella). Permiso: fertirriego_agl · ver.
--   2. fn_agm_confirmar_bajada(p)  AGL confirma {lote:[{tabla,id,huella}], cuantos, sha256_lote}. La base RECALCULA la
--                                  huella de cada fila: si coincide, la marca (bajado_a_agl_en, huella); si la fila cambió
--                                  entre la lectura y la confirmación, queda «por bajar» otra vez. NO borra nada.
--                                  Permiso: fertirriego_agl · publicar.
--   3. fn_agm_purgar_bajadas(p)    Borra de Supabase SOLO lo confirmado cuya huella actual sigue igual y que lleva más de
--                                  la retención (7 días por defecto, configurable) desde la confirmación. Devuelve las
--                                  rutas de fotos que AGL ya puede borrar de Storage (con su llave de servicio: la base
--                                  no borra objetos de Storage). Permiso: fertirriego_agl · publicar.
--   4. fn_agm_bajada_retencion(d)  Lee (o cambia) los días de retención. Permiso: fertirriego_agl · publicar.
--
-- Huella: sha256 (hex) de fila::text, donde fila = to_jsonb(registro) SIN las claves bajado_a_agl_en y huella.
-- El texto de jsonb es canónico (claves ordenadas), así que AGL puede recalcularlo sobre «texto».
-- Huella del lote: sha256 de las huellas de sus filas unidas con '|', ordenadas por cursor (comparación binaria, collate "C").
-- Cursor de una fila: 'p|<id>' parámetros, 'c|<id>' clima, 'l|<turno_ciclo_id>' calicata.
--
-- Calicata: es FIJA por ciclo y la pantalla del teléfono la consulta para no moverla: se baja pronto pero solo se
-- borra de Supabase cuando su turno ya no está activo (ciclo terminado).
-- Requiere 109 y 110. Idempotente. No redefine funciones de la 109/110 (no necesita parches): re-correr 109/110 en
-- cualquier orden no rompe esta (solo usa columnas que esas migraciones no tocan). Todo UPDATE/DELETE lleva WHERE.
-- Sin permisos nuevos: usa los que ya tiene el usuario técnico «Integración AGL» (fertirriego_agl ver / publicar).
-- =====================================================================

-- ---------------------------------------------------------------- columnas (nullable: no tocan datos existentes)
alter table public.agm_parametros add column if not exists bajado_a_agl_en timestamptz;
alter table public.agm_parametros add column if not exists huella text;
alter table public.agm_clima      add column if not exists bajado_a_agl_en timestamptz;
alter table public.agm_clima      add column if not exists huella text;
alter table public.agm_calicatas  add column if not exists bajado_a_agl_en timestamptz;
alter table public.agm_calicatas  add column if not exists huella text;

-- ---------------------------------------------------------------- retención (una sola fila)
create table if not exists public.agm_bajada_config (
    id              boolean primary key default true check (id),
    retencion_dias  integer not null default 7 check (retencion_dias between 0 and 365)
);
insert into public.agm_bajada_config (id) values (true) on conflict (id) do nothing;
alter table public.agm_bajada_config enable row level security;   -- sin políticas: solo las funciones (security definer)

-- ---------------------------------------------------------------- ayudas internas
/** Huella de una fila (jsonb de to_jsonb(registro)): sin las marcas de bajada. */
create or replace function public._agm_huella(p_fila jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
    select encode(sha256(convert_to(((p_fila - 'bajado_a_agl_en') - 'huella')::text, 'UTF8')), 'hex')
$$;
revoke execute on function public._agm_huella(jsonb) from public, anon, authenticated;

/** Tamaño de la foto en Storage (bytes); null si no hay Storage (réplica) o no existe. */
create or replace function public._agm_foto_bytes(p_ruta text)
returns bigint language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v bigint;
begin
    if p_ruta is null or to_regclass('storage.objects') is null then return null; end if;
    execute 'select (metadata ->> ''size'')::bigint from storage.objects where bucket_id = ''agrometricas'' and name = $1 limit 1'
        into v using p_ruta;
    return v;
exception when others then
    return null;
end $$;
revoke execute on function public._agm_foto_bytes(text) from public, anon, authenticated;

/** Las tres tablas en un solo conjunto, con la huella actual y la guardada. */
create or replace function public._agm_filas()
returns table (tabla text, cursor text, id uuid, turno_ciclo_id uuid, zona_id uuid, fecha date,
               fila jsonb, texto text, huella text, huella_guardada text, bajado_a_agl_en timestamptz,
               foto text, turno_activo boolean)
language sql stable security definer set search_path = public, pg_temp as $$
    with b as (
        select 'parametros'::text as tabla, 'p|' || a.id::text as cursor, a.id as id, a.turno_ciclo_id as tc, null::uuid as zona,
               a.fecha as fecha, to_jsonb(a) as j, a.huella as hg, a.bajado_a_agl_en as bj, nullif(a.foto_calicata, '') as foto
          from public.agm_parametros a
        union all
        select 'clima', 'c|' || c.id::text, c.id, null::uuid, c.zona_id, c.fecha, to_jsonb(c), c.huella, c.bajado_a_agl_en, null
          from public.agm_clima c
        union all
        select 'calicatas', 'l|' || l.turno_ciclo_id::text, l.turno_ciclo_id, l.turno_ciclo_id, null::uuid,
               (l.medido_en at time zone 'America/Tegucigalpa')::date, to_jsonb(l), l.huella, l.bajado_a_agl_en, null
          from public.agm_calicatas l
    )
    select b.tabla, b.cursor, b.id, b.tc, b.zona, b.fecha,
           (b.j - 'bajado_a_agl_en') - 'huella',
           ((b.j - 'bajado_a_agl_en') - 'huella')::text,
           public._agm_huella(b.j), b.hg, b.bj, b.foto,
           (select t.activo from public.turnos_ciclo t where t.id = b.tc)
      from b
$$;
revoke execute on function public._agm_filas() from public, anon, authenticated;

/** Verifica sesión y permiso (null = no exige permiso, solo sesión). */
create or replace function public._agm_exigir_agl(p_accion text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', p_accion)) then
        raise exception 'Tu rol no tiene permiso para %: se necesita Conexión AGL · %.',
            case when p_accion = 'ver' then 'leer los parámetros de AgroMétricas' else 'confirmar o purgar lo bajado de AgroMétricas' end,
            p_accion using errcode = '42501';
    end if;
end $$;
revoke execute on function public._agm_exigir_agl(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 1. exportar
/**
 * p = {desde?: 'YYYY-MM-DD', hasta?: 'YYYY-MM-DD', limite?: 1..1000 (200), despues_de?: cursor}
 * -> {generado, hay_mas, siguiente (cursor de la última fila), cuantos, sha256_lote,
 *     filas: [{tabla, cursor, id, turno_ciclo_id (de la base), turno_agl_id (id del turno en AGL), turno, temporada, ciclo,
 *              zona_id, zona, fecha, fila, texto, huella, foto: {ruta, bytes} | null}]}
 * Solo lo «por bajar». Orden estable por cursor (binario). Si AGL no confirma un lote, la siguiente lectura lo repite
 * salvo que pase despues_de = siguiente.
 */
create or replace function public.fn_agm_exportar(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_p      jsonb := coalesce(p, '{}'::jsonb);
    v_lim    integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 200), 1), 1000);
    v_desde  date := nullif(v_p ->> 'desde', '')::date;
    v_hasta  date := nullif(v_p ->> 'hasta', '')::date;
    v_desp   text := nullif(v_p ->> 'despues_de', '');
    v_filas  jsonb;
    v_mas    boolean;
    v_sig    text;
    v_cuantos integer;
    v_lote   text;
begin
    perform public._agm_exigir_agl('ver');
    with f as (
        select x.* from public._agm_filas() x
         where (x.bajado_a_agl_en is null or x.huella_guardada is distinct from x.huella)
           and (v_desde is null or x.fecha >= v_desde)
           and (v_hasta is null or x.fecha <= v_hasta)
           and (v_desp is null or x.cursor collate "C" > v_desp collate "C")
         order by x.cursor collate "C"
         limit v_lim + 1
    ), lim as (
        select * from f order by cursor collate "C" limit v_lim
    )
    select (select count(*) > v_lim from f),
           coalesce(jsonb_agg(jsonb_build_object(
               'tabla', l.tabla, 'cursor', l.cursor, 'id', l.id,
               'turno_ciclo_id', l.turno_ciclo_id,
               'turno_agl_id', tc.agl_id, 'turno', tu.codigo, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
               'zona_id', coalesce(l.zona_id, e.zona_id, tc.zona_id), 'zona', z.nombre,
               'fecha', l.fecha, 'fila', l.fila, 'texto', l.texto, 'huella', l.huella,
               'foto', case when l.foto is null then null
                            else jsonb_build_object('ruta', l.foto, 'bytes', public._agm_foto_bytes(l.foto)) end
           ) order by l.cursor collate "C"), '[]'::jsonb),
           max(l.cursor collate "C"),
           count(*),
           encode(sha256(convert_to(coalesce(string_agg(l.huella, '|' order by l.cursor collate "C"), ''), 'UTF8')), 'hex')
      into v_mas, v_filas, v_sig, v_cuantos, v_lote
      from lim l
      left join public.turnos_ciclo tc on tc.id = l.turno_ciclo_id
      left join public.turnos tu on tu.id = tc.turno_id
      left join public.estaciones_riego e on e.id = tc.estacion_id
      left join public.zonas z on z.id = coalesce(l.zona_id, e.zona_id, tc.zona_id);
    return jsonb_build_object('generado', now(), 'hay_mas', coalesce(v_mas, false), 'siguiente', v_sig,
                              'cuantos', v_cuantos, 'sha256_lote', v_lote, 'filas', v_filas);
end
$$;
revoke execute on function public.fn_agm_exportar(jsonb) from public, anon;
grant  execute on function public.fn_agm_exportar(jsonb) to authenticated;

-- ---------------------------------------------------------------- 2. confirmar (no borra)
/**
 * p = {lote: [{tabla: 'parametros'|'clima'|'calicatas', id, huella}], cuantos, sha256_lote}
 * AGL confirma SOLO después de guardar la fila (y su foto en OneDrive). La base valida cuantos y sha256_lote del
 * mensaje y recalcula la huella de cada fila; solo marca las que coinciden.
 * -> {confirmadas: [{tabla,id}], rechazadas: [{tabla,id}]}  (rechazada = la fila cambió o ya no existe: sigue «por bajar»)
 */
create or replace function public.fn_agm_confirmar_bajada(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_lote   jsonb := p -> 'lote';
    v_ok     jsonb;
    v_mal    jsonb;
begin
    perform public._agm_exigir_agl('publicar');
    if v_lote is null or jsonb_typeof(v_lote) <> 'array' then
        raise exception 'Se esperaba {lote: [{tabla, id, huella}], cuantos, sha256_lote}.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_lote) x
                where coalesce(x ->> 'tabla', '') not in ('parametros', 'clima', 'calicatas')
                   or nullif(x ->> 'id', '') is null or nullif(x ->> 'huella', '') is null) then
        raise exception 'El lote trae filas sin tabla, id o huella, o con una tabla desconocida.' using errcode = '22023';
    end if;
    if coalesce(nullif(p ->> 'cuantos', '')::integer, -1) <> jsonb_array_length(v_lote) then
        raise exception 'El conteo del lote no coincide con la lista (cuantos = %, filas = %).',
            coalesce(p ->> 'cuantos', 'null'), jsonb_array_length(v_lote) using errcode = '22023';
    end if;
    if coalesce(p ->> 'sha256_lote', '') <> encode(sha256(convert_to(coalesce((
            select string_agg(x ->> 'huella', '|' order by (case x ->> 'tabla' when 'parametros' then 'p|' when 'clima' then 'c|' else 'l|' end || (x ->> 'id')) collate "C")
              from jsonb_array_elements(v_lote) x), ''), 'UTF8')), 'hex') then
        raise exception 'La huella del lote no coincide: no se confirma nada. Vuelve a bajar y a verificar.' using errcode = '22023';
    end if;

    -- solo donde la huella recalculada coincide con la que AGL verificó
    update public.agm_parametros a set bajado_a_agl_en = now(), huella = c.h
      from (select (x ->> 'id')::uuid as id, x ->> 'huella' as h from jsonb_array_elements(v_lote) x where x ->> 'tabla' = 'parametros') c
     where a.id = c.id and public._agm_huella(to_jsonb(a)) = c.h;
    update public.agm_clima a set bajado_a_agl_en = now(), huella = c.h
      from (select (x ->> 'id')::uuid as id, x ->> 'huella' as h from jsonb_array_elements(v_lote) x where x ->> 'tabla' = 'clima') c
     where a.id = c.id and public._agm_huella(to_jsonb(a)) = c.h;
    update public.agm_calicatas a set bajado_a_agl_en = now(), huella = c.h
      from (select (x ->> 'id')::uuid as id, x ->> 'huella' as h from jsonb_array_elements(v_lote) x where x ->> 'tabla' = 'calicatas') c
     where a.turno_ciclo_id = c.id and public._agm_huella(to_jsonb(a)) = c.h;

    -- (sentencias aparte: ven el efecto de las anteriores)
    select coalesce(jsonb_agg(jsonb_build_object('tabla', x ->> 'tabla', 'id', x ->> 'id')), '[]'::jsonb) into v_ok
      from jsonb_array_elements(v_lote) x
     where exists (select 1 from public._agm_filas() f
                    where f.tabla = x ->> 'tabla' and f.id = (x ->> 'id')::uuid
                      and f.bajado_a_agl_en is not null and f.huella_guardada = x ->> 'huella' and f.huella = f.huella_guardada);
    select coalesce(jsonb_agg(jsonb_build_object('tabla', x ->> 'tabla', 'id', x ->> 'id')), '[]'::jsonb) into v_mal
      from jsonb_array_elements(v_lote) x
     where not exists (select 1 from public._agm_filas() f
                        where f.tabla = x ->> 'tabla' and f.id = (x ->> 'id')::uuid
                          and f.bajado_a_agl_en is not null and f.huella_guardada = x ->> 'huella' and f.huella = f.huella_guardada);
    return jsonb_build_object('confirmadas', v_ok, 'rechazadas', v_mal);
end
$$;
revoke execute on function public.fn_agm_confirmar_bajada(jsonb) from public, anon;
grant  execute on function public.fn_agm_confirmar_bajada(jsonb) to authenticated;

-- ---------------------------------------------------------------- 3. retención
/** Sin parámetro: devuelve los días de retención. Con p_dias (0..365): los cambia. */
create or replace function public.fn_agm_bajada_retencion(p_dias integer default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v integer;
begin
    perform public._agm_exigir_agl('publicar');
    if p_dias is not null then
        if p_dias not between 0 and 365 then
            raise exception 'La retención va de 0 a 365 días.' using errcode = '22023';
        end if;
        update public.agm_bajada_config set retencion_dias = p_dias where id;
    end if;
    select retencion_dias into v from public.agm_bajada_config where id;
    return v;
end
$$;
revoke execute on function public.fn_agm_bajada_retencion(integer) from public, anon;
grant  execute on function public.fn_agm_bajada_retencion(integer) to authenticated;

-- ---------------------------------------------------------------- 4. purgar lo confirmado
/**
 * p = {limite?: 1..5000 (500), retencion_dias?: solo puede AUMENTAR la configurada}
 * Borra de Supabase lo confirmado hace más de la retención, cuya huella actual = la confirmada. Las calicatas, solo si
 * su turno ya no está activo.
 * -> {parametros, clima, calicatas, fotos: [rutas de Storage que AGL ya puede borrar], hay_mas, retencion_dias}
 * Una foto sigue en la lista solo si ninguna fila que quede en Supabase la usa.
 */
create or replace function public.fn_agm_purgar_bajadas(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p     jsonb := coalesce(p, '{}'::jsonb);
    v_lim   integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 500), 1), 5000);
    v_ret   integer;
    v_np    integer;
    v_nc    integer;
    v_nl    integer;
    v_fotos text[];
    v_mas   boolean;
begin
    perform public._agm_exigir_agl('publicar');
    select retencion_dias into v_ret from public.agm_bajada_config where id;
    v_ret := greatest(coalesce(v_ret, 7), coalesce(nullif(v_p ->> 'retencion_dias', '')::integer, 0));

    select count(*) > v_lim into v_mas
      from public._agm_filas() f
     where f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
       and f.bajado_a_agl_en < now() - make_interval(days => v_ret)
       and (f.tabla <> 'calicatas' or f.turno_activo is false);

    with c as (
        select f.tabla, f.id from public._agm_filas() f
         where f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
           and f.bajado_a_agl_en < now() - make_interval(days => v_ret)
           and (f.tabla <> 'calicatas' or f.turno_activo is false)
         order by f.cursor collate "C"
         limit v_lim
    ), dp as (
        delete from public.agm_parametros a using c
         where c.tabla = 'parametros' and a.id = c.id
           and a.huella is not null and public._agm_huella(to_jsonb(a)) = a.huella
        returning a.foto_calicata
    ), dc as (
        delete from public.agm_clima a using c
         where c.tabla = 'clima' and a.id = c.id
           and a.huella is not null and public._agm_huella(to_jsonb(a)) = a.huella
        returning a.id
    ), dl as (
        delete from public.agm_calicatas a using c
         where c.tabla = 'calicatas' and a.turno_ciclo_id = c.id
           and a.huella is not null and public._agm_huella(to_jsonb(a)) = a.huella
        returning a.turno_ciclo_id
    )
    select (select count(*) from dp), (select count(*) from dc), (select count(*) from dl),
           (select array_agg(distinct nullif(foto_calicata, '')) from dp where nullif(foto_calicata, '') is not null)
      into v_np, v_nc, v_nl, v_fotos;

    -- sentencia aparte: ya ve las filas borradas
    return jsonb_build_object(
        'parametros', v_np, 'clima', v_nc, 'calicatas', v_nl,
        'fotos', coalesce((select jsonb_agg(f order by f) from unnest(coalesce(v_fotos, '{}'::text[])) f
                            where not exists (select 1 from public.agm_parametros o where o.foto_calicata = f)), '[]'::jsonb),
        'hay_mas', coalesce(v_mas, false) and (v_np + v_nc + v_nl) > 0,
        'retencion_dias', v_ret);
end
$$;
revoke execute on function public.fn_agm_purgar_bajadas(jsonb) from public, anon;
grant  execute on function public.fn_agm_purgar_bajadas(jsonb) to authenticated;

notify pgrst, 'reload schema';
