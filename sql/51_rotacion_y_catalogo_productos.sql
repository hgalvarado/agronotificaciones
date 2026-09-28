-- =====================================================================
-- 51 · Cultivos de rotación, y el producto deja de ser texto suelto
--
-- Ejecutar en el SQL Editor DESPUÉS de la 50.
--
-- Dos cosas, y la segunda necesita la primera:
--
--   A–C. `variedades.producto` era una columna de TEXTO. «Melon»,
--        «Melón», «MELON» y «melon » son cuatro cultivos distintos para
--        cualquier agrupación, y los resúmenes por cultivo salían
--        partidos sin que se viera por qué. Pasa a ser
--        `producto_id` → `catalogo_productos`, con su pestaña en
--        Catálogos. Lo ya escrito se rescata: no se pierde un solo dato.
--
--   D–H. El módulo de CULTIVOS DE ROTACIÓN: lo que se siembra entre dos
--        ciclos de melón para descansar y limpiar el suelo. Tiene plan
--        —cuánto se va a sembrar y con cuánta semilla— y avance diario
--        —cuánto se sembró de verdad, con qué gasto y a qué costo—.
--
-- La rotación NO cuelga del trasplante: comparte lotes, zonas,
-- temporadas y variedades, y nada más. Un maíz de rotación no tiene
-- plántula, ni bandeja, ni ciclo de melón.
-- =====================================================================


-- =====================================================================
-- A · EL CATÁLOGO DE PRODUCTOS (CULTIVOS)
-- =====================================================================

create table if not exists public.catalogo_productos (
    id         uuid primary key default gen_random_uuid(),
    nombre     text not null unique,
    codigo_sap text,
    activo     boolean not null default true,
    created_at timestamptz not null default now()
);

comment on table public.catalogo_productos is
'Los cultivos: melón, sandía, maíz. La variedad apunta aquí y todo lo demás lo hereda de la variedad.';

create index if not exists idx_catalogo_productos_activo
    on public.catalogo_productos (activo) where activo;

/**
 * La llave con la que dos nombres son el MISMO cultivo.
 *
 * Sin acentos, sin mayúsculas y sin espacios de sobra, porque «Melon»,
 * «melón » y «MELÓN» son el mismo melón. Comparar el texto tal cual es
 * exactamente lo que partía los resúmenes por cultivo en tres, y
 * arreglarlo sólo al rescatar dejaría que volviera a pasar mañana.
 *
 * `translate` y no `unaccent`: la extensión puede no estar instalada en
 * el proyecto, y una migración que depende de una extensión que nadie
 * instaló falla a mitad.
 */
create or replace function public.fn_clave_producto(p_nombre text)
returns text
language sql immutable as $$
    select lower(trim(translate(
        coalesce(p_nombre, ''),
        'áàäâãÁÀÄÂÃéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ',
        'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC'
    )))
$$;

-- Que no se vuelva a partir: el índice lo impide desde la base, no desde
-- la pantalla de Catálogos.
create unique index if not exists ux_catalogo_productos_clave
    on public.catalogo_productos (public.fn_clave_producto(nombre));

alter table public.catalogo_productos enable row level security;

drop policy if exists catalogo_productos_select on public.catalogo_productos;
create policy catalogo_productos_select on public.catalogo_productos for select
    using ((select auth.uid()) is not null);

drop policy if exists catalogo_productos_write on public.catalogo_productos;
create policy catalogo_productos_write on public.catalogo_productos for all
    using ((select public.fn_tiene_permiso('catalogos','editar')))
    with check ((select public.fn_tiene_permiso('catalogos','crear'))
             or (select public.fn_tiene_permiso('catalogos','editar')));

grant select on public.catalogo_productos to authenticated;
grant insert, update, delete on public.catalogo_productos to authenticated;


-- =====================================================================
-- B · LA VARIEDAD APUNTA AL CATÁLOGO
-- =====================================================================
-- El rescate va ANTES de tocar la columna vieja: si algo saliera mal,
-- todavía está el texto original para volver a intentarlo.

