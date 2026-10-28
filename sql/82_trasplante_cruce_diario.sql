-- =====================================================================
-- 82 · TRASPLANTE: CRUCE MAESTRO DEL AVANCE DIARIO (PLAN ⟷ REAL)
--
-- Ejecutar en el SQL Editor DESPUÉS de la 81.
--
-- `v_siembras` (79/80) parte de lo SEMBRADO y le cuelga el plan: un lote
-- que el plan fechaba para un día y no se sembró no aparecía en el
-- reporte. Esta vista es el cruce completo:
--
--     siembras agrupadas  FULL OUTER JOIN  plan agrupado
--     por (temporada, fecha, ciclo, lote, variedad)
--
--   · sembrado sin plan  → mz_real = X, mz_plan = NULL  (origen 'real')
--   · plan sin siembra   → mz_real = NULL, mz_plan = Y  (origen 'plan')
--   · los dos            → mz_real = X, mz_plan = Y     (origen 'ambos')
--
-- `diferencia` = coalesce(real, 0) − coalesce(plan, 0). El plan SIN fecha no
-- entra: no se puede situar en ningún día.
--
-- Patrón 56/66: cruda `definer` en `interno`, expuesta con reja de
-- `trasplante_diario`. El eje «propietario» mira `usuarios` (uuid[] de
-- quienes capturaron la siembra de la fila; `array_agg` sobre uuid, nunca
-- sobre text[]): las filas sólo-plan no tienen dueño y ese alcance no las ve.
--
-- Idempotente.
-- =====================================================================

drop view if exists public.v_trasplante_avance_diario;

create or replace view interno.v_trasplante_avance_diario_crudo as
with real_ as (
    select s.temporada_id,
           s.fecha_siembra                          as fecha,
           s.ciclo::integer                         as ciclo,
           s.lote_temporada_id,
           s.variedad_id,
           sum(s.avance_mz)                         as mz_real,
           sum(coalesce(s.plantas_reportadas, 0))   as plantas,
           array_agg(distinct s.usuario_id) filter (where s.usuario_id is not null) as usuarios
    from public.siembras s
    group by 1, 2, 3, 4, 5
),
plan as (
    select p.temporada_id,
           p.fecha_siembra                          as fecha,
           p.ciclo::integer                         as ciclo,
           p.lote_temporada_id,
           p.variedad_id,
           sum(p.area_plan)                         as mz_plan
    from public.planes_siembra p
    where p.fecha_siembra is not null
    group by 1, 2, 3, 4, 5
),
cruce as (
    select coalesce(r.temporada_id, p.temporada_id)           as temporada_id,
           coalesce(r.fecha, p.fecha)                         as fecha,
           coalesce(r.ciclo, p.ciclo)                         as ciclo,
           coalesce(r.lote_temporada_id, p.lote_temporada_id) as lote_temporada_id,
           coalesce(r.variedad_id, p.variedad_id)             as variedad_id,
           r.mz_real,
           p.mz_plan,
           r.plantas,
           coalesce(r.usuarios, '{}'::uuid[])                 as usuarios
    from real_ r
    full outer join plan p
      on  p.temporada_id      = r.temporada_id
      and p.fecha             = r.fecha
      and p.ciclo             = r.ciclo
      and p.lote_temporada_id = r.lote_temporada_id
      and p.variedad_id       = r.variedad_id
)
select
    md5(c.temporada_id::text || c.fecha::text || c.ciclo::text
        || c.lote_temporada_id::text || c.variedad_id::text)          as id,
    c.temporada_id,
    c.fecha,
    extract(isoyear from c.fecha)::text
        || '-S' || lpad(extract(week from c.fecha)::text, 2, '0')     as semana,
    c.ciclo,
    c.lote_temporada_id,
    lo.nomenclatura                                                   as ut,
    lo.nombre                                                         as lote_nombre,
    lt.zona_id,
    z.nombre                                                          as zona,
    c.variedad_id,
    v.nombre                                                          as variedad,
    c.mz_real,
    c.mz_plan,
    coalesce(c.mz_real, 0) - coalesce(c.mz_plan, 0)                   as diferencia,
    c.plantas,
    case
        when c.mz_real is not null and c.mz_plan is not null then 'ambos'
        when c.mz_real is not null                           then 'real'
        else 'plan'
    end                                                               as origen,
    c.usuarios
from cruce c
join public.lotes_temporada lt on lt.id = c.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.variedades v       on v.id = c.variedad_id;

alter view interno.v_trasplante_avance_diario_crudo set (security_invoker = off);
revoke all on interno.v_trasplante_avance_diario_crudo from authenticated, anon;

comment on view interno.v_trasplante_avance_diario_crudo is
    'Cruce plan ⟷ real del trasplante por día, ciclo, lote y variedad (FULL OUTER JOIN). Cruda; la reja la pone public.v_trasplante_avance_diario (migración 82).';

create view public.v_trasplante_avance_diario as
select x.* from interno.v_trasplante_avance_diario_crudo x
where (select public.fn_permitido_de('trasplante_diario', 'ver'))
  and case (select public.fn_mi_alcance('trasplante_diario', 'ver'))
      when 'global'      then true
      when 'propietario' then (select auth.uid()) = any (x.usuarios)
      else public.fn_ve_lote_estricto(x.lote_temporada_id)
  end;

grant select on public.v_trasplante_avance_diario to authenticated;

-- Las dos agregaciones recorren la temporada por fecha.
create index if not exists siembras_temporada_fecha_idx
    on public.siembras (temporada_id, fecha_siembra);
create index if not exists planes_siembra_temporada_fecha_idx
    on public.planes_siembra (temporada_id, fecha_siembra);

-- =====================================================================
-- GUARDIANES
-- =====================================================================
do $$
declare v text;
begin
    select string_agg(c, ', ') into v
    from unnest(array['id', 'temporada_id', 'fecha', 'semana', 'ciclo', 'lote_temporada_id', 'ut',
                      'variedad', 'mz_real', 'mz_plan', 'diferencia', 'origen', 'usuarios']) c
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'v_trasplante_avance_diario'
                        and column_name = c);
    if v is not null then
        raise exception '82 · v_trasplante_avance_diario quedó sin: %', v;
    end if;

    v := pg_get_viewdef('public.v_trasplante_avance_diario'::regclass, true);
    if v not like '%fn_permitido_de%' or v not like '%fn_ve_lote_estricto%'
       or v not like '%auth.uid()%' then
        raise exception '82 · La expuesta salió sin reja.';
    end if;

    if has_schema_privilege('authenticated', 'interno', 'usage')
       or has_table_privilege('authenticated', 'interno.v_trasplante_avance_diario_crudo', 'select') then
        raise exception '82 · La cruda quedó alcanzable por authenticated.';
    end if;

    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'interno' and c.relname = 'v_trasplante_avance_diario_crudo'
                     and coalesce(c.reloptions::text, '') ~ 'security_invoker=(off|false)') then
        raise exception '82 · La cruda no es definer.';
    end if;
end $$;
