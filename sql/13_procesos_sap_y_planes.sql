-- =====================================================================
-- AGRONOTIFICACIONES · Migración 13
-- Procesos de SAP (APS / LEV / COS) y el plan colgado del proceso
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01–12.
--
-- Lo que cambió respecto a la 12, con las palabras de Henry:
--
--   «el plan de Mecanizacion va exclusivamente a Preparacion de suelo,
--    este esta en el proceso que nosotros en SAP llamamos APS ... en el
--    proceso APS usamos las tareas T101, T102, T103, T106 y T108, en
--    estas tareas usamos las areas del plan de mecanizacion»
--
-- Es decir: el área planificada es UNA por lote y por proceso, y TODAS
-- las tareas del proceso se miden contra esa misma área. El plan de
-- mecanización no es «el plan del emplasticado»: es el área de trabajo
-- de la preparación de suelo, y el emplasticado es una de las labores
-- que la recorre.
--
-- Consecuencia importante: el avance NO se puede sumar entre labores. Si
-- el arado hizo 29.84 mz y el emplasticado otras 29.84 mz del mismo lote
-- de 29.84 mz planificadas, el lote va al 100% en ambas labores, no al
-- 200%. Por eso el avance se mide SIEMPRE de una labor a la vez.
-- =====================================================================


-- =====================================================================
-- PARTE A · CATÁLOGO DE PROCESOS
-- =====================================================================

create table if not exists public.procesos_sap (
    id          uuid primary key default gen_random_uuid(),
    codigo      text not null unique,      -- 'APS'
    nombre      text not null,             -- 'Preparación de suelo'
    descripcion text,
    momento     text,                      -- cuándo ocurre respecto al trasplante
    orden       smallint not null default 0,
    activo      boolean not null default true
);

comment on table public.procesos_sap is
'Procesos de SAP en que se divide la temporada. Cada uno tiene su propio plan.';

insert into public.procesos_sap (codigo, nombre, descripcion, momento, orden) values
    ('APS', 'Preparación de suelo',
     'Mecanización: todo lo que se hace antes del trasplante.',
     'Antes del trasplante', 10),
    ('LEV', 'Levante',
     'Siembra y manejo del cultivo después del trasplante.',
     'Después del trasplante', 20),
    ('COS', 'Cosecha',
     'Corte y acarreo.',
     'Cosecha', 30)
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    momento = excluded.momento,
    orden = excluded.orden;

alter table public.procesos_sap enable row level security;

drop policy if exists procesos_select on public.procesos_sap;
create policy procesos_select on public.procesos_sap for select
    using ((select auth.uid()) is not null);
drop policy if exists procesos_insert on public.procesos_sap;
create policy procesos_insert on public.procesos_sap for insert
    with check ((select public.fn_tiene_permiso('catalogos', 'crear')));
drop policy if exists procesos_update on public.procesos_sap;
create policy procesos_update on public.procesos_sap for update
    using ((select public.fn_tiene_permiso('catalogos', 'editar')));
drop policy if exists procesos_delete on public.procesos_sap;
create policy procesos_delete on public.procesos_sap for delete
    using ((select public.fn_tiene_permiso('catalogos', 'eliminar')));


-- =====================================================================
-- PARTE B · CADA TAREA SAP PERTENECE A UN PROCESO
-- =====================================================================

alter table public.tareas_sap
    add column if not exists proceso_id uuid references public.procesos_sap(id);

create index if not exists tareas_sap_proceso_idx on public.tareas_sap (proceso_id);

-- Las que él nombró explícitamente.
update public.tareas_sap t
set proceso_id = p.id
from public.procesos_sap p
where p.codigo = 'APS'
  and t.proceso_id is null
  and upper(replace(t.codigo, ' ', '')) in ('T101', 'T102', 'T103', 'T106', 'T108');

