-- =====================================================================
-- MIGRACIÓN 89 · Cerrar y reabrir ticket: el permiso se mira ANTES del cambio
-- =====================================================================
-- Reporte del usuario (2026-11-11): «los usuarios no pueden cerrar el ticket, la plataforma les rebota porque no
-- tienen permisos, y en Permisos no hay opción para habilitarlo».
--
-- Causa: `cerrar_ticket` era `security invoker` y dejaba decidir a la RLS de `tickets`. La política de UPDATE no
-- tiene WITH CHECK, así que Postgres aplica su USING también a la fila NUEVA. Para un capturador la condición
-- es «solo abiertos y en Registrando»: el ticket ya cerrado no la cumple y la base rechaza su propio cierre
-- («new row violates row-level security policy»). Igual con reabrir: el ticket cerrado nunca cumple «abierto».
--
-- Arreglo (mismo patrón que reabrir_ticket de la 43): funciones `security definer` que preguntan el permiso
-- «Editar» de Tickets sobre el ticket TAL COMO ESTÁ (alcance + condición + notificado), y luego cambian solo
-- el estado. Reabrir pregunta «¿podría editarlo si estuviera abierto?»: así el capturador puede reabrir su
-- propio ticket mientras siga en «0 · Registrado» (le faltó un equipo); una vez en revisión, ya no.
-- No toca permisos ni la matriz. Idempotente.
-- =====================================================================

create or replace function public.cerrar_ticket(p_ticket_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;

    if not public.fn_puede_escribir_en_ticket(p_ticket_id, 'tickets', 'editar') then
        raise exception 'Tu rol no puede cerrar este ticket: pide «Editar» en Tickets y, si tu permiso es solo para tickets en registro, que el ticket siga en «0 · Registrado».'
            using errcode = '42501';
    end if;

    update public.tickets
       set estado = 'CERRADO', cerrado_at = now(), cerrado_by = auth.uid()
     where id = p_ticket_id
       and estado <> 'CERRADO';
end;
$$;

grant execute on function public.cerrar_ticket(uuid) to authenticated;

create or replace function public.reabrir_ticket(p_ticket_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ok boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;

    -- Igual que fn_puede_escribir_en_ticket, pero evaluando el ticket como ABIERTO (lo que quedará al reabrir)
    select public.fn_es_admin()
        or (
            not coalesce(a.notificado, false)
            and public.fn_verificar_permiso('tickets', 'editar', a.dueno, null, true, a.nivel)
            and (public.fn_mi_alcance('tickets', 'editar') <> 'zonal' or public.fn_ve_ticket(p_ticket_id))
        )
      into v_ok
      from public.fn_atributos_ticket(p_ticket_id) a;

    if not coalesce(v_ok, false) then
        raise exception 'Tu rol no puede reabrir este ticket: pide «Editar» en Tickets y, si tu permiso es solo para tickets en registro, que el ticket siga en «0 · Registrado».'
            using errcode = '42501';
    end if;

    update public.tickets
       set estado = 'ABIERTO', cerrado_at = null, cerrado_by = null
     where id = p_ticket_id
       and estado <> 'ABIERTO';
end;
$$;

grant execute on function public.reabrir_ticket(uuid) to authenticated;
