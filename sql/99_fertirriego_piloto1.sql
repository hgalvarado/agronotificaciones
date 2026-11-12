-- =====================================================================
-- 99 · FERTIRRIEGO · CAMBIOS DE LA PRIMERA PRUEBA PILOTO
-- =====================================================================
-- Contrato completo y decisiones del usuario: docs/fertirriego-piloto1.md. En corto:
--   - Recibir: para qué turnos es el pedido, comentarios, envases recibidos/entregados.
--   - Aplicar: DDT del plan elegido o «Extra»; la base calcula el DDT real (día de aplicación − siembra).
--   - Horas: ppm de cloro en cabezal y en campo.
--   - Relevo de noche: código de entrega de 12 horas (8 dígitos), sin señal.
--   - Envases (barriles, canecas…): saldo por estación; tipos nuevos desde el campo (por validar).
--   - Productos: los de MARA llevan su grupo y si son fertilizante (entra al análisis); productos de CAMPO que no
--     están en MARA (por validar, nunca van a MARA ni a otros módulos).
--   - Administración de choferes, vehículos, envases y productos de campo (editar, validar, unir duplicados).
-- Correr DESPUÉS de la 98. Idempotente. Para los demás módulos no cambia nada (los productos de campo quedan
-- inactivos en «materiales», así Desinfección y Catálogos no los ofrecen).
-- Todo UPDATE/DELETE lleva WHERE (Supabase lo exige aun dentro de funciones).
-- =====================================================================


-- ---------------------------------------------------------------- 0 · estructura

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'materiales' and column_name = 'fert_analisis') then
        alter table public.materiales add column fert_analisis boolean not null default false;
        -- Lo publicado hasta hoy es lo del plan: fertilizantes (AGL lo vuelve a decidir al publicar)
        update public.materiales set fert_analisis = true where fertirriego;
    end if;
end $$;

alter table public.materiales
    add column if not exists origen   text not null default 'MARA',
    add column if not exists validado boolean not null default true;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'materiales_origen_check') then
        alter table public.materiales add constraint materiales_origen_check check (origen in ('MARA', 'CAMPO'));
    end if;
end $$;

comment on column public.materiales.origen is
'99: MARA = catálogo de SAP (publicado por AGL u otros módulos); CAMPO = creado por un estacionero (Fertirriego), nunca va a MARA.';
comment on column public.materiales.fert_analisis is
'99: fertilizante que entra a los análisis de Fertirriego (lo decide AGL por grupo de artículos). Lo demás es solo inventario.';

alter table public.fert_recepciones add column if not exists turnos uuid[];
comment on column public.fert_recepciones.turnos is '99: para qué turnos es el pedido (los marca quien recibe).';

alter table public.fert_aplicaciones
    add column if not exists ddt_plan   integer,
    add column if not exists fecha_plan date,
    add column if not exists extra      boolean not null default false,
    add column if not exists ddt_real   integer;
comment on column public.fert_aplicaciones.ddt_plan is '99: DDT del plan que se aplicó (null si es extra o lo mandó un teléfono viejo).';
comment on column public.fert_aplicaciones.ddt_real is '99: días desde la siembra al día de aplicación.';

alter table public.fert_bitacora_riego
    add column if not exists ppm_cloro_cabezal numeric(8,2),
    add column if not exists ppm_cloro_campo   numeric(8,2);

alter table public.fert_relevos drop constraint if exists fert_relevos_metodo_check;
alter table public.fert_relevos add constraint fert_relevos_metodo_check
    check (metodo in ('CODIGO', 'CODIGO_LARGO', 'SESION', 'ASIGNACION'));

create table if not exists public.fert_envases_tipos (
    id         uuid primary key,
    nombre     text not null check (btrim(nombre) <> ''),
    validado   boolean not null default false,
    activo     boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid
);

insert into public.fert_envases_tipos (id, nombre, validado) values
    ('99000000-0000-4000-8000-000000000001', 'Barril', true),
    ('99000000-0000-4000-8000-000000000002', 'Caneca', true)
on conflict (id) do nothing;

create table if not exists public.fert_envases_movimientos (
    id             bigint generated always as identity primary key,
    estacion_id    uuid not null references public.estaciones_riego(id) on delete cascade,
    envase_id      uuid not null references public.fert_envases_tipos(id),
    cantidad       integer not null check (cantidad <> 0),
    motivo         text not null check (motivo in ('RECEPCION', 'ENTREGA', 'CONTEO', 'ANULACION')),
    documento_tipo text not null,
    documento_id   uuid not null,
    anula_id       bigint references public.fert_envases_movimientos(id),
    fecha_hora     timestamptz not null,
    registrado_por uuid not null,
    created_at     timestamptz not null default now()
);

create index if not exists idx_fert_envases_mov_estacion on public.fert_envases_movimientos (estacion_id, envase_id);
create index if not exists idx_fert_envases_mov_documento on public.fert_envases_movimientos (documento_id);

alter table public.fert_envases_tipos enable row level security;
alter table public.fert_envases_movimientos enable row level security;
drop policy if exists fert_leer on public.fert_envases_tipos;
create policy fert_leer on public.fert_envases_tipos for select to authenticated
    using (public.fn_tiene_permiso('fertirriego', 'ver'));
-- fert_envases_movimientos: sin políticas (solo por las funciones)


-- ---------------------------------------------------------------- 1 · envases

create or replace function public._fert_saldo_envase(p_estacion uuid, p_envase uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(sum(cantidad), 0)::integer from public.fert_envases_movimientos
    where estacion_id = p_estacion and envase_id = p_envase
$$;

create or replace function public._fert_entero_envase(p text) returns integer
language plpgsql immutable as $$
declare v numeric;
begin
    if nullif(btrim(coalesce(p, '')), '') is null then
        return 0;
    end if;
    begin
        v := btrim(p)::numeric;
    exception when others then
        raise exception 'La cantidad de envases debe ser un número entero.';
    end;
    if v <> trunc(v) or v < 0 or v > 100000 then
        raise exception 'La cantidad de envases debe ser un número entero entre 0 y 100,000.';
    end if;
    return v::integer;
end;
$$;

/** Envases de una recepción: [{envase_id, recibidos, entregados}]. Devuelve cuántas filas guardó. */
create or replace function public._fert_envases_recepcion(p_doc uuid, p_estacion uuid, p jsonb, p_fecha timestamptz)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    x       jsonb;
    v_env   uuid;
    v_rec   integer;
    v_ent   integer;
    v_vistos uuid[] := '{}';
    n       integer := 0;
begin
    if p is null or jsonb_typeof(p) <> 'array' then
        return 0;
    end if;
    for x in select value from jsonb_array_elements(p) loop
        v_env := public._fert_uuid(x->>'envase_id');
        if v_env is null or not exists (select 1 from public.fert_envases_tipos where id = v_env) then
            raise exception 'Un tipo de envase no existe. Actualiza la aplicación.';
        end if;
        if v_env = any(v_vistos) then
            raise exception 'Un tipo de envase está repetido en la recepción.';
        end if;
        v_vistos := v_vistos || v_env;
        v_rec := public._fert_entero_envase(x->>'recibidos');
        v_ent := public._fert_entero_envase(x->>'entregados');
        if v_rec > 0 then
            insert into public.fert_envases_movimientos
                (estacion_id, envase_id, cantidad, motivo, documento_tipo, documento_id, fecha_hora, registrado_por)
            values (p_estacion, v_env, v_rec, 'RECEPCION', 'recepcion', p_doc, p_fecha, (select auth.uid()));
            n := n + 1;
        end if;
        if v_ent > 0 then
            insert into public.fert_envases_movimientos
                (estacion_id, envase_id, cantidad, motivo, documento_tipo, documento_id, fecha_hora, registrado_por)
            values (p_estacion, v_env, -v_ent, 'ENTREGA', 'recepcion', p_doc, p_fecha, (select auth.uid()));
            n := n + 1;
        end if;
    end loop;
    return n;
end;
$$;

/** Al anular una recepción o un conteo, sus envases se revierten. */
create or replace function public._fert_envases_al_anular() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if old.anulado_at is null and new.anulado_at is not null then
        insert into public.fert_envases_movimientos
            (estacion_id, envase_id, cantidad, motivo, documento_tipo, documento_id, anula_id, fecha_hora, registrado_por)
        select m.estacion_id, m.envase_id, -m.cantidad, 'ANULACION', m.documento_tipo, m.documento_id, m.id, now(),
               coalesce(new.anulado_por, (select auth.uid()), m.registrado_por)
        from public.fert_envases_movimientos m
        where m.documento_id = new.id and m.motivo <> 'ANULACION'
          and not exists (select 1 from public.fert_envases_movimientos a where a.anula_id = m.id);
    end if;
    return new;
end;
$$;

drop trigger if exists fert_envases_anular on public.fert_recepciones;
create trigger fert_envases_anular after update of anulado_at on public.fert_recepciones
    for each row execute function public._fert_envases_al_anular();
drop trigger if exists fert_envases_anular on public.fert_conteos;
create trigger fert_envases_anular after update of anulado_at on public.fert_conteos
    for each row execute function public._fert_envases_al_anular();

create or replace function public._fert_op_envase_tipo(p_id uuid, d jsonb) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_gestiona boolean := public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'gestionar_choferes');
    v_nombre   text := nullif(btrim(d->>'nombre'), '');
    v_id       uuid := coalesce(public._fert_uuid(d->>'envase_id'), p_id);
