-- =====================================================================
-- 97 · QUÉ ROLES ADMINISTRA CADA ROL (delegación fina de Usuarios)
-- =====================================================================
-- Pedido del usuario (2026-11-12): «el rol Jefe de zona solo puede modificar a los usuarios con rol Estacionero de
-- su zona; los Digitadores de campo también tienen zona pero no dependen del jefe, dependen del administrador».
--
-- Antes (93): una sola marca por rol, `roles.delegable`: CUALQUIER jefe con Usuarios (alcance zonal) podía editar a
-- quien tuviera solo roles delegables en sus zonas. No se podía decir «este jefe administra a estos roles».
--
-- Ahora: seguridad.roles_administra (rol que administra → rol administrado), se configura en Permisos.
--   - Un rol CON lista: quien lo tenga solo ve, edita, crea y asigna personas cuyos roles estén TODOS en su lista
--     (y, como antes, solo en sus zonas).
--   - Un rol SIN lista: sigue exactamente como en la 93 (los roles marcados «delegable»). Mientras nadie configure
--     listas, NADA cambia para nadie (producción igual).
--   - Acceso total / alcance global en Usuarios: igual que antes (administra todo).
-- Tabla fuera de `public` (lección de la 92: una tabla puente en public con FK a roles vuelve ambiguo
-- `perfiles?select=*,roles(*)` en PostgREST y nadie entra). Se lee y se guarda solo con funciones.
--
-- Correr DESPUÉS de la 93. Idempotente.

create table if not exists seguridad.roles_administra (
    rol_id            smallint not null references public.roles(id) on delete cascade,
    administra_rol_id smallint not null references public.roles(id) on delete cascade,
    creado_en         timestamptz not null default now(),
    creado_por        uuid,
    primary key (rol_id, administra_rol_id),
    check (rol_id <> administra_rol_id)
);
comment on table seguridad.roles_administra is
'97: el rol `rol_id` administra (ve, edita, crea, asigna) a las personas con el rol `administra_rol_id` en sus zonas.';
alter table seguridad.roles_administra enable row level security;
revoke all on seguridad.roles_administra from public, anon, authenticated;

/** Mis roles (los de seguridad.perfiles_roles y el principal). */
create or replace function seguridad.fn_mis_roles()
returns setof smallint
language sql stable security definer set search_path = public, pg_temp as $$
    select pr.rol_id from seguridad.perfiles_roles pr where pr.perfil_id = (select auth.uid())
    union
    select p.rol_id from public.perfiles p where p.id = (select auth.uid()) and p.rol_id is not null
$$;

/** ¿Alguno de mis roles tiene lista configurada? (entonces mandan las listas, no la marca «delegable»). */
create or replace function public.fn_administro_por_lista()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from seguridad.roles_administra ra where ra.rol_id in (select seguridad.fn_mis_roles()))
$$;

/**
 * Roles que puedo administrar (asignar, y editar a quien los tenga), sin contar quien administra todo:
 *   - con listas: la unión de las listas de mis roles;
 *   - sin listas: los marcados «delegable» (como en la 93).
 * Nunca un rol con acceso total.
 */
create or replace function public.fn_roles_que_administro()
returns setof smallint
language sql stable security definer set search_path = public, pg_temp as $$
    select r.id from public.roles r
    where not coalesce(r.acceso_total, false)
      and (case when public.fn_administro_por_lista()
                then r.id in (select ra.administra_rol_id from seguridad.roles_administra ra
                              where ra.rol_id in (select seguridad.fn_mis_roles()))
                else coalesce(r.delegable, false) end)
$$;

