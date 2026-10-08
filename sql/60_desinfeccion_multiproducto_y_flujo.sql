-- =====================================================================
-- 60 · DESINFECCIÓN — MULTIPRODUCTO Y REESTRUCTURA DEL FLUJO
-- =====================================================================
--
-- La 59 dio por supuesto que una aplicación lleva UN químico y que un
-- lote se planifica UNA vez por ciclo. Las dos cosas son falsas en campo:
--
--   · Un lote se parte: diez manzanas con Vapam y diez con Mercenario.
--     Son dos líneas de plan del MISMO lote y el mismo ciclo.
--
--   · Una aplicación lleva varios productos —el desinfectante y el ácido,
--     y mañana otro—. Con `producto_id`, `litros_acido` y
--     `costo_litro_acido` como columnas de la cabecera, el segundo
--     producto no cabe: hay que añadir una columna por cada uno, y el
--     costo deja de poder sumarse sin nombrarlos a mano.
--
-- Esta migración:
--
--   A · La estación de riego gana zona, para poder recortarla como se
--       recortan el turno y el lote.
--   B · Fuera las vistas (se vuelven a crear enteras al final).
--   C · El plan admite varios productos por lote y ciclo.
--   D · La ejecución gana CICLO —es con lo que se la busca— y fecha
--       propia de lecturas, y sus horas pasan a calcularse solas.
--   E · Los químicos salen de la cabecera a su propia tabla.
--   F · De dónde sale la siembra para autocompletar.
--   G · RLS de lo nuevo.
--   H · Las vistas, con su reja.
--   I · Los guardianes.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · LA ESTACIÓN DE RIEGO, CON SU ZONA
-- =====================================================================
-- El encargo pide recortar por zona los tres selectores del módulo:
-- turno, lote y estación de riego. Los dos primeros ya saben en qué zona
-- están; la estación no tenía dónde guardarlo.
--
-- Nace NULA a propósito, y una estación sin zona la sigue viendo todo el
-- mundo: el día que se instala esta migración ninguna tiene zona, y
-- esconderlas todas dejaría el módulo sin poder capturar hasta que
-- alguien entre a Catálogos. Se asignan y entonces empiezan a recortar.

alter table public.estaciones_riego
    add column if not exists zona_id uuid references public.zonas(id);

create index if not exists estaciones_riego_zona_idx
    on public.estaciones_riego (zona_id);

comment on column public.estaciones_riego.zona_id is
    'La zona de la estación. Nula = todavía sin asignar, y entonces no recorta a nadie.';

-- =====================================================================
-- B · FUERA LAS VISTAS
-- =====================================================================
-- Se van las siete —las seis de la 59 y la nueva— antes de tocar las
-- columnas: una vista cuelga de los tipos de lo que lee, y Postgres no
-- deja quitar una columna que una vista nombra. Se recrean enteras en la
-- sección H, que además es el único sitio donde está escrita su reja.

do $$
declare
    v text;
begin
    foreach v in array array['v_desinfeccion_plan', 'v_desinfeccion_ejecucion',
                             'v_desinfeccion_lotes', 'v_desinfeccion_personal',
                             'v_desinfeccion_logistica', 'v_desinfeccion_costos',
                             'v_desinfeccion_productos']
    loop
        execute format('drop view if exists public.%I', v);
        execute format('drop view if exists interno.%I', v || '_crudo');
    end loop;
end $$;

-- =====================================================================
-- C · EL PLAN, MULTIPRODUCTO
-- =====================================================================
-- Antes: `unique (lote_temporada_id, ciclo)` — un lote, una línea, un
-- producto. Ahora el producto entra en la llave, así que el mismo lote
-- admite tantas líneas como productos distintos.
--
-- `nulls not distinct` es lo que hace que esto no se vuelva un coladero:
-- sin eso, Postgres considera que dos nulos son distintos y se podrían
-- meter cien líneas del mismo lote sin producto, que es exactamente el
-- duplicado que la llave venía a impedir.

do $$
declare
    v_nombre text;