begin
    if not (v_gestiona or public.fn_tiene_permiso('fertirriego', 'recibir') or public.fn_tiene_permiso('fertirriego', 'contar')) then
        raise exception 'Tu rol no puede agregar tipos de envase.' using errcode = '42501';
    end if;
    if exists (select 1 from public.fert_envases_tipos where id = v_id) then
        if not v_gestiona then
            return '{}';
        end if;
        update public.fert_envases_tipos set
            nombre   = coalesce(v_nombre, nombre),
            validado = coalesce((d->>'validado')::boolean, validado),
            activo   = coalesce((d->>'activo')::boolean, activo)
        where id = v_id;
        return '{}';
    end if;
    if v_nombre is null then
        raise exception 'Escribe el nombre del envase.';
    end if;
    insert into public.fert_envases_tipos (id, nombre, validado, created_by)
    values (v_id, left(v_nombre, 80), v_gestiona and coalesce((d->>'validado')::boolean, true), (select auth.uid()));
    return '{}';
end;
$$;


-- ---------------------------------------------------------------- 2 · productos de campo

create or replace function public._fert_op_producto(p_id uuid, d jsonb) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_gestiona boolean := public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'gestionar_choferes');
    v_id       uuid := coalesce(public._fert_uuid(d->>'material_id'), p_id);
    v_desc     text := nullif(btrim(d->>'descripcion'), '');
    v_unidad   text := nullif(btrim(d->>'unidad'), '');
    v_grupo    text := nullif(btrim(d->>'grupo'), '');
    v_mat      public.materiales%rowtype;
begin
    if not (v_gestiona or public.fn_tiene_permiso('fertirriego', 'recibir') or public.fn_tiene_permiso('fertirriego', 'aplicar')
            or public.fn_tiene_permiso('fertirriego', 'contar')) then
        raise exception 'Tu rol no puede agregar productos.' using errcode = '42501';
    end if;

    select * into v_mat from public.materiales where id = v_id;
    if found then
        if not v_gestiona then
            return '{}';   -- otro envío ya lo creó
        end if;
        if v_mat.origen <> 'CAMPO' then
            raise exception 'Los productos de MARA se corrigen en AGL, no aquí.';
        end if;
        if (d->>'activo')::boolean is false
           and exists (select 1 from public.fert_saldos s where s.material_id = v_id and (s.disponible <> 0 or s.en_transito <> 0)) then
            raise exception 'No se puede quitar «%»: todavía hay saldo en alguna estación.', v_mat.descripcion;
        end if;
        update public.materiales set
            descripcion = coalesce(left(v_desc, 120), descripcion),
            unidad      = coalesce(left(v_unidad, 20), unidad),
            grupo       = coalesce(left(v_grupo, 60), grupo),
            validado    = coalesce((d->>'validado')::boolean, validado),
            fertirriego = coalesce((d->>'activo')::boolean, fertirriego)
        where id = v_id;
        return '{}';
    end if;

    if v_desc is null then
        raise exception 'Escribe el nombre del producto.';
    end if;
    insert into public.materiales (id, codigo, descripcion, grupo, unidad, fertirriego, activo, origen, validado, fert_analisis)
    values (v_id, 'CAMPO-' || left(v_id::text, 8), left(v_desc, 120), coalesce(left(v_grupo, 60), 'Otros insumos'),
            left(v_unidad, 20), true, false, 'CAMPO', v_gestiona and coalesce((d->>'validado')::boolean, true), false);
    return '{}';
end;
$$;


-- ---------------------------------------------------------------- 3 · recepción, aplicación, horas, conteo

create or replace function public._fert_op_recepcion(p_id uuid, d jsonb, p_creado timestamp with time zone, p_inmediato boolean, p_en_nombre uuid)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_chofer   uuid := public._fert_uuid(d->>'chofer_id');
    v_vehiculo uuid := public._fert_uuid(d->>'vehiculo_id');
    v_fecha    timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_hay_lin  boolean := jsonb_typeof(d->'lineas') = 'array' and jsonb_array_length(d->'lineas') > 0;
    v_hay_env  boolean;
    v_turnos   uuid[];
    v_obs      text[];
    l          record;
begin
    v_obs := public._fert_autorizar(v_estacion, 'recibir', p_creado, p_inmediato, p_en_nombre);

    if v_chofer is null or not exists (select 1 from public.fert_choferes where id = v_chofer) then
        raise exception 'Indica quién entregó (chofer).';
    end if;
    if v_vehiculo is not null and not exists (select 1 from public.fert_vehiculos where id = v_vehiculo) then
        raise exception 'El vehículo no existe. Actualiza la aplicación.';
    end if;
    if v_fecha > p_creado + interval '5 minutes' then
        raise exception 'La fecha y hora de la recepción no puede ser posterior al momento en que se registra.';
    end if;

    -- Para qué turnos (los que no existen se ignoran: el teléfono pudo tener una lista vieja)
    if jsonb_typeof(d->'turnos') = 'array' then
        v_turnos := array(select distinct tc.id from jsonb_array_elements_text(d->'turnos') x
                          join public.turnos_ciclo tc on tc.id = public._fert_uuid(x));
        if cardinality(v_turnos) = 0 then
            v_turnos := null;
        end if;
    end if;

    insert into public.fert_recepciones
        (id, estacion_id, fecha_hora, chofer_id, vehiculo_id, lugar, documento, comentario, registrado_por, turnos)
    values
        (p_id, v_estacion, v_fecha, v_chofer, v_vehiculo, nullif(btrim(d->>'lugar'), ''),
         nullif(btrim(d->>'documento'), ''), left(nullif(btrim(d->>'comentario'), ''), 1000), (select auth.uid()), v_turnos);

    if v_hay_lin then
        for l in select * from public._fert_lineas(d->'lineas') loop
            insert into public.fert_recepciones_detalle (recepcion_id, material_id, cantidad)
            values (p_id, l.material_id, l.cantidad);
            v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'RECEPCION',
                         l.cantidad, v_fecha, null, 'recepcion', p_id, p_inmediato));
        end loop;
    end if;

    v_hay_env := public._fert_envases_recepcion(p_id, v_estacion, d->'envases', v_fecha) > 0;
    if not v_hay_lin and not v_hay_env then
        raise exception 'Escribe la cantidad de al menos un producto o envase recibido.';
    end if;

    if v_vehiculo is not null then
        insert into public.fert_choferes_vehiculos (chofer_id, vehiculo_id, ultima_vez)
        values (v_chofer, v_vehiculo, v_fecha)
        on conflict (chofer_id, vehiculo_id) do update set ultima_vez = greatest(fert_choferes_vehiculos.ultima_vez, excluded.ultima_vez);
    end if;
    return v_obs;
end;
$$;

create or replace function public._fert_op_aplicacion(p_id uuid, d jsonb, p_creado timestamp with time zone, p_inmediato boolean, p_en_nombre uuid)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_turno    uuid := public._fert_uuid(d->>'turno_ciclo_id');
    v_fecha_h  timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_fecha    date := coalesce((d->>'fecha')::date, (v_fecha_h at time zone 'America/Tegucigalpa')::date);
    v_ejec     uuid := coalesce(public._fert_uuid(d->>'ejecutor_id'), p_en_nombre, (select auth.uid()));
    v_ejec2    uuid := public._fert_uuid(d->>'ejecutor2_id');
    v_extra    boolean := coalesce((d->>'extra')::boolean, false);
    v_ddt_plan integer := case when v_extra then null else nullif(btrim(coalesce(d->>'ddt_plan', '')), '')::integer end;
    v_f_plan   date := case when v_extra then null else nullif(btrim(coalesce(d->>'fecha_plan', '')), '')::date end;
    v_tc       public.turnos_ciclo%rowtype;
    v_obs      text[];
    v_en_plan  boolean;
    l          record;