update public.tareas_sap t
set proceso_id = p.id
from public.procesos_sap p
where p.codigo = 'LEV'
  and t.proceso_id is null
  and upper(replace(t.codigo, ' ', '')) in ('T203', 'T300');

-- Las T9xx son cosecha. Se deduce por el prefijo porque él dijo «T900,
-- T901 etc.»: son una familia entera, no una lista cerrada.
update public.tareas_sap t
set proceso_id = p.id
from public.procesos_sap p
where p.codigo = 'COS'
  and t.proceso_id is null
  and upper(replace(t.codigo, ' ', '')) like 'T9%';

-- Lo demás queda sin proceso a propósito: es mejor que salga «sin
-- proceso» en pantalla y él lo asigne, que adivinarle y que un avance
-- termine contado en el plan equivocado.


-- =====================================================================
-- PARTE C · EL PLAN CUELGA DEL PROCESO, NO DE LA CATEGORÍA DE LABOR
-- =====================================================================
-- La tabla se renombra: va a guardar también el plan de siembra y el de
-- cosecha, así que llamarla `planes_mecanizacion` sería confuso para
-- siempre. El rename se lleva índices, policies y llaves con él.
-- =====================================================================

do $$
begin
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'planes_mecanizacion')
       and not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'planes') then
        alter table public.planes_mecanizacion rename to planes;
    end if;
end $$;

alter table public.planes
    add column if not exists proceso_id uuid references public.procesos_sap(id);

-- Lo que ya estaba cargado era plan de mecanización, o sea APS.
update public.planes set proceso_id = (select id from public.procesos_sap where codigo = 'APS')
where proceso_id is null;

alter table public.planes alter column proceso_id set not null;

-- La categoría de labor deja de definir el plan. La columna se va: es de
-- ayer y no hay nada que preservar en ella.
alter table public.planes drop column if exists categoria_labor_id;

-- Unicidad nueva: un lote, un proceso, una etapa.
alter table public.planes drop constraint if exists planes_mecanizacion_lote_temporada_id_categoria_labor_id_eta_key;
alter table public.planes drop constraint if exists planes_lote_temporada_id_proceso_id_etapa_key;
alter table public.planes
    add constraint planes_lote_temporada_id_proceso_id_etapa_key
    unique (lote_temporada_id, proceso_id, etapa);

drop index if exists planes_mecanizacion_busqueda_idx;
create index if not exists planes_busqueda_idx
    on public.planes (temporada_id, proceso_id, etapa);

-- Las policies se renombraron con la tabla; se rehacen con nombre limpio.
drop policy if exists planes_select on public.planes;
create policy planes_select on public.planes for select
    using ((select public.fn_tiene_permiso('plan', 'ver')));
drop policy if exists planes_insert on public.planes;
create policy planes_insert on public.planes for insert
    with check ((select public.fn_tiene_permiso('plan', 'crear')));
drop policy if exists planes_update on public.planes;
create policy planes_update on public.planes for update
    using ((select public.fn_tiene_permiso('plan', 'editar')));
drop policy if exists planes_delete on public.planes;
create policy planes_delete on public.planes for delete
    using ((select public.fn_tiene_permiso('plan', 'eliminar')));

-- `fn_eliminar_lote` apuntaba al nombre viejo.
create or replace function public.fn_eliminar_lote(
    p_lote_id uuid,
    p_forzar  boolean default false
) returns text
language plpgsql security invoker as $$
declare
    v_labores    integer;
    v_temporadas integer;
    v_nombre     text;