begin
    select c.conname into v_nombre
    from pg_constraint c
    where c.conrelid = 'public.desinfeccion_plan'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (lote_temporada_id, ciclo)';
    if v_nombre is not null then
        execute format('alter table public.desinfeccion_plan drop constraint %I', v_nombre);
    end if;
end $$;

create unique index if not exists desinfeccion_plan_lote_ciclo_producto_uidx
    on public.desinfeccion_plan (lote_temporada_id, ciclo, producto_id)
    nulls not distinct;

comment on index public.desinfeccion_plan_lote_ciclo_producto_uidx is
    'Un lote se puede partir entre productos en el mismo ciclo, pero no repetir el mismo producto.';

-- =====================================================================
-- D · LA EJECUCIÓN: CICLO, FECHA DE LECTURAS Y HORAS QUE SE CALCULAN
-- =====================================================================

-- El ciclo es con lo que la pantalla BUSCA la ejecución: se eligen turno
-- y ciclo, y o se abre la que ya existe o se empieza una. Sin ciclo, el
-- segundo ciclo del mismo turno sería otra fila indistinguible.
alter table public.desinfeccion_ejecucion
    add column if not exists ciclo smallint not null default 1;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.desinfeccion_ejecucion'::regclass
          and conname = 'desinfeccion_ejec_ciclo_positivo')
    then
        alter table public.desinfeccion_ejecucion
            add constraint desinfeccion_ejec_ciclo_positivo check (ciclo > 0);
    end if;
end $$;

-- La fase 2 tiene su propio día: se riega un día y se leen los
-- tensiómetros otro. Con una sola fecha para todo, el DDT de la lectura
-- salía del día del preriego y no del día en que se midió.
alter table public.desinfeccion_ejecucion
    add column if not exists fecha_lecturas date;

-- Una ejecución por turno y ciclo dentro de la temporada. Si ya hubiera
-- duplicados se dice CUÁLES, en vez de dejar que el índice reviente con
-- un mensaje que no dice dónde mirar.
do $$
declare
    v_duplicados text;
begin
    select string_agg(format('turno %s, ciclo %s (%s veces)', turno_id, ciclo, n), '; ')
      into v_duplicados
    from (
        select temporada_id, turno_id, ciclo, count(*) as n
        from public.desinfeccion_ejecucion
        group by temporada_id, turno_id, ciclo
        having count(*) > 1
    ) d;
    if v_duplicados is not null then
        raise exception
            'Hay ejecuciones repetidas del mismo turno y ciclo; hay que unirlas antes: %',
            v_duplicados;
    end if;
end $$;

create unique index if not exists desinfeccion_ejec_turno_ciclo_uidx
    on public.desinfeccion_ejecucion (temporada_id, turno_id, ciclo);

/* -------------------- Las horas, calculadas por la base -------------- */
-- Estaban a mano y el encargo las quiere automáticas y bloqueadas. Van
-- como COLUMNAS GENERADAS y no como un cálculo del navegador por lo de
-- siempre: una suma que se hace en la pantalla acaba distinta de la del
-- reporte y nadie sabe cuál rige.
--
-- `greatest(fin - inicio, interval '0')` resuelve dos cosas a la vez: un
-- fin anterior al inicio no resta horas, y —porque `greatest` ignora los
-- nulos— una hora todavía sin capturar cuenta como cero en vez de
-- anular la suma entera.

alter table public.desinfeccion_ejecucion drop column if exists horas_preriego;
alter table public.desinfeccion_ejecucion
    add column horas_preriego numeric(10,2) generated always as (
        extract(epoch from greatest(hora_fin_preriego - hora_inicio_preriego, interval '0')) / 3600.0
    ) stored;

alter table public.desinfeccion_ejecucion drop column if exists horas_inyeccion;
alter table public.desinfeccion_ejecucion
    add column horas_inyeccion numeric(10,2) generated always as (
        extract(epoch from greatest(hora_fin_iny - hora_inicio_iny, interval '0')) / 3600.0
    ) stored;