begin
    v_obs := public._fert_autorizar(v_estacion, 'aplicar', p_creado, p_inmediato, p_en_nombre);

    select * into v_tc from public.turnos_ciclo where id = v_turno;
    if not found then
        raise exception 'El turno no existe. Actualiza la aplicación.';
    end if;
    if v_tc.estacion_id is distinct from coalesce((select e9.prueba_de from public.estaciones_riego e9 where e9.id = v_estacion), v_estacion) then
        v_obs := public._fert_obs(v_obs, array['OTRA_ESTACION']);
    end if;
    if v_fecha > (p_creado at time zone 'America/Tegucigalpa')::date + 1 then
        raise exception 'La fecha de la aplicación no puede ser futura.';
    end if;
    if not exists (select 1 from public.perfiles where id = v_ejec)
       or (v_ejec2 is not null and not exists (select 1 from public.perfiles where id = v_ejec2)) then
        raise exception 'El estacionero que ejecutó no existe.';
    end if;

    -- El DDT del plan elegido: se completa el que falte (fecha ↔ DDT) desde el plan del turno
    if v_ddt_plan is not null and v_f_plan is null then
        v_f_plan := (select min(p.fecha) from public.fert_plan p where p.turno_ciclo_id = v_turno and p.ddt = v_ddt_plan);
    elsif v_f_plan is not null and v_ddt_plan is null then
        v_ddt_plan := (select min(p.ddt) from public.fert_plan p where p.turno_ciclo_id = v_turno and p.fecha = v_f_plan);
    end if;
    if (v_ddt_plan is not null or v_f_plan is not null)
       and not exists (select 1 from public.fert_plan p where p.turno_ciclo_id = v_turno and p.fecha = v_f_plan) then
        v_obs := public._fert_obs(v_obs, array['DDT_SIN_PLAN']);
    end if;

    insert into public.fert_aplicaciones
        (id, estacion_id, turno_ciclo_id, fecha, fecha_hora, ejecutor_id, ejecutor2_id, comentario, registrado_por,
         ddt_plan, fecha_plan, extra, ddt_real)
    values
        (p_id, v_estacion, v_turno, v_fecha, v_fecha_h, v_ejec, v_ejec2,
         nullif(btrim(d->>'comentario'), ''), (select auth.uid()),
         v_ddt_plan, v_f_plan, v_extra, v_fecha - v_tc.fecha_siembra);

    for l in select * from public._fert_lineas(d->'lineas') loop
        if v_extra then
            v_en_plan := false;   -- declarada extra: no es «fuera de plan» por error
        elsif v_f_plan is not null then
            v_en_plan := exists (select 1 from public.fert_plan p where p.turno_ciclo_id = v_turno and p.fecha = v_f_plan
                                                                 and p.material_id = l.material_id);
        else
            v_en_plan := exists (select 1 from public.fert_plan p where p.turno_ciclo_id = v_turno and p.material_id = l.material_id);
        end if;
        if not v_en_plan and not v_extra then
            v_obs := public._fert_obs(v_obs, array['FUERA_DE_PLAN']);
        end if;
        insert into public.fert_aplicaciones_detalle (aplicacion_id, material_id, cantidad, en_plan)
        values (p_id, l.material_id, l.cantidad, v_en_plan);
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'APLICACION',
                     -l.cantidad, v_fecha_h, v_turno, 'aplicacion', p_id, p_inmediato));
    end loop;
    return v_obs;
end;
$$;

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
    v_tc     public.turnos_ciclo%rowtype;
begin
    begin
        v_cl_cab := nullif(btrim(coalesce(d->>'ppm_cloro_cabezal', '')), '')::numeric;
        v_cl_cam := nullif(btrim(coalesce(d->>'ppm_cloro_campo', '')), '')::numeric;
    exception when others then
        raise exception 'Las ppm de cloro deben ser números.';
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
    if v_ini is not null and v_fin is not null and v_fin < v_ini then
        raise exception 'La hora final no puede ser anterior a la inicial.';
    end if;
    if v_ejec is not null and not exists (select 1 from public.perfiles where id = v_ejec)
       or v_ejec2 is not null and not exists (select 1 from public.perfiles where id = v_ejec2) then
        raise exception 'El estacionero que ejecutó no existe.';
    end if;

    insert into public.fert_bitacora_riego as b
        (turno_ciclo_id, fecha, estacion_id, horas_fertilizacion, horas_riego, hora_inicio, hora_fin,
         ejecutor_id, ejecutor2_id, comentario, operacion_id, updated_at, updated_by, ppm_cloro_cabezal, ppm_cloro_campo)
    values
        (v_turno, v_fecha, v_tc.estacion_id, v_hf, v_hr, v_ini, v_fin, v_ejec, v_ejec2,
         nullif(btrim(d->>'comentario'), ''), p_id, now(), (select auth.uid()), round(v_cl_cab, 2), round(v_cl_cam, 2))
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
        operacion_id        = excluded.operacion_id,
        updated_at          = now(),
        updated_by          = excluded.updated_by;
    return '{}';
end;
$$;

create or replace function public._fert_op_conteo(p_id uuid, d jsonb, p_creado timestamp with time zone, p_inmediato boolean, p_en_nombre uuid)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_fecha    timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_hay_lin  boolean := jsonb_typeof(d->'lineas') = 'array' and jsonb_array_length(d->'lineas') > 0;
    v_hay_env  boolean := jsonb_typeof(d->'envases') = 'array' and jsonb_array_length(d->'envases') > 0;
    v_obs      text[];
    v_linea    jsonb;
    v_mat      uuid;
    v_real     numeric;
    v_sistema  numeric;
    v_hay      boolean;
    v_vistos   uuid[] := '{}';
    v_env      uuid;
    v_ereal    integer;
    v_esis     integer;
begin
    v_obs := public._fert_autorizar(v_estacion, 'contar', p_creado, p_inmediato, p_en_nombre);

    if not v_hay_lin and not v_hay_env then
        raise exception 'Agrega al menos un producto contado.';
    end if;

    insert into public.fert_conteos (id, estacion_id, fecha_hora, comentario, registrado_por)
    values (p_id, v_estacion, v_fecha, nullif(btrim(d->>'comentario'), ''), (select auth.uid()));

    if v_hay_lin then
        for v_linea in select value from jsonb_array_elements(d->'lineas') loop
            v_mat := public._fert_uuid(v_linea->>'material_id');
            if v_mat is null or not exists (select 1 from public.materiales where id = v_mat) then
                raise exception 'Un producto no existe en el catálogo. Actualiza la aplicación.';
            end if;
            if v_mat = any(v_vistos) then
                raise exception 'Un producto está repetido en el conteo.';
            end if;
            v_vistos := v_vistos || v_mat;
            begin
                v_real := round(replace(btrim(v_linea->>'cantidad_real'), ',', '')::numeric, 4);
            exception when others then
                raise exception 'La cantidad contada no es un número válido.';
            end;
            if v_real is null or v_real < 0 or v_real > 1000000 then
                raise exception 'La cantidad contada debe estar entre 0 y 1,000,000.';
            end if;

            v_hay := exists (select 1 from public.fert_movimientos m
                             where m.estacion_id = v_estacion and m.material_id = v_mat and m.fecha_hora <= v_fecha);
            v_sistema := public._fert_saldo_en(v_estacion, v_mat, v_fecha);

            insert into public.fert_conteos_detalle (conteo_id, material_id, saldo_sistema, cantidad_real, diferencia)
            values (p_id, v_mat, v_sistema, v_real, v_real - v_sistema);

            v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, v_mat,
                         case when v_hay then 'AJUSTE_CONTEO' else 'SALDO_INICIAL' end,
                         v_real - v_sistema, v_fecha, null, 'conteo', p_id, false));
        end loop;
    end if;

    -- Envases contados: el ajuste = lo contado − lo que dice el sistema
    v_vistos := '{}';
    if v_hay_env then
        for v_linea in select value from jsonb_array_elements(d->'envases') loop
            v_env := public._fert_uuid(v_linea->>'envase_id');
            if v_env is null or not exists (select 1 from public.fert_envases_tipos where id = v_env) then
                raise exception 'Un tipo de envase no existe. Actualiza la aplicación.';
            end if;
            if v_env = any(v_vistos) then
                raise exception 'Un tipo de envase está repetido en el conteo.';
            end if;
            v_vistos := v_vistos || v_env;
            continue when nullif(btrim(coalesce(v_linea->>'cantidad_real', '')), '') is null;
            v_ereal := public._fert_entero_envase(v_linea->>'cantidad_real');
            v_esis := public._fert_saldo_envase(v_estacion, v_env);
            if v_ereal <> v_esis then
                insert into public.fert_envases_movimientos
                    (estacion_id, envase_id, cantidad, motivo, documento_tipo, documento_id, fecha_hora, registrado_por)
                values (v_estacion, v_env, v_ereal - v_esis, 'CONTEO', 'conteo', p_id, v_fecha, (select auth.uid()));
            end if;
        end loop;
    end if;
    return v_obs;
end;
$$;


-- ---------------------------------------------------------------- 4 · relevo con código de 12 horas

/** Código de entrega: como el TOTP pero con pasos de 10 minutos, contador 2^40 + paso y 8 dígitos. */
create or replace function public.fn_fert_codigo_largo(p_secreto bytea, p_paso bigint)
returns text
language plpgsql immutable set search_path = public, extensions, pg_temp as $$
declare
    h bytea;
    o integer;
    v bigint;
begin
    h := extensions.hmac(int8send(1099511627776 + p_paso), p_secreto, 'sha1');
    o := get_byte(h, 19) & 15;
    v := ((get_byte(h, o) & 127)::bigint << 24)
       | (get_byte(h, o + 1)::bigint << 16)
       | (get_byte(h, o + 2)::bigint << 8)
       |  get_byte(h, o + 3)::bigint;
    return lpad((v % 100000000)::text, 8, '0');
end;
$$;

/** ¿Este código de 8 dígitos lo generó esa persona en las últimas 12 horas (respecto a p_momento)? */
create or replace function public.fn_fert_codigo_largo_valido(p_perfil uuid, p_codigo text, p_momento timestamptz)
returns boolean
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
    v_secreto bytea;
    v_paso    bigint := floor(extract(epoch from p_momento) / 600)::bigint;
    i         integer;
begin
    select secreto into v_secreto from public.fert_llaves where perfil_id = p_perfil;
    if v_secreto is null or p_codigo !~ '^\d{8}$' then
        return false;
    end if;
    for i in -72 .. 1 loop
        if public.fn_fert_codigo_largo(v_secreto, v_paso + i) = p_codigo then
            return true;
        end if;
    end loop;
    return false;
end;
$$;

