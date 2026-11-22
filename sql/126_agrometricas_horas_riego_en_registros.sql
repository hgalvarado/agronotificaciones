-- =====================================================================
-- 126 · AGROMÉTRICAS · HORAS DE RIEGO Y % DE FERTILIZACIÓN EN «REGISTROS DE LA TEMPORADA»
-- =====================================================================
-- Pedido del usuario (2026-11-22): las horas de riego y el % de fertilización son un parámetro más. Viven en Fertirriego
-- (`fert_bitacora_riego`: UNA fila por turno_ciclo_id y fecha, desde la 91; % desde la 112) y aquí se unen a los registros de
-- AgroMétricas por (turno_ciclo_id, fecha).
--
-- fn_agm_mis_registros se redefine (misma firma y mismos filtros que en la 125) para que cada registro traiga
--   horas_riego, horas_fertilizacion y pct_fertilizacion del MISMO turno y día. Como la clave de la bitácora es (turno, fecha) no hay
--   nada que sumar ni ponderar: se devuelve el valor tal cual (un turno solo tiene un registro de horas por día).
-- Los días con horas/% pero SIN parámetros salen como filas del turno con `solo_horas = true`: id «h:<turno_ciclo_id>:<fecha>»
--   (texto, no es un uuid de agm_parametros), sin valores de parámetros, `puede_editar = false` y `puede_eliminar = false` (se corrigen
--   en Fertirriego › Horas, no aquí). Entran en `total`, en la paginación y en todos los filtros (turno, temporada, zona, lote,
--   fechas, texto), igual que un registro normal.
--
-- Permisos: SECURITY DEFINER con search_path fijo. Una fila (con o sin parámetros) solo sale si la persona ve ese turno según
--   AgroMétricas · ver en la zona del turno (o es administrador): la misma regla de la 125 (`_agm_puede_ver_registro`). No se lee
--   ni se devuelve ninguna otra columna de Fertirriego (ni cantidades, ni productos, ni ejecutores, ni horas de inicio/fin ni cloro).
--   Un turno archivado (Terminar ciclo, 102) ya no tiene bitácora en Supabase: no hay horas que mostrar (sus parámetros siguen igual).
--
-- Requiere 125 y 112 (columna pct_fertilizacion). Idempotente (create or replace; sin DDL destructivo; sin UPDATE/DELETE).
-- ÓRDENES: la 125 también define fn_agm_mis_registros: si se vuelve a correr la 125 (o la 109/122 y luego la 125), correr la 126 DESPUÉS.
-- =====================================================================

do $$
begin
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'fert_bitacora_riego' and column_name = 'pct_fertilizacion') then
        raise exception 'Falta la migración 112 (fert_bitacora_riego.pct_fertilizacion). Córrela antes que la 126.';
    end if;
    if to_regprocedure('public._agm_puede_ver_registro(uuid, uuid)') is null then
        raise exception 'Falta la migración 125. Córrela antes que la 126.';
    end if;
end $$;

/**
 * p = {temporada?, turno? (código EXACTO), turno_contiene?, turno_ciclo_id?, zona_id?, desde?, hasta?, texto?, limite? (50, máx. 1000),
 *      pagina? (desde 0), orden? 'desc'|'asc', lote?, lotes?}
 * -> {total, limite, pagina, registros: [...]}. Cada registro: lo de la 125 + horas_riego, horas_fertilizacion, pct_fertilizacion,
 *    solo_horas (true = día con horas/% y sin parámetros; id «h:<turno_ciclo_id>:<fecha>», valores de parámetros ausentes).
 */
