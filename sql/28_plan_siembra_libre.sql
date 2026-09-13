-- =====================================================================
-- MIGRACIÓN 28 · El plan de siembra deja de ser único por lote+ciclo+variedad
-- =====================================================================
-- Un mismo lote SÍ puede planificarse varias veces con la misma variedad
-- y el mismo ciclo: se siembra en fechas distintas, o con distancias
-- distintas. Cada una es una línea de planificación por derecho propio.
--
-- La restricción `unique (lote_temporada_id, ciclo, variedad_id)` de la
-- migración 26 asumía lo contrario, y por eso la carga masiva reventaba
-- con «ON CONFLICT DO UPDATE command cannot affect row a second time»
-- en cuanto el archivo traía dos líneas del mismo lote.
--
-- Se quita la restricción y la carga pasa a ser REEMPLAZO POR LOTE, que
-- es la única forma de volver a subir el archivo corregido sin duplicar
-- y sin bloquear combinaciones repetidas.
-- =====================================================================


-- =====================================================================
-- PARTE A · FUERA LA UNICIDAD
-- =====================================================================
-- Por nombre no: la restricción pudo nacer con el nombre que Postgres le
-- puso sola (`planes_siembra_lote_temporada_id_ciclo_variedad_id_key`) o
-- con otro si alguien la recreó a mano. Se busca por LO QUE HACE —una
-- restricción única exactamente sobre esas tres columnas— y se cae esa.
-- =====================================================================

do $$
declare
    r record;
begin
    for r in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
        where ns.nspname = 'public'
          and rel.relname = 'planes_siembra'
          and con.contype in ('u', 'p')
          and con.contype = 'u'
          and (
            select array_agg(att.attname::text order by att.attname)
            from unnest(con.conkey) k
            join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k
          ) = array['ciclo', 'lote_temporada_id', 'variedad_id']
    loop
        execute format('alter table public.planes_siembra drop constraint %I', r.conname);
        raise notice 'Restricción única eliminada: %', r.conname;
    end loop;
end
$$;

-- Y el índice único suelto, por si alguna vez se creó sin restricción.
do $$
declare
    r record;
begin
    for r in
        select cls.relname
        from pg_index idx
        join pg_class cls on cls.oid = idx.indexrelid
        join pg_class rel on rel.oid = idx.indrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
        where ns.nspname = 'public'
          and rel.relname = 'planes_siembra'
          and idx.indisunique
          and not idx.indisprimary
          and (
            select array_agg(att.attname::text order by att.attname)
            from unnest(idx.indkey::smallint[]) k
            join pg_attribute att on att.attrelid = idx.indrelid and att.attnum = k
          ) = array['ciclo', 'lote_temporada_id', 'variedad_id']
    loop
        execute format('drop index if exists public.%I', r.relname);
        raise notice 'Índice único eliminado: %', r.relname;
    end loop;
end
$$;

-- Lo que sí conviene tener: un índice NO único para buscar por lote, que
-- es como consulta la pantalla y como borra la carga masiva.
create index if not exists idx_plan_siembra_lote
    on public.planes_siembra (lote_temporada_id, ciclo);

comment on table public.planes_siembra is
    'Plan de siembra: registro libre de planificación. Un lote puede repetir variedad y ciclo tantas veces como haga falta (fechas o distancias distintas); no hay ninguna combinación prohibida.';


-- =====================================================================
-- PARTE B · LA CARGA MASIVA, EN UNA SOLA TRANSACCIÓN
-- =====================================================================
-- «Elimina primero los registros previos de los lotes contenidos en el
-- Excel y luego inserta los nuevos.»
--
-- Son dos escrituras y tienen que ser una sola cosa: si la red se corta
-- entre el borrado y la inserción, esos lotes se quedan SIN PLAN, que es
-- peor que no haber importado nada. Por eso vive en la base y no en el
-- navegador.
--
-- El alcance del borrado son los lotes que vienen en el archivo, no la
-- temporada entera: subir el plan de una zona no puede llevarse por
-- delante el de las demás.
-- =====================================================================

create or replace function public.fn_cargar_plan_siembra(
    p_temporada_id uuid,
    p_filas        jsonb
) returns integer
language plpgsql security invoker as $$
declare
    v_lotes  uuid[];
    v_filas  integer;
begin
    if p_filas is null
       or jsonb_typeof(p_filas) <> 'array'
       or jsonb_array_length(p_filas) = 0 then
        return 0;
    end if;

    select array_agg(distinct (f->>'lote_temporada_id')::uuid)
      into v_lotes
      from jsonb_array_elements(p_filas) f;

    delete from public.planes_siembra
     where temporada_id = p_temporada_id
       and lote_temporada_id = any(v_lotes);

    insert into public.planes_siembra (
        temporada_id, lote_temporada_id, ciclo, variedad_id,
        fecha_siembra, area_plan, distancia_siembra
    )
    select
        p_temporada_id,
        (f->>'lote_temporada_id')::uuid,
        (f->>'ciclo')::smallint,
        (f->>'variedad_id')::uuid,
        nullif(f->>'fecha_siembra', '')::date,
        (f->>'area_plan')::numeric,
        nullif(f->>'distancia_siembra', '')
    from jsonb_array_elements(p_filas) f;

    get diagnostics v_filas = row_count;
    return v_filas;
end;
$$;

comment on function public.fn_cargar_plan_siembra(uuid, jsonb) is
    'Carga masiva del plan: reemplaza por completo el plan de los lotes que vengan en el archivo y deja intacto el del resto. Borrado e inserción en una sola transacción.';

grant execute on function public.fn_cargar_plan_siembra(uuid, jsonb) to authenticated;
