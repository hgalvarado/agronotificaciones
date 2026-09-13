-- =====================================================================
-- MIGRACIÓN 23 · Reporte público de maquinaria
-- =====================================================================
-- «Añadir un botón "Ver Reporte Maquinaria" en el Login que dirija a una
--  vista pública sin requerir autenticación.»
--
-- Una vista pública no puede apoyarse en RLS: RLS responde «¿quién eres?»
-- y aquí no hay nadie. Así que el permiso lo define el Administrador en
-- una tabla de configuración, y el acceso pasa por funciones
-- `security definer` —las únicas que el rol anónimo puede ejecutar— que
-- aplican esa configuración antes de devolver una sola fila.
--
-- Las tablas siguen cerradas a cal y canto para `anon`: no se le concede
-- select sobre ninguna. Lo único que puede hacer es llamar a estas
-- cuatro funciones, y lo que devuelven ya viene recortado.
--
-- El reparto de responsabilidades es el mismo de la app:
--   · `fn_reporte_publico_config`      — qué se permite ver.
--   · `fn_reporte_maquinaria_detalle`  — el detalle operativo del día.
--   · `fn_reporte_maquinaria_horometros` — el resumen de horómetros.
--   · `fn_reporte_maquinaria_filtros`  — qué opciones ofrecer sin filtrar
--     de más (y sin delatar departamentos que el admin no publicó).
-- =====================================================================


-- =====================================================================
-- PARTE A · LAS REGLAS QUE PONE EL ADMINISTRADOR
-- =====================================================================

create table if not exists public.reporte_publico_config (
    -- Fila única: la configuración es global, no una por usuario. El
    -- `check` sobre la clave primaria es lo que lo garantiza sin dejar
    -- que una segunda fila se cuele por descuido.
    id                  boolean primary key default true check (id),
    activo              boolean not null default false,
    -- «Hasta qué nivel de Proceso se pueden ver los registros.» Se guarda
    -- el tope: un ticket entra si su proceso está en ese nivel o antes.
    nivel_proceso       public.proceso_ticket not null default 'NOTIFICADO',
    -- Con `todos_departamentos` en true la lista de abajo se ignora y
    -- entran todos, incluidos los que se creen mañana.
    todos_departamentos boolean not null default false,
    departamentos       text[] not null default '{}'::text[],
    actualizado_por     uuid references public.perfiles(id),
    updated_at          timestamptz not null default now()
);

comment on table public.reporte_publico_config is
    'Reglas del reporte público de maquinaria: si está activo, hasta qué proceso se publica y qué departamentos. Fila única.';

insert into public.reporte_publico_config (id) values (true)
on conflict (id) do nothing;

alter table public.reporte_publico_config enable row level security;

-- Cualquier usuario con sesión puede LEER la configuración (la pantalla
-- de administración la muestra); tocarla es sólo del Administrador.
drop policy if exists reporte_config_select on public.reporte_publico_config;
create policy reporte_config_select on public.reporte_publico_config for select
    using ((select auth.uid()) is not null);

drop policy if exists reporte_config_update on public.reporte_publico_config;
create policy reporte_config_update on public.reporte_publico_config for update
    using ((select public.fn_es_admin())) with check ((select public.fn_es_admin()));

drop policy if exists reporte_config_insert on public.reporte_publico_config;
create policy reporte_config_insert on public.reporte_publico_config for insert
    with check ((select public.fn_es_admin()));


-- =====================================================================
-- PARTE B · EL ORDEN DE LOS PROCESOS
-- =====================================================================
-- El enum `proceso_ticket` no tiene orden numérico propio y la app sí lo
-- usa (0 registrado → 3 notificado). Se escribe una sola vez aquí para
-- que el «hasta qué nivel» signifique lo mismo en la base y en pantalla.
-- =====================================================================

create or replace function public.fn_nivel_proceso(p_proceso public.proceso_ticket)
returns smallint
language sql immutable as $$
    select case p_proceso
        when 'REGISTRADO'           then 0
        when 'REVISANDO'            then 1
        when 'PENDIENTE_APROBACION' then 2
        when 'NOTIFICADO'           then 3
    end::smallint
$$;


-- =====================================================================
-- PARTE C · LA CONFIGURACIÓN, VISTA DESDE FUERA
-- =====================================================================

create or replace function public.fn_reporte_publico_config()
returns table (
    activo              boolean,
    nivel_proceso       text,
    todos_departamentos boolean,
    departamentos       text[],
    temporada_activa    text
)
language sql stable security definer set search_path = public, pg_temp as $$
    select
        c.activo,
        c.nivel_proceso::text,
        c.todos_departamentos,
        c.departamentos,
        (select t.nombre from public.temporadas t where t.activa order by t.fecha_inicio desc limit 1)
    from public.reporte_publico_config c
    where c.id
