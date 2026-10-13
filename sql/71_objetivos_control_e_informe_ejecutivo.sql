-- =====================================================================
-- 71 · LOS OBJETIVOS DE CONTROL Y EL INFORME EJECUTIVO
-- =====================================================================
--
--   A · **CONTRA QUÉ SE APLICÓ.** Un químico se aplica contra algo
--       —nematodos, hongos de suelo, malezas— y hasta ahora eso no se
--       guardaba en ningún sitio. El dato vivía en la cabeza del
--       agrónomo, así que la pregunta «¿qué hicimos contra el nematodo
--       esta temporada?» no se podía contestar con la base.
--
--       Va en DOS sitios y no en uno:
--         · En `materiales`, el objetivo que el producto trae de fábrica
--           —lo que dice su etiqueta—.
--         · En la aplicación, contra qué se usó ESE día. Un mismo
--           producto se aplica contra cosas distintas según la presión
--           que haya en el lote, y guardar sólo el del catálogo sería
--           contestar con la etiqueta en vez de con lo que pasó.
--
--   B · **EL INFORME DE UN LOTE, EN UNA FILA.** Para contar qué pasó en
--       un lote hay que abrir cinco pantallas: el plan, la ejecución, la
--       cuadrilla, los químicos y la logística. Esta vista consolida el
--       flujo entero por lote y ciclo: cuándo se planificó, cuándo se
--       regó, contra qué se aplicó, a qué dosis frente a la planificada,
--       y a dónde se fue el dinero.
--
--       Es de LECTURA y vive detrás de `desinfeccion_reporte`, que es el
--       permiso de quien mira números, no de quien captura.
--
-- Idempotente.
-- =====================================================================


-- =====================================================================
-- A · CONTRA QUÉ SE APLICA
-- =====================================================================

-- `text[]` y no una tabla de catálogo: hoy nadie mantiene una lista
-- cerrada de plagas, y obligar a darlas de alta antes de poder anotarlas
-- es la clase de fricción que acaba con el campo vacío. Si algún día la
-- lista se estabiliza, se normaliza con los valores ya escritos.
alter table public.materiales
    add column if not exists objetivos_control text[] not null default array[]::text[];

comment on column public.materiales.objetivos_control is
    'Contra qué sirve el producto, según su etiqueta. Lo que se aplicó de verdad va en la ejecución (migración 71).';

alter table public.desinfeccion_ejecucion_productos
    add column if not exists objetivos_control text[] not null default array[]::text[];

comment on column public.desinfeccion_ejecucion_productos.objetivos_control is
    'Contra qué se aplicó ESTE día. Puede ser más de uno, y puede no coincidir con la etiqueta (migración 71).';

-- Buscar «todo lo que se aplicó contra nematodos» es la consulta que
-- justifica la columna, y sin índice es un recorrido de la tabla entera.
create index if not exists materiales_objetivos_idx
    on public.materiales using gin (objetivos_control);
create index if not exists desinfeccion_productos_objetivos_idx
    on public.desinfeccion_ejecucion_productos using gin (objetivos_control);

/**
 * Limpia una lista de objetivos antes de guardarla.
 *
 * Quita los vacíos, los espacios de los extremos y los repetidos. Sin
 * esto, «Nematodos» y «nematodos » son dos etiquetas distintas para el
 * informe y para el índice, y la lista se ensucia sola en una semana.
 *
 * NO cambia mayúsculas: «Mal de Panamá» es un nombre propio y bajarlo a
 * minúsculas lo haría ilegible. Se normaliza el espacio, no la palabra.
 */
create or replace function public.fn_limpiar_objetivos(p_objetivos text[])
returns text[]
language sql immutable as $$
    select coalesce(
        array(
            select distinct btrim(x)
            from unnest(coalesce(p_objetivos, array[]::text[])) as x
            where btrim(x) <> ''
            order by btrim(x)
        ),
        array[]::text[]
    )
$$;

grant execute on function public.fn_limpiar_objetivos(text[]) to authenticated;

create or replace function public.fn_objetivos_en_orden()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    new.objetivos_control := public.fn_limpiar_objetivos(new.objetivos_control);
    return new;
end $$;

