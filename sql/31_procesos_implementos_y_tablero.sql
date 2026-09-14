-- =====================================================================
-- MIGRACIÓN 31 · Procesos publicables, implementos al revés y tablero
--                por lote
-- =====================================================================
-- Tres pedidos, tres partes independientes:
--
--   A · «Cambiar "Hasta qué proceso se publica" a un grupo de casillas.
--        Debe permitir selección múltiple.»
--       El reporte público dejaba de ser un TOPE y pasa a ser una LISTA.
--
--   B · «Invertir el orden: seleccionar primero el Código Físico del
--        Implemento. Al hacerlo, el sistema debe autocompletar
--        silenciosamente el Implemento Usado.»
--       El autocompletado vive en la base, no en la pantalla: así vale
--       también para la importación masiva del histórico.
--
--   C · «Eliminar el filtro Proceso. Eliminar cualquier lógica o
--        distinción subyacente entre APS, LEV o CAT… Zona a selección
--        múltiple, añadir Ciclo… Vista de datos a nivel lote.»
-- =====================================================================


-- =====================================================================
-- PARTE A · EL REPORTE PÚBLICO PUBLICA UNA LISTA DE PROCESOS
-- =====================================================================
-- Antes se guardaba un tope —«hasta NOTIFICADO»— y la base traducía ese
-- tope a un rango con `fn_nivel_proceso`. Un tope no sabe decir «publica
-- lo notificado y lo registrado, pero no lo que está en revisión», y eso
-- es justo lo que se pide ahora.
--
-- La columna pasa a ser un arreglo del mismo enum. Un arreglo vacío
-- significa «ninguno»: el reporte no muestra nada, que es lo correcto y
-- lo que la validación de la pantalla impide guardar sin querer.
--
-- Las cuatro funciones se sueltan ANTES de tocar la columna: Postgres no
-- registra la dependencia de una función con las columnas que lee, así
-- que si se dejaran vivas quedarían rotas hasta el final del archivo.
-- =====================================================================

drop function if exists public.fn_reporte_publico_config();
drop function if exists public.fn_reporte_maquinaria_detalle(date, text, uuid, uuid);
drop function if exists public.fn_reporte_maquinaria_horometros(date, text, uuid, uuid);
drop function if exists public.fn_reporte_maquinaria_filtros(date);

alter table public.reporte_publico_config
    add column if not exists procesos public.proceso_ticket[] not null default '{}'::public.proceso_ticket[];

comment on column public.reporte_publico_config.procesos is
    'Procesos de ticket que el reporte público muestra. Lista, no tope: se ve lo que esté marcado. Vacía = no se publica nada.';

-- Lo que ya estaba configurado se conserva: el tope viejo se abre a la
-- lista equivalente (todos los procesos hasta ese nivel). Sólo se hace
-- una vez, sobre la fila que todavía no tiene procesos.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'reporte_publico_config'
          and column_name  = 'nivel_proceso'
    ) then
        execute $mig$
            update public.reporte_publico_config c
               set procesos = coalesce((
                       select array_agg(p order by public.fn_nivel_proceso(p))
                       from unnest(enum_range(null::public.proceso_ticket)) p
                       where public.fn_nivel_proceso(p) <= public.fn_nivel_proceso(c.nivel_proceso)
                   ), '{}'::public.proceso_ticket[])
             where cardinality(c.procesos) = 0
        $mig$;
    end if;
end $$;

-- El tope se va: dos formas de decir lo mismo es una de más, y la que
-- sobra siempre acaba desincronizada.
alter table public.reporte_publico_config drop column if exists nivel_proceso;


create or replace function public.fn_reporte_publico_config()
returns table (
    activo              boolean,
    procesos            text[],
    todos_departamentos boolean,
    departamentos       text[],
    temporada_activa    text
)
language sql stable security definer set search_path = public, pg_temp as $$
    select
        c.activo,
        c.procesos::text[],
        c.todos_departamentos,
        c.departamentos,
        (select t.nombre from public.temporadas t where t.activa order by t.fecha_inicio desc limit 1)
    from public.reporte_publico_config c
    where c.id