-- El total pasa de columna escrita a mano a columna generada. No se
-- puede convertir en sitio: hay que quitarla y volver a ponerla.
alter table public.desinfeccion_ejecucion drop column if exists total_horas_riego;
alter table public.desinfeccion_ejecucion
    add column total_horas_riego numeric(10,2) generated always as (
        coalesce(horas_presurizacion, 0)
        + extract(epoch from greatest(hora_fin_iny - hora_inicio_iny, interval '0')) / 3600.0
        + coalesce(horas_lavado, 0)
    ) stored;

comment on column public.desinfeccion_ejecucion.total_horas_riego is
    'Presurización + inyección + lavado. Generada: no se puede escribir a mano ni quedar desalineada.';

-- =====================================================================
-- E · LOS QUÍMICOS, FUERA DE LA CABECERA
-- =====================================================================
-- Una aplicación lleva varios productos. Con columnas en la cabecera, el
-- segundo no cabe —y añadir `producto_2_id` es cómo empiezan las tablas
-- con veinte columnas de las que sólo se usan dos—.

create table if not exists public.desinfeccion_ejecucion_productos (
    id            uuid primary key default gen_random_uuid(),
    ejecucion_id  uuid not null references public.desinfeccion_ejecucion(id) on delete cascade,
    producto_id   uuid not null references public.materiales(id),

    -- Se captura el TOTAL aplicado, no la dosis. La dosis por manzana se
    -- deduce dividiendo entre las manzanas del turno, y deducirla es
    -- mejor que capturarla: capturadas las dos, un día no cuadran.
    total_litros  numeric(14,4) not null default 0 check (total_litros >= 0),
    costo_litro   numeric(12,4) not null default 0 check (costo_litro >= 0),
    costo_total   numeric(16,4) generated always as (total_litros * costo_litro) stored,

    created_at    timestamptz not null default now(),

    -- El mismo producto dos veces en la misma aplicación es un error de
    -- captura: se suman los litros en una línea.
    unique (ejecucion_id, producto_id)
);

comment on table public.desinfeccion_ejecucion_productos is
    'Los químicos de una aplicación. Tabla y no columnas porque una aplicación lleva varios.';

create index if not exists desinfeccion_ejec_productos_idx
    on public.desinfeccion_ejecucion_productos (ejecucion_id);

-- Lo que ya estuviera capturado en las columnas viejas se trae antes de
-- quitarlas. Perder un costo capturado por un cambio de forma de la
-- tabla es la clase de pérdida que nadie nota hasta que cuadra el mes.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
          and column_name = 'litros_acido')
    then
        insert into public.desinfeccion_ejecucion_productos
            (ejecucion_id, producto_id, total_litros, costo_litro)
        select e.id, e.producto_id,
               coalesce(e.litros_acido, 0), coalesce(e.costo_litro_acido, 0)
        from public.desinfeccion_ejecucion e
        where e.producto_id is not null
          and (coalesce(e.litros_acido, 0) > 0 or coalesce(e.costo_litro_acido, 0) > 0)
        on conflict (ejecucion_id, producto_id) do nothing;
    end if;
end $$;

alter table public.desinfeccion_ejecucion drop column if exists costo_acido;
alter table public.desinfeccion_ejecucion drop column if exists litros_acido;
alter table public.desinfeccion_ejecucion drop column if exists costo_litro_acido;
alter table public.desinfeccion_ejecucion drop column if exists producto_id;

-- =====================================================================
-- F · DE DÓNDE SALE LA SIEMBRA
-- =====================================================================
-- Al elegir el lote en el plan, la pantalla rellena sola la fecha de
-- siembra y la variedad. Ese dato vive en `siembras`, que es la captura
-- de Trasplante, y su RLS pide el permiso de Trasplante — que quien
-- planifica una desinfección no tiene por qué tener.
--
-- Por eso la función es `security definer` y **comprueba el permiso ella
-- misma**: sin esa comprobación sería un agujero por el que cualquiera
-- leería la siembra de toda la finca. Con ella, entrega exactamente lo
-- que la pantalla necesita a quien ya puede ver el módulo.
--
-- Devuelve la PRIMERA siembra del lote en el ciclo: un lote se siembra en
-- varios días y la que manda para contar los días a la aplicación es la
-- que abrió el ciclo.

