-- =====================================================================
-- 80 · REPORTE: LOTE PLANIFICADO CONTRA REAL · RIEGO: TOPE POR CICLO
--
-- Ejecutar en el SQL Editor DESPUÉS de la 79.
--
--   A · `v_siembras` gana `plan_lotes`: la nomenclatura de los lotes que
--       el plan de siembra programó para esa MISMA fecha y ciclo, en la
--       temporada. Texto separado por coma (string_agg sobre texto, nunca
--       array_agg de text[]). NO se llama `plan_lote`: ese nombre ya existe
--       en la vista desde la 26 y es NUMÉRICO (las mz del plan del lote;
--       la cuadrícula de siembra y el % de cumplimiento lo leen).
--
--   B · Riego. El disparador `fn_validar_area_turno` (40) comparaba contra
--       el área de TODOS los ciclos del lote y sumaba lo asignado en turnos
--       de TODOS los ciclos, mientras el modal ya mostraba el saldo del
--       ciclo (68). Con un turno de ciclo 2 sobre un lote regado en el
--       ciclo 1, la base rechazaba cualquier área. Ahora todo es del CICLO
--       del turno.
--
--   C · Riego. El TOPE deja de ser «lo sembrado manda aunque sea menos que
--       el plan» (68): es el MAYOR de lo sembrado y lo planificado en el
--       ciclo; si los dos son cero, el área neta del lote. Un lote sin plan
--       pero con 3 mz sembradas topa en 3, no en 0. Función propia,
--       `fn_tope_riego_lote_ciclo`: `fn_area_lote_ciclo` NO se toca porque
--       la desinfección reparte la dosis con ella (72/76).
--
--   D · `fn_lotes_regables`: el área viene del tope nuevo y el recorte por
--       zona sólo aplica con alcance ZONAL. Con alcance «propietario» el
--       selector salía VACÍO (los lotes no tienen dueño; la rama zonal
--       estricta sin zonas devolvía nada).
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · v_siembras + plan_lotes
-- =====================================================================
do $$
declare
    v_def text;
begin
    if to_regclass('interno.v_siembras_crudo') is null then
        raise exception '80 · No existe interno.v_siembras_crudo: faltan la 56/66/79.';
    end if;

    drop view if exists public.v_siembras;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'interno' and table_name = 'v_siembras_crudo'
          and column_name = 'plan_lotes'
    ) then
        v_def := rtrim(btrim(pg_get_viewdef('interno.v_siembras_crudo'::regclass, true)), ';');
        execute format($v$
            create or replace view interno.v_siembras_crudo as
            select c.*, pl.lotes as plan_lotes
            from (%s) c
            left join lateral (
                select string_agg(distinct lo.nomenclatura, ', ' order by lo.nomenclatura) as lotes
                from public.planes_siembra p
                join public.lotes_temporada lt on lt.id = p.lote_temporada_id
                join public.lotes lo          on lo.id = lt.lote_id
                where p.temporada_id  = c.temporada_id
                  and p.ciclo         = c.ciclo
                  and p.fecha_siembra = c.fecha_siembra
            ) pl on true
        $v$, v_def);
    else
        raise notice '80 · La cruda ya trae plan_lotes; sólo se rearma la expuesta.';
    end if;

    execute 'alter view interno.v_siembras_crudo set (security_invoker = off)';
    execute 'revoke all on interno.v_siembras_crudo from authenticated, anon';
end $$;

create index if not exists planes_siembra_temporada_ciclo_fecha_idx
    on public.planes_siembra (temporada_id, ciclo, fecha_siembra);