$$;

comment on function public.fn_reporte_publico_config() is
    'Reglas vigentes del reporte público. La ejecuta también el rol anónimo: no expone nada que no sea la propia configuración.';


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
      and t.proceso = any (cfg.procesos)
      and (cfg.todos_departamentos or t.departamento = any (cfg.departamentos))
      -- Filtros que elige quien mira el reporte.
      and (p_departamento is null or t.departamento = p_departamento)
      and (p_usuario_id   is null or r.usuario_id  = p_usuario_id)
      and (p_ticket_id    is null or t.id          = p_ticket_id)
    order by h.turno, e.codigo, lo.nomenclatura
$$;

comment on function public.fn_reporte_maquinaria_detalle(date, text, uuid, uuid) is
    'Detalle operativo de un día para el reporte público. Sólo salen los tickets cuyo proceso está marcado por el administrador, y no filtra por temporada.';


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
      and (cfg.todos_departamentos or t.departamento = any (cfg.departamentos))
      and (p_departamento is null or t.departamento = p_departamento)
      and (p_usuario_id   is null or r.usuario_id  = p_usuario_id)
      and (p_ticket_id    is null or t.id          = p_ticket_id)
    group by e.codigo, h.horometro_inicial, h.horometro_final
    order by e.codigo, h.horometro_inicial
$$;

comment on function public.fn_reporte_maquinaria_horometros(date, text, uuid, uuid) is
    'Una fila por lectura de horómetro del día: mismo equipo con mismo inicial y final se agrupa en una sola.';


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

grant execute on function public.fn_reporte_publico_config() to anon, authenticated;
grant execute on function public.fn_reporte_maquinaria_detalle(date, text, uuid, uuid) to anon, authenticated;
grant execute on function public.fn_reporte_maquinaria_horometros(date, text, uuid, uuid) to anon, authenticated;
grant execute on function public.fn_reporte_maquinaria_filtros(date) to anon, authenticated;


-- =====================================================================
-- PARTE B · EL CÓDIGO FÍSICO MANDA; EL TIPO SE DEDUCE
-- =====================================================================
-- «Invertir el orden de selección: seleccionar primero el Código Físico
--  del Implemento. Al hacerlo, el sistema debe autocompletar
--  silenciosamente el Implemento Usado.»
--
-- El autocompletado se pone en la BASE y no en el formulario. Dos
-- razones: la importación masiva del histórico no pasa por el
-- formulario, y la edición en línea de /labores tampoco. Una regla que
-- vive en un solo sitio no se olvida en los otros dos.
--
-- Retrocompatibilidad, que es lo que más importa aquí:
--
--   · Sólo rellena cuando `implemento_id` viene VACÍO. Una fila del
--     histórico que trae su código SAP escrito lo conserva tal cual.
--   · Si el código físico todavía no está emparejado con un tipo, no
--     pasa nada: el implemento queda nulo, como hasta ahora, y la fila
--     entra igual. Nada de esto es obligatorio.
-- =====================================================================

create or replace function public.fn_completar_implemento_del_fisico()
returns trigger
language plpgsql security invoker as $$
declare
    v_tipo uuid;
begin
    if new.implemento_fisico_id is null or new.implemento_id is not null then
        return new;
    end if;

    select f.implemento_id into v_tipo
    from public.implementos_fisicos f
    where f.id = new.implemento_fisico_id;

    -- `v_tipo` nulo es un caso válido: el código físico existe pero
    -- todavía no tiene tipo asignado en el catálogo.
    new.implemento_id := v_tipo;
    return new;
end;
$$;

comment on function public.fn_completar_implemento_del_fisico() is
    'Rellena `registros.implemento_id` a partir del código físico cuando viene vacío. No pisa lo que ya trae escrito: la importación del histórico manda sobre el catálogo.';

drop trigger if exists trg_completar_implemento on public.registros;
create trigger trg_completar_implemento
    before insert or update of implemento_fisico_id, implemento_id
    on public.registros
    for each row execute function public.fn_completar_implemento_del_fisico();

