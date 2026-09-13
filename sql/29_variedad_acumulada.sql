-- =====================================================================
-- MIGRACIÓN 29 · El cumplimiento por variedad, acumulado a la fecha de corte
-- =====================================================================
-- El reporte comparaba peras con manzanas: lo SEMBRADO se recortaba a la
-- fecha de corte, pero el PLAN era el de la temporada entera. Un reporte
-- del 15 de septiembre enseñaba 200 mz plan contra 40 sembradas y decía
-- 20 % de cumplimiento, cuando a esa fecha sólo tocaban 45 y el avance
-- real era del 89 %.
--
-- Ahora los dos lados se cortan por la misma fecha: el plan cuenta lo que
-- estaba PREVISTO sembrar hasta ese día, según `planes_siembra.fecha_siembra`.
--
-- Las líneas del plan sin fecha no entran —no se les puede decir si
-- tocaban antes o después del corte— y por eso la función devuelve
-- también `plan_sin_fecha`: el reporte lo enseña al pie, porque un plan
-- sin fechar hace que la brecha salga siempre a favor y nadie sabría por
-- qué.
--
-- DROP + CREATE: cambia la forma de la tabla que devuelve.
-- =====================================================================

drop function if exists public.fn_trasplante_por_variedad(uuid, date);

create function public.fn_trasplante_por_variedad(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    ciclo          smallint,
    variedad       text,
    cultivo        text,
    area_plan      numeric,
    area_real      numeric,
    pct            numeric,
    plantas        numeric,
    plan_sin_fecha numeric
)
language sql stable security invoker as $$
    with plan as (
        select p.ciclo, p.variedad_id,
               -- Lo que tocaba sembrar hasta el corte.
               sum(p.area_plan) filter (
                   where p.fecha_siembra is not null
                     and (p_hasta is null or p.fecha_siembra <= p_hasta)
               ) as area_plan,
               -- Lo que no se puede situar en el tiempo, para avisarlo.
               sum(p.area_plan) filter (where p.fecha_siembra is null) as sin_fecha
        from public.planes_siembra p
        where p.temporada_id = p_temporada_id
        group by p.ciclo, p.variedad_id
    ),
    real_ as (
        select s.ciclo, s.variedad_id,
               sum(s.avance_mz) as area_real,
               sum(s.plantas_reportadas) as plantas
        from public.siembras s
        where s.temporada_id = p_temporada_id
          and (p_hasta is null or s.fecha_siembra <= p_hasta)
        group by s.ciclo, s.variedad_id
    ),
    llaves as (
        select ciclo, variedad_id from plan
        union
        select ciclo, variedad_id from real_
    )
    select
        k.ciclo,
        v.nombre,
        v.producto,
        coalesce(p.area_plan, 0),
        coalesce(r.area_real, 0),
        case when coalesce(p.area_plan, 0) > 0
             then round(coalesce(r.area_real, 0) / p.area_plan * 100, 1) end,
        coalesce(r.plantas, 0),
        coalesce(p.sin_fecha, 0)
    from llaves k
    join public.variedades v on v.id = k.variedad_id
    left join plan p  on p.ciclo = k.ciclo and p.variedad_id = k.variedad_id
    left join real_ r on r.ciclo = k.ciclo and r.variedad_id = k.variedad_id
    -- Una combinación que ya no tiene ni plan vigente ni siembra a la
    -- fecha no es una fila: es una línea de ceros que sólo estorba.
    where coalesce(p.area_plan, 0) > 0
       or coalesce(r.area_real, 0) > 0
       or coalesce(p.sin_fecha, 0) > 0
    order by k.ciclo, v.nombre
$$;

comment on function public.fn_trasplante_por_variedad(uuid, date) is
    'Cumplimiento por variedad y ciclo, acumulado desde el inicio de la temporada hasta la fecha de corte. El plan se corta por la fecha prevista de siembra, igual que lo real; `plan_sin_fecha` son las manzanas planificadas que no se pueden situar en el tiempo.';
