-- =====================================================================
-- 81 · RIEGO: EL EXCESO DE ÁREA SE PUEDE FORZAR (Y QUEDA REGISTRADO)
--
-- Ejecutar en el SQL Editor DESPUÉS de la 80.
--
-- En campo se riegan lotes antes de que el plan o la siembra estén
-- capturados: el tope de la 80 (mayor de sembrado y plan del ciclo)
-- bloqueaba trabajo real. El tope NO se quita —sigue siendo la regla y el
-- disparador sigue en la base—, pero una línea puede llegar con
-- `forzar_exceso = true` y entonces se acepta, dejando escrito:
--
--   forzar_exceso  la línea se guardó por encima del tope a sabiendas
--   exceso_mz      cuántas mz por encima del tope quedó (al guardar)
--   forzado_por    quién lo forzó (la sesión, no un parámetro)
--   forzado_en     cuándo
--
-- Si la línea NO excede, el disparador apaga la bandera y limpia los tres
-- campos: un «forzado» que no forzó nada sólo ensucia la auditoría.
--
-- `fn_guardar_turno_riego` lee la bandera de cada lote del JSON
-- (`forzar_exceso`). El editor en celda (`fn_editar_turno_riego`) no la
-- envía: desde la celda el tope sigue siendo duro, salvo en una línea que
-- ya estaba forzada.
--
-- Idempotente.
-- =====================================================================

alter table public.turnos_riego_detalle
    add column if not exists forzar_exceso boolean not null default false,
    add column if not exists exceso_mz     numeric(10,2),
    add column if not exists forzado_por   uuid references public.perfiles(id),
    add column if not exists forzado_en    timestamptz;

comment on column public.turnos_riego_detalle.forzar_exceso is
    'La línea superó el tope de riego del ciclo y se guardó a sabiendas (migración 81).';
comment on column public.turnos_riego_detalle.exceso_mz is
    'Manzanas por encima del tope en el momento de guardar. Nulo si no hubo exceso.';

-- ---------------------------------------------------------------------
-- El disparador: mismo tope y misma suma por ciclo de la 80, con la
-- válvula auditada.
-- ---------------------------------------------------------------------
create or replace function public.fn_validar_area_turno()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp as $$
declare
    v_ciclo     integer;
    v_tope      numeric;
    v_asignada  numeric;
    v_exceso    numeric;
    v_lote      text;
begin
    select t.ciclo into v_ciclo
    from public.turnos_riego t
    where t.id = new.turno_id;

    v_tope := public.fn_tope_riego_lote_ciclo(new.lote_temporada_id, v_ciclo);

    select coalesce(sum(d.area_turno), 0) into v_asignada
    from public.turnos_riego_detalle d
    join public.turnos_riego t on t.id = d.turno_id
    where d.lote_temporada_id = new.lote_temporada_id
      and d.id <> new.id
      and (v_ciclo is null or t.ciclo = v_ciclo);

    v_exceso := (v_asignada + new.area_turno) - v_tope;

    if v_tope > 0 and v_exceso > 0.005 then
        if coalesce(new.forzar_exceso, false) then
            -- Se acepta y se deja escrito quién, cuándo y cuánto.
            new.exceso_mz   := round(v_exceso, 2);
            new.forzado_por := coalesce((select auth.uid()), new.forzado_por);
            new.forzado_en  := now();
            return new;
        end if;

        select lo.nomenclatura into v_lote
        from public.lotes_temporada lt
        join public.lotes lo on lo.id = lt.lote_id
        where lt.id = new.lote_temporada_id;

        raise exception
            'El lote % sólo tiene % mz en el ciclo % y ya hay % mz en otros turnos de ese ciclo: no caben % mz más. Si en campo se regó más, confirma el exceso al guardar.',
            coalesce(v_lote, '?'), round(v_tope, 2), coalesce(v_ciclo::text, '?'),
            round(v_asignada, 2), round(new.area_turno, 2)
            using errcode = '23514';
    end if;

    -- No excede: la bandera no aplica y no se deja rastro falso.
    new.forzar_exceso := false;
    new.exceso_mz     := null;
    new.forzado_por   := null;
    new.forzado_en    := null;
    return new;
end
$$;

drop trigger if exists trg_validar_area_turno on public.turnos_riego_detalle;
create trigger trg_validar_area_turno
    before insert or update of area_turno, lote_temporada_id, forzar_exceso
    on public.turnos_riego_detalle
    for each row execute function public.fn_validar_area_turno();

