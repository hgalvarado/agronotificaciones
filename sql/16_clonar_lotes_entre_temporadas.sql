-- =====================================================================
-- MIGRACIÓN 16 · Clonar los lotes de una temporada a otra
-- =====================================================================
-- «Clonado masivo de lotes: copiar lotes de una temporada origen a una
--  temporada destino. Copiar exactamente: nombre, lote, zona, áreas,
--  ciclo y estado. Si el lote ya existe en la temporada de destino, se
--  actualizan sus datos; si no existe, se inserta como nuevo.»
--
-- Va en la base y no en el navegador por tres razones:
--
--   1. Es un solo `insert … on conflict do update`, o sea una sola
--      sentencia atómica. Hecho en el navegador serían 400 viajes y, si
--      se corta la red a la mitad, la temporada nueva queda incompleta
--      sin que nadie sepa dónde se quedó.
--   2. `nombre` y `lote` no se copian: viven en `lotes`, que es el lote
--      FÍSICO y no cambia de temporada a temporada. La fila nueva apunta
--      al mismo lote, así que el nombre y la nomenclatura son los
--      mismos por construcción —y si mañana se corrige el nombre, se
--      corrige en las dos temporadas a la vez, que es lo correcto—.
--      Lo que de verdad se copia es lo que sí es por temporada: zona,
--      área bruta, área neta, ciclo y estado.
--   3. El `on conflict` se apoya en el índice único
--      `lotes_temporada (lote_id, temporada_id)` que ya existe desde la
--      migración 01. Esa es la regla de upsert: un lote no puede estar
--      dos veces en la misma temporada.
--
-- Se queda como `security invoker`: quien clona necesita permiso real de
-- insertar y actualizar en `lotes_temporada`, y las policies deciden.
-- =====================================================================

create or replace function public.fn_clonar_lotes_temporada(
    p_origen_id  uuid,
    p_destino_id uuid,
    /** Filas de la temporada origen a copiar. En null, todas. */
    p_lote_temporada_ids uuid[] default null
) returns table (
    insertados   integer,
    actualizados integer
)
language plpgsql volatile security invoker as $$
declare
    v_ins integer := 0;
    v_upd integer := 0;
    v_origen integer := 0;
begin
    if p_origen_id is null or p_destino_id is null then
        raise exception 'Hay que indicar la temporada de origen y la de destino.';
    end if;

    if p_origen_id = p_destino_id then
        raise exception 'La temporada de origen y la de destino son la misma. Elige dos distintas.';
    end if;

    if not exists (select 1 from public.temporadas t where t.id = p_destino_id) then
        raise exception 'La temporada de destino no existe.';
    end if;

    select count(*) into v_origen
    from public.lotes_temporada lt
    where lt.temporada_id = p_origen_id
      and (p_lote_temporada_ids is null or lt.id = any(p_lote_temporada_ids));

    if v_origen = 0 then
        raise exception 'La temporada de origen no tiene lotes que copiar.';
    end if;

    -- `xmax = 0` distingue lo insertado de lo actualizado dentro del
    -- mismo upsert: en una fila recién insertada xmax vale 0.
    with origen as (
        select lt.lote_id, lt.zona_id, lt.area_bruta, lt.area_neta, lt.ciclo, lt.activo
        from public.lotes_temporada lt
        where lt.temporada_id = p_origen_id
          and (p_lote_temporada_ids is null or lt.id = any(p_lote_temporada_ids))
    ),
    guardado as (
        insert into public.lotes_temporada
            (lote_id, temporada_id, zona_id, area_bruta, area_neta, ciclo, activo)
        select o.lote_id, p_destino_id, o.zona_id, o.area_bruta, o.area_neta, o.ciclo, o.activo
        from origen o
        on conflict (lote_id, temporada_id) do update
            set zona_id    = excluded.zona_id,
                area_bruta = excluded.area_bruta,
                area_neta  = excluded.area_neta,
                ciclo      = excluded.ciclo,
                activo     = excluded.activo
        returning (xmax = 0) as fue_insercion
    )
    select
        count(*) filter (where g.fue_insercion),
        count(*) filter (where not g.fue_insercion)
    into v_ins, v_upd
    from guardado g;

    return query select v_ins, v_upd;
end;
$$;

comment on function public.fn_clonar_lotes_temporada(uuid, uuid, uuid[]) is
    'Copia las asignaciones de lotes de una temporada a otra. Upsert por (lote, temporada): si el lote ya está en el destino, se actualizan zona, áreas, ciclo y estado.';
