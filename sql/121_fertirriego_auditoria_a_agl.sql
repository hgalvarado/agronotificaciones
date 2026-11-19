-- =====================================================================
-- 121 · FERTIRRIEGO · LA COPIA DE LO ELIMINADO (119) SE BAJA A AGL Y SE BORRA DE SUPABASE
-- =====================================================================
-- Regla del usuario: Supabase es solo un intermediario; la información documental vive en AGL.
-- Antes: fert_eliminaciones guardaba para siempre una COPIA COMPLETA (snapshot) de cada registro eliminado.
-- Ahora: la copia está aquí solo hasta que AGL la baja y confirma con la huella (sha256 del snapshot::text);
-- entonces snapshot = null. Quedan solo datos mínimos (id, tipo, documento, estación, resumen, motivo, quién,
-- cuándo, conteos, operaciones_ids y los ids de movimientos que AGL necesita para purgar, sql/120).
--   · fn_fert_eliminaciones_para_bajar(p_limite)  AGL lee las copias pendientes (permiso fertirriego_agl·ver).
--   · fn_fert_eliminaciones_confirmar(jsonb)      AGL confirma [{id, huella}] (permiso fertirriego_agl·publicar,
--                                                  destructivo, como Terminar ciclo); huella que no coincide = rechazada.
--   · Limpieza: las filas ya bajadas hace más de 180 días se borran.
--     TRADE-OFF: operaciones_ids es lo que impide que un teléfono reenvíe y recree lo eliminado (119). Pasados
--     180 días de bajada, esa protección se pierde: un teléfono que estuvo sin señal más de medio año y reenvíe la
--     operación podría recrear el registro. Se acepta (el teléfono sincroniza mucho antes).
-- Correr DESPUÉS de la 120. Idempotente. Re-correr la 119 NO la rompe (no vuelve a poner NOT NULL ni borra columnas; un
-- disparador calcula la huella y los ids de movimientos aunque la 119 redefina fn_fert_eliminar_documento). Si se
-- re-corre la 119 (redefine fn_fert_eliminaciones_listar) o la 120 (su función), correr la 121 otra vez para
-- recuperar el aviso copia_en_agl. No crea acciones ni permisos nuevos.
-- =====================================================================

alter table public.fert_eliminaciones alter column snapshot drop not null;
alter table public.fert_eliminaciones add column if not exists snapshot_huella text;
alter table public.fert_eliminaciones add column if not exists snapshot_bajado_at timestamptz;
alter table public.fert_eliminaciones add column if not exists movimientos_ids jsonb;