-- Lo ya capturado se empareja de una vez. Sólo donde falta el tipo y el
-- catálogo sabe cuál es: ni una fila con dato se toca.
update public.registros r
   set implemento_id = f.implemento_id
  from public.implementos_fisicos f
 where f.id = r.implemento_fisico_id
   and r.implemento_id is null
   and f.implemento_id is not null;

-- «Eliminar el campo "Implementos permitidos". Mantener únicamente
--  "Código físico del implemento".»
--
-- La tabla NO se borra: es la que sostiene los registros viejos que se
-- capturaron con ella y borrarla no tiene vuelta atrás. Deja de
-- alimentarse desde la pantalla y queda marcada para quien la mire.
comment on table public.labores_implementos is
    'OBSOLETA desde la migración 31. La lista de implementos por labor ahora se deduce de los códigos físicos vinculados (`labores_implementos_fisicos` → `implementos_fisicos.implemento_id`). Se conserva sólo por el histórico.';


-- ---------------------------------------------------------------------
-- La edición en línea de /labores también elige el código físico
-- ---------------------------------------------------------------------
-- Cambia la lista de argumentos, así que hay que soltar la versión de la
-- migración 30: dejar las dos vivas convertiría cada llamada en una
-- ambigüedad que Postgres resuelve mal o rechaza.
-- ---------------------------------------------------------------------

drop function if exists public.fn_editar_linea_labor(uuid, uuid, uuid, uuid, boolean, numeric, uuid);

create or replace function public.fn_editar_linea_labor(
    p_detalle_id           uuid,
    p_labor_id             uuid    default null,
    p_tarea_id             uuid    default null,
    p_implemento_id        uuid    default null,
    p_quitar_implemento    boolean default false,
    p_avance_mz            numeric default null,
    p_lote_temporada_id    uuid    default null,
    p_implemento_fisico_id uuid    default null
) returns uuid
language plpgsql security invoker as $$
declare
    v_registro   public.registros%rowtype;
    v_lineas     integer;
    v_nuevo_id   uuid;
    v_horometro  uuid;
    v_cambia_reg boolean;
    v_tipo       uuid;
    v_fisico     uuid;
begin
    select r.* into v_registro
    from public.registro_detalle d
    join public.registros r on r.id = d.registro_id
    where d.id = p_detalle_id;

    if not found then
        raise exception 'La línea ya no existe. Vuelve a consultar la tabla.';
    end if;

    v_horometro := v_registro.horometro_id;

    -- Elegir el código físico arrastra el tipo, igual que en el
    -- formulario. Si el código no tiene tipo, el implemento se vacía:
    -- dejar el anterior sería atribuirle a este fierro una tarifa que no
    -- es la suya.
    if p_implemento_fisico_id is not null then
        select f.implemento_id into v_tipo
        from public.implementos_fisicos f
        where f.id = p_implemento_fisico_id;
        v_fisico := p_implemento_fisico_id;
    elsif p_quitar_implemento then
        v_tipo   := null;
        v_fisico := null;
    else
        v_tipo   := coalesce(p_implemento_id, v_registro.implemento_id);
        v_fisico := v_registro.implemento_fisico_id;
    end if;

    -- Lo que es del detalle se cambia siempre, sin separar nada.
    if p_avance_mz is not null then
        update public.registro_detalle set avance_mz = p_avance_mz where id = p_detalle_id;
    end if;
    if p_lote_temporada_id is not null then
        update public.registro_detalle
           set lote_temporada_id = p_lote_temporada_id
         where id = p_detalle_id;
    end if;

    v_cambia_reg :=
        (p_labor_id is not null and p_labor_id is distinct from v_registro.labor_id)
     or (p_tarea_id is not null and p_tarea_id is distinct from v_registro.tarea_id)
     or (v_tipo   is distinct from v_registro.implemento_id)
     or (v_fisico is distinct from v_registro.implemento_fisico_id);

    if not v_cambia_reg then
        return v_registro.id;
    end if;

    select count(*) into v_lineas
    from public.registro_detalle where registro_id = v_registro.id;

    if v_lineas <= 1 then
        -- Único lote: la labor entera ES esta línea.
        update public.registros
           set labor_id             = coalesce(p_labor_id, labor_id),
               tarea_id             = coalesce(p_tarea_id, tarea_id),
               implemento_id        = v_tipo,
               implemento_fisico_id = v_fisico
         where id = v_registro.id;
        perform public.fn_prorratear_horas_horometro(v_horometro);
        return v_registro.id;
    end if;

    -- Varios lotes: se separa. `horas_notificadas` nace en null a
    -- propósito; el prorrateo de abajo reparte las del horómetro entre
    -- todas las líneas, incluida la que se acaba de mudar.
    insert into public.registros (
        ticket_id, horometro_id, temporada_id, fecha,
        labor_id, tarea_id, implemento_id, implemento_fisico_id, comentarios, usuario_id
    )
    values (
        v_registro.ticket_id,
        v_registro.horometro_id,
        v_registro.temporada_id,
        v_registro.fecha,
        coalesce(p_labor_id, v_registro.labor_id),
        coalesce(p_tarea_id, v_registro.tarea_id),
        v_tipo,
        v_fisico,
        v_registro.comentarios,
        v_registro.usuario_id
    )
    returning id into v_nuevo_id;

    update public.registro_detalle
       set registro_id = v_nuevo_id
     where id = p_detalle_id;

    perform public.fn_prorratear_horas_horometro(v_horometro);
    return v_nuevo_id;