create or replace function public.fn_siembras_de_lotes(
    p_lotes uuid[],
    p_ciclo integer default null
)
returns table (
    lote_temporada_id uuid,
    fecha_siembra     date,
    variedad_id       uuid,
    variedad_nombre   text
)
language sql stable security definer set search_path = public, pg_temp as $$
    select distinct on (s.lote_temporada_id)
           s.lote_temporada_id,
           s.fecha_siembra,
           s.variedad_id,
           v.nombre
    from public.siembras s
    left join public.variedades v on v.id = s.variedad_id
    where s.lote_temporada_id = any(p_lotes)
      and (p_ciclo is null or s.ciclo = p_ciclo)
      and (public.fn_tiene_permiso('desinfeccion', 'ver')
           or public.fn_tiene_permiso('trasplante', 'ver'))
    order by s.lote_temporada_id, s.fecha_siembra
$$;

comment on function public.fn_siembras_de_lotes(uuid[], integer) is
    'La primera siembra de cada lote en un ciclo. Definer, pero comprueba el permiso dentro.';

grant execute on function public.fn_siembras_de_lotes(uuid[], integer) to authenticated;

-- =====================================================================
-- G · RLS DE LA TABLA NUEVA
-- =====================================================================
-- Hereda de su ejecución, igual que los lotes regados y la cuadrilla:
-- se puede tocar la línea si se puede tocar el turno del que cuelga.
-- Escribir la regla otra vez aquí es garantizar que dentro de un año
-- diga otra cosa.

alter table public.desinfeccion_ejecucion_productos enable row level security;

drop policy if exists desinfeccion_ejec_productos_select on public.desinfeccion_ejecucion_productos;
create policy desinfeccion_ejec_productos_select
    on public.desinfeccion_ejecucion_productos for select
    using (
        (select public.fn_permitido_de('desinfeccion', 'ver'))
        and (select public.fn_verificar_permiso('desinfeccion', 'ver',
                (select public.fn_dueno_desinfeccion(
                    desinfeccion_ejecucion_productos.ejecucion_id))))
    );

drop policy if exists desinfeccion_ejec_productos_write on public.desinfeccion_ejecucion_productos;
create policy desinfeccion_ejec_productos_write
    on public.desinfeccion_ejecucion_productos for all
    using ((select public.fn_verificar_permiso('desinfeccion', 'editar',
                (select public.fn_dueno_desinfeccion(
                    desinfeccion_ejecucion_productos.ejecucion_id)))))
    with check ((select public.fn_verificar_permiso('desinfeccion', 'crear')));

-- =====================================================================
-- H · LAS VISTAS, OTRA VEZ ENTERAS
-- =====================================================================
-- Patrón de la 56/57/59: cruda en `interno` con `security_invoker = off`
-- y expuesta en `public` con la reja de SU pantalla.

create schema if not exists interno;

/* ----------------------------- El plan ----------------------------- */

create or replace view interno.v_desinfeccion_plan_crudo as
select
    p.id,
    p.temporada_id,
    tm.nombre                as temporada_nombre,
    p.lote_temporada_id,
    lo.nomenclatura          as lote_nomenclatura,
    lo.nombre                as lote_nombre,
    lt.zona_id,
    z.nombre                 as zona_nombre,
    p.ciclo,
    p.fecha_siembra_congelada,
    p.dias_aplicacion,
    p.fecha_aplicacion,
    p.variedad_id,
    v.nombre                 as variedad_nombre,
    p.producto_id,
    m.descripcion            as producto_nombre,
    m.codigo                 as producto_codigo,
    p.dosis_mz,
    p.area_planificada_mz,
    p.costo_litro,
    p.total_litros,
    p.total_costo,
    p.costo_mz,
    p.comentarios,
    p.usuario_id,
    pe.nombre                as usuario_nombre,
    p.created_at
from public.desinfeccion_plan p
join public.lotes_temporada lt on lt.id = p.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.temporadas tm      on tm.id = p.temporada_id
left join public.variedades v  on v.id = p.variedad_id
left join public.materiales m  on m.id = p.producto_id
left join public.perfiles pe   on pe.id = p.usuario_id;

