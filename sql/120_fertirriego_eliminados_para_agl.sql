-- =====================================================================
-- 120 · FERTIRRIEGO · LO ELIMINADO POR COMPLETO (119) SE PURGA TAMBIÉN EN AGL
-- =====================================================================
-- AGL baja los movimientos por cursor y los ACUMULA en sus archivos; si después se elimina un registro (119), esos
-- movimientos ya bajados seguirían en los informes de AGL. Esta función le da a AGL solo IDENTIFICADORES de lo
-- eliminado (cursor e id de movimiento, documento, operaciones) para que los quite. NO expone motivo, nombres,
-- quién eliminó ni la copia del documento.
-- Correr DESPUÉS de la 119. Solo lectura (stable), idempotente. Mismo permiso que fn_fert_exportar.
-- =====================================================================

-- (121) Los identificadores de los movimientos se guardan aparte para que sigan sirviendo cuando el snapshot se
-- baje a AGL y se borre de aquí. Si la 121 aún no corrió, se leen del snapshot como antes.
alter table public.fert_eliminaciones add column if not exists movimientos_ids jsonb;

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
