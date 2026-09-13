-- =====================================================================
-- MIGRACIÓN 15 · Proveedores por labor, tablero con filtros y corte de
--                fecha para el reporte gerencial
-- =====================================================================
-- Cuatro pedidos suyos:
--
--   1. «Catálogo de labores: añadir opción/checkbox para habilitar
--      proveedores de plástico y manguera de forma individual por labor.»
--      → PARTE A. Hoy los dos selectores aparecen en TODA labor con sólo
--        que el catálogo de proveedores tenga a alguien. Pasan a ser dos
--        interruptores de la labor.
--
--   2. «Importación masiva … de labores vía Excel.»
--      → No necesita base de datos: se resuelve en la plantilla y el
--        importador. Los dos interruptores de la PARTE A entran solos en
--        el importador porque son columnas normales.
--
--   3. «Dashboard de avances … filtros por lote, zona, labor y categoría
--      de labor.»
--      → PARTES B y C.
--
--   4. «Reporte gerencial … selector de fecha para “Avance del día”,
--      permitiendo generar reportes retroactivos.»
--      → PARTE D: las dos funciones del reporte aceptan un corte de
--        fecha. Sin corte, un reporte de la semana pasada mostraría el
--        avance de hoy y no cuadraría con lo que se envió ese día.
-- =====================================================================


-- =====================================================================
-- PARTE A · CADA LABOR DICE SI PIDE PROVEEDOR
-- =====================================================================

alter table public.labores
    add column if not exists usa_proveedor_plastico boolean not null default false,
    add column if not exists usa_proveedor_manguera boolean not null default false;

comment on column public.labores.usa_proveedor_plastico is
    'Si está en true, la captura de esta labor pide proveedor de plástico por línea.';
comment on column public.labores.usa_proveedor_manguera is
    'Si está en true, la captura de esta labor pide proveedor de manguera por línea.';

-- Arranque sin trabajo manual. Dos fuentes, en este orden:
--
--   a) Lo que ya se capturó. Si en alguna labor alguien eligió un
--      proveedor, esa labor evidentemente lo usa. Es el dato más fiable
--      que hay porque salió de la operación, no de un nombre.
update public.labores lb
set usa_proveedor_plastico = true
where not lb.usa_proveedor_plastico
  and exists (
      select 1
      from public.registro_detalle rd
      join public.registros r on r.id = rd.registro_id
      where r.labor_id = lb.id
        and rd.proveedor_plastico_id is not null
  );

update public.labores lb
set usa_proveedor_manguera = true
where not lb.usa_proveedor_manguera
  and exists (
      select 1
      from public.registro_detalle rd
      join public.registros r on r.id = rd.registro_id
      where r.labor_id = lb.id
        and rd.proveedor_manguera_id is not null
  );

--   b) El nombre, para las labores que todavía no tienen captura. El
--      emplasticado pone plástico y manguera en la misma pasada: así sale
--      en su reporte de «DETALLE AVANCE DIARIO DE EMPLASTICADO», que
--      lleva las dos columnas de proveedor.
update public.labores
set usa_proveedor_plastico = true
where not usa_proveedor_plastico
  and lower(nombre) like '%plastic%';

update public.labores
set usa_proveedor_manguera = true
where not usa_proveedor_manguera
  and (lower(nombre) like '%plastic%' or lower(nombre) like '%mangue%');


-- =====================================================================
-- PARTE B · TABLERO CON FILTROS
-- =====================================================================
-- «Dashboard de avances: implementar un panel interactivo con filtros
--  dinámicos por: lote, zona, labor y categoría de labor.»
--
-- La regla que hace honesto el porcentaje: los filtros de lote y de zona
-- recortan TAMBIÉN el plan, no sólo lo ejecutado. Si se filtra una zona
-- y el plan siguiera siendo el de la finca completa, el avance de esa
-- zona saldría en 3% y el tablero mentiría.
--
-- En cambio los filtros de labor, categoría y fecha NO recortan el plan:
-- un plan no tiene labor ni fecha —es el área que hay que recorrer— y
-- cada labor del proceso recorre esa misma área.
-- =====================================================================

