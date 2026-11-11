-- =====================================================================
-- MIGRACIÓN 90 · Eliminar un ticket con registros pide una casilla aparte
-- =====================================================================
-- Pedido del usuario (2026-11-11): «el usuario tiene acceso a eliminar y eso está bien, para no llenar de tickets
-- que no sirven o registros en que se equivocaron; el problema es que pueden eliminar en escala completa: borran
-- el ticket y con esa acción borran todos los registros de horómetros. Que sólo puedan borrar cuando el ticket
-- esté vacío.»
--
-- Casilla nueva en la matriz: tickets · «Eliminar con registros». Sin ella, un ticket se puede eliminar sólo si
-- no tiene horómetros (los equipos se eliminan uno por uno, que es una decisión consciente por registro).
-- Se concede a los roles que hoy eliminan tickets con alcance distinto de «propietario» (eliminan lo de otros:
-- quien revisa); los capturadores (alcance propietario) quedan con «sólo vacíos». Ningún nombre de rol escrito.
-- El Administrador (acceso total) no se recorta. Lo que corre sin sesión (procesos internos, service role) no se toca.
-- Idempotente. No borra datos.
-- =====================================================================

insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('eliminar_con_contenido', 'Eliminar con registros',
     'Puede eliminar un ticket que todavía tiene horómetros y labores (se borran con él). Sin esta casilla, «Eliminar» sólo alcanza a tickets vacíos: primero hay que eliminar sus equipos uno por uno.',
     55, true)
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden, escribe = excluded.escribe;

update public.pantallas
   set acciones = array_append(acciones, 'eliminar_con_contenido')
 where codigo = 'tickets'
   and not (acciones @> array['eliminar_con_contenido']);

insert into public.permisos (rol_id, recurso, accion, alcance, condicion)
select p.rol_id, 'tickets', 'eliminar_con_contenido', p.alcance, p.condicion
from public.permisos p
where p.recurso = 'tickets' and p.accion = 'eliminar' and p.permitido and p.alcance <> 'propietario'
on conflict (rol_id, recurso, accion) do nothing;


create or replace function public.fn_ticket_eliminar_solo_vacio()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_equipos integer;
begin
    -- Sin sesión de usuario (procesos internos) o Administrador: sin recorte
    if (select auth.uid()) is null or public.fn_es_admin() then
        return old;
    end if;

    select count(*) into v_equipos from public.horometros h where h.ticket_id = old.id;
    if v_equipos > 0 and not public.fn_tiene_permiso('tickets', 'eliminar_con_contenido') then
        raise exception 'El ticket % tiene % % registrado%. Para eliminarlo, primero elimina sus equipos uno por uno (o pide «Eliminar con registros» en Permisos).',
            old.codigo, v_equipos, case when v_equipos = 1 then 'equipo' else 'equipos' end,
            case when v_equipos = 1 then '' else 's' end
            using errcode = 'P0001';
    end if;
    return old;
end;
$$;

drop trigger if exists trg_ticket_eliminar_solo_vacio on public.tickets;
create trigger trg_ticket_eliminar_solo_vacio
    before delete on public.tickets
    for each row execute function public.fn_ticket_eliminar_solo_vacio();
