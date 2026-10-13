-- =====================================================================
-- 72 · EL ÁREA DE DESINFECCIÓN ES DE UN CICLO, NO DE LA TEMPORADA
-- =====================================================================
--
-- ── Qué estaba mal ──────────────────────────────────────────────────
--
-- En «0. Lotes y manzanas» se elige el ciclo en la cabecera del turno,
-- pero el catálogo de lotes no se enteraba: `fn_lotes_desinfeccion`
-- pedía las manzanas a `fn_area_regable`, que suma TODOS los ciclos de
-- la temporada. Un lote de 10 mz planificado en el ciclo 1 y otra vez en
-- el ciclo 2 se ofrecía como 20 mz.
--
-- No es un número feo en una lista: la sugerencia de `mz_restantes` es
-- la que acaba escrita en el renglón, y las manzanas del turno son el
-- divisor con el que se reparte el químico. **Un área inflada es una
-- dosis mal calculada**, y eso sale al campo.
--
-- Lo mismo con lo ya desinfectado: `mz_ejecutadas` contaba las pasadas
-- de cualquier ciclo. Lo que se regó en el ciclo 1 no está hecho para el
-- ciclo 2 —es otra desinfección, con otro producto y otra fecha—, así
-- que descontarlo dejaba el lote en «no queda nada» cuando quedaba todo.
--
-- ── Qué se hace ─────────────────────────────────────────────────────
--
-- La función gana `p_ciclo`. Con ciclo, las planeadas salen de
-- `fn_area_lote_ciclo` —la misma que riego usa desde la 68— y las
-- ejecutadas se recortan a las ejecuciones de ESE ciclo. Sin ciclo
-- (`null`) se comporta como siempre: la pestaña de desinfección enseña
-- el catálogo de la temporada entera y ahí la suma sí es lo que se
-- quiere.
--
-- ── Lo que NO se puede perder ───────────────────────────────────────
--
-- Es `security definer`. La reja zonal estricta de la 67
-- —`fn_ve_zona_estricta`— y la puerta de pantalla `fn_permitido_de` van
-- íntegras: si no se comprueban aquí, no las comprueba nadie. Los
-- guardianes del pie vuelven a exigirlas, y ahora también el ciclo.
--
-- Y la trampa de siempre: cambiar la lista de argumentos con
-- `create or replace` deja DOS funciones con el mismo nombre y la
-- llamada por RPC pasa a ser ambigua. Se suelta la firma vieja primero.
-- =====================================================================

-- =====================================================================
-- A · LOS LOTES, RECORTADOS AL CICLO QUE SE ESTÁ CAPTURANDO
-- =====================================================================

-- La de la 67 (tres argumentos). Si no se suelta, la nueva se suma en
-- vez de sustituirla y PostgREST contesta «function is not unique».
drop function if exists public.fn_lotes_desinfeccion(uuid, uuid, text);

