-- =====================================================================
-- MIGRACIÓN 86 · Un ticket «Registrando» por día y la casilla «Mover proceso»
-- =====================================================================
-- Pedidos del usuario (2026-11-10):
--
--   A · «Debemos limitarlo a que solo pueda crear 1 ticket diario… solo puede crear un ticket nuevo con la
--       misma fecha cuando el ticket ya esté en 1. Revisión o niveles superiores, por si le faltó otro equipo.»
--       En desarrollo había capturadores con 3, 4 y hasta 8 tickets del mismo día en «Registrado».
--
--   B · «El usuario tiene un botón que dice Enviar a revisión: se lo vamos a quitar. Que el cambio de proceso
--       solo lo pueda hacer Torre de Control, el Administrador o cualquier persona que el Administrador diga.»
--       → Casilla nueva en la matriz: tickets · «Mover proceso». Sin ella no se mueve el proceso de ningún
--       ticket (ni el propio). «Aprobar» y «Notificar» siguen siendo llaves aparte para los pasos 2 y 3.
--       Se concede a los roles que ya tenían «Aprobar» o «Notificar» (quienes revisan hoy), con su alcance.
--       Ningún nombre de rol en el código: todo sale de la matriz.
--
-- Idempotente. No borra datos. Los tickets duplicados que ya existen se quedan como están (la regla aplica a
-- los nuevos); se pueden revisar con la consulta del final.
-- =====================================================================


-- =====================================================================
-- B.1 · LA CASILLA
-- =====================================================================

insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('mover_proceso', 'Mover proceso',
     'Puede cambiar el proceso de los tickets (0 Registrado ⇄ 1 Revisando), uno por uno o en lote desde Tickets, Horómetros y Labores. Pasar a «2 · Pendiente Aprobación» pide además «Aprobar», y a «3 · Notificado», «Notificar».',
     75, true)
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden, escribe = excluded.escribe;

update public.pantallas
   set acciones = array_append(acciones, 'mover_proceso')
 where codigo = 'tickets'
   and not (acciones @> array['mover_proceso']);

-- Quien revisa hoy (tiene Aprobar o Notificar en Tickets) conserva poder mover el proceso
insert into public.permisos (rol_id, recurso, accion, alcance, condicion)
select distinct on (p.rol_id) p.rol_id, 'tickets', 'mover_proceso', p.alcance, 'sin_restriccion'
from public.permisos p
where p.recurso = 'tickets' and p.accion in ('aprobar', 'notificar') and p.permitido
order by p.rol_id, p.accion
on conflict (rol_id, recurso, accion) do nothing;


-- =====================================================================
-- B.2 · CAMBIAR EL PROCESO DE UN TICKET
-- =====================================================================

create or replace function public.cambiar_proceso_ticket(
    p_ticket_id uuid,
    p_proceso   public.proceso_ticket
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ticket public.tickets%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;

    if not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'mover_proceso')) then
        raise exception 'Tu rol no tiene «Mover proceso» en Tickets. Lo mueve Torre de Control o quien el Administrador indique en Permisos.'
            using errcode = '42501';
    end if;

    select * into v_ticket from public.tickets t where t.id = p_ticket_id;
    if not found then
        raise exception 'El ticket ya no existe. Actualiza la lista.';
    end if;

    if v_ticket.proceso = p_proceso then
        return;  -- alguien ya lo movió: pulsar dos veces no es un error
    end if;

    -- Alcance: con «propietario» sólo los propios
    if not public.fn_es_admin()
       and public.fn_mi_alcance('tickets', 'mover_proceso') = 'propietario'
       and v_ticket.usuario_id is distinct from auth.uid() then
        raise exception 'Este ticket es de otra persona y tu permiso «Mover proceso» sólo alcanza a los tuyos.'
            using errcode = '42501';
    end if;

    if v_ticket.proceso = 'NOTIFICADO' and not public.fn_es_admin() then
        raise exception 'El ticket ya está notificado en SAP: sólo el Administrador lo devuelve.'
            using errcode = '42501';
    end if;

    if p_proceso = 'PENDIENTE_APROBACION'
       and not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'aprobar')) then
        raise exception 'Tu rol no tiene «Aprobar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    if p_proceso = 'NOTIFICADO'
       and not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'notificar')) then
        raise exception 'Tu rol no tiene «Notificar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    update public.tickets set proceso = p_proceso where id = p_ticket_id;
