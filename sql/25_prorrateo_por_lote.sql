-- =====================================================================
-- MIGRACIÓN 25 · Las horas se liquidan POR LOTE, no por labor
-- =====================================================================
-- «Un tractor con 9 horas totales en 3 lotes está reportando 13.5 horas.»
--
-- El error no estaba en el reparto entre labores sino en la unidad. Las
-- horas vivían en `registros` —una labor— y una labor cubre varios
-- lotes; cada pantalla que abre el registro por lote volvía a contar las
-- mismas horas una vez por lote. 4.5 h de una labor sobre tres lotes se
-- leían como 13.5.
--
-- La unidad correcta es la LÍNEA: `registro_detalle`, que es «este lote,
-- este día, esta labor». Esta migración le da su propia columna de horas
-- y la llena repartiendo el horómetro entre todas las líneas que cuelgan
-- de él.
--
-- La regla, intocable: la suma de `horas_maquina` de todas las líneas de
-- un horómetro es exactamente lo que marcó el horómetro. Ni una centésima
-- más.
-- =====================================================================


-- =====================================================================
-- PARTE A · LA COLUMNA
-- =====================================================================

alter table public.registro_detalle
    add column if not exists horas_maquina numeric(10,2) check (horas_maquina >= 0);

comment on column public.registro_detalle.horas_maquina is
    'Horas del horómetro liquidadas a ESTA línea de lote. La suma de todas las líneas de un horómetro da exactamente sus horas máquina.';

create index if not exists idx_registro_detalle_horas
    on public.registro_detalle (registro_id)
    where horas_maquina is not null;


-- =====================================================================
-- PARTE B · EL PRORRATEO, EN LA BASE
-- =====================================================================
-- El mismo algoritmo que la app aplica al guardar, disponible también
-- aquí para cuadrar de golpe lo que ya está cargado —el histórico entero
-- se arregla con un `select`— y para que la regla no dependa de que la
-- pantalla se acuerde de llamarla.
--
--   1. Peso de cada línea: las manzanas ejecutadas.
--   2. Si NINGUNA línea del horómetro tiene manzanas, peso 1 para todas
--      (reparto igualitario). Inventar un peso sería peor.
--   3. Horas de la línea = horas del horómetro × (peso / peso total).
--
-- El redondeo a dos decimales deja céntimos sueltos; se le cargan a la
-- línea de mayor peso para que la suma dé el total exacto. Sin ese ajuste
-- el reparto tendría el mismo defecto que se está corrigiendo, más
-- pequeño pero igual de real.
-- =====================================================================

create or replace function public.fn_prorratear_horas_horometro(p_horometro_id uuid)
returns numeric
language plpgsql volatile security invoker as $$
declare
    v_total   numeric;
    v_repartido numeric;
    v_id      uuid;
begin
    select h.horas_maquina into v_total
    from public.horometros h where h.id = p_horometro_id;

    if v_total is null or v_total <= 0 then
        return 0;
    end if;

    with lineas as (
        select rd.id,
               coalesce(rd.avance_mz, 0) as mz
        from public.registro_detalle rd
        join public.registros r on r.id = rd.registro_id
        where r.horometro_id = p_horometro_id
    ),
    pesos as (
        select l.id,
               -- Sin manzanas en ninguna, todas pesan 1: reparto parejo.
               case when sum(l.mz) over () > 0 then l.mz else 1 end as peso
        from lineas l
    ),
    calculado as (
        select p.id,
               round(v_total * p.peso / nullif(sum(p.peso) over (), 0), 2) as horas
        from pesos p
    )
    update public.registro_detalle rd
    set horas_maquina = c.horas
    from calculado c
    where rd.id = c.id;

    -- El resto del redondeo va a la línea de mayor peso (y, a igualdad,
    -- a la más antigua, para que el resultado sea siempre el mismo).
    select sum(rd.horas_maquina) into v_repartido
    from public.registro_detalle rd
    join public.registros r on r.id = rd.registro_id
    where r.horometro_id = p_horometro_id;

    if v_repartido is not null and v_repartido <> v_total then
        select rd.id into v_id
        from public.registro_detalle rd
        join public.registros r on r.id = rd.registro_id
        where r.horometro_id = p_horometro_id
        order by coalesce(rd.avance_mz, 0) desc, rd.created_at, rd.id
        limit 1;

        update public.registro_detalle
        set horas_maquina = round(horas_maquina + (v_total - v_repartido), 2)
        where id = v_id;
    end if;

    -- `registros.horas_notificadas` queda como la SUMA de sus líneas.
    -- No es un dato nuevo: es el mismo reparto visto por labor, y lo que
    -- leen las pantallas que todavía trabajan a ese nivel. Se escribe una
    -- labor a la vez porque el disparador que valida contra el horómetro
    -- compara con lo que llevan las demás.
    --
    -- Se vacían todas primero: si no, al escribir la primera el
    -- disparador la suma con las viejas de las otras, el total pasa del
    -- horómetro y rechaza un reparto que sí cuadra. Con `null` el
    -- disparador se aparta —no hay nada que validar— y al terminar el
    -- bucle todas tienen su cifra nueva.
    update public.registros set horas_notificadas = null
    where horometro_id = p_horometro_id;

    for v_id in
        select r.id from public.registros r where r.horometro_id = p_horometro_id
        order by r.created_at, r.id
    loop
        update public.registros r
        set horas_notificadas = (
            select coalesce(sum(rd.horas_maquina), 0)
            from public.registro_detalle rd where rd.registro_id = r.id
        )
        where r.id = v_id;
    end loop;

    return v_total;
