-- =====================================================================
-- 75 · EL INFORME QUE REVENTABA, EL CATÁLOGO DE OBJETIVOS,
--      EL EQUIPO DE APLICACIÓN Y LAS DOS FECHAS DEL PLAN
-- =====================================================================
--
-- ── A · El fallo que tiraba el informe entero ───────────────────────
--
--     ERROR: cannot accumulate null arrays
--
-- `interno.v_desinfeccion_informe_crudo` agregaba los objetivos así:
--
--     fn_limpiar_objetivos(array(select unnest(array_agg(qu.objetivos))))
--
-- `qu` viene de un LEFT JOIN con los químicos. **Un turno sin químicos
-- capturados —o con sólo químicos de lavado— deja `qu.objetivos` en
-- NULO**, y `array_agg` sobre una columna de tipo `text[]` se niega a
-- acumular un nulo. No es un aviso: la consulta entera revienta, así que
-- el informe no enseñaba «menos datos», no enseñaba NADA.
--
-- Y era invisible en las pruebas de humo, porque `count(*)` no evalúa la
-- columna: sólo falla cuando alguien pide `objetivos_control`.
--
-- La regla, de aquí en adelante: **nunca `array_agg` sobre una columna
-- que ya es un arreglo.** Se desempaca con `unnest` en origen y se
-- agregan ESCALARES, que sí admiten nulos y se filtran.
--
-- ── B · Los objetivos dejan de ser texto libre ──────────────────────
--
-- La 71 los hizo `text[]` de texto libre a propósito: nadie mantiene un
-- catálogo de plagas y obligar a darlas de alta deja el campo vacío. El
-- precio se vio enseguida —«Nematodos» y «nematodos» como dos cosas
-- distintas, documentado entonces como deuda—. Ahora hay catálogo, con
-- alta in-situ para que siga sin frenar la captura.
--
-- Lo que ya está escrito NO se pierde: se rescata con `unnest` de las
-- dos tablas y se da de alta en el catálogo con grupo «General».
--
-- ── C · El equipo de aplicación, y las dos fechas del plan ──────────
--
-- Con qué se aplicó —sistema de riego, inyección u otra cosa— no se
-- guardaba. Y el plan sabía cuándo aplicar pero no cuándo preparar el
-- suelo ni cuándo se cosecha, que son las dos fechas con las que se
-- cuadra el calendario de la finca.
-- =====================================================================

-- =====================================================================
-- A · EL CATÁLOGO DE OBJETIVOS DE CONTROL
-- =====================================================================

create table if not exists public.objetivos_control (
    id         uuid primary key default gen_random_uuid(),
    codigo     varchar(40),
    nombre     varchar(120) not null,
    -- Hongos, Nematodos, Malezas, Insectos… Sirve para agrupar en el
    -- informe sin obligar a una tabla de grupos: son cuatro y cambian
    -- cada varios años.
    grupo      varchar(80),
    activo     boolean not null default true,
    created_at timestamptz not null default now()
);

-- El código es opcional —un alta de campo no siempre lo sabe— pero no se
-- puede repetir. Índice PARCIAL y normalizado, igual que en operadores.
create unique index if not exists objetivos_control_codigo_uidx
    on public.objetivos_control (upper(btrim(codigo)))
    where codigo is not null and btrim(codigo) <> '';

-- **El nombre sí es obligatorio y único sin distinguir mayúsculas.** Es
-- justo la deuda que la 71 dejó anotada: «Nematodos» y «nematodos» eran
-- dos objetivos distintos en el informe.
create unique index if not exists objetivos_control_nombre_uidx
    on public.objetivos_control (lower(btrim(nombre)));

comment on table public.objetivos_control is
    'Contra qué se aplica un químico. Catálogo gobernado por catalogo_cultivos.';

alter table public.objetivos_control enable row level security;

-- Lectura para cualquier autenticado: es un catálogo de captura, como
-- materiales o variedades. Esconderlo dejaría el selector vacío a quien
-- no administra catálogos, que es justo quien captura.
drop policy if exists objetivos_control_select on public.objetivos_control;
create policy objetivos_control_select on public.objetivos_control
    for select using ((select auth.uid()) is not null);