/** ¿Todos los roles de esta persona son de los que administro? (sin roles = sí: recién creada) */
create or replace function public.fn_administro_roles_de(p_perfil uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select not exists (
        select 1 from (select pr.rol_id from seguridad.perfiles_roles pr where pr.perfil_id = p_perfil
                       union select p.rol_id from public.perfiles p where p.id = p_perfil and p.rol_id is not null) t
        where t.rol_id not in (select public.fn_roles_que_administro()))
$$;

/**
 * ¿Puede ver (p_solo_ver) o editar a esta persona? (reemplaza la de la 93)
 * Completo: siempre. Delegado: la persona no tiene «Todas las zonas», TODOS sus roles son de los que administra y
 * todas sus zonas son suyas. Para VER: comparte zona o estación (o no tiene zonas todavía); y si sus roles tienen
 * lista, además sus roles deben ser de los que administra (el jefe no ve a los digitadores que no dependen de él).
 */
create or replace function public.fn_puedo_editar_persona(p_perfil uuid, p_solo_ver boolean default false)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_mias uuid[] := array(select public.fn_mis_zonas_efectivas());
    v_suyas uuid[] := array(select zona_id from public.perfiles_zonas where perfil_id = p_perfil);
    v_todas boolean;
begin
    if public.fn_administra_todo_usuarios(case when p_solo_ver then 'ver' else 'editar' end) then
        return true;
    end if;
    if not public.fn_tiene_permiso('usuarios', case when p_solo_ver then 'ver' else 'editar' end) then
        return false;
    end if;
    if p_perfil = (select auth.uid()) then
        return p_solo_ver;   -- un jefe no se cambia a sí mismo sus accesos
    end if;
    select coalesce(todas_las_zonas, false) into v_todas from public.perfiles where id = p_perfil;
    if v_todas is null then
        return false;
    end if;

    if p_solo_ver then
        if public.fn_administro_por_lista() and not public.fn_administro_roles_de(p_perfil) then
            return false;
        end if;
        return v_suyas && v_mias
            or cardinality(v_suyas) = 0 and not v_todas
            or (to_regclass('public.perfiles_estaciones') is not null and exists (
                   select 1 from public.perfiles_estaciones pe join public.estaciones_riego e on e.id = pe.estacion_id
                   where pe.perfil_id = p_perfil and e.zona_id = any(v_mias)));
    end if;

    return not v_todas
       and v_suyas <@ v_mias
       and public.fn_administro_roles_de(p_perfil);
end;
$$;

/** ¿Puede dar ESTOS accesos? (reemplaza la de la 93) null = sí; si no, el motivo. */
create or replace function public.fn_motivo_no_asignar(p_roles smallint[], p_todas boolean, p_zonas uuid[])
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_mias uuid[] := array(select public.fn_mis_zonas_efectivas());
    v_puedo text;
begin
    if public.fn_administra_todo_usuarios('editar') or public.fn_administra_todo_usuarios('crear') then
        return null;
    end if;
    if not (public.fn_tiene_permiso('usuarios', 'editar') or public.fn_tiene_permiso('usuarios', 'crear')) then
        return 'Tu rol no tiene «Editar» ni «Crear» en Usuarios.';
    end if;
    if coalesce(p_todas, false) then
        return 'Solo quien administra todas las zonas puede dar «Todas las zonas».';
    end if;
    if exists (select 1 from unnest(coalesce(p_roles, '{}')) x where x not in (select public.fn_roles_que_administro())) then
        select string_agg(r.nombre, ', ' order by r.nombre) into v_puedo
        from public.roles r where r.id in (select public.fn_roles_que_administro());
        return 'Solo puedes asignar los roles que administra tu rol: ' || coalesce(v_puedo, 'ninguno') || '.';
    end if;
    if not coalesce(p_zonas, '{}') <@ v_mias then
        return 'Solo puedes asignar tus zonas.';
    end if;
    return null;
end;
$$;

/** Para Permisos: todas las listas (quien puede ver Permisos). */
create or replace function public.fn_roles_administra()
returns table (rol_id smallint, administra_rol_id smallint)
language sql stable security definer set search_path = public, pg_temp as $$
    select ra.rol_id, ra.administra_rol_id from seguridad.roles_administra ra
    where public.fn_es_admin() or public.fn_tiene_permiso('permisos', 'ver')
    order by 1, 2
$$;

/** Guarda la lista de un rol (reemplaza la anterior). Vacía = vuelve al comportamiento de la 93 («delegable»). */
create or replace function public.fn_guardar_roles_administra(p_rol smallint, p_roles smallint[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not (public.fn_es_admin() or (public.fn_tiene_permiso('permisos', 'editar') and public.fn_mi_alcance('permisos', 'editar') = 'global')) then
        raise exception 'Solo quien administra los permisos de todos puede cambiar qué roles administra cada rol.'
            using errcode = '42501';
    end if;
    if not exists (select 1 from public.roles where id = p_rol) then
        raise exception 'El rol ya no existe. Recarga la página.';
    end if;
    if exists (select 1 from public.roles r where r.id = any(coalesce(p_roles, '{}')) and coalesce(r.acceso_total, false)) then
        raise exception 'Un rol con acceso total no lo administra otro rol.';
    end if;
    if p_rol = any(coalesce(p_roles, '{}')) then
        raise exception 'Un rol no se administra a sí mismo (un jefe no cambia a otros jefes).';
    end if;
    delete from seguridad.roles_administra where rol_id = p_rol and administra_rol_id <> all(coalesce(p_roles, '{}'));
    insert into seguridad.roles_administra (rol_id, administra_rol_id, creado_por)
    select p_rol, x, (select auth.uid()) from unnest(coalesce(p_roles, '{}')) x
    on conflict do nothing;
end;
$$;

grant execute on function public.fn_administro_por_lista() to authenticated;
grant execute on function public.fn_roles_que_administro() to authenticated;
grant execute on function public.fn_administro_roles_de(uuid) to authenticated;
grant execute on function public.fn_puedo_editar_persona(uuid, boolean) to authenticated;
grant execute on function public.fn_motivo_no_asignar(smallint[], boolean, uuid[]) to authenticated;
grant execute on function public.fn_roles_administra() to authenticated;
grant execute on function public.fn_guardar_roles_administra(smallint, smallint[]) to authenticated;
revoke execute on function seguridad.fn_mis_roles() from public, anon;
grant execute on function seguridad.fn_mis_roles() to authenticated;