end;
$$;

comment on function public.fn_prorratear_horas_horometro(uuid) is
    'Reparte las horas de un horómetro entre sus líneas de lote por manzanas ejecutadas (o parejo si ninguna tiene). La suma queda exactamente igual al horómetro.';


/**
 * Cuadra muchos horómetros de una vez. Devuelve cuántos tocó.
 */
create or replace function public.fn_prorratear_horas_masivo(p_horometro_ids uuid[] default null)
returns integer
language plpgsql volatile security invoker as $$
declare
    v_id  uuid;
    v_n   integer := 0;
begin
    for v_id in
        select h.id from public.horometros h
        where (p_horometro_ids is null or h.id = any(p_horometro_ids))
          and coalesce(h.horas_maquina, 0) > 0
    loop
        perform public.fn_prorratear_horas_horometro(v_id);
        v_n := v_n + 1;
    end loop;
    return v_n;
end;
$$;

comment on function public.fn_prorratear_horas_masivo(uuid[]) is
    'Corre el prorrateo sobre varios horómetros. Sin argumento, sobre todos: sirve para cuadrar de una vez lo ya cargado.';


-- Cuadre de arranque: todo lo que hay hoy en la base queda repartido.
select public.fn_prorratear_horas_masivo(null);


-- =====================================================================
-- PARTE C · LAS HORAS QUE CUESTAN SALEN DE LA LÍNEA
-- =====================================================================
-- `v_costos_labores` repartía el COSTO por lote pero exponía las horas
-- del registro enteras en cada línea. Ahora expone las de la línea, que
-- es lo que de verdad se liquida, con respaldo al reparto proporcional
-- para las líneas que aún no tengan la columna llena.
-- =====================================================================

drop view if exists public.v_costos_labores;