end;
$$;

comment on function public.fn_editar_linea_labor(uuid, uuid, uuid, uuid, boolean, numeric, uuid, uuid) is
    'Edita UNA línea de labor sin tocar los demás lotes del mismo ticket. El código físico arrastra el tipo de implemento. Si el registro tiene varios lotes y cambia algo que vive en el registro, la línea se separa a un registro nuevo y el horómetro se vuelve a prorratear.';

grant execute on function public.fn_editar_linea_labor(uuid, uuid, uuid, uuid, boolean, numeric, uuid, uuid) to authenticated;


-- =====================================================================
-- PARTE C · EL TABLERO SE OLVIDA DEL PROCESO Y BAJA AL LOTE
-- =====================================================================
-- «Eliminar el filtro Proceso. Eliminar cualquier lógica o distinción
--  subyacente entre APS, LEV o CAT.»
--
-- El plan vive por proceso, y cada proceso planifica LA MISMA área del
-- lote: APS y LEV no son dos pedazos de tierra, son dos pasadas sobre la
-- misma. Por eso, quitado el proceso, el plan de un lote es el MAYOR de
-- sus planes, nunca la suma. Sumarlos duplicaría el área de la finca y
-- todo porcentaje saldría por la mitad.
--
-- Zona y ciclo pasan a ser arreglos; `null` sigue queriendo decir «todos»
-- para no obligar a la pantalla a mandar la lista completa.
-- =====================================================================

drop function if exists public.fn_tablero_avance(uuid, uuid, uuid, uuid, uuid, uuid, date, date);
drop function if exists public.fn_tablero_por_zona(uuid, uuid, uuid, uuid, uuid, uuid, date, date);


