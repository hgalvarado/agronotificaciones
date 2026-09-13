-- =====================================================================
-- MIGRACIÓN 24 · El detalle dice a qué lectura de horómetro pertenece
-- =====================================================================
-- «Generar un número de índice secuencial para cada fila del Resumen de
--  Horómetros y renderizar ese mismo número junto al equipo en la tabla
--  de detalle.»
--
-- Para poder numerar hace falta poder EMPAREJAR, y hasta ahora el detalle
-- sólo devolvía el código del equipo. No alcanza: un mismo tractor puede
-- tener dos pasadas el mismo día —dos lecturas distintas, dos filas del
-- resumen— y por el código se llegaría a las dos.
--
-- La llave de una lectura es la misma con la que el resumen deduplica:
-- equipo + horómetro inicial + horómetro final. Se añaden esas dos
-- columnas al detalle y la pantalla arma el índice con ellas.
--
-- DROP + CREATE porque cambia la tabla que devuelve la función, y
-- `create or replace` sólo admite añadir al final cuando el resto
-- coincide exactamente: aquí las nuevas van en medio, junto al equipo,
-- que es donde se leen.
-- =====================================================================

drop function if exists public.fn_reporte_maquinaria_detalle(date, text, uuid, uuid);

create function public.fn_reporte_maquinaria_detalle(
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
    horometro_inicial numeric,
    horometro_final   numeric,
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
        h.horometro_inicial,
        h.horometro_final,
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
      and public.fn_nivel_proceso(t.proceso) <= public.fn_nivel_proceso(cfg.nivel_proceso)
      and (cfg.todos_departamentos or t.departamento = any (cfg.departamentos))
      and (p_departamento is null or t.departamento = p_departamento)
      and (p_usuario_id   is null or r.usuario_id  = p_usuario_id)
      and (p_ticket_id    is null or t.id          = p_ticket_id)
    -- El orden IMPORTA para la pantalla: las filas de una misma lectura
    -- tienen que salir juntas, porque el reporte dibuja una línea
    -- divisoria cada vez que cambia el bloque del tractor. Ordenado por
    -- lote, las labores del mismo equipo saldrían salteadas y la línea
    -- aparecería en cada fila.
    order by h.turno, e.codigo, h.horometro_inicial, h.horometro_final, lo.nomenclatura
$$;

comment on function public.fn_reporte_maquinaria_detalle(date, text, uuid, uuid) is
    'Detalle operativo de un día para el reporte público, con la lectura de horómetro de cada fila para poder emparejarla con el resumen. Aplica las reglas del administrador y no filtra por temporada.';

grant execute on function public.fn_reporte_maquinaria_detalle(date, text, uuid, uuid) to anon, authenticated;