create view public.v_costos_labores as
with reparto as (
    -- Peso de cada línea dentro de su registro. `count(*) over` y
    -- `sum() over` hacen el reparto sin una segunda pasada.
    select
        rd.id                as detalle_id,
        rd.registro_id,
        rd.lote_temporada_id,
        rd.avance_mz,
        rd.ciclo,
        rd.etapa,
        rd.horas_maquina     as horas_propias,
        case
            when coalesce(sum(rd.avance_mz) over (partition by rd.registro_id), 0) > 0
                then coalesce(rd.avance_mz, 0)
                     / sum(rd.avance_mz) over (partition by rd.registro_id)
            else 1.0 / count(*) over (partition by rd.registro_id)
        end                  as peso
    from public.registro_detalle rd
),
lineas as (
    select
        rp.detalle_id,
        r.id                                          as registro_id,
        r.ticket_id,
        r.fecha,
        r.temporada_id,
        rp.lote_temporada_id,
        lo.nomenclatura                               as ut,
        lo.nombre                                     as lote_nombre,
        z.id                                          as zona_id,
        z.nombre                                      as zona,
        z.responsable                                 as encargado,
        rp.avance_mz                                  as mz,
        rp.ciclo,
        rp.etapa,
        rp.peso,
        -- Las horas que se liquidan a ESTA línea.
        --
        -- Antes salía de aquí el registro entero y se multiplicaba por el
        -- peso más abajo; con el prorrateo de la 25 la línea ya trae las
        -- suyas, repartidas contra el horómetro y no contra la labor. El
        -- `coalesce` cubre las líneas que todavía no se han cuadrado.
        coalesce(
            rp.horas_propias,
            round(coalesce(r.horas_notificadas, h.horas_maquina) * rp.peso, 2)
        )                                             as horas_linea,
        e.codigo                                      as equipo_codigo,
        lb.id                                         as labor_id,
        lb.nombre                                     as labor_nombre,
        cl.id                                         as categoria_labor_id,
        cl.nombre                                     as categoria_labor,
        ts.codigo                                     as tarea_codigo,
        ps.codigo                                     as proceso_codigo,
        im.codigo                                     as implemento_codigo,
        imf.codigo                                    as codigo_implemento,
        t.proceso                                     as ticket_proceso,
        t.codigo                                      as ticket_codigo,
        pf.id                                         as puesto_equipo_id,
        pf.codigo                                     as puesto_equipo,
        pi_.id                                        as puesto_implemento_id,
        pi_.codigo                                    as puesto_implemento
    from reparto rp
    join public.registros r  on r.id = rp.registro_id
    join public.lotes_temporada l_t on l_t.id = rp.lote_temporada_id
    join public.lotes lo     on lo.id = l_t.lote_id
    left join public.zonas z on z.id = l_t.zona_id
    join public.horometros h on h.id = r.horometro_id
    join public.equipos e    on e.id = h.equipo_id
    left join public.familias_equipo fe on fe.id = e.familia_id
    left join public.puestos_trabajo pf on pf.id = fe.puesto_trabajo_id
    left join public.implementos im on im.id = r.implemento_id
    left join public.implementos_fisicos imf on imf.id = r.implemento_fisico_id
    left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
    join public.labores lb   on lb.id = r.labor_id
    left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
    join public.tareas_sap ts on ts.id = r.tarea_id
    left join public.procesos_sap ps on ps.id = ts.proceso_id
    join public.tickets t    on t.id = r.ticket_id
),
ambas as (
    select l.*, 'EQUIPO'::text as concepto,
           l.puesto_equipo as puesto,
           public.fn_tarifa_vigente(l.puesto_equipo_id, l.fecha) as costo_hora
    from lineas l
    where l.puesto_equipo_id is not null

    union all

    select l.*, 'IMPLEMENTO'::text,
           l.puesto_implemento,
           public.fn_tarifa_vigente(l.puesto_implemento_id, l.fecha)
    from lineas l
    where l.puesto_implemento_id is not null
)
select
    detalle_id, registro_id, ticket_id, ticket_codigo, ticket_proceso,
    fecha, temporada_id,
    lote_temporada_id, ut, lote_nombre, zona_id, zona, encargado,
    equipo_codigo, labor_id, labor_nombre, categoria_labor_id, categoria_labor,
    tarea_codigo, proceso_codigo, implemento_codigo, codigo_implemento,
    ciclo, etapa, mz,
    concepto, puesto, costo_hora,
    -- Horas y costo de la línea. No se multiplica por el peso: las horas
    -- ya vienen repartidas por lote, y volver a repartirlas era justo el
    -- error que hacía que 9 h de un tractor se reportaran como 13.5.
    round(horas_linea, 2) as horas,
    round(horas_linea * coalesce(costo_hora, 0), 2) as costo,
    case when coalesce(mz, 0) > 0
         then round(horas_linea * coalesce(costo_hora, 0) / mz, 2)
         else null end as costo_mz
from ambas;

alter view public.v_costos_labores set (security_invoker = on);

comment on view public.v_costos_labores is
    'Costo de cada labor repartido por lote (en proporción a las manzanas, o parejo si la labor no mide área), con zona y encargado para poder agrupar por ellos. Dos filas por lote y labor: el puesto del equipo y el del implemento, igual que la notificación de SAP.';
comment on view public.v_costos_labores is
    'Una fila por línea de lote y puesto de trabajo, con las horas que se liquidan a esa línea y su costo. Las horas de un horómetro repartidas entre sus líneas suman exactamente lo que marcó el horómetro.';