/* -------------------------- La ejecución --------------------------- */

create or replace view interno.v_desinfeccion_ejecucion_crudo as
select
    e.id,
    e.temporada_id,
    tm.nombre               as temporada_nombre,
    e.turno_id,
    tn.nombre               as turno_nombre,
    tn.codigo               as turno_codigo,
    tn.zona_id,
    z.nombre                as zona_nombre,
    e.ciclo,
    e.estado,

    e.fecha_preriego,
    e.hora_inicio_preriego,
    e.hora_fin_preriego,
    e.horas_preriego,
    e.obs_preriego,

    e.fecha_lecturas,
    e.lecturas_tensiometro,

    e.fecha_aplicacion,
    e.estacion_riego_id,
    er.nombre               as estacion_riego_nombre,
    e.horas_presurizacion,
    e.hora_inicio_iny,
    e.hora_fin_iny,
    e.horas_inyeccion,
    e.horas_lavado,
    e.total_horas_riego,
    e.ppm,
    e.ce_antes,
    e.ce_durante,
    e.ce_despues,
    e.calibracion_entrada,
    e.calibracion_salida,
    e.calibracion_campo,

    -- Lo que cuelga, resumido: la cuadrícula lo necesita en la lista y
    -- bajarlo aparte serían tres consultas por fila.
    coalesce(l.mz_regadas, 0)        as mz_regadas,
    coalesce(l.lotes_regados, 0)     as lotes_regados,
    coalesce(pr.costo_personal, 0)   as costo_personal,
    coalesce(q.costo_quimico, 0)     as costo_quimico,
    coalesce(q.productos, 0)         as productos,
    q.productos_nombres,

    e.usuario_id,
    pf.nombre               as usuario_nombre,
    e.created_at
from public.desinfeccion_ejecucion e
join public.temporadas tm            on tm.id = e.temporada_id
join public.turnos tn                on tn.id = e.turno_id
left join public.zonas z             on z.id = tn.zona_id
left join public.estaciones_riego er on er.id = e.estacion_riego_id
left join public.perfiles pf         on pf.id = e.usuario_id
left join lateral (
    select sum(x.mz_cubiertas) as mz_regadas, count(*) as lotes_regados
    from public.desinfeccion_ejecucion_lotes x
    where x.ejecucion_id = e.id
) l on true
left join lateral (
    select sum(x.costo_total) as costo_personal
    from public.desinfeccion_personal x
    where x.ejecucion_id = e.id
) pr on true
left join lateral (
    select sum(x.costo_total)                        as costo_quimico,
           count(*)                                  as productos,
           string_agg(mm.descripcion, ', '
                      order by mm.descripcion)       as productos_nombres
    from public.desinfeccion_ejecucion_productos x
    join public.materiales mm on mm.id = x.producto_id
    where x.ejecucion_id = e.id
) q on true;

/* ------------------------ Los lotes regados ------------------------ */

create or replace view interno.v_desinfeccion_lotes_crudo as
select
    dl.id,
    dl.ejecucion_id,
    e.temporada_id,
    e.fecha_aplicacion,
    e.turno_id,
    tn.nombre        as turno_nombre,
    e.ciclo,
    dl.lote_temporada_id,
    lo.nomenclatura  as lote_nomenclatura,
    lo.nombre        as lote_nombre,
    lt.zona_id,
    z.nombre         as zona_nombre,
    dl.mz_cubiertas,
    e.usuario_id,
    dl.created_at
from public.desinfeccion_ejecucion_lotes dl
join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
join public.lotes_temporada lt       on lt.id = dl.lote_temporada_id
join public.lotes lo                 on lo.id = lt.lote_id
left join public.zonas z             on z.id = lt.zona_id;

/* --------------------------- Los químicos -------------------------- */
/**
 * La dosis por manzana se DEDUCE, no se captura.
 *
 * Se anota el total aplicado y la vista lo divide entre las manzanas que
 * ese turno regó. Capturar las dos cosas es garantizar que un día no
 * cuadren, y entonces no hay forma de saber cuál de las dos es la buena.
 * `nullif` porque un turno sin lotes todavía no es un error: es un turno
 * que aún no se ha repartido.
 */