create or replace function public.fn_tablero_avance(
    p_temporada_id       uuid,
    p_proceso_id         uuid default null,
    p_zona_id            uuid default null,
    p_lote_temporada_id  uuid default null,
    p_labor_id           uuid default null,
    p_categoria_labor_id uuid default null,
    p_desde              date default null,
    p_hasta              date default null
) returns table (
    labor_id        uuid,
    labor_nombre    text,
    categoria_id    uuid,
    categoria_labor text,
    proceso_id      uuid,
    proceso_codigo  text,
    area_plan       numeric,
    mz_avance       numeric,
    mz_pendiente    numeric,
    pct_avance      numeric,
    lotes_con_plan  bigint,
    lotes_tocados   bigint,
    lineas          bigint,
    primera_fecha   date,
    ultima_fecha    date
)
language sql stable security invoker as $$
    with plan as (
        -- Un plan por proceso: si no se filtró proceso, cada labor se
        -- mide contra el plan del proceso al que pertenece su tarea.
        select pl.proceso_id,
               sum(pl.area_plan)               as area_plan,
               count(distinct pl.lote_temporada_id) as lotes
        from public.planes pl
        join public.lotes_temporada lt on lt.id = pl.lote_temporada_id
        where pl.temporada_id = p_temporada_id
          and (p_proceso_id is null or pl.proceso_id = p_proceso_id)
          and (p_zona_id is null or lt.zona_id = p_zona_id)
          and (p_lote_temporada_id is null or pl.lote_temporada_id = p_lote_temporada_id)
        group by pl.proceso_id
    ),
    hecho as (
        select lb.id                                  as labor_id,
               lb.nombre                              as labor_nombre,
               lb.categoria_labor_id                  as categoria_id,
               ts.proceso_id                          as proceso_id,
               sum(rd.avance_mz)                      as mz,
               count(distinct rd.lote_temporada_id)   as lotes,
               count(*)                               as lineas,
               min(rd.fecha)                          as primera,
               max(rd.fecha)                          as ultima
        from public.registro_detalle rd
        join public.registros r        on r.id  = rd.registro_id
        join public.labores lb         on lb.id = r.labor_id
        join public.tareas_sap ts      on ts.id = r.tarea_id
        join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
        where lt.temporada_id = p_temporada_id
          and rd.avance_mz is not null
          and (p_proceso_id is null or ts.proceso_id = p_proceso_id)
          and (p_zona_id is null or lt.zona_id = p_zona_id)
          and (p_lote_temporada_id is null or rd.lote_temporada_id = p_lote_temporada_id)
          and (p_labor_id is null or lb.id = p_labor_id)
          and (p_categoria_labor_id is null or lb.categoria_labor_id = p_categoria_labor_id)
          and (p_desde is null or rd.fecha >= p_desde)
          and (p_hasta is null or rd.fecha <= p_hasta)
        group by lb.id, lb.nombre, lb.categoria_labor_id, ts.proceso_id
    )
    select
        h.labor_id,
        h.labor_nombre,
        h.categoria_id,
        cl.nombre,
        h.proceso_id,
        ps.codigo,
        coalesce(p.area_plan, 0),
        coalesce(h.mz, 0),
        greatest(coalesce(p.area_plan, 0) - coalesce(h.mz, 0), 0),
        case when coalesce(p.area_plan, 0) > 0
             then round(coalesce(h.mz, 0) * 100.0 / p.area_plan, 2)
             else null end,
        coalesce(p.lotes, 0),
        h.lotes,
        h.lineas,
        h.primera,
        h.ultima
    from hecho h
    left join plan p on p.proceso_id = h.proceso_id
    left join public.categorias_labor cl on cl.id = h.categoria_id
    left join public.procesos_sap ps     on ps.id = h.proceso_id
    order by coalesce(h.mz, 0) desc
$$;


-- =====================================================================
-- PARTE C · EL MISMO TABLERO, ABIERTO POR ZONA
-- =====================================================================
-- Los mismos filtros, para contestar «¿y quién va atrasado?». El plan se
-- recorta igual que arriba, salvo el filtro de zona: aquí la zona es la
-- fila, así que filtrar por una deja una sola fila y sigue cuadrando.
-- =====================================================================

