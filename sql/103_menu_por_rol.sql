-- =====================================================================
-- 103 · DISEÑADOR DE MENÚ POR ROL
-- =====================================================================
-- Pedido del usuario (2026-11-12): «quiero tener la opción de diseñador de menú que tengo en AGL, quiero algo
-- parecido en agronotificaciones pero por roles, ya que agronotificaciones pasará a ser una plataforma
-- multifunciones».
--
-- Qué hace:
--   - seguridad.menu_rol: el menú que el administrador arma para un rol (grupos, pantallas, orden, etiqueta e
--     ícono propios, pantalla de inicio). Una fila por rol; SIN fila = el menú de siempre (nada cambia).
--   - Acción nueva «disenar_menu» en la pantalla Permisos. La tienen solo los roles con acceso total (la regla de
--     acceso total ya concede toda acción de toda pantalla); a otro rol se la da quien edita la matriz.
--   - Funciones: fn_mi_menu (lo que lee el armazón), fn_menus_roles / fn_guardar_menu_rol / fn_copiar_menu_rol /
--     fn_restablecer_menu_rol / fn_menu_permisos_rol (las usa la pantalla Administración › Menú por rol).
--   - fn_copiar_rol (92) también copia el menú.
--
-- Reglas que no se negocian:
--   1. El menú NUNCA da acceso: solo ordena y nombra. Lo que se ve lo siguen decidiendo los permisos (la app filtra
--      cada entrada con fn_mis_permisos, y cada pantalla revisa el suyo).
--   2. Sin menú diseñado, el menú de cada persona es EXACTAMENTE el de antes (pruebas/sql/103_menu_por_rol.sql).
--   3. La tabla va en el esquema `seguridad` (lección de la 92: una tabla en `public` con llaves a roles puede
--      volver ambiguos los embebidos de PostgREST y dejar a todos sin entrar). Solo se toca por funciones.
--
-- Idempotente. Todo UPDATE/DELETE lleva WHERE (Supabase rechaza los que no). Correr DESPUÉS de la 101.
-- =====================================================================

create schema if not exists seguridad;

-- ---------------------------------------------------------------------
-- 1 · La tabla
-- ---------------------------------------------------------------------
create table if not exists seguridad.menu_rol (
    rol_id          smallint primary key references public.roles(id) on delete cascade,
    -- [{tipo:'grupo', etiqueta, icono?, hijos:[{tipo:'pantalla', destino, etiqueta?, icono?}]},
    --  {tipo:'pantalla', destino, etiqueta?, icono?}]   (destino = clave del catálogo de destinos de la app)
    nodos           jsonb not null default '[]'::jsonb,
    -- Destino que se abre al entrar (si la persona lo puede ver); null = la portada de siempre
    inicio          text,
    -- Lo que la persona puede abrir y el diseño no puso sale al final en «Otros» (por omisión, sí: nada se pierde)
    incluir_resto   boolean not null default true,
    actualizado_en  timestamptz not null default now(),
    actualizado_por uuid,
    constraint menu_rol_nodos_lista check (jsonb_typeof(nodos) = 'array')
);

comment on table seguridad.menu_rol is
    'Menú diseñado por rol (103). Sin fila = el menú de siempre. Solo ordena y nombra: nunca concede acceso.';

alter table seguridad.menu_rol enable row level security;
revoke all on seguridad.menu_rol from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on seguridad.menu_rol from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute 'revoke all on seguridad.menu_rol from authenticated';
    end if;
end $$;

-- Historial de accesos (93): quién cambió el menú de qué rol
drop trigger if exists trg_anotar_acceso on seguridad.menu_rol;
create trigger trg_anotar_acceso
    after insert or update or delete on seguridad.menu_rol
    for each row execute function seguridad.fn_anotar_acceso();

-- ---------------------------------------------------------------------
-- 2 · La acción «Diseñar menú» (pantalla Permisos)
-- ---------------------------------------------------------------------
insert into public.acciones (codigo, nombre, descripcion, orden, escribe, nivel) values
    ('disenar_menu', 'Diseñar menú',
     'Permisos: arma el menú de cada rol (grupos, orden, nombres, íconos y pantalla de inicio). El menú no da acceso: solo ordena lo que cada quien ya puede abrir.',
     125, true, 4)
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden,
    escribe = excluded.escribe, nivel = excluded.nivel;

update public.pantallas
   set acciones = array_append(acciones, 'disenar_menu')
 where codigo = 'permisos'
   and not (acciones @> array['disenar_menu']);