drop trigger if exists trg_materiales_objetivos on public.materiales;
create trigger trg_materiales_objetivos
    before insert or update of objetivos_control on public.materiales
    for each row execute function public.fn_objetivos_en_orden();

drop trigger if exists trg_productos_objetivos on public.desinfeccion_ejecucion_productos;
create trigger trg_productos_objetivos
    before insert or update of objetivos_control on public.desinfeccion_ejecucion_productos
    for each row execute function public.fn_objetivos_en_orden();

-- Al anotar un químico sin decir contra qué, hereda lo que dice su
-- etiqueta. Es un punto de partida, no una imposición: se puede cambiar
-- en el acto, y el disparador no vuelve a tocarlo.
create or replace function public.fn_objetivos_por_omision()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if coalesce(array_length(new.objetivos_control, 1), 0) = 0 then
        select m.objetivos_control into new.objetivos_control
          from public.materiales m where m.id = new.producto_id;
        new.objetivos_control := coalesce(new.objetivos_control, array[]::text[]);
    end if;
    return new;
end $$;

drop trigger if exists trg_productos_objetivos_omision on public.desinfeccion_ejecucion_productos;
create trigger trg_productos_objetivos_omision
    before insert on public.desinfeccion_ejecucion_productos
    for each row execute function public.fn_objetivos_por_omision();


-- --------------------- La vista de químicos, al día ------------------
-- Se rehace para que `objetivos_control` salga por ella: la pantalla de
-- ejecución lee de aquí.

drop view if exists public.v_desinfeccion_productos;
drop view if exists interno.v_desinfeccion_productos_crudo;

create view interno.v_desinfeccion_productos_crudo as
select
    dp.id, dp.ejecucion_id, e.temporada_id,
    e.turno_id, tn.nombre as turno_nombre, tn.zona_id, e.ciclo, e.fecha_aplicacion,
    dp.producto_id, m.codigo as producto_codigo, m.descripcion as producto_nombre,
    m.ingrediente_activo, m.concentracion,
    dp.objetivos_control,
    m.objetivos_control                        as objetivos_catalogo,
    dp.total_litros, dp.costo_litro, dp.costo_total,
    dp.cantidad_envases, dp.tipo_envase,
    public.fn_precio_material(dp.producto_id,
        coalesce(e.fecha_aplicacion, e.fecha_preriego, current_date),
        e.temporada_id)                        as precio_catalogo,
    coalesce(l.mz_regadas, 0)                  as mz_regadas,
    dp.total_litros / nullif(l.mz_regadas, 0)  as dosis_mz,
    e.usuario_id, dp.created_at,

    e.caudal_agua,
    e.horas_inyeccion,
    e.horas_lavado,
    coalesce(e.horas_inyeccion, 0) * e.caudal_agua
                                               as agua_total_m3,
    (dp.total_litros / nullif(l.mz_regadas, 0))
        * (public.fn_numero_de_texto(m.concentracion) / 100.0)
                                               as producto_puro_litros,
    public.fn_ppm_desinfeccion(dp.total_litros, m.concentracion,
                               e.horas_inyeccion, e.caudal_agua,
                               l.mz_regadas)
                                               as ppm_calculada
from public.desinfeccion_ejecucion_productos dp
join public.desinfeccion_ejecucion e on e.id = dp.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
join public.materiales m             on m.id = dp.producto_id
left join lateral (
    select sum(x.mz_cubiertas) as mz_regadas
    from public.desinfeccion_ejecucion_lotes x
    where x.ejecucion_id = e.id
) l on true;

alter view interno.v_desinfeccion_productos_crudo set (security_invoker = off);

