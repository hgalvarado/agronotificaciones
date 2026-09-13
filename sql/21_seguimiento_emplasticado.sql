-- =====================================================================
-- MIGRACIÓN 21 · El seguimiento de plan y etapas es sólo de emplasticado
-- =====================================================================
-- «El seguimiento de "Planes" y "Etapas" aplica única y exclusivamente
--  para la labor de "Emplasticado".»
--
-- Hasta ahora cualquier labor podía llevar etapa y cualquiera se medía
-- contra el plan. Eso obligaba a elegir «qué labor medir» en el plan
-- —una pregunta que no tiene sentido si la respuesta es siempre la
-- misma— y le ponía al digitador un campo «Etapa» en el arado, donde no
-- significa nada.
--
-- La bandera vive en la LABOR y no en el código: mañana el emplasticado
-- puede llamarse distinto, o pueden ser dos (sencillo y triple), y eso
-- se arregla marcando la casilla en el catálogo, sin tocar la app.
-- =====================================================================


-- =====================================================================
-- PARTE A · LA BANDERA
-- =====================================================================

alter table public.labores
    add column if not exists seguimiento_emplasticado boolean not null default false;

comment on column public.labores.seguimiento_emplasticado is
    'Si está en true, esta labor lleva etapa en la captura y es la que se mide contra el plan de mecanización. Sólo el emplasticado.';

-- Arranque sin trabajo manual: las labores cuyo nombre habla de plástico
-- son las que ya se estaban usando para esto.
update public.labores
set seguimiento_emplasticado = true
where not seguimiento_emplasticado
  and lower(nombre) like '%plastic%';

create index if not exists idx_labores_seguimiento
    on public.labores (seguimiento_emplasticado)
    where seguimiento_emplasticado;


-- =====================================================================
-- PARTE B · LAS LABORES DEL PROCESO DICEN SI LLEVAN SEGUIMIENTO
-- =====================================================================
-- La pantalla del plan ya no pregunta qué labor medir: toma la que tiene
-- la bandera. Para eso necesita saberlo en la misma consulta.
--
-- DROP + CREATE porque cambia la forma de la tabla que devuelve, y
-- `create or replace` sólo admite agregar al final de una tabla de
-- salida cuando el resto coincide exactamente.
-- =====================================================================

drop function if exists public.fn_labores_del_proceso(uuid, uuid);

create function public.fn_labores_del_proceso(
    p_temporada_id uuid,
    p_proceso_id   uuid
) returns table (
    labor_id     uuid,
    labor_nombre text,
    mz_total     numeric,
    lotes        bigint,
    ultima_fecha date,
    seguimiento  boolean
)
language sql stable security invoker as $$
    select
        lb.id,
        lb.nombre,
        sum(rd.avance_mz),
        count(distinct rd.lote_temporada_id),
        max(rd.fecha),
        lb.seguimiento_emplasticado
    from public.registro_detalle rd
    join public.registros r  on r.id = rd.registro_id
    join public.labores lb   on lb.id = r.labor_id
    join public.tareas_sap ts on ts.id = r.tarea_id
    join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
    where lt.temporada_id = p_temporada_id
      and ts.proceso_id = p_proceso_id
      and rd.avance_mz is not null
    group by lb.id, lb.nombre, lb.seguimiento_emplasticado
    order by lb.seguimiento_emplasticado desc, sum(rd.avance_mz) desc
$$;

comment on function public.fn_labores_del_proceso(uuid, uuid) is
    'Labores con avance dentro del proceso. La de seguimiento de emplasticado sale primero, que es la que el plan mide.';


