-- =====================================================================
-- AGRONOTIFICACIONES · Migración 08
-- (a) Vista de control de horómetros con COMPARATIVO
-- (b) Acciones masivas sobre tickets
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01–07.
-- =====================================================================


-- =====================================================================
-- PARTE A · VISTA DE CONTROL DE HORÓMETROS
-- =====================================================================
-- Replica la hoja "REGISTRO DE HOROMETROS DIARIO" que Torre de Control
-- revisa cada semana, incluida la columna COMPARATIVO.
--
-- Qué hace el comparativo: por cada equipo, en orden cronológico, compara
-- el horómetro INICIAL de un registro contra el horómetro FINAL del
-- registro anterior del MISMO equipo.
--
--   comparativo = horometro_inicial − horometro_final_anterior
--
--   = 0  → la secuencia calza, no falta nada
--   > 0  → hay un HUECO: esas horas se trabajaron pero nadie las notificó
--   < 0  → hay un TRASLAPE: dos registros cubren las mismas horas
--
-- Ese hueco es justo lo que buscas al revisar: horas de máquina que no
-- llegaron a SAP. La ventana usa (fecha, created_at) para desempatar dos
-- registros del mismo equipo el mismo día (por ejemplo diurno y nocturno).
-- =====================================================================

create or replace view public.v_horometros_control as
select
    h.id,
    h.ticket_id,
    h.fecha,
    h.turno,
    h.equipo_id,
    e.codigo                as equipo_codigo,
    e.nombre                as equipo_nombre,
    fe.nombre               as familia,
    h.horometro_inicial,
    h.horometro_final,
    h.horas_maquina,
    h.horas_hombre,
    h.operador_id,
    o.codigo                as operador_codigo,
    o.nombre                as operador_nombre,
    t.codigo                as ticket_codigo,
    t.estado                as ticket_estado,
    t.proceso               as ticket_proceso,
    t.departamento,
    h.comentario,
    h.usuario_id,
    h.created_at,
    lag(h.horometro_final) over w as horometro_final_anterior,
    -- NULL en el primer registro de cada equipo: no hay contra qué comparar.
    h.horometro_inicial - lag(h.horometro_final) over w as comparativo
from public.horometros h
join public.equipos e         on e.id = h.equipo_id
left join public.familias_equipo fe on fe.id = e.familia_id
left join public.operadores o on o.id = h.operador_id
join public.tickets t         on t.id = h.ticket_id
window w as (partition by h.equipo_id order by h.fecha, h.created_at);

-- IMPORTANTE: por defecto una vista corre con los permisos de quien la
-- creó y SALTA las políticas RLS de las tablas de abajo. Con
-- security_invoker la vista respeta el RLS de quien consulta, así que un
-- Digitador sigue viendo únicamente lo suyo.
alter view public.v_horometros_control set (security_invoker = on);

comment on view public.v_horometros_control is
'Control de horómetros para Torre de Control. La columna comparativo detecta
horas trabajadas sin notificar (hueco) o registros traslapados.';


-- =====================================================================
-- PARTE B · ACCIONES MASIVAS SOBRE TICKETS
-- =====================================================================
-- Torre de Control revisa por lotes (a veces una vez por semana), así que
-- necesita mover varios tickets de estado o de proceso en una sola acción.
-- Se hace en una función para que sea UNA transacción: o se aplican todos
-- los permitidos, o no se aplica ninguno.
-- =====================================================================

create or replace function public.actualizar_tickets_masivo(
    p_ticket_ids uuid[],
    p_estado     public.estado_ticket   default null,
    p_proceso    public.proceso_ticket  default null
) returns integer
language plpgsql security invoker as $$
declare
    v_rol       text;
    v_afectados integer := 0;
begin
    if p_ticket_ids is null or array_length(p_ticket_ids, 1) is null then
        raise exception 'No se recibió ningún ticket.';
    end if;

    if p_estado is null and p_proceso is null then
        raise exception 'Indica al menos un cambio: estado o proceso.';
    end if;

    v_rol := public.fn_mi_rol();

    -- Sólo Administrador y Torre de Control trabajan por lotes. El
    -- Digitador de campo no tiene por qué mover tickets en bloque.
    if v_rol not in ('ADMIN', 'TORRE_CONTROL') then
        raise exception 'Tu rol no puede actualizar tickets en bloque.';
    end if;

    update public.tickets t
    set
        estado     = coalesce(p_estado, t.estado),
        proceso    = coalesce(p_proceso, t.proceso),
        cerrado_at = case
                        when p_estado = 'CERRADO' and t.estado <> 'CERRADO' then now()
                        when p_estado = 'ABIERTO' then null
                        else t.cerrado_at
                     end,
        cerrado_by = case
                        when p_estado = 'CERRADO' and t.estado <> 'CERRADO' then auth.uid()
                        when p_estado = 'ABIERTO' then null
                        else t.cerrado_by
                     end
    where t.id = any(p_ticket_ids);
    -- RLS sigue filtrando: sólo se actualizan los tickets que este usuario
    -- realmente puede tocar.

    get diagnostics v_afectados = row_count;
    return v_afectados;
end;
$$;

comment on function public.actualizar_tickets_masivo is
'Cambia estado y/o proceso de varios tickets a la vez. Sólo Admin y Torre de Control.';
