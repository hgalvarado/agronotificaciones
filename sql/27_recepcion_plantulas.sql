-- =====================================================================
-- MIGRACIÓN 27 · Recepción de plántulas y limpieza de la siembra diaria
-- =====================================================================
-- Tres cosas:
--
--   A. Se va `denominacion`. No se usaba en ningún reporte y una columna
--      que nadie llena sólo sirve para que alguien la llene mal.
--   B. Entra la recepción de plántulas: lo que el vivero factura, contra
--      lo que la siembra diaria consume.
--   C. El cumplimiento semanal aprende a decir cuánto TOCABA sembrar esa
--      semana, no sólo cuánto se sembró: sin el plan, la línea de la
--      gráfica no dice si se va bien o mal.
-- =====================================================================


-- =====================================================================
-- PARTE A · FUERA LA DENOMINACIÓN
-- =====================================================================
-- La vista se recrea porque `drop column` sobre una columna que una
-- vista expone falla; se baja primero y se vuelve a levantar sin ella.
-- =====================================================================

drop view if exists public.v_siembras;

alter table public.siembras drop column if exists denominacion;


-- =====================================================================
-- PARTE B · LA RECEPCIÓN
-- =====================================================================
-- El total es una columna GENERADA. Facturadas × costo unitario no es un
-- dato que alguien escriba: es una multiplicación, y guardarla como
-- campo normal es firmar que algún día no cuadre con sus dos factores.
-- =====================================================================

create table if not exists public.recepcion_plantulas (
    id                  uuid primary key default gen_random_uuid(),
    temporada_id        uuid not null references public.temporadas(id),
    variedad_id         uuid not null references public.variedades(id),
    fecha               date not null,
    plantulas_enviadas  numeric(12,2),
    plantulas_facturadas numeric(12,2) not null default 0 check (plantulas_facturadas >= 0),
    costo_unitario      numeric(12,4) not null default 0 check (costo_unitario >= 0),
    numero_factura      text,
    lote_semilla        text,
    bandejas_enviadas   numeric(12,2),
    documento_sap       text,
    observaciones       text,
    usuario_id          uuid references public.perfiles(id),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    total numeric(14,2) generated always as (
        round(plantulas_facturadas * costo_unitario, 2)
    ) stored
);

comment on table public.recepcion_plantulas is
    'Plántulas recibidas del vivero. El total se calcula solo: facturadas por costo unitario.';

create index if not exists idx_recepcion_temporada on public.recepcion_plantulas (temporada_id);
create index if not exists idx_recepcion_variedad on public.recepcion_plantulas (variedad_id);
create index if not exists idx_recepcion_fecha on public.recepcion_plantulas (fecha);

drop trigger if exists trg_recepcion_updated on public.recepcion_plantulas;
create trigger trg_recepcion_updated
    before update on public.recepcion_plantulas
    for each row execute function public.fn_touch_updated_at();

alter table public.recepcion_plantulas enable row level security;

drop policy if exists recepcion_select on public.recepcion_plantulas;
create policy recepcion_select on public.recepcion_plantulas for select
    using ((select public.fn_tiene_permiso('trasplante','ver')));
drop policy if exists recepcion_insert on public.recepcion_plantulas;
create policy recepcion_insert on public.recepcion_plantulas for insert
    with check ((select public.fn_tiene_permiso('trasplante','crear')));
drop policy if exists recepcion_update on public.recepcion_plantulas;
create policy recepcion_update on public.recepcion_plantulas for update
    using ((select public.fn_tiene_permiso('trasplante','editar')));
drop policy if exists recepcion_delete on public.recepcion_plantulas;
create policy recepcion_delete on public.recepcion_plantulas for delete
    using ((select public.fn_tiene_permiso('trasplante','eliminar')));


create or replace view public.v_recepcion_plantulas as
select
    r.id,
    r.temporada_id,
    r.fecha,
    r.variedad_id,
    v.nombre      as variedad,
    v.codigo_sap  as variedad_sap,
    v.producto    as cultivo,
    r.plantulas_enviadas,
    r.plantulas_facturadas,
    r.costo_unitario,
    r.total,
    r.numero_factura,
    r.lote_semilla,
    r.bandejas_enviadas,
    r.documento_sap,
    r.observaciones,
    r.created_at
