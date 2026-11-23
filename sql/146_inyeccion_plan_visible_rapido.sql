-- =====================================================================
-- 146 · INYECCIÓN · FILTRO DE ZONAS DEL PLAN EN UNA SOLA PASADA (arregla «statement timeout»)
-- =====================================================================
-- Problema (producción, 2026-11-23): para quien tiene recorte de zonas (no admin / sin «Todas las zonas») `fn_iny_estado_campo`
-- llamaba `_iny_plan_visible(...)` POR CADA línea del plan (miles). Para las líneas sin lote_temporada_id (todas las de lotes sin turno)
-- cada llamada recorría lotes × temporadas normalizando textos: costo = líneas × lotes → pasaba el tiempo máximo y el teléfono
-- mostraba «canceling statement due to statement timeout». Los administradores no lo notaban (sin recorte de zonas el filtro sale al instante).
--
-- Arreglo: `_iny_plan_ids_visibles()` devuelve de una vez los ids de las líneas visibles (una sola pasada con joins) y la función
-- del teléfono usa `p.id in (select …)` (se calcula una vez por consulta). Mismo resultado que antes.
-- Correr DESPUÉS de la 141 y 142. Idempotente. Parche con marca propia 146.
-- Si se vuelve a correr la 129, 132, 139, 141 o 142 (redefinen fn_iny_estado_campo), CORRER LA 146 OTRA VEZ.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.fn_iny_estado_campo(date)') is null
       or to_regprocedure('public._iny_plan_visible(uuid,text,text)') is null then
        raise exception '146: falta correr la 129, 139, 141 y 142 antes.';
    end if;
end $$;

-- ids de las líneas del plan que son de lotes de las zonas de la persona (misma regla que _iny_plan_visible, en un solo paso)
create or replace function public._iny_plan_ids_visibles()
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
    with zonas as (
        select pz.zona_id from public.perfiles_zonas pz where pz.perfil_id = (select auth.uid())
    ), lt as (       -- lotes de temporada en zonas de la persona, con su nombre normalizado una sola vez
        select l.id, l.zona_id,
               public._iny_norm_lote(lc.nomenclatura) as nl,
               public._fert_llave(t.nombre) as nt
          from public.lotes_temporada l
          left join public.lotes lc on lc.id = l.lote_id
          left join public.temporadas t on t.id = l.temporada_id
         where l.zona_id in (select zona_id from zonas)
    )
    select p.id from public.iny_plan p
     where not public.fn_tiene_zonas()
        or p.lote_temporada_id in (select id from lt)
        or (p.lote_temporada_id is null
            and exists (select 1 from lt
                         where lt.nl = public._iny_norm_lote(p.lote)
                           and lt.nt = public._fert_llave(p.temporada)))
$$;
revoke execute on function public._iny_plan_ids_visibles() from public, anon;
grant  execute on function public._iny_plan_ids_visibles() to authenticated;

create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer;
begin
    if position(p_marca in v_def) > 0 then
        return;
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '146: en % se esperaba 1 aparición de «%» y hay % (¿falta correr la 141?)', p_fn, v_viejo, v_n;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
end $$;

select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$and public._iny_plan_visible(p.lote_temporada_id, p.lote, p.temporada)$p$,
    $p$and p.id in (select public._iny_plan_ids_visibles()) /* 146:plan-visible */$p$,
    '146:plan-visible');

-- selector de lotes del teléfono: las temporadas con plan se calculan UNA vez (antes, por cada lote se recorría todo iny_plan normalizando texto)
create or replace function public._iny_lotes_campo()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
    with tp as (select distinct public._fert_llave(p.temporada) as k from public.iny_plan p)
    select coalesce(jsonb_agg(jsonb_build_object(
               'lote_temporada_id', lt.id, 'nomenclatura', l.nomenclatura, 'nombre', l.nombre,
               'temporada', t.nombre, 'activa', t.activa, 'zona_id', lt.zona_id, 'zona', z.nombre)
               order by l.nomenclatura, t.nombre), '[]'::jsonb)
      from public.lotes_temporada lt
      join public.lotes l on l.id = lt.lote_id and l.activo
      join public.temporadas t on t.id = lt.temporada_id
      left join public.zonas z on z.id = lt.zona_id
     where lt.activo
       and (t.activa or public._fert_llave(t.nombre) in (select k from tp))
       and public._iny_zona_visible(lt.zona_id)
$$;
revoke execute on function public._iny_lotes_campo() from public, anon, authenticated;

notify pgrst, 'reload schema';
