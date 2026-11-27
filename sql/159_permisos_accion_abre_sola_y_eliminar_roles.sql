-- =====================================================================
-- 159 · Permisos (pedido 2026-11-27)
--
-- A · Acciones que abren por sí solas («Ver registros» de AgroMétricas).
--     Antes la cascada de la matriz impedía dar «Ver registros» sin «Ver»: al apagar «Ver» se apagaba todo y al
--     encender cualquier otra acción se encendía «Ver» solo. Así nunca se podía dejar a un supervisor con la ficha
--     «Registros de parámetros» sin la captura «Parámetros de riego».
--     Columna nueva `acciones.abre_sola`: una acción marcada no depende de «Ver» ni lo enciende. Genérico: cualquier
--     módulo futuro con una «segunda puerta» la marca y listo.
--
-- B · Eliminar roles de fábrica. El usuario no podía eliminar roles como «Digitador Análisis». El rol de fábrica
--     ya no se nombra por código en la aplicación (todo va por la matriz y las banderas), así que solo queda
--     protegido el rol con acceso total (el Administrador). Sigue la regla: no se elimina un rol que tenga personas.
--     `_alerta_perfil_es_admin` (154) dejaba de reconocer al Administrador por su código: ahora por la bandera.
--
-- Idempotente. Sin UPDATE/DELETE sin WHERE.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ------------------------------- A -------------------------------
alter table public.acciones add column if not exists abre_sola boolean not null default false;
comment on column public.acciones.abre_sola is
'Da acceso por sí sola (otra puerta de la pantalla): no necesita «Ver», no lo enciende y apagar «Ver» no la apaga.';

update public.acciones set abre_sola = true where codigo = 'ver_registros' and not abre_sola;

create or replace function public.fn_guardar_permiso(
    p_rol_id    smallint,
    p_recurso   text,
    p_accion    text,
    p_permitido boolean,
    p_alcance   text default 'global',
    p_condicion text default 'sin_restriccion'
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_alcance   public.alcance_permiso   := p_alcance::public.alcance_permiso;
    v_condicion public.condicion_permiso := p_condicion::public.condicion_permiso;
begin
    if not public.fn_tiene_permiso('permisos', 'editar') then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Permisos.'
            using errcode = '42501';
    end if;

    -- Los roles de bandera no se configuran por casillas.
    if exists (
        select 1 from public.roles
        where id = p_rol_id and (acceso_total or solo_lectura)
    ) then
        raise exception
            'Ese rol se rige por su bandera (acceso total o sólo lectura), no por la matriz.'
            using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.pantallas
        where codigo = p_recurso and acciones @> array[p_accion]
    ) then
        raise exception 'La pantalla «%» no ofrece la acción «%».', p_recurso, p_accion;
    end if;

    insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
    values (p_rol_id, p_recurso, p_accion, p_permitido, v_alcance, v_condicion)
    on conflict (rol_id, recurso, accion) do update
    set permitido = excluded.permitido,
        alcance   = excluded.alcance,
        condicion = excluded.condicion;

    -- ------------------------------ Cascada ------------------------------
    -- (159) las acciones que abren solas quedan fuera de la cascada
    if p_accion = 'ver' and not p_permitido then
        update public.permisos
        set permitido = false
        where rol_id = p_rol_id and recurso = p_recurso and accion <> 'ver'
          and accion not in (select a.codigo from public.acciones a where a.abre_sola);

    elsif p_accion <> 'ver' and p_permitido
      and not exists (select 1 from public.acciones a where a.codigo = p_accion and a.abre_sola)
      and exists (
        select 1 from public.pantallas
        where codigo = p_recurso and acciones @> array['ver']
    ) then
        insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
        values (p_rol_id, p_recurso, 'ver', true, v_alcance, 'sin_restriccion')
        on conflict (rol_id, recurso, accion) do update
        set permitido = true
        where public.permisos.permitido is distinct from true;
    end if;
end;
$$;
grant execute on function public.fn_guardar_permiso(smallint, text, text, boolean, text, text) to authenticated;

-- ------------------------------- B -------------------------------
create or replace function public.fn_eliminar_rol(p_rol_id smallint)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_rol     public.roles%rowtype;
    v_cuantos integer;
begin
    if not public.fn_tiene_permiso('permisos', 'editar') then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Permisos.' using errcode = '42501';
    end if;

    select * into v_rol from public.roles where id = p_rol_id;
    if not found then
        raise exception 'Ese rol ya no existe.' using errcode = 'P0002';
    end if;
    -- (159) solo el rol con acceso total queda protegido; los demás de fábrica se pueden eliminar
    if v_rol.acceso_total then
        raise exception 'El rol «%» tiene acceso total y no se puede eliminar.', v_rol.nombre using errcode = '2BP01';
    end if;

    select count(distinct x.perfil_id) into v_cuantos
      from (select pr.perfil_id from seguridad.perfiles_roles pr where pr.rol_id = p_rol_id
            union select p.id from public.perfiles p where p.rol_id = p_rol_id) x;
    if v_cuantos > 0 then
        raise exception 'El rol «%» lo tienen % persona(s). Quítaselo antes de eliminarlo.', v_rol.nombre, v_cuantos
            using errcode = '2BP01';
    end if;

    delete from public.permisos where rol_id = p_rol_id;
    delete from public.navegacion_rol where rol_id = p_rol_id;
    delete from public.roles where id = p_rol_id;   -- roles_administra y menu_rol se van en cascada
end
$$;

create or replace function public._alerta_perfil_es_admin(p_perfil uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.roles r
         where r.acceso_total   -- (159) por la bandera, no por el código
           and (r.id = (select p.rol_id from public.perfiles p where p.id = p_perfil)
                or r.id in (select pr.rol_id from seguridad.perfiles_roles pr where pr.perfil_id = p_perfil)))
$$;
revoke execute on function public._alerta_perfil_es_admin(uuid) from public, anon, authenticated;