-- Escritura por `catalogo_cultivos`, la forma canónica de los catálogos.
drop policy if exists objetivos_control_write on public.objetivos_control;
create policy objetivos_control_write on public.objetivos_control
    for all
    using ((select public.fn_tiene_permiso('catalogo_cultivos', 'editar')))
    with check (
        (select public.fn_tiene_permiso('catalogo_cultivos', 'crear'))
        or (select public.fn_tiene_permiso('catalogo_cultivos', 'editar'))
    );

grant select, insert, update, delete on public.objetivos_control to authenticated;

/* ----------------------- La semilla ------------------------------- */

insert into public.objetivos_control (codigo, nombre, grupo)
values ('OBJ-01', 'Hongos de suelo',    'Hongos'),
       ('OBJ-02', 'Nematodos',          'Nematodos'),
       ('OBJ-03', 'Semillas y Malezas', 'Malezas'),
       ('OBJ-04', 'Mosca Blanca',       'Insectos')
on conflict do nothing;

/* ------------- El rescate de lo que ya estaba escrito -------------- */
--
-- Sin esto, el día que el selector pase a ser una lista cerrada, todo lo
-- anotado en texto libre durante la 71 se queda huérfano: seguiría
-- guardado, pero no se podría volver a elegir ni se vería de dónde salió.
insert into public.objetivos_control (nombre, grupo)
select distinct btrim(o.obj), 'General'
from (
    select unnest(coalesce(objetivos_control, array[]::text[])) as obj
      from public.materiales
    union all
    select unnest(coalesce(objetivos_control, array[]::text[])) as obj
      from public.desinfeccion_ejecucion_productos
) o
where nullif(btrim(o.obj), '') is not null
  and not exists (
      select 1 from public.objetivos_control oc
       where lower(btrim(oc.nombre)) = lower(btrim(o.obj))
  )
on conflict do nothing;

-- =====================================================================
-- B · EL EQUIPO DE APLICACIÓN
-- =====================================================================

alter table public.desinfeccion_ejecucion
    add column if not exists equipo_aplicacion varchar(40),
    add column if not exists equipo_aplicacion_otro varchar(120);

alter table public.desinfeccion_ejecucion
    drop constraint if exists desinfeccion_ejec_equipo_check;

alter table public.desinfeccion_ejecucion
    add constraint desinfeccion_ejec_equipo_check
        check (equipo_aplicacion is null
               or equipo_aplicacion in ('Sistema de Riego', 'Inyección', 'Otros'));

-- **«Otros» sin decir cuál no es un dato.** Dentro de un año, «Otros» a
-- secas no contesta con qué se aplicó: es exactamente el hueco que el
-- campo venía a llenar. Y al revés: un detalle colgando de una opción
-- que ya no es «Otros» es basura que alguien acabará leyendo como buena.
--
-- Va en un DISPARADOR y no sólo en un CHECK porque la limpieza —poner el
-- detalle en nulo— no la puede hacer un CHECK: un CHECK rechaza, no
-- corrige, y rechazar ahí obligaría a la pantalla a borrar el campo a
-- mano cada vez que se cambia de opción.
create or replace function public.fn_equipo_aplicacion_en_orden()
returns trigger language plpgsql
set search_path = public, pg_temp as $$
begin
    if new.equipo_aplicacion is distinct from 'Otros' then
        new.equipo_aplicacion_otro := null;
    else
        new.equipo_aplicacion_otro := nullif(btrim(new.equipo_aplicacion_otro), '');
        if new.equipo_aplicacion_otro is null then
            raise exception
                'Elegiste «Otros» como equipo de aplicación: escribe cuál fue.'
                using errcode = 'check_violation';
        end if;
    end if;
    return new;
end $$;

drop trigger if exists trg_equipo_aplicacion on public.desinfeccion_ejecucion;
create trigger trg_equipo_aplicacion
    before insert or update of equipo_aplicacion, equipo_aplicacion_otro
    on public.desinfeccion_ejecucion
    for each row execute function public.fn_equipo_aplicacion_en_orden();

comment on column public.desinfeccion_ejecucion.equipo_aplicacion is
    'Con qué se aplicó: Sistema de Riego, Inyección u Otros (con su detalle obligatorio).';

-- =====================================================================
-- C · EL DDT DE COSECHA Y LAS DOS FECHAS DEL PLAN
-- =====================================================================

alter table public.variedades
    add column if not exists ddt_cosecha integer;

