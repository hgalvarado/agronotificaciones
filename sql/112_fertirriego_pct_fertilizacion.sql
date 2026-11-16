-- =====================================================================
-- 112 · FERTIRRIEGO › HORAS: % DE FERTILIZACIÓN
-- =====================================================================
-- Decisión del usuario (2026-11-13, docs/agrometricas-parametros-riego.md §4.4): el % de fertilización NO se
-- registra en AgroMétricas › Parámetros; se agrega a Fertirriego › Horas (bitácora de riego del turno y día), junto a
-- las horas de fertilización y de riego. El número de fertilización es el DDT del plan del turno (ya existe).
--
--   - fert_bitacora_riego.pct_fertilizacion numeric(5,2), 0 a 100.
--   - _fert_op_bitacora (la de la 99, que nadie parchó después) se redefine completa con el campo nuevo. Mismo
--     criterio que lo demás: lo vacío NO borra lo que ya estaba; idempotente por la operación del teléfono (cola).
--   - El campo se agrega a lo que bajan el teléfono (_fert_estado_campo_base) y AGL (_fert_exportar_base y
--     fn_fert_exportar_turno), por texto y verificando, como la 101 y la 102. «Terminar ciclo / Reactivar» (102)
--     guardan la fila con to_jsonb y la restauran con jsonb_populate_recordset: el campo viaja solo. La huella
--     (_fert_turno_filas) deja fuera el % VACÍO, para que un turno archivado antes de la 112 se pueda reactivar.
--
-- Orden de corrida: DESPUÉS de la 102. Idempotente. Si se vuelve a correr la 99 o la 102 (redefinen esas
-- funciones), correr la 112 otra vez: vuelve a poner el campo (lo verifican pruebas/sql/112_pct_fertilizacion.sql).
-- Un teléfono con la app vieja no manda el campo: no cambia nada. Una base sin la 112 ignora el campo que mande la
-- app nueva (no falla). Todo UPDATE/DELETE lleva WHERE.
-- =====================================================================

alter table public.fert_bitacora_riego
    add column if not exists pct_fertilizacion numeric(5,2);

comment on column public.fert_bitacora_riego.pct_fertilizacion is
    '112: % de fertilización del turno en el día (0 a 100). Se registra en Fertirriego › Horas.';

-- ---------------------------------------------------------------- escritura (la de la 99 + el %)
create or replace function public._fert_op_bitacora(p_id uuid, d jsonb, p_creado timestamp with time zone, p_en_nombre uuid)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_turno  uuid := public._fert_uuid(d->>'turno_ciclo_id');
    v_fecha  date := (d->>'fecha')::date;
    v_hf     numeric := nullif(btrim(d->>'horas_fertilizacion'), '')::numeric;
    v_hr     numeric := nullif(btrim(d->>'horas_riego'), '')::numeric;
    v_ini    timestamptz := nullif(btrim(d->>'hora_inicio'), '')::timestamptz;
    v_fin    timestamptz := nullif(btrim(d->>'hora_fin'), '')::timestamptz;
    v_ejec   uuid := public._fert_uuid(d->>'ejecutor_id');
    v_ejec2  uuid := public._fert_uuid(d->>'ejecutor2_id');
    v_cl_cab numeric;
    v_cl_cam numeric;
    v_pct    numeric;   -- 112
    v_tc     public.turnos_ciclo%rowtype;