create or replace function public._fert_elim_huella(p_snap jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
    select case when p_snap is null then null else encode(sha256(convert_to(p_snap::text, 'UTF8')), 'hex') end
$$;

create or replace function public._fert_elim_derivados()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
    if new.snapshot is not null then
        new.snapshot_huella := public._fert_elim_huella(new.snapshot);
        if new.movimientos_ids is null then
            new.movimientos_ids := coalesce((select jsonb_agg(jsonb_build_object('cursor', x->'cursor', 'id', x->'id'))
                                             from jsonb_array_elements(coalesce(new.snapshot->'movimientos', '[]'::jsonb)) x), '[]'::jsonb);
        end if;
    end if;
    return new;
end $$;

drop trigger if exists trg_fert_elim_derivados on public.fert_eliminaciones;
create trigger trg_fert_elim_derivados before insert on public.fert_eliminaciones
    for each row execute function public._fert_elim_derivados();

-- filas que ya existían
update public.fert_eliminaciones e
   set snapshot_huella = public._fert_elim_huella(e.snapshot)
 where e.snapshot is not null and e.snapshot_huella is null;
update public.fert_eliminaciones e
   set movimientos_ids = coalesce((select jsonb_agg(jsonb_build_object('cursor', x->'cursor', 'id', x->'id'))
                                   from jsonb_array_elements(coalesce(e.snapshot->'movimientos', '[]'::jsonb)) x), '[]'::jsonb)
 where e.snapshot is not null and e.movimientos_ids is null;

-- ---- la función de la 120, ahora sin depender del snapshot (misma definición que en la 120)
create or replace function public.fn_fert_eliminados_para_agl(p_desde timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    c_limite constant integer := 5000;
    v_res  jsonb;
    v_mas  boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'ver')) then
        raise exception 'Tu rol no tiene permiso para leer lo eliminado de Fertirriego (Conexión AGL · ver).' using errcode = '42501';
    end if;
    with f as (
        select e.id, e.tipo, e.documento_id, e.eliminado_at, e.operaciones_ids, e.snapshot, e.movimientos_ids
        from public.fert_eliminaciones e
        where p_desde is null or e.eliminado_at > p_desde
        order by e.eliminado_at, e.id
        limit c_limite + 1
    ), lim as (
        select * from f order by eliminado_at, id limit c_limite
    )
    select
        (select count(*) > c_limite from f),
        coalesce(jsonb_agg(jsonb_build_object(
            'eliminacion_id', l.id,
            'tipo', l.tipo,
            'documento_id', l.documento_id,
            'eliminado_at', l.eliminado_at,
            'movimientos', coalesce(l.movimientos_ids,
                     (select jsonb_agg(jsonb_build_object('cursor', x->'cursor', 'id', x->'id'))
                      from jsonb_array_elements(coalesce(l.snapshot->'movimientos', '[]'::jsonb)) x), '[]'::jsonb),
            'operaciones_ids', to_jsonb(coalesce(l.operaciones_ids, '{}'::uuid[]))
        ) order by l.eliminado_at, l.id), '[]'::jsonb)
    into v_mas, v_res
    from lim l;
    return jsonb_build_object('generado', now(), 'hay_mas', coalesce(v_mas, false), 'eliminados', coalesce(v_res, '[]'::jsonb));
end;
$$;
revoke execute on function public.fn_fert_eliminados_para_agl(timestamptz) from public, anon;
grant  execute on function public.fn_fert_eliminados_para_agl(timestamptz) to authenticated;

