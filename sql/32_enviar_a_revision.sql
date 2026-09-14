-- =====================================================================
-- MIGRACIÓN 32 · «Enviar a revisión» deja de fallar en silencio
-- =====================================================================
-- «Al hacer clic en "Enviar a revisión" dentro de un ticket en estado
--  "Registrado", la acción no funciona y el estado no cambia.»
--
-- El botón sí llamaba a la función, y la función sí terminaba bien. Lo
-- que no ocurría era el `update`, y la versión anterior lo daba por
-- bueno; su propio comentario lo decía:
--
--     -- Si RLS no permite el UPDATE (ej. ticket ajeno), no afecta filas
--     -- y la operación termina sin cambios: el frontend lo detecta al
--     -- refrescar.
--
-- El frontend no lo detecta: refresca y ve lo mismo de antes, sin un
-- error que enseñar. Desde fuera es un botón muerto.
--
-- Y la razón de que RLS lo bloqueara es de negocio, no de seguridad. La
-- política `tickets_update` deja al digitador tocar sus tickets sólo
-- mientras están ABIERTOS —correcto: un ticket cerrado ya no se captura—,
-- pero «enviar a revisión» es justo lo que se hace DESPUÉS de cerrarlo.
-- La regla correcta y la aplicada se contradecían.
--
-- Esta migración arregla las dos cosas:
--
--   1. La función pasa a `security definer` y lleva ella misma las
--      reglas de quién puede mover qué. Es la única forma de permitir
--      este paso concreto sobre un ticket cerrado sin abrirle al
--      digitador la edición de todo lo demás, que es lo que pasaría si
--      se relajara la política de la tabla.
--   2. Si no cambia ninguna fila, LANZA. Un botón que no hace nada y no
--      dice nada es peor que un error: el usuario lo pulsa diez veces y
--      acaba pensando que el sistema se cayó.
-- =====================================================================

create or replace function public.cambiar_proceso_ticket(
    p_ticket_id uuid,
    p_proceso    public.proceso_ticket
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol     text;
    v_ticket  public.tickets%rowtype;
begin
    v_rol := public.fn_mi_rol();

    if v_rol is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;

    -- Se lee con la función —que es `definer`— para poder distinguir
    -- «el ticket no existe» de «el ticket no es tuyo». Con un `select`
    -- sujeto a RLS las dos cosas se ven igual: cero filas.
    select * into v_ticket from public.tickets t where t.id = p_ticket_id;

    if not found then
        raise exception 'El ticket ya no existe. Actualiza la lista.';
    end if;

    if v_ticket.proceso = p_proceso then
        -- No es un error: es que alguien ya lo movió. Se sale sin tocar
        -- nada para que pulsar dos veces no cuente como fallo.
        return;
    end if;

    -- Torre de Control y el Administrador mueven el ticket por todo el
    -- flujo, sea de quien sea y esté abierto o cerrado.
    if v_rol not in ('ADMIN', 'TORRE_CONTROL') then
        -- Todos los demás: sólo su propio ticket, sólo hacia REVISANDO y
        -- sólo desde REGISTRADO. Es el único paso que les corresponde:
        -- avisar de que ya terminaron en campo.
        if v_ticket.usuario_id is distinct from auth.uid() then
            raise exception 'Este ticket es de otra persona. Pídele a Torre de Control que lo mueva.';
        end if;
        if p_proceso <> 'REVISANDO' then
            raise exception 'Tu rol sólo puede enviar el ticket a revisión; el resto lo mueve Torre de Control.';
        end if;
        if v_ticket.proceso <> 'REGISTRADO' then
            raise exception 'Este ticket ya salió de «Registrado», así que Torre de Control es quien lo mueve desde aquí.';
        end if;
    end if;

    update public.tickets t
       set proceso = p_proceso
     where t.id = p_ticket_id;

    if not found then
        raise exception 'No se pudo cambiar el proceso del ticket. Vuelve a intentarlo.';
    end if;
end;
$$;

comment on function public.cambiar_proceso_ticket(uuid, public.proceso_ticket) is
    'Mueve el ticket en el flujo hacia SAP. Torre de Control y el Administrador, a donde sea; los demás, sólo su propio ticket de REGISTRADO a REVISANDO, aunque ya esté cerrado. Lanza en vez de terminar sin hacer nada.';

grant execute on function public.cambiar_proceso_ticket(uuid, public.proceso_ticket) to authenticated;