from public.recepcion_plantulas r
join public.variedades v on v.id = r.variedad_id;

alter view public.v_recepcion_plantulas set (security_invoker = on);


-- =====================================================================
-- PARTE C · LA LIQUIDACIÓN
-- =====================================================================
-- «Plántulas facturadas contra plántulas consumidas.» Las consumidas
-- salen de la siembra diaria: son las mismas plantas, contadas al
-- ponerlas en el suelo en vez de al recibirlas.
--
-- Un `full outer join` de mentira —unión de llaves más dos `left join`—
-- porque hace falta que salgan las variedades que sólo tienen recepción
-- y las que sólo tienen siembra: una variedad facturada y sin sembrar es
-- justamente lo que este panel viene a enseñar.
-- =====================================================================

create or replace function public.fn_trasplante_liquidacion_plantulas(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    variedad     text,
    cultivo      text,
    facturadas   numeric,
    enviadas     numeric,
    consumidas   numeric,
    pendientes   numeric,
    pct          numeric,
    costo_total  numeric
)
language sql stable security invoker as $$
    with recibido as (
        select r.variedad_id,
               sum(r.plantulas_facturadas) as facturadas,
               sum(coalesce(r.plantulas_enviadas, 0)) as enviadas,
               sum(r.total) as costo_total
        from public.recepcion_plantulas r
        where r.temporada_id = p_temporada_id
          and (p_hasta is null or r.fecha <= p_hasta)
        group by r.variedad_id
    ),
    consumido as (
        select s.variedad_id, sum(coalesce(s.plantas_reportadas, 0)) as consumidas
        from public.siembras s
        where s.temporada_id = p_temporada_id
          and (p_hasta is null or s.fecha_siembra <= p_hasta)
        group by s.variedad_id
    ),
    llaves as (
        select variedad_id from recibido
        union
        select variedad_id from consumido
    )
    select
        v.nombre,
        v.producto,
        coalesce(r.facturadas, 0),
        coalesce(r.enviadas, 0),
        coalesce(c.consumidas, 0),
        coalesce(r.facturadas, 0) - coalesce(c.consumidas, 0),
        case when coalesce(r.facturadas, 0) > 0
             then round(coalesce(c.consumidas, 0) / r.facturadas * 100, 1) end,
        coalesce(r.costo_total, 0)
    from llaves k
    join public.variedades v on v.id = k.variedad_id
    left join recibido r  on r.variedad_id = k.variedad_id
    left join consumido c on c.variedad_id = k.variedad_id
    order by v.nombre
$$;

comment on function public.fn_trasplante_liquidacion_plantulas(uuid, date) is
    'Plántulas facturadas contra las consumidas en la siembra diaria, por variedad. Lo pendiente puede salir negativo: eso significa que se sembró más de lo facturado.';


-- =====================================================================
-- PARTE D · LA SEMANA, CON SU PLAN
-- =====================================================================
-- «Lo Planeado, lo Real y la Diferencia.»
--
-- El plan por semana sale de `planes_siembra.fecha_siembra`: la semana en
-- la que estaba previsto sembrar cada lote. Las filas del plan sin fecha
-- no entran —no se les puede asignar semana— y por eso el pie de la
-- gráfica avisa cuando hay plan sin fechar: si no, la brecha saldría
-- siempre a favor y nadie sabría por qué.
--
-- DROP + CREATE: cambia la forma de la tabla que devuelve.
-- =====================================================================

drop function if exists public.fn_trasplante_por_semana(uuid, date);