begin
    begin
        v_cl_cab := nullif(btrim(coalesce(d->>'ppm_cloro_cabezal', '')), '')::numeric;
        v_cl_cam := nullif(btrim(coalesce(d->>'ppm_cloro_campo', '')), '')::numeric;
    exception when others then
        raise exception 'Las ppm de cloro deben ser números.';
    end;
    begin
        v_pct := nullif(btrim(replace(coalesce(d->>'pct_fertilizacion', ''), ',', '.')), '')::numeric;
    exception when others then
        raise exception 'El %% de fertilización debe ser un número.';
    end;
    select * into v_tc from public.turnos_ciclo where id = v_turno;
    if not found then
        raise exception 'El turno no existe. Actualiza la aplicación.';
    end if;
    if v_fecha is null then
        raise exception 'Indica la fecha del riego.';
    end if;
    if v_tc.estacion_id is null or not public.fn_fert_puede(v_tc.estacion_id, 'aplicar') then
        raise exception 'Tu rol no tiene «Aplicar» en la estación de este turno.' using errcode = '42501';
    end if;
    if v_hf is not null and (v_hf < 0 or v_hf > 24) or v_hr is not null and (v_hr < 0 or v_hr > 24) then
        raise exception 'Las horas deben estar entre 0 y 24.';
    end if;
    if v_cl_cab is not null and (v_cl_cab < 0 or v_cl_cab > 1000) or v_cl_cam is not null and (v_cl_cam < 0 or v_cl_cam > 1000) then
        raise exception 'Las ppm de cloro deben estar entre 0 y 1,000.';
    end if;
    if v_pct is not null and (v_pct < 0 or v_pct > 100) then
        raise exception 'El %% de fertilización debe estar entre 0 y 100.';
    end if;
    if v_ini is not null and v_fin is not null and v_fin < v_ini then
        raise exception 'La hora final no puede ser anterior a la inicial.';
    end if;
    if v_ejec is not null and not exists (select 1 from public.perfiles where id = v_ejec)
       or v_ejec2 is not null and not exists (select 1 from public.perfiles where id = v_ejec2) then
        raise exception 'El estacionero que ejecutó no existe.';
    end if;

    insert into public.fert_bitacora_riego as b
        (turno_ciclo_id, fecha, estacion_id, horas_fertilizacion, horas_riego, hora_inicio, hora_fin,
         ejecutor_id, ejecutor2_id, comentario, operacion_id, updated_at, updated_by, ppm_cloro_cabezal, ppm_cloro_campo,
         pct_fertilizacion)
    values
        (v_turno, v_fecha, v_tc.estacion_id, v_hf, v_hr, v_ini, v_fin, v_ejec, v_ejec2,
         nullif(btrim(d->>'comentario'), ''), p_id, now(), (select auth.uid()), round(v_cl_cab, 2), round(v_cl_cam, 2),
         round(v_pct, 2))
    on conflict (turno_ciclo_id, fecha) do update set
        horas_fertilizacion = coalesce(excluded.horas_fertilizacion, b.horas_fertilizacion),
        horas_riego         = coalesce(excluded.horas_riego, b.horas_riego),
        hora_inicio         = coalesce(excluded.hora_inicio, b.hora_inicio),
        hora_fin            = coalesce(excluded.hora_fin, b.hora_fin),
        ejecutor_id         = coalesce(excluded.ejecutor_id, b.ejecutor_id),
        ejecutor2_id        = coalesce(excluded.ejecutor2_id, b.ejecutor2_id),
        comentario          = coalesce(excluded.comentario, b.comentario),
        ppm_cloro_cabezal   = coalesce(excluded.ppm_cloro_cabezal, b.ppm_cloro_cabezal),
        ppm_cloro_campo     = coalesce(excluded.ppm_cloro_campo, b.ppm_cloro_campo),
        pct_fertilizacion   = coalesce(excluded.pct_fertilizacion, b.pct_fertilizacion),
        operacion_id        = excluded.operacion_id,
        updated_at          = now(),
        updated_by          = excluded.updated_by;
    return '{}';
end;
$$;
revoke execute on function public._fert_op_bitacora(uuid, jsonb, timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- lectura: teléfono y AGL (por texto, verificando)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');   -- igual si se corrió con CRLF
    v_n   integer := (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    if v_n <> 1 then
        raise exception '112: en % se esperaba 1 aparición de «%» y hay %', p_fn, p_viejo, v_n;
    end if;
    execute replace(v_def, p_viejo, p_nuevo);
end $$;

-- Teléfono (fn_fert_estado_campo = _base de la 99 + lo de la 100)
select pg_temp.parchar('public._fert_estado_campo_base(date)',
    '''ppm_cloro_cabezal'', b.ppm_cloro_cabezal, ''ppm_cloro_campo'', b.ppm_cloro_campo))',
    '''ppm_cloro_cabezal'', b.ppm_cloro_cabezal, ''ppm_cloro_campo'', b.ppm_cloro_campo, ''pct_fertilizacion'', b.pct_fertilizacion))',
    'pct_fertilizacion');
-- AGL: lo de cada día (fn_fert_exportar / fn_fert_exportar_pruebas usan esta base)
select pg_temp.parchar('public._fert_exportar_base(bigint, integer)',
    '''ppm_cloro_cabezal'', b.ppm_cloro_cabezal, ''ppm_cloro_campo'', b.ppm_cloro_campo,',
    '''ppm_cloro_cabezal'', b.ppm_cloro_cabezal, ''ppm_cloro_campo'', b.ppm_cloro_campo, ''pct_fertilizacion'', b.pct_fertilizacion,',
    'pct_fertilizacion');
-- AGL: «Terminar ciclo» (resumen legible; las filas completas ya van con to_jsonb)
select pg_temp.parchar('public.fn_fert_exportar_turno(text)',
    '''ppm_cloro_cabezal'', b.ppm_cloro_cabezal, ''ppm_cloro_campo'', b.ppm_cloro_campo,',
    '''ppm_cloro_cabezal'', b.ppm_cloro_cabezal, ''ppm_cloro_campo'', b.ppm_cloro_campo, ''pct_fertilizacion'', b.pct_fertilizacion,',
    'pct_fertilizacion');

-- «Terminar ciclo» (102): la huella es el sha256 de las filas con to_jsonb. Un turno archivado ANTES de la 112 no
-- tenía la columna: al reactivarlo, sus filas vuelven con pct_fertilizacion = null y la huella ya no cuadraría
-- («no quedó idéntico») y no se podría reactivar. Por eso el % vacío NO entra a la huella (queda igual que antes);
-- con valor, sí.
select pg_temp.parchar('public._fert_turno_filas(uuid)',
    '''fert_bitacora_riego'', coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha)',
    '''fert_bitacora_riego'', coalesce((select jsonb_agg(case when x.pct_fertilizacion is null   -- 112: igual que antes de la columna'
    || E'\n                                                           then to_jsonb(x) - ''pct_fertilizacion'' else to_jsonb(x) end order by x.fecha)',
    'pct_fertilizacion');

notify pgrst, 'reload schema';