begin
    select nomenclatura into v_nombre from public.lotes where id = p_lote_id;
    if v_nombre is null then
        raise exception 'Ese lote ya no existe.';
    end if;

    select count(*) into v_labores
    from public.registro_detalle rd
    join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
    where lt.lote_id = p_lote_id;

    if v_labores > 0 then
        raise exception
            'No se puede eliminar % porque tiene % línea(s) de labor registradas. Desactívalo en vez de borrarlo para que el histórico no se pierda.',
            v_nombre, v_labores;
    end if;

    select count(*) into v_temporadas
    from public.lotes_temporada where lote_id = p_lote_id;

    if v_temporadas > 0 and not p_forzar then
        raise exception
            'El lote % está asignado a % temporada(s) pero no tiene labores. Confirma el borrado para quitarlo también de ellas.',
            v_nombre, v_temporadas;
    end if;

    delete from public.planes pl
    using public.lotes_temporada lt
    where lt.id = pl.lote_temporada_id and lt.lote_id = p_lote_id;

    delete from public.lotes_temporada where lote_id = p_lote_id;
    delete from public.lotes where id = p_lote_id;

    return v_nombre;
end;
$$;

create or replace function public.fn_quitar_lote_de_temporada(
    p_lote_temporada_id uuid
) returns text
language plpgsql security invoker as $$
declare
    v_labores integer;
    v_nombre  text;
begin
    select lo.nomenclatura into v_nombre
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    where lt.id = p_lote_temporada_id;

    if v_nombre is null then
        raise exception 'Esa asignación de lote ya no existe.';
    end if;

    select count(*) into v_labores
    from public.registro_detalle where lote_temporada_id = p_lote_temporada_id;

    if v_labores > 0 then
        raise exception
            'No se puede quitar % de la temporada: tiene % línea(s) de labor. Desactívalo en vez de borrarlo.',
            v_nombre, v_labores;
    end if;

    delete from public.planes where lote_temporada_id = p_lote_temporada_id;
    delete from public.lotes_temporada where id = p_lote_temporada_id;
    return v_nombre;
end;
$$;


-- =====================================================================
-- PARTE D · AVANCE: SIEMPRE DE UNA LABOR A LA VEZ
-- =====================================================================

-- Qué labores han trabajado dentro de un proceso y cuánto llevan. Sirve
-- para el selector de la pantalla y para el resumen «¿en qué va cada
-- tarea del proceso?».
create or replace function public.fn_labores_del_proceso(
    p_temporada_id uuid,
    p_proceso_id   uuid
) returns table (
    labor_id     uuid,
    labor_nombre text,
    mz_total     numeric,
    lotes        bigint,
    ultima_fecha date
)
language sql stable security invoker as $$
    select
        lb.id,
        lb.nombre,
        sum(rd.avance_mz),
        count(distinct rd.lote_temporada_id),
        max(rd.fecha)
    from public.registro_detalle rd
    join public.registros r  on r.id = rd.registro_id
    join public.labores lb   on lb.id = r.labor_id
    join public.tareas_sap ts on ts.id = r.tarea_id
    join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
    where lt.temporada_id = p_temporada_id
      and ts.proceso_id = p_proceso_id
      and rd.avance_mz is not null
    group by lb.id, lb.nombre
    order by sum(rd.avance_mz) desc
$$;


