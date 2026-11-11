-- =====================================================================
-- MIGRACIÓN 85 · Última lectura del horómetro de un equipo (continuidad al capturar)
-- =====================================================================
-- Al revisar, Torre de Control cuadra que el horómetro inicial de cada equipo siga donde terminó el final
-- anterior. Hoy ese desfase se descubre DESPUÉS, en /horometros. Con esta función el formulario de captura
-- propone el inicial desde la última lectura y avisa en el momento si lo tecleado no sigue la secuencia.
--
-- `security definer` por la misma razón que fn_ultimo_operador_equipo (migración 33): el capturador sólo ve
-- los horómetros de SUS tickets, y el equipo pudo haberlo llevado otra persona la jornada anterior.
-- Devuelve lo mínimo: la lectura final, su fecha y su turno. Nada del ticket ni de quién lo capturó.
--
-- «Anterior» = antes de (fecha, turno) de la jornada que se captura: otro día anterior, o el mismo día en
-- turno diurno cuando se captura el nocturno. p_excluir deja fuera el propio horómetro al editarlo.
-- Usa el índice idx_horometros_equipo_fecha_todos (abajo).
-- =====================================================================

create or replace function public.fn_ultima_lectura_equipo(
    p_equipo_id uuid,
    p_fecha     date,
    p_turno     text default 'DIURNO',
    p_excluir   uuid default null
)
returns table (
    horometro_final numeric,
    fecha           date,
    turno           text
)
language sql stable security definer set search_path = public, pg_temp as $$
    select h.horometro_final, h.fecha, h.turno::text
    from public.horometros h
    where h.equipo_id = p_equipo_id
      and (p_excluir is null or h.id <> p_excluir)
      and (
            h.fecha < p_fecha
         or (h.fecha = p_fecha and upper(p_turno) = 'NOCTURNO' and h.turno::text = 'DIURNO')
      )
    order by h.fecha desc,
             (h.turno::text = 'NOCTURNO') desc,
             h.created_at desc
    limit 1
$$;

comment on function public.fn_ultima_lectura_equipo(uuid, date, text, uuid) is
    'Lectura final del horómetro anterior (fecha/turno) de un equipo. Alimenta la propuesta del horómetro inicial y el aviso de continuidad al capturar. security definer: el capturador no ve horómetros de otros.';

revoke all on function public.fn_ultima_lectura_equipo(uuid, date, text, uuid) from public;
grant execute on function public.fn_ultima_lectura_equipo(uuid, date, text, uuid) to authenticated;

-- El índice de la migración 33 es parcial (sólo con operador); éste cubre todas las lecturas del equipo.
create index if not exists idx_horometros_equipo_fecha_todos
    on public.horometros (equipo_id, fecha desc, created_at desc);