create or replace function public.fn_tablero_avance(
    p_temporada_id       uuid,
    p_zona_ids           uuid[]     default null,
    p_lote_temporada_id  uuid       default null,
    p_ciclos             smallint[] default null,
    p_labor_id           uuid       default null,
    p_categoria_labor_id uuid       default null,
    p_desde              date       default null,
    p_hasta              date       default null
) returns table (
    labor_id        uuid,
    labor_nombre    text,
    categoria_id    uuid,
    categoria_labor text,
    area_plan       numeric,
    mz_avance       numeric,
    mz_pendiente    numeric,
    pct_avance      numeric,
    lotes_con_plan  bigint,
    lotes_tocados   bigint,
    lineas          bigint,
    primera_fecha   date,
    ultima_fecha    date
)
language sql stable security invoker as $$
    with plan_lote as (
        -- Primero el plan de cada lote en cada proceso; después el mayor.
        select x.lote_temporada_id, max(x.area) as area_plan
        from (
            select pl.lote_temporada_id, pl.proceso_id, sum(pl.area_plan) as area
            from public.planes pl
            join public.lotes_temporada lt on lt.id = pl.lote_temporada_id
            where pl.temporada_id = p_temporada_id
              and (p_zona_ids is null or lt.zona_id = any (p_zona_ids))
              and (p_lote_temporada_id is null or pl.lote_temporada_id = p_lote_temporada_id)
              and (p_ciclos is null or lt.ciclo = any (p_ciclos))
            group by pl.lote_temporada_id, pl.proceso_id
        ) x
        group by x.lote_temporada_id
    ),
    plan as (
        select coalesce(sum(area_plan), 0) as area_plan, count(*) as lotes
        from plan_lote
    ),
    hecho as (
        select lb.id                                  as labor_id,
               lb.nombre                              as labor_nombre,
               lb.categoria_labor_id                  as categoria_id,
               sum(rd.avance_mz)                      as mz,
               count(distinct rd.lote_temporada_id)   as lotes,
               count(*)                               as lineas,
               min(rd.fecha)                          as primera,
               max(rd.fecha)                          as ultima
        from public.registro_detalle rd
        join public.registros r        on r.id  = rd.registro_id
        join public.labores lb         on lb.id = r.labor_id
        join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
        where lt.temporada_id = p_temporada_id
          and rd.avance_mz is not null
          and (p_zona_ids is null or lt.zona_id = any (p_zona_ids))
          and (p_lote_temporada_id is null or rd.lote_temporada_id = p_lote_temporada_id)
          and (p_ciclos is null or rd.ciclo = any (p_ciclos))
          and (p_labor_id is null or lb.id = p_labor_id)
          and (p_categoria_labor_id is null or lb.categoria_labor_id = p_categoria_labor_id)
          and (p_desde is null or rd.fecha >= p_desde)
          and (p_hasta is null or rd.fecha <= p_hasta)
        group by lb.id, lb.nombre, lb.categoria_labor_id
    )
    select
        h.labor_id,
        h.labor_nombre,
        h.categoria_id,
        cl.nombre,
        p.area_plan,
        coalesce(h.mz, 0),
        greatest(p.area_plan - coalesce(h.mz, 0), 0),
        case when p.area_plan > 0
             then round(coalesce(h.mz, 0) * 100.0 / p.area_plan, 2)
             else null end,
        p.lotes,
        h.lotes,
        h.lineas,
        h.primera,
        h.ultima
    from hecho h
    cross join plan p
    left join public.categorias_labor cl on cl.id = h.categoria_id
    order by coalesce(h.mz, 0) desc
$$;

comment on function public.fn_tablero_avance(uuid, uuid[], uuid, smallint[], uuid, uuid, date, date) is
    'Avance por labor contra el plan del área filtrada. Sin distinción de proceso: el plan de un lote es el mayor de sus planes, porque todos los procesos recorren la misma tierra.';


