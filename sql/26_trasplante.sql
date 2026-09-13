-- =====================================================================
-- MIGRACIÓN 26 · Catálogos base y módulo de Trasplante (proceso LEV)
-- =====================================================================
-- El trasplante no es maquinaria. No tiene horómetro, ni equipo, ni
-- tarifa por hora: tiene un plan de siembra por lote y variedad, y una
-- captura diaria de lo que de verdad se sembró. Por eso vive en sus
-- propias tablas y no colgando de `registros`, que está construido
-- alrededor de la pasada de un tractor.
--
-- Lo que sí comparte con el resto: lotes, zonas y temporadas. Un lote es
-- el mismo lote lo trabaje un tractor o una cuadrilla.
-- =====================================================================


-- =====================================================================
-- PARTE A · VARIEDADES
-- =====================================================================

create table if not exists public.variedades (
    id         uuid primary key default gen_random_uuid(),
    codigo_sap text,
    nombre     text not null unique,
    -- El cultivo: melón, sandía… La siembra lo hereda de la variedad, así
    -- que el digitador no lo escribe y no puede equivocarse.
    producto   text,
    activo     boolean not null default true,
    created_at timestamptz not null default now()
);

comment on table public.variedades is
    'Variedades de siembra con su código SAP y el cultivo al que pertenecen.';

create index if not exists idx_variedades_activa on public.variedades (activo) where activo;


-- =====================================================================
-- PARTE B · MATERIALES
-- =====================================================================
-- «Etiquetas (Array/JSON para manejar múltiples números de parte o IDs de
--  proveedores).»
--
-- Se guardan como arreglo para poder buscar dentro (`= any`), y además se
-- expone `etiquetas_texto` —las mismas separadas por coma— porque el
-- catálogo genérico de la app edita campos de texto, no arreglos. Un
-- trigger mantiene las dos caras sincronizadas: se escriba por donde se
-- escriba, la otra queda igual.
-- =====================================================================

create table if not exists public.materiales (
    id             uuid primary key default gen_random_uuid(),
    codigo         text not null unique,
    descripcion    text,
    grupo          text,
    etiquetas      text[] not null default '{}'::text[],
    etiquetas_texto text,
    activo         boolean not null default true,
    created_at     timestamptz not null default now()
);

comment on table public.materiales is
    'Insumos aplicados en campo. `etiquetas` guarda números de parte o códigos de proveedor; `etiquetas_texto` es la misma lista separada por comas, para editarla desde el catálogo.';

create or replace function public.fn_etiquetas_desde_texto(p_texto text)
returns text[] language sql immutable as $$
    select coalesce(
        array(
            select trim(x)
            from unnest(string_to_array(coalesce(p_texto, ''), ',')) as x
            where trim(x) <> ''
        ),
        '{}'::text[]
    )
$$;

create or replace function public.fn_sincronizar_etiquetas_material()
returns trigger language plpgsql as $$
begin
    -- Se mira cuál de las dos caras cambió y se recalcula la otra.
    if tg_op = 'INSERT' then
        if new.etiquetas_texto is not null and coalesce(array_length(new.etiquetas, 1), 0) = 0 then
            new.etiquetas := public.fn_etiquetas_desde_texto(new.etiquetas_texto);
        else
            new.etiquetas_texto := array_to_string(new.etiquetas, ', ');
        end if;
    elsif new.etiquetas_texto is distinct from old.etiquetas_texto then
        new.etiquetas := public.fn_etiquetas_desde_texto(new.etiquetas_texto);
    elsif new.etiquetas is distinct from old.etiquetas then
        new.etiquetas_texto := array_to_string(new.etiquetas, ', ');
    end if;
    return new;
end;
$$;

drop trigger if exists trg_etiquetas_material on public.materiales;
create trigger trg_etiquetas_material
    before insert or update on public.materiales
    for each row execute function public.fn_sincronizar_etiquetas_material();

create index if not exists idx_materiales_etiquetas on public.materiales using gin (etiquetas);


-- =====================================================================
-- PARTE C · PLAN DE SIEMBRA
-- =====================================================================
-- «Un lote puede tener múltiples variedades y ciclos.» Por eso la llave
-- natural es lote + ciclo + variedad y no el lote solo: el mismo lote
-- puede llevar dos variedades en el ciclo 1 y otra en el 2.
-- =====================================================================

