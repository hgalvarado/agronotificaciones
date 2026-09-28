-- =====================================================================
-- 50 · El proceso es el candado: en revisión ya no se captura.
--
-- Ejecutar en el SQL Editor DESPUÉS de la 49.
--
-- El problema: un digitador mandaba su ticket a «1. Revisando» y seguía
-- agregando labores mientras Torre de Control lo estaba cuadrando. Lo que
-- se revisó el lunes no era lo que se liquidó el martes, y la diferencia
-- no aparecía en ninguna parte.
--
-- Hasta ahora el único tope era NOTIFICADO —el final del flujo—, así que
-- los tres pasos intermedios no protegían nada.
--
-- La regla, en una línea: **el ticket se captura mientras está en
-- «0. Registrado»; a partir de «1. Revisando» se congela.**
--
--   · En REGISTRADO (esté el ticket Activo o Cerrado): CRUD normal según
--     la matriz. Cerrar el ticket sigue siendo una marca de avance, no un
--     candado.
--   · En REVISANDO, PENDIENTE_APROBACION o NOTIFICADO: ni crear, ni
--     editar, ni eliminar.
--
-- Y la excepción se concede, no se hereda de un nombre de rol: la acción
-- nueva `tickets:editar_en_revision` levanta el candado de los pasos 1 y
-- 2. El 3 —NOTIFICADO— no lo levanta nadie más que el Administrador,
-- porque eso ya se liquidó en SAP y corregirlo aquí deja las dos bases
-- diciendo cosas distintas.
--
-- Ni un `rol = 'TORRE_CONTROL'` en toda la migración. Quien hoy revisa
-- recibe la llave por lo que YA puede hacer (`tickets:ver_todo`), no por
-- cómo se llama.
-- =====================================================================

-- =====================================================================
-- A · LA CASILLA NUEVA
-- =====================================================================
-- Sin casilla en la matriz, la restricción sería un candado sin llave:
-- nadie podría concederla desde /admin/permisos y el guardián
-- `fn_permisos_sin_casilla()` la cantaría. Va primero, por eso.

insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('editar_en_revision',
     'Editar en revisión',
     'Puede corregir un ticket que ya salió de «0. Registrado» y está en revisión o pendiente de aprobación. Sin esta casilla, quien captura sólo trabaja sus tickets mientras siguen en el paso 0. Un ticket «Notificado» no lo abre esta llave: eso ya se liquidó en SAP.',
     45, true)
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    orden = excluded.orden,
    escribe = excluded.escribe;

-- La casilla aparece en la fila de Tickets. Que exista no concede nada:
-- sólo permite concederlo.
update public.pantallas
set acciones = array[
    'ver','ver_todo','crear','editar','editar_en_revision',
    'eliminar','exportar','importar','aprobar','notificar'
]
where codigo = 'tickets';

-- Quien ya movía el flujo sigue moviéndolo. `ver_todo` en Tickets es lo
-- que tiene Torre de Control, y es la misma regla con la que la 44
-- repartió «aprobar» y «notificar».
insert into public.permisos (rol_id, recurso, accion)
select p.rol_id, 'tickets', 'editar_en_revision'
from public.permisos p
where p.recurso = 'tickets' and p.accion = 'ver_todo'
on conflict do nothing;

-- =====================================================================
-- B · ¿ESTE TICKET YA SALIÓ DE CAPTURA?
-- =====================================================================

/**
 * El ticket pasó del paso 0 y está en manos de quien revisa.
 *
 * Se pregunta por el NIVEL y no por el nombre del proceso: `fn_nivel_proceso`
 * ya es el único sitio donde vive el orden del flujo, y el día que se
 * agregue un paso 4 esta función no se entera.
 */
create or replace function public.fn_ticket_en_revision(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.tickets t
        where t.id = p_ticket_id
          and public.fn_nivel_proceso(t.proceso) >= 1
    )
$$;

comment on function public.fn_ticket_en_revision(uuid) is
'El ticket salió de «0. Registrado». A partir de aquí sólo escribe quien tenga tickets:editar_en_revision.';

grant execute on function public.fn_ticket_en_revision(uuid) to authenticated;

/**
 * ¿Se le levanta el candado a esta persona?
 *
 * Una función aparte y no una condición repetida en seis sitios: la
 * regla de la excepción se lee —y se cambia— en un solo renglón.
 */
create or replace function public.fn_puede_editar_en_revision()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'editar_en_revision')
$$;

grant execute on function public.fn_puede_editar_en_revision() to authenticated;

-- =====================================================================
-- C · LA REGLA ÚNICA AL ESCRIBIR
-- =====================================================================

/**
 * Quién puede escribir en lo que cuelga de un ticket.
 *
 * Cambia respecto a la 43: entra el candado del proceso. Quedan tres
 * condiciones y un tope:
 *
 *   1. La matriz concede esa acción en esa pantalla.
 *   2. El ticket está en «0. Registrado» —o quien escribe tiene
 *      `tickets:editar_en_revision`, que es la excepción concedida.
 *   3. Alcance: con `ver_todo` de esa pantalla, cualquier ticket; sin
 *      ella, sólo los propios.
 *   tope. NOTIFICADO no lo abre ninguna casilla. Sólo el Administrador,
 *      y es su responsabilidad rehacer la carga en SAP.
 */