create or replace function public.fn_tablero_por_zona(
    p_temporada_id       uuid,
    p_zona_ids           uuid[]     default null,
    p_lote_temporada_id  uuid       default null,
    p_ciclos             smallint[] default null,
    p_labor_id           uuid       default null,
    p_categoria_labor_id uuid       default null,
    p_desde              date       default null,
    p_hasta              date       default null
) returns table (
    zona_id       uuid,
    zona          text,
    encargado     text,
    area_plan     numeric,
    mz_avance     numeric,
    mz_pendiente  numeric,
    pct_avance    numeric,
    lotes_tocados bigint,
    ultima_fecha  date
)
language sql stable security invoker as $$
    with plan as (
        select x.zona_id, sum(x.area_plan) as area_plan
        from (
            select lt.zona_id, pl.lote_temporada_id, max(pl.area) as area_plan
            from (
                select pl.lote_temporada_id, pl.proceso_id, sum(pl.area_plan) as area
                from public.planes pl
                where pl.temporada_id = p_temporada_id
                group by pl.lote_temporada_id, pl.proceso_id
            ) pl
            join public.lotes_temporada lt on lt.id = pl.lote_temporada_id
            where (p_zona_ids is null or lt.zona_id = any (p_zona_ids))
              and (p_lote_temporada_id is null or pl.lote_temporada_id = p_lote_temporada_id)
              and (p_ciclos is null or lt.ciclo = any (p_ciclos))
            group by lt.zona_id, pl.lote_temporada_id
        ) x
        group by x.zona_id
    ),
    hecho as (
        select lt.zona_id,
               sum(rd.avance_mz)                    as mz,
               count(distinct rd.lote_temporada_id) as lotes,
               max(rd.fecha)                        as ultima
        from public.registro_detalle rd
        join public.registros r        on r.id  = rd.registro_id
        join public.labores lb         on lb.id = r.labor_id
        join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
        where lt.temporada_id = p_temporada_id
          and rd.avance_mz is not null
          and (p_zona_ids is null or lt.zona_id = any (p_zona_ids))
          and (p_lote_temporada_id is null or rd.lote_temporada_id = p_lote_temporada_id)
          and (p_ciclos is null or rd.ciclo = any (p_ciclos))
          and (p_labor_id is null or lb.id = p_labor_id)
          and (p_categoria_labor_id is null or lb.categoria_labor_id = p_categoria_labor_id)
          and (p_desde is null or rd.fecha >= p_desde)
          and (p_hasta is null or rd.fecha <= p_hasta)
        group by lt.zona_id
    ),
    -- Las zonas que salen son las del plan MÁS las que registraron algo.
    llaves as (
        select zona_id from plan
        union
        select zona_id from hecho
    )
    select
        k.zona_id,
        z.nombre,
        z.responsable,
        coalesce(p.area_plan, 0),
        coalesce(h.mz, 0),
        greatest(coalesce(p.area_plan, 0) - coalesce(h.mz, 0), 0),
        case when coalesce(p.area_plan, 0) > 0
             then round(coalesce(h.mz, 0) * 100.0 / p.area_plan, 2)
             else null end,
        coalesce(h.lotes, 0),
        h.ultima
    from llaves k
    left join plan  p on p.zona_id is not distinct from k.zona_id
    left join hecho h on h.zona_id is not distinct from k.zona_id
    left join public.zonas z on z.id = k.zona_id
    order by z.nombre nulls last
$$;

comment on function public.fn_tablero_por_zona(uuid, uuid[], uuid, smallint[], uuid, uuid, date, date) is
    'El mismo tablero abierto por zona y encargado, sin distinción de proceso.';


-- ---------------------------------------------------------------------
-- El grano fino: una fila por lote y labor, con su costo
-- ---------------------------------------------------------------------
-- «Vista de Datos (Nivel Lote). Columnas requeridas: Labor, Subtotal, Mz
--  Avanzadas, Plan, Costo Total por Actividad, Gasto Total.»
--
-- Las tres cifras de dinero contestan tres preguntas distintas y por eso
-- son tres columnas y no una:
--
--   · `subtotal`        — lo que costó ESTA labor en ESTE lote.
--   · `costo_actividad` — lo que costó esa labor en TODO lo filtrado,
--                         para saber qué parte del gasto de la actividad
--                         se fue a este lote.
--   · `gasto_lote`      — lo que lleva gastado el lote entero.
--
-- El costo sale de `v_costos_labores`, que ya reparte por lote. Se pega
-- por `detalle_id` —no por fecha ni por labor— porque la vista fecha el
-- costo con la fecha del REGISTRO y el avance se fecha con la de la
-- LÍNEA; emparejar por la llave deja los dos lados hablando de las
-- mismas filas. Y las manzanas NO se suman de la vista: ahí cada línea
-- aparece dos veces (el puesto del equipo y el del implemento) y el área
-- saldría al doble.
-- ---------------------------------------------------------------------