$$;

comment on function public.fn_reporte_publico_config() is
    'Reglas vigentes del reporte público. La ejecuta también el rol anónimo: no expone nada que no sea la propia configuración.';


-- =====================================================================
-- PARTE D · EL DETALLE OPERATIVO DEL DÍA
-- =====================================================================
-- «El reporte consulta la actividad exacta del día seleccionado. No debe
--  limitar los datos por la temporada a la que pertenezcan.»
--
-- Por eso se filtra por `rd.fecha` y en ningún sitio aparece
-- `temporada_id`: un lote que sigue en la temporada anterior tiene que
-- salir igual que el resto.
-- =====================================================================

create or replace function public.fn_reporte_maquinaria_detalle(
    p_fecha         date,
    p_departamento  text default null,
    p_usuario_id    uuid  default null,
    p_ticket_id     uuid  default null
) returns table (
    detalle_id        uuid,
    turno             public.turno_tipo,
    ubicacion_tecnica text,
    ut                text,
    lote_nombre       text,
    labor             text,
    tarea_codigo      text,
    tarea_nombre      text,
    puesto_trabajo    text,
    implemento        text,
    equipo_codigo     text,
    equipo_nombre     text,
    horas_maquina     numeric,
    avance_mz         numeric,
    horas_hombre      numeric,
    operador_codigo   text,
    operador_nombre   text,
    ticket_codigo     text,
    departamento      text,
    usuario_nombre    text
)
language sql stable security definer set search_path = public, pg_temp as $$
    select
        rd.id,
        h.turno,
        lo.nomenclatura || coalesce('-' || tm.codigo_pep, ''),
        lo.nomenclatura,
        lo.nombre,
        lb.nombre,
        ts.codigo,
        ts.nombre,
        coalesce(pi_.codigo, pf.codigo),
        im.nombre,
        e.codigo,
        e.nombre,
        h.horas_maquina,
        rd.avance_mz,
        h.horas_hombre,
        o.codigo,
        o.nombre,
        t.codigo,
        t.departamento,
        pe.nombre
    from public.reporte_publico_config cfg
    join public.registro_detalle rd on cfg.activo and cfg.id
    join public.registros r          on r.id = rd.registro_id
    join public.horometros h         on h.id = r.horometro_id
    join public.equipos e            on e.id = h.equipo_id
    left join public.familias_equipo fe on fe.id = e.familia_id
    left join public.puestos_trabajo pf on pf.id = fe.puesto_trabajo_id
    left join public.operadores o    on o.id = h.operador_id
    join public.labores lb           on lb.id = r.labor_id
    join public.tareas_sap ts        on ts.id = r.tarea_id
    left join public.implementos im  on im.id = r.implemento_id
    left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
    join public.lotes_temporada lt   on lt.id = rd.lote_temporada_id
    join public.lotes lo             on lo.id = lt.lote_id
    join public.temporadas tm        on tm.id = lt.temporada_id
    join public.tickets t            on t.id = r.ticket_id
    left join public.perfiles pe     on pe.id = r.usuario_id
    where rd.fecha = p_fecha
      -- Las reglas del administrador, aplicadas aquí y no en la pantalla:
      -- lo que no pasa por este filtro nunca sale del servidor.
      and public.fn_nivel_proceso(t.proceso) <= public.fn_nivel_proceso(cfg.nivel_proceso)
      and (cfg.todos_departamentos or t.departamento = any (cfg.departamentos))
      -- Filtros que elige quien mira el reporte.
      and (p_departamento is null or t.departamento = p_departamento)
      and (p_usuario_id   is null or r.usuario_id  = p_usuario_id)
      and (p_ticket_id    is null or t.id          = p_ticket_id)
    order by h.turno, e.codigo, lo.nomenclatura
$$;

comment on function public.fn_reporte_maquinaria_detalle(date, text, uuid, uuid) is
    'Detalle operativo de un día para el reporte público. Aplica las reglas del administrador antes de devolver nada y no filtra por temporada.';


-- =====================================================================
-- PARTE E · EL RESUMEN DE HORÓMETROS, SIN REPETIR
-- =====================================================================
-- «Si un mismo equipo presenta registros con horómetros iniciales y
--  finales idénticos en ese día, agruparlos para mostrar solo 1 fila neta
--  por equipo.»
--
-- Un horómetro con tres labores aparece tres veces en el detalle, y eso
-- está bien: son tres trabajos. En el resumen sería sumar tres veces las
-- mismas horas. El `group by` de abajo deja una fila por lectura; si el
-- mismo equipo tuvo dos pasadas distintas el mismo día, salen las dos,
-- que es lo correcto.
-- =====================================================================