alter table public.variedades
    add column if not exists producto_id uuid references public.catalogo_productos(id);

do $$
begin
    -- Sólo si la columna de texto todavía existe: correr la migración
    -- dos veces no puede romper nada.
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'variedades' and column_name = 'producto'
    ) then
        -- Un cultivo por cada texto DISTINTO IGNORANDO acentos y
        -- mayúsculas: «Melon» y «melón » son el mismo melón, y crear los
        -- dos sería mudar el problema al catálogo nuevo. Se conserva la
        -- forma que salga primera por orden alfabético, que es tan
        -- arbitraria como cualquier otra y al menos es estable.
        insert into public.catalogo_productos (nombre)
        select distinct on (public.fn_clave_producto(v.producto)) trim(v.producto)
        from public.variedades v
        where v.producto is not null and trim(v.producto) <> ''
          and not exists (
              select 1 from public.catalogo_productos c
              where public.fn_clave_producto(c.nombre)
                  = public.fn_clave_producto(v.producto)
          )
        order by public.fn_clave_producto(v.producto), trim(v.producto);

        update public.variedades v
        set producto_id = c.id
        from public.catalogo_productos c
        where v.producto_id is null
          and v.producto is not null
          and public.fn_clave_producto(c.nombre) = public.fn_clave_producto(v.producto);
    end if;
end $$;

comment on column public.variedades.producto_id is
'El cultivo, del catálogo. Era texto libre y «Melon», «Melón» y «MELON» partían cualquier agrupación por cultivo en tres.';

create index if not exists idx_variedades_producto on public.variedades (producto_id);


-- =====================================================================
-- C · LO QUE LEÍA LA COLUMNA VIEJA
-- =====================================================================
-- Cuatro objetos decían `v.producto`. Se reescriben con el `join`, sin
-- cambiar ni un nombre ni un tipo de columna: quien los consume no se
-- entera. Por eso `create or replace` basta y no hace falta tirarlos.
--
-- Y va ANTES de quitar la columna: dos vistas dependen de ella y
-- Postgres no deja tirarla mientras alguien la mire. Con `cascade` se
-- llevaría las vistas por delante y todo lo que cuelgue de ellas.

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
    pr.nombre         as cultivo,
    pe.nombre         as usuario_nombre,
    s.usuario_id,
    s.created_at,
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
    ) as plan_lote,
    coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id',          sp.id,
                   'material_id', sp.material_id,
                   'codigo',      m.codigo,
                   'descripcion', m.descripcion,
                   'cantidad',    sp.cantidad,
                   'unidad',      sp.unidad
               ) order by m.codigo)
        from public.siembra_productos sp
        join public.materiales m on m.id = sp.material_id
        where sp.siembra_id = s.id
    ), '[]'::jsonb) as productos
from public.siembras s
join public.lotes_temporada lt on lt.id = s.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.variedades v       on v.id = s.variedad_id
left join public.catalogo_productos pr on pr.id = v.producto_id
left join public.perfiles pe   on pe.id = s.usuario_id;

alter view public.v_siembras set (security_invoker = on);
grant select on public.v_siembras to authenticated;

create or replace view public.v_recepcion_plantulas as
select
    r.id,
    r.temporada_id,
    r.fecha,
    r.variedad_id,
    v.nombre      as variedad,
    v.codigo_sap  as variedad_sap,
    pr.nombre     as cultivo,
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
join public.variedades v on v.id = r.variedad_id
left join public.catalogo_productos pr on pr.id = v.producto_id;

alter view public.v_recepcion_plantulas set (security_invoker = on);
grant select on public.v_recepcion_plantulas to authenticated;

