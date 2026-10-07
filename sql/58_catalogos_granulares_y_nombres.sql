-- =====================================================================
-- 58 · CATÁLOGOS POR BLOQUE, PANTALLAS FANTASMA Y NOMBRES EN LAS VISTAS
-- =====================================================================
-- Tres cosas, y las tres son de granularidad o de que el dato llegue
-- legible a la pantalla:
--
--   A · Dos pantallas fantasma. «Plan de siembra» y «Plan de cosecha»
--       son módulos que ya no existen y seguían ocupando dos filas en la
--       matriz de Permisos. Una casilla que no gobierna nada es peor que
--       ninguna: alguien la marca creyendo que concede algo.
--
--   B · «Catálogos» era UNA casilla para todos los datos maestros. Quien
--       podía tocar los equipos podía tocar también las tareas SAP y los
--       proveedores. Se parte en cinco, una por bloque, y cada tabla de
--       catálogo pasa a regirse por la suya.
--
--   C · Las vistas devolvían identificadores donde la pantalla necesita
--       nombres. Desde la 56 las vistas son `definer` y se saltan el RLS
--       de los catálogos, así que pueden resolver el nombre AHÍ y el
--       navegador ya no tiene que descargarse el catálogo entero sólo
--       para pintar una columna —ni enseñar «—» cuando no puede.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · LAS DOS PANTALLAS FANTASMA
-- =====================================================================

do $$
declare
    v_borradas integer;
begin
    delete from public.permisos where recurso in ('plan_lev', 'plan_cos');
    get diagnostics v_borradas = row_count;

    delete from public.pantallas where codigo in ('plan_lev', 'plan_cos');

    -- La navegación también las nombraba.
    delete from public.navegacion_rol where pantalla in ('plan_lev', 'plan_cos');

    raise notice 'Pantallas fantasma fuera (% permisos sueltos borrados).', v_borradas;
exception
    when undefined_table then
        -- `navegacion_rol` llega con la 39; si no está, lo demás ya se hizo.
        raise notice 'Pantallas fantasma fuera (sin tabla de navegación).';
end $$;

-- =====================================================================
-- B · CATÁLOGOS, UNO POR BLOQUE
-- =====================================================================
-- Los cinco bloques son los mismos que la pantalla ya usaba para
-- agrupar: equipos, labores, cultivo, SAP y organización. No se inventa
-- una taxonomía nueva — quien entra a Catálogos ya los ve así.

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('catalogo_equipos', 'Catálogos · Equipos',
     'Equipos, familias, implementos, puestos de trabajo y contadores.',
     '/admin/catalogos', 81,
     array['ver','crear','editar','eliminar','exportar','importar']),
    ('catalogo_labores', 'Catálogos · Labores',
     'Labores con sus tareas e implementos, categorías y operadores.',
     '/admin/catalogos', 82,
     array['ver','crear','editar','eliminar','exportar','importar']),
    ('catalogo_cultivos', 'Catálogos · Campo y cultivo',
     'Zonas, productos, variedades, materiales, planes de nutrición, turnos y estaciones.',
     '/admin/catalogos', 83,
     array['ver','crear','editar','eliminar','exportar','importar']),
    ('catalogo_sap', 'Catálogos · SAP',
     'Tareas y procesos con los que se notifica a SAP.',
     '/admin/catalogos', 84,
     array['ver','crear','editar','eliminar','exportar','importar']),
    ('catalogo_organizacion', 'Catálogos · Organización',
     'Departamentos, proveedores y temporadas.',
     '/admin/catalogos', 85,
     array['ver','crear','editar','eliminar','exportar','importar'])
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta = excluded.ruta,
    orden = excluded.orden,
    acciones = excluded.acciones;

/**
 * Lo que cada rol tenía en «Catálogos» se hereda a los cinco.
 *
 * Partir un permiso en cinco sin heredar es quitárselo a todo el mundo y
 * obligar al Administrador a volver a marcar cinco casillas por rol el
 * lunes por la mañana. Se copian los tres ejes tal cual: el día de la
 * migración nadie cambia de acceso, y a partir de ahí se puede afinar.
 */
do $$
declare
    v_nueva text;