-- Reja canónica (66): trasplante_diario · lote estricto · dueño.
create view public.v_siembras as
select x.* from interno.v_siembras_crudo x
where (select public.fn_permitido_de('trasplante_diario', 'ver'))
  and case (select public.fn_mi_alcance('trasplante_diario', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else public.fn_ve_lote_estricto(x.lote_temporada_id)
  end;

grant select on public.v_siembras to authenticated;

-- =====================================================================
-- C · EL TOPE DE RIEGO DEL LOTE EN UN CICLO
-- =====================================================================
create or replace function public.fn_tope_riego_lote_ciclo(
    p_lote_temporada_id uuid,
    p_ciclo integer default null
)
returns numeric
language sql stable set search_path = public, pg_temp as $$
    with s as (
        select coalesce(sum(si.avance_mz), 0) as sembrada
        from public.siembras si
        where si.lote_temporada_id = p_lote_temporada_id
          and (p_ciclo is null or si.ciclo = p_ciclo)
    ),
    p as (
        select coalesce(sum(ps.area_plan), 0) as planificada
        from public.planes_siembra ps
        where ps.lote_temporada_id = p_lote_temporada_id
          and (p_ciclo is null or ps.ciclo = p_ciclo)
    ),
    n as (
        select coalesce(lt.area_neta, 0) as neta
        from public.lotes_temporada lt
        where lt.id = p_lote_temporada_id
    )
    select case
        when greatest(s.sembrada, p.planificada) > 0 then greatest(s.sembrada, p.planificada)
        else n.neta
    end
    from s, p, n;
$$;

comment on function public.fn_tope_riego_lote_ciclo(uuid, integer) is
    'Tope de riego del lote en un ciclo: el mayor de lo sembrado y lo planificado; el área neta si los dos son cero (migración 80).';

grant execute on function public.fn_tope_riego_lote_ciclo(uuid, integer) to authenticated;

create or replace function public.fn_origen_tope_riego(
    p_lote_temporada_id uuid,
    p_ciclo integer default null
)
returns text
language sql stable set search_path = public, pg_temp as $$
    with s as (
        select coalesce(sum(si.avance_mz), 0) as sembrada
        from public.siembras si
        where si.lote_temporada_id = p_lote_temporada_id
          and (p_ciclo is null or si.ciclo = p_ciclo)
    ),
    p as (
        select coalesce(sum(ps.area_plan), 0) as planificada
        from public.planes_siembra ps
        where ps.lote_temporada_id = p_lote_temporada_id
          and (p_ciclo is null or ps.ciclo = p_ciclo)
    )
    select case
        when s.sembrada > 0 and s.sembrada >= p.planificada then 'real'
        when p.planificada > 0 then 'plan'
        else 'neta'
    end
    from s, p;
$$;

grant execute on function public.fn_origen_tope_riego(uuid, integer) to authenticated;

-- =====================================================================
-- B · EL DISPARADOR, POR CICLO
-- =====================================================================
create or replace function public.fn_validar_area_turno()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp as $$
declare
    v_ciclo     integer;
    v_tope      numeric;
    v_asignada  numeric;
    v_lote      text;
begin
    select t.ciclo into v_ciclo
    from public.turnos_riego t
    where t.id = new.turno_id;

    v_tope := public.fn_tope_riego_lote_ciclo(new.lote_temporada_id, v_ciclo);

    -- Lo ya repartido en OTROS turnos DEL MISMO CICLO, más lo que entra
    -- ahora. Se excluye la propia fila para que corregir 8.99 a 9.00 no
    -- choque consigo misma.
    select coalesce(sum(d.area_turno), 0) into v_asignada
    from public.turnos_riego_detalle d
    join public.turnos_riego t on t.id = d.turno_id
    where d.lote_temporada_id = new.lote_temporada_id
      and d.id <> new.id
      and (v_ciclo is null or t.ciclo = v_ciclo);

    if v_tope > 0 and (v_asignada + new.area_turno) > v_tope + 0.005 then
        select lo.nomenclatura into v_lote
        from public.lotes_temporada lt
        join public.lotes lo on lo.id = lt.lote_id
        where lt.id = new.lote_temporada_id;

        raise exception
            'El lote % sólo tiene % mz en el ciclo % y ya hay % mz en otros turnos de ese ciclo: no caben % mz más.',
            coalesce(v_lote, '?'), round(v_tope, 2), coalesce(v_ciclo::text, '?'),
            round(v_asignada, 2), round(new.area_turno, 2)
            using errcode = '23514';
    end if;

    return new;
end
$$;

-- =====================================================================
-- D · LOS LOTES REGABLES
-- =====================================================================
create or replace function public.fn_lotes_regables(
    p_temporada_id uuid,
    p_zona_id uuid default null,
    p_turno_id uuid default null,
    p_ciclo integer default null
)
returns table (
    lote_temporada_id uuid,
    ut                text,
    lote_nombre       text,
    zona              text,
    zona_id           uuid,
    area_total        numeric,
    area_asignada     numeric,
    area_disponible   numeric,
    origen_area       text,
    fecha_siembra     date,
    variedad          text
)
language sql stable set search_path = public, pg_temp as $$
    select
        lt.id,
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        lt.zona_id,
        public.fn_tope_riego_lote_ciclo(lt.id, p_ciclo)       as area_total,
        coalesce(a.asignada, 0)                               as area_asignada,
        greatest(public.fn_tope_riego_lote_ciclo(lt.id, p_ciclo)
                 - coalesce(a.asignada, 0), 0)                as area_disponible,
        public.fn_origen_tope_riego(lt.id, p_ciclo)           as origen_area,
        sb.fecha_siembra,
        sb.variedad_nombre
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    left join public.zonas z on z.id = lt.zona_id
    left join lateral (
        select sum(d.area_turno) as asignada
        from public.turnos_riego_detalle d
        join public.turnos_riego t on t.id = d.turno_id
        where d.lote_temporada_id = lt.id
          and (p_turno_id is null or d.turno_id <> p_turno_id)
          and (p_ciclo is null or t.ciclo = p_ciclo)
    ) a on true
    left join lateral (
        select x.fecha_siembra, x.variedad_nombre
        from public.fn_siembras_de_lotes(array[lt.id], p_ciclo) x
        limit 1
    ) sb on true
    where lt.temporada_id = p_temporada_id
      and lo.tipo = 'AGRICOLA'
      and lt.activo
      and (p_zona_id is null or lt.zona_id = p_zona_id)
      -- Con o sin plan de siembra: el lote existe en la temporada y se
      -- riega. El recorte por zona, sólo con alcance ZONAL.
      and (select public.fn_permitido_de('turnos_riego', 'ver'))
      and case (select public.fn_mi_alcance('turnos_riego', 'ver'))
          when 'zonal' then (select public.fn_ve_zona_estricta(lt.zona_id))
          else true
      end
    order by lo.nomenclatura;
$$;

comment on function public.fn_lotes_regables(uuid, uuid, uuid, integer) is
    'Lotes regables de la temporada (con o sin plan), con el tope del CICLO: mayor de sembrado y plan, o área neta. Recorte zonal sólo con alcance zonal (migración 80).';

grant execute on function public.fn_lotes_regables(uuid, uuid, uuid, integer) to authenticated;

-- =====================================================================
-- GUARDIANES
-- =====================================================================
do $$
declare v text;
begin
    select string_agg(c, ', ') into v
    from unnest(array['plan_lotes', 'plan_variedad', 'plan_mz', 'plan_lote',
                      'usuario_id', 'lote_temporada_id']) c
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'v_siembras'
                        and column_name = c);
    if v is not null then
        raise exception '80 · v_siembras quedó sin: %', v;
    end if;

    v := pg_get_viewdef('public.v_siembras'::regclass, true);
    if v not like '%fn_permitido_de%' or v not like '%fn_ve_lote_estricto%'
       or v not like '%auth.uid()%' then
        raise exception '80 · La expuesta perdió la reja.';
    end if;

    if has_schema_privilege('authenticated', 'interno', 'usage')
       or has_table_privilege('authenticated', 'interno.v_siembras_crudo', 'select') then
        raise exception '80 · La cruda quedó alcanzable por authenticated.';
    end if;

    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'interno' and c.relname = 'v_siembras_crudo'
                     and coalesce(c.reloptions::text, '') ~ 'security_invoker=(off|false)') then
        raise exception '80 · La cruda dejó de ser definer.';
    end if;

    if pg_get_functiondef('public.fn_validar_area_turno()'::regprocedure) not like '%fn_tope_riego_lote_ciclo%' then
        raise exception '80 · fn_validar_area_turno no usa el tope por ciclo.';
    end if;

    if (select count(*) from pg_proc where proname = 'fn_lotes_regables'
          and pronamespace = 'public'::regnamespace) <> 1 then
        raise exception '80 · Hay más de una fn_lotes_regables.';
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_validar_area_turno' and not tgisinternal) then
        raise exception '80 · Falta trg_validar_area_turno.';
    end if;
end $$;