create or replace function public.fn_trasplante_por_variedad(
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
               sum(p.area_plan) filter (
                   where p.fecha_siembra is not null
                     and (p_hasta is null or p.fecha_siembra <= p_hasta)
               ) as area_plan,
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
        pr.nombre,
        coalesce(p.area_plan, 0),
        coalesce(r.area_real, 0),
        case when coalesce(p.area_plan, 0) > 0
             then round(coalesce(r.area_real, 0) / p.area_plan * 100, 1) end,
        coalesce(r.plantas, 0),
        coalesce(p.sin_fecha, 0)
    from llaves k
    join public.variedades v on v.id = k.variedad_id
    left join public.catalogo_productos pr on pr.id = v.producto_id
    left join plan p  on p.ciclo = k.ciclo and p.variedad_id = k.variedad_id
    left join real_ r on r.ciclo = k.ciclo and r.variedad_id = k.variedad_id
    where coalesce(p.area_plan, 0) > 0
       or coalesce(r.area_real, 0) > 0
       or coalesce(p.sin_fecha, 0) > 0
    order by k.ciclo, v.nombre
$$;

create or replace function public.fn_trasplante_liquidacion_plantulas(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    variedad    text,
    cultivo     text,
    facturadas  numeric,
    enviadas    numeric,
    consumidas  numeric,
    pendientes  numeric,
    pct         numeric,
    costo_total numeric
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
        pr.nombre,
        coalesce(r.facturadas, 0),
        coalesce(r.enviadas, 0),
        coalesce(c.consumidas, 0),
        coalesce(r.facturadas, 0) - coalesce(c.consumidas, 0),
        case when coalesce(r.facturadas, 0) > 0
             then round(coalesce(c.consumidas, 0) / r.facturadas * 100, 1) end,
        coalesce(r.costo_total, 0)
    from llaves k
    join public.variedades v on v.id = k.variedad_id
    left join public.catalogo_productos pr on pr.id = v.producto_id
    left join recibido r  on r.variedad_id = k.variedad_id
    left join consumido c on c.variedad_id = k.variedad_id
    order by v.nombre
$$;


-- Ya nadie la mira: fuera. El dato vive en `producto_id` y el texto
-- sólo podría volver a divergir del catálogo.
alter table public.variedades drop column if exists producto;


-- =====================================================================
-- D · LAS DOS LISTAS CERRADAS DE LA ROTACIÓN
-- =====================================================================
-- Enum y no catálogo: son listas físicas y cerradas. Un kilo es un kilo
-- y «sembrar con dron rentado» no es algo que se invente una tarde. Un
-- catálogo editable aquí sólo serviría para que alguien escriba «Kgs» y
-- parta el resumen de costos en dos.

do $$
begin
    if not exists (select 1 from pg_type where typname = 'umb_rotacion') then
        create type public.umb_rotacion as enum ('KG', 'LB', 'G', 'OZ', 'TON', 'L', 'ML', 'UNIDAD');
    end if;
    if not exists (select 1 from pg_type where typname = 'tipo_siembra_rotacion') then
        create type public.tipo_siembra_rotacion as enum
            ('DIRECTA', 'DRON_RENTADO', 'CON_SEMBRADORA', 'PLANTULA');
    end if;
end $$;


-- =====================================================================
-- E · EL PLAN Y EL AVANCE
-- =====================================================================
-- El lote se referencia por `lote_temporada_id` y no por `lote_id`, que
-- es lo que ya hacen el plan de siembra y la siembra diaria. La razón es
-- que la ZONA de un lote es de la temporada —un lote cambia de zona
-- entre temporadas— y con `lote_id` suelto habría que guardarla aparte,
-- copiada, para que después se desincronice. Por ahí llegan gratis la
-- nomenclatura, la zona y el área.
--
-- Las tres columnas calculadas son `generated ... stored`: no se
-- teclean, no se pueden desincronizar de sus factores y no hay dos
-- sitios que las calculen distinto. Se corrigen moviendo el factor.

create table if not exists public.rotacion_plan (
    id                  uuid primary key default gen_random_uuid(),
    temporada_id        uuid not null references public.temporadas(id),
    lote_temporada_id   uuid not null references public.lotes_temporada(id) on delete cascade,
    variedad_id         uuid not null references public.variedades(id),
    area_planificada_mz numeric(12,4) not null check (area_planificada_mz >= 0),
    dosis_mz            numeric(12,4) check (dosis_mz >= 0),
    umb                 public.umb_rotacion,
    dosis_total_area    numeric(14,4)
        generated always as (round(area_planificada_mz * coalesce(dosis_mz, 0), 4)) stored,
    observaciones       text,
    created_at          timestamptz not null default now()
);

comment on table public.rotacion_plan is
'Plan de cultivos de rotación: cuánto se va a sembrar en cada lote y con cuánta semilla por manzana.';
comment on column public.rotacion_plan.dosis_total_area is
'Área × dosis. Columna generada: ni se teclea ni puede quedar desfasada de sus dos factores.';

create index if not exists idx_rotacion_plan_temporada on public.rotacion_plan (temporada_id);
create index if not exists idx_rotacion_plan_lote      on public.rotacion_plan (lote_temporada_id);

create table if not exists public.rotacion_avance (
    id                    uuid primary key default gen_random_uuid(),
    temporada_id          uuid not null references public.temporadas(id),
    -- El día de Honduras, no el del servidor: a las seis de la tarde de
    -- Tegucigalpa el reloj UTC ya es del día siguiente, y la siembra de
    -- hoy quedaría contada mañana.
    fecha                 date not null
        default (now() at time zone 'America/Tegucigalpa')::date,
    lote_temporada_id     uuid not null references public.lotes_temporada(id) on delete cascade,
    variedad_id           uuid not null references public.variedades(id),
    avance_mz             numeric(12,4) not null check (avance_mz > 0),
    gasto_semilla         numeric(14,4) check (gasto_semilla >= 0),
    umb                   public.umb_rotacion,
    semilla_mz            numeric(14,4)
        generated always as (
            case when avance_mz > 0 then round(coalesce(gasto_semilla, 0) / avance_mz, 4) end
        ) stored,
    tipo_siembra          public.tipo_siembra_rotacion not null default 'DIRECTA',
    costo_tipo_siembra_mz numeric(14,4) check (costo_tipo_siembra_mz >= 0),
    costo_total           numeric(14,2)
        generated always as (round(coalesce(costo_tipo_siembra_mz, 0) * avance_mz, 2)) stored,
    observaciones         text,
    usuario_id            uuid references public.perfiles(id),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

comment on table public.rotacion_avance is
'Siembra diaria de rotación: lo que de verdad se sembró, con qué gasto de semilla y a qué costo.';
comment on column public.rotacion_avance.semilla_mz is
'Gasto de semilla ÷ avance. Generada: la división nunca se hace a mano ni sale de una celda de Excel.';

create index if not exists idx_rotacion_avance_temporada on public.rotacion_avance (temporada_id, fecha);
create index if not exists idx_rotacion_avance_lote      on public.rotacion_avance (lote_temporada_id);


-- =====================================================================
-- F · LA TEMPORADA SE DERIVA, NO SE TECLEA
-- =====================================================================
/**
 * La temporada sale del lote, y el lote tiene que ser agrícola.
 *
 * Dos cosas que la pantalla NO puede garantizar:
 *
 *   1. `temporada_id` no se recibe: se lee del `lotes_temporada`. Si se
 *      mandara desde el navegador, una línea podría quedar guardada en
 *      una temporada y apuntando a un lote de otra, y ese registro no
 *      aparecería en ningún resumen sin que nadie supiera por qué.
 *   2. Un departamento administrativo no se siembra. Existe para
 *      notificar costos de maquinaria a SAP; ofrecerlo era lo que
 *      llenaba el plan de líneas de 0 mz que nunca se iban a cumplir.
 */
create or replace function public.fn_rotacion_coherencia()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_temporada uuid;
    v_tipo      text;
begin
    select lt.temporada_id, lo.tipo::text into v_temporada, v_tipo
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    where lt.id = new.lote_temporada_id;

    if v_temporada is null then
        raise exception 'Ese lote ya no existe en ninguna temporada. Actualiza la lista.';
    end if;

    if v_tipo is distinct from 'AGRICOLA' then
        raise exception 'Un departamento administrativo no se siembra: elige un lote agrícola.'
            using errcode = '23514';
    end if;

    new.temporada_id := v_temporada;
    return new;
end;
$$;

drop trigger if exists trg_rotacion_plan_coherencia on public.rotacion_plan;
create trigger trg_rotacion_plan_coherencia
    before insert or update of lote_temporada_id on public.rotacion_plan
    for each row execute function public.fn_rotacion_coherencia();

drop trigger if exists trg_rotacion_avance_coherencia on public.rotacion_avance;
create trigger trg_rotacion_avance_coherencia
    before insert or update of lote_temporada_id on public.rotacion_avance
    for each row execute function public.fn_rotacion_coherencia();

/** Quién capturó, del lado de la base: no se manda desde el navegador. */
create or replace function public.fn_rotacion_marcar_autor()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if tg_op = 'INSERT' then
        new.usuario_id := coalesce(new.usuario_id, auth.uid());
    end if;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_rotacion_avance_autor on public.rotacion_avance;
create trigger trg_rotacion_avance_autor
    before insert or update on public.rotacion_avance
    for each row execute function public.fn_rotacion_marcar_autor();


-- =====================================================================
-- G · PERMISOS
-- =====================================================================

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('rotacion', 'Cultivos de rotación',
     'Plan y avance diario de los cultivos que descansan el suelo entre ciclos',
     '/controles/rotacion', 56,
     array['ver','crear','editar','eliminar','exportar','importar'])
on conflict (codigo) do update
set nombre      = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta        = excluded.ruta,
    orden       = excluded.orden,
    acciones    = excluded.acciones;

-- Quien ya lleva el trasplante lleva también la rotación: es el mismo
-- trabajo —plan contra avance por lote— sobre los mismos lotes. Se
-- concede por lo que el rol YA puede hacer, no por cómo se llama.
insert into public.permisos (rol_id, recurso, accion)
select distinct p.rol_id, 'rotacion', p.accion
from public.permisos p
where p.recurso = 'trasplante'
  and p.accion in ('ver','crear','editar','eliminar','exportar','importar')
on conflict do nothing;

alter table public.rotacion_plan   enable row level security;
alter table public.rotacion_avance enable row level security;

drop policy if exists rotacion_plan_select on public.rotacion_plan;
create policy rotacion_plan_select on public.rotacion_plan for select
    using ((select public.fn_tiene_permiso('rotacion','ver')));
drop policy if exists rotacion_plan_insert on public.rotacion_plan;
create policy rotacion_plan_insert on public.rotacion_plan for insert
    with check ((select public.fn_tiene_permiso('rotacion','crear')));
drop policy if exists rotacion_plan_update on public.rotacion_plan;
create policy rotacion_plan_update on public.rotacion_plan for update
    using ((select public.fn_tiene_permiso('rotacion','editar')));
drop policy if exists rotacion_plan_delete on public.rotacion_plan;
create policy rotacion_plan_delete on public.rotacion_plan for delete
    using ((select public.fn_tiene_permiso('rotacion','eliminar')));

drop policy if exists rotacion_avance_select on public.rotacion_avance;
create policy rotacion_avance_select on public.rotacion_avance for select
    using ((select public.fn_tiene_permiso('rotacion','ver')));
drop policy if exists rotacion_avance_insert on public.rotacion_avance;
create policy rotacion_avance_insert on public.rotacion_avance for insert
    with check ((select public.fn_tiene_permiso('rotacion','crear')));
drop policy if exists rotacion_avance_update on public.rotacion_avance;
create policy rotacion_avance_update on public.rotacion_avance for update
    using ((select public.fn_tiene_permiso('rotacion','editar')));
drop policy if exists rotacion_avance_delete on public.rotacion_avance;
create policy rotacion_avance_delete on public.rotacion_avance for delete
    using ((select public.fn_tiene_permiso('rotacion','eliminar')));

grant select, insert, update, delete on public.rotacion_plan   to authenticated;
grant select, insert, update, delete on public.rotacion_avance to authenticated;


-- =====================================================================
-- H · LAS DOS VISTAS
-- =====================================================================
-- El lote, la zona, la variedad y el cultivo vienen resueltos desde la
-- base. La pantalla los enseña de sólo lectura al lado del selector: el
-- digitador elige el lote y ve inmediatamente en qué zona está, que es
-- justo la comprobación que evita capturar en el lote equivocado.

create or replace view public.v_rotacion_plan as
select
    p.id,
    p.temporada_id,
    p.lote_temporada_id,
    lo.nomenclatura        as ut,
    lo.nombre              as lote_nombre,
    z.nombre               as zona,
    p.variedad_id,
    v.nombre               as variedad,
    v.producto_id,
    pr.nombre              as producto,
    lt.area_neta,
    p.area_planificada_mz,
    p.dosis_mz,
    p.umb::text            as umb,
    p.dosis_total_area,
    p.observaciones,
    p.created_at
from public.rotacion_plan p
join public.lotes_temporada lt on lt.id = p.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.variedades v       on v.id = p.variedad_id
left join public.catalogo_productos pr on pr.id = v.producto_id;

alter view public.v_rotacion_plan set (security_invoker = on);
grant select on public.v_rotacion_plan to authenticated;

create or replace view public.v_rotacion_avance as
select
    a.id,
    a.temporada_id,
    a.fecha,
    a.lote_temporada_id,
    lo.nomenclatura        as ut,
    lo.nombre              as lote_nombre,
    z.nombre               as zona,
    a.variedad_id,
    v.nombre               as variedad,
    v.producto_id,
    pr.nombre              as producto,
    a.avance_mz,
    a.gasto_semilla,
    a.umb::text            as umb,
    a.semilla_mz,
    a.tipo_siembra::text   as tipo_siembra,
    a.costo_tipo_siembra_mz,
    a.costo_total,
    a.observaciones,
    a.usuario_id,
    pe.nombre              as usuario_nombre,
    a.created_at
from public.rotacion_avance a
join public.lotes_temporada lt on lt.id = a.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.variedades v       on v.id = a.variedad_id
left join public.catalogo_productos pr on pr.id = v.producto_id
left join public.perfiles pe   on pe.id = a.usuario_id;

alter view public.v_rotacion_avance set (security_invoker = on);
grant select on public.v_rotacion_avance to authenticated;


-- =====================================================================
-- I · LOS CINCO RESÚMENES
-- =====================================================================
-- Todos con FECHA DE CORTE, igual que el trasplante: «cómo vamos al 15»
-- se contesta cortando lo real, no el plan. El plan de rotación no lleva
-- fecha prevista —se siembra cuando el lote queda libre—, así que el
-- plan es siempre el de la temporada entera y el corte sólo mueve lo
-- real. Eso hay que decirlo en la pantalla, y se dice.

create or replace function public.fn_rotacion_estadisticas(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    area_plan     numeric,
    area_real     numeric,
    pendiente     numeric,
    pct           numeric,
    lotes_plan    integer,
    lotes_real    integer,
    gasto_semilla numeric,
    costo_total   numeric
)
language sql stable security invoker as $$
    with plan as (
        select coalesce(sum(p.area_planificada_mz), 0) as area,
               count(distinct p.lote_temporada_id)     as lotes
        from public.rotacion_plan p
        where p.temporada_id = p_temporada_id
    ),
    real_ as (
        select coalesce(sum(a.avance_mz), 0)       as area,
               count(distinct a.lote_temporada_id) as lotes,
               coalesce(sum(a.gasto_semilla), 0)   as semilla,
               coalesce(sum(a.costo_total), 0)     as costo
        from public.rotacion_avance a
        where a.temporada_id = p_temporada_id
          and (p_hasta is null or a.fecha <= p_hasta)
    )
    select
        plan.area,
        real_.area,
        -- Puede salir negativo, y así se enseña: sembrar de más también
        -- es una desviación del plan y esconderla con un `greatest(…, 0)`
        -- sería contar una mentira cómoda.
        plan.area - real_.area,
        case when plan.area > 0 then round(real_.area / plan.area * 100, 1) end,
        plan.lotes::integer,
        real_.lotes::integer,
        real_.semilla,
        real_.costo
    from plan, real_
$$;

comment on function public.fn_rotacion_estadisticas(uuid, date) is
'Los cuatro números de arriba: planificado, real hasta el corte, pendiente y porcentaje.';

create or replace function public.fn_rotacion_por_variedad(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    variedad      text,
    producto      text,
    area_plan     numeric,
    area_real     numeric,
    pct           numeric,
    gasto_semilla numeric,
    semilla_mz    numeric,
    costo_total   numeric
)
language sql stable security invoker as $$
    with plan as (
        select p.variedad_id, sum(p.area_planificada_mz) as area
        from public.rotacion_plan p
        where p.temporada_id = p_temporada_id
        group by p.variedad_id
    ),
    real_ as (
        select a.variedad_id,
               sum(a.avance_mz) as area,
               sum(coalesce(a.gasto_semilla, 0)) as semilla,
               sum(a.costo_total) as costo
        from public.rotacion_avance a
        where a.temporada_id = p_temporada_id
          and (p_hasta is null or a.fecha <= p_hasta)
        group by a.variedad_id
    ),
    llaves as (
        select variedad_id from plan union select variedad_id from real_
    )
    select
        v.nombre,
        pr.nombre,
        coalesce(p.area, 0),
        coalesce(r.area, 0),
        case when coalesce(p.area, 0) > 0 then round(coalesce(r.area, 0) / p.area * 100, 1) end,
        coalesce(r.semilla, 0),
        -- La semilla por manzana del GRUPO se recalcula sobre los
        -- totales. Promediar los `semilla_mz` de cada línea daría un
        -- número distinto —y equivocado— en cuanto las líneas tengan
        -- áreas distintas, que es siempre.
        case when coalesce(r.area, 0) > 0 then round(coalesce(r.semilla, 0) / r.area, 4) end,
        coalesce(r.costo, 0)
    from llaves k
    join public.variedades v on v.id = k.variedad_id
    left join public.catalogo_productos pr on pr.id = v.producto_id
    left join plan p  on p.variedad_id = k.variedad_id
    left join real_ r on r.variedad_id = k.variedad_id
    order by v.nombre
$$;

create or replace function public.fn_rotacion_por_zona(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    zona        text,
    encargado   text,
    area_plan   numeric,
    area_real   numeric,
    pct         numeric,
    lotes       integer,
    costo_total numeric
)
language sql stable security invoker as $$
    with plan as (
        select lt.zona_id, sum(p.area_planificada_mz) as area,
               count(distinct p.lote_temporada_id) as lotes
        from public.rotacion_plan p
        join public.lotes_temporada lt on lt.id = p.lote_temporada_id
        where p.temporada_id = p_temporada_id
        group by lt.zona_id
    ),
    real_ as (
        select lt.zona_id, sum(a.avance_mz) as area, sum(a.costo_total) as costo
        from public.rotacion_avance a
        join public.lotes_temporada lt on lt.id = a.lote_temporada_id
        where a.temporada_id = p_temporada_id
          and (p_hasta is null or a.fecha <= p_hasta)
        group by lt.zona_id
    ),
    llaves as (
        select zona_id from plan union select zona_id from real_
    )
    select
        coalesce(z.nombre, 'Sin zona'),
        z.responsable,
        coalesce(p.area, 0),
        coalesce(r.area, 0),
        case when coalesce(p.area, 0) > 0 then round(coalesce(r.area, 0) / p.area * 100, 1) end,
        coalesce(p.lotes, 0)::integer,
        coalesce(r.costo, 0)
    from llaves k
    left join public.zonas z on z.id = k.zona_id
    left join plan p  on p.zona_id is not distinct from k.zona_id
    left join real_ r on r.zona_id is not distinct from k.zona_id
    order by 1
$$;

/**
 * Lote por lote: lo planificado contra lo hecho, y con qué variedad.
 *
 * Es el resumen que contesta la pregunta incómoda: «este lote iba a
 * llevar maíz y lleva sorgo». Por eso las dos variedades salen en
 * columnas distintas en vez de agrupar por variedad: agrupando, un
 * cambio de variedad se ve como un plan incumplido y un avance sin plan,
 * en dos filas que nadie relaciona.
 */
create or replace function public.fn_rotacion_por_lote(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    lote_temporada_id uuid,
    ut                text,
    lote_nombre       text,
    zona              text,
    variedad_plan     text,
    variedad_real     text,
    area_plan         numeric,
    area_real         numeric,
    pct               numeric,
    coincide          boolean,
    costo_total       numeric
)
language sql stable security invoker as $$
    with plan as (
        select p.lote_temporada_id,
               sum(p.area_planificada_mz) as area,
               string_agg(distinct v.nombre, ', ' order by v.nombre) as variedades
        from public.rotacion_plan p
        join public.variedades v on v.id = p.variedad_id
        where p.temporada_id = p_temporada_id
        group by p.lote_temporada_id
    ),
    real_ as (
        select a.lote_temporada_id,
               sum(a.avance_mz) as area,
               sum(a.costo_total) as costo,
               string_agg(distinct v.nombre, ', ' order by v.nombre) as variedades
        from public.rotacion_avance a
        join public.variedades v on v.id = a.variedad_id
        where a.temporada_id = p_temporada_id
          and (p_hasta is null or a.fecha <= p_hasta)
        group by a.lote_temporada_id
    ),
    llaves as (
        select lote_temporada_id from plan union select lote_temporada_id from real_
    )
    select
        k.lote_temporada_id,
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        p.variedades,
        r.variedades,
        coalesce(p.area, 0),
        coalesce(r.area, 0),
        case when coalesce(p.area, 0) > 0 then round(coalesce(r.area, 0) / p.area * 100, 1) end,
        -- `null` cuando todavía no hay avance: no es que no coincida, es
        -- que aún no se sabe, y pintarlo de rojo sería una falsa alarma
        -- en todo lote que no ha arrancado.
        case when p.variedades is not null and r.variedades is not null
             then p.variedades = r.variedades end,
        coalesce(r.costo, 0)
    from llaves k
    join public.lotes_temporada lt on lt.id = k.lote_temporada_id
    join public.lotes lo           on lo.id = lt.lote_id
    left join public.zonas z       on z.id = lt.zona_id
    left join plan p  on p.lote_temporada_id = k.lote_temporada_id
    left join real_ r on r.lote_temporada_id = k.lote_temporada_id
    order by lo.nomenclatura
$$;

create or replace function public.fn_rotacion_por_tipo_siembra(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    tipo_siembra text,
    lineas       integer,
    area_real    numeric,
    costo_mz     numeric,
    costo_total  numeric,
    pct_area     numeric
)
language sql stable security invoker as $$
    with base as (
        select a.tipo_siembra::text as tipo,
               count(*)             as lineas,
               sum(a.avance_mz)     as area,
               sum(a.costo_total)   as costo
        from public.rotacion_avance a
        where a.temporada_id = p_temporada_id
          and (p_hasta is null or a.fecha <= p_hasta)
        group by a.tipo_siembra
    ),
    total as (select coalesce(sum(area), 0) as area from base)
    select
        b.tipo,
        b.lineas::integer,
        b.area,
        -- Costo por manzana del grupo: el total entre las manzanas. Es
        -- la cifra que se compara entre tipos de siembra, y promediar
        -- los costos unitarios de cada línea daría otra.
        case when b.area > 0 then round(b.costo / b.area, 4) end,
        b.costo,
        case when total.area > 0 then round(b.area / total.area * 100, 1) end
    from base b, total
    order by b.costo desc
$$;


-- =====================================================================
-- J · EL GUARDIÁN
-- =====================================================================

do $$
declare v_faltan integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    if v_faltan > 0 then
        raise exception 'Quedaron % llaves sin casilla en la matriz.', v_faltan;
    end if;
    raise notice 'ok  la matriz ofrece todas las llaves que la base exige';
end $$;