create or replace function public._fert_op_relevo_recibir(p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_est     uuid := public._fert_uuid(d->>'estacion_id');
    v_entrega uuid := public._fert_uuid(d->>'entrega_id');
    v_metodo  text := coalesce(nullif(d->>'metodo', ''), 'CODIGO');
    v_momento timestamptz := coalesce(nullif(d->>'momento_codigo', '')::timestamptz, p_creado);
    v_yo      uuid := (select auth.uid());
    v_r       public.fert_relevos%rowtype;
    v_rid     uuid;
    v_obs     text[] := '{}';
    v_linea   jsonb;
    v_mat     uuid;
    v_real    numeric;
    v_sis     numeric;
    v_cust    public.fert_custodia%rowtype;
begin
    if v_est is null or not exists (select 1 from public.estaciones_riego where id = v_est) then
        raise exception 'La estación no existe. Actualiza la aplicación.';
    end if;
    if not public.fn_fert_puede(v_est, 'relevo') then
        raise exception 'Tu rol no tiene «Relevo» en esta estación.' using errcode = '42501';
    end if;
    if v_entrega is null or v_entrega = v_yo then
        raise exception 'Indica quién te entrega la estación (no puedes recibírtela a ti mismo).';
    end if;
    if v_metodo not in ('CODIGO', 'CODIGO_LARGO', 'SESION') then
        raise exception 'Método de relevo desconocido.';
    end if;

    select * into v_r from public.fert_relevos
     where estacion_id = v_est and entrega_id = v_entrega and estado = 'EN_ENTREGA'
       and entregado_at <= p_creado + interval '10 minutes'
     order by entregado_at desc limit 1;

    if v_metodo = 'CODIGO' then
        -- La segunda revisión del código (el teléfono ya lo verificó sin internet)
        if abs(extract(epoch from (v_momento - p_creado))) > 900 then
            v_obs := array['RELOJ'];
        end if;
        if not public.fn_fert_totp_valido(v_entrega, coalesce(d->>'codigo', ''), v_momento, 2) then
            raise exception 'El código no corresponde a quien entrega o ya venció. Pide el código otra vez.' using errcode = '42501';
        end if;
    elsif v_metodo = 'CODIGO_LARGO' then
        -- Código de entrega de 12 horas (relevo de noche: quien entrega ya no está)
        if abs(extract(epoch from (v_momento - p_creado))) > 900 then
            v_obs := array['RELOJ'];
        end if;
        if not public.fn_fert_codigo_largo_valido(v_entrega, coalesce(d->>'codigo', ''), least(v_momento, p_creado)) then
            raise exception 'El código de entrega no corresponde a quien entrega o ya pasaron más de 12 horas.' using errcode = '42501';
        end if;
    elsif v_r.id is null then
        -- Recibir con sesión en el mismo teléfono: solo si la entrega ya está registrada en la base
        raise exception 'Esa persona no ha entregado la estación todavía.';
    end if;

    if v_r.id is not null then
        update public.fert_relevos
           set estado = 'RECIBIDO', recibe_id = v_yo, recibido_at = p_creado, metodo = v_metodo,
               codigo_verificado = (v_metodo in ('CODIGO', 'CODIGO_LARGO')), nota_recibe = nullif(btrim(d->>'nota'), ''),
               operacion_recibe = p_id
         where id = v_r.id;
        v_rid := v_r.id;
    else
        -- El «entregar» del otro teléfono aún no llega: se crea el relevo y se completa cuando llegue
        insert into public.fert_relevos
            (id, estacion_id, metodo, estado, entrega_id, recibe_id, entregado_at, recibido_at, codigo_verificado,
             nota_recibe, registrado_por, entrega_registrada, operacion_recibe)
        values
            (p_id, v_est, v_metodo, 'RECIBIDO', v_entrega, v_yo,
             case when v_metodo = 'CODIGO_LARGO' then p_creado - interval '12 hours' else least(v_momento, p_creado) end,
             p_creado, true, nullif(btrim(d->>'nota'), ''), v_yo, false, p_id);
        v_rid := p_id;
    end if;

    -- Diferencias declaradas (lo demás, «recibo conforme»)
    if jsonb_typeof(d->'diferencias') = 'array' then
        for v_linea in select value from jsonb_array_elements(d->'diferencias') loop
            v_mat := public._fert_uuid(v_linea->>'material_id');
            continue when v_mat is null or not exists (select 1 from public.materiales where id = v_mat);
            begin
                v_real := round(replace(btrim(v_linea->>'cantidad_real'), ',', '')::numeric, 4);
            exception when others then
                raise exception 'Una cantidad del relevo no es un número válido.';
            end;
            continue when v_real is null;
            if v_real < 0 or v_real > 1000000 then
                raise exception 'Las cantidades del relevo deben estar entre 0 y 1,000,000.';
            end if;
            v_sis := public._fert_saldo_en(v_est, v_mat, p_creado);
            continue when v_real = v_sis;
            insert into public.fert_relevos_diferencias (relevo_id, material_id, saldo_sistema, cantidad_real, diferencia)
            values (v_rid, v_mat, v_sis, v_real, v_real - v_sis)
            on conflict (relevo_id, material_id) do update set saldo_sistema = excluded.saldo_sistema,
                cantidad_real = excluded.cantidad_real, diferencia = excluded.diferencia;
            perform public._fert_mover(p_id, v_est, v_mat, 'DIFERENCIA_RELEVO', v_real - v_sis, p_creado, null,
                                       'relevo', v_rid, false);
            v_obs := public._fert_obs(v_obs, array['DIFERENCIA_RELEVO']);
        end loop;
        if 'DIFERENCIA_RELEVO' = any(v_obs) then
            update public.fert_relevos set revisar = true where id = v_rid;
        end if;
    end if;

    -- La custodia pasa a quien recibe (salvo que ya haya una asignación posterior)
    select * into v_cust from public.fert_custodia where estacion_id = v_est for update;
    if v_cust.estacion_id is null or v_cust.desde <= p_creado then
        insert into public.fert_custodia (estacion_id, custodio_id, estado, desde, relevo_id, updated_at)
        values (v_est, v_yo, 'ACTIVA', p_creado, v_rid, now())
        on conflict (estacion_id) do update set custodio_id = excluded.custodio_id, estado = 'ACTIVA',
            desde = excluded.desde, relevo_id = excluded.relevo_id, updated_at = now();
    else
        v_obs := public._fert_obs(v_obs, array['CUSTODIA_POSTERIOR']);
    end if;
    return v_obs;
end;
$$;


-- ---------------------------------------------------------------- 5 · despachador (dos tipos nuevos)

create or replace function public._fert_procesar(p_op jsonb)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id        uuid := public._fert_uuid(p_op->>'id');
    v_tipo      text := p_op->>'tipo';
    v_datos     jsonb := coalesce(p_op->'datos', '{}'::jsonb);
    v_creado    timestamptz := coalesce(nullif(p_op->>'creado_en', '')::timestamptz, now());
    v_enviado   timestamptz := nullif(p_op->>'enviado_en', '')::timestamptz;
    v_inmediato boolean := coalesce((p_op->>'inmediato')::boolean, false);
    v_en_nombre uuid := public._fert_uuid(p_op->>'en_nombre_de');
    v_lat       double precision := nullif(p_op->'ubicacion'->>'lat', '')::double precision;
    v_lon       double precision := nullif(p_op->'ubicacion'->>'lon', '')::double precision;
    v_obs       text[] := '{}';
    v_est       uuid;
begin
    if v_id is null then
        raise exception 'El registro no trae identificador.';
    end if;
    if v_tipo is null or v_tipo not in ('recepcion', 'aplicacion', 'bitacora', 'conteo', 'devolucion', 'anulacion',
                                        'chofer', 'vehiculo', 'producto', 'envase_tipo',
                                        'relevo_entregar', 'relevo_recibir', 'relevo_cancelar',
                                        'relevo_rechazar', 'traslado_crear', 'traslado_autorizar', 'traslado_aceptar',
                                        'traslado_rechazar', 'traslado_cancelar') then
        raise exception 'Tipo de registro desconocido: %. Actualiza la aplicación.', coalesce(v_tipo, '(vacío)');
    end if;

    if v_enviado is not null and abs(extract(epoch from (v_enviado - now()))) > 300
       or v_creado > now() + interval '5 minutes' then
        v_obs := array['RELOJ'];
    end if;
    -- Catálogos (chofer, vehículo, producto, envase) no necesitan ubicación
    if (v_lat is null or v_lon is null) and v_tipo not in ('chofer', 'vehiculo', 'producto', 'envase_tipo') then
        v_obs := public._fert_obs(v_obs, array['SIN_UBICACION']);
    end if;

    v_est := coalesce(public._fert_uuid(v_datos->>'estacion_id'), public._fert_uuid(v_datos->>'origen_id'),
                      (select origen_id from public.fert_traslados where id = public._fert_uuid(v_datos->>'traslado_id')),
                      (select estacion_id from public.fert_relevos where id = public._fert_uuid(v_datos->>'relevo_id')));

    insert into public.fert_operaciones
        (id, tipo, estacion_id, perfil_id, en_nombre_de, dispositivo, creado_en, enviado_en, inmediato,
         lat, lon, precision_m, datos, resultado)
    values
        (v_id, v_tipo, v_est, (select auth.uid()), v_en_nombre,
         left(p_op->>'dispositivo', 200), v_creado, v_enviado, v_inmediato,
         v_lat, v_lon, nullif(p_op->'ubicacion'->>'precision', '')::double precision, v_datos - 'codigo', 'ACEPTADO');

    v_obs := public._fert_obs(v_obs, case v_tipo
        when 'recepcion'          then public._fert_op_recepcion(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'aplicacion'         then public._fert_op_aplicacion(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'bitacora'           then public._fert_op_bitacora(v_id, v_datos, v_creado, v_en_nombre)
        when 'conteo'             then public._fert_op_conteo(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'devolucion'         then public._fert_op_devolucion(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'anulacion'          then public._fert_op_anulacion(v_id, v_datos, v_creado, v_inmediato)
        when 'chofer'             then public._fert_op_chofer(v_id, v_datos)
        when 'vehiculo'           then public._fert_op_vehiculo(v_id, v_datos)
        when 'producto'           then public._fert_op_producto(v_id, v_datos)
        when 'envase_tipo'        then public._fert_op_envase_tipo(v_id, v_datos)
        when 'relevo_entregar'    then public._fert_op_relevo_entregar(v_id, v_datos, v_creado, v_inmediato)
        when 'relevo_recibir'     then public._fert_op_relevo_recibir(v_id, v_datos, v_creado, v_inmediato)
        when 'relevo_cancelar'    then public._fert_op_relevo_cancelar(v_id, v_datos)
        when 'relevo_rechazar'    then public._fert_op_relevo_rechazar(v_id, v_datos)
        when 'traslado_crear'     then public._fert_op_traslado_crear(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'traslado_autorizar' then public._fert_op_traslado_autorizar(v_id, v_datos, v_creado, v_inmediato)
        when 'traslado_aceptar'   then public._fert_op_traslado_resolver(v_id, v_datos, v_creado, v_inmediato, v_en_nombre, true)
        when 'traslado_rechazar'  then public._fert_op_traslado_resolver(v_id, v_datos, v_creado, v_inmediato, v_en_nombre, false)
        when 'traslado_cancelar'  then public._fert_op_traslado_cancelar(v_id, v_datos)
    end);

    update public.fert_operaciones
       set observaciones = v_obs,
           resultado = case when cardinality(v_obs) > 0 then 'ACEPTADO_CON_OBSERVACIONES' else 'ACEPTADO' end
     where id = v_id;
    return v_obs;
end;
$$;


-- ---------------------------------------------------------------- 6 · AGL publica (grupo y fertilizante)

create or replace function public.fn_fert_publicar(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_avisos  text[] := '{}';
    v_n_est   integer := 0;
    v_n_mat   integer := 0;
    v_n_tur   integer := 0;
    v_n_plan  integer := 0;
    v_n_inact integer := 0;
    v_zona    uuid;
    v_est     uuid;
    v_turno   uuid;
    v_tc      uuid;
    v_faltan  integer;
    e record;
    m record;
    t record;
    g jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'publicar')) then
        raise exception 'Este usuario no tiene «Publicar» en «Fertirriego · Conexión AGL».' using errcode = '42501';
    end if;

    -- ---- Estaciones (por nombre) ----
    for e in select * from jsonb_to_recordset(coalesce(p->'estaciones', '[]')) as x(nombre text, zona text) loop
        continue when nullif(btrim(e.nombre), '') is null;
        v_zona := (select z.id from public.zonas z where public._fert_llave(z.nombre) = public._fert_llave(e.zona) limit 1);
        if nullif(btrim(e.zona), '') is not null and v_zona is null then
            v_avisos := v_avisos || format('Zona «%s» (estación %s) no existe en AgroNotificaciones.', e.zona, e.nombre);
        end if;
        update public.estaciones_riego
           set zona_id = coalesce(v_zona, zona_id), activo = true
         where public._fert_llave(nombre) = public._fert_llave(e.nombre);
        if not found then
            insert into public.estaciones_riego (nombre, zona_id) values (btrim(e.nombre), v_zona);
        end if;
        v_n_est := v_n_est + 1;
    end loop;

    -- ---- Materiales (por código; AGL manda en unidad y en si es fertilizante; descripción y grupo solo si faltan) ----
    for m in select * from jsonb_to_recordset(coalesce(p->'materiales', '[]'))
             as x(codigo text, descripcion text, unidad text, grupo text, analisis boolean) loop
        continue when nullif(btrim(m.codigo), '') is null or btrim(m.codigo) like 'CAMPO-%';
        insert into public.materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen)
        values (btrim(m.codigo), m.descripcion, nullif(btrim(m.grupo), ''), m.unidad, true, coalesce(m.analisis, true), 'MARA')
        on conflict (codigo) do update set
            unidad = coalesce(excluded.unidad, materiales.unidad),
            fertirriego = true,
            fert_analisis = coalesce(m.analisis, materiales.fert_analisis),
            descripcion = coalesce(materiales.descripcion, excluded.descripcion),
            grupo = coalesce(materiales.grupo, excluded.grupo),
            activo = true;
        v_n_mat := v_n_mat + 1;
    end loop;

    -- ---- Turnos por temporada y ciclo ----
    for t in select * from jsonb_to_recordset(coalesce(p->'turnos', '[]')) as x(
                 agl_id text, turno text, temporada text, ciclo text, fecha_siembra date, estacion text, zona text,
                 orden_sap text, plan text, tipo_plan text, area_mz numeric, estado text) loop
        continue when nullif(btrim(t.agl_id), '') is null or nullif(btrim(t.turno), '') is null;
        v_zona := (select z.id from public.zonas z where public._fert_llave(z.nombre) = public._fert_llave(t.zona) limit 1);
        v_est := (select s.id from public.estaciones_riego s where public._fert_llave(s.nombre) = public._fert_llave(t.estacion) limit 1);
        if v_est is null then
            v_avisos := v_avisos || format('Turno %s: la estación «%s» no existe.', t.turno, coalesce(t.estacion, '(vacía)'));
        end if;

        insert into public.turnos (codigo, zona_id) values (btrim(t.turno), v_zona)
        on conflict (codigo) do update set zona_id = coalesce(excluded.zona_id, turnos.zona_id)
        returning id into v_turno;

        insert into public.turnos_ciclo
            (agl_id, turno_id, temporada, ciclo, fecha_siembra, estacion_id, zona_id, orden_sap, plan, tipo_plan,
             area_mz, estado, activo, publicado_at)
        values
            (btrim(t.agl_id), v_turno, coalesce(t.temporada, p->>'temporada'), t.ciclo, t.fecha_siembra, v_est, v_zona,
             nullif(btrim(t.orden_sap), ''), t.plan, t.tipo_plan, t.area_mz, t.estado, true, now())
        on conflict (agl_id) do update set
            turno_id = excluded.turno_id, temporada = excluded.temporada, ciclo = excluded.ciclo,
            fecha_siembra = excluded.fecha_siembra, estacion_id = excluded.estacion_id, zona_id = excluded.zona_id,
            orden_sap = excluded.orden_sap, plan = excluded.plan, tipo_plan = excluded.tipo_plan,
            area_mz = excluded.area_mz, estado = excluded.estado, activo = true, publicado_at = now();
        v_n_tur := v_n_tur + 1;
    end loop;

    if coalesce((p->>'completo')::boolean, false) and p->>'temporada' is not null then
        update public.turnos_ciclo tc
           set activo = false
         where tc.temporada = p->>'temporada'
           and tc.activo
           and tc.agl_id not in (select x->>'agl_id' from jsonb_array_elements(coalesce(p->'turnos', '[]')) x);
        get diagnostics v_n_inact = row_count;
    end if;

    -- ---- Plan: se reemplaza el de cada turno que viene ----
    for g in select value from jsonb_array_elements(coalesce(p->'plan', '[]')) loop
        v_tc := (select id from public.turnos_ciclo where agl_id = g->>'agl_id');
        if v_tc is null then
            v_avisos := v_avisos || format('Plan del turno %s: el turno no se publicó.', g->>'agl_id');
            continue;
        end if;
        delete from public.fert_plan where turno_ciclo_id = v_tc;

        insert into public.fert_plan
            (turno_ciclo_id, fecha, ddt, material_id, cantidad, unidad, dosis_mz, horas_riego, volumen_m3)
        select v_tc, x.fecha, x.ddt, mt.id, x.cantidad, coalesce(x.unidad, mt.unidad), x.dosis_mz, x.horas_riego, x.volumen_m3
        from jsonb_to_recordset(coalesce(g->'filas', '[]')) as x(
                 fecha date, ddt integer, material text, cantidad numeric, unidad text, dosis_mz numeric,
                 horas_riego numeric, volumen_m3 numeric)
        join public.materiales mt on mt.codigo = btrim(x.material)
        where x.fecha is not null and x.cantidad is not null;
        v_n_plan := v_n_plan + (select count(*) from public.fert_plan where turno_ciclo_id = v_tc);

        select count(*) into v_faltan
        from jsonb_to_recordset(coalesce(g->'filas', '[]')) as x(material text)
        where not exists (select 1 from public.materiales mt where mt.codigo = btrim(x.material));
        if v_faltan > 0 then
            v_avisos := v_avisos || format('Plan del turno %s: %s fila(s) con material que no se publicó.', g->>'agl_id', v_faltan);
        end if;
    end loop;

    insert into public.fert_publicaciones (temporada, publicado_por, conteos, avisos)
    values (p->>'temporada', (select auth.uid()),
            jsonb_build_object('estaciones', v_n_est, 'materiales', v_n_mat, 'turnos', v_n_tur,
                               'turnos_desactivados', v_n_inact, 'filas_plan', v_n_plan),
            v_avisos);

    return jsonb_build_object('estaciones', v_n_est, 'materiales', v_n_mat, 'turnos', v_n_tur,
                              'turnos_desactivados', v_n_inact, 'filas_plan', v_n_plan, 'avisos', to_jsonb(v_avisos));
end;
$$;


-- ---------------------------------------------------------------- 7 · lo que baja el teléfono

create or replace function public.fn_fert_estado_campo(p_desde date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_yo     uuid := (select auth.uid());
    v_est    uuid[];
    v_turnos uuid[];
    v_desde  timestamptz;
    v_zonas  uuid[];
    v_res    jsonb;
begin
    if v_yo is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'ver')) then
        raise exception 'Tu rol no tiene «Ver» en Fertirriego.' using errcode = '42501';
    end if;

    v_est := array(select e.id from public.estaciones_riego e where e.activo and public.fn_fert_puede(e.id, 'ver') order by e.nombre);
    v_turnos := array(select tc.id from public.turnos_ciclo tc where (tc.estacion_id = any(v_est) or tc.estacion_id in (select e9.prueba_de from public.estaciones_riego e9 where e9.id = any(v_est))) and tc.activo);
    v_zonas := array(select distinct e.zona_id from public.estaciones_riego e where e.id = any(v_est) and e.zona_id is not null);
    v_desde := greatest(
        coalesce(p_desde::timestamptz,
                 (select min(tc.fecha_siembra) - 30 from public.turnos_ciclo tc where tc.id = any(v_turnos))::timestamptz,
                 now() - interval '120 days'),
        now() - interval '365 days');

    select jsonb_build_object(
        'servidor_en', now(),
        'desde', v_desde,
        'yo', (select jsonb_build_object('id', p.id, 'nombre', p.nombre) from public.perfiles p where p.id = v_yo),

        'estaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', e.id, 'nombre', e.nombre, 'zona_id', e.zona_id,
                'zona', (select z.nombre from public.zonas z where z.id = e.zona_id),
                'custodio_id', c.custodio_id,
                'custodio', (select p.nombre from public.perfiles p where p.id = c.custodio_id),
                'custodia_estado', c.estado, 'custodia_desde', c.desde,
                'permisos', jsonb_build_object(
                    'recibir', public.fn_fert_puede(e.id, 'recibir'),
                    'aplicar', public.fn_fert_puede(e.id, 'aplicar'),
                    'contar', public.fn_fert_puede(e.id, 'contar'),
                    'relevo', public.fn_fert_puede(e.id, 'relevo'),
                    'trasladar', public.fn_fert_puede(e.id, 'trasladar'),
                    'autorizar_traslado', public.fn_fert_puede(e.id, 'autorizar_traslado'),
                    'anular', public.fn_fert_puede(e.id, 'anular'),
                    'en_nombre_de', public.fn_fert_puede(e.id, 'en_nombre_de'),
                    'administrar', public.fn_fert_puede(e.id, 'administrar_estaciones'),
                    'gestionar_choferes', public.fn_fert_puede(e.id, 'gestionar_choferes')),
                'personas', coalesce((
                    select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre)
                    from public.perfiles_estaciones pe join public.perfiles p on p.id = pe.perfil_id
                    where pe.estacion_id = e.id and p.activo), '[]'::jsonb),
                'autorizadores', coalesce((
                    select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre))
                    from public._fert_autorizadores(e.id) a where a.id <> v_yo), '[]'::jsonb)
            ) order by e.nombre)
            from public.estaciones_riego e
            left join public.fert_custodia c on c.estacion_id = e.id
            where e.id = any(v_est)), '[]'::jsonb),

        -- Estaciones a las que se puede trasladar (las de sus zonas; si no tiene zonas, todas las activas)
        'destinos', coalesce((
            select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre,
                                                'zona', (select z.nombre from public.zonas z where z.id = e.zona_id),
                                                'misma_zona', e.zona_id = any(v_zonas)) order by (e.zona_id = any(v_zonas)) desc, e.nombre)
            from public.estaciones_riego e where e.activo and ((e.prueba_de is not null) = public.fn_fert_en_pruebas())), '[]'::jsonb),

        'turnos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', tc.id, 'turno', t.codigo, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
                'fecha_siembra', tc.fecha_siembra, 'estacion_id', case when public.fn_fert_en_pruebas() then coalesce((select e9.id from public.estaciones_riego e9 where e9.prueba_de = tc.estacion_id and e9.id = any(v_est) limit 1), tc.estacion_id) else tc.estacion_id end, 'orden_sap', tc.orden_sap,
                'plan', tc.plan, 'area_mz', tc.area_mz, 'activo', tc.activo
            ) order by t.codigo)
            from public.turnos_ciclo tc join public.turnos t on t.id = tc.turno_id
            where tc.id = any(v_turnos)), '[]'::jsonb),

        'plan', coalesce((
            select jsonb_agg(jsonb_build_object(
                'turno_ciclo_id', fp.turno_ciclo_id, 'fecha', fp.fecha, 'ddt', fp.ddt, 'material_id', fp.material_id,
                'cantidad', fp.cantidad, 'horas_riego', fp.horas_riego
            ) order by fp.fecha)
            from public.fert_plan fp where fp.turno_ciclo_id = any(v_turnos)), '[]'::jsonb),

        -- 99: fertilizantes (entran al análisis) primero; los de campo también (aunque inactivos para otros módulos)
        'materiales', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'codigo', m.codigo, 'descripcion', m.descripcion,
                                                'unidad', m.unidad, 'grupo', m.grupo, 'origen', m.origen,
                                                'validado', m.validado, 'analisis', m.fert_analisis)
                             order by m.fert_analisis desc, m.grupo nulls last, m.descripcion)
            from public.materiales m where m.fertirriego and (m.activo or m.origen = 'CAMPO')), '[]'::jsonb),

        'choferes', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'validado', c.validado) order by c.nombre)
            from public.fert_choferes c where c.activo), '[]'::jsonb),
        'vehiculos', coalesce((
            select jsonb_agg(jsonb_build_object('id', v.id, 'placa', v.placa, 'tipo', v.tipo, 'marca', v.marca,
                                                'color', v.color, 'validado', v.validado) order by v.placa)
            from public.fert_vehiculos v where v.activo), '[]'::jsonb),
        'choferes_vehiculos', coalesce((
            select jsonb_agg(jsonb_build_object('chofer_id', cv.chofer_id, 'vehiculo_id', cv.vehiculo_id,
                                                'ultima_vez', cv.ultima_vez))
            from public.fert_choferes_vehiculos cv), '[]'::jsonb),

        'envases_tipos', coalesce((
            select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'validado', x.validado) order by x.nombre)
            from public.fert_envases_tipos x where x.activo), '[]'::jsonb),
        'envases_saldos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion_id', s.estacion_id, 'envase_id', s.envase_id, 'saldo', s.saldo))
            from (select estacion_id, envase_id, sum(cantidad)::integer as saldo
                  from public.fert_envases_movimientos where estacion_id = any(v_est)
                  group by 1, 2 having sum(cantidad) <> 0) s), '[]'::jsonb),

        'saldos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion_id', s.estacion_id, 'material_id', s.material_id,
                                                'disponible', s.disponible, 'en_transito', s.en_transito))
            from public.fert_saldos s where s.estacion_id = any(v_est)), '[]'::jsonb),

        'movimientos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', m.id, 'cursor', m.cursor, 'estacion_id', m.estacion_id, 'material_id', m.material_id,
                'tipo', m.tipo, 'cantidad', m.cantidad, 'fecha_hora', m.fecha_hora, 'turno_ciclo_id', m.turno_ciclo_id,
                'documento_tipo', m.documento_tipo, 'documento_id', m.documento_id, 'anula_id', m.anula_id,
                'registrado_por', m.registrado_por
            ) order by m.fecha_hora, m.cursor)
            from public.fert_movimientos m
            where m.estacion_id = any(v_est) and m.fecha_hora >= v_desde), '[]'::jsonb),

        'saldos_previos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion_id', x.estacion_id, 'material_id', x.material_id, 'saldo', x.saldo))
            from (select m.estacion_id, m.material_id, sum(m.cantidad) as saldo
                  from public.fert_movimientos m
                  where m.estacion_id = any(v_est) and m.fecha_hora < v_desde
                  group by 1, 2) x), '[]'::jsonb),

        'recepciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id, 'estacion_id', r.estacion_id, 'fecha_hora', r.fecha_hora, 'chofer_id', r.chofer_id,
                'vehiculo_id', r.vehiculo_id, 'lugar', r.lugar, 'documento', r.documento, 'comentario', r.comentario,
                'registrado_por', r.registrado_por, 'anulado_at', r.anulado_at, 'motivo_anulacion', r.motivo_anulacion,
                'turnos', to_jsonb(r.turnos),
                'envases', (select jsonb_agg(jsonb_build_object('envase_id', x.envase_id, 'recibidos', x.rec, 'entregados', x.ent))
                            from (select em.envase_id,
                                         coalesce(sum(em.cantidad) filter (where em.motivo = 'RECEPCION'), 0)::integer as rec,
                                         coalesce(-sum(em.cantidad) filter (where em.motivo = 'ENTREGA'), 0)::integer as ent
                                  from public.fert_envases_movimientos em
                                  where em.documento_id = r.id and em.motivo in ('RECEPCION', 'ENTREGA')
                                  group by em.envase_id) x)))
            from public.fert_recepciones r where r.estacion_id = any(v_est) and r.fecha_hora >= v_desde), '[]'::jsonb),

        'aplicaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', a.id, 'estacion_id', a.estacion_id, 'turno_ciclo_id', a.turno_ciclo_id, 'fecha', a.fecha,
                'fecha_hora', a.fecha_hora, 'ejecutor_id', a.ejecutor_id, 'ejecutor2_id', a.ejecutor2_id,
                'comentario', a.comentario, 'registrado_por', a.registrado_por, 'anulado_at', a.anulado_at,
                'motivo_anulacion', a.motivo_anulacion,
                'ddt_plan', a.ddt_plan, 'fecha_plan', a.fecha_plan, 'extra', a.extra, 'ddt_real', a.ddt_real,
                'lineas', (select jsonb_agg(jsonb_build_object('material_id', d.material_id, 'cantidad', d.cantidad,
                                                               'en_plan', d.en_plan))
                           from public.fert_aplicaciones_detalle d where d.aplicacion_id = a.id)))
            from public.fert_aplicaciones a where a.estacion_id = any(v_est) and a.fecha_hora >= v_desde), '[]'::jsonb),

        'bitacora_riego', coalesce((
            select jsonb_agg(jsonb_build_object(
                'turno_ciclo_id', b.turno_ciclo_id, 'fecha', b.fecha, 'horas_fertilizacion', b.horas_fertilizacion,
                'horas_riego', b.horas_riego, 'hora_inicio', b.hora_inicio, 'hora_fin', b.hora_fin,
                'ejecutor_id', b.ejecutor_id, 'ejecutor2_id', b.ejecutor2_id, 'comentario', b.comentario,
                'ppm_cloro_cabezal', b.ppm_cloro_cabezal, 'ppm_cloro_campo', b.ppm_cloro_campo))
            from public.fert_bitacora_riego b where b.estacion_id = any(v_est) and b.fecha >= v_desde::date), '[]'::jsonb),

        'relevos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id, 'estacion_id', r.estacion_id, 'estado', r.estado, 'metodo', r.metodo,
                'entrega_id', r.entrega_id, 'entrega', (select p.nombre from public.perfiles p where p.id = r.entrega_id),
                'recibe_id', r.recibe_id, 'recibe', (select p.nombre from public.perfiles p where p.id = r.recibe_id),
                'entregado_at', r.entregado_at, 'recibido_at', r.recibido_at, 'novedades', r.novedades,
                'nota_entrega', r.nota_entrega, 'nota_recibe', r.nota_recibe, 'motivo', r.motivo, 'revisar', r.revisar,
                'diferencias', coalesce((select jsonb_agg(jsonb_build_object('material_id', x.material_id,
                                           'saldo_sistema', x.saldo_sistema, 'cantidad_real', x.cantidad_real, 'diferencia', x.diferencia))
                                         from public.fert_relevos_diferencias x where x.relevo_id = r.id), '[]'::jsonb)
            ) order by coalesce(r.recibido_at, r.entregado_at) desc)
            from (select * from public.fert_relevos
                  where estacion_id = any(v_est)
                    and (estado = 'EN_ENTREGA' or coalesce(recibido_at, entregado_at, created_at) >= v_desde)
                  order by coalesce(recibido_at, entregado_at, created_at) desc limit 60) r), '[]'::jsonb),

        'traslados', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', t.id, 'origen_id', t.origen_id, 'destino_id', t.destino_id,
                'origen', (select e.nombre from public.estaciones_riego e where e.id = t.origen_id),
                'destino', (select e.nombre from public.estaciones_riego e where e.id = t.destino_id),
                'estado', t.estado, 'motivo', t.motivo, 'autorizador_id', t.autorizador_id,
                'autorizador', (select p.nombre from public.perfiles p where p.id = t.autorizador_id),
                'creado_por', t.creado_por, 'creador', (select p.nombre from public.perfiles p where p.id = t.creado_por),
                'creado_at', t.creado_at, 'autorizado_at', t.autorizado_at, 'resuelto_at', t.resuelto_at,
                'nota_autorizacion', t.nota_autorizacion, 'nota_resolucion', t.nota_resolucion,
                'lineas', (select jsonb_agg(jsonb_build_object('material_id', d.material_id, 'cantidad_enviada', d.cantidad_enviada,
                                                               'cantidad_recibida', d.cantidad_recibida))
                           from public.fert_traslados_detalle d where d.traslado_id = t.id)
            ) order by t.creado_at desc)
            from public.fert_traslados t
            where (t.origen_id = any(v_est) or t.destino_id = any(v_est) or t.autorizador_id = v_yo)
              and (t.estado in ('POR_AUTORIZAR', 'EN_TRANSITO') or t.creado_at >= v_desde)), '[]'::jsonb),

        'mis_operaciones', coalesce((
            select jsonb_agg(jsonb_build_object('id', o.id, 'tipo', o.tipo, 'resultado', o.resultado,
                                                'mensaje', o.mensaje, 'observaciones', o.observaciones,
                                                'recibido_en', o.recibido_en) order by o.recibido_en desc)
            from (select * from public.fert_operaciones where perfil_id = v_yo order by recibido_en desc limit 100) o),
            '[]'::jsonb)
    ) into v_res;

    return v_res;
