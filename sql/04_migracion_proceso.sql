-- =====================================================================
-- AGRONOTIFICACIONES · Migración 04
-- Agrega el flujo de PROCESO al ticket
-- =====================================================================
-- Contexto: la app de AppSheet manejaba DOS dimensiones distintas en el
-- ticket que en el esquema inicial quedaron colapsadas en una sola:
--
--   * ESTADO  (hoja ESTADOS)  → Activo / Inactivo   = ticket abierto o cerrado
--   * PROCESO (hoja PROGRESO) → 0 Registrado, 1 Revisando,
--                               2 Pendiente Aprobación, 3 Notificado
--
-- El ESTADO controla si el digitador puede seguir editando (ya lo maneja
-- el enum estado_ticket + las políticas RLS). El PROCESO es el avance del
-- ticket hacia la liquidación en SAP, y lo mueve Torre de Control.
-- Ejecutar en el SQL Editor DESPUÉS de 01, 02 y 03.
-- =====================================================================

create type public.proceso_ticket as enum (
    'REGISTRADO',            -- 0 · el digitador terminó de capturar en campo
    'REVISANDO',             -- 1 · enviado a Torre de Control
    'PENDIENTE_APROBACION',  -- 2 · revisado, esperando visto bueno
    'NOTIFICADO'             -- 3 · ya cargado y liquidado en SAP
);

alter table public.tickets
    add column if not exists proceso public.proceso_ticket not null default 'REGISTRADO';

create index if not exists tickets_proceso_idx on public.tickets (proceso);

-- ---------------------------------------------------------------------
-- RPC para mover el proceso respetando el rol
-- ---------------------------------------------------------------------
-- El Digitador de campo sólo puede empujar su ticket a "Revisando"
-- (avisarle a Torre de Control que ya terminó). De ahí en adelante, el
-- avance hacia SAP lo controla Torre de Control / Administrador.
create or replace function public.cambiar_proceso_ticket(
    p_ticket_id uuid,
    p_proceso    public.proceso_ticket
) returns void
language plpgsql security invoker as $$
declare
    v_rol text;
begin
    v_rol := public.fn_mi_rol();

    if v_rol = 'DIGITADOR' and p_proceso <> 'REVISANDO' then
        raise exception 'Tu rol sólo puede enviar el ticket a revisión.';
    end if;

    update public.tickets
    set proceso = p_proceso
    where id = p_ticket_id;
    -- Si RLS no permite el UPDATE (ej. ticket ajeno), no afecta filas y
    -- la operación termina sin cambios: el frontend lo detecta al refrescar.
end;
$$;

comment on function public.cambiar_proceso_ticket is
'Mueve el ticket en el flujo hacia SAP. El Digitador sólo puede llevarlo a REVISANDO.';

-- ---------------------------------------------------------------------
-- RPC para reabrir un ticket (sólo Admin / Torre de Control)
-- ---------------------------------------------------------------------
create or replace function public.reabrir_ticket(p_ticket_id uuid)
returns void
language plpgsql security invoker as $$
begin
    if public.fn_mi_rol() not in ('ADMIN', 'TORRE_CONTROL') then
        raise exception 'Sólo Torre de Control o el Administrador pueden reabrir un ticket.';
    end if;

    update public.tickets
    set estado = 'ABIERTO', cerrado_at = null, cerrado_by = null
    where id = p_ticket_id;
end;
$$;
