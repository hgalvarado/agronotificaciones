-- =====================================================================
-- AGRONOTIFICACIONES · Migración 10
-- Vista de labores ampliada: IDs para edición + usuario que registró
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01–09.
--
-- La vista anterior sólo traía nombres, suficiente para leer pero no para
-- editar: para cambiar la labor o la tarea desde la pantalla de control
-- hacen falta los IDs. También se agrega el usuario que capturó, para
-- poder filtrar por él.
--
-- OJO: se usa DROP + CREATE, no CREATE OR REPLACE. PostgreSQL sólo deja
-- que un REPLACE AGREGUE columnas al final; si cambia el orden o el
-- nombre de alguna existente falla con:
--   ERROR: cannot change name of view column "ut" to "lote_temporada_id"
-- Aquí sí cambia el orden (los IDs quedan junto a su nombre), así que hay
-- que recrear la vista. Es seguro: una vista no guarda datos y nada más
-- depende de ella.
-- =====================================================================

drop view if exists public.v_labores_control;

create view public.v_labores_control as
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
    -- Quién capturó la labor (no el dueño del ticket): es el dato con el
    -- que Torre de Control rastrea a quién preguntarle por una línea.
    r.usuario_id,
    pe.nombre                   as usuario_nombre,
    -- Cuántos lotes cuelgan del mismo registro. Sirve para avisar en la
    -- interfaz que cambiar la labor afecta a todas esas líneas.
    (select count(*) from public.registro_detalle x where x.registro_id = r.id) as lotes_del_registro,
    r.created_at
from public.registro_detalle rd
join public.registros r          on r.id = rd.registro_id
join public.lotes_temporada l_t  on l_t.id = rd.lote_temporada_id
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

-- El ciclo pasa a ser una lista cerrada (1, 2 o 3) en vez de texto libre.
alter table public.registro_detalle drop constraint if exists registro_detalle_ciclo_check;
alter table public.registro_detalle
    add constraint registro_detalle_ciclo_check check (ciclo in (1, 2, 3));

alter table public.lotes_temporada drop constraint if exists lotes_temporada_ciclo_check;
alter table public.lotes_temporada
    add constraint lotes_temporada_ciclo_check check (ciclo in (1, 2, 3));
