-- =====================================================================
-- MIGRACIÓN 35 · Las horas de la LÍNEA salen a la vista, y Torre de
--                Control termina de tener las manos libres
-- =====================================================================
-- «El sistema está duplicando las horas máquina en lugar de prorratearlas
--  por lote. Si el equipo trabajó 6 horas en 2 lotes (3 mz y 2 mz), debe
--  verse: Lote | Horas Máquina | Horas Notificadas → 1001-010 | 6 | 3.6»
--
-- El reparto ya se hacía bien —la migración 34 lo dejó calculando 3.6 y
-- 2.4 y guardándolo en `registro_detalle.horas_maquina`—, pero la
-- pantalla no lo estaba enseñando: la vista `v_labores_control` no
-- exponía esa columna.
--
-- Lo que la pantalla leía era `horas_costeadas`, que es
-- `coalesce(registros.horas_notificadas, horometros.horas_maquina)`: una
-- cifra del REGISTRO, no de la línea. Como un registro cubre varios
-- lotes, la misma cifra salía repetida en cada fila. De ahí el «está
-- duplicando»: no duplicaba el cálculo, duplicaba la presentación.
--
-- Se añade `horas_linea` al final de la vista. Al final y no en su sitio
-- «lógico» porque `create or replace view` sólo permite agregar columnas
-- por el final; meterla en medio obligaría a soltar la vista y con ella
-- todo lo que cuelga.
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
    -- Columnas de la 22: de la LÍNEA
    rd.etapa,
    rd.con_moto,
    rd.proveedor_plastico_id,
    pp.nombre                   as proveedor_plastico,
    rd.proveedor_manguera_id,
    pmg.nombre                  as proveedor_manguera,
    rd.comentarios              as detalle_comentarios,
    rd.fecha                    as detalle_fecha,
    -- Del HORÓMETRO
    h.equipo_id,
    h.operador_id,
    h.horometro_inicial,
    h.horometro_final,
    (select count(*) from public.registros y where y.horometro_id = h.id) as registros_del_horometro,
    -- ---------------- Columna nueva de la 35 ------------------------
    -- LAS HORAS DE ESTE LOTE. Es lo que se notifica a SAP por línea y lo
    -- que hay que enseñar en «Horas notificadas». No confundir con
    -- `horas_maquina` (las del horómetro entero, 6) ni con
    -- `horas_costeadas` (las de la labor completa, repetidas en cada
    -- lote): ésta es la parte que le tocó a este lote, 3.6.
    rd.horas_maquina            as horas_linea
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
    'Una fila por línea de lote trabajada. Tres cifras de horas y cada una es otra cosa: `horas_maquina` las del horómetro completo, `horas_costeadas` las de la labor, y `horas_linea` las que le tocaron a ESTE lote —que es lo que se notifica a SAP—.';


-- =====================================================================
-- TORRE DE CONTROL PUEDE ELIMINAR HORÓMETROS
-- =====================================================================
-- «Administrador y Torre de Control pueden editar cualquier registro,
--  labor u horómetro en cualquier momento.»
--
-- Editar ya podían: `fn_puede_capturar_en_ticket` los exceptúa desde la
-- migración 14. Faltaba borrar un horómetro, que seguía siendo sólo del
-- Administrador mientras que borrar una LABOR sí lo permitía Torre. Era
-- una asimetría sin razón: quien puede rehacer una pasada entera labor
-- por labor puede rehacerla de una vez.
-- =====================================================================

drop policy if exists horometros_delete on public.horometros;
create policy horometros_delete on public.horometros for delete
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
    );
