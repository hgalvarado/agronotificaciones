-- =====================================================================
-- 113 · FERTIRRIEGO › HORAS: EL % DE FERTILIZACIÓN PUEDE PASAR DE 100
-- =====================================================================
-- Decisión del usuario (2026-11-15): el % de fertilización puede ser 120 %, 200 % o más. La 112 lo limitó a 0-100.
--   - fert_bitacora_riego.pct_fertilizacion pasa de numeric(5,2) (máx. 999.99) a numeric(12,2).
--   - _fert_op_bitacora (la de la 112, que es la de la 99 + el %) se redefine completa: el % solo debe ser >= 0.
--     Sin otro tope. Lo demás (horas 0-24, cloro 0-1000, idempotencia, «lo vacío no borra») queda IGUAL.
--   - Se quita cualquier CHECK que tope la columna (la 112 no crea ninguno, pero por si alguien lo agregó a mano) y
--     queda uno solo: >= 0.
--   - «Terminar ciclo / Reactivar» (102): la columna es la misma; el to_jsonb de un 85.50 sale igual con (5,2) o (12,2),
--     así que la huella de turnos archivados antes de la 113 sigue cuadrando (lo verifica pruebas/sql/113_*.sql).
--
-- Orden de corrida: DESPUÉS de la 112 (necesita la columna; si falta, falla con mensaje claro). Idempotente.
-- OJO: si se vuelve a correr la 112 (o la 99), esas redefinen _fert_op_bitacora con el tope de 100: correr la 113
-- OTRA VEZ después. No hay UPDATE ni DELETE.
-- =====================================================================

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'fert_bitacora_riego' and column_name = 'pct_fertilizacion') then
        raise exception '113: falta la 112 (columna pct_fertilizacion). Corre primero la 112.';
    end if;
end $$;

-- quitar cualquier CHECK que tope la columna (si no hay, no hace nada)
do $$
declare r record;
begin
    for r in select c.conname from pg_constraint c
             where c.conrelid = 'public.fert_bitacora_riego'::regclass and c.contype = 'c'
               and pg_get_constraintdef(c.oid) ilike '%pct_fertilizacion%'
    loop
        execute format('alter table public.fert_bitacora_riego drop constraint %I', r.conname);
    end loop;
end $$;

-- ampliar el tipo (solo si todavía es el chico; si ya es más ancho no se toca)
do $$
begin
    if (select numeric_precision from information_schema.columns
        where table_schema = 'public' and table_name = 'fert_bitacora_riego' and column_name = 'pct_fertilizacion') < 12 then
        alter table public.fert_bitacora_riego alter column pct_fertilizacion type numeric(12,2);
    end if;
end $$;

alter table public.fert_bitacora_riego add constraint fert_bitacora_riego_pct_fertilizacion_check
    check (pct_fertilizacion is null or pct_fertilizacion >= 0);

comment on column public.fert_bitacora_riego.pct_fertilizacion is
    '113: % de fertilización del turno en el día (>= 0; puede pasar de 100). Se registra en Fertirriego › Horas.';

-- ---------------------------------------------------------------- escritura (la de la 112 con la validación nueva)
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
    if v_pct is not null and v_pct < 0 then
        raise exception 'El %% de fertilización no puede ser negativo.';
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

notify pgrst, 'reload schema';
