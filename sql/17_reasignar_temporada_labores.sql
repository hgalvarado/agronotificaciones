-- =====================================================================
-- MIGRACIÓN 17 · Reasignar la temporada de las líneas capturadas
-- =====================================================================
-- «Control de labores: edición masiva de temporada… seleccionar
--  múltiples lotes simultáneamente y reasignarles la temporada en una
--  sola transacción. Mantener también la opción rápida para editar la
--  temporada de un solo lote desde su fila.»
--
-- Qué significa «la temporada» de una línea capturada. La temporada NO
-- es una columna de `registro_detalle`: la línea apunta a un
-- `lotes_temporada`, que ya es la pareja (lote, temporada). O sea que
-- cambiar la temporada de una línea es RE-APUNTARLA a la fila del MISMO
-- lote físico en la temporada nueva.
--
-- Por qué importa que sea así y no un simple `update` de una columna:
-- todo el avance —`fn_plan_avance_lote`, `fn_tablero_avance`, el reporte
-- gerencial— entra por `lotes_temporada.temporada_id`. Si la línea se
-- capturó contra la temporada equivocada, sus manzanas están sumando en
-- el plan equivocado, y es exactamente eso lo que hay que poder
-- corregir. `registros.temporada_id` es una copia de conveniencia que se
-- refresca sola con el disparador.
--
-- El lote tiene que estar asignado a la temporada de destino. NO se crea
-- la asignación al pasar: se crearía con área en 0 y sin zona, que es
-- justo lo que hacía que el tablero mintiera. Si falta, la función lo
-- dice por nombre y el usuario la crea —o la copia de la temporada
-- anterior con «Copiar de otra temporada», que ya existe—.
-- =====================================================================


-- =====================================================================
-- PARTE A · LA VISTA DE CONTROL MUESTRA LA TEMPORADA
-- =====================================================================
-- `create or replace view` sólo puede AGREGAR columnas al final, y eso
-- es justo lo que se hace aquí: tres columnas nuevas detrás de
-- `created_at`. Así no hay que repetir las cuarenta de la migración 11.
-- =====================================================================

create or replace view public.v_labores_control as
select
    rd.id                       as detalle_id,
    r.id                        as registro_id,
    r.ticket_id,
    r.horometro_id,
    r.fecha,
    rd.lote_temporada_id,
    lo.nomenclatura             as ut,
    lo.nombre                   as lote_nombre,
    r.tarea_id,
    ts.codigo                   as tarea_codigo,
    ts.nombre                   as tarea_nombre,
    rd.ciclo,
    rd.avance_mz,
    r.labor_id,
    lb.nombre                   as labor_nombre,
    cl.nombre                   as categoria_labor,
    e.codigo                    as equipo_codigo,
    h.turno,
    h.horas_maquina,
    h.horas_hombre,
    r.horas_notificadas,
    coalesce(r.horas_notificadas, h.horas_maquina) as horas_costeadas,
    o.codigo                    as operador_codigo,
    o.nombre                    as operador_nombre,
    r.implemento_id,
    im.codigo                   as implemento_codigo,
    im.nombre                   as implemento_nombre,
    pi_.codigo                  as puesto_implemento,
    pi_.operacion_sap           as operacion_implemento,
    pf.codigo                   as puesto_equipo,
    pf.operacion_sap            as operacion_equipo,
    pf.descripcion              as descripcion_equipo,
    t.codigo                    as ticket_codigo,
    t.estado                    as ticket_estado,
    t.proceso                   as ticket_proceso,
    t.departamento,
    r.comentarios,
    r.usuario_id,
    pe.nombre                   as usuario_nombre,
    (select count(*) from public.registro_detalle x where x.registro_id = r.id) as lotes_del_registro,
    r.created_at,
    -- Columnas nuevas de la 17
    l_t.temporada_id,
    tm.nombre                   as temporada_nombre,
    l_t.lote_id
