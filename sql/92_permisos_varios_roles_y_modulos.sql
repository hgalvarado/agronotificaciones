-- =====================================================================
-- MIGRACIÓN 92 · Permisos v2: varios roles por persona, «Todas las zonas» explícito, módulos y niveles
-- =====================================================================
-- Pedido del usuario (2026-11-11): «mejoremos el sistema de permisos… será el cuello de botella de la
-- operación». Vienen más módulos (Fertirriego, combustible de motores y bombas, parámetros de campo),
-- jefes de zona que ven su zona, un gerente que ve todas las zonas y el Administrador que administra todo.
--
--   A · VARIOS ROLES POR PERSONA (perfiles_roles). Los permisos efectivos son la UNIÓN de sus roles:
--       una acción vale si algún rol la concede; el alcance es el más amplio (global > zonal > propietario)
--       y la condición la menos restrictiva. Acceso total si ALGUNO de sus roles lo tiene; Invitado (solo
--       lectura) solo si TODOS sus roles son de solo lectura. `perfiles.rol_id` queda como ROL PRINCIPAL
--       (barra del teléfono y compatibilidad) y siempre está dentro de sus roles.
--
--   B · «TODAS LAS ZONAS» EXPLÍCITO (perfiles.todas_las_zonas). Antes «sin zonas marcadas» quería decir
--       «ve todas»: olvidar marcar zonas abría todo. Ahora es una casilla. Para no cambiarle nada a nadie,
--       quien hoy no tiene zonas queda con «Todas» encendido. Sin «Todas» y sin zonas: no ve datos zonales.
--       Las vistas ESTRICTAS (Desinfección, Trasplante) no cambian: siguen mirando solo las zonas marcadas.
--
--   PRODUCCIÓN: nadie gana ni pierde nada al correrla. Probado con pruebas/sql/92_equivalencia.sql (foto de
--   permisos, zonas y banderas de cada persona antes y después: idénticas).
--
--   C · CATÁLOGO PARA LA PANTALLA NUEVA DE PERMISOS:
--       pantallas.modulo (agrupa: Operación, Planificación, Controles, Fertirriego, Costos, Catálogos,
--       Administración), pantallas.usa_condicion (solo tickets/horómetros/labores), pantallas.etiquetas_alcance
--       (cómo se nombra el alcance en ese módulo: en Fertirriego «propietario» = «Sus estaciones»),
--       acciones.nivel (1 Ver · 2 Operar · 3 Supervisar · 4 Administrar) para los niveles rápidos.
--       Un módulo nuevo solo declara esto y la pantalla de Permisos lo muestra solo.
--
--   D · FUNCIONES: guardar varios permisos de un golpe, copiar un rol, permisos efectivos de una persona.
--
-- Ningún nombre de rol en el código. Idempotente.
-- =====================================================================


-- =====================================================================
-- A · VARIOS ROLES POR PERSONA
-- =====================================================================

-- ¡OJO! La tabla vive en el esquema «seguridad», que la API de Supabase NO expone. Si estuviera en «public»,
-- la API vería dos caminos entre perfiles y roles (rol_id y esta tabla) y la consulta `perfiles?select=*,roles(*)`
-- —la que carga el perfil al entrar— fallaría por ambigüedad: NADIE podría entrar (pasó en desarrollo con la
-- primera versión de esta migración). Fuera de «public» no hay ambigüedad y el código viejo sigue igual.
-- Se lee y se escribe solo por funciones: fn_roles_de_perfiles() y fn_asignar_roles().
create schema if not exists seguridad;
revoke all on schema seguridad from public, anon, authenticated;

do $$
begin
    -- Primera versión de esta migración (solo corrió en desarrollo): la mueve, con sus datos
    if to_regclass('public.perfiles_roles') is not null and to_regclass('seguridad.perfiles_roles') is null then
        drop policy if exists perfiles_roles_leer on public.perfiles_roles;
        alter table public.perfiles_roles set schema seguridad;
    end if;
end $$;

create table if not exists seguridad.perfiles_roles (
    perfil_id  uuid not null references public.perfiles(id) on delete cascade,
    rol_id     smallint not null references public.roles(id),
    created_at timestamptz not null default now(),
    primary key (perfil_id, rol_id)
);