create view public.v_desinfeccion_productos as
select x.* from interno.v_desinfeccion_productos_crudo x
where (select public.fn_permitido_de('desinfeccion_ejecucion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_ejecucion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_productos to authenticated;


-- =====================================================================
-- B · EL INFORME EJECUTIVO
-- =====================================================================
--
-- ── El grano: LOTE × CICLO ──────────────────────────────────────────
--
-- No por lote a secas, porque un lote se desinfecta una vez por ciclo y
-- los dos ciclos de una temporada son dos campañas distintas: juntarlas
-- sumaría costos de siembras diferentes en una sola cifra. Y no por
-- ejecución, porque un turno riega varios lotes y la pregunta gerencial
-- es siempre «¿cuánto me costó ESTE lote?».
--
-- ── Lo que NO hace ──────────────────────────────────────────────────
--
-- No inventa un plan cuando no lo hay. Un lote ejecutado sin plan trae
-- los campos de plan en nulo, y la pantalla dice «sin plan» en vez de
-- enseñar un cero que se leería como «se planificó cero».

drop view if exists public.v_desinfeccion_informe_ejecutivo;
drop view if exists interno.v_desinfeccion_informe_crudo;

create view interno.v_desinfeccion_informe_crudo as
with
-- Lo ejecutado, por lote y ciclo. Las manzanas de un lote pueden venir
-- de varias ejecuciones del mismo ciclo: se suman.
regado as (
    select
        dl.lote_temporada_id,
        e.ciclo,
        e.temporada_id,
        lt.zona_id,
        dl.ejecucion_id,
        dl.mz_cubiertas,
        e.fecha_preriego,
        e.fecha_aplicacion,
        e.caudal_agua,
        e.horas_preriego,
        e.horas_inyeccion,
        e.horas_lavado,
        e.total_horas_riego,
        e.estado,
        e.usuario_id
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.lotes_temporada lt       on lt.id = dl.lote_temporada_id
),
-- El plan del mismo lote y ciclo. Puede llevar varias líneas —un
-- químico por línea, y desde la 67 hasta dos dosis del mismo— así que se
-- agrega antes de cruzarlo.
plan as (
    select
        p.lote_temporada_id,
        p.ciclo,
        min(p.fecha_siembra_congelada)              as fecha_siembra_plan,
        min(p.fecha_aplicacion)                     as fecha_aplicacion_plan,
        max(p.area_planificada_mz)                  as mz_planificadas,
        sum(p.dosis_mz)                             as dosis_mz_plan,
        sum(p.total_litros)                         as litros_plan,
        sum(p.total_costo)                          as costo_plan,
        count(*)                                    as lineas_plan
    from public.desinfeccion_plan p
    group by p.lote_temporada_id, p.ciclo
),
-- La siembra: la capturada si la hay, la del plan de trasplante si no.
-- Es la misma precedencia de `fn_siembras_de_lotes` (migración 63),
-- escrita aquí porque una vista no puede llamar a una función que
-- comprueba permisos por su cuenta sin heredar su criterio.
siembra as (
    select
        lt.id as lote_temporada_id,
        coalesce(r.ciclo, p.ciclo)                  as ciclo,
        coalesce(r.fecha_siembra, p.fecha_siembra)  as fecha_siembra,
        case when r.fecha_siembra is not null then 'real' else 'plan' end as origen_siembra,
        coalesce(r.variedad, p.variedad)            as variedad
    from public.lotes_temporada lt
    left join lateral (
        select distinct on (s.ciclo) s.ciclo, s.fecha_siembra, v.nombre as variedad
        from public.siembras s
        left join public.variedades v on v.id = s.variedad_id
        where s.lote_temporada_id = lt.id
        order by s.ciclo, s.fecha_siembra
    ) r on true
    left join lateral (
        select distinct on (ps.ciclo) ps.ciclo, ps.fecha_siembra, v.nombre as variedad
        from public.planes_siembra ps
        left join public.variedades v on v.id = ps.variedad_id
        where ps.lote_temporada_id = lt.id and ps.fecha_siembra is not null
        order by ps.ciclo, ps.fecha_siembra
    ) p on true
),
-- Los químicos de cada ejecución, ya con su ppm y sus objetivos.
quimicos as (
    select
        x.ejecucion_id,
        sum(x.costo_total)                          as costo_quimico,
        count(*)                                    as productos,
        sum(x.total_litros)                         as litros_aplicados,
        -- Las ppm del que más pesa: con dos químicos, el número que se
        -- discute es el del principal, no una media que no existe.
        (array_agg(x.ppm_calculada order by x.total_litros desc nulls last))[1] as ppm_principal,
        -- Todos los objetivos del turno, sin repetir.
        public.fn_limpiar_objetivos(
            array(select unnest(array_agg(o.obj)) )
        )                                           as objetivos,
        jsonb_agg(jsonb_build_object(
            'codigo',       x.producto_codigo,
            'nombre',       x.producto_nombre,
            'concentracion', x.concentracion,
            'objetivos',    to_jsonb(x.objetivos_control),
            'litros',       x.total_litros,
            'dosis_mz',     x.dosis_mz,
            'ppm',          x.ppm_calculada,
            'costo',        x.costo_total
        ) order by x.total_litros desc nulls last) as detalle
    from interno.v_desinfeccion_productos_crudo x
    left join lateral unnest(
        case when coalesce(array_length(x.objetivos_control, 1), 0) = 0
             then array[null]::text[] else x.objetivos_control end
    ) as o(obj) on true
    group by x.ejecucion_id
),
personal as (
    select
        pe.ejecucion_id,
        sum(pe.costo_total)                                              as costo_personal,
        sum(pe.costo_total) filter (where pe.fase = '1_Preriego')        as costo_preriego,
        sum(pe.costo_total) filter (where pe.fase = '3_Aplicacion')      as costo_aplicacion
    from public.desinfeccion_personal pe
    group by pe.ejecucion_id
),
-- Las manzanas de cada ejecución, para repartir sus costos entre los
-- lotes que regó. Es el mismo prorrateo de `v_desinfeccion_costos`.
por_ejecucion as (
    select ejecucion_id, sum(mz_cubiertas) as mz_total
    from public.desinfeccion_ejecucion_lotes group by ejecucion_id
),
-- El acarreo se reparte por ZONA y temporada, no por ejecución.
por_zona as (
    select r.temporada_id, r.zona_id, sum(r.mz_cubiertas) as mz_zona
    from regado r group by r.temporada_id, r.zona_id
),
bolsa as (
    select temporada_id, zona_id, sum(costo_total) as bolsa_zona
    from public.desinfeccion_logistica group by temporada_id, zona_id
)
select
    /* ---------------------- Quién y dónde ------------------------- */
    r.lote_temporada_id,
    r.ciclo,
    lo.nomenclatura                                 as lote_nomenclatura,
    lo.nombre                                       as lote_nombre,
    r.zona_id,
    z.nombre                                        as zona_nombre,
    r.temporada_id,
    tm.nombre                                       as temporada_nombre,
    min(r.usuario_id::text)::uuid                   as usuario_id,

    /* ------------------------- Tiempos ---------------------------- */
    max(pl.fecha_siembra_plan)                      as fecha_siembra_plan,
    max(pl.fecha_aplicacion_plan)                   as fecha_aplicacion_plan,
    min(r.fecha_preriego)                           as fecha_preriego,
    min(r.fecha_aplicacion)                         as fecha_aplicacion,
    max(sb.fecha_siembra)                           as fecha_siembra,
    max(sb.origen_siembra)                          as origen_siembra,
    max(sb.variedad)                                as variedad,
    -- El DDT es `fase − siembra`: negativo mientras falte para
    -- trasplantar, que es lo normal al desinfectar (migración 62).
    (min(r.fecha_preriego) - max(sb.fecha_siembra))    as ddt_preriego,
    (min(r.fecha_aplicacion) - max(sb.fecha_siembra))  as ddt_aplicacion,
    (max(pl.fecha_aplicacion_plan) - max(sb.fecha_siembra)) as ddt_plan,

    /* ------------------------ Agronomía --------------------------- */
    sum(r.mz_cubiertas)                             as mz_regadas,
    max(pl.mz_planificadas)                         as mz_planificadas,
    max(pl.dosis_mz_plan)                           as dosis_mz_plan,
    sum(qu.litros_aplicados) / nullif(sum(r.mz_cubiertas), 0) as dosis_mz_real,
    max(r.caudal_agua)                              as caudal_agua,
    sum(r.total_horas_riego)                        as horas_riego,
    (array_agg(qu.ppm_principal order by r.mz_cubiertas desc nulls last))[1] as ppm_principal,
    public.fn_limpiar_objetivos(
        array(select unnest(array_agg(qu.objetivos)))
    )                                               as objetivos_control,
    jsonb_agg(coalesce(qu.detalle, '[]'::jsonb))    as productos,
    max(r.estado::text)                             as estado,

    /* ------------------------ Finanzas ---------------------------- */
    sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))  as costo_quimico,
    sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal,
    sum(coalesce(pr.costo_preriego, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_preriego,
    sum(coalesce(pr.costo_aplicacion, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_aplicacion,
    max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas)   as costo_logistica,
    max(pl.costo_plan)                              as costo_plan
from regado r
join public.lotes_temporada lt on lt.id = r.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
join public.temporadas tm      on tm.id = r.temporada_id
left join public.zonas z       on z.id = r.zona_id
left join por_ejecucion pe_    on pe_.ejecucion_id = r.ejecucion_id
left join quimicos qu          on qu.ejecucion_id = r.ejecucion_id
left join personal pr          on pr.ejecucion_id = r.ejecucion_id
left join por_zona pz          on pz.temporada_id = r.temporada_id and pz.zona_id is not distinct from r.zona_id
left join bolsa b              on b.temporada_id = r.temporada_id and b.zona_id is not distinct from r.zona_id
left join plan pl              on pl.lote_temporada_id = r.lote_temporada_id and pl.ciclo = r.ciclo
left join siembra sb           on sb.lote_temporada_id = r.lote_temporada_id and sb.ciclo = r.ciclo
group by r.lote_temporada_id, r.ciclo, lo.nomenclatura, lo.nombre,
         r.zona_id, z.nombre, r.temporada_id, tm.nombre;

alter view interno.v_desinfeccion_informe_crudo set (security_invoker = off);

-- Los derivados van en una capa aparte porque una columna generada no
-- puede referirse a otra del mismo `select`, y escribir cuatro veces la
-- misma suma de tres sumandos es cómo se consigue que un día digan
-- cosas distintas.
create view public.v_desinfeccion_informe_ejecutivo as
select
    x.*,
    (x.costo_quimico + x.costo_personal + x.costo_logistica)            as costo_total,
    (x.costo_quimico + x.costo_personal + x.costo_logistica)
        / nullif(x.mz_regadas, 0)                                       as costo_mz,
    -- La desviación contra lo planificado. Positiva = se gastó de más.
    case when x.costo_plan is null then null
         else (x.costo_quimico + x.costo_personal + x.costo_logistica) - x.costo_plan
    end                                                                 as delta_costo,
    case when coalesce(x.costo_plan, 0) = 0 then null
         else ((x.costo_quimico + x.costo_personal + x.costo_logistica) - x.costo_plan)
              * 100.0 / x.costo_plan
    end                                                                 as delta_costo_pct,
    case when x.dosis_mz_plan is null then null
         else x.dosis_mz_real - x.dosis_mz_plan
    end                                                                 as delta_dosis,
    case when coalesce(x.dosis_mz_plan, 0) = 0 then null
         else (x.dosis_mz_real - x.dosis_mz_plan) * 100.0 / x.dosis_mz_plan
    end                                                                 as delta_dosis_pct,
    -- Dónde se fue el dinero de la cuadrilla. Es la pregunta que más se
    -- repite en gerencia: el preriego lo hace mucha gente pocas horas y
    -- la aplicación poca gente muchas, y cuál pesa más no es evidente.
    case
        when coalesce(x.costo_personal_preriego, 0) = 0
         and coalesce(x.costo_personal_aplicacion, 0) = 0 then null
        when coalesce(x.costo_personal_preriego, 0)
           > coalesce(x.costo_personal_aplicacion, 0)     then 'Preriego'
        else 'Aplicación'
    end                                                                 as fase_mas_cara
from interno.v_desinfeccion_informe_crudo x
-- La reja de la 66, sobre la pantalla de REPORTES: quien mira números no
-- es necesariamente quien captura.
where (select public.fn_permitido_de('desinfeccion_reporte', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_reporte', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_informe_ejecutivo to authenticated;

comment on view public.v_desinfeccion_informe_ejecutivo is
    'El flujo entero de un lote y ciclo: plan, tiempos, agronomía y finanzas, con sus desviaciones (migración 71).';