alter table public.variedades
    drop constraint if exists variedades_ddt_cosecha_check;

alter table public.variedades
    add constraint variedades_ddt_cosecha_check
        check (ddt_cosecha is null or ddt_cosecha >= 0);

comment on column public.variedades.ddt_cosecha is
    'Días desde el trasplante hasta la cosecha. De aquí sale la fecha de cosecha prevista.';

alter table public.desinfeccion_plan
    add column if not exists dias_preriego integer;

comment on column public.desinfeccion_plan.dias_preriego is
    'Días del preriego CONTRA la aplicación. Negativo = antes de aplicar, que es lo normal.';

-- ── La trampa de la columna generada ────────────────────────────────
--
-- `fecha_aplicacion` ya es GENERADA (`fecha_siembra_congelada +
-- dias_aplicacion`), y Postgres **no deja que una generada se apoye en
-- otra generada**: «cannot use generated column in column generation
-- expression». Hay que repetir la suma entera.
do $$
begin
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'desinfeccion_plan'
                      and column_name = 'fecha_preriego') then
        alter table public.desinfeccion_plan
            add column fecha_preriego date
                generated always as
                    ((fecha_siembra_congelada + dias_aplicacion) + dias_preriego) stored;
    end if;
end $$;

comment on column public.desinfeccion_plan.fecha_preriego is
    'Generada: (siembra + días de aplicación) + días de preriego. Nula si no se planificó.';

-- =====================================================================
-- D · LAS VISTAS
-- =====================================================================
--
-- Se sueltan las cuatro parejas que tocan algo de esto. Las públicas van
-- con `x.*` desde la 74: una lista de columnas a mano es el sitio donde
-- se pierde una columna en silencio.

drop view if exists public.v_desinfeccion_informe_ejecutivo;
drop view if exists public.v_desinfeccion_ejecucion;
drop view if exists public.v_desinfeccion_plan;

drop view if exists interno.v_desinfeccion_informe_crudo;
drop view if exists interno.v_desinfeccion_ejecucion_crudo;
drop view if exists interno.v_desinfeccion_plan_crudo;

/* ------------------------------ Plan ------------------------------- */

create view interno.v_desinfeccion_plan_crudo as
select
    p.id,
    p.temporada_id,
    tm.nombre       as temporada_nombre,
    p.lote_temporada_id,
    lo.nomenclatura as lote_nomenclatura,
    lo.nombre       as lote_nombre,
    lt.zona_id,
    z.nombre        as zona_nombre,
    p.ciclo,
    p.fecha_siembra_congelada,
    p.dias_aplicacion,
    p.fecha_aplicacion,
    p.dias_preriego,
    p.fecha_preriego,
    p.variedad_id,
    v.nombre        as variedad_nombre,
    v.ddt_cosecha,
    -- La cosecha se cuenta desde la SIEMBRA, no desde la aplicación: el
    -- DDT es «días desde el trasplante» y el trasplante es la siembra.
    -- Sin `ddt_cosecha` en la variedad va en nulo y la pantalla lo dice,
    -- en vez de inventar una fecha que alguien metería en el calendario.
    case when v.ddt_cosecha is not null
         then p.fecha_siembra_congelada + v.ddt_cosecha
         else null end as fecha_cosecha,
    p.producto_id,
    m.descripcion   as producto_nombre,
    m.codigo        as producto_codigo,
    m.ingrediente_activo,
    m.concentracion,
    p.dosis_mz,
    p.area_planificada_mz,
    p.costo_litro,
    p.total_litros,
    p.total_costo,
    p.costo_mz,
    p.moneda,
    p.costo_origen,
    p.comentarios,
    p.usuario_id,
    pe.nombre       as usuario_nombre,
    p.created_at
from public.desinfeccion_plan p
join public.lotes_temporada lt on lt.id = p.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.temporadas tm      on tm.id = p.temporada_id
left join public.variedades v  on v.id = p.variedad_id
left join public.materiales m  on m.id = p.producto_id
left join public.perfiles pe   on pe.id = p.usuario_id;

alter view interno.v_desinfeccion_plan_crudo set (security_invoker = off);

