-- =====================================================================
-- MIGRACIÓN 39 · Roles nuevos, navegación por rol y columnas de labores
-- =====================================================================
-- Tres cosas:
--
--   A. Cuatro roles más, y uno de ellos —Invitado— que NO puede escribir
--      nada en ninguna pantalla. El bloqueo va en la base, no en la
--      interfaz: esconder un botón no impide un POST.
--   B. Qué accesos directos salen en la barra inferior del teléfono, por
--      rol y configurable por el Administrador.
--   C. La etapa se puede corregir en línea desde /labores, y sólo en las
--      labores que de verdad la llevan.
-- =====================================================================


-- =====================================================================
-- PARTE A · LOS ROLES
-- =====================================================================

insert into public.roles (id, codigo, nombre, descripcion) values
    (4, 'DIGITADOR_PARAMETRISTA', 'Digitador Parametrista',
        'Mantiene los datos maestros: catálogos, lotes, tarifas y contadores.'),
    (5, 'JEFE_ZONA', 'Jefe de Zona',
        'Ve y captura lo de su zona: avance, riego y trasplante. No toca catálogos.'),
    (6, 'DIGITADOR_ANALISIS', 'Digitador Análisis',
        'Captura y corrige horómetros y labores, y consulta costos y avance.'),
    (7, 'INVITADO', 'Invitado',
        'Sólo lectura. Puede ver y exportar, nunca crear, editar ni eliminar.')
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion;


-- ---------------------------------------------------------------------
-- El Invitado, de verdad
-- ---------------------------------------------------------------------
-- «Bloqueo global a nivel de UI y API que le impide modificar, crear o
--  eliminar registros.»
--
-- Se implementa en `fn_tiene_permiso` y no en cada policy porque ésa es
-- la ÚNICA puerta por la que pasan todas: las de la primera generación
-- (recursos de tabla, acciones create/read/update/delete) y las de la
-- segunda (recursos de pantalla, acciones ver/crear/editar/eliminar).
-- Bloquear ahí es bloquear en los dos sitios a la vez, y ninguna policy
-- futura se puede olvidar de esta regla.
--
-- Lo que NO se hace: poner al Invitado en la tabla `permisos` con sólo
-- «ver». Bastaría con que alguien le marcara una casilla de más en el
-- panel de permisos para que pudiera escribir, y el rol dejaría de
-- significar lo que dice su nombre.
-- ---------------------------------------------------------------------

create or replace function public.fn_es_invitado() returns boolean
language sql stable security definer
set search_path = public, pg_temp as $$
    select public.fn_mi_rol() = 'INVITADO'
$$;

comment on function public.fn_es_invitado() is
    'El rol Invitado: mira y exporta, nunca escribe. Lo aplica fn_tiene_permiso.';

grant execute on function public.fn_es_invitado() to authenticated;

/* Acciones que son «mirar». Lo demás, para el Invitado, es que no. */
create or replace function public.fn_accion_de_lectura(p_accion text) returns boolean
language sql immutable
as $$
    select p_accion in ('ver', 'descargar', 'read')
$$;

