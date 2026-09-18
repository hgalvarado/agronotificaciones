-- =====================================================================
-- 45 · El historial completo de tickets, por mes y por proceso
--
-- Ejecutar en el SQL Editor DESPUÉS de la 44.
--
-- El problema: la lista traía `.limit(100)` y con eso marzo desaparecía.
-- Subir el número no es la solución —con dos años de operación son miles
-- de filas en cada navegación— y quitarlo tampoco: sería traer la tabla
-- entera al teléfono.
--
-- La forma correcta es la que usa cualquier bandeja de correo: primero el
-- ÍNDICE —cuántos hay en cada mes y en cada proceso— y después, sólo al
-- abrir un bloque, sus tickets. Y esos por páginas.
--
-- Dos funciones:
--
--   fn_tickets_resumen(...)  el árbol: mes → proceso → cuántos.
--                            Una sola consulta agregada, sin traer filas.
--   fn_tickets_pagina(...)   los tickets de UN bloque, por páginas.
--
-- Ninguna es `security definer`: se ejecutan con los permisos de quien
-- llama, así que la RLS de `tickets` sigue mandando. Un rol sin «Ver
-- todo» cuenta y pagina únicamente lo suyo, y no hace falta repetir aquí
-- ni una sola regla de permisos.
--
-- El mes se agrupa por `tickets.fecha`, que es la fecha de la JORNADA:
-- una fecha de calendario capturada en Honduras, no un instante. Por eso
-- agrupar por ella ya es agrupar en UTC-6, sin conversiones que puedan
-- correr un ticket de fin de mes al mes siguiente.
-- =====================================================================

-- Para paginar por llave hace falta un orden total y un índice que lo
-- siga. `fecha desc` ya estaba; el `id` lo vuelve único y estable, que es
-- lo que evita que un ticket se repita o se pierda entre páginas cuando
-- varios comparten fecha.
create index if not exists tickets_fecha_id_idx
    on public.tickets (fecha desc, id desc);

-- Y uno por proceso dentro de la fecha, que es como agrupa el resumen.
--
-- NO se indexa `to_char(fecha,'YYYY-MM')`: `to_char` es STABLE y no
-- IMMUTABLE —depende de la configuración regional— así que Postgres no
-- la admite en un índice. Por eso el mes se filtra como RANGO de fechas,
-- que además es lo que sabe usar este índice; `to_char` queda sólo en el
-- `group by`, sobre lo que el filtro ya recortó.
create index if not exists tickets_fecha_proceso_idx
    on public.tickets (fecha desc, proceso);

-- =====================================================================
-- El índice del historial
-- =====================================================================

/**
 * Cuántos tickets hay en cada mes y en cada proceso.
 *
 * Devuelve el árbol que dibuja la lista, sin una sola fila de detalle:
 * con dos años de operación son unas cien filas de resumen en vez de
 * miles de tickets. Los tickets de un bloque se piden aparte, y sólo
 * cuando alguien lo abre.
 *
 * Todos los filtros son opcionales y se combinan con Y. `null` o lista
 * vacía significa «no filtres por eso».
 */
create or replace function public.fn_tickets_resumen(
    p_meses      text[] default null,
    p_usuarios   uuid[] default null,
    p_procesos   text[] default null,
    p_estados    text[] default null,
    p_busqueda   text   default null
) returns table (
    mes         text,
    proceso     public.proceso_ticket,
    cuantos     bigint,
    abiertos    bigint,
    primera     date,
    ultima      date
)
language sql stable
set search_path = public, pg_temp as $$
    select to_char(t.fecha, 'YYYY-MM') as mes,
           t.proceso,
           count(*)                                          as cuantos,
           count(*) filter (where t.estado = 'ABIERTO')      as abiertos,
           min(t.fecha)                                      as primera,
           max(t.fecha)                                      as ultima
    from public.tickets t
    where (p_meses is null or cardinality(p_meses) = 0
           or exists (
               select 1 from unnest(p_meses) m
               where t.fecha >= to_date(m || '-01', 'YYYY-MM-DD')
                 and t.fecha <  (to_date(m || '-01', 'YYYY-MM-DD') + interval '1 month')
           ))
      and (p_usuarios is null or cardinality(p_usuarios) = 0
           or t.usuario_id = any(p_usuarios))
      and (p_procesos is null or cardinality(p_procesos) = 0
           or t.proceso::text = any(p_procesos))
      and (p_estados is null or cardinality(p_estados) = 0
           or t.estado::text = any(p_estados))
      and (
          coalesce(btrim(p_busqueda), '') = ''
          or t.codigo ilike '%' || btrim(p_busqueda) || '%'
          or coalesce(t.departamento, '') ilike '%' || btrim(p_busqueda) || '%'
      )
    group by 1, 2
    order by 1 desc, 2