-- ---------------------------------------------------------------------
-- El guardado: igual que el de la 41, más la bandera por lote.
-- ---------------------------------------------------------------------
create or replace function public.fn_guardar_turno_riego(
    p_turno_id            uuid,
    p_temporada_id        uuid,
    p_ciclo               smallint,
    p_fecha_siembra       date,
    p_zona_id             uuid,
    p_turno               text,
    p_plan_nutricional_id uuid,
    p_estacion_riego      text,
    p_fuente_agua         public.fuente_agua,
    p_orden_sap           text,
    p_estado              public.estado_turno_riego,
    p_responsable         text,
    p_comentarios         text,
    p_lotes               jsonb,
    p_turno_catalogo_id   uuid default null,
    p_estacion_riego_id   uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp as $$
declare
    v_id uuid;
    v_n  integer;
begin
    if p_lotes is null or jsonb_array_length(p_lotes) = 0 then
        raise exception 'Un turno tiene que llevar al menos un lote.' using errcode = '22023';
    end if;

    if p_turno_id is null then
        insert into public.turnos_riego
            (temporada_id, ciclo, fecha_siembra, zona_id, turno, turno_id, plan_nutricional_id,
             responsable, estacion_riego, estacion_riego_id, fuente_agua, orden_sap, estado,
             comentarios, usuario_id)
        values
            (p_temporada_id, coalesce(p_ciclo, 1), p_fecha_siembra, p_zona_id, btrim(p_turno),
             p_turno_catalogo_id, p_plan_nutricional_id, nullif(btrim(p_responsable), ''),
             nullif(btrim(p_estacion_riego), ''), p_estacion_riego_id, p_fuente_agua,
             nullif(btrim(p_orden_sap), ''), coalesce(p_estado, 'PENDIENTE_CREAR'),
             nullif(btrim(p_comentarios), ''), (select auth.uid()))
        returning id into v_id;
    else
        update public.turnos_riego
        set temporada_id        = p_temporada_id,
            ciclo               = coalesce(p_ciclo, 1),
            fecha_siembra       = p_fecha_siembra,
            zona_id             = p_zona_id,
            turno               = btrim(p_turno),
            turno_id            = p_turno_catalogo_id,
            plan_nutricional_id = p_plan_nutricional_id,
            responsable         = nullif(btrim(p_responsable), ''),
            estacion_riego      = nullif(btrim(p_estacion_riego), ''),
            estacion_riego_id   = p_estacion_riego_id,
            fuente_agua         = p_fuente_agua,
            orden_sap           = nullif(btrim(p_orden_sap), ''),
            estado              = coalesce(p_estado, estado),
            comentarios         = nullif(btrim(p_comentarios), '')
        where id = p_turno_id
        returning id into v_id;

        if v_id is null then
            raise exception 'El turno no existe o no tienes permiso para cambiarlo.'
                using errcode = '42501';
        end if;

        delete from public.turnos_riego_detalle where turno_id = v_id;
    end if;

    insert into public.turnos_riego_detalle
        (turno_id, lote_temporada_id, area_turno, variedad_id, comentarios, forzar_exceso)
    select
        v_id,
        (x->>'lote_temporada_id')::uuid,
        (x->>'area_turno')::numeric,
        nullif(x->>'variedad_id', '')::uuid,
        nullif(btrim(coalesce(x->>'comentarios', '')), ''),
        coalesce((x->>'forzar_exceso')::boolean, false)
    from jsonb_array_elements(p_lotes) as x;

    get diagnostics v_n = row_count;
    if v_n = 0 then
        raise exception 'Un turno tiene que llevar al menos un lote.' using errcode = '22023';
    end if;

    return v_id;
end
$$;

grant execute on function public.fn_guardar_turno_riego(
    uuid, uuid, smallint, date, uuid, text, uuid, text,
    public.fuente_agua, text, public.estado_turno_riego, text, text, jsonb, uuid, uuid
) to authenticated;

-- =====================================================================
-- GUARDIANES
-- =====================================================================
do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'turnos_riego_detalle'
                     and column_name = 'forzar_exceso') then
        raise exception '81 · Falta turnos_riego_detalle.forzar_exceso.';
    end if;

    if pg_get_functiondef('public.fn_validar_area_turno()'::regprocedure) not like '%fn_tope_riego_lote_ciclo%'
       or pg_get_functiondef('public.fn_validar_area_turno()'::regprocedure) not like '%forzar_exceso%' then
        raise exception '81 · fn_validar_area_turno no tiene el tope por ciclo con válvula.';
    end if;

    if (select count(*) from pg_proc where proname = 'fn_guardar_turno_riego'
          and pronamespace = 'public'::regnamespace) <> 1 then
        raise exception '81 · Hay más de una fn_guardar_turno_riego.';
    end if;

    if pg_get_functiondef(
         (select oid from pg_proc where proname = 'fn_guardar_turno_riego'
            and pronamespace = 'public'::regnamespace)) not like '%forzar_exceso%' then
        raise exception '81 · fn_guardar_turno_riego no lee forzar_exceso.';
    end if;

    if not exists (select 1 from pg_trigger where tgname = 'trg_validar_area_turno' and not tgisinternal) then
        raise exception '81 · Falta trg_validar_area_turno.';
    end if;
end $$;