-- ---- AGL lee las copias pendientes
create or replace function public.fn_fert_eliminaciones_para_bajar(p_limite integer default 200)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_lim integer := least(greatest(coalesce(p_limite, 200), 1), 1000);
    v_res jsonb;
    v_mas boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'ver')) then
        raise exception 'Tu rol no tiene permiso para leer lo eliminado de Fertirriego (Conexión AGL · ver).' using errcode = '42501';
    end if;
    with f as (
        select e.* from public.fert_eliminaciones e
        where e.snapshot is not null
        order by e.eliminado_at, e.id
        limit v_lim + 1
    ), lim as (
        select * from f order by eliminado_at, id limit v_lim
    )
    select
        (select count(*) > v_lim from f),
        coalesce(jsonb_agg(jsonb_build_object(
            'id', l.id, 'tipo', l.tipo, 'documento_id', l.documento_id,
            'estacion', l.estacion, 'estacion2', l.estacion2, 'resumen', l.resumen, 'motivo', l.motivo,
            'eliminado_at', l.eliminado_at, 'eliminado_por_nombre', l.eliminado_por_nombre,
            'registrado_por_nombre', l.registrado_por_nombre, 'fecha_documento', l.fecha_documento,
            'conteos', l.conteos, 'snapshot', l.snapshot,
            'snapshot_texto', l.snapshot::text,      -- el texto EXACTO que se firmó: AGL verifica sha256 sobre él
            -- nombres de los productos del documento (solo para mostrarlo en AGL; NO forman parte de lo firmado)
            'materiales', coalesce((select jsonb_object_agg(m.id::text, jsonb_build_object('codigo', m.codigo, 'texto', m.descripcion, 'umb', m.unidad))
                                    from public.materiales m
                                    where m.id in (select distinct (v #>> '{}')::uuid from jsonb_path_query(l.snapshot, 'lax $.**.material_id') v
                                                   where jsonb_typeof(v) = 'string')), '{}'::jsonb),
            'huella', l.snapshot_huella
        ) order by l.eliminado_at, l.id), '[]'::jsonb)
    into v_mas, v_res
    from lim l;
    return jsonb_build_object('generado', now(), 'hay_mas', coalesce(v_mas, false), 'eliminaciones', coalesce(v_res, '[]'::jsonb));
end;
$$;
revoke execute on function public.fn_fert_eliminaciones_para_bajar(integer) from public, anon;
grant  execute on function public.fn_fert_eliminaciones_para_bajar(integer) to authenticated;

-- ---- AGL confirma lo que guardó bien
create or replace function public.fn_fert_eliminaciones_confirmar(p_confirmaciones jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ok   jsonb;
    v_mal  jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'publicar')) then
        raise exception 'Tu rol no tiene permiso para confirmar copias de lo eliminado (Conexión AGL · publicar).' using errcode = '42501';
    end if;
    if p_confirmaciones is null or jsonb_typeof(p_confirmaciones) <> 'array' then
        raise exception 'Se esperaba una lista de {id, huella}.' using errcode = '22023';
    end if;

    -- solo donde la huella coincide: la copia ya vive en AGL
    update public.fert_eliminaciones e
       set snapshot = null, snapshot_bajado_at = coalesce(e.snapshot_bajado_at, now())
      from (select (x->>'id')::uuid as id, x->>'huella' as h from jsonb_array_elements(p_confirmaciones) x) c
     where e.id = c.id and e.snapshot is not null and e.snapshot_huella is not null and e.snapshot_huella = c.h;

    -- limpieza: ya bajadas hace más de 180 días
    delete from public.fert_eliminaciones e
     where e.snapshot is null and e.snapshot_bajado_at is not null and e.snapshot_bajado_at < now() - interval '180 days';

    -- (sentencias aparte: ven el efecto de las anteriores)
    select coalesce(jsonb_agg(c.id), '[]'::jsonb) into v_ok
      from (select (x->>'id')::uuid as id, x->>'huella' as h from jsonb_array_elements(p_confirmaciones) x) c
     where exists (select 1 from public.fert_eliminaciones e
                    where e.id = c.id and e.snapshot is null and e.snapshot_bajado_at is not null and e.snapshot_huella = c.h);
    select coalesce(jsonb_agg(c.id), '[]'::jsonb) into v_mal
      from (select (x->>'id')::uuid as id, x->>'huella' as h from jsonb_array_elements(p_confirmaciones) x) c
     where not exists (select 1 from public.fert_eliminaciones e
                        where e.id = c.id and e.snapshot is null and e.snapshot_bajado_at is not null and e.snapshot_huella = c.h);
    return jsonb_build_object('confirmadas', v_ok, 'rechazadas', v_mal);
end;
$$;
revoke execute on function public.fn_fert_eliminaciones_confirmar(jsonb) from public, anon;
grant  execute on function public.fn_fert_eliminaciones_confirmar(jsonb) to authenticated;

-- ---- la auditoría de la app: marca si la copia ya está en AGL
create or replace function public.fn_fert_eliminaciones_listar(p_limite integer default 200)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._fert_eliminar_exigir();
    return coalesce((
        select jsonb_agg(to_jsonb(x) order by x.eliminado_at desc) from (
            select e.id, e.tipo, e.documento_id, e.estacion, e.estacion2, e.fecha_documento, e.registrado_por_nombre,
                   e.resumen, e.motivo, e.eliminado_por_nombre, e.eliminado_at, e.conteos,
                   e.snapshot_bajado_at, (e.snapshot is null) as copia_en_agl
            from public.fert_eliminaciones e
            order by e.eliminado_at desc
            limit least(greatest(coalesce(p_limite, 200), 1), 1000)) x), '[]'::jsonb);
end;
$$;
revoke execute on function public.fn_fert_eliminaciones_listar(integer) from public, anon;
grant execute on function public.fn_fert_eliminaciones_listar(integer) to authenticated;

-- ---- «Ver copia»: null con gracia si ya se bajó a AGL
create or replace function public.fn_fert_eliminacion_copia(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._fert_eliminar_exigir();
    return (select e.snapshot from public.fert_eliminaciones e where e.id = p_id);   -- null si ya está en AGL
end;
$$;
revoke execute on function public.fn_fert_eliminacion_copia(uuid) from public, anon;
grant execute on function public.fn_fert_eliminacion_copia(uuid) to authenticated;

notify pgrst, 'reload schema';