create table if not exists public.planes_siembra (
    id                uuid primary key default gen_random_uuid(),
    temporada_id      uuid not null references public.temporadas(id),
    lote_temporada_id uuid not null references public.lotes_temporada(id) on delete cascade,
    ciclo             smallint not null check (ciclo between 1 and 3),
    variedad_id       uuid not null references public.variedades(id),
    fecha_siembra     date,
    area_plan         numeric(10,2) not null check (area_plan >= 0),
    distancia_siembra text,
    created_at        timestamptz not null default now(),
    unique (lote_temporada_id, ciclo, variedad_id)
);

comment on table public.planes_siembra is
    'Plan de trasplante: cuántas manzanas de cada variedad se van a sembrar en cada lote y ciclo.';

create index if not exists idx_plan_siembra_temporada on public.planes_siembra (temporada_id);


-- =====================================================================
-- PARTE D · SIEMBRA DIARIA
-- =====================================================================
-- La semana y las plantas por manzana son columnas GENERADAS: se calculan
-- solas y no se pueden escribir. Si fueran normales, dos pantallas
-- distintas podrían guardar semanas distintas para la misma fecha, y la
-- tabla de cumplimiento semanal diría cualquier cosa.
--
-- La semana es la ISO (`IYYY-IW`), que es la que usan sus reportes: la
-- que empieza en lunes y cuya numeración no se rompe en enero.
-- =====================================================================

create table if not exists public.siembras (
    id                 uuid primary key default gen_random_uuid(),
    temporada_id       uuid not null references public.temporadas(id),
    lote_temporada_id  uuid not null references public.lotes_temporada(id),
    variedad_id        uuid not null references public.variedades(id),
    fecha_siembra      date not null,
    ciclo              smallint not null default 1 check (ciclo between 1 and 3),
    denominacion       text,
    -- Código del lote de plántulas: la trazabilidad hacia el vivero.
    lote_variedad      text,
    avance_mz          numeric(10,2) not null check (avance_mz > 0),
    plantas_reportadas numeric(12,2),
    observaciones      text,
    usuario_id         uuid not null references public.perfiles(id),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    -- `to_char` no es inmutable (depende de la configuración regional) y
    -- Postgres no la admite en una columna generada. `extract` sí lo es,
    -- y da lo mismo: el año y la semana ISO.
    semana text generated always as (
        extract(isoyear from fecha_siembra)::text
        || '-S' || lpad(extract(week from fecha_siembra)::text, 2, '0')
    ) stored,
    plantas_mz numeric(12,2) generated always as (
        case when avance_mz > 0 and plantas_reportadas is not null
             then round(plantas_reportadas / avance_mz, 2) end
    ) stored
);

comment on table public.siembras is
    'Captura diaria de trasplante. La semana ISO y las plantas por manzana se calculan solas: no hay forma de guardarlas mal.';

create index if not exists idx_siembras_fecha on public.siembras (fecha_siembra);
create index if not exists idx_siembras_temporada on public.siembras (temporada_id, ciclo);
create index if not exists idx_siembras_lote on public.siembras (lote_temporada_id);

drop trigger if exists trg_siembras_updated on public.siembras;
create trigger trg_siembras_updated
    before update on public.siembras
    for each row execute function public.fn_touch_updated_at();


-- «Sub-formulario (1 a N): Productos Aplicados.»
create table if not exists public.siembra_productos (
    id          uuid primary key default gen_random_uuid(),
    siembra_id  uuid not null references public.siembras(id) on delete cascade,
    material_id uuid not null references public.materiales(id),
    cantidad    numeric(12,3),
    unidad      text,
    created_at  timestamptz not null default now()
);

create index if not exists idx_siembra_productos on public.siembra_productos (siembra_id);


-- =====================================================================
-- PARTE E · PERMISOS
-- =====================================================================