create or replace function public.fn_agm_mis_registros(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_p     jsonb := coalesce(p, '{}'::jsonb);
    v_lim   integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 50), 1), 1000);
    v_pag   integer := greatest(coalesce(nullif(v_p ->> 'pagina', '')::integer, 0), 0);
    v_asc   boolean := lower(coalesce(v_p ->> 'orden', 'desc')) = 'asc';
    v_temp  text := nullif(btrim(v_p ->> 'temporada'), '');
    v_turno text := nullif(btrim(v_p ->> 'turno'), '');
    v_turno_c text := nullif(btrim(v_p ->> 'turno_contiene'), '');
    v_tc    uuid := nullif(v_p ->> 'turno_ciclo_id', '')::uuid;
    v_zona  uuid := nullif(v_p ->> 'zona_id', '')::uuid;
    v_desde date := nullif(v_p ->> 'desde', '')::date;
    v_hasta date := nullif(v_p ->> 'hasta', '')::date;
    v_txt   text := nullif(btrim(v_p ->> 'texto'), '');
    v_lotes text[];
    v_total integer;
    v_regs  jsonb;
    v_elim  boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    v_elim := public._agm_puede_eliminar_registro();
    select array_agg(distinct btrim(q.x)) into v_lotes
      from (select x from jsonb_array_elements_text(case when jsonb_typeof(v_p -> 'lotes') = 'array' then v_p -> 'lotes' else '[]'::jsonb end) x
            union all select v_p ->> 'lote') q
     where nullif(btrim(q.x), '') is not null;

    with base as (
        -- 1) registros de parámetros (no eliminados)
        select a.id as pid, a.fecha, tc.id as tcid, tu.codigo, a.creado_por, tc.temporada,
               coalesce(e.zona_id, tc.zona_id) as zona_id,
               concat_ws(' ', tu.codigo, z.nombre, e.nombre, pf.nombre, a.comentario, a.id_appsheet, a.fecha::text) as txt
          from public.agm_parametros a
          join public.turnos_ciclo tc on tc.id = a.turno_ciclo_id
          join public.turnos tu on tu.id = tc.turno_id
          left join public.estaciones_riego e on e.id = tc.estacion_id
          left join public.zonas z on z.id = coalesce(e.zona_id, tc.zona_id)
          left join public.perfiles pf on pf.id = a.creado_por
         where a.eliminado_en is null
        union all
        -- 2) días con horas/% de Fertirriego y SIN parámetros vivos de ese turno y día
        select null::uuid, b.fecha, tc.id, tu.codigo, null::uuid, tc.temporada,
               coalesce(e.zona_id, tc.zona_id),
               concat_ws(' ', tu.codigo, z.nombre, e.nombre, b.comentario, b.fecha::text)
          from public.fert_bitacora_riego b
          join public.turnos_ciclo tc on tc.id = b.turno_ciclo_id
          join public.turnos tu on tu.id = tc.turno_id
          left join public.estaciones_riego e on e.id = tc.estacion_id
          left join public.zonas z on z.id = coalesce(e.zona_id, tc.zona_id)
         where (b.horas_riego is not null or b.horas_fertilizacion is not null or b.pct_fertilizacion is not null)
           and not exists (select 1 from public.agm_parametros a2
                            where a2.turno_ciclo_id = b.turno_ciclo_id and a2.fecha = b.fecha and a2.eliminado_en is null)
    ), f as (
        select x.pid, x.fecha, x.tcid, x.codigo
          from base x
         where (v_temp is null or x.temporada = v_temp)
           and (v_tc is null or x.tcid = v_tc)
           and (v_turno is null or lower(btrim(x.codigo)) = lower(v_turno))
           and (v_turno_c is null or x.codigo ilike '%' || v_turno_c || '%')
           and (v_zona is null or x.zona_id = v_zona)
           and (v_lotes is null or exists (select 1 from public.turno_lotes tl where tl.turno_ciclo_id = x.tcid and tl.lote = any (v_lotes)))
           and (v_desde is null or x.fecha >= v_desde)
           and (v_hasta is null or x.fecha <= v_hasta)
           and (v_txt is null or x.txt ilike '%' || v_txt || '%')
           and public._agm_puede_ver_registro(x.creado_por, x.tcid)
    ), pg as (
        select f.pid, f.fecha, f.tcid, f.codigo from f
         order by case when v_asc then f.fecha end asc, case when not v_asc then f.fecha end desc, f.codigo, f.pid nulls last, f.tcid
         limit v_lim offset v_pag * v_lim
    )
    select (select count(*) from f),
           coalesce(jsonb_agg(
               (case when pg.pid is not null
                     then to_jsonb(a) - array['bajado_a_agl_en', 'huella', 'creado_por', 'actualizado_por', 'editado_por',
                                              'eliminado_en', 'eliminado_por', 'eliminado_motivo']
                     else jsonb_build_object(
                              'id', 'h:' || pg.tcid::text || ':' || pg.fecha::text, 'fecha', pg.fecha, 'turno_ciclo_id', pg.tcid,
                              'ddt', case when tc.fecha_siembra is not null then pg.fecha - tc.fecha_siembra end,
                              'fuera_rango', '[]'::jsonb, 'comentario', b.comentario, 'origen', 'FERTIRRIEGO') end)
               || jsonb_build_object(
                   'turno', tu.codigo, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
                   'estacion', e.nombre, 'zona_id', coalesce(e.zona_id, tc.zona_id), 'zona', z.nombre,
                   'lotes', coalesce((select jsonb_agg(jsonb_build_object('lote', tl.lote, 'nombre', tl.nombre) order by tl.lote)
                                        from public.turno_lotes tl where tl.turno_ciclo_id = tc.id), '[]'::jsonb),
                   'creado_por_nombre', case when pg.pid is null then pb.nombre else pf.nombre end,
                   'creado_por_email', case when pg.pid is null
                                            then (select lower(u.email) from auth.users u where u.id = b.updated_by)
                                            else (select lower(u.email) from auth.users u where u.id = a.creado_por) end,
                   'editado_por_nombre', pe.nombre,
                   'horas_riego', b.horas_riego, 'horas_fertilizacion', b.horas_fertilizacion, 'pct_fertilizacion', b.pct_fertilizacion,
                   'solo_horas', pg.pid is null,
                   'puede_editar', pg.pid is not null and public._agm_puede_editar_registro(a.creado_por, a.turno_ciclo_id),
                   'puede_eliminar', pg.pid is not null and v_elim)
               order by case when v_asc then pg.fecha end asc, case when not v_asc then pg.fecha end desc,
                        tu.codigo, pg.pid nulls last, pg.tcid), '[]'::jsonb)
      into v_total, v_regs
      from pg
      join public.turnos_ciclo tc on tc.id = pg.tcid
      join public.turnos tu on tu.id = tc.turno_id
      left join public.agm_parametros a on a.id = pg.pid
      left join public.fert_bitacora_riego b on b.turno_ciclo_id = pg.tcid and b.fecha = pg.fecha
      left join public.estaciones_riego e on e.id = tc.estacion_id
      left join public.zonas z on z.id = coalesce(e.zona_id, tc.zona_id)
      left join public.perfiles pf on pf.id = a.creado_por
      left join public.perfiles pb on pb.id = b.updated_by
      left join public.perfiles pe on pe.id = a.editado_por;
    return jsonb_build_object('total', v_total, 'limite', v_lim, 'pagina', v_pag, 'registros', v_regs);
end
$$;
revoke execute on function public.fn_agm_mis_registros(jsonb) from public, anon;
grant  execute on function public.fn_agm_mis_registros(jsonb) to authenticated;