create index if not exists idx_perfiles_roles_rol on seguridad.perfiles_roles (rol_id);

-- Cada persona arranca con su rol de siempre
insert into seguridad.perfiles_roles (perfil_id, rol_id)
select id, rol_id from public.perfiles
on conflict do nothing;

/**
 * El rol principal siempre está entre sus roles. Cambiar el principal REEMPLAZA al anterior (igual que antes
 * de la 92, cuando cambiar el rol quitaba el viejo): así, cambiar `perfiles.rol_id` a mano en la base no deja
 * a nadie con los permisos de su rol anterior. La pantalla de Usuarios vuelve a agregar el viejo si se quiere
 * conservar como secundario.
 */
create or replace function public.fn_rol_principal_en_roles()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if tg_op = 'UPDATE' and old.rol_id is distinct from new.rol_id then
        delete from seguridad.perfiles_roles where perfil_id = new.id and rol_id = old.rol_id;
    end if;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values (new.id, new.rol_id)
    on conflict do nothing;
    return new;
end;
$$;

drop trigger if exists trg_rol_principal_en_roles on public.perfiles;
create trigger trg_rol_principal_en_roles
    after insert or update of rol_id on public.perfiles
    for each row execute function public.fn_rol_principal_en_roles();

/** No se puede quitar el rol principal de la lista: primero se cambia el principal. */
create or replace function public.fn_no_quitar_rol_principal()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if exists (select 1 from public.perfiles p where p.id = old.perfil_id and p.rol_id = old.rol_id) then
        raise exception 'No se puede quitar el rol principal de la persona. Cambia primero su rol principal.'
            using errcode = '23514';
    end if;
    return old;
end;
$$;

drop trigger if exists trg_no_quitar_rol_principal on seguridad.perfiles_roles;
create trigger trg_no_quitar_rol_principal
    before delete on seguridad.perfiles_roles
    for each row execute function public.fn_no_quitar_rol_principal();

alter table seguridad.perfiles_roles enable row level security;
revoke all on seguridad.perfiles_roles from public, anon, authenticated;
drop policy if exists perfiles_roles_leer on seguridad.perfiles_roles;

/** Los roles de todas las personas, para la pantalla de Usuarios. */
create or replace function public.fn_roles_de_perfiles()
returns table (perfil_id uuid, rol_id smallint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not ((select auth.role()) = 'service_role' or public.fn_es_admin() or public.fn_tiene_permiso('usuarios', 'ver')) then
        raise exception 'Tu rol no tiene «Ver» en Usuarios.' using errcode = '42501';
    end if;
    return query select pr.perfil_id, pr.rol_id from seguridad.perfiles_roles pr;
end;
$$;

revoke all on function public.fn_roles_de_perfiles() from public, anon;
grant execute on function public.fn_roles_de_perfiles() to authenticated, service_role;

/**
 * Deja exactamente esos roles a la persona, con su principal. Lo usa la API de Usuarios (que ya comprobó
 * «Editar» en Usuarios y que nadie se quite su propio acceso total).
 */
create or replace function public.fn_asignar_roles(p_perfil uuid, p_roles smallint[], p_principal smallint)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not ((select auth.role()) = 'service_role' or public.fn_es_admin() or public.fn_tiene_permiso('usuarios', 'editar')) then
        raise exception 'Tu rol no tiene «Editar» en Usuarios.' using errcode = '42501';
    end if;
    if p_roles is null or cardinality(p_roles) = 0 then
        raise exception 'Elige al menos un rol.';
    end if;
    if not (p_principal = any(p_roles)) then
        raise exception 'El rol principal tiene que estar entre sus roles.';
    end if;
    if (select count(*) from public.roles where id = any(p_roles)) <> cardinality(array(select distinct unnest(p_roles))) then
        raise exception 'Uno de los roles ya no existe. Recarga la página.';
    end if;

    update public.perfiles set rol_id = p_principal where id = p_perfil;   -- el trigger cambia el principal
    if not found then
        raise exception 'La persona no existe.';
    end if;
    insert into seguridad.perfiles_roles (perfil_id, rol_id)
    select p_perfil, r from unnest(p_roles) r
    on conflict do nothing;
    delete from seguridad.perfiles_roles where perfil_id = p_perfil and rol_id <> all(p_roles);
end;
$$;

revoke all on function public.fn_asignar_roles(uuid, smallint[], smallint) from public, anon;
grant execute on function public.fn_asignar_roles(uuid, smallint[], smallint) to authenticated, service_role;

-- ---------- Banderas: acceso total (alguno) · solo lectura (todos) ----------

create or replace function public.fn_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1
        from seguridad.perfiles_roles pr
        join public.roles r on r.id = pr.rol_id
        where pr.perfil_id = (select auth.uid())
          and r.acceso_total
    )