alter table public.variedades        enable row level security;
alter table public.materiales        enable row level security;
alter table public.planes_siembra    enable row level security;
alter table public.siembras          enable row level security;
alter table public.siembra_productos enable row level security;

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('trasplante', 'Trasplante', 'Plan y captura diaria de siembra', '/trasplante', 55,
     array['ver','crear','editar','eliminar','descargar'])
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion,
    ruta = excluded.ruta, orden = excluded.orden, acciones = excluded.acciones;

drop policy if exists variedades_select on public.variedades;
create policy variedades_select on public.variedades for select
    using ((select auth.uid()) is not null);
drop policy if exists variedades_write on public.variedades;
create policy variedades_write on public.variedades for all
    using ((select public.fn_tiene_permiso('catalogos','editar')))
    with check ((select public.fn_tiene_permiso('catalogos','crear'))
             or (select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists materiales_select on public.materiales;
create policy materiales_select on public.materiales for select
    using ((select auth.uid()) is not null);
drop policy if exists materiales_write on public.materiales;
create policy materiales_write on public.materiales for all
    using ((select public.fn_tiene_permiso('catalogos','editar')))
    with check ((select public.fn_tiene_permiso('catalogos','crear'))
             or (select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists plan_siembra_select on public.planes_siembra;
create policy plan_siembra_select on public.planes_siembra for select
    using ((select public.fn_tiene_permiso('trasplante','ver')));
drop policy if exists plan_siembra_insert on public.planes_siembra;
create policy plan_siembra_insert on public.planes_siembra for insert
    with check ((select public.fn_tiene_permiso('trasplante','crear')));
drop policy if exists plan_siembra_update on public.planes_siembra;
create policy plan_siembra_update on public.planes_siembra for update
    using ((select public.fn_tiene_permiso('trasplante','editar')));
drop policy if exists plan_siembra_delete on public.planes_siembra;
create policy plan_siembra_delete on public.planes_siembra for delete
    using ((select public.fn_tiene_permiso('trasplante','eliminar')));

drop policy if exists siembras_select on public.siembras;
create policy siembras_select on public.siembras for select
    using ((select public.fn_tiene_permiso('trasplante','ver')));
drop policy if exists siembras_insert on public.siembras;
create policy siembras_insert on public.siembras for insert
    with check ((select public.fn_tiene_permiso('trasplante','crear')));
drop policy if exists siembras_update on public.siembras;
create policy siembras_update on public.siembras for update
    using ((select public.fn_tiene_permiso('trasplante','editar')));
drop policy if exists siembras_delete on public.siembras;
create policy siembras_delete on public.siembras for delete
    using ((select public.fn_tiene_permiso('trasplante','eliminar')));

drop policy if exists siembra_productos_select on public.siembra_productos;
create policy siembra_productos_select on public.siembra_productos for select
    using ((select public.fn_tiene_permiso('trasplante','ver')));
drop policy if exists siembra_productos_write on public.siembra_productos;
create policy siembra_productos_write on public.siembra_productos for all
    using ((select public.fn_tiene_permiso('trasplante','editar'))
        or (select public.fn_tiene_permiso('trasplante','crear')))
    with check ((select public.fn_tiene_permiso('trasplante','editar'))
             or (select public.fn_tiene_permiso('trasplante','crear')));


-- =====================================================================
-- PARTE F · LA VISTA DE SIEMBRAS
-- =====================================================================

create or replace view public.v_siembras as
select
    s.id,
    s.temporada_id,
    s.lote_temporada_id,
    s.fecha_siembra,
    s.semana,
    s.ciclo,
    s.denominacion,
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
    s.created_at
from public.siembras s
join public.lotes_temporada lt on lt.id = s.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.variedades v       on v.id = s.variedad_id
left join public.perfiles pe   on pe.id = s.usuario_id;

alter view public.v_siembras set (security_invoker = on);


-- =====================================================================
-- PARTE G · PLAN CONTRA REAL
-- =====================================================================
-- Las cuatro consultas del reporte gerencial y de la pantalla de avance.
-- Van en la base y no en la pantalla porque todas son la misma idea
-- —sumar lo sembrado y compararlo con el plan— y repetirla cuatro veces
-- en JavaScript es cuatro sitios donde puede dejar de coincidir.
--
-- El PLAN es acumulado: no depende de las fechas del filtro. Lo REAL sí:
-- es lo sembrado hasta la fecha de corte. Comparar un plan recortado con
-- lo ejecutado no diría nada.
-- =====================================================================

create or replace function public.fn_trasplante_por_ut(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    lote_temporada_id uuid,
    ut                text,
    lote_nombre       text,
    zona              text,
    encargado         text,
    ciclo             smallint,
    variedad          text,
    area_plan         numeric,
    area_real         numeric,
    pct               numeric,
    plantas           numeric,
    primera_fecha     date,
    ultima_fecha      date
)
language sql stable security invoker as $$
    with plan as (
        select p.lote_temporada_id, p.ciclo, p.variedad_id, sum(p.area_plan) as area_plan
        from public.planes_siembra p
        where p.temporada_id = p_temporada_id
        group by p.lote_temporada_id, p.ciclo, p.variedad_id
    ),
    real_ as (
        select s.lote_temporada_id, s.ciclo, s.variedad_id,
               sum(s.avance_mz) as area_real,
               sum(s.plantas_reportadas) as plantas,
               min(s.fecha_siembra) as primera,
               max(s.fecha_siembra) as ultima
        from public.siembras s
        where s.temporada_id = p_temporada_id
          and (p_hasta is null or s.fecha_siembra <= p_hasta)
        group by s.lote_temporada_id, s.ciclo, s.variedad_id
    ),
    llaves as (
        select lote_temporada_id, ciclo, variedad_id from plan
        union
        select lote_temporada_id, ciclo, variedad_id from real_
    )
    select
        k.lote_temporada_id,
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        z.responsable,
        k.ciclo,
        v.nombre,
        coalesce(p.area_plan, 0),
        coalesce(r.area_real, 0),
        case when coalesce(p.area_plan, 0) > 0
             then round(coalesce(r.area_real, 0) / p.area_plan * 100, 1) end,
        coalesce(r.plantas, 0),
        r.primera,
        r.ultima
    from llaves k
    join public.lotes_temporada lt on lt.id = k.lote_temporada_id
    join public.lotes lo           on lo.id = lt.lote_id
    left join public.zonas z       on z.id = lt.zona_id
    join public.variedades v       on v.id = k.variedad_id
    left join plan p  on p.lote_temporada_id = k.lote_temporada_id
                     and p.ciclo = k.ciclo and p.variedad_id = k.variedad_id
    left join real_ r on r.lote_temporada_id = k.lote_temporada_id
                     and r.ciclo = k.ciclo and r.variedad_id = k.variedad_id
    order by z.nombre, lo.nomenclatura, k.ciclo, v.nombre
$$;


create or replace function public.fn_trasplante_por_variedad(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    ciclo     smallint,
    variedad  text,
    cultivo   text,
    area_plan numeric,
    area_real numeric,
    pct       numeric,
    plantas   numeric
)
language sql stable security invoker as $$
    with plan as (
        select p.ciclo, p.variedad_id, sum(p.area_plan) as area_plan
        from public.planes_siembra p
        where p.temporada_id = p_temporada_id
        group by p.ciclo, p.variedad_id
    ),
    real_ as (
        select s.ciclo, s.variedad_id, sum(s.avance_mz) as area_real,
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
    select k.ciclo, v.nombre, v.producto,
           coalesce(p.area_plan, 0), coalesce(r.area_real, 0),
           case when coalesce(p.area_plan, 0) > 0
                then round(coalesce(r.area_real, 0) / p.area_plan * 100, 1) end,
           coalesce(r.plantas, 0)
    from llaves k
    join public.variedades v on v.id = k.variedad_id
    left join plan p  on p.ciclo = k.ciclo and p.variedad_id = k.variedad_id
    left join real_ r on r.ciclo = k.ciclo and r.variedad_id = k.variedad_id
    order by k.ciclo, v.nombre
$$;


create or replace function public.fn_trasplante_por_zona(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    zona      text,
    encargado text,
    ciclo     smallint,
    area_plan numeric,
    area_real numeric,
    pct       numeric
)
language sql stable security invoker as $$
    with plan as (
        select lt.zona_id, p.ciclo, sum(p.area_plan) as area_plan
        from public.planes_siembra p
        join public.lotes_temporada lt on lt.id = p.lote_temporada_id
        where p.temporada_id = p_temporada_id
        group by lt.zona_id, p.ciclo
    ),
    real_ as (
        select lt.zona_id, s.ciclo, sum(s.avance_mz) as area_real
        from public.siembras s
        join public.lotes_temporada lt on lt.id = s.lote_temporada_id
        where s.temporada_id = p_temporada_id
          and (p_hasta is null or s.fecha_siembra <= p_hasta)
        group by lt.zona_id, s.ciclo
    ),
    llaves as (
        select zona_id, ciclo from plan
        union
        select zona_id, ciclo from real_
    )
    select coalesce(z.nombre, '(sin zona)'), z.responsable, k.ciclo,
           coalesce(p.area_plan, 0), coalesce(r.area_real, 0),
           case when coalesce(p.area_plan, 0) > 0
                then round(coalesce(r.area_real, 0) / p.area_plan * 100, 1) end
    from llaves k
    left join public.zonas z on z.id = k.zona_id
    left join plan p  on p.zona_id is not distinct from k.zona_id and p.ciclo = k.ciclo
    left join real_ r on r.zona_id is not distinct from k.zona_id and r.ciclo = k.ciclo
    order by 1, k.ciclo
$$;


create or replace function public.fn_trasplante_por_semana(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    semana       text,
    desde        date,
    hasta        date,
    ciclo        smallint,
    area_real    numeric,
    plantas      numeric,
    acumulado    numeric
)
language sql stable security invoker as $$
    with por_semana as (
        select s.semana,
               min(s.fecha_siembra) as desde,
               max(s.fecha_siembra) as hasta,
               s.ciclo,
               sum(s.avance_mz)          as area_real,
               sum(s.plantas_reportadas) as plantas
        from public.siembras s
        where s.temporada_id = p_temporada_id
          and (p_hasta is null or s.fecha_siembra <= p_hasta)
        group by s.semana, s.ciclo
    )
    select ps.semana, ps.desde, ps.hasta, ps.ciclo, ps.area_real, ps.plantas,
           sum(ps.area_real) over (order by ps.semana, ps.ciclo
                                   rows between unbounded preceding and current row)
    from por_semana ps
    order by ps.semana, ps.ciclo
$$;


create or replace function public.fn_trasplante_estadisticas(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    ciclo       smallint,
    area_plan   numeric,
    area_real   numeric,
    pendiente   numeric,
    pct         numeric,
    plantas     numeric,
    plantas_mz  numeric,
    lotes       bigint
)
language sql stable security invoker as $$
    with plan as (
        select p.ciclo, sum(p.area_plan) as area_plan
        from public.planes_siembra p
        where p.temporada_id = p_temporada_id
        group by p.ciclo
    ),
    real_ as (
        select s.ciclo, sum(s.avance_mz) as area_real,
               sum(s.plantas_reportadas) as plantas,
               count(distinct s.lote_temporada_id) as lotes
        from public.siembras s
        where s.temporada_id = p_temporada_id
          and (p_hasta is null or s.fecha_siembra <= p_hasta)
        group by s.ciclo
    ),
    llaves as (select ciclo from plan union select ciclo from real_)
    select k.ciclo,
           coalesce(p.area_plan, 0),
           coalesce(r.area_real, 0),
           greatest(coalesce(p.area_plan, 0) - coalesce(r.area_real, 0), 0),
           case when coalesce(p.area_plan, 0) > 0
                then round(coalesce(r.area_real, 0) / p.area_plan * 100, 1) end,
           coalesce(r.plantas, 0),
           case when coalesce(r.area_real, 0) > 0
                then round(coalesce(r.plantas, 0) / r.area_real, 2) end,
           coalesce(r.lotes, 0)
    from llaves k
    left join plan p  on p.ciclo = k.ciclo
    left join real_ r on r.ciclo = k.ciclo
    order by k.ciclo
$$;

comment on function public.fn_trasplante_estadisticas(uuid, date) is
    'Plan, ejecutado, pendiente y plantas por ciclo. El total general se suma en la pantalla a partir de estas filas.';
