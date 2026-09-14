-- ===================================================================
-- 37 · Zona horaria: la base también cuenta los días en Honduras
-- ===================================================================
--
-- El problema, en una línea: Supabase corre en UTC. A las 6 de la tarde
-- de Honduras la base ya cree que es mañana, así que `now()::date` da el
-- día siguiente, un `timestamptz` leído en el SQL Editor sale con seis
-- horas de más y cualquier reporte que compare «hoy» se corre un día.
--
-- Qué NO cambia esto: los datos guardados. Un `timestamptz` es un
-- instante, y el instante es el mismo se mire desde donde se mire; lo
-- único que cambia es en qué reloj se LEE. Y una `date` —la fecha de la
-- jornada— nunca tuvo hora ni zona: es un día del calendario, y sigue
-- siéndolo. Por eso esta migración no toca una sola fila.
--
-- Qué sí cambia:
--   1. La zona por omisión de las sesiones, para que leer una tabla en el
--      SQL Editor enseñe la hora de la finca y no la de Greenwich.
--   2. Una función `fn_hoy()` con la que todo SQL futuro pueda preguntar
--      «qué día es hoy» sin volver a caer en la misma trampa.
--
-- Es idempotente: se puede correr dos veces sin consecuencias.
-- ===================================================================

-- -------------------------------------------------------------------
-- 1 · La zona por omisión de la base
-- -------------------------------------------------------------------
-- `alter database` deja el ajuste puesto para TODA sesión nueva, incluida
-- la del SQL Editor y la de PostgREST. Si el rol que corre esto no es
-- dueño de la base, el bloque se calla en vez de tumbar la migración: la
-- parte que de verdad importa —`fn_hoy`— no depende de esto.
do $$
declare
    v_base text := current_database();
begin
    execute format('alter database %I set timezone to %L', v_base, 'America/Tegucigalpa');
    raise notice 'Zona horaria de % fijada en America/Tegucigalpa.', v_base;
exception
    when insufficient_privilege then
        raise notice 'Sin permiso para cambiar la zona de la base; fn_hoy() funciona igual.';
end
$$;

-- Que la sesión actual ya lo note, sin tener que reconectar.
set timezone to 'America/Tegucigalpa';

-- -------------------------------------------------------------------
-- 2 · «Hoy», sin depender de cómo esté configurado el servidor
-- -------------------------------------------------------------------
-- Pide la zona de forma explícita, así que da el día correcto aunque
-- mañana alguien mueva el ajuste de arriba, o aunque la base se restaure
-- en otro proyecto. `stable` y no `immutable` porque cambia con el reloj:
-- marcarla inmutable dejaría que el planificador la congelara en un
-- índice, que es exactamente el error que nadie encuentra hasta enero.
create or replace function public.fn_hoy()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
    select (now() at time zone 'America/Tegucigalpa')::date;
$$;

comment on function public.fn_hoy() is
    'El día del calendario en Honduras (UTC-6). Úsala en vez de current_date: '
    'el servidor corre en UTC y current_date adelanta el día desde las 6 de la tarde.';

grant execute on function public.fn_hoy() to anon, authenticated;

-- -------------------------------------------------------------------
-- 3 · Comprobación
-- -------------------------------------------------------------------
-- No cambia nada: sólo deja constancia en el log de que la cuenta salió.
do $$
declare
    v_utc  date := (now() at time zone 'UTC')::date;
    v_hn   date := public.fn_hoy();
    v_nota text := case
        when v_utc = v_hn then '(coinciden: no estamos en la franja del error)'
        else '(NO coinciden: justo la franja de las 6 pm a medianoche donde fallaba)'
    end;
begin
    raise notice 'UTC dice % · Honduras dice % %', v_utc, v_hn, v_nota;
end
$$;