$$;

create or replace function public.fn_es_invitado() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
               select 1 from seguridad.perfiles_roles pr join public.roles r on r.id = pr.rol_id
               where pr.perfil_id = (select auth.uid()) and r.solo_lectura)
       and not exists (
               select 1 from seguridad.perfiles_roles pr join public.roles r on r.id = pr.rol_id
               where pr.perfil_id = (select auth.uid()) and not r.solo_lectura)
$$;

-- ---------- La regla que aplica: unión de los roles ----------

create or replace function public.fn_rango_alcance(p public.alcance_permiso)
returns smallint
language sql immutable as $$
    select case p when 'global' then 3 when 'zonal' then 2 else 1 end::smallint
$$;

create or replace function public.fn_permiso_de(p_pantalla text, p_accion text)
returns table (
    permitido boolean,
    alcance   public.alcance_permiso,
    condicion public.condicion_permiso
)
language sql stable security definer set search_path = public, pg_temp as $$
    with banderas as (
        select public.fn_es_invitado() as invitado, public.fn_es_admin() as admin
    ),
    concedidas as (
        select pm.alcance, pm.condicion
        from seguridad.perfiles_roles pr
        join public.permisos pm
          on pm.rol_id = pr.rol_id and pm.recurso = p_pantalla and pm.accion = p_accion
        where pr.perfil_id = (select auth.uid())
          and pm.permitido
    )
    select
        case
            when b.invitado then public.fn_accion_de_lectura(p_accion)
            when b.admin    then true
            else exists (select 1 from concedidas)
        end,
        -- Sin nada concedido: lo guardado en su rol PRINCIPAL, exactamente como antes de la 92
        case
            when b.invitado or b.admin then 'global'::public.alcance_permiso
            else coalesce((select c.alcance from concedidas c order by public.fn_rango_alcance(c.alcance) desc limit 1),
                          (select pm.alcance from public.perfiles pe join public.permisos pm
                             on pm.rol_id = pe.rol_id and pm.recurso = p_pantalla and pm.accion = p_accion
                           where pe.id = (select auth.uid())),
                          'propietario'::public.alcance_permiso)
        end,
        case
            when b.invitado or b.admin then 'sin_restriccion'::public.condicion_permiso
            else coalesce((select c.condicion from concedidas c
                           order by (c.condicion = 'sin_restriccion') desc limit 1),
                          (select pm.condicion from public.perfiles pe join public.permisos pm
                             on pm.rol_id = pe.rol_id and pm.recurso = p_pantalla and pm.accion = p_accion
                           where pe.id = (select auth.uid())),
                          'sin_restriccion'::public.condicion_permiso)
        end
    from banderas b
$$;

grant execute on function public.fn_permiso_de(text, text) to authenticated;