end;
$$;


-- ---------------------------------------------------------------- 8 · lo que baja AGL

create or replace function public.fn_fert_exportar(p_cursor bigint default 0, p_limite integer default 5000)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_lim integer := greatest(1, least(coalesce(p_limite, 5000), 20000));
    v_res jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'ver')) then
        raise exception 'Este usuario no tiene «Ver» en «Fertirriego · Conexión AGL».' using errcode = '42501';
    end if;

    with m as (
        select * from public.fert_movimientos where cursor > coalesce(p_cursor, 0) and estacion_id not in (select e9.id from public.estaciones_riego e9 where e9.prueba_de is not null) order by cursor limit v_lim
    )
    select jsonb_build_object(
        'generado', now(),
        'ultimo_cursor', coalesce((select max(cursor) from m), coalesce(p_cursor, 0)),
        'hay_mas', (select count(*) from m) = v_lim,
        'movimientos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'cursor', m.cursor, 'id', m.id, 'fecha_hora', m.fecha_hora, 'tipo', m.tipo, 'cantidad', m.cantidad,
                'estacion', e.nombre, 'zona', z.nombre, 'material', mt.codigo, 'texto_material', mt.descripcion,
                'unidad', mt.unidad, 'origen', mt.origen, 'grupo', mt.grupo, 'analisis', mt.fert_analisis,
                'turno', t.codigo, 'turno_agl_id', tc.agl_id, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
                'orden_sap', tc.orden_sap,
                'fecha_turno', ap.fecha,
                'ddt_plan', ap.ddt_plan, 'fecha_plan', ap.fecha_plan, 'extra', ap.extra, 'ddt_real', ap.ddt_real,
                'recepcion_turnos', (select jsonb_agg(tt.codigo order by tt.codigo)
                                     from public.fert_recepciones r
                                     join public.turnos_ciclo tc2 on tc2.id = any(r.turnos)
                                     join public.turnos tt on tt.id = tc2.turno_id
                                     where r.id = m.documento_id),
                'comentario', coalesce(ap.comentario, (select r.comentario from public.fert_recepciones r where r.id = m.documento_id)),
                'documento_tipo', m.documento_tipo, 'documento_id', m.documento_id, 'anula_id', m.anula_id,
                'registrado_por', p.nombre,
                'ejecutor', (select pp.nombre from public.perfiles pp where pp.id = ap.ejecutor_id),
                'observaciones', (select o.observaciones from public.fert_operaciones o where o.id = m.operacion_id)
            ) order by m.cursor)
            from m
            join public.estaciones_riego e on e.id = m.estacion_id
            left join public.zonas z on z.id = e.zona_id
            join public.materiales mt on mt.id = m.material_id
            left join public.turnos_ciclo tc on tc.id = m.turno_ciclo_id
            left join public.turnos t on t.id = tc.turno_id
            left join public.fert_aplicaciones ap on ap.id = m.documento_id
            left join public.perfiles p on p.id = m.registrado_por), '[]'::jsonb),
        'bitacora_riego', coalesce((
            select jsonb_agg(jsonb_build_object(
                'turno_agl_id', tc.agl_id, 'turno', t.codigo, 'fecha', b.fecha, 'estacion', e.nombre,
                'horas_fertilizacion', b.horas_fertilizacion, 'horas_riego', b.horas_riego,
                'hora_inicio', b.hora_inicio, 'hora_fin', b.hora_fin,
                'ppm_cloro_cabezal', b.ppm_cloro_cabezal, 'ppm_cloro_campo', b.ppm_cloro_campo,
                'ejecutor', (select p.nombre from public.perfiles p where p.id = b.ejecutor_id)))
            from public.fert_bitacora_riego b
            join public.turnos_ciclo tc on tc.id = b.turno_ciclo_id
            join public.turnos t on t.id = tc.turno_id
            join public.estaciones_riego e on e.id = b.estacion_id and e.prueba_de is null), '[]'::jsonb),
        'saldos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'zona', z.nombre, 'material', mt.codigo,
                                                'texto_material', mt.descripcion, 'unidad', mt.unidad,
                                                'origen', mt.origen, 'grupo', mt.grupo, 'analisis', mt.fert_analisis,
                                                'disponible', s.disponible, 'en_transito', s.en_transito))
            from public.fert_saldos s
            join public.estaciones_riego e on e.id = s.estacion_id and e.prueba_de is null
            left join public.zonas z on z.id = e.zona_id
            join public.materiales mt on mt.id = s.material_id), '[]'::jsonb),
        'envases_saldos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'zona', z.nombre, 'envase', x.nombre, 'saldo', s.saldo)
                             order by e.nombre, x.nombre)
            from (select estacion_id, envase_id, sum(cantidad)::integer as saldo
                  from public.fert_envases_movimientos group by 1, 2 having sum(cantidad) <> 0) s
            join public.estaciones_riego e on e.id = s.estacion_id and e.prueba_de is null
            left join public.zonas z on z.id = e.zona_id
            join public.fert_envases_tipos x on x.id = s.envase_id), '[]'::jsonb),
        'relevos_revisar', coalesce((
            select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'entrega', pe.nombre, 'recibe', pr.nombre,
                                                'recibido_at', r.recibido_at, 'estado', r.estado, 'motivo', r.motivo))
            from public.fert_relevos r
            join public.estaciones_riego e on e.id = r.estacion_id and e.prueba_de is null
            left join public.perfiles pe on pe.id = r.entrega_id
            left join public.perfiles pr on pr.id = r.recibe_id
            where r.revisar), '[]'::jsonb)
    ) into v_res;
    return v_res;