end;
$$;

grant execute on function public.cambiar_proceso_ticket(uuid, public.proceso_ticket) to authenticated;


-- =====================================================================
-- B.3 · CAMBIO EN LOTE (Tickets, Horómetros, Labores)
-- =====================================================================
-- Igual que la migración 53, salvo: mover el PROCESO pide «Mover proceso» (antes bastaba «Editar»); cambiar
-- sólo el ESTADO sigue pidiendo «Editar».

create or replace function public.actualizar_tickets_masivo(
    p_ticket_ids uuid[],
    p_estado     public.estado_ticket default null,
    p_proceso    public.proceso_ticket default null
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_afectados integer := 0;
    v_todos     boolean;
begin
    if p_ticket_ids is null or array_length(p_ticket_ids, 1) is null then
        raise exception 'No se recibió ningún ticket.';
    end if;

    if p_estado is null and p_proceso is null then
        raise exception 'Indica al menos un cambio: estado o proceso.';
    end if;

    if p_estado is not null and not public.fn_tiene_permiso('tickets', 'editar') then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    if p_proceso is not null and not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'mover_proceso')) then
        raise exception 'Tu rol no tiene «Mover proceso» en Tickets. Lo mueve Torre de Control o quien el Administrador indique en Permisos.'
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

    -- Alcance de lo que se mueve: el de «Mover proceso» si se mueve el proceso, si no el de «ver» (como antes)
    v_todos := public.fn_es_admin()
               or (p_proceso is not null and public.fn_mi_alcance('tickets', 'mover_proceso') <> 'propietario')
               or (p_proceso is null and public.fn_ve_todo('tickets'));

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
      and (p_estado is null
           or public.fn_es_admin()
           or public.fn_nivel_proceso(t.proceso) = 0
           or public.fn_puede_editar_en_revision())
      and (v_todos or t.usuario_id = auth.uid());

    get diagnostics v_afectados = row_count;
    return v_afectados;
end;
$$;

grant execute on function public.actualizar_tickets_masivo(uuid[], public.estado_ticket, public.proceso_ticket) to authenticated;


-- =====================================================================
-- A · UN TICKET «REGISTRANDO» POR PERSONA Y DÍA
-- =====================================================================
-- Se puede crear otro ticket de la misma fecha sólo cuando el que existe ya pasó a «1 · Revisando» o más.
-- El mensaje lleva el id del ticket existente (después de «ticket:») para que la pantalla lleve a él.

create or replace function public.fn_un_ticket_registrando_por_dia()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_existente uuid;
begin
    if new.proceso is distinct from 'REGISTRADO' or new.usuario_id is null or new.fecha is null then
        return new;
    end if;
    -- Un UPDATE que manda la misma fecha y el mismo dueño (p. ej. al editar el estado) no cambia nada:
    -- no debe chocar con duplicados que ya existían antes de esta regla
    if tg_op = 'UPDATE' and new.fecha = old.fecha and new.usuario_id = old.usuario_id then
        return new;
    end if;

    select t.id into v_existente
    from public.tickets t
    where t.usuario_id = new.usuario_id
      and t.fecha = new.fecha
      and t.proceso = 'REGISTRADO'
      and t.id <> new.id
    order by t.created_at
    limit 1;

    if v_existente is not null then
        raise exception 'Ya existe un ticket de esa fecha que sigue en «0 · Registrando». Agrega los equipos en ese ticket. ticket:%', v_existente
            using errcode = 'P0001',
                  hint = 'Se puede crear otro de la misma fecha cuando ese ticket pase a «1 · Revisando».';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_un_ticket_registrando_por_dia on public.tickets;
create trigger trg_un_ticket_registrando_por_dia
    before insert or update of fecha, usuario_id on public.tickets
    for each row execute function public.fn_un_ticket_registrando_por_dia();

create index if not exists idx_tickets_usuario_fecha_registrando
    on public.tickets (usuario_id, fecha)
    where proceso = 'REGISTRADO';


-- =====================================================================
-- Para revisar a mano: los duplicados que ya existían (no se tocan)
-- =====================================================================
-- select pe.nombre, t.fecha, count(*) as tickets
-- from public.tickets t join public.perfiles pe on pe.id = t.usuario_id
-- where t.proceso = 'REGISTRADO'
-- group by 1, 2 having count(*) > 1 order by 2 desc;