create function public.fn_lotes_desinfeccion(
    p_temporada_id uuid,
    p_ejecucion_id uuid default null,
    p_pantalla     text default 'desinfeccion_ejecucion',
    p_ciclo        integer default null
) returns table (
    lote_temporada_id uuid,
    nomenclatura      text,
    lote_nombre       text,
    zona_id           uuid,
    area_neta         numeric,
    mz_planeadas      numeric,
    mz_ejecutadas     numeric,
    mz_restantes      numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
    select
        lt.id,
        lo.nomenclatura,
        lo.nombre,
        lt.zona_id,
        coalesce(lt.area_neta, 0),
        -- **El área del ciclo, no la de la temporada.** `fn_area_regable`
        -- es exactamente esto con `p_ciclo => null`, así que pasar el
        -- ciclo no cambia el criterio (sembrado > planificado > neta):
        -- sólo deja de sumar los demás ciclos.
        coalesce(public.fn_area_lote_ciclo(lt.id, p_ciclo), 0)  as mz_planeadas,
        coalesce(d.hechas, 0)                                   as mz_ejecutadas,
        greatest(
            coalesce(public.fn_area_lote_ciclo(lt.id, p_ciclo), 0) - coalesce(d.hechas, 0), 0
        )                                                       as mz_restantes
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    left join lateral (
        select sum(dl.mz_cubiertas) as hechas
        from public.desinfeccion_ejecucion_lotes dl
        join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
        where dl.lote_temporada_id = lt.id
          and e.temporada_id = p_temporada_id
          -- Lo regado en el ciclo 1 no está hecho para el ciclo 2: es
          -- otra desinfección, con otro producto y otra fecha.
          and (p_ciclo is null or e.ciclo = p_ciclo)
          and (p_ejecucion_id is null or e.id <> p_ejecucion_id)
    ) d on true
    where lt.temporada_id = p_temporada_id
      and lt.activo
      -- Sin permiso de ver esa pantalla no hay lotes que ofrecer. Es
      -- `security definer`: si no se comprueba aquí, no lo comprueba
      -- nadie.
      and (select public.fn_permitido_de(p_pantalla, 'ver'))
      -- Y el recorte zonal, con la ESTRICTA de la 66/67: sin zonas
      -- asignadas no se ve nada, y un lote sin zona tampoco. Un lote sin
      -- zona es un dato incompleto, no un pase libre.
      and case (select public.fn_mi_alcance(p_pantalla, 'ver'))
          when 'global'      then true
          -- Un lote no tiene dueño: el alcance «propietario» sobre un
          -- catálogo no puede recortar por ahí, así que recorta igual
          -- que el zonal. Dejarlo en `true` sería la fuga de siempre.
          else (select public.fn_ve_zona_estricta(lt.zona_id))
      end
    order by lo.nomenclatura
$$;

comment on function public.fn_lotes_desinfeccion(uuid, uuid, text, integer) is
    'Los lotes de la temporada con sus manzanas pendientes EN UN CICLO, ya recortados por la zona del usuario.';

grant execute on function public.fn_lotes_desinfeccion(uuid, uuid, text, integer) to authenticated;

-- =====================================================================
-- B · LOS GUARDIANES
-- =====================================================================

do $$
declare v_def text;
begin
    -- Una sola. Dos firmas con el mismo nombre hacen que la llamada por
    -- RPC —que va por nombre de argumento— deje de resolverse.
    if (select count(*) from pg_proc p
         where p.pronamespace = 'public'::regnamespace::oid
           and p.proname = 'fn_lotes_desinfeccion') <> 1
    then
        raise exception 'Hay más de una fn_lotes_desinfeccion: la llamada sería ambigua.';
    end if;

    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace::oid
       and p.proname = 'fn_lotes_desinfeccion';

    -- La fuga de la 67: la función tiene que mirar la zona. Es definer,
    -- así que si no la mira ella no la mira nadie.
    if v_def !~ 'fn_ve_zona_estricta' then
        raise exception 'fn_lotes_desinfeccion volvió a quedarse sin recorte zonal.';
    end if;

    if v_def !~ 'fn_permitido_de' then
        raise exception 'fn_lotes_desinfeccion volvió a quedarse sin puerta de pantalla.';
    end if;

    -- Y lo que viene a arreglar esta migración, por si una edición futura
    -- lo deshace sin darse cuenta.
    if v_def !~ 'fn_area_lote_ciclo' then
        raise exception 'fn_lotes_desinfeccion volvió a sumar el área de todos los ciclos.';
    end if;

    if v_def !~ 'e\.ciclo' then
        raise exception 'fn_lotes_desinfeccion volvió a descontar lo ejecutado en otros ciclos.';
    end if;

    if not exists (
        select 1 from pg_proc p
         where p.pronamespace = 'public'::regnamespace::oid
           and p.proname = 'fn_lotes_desinfeccion'
           and p.pronargs = 4)
    then
        raise exception 'fn_lotes_desinfeccion no recibe el ciclo.';
    end if;
end $$;