create or replace view interno.v_desinfeccion_productos_crudo as
select
    dp.id,
    dp.ejecucion_id,
    e.temporada_id,
    e.turno_id,
    tn.nombre        as turno_nombre,
    tn.zona_id,
    e.ciclo,
    e.fecha_aplicacion,
    dp.producto_id,
    m.codigo         as producto_codigo,
    m.descripcion    as producto_nombre,
    dp.total_litros,
    dp.costo_litro,
    dp.costo_total,
    coalesce(l.mz_regadas, 0)                       as mz_regadas,
    dp.total_litros / nullif(l.mz_regadas, 0)       as dosis_mz,
    e.usuario_id,
    dp.created_at
from public.desinfeccion_ejecucion_productos dp
join public.desinfeccion_ejecucion e on e.id = dp.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
join public.materiales m             on m.id = dp.producto_id
left join lateral (
    select sum(x.mz_cubiertas) as mz_regadas
    from public.desinfeccion_ejecucion_lotes x
    where x.ejecucion_id = e.id
) l on true;

/* ---------------------------- Personal ----------------------------- */

create or replace view interno.v_desinfeccion_personal_crudo as
select
    dp.id,
    dp.ejecucion_id,
    e.temporada_id,
    e.fecha_aplicacion,
    e.turno_id,
    tn.nombre        as turno_nombre,
    e.ciclo,
    dp.puesto_id,
    pt.codigo        as puesto_codigo,
    pt.descripcion   as puesto_nombre,
    dp.operador_id,
    op.nombre        as operador_nombre,
    dp.cantidad_personas,
    dp.jornadas,
    dp.horas_extras,
    dp.jornada_tipo,
    dp.tarifa_dia,
    dp.costo_total,
    e.usuario_id,
    dp.created_at
from public.desinfeccion_personal dp
join public.desinfeccion_ejecucion e on e.id = dp.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
join public.puestos_trabajo pt       on pt.id = dp.puesto_id
left join public.operadores op       on op.id = dp.operador_id;

/* ---------------------------- Logística ---------------------------- */

create or replace view interno.v_desinfeccion_logistica_crudo as
select
    dg.id,
    dg.temporada_id,
    tm.nombre       as temporada_nombre,
    dg.zona_id,
    z.nombre        as zona_nombre,
    dg.fecha,
    dg.equipo_id,
    eq.codigo       as equipo_codigo,
    eq.nombre       as equipo_nombre,
    dg.implemento_id,
    im.nombre       as implemento_nombre,
    dg.operador_id,
    op.nombre       as operador_nombre,
    dg.horas_trabajo,
    dg.costo_hora,
    dg.costo_total,
    dg.comentarios,
    dg.usuario_id,
    pe.nombre       as usuario_nombre,
    dg.created_at
from public.desinfeccion_logistica dg
join public.temporadas tm       on tm.id = dg.temporada_id
join public.zonas z             on z.id = dg.zona_id
join public.equipos eq          on eq.id = dg.equipo_id
left join public.implementos im on im.id = dg.implemento_id
left join public.operadores op  on op.id = dg.operador_id
left join public.perfiles pe    on pe.id = dg.usuario_id;

/* ====================== LA VISTA ANALÍTICA ========================= */
/**
 * El costo por lote: químico + personal + su parte de la bolsa zonal.
 *
 * Lo único que cambia respecto de la 59 es de dónde sale el químico: ya
 * no es una columna de la cabecera sino la SUMA de los productos de esa
 * aplicación. El reparto es el mismo y por los mismos motivos:
 *
 *   · El químico y el personal, entre los lotes de ESA ejecución, por
 *     manzanas.
 *   · La bolsa de logística, entre las manzanas de ESA zona en la
 *     temporada, y se reparte al LEER.
 */