create or replace function public.fn_tablero_por_lote(
    p_temporada_id       uuid,
    p_zona_ids           uuid[]     default null,
    p_lote_temporada_id  uuid       default null,
    p_ciclos             smallint[] default null,
    p_labor_id           uuid       default null,
    p_categoria_labor_id uuid       default null,
    p_desde              date       default null,
    p_hasta              date       default null
) returns table (
    lote_temporada_id uuid,
    ut                text,
    lote_nombre       text,
    zona_id           uuid,
    zona              text,
    encargado         text,
    labor_id          uuid,
    labor_nombre      text,
    categoria_labor   text,
    mz_avance         numeric,
    area_plan         numeric,
    subtotal          numeric,
    costo_actividad   numeric,
    gasto_lote        numeric
)
language sql stable security invoker as $$
    with lineas as (
        select rd.id                 as detalle_id,
               rd.lote_temporada_id,
               rd.avance_mz,
               lt.zona_id,
               r.labor_id
        from public.registro_detalle rd
        join public.registros r        on r.id  = rd.registro_id
        join public.labores lb         on lb.id = r.labor_id
        join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
        where lt.temporada_id = p_temporada_id
          and (p_zona_ids is null or lt.zona_id = any (p_zona_ids))
          and (p_lote_temporada_id is null or rd.lote_temporada_id = p_lote_temporada_id)
          and (p_ciclos is null or rd.ciclo = any (p_ciclos))
          and (p_labor_id is null or lb.id = p_labor_id)
          and (p_categoria_labor_id is null or lb.categoria_labor_id = p_categoria_labor_id)
          and (p_desde is null or rd.fecha >= p_desde)
          and (p_hasta is null or rd.fecha <= p_hasta)
    ),
    plan_lote as (
        select x.lote_temporada_id, max(x.area) as area_plan
        from (
            select pl.lote_temporada_id, pl.proceso_id, sum(pl.area_plan) as area
            from public.planes pl
            where pl.temporada_id = p_temporada_id
            group by pl.lote_temporada_id, pl.proceso_id
        ) x
        group by x.lote_temporada_id
    ),
    costo as (
        select l.lote_temporada_id, l.labor_id, sum(c.costo) as costo
        from lineas l
        join public.v_costos_labores c on c.detalle_id = l.detalle_id
        group by l.lote_temporada_id, l.labor_id
    ),
    celda as (
        select l.lote_temporada_id,
               l.zona_id,
               l.labor_id,
               sum(l.avance_mz) as mz
        from lineas l
        group by l.lote_temporada_id, l.zona_id, l.labor_id
    )
    select
        ce.lote_temporada_id,
        lo.nomenclatura,
        lo.nombre,
        ce.zona_id,
        z.nombre,
        z.responsable,
        ce.labor_id,
        lb.nombre,
        cl.nombre,
        coalesce(ce.mz, 0),
        coalesce(pl.area_plan, 0),
        coalesce(co.costo, 0),
        sum(coalesce(co.costo, 0)) over (partition by ce.labor_id),
        sum(coalesce(co.costo, 0)) over (partition by ce.lote_temporada_id)
    from celda ce
    join public.lotes_temporada lt on lt.id = ce.lote_temporada_id
    join public.lotes lo           on lo.id = lt.lote_id
    join public.labores lb         on lb.id = ce.labor_id
    left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
    left join public.zonas z       on z.id = ce.zona_id
    left join plan_lote pl         on pl.lote_temporada_id = ce.lote_temporada_id
    left join costo co on co.lote_temporada_id = ce.lote_temporada_id
                      and co.labor_id          = ce.labor_id
    order by z.nombre nulls last, lo.nomenclatura, lb.nombre
$$;

comment on function public.fn_tablero_por_lote(uuid, uuid[], uuid, smallint[], uuid, uuid, date, date) is
    'Una fila por lote y labor: manzanas, plan del lote, costo de la labor en el lote, costo total de esa labor y gasto total del lote. Es la base de la cuadrícula y del resumen de costos por zona del tablero.';