-- ---------------------------------------------------------------------
-- 3 · Validar y normalizar un menú (lo usa el guardado)
-- ---------------------------------------------------------------------
create or replace function public._menu_validar(p_nodos jsonb, p_inicio text)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp as $$
declare
    v_salida   jsonb := '[]'::jsonb;
    v_nodo     jsonb;
    v_hijo     jsonb;
    v_hijos    jsonb;
    v_destinos text[] := array[]::text[];
    v_grupos   text[] := array[]::text[];
    v_etq      text;
    v_ico      text;
    v_dest     text;
begin
    if p_nodos is null or jsonb_typeof(p_nodos) <> 'array' then
        raise exception 'El menú debe ser una lista.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_nodos) = 0 then
        raise exception 'Un menú vacío dejaría al rol sin menú. Para volver al de siempre usa «Restablecer».'
            using errcode = '22023';
    end if;
    if jsonb_array_length(p_nodos) > 60 then
        raise exception 'El menú tiene demasiadas entradas (máximo 60).' using errcode = '22023';
    end if;

    for v_nodo in select value from jsonb_array_elements(p_nodos) loop
        if jsonb_typeof(v_nodo) <> 'object' then
            raise exception 'Cada entrada del menú debe ser un objeto.' using errcode = '22023';
        end if;
        v_etq := nullif(btrim(v_nodo->>'etiqueta'), '');
        v_ico := nullif(btrim(v_nodo->>'icono'), '');
        if v_etq is not null and length(v_etq) > 40 then
            raise exception 'La etiqueta «%» es muy larga (máximo 40 letras).', left(v_etq, 40) using errcode = '22023';
        end if;
        if v_ico is not null and v_ico !~ '^[a-z0-9_]{1,30}$' then
            raise exception 'Ícono no válido: «%».', v_ico using errcode = '22023';
        end if;

        if v_nodo->>'tipo' = 'grupo' then
            if v_etq is null then
                raise exception 'Cada grupo necesita un nombre.' using errcode = '22023';
            end if;
            if lower(v_etq) = any (v_grupos) then
                raise exception 'Hay dos grupos llamados «%».', v_etq using errcode = '22023';
            end if;
            v_grupos := v_grupos || lower(v_etq);
            if jsonb_typeof(coalesce(v_nodo->'hijos', 'null'::jsonb)) <> 'array' then
                raise exception 'El grupo «%» no trae su lista de pantallas.', v_etq using errcode = '22023';
            end if;
            if jsonb_array_length(v_nodo->'hijos') > 40 then
                raise exception 'El grupo «%» tiene demasiadas pantallas (máximo 40).', v_etq using errcode = '22023';
            end if;
            v_hijos := '[]'::jsonb;
            for v_hijo in select value from jsonb_array_elements(v_nodo->'hijos') loop
                if jsonb_typeof(v_hijo) <> 'object' or coalesce(v_hijo->>'tipo', 'pantalla') <> 'pantalla' then
                    raise exception 'Dentro del grupo «%» solo van pantallas (no grupos dentro de grupos).', v_etq
                        using errcode = '22023';
                end if;
                v_dest := btrim(coalesce(v_hijo->>'destino', ''));
                if v_dest !~ '^[a-z0-9_]{1,60}$' then
                    raise exception 'Pantalla no válida: «%».', v_dest using errcode = '22023';
                end if;
                if v_dest = any (v_destinos) then
                    raise exception 'La pantalla «%» está dos veces en el menú.', v_dest using errcode = '22023';
                end if;
                v_destinos := v_destinos || v_dest;
                if length(coalesce(btrim(v_hijo->>'etiqueta'), '')) > 40 then
                    raise exception 'La etiqueta «%» es muy larga (máximo 40 letras).', left(btrim(v_hijo->>'etiqueta'), 40)
                        using errcode = '22023';
                end if;
                if nullif(btrim(v_hijo->>'icono'), '') is not null and btrim(v_hijo->>'icono') !~ '^[a-z0-9_]{1,30}$' then
                    raise exception 'Ícono no válido: «%».', v_hijo->>'icono' using errcode = '22023';
                end if;
                v_hijos := v_hijos || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                    'tipo', 'pantalla', 'destino', v_dest,
                    'etiqueta', nullif(btrim(v_hijo->>'etiqueta'), ''),
                    'icono', nullif(btrim(v_hijo->>'icono'), ''))));
            end loop;
            v_salida := v_salida || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                'tipo', 'grupo', 'etiqueta', v_etq, 'icono', v_ico)) || jsonb_build_object('hijos', v_hijos));

        elsif coalesce(v_nodo->>'tipo', 'pantalla') = 'pantalla' then
            v_dest := btrim(coalesce(v_nodo->>'destino', ''));
            if v_dest !~ '^[a-z0-9_]{1,60}$' then
                raise exception 'Pantalla no válida: «%».', v_dest using errcode = '22023';
            end if;
            if v_dest = any (v_destinos) then
                raise exception 'La pantalla «%» está dos veces en el menú.', v_dest using errcode = '22023';
            end if;
            v_destinos := v_destinos || v_dest;
            v_salida := v_salida || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                'tipo', 'pantalla', 'destino', v_dest, 'etiqueta', v_etq, 'icono', v_ico)));
        else
            raise exception 'Tipo de entrada desconocido: «%».', v_nodo->>'tipo' using errcode = '22023';
        end if;
    end loop;

    if nullif(btrim(p_inicio), '') is not null and not (btrim(p_inicio) = any (v_destinos)) then
        raise exception 'La pantalla de inicio tiene que estar en el menú.' using errcode = '22023';
    end if;
    return v_salida;