create or replace function public.fn_tablero_por_zona(
    p_temporada_id       uuid,
    p_proceso_id         uuid default null,
    p_zona_id            uuid default null,
    p_lote_temporada_id  uuid default null,
    p_labor_id           uuid default null,
    p_categoria_labor_id uuid default null,
    p_desde              date default null,
    p_hasta              date default null
) returns table (
    zona_id       uuid,
    zona          text,
    encargado     text,
    area_plan     numeric,
    mz_avance     numeric,
    mz_pendiente  numeric,
    pct_avance    numeric,
    lotes_tocados bigint,
    ultima_fecha  date
)
language sql stable security invoker as $$
    with plan as (
        select lt.zona_id, sum(pl.area_plan) as area_plan
        from public.planes pl
        join public.lotes_temporada lt on lt.id = pl.lote_temporada_id
        where pl.temporada_id = p_temporada_id
          and (p_proceso_id is null or pl.proceso_id = p_proceso_id)
          and (p_zona_id is null or lt.zona_id = p_zona_id)
          and (p_lote_temporada_id is null or pl.lote_temporada_id = p_lote_temporada_id)
        group by lt.zona_id
    ),
    hecho as (
        select lt.zona_id,
               sum(rd.avance_mz)                    as mz,
               count(distinct rd.lote_temporada_id) as lotes,
               max(rd.fecha)                        as ultima
        from public.registro_detalle rd
        join public.registros r        on r.id  = rd.registro_id
        join public.labores lb         on lb.id = r.labor_id
        join public.tareas_sap ts      on ts.id = r.tarea_id
        join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
        where lt.temporada_id = p_temporada_id
          and rd.avance_mz is not null
          and (p_proceso_id is null or ts.proceso_id = p_proceso_id)
          and (p_zona_id is null or lt.zona_id = p_zona_id)
          and (p_lote_temporada_id is null or rd.lote_temporada_id = p_lote_temporada_id)
          and (p_labor_id is null or lb.id = p_labor_id)
          and (p_categoria_labor_id is null or lb.categoria_labor_id = p_categoria_labor_id)
          and (p_desde is null or rd.fecha >= p_desde)
          and (p_hasta is null or rd.fecha <= p_hasta)
        group by lt.zona_id
    ),
    -- Las zonas que salen son las del plan MÁS las que registraron algo.
    -- Se arma la lista con `union` y se pegan los dos lados con left
    -- join: un `full outer join` con `is not distinct from` —que hace
    -- falta porque un lote puede no tener zona— Postgres lo rechaza con
    -- «FULL JOIN is only supported with merge-joinable or hash-joinable
    -- join conditions». Con left join no hay tal restricción.
    llaves as (
        select zona_id from plan
        union
        select zona_id from hecho
    )
    select
        k.zona_id,
        z.nombre,
        z.responsable,
        coalesce(p.area_plan, 0),
        coalesce(h.mz, 0),
        greatest(coalesce(p.area_plan, 0) - coalesce(h.mz, 0), 0),
        case when coalesce(p.area_plan, 0) > 0
             then round(coalesce(h.mz, 0) * 100.0 / p.area_plan, 2)
             else null end,
        coalesce(h.lotes, 0),
        h.ultima
    from llaves k
    left join plan  p on p.zona_id is not distinct from k.zona_id
    left join hecho h on h.zona_id is not distinct from k.zona_id
    left join public.zonas z on z.id = k.zona_id
    order by z.nombre nulls last
$$;


-- =====================================================================
-- PARTE D · CORTE DE FECHA PARA EL REPORTE RETROACTIVO
-- =====================================================================
-- «Añadir selector de fecha para “Avance del día”, permitiendo generar
--  reportes retroactivos.»
--
-- Un reporte con fecha del martes tiene que decir lo que decía el
-- martes. Sin este corte, el encabezado diría «corte al 3 de septiembre»
-- y los totales traerían el avance del 6: nadie podría cuadrar el correo
-- que se envió ese día con la plataforma.
--
-- Se BORRAN y se vuelven a crear en vez de `create or replace`: agregar
-- un parámetro con valor por omisión a una función que ya existe deja
-- dos sobrecargas y las llamadas con los parámetros de antes quedan
-- ambiguas —Postgres las rechaza con «function is not unique».
-- =====================================================================

drop function if exists public.fn_plan_avance_lote(uuid, uuid, uuid);

