-- =====================================================================
-- MIGRACIÓN 88 · Lecturas del mismo equipo en el mismo día (aviso de registro repetido)
-- =====================================================================
-- Pedido del usuario (2026-11-11): «a veces registran un tractor con los mismos horómetros en un mismo día y con
-- el mismo operador; no le registraron labores y para ellos es más fácil volver a registrar el equipo… y cuando
-- reviso me salen dos registros del mismo equipo, uno sin labores. Quiero una advertencia, sin bloquearlos del
-- todo; si el horómetro anda malo, un botón para reportarlo».
--
-- El formulario pregunta, al elegir equipo y lecturas, qué otras lecturas tiene ESE equipo ESA fecha.
-- `security definer` como las migraciones 33 y 85: el repetido puede haberlo capturado otra persona, que el
-- capturador no ve por RLS. Devuelve lo mínimo para avisar y, si es suyo, llevarlo a ese registro: lecturas,
-- turno, operador, cuántas labores tiene, si el ticket es del que pregunta y el nombre de quien lo capturó.
-- Sólo lectura. Idempotente.
-- =====================================================================

create or replace function public.fn_horometros_mismo_dia(
    p_equipo_id uuid,
    p_fecha     date,
    p_excluir   uuid default null
)
returns table (
    id                uuid,
    ticket_id         uuid,
    turno             text,
    horometro_inicial numeric,
    horometro_final   numeric,
    operador_nombre   text,
    labores           integer,
    es_mio            boolean,
    capturo           text
)
language sql stable security definer set search_path = public, pg_temp as $$
    select h.id,
           h.ticket_id,
           h.turno::text,
           h.horometro_inicial,
           h.horometro_final,
           o.nombre,
           (select count(*) from public.registros r where r.horometro_id = h.id)::integer,
           t.usuario_id = auth.uid(),
           pe.nombre
    from public.horometros h
    join public.tickets t on t.id = h.ticket_id
    left join public.operadores o on o.id = h.operador_id
    left join public.perfiles pe on pe.id = t.usuario_id
    where auth.uid() is not null
      and h.equipo_id = p_equipo_id
      and h.fecha = p_fecha
      and (p_excluir is null or h.id <> p_excluir)
    order by h.horometro_inicial, h.created_at
    limit 20
$$;

comment on function public.fn_horometros_mismo_dia(uuid, date, uuid) is
    'Otras lecturas del mismo equipo en la misma fecha. Alimenta el aviso de registro repetido al capturar un horómetro. security definer: el repetido puede ser de otro capturador.';

revoke all on function public.fn_horometros_mismo_dia(uuid, date, uuid) from public;
grant execute on function public.fn_horometros_mismo_dia(uuid, date, uuid) to authenticated;

-- Ya existe idx_horometros_equipo_fecha_todos (85): (equipo_id, fecha desc, created_at desc).