/** Permisos efectivos de UNA persona (unión de sus roles). Base de fn_mis_permisos y de la ficha. */
create or replace function public._permisos_efectivos(p_perfil uuid)
returns table (recurso text, accion text, alcance text, condicion text, roles text[])
language sql stable security definer set search_path = public, pg_temp as $$
    with banderas as (
        select
            exists (select 1 from seguridad.perfiles_roles pr join public.roles r on r.id = pr.rol_id
                    where pr.perfil_id = p_perfil and r.acceso_total) as admin,
            exists (select 1 from seguridad.perfiles_roles pr join public.roles r on r.id = pr.rol_id
                    where pr.perfil_id = p_perfil and r.solo_lectura)
            and not exists (select 1 from seguridad.perfiles_roles pr join public.roles r on r.id = pr.rol_id
                            where pr.perfil_id = p_perfil and not r.solo_lectura) as invitado
    ),
    bandera_roles as (
        select array_agg(r.nombre order by r.nombre) as nombres
        from seguridad.perfiles_roles pr join public.roles r on r.id = pr.rol_id
        where pr.perfil_id = p_perfil and (r.acceso_total or r.solo_lectura)
    )
    -- Acceso total: todo
    select p.codigo, a.accion, 'global', 'sin_restriccion', (select nombres from bandera_roles)
    from public.pantallas p cross join lateral unnest(p.acciones) as a(accion), banderas b
    where b.admin and not b.invitado

    union all

    -- Solo lectura: lo de leer
    select p.codigo, a.accion, 'global', 'sin_restriccion', (select nombres from bandera_roles)
    from public.pantallas p cross join lateral unnest(p.acciones) as a(accion), banderas b
    where b.invitado and public.fn_accion_de_lectura(a.accion)

    union all

    -- Matriz: la unión de sus roles
    select pm.recurso, pm.accion,
           (array_agg(pm.alcance::text order by public.fn_rango_alcance(pm.alcance) desc))[1],
           (array_agg(pm.condicion::text order by (pm.condicion = 'sin_restriccion') desc))[1],
           array_agg(distinct r.nombre)
    from seguridad.perfiles_roles pr
    join public.roles r on r.id = pr.rol_id
    join public.permisos pm on pm.rol_id = pr.rol_id
    join public.pantallas pa on pa.codigo = pm.recurso   -- igual que antes de la 92: no se filtran acciones
    cross join banderas b
    where pr.perfil_id = p_perfil
      and pm.permitido
      and not b.admin and not b.invitado
    group by pm.recurso, pm.accion
$$;

revoke all on function public._permisos_efectivos(uuid) from public, anon, authenticated;

drop function if exists public.fn_mis_permisos();
create function public.fn_mis_permisos()
returns table (recurso text, accion text, alcance text, condicion text)
language sql stable security definer set search_path = public, pg_temp as $$
    select e.recurso, e.accion, e.alcance, e.condicion
    from public._permisos_efectivos((select auth.uid())) e
$$;

grant execute on function public.fn_mis_permisos() to authenticated;

/** Lo que puede hacer una persona y qué rol se lo da. Para la ficha de Usuarios. */
create or replace function public.fn_permisos_de_perfil(p_perfil uuid)
returns table (recurso text, accion text, alcance text, condicion text, roles text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not (public.fn_es_admin() or public.fn_tiene_permiso('usuarios', 'ver')) then
        raise exception 'Tu rol no tiene «Ver» en Usuarios.' using errcode = '42501';
    end if;
    return query select * from public._permisos_efectivos(p_perfil);
end;
$$;

grant execute on function public.fn_permisos_de_perfil(uuid) to authenticated;

-- ---------- Eliminar rol: nadie debe tenerlo (en ninguno de sus roles) ----------

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
    if v_rol.de_sistema then
        raise exception 'El rol «%» es de fábrica y no se puede eliminar.', v_rol.nombre using errcode = '2BP01';
    end if;

    select count(distinct perfil_id) into v_cuantos from seguridad.perfiles_roles where rol_id = p_rol_id;
    if v_cuantos > 0 then
        raise exception 'El rol «%» lo tienen % persona(s). Quítaselo antes de eliminarlo.', v_rol.nombre, v_cuantos
            using errcode = '2BP01';
    end if;

    delete from public.permisos where rol_id = p_rol_id;
    delete from public.navegacion_rol where rol_id = p_rol_id;
    delete from public.roles where id = p_rol_id;
end
$$;


-- =====================================================================
-- B · «TODAS LAS ZONAS» EXPLÍCITO
-- =====================================================================

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'perfiles' and column_name = 'todas_las_zonas') then
        alter table public.perfiles add column todas_las_zonas boolean not null default false;
        -- Quien hoy no tiene zonas veía todas: se le conserva tal cual
        update public.perfiles p set todas_las_zonas = true
        where not exists (select 1 from public.perfiles_zonas pz where pz.perfil_id = p.id);
    end if;