create function public.fn_trasplante_por_semana(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    semana       text,
    desde        date,
    hasta        date,
    ciclo        smallint,
    area_plan    numeric,
    area_real    numeric,
    plantas      numeric,
    acumulado    numeric
)
language sql stable security invoker as $$
    with real_ as (
        select s.semana,
               min(s.fecha_siembra) as desde,
               max(s.fecha_siembra) as hasta,
               s.ciclo,
               sum(s.avance_mz)          as area_real,
               sum(coalesce(s.plantas_reportadas, 0)) as plantas
        from public.siembras s
        where s.temporada_id = p_temporada_id
          and (p_hasta is null or s.fecha_siembra <= p_hasta)
        group by s.semana, s.ciclo
    ),
    plan as (
        select
            extract(isoyear from p.fecha_siembra)::text
            || '-S' || lpad(extract(week from p.fecha_siembra)::text, 2, '0') as semana,
            p.ciclo,
            min(p.fecha_siembra) as desde,
            max(p.fecha_siembra) as hasta,
            sum(p.area_plan) as area_plan
        from public.planes_siembra p
        where p.temporada_id = p_temporada_id
          and p.fecha_siembra is not null
          and (p_hasta is null or p.fecha_siembra <= p_hasta)
        group by 1, p.ciclo
    ),
    llaves as (
        select semana, ciclo from real_
        union
        select semana, ciclo from plan
    ),
    juntas as (
        select
            k.semana,
            coalesce(r.desde, p.desde) as desde,
            coalesce(r.hasta, p.hasta) as hasta,
            k.ciclo,
            coalesce(p.area_plan, 0)  as area_plan,
            coalesce(r.area_real, 0)  as area_real,
            coalesce(r.plantas, 0)    as plantas
        from llaves k
        left join real_ r on r.semana = k.semana and r.ciclo = k.ciclo
        left join plan  p on p.semana = k.semana and p.ciclo = k.ciclo
    )
    select j.semana, j.desde, j.hasta, j.ciclo, j.area_plan, j.area_real, j.plantas,
           sum(j.area_real) over (order by j.semana, j.ciclo
                                  rows between unbounded preceding and current row)
    from juntas j
    order by j.semana, j.ciclo
$$;

comment on function public.fn_trasplante_por_semana(uuid, date) is
    'Siembra por semana ISO: lo planificado, lo real y el acumulado. El plan de una semana sale de la fecha prevista en el plan de siembra.';


-- =====================================================================
-- PARTE E · LA VISTA DE SIEMBRAS, YA SIN DENOMINACIÓN
-- =====================================================================

create or replace view public.v_siembras as
select
    s.id,
    s.temporada_id,
    s.lote_temporada_id,
    s.fecha_siembra,
    s.semana,
    s.ciclo,
    s.lote_variedad,
    s.avance_mz,
    s.plantas_reportadas,
    s.plantas_mz,
    s.observaciones,
    lo.nomenclatura   as ut,
    lo.nombre         as lote_nombre,
    z.nombre          as zona,
    z.responsable     as encargado,
    v.id              as variedad_id,
    v.nombre          as variedad,
    v.codigo_sap      as variedad_sap,
    v.producto        as cultivo,
    pe.nombre         as usuario_nombre,
    s.usuario_id,
    s.created_at,
    -- Acumulado y cumplimiento POR LOTE Y CICLO, calculados en la base.
    --
    -- La pantalla los pide para cada fila y la cuenta es la misma: lo
    -- sembrado en ese lote y ciclo hasta esa fecha, contra lo que el plan
    -- dice para ese lote y ciclo. Hacerlo en JavaScript obligaría a
    -- recorrer todas las siembras por cada fila.
    sum(s.avance_mz) over (
        partition by s.lote_temporada_id, s.ciclo
        order by s.fecha_siembra, s.created_at
        rows between unbounded preceding and current row
    ) as acumulado_lote,
    (
        select coalesce(sum(p.area_plan), 0)
        from public.planes_siembra p
        where p.lote_temporada_id = s.lote_temporada_id
          and p.ciclo = s.ciclo
    ) as plan_lote
from public.siembras s
join public.lotes_temporada lt on lt.id = s.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.variedades v       on v.id = s.variedad_id
left join public.perfiles pe   on pe.id = s.usuario_id;

alter view public.v_siembras set (security_invoker = on);

comment on view public.v_siembras is
    'Siembra diaria con su semana, sus plantas por manzana y el acumulado del lote y ciclo contra su plan.';