create or replace function public.fn_reporte_maquinaria_horometros(
    p_fecha         date,
    p_departamento  text default null,
    p_usuario_id    uuid  default null,
    p_ticket_id     uuid  default null
) returns table (
    equipo_codigo     text,
    equipo_nombre     text,
    horometro_inicial numeric,
    horometro_final   numeric,
    horas_maquina     numeric,
    horas_hombre      numeric,
    familia           text
)
language sql stable security definer set search_path = public, pg_temp as $$
    select
        e.codigo,
        max(e.nombre),
        h.horometro_inicial,
        h.horometro_final,
        max(h.horas_maquina),
        max(h.horas_hombre),
        max(fe.nombre)
    from public.reporte_publico_config cfg
    join public.registro_detalle rd on cfg.activo and cfg.id
    join public.registros r          on r.id = rd.registro_id
    join public.horometros h         on h.id = r.horometro_id
    join public.equipos e            on e.id = h.equipo_id
    left join public.familias_equipo fe on fe.id = e.familia_id
    join public.tickets t            on t.id = r.ticket_id
    where rd.fecha = p_fecha
      and public.fn_nivel_proceso(t.proceso) <= public.fn_nivel_proceso(cfg.nivel_proceso)
      and (cfg.todos_departamentos or t.departamento = any (cfg.departamentos))
      and (p_departamento is null or t.departamento = p_departamento)
      and (p_usuario_id   is null or r.usuario_id  = p_usuario_id)
      and (p_ticket_id    is null or t.id          = p_ticket_id)
    group by e.codigo, h.horometro_inicial, h.horometro_final
    order by e.codigo, h.horometro_inicial
$$;

comment on function public.fn_reporte_maquinaria_horometros(date, text, uuid, uuid) is
    'Una fila por lectura de horómetro del día: mismo equipo con mismo inicial y final se agrupa en una sola.';


-- =====================================================================
-- PARTE F · LAS OPCIONES DE LOS FILTROS
-- =====================================================================
-- Los desplegables del visor público no pueden salir de los catálogos
-- completos: enseñarían departamentos, usuarios y tickets que el
-- administrador no publicó. Salen de lo que ese día es visible.
-- =====================================================================

create or replace function public.fn_reporte_maquinaria_filtros(p_fecha date)
returns table (tipo text, valor text, etiqueta text)
language sql stable security definer set search_path = public, pg_temp as $$
    with visible as (
        select distinct
            t.departamento,
            r.usuario_id,
            pe.nombre as usuario_nombre,
            t.id      as ticket_id,
            t.codigo  as ticket_codigo
        from public.reporte_publico_config cfg
        join public.registro_detalle rd on cfg.activo and cfg.id
        join public.registros r on r.id = rd.registro_id
        join public.tickets t   on t.id = r.ticket_id
        left join public.perfiles pe on pe.id = r.usuario_id
        where rd.fecha = p_fecha
          and public.fn_nivel_proceso(t.proceso) <= public.fn_nivel_proceso(cfg.nivel_proceso)
          and (cfg.todos_departamentos or t.departamento = any (cfg.departamentos))
    )
    select 'departamento', departamento, departamento
    from visible where departamento is not null
    group by departamento
    union all
    select 'usuario', usuario_id::text, coalesce(usuario_nombre, 'Sin nombre')
    from visible where usuario_id is not null
    group by usuario_id, usuario_nombre
    union all
    select 'ticket', ticket_id::text, ticket_codigo
    from visible
    group by ticket_id, ticket_codigo
    order by 1, 3
$$;

comment on function public.fn_reporte_maquinaria_filtros(date) is
    'Departamentos, usuarios y tickets que el reporte público puede mostrar ese día. Alimenta los desplegables sin delatar lo oculto.';


-- =====================================================================
-- PARTE G · QUIÉN PUEDE LLAMARLAS
-- =====================================================================
-- `anon` es el rol del visitante sin sesión. Se le concede ejecutar
-- estas cuatro funciones y nada más: no tiene select sobre ninguna
-- tabla, así que no hay forma de pedir por fuera lo que estas filtran.
-- =====================================================================

grant execute on function public.fn_reporte_publico_config() to anon, authenticated;
grant execute on function public.fn_reporte_maquinaria_detalle(date, text, uuid, uuid) to anon, authenticated;
grant execute on function public.fn_reporte_maquinaria_horometros(date, text, uuid, uuid) to anon, authenticated;
grant execute on function public.fn_reporte_maquinaria_filtros(date) to anon, authenticated;


-- =====================================================================
-- PARTE H · LA PANTALLA EN EL PANEL DE PERMISOS
-- =====================================================================

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('reporte_publico', 'Reporte público',
     'Reglas del reporte de maquinaria abierto al público', '/admin/reporte-publico', 115,
     array['ver','editar'])
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta = excluded.ruta,
    orden = excluded.orden,
    acciones = excluded.acciones;
