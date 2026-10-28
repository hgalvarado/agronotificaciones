-- =====================================================================
-- 79 · TRASPLANTE: AVANCE DIARIO, PLAN CONTRA REAL
--
-- Ejecutar en el SQL Editor DESPUÉS de la 78.
--
-- La sección «2. Avance diario» del reporte lee `v_siembras` por rango.
-- Cada siembra gana lo que el PLAN decía para su lote y ciclo:
--
--   plan_variedad     variedades planificadas para ese lote/ciclo en esa
--                     FECHA; si el plan no fecha nada ese día, las del
--                     lote/ciclo completo. Texto, separadas por coma.
--   plan_mz           manzanas planificadas para ese lote/ciclo en esa
--                     fecha. NULL = el plan no puso nada ese día (no es 0:
--                     un plan sin fecha no dice «nada», dice «no sé»).
--   plan_mz_variedad  manzanas del plan para ese lote/ciclo y la MISMA
--                     variedad que se sembró (sin mirar fecha).
--
-- Patrón de la 57/78: la cruda se ENVUELVE con su propia definición
-- (`pg_get_viewdef`) y no se reescribe a mano. `string_agg` sobre TEXTO
-- (nombre), nunca `array_agg` sobre un `text[]`.
--
-- La expuesta se rearma con la reja de la 66:
-- trasplante_diario · recorte por lote estricto · con dueño.
--
-- Idempotente.
-- =====================================================================

do $$
declare
    v_def text;
begin
    if to_regclass('interno.v_siembras_crudo') is null then
        raise exception '79 · No existe interno.v_siembras_crudo: faltan la 56/66.';
    end if;

    -- La expuesta fijó su lista de columnas al crearse: se tira antes.
    drop view if exists public.v_siembras;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'interno' and table_name = 'v_siembras_crudo'
          and column_name = 'plan_mz'
    ) then
        v_def := rtrim(btrim(pg_get_viewdef('interno.v_siembras_crudo'::regclass, true)), ';');
        execute format($v$
            create or replace view interno.v_siembras_crudo as
            select c.*,
                   coalesce(pd.variedades, pl.variedades) as plan_variedad,
                   pd.mz                                  as plan_mz,
                   pv.mz                                  as plan_mz_variedad
            from (%s) c
            -- Lo planificado para ESE día en ese lote y ciclo.
            left join lateral (
                select string_agg(distinct v.nombre, ', ' order by v.nombre) as variedades,
                       sum(p.area_plan)                                       as mz
                from public.planes_siembra p
                join public.variedades v on v.id = p.variedad_id
                where p.lote_temporada_id = c.lote_temporada_id
                  and p.ciclo = c.ciclo
                  and p.fecha_siembra = c.fecha_siembra
                having count(*) > 0
            ) pd on true
            -- Sin plan fechado ese día: qué variedades lleva el lote/ciclo.
            left join lateral (
                select string_agg(distinct v.nombre, ', ' order by v.nombre) as variedades
                from public.planes_siembra p
                join public.variedades v on v.id = p.variedad_id
                where p.lote_temporada_id = c.lote_temporada_id
                  and p.ciclo = c.ciclo
            ) pl on true
            -- El plan de la variedad que de verdad se sembró.
            left join lateral (
                select sum(p.area_plan) as mz
                from public.planes_siembra p
                where p.lote_temporada_id = c.lote_temporada_id
                  and p.ciclo = c.ciclo
                  and p.variedad_id = c.variedad_id
            ) pv on true
        $v$, v_def);
    else
        raise notice '79 · La cruda ya trae el plan; sólo se rearma la expuesta.';
    end if;

    execute 'alter view interno.v_siembras_crudo set (security_invoker = off)';
    execute 'revoke all on interno.v_siembras_crudo from authenticated, anon';
end $$;

-- El plan se busca por lote/ciclo/fecha en cada fila del rango.
create index if not exists planes_siembra_lote_ciclo_fecha_idx
    on public.planes_siembra (lote_temporada_id, ciclo, fecha_siembra);

-- Reja canónica (66): trasplante_diario · lote estricto · dueño.
create view public.v_siembras as
select x.* from interno.v_siembras_crudo x
where (select public.fn_permitido_de('trasplante_diario', 'ver'))
  and case (select public.fn_mi_alcance('trasplante_diario', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else public.fn_ve_lote_estricto(x.lote_temporada_id)
  end;

grant select on public.v_siembras to authenticated;

-- =====================================================================
-- GUARDIANES
-- =====================================================================
do $$
declare v text;
begin
    select string_agg(c, ', ') into v
    from unnest(array['plan_variedad', 'plan_mz', 'plan_mz_variedad',
                      'id', 'usuario_id', 'lote_temporada_id', 'fecha_siembra',
                      'ciclo', 'variedad_id', 'avance_mz', 'plan_lote']) c
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'v_siembras'
                        and column_name = c);
    if v is not null then
        raise exception '79 · v_siembras quedó sin: %', v;
    end if;

    v := pg_get_viewdef('public.v_siembras'::regclass, true);
    if v not like '%fn_permitido_de%' or v not like '%fn_ve_lote_estricto%'
       or v not like '%auth.uid()%' then
        raise exception '79 · La expuesta perdió la reja.';
    end if;

    if has_schema_privilege('authenticated', 'interno', 'usage')
       or has_table_privilege('authenticated', 'interno.v_siembras_crudo', 'select') then
        raise exception '79 · La cruda quedó alcanzable por authenticated.';
    end if;

    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'interno' and c.relname = 'v_siembras_crudo'
                     and coalesce(c.reloptions::text, '') ~ 'security_invoker=(off|false)') then
        raise exception '79 · La cruda dejó de ser definer.';
    end if;
end $$;
