-- =====================================================================
-- MIGRACIÓN 93 · Permisos: historial (P3), menú desde la base (P4) y delegación a jefes de zona (P5)
-- =====================================================================
-- Cierra la mejora del módulo de permisos (pedido del usuario 2026-11-11) antes de Fertirriego Etapa B.
--
--   P3 · HISTORIAL: todo cambio de permisos, roles, roles de una persona, zonas, «Todas las zonas», estado de
--        la cuenta y estaciones asignadas queda en seguridad.bitacora_accesos: quién, cuándo, antes y después.
--        Se lee con fn_historial_accesos().
--   P4 · MENÚ DESDE LA BASE: pantallas.en_menu + pantallas.icono. Una pantalla marcada «en menú» con ruta
--        aparece sola en el menú de quien tenga «Ver». El menú que ya existe NO se toca (no se arriesga la
--        navegación de nadie); esto es para los módulos nuevos (Fertirriego, combustible, parámetros…).
--   P5 · DELEGACIÓN: quien tenga Usuarios con alcance «zonal»/«propietario» (p. ej. el jefe de zona) solo ve y
--        edita personas de SUS zonas, solo asigna SUS zonas y roles marcados como delegables (roles.delegable),
--        nunca «Todas las zonas» ni acceso total. Lo valida la base (fn_guardar_accesos_persona), no la pantalla.
--
-- Producción: no cambia lo que nadie puede hacer (solo agrega columnas apagadas, triggers de bitácora y
-- funciones nuevas). Probado con pruebas/sql/92_equivalencia.sql. Idempotente.
-- Las tablas nuevas van en el esquema «seguridad» (no expuesto): una tabla en «public» con caminos entre
-- perfiles y roles rompe la consulta con que se entra a la aplicación (lección de la 92).
-- =====================================================================

create schema if not exists seguridad;


-- =====================================================================
-- P3 · HISTORIAL DE ACCESOS
-- =====================================================================

create table if not exists seguridad.bitacora_accesos (
    id        bigint generated always as identity primary key,
    at        timestamptz not null default now(),
    por       uuid,                -- quién lo hizo (sin FK a propósito)
    tabla     text not null,
    accion    text not null,       -- INSERT · UPDATE · DELETE
    rol_id    smallint,
    perfil_id uuid,
    recurso   text,                -- «pantalla:acción», id de zona o de estación
    antes     jsonb,
    despues   jsonb
);

create index if not exists idx_bitacora_accesos_rol on seguridad.bitacora_accesos (rol_id, at desc);
create index if not exists idx_bitacora_accesos_perfil on seguridad.bitacora_accesos (perfil_id, at desc);
revoke all on seguridad.bitacora_accesos from public, anon, authenticated;

create or replace function seguridad.fn_anotar_acceso()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_nuevo jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
    v_viejo jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
    v_fila  jsonb := coalesce(v_nuevo, v_viejo);
    v_por   uuid;
    v_recurso text;
begin
    -- perfiles: solo interesan los campos de acceso
    if tg_table_name = 'perfiles' then
        if tg_op = 'UPDATE'
           and (v_nuevo->'rol_id') is not distinct from (v_viejo->'rol_id')
           and (v_nuevo->'todas_las_zonas') is not distinct from (v_viejo->'todas_las_zonas')
           and (v_nuevo->'activo') is not distinct from (v_viejo->'activo') then
            return null;
        end if;
        v_nuevo := v_nuevo - 'nombre' - 'departamento' - 'whatsapp' - 'created_at' - 'updated_at';
        v_viejo := v_viejo - 'nombre' - 'departamento' - 'whatsapp' - 'created_at' - 'updated_at';
    end if;
    if tg_op = 'UPDATE' and v_nuevo is not distinct from v_viejo then
        return null;
    end if;

    begin
        v_por := (select auth.uid());
    exception when others then
        v_por := null;
    end;

    v_recurso := case tg_table_name
        when 'permisos' then (v_fila->>'recurso') || ':' || (v_fila->>'accion')
        when 'perfiles_zonas' then v_fila->>'zona_id'
        when 'perfiles_estaciones' then v_fila->>'estacion_id'
        else null end;

    insert into seguridad.bitacora_accesos (por, tabla, accion, rol_id, perfil_id, recurso, antes, despues)
    values (v_por, tg_table_name, tg_op,
            case when tg_table_name = 'roles' then (v_fila->>'id')::smallint else (v_fila->>'rol_id')::smallint end,
            case when tg_table_name = 'perfiles' then (v_fila->>'id')::uuid else (v_fila->>'perfil_id')::uuid end,
            v_recurso, v_viejo, v_nuevo);
    return null;
end;
$$;

do $$
declare
    t text;