create or replace view interno.v_desinfeccion_costos_crudo as
with regado as (
    select
        dl.lote_temporada_id,
        dl.ejecucion_id,
        e.temporada_id,
        lt.zona_id,
        dl.mz_cubiertas
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.lotes_temporada lt       on lt.id = dl.lote_temporada_id
),
por_ejecucion as (
    select ejecucion_id, sum(mz_cubiertas) as mz_total
    from regado group by ejecucion_id
),
por_zona as (
    select temporada_id, zona_id, sum(mz_cubiertas) as mz_zona
    from regado group by temporada_id, zona_id
),
bolsa as (
    select temporada_id, zona_id, sum(costo_total) as bolsa_zona
    from public.desinfeccion_logistica
    group by temporada_id, zona_id
),
personal as (
    select ejecucion_id, sum(costo_total) as costo_personal
    from public.desinfeccion_personal group by ejecucion_id
),
-- Lo nuevo de la 60: el químico de la ejecución es la suma de TODOS sus
-- productos, no una columna.
quimico as (
    select ejecucion_id, sum(costo_total) as costo_quimico
    from public.desinfeccion_ejecucion_productos group by ejecucion_id
)
select
    r.lote_temporada_id,
    lo.nomenclatura                                   as lote_nomenclatura,
    lo.nombre                                         as lote_nombre,
    r.temporada_id,
    tm.nombre                                         as temporada_nombre,
    r.zona_id,
    z.nombre                                          as zona_nombre,

    sum(r.mz_cubiertas)                               as mz_regadas,

    sum(coalesce(qu.costo_quimico, 0)
        * r.mz_cubiertas / nullif(pe_.mz_total, 0))   as costo_quimico,

    sum(coalesce(pr.costo_personal, 0)
        * r.mz_cubiertas / nullif(pe_.mz_total, 0))   as costo_personal,

    -- `max` y no `sum` porque la bolsa es una por zona y el join la
    -- repite en cada fila de regado.
    max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0))
        * sum(r.mz_cubiertas)                         as costo_logistica,

    sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas)
                                                      as costo_total,

    (sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas))
      / nullif(sum(r.mz_cubiertas), 0)                as costo_mz
from regado r
join public.desinfeccion_ejecucion e on e.id = r.ejecucion_id
join public.lotes_temporada lt       on lt.id = r.lote_temporada_id
join public.lotes lo                 on lo.id = lt.lote_id
join public.temporadas tm            on tm.id = r.temporada_id
left join public.zonas z             on z.id = r.zona_id
left join por_ejecucion pe_          on pe_.ejecucion_id = r.ejecucion_id
left join por_zona pz                on pz.temporada_id = r.temporada_id
                                    and pz.zona_id is not distinct from r.zona_id
left join bolsa b                    on b.temporada_id = r.temporada_id
                                    and b.zona_id is not distinct from r.zona_id
left join personal pr                on pr.ejecucion_id = r.ejecucion_id
left join quimico qu                 on qu.ejecucion_id = r.ejecucion_id
group by r.lote_temporada_id, lo.nomenclatura, lo.nombre,
         r.temporada_id, tm.nombre, r.zona_id, z.nombre;

-- --------------------- Las expuestas, con su reja -------------------
-- Siete ahora. La reja se escribe UNA vez, en este bucle: siete rejas
-- escritas a mano acaban siendo siete rejas ligeramente distintas, y la
-- que esté mal no la ve nadie.

do $$
declare
    v record;
    v_dueno text;
    v_zona  text;
