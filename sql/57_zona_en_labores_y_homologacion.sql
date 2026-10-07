-- =====================================================================
-- 57 · LA ZONA VIAJA CON LA LÍNEA DE LABOR
-- =====================================================================
--
-- `v_labores_control` traía `lote_temporada_id` pero no la ZONA de ese
-- lote. En la base no se notaba —la reja de la vista resuelve el eje
-- zonal con `fn_mis_lotes()`— pero en el navegador sí: `canExecuteAction`
-- no tenía con qué evaluar el eje zonal de una ESCRITURA fila por fila,
-- así que en una celda de alcance zonal la pantalla no recortaba y el
-- rechazo llegaba al pulsar Guardar. La base nunca concedió nada de más;
-- lo que fallaba era el aviso.
--
-- Con `zona_id` en la vista, los tres ejes se pueden evaluar en el
-- navegador igual que en Postgres, que es lo que la prueba de paridad
-- exige.
--
-- CÓMO SE AÑADE UNA COLUMNA A UNA VISTA QUE YA ESTÁ EN PRODUCCIÓN
--
-- `create or replace view` no deja insertar una columna a media lista:
-- sólo añadir al final. Y la definición de `v_labores_control_crudo` son
-- setenta columnas; volver a escribirlas a mano para colar una es la
-- forma más segura de perder otra por el camino.
--
-- Así que la vista se envuelve en sí misma: se lee su definición actual
-- con `pg_get_viewdef`, se mete entera como subconsulta y se le pega la
-- columna nueva al final. El texto viejo queda inlineado en el momento
-- del `replace`, así que no hay recursión. Y como la columna se añade al
-- final, nada de lo que ya apuntaba a esta vista cambia de sitio.
--
-- Idempotente: si `zona_id` ya está, no hace nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A · TELECOM ENTRA AL PATRÓN
--
-- La 56 dejó telecom fuera a propósito: sus tablas no cuelgan de ninguna
-- tabla padre con permiso propio, así que allí nunca hubo
-- estrangulamiento. Pero ahora sus pantallas van a esconder botones POR
-- FILA, y para eso la vista tiene que traer el dueño y regirse por su
-- propia casilla igual que las demás. Mismo bucle que la 56.
-- ---------------------------------------------------------------------

do $$
declare
    v record;
begin
    for v in
        select * from (values
            ('v_telecom_lineas',       'telecom'),
            ('v_telecom_equipos',      'telecom'),
            ('v_telecom_asignaciones', 'telecom'),
            ('v_telecom_alertas',      'telecom')
        ) as t(vista, pantalla)
    loop
        if exists (
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'interno' and c.relname = v.vista || '_crudo'
        ) then
            continue;   -- ya partida
        end if;

        if not exists (
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and c.relname = v.vista
        ) then
            raise notice 'No existe public.%; se omite.', v.vista;
            continue;
        end if;

        execute format('alter view public.%I rename to %I', v.vista, v.vista || '_crudo');
        execute format('alter view public.%I set schema interno', v.vista || '_crudo');
        execute format('alter view interno.%I set (security_invoker = off)', v.vista || '_crudo');

        execute format($sql$
            create view public.%I as
            select x.* from interno.%I x
            where (select public.fn_permitido_de(%L, 'ver'))
        $sql$, v.vista, v.vista || '_crudo', v.pantalla);

        execute format('grant select on public.%I to authenticated', v.vista);
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- B · El envoltorio, para las dos vistas a las que les falta un eje.
--
--   v_labores_control      le falta la ZONA  → la trae su lote
--   v_telecom_asignaciones le falta el DUEÑO → lo trae su tabla base
--
-- Las dos van por el mismo bucle y no por dos bloques escritos a mano,
-- por lo mismo que en la 56: dos envoltorios a mano acaban siendo dos
-- envoltorios distintos.
-- ---------------------------------------------------------------------

do $$
declare
    v record;
    v_def text;
begin
    for v in
        select * from (values
            ('v_labores_control', 'zona_id',
             'left join public.lotes_temporada lt on lt.id = c.lote_temporada_id',
             'lt.zona_id'),
            ('v_telecom_asignaciones', 'usuario_id',
             'left join public.telecom_asignaciones ta on ta.id = c.id',
             'ta.usuario_id')
        ) as t(vista, columna, union_, expresion)
    loop
        if not exists (
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'interno' and c.relname = v.vista || '_crudo'
        ) then
            raise notice 'No existe interno.%_crudo; se omite.', v.vista;
            continue;
        end if;

        if exists (
            select 1 from information_schema.columns
            where table_schema = 'interno'
              and table_name = v.vista || '_crudo'
              and column_name = v.columna
        ) then
            raise notice '%_crudo ya trae %; no se toca.', v.vista, v.columna;
            continue;
        end if;

        v_def := rtrim(btrim(pg_get_viewdef(('interno.' || v.vista || '_crudo')::regclass, true)), ';');

        -- La expuesta se tira primero: su lista de columnas se fijó
        -- cuando se creó, así que un `select x.*` viejo NO se entera de
        -- la columna nueva. Se vuelven a armar abajo.
        execute format('drop view if exists public.%I', v.vista);

        -- Un `left join` y no una subconsulta correlacionada: se
        -- resuelve con una tabla hash una vez, no una por fila. Es la
        -- misma lección de la 55.
        execute format(
            'create or replace view interno.%I as select c.*, %s as %I from (%s) c %s',
            v.vista || '_crudo', v.expresion, v.columna, v_def, v.union_);

        execute format('alter view interno.%I set (security_invoker = off)', v.vista || '_crudo');
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- C · Las vistas expuestas, con su reja.
--
-- Misma forma canónica de la 55/56. El eje zonal se resuelve con
-- `fn_mis_zonas()`, que existe desde la 41: un conjunto que Postgres
-- resuelve con una tabla hash UNA vez en vez de una función por fila.
-- Ahora mira la columna directamente en lugar de pasar por la lista de
-- lotes.
-- ---------------------------------------------------------------------