end;
$$;


-- ---------------------------------------------------------------- 9 · administración de catálogos de campo

create or replace function public._fert_gestiona_catalogos() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'gestionar_choferes')) then
        raise exception 'Tu rol no tiene «Gestionar choferes» en Fertirriego.' using errcode = '42501';
    end if;
end;
$$;

create or replace function public.fn_fert_catalogos_campo()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._fert_gestiona_catalogos();
    return jsonb_build_object(
        'choferes', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'identidad', c.identidad,
                       'telefono', c.telefono, 'validado', c.validado, 'activo', c.activo, 'creado', c.created_at,
                       'recepciones', (select count(*) from public.fert_recepciones r where r.chofer_id = c.id),
                       'ultima_vez', (select max(r.fecha_hora) from public.fert_recepciones r where r.chofer_id = c.id))
                   order by c.activo desc, c.validado, c.nombre)
            from public.fert_choferes c), '[]'::jsonb),
        'vehiculos', coalesce((
            select jsonb_agg(jsonb_build_object('id', v.id, 'placa', v.placa, 'tipo', v.tipo, 'marca', v.marca,
                       'color', v.color, 'validado', v.validado, 'activo', v.activo, 'creado', v.created_at,
                       'recepciones', (select count(*) from public.fert_recepciones r where r.vehiculo_id = v.id),
                       'ultima_vez', (select max(r.fecha_hora) from public.fert_recepciones r where r.vehiculo_id = v.id))
                   order by v.activo desc, v.validado, v.placa)
            from public.fert_vehiculos v), '[]'::jsonb),
        'envases', coalesce((
            select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'validado', x.validado, 'activo', x.activo,
                       'usos', (select count(*) from public.fert_envases_movimientos em where em.envase_id = x.id))
                   order by x.activo desc, x.validado, x.nombre)
            from public.fert_envases_tipos x), '[]'::jsonb),
        'productos', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'codigo', m.codigo, 'descripcion', m.descripcion,
                       'unidad', m.unidad, 'grupo', m.grupo, 'validado', m.validado, 'activo', m.fertirriego,
                       'movimientos', (select count(*) from public.fert_movimientos fm where fm.material_id = m.id),
                       'saldo', (select coalesce(sum(s.disponible + s.en_transito), 0) from public.fert_saldos s where s.material_id = m.id))
                   order by m.fertirriego desc, m.validado, m.descripcion)
            from public.materiales m where m.origen = 'CAMPO'), '[]'::jsonb),
        'clases', coalesce((
            select jsonb_agg(distinct m.grupo) from public.materiales m
            where m.fertirriego and m.grupo is not null and (m.activo or m.origen = 'CAMPO')), '[]'::jsonb)
    );
