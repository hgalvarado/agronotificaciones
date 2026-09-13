-- =====================================================================
-- MIGRACIÓN 22 · La vista de control trae TODO lo que se capturó
-- =====================================================================
-- «El formulario debe cargar y permitir la modificación de todos los
--  datos originales capturados desde el ticket (Proveedor, Etapa, Horas,
--  Lote, Operador, etc.).»
--
-- La pantalla de Control de labores editaba seis campos sueltos dentro de
-- la tabla. Para abrir un formulario completo hace falta que la fila
-- traiga lo que hoy no trae: la etapa, los proveedores, el operador y el
-- equipo (sus IDs, no sólo el nombre) y las lecturas del horómetro.
--
-- Se agregan AL FINAL de `v_labores_control`. `create or replace view`
-- sólo admite añadir columnas al final —cualquier cambio de orden o de
-- nombre exigiría DROP, y de ahí se caerían las políticas que cuelgan de
-- la vista—, así que el orden de abajo respeta exactamente el de la
-- migración 19 y lo nuevo va después de `codigo_implemento`.
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
    l_t.temporada_id,
    tm.nombre                   as temporada_nombre,
    l_t.lote_id,
    -- Columnas de la 19
    r.implemento_fisico_id,
    imf.codigo                  as codigo_implemento,
    -- ---------------- Columnas nuevas de la 22 ----------------------
    -- De la LÍNEA (registro_detalle): lo que cambia lote por lote.
    rd.etapa,
    rd.con_moto,
    rd.proveedor_plastico_id,
    pp.nombre                   as proveedor_plastico,
    rd.proveedor_manguera_id,
    pmg.nombre                  as proveedor_manguera,
    rd.comentarios              as detalle_comentarios,
    rd.fecha                    as detalle_fecha,
    -- Del HORÓMETRO: lo que comparten todas las labores de esa pasada.
    h.equipo_id,
    h.operador_id,
    h.horometro_inicial,
    h.horometro_final,
    -- Cuántos registros cuelgan del mismo horómetro. La pantalla lo usa
    -- para avisar que tocar el operador o las lecturas afecta a todos.
    (select count(*) from public.registros y where y.horometro_id = h.id) as registros_del_horometro
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
left join public.implementos_fisicos imf on imf.id = r.implemento_fisico_id
left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
left join public.proveedores pp  on pp.id = rd.proveedor_plastico_id
left join public.proveedores pmg on pmg.id = rd.proveedor_manguera_id
left join public.perfiles pe     on pe.id = r.usuario_id
join public.tickets t            on t.id = r.ticket_id;

alter view public.v_labores_control set (security_invoker = on);

comment on view public.v_labores_control is
    'Una fila por línea de lote trabajada, con todo lo capturado en el ticket: la línea, su registro y su horómetro. La pantalla de Control de labores edita desde aquí.';