$$;

comment on function public.fn_tickets_resumen(text[], uuid[], text[], text[], text) is
'El árbol mes → proceso con sus conteos. Sin filas de detalle: ésas las trae fn_tickets_pagina.';

grant execute on function public.fn_tickets_resumen(text[], uuid[], text[], text[], text) to authenticated;

-- =====================================================================
-- Una página de un bloque
-- =====================================================================

/**
 * Los tickets de UN mes y UN proceso, por páginas.
 *
 * Pagina por LLAVE y no por `offset`: el cursor es el último
 * (fecha, id) entregado, y la siguiente página arranca justo debajo. Con
 * `offset` grande Postgres recorre y descarta todo lo anterior en cada
 * página, y encima un ticket nuevo desplaza la lista y hace que uno se
 * repita o se salte. Con llave no pasa ninguna de las dos cosas.
 *
 * Trae el nombre de quien capturó, que es lo que la lista enseña; con un
 * `left join` para que un perfil borrado no haga desaparecer el ticket.
 */
create or replace function public.fn_tickets_pagina(
    p_mes           text,
    p_proceso       text   default null,
    p_usuarios      uuid[] default null,
    p_estados       text[] default null,
    p_busqueda      text   default null,
    p_limite        integer default 40,
    p_cursor_fecha  date   default null,
    p_cursor_id     uuid   default null
) returns table (
    id             uuid,
    codigo         text,
    fecha          date,
    estado         public.estado_ticket,
    proceso        public.proceso_ticket,
    departamento   text,
    usuario_id     uuid,
    usuario_nombre text
)
language sql stable
set search_path = public, pg_temp as $$
    select t.id, t.codigo, t.fecha, t.estado, t.proceso, t.departamento,
           t.usuario_id, pe.nombre
    from public.tickets t
    left join public.perfiles pe on pe.id = t.usuario_id
    where (
          p_mes is null
          or (t.fecha >= to_date(p_mes || '-01', 'YYYY-MM-DD')
              and t.fecha < (to_date(p_mes || '-01', 'YYYY-MM-DD') + interval '1 month'))
      )
      and (p_proceso is null or t.proceso::text = p_proceso)
      and (p_usuarios is null or cardinality(p_usuarios) = 0
           or t.usuario_id = any(p_usuarios))
      and (p_estados is null or cardinality(p_estados) = 0
           or t.estado::text = any(p_estados))
      and (
          coalesce(btrim(p_busqueda), '') = ''
          or t.codigo ilike '%' || btrim(p_busqueda) || '%'
          or coalesce(t.departamento, '') ilike '%' || btrim(p_busqueda) || '%'
      )
      -- El cursor. Los dos campos a la vez: con la fecha sola, los
      -- tickets del mismo día se repetirían en la página siguiente.
      and (
          p_cursor_fecha is null
          or (t.fecha, t.id) < (p_cursor_fecha, coalesce(p_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid))
      )
    order by t.fecha desc, t.id desc
    limit greatest(1, least(coalesce(p_limite, 40), 200))
$$;

comment on function public.fn_tickets_pagina(text, text, uuid[], text[], text, integer, date, uuid) is
'Una página de tickets de un bloque, paginada por llave (fecha, id). El cursor es la última fila entregada.';

grant execute on function public.fn_tickets_pagina(text, text, uuid[], text[], text, integer, date, uuid) to authenticated;

-- =====================================================================
-- Quiénes salen en el filtro de «Capturó»
-- =====================================================================

/**
 * Las personas que aparecen como dueñas de algún ticket VISIBLE.
 *
 * Sale de los tickets y no del directorio de personas a propósito: un
 * filtro con cien nombres que no tienen ni un ticket no filtra nada, y
 * además delataría la plantilla completa a quien sólo ve lo suyo.
 */
create or replace function public.fn_tickets_capturadores()
returns table (usuario_id uuid, nombre text, cuantos bigint)
language sql stable
set search_path = public, pg_temp as $$
    select t.usuario_id, coalesce(pe.nombre, '—'), count(*)
    from public.tickets t
    left join public.perfiles pe on pe.id = t.usuario_id
    group by 1, 2
    order by 2
$$;

grant execute on function public.fn_tickets_capturadores() to authenticated;

-- =====================================================================
-- Comprobación
-- =====================================================================
do $$
declare v_meses integer; v_total bigint;
begin
    select count(*), coalesce(sum(cuantos), 0) into v_meses, v_total
    from public.fn_tickets_resumen();

    raise notice 'Migración 45 aplicada. Bloques mes+proceso: %, tickets alcanzados: %.',
        v_meses, v_total;
    raise notice 'La lista deja de traer 100 filas: trae el índice y baja cada bloque al abrirlo.';
end $$;