end $$;

comment on column public.perfiles.todas_las_zonas is
'Ve todas las zonas (gerentes, Torre de Control). Apagado: solo las zonas marcadas en perfiles_zonas; sin ninguna, no ve datos zonales.';

/** ¿Tiene recorte de zonas? Ahora lo decide la casilla, no la lista vacía. */
create or replace function public.fn_tiene_zonas()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select not public.fn_es_admin()
       and not coalesce((select p.todas_las_zonas from public.perfiles p where p.id = (select auth.uid())), false)
$$;

-- Las vistas ESTRICTAS (66: Desinfección, Trasplante…) NO cambian: solo las zonas marcadas. Hoy, quien tiene
-- alcance zonal y ninguna zona no ve nada ahí; encenderle «Todas» con la migración no puede abrírselas.
-- (Se reescriben con su definición original por si una versión previa de esta migración las tocó.)
create or replace function public.fn_ve_zona_estricta(p_zona_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.perfiles_zonas pz
        where pz.perfil_id = (select auth.uid())
          and pz.zona_id = p_zona_id
    )
$$;

create or replace function public.fn_ve_lote_estricto(p_lote_temporada_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1
        from public.lotes_temporada lt
        join public.perfiles_zonas pz on pz.zona_id = lt.zona_id
        where lt.id = p_lote_temporada_id
          and pz.perfil_id = (select auth.uid())
    )
$$;

-- Fertirriego (nuevo, sin usuarios en producción): «Sus zonas» sí respeta «Todas las zonas». Solo si la 91
-- ya está (en producción la 92 puede correr antes que la 91).
do $$
begin
    if to_regclass('public.perfiles_estaciones') is not null then
        execute $f$
        create or replace function public.fn_fert_puede(p_estacion uuid, p_accion text default 'ver')
        returns boolean
        language sql stable security definer set search_path = public, pg_temp as $b$
            select case
                when public.fn_es_admin() then true
                when not public.fn_tiene_permiso('fertirriego', p_accion) then false
                else case public.fn_mi_alcance('fertirriego', p_accion)
                    when 'global' then true
                    when 'zonal' then
                        exists (select 1 from public.estaciones_riego e
                                where e.id = p_estacion and e.zona_id is not null
                                  and (public.fn_ve_zona_estricta(e.zona_id)
                                       or coalesce((select p.todas_las_zonas from public.perfiles p
                                                    where p.id = (select auth.uid())), false)))
                        or exists (select 1 from public.perfiles_estaciones pe
                                   where pe.estacion_id = p_estacion and pe.perfil_id = (select auth.uid()))
                    else
                        exists (select 1 from public.perfiles_estaciones pe
                                where pe.estacion_id = p_estacion and pe.perfil_id = (select auth.uid()))
                end
            end
        $b$
        $f$;
    end if;
end $$;


-- =====================================================================
-- C · CATÁLOGO: MÓDULOS, NIVELES, CONDICIÓN Y NOMBRES DEL ALCANCE
-- =====================================================================

alter table public.acciones add column if not exists nivel smallint not null default 2
    check (nivel between 1 and 4);
comment on column public.acciones.nivel is
'Nivel rápido en Permisos: 1 Ver · 2 Operar · 3 Supervisar · 4 Administrar. «Operar» enciende hasta el 2, etc.';

update public.acciones set nivel = case codigo
    when 'ver' then 1 when 'exportar' then 1 when 'descargar' then 1
    when 'crear' then 2 when 'editar' then 2 when 'importar' then 2
    when 'recibir' then 2 when 'aplicar' then 2 when 'contar' then 2 when 'relevo' then 2
    when 'trasladar' then 2 when 'publicar' then 2
    when 'eliminar' then 3 when 'aprobar' then 3 when 'notificar' then 3 when 'mover_proceso' then 3
    when 'anular' then 3 when 'en_nombre_de' then 3 when 'autorizar_traslado' then 3
    when 'gestionar_choferes' then 3
    when 'eliminar_con_contenido' then 4 when 'administrar_estaciones' then 4 when 'configurar' then 4
    else nivel end;