begin
    if not exists (select 1 from public.permisos where recurso = 'catalogos') then
        raise notice 'No había permisos de «catalogos» que heredar.';
    else
        foreach v_nueva in array array['catalogo_equipos','catalogo_labores',
                                       'catalogo_cultivos','catalogo_sap',
                                       'catalogo_organizacion']
        loop
            insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
            select pm.rol_id, v_nueva, pm.accion, pm.permitido, pm.alcance, pm.condicion
            from public.permisos pm
            where pm.recurso = 'catalogos'
              and exists (select 1 from public.pantallas pa
                          where pa.codigo = v_nueva and pa.acciones @> array[pm.accion])
            on conflict (rol_id, recurso, accion) do nothing;
        end loop;
    end if;

    delete from public.permisos where recurso = 'catalogos';
    delete from public.pantallas where codigo = 'catalogos';
end $$;

-- ---------------------------------------------------------------------
-- Y cada tabla de catálogo pasa a regirse por SU bloque.
--
-- Las policies no se vuelven a escribir a mano: se lee la expresión que
-- ya tienen y se le cambia el nombre de la pantalla. Veintiuna tablas
-- reescritas a mano son veintiuna oportunidades de colar un matiz
-- distinto, y la que quede mal abre o cierra una tabla sin que nadie lo
-- note hasta que alguien se queja.
-- ---------------------------------------------------------------------

do $$
declare
    v_tabla   record;
    v_policy  record;
    v_qual    text;
    v_check   text;
    v_cmd     text;