begin
    foreach t in array array['public.permisos', 'public.roles', 'seguridad.perfiles_roles', 'public.perfiles_zonas',
                             'public.perfiles', 'public.perfiles_estaciones'] loop
        if to_regclass(t) is not null then
            execute format('drop trigger if exists trg_anotar_acceso on %s', t);
            execute format('create trigger trg_anotar_acceso after insert or update or delete on %s
                            for each row execute function seguridad.fn_anotar_acceso()', t);
        end if;
    end loop;
end $$;

/** El historial de un rol o de una persona (o todo), lo más reciente primero. */
create or replace function public.fn_historial_accesos(
    p_rol smallint default null, p_perfil uuid default null, p_limite integer default 100
) returns table (
    at timestamptz, por text, tabla text, accion text, rol text, persona text, recurso text, antes jsonb, despues jsonb
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not (public.fn_es_admin()
            or (p_perfil is null and public.fn_tiene_permiso('permisos', 'ver'))
            or (p_perfil is not null and public.fn_tiene_permiso('usuarios', 'ver')
                and public.fn_puedo_editar_persona(p_perfil, true))) then
        raise exception 'No tienes permiso para ver este historial.' using errcode = '42501';
    end if;
    return query
        select b.at, coalesce(pp.nombre, case when b.por is null then 'Sistema / SQL' else 'Desconocido' end),
               b.tabla, b.accion, r.nombre, pe.nombre,
               case b.tabla
                   when 'perfiles_zonas' then coalesce((select z.nombre from public.zonas z where z.id::text = b.recurso), b.recurso)
                   when 'perfiles_estaciones' then coalesce((select e.nombre from public.estaciones_riego e where e.id::text = b.recurso), b.recurso)
                   else b.recurso end,
               b.antes, b.despues
        from seguridad.bitacora_accesos b
        left join public.perfiles pp on pp.id = b.por
        left join public.roles r on r.id = b.rol_id
        left join public.perfiles pe on pe.id = b.perfil_id
        where (p_rol is null or b.rol_id = p_rol)
          and (p_perfil is null or b.perfil_id = p_perfil)
        order by b.at desc, b.id desc
        limit greatest(1, least(coalesce(p_limite, 100), 500));
end;
$$;


-- =====================================================================
-- P4 · MENÚ DESDE LA BASE (solo para pantallas nuevas)
-- =====================================================================

alter table public.pantallas
    add column if not exists en_menu boolean not null default false,
    add column if not exists icono text;

comment on column public.pantallas.en_menu is
'La pantalla aparece sola en el menú de quien tenga «Ver» (módulos nuevos). Las de siempre siguen en su lugar.';
comment on column public.pantallas.icono is 'Nombre del ícono del menú: gota, gauge, tractor, chart, plan, mappin, dinero, ajustes, usuario.';

-- Fertirriego se enciende en el menú cuando exista su pantalla de campo (Etapa B)
update public.pantallas set icono = 'gota' where codigo = 'fertirriego' and icono is null;


-- =====================================================================
-- P5 · DELEGACIÓN A JEFES DE ZONA
-- =====================================================================

alter table public.roles add column if not exists delegable boolean not null default false;
comment on column public.roles.delegable is
'Lo pueden asignar quienes administran usuarios solo de sus zonas (jefes de zona). Nunca un rol con acceso total.';

/** Zonas de quien pregunta (todas, si tiene «Todas las zonas» o es administrador). */
create or replace function public.fn_mis_zonas_efectivas()
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select z.id from public.zonas z
    where public.fn_es_admin()
       or coalesce((select p.todas_las_zonas from public.perfiles p where p.id = (select auth.uid())), false)
       or exists (select 1 from public.perfiles_zonas pz where pz.perfil_id = (select auth.uid()) and pz.zona_id = z.id)
$$;

/** ¿Administra usuarios con alcance completo (global) o delegado (sus zonas)? */
create or replace function public.fn_administra_todo_usuarios(p_accion text default 'editar')
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin()
        or (public.fn_tiene_permiso('usuarios', p_accion) and public.fn_mi_alcance('usuarios', p_accion) = 'global')
$$;

/**
 * ¿Puede ver (p_solo_ver) o editar a esta persona?
 * Completo: siempre. Delegado: la persona no tiene acceso total ni «Todas las zonas», todos sus roles son
 * delegables y todas sus zonas son del jefe. Para VER basta con que comparta una zona o una estación de sus
 * zonas, o que todavía no tenga zonas (recién creada).
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
        return v_suyas && v_mias
            or cardinality(v_suyas) = 0 and not v_todas
            or (to_regclass('public.perfiles_estaciones') is not null and exists (
                   select 1 from public.perfiles_estaciones pe join public.estaciones_riego e on e.id = pe.estacion_id
                   where pe.perfil_id = p_perfil and e.zona_id = any(v_mias)));
    end if;

    return not v_todas
       and v_suyas <@ v_mias
       and not exists (select 1 from seguridad.perfiles_roles pr join public.roles r on r.id = pr.rol_id
                       where pr.perfil_id = p_perfil and (r.acceso_total or not r.delegable));
end;
$$;

grant execute on function public.fn_puedo_editar_persona(uuid, boolean) to authenticated;
grant execute on function public.fn_historial_accesos(smallint, uuid, integer) to authenticated;

/** Las personas que puede ver quien pregunta en la pantalla de Usuarios. */
create or replace function public.fn_personas_visibles()
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select p.id from public.perfiles p where public.fn_puedo_editar_persona(p.id, true)
$$;

grant execute on function public.fn_personas_visibles() to authenticated;

/**
 * ¿Puede dar ESTOS accesos? (antes de crear a alguien, y dentro de fn_guardar_accesos_persona).
 * Devuelve null si sí, o el motivo si no.
 */
create or replace function public.fn_motivo_no_asignar(p_roles smallint[], p_todas boolean, p_zonas uuid[])
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_mias uuid[] := array(select public.fn_mis_zonas_efectivas());
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
    if exists (select 1 from public.roles r where r.id = any(coalesce(p_roles, '{}')) and (r.acceso_total or not r.delegable)) then
        return 'Solo puedes asignar los roles marcados como «delegables» en Permisos.';
    end if;
    if not coalesce(p_zonas, '{}') <@ v_mias then
        return 'Solo puedes asignar tus zonas.';
    end if;
    return null;
end;
$$;

grant execute on function public.fn_motivo_no_asignar(smallint[], boolean, uuid[]) to authenticated;

/**
 * Guarda los ACCESOS de una persona en una sola transacción y a nombre de quien la llama (queda en el
 * historial): roles (con principal), «Todas las zonas» y zonas. Un parámetro nulo = no se toca.
 * La pantalla la llama con la sesión del usuario; las reglas de delegación se aplican aquí.
 */
create or replace function public.fn_guardar_accesos_persona(
    p_perfil uuid, p_roles smallint[] default null, p_principal smallint default null,
    p_todas boolean default null, p_zonas uuid[] default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_motivo text;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not public.fn_puedo_editar_persona(p_perfil, false) then
        raise exception 'No puedes cambiar los accesos de esta persona (no es de tus zonas, tiene roles que no administras o eres tú).'
            using errcode = '42501';
    end if;
    v_motivo := public.fn_motivo_no_asignar(p_roles, p_todas, p_zonas);
    if v_motivo is not null then
        raise exception '%', v_motivo using errcode = '42501';
    end if;

    -- Nadie se quita a sí mismo el acceso total
    if p_perfil = (select auth.uid()) and p_roles is not null
       and exists (select 1 from seguridad.perfiles_roles pr join public.roles r on r.id = pr.rol_id
                   where pr.perfil_id = p_perfil and r.acceso_total)
       and not exists (select 1 from public.roles r where r.id = any(p_roles) and r.acceso_total) then
        raise exception 'No puedes quitarte a ti mismo el rol con acceso total.';
    end if;

    if p_roles is not null then
        if cardinality(p_roles) = 0 then
            raise exception 'Elige al menos un rol.';
        end if;
        if not (coalesce(p_principal, p_roles[1]) = any(p_roles)) then
            raise exception 'El rol principal tiene que estar entre sus roles.';
        end if;
        if (select count(*) from public.roles where id = any(p_roles)) <> cardinality(array(select distinct unnest(p_roles))) then
            raise exception 'Uno de los roles ya no existe. Recarga la página.';
        end if;
        update public.perfiles set rol_id = coalesce(p_principal, p_roles[1]) where id = p_perfil;
        insert into seguridad.perfiles_roles (perfil_id, rol_id)
        select p_perfil, r from unnest(p_roles) r on conflict do nothing;
        delete from seguridad.perfiles_roles where perfil_id = p_perfil and rol_id <> all(p_roles);
    end if;

    if p_todas is not null then
        update public.perfiles set todas_las_zonas = p_todas, updated_at = now() where id = p_perfil;
    end if;

    if p_zonas is not null then
        delete from public.perfiles_zonas where perfil_id = p_perfil and zona_id <> all(p_zonas);
        insert into public.perfiles_zonas (perfil_id, zona_id)
        select p_perfil, z from unnest(p_zonas) z on conflict do nothing;
    end if;
end;
$$;

grant execute on function public.fn_guardar_accesos_persona(uuid, smallint[], smallint, boolean, uuid[]) to authenticated;