alter table public.pantallas
    add column if not exists modulo text,
    add column if not exists usa_condicion boolean not null default false,
    add column if not exists etiquetas_alcance jsonb;

comment on column public.pantallas.modulo is 'Agrupa las pantallas en la matriz de Permisos.';
comment on column public.pantallas.usa_condicion is 'La condición «solo mientras se registra» tiene sentido aquí.';
comment on column public.pantallas.etiquetas_alcance is
'Cómo se llama cada alcance en este módulo, p. ej. {"propietario": "Sus estaciones"}. Sin valor: los nombres de siempre.';

update public.pantallas set modulo = case
    when codigo in ('tickets', 'horometros', 'labores', 'avance') then 'Operación'
    when codigo in ('plan', 'plan_aps', 'trasplante_plan', 'trasplante_diario', 'turnos_riego', 'rotacion') then 'Planificación'
    when codigo like 'desinfeccion%' then 'Controles'
    when codigo like 'fertirriego%' then 'Fertirriego'
    when codigo in ('costos', 'tarifas') then 'Costos'
    when codigo like 'catalogo_%' or codigo in ('lotes', 'historico') then 'Catálogos'
    when codigo in ('usuarios', 'permisos', 'reporte_publico') then 'Administración'
    else coalesce(modulo, 'Otros') end
where modulo is null;

update public.pantallas set usa_condicion = true where codigo in ('tickets', 'horometros', 'labores');

update public.pantallas
   set etiquetas_alcance = '{"global": "Todas las estaciones", "zonal": "Estaciones de sus zonas", "propietario": "Sus estaciones"}'::jsonb
 where codigo = 'fertirriego' and etiquetas_alcance is null;


-- =====================================================================
-- D · FUNCIONES PARA LA PANTALLA DE PERMISOS
-- =====================================================================

/**
 * Varios cambios de un rol en una sola llamada (niveles rápidos, alcance de un módulo).
 * p_cambios = [{recurso, accion, permitido, alcance, condicion}]. Cada uno con las reglas de fn_guardar_permiso
 * (cascada de «Ver», validación de la acción). Todo o nada.
 */
create or replace function public.fn_guardar_permisos_rol(p_rol_id smallint, p_cambios jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    c jsonb;
    n integer := 0;
begin
    if p_cambios is null or jsonb_typeof(p_cambios) <> 'array' then
        raise exception 'Se esperaba una lista de cambios.';
    end if;
    -- Primero los que encienden, al final los «Ver» que apagan (la cascada de apagar va de último)
    for c in
        select value from jsonb_array_elements(p_cambios)
        order by (value->>'accion' = 'ver' and not coalesce((value->>'permitido')::boolean, false)), 1
    loop
        perform public.fn_guardar_permiso(
            p_rol_id, c->>'recurso', c->>'accion', coalesce((c->>'permitido')::boolean, false),
            coalesce(c->>'alcance', 'global'), coalesce(c->>'condicion', 'sin_restriccion'));
        n := n + 1;
    end loop;
    return n;
end;
$$;

grant execute on function public.fn_guardar_permisos_rol(smallint, jsonb) to authenticated;

/** Rol nuevo con los mismos permisos y la misma barra del teléfono que otro. */
create or replace function public.fn_copiar_rol(p_origen smallint, p_nombre text)
returns smallint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id smallint;
begin
    if not exists (select 1 from public.roles where id = p_origen) then
        raise exception 'El rol a copiar ya no existe.';
    end if;
    v_id := public.fn_crear_rol(p_nombre, null, null);   -- valida permiso y nombre

    insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
    select v_id, recurso, accion, permitido, alcance, condicion
    from public.permisos where rol_id = p_origen;

    insert into public.navegacion_rol (rol_id, pantalla, orden)
    select v_id, pantalla, orden from public.navegacion_rol where rol_id = p_origen
    on conflict do nothing;
    return v_id;
end;
$$;

grant execute on function public.fn_copiar_rol(smallint, text) to authenticated;