create or replace function public.fn_puede_escribir_en_ticket(
    p_ticket_id uuid,
    p_pantalla  text,
    p_accion    text
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin()
        or (
            public.fn_tiene_permiso(p_pantalla, p_accion)
            and not public.fn_ticket_notificado(p_ticket_id)
            and (
                not public.fn_ticket_en_revision(p_ticket_id)
                or public.fn_tiene_permiso('tickets', 'editar_en_revision')
            )
            and (
                public.fn_ve_todo(p_pantalla)
                or exists (
                    select 1 from public.tickets t
                    where t.id = p_ticket_id and t.usuario_id = auth.uid()
                )
            )
        )
$$;

comment on function public.fn_puede_escribir_en_ticket(uuid, text, text) is
'Matriz + candado del proceso + alcance, con NOTIFICADO como tope. Ni un nombre de rol.';

-- El ticket EN SÍ. Antes bastaba `tickets:editar` para corregirle la
-- fecha o reabrirlo estando ya en revisión; ahora lleva el mismo candado.
-- Mover el PROCESO no pasa por aquí: va por `cambiar_proceso_ticket`, que
-- es `definer` y tiene sus propias reglas —si no, nadie podría devolver a
-- «Registrado» un ticket que se mandó a revisar por error.
drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update
    using (
        (select public.fn_es_admin())
        or ((select public.fn_tiene_permiso('tickets','editar'))
            and not (select public.fn_ticket_notificado(tickets.id))
            and (not (select public.fn_ticket_en_revision(tickets.id))
                 or (select public.fn_tiene_permiso('tickets','editar_en_revision')))
            and ((select public.fn_ve_todo('tickets')) or usuario_id = (select auth.uid())))
    );

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets for delete
    using (
        (select public.fn_es_admin())
        or ((select public.fn_tiene_permiso('tickets','eliminar'))
            and not (select public.fn_ticket_notificado(tickets.id))
            and (not (select public.fn_ticket_en_revision(tickets.id))
                 or (select public.fn_tiene_permiso('tickets','editar_en_revision')))
            and ((select public.fn_ve_todo('tickets')) or usuario_id = (select auth.uid())))
    );

-- =====================================================================
-- D · LO QUE PASA POR RPC
-- =====================================================================

-- `cerrar_ticket` es `invoker`: pasa por `tickets_update` y ya quedó
-- cubierto arriba. `reabrir_ticket` pregunta por
-- `fn_puede_escribir_en_ticket(…, 'tickets', 'editar')`, que acaba de
-- aprender el candado. Ninguno de los dos se toca aquí: la regla se
-- escribió una vez y los dos la heredan.

/**
 * El cambio en masa.
 *
 * Mover el PROCESO de varios tickets es justamente el trabajo de quien
 * revisa, así que el candado no puede aplicarse al proceso —sería un
 * candado que se cierra sobre la llave—. Se aplica al ESTADO: cambiar
 * Activo/Cerrado de un ticket que ya está en revisión pide la casilla.
 */
create or replace function public.actualizar_tickets_masivo(
    p_ticket_ids uuid[],
    p_estado     public.estado_ticket default null,
    p_proceso    public.proceso_ticket default null
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_afectados integer := 0;
begin
    if p_ticket_ids is null or array_length(p_ticket_ids, 1) is null then
        raise exception 'No se recibió ningún ticket.';
    end if;

    if p_estado is null and p_proceso is null then
        raise exception 'Indica al menos un cambio: estado o proceso.';
    end if;

    if not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'editar')) then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    if p_proceso = 'PENDIENTE_APROBACION'
       and not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'aprobar')) then
        raise exception 'Tu rol no tiene «Aprobar» en la pantalla de Tickets.' using errcode = '42501';
    end if;

    if p_proceso = 'NOTIFICADO'
       and not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'notificar')) then
        raise exception 'Tu rol no tiene «Notificar» en la pantalla de Tickets.' using errcode = '42501';
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
    where t.id = any(p_ticket_ids)
      and (public.fn_es_admin() or t.proceso <> 'NOTIFICADO')
      -- Cambiar el ESTADO de algo que ya está en revisión pide la llave;
      -- cambiar sólo el PROCESO, no: eso es revisar.
      and (p_estado is null
           or public.fn_es_admin()
           or public.fn_nivel_proceso(t.proceso) = 0
           or public.fn_tiene_permiso('tickets', 'editar_en_revision'))
      and (public.fn_es_admin()
           or public.fn_ve_todo('tickets')
           or t.usuario_id = auth.uid());

    get diagnostics v_afectados = row_count;
    return v_afectados;
end;
$$;

grant execute on function public.actualizar_tickets_masivo(uuid[], public.estado_ticket, public.proceso_ticket) to authenticated;

-- =====================================================================
-- E · EL GUARDIÁN, OTRA VEZ
-- =====================================================================
-- `fn_permisos_sin_casilla()` recorre policies y funciones buscando las
-- llaves que la base exige de verdad. La nueva tiene que salir con su
-- casilla puesta, o la migración se queda a medias.

do $$
declare
    v_faltan integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    if v_faltan > 0 then
        raise exception 'Quedaron % llaves sin casilla en la matriz.', v_faltan;
    end if;
    raise notice 'ok  la matriz ofrece todas las llaves que la base exige';
end;
$$;