-- El «Resumen por lote». `p_labor_id` en null devuelve el plan sin
-- avance: es lo honesto cuando todavía no se eligió qué labor medir.
create or replace function public.fn_plan_avance_lote(
    p_temporada_id uuid,
    p_proceso_id   uuid,
    p_labor_id     uuid default null
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


create or replace function public.fn_avance_por_zona_etapa(
    p_temporada_id uuid,
    p_proceso_id   uuid,
    p_labor_id     uuid default null
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
    -- El avance se atribuye a la etapa que trae la línea diaria; si no la
    -- trae, a la etapa en que el lote está planificado.
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


-- =====================================================================
-- PARTE E · ÁREA POR PROVEEDOR
-- =====================================================================
-- «hay veces que en un mismo lote usan 2 o tres proveedores, entonces
--  querré saber que area es la que hizo por proveedor»
--
-- `registro_detalle` no tiene restricción única por (registro, lote), así
-- que un mismo lote puede llevar dos o tres líneas en la misma labor, con
-- su área y su proveedor cada una. Eso es lo que hace posible este corte.
-- =====================================================================

create or replace function public.fn_avance_por_proveedor(
    p_temporada_id uuid,
    p_proceso_id   uuid,
    p_labor_id     uuid default null
) returns table (
    proveedor_plastico text,
    proveedor_manguera text,
    mz                 numeric,
    lotes              bigint,
    lineas             bigint,
    primera_fecha      date,
    ultima_fecha       date
)
language sql stable security invoker as $$
    select
        coalesce(pp.nombre,  'Sin proveedor'),
        coalesce(pmg.nombre, 'Sin proveedor'),
        sum(rd.avance_mz),
        count(distinct rd.lote_temporada_id),
        count(*),
        min(rd.fecha),
        max(rd.fecha)
    from public.registro_detalle rd
    join public.registros r  on r.id = rd.registro_id
    join public.tareas_sap ts on ts.id = r.tarea_id
    join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
    left join public.proveedores pp  on pp.id = rd.proveedor_plastico_id
    left join public.proveedores pmg on pmg.id = rd.proveedor_manguera_id
    where lt.temporada_id = p_temporada_id
      and ts.proceso_id = p_proceso_id
      and (p_labor_id is null or r.labor_id = p_labor_id)
      and rd.avance_mz is not null
    group by coalesce(pp.nombre, 'Sin proveedor'), coalesce(pmg.nombre, 'Sin proveedor')
    order by sum(rd.avance_mz) desc
$$;


-- Desglose por lote y proveedor, que es como él lo va a revisar cuando un
-- lote llevó dos rollos distintos.
create or replace function public.fn_proveedor_por_lote(
    p_temporada_id uuid,
    p_proceso_id   uuid,
    p_labor_id     uuid default null
) returns table (
    ut                 text,
    nomenclatura       text,
    zona               text,
    proveedor_plastico text,
    proveedor_manguera text,
    mz                 numeric,
    fecha              date
)
language sql stable security invoker as $$
    select
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        coalesce(pp.nombre,  'Sin proveedor'),
        coalesce(pmg.nombre, 'Sin proveedor'),
        sum(rd.avance_mz),
        max(rd.fecha)
    from public.registro_detalle rd
    join public.registros r  on r.id = rd.registro_id
    join public.tareas_sap ts on ts.id = r.tarea_id
    join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
    join public.lotes lo on lo.id = lt.lote_id
    left join public.zonas z on z.id = lt.zona_id
    left join public.proveedores pp  on pp.id = rd.proveedor_plastico_id
    left join public.proveedores pmg on pmg.id = rd.proveedor_manguera_id
    where lt.temporada_id = p_temporada_id
      and ts.proceso_id = p_proceso_id
      and (p_labor_id is null or r.labor_id = p_labor_id)
      and rd.avance_mz is not null
    group by lo.nomenclatura, lo.nombre, z.nombre,
             coalesce(pp.nombre, 'Sin proveedor'), coalesce(pmg.nombre, 'Sin proveedor')
    order by lo.nomenclatura, sum(rd.avance_mz) desc
$$;


-- =====================================================================
-- PARTE F · LA VISTA DIARIA LLEVA TAREA Y PROCESO
-- =====================================================================

drop view if exists public.v_avance_diario;

create view public.v_avance_diario as
select
    rd.id                as detalle_id,
    rd.fecha,
    lo.nomenclatura      as ut,
    lo.nombre            as nomenclatura,
    z.nombre             as zona,
    z.responsable        as encargado,
    rd.etapa,
    rd.ciclo,
    rd.con_moto,
    rd.avance_mz,
    lb.id                as labor_id,
    lb.nombre            as labor_nombre,
    lb.categoria_labor_id,
    cl.nombre            as categoria_labor,
    ts.id                as tarea_id,
    ts.codigo            as tarea_codigo,
    ts.proceso_id,
    ps.codigo            as proceso_codigo,
    ps.nombre            as proceso_nombre,
    e.codigo             as equipo_codigo,
    o.nombre             as operador_nombre,
    pp.nombre            as proveedor_plastico,
    pmg.nombre           as proveedor_manguera,
    t.id                 as temporada_id,
    tk.codigo            as ticket_codigo,
    tk.proceso           as ticket_proceso,
    pe.nombre            as usuario_nombre,
    rd.lote_temporada_id
from public.registro_detalle rd
join public.registros r          on r.id = rd.registro_id
join public.labores lb           on lb.id = r.labor_id
left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
join public.tareas_sap ts        on ts.id = r.tarea_id
left join public.procesos_sap ps on ps.id = ts.proceso_id
join public.lotes_temporada lt   on lt.id = rd.lote_temporada_id
join public.lotes lo             on lo.id = lt.lote_id
join public.temporadas t         on t.id = lt.temporada_id
left join public.zonas z         on z.id = lt.zona_id
join public.horometros h         on h.id = r.horometro_id
join public.equipos e            on e.id = h.equipo_id
left join public.operadores o    on o.id = h.operador_id
left join public.proveedores pp  on pp.id = rd.proveedor_plastico_id
left join public.proveedores pmg on pmg.id = rd.proveedor_manguera_id
join public.tickets tk           on tk.id = r.ticket_id
left join public.perfiles pe     on pe.id = r.usuario_id
where rd.avance_mz is not null;

alter view public.v_avance_diario set (security_invoker = on);

-- `v_avance_ejecutado` de la 12 agrupaba por categoría de labor, que ya
-- no es la dimensión del plan. Se rehace por labor y proceso.
drop view if exists public.v_avance_ejecutado;

create view public.v_avance_ejecutado as
select
    rd.lote_temporada_id,
    r.labor_id,
    ts.proceso_id,
    rd.etapa,
    sum(rd.avance_mz)                     as mz_avance,
    min(rd.fecha)                         as fecha_inicio,
    max(rd.fecha)                         as fecha_ultima,
    count(*)                              as lineas,
    bool_or(coalesce(rd.con_moto, false)) as uso_moto
from public.registro_detalle rd
join public.registros r   on r.id = rd.registro_id
join public.tareas_sap ts on ts.id = r.tarea_id
where rd.avance_mz is not null
group by rd.lote_temporada_id, r.labor_id, ts.proceso_id, rd.etapa;

alter view public.v_avance_ejecutado set (security_invoker = on);


-- =====================================================================
-- PARTE G · UNA PANTALLA POR PLAN
-- =====================================================================
-- El menú pasa de «Plan» a «Planes» y se despliega. Cada plan es una
-- pantalla con su propio permiso, para que mañana se le pueda dar Siembra
-- a alguien sin darle Mecanización.
-- =====================================================================

update public.pantallas
set nombre = 'Planes', descripcion = 'Planes por proceso y avance diario'
where codigo = 'plan';

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('plan_aps', 'Plan de mecanización', 'Preparación de suelo · proceso APS',
     '/plan/APS', 51, array['ver','crear','editar','eliminar','descargar']),
    ('plan_lev', 'Plan de siembra', 'Levante · proceso LEV',
     '/plan/LEV', 52, array['ver','crear','editar','eliminar','descargar']),
    ('plan_cos', 'Plan de cosecha', 'Cosecha · proceso COS',
     '/plan/COS', 53, array['ver','crear','editar','eliminar','descargar'])
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta = excluded.ruta,
    orden = excluded.orden,
    acciones = excluded.acciones;

-- Quien ya tenía el plan, tiene los tres planes: es lo que tenía ayer.
insert into public.permisos (rol_id, recurso, accion)
select p.rol_id, x.pantalla, p.accion
from public.permisos p
cross join (values ('plan_aps'), ('plan_lev'), ('plan_cos')) as x(pantalla)
where p.recurso = 'plan'
on conflict (rol_id, recurso, accion) do nothing;