from public.registro_detalle rd
join public.registros r          on r.id = rd.registro_id
join public.lotes_temporada l_t  on l_t.id = rd.lote_temporada_id
join public.temporadas tm        on tm.id = l_t.temporada_id
join public.lotes lo             on lo.id = l_t.lote_id
join public.horometros h         on h.id = r.horometro_id
join public.equipos e            on e.id = h.equipo_id
left join public.familias_equipo fe on fe.id = e.familia_id
left join public.puestos_trabajo pf on pf.id = fe.puesto_trabajo_id
left join public.operadores o    on o.id = h.operador_id
join public.labores lb           on lb.id = r.labor_id
left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
join public.tareas_sap ts        on ts.id = r.tarea_id
left join public.implementos im  on im.id = r.implemento_id
left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
left join public.perfiles pe     on pe.id = r.usuario_id
join public.tickets t            on t.id = r.ticket_id;

alter view public.v_labores_control set (security_invoker = on);


-- =====================================================================
-- PARTE B · EL DISPARADOR TAMBIÉN AL ACTUALIZAR
-- =====================================================================
-- `registros.temporada_id` se llenaba sólo al INSERTAR el detalle. Si la
-- línea se re-apunta a otra temporada, la copia del registro se quedaba
-- con la vieja y la pantalla de captura seguía mostrando la temporada
-- equivocada.
-- =====================================================================

drop trigger if exists trg_detalle_temporada on public.registro_detalle;
create trigger trg_detalle_temporada
    after insert or update of lote_temporada_id on public.registro_detalle
    for each row execute function public.fn_temporada_desde_lotes();


-- =====================================================================
-- PARTE C · REASIGNAR EN UNA SOLA TRANSACCIÓN
-- =====================================================================
-- Sirve igual para una línea que para doscientas: la pantalla llama a la
-- misma función con un arreglo de uno o de muchos. Al ser una sola
-- sentencia, o se mueven todas las que se pueden mover o ninguna; no
-- queda la mitad reasignada si se corta la red.
-- =====================================================================

create or replace function public.fn_reasignar_temporada_detalle(
    p_detalle_ids  uuid[],
    p_temporada_id uuid
) returns table (
    movidos      integer,
    sin_cambio   integer,
    /** Lotes que no están asignados a la temporada de destino. */
    faltantes    text[]
)
language plpgsql volatile security invoker as $$
declare
    v_movidos integer := 0;
    v_igual   integer := 0;
    v_faltan  text[];
begin
    if p_detalle_ids is null or array_length(p_detalle_ids, 1) is null then
        raise exception 'No se seleccionó ninguna línea.';
    end if;

    if p_temporada_id is null
       or not exists (select 1 from public.temporadas t where t.id = p_temporada_id) then
        raise exception 'La temporada de destino no existe.';
    end if;

    -- Las que ya están en la temporada pedida no se tocan.
    select count(*) into v_igual
    from public.registro_detalle rd
    join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
    where rd.id = any(p_detalle_ids)
      and lt.temporada_id = p_temporada_id;

    -- Las que no se pueden mover porque su lote no está en el destino.
    select array_agg(distinct lo.nomenclatura order by lo.nomenclatura)
    into v_faltan
    from public.registro_detalle rd
    join public.lotes_temporada origen on origen.id = rd.lote_temporada_id
    join public.lotes lo on lo.id = origen.lote_id
    where rd.id = any(p_detalle_ids)
      and origen.temporada_id is distinct from p_temporada_id
      and not exists (
          select 1 from public.lotes_temporada destino
          where destino.lote_id = origen.lote_id
            and destino.temporada_id = p_temporada_id
      );

    with destino as (
        select rd.id as detalle_id, lt_destino.id as nuevo_lote_temporada_id
        from public.registro_detalle rd
        join public.lotes_temporada origen on origen.id = rd.lote_temporada_id
        join public.lotes_temporada lt_destino
              on lt_destino.lote_id = origen.lote_id
             and lt_destino.temporada_id = p_temporada_id
        where rd.id = any(p_detalle_ids)
          and origen.temporada_id is distinct from p_temporada_id
    ),
    movido as (
        update public.registro_detalle rd
        set lote_temporada_id = d.nuevo_lote_temporada_id
        from destino d
        where rd.id = d.detalle_id
        returning rd.id
    )
    select count(*) into v_movidos from movido;

    return query select v_movidos, v_igual, coalesce(v_faltan, array[]::text[]);
end;
$$;

comment on function public.fn_reasignar_temporada_detalle(uuid[], uuid) is
    'Re-apunta las líneas de labor indicadas al mismo lote físico en otra temporada. El lote debe estar asignado a la temporada de destino; las que no se pueden mover se devuelven en «faltantes».';
