-- =====================================================================
-- MIGRACIÓN 36 · El reporte público también filtra por estado del ticket
-- =====================================================================
-- «Añadir un nuevo grupo de Checkboxes para filtrar por Estado del Ticket
--  (Abierto / Cerrado). Aplicar la misma lógica de selección múltiple.»
--
-- Mismo patrón que los procesos de la migración 31: un arreglo del enum,
-- vacío significa «ninguno», y el filtro se aplica DENTRO de las
-- funciones `security definer`, no en la pantalla. Lo que no pasa el
-- filtro no sale del servidor.
--
-- El relleno inicial son los DOS estados: hasta hoy el reporte no
-- distinguía, así que no marcar ninguno al actualizar dejaría el visor en
-- blanco de un día para otro sin que nadie hubiera cambiado nada.
-- =====================================================================

alter table public.reporte_publico_config
    add column if not exists estados public.estado_ticket[]
    not null default array['ABIERTO','CERRADO']::public.estado_ticket[];

comment on column public.reporte_publico_config.estados is
    'Estados de ticket que el reporte público muestra. Lista, como los procesos: vacía = no se publica nada.';

-- Las filas que ya existían se quedan con los dos estados, que es el
-- comportamiento de siempre.
update public.reporte_publico_config
   set estados = array['ABIERTO','CERRADO']::public.estado_ticket[]
 where cardinality(estados) = 0;


-- La configuración, vista desde fuera. Cambia la forma de la tabla que
-- devuelve, así que hay que soltarla: `create or replace` no puede.
drop function if exists public.fn_reporte_publico_config();

create or replace function public.fn_reporte_publico_config()
returns table (
    activo              boolean,
    procesos            text[],
    estados             text[],
    todos_departamentos boolean,
    departamentos       text[],
    temporada_activa    text
)
language sql stable security definer set search_path = public, pg_temp as $$
    select
        c.activo,
        c.procesos::text[],
        c.estados::text[],
        c.todos_departamentos,
        c.departamentos,
        (select t.nombre from public.temporadas t where t.activa order by t.fecha_inicio desc limit 1)
    from public.reporte_publico_config c
    where c.id
$$;

comment on function public.fn_reporte_publico_config() is
    'Reglas vigentes del reporte público. La ejecuta también el rol anónimo: no expone nada que no sea la propia configuración.';

grant execute on function public.fn_reporte_publico_config() to anon, authenticated;


-- Las tres funciones de datos ganan la misma condición. Mantienen su
-- firma, así que basta con reemplazarlas.
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
      and t.proceso = any (cfg.procesos)
      and t.estado  = any (cfg.estados)
      and (cfg.todos_departamentos or t.departamento = any (cfg.departamentos))
      and (p_departamento is null or t.departamento = p_departamento)
      and (p_usuario_id   is null or r.usuario_id  = p_usuario_id)
      and (p_ticket_id    is null or t.id          = p_ticket_id)
    order by h.turno, e.codigo, lo.nomenclatura
$$;


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
      and t.proceso = any (cfg.procesos)
      and t.estado  = any (cfg.estados)
      and (cfg.todos_departamentos or t.departamento = any (cfg.departamentos))
      and (p_departamento is null or t.departamento = p_departamento)
      and (p_usuario_id   is null or r.usuario_id  = p_usuario_id)
      and (p_ticket_id    is null or t.id          = p_ticket_id)
    group by e.codigo, h.horometro_inicial, h.horometro_final
    order by e.codigo, h.horometro_inicial
$$;


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
          and t.proceso = any (cfg.procesos)
          and t.estado  = any (cfg.estados)
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

grant execute on function public.fn_reporte_maquinaria_detalle(date, text, uuid, uuid) to anon, authenticated;
grant execute on function public.fn_reporte_maquinaria_horometros(date, text, uuid, uuid) to anon, authenticated;
grant execute on function public.fn_reporte_maquinaria_filtros(date) to anon, authenticated;