end;
$$;

/** Un chofer repetido: sus recepciones pasan al que se deja y el repetido se desactiva. */
create or replace function public.fn_fert_unir_chofer(p_quitar uuid, p_dejar uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
    perform public._fert_gestiona_catalogos();
    if p_quitar is null or p_dejar is null or p_quitar = p_dejar then
        raise exception 'Elige dos choferes distintos.';
    end if;
    if not exists (select 1 from public.fert_choferes where id = p_quitar)
       or not exists (select 1 from public.fert_choferes where id = p_dejar) then
        raise exception 'Uno de los choferes no existe.';
    end if;
    update public.fert_recepciones set chofer_id = p_dejar where chofer_id = p_quitar;
    get diagnostics n = row_count;
    insert into public.fert_choferes_vehiculos (chofer_id, vehiculo_id, ultima_vez)
    select p_dejar, cv.vehiculo_id, cv.ultima_vez from public.fert_choferes_vehiculos cv where cv.chofer_id = p_quitar
    on conflict (chofer_id, vehiculo_id) do update set ultima_vez = greatest(fert_choferes_vehiculos.ultima_vez, excluded.ultima_vez);
    delete from public.fert_choferes_vehiculos where chofer_id = p_quitar;
    update public.fert_choferes set activo = false where id = p_quitar;
    update public.fert_choferes set validado = true, activo = true where id = p_dejar;
    return jsonb_build_object('recepciones', n);
end;
$$;

create or replace function public.fn_fert_unir_vehiculo(p_quitar uuid, p_dejar uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
    perform public._fert_gestiona_catalogos();
    if p_quitar is null or p_dejar is null or p_quitar = p_dejar then
        raise exception 'Elige dos vehículos distintos.';
    end if;
    if not exists (select 1 from public.fert_vehiculos where id = p_quitar)
       or not exists (select 1 from public.fert_vehiculos where id = p_dejar) then
        raise exception 'Uno de los vehículos no existe.';
    end if;
    update public.fert_recepciones set vehiculo_id = p_dejar where vehiculo_id = p_quitar;
    get diagnostics n = row_count;
    insert into public.fert_choferes_vehiculos (chofer_id, vehiculo_id, ultima_vez)
    select cv.chofer_id, p_dejar, cv.ultima_vez from public.fert_choferes_vehiculos cv where cv.vehiculo_id = p_quitar
    on conflict (chofer_id, vehiculo_id) do update set ultima_vez = greatest(fert_choferes_vehiculos.ultima_vez, excluded.ultima_vez);
    delete from public.fert_choferes_vehiculos where vehiculo_id = p_quitar;
    update public.fert_vehiculos set activo = false where id = p_quitar;
    update public.fert_vehiculos set validado = true, activo = true where id = p_dejar;
    return jsonb_build_object('recepciones', n);
end;
$$;

create or replace function public.fn_fert_unir_envase(p_quitar uuid, p_dejar uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
    perform public._fert_gestiona_catalogos();
    if p_quitar is null or p_dejar is null or p_quitar = p_dejar then
        raise exception 'Elige dos envases distintos.';
    end if;
    if not exists (select 1 from public.fert_envases_tipos where id = p_quitar)
       or not exists (select 1 from public.fert_envases_tipos where id = p_dejar) then
        raise exception 'Uno de los envases no existe.';
    end if;
    update public.fert_envases_movimientos set envase_id = p_dejar where envase_id = p_quitar;
    get diagnostics n = row_count;
    update public.fert_envases_tipos set activo = false where id = p_quitar;
    update public.fert_envases_tipos set validado = true, activo = true where id = p_dejar;
    return jsonb_build_object('movimientos', n);
end;
$$;


-- ---------------------------------------------------------------- 10 · permisos de ejecución

revoke execute on function public._fert_saldo_envase(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._fert_envases_recepcion(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public._fert_envases_al_anular() from public, anon, authenticated;
revoke execute on function public._fert_op_envase_tipo(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._fert_op_producto(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._fert_op_recepcion(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;
revoke execute on function public._fert_op_aplicacion(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;
revoke execute on function public._fert_op_bitacora(uuid, jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public._fert_op_conteo(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;
revoke execute on function public._fert_op_relevo_recibir(uuid, jsonb, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public._fert_procesar(jsonb) from public, anon, authenticated;
revoke execute on function public._fert_gestiona_catalogos() from public, anon, authenticated;
revoke execute on function public.fn_fert_codigo_largo_valido(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.fn_fert_codigo_largo(bytea, bigint) from public, anon;
grant execute on function public.fn_fert_estado_campo(date) to authenticated;
grant execute on function public.fn_fert_exportar(bigint, integer) to authenticated;
grant execute on function public.fn_fert_publicar(jsonb) to authenticated;
grant execute on function public.fn_fert_catalogos_campo() to authenticated;
grant execute on function public.fn_fert_unir_chofer(uuid, uuid) to authenticated;
grant execute on function public.fn_fert_unir_vehiculo(uuid, uuid) to authenticated;
grant execute on function public.fn_fert_unir_envase(uuid, uuid) to authenticated;
revoke execute on function public.fn_fert_catalogos_campo() from public, anon;
revoke execute on function public.fn_fert_unir_chofer(uuid, uuid) from public, anon;
revoke execute on function public.fn_fert_unir_vehiculo(uuid, uuid) from public, anon;
revoke execute on function public.fn_fert_unir_envase(uuid, uuid) from public, anon;

notify pgrst, 'reload schema';