create or replace function public.fn_tiene_permiso(p_recurso text, p_accion text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp as $$
    select case
        -- El Invitado primero, y antes que el atajo del Administrador:
        -- si alguien le pusiera el rol ADMIN además, ya no sería Invitado.
        when public.fn_es_invitado() then public.fn_accion_de_lectura(p_accion)
        when public.fn_es_admin() then true
        else exists (
            select 1
            from public.perfiles p
            join public.permisos pm on pm.rol_id = p.rol_id
            where p.id = (select auth.uid())
              and pm.recurso = p_recurso
              and pm.accion = p_accion
        )
    end
$$;

comment on function public.fn_tiene_permiso(text, text) is
    'La única puerta de permisos. El Invitado sólo pasa con acciones de lectura, '
    'el Administrador pasa siempre, y el resto según la tabla permisos.';

-- Y que el menú tampoco le ofrezca lo que no puede hacer.
create or replace function public.fn_mis_permisos()
returns table (recurso text, accion text)
language sql stable security definer
set search_path = public, pg_temp as $$
    select p.codigo, a.accion
    from public.pantallas p
    cross join lateral unnest(p.acciones) as a(accion)
    where public.fn_es_admin() and not public.fn_es_invitado()

    union

    -- El Invitado ve TODAS las pantallas, pero sólo con lectura.
    select p.codigo, a.accion
    from public.pantallas p
    cross join lateral unnest(p.acciones) as a(accion)
    where public.fn_es_invitado()
      and public.fn_accion_de_lectura(a.accion)

    union

    select pm.recurso, pm.accion
    from public.perfiles pe
    join public.permisos pm on pm.rol_id = pe.rol_id
    join public.pantallas pa on pa.codigo = pm.recurso
    where pe.id = (select auth.uid())
      and not public.fn_es_invitado()
$$;

grant execute on function public.fn_mis_permisos() to authenticated;


-- ---------------------------------------------------------------------
-- Qué puede hacer cada rol nuevo
-- ---------------------------------------------------------------------
-- Semilla razonable, no una sentencia: el Administrador la ajusta desde
-- Permisos sin tocar código. El Invitado NO se siembra —su regla vive en
-- la función de arriba— y por eso tampoco se le puede ampliar por error.
-- ---------------------------------------------------------------------

insert into public.permisos (rol_id, recurso, accion)
select r.id, x.recurso, x.accion
from public.roles r
join (values
    -- Parametrista: los datos maestros son suyos; la operación sólo la mira.
    ('DIGITADOR_PARAMETRISTA','catalogos','ver'),   ('DIGITADOR_PARAMETRISTA','catalogos','crear'),
    ('DIGITADOR_PARAMETRISTA','catalogos','editar'),('DIGITADOR_PARAMETRISTA','catalogos','eliminar'),
    ('DIGITADOR_PARAMETRISTA','catalogos','descargar'),
    ('DIGITADOR_PARAMETRISTA','lotes','ver'),       ('DIGITADOR_PARAMETRISTA','lotes','crear'),
    ('DIGITADOR_PARAMETRISTA','lotes','editar'),    ('DIGITADOR_PARAMETRISTA','lotes','descargar'),
    ('DIGITADOR_PARAMETRISTA','tarifas','ver'),     ('DIGITADOR_PARAMETRISTA','tarifas','crear'),
    ('DIGITADOR_PARAMETRISTA','tarifas','editar'),  ('DIGITADOR_PARAMETRISTA','tarifas','descargar'),
    ('DIGITADOR_PARAMETRISTA','tickets','ver'),
    ('DIGITADOR_PARAMETRISTA','avance','ver'),      ('DIGITADOR_PARAMETRISTA','avance','descargar'),

    -- Jefe de Zona: la operación de campo de su zona.
    ('JEFE_ZONA','avance','ver'),         ('JEFE_ZONA','avance','descargar'),
    ('JEFE_ZONA','tickets','ver'),
    ('JEFE_ZONA','horometros','ver'),     ('JEFE_ZONA','horometros','descargar'),
    ('JEFE_ZONA','labores','ver'),        ('JEFE_ZONA','labores','descargar'),
    ('JEFE_ZONA','plan','ver'),           ('JEFE_ZONA','plan','descargar'),
    ('JEFE_ZONA','plan_aps','ver'),       ('JEFE_ZONA','plan_aps','descargar'),
    ('JEFE_ZONA','trasplante','ver'),     ('JEFE_ZONA','trasplante','descargar'),
    ('JEFE_ZONA','turnos_riego','ver'),   ('JEFE_ZONA','turnos_riego','crear'),
    ('JEFE_ZONA','turnos_riego','editar'),('JEFE_ZONA','turnos_riego','descargar'),

    -- Digitador Análisis: cuadra el mes.
    ('DIGITADOR_ANALISIS','tickets','ver'),      ('DIGITADOR_ANALISIS','tickets','crear'),
    ('DIGITADOR_ANALISIS','tickets','editar'),   ('DIGITADOR_ANALISIS','tickets','descargar'),
    ('DIGITADOR_ANALISIS','horometros','ver'),   ('DIGITADOR_ANALISIS','horometros','editar'),
    ('DIGITADOR_ANALISIS','horometros','descargar'),
    ('DIGITADOR_ANALISIS','labores','ver'),      ('DIGITADOR_ANALISIS','labores','editar'),
    ('DIGITADOR_ANALISIS','labores','descargar'),
    ('DIGITADOR_ANALISIS','avance','ver'),       ('DIGITADOR_ANALISIS','avance','descargar'),
    ('DIGITADOR_ANALISIS','costos','ver'),       ('DIGITADOR_ANALISIS','costos','descargar'),
    ('DIGITADOR_ANALISIS','turnos_riego','ver'), ('DIGITADOR_ANALISIS','turnos_riego','descargar')
) as x(rol, recurso, accion) on x.rol = r.codigo
on conflict (rol_id, recurso, accion) do nothing;


-- ---------------------------------------------------------------------
-- El Digitador ya puede dar de alta un equipo
-- ---------------------------------------------------------------------
-- Desde esta versión el formulario de horómetro permite crear el equipo
-- sin salir de la captura, igual que ya permitía crear el operador. El
-- Digitador tenía permiso para operadores e implementos pero no para
-- equipos, así que el botón nuevo le habría salido y le habría fallado.
--
-- Es el caso real: llega una máquina prestada a media jornada y quien la
-- está capturando no puede parar a pedirle a nadie que la dé de alta.
-- ---------------------------------------------------------------------

insert into public.permisos (rol_id, recurso, accion)
select r.id, 'catalogo_equipos', 'create'
from public.roles r
where r.codigo in ('DIGITADOR', 'DIGITADOR_ANALISIS')
on conflict (rol_id, recurso, accion) do nothing;


-- =====================================================================
-- PARTE B · LA BARRA INFERIOR DEL TELÉFONO, POR ROL
-- =====================================================================
-- Hoy la barra se arma sola: se aplanan los módulos visibles, caben
-- cuatro y el resto va a «Más». Funciona, pero el orden lo decide el
-- código, no quien usa la aplicación: un Jefe de Zona entra a Riego
-- treinta veces al día y lo tenía escondido detrás de «Más» porque
-- «Tickets» estaba declarado antes.
--
-- Esta tabla deja que el Administrador diga, para cada rol, qué accesos
-- van en la barra y en qué orden. Lo que no esté aquí sigue saliendo en
-- «Más» —nada desaparece— y un rol sin filas configuradas se comporta
-- exactamente como hasta ahora.
-- =====================================================================

create table if not exists public.navegacion_rol (
    id         uuid primary key default gen_random_uuid(),
    rol_id     smallint not null references public.roles(id) on delete cascade,
    pantalla   text not null references public.pantallas(codigo) on delete cascade,
    orden      smallint not null default 0,
    created_at timestamptz not null default now(),
    unique (rol_id, pantalla)
);

create index if not exists navegacion_rol_rol_idx on public.navegacion_rol (rol_id, orden);

comment on table public.navegacion_rol is
    'Qué accesos directos salen en la barra inferior del teléfono, por rol y en qué orden. '
    'Un rol sin filas usa el orden por omisión del código; lo que no esté aquí va a «Más».';

alter table public.navegacion_rol enable row level security;

-- Todo el mundo lee la suya: el menú se dibuja con esto.
drop policy if exists navegacion_rol_select on public.navegacion_rol;
create policy navegacion_rol_select on public.navegacion_rol for select
    using ((select auth.uid()) is not null);

-- Sólo el Administrador la cambia. No pasa por `permisos` a propósito:
-- quien configura la navegación de los demás manda sobre todos.
drop policy if exists navegacion_rol_insert on public.navegacion_rol;
create policy navegacion_rol_insert on public.navegacion_rol for insert
    with check ((select public.fn_es_admin()) and not (select public.fn_es_invitado()));

drop policy if exists navegacion_rol_update on public.navegacion_rol;
create policy navegacion_rol_update on public.navegacion_rol for update
    using ((select public.fn_es_admin()) and not (select public.fn_es_invitado()));

drop policy if exists navegacion_rol_delete on public.navegacion_rol;
create policy navegacion_rol_delete on public.navegacion_rol for delete
    using ((select public.fn_es_admin()) and not (select public.fn_es_invitado()));

grant select, insert, update, delete on public.navegacion_rol to authenticated;

/* Los accesos del usuario que pregunta, ya ordenados. */
create or replace function public.fn_mi_navegacion()
returns table (pantalla text, orden smallint)
language sql stable security definer
set search_path = public, pg_temp as $$
    select n.pantalla, n.orden
    from public.perfiles p
    join public.navegacion_rol n on n.rol_id = p.rol_id
    where p.id = (select auth.uid())
    order by n.orden, n.pantalla
$$;

grant execute on function public.fn_mi_navegacion() to authenticated;

/* Reemplaza de una vez la barra de un rol. Se hace en una función y no
   con borrar+insertar desde el navegador porque a medio camino el rol se
   quedaría sin barra, y hay gente usándola en ese momento. */
create or replace function public.fn_guardar_navegacion(
    p_rol_id    smallint,
    p_pantallas text[]
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp as $$
declare
    v_n integer;
begin
    if not public.fn_es_admin() or public.fn_es_invitado() then
        raise exception 'Sólo el Administrador puede configurar la navegación.'
            using errcode = '42501';
    end if;

    delete from public.navegacion_rol where rol_id = p_rol_id;

    insert into public.navegacion_rol (rol_id, pantalla, orden)
    select p_rol_id, x.codigo, (x.i - 1)::smallint
    from unnest(coalesce(p_pantallas, array[]::text[])) with ordinality as x(codigo, i)
    -- Una pantalla que no existe se ignora en vez de tumbar el guardado:
    -- la lista viene de una interfaz que puede ir por detrás del catálogo.
    where exists (select 1 from public.pantallas pa where pa.codigo = x.codigo);

    get diagnostics v_n = row_count;
    return v_n;
end
$$;

grant execute on function public.fn_guardar_navegacion(smallint, text[]) to authenticated;


-- =====================================================================
-- PARTE C · LA ETAPA SE CORRIGE EN LÍNEA
-- =====================================================================
-- Las columnas ya existen desde la 12 y la vista ya las enseña desde la
-- 22; lo que faltaba era poder corregirlas sobre la tabla y, sobre todo,
-- que la cuadrícula supiera CUÁNDO la etapa aplica.
--
-- «Sólo debe habilitarse si la labor seleccionada es Emplasticado (o las
--  labores configuradas dinámicamente para requerir etapa).» Esa bandera
-- ya existe: `labores.seguimiento_emplasticado`. No se inventa otra.
-- =====================================================================

-- La vista dice, por línea, si la etapa aplica. Sin esto la pantalla
-- tendría que volver a consultar el catálogo de labores por cada fila.
-- `create or replace view` sólo añade columnas al final, que es esto.
create or replace view public.v_labores_control as
select
    rd.id                       as detalle_id,
    r.id                        as registro_id,
    r.ticket_id,
    r.horometro_id,
    r.fecha,
    rd.lote_temporada_id,
    lo.nomenclatura             as ut,
    lo.nombre                   as lote_nombre,
    r.tarea_id,
    ts.codigo                   as tarea_codigo,
    ts.nombre                   as tarea_nombre,
    rd.ciclo,
    rd.avance_mz,
    r.labor_id,
    lb.nombre                   as labor_nombre,
    cl.nombre                   as categoria_labor,
    e.codigo                    as equipo_codigo,
    h.turno,
    h.horas_maquina,
    h.horas_hombre,
    r.horas_notificadas,
    coalesce(r.horas_notificadas, h.horas_maquina) as horas_costeadas,
    o.codigo                    as operador_codigo,
    o.nombre                    as operador_nombre,
    r.implemento_id,
    im.codigo                   as implemento_codigo,
    im.nombre                   as implemento_nombre,
    pi_.codigo                  as puesto_implemento,
    pi_.operacion_sap           as operacion_implemento,
    pf.codigo                   as puesto_equipo,
    pf.operacion_sap            as operacion_equipo,
    pf.descripcion              as descripcion_equipo,
    t.codigo                    as ticket_codigo,
    t.estado                    as ticket_estado,
    t.proceso                   as ticket_proceso,
    t.departamento,
    r.comentarios,
    r.usuario_id,
    pe.nombre                   as usuario_nombre,
    (select count(*) from public.registro_detalle x where x.registro_id = r.id) as lotes_del_registro,
    r.created_at,
    l_t.temporada_id,
    tm.nombre                   as temporada_nombre,
    l_t.lote_id,
    r.implemento_fisico_id,
    imf.codigo                  as codigo_implemento,
    rd.etapa,
    rd.con_moto,
    rd.proveedor_plastico_id,
    pp.nombre                   as proveedor_plastico,
    rd.proveedor_manguera_id,
    pmg.nombre                  as proveedor_manguera,
    rd.comentarios              as detalle_comentarios,
    rd.fecha                    as detalle_fecha,
    h.equipo_id,
    h.operador_id,
    h.horometro_inicial,
    h.horometro_final,
    (select count(*) from public.registros y where y.horometro_id = h.id) as registros_del_horometro,
    rd.horas_maquina            as horas_linea,
    -- ---------------- Columna nueva de la 39 ------------------------
    -- Si esta línea lleva etapa o no. Va en la vista y no en el
    -- navegador para que la cuadrícula no tenga que cruzar el catálogo
    -- de labores fila por fila con mil filas en pantalla.
    coalesce(lb.seguimiento_emplasticado, false) as requiere_etapa
from public.registro_detalle rd
join public.registros r          on r.id = rd.registro_id
join public.lotes_temporada l_t  on l_t.id = rd.lote_temporada_id
join public.temporadas tm        on tm.id = l_t.temporada_id
join public.lotes lo             on lo.id = l_t.lote_id
join public.horometros h         on h.id = r.horometro_id
join public.equipos e            on e.id = h.equipo_id
left join public.familias_equipo fe on fe.id = e.familia_id
left join public.puestos_trabajo pf on pf.id = fe.puesto_trabajo_id
left join public.operadores o    on o.id = h.operador_id
join public.labores lb           on lb.id = r.labor_id
left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
join public.tareas_sap ts        on ts.id = r.tarea_id
left join public.implementos im  on im.id = r.implemento_id
left join public.implementos_fisicos imf on imf.id = r.implemento_fisico_id
left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
left join public.proveedores pp  on pp.id = rd.proveedor_plastico_id
left join public.proveedores pmg on pmg.id = rd.proveedor_manguera_id
left join public.perfiles pe     on pe.id = r.usuario_id
join public.tickets t            on t.id = r.ticket_id;

alter view public.v_labores_control set (security_invoker = on);


-- ---------------------------------------------------------------------
-- La edición en línea acepta etapa, proveedores y comentario
-- ---------------------------------------------------------------------
-- Los cuatro viven en `registro_detalle`, así que NO separan la línea:
-- corregir la etapa de un lote no le cambia la tarea a los demás. Por eso
-- se pueden aplicar directo y antes del resto de la lógica.
-- ---------------------------------------------------------------------

drop function if exists public.fn_editar_linea_labor(uuid, uuid, uuid, uuid, boolean, numeric, uuid, uuid);

create or replace function public.fn_editar_linea_labor(
    p_detalle_id           uuid,
    p_labor_id             uuid    default null,
    p_tarea_id             uuid    default null,
    p_implemento_id        uuid    default null,
    p_quitar_implemento    boolean default false,
    p_avance_mz            numeric default null,
    p_lote_temporada_id    uuid    default null,
    p_implemento_fisico_id uuid    default null,
    p_etapa                smallint default null,
    p_quitar_etapa         boolean default false,
    p_proveedor_plastico_id  uuid  default null,
    p_quitar_plastico      boolean default false,
    p_proveedor_manguera_id  uuid  default null,
    p_quitar_manguera      boolean default false,
    p_comentarios          text    default null
) returns uuid
language plpgsql security invoker as $$
declare
    v_registro   public.registros%rowtype;
    v_lineas     integer;
    v_nuevo_id   uuid;
    v_tipo_impl  uuid;
    v_requiere   boolean;
begin
    select r.* into v_registro
    from public.registros r
    join public.registro_detalle rd on rd.registro_id = r.id
    where rd.id = p_detalle_id;

    if not found then
        raise exception 'La línea no existe o no tienes permiso para verla.'
            using errcode = 'P0002';
    end if;

    -- ---- Lo que vive en el DETALLE: se aplica sin separar nada -------
    if p_avance_mz is not null then
        update public.registro_detalle set avance_mz = p_avance_mz where id = p_detalle_id;
    end if;

    if p_lote_temporada_id is not null then
        update public.registro_detalle
        set lote_temporada_id = p_lote_temporada_id
        where id = p_detalle_id;
    end if;

    if p_quitar_etapa then
        update public.registro_detalle set etapa = null where id = p_detalle_id;
    elsif p_etapa is not null then
        -- La etapa sólo se acepta donde significa algo. Guardarla en una
        -- labor que no la lleva es dejar un dato que nadie sabe leer.
        select coalesce(l.seguimiento_emplasticado, false) into v_requiere
        from public.labores l
        where l.id = coalesce(p_labor_id, v_registro.labor_id);

        if not coalesce(v_requiere, false) then
            raise exception 'Esta labor no lleva etapa. Sólo la llevan las de seguimiento de emplasticado.'
                using errcode = '22023';
        end if;

        update public.registro_detalle set etapa = p_etapa where id = p_detalle_id;
    end if;

    if p_quitar_plastico then
        update public.registro_detalle set proveedor_plastico_id = null where id = p_detalle_id;
    elsif p_proveedor_plastico_id is not null then
        update public.registro_detalle
        set proveedor_plastico_id = p_proveedor_plastico_id where id = p_detalle_id;
    end if;

    if p_quitar_manguera then
        update public.registro_detalle set proveedor_manguera_id = null where id = p_detalle_id;
    elsif p_proveedor_manguera_id is not null then
        update public.registro_detalle
        set proveedor_manguera_id = p_proveedor_manguera_id where id = p_detalle_id;
    end if;

    if p_comentarios is not null then
        update public.registro_detalle
        set comentarios = nullif(btrim(p_comentarios), '') where id = p_detalle_id;
    end if;

    -- ---- Lo que vive en el REGISTRO: puede separar la línea ----------
    if p_labor_id is null and p_tarea_id is null
       and p_implemento_id is null and p_implemento_fisico_id is null
       and not p_quitar_implemento then
        return v_registro.id;
    end if;

    -- Un código físico arrastra su tipo de implemento.
    if p_implemento_fisico_id is not null then
        select ifi.implemento_id into v_tipo_impl
        from public.implementos_fisicos ifi
        where ifi.id = p_implemento_fisico_id;
    end if;

    select count(*) into v_lineas
    from public.registro_detalle where registro_id = v_registro.id;

    if v_lineas <= 1 then
        update public.registros
        set labor_id             = coalesce(p_labor_id, labor_id),
            tarea_id             = coalesce(p_tarea_id, tarea_id),
            implemento_id        = case
                                       when p_quitar_implemento then null
                                       when p_implemento_fisico_id is not null then v_tipo_impl
                                       else coalesce(p_implemento_id, implemento_id)
                                   end,
            implemento_fisico_id = case
                                       when p_quitar_implemento then null
                                       else coalesce(p_implemento_fisico_id, implemento_fisico_id)
                                   end
        where id = v_registro.id;

        return v_registro.id;
    end if;

    -- Varios lotes: nace un registro propio y la línea se muda.
    insert into public.registros
        (ticket_id, horometro_id, labor_id, tarea_id, implemento_id,
         implemento_fisico_id, horas_notificadas, comentarios, usuario_id)
    values
        (v_registro.ticket_id, v_registro.horometro_id,
         coalesce(p_labor_id, v_registro.labor_id),
         coalesce(p_tarea_id, v_registro.tarea_id),
         case
             when p_quitar_implemento then null
             when p_implemento_fisico_id is not null then v_tipo_impl
             else coalesce(p_implemento_id, v_registro.implemento_id)
         end,
         case
             when p_quitar_implemento then null
             else coalesce(p_implemento_fisico_id, v_registro.implemento_fisico_id)
         end,
         null, v_registro.comentarios, v_registro.usuario_id)
    returning id into v_nuevo_id;

    update public.registro_detalle set registro_id = v_nuevo_id where id = p_detalle_id;

    -- Al separar, las horas del registro viejo cubrían lotes que ya no
    -- son suyos. Se vuelve a repartir todo el horómetro.
    perform public.fn_prorratear_horas_horometro(v_registro.horometro_id);

    return v_nuevo_id;
end
$$;

comment on function public.fn_editar_linea_labor(uuid, uuid, uuid, uuid, boolean, numeric, uuid, uuid, smallint, boolean, uuid, boolean, uuid, boolean, text) is
    'Edita UNA línea de labor sin tocar los demás lotes del mismo ticket. Etapa, proveedores '
    'y comentario viven en el detalle y nunca separan la línea; la etapa sólo se acepta en '
    'labores con seguimiento de emplasticado.';

grant execute on function public.fn_editar_linea_labor(uuid, uuid, uuid, uuid, boolean, numeric, uuid, uuid, smallint, boolean, uuid, boolean, uuid, boolean, text)
    to authenticated;