-- =====================================================================
-- PARTE C · EL DETALLE DIARIO, ABIERTO POR PROVEEDOR Y ÁREA
-- =====================================================================
-- «Proveedores (desglosado con áreas si hay múltiples)»
--
-- Un lote puede llevar dos o tres rollos el mismo día, cada uno con su
-- área: eso son varias líneas de `registro_detalle` sobre el mismo lote
-- y la misma fecha. La función las junta en UNA fila por lote y día —que
-- es como él lee el reporte— y devuelve el desglose de proveedores en
-- texto, con el área de cada uno sólo cuando hay más de uno. Con un
-- proveedor, poner «Plastimex 30.00 mz» al lado de una columna que ya
-- dice 30.00 sería ruido.
--
-- Va en la base y no en la pantalla porque el `string_agg` ordenado por
-- área es justo lo que en JavaScript obliga a recorrer y reagrupar todo
-- el rango en memoria.
-- =====================================================================

create or replace function public.fn_avance_diario_emplasticado(
    p_temporada_id uuid,
    p_labor_id     uuid,
    p_desde        date,
    p_hasta        date
) returns table (
    fecha              date,
    lote_temporada_id  uuid,
    ut                 text,
    nomenclatura       text,
    zona               text,
    encargado          text,
    proveedores        text,
    lineas             bigint,
    avance_mz          numeric
)
language sql stable security invoker as $$
    with lineas as (
        select
            rd.fecha,
            rd.lote_temporada_id,
            lo.nomenclatura as ut,
            lo.nombre       as nomenclatura,
            z.nombre        as zona,
            z.responsable   as encargado,
            rd.avance_mz,
            -- El texto de una línea: «Plastimex / Tuberías HN». Los dos
            -- proveedores de la misma línea van juntos porque el plástico
            -- y la manguera se ponen en la misma pasada.
            nullif(
                concat_ws(
                    ' / ',
                    pp.nombre,
                    case when pmg.nombre is distinct from pp.nombre then pmg.nombre end
                ),
                ''
            ) as proveedor
        from public.registro_detalle rd
        join public.registros r  on r.id = rd.registro_id
        join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
        join public.lotes lo     on lo.id = lt.lote_id
        left join public.zonas z on z.id = lt.zona_id
        left join public.proveedores pp  on pp.id = rd.proveedor_plastico_id
        left join public.proveedores pmg on pmg.id = rd.proveedor_manguera_id
        where lt.temporada_id = p_temporada_id
          and r.labor_id = p_labor_id
          and rd.avance_mz is not null
          and rd.fecha between p_desde and p_hasta
    ),
    -- Cuántas líneas tiene cada lote ese día. Se calcula ANTES porque
    -- una función de ventana no puede ir dentro de un `string_agg`:
    -- Postgres lo rechaza con «aggregate function calls cannot contain
    -- window function calls».
    marcadas as (
        select l.*,
               count(*) over (partition by l.fecha, l.lote_temporada_id) as lineas_del_lote
        from lineas l
    ),
    agrupado as (
        select
            m.fecha, m.lote_temporada_id, m.ut, m.nomenclatura, m.zona, m.encargado,
            count(*)          as lineas,
            sum(m.avance_mz)  as avance_mz,
            -- Con varios proveedores se dice cuánto hizo cada uno; con
            -- uno solo basta el nombre.
            string_agg(
                coalesce(m.proveedor, 'Sin proveedor')
                || case when m.lineas_del_lote > 1
                        then ' ' || trim(to_char(m.avance_mz, 'FM999999990.00')) || ' mz'
                        else '' end,
                ' · ' order by m.avance_mz desc
            ) as proveedores
        from marcadas m
        group by m.fecha, m.lote_temporada_id, m.ut, m.nomenclatura, m.zona, m.encargado
    )
    select fecha, lote_temporada_id, ut, nomenclatura, zona, encargado,
           proveedores, lineas, avance_mz
    from agrupado
    order by fecha desc, ut
$$;

comment on function public.fn_avance_diario_emplasticado(uuid, uuid, date, date) is
    'Una fila por lote y día, con el desglose de proveedores y —cuando hay más de uno— el área de cada uno.';