create view public.v_desinfeccion_plan as
select x.*
from interno.v_desinfeccion_plan_crudo x
where (select public.fn_permitido_de('desinfeccion_plan', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_plan', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_lote_estricto(x.lote_temporada_id))
  end;

grant select on public.v_desinfeccion_plan to authenticated;

/* ---------------------------- Ejecución ---------------------------- */

create view interno.v_desinfeccion_ejecucion_crudo as
select
    e.id,
    e.temporada_id,
    tm.nombre       as temporada_nombre,
    e.turno_id,
    tn.nombre       as turno_nombre,
    tn.codigo       as turno_codigo,
    tn.zona_id,
    z.nombre        as zona_nombre,
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
    e.fecha_lavado,
    e.estacion_riego_id,
    er.nombre       as estacion_riego_nombre,
    e.equipo_aplicacion,
    e.equipo_aplicacion_otro,
    -- Lo que se ENSEÑA, resuelto en la base y no en cada pantalla: el
    -- informe, la cuadrícula y el PDF tienen que decir lo mismo, y tres
    -- `case` repetidos son tres sitios donde divergir.
    case when e.equipo_aplicacion = 'Otros' then e.equipo_aplicacion_otro
         else e.equipo_aplicacion end as equipo_aplicacion_mostrado,
    e.inicio_presurizacion,
    e.fin_presurizacion,
    e.horas_presurizacion,
    e.hora_inicio_iny,
    e.hora_fin_iny,
    e.horas_inyeccion,
    e.hora_inicio_lavado,
    e.hora_fin_lavado,
    e.horas_lavado,
    e.total_horas_riego,
    e.caudal_agua,
    coalesce(e.horas_inyeccion, 0) * e.caudal_agua as agua_total_m3,
    e.ce_antes,
    e.ce_durante,
    e.ce_despues,
    e.calibracion_entrada,
    e.calibracion_salida,
    e.calibracion_campo,
    coalesce(l.mz_regadas, 0)     as mz_regadas,
    coalesce(l.lotes_regados, 0)  as lotes_regados,
    coalesce(pr.costo_preriego, 0)   as costo_personal_preriego,
    coalesce(pr.costo_aplicacion, 0) as costo_personal_aplicacion,
    coalesce(pr.costo_lavado, 0)     as costo_personal_lavado,
    coalesce(pr.costo_total, 0)      as costo_personal,
    coalesce(q.costo_quimico, 0)  as costo_quimico,
    coalesce(q.productos, 0)      as productos,
    q.productos_nombres,
    coalesce(q.envases, 0)        as envases,
    q.ppm_principal,
    e.usuario_id,
    pf.nombre       as usuario_nombre,
    e.created_at
from public.desinfeccion_ejecucion e
join public.temporadas tm   on tm.id = e.temporada_id
join public.turnos tn       on tn.id = e.turno_id
left join public.zonas z    on z.id = tn.zona_id
left join public.estaciones_riego er on er.id = e.estacion_riego_id
left join public.perfiles pf on pf.id = e.usuario_id
left join lateral (
    select sum(x.mz_cubiertas) as mz_regadas, count(*) as lotes_regados
    from public.desinfeccion_ejecucion_lotes x
    where x.ejecucion_id = e.id
) l on true
left join lateral (
    select
        sum(x.costo_total) filter (where x.fase = '1_Preriego')   as costo_preriego,
        sum(x.costo_total) filter (where x.fase = '3_Aplicacion') as costo_aplicacion,
        sum(x.costo_total) filter (where x.fase = '4_Lavado')     as costo_lavado,
        sum(x.costo_total)                                        as costo_total
    from public.desinfeccion_personal x
    where x.ejecucion_id = e.id
) pr on true
left join lateral (
    select
        sum(x.costo_total)        as costo_quimico,
        count(*)                  as productos,
        sum(x.cantidad_envases)   as envases,
        string_agg(mm.descripcion, ', ' order by mm.descripcion) as productos_nombres,
        (array_agg(
            public.fn_ppm_desinfeccion(x.total_litros, mm.concentracion,
                                       e.horas_inyeccion, e.caudal_agua, l.mz_regadas)
            order by x.total_litros desc nulls last
         ) filter (where x.fase = '3_Aplicacion'))[1] as ppm_principal
    from public.desinfeccion_ejecucion_productos x
    join public.materiales mm on mm.id = x.producto_id
    where x.ejecucion_id = e.id
) q on true;

alter view interno.v_desinfeccion_ejecucion_crudo set (security_invoker = off);

create view public.v_desinfeccion_ejecucion as
select x.*
from interno.v_desinfeccion_ejecucion_crudo x
where (select public.fn_permitido_de('desinfeccion_ejecucion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_ejecucion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_ejecucion to authenticated;

/* ------------------------- Informe ejecutivo ------------------------ */

create view interno.v_desinfeccion_informe_crudo as
with regado as (
    select dl.lote_temporada_id, e.ciclo, e.temporada_id, lt.zona_id, dl.ejecucion_id,
           dl.mz_cubiertas, e.fecha_preriego, e.fecha_aplicacion, e.fecha_lavado,
           e.caudal_agua, e.horas_preriego, e.horas_inyeccion, e.horas_lavado,
           e.total_horas_riego, e.estado, e.usuario_id,
           case when e.equipo_aplicacion = 'Otros' then e.equipo_aplicacion_otro
                else e.equipo_aplicacion end as equipo_aplicacion_mostrado
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.lotes_temporada lt on lt.id = dl.lote_temporada_id
),
plan as (
    select p.lote_temporada_id, p.ciclo,
           min(p.fecha_siembra_congelada) as fecha_siembra_plan,
           min(p.fecha_aplicacion)        as fecha_aplicacion_plan,
           min(p.fecha_preriego)          as fecha_preriego_plan,
           min(case when v.ddt_cosecha is not null
                    then p.fecha_siembra_congelada + v.ddt_cosecha end) as fecha_cosecha_plan,
           max(p.area_planificada_mz)     as mz_planificadas,
           sum(p.dosis_mz)                as dosis_mz_plan,
           sum(p.total_litros)            as litros_plan,
           sum(p.total_costo)             as costo_plan,
           count(*)                       as lineas_plan
    from public.desinfeccion_plan p
    left join public.variedades v on v.id = p.variedad_id
    group by p.lote_temporada_id, p.ciclo
),
siembra as (
    select lt.id as lote_temporada_id,
           coalesce(r.ciclo, p.ciclo) as ciclo,
           coalesce(r.fecha_siembra, p.fecha_siembra) as fecha_siembra,
           case when r.fecha_siembra is not null then 'real' else 'plan' end as origen_siembra,
           coalesce(r.variedad, p.variedad) as variedad
    from public.lotes_temporada lt
    left join lateral (
        select distinct on (s.ciclo) s.ciclo, s.fecha_siembra, v.nombre as variedad
        from public.siembras s left join public.variedades v on v.id = s.variedad_id
        where s.lote_temporada_id = lt.id order by s.ciclo, s.fecha_siembra
    ) r on true
    left join lateral (
        select distinct on (ps.ciclo) ps.ciclo, ps.fecha_siembra, v.nombre as variedad
        from public.planes_siembra ps left join public.variedades v on v.id = ps.variedad_id
        where ps.lote_temporada_id = lt.id and ps.fecha_siembra is not null
        order by ps.ciclo, ps.fecha_siembra
    ) p on true
),
/*
 * **Los objetivos, desempacados en origen** (migración 75).
 *
 * Aquí estaba el `cannot accumulate null arrays`. Esta consulta agrega
 * ESCALARES —un texto por fila— en vez de arreglos, así que una
 * ejecución sin químicos sencillamente no aporta filas, que es lo que
 * tiene que pasar, en vez de aportar un nulo que revienta la agregación.
 *
 * Y va en su propia consulta, unida DESPUÉS de agrupar, para no
 * multiplicar las filas de `regado`: un químico con tres objetivos
 * triplicaría las manzanas y los costos del lote.
 */
objetivos as (
    select dl.lote_temporada_id, e.ciclo,
           coalesce(array_agg(distinct btrim(o.obj) order by btrim(o.obj)),
                    array[]::text[]) as objetivos_control
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.desinfeccion_ejecucion_productos dp
         on dp.ejecucion_id = e.id and dp.fase = '3_Aplicacion'
    cross join lateral unnest(coalesce(dp.objetivos_control, array[]::text[])) o(obj)
    where nullif(btrim(o.obj), '') is not null
    group by dl.lote_temporada_id, e.ciclo
),
quimicos as (
    select
        x.ejecucion_id,
        sum(x.costo_total) as costo_quimico,
        count(*)           as productos,
        sum(x.total_litros) filter (where x.fase = '3_Aplicacion') as litros_aplicados,
        (array_agg(x.ppm_calculada order by x.total_litros desc nulls last)
            filter (where x.fase = '3_Aplicacion'))[1] as ppm_principal,
        jsonb_agg(jsonb_build_object(
            'codigo', x.producto_codigo, 'nombre', x.producto_nombre,
            'concentracion', x.concentracion, 'fase', x.fase,
            'objetivos', to_jsonb(coalesce(x.objetivos_control, array[]::text[])),
            'litros', x.total_litros, 'dosis_mz', x.dosis_mz,
            'ppm', x.ppm_calculada, 'costo', x.costo_total
        ) order by x.total_litros desc nulls last) as detalle
    from interno.v_desinfeccion_productos_crudo x
    group by x.ejecucion_id
),
personal as (
    select pe.ejecucion_id,
           sum(pe.costo_total) as costo_personal,
           sum(pe.costo_total) filter (where pe.fase = '1_Preriego')   as costo_preriego,
           sum(pe.costo_total) filter (where pe.fase = '3_Aplicacion') as costo_aplicacion,
           sum(pe.costo_total) filter (where pe.fase = '4_Lavado')     as costo_lavado
    from public.desinfeccion_personal pe group by pe.ejecucion_id
),
por_ejecucion as (
    select ejecucion_id, sum(mz_cubiertas) as mz_total
    from public.desinfeccion_ejecucion_lotes group by ejecucion_id
),
por_zona as (
    select temporada_id, zona_id, sum(mz_cubiertas) as mz_zona from regado
    group by temporada_id, zona_id
),
bolsa as (
    select temporada_id, zona_id, sum(costo_total) as bolsa_zona
    from public.desinfeccion_logistica group by temporada_id, zona_id
),
base as (
    select
        r.lote_temporada_id,
        r.ciclo,
        lo.nomenclatura as lote_nomenclatura,
        lo.nombre       as lote_nombre,
        r.zona_id,
        z.nombre        as zona_nombre,
        r.temporada_id,
        tm.nombre       as temporada_nombre,
        min(r.usuario_id::text)::uuid as usuario_id,
        max(pl.fecha_siembra_plan)    as fecha_siembra_plan,
        max(pl.fecha_aplicacion_plan) as fecha_aplicacion_plan,
        max(pl.fecha_preriego_plan)   as fecha_preriego_plan,
        max(pl.fecha_cosecha_plan)    as fecha_cosecha_plan,
        min(r.fecha_preriego)         as fecha_preriego,
        min(r.fecha_aplicacion)       as fecha_aplicacion,
        max(r.fecha_lavado)           as fecha_lavado,
        max(sb.fecha_siembra)         as fecha_siembra,
        max(sb.origen_siembra)        as origen_siembra,
        max(sb.variedad)              as variedad,
        -- Un turno riega varios lotes con el mismo equipo; si dos turnos
        -- del mismo lote usaron equipos distintos, se enseña uno y el
        -- detalle por turno vive en la cuadrícula de Ejecución.
        max(r.equipo_aplicacion_mostrado) as equipo_aplicacion,
        min(r.fecha_preriego)   - max(sb.fecha_siembra) as ddt_preriego,
        min(r.fecha_aplicacion) - max(sb.fecha_siembra) as ddt_aplicacion,
        max(r.fecha_lavado)     - max(sb.fecha_siembra) as ddt_lavado,
        max(pl.fecha_aplicacion_plan) - max(sb.fecha_siembra) as ddt_plan,
        sum(r.mz_cubiertas)        as mz_regadas,
        max(pl.mz_planificadas)    as mz_planificadas,
        max(pl.dosis_mz_plan)      as dosis_mz_plan,
        sum(qu.litros_aplicados) / nullif(sum(r.mz_cubiertas), 0) as dosis_mz_real,
        max(r.caudal_agua)         as caudal_agua,
        sum(r.total_horas_riego)   as horas_riego,
        (array_agg(qu.ppm_principal order by r.mz_cubiertas desc nulls last))[1] as ppm_principal,
        jsonb_agg(coalesce(qu.detalle, '[]'::jsonb)) as productos,
        max(r.estado::text) as estado,
        sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_quimico,
        sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal,
        sum(coalesce(pr.costo_preriego, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_preriego,
        sum(coalesce(pr.costo_aplicacion, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_aplicacion,
        sum(coalesce(pr.costo_lavado, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_lavado,
        max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas) as costo_logistica,
        max(pl.costo_plan) as costo_plan
    from regado r
    join public.lotes_temporada lt on lt.id = r.lote_temporada_id
    join public.lotes lo           on lo.id = lt.lote_id
    join public.temporadas tm      on tm.id = r.temporada_id
    left join public.zonas z       on z.id = r.zona_id
    left join por_ejecucion pe_ on pe_.ejecucion_id = r.ejecucion_id
    left join quimicos qu       on qu.ejecucion_id = r.ejecucion_id
    left join personal pr       on pr.ejecucion_id = r.ejecucion_id
    left join por_zona pz on pz.temporada_id = r.temporada_id and pz.zona_id is not distinct from r.zona_id
    left join bolsa b     on b.temporada_id = r.temporada_id and b.zona_id is not distinct from r.zona_id
    left join plan pl    on pl.lote_temporada_id = r.lote_temporada_id and pl.ciclo = r.ciclo
    left join siembra sb on sb.lote_temporada_id = r.lote_temporada_id and sb.ciclo = r.ciclo
    group by r.lote_temporada_id, r.ciclo, lo.nomenclatura, lo.nombre, r.zona_id, z.nombre,
             r.temporada_id, tm.nombre
)
select
    b.*,
    -- Se une DESPUÉS de agrupar: unirlo antes multiplicaría las filas de
    -- `regado` y con ellas las manzanas y los costos del lote.
    coalesce(ob.objetivos_control, array[]::text[]) as objetivos_control
from base b
left join objetivos ob
       on ob.lote_temporada_id = b.lote_temporada_id and ob.ciclo = b.ciclo;

alter view interno.v_desinfeccion_informe_crudo set (security_invoker = off);

create view public.v_desinfeccion_informe_ejecutivo as
select
    x.*,
    x.costo_quimico + x.costo_personal + x.costo_logistica as costo_total,
    (x.costo_quimico + x.costo_personal + x.costo_logistica)
        / nullif(x.mz_regadas, 0) as costo_mz,
    case when x.costo_plan is null then null
         else x.costo_quimico + x.costo_personal + x.costo_logistica - x.costo_plan
    end as delta_costo,
    case when coalesce(x.costo_plan, 0) = 0 then null
         else (x.costo_quimico + x.costo_personal + x.costo_logistica - x.costo_plan)
              * 100.0 / x.costo_plan
    end as delta_costo_pct,
    case when x.dosis_mz_plan is null then null
         else x.dosis_mz_real - x.dosis_mz_plan end as delta_dosis,
    case when coalesce(x.dosis_mz_plan, 0) = 0 then null
         else (x.dosis_mz_real - x.dosis_mz_plan) * 100.0 / x.dosis_mz_plan
    end as delta_dosis_pct,
    case
        when coalesce(x.costo_personal_preriego, 0) = 0
         and coalesce(x.costo_personal_aplicacion, 0) = 0
         and coalesce(x.costo_personal_lavado, 0) = 0 then null
        when coalesce(x.costo_personal_preriego, 0) >= coalesce(x.costo_personal_aplicacion, 0)
         and coalesce(x.costo_personal_preriego, 0) >= coalesce(x.costo_personal_lavado, 0)
            then 'Preriego'
        when coalesce(x.costo_personal_aplicacion, 0) >= coalesce(x.costo_personal_lavado, 0)
            then 'Aplicación'
        else 'Lavado de cinta'
    end as fase_mas_cara
from interno.v_desinfeccion_informe_crudo x
where (select public.fn_permitido_de('desinfeccion_reporte', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_reporte', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_informe_ejecutivo to authenticated;

-- =====================================================================
-- E · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_falta text;
    v_vista text;
    v_obj   text[];
begin
    /* ---- 1 · El fallo que esta migración viene a cerrar ---- */
    --
    -- No se comprueba leyendo el texto de la vista: se EJECUTA contra el
    -- caso que reventaba. Un turno sin químicos es el que hacía caer el
    -- informe entero, y `count(*)` no lo detecta porque no evalúa la
    -- columna.
    begin
        select coalesce(array_agg(distinct x), array[]::text[]) into v_obj
          from (select unnest(objetivos_control) as x
                  from interno.v_desinfeccion_informe_crudo) t;
    exception when others then
        raise exception 'El informe vuelve a reventar al agregar objetivos: %', sqlerrm;
    end;

    if (select pg_get_viewdef('interno.v_desinfeccion_informe_crudo'::regclass, true))
       ~ 'array_agg\(qu\.objetivos' then
        raise exception 'Volvió el array_agg sobre una columna que ya es un arreglo.';
    end if;

    /* ---- 2 · El catálogo, con su reja ---- */
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'objetivos_control'
                      and policyname = 'objetivos_control_write'
                      and qual ~ 'catalogo_cultivos') then
        raise exception 'objetivos_control no está gobernado por catalogo_cultivos.';
    end if;

    if not (select relrowsecurity from pg_class
             where oid = 'public.objetivos_control'::regclass) then
        raise exception 'objetivos_control se quedó sin RLS.';
    end if;

    if (select count(*) from public.objetivos_control) < 4 then
        raise exception 'Falta la semilla de objetivos de control.';
    end if;

    -- El rescate: nada de lo ya escrito puede quedarse huérfano.
    select string_agg(distinct o.obj, ', ') into v_falta
      from (
        select unnest(coalesce(objetivos_control, array[]::text[])) as obj from public.materiales
        union all
        select unnest(coalesce(objetivos_control, array[]::text[])) as obj
          from public.desinfeccion_ejecucion_productos
      ) o
     where nullif(btrim(o.obj), '') is not null
       and not exists (select 1 from public.objetivos_control oc
                        where lower(btrim(oc.nombre)) = lower(btrim(o.obj)));
    if v_falta is not null then
        raise exception 'Hay objetivos ya escritos que no entraron al catálogo: %', v_falta;
    end if;

    /* ---- 3 · Lo demás del encargo ---- */
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'desinfeccion_plan'
                      and column_name = 'fecha_preriego'
                      and is_generated = 'ALWAYS') then
        raise exception 'fecha_preriego del plan no es una columna generada.';
    end if;

    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'variedades'
                      and column_name = 'ddt_cosecha') then
        raise exception 'Falta variedades.ddt_cosecha.';
    end if;

    if pg_get_functiondef('public.fn_equipo_aplicacion_en_orden()'::regprocedure)
       !~ 'equipo_aplicacion_otro' then
        raise exception 'El equipo «Otros» puede quedarse sin decir cuál.';
    end if;

    /* ---- 4 · Las rejas, después de recrear tres parejas ---- */
    if has_schema_privilege('authenticated', 'interno', 'usage') then
        raise exception 'authenticated ganó USAGE sobre interno.';
    end if;

    select string_agg(c.relname, ', ') into v_falta
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'interno' and c.relkind = 'v'
       and has_table_privilege('authenticated', c.oid, 'select');
    if v_falta is not null then
        raise exception 'authenticated puede leer vistas crudas de interno: %', v_falta;
    end if;

    for v_vista in
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'v'
           and c.relname in ('v_desinfeccion_plan', 'v_desinfeccion_ejecucion',
                             'v_desinfeccion_informe_ejecutivo')
    loop
        if pg_get_viewdef(('public.' || v_vista)::regclass, true) !~ 'fn_permitido_de'
        or pg_get_viewdef(('public.' || v_vista)::regclass, true) !~ 'fn_mi_alcance' then
            raise exception 'La vista %: se quedó sin reja.', v_vista;
        end if;
        if not has_table_privilege('authenticated', ('public.' || v_vista)::regclass, 'select') then
            raise exception 'La vista %: el navegador no la puede leer.', v_vista;
        end if;
    end loop;

    select string_agg(c.relname, ', ') into v_falta
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'interno' and c.relkind = 'v'
       and c.relname in ('v_desinfeccion_plan_crudo', 'v_desinfeccion_ejecucion_crudo',
                         'v_desinfeccion_informe_crudo')
       and coalesce(array_to_string(c.reloptions, ','), '') !~ 'security_invoker=off';
    if v_falta is not null then
        raise exception 'Vistas crudas sin security_invoker=off: %', v_falta;
    end if;
end $$;