-- `create or replace` sobre la firma NUEVA, para que esta migración se
-- pueda volver a correr sin dar «already exists with same argument
-- types». El `drop` de arriba sólo se lleva la firma vieja de tres
-- parámetros, que es la que estorba.
create or replace function public.fn_plan_avance_lote(
    p_temporada_id uuid,
    p_proceso_id   uuid,
    p_labor_id     uuid default null,
    p_hasta        date default null
) returns table (
    lote_temporada_id uuid,
    ut                text,
    nomenclatura      text,
    zona              text,
    encargado         text,
    elemento_pep      text,
    area_bruta        numeric,
    area_neta         numeric,
    etapa_plan        smallint,
    area_plan         numeric,
    con_moto_plan     boolean,
    mz_avance         numeric,
    mz_pendiente      numeric,
    pct_avance        numeric,
    uso_moto          boolean,
    fecha_inicio      date,
    fecha_ultima      date,
    proveedor_plastico text,
    proveedor_manguera text
)
language sql stable security invoker as $$
    with plan as (
        select pl.lote_temporada_id,
               min(pl.etapa)                         as etapa_plan,
               sum(pl.area_plan)                     as area_plan,
               bool_or(coalesce(pl.con_moto, false)) as con_moto_plan
        from public.planes pl
        where pl.temporada_id = p_temporada_id
          and pl.proceso_id = p_proceso_id
        group by pl.lote_temporada_id
    ),
    hecho as (
        select rd.lote_temporada_id,
               sum(rd.avance_mz)                     as mz_avance,
               min(rd.fecha)                         as fecha_inicio,
               max(rd.fecha)                         as fecha_ultima,
               bool_or(coalesce(rd.con_moto, false)) as uso_moto,
               string_agg(distinct pp.nombre,  ' | ') as plastico,
               string_agg(distinct pmg.nombre, ' | ') as manguera
        from public.registro_detalle rd
        join public.registros r on r.id = rd.registro_id
        left join public.proveedores pp  on pp.id = rd.proveedor_plastico_id
        left join public.proveedores pmg on pmg.id = rd.proveedor_manguera_id
        where p_labor_id is not null
          and r.labor_id = p_labor_id
          and rd.avance_mz is not null
          and (p_hasta is null or rd.fecha <= p_hasta)
        group by rd.lote_temporada_id
    )
    select
        lt.id,
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        z.responsable,
        lo.nomenclatura || coalesce('-' || t.codigo_pep, ''),
        lt.area_bruta,
        lt.area_neta,
        pl.etapa_plan,
        pl.area_plan,
        pl.con_moto_plan,
        coalesce(h.mz_avance, 0),
        greatest(coalesce(pl.area_plan, 0) - coalesce(h.mz_avance, 0), 0),
        case when coalesce(pl.area_plan, 0) > 0 and p_labor_id is not null
             then round(coalesce(h.mz_avance, 0) * 100.0 / pl.area_plan, 2)
             else null end,
        h.uso_moto,
        h.fecha_inicio,
        h.fecha_ultima,
        h.plastico,
        h.manguera
    from public.lotes_temporada lt
    join public.lotes lo      on lo.id = lt.lote_id
    join public.temporadas t  on t.id = lt.temporada_id
    left join public.zonas z  on z.id = lt.zona_id
    left join plan pl on pl.lote_temporada_id = lt.id
    left join hecho h on h.lote_temporada_id = lt.id
    where lt.temporada_id = p_temporada_id
      and lt.activo
      and (pl.lote_temporada_id is not null or h.lote_temporada_id is not null)
    order by lo.nomenclatura
$$;


drop function if exists public.fn_avance_por_zona_etapa(uuid, uuid, uuid);

create or replace function public.fn_avance_por_zona_etapa(
    p_temporada_id uuid,
    p_proceso_id   uuid,
    p_labor_id     uuid default null,
    p_hasta        date default null
) returns table (
    zona       text,
    encargado  text,
    etapa      smallint,
    area_plan  numeric,
    mz_avance  numeric,
    pct_avance numeric
)
language sql stable security invoker as $$
    with plan as (
        select lt.zona_id, pl.etapa, sum(pl.area_plan) as area_plan
        from public.planes pl
        join public.lotes_temporada lt on lt.id = pl.lote_temporada_id
        where pl.temporada_id = p_temporada_id
          and pl.proceso_id = p_proceso_id
        group by lt.zona_id, pl.etapa
    ),
    hecho as (
        select lt.zona_id,
               coalesce(rd.etapa, pl.etapa) as etapa,
               sum(rd.avance_mz) as mz_avance
        from public.registro_detalle rd
        join public.registros r  on r.id = rd.registro_id
        join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
        left join public.planes pl
               on pl.lote_temporada_id = rd.lote_temporada_id
              and pl.proceso_id = p_proceso_id
        where lt.temporada_id = p_temporada_id
          and p_labor_id is not null
          and r.labor_id = p_labor_id
          and rd.avance_mz is not null
          and (p_hasta is null or rd.fecha <= p_hasta)
        group by lt.zona_id, coalesce(rd.etapa, pl.etapa)
    )
    select
        z.nombre,
        z.responsable,
        coalesce(p.etapa, h.etapa),
        coalesce(p.area_plan, 0),
        coalesce(h.mz_avance, 0),
        case when coalesce(p.area_plan, 0) > 0 and p_labor_id is not null
             then round(coalesce(h.mz_avance, 0) * 100.0 / p.area_plan, 2)
             else null end
    from plan p
    full outer join hecho h on h.zona_id = p.zona_id and h.etapa = p.etapa
    left join public.zonas z on z.id = coalesce(p.zona_id, h.zona_id)
    order by z.nombre, coalesce(p.etapa, h.etapa)
$$;