begin
    for v in
        select * from (values
            ('v_desinfeccion_plan',       'usuario_id', 'lote_temporada_id'),
            ('v_desinfeccion_ejecucion',  'usuario_id', null),
            ('v_desinfeccion_lotes',      'usuario_id', 'lote_temporada_id'),
            ('v_desinfeccion_productos',  'usuario_id', 'zona_id'),
            ('v_desinfeccion_personal',   'usuario_id', null),
            ('v_desinfeccion_logistica',  'usuario_id', 'zona_id'),
            ('v_desinfeccion_costos',     null,         'zona_id')
        ) as t(vista, col_dueno, col_zona)
    loop
        execute format('alter view interno.%I set (security_invoker = off)', v.vista || '_crudo');

        v_dueno := case when v.col_dueno is not null
                        then format('x.%I = (select auth.uid())', v.col_dueno)
                        else 'true' end;

        v_zona := case
            when v.col_zona = 'zona_id' then
                format('%s or not (select public.fn_tiene_zonas()) '
                    || 'or x.zona_id in (select public.fn_mis_zonas())', v_dueno)
            when v.col_zona is not null then
                format('%s or not (select public.fn_tiene_zonas()) '
                    || 'or x.%I in (select public.fn_mis_lotes())', v_dueno, v.col_zona)
            else 'true'
        end;

        execute format('drop view if exists public.%I', v.vista);
        execute format($sql$
            create view public.%I as
            select x.* from interno.%I x
            where (select public.fn_permitido_de('desinfeccion', 'ver'))
              and case (select public.fn_mi_alcance('desinfeccion', 'ver'))
                  when 'global'      then true
                  when 'propietario' then %s
                  else %s
              end
        $sql$, v.vista, v.vista || '_crudo', v_dueno, v_zona);

        execute format('grant select on public.%I to authenticated', v.vista);
    end loop;
end $$;

-- =====================================================================
-- I · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_falta text;
begin
    -- 1 · Las siete vistas, con su cruda en `interno`.
    select string_agg(v, ', ') into v_falta
    from unnest(array['v_desinfeccion_plan','v_desinfeccion_ejecucion','v_desinfeccion_lotes',
                      'v_desinfeccion_productos','v_desinfeccion_personal',
                      'v_desinfeccion_logistica','v_desinfeccion_costos']) as v
    where not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'interno' and c.relname = v || '_crudo');
    if v_falta is not null then
        raise exception 'Faltan vistas crudas del módulo: %', v_falta;
    end if;

    -- 2 · Lo de la 56/57/59, otra vez: ninguna cruda en `public`, nadie
    --     de fuera en `interno`, ninguna expuesta sin reja.
    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.relname like '%\_crudo';
    if v_falta is not null then
        raise exception 'Vistas crudas sueltas en public: %', v_falta;
    end if;

    select string_agg(r.rolname, ', ') into v_falta
    from unnest(array['authenticated','anon','public']) as r(rolname)
    where has_schema_privilege(r.rolname, 'interno', 'usage');
    if v_falta is not null then
        raise exception 'Estos roles pueden entrar al esquema interno: %', v_falta;
    end if;

    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and exists (select 1 from pg_class cr join pg_namespace nr on nr.oid = cr.relnamespace
                  where nr.nspname = 'interno' and cr.relname = c.relname || '_crudo')
      and pg_get_viewdef(c.oid, true) !~ 'fn_permitido_de';
    if v_falta is not null then
        raise exception 'Vistas sin reja de permiso: %', v_falta;
    end if;

    -- 3 · La tabla nueva, con RLS Y con policies.
    if not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'desinfeccion_ejecucion_productos'
          and c.relrowsecurity)
       or not exists (select 1 from pg_policies p
                      where p.schemaname = 'public'
                        and p.tablename = 'desinfeccion_ejecucion_productos')
    then
        raise exception 'desinfeccion_ejecucion_productos se quedó sin RLS o sin policies.';
    end if;

    -- 4 · Las columnas rígidas de químico ya no están en la cabecera: si
    --     volvieran, volverían con ellas las aplicaciones de un solo
    --     producto y dos sitios donde mirar el mismo costo.
    select string_agg(column_name, ', ') into v_falta
    from information_schema.columns
    where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
      and column_name in ('producto_id', 'litros_acido', 'costo_litro_acido', 'costo_acido');
    if v_falta is not null then
        raise exception 'La cabecera de ejecución todavía tiene columnas de químico: %', v_falta;
    end if;

    -- 5 · Y ninguna función `security definer` sin `search_path`.
    select string_agg(p.proname, ', ') into v_falta
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                       where c like 'search_path=%');
    if v_falta is not null then
        raise exception 'Funciones security definer sin search_path: %', v_falta;
    end if;
end $$;

do $$
declare
    v_faltan integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    if v_faltan > 0 then
        raise exception 'Quedaron % llaves sin casilla en la matriz.', v_faltan;
    end if;
end $$;