end
$$;

revoke all on function public._menu_validar(jsonb, text) from public;

-- ---------------------------------------------------------------------
-- 4 · Lo que lee el armazón: los menús de MIS roles (principal primero)
-- ---------------------------------------------------------------------
-- Devuelve una fila por cada rol de la persona; `disenado = false` → ese rol usa el menú de siempre. Si NINGUNO
-- está diseñado, la app dibuja exactamente el menú de antes.
create or replace function public.fn_mi_menu()
returns table (rol_id smallint, principal boolean, disenado boolean, nodos jsonb, inicio text, incluir_resto boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
    select pr.rol_id,
           pr.rol_id = p.rol_id                        as principal,
           m.rol_id is not null                        as disenado,
           m.nodos,
           m.inicio,
           coalesce(m.incluir_resto, true)             as incluir_resto
    from public.perfiles p
    join seguridad.perfiles_roles pr on pr.perfil_id = p.id
    left join seguridad.menu_rol m on m.rol_id = pr.rol_id
    where p.id = (select auth.uid())
    order by (pr.rol_id = p.rol_id) desc, pr.rol_id
$$;

revoke all on function public.fn_mi_menu() from public;
grant execute on function public.fn_mi_menu() to authenticated;

-- ---------------------------------------------------------------------
-- 5 · Pantalla de administración
-- ---------------------------------------------------------------------
create or replace function public._menu_exigir_permiso()
returns void
language plpgsql stable security definer
set search_path = public, pg_temp as $$
begin
    if not public.fn_tiene_permiso('permisos', 'disenar_menu') then
        raise exception 'Tu rol no tiene «Diseñar menú» en la pantalla de Permisos.' using errcode = '42501';
    end if;
end
$$;

revoke all on function public._menu_exigir_permiso() from public;

/* Los menús diseñados (los roles sin fila usan el de siempre). */
create or replace function public.fn_menus_roles()
returns table (rol_id smallint, nodos jsonb, inicio text, incluir_resto boolean, actualizado_en timestamptz,
               actualizado_por text)
language plpgsql stable security definer
set search_path = public, pg_temp as $$
begin
    perform public._menu_exigir_permiso();
    return query
        select m.rol_id, m.nodos, m.inicio, m.incluir_resto, m.actualizado_en, p.nombre
        from seguridad.menu_rol m
        left join public.perfiles p on p.id = m.actualizado_por
        order by m.rol_id;
end
$$;

revoke all on function public.fn_menus_roles() from public;
grant execute on function public.fn_menus_roles() to authenticated;

/* Qué puede abrir un rol (para la vista previa «como lo ve el rol X»): las claves recurso:accion de ESE rol,
   con la misma regla de _permisos_efectivos (acceso total = todo; solo lectura = lo de leer). */
create or replace function public.fn_menu_permisos_rol(p_rol_id smallint)
returns table (recurso text, accion text)
language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
    v_rol public.roles%rowtype;
begin
    perform public._menu_exigir_permiso();
    select * into v_rol from public.roles where id = p_rol_id;
    if not found then
        raise exception 'Ese rol ya no existe.' using errcode = 'P0002';
    end if;
    if v_rol.acceso_total and not v_rol.solo_lectura then
        return query select pa.codigo, a.accion from public.pantallas pa cross join lateral unnest(pa.acciones) a(accion);
    elsif v_rol.solo_lectura then
        return query select pa.codigo, a.accion from public.pantallas pa cross join lateral unnest(pa.acciones) a(accion)
                     where public.fn_accion_de_lectura(a.accion);
    else
        return query select distinct pm.recurso, pm.accion
                     from public.permisos pm join public.pantallas pa on pa.codigo = pm.recurso
                     where pm.rol_id = p_rol_id and pm.permitido;
    end if;
end
$$;

revoke all on function public.fn_menu_permisos_rol(smallint) from public;
grant execute on function public.fn_menu_permisos_rol(smallint) to authenticated;

/* Guarda (reemplaza de una vez) el menú de un rol. */
create or replace function public.fn_guardar_menu_rol(
    p_rol_id        smallint,
    p_nodos         jsonb,
    p_inicio        text default null,
    p_incluir_resto boolean default true
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
    v_nodos jsonb;
begin
    perform public._menu_exigir_permiso();
    if not exists (select 1 from public.roles where id = p_rol_id) then
        raise exception 'Ese rol ya no existe.' using errcode = 'P0002';
    end if;
    v_nodos := public._menu_validar(p_nodos, p_inicio);

    insert into seguridad.menu_rol (rol_id, nodos, inicio, incluir_resto, actualizado_en, actualizado_por)
    values (p_rol_id, v_nodos, nullif(btrim(p_inicio), ''), coalesce(p_incluir_resto, true), now(), (select auth.uid()))
    on conflict (rol_id) do update
    set nodos = excluded.nodos, inicio = excluded.inicio, incluir_resto = excluded.incluir_resto,
        actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por;

    return jsonb_build_object('rol_id', p_rol_id, 'nodos', v_nodos, 'inicio', nullif(btrim(p_inicio), ''),
                              'incluir_resto', coalesce(p_incluir_resto, true));
end
$$;

revoke all on function public.fn_guardar_menu_rol(smallint, jsonb, text, boolean) from public;
grant execute on function public.fn_guardar_menu_rol(smallint, jsonb, text, boolean) to authenticated;

/* Vuelve un rol al menú de siempre. Devuelve si había algo que borrar. */
create or replace function public.fn_restablecer_menu_rol(p_rol_id smallint)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
    perform public._menu_exigir_permiso();
    delete from seguridad.menu_rol where rol_id = p_rol_id;
    return found;
end
$$;

revoke all on function public.fn_restablecer_menu_rol(smallint) from public;
grant execute on function public.fn_restablecer_menu_rol(smallint) to authenticated;

/* Copia el menú de un rol a otro. Si el de origen no tiene diseño, el destino vuelve al de siempre. */
create or replace function public.fn_copiar_menu_rol(p_origen smallint, p_destino smallint)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
    v_m seguridad.menu_rol%rowtype;
begin
    perform public._menu_exigir_permiso();
    if p_origen = p_destino then
        raise exception 'Elige un rol distinto para copiar.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.roles where id = p_origen) or not exists (select 1 from public.roles where id = p_destino) then
        raise exception 'Ese rol ya no existe.' using errcode = 'P0002';
    end if;

    select * into v_m from seguridad.menu_rol where rol_id = p_origen;
    if not found then
        delete from seguridad.menu_rol where rol_id = p_destino;
        return false;
    end if;

    insert into seguridad.menu_rol (rol_id, nodos, inicio, incluir_resto, actualizado_en, actualizado_por)
    values (p_destino, v_m.nodos, v_m.inicio, v_m.incluir_resto, now(), (select auth.uid()))
    on conflict (rol_id) do update
    set nodos = excluded.nodos, inicio = excluded.inicio, incluir_resto = excluded.incluir_resto,
        actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por;
    return true;
end
$$;

revoke all on function public.fn_copiar_menu_rol(smallint, smallint) from public;
grant execute on function public.fn_copiar_menu_rol(smallint, smallint) to authenticated;

-- ---------------------------------------------------------------------
-- 6 · fn_copiar_rol (92) también copia el menú
-- ---------------------------------------------------------------------
-- Se agrega una línea sobre la definición vigente (no se reescribe la función): si ya estaba, no hace nada.
do $$
declare
    v_def   text;
    v_viejo text := 'on conflict do nothing;
    return v_id;';
    v_nuevo text := 'on conflict do nothing;

    -- 103: y el mismo menú
    insert into seguridad.menu_rol (rol_id, nodos, inicio, incluir_resto, actualizado_en, actualizado_por)
    select v_id, m.nodos, m.inicio, m.incluir_resto, now(), (select auth.uid())
    from seguridad.menu_rol m where m.rol_id = p_origen
    on conflict (rol_id) do nothing;
    return v_id;';
begin
    select pg_get_functiondef('public.fn_copiar_rol(smallint, text)'::regprocedure) into v_def;
    v_def := replace(v_def, chr(13), '');
    if position('seguridad.menu_rol' in v_def) > 0 then
        return;   -- ya estaba
    end if;
    if position(v_viejo in v_def) = 0 then
        raise notice '103: fn_copiar_rol no tiene la forma esperada; no se le agregó la copia del menú.';
        return;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
end $$;