drop view if exists public.v_labores_control;

create view public.v_labores_control as
select x.*
from interno.v_labores_control_crudo x
where (select public.fn_permitido_de('labores', 'ver'))
  and case (select public.fn_mi_alcance('labores', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else x.usuario_id = (select auth.uid())
           or not (select public.fn_tiene_zonas())
           or x.zona_id in (select public.fn_mis_zonas())
  end;

grant select on public.v_labores_control to authenticated;

drop view if exists public.v_telecom_asignaciones;

create view public.v_telecom_asignaciones as
select x.*
from interno.v_telecom_asignaciones_crudo x
where (select public.fn_permitido_de('telecom', 'ver'))
  and case (select public.fn_mi_alcance('telecom', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      -- Telecom no cuelga de ninguna zona: no hay de qué agarrar el
      -- recorte zonal, así que ese eje no recorta. Es la misma regla que
      -- aplica `fn_verificar_permiso` cuando el atributo llega nulo.
      else true
  end;

grant select on public.v_telecom_asignaciones to authenticated;

-- =====================================================================
-- EL GUARDIÁN
-- =====================================================================

do $$
declare
    v_suelta text;
    v_abierta text;
    v_sin_reja text;
begin
    -- La columna tiene que haber llegado hasta la vista EXPUESTA, que es
    -- la única que el navegador consulta.
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'v_labores_control'
          and column_name = 'zona_id'
    ) then
        raise exception 'v_labores_control se quedó sin zona_id: el navegador no podrá evaluar el eje zonal.';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'v_telecom_asignaciones'
          and column_name = 'usuario_id'
    ) then
        raise exception 'v_telecom_asignaciones se quedó sin usuario_id: el navegador no podrá evaluar el eje propietario.';
    end if;

    -- Y lo de la 56 sigue en pie: ninguna cruda en `public`, nadie de
    -- fuera en `interno`, ninguna expuesta sin reja.
    select string_agg(c.relname, ', ') into v_suelta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.relname like '%\_crudo';
    if v_suelta is not null then
        raise exception 'Vistas crudas sueltas en public: %', v_suelta;
    end if;

    select string_agg(r.rolname, ', ') into v_abierta
    from unnest(array['authenticated','anon','public']) as r(rolname)
    where has_schema_privilege(r.rolname, 'interno', 'usage');
    if v_abierta is not null then
        raise exception 'Estos roles pueden entrar al esquema interno: %', v_abierta;
    end if;

    select string_agg(c.relname, ', ') into v_sin_reja
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and exists (
          select 1 from pg_class cr join pg_namespace nr on nr.oid = cr.relnamespace
          where nr.nspname = 'interno' and cr.relname = c.relname || '_crudo')
      and pg_get_viewdef(c.oid, true) !~ 'fn_permitido_de';
    if v_sin_reja is not null then
        raise exception 'Vistas sin reja de permiso: %', v_sin_reja;
    end if;
end $$;

do $$
declare
    v_faltan integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    if v_faltan > 0 then
        raise exception 'Quedaron % llaves sin casilla en la matriz.', v_faltan;
    end if;
end $$;

-- =====================================================================
-- D · TRES FUNCIONES SIN `search_path`
-- =====================================================================
-- Esto no venía en el encargo: lo encontró la suite de regresión al
-- reconstruirla.
--
-- `fn_audit_horometros`, `fn_mi_rol` y `fn_notificar_ticket` son
-- `security definer` —corren con los permisos de su dueño— y no fijaban
-- su `search_path`. Es el agujero clásico de PostgreSQL: quien pueda
-- crear un esquema y ponerlo delante en su `search_path` consigue que
-- una tabla o una función SUYA se resuelva antes que la de `public`, y
-- el cuerpo de la función la ejecuta con los permisos del dueño.
--
-- `fn_mi_rol` es la más delicada de las tres: de ella cuelga media
-- cadena de permisos.
--
-- Son de migraciones viejas y el refactor de la 53-57 no las tocó; se
-- arreglan aquí porque es donde se encontraron. No cambia nada de lo que
-- hacen: sólo les fija el esquema desde el que resuelven los nombres.
-- =====================================================================

do $$
declare
    v record;
begin
    for v in
        select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and not exists (
              select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
              where c like 'search_path=%')
    loop
        execute format(
            'alter function public.%I(%s) set search_path = public, pg_temp',
            v.proname, v.args);
        raise notice 'search_path fijado en %(%)', v.proname, v.args;
    end loop;
end $$;

do $$
declare
    v_sueltas text;
begin
    select string_agg(p.proname, ', ') into v_sueltas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                       where c like 'search_path=%');

    if v_sueltas is not null then
        raise exception
            'Estas funciones security definer se quedaron sin search_path: %', v_sueltas;
    end if;
end $$;