begin
    for v_tabla in
        select * from (values
            ('equipos',                     'catalogo_equipos'),
            ('familias_equipo',             'catalogo_equipos'),
            ('implementos',                 'catalogo_equipos'),
            ('implementos_fisicos',         'catalogo_equipos'),
            ('puestos_trabajo',             'catalogo_equipos'),
            ('contadores_equipo',           'catalogo_equipos'),

            ('labores',                     'catalogo_labores'),
            ('labores_tareas',              'catalogo_labores'),
            ('labores_implementos',         'catalogo_labores'),
            ('labores_implementos_fisicos', 'catalogo_labores'),
            ('operadores',                  'catalogo_labores'),

            ('zonas',                       'catalogo_cultivos'),
            ('catalogo_productos',          'catalogo_cultivos'),
            ('variedades',                  'catalogo_cultivos'),
            ('materiales',                  'catalogo_cultivos'),
            ('planes_nutricionales',        'catalogo_cultivos'),
            ('turnos',                      'catalogo_cultivos'),
            ('estaciones_riego',            'catalogo_cultivos'),

            ('procesos_sap',                'catalogo_sap'),
            ('tareas_sap',                  'catalogo_sap'),

            ('departamentos',               'catalogo_organizacion'),
            ('proveedores',                 'catalogo_organizacion')
        ) as t(tabla, pantalla)
    loop
        for v_policy in
            select policyname, cmd, qual, with_check, roles
            from pg_policies
            where schemaname = 'public'
              and tablename = v_tabla.tabla
              and (coalesce(qual,'') || coalesce(with_check,'')) like '%catalogos%'
        loop
            v_qual  := replace(coalesce(v_policy.qual, ''),       '''catalogos''', '''' || v_tabla.pantalla || '''');
            v_check := replace(coalesce(v_policy.with_check, ''), '''catalogos''', '''' || v_tabla.pantalla || '''');
            v_cmd   := case v_policy.cmd
                           when 'ALL' then 'all' when 'SELECT' then 'select'
                           when 'INSERT' then 'insert' when 'UPDATE' then 'update'
                           else 'delete' end;

            execute format('drop policy if exists %I on public.%I',
                           v_policy.policyname, v_tabla.tabla);

            execute format('create policy %I on public.%I for %s to %s %s %s',
                v_policy.policyname,
                v_tabla.tabla,
                v_cmd,
                array_to_string(v_policy.roles, ', '),
                case when v_qual  <> '' then 'using (' || v_qual || ')'      else '' end,
                case when v_check <> '' then 'with check (' || v_check || ')' else '' end);
        end loop;
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- Y las FUNCIONES que también preguntaban por la casilla global.
--
-- El guardián de la 44 las encuentra leyendo el código fuente: una
-- función que exige `catalogos:crear` después de que esa casilla deje de
-- existir pide un permiso que nadie puede conceder, y lo que protege
-- queda cerrado para siempre sin que ningún error lo diga.
-- ---------------------------------------------------------------------

do $$
declare
    v record;
    v_src text;
begin
    for v in
        select * from (values
            ('fn_cambiar_contador', 'catalogo_equipos')
        ) as t(funcion, pantalla)
    loop
        for v_src in
            select pg_get_functiondef(p.oid)
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = v.funcion
        loop
            execute replace(v_src, '''catalogos''', '''' || v.pantalla || '''');
        end loop;
    end loop;
end $$;

-- =====================================================================
-- C · LAS VISTAS DEVUELVEN NOMBRES, NO IDENTIFICADORES
-- =====================================================================
-- Mismo envoltorio de la 57: se lee la definición actual, se mete como
-- subconsulta y se le pega la columna al final con un `left join` —una
-- tabla hash una vez, no una subconsulta por fila—.
--
-- Esto es lo que quita del navegador la necesidad de descargarse el
-- catálogo entero para pintar una columna. Y como la vista es `definer`
-- desde la 56, resuelve el nombre aunque quien pregunta no tenga permiso
-- de ver ese catálogo: el dato de SU pantalla se le enseña completo, que
-- es justo la regla que fijó la 56.

do $$
declare
    v record;
    v_def text;
begin
    for v in
        select * from (values
            -- vista, columna nueva, join, expresión
            ('v_labores_control', 'zona_nombre',
             'left join public.zonas z on z.id = c.zona_id', 'z.nombre'),
            ('v_siembras', 'temporada_nombre',
             'left join public.temporadas tm on tm.id = c.temporada_id', 'tm.nombre'),
            ('v_rotacion_plan', 'temporada_nombre',
             'left join public.temporadas tm on tm.id = c.temporada_id', 'tm.nombre'),
            ('v_rotacion_avance', 'temporada_nombre',
             'left join public.temporadas tm on tm.id = c.temporada_id', 'tm.nombre'),
            ('v_recepcion_plantulas', 'temporada_nombre',
             'left join public.temporadas tm on tm.id = c.temporada_id', 'tm.nombre'),
            ('v_avance_diario', 'temporada_nombre',
             'left join public.temporadas tm on tm.id = c.temporada_id', 'tm.nombre'),
            ('v_costos_labores', 'temporada_nombre',
             'left join public.temporadas tm on tm.id = c.temporada_id', 'tm.nombre'),
            ('v_avance_lote_labor', 'temporada_nombre',
             'left join public.temporadas tm on tm.id = c.temporada_id', 'tm.nombre'),
            ('v_avance_ejecutado', 'labor_nombre',
             'left join public.labores lb on lb.id = c.labor_id', 'lb.nombre'),
            ('v_turnos_riego', 'turno_nombre',
             'left join public.turnos tn on tn.id = c.turno_catalogo_id', 'tn.nombre')
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
            continue;   -- ya la trae
        end if;

        v_def := rtrim(btrim(pg_get_viewdef(('interno.' || v.vista || '_crudo')::regclass, true)), ';');

        execute format('drop view if exists public.%I', v.vista);
        execute format(
            'create or replace view interno.%I as select c.*, %s as %I from (%s) c %s',
            v.vista || '_crudo', v.expresion, v.columna, v_def, v.union_);
        execute format('alter view interno.%I set (security_invoker = off)', v.vista || '_crudo');
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- Las expuestas, con su reja. Se vuelven a armar en bloque: cualquiera a
-- la que se le añadió una columna arriba perdió su vista de fuera.
-- ---------------------------------------------------------------------

do $$
declare
    v record;
    v_dueno text;
    v_zona  text;
    v_reja  text;
begin
    for v in
        select * from (values
            ('v_labores_control',    'labores',      'usuario_id', 'zona_id'),
            ('v_horometros_control', 'horometros',   'usuario_id', null),
            ('v_avance_diario',      'avance',       null,         'lote_temporada_id'),
            ('v_avance_ejecutado',   'avance',       null,         'lote_temporada_id'),
            ('v_avance_lote_labor',  'avance',       null,         'lote_temporada_id'),
            ('v_costos_labores',     'costos',       null,         'lote_temporada_id'),
            ('v_rotacion_avance',    'rotacion',     'usuario_id', 'lote_temporada_id'),
            ('v_rotacion_plan',      'rotacion',     null,         'lote_temporada_id'),
            ('v_siembras',           'trasplante',   'usuario_id', 'lote_temporada_id'),
            ('v_recepcion_plantulas','trasplante',   null,         null),
            ('v_turnos_riego',       'turnos_riego', 'usuario_id', 'lote_temporada_id'),
            ('v_lotes',              'lotes',        null,         null),
            ('v_contadores_equipo',  'catalogo_equipos', 'usuario_id', null),
            ('v_telecom_lineas',     'telecom',      null,         null),
            ('v_telecom_equipos',    'telecom',      null,         null),
            ('v_telecom_asignaciones','telecom',     'usuario_id', null),
            ('v_telecom_alertas',    'telecom',      null,         null)
        ) as t(vista, pantalla, col_dueno, col_zona)
    loop
        if not exists (
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'interno' and c.relname = v.vista || '_crudo'
        ) then
            continue;
        end if;

        v_dueno := case when v.col_dueno is not null
                        then format('x.%I = (select auth.uid())', v.col_dueno)
                        else 'true' end;

        v_zona := case
            when v.col_zona = 'zona_id' then
                format('%s or not (select public.fn_tiene_zonas()) '
                    || 'or x.zona_id in (select public.fn_mis_zonas())', v_dueno)
            when v.col_zona is not null then
                format('%s or not (select public.fn_tiene_zonas()) '
                    || 'or x.%I in (select public.fn_mis_lotes())', v_dueno, v.col_zona)
            else 'true'
        end;

        execute format('drop view if exists public.%I', v.vista);
        execute format($sql$
            create view public.%I as
            select x.* from interno.%I x
            where (select public.fn_permitido_de(%L, 'ver'))
              and case (select public.fn_mi_alcance(%L, 'ver'))
                  when 'global'      then true
                  when 'propietario' then %s
                  else %s
              end
        $sql$, v.vista, v.vista || '_crudo', v.pantalla, v.pantalla, v_dueno, v_zona);

        execute format('grant select on public.%I to authenticated', v.vista);
    end loop;
end $$;

-- =====================================================================
-- D · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_falta text;
begin
    -- 1 · Ni rastro de las fantasmas ni de la casilla global.
    select string_agg(codigo, ', ') into v_falta
    from public.pantallas where codigo in ('plan_lev', 'plan_cos', 'catalogos');
    if v_falta is not null then
        raise exception 'Estas pantallas tenían que haber desaparecido: %', v_falta;
    end if;

    select string_agg(distinct recurso, ', ') into v_falta
    from public.permisos where recurso in ('plan_lev', 'plan_cos', 'catalogos');
    if v_falta is not null then
        raise exception 'Quedaron permisos de pantallas borradas: %', v_falta;
    end if;

    -- 2 · Los cinco bloques existen.
    if (select count(*) from public.pantallas where codigo like 'catalogo\_%') <> 5 then
        raise exception 'Tienen que quedar exactamente cinco bloques de catálogo.';
    end if;

    -- 3 · Nada sigue preguntando por la casilla que ya no existe.
    select string_agg(tablename || '.' || policyname, ', ') into v_falta
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') || coalesce(with_check,'')) ~ '''catalogos''';
    if v_falta is not null then
        raise exception 'Estas policies siguen preguntando por «catalogos»: %', v_falta;
    end if;

    select string_agg(p.proname, ', ') into v_falta
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ '''catalogos''';
    if v_falta is not null then
        raise exception 'Estas funciones siguen preguntando por «catalogos»: %', v_falta;
    end if;

    -- 4 · Y lo de la 56/57 sigue en pie.
    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.relname like '%\_crudo';
    if v_falta is not null then
        raise exception 'Vistas crudas sueltas en public: %', v_falta;
    end if;

    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and exists (select 1 from pg_class cr join pg_namespace nr on nr.oid = cr.relnamespace
                  where nr.nspname = 'interno' and cr.relname = c.relname || '_crudo')
      and pg_get_viewdef(c.oid, true) !~ 'fn_permitido_de';
    if v_falta is not null then
        raise exception 'Vistas sin reja de permiso: %', v_falta;
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
