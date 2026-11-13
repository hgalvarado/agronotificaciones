-- =====================================================================
-- 109 · AgroMétricas › Parámetros de riego (parte 1 de la migración desde AppSheet)
-- Diseño: docs/agrometricas-parametros-riego.md · Plan general: docs/agrometricas-migracion.md
--
--   agm_parametros  una lectura por turno (turnos_ciclo, publicado por AGL) y día: tensiómetros, riego, agua/solución
--                   y suelo. El DDT lo calcula la base (fecha − siembra): nunca se escribe a mano.
--   agm_clima       ETo, DPV y viento una vez por ZONA y día (lo manda el encargado de zona; no por turno).
--   Las horas de riego, el % y el número de fertilización NO van aquí: salen del turno (DDT del plan) y de Fertirriego › Horas.
--   agm_rangos      rangos por parámetro (los publica AGL): fuera de rango = AVISO, no bloquea.
--   fn_agm_guardar_parametros / fn_agm_guardar_clima: escritura idempotente por el UUID del teléfono (sin señal:
--                   la cola reenvía y no duplica); un turno y día ya registrado se COMPLETA (no se duplica).
--   Permisos: pantalla «agrometricas» (matriz de la base; ningún nombre de rol). El parametrista trabaja POR ZONA:
--   ve y registra los turnos de sus zonas asignadas (zona del turno). Alcance: global, zonal (sus zonas) o
--   propietario (zonas donde tiene una estación asignada).
--   El menú se enciende cuando se publique la pantalla (en_menu queda en false aquí).
-- Idempotente: se puede correr varias veces. Todo UPDATE/DELETE lleva WHERE (Supabase safeupdate).
-- =====================================================================

-- ---------------------------------------------------------------- tablas

create table if not exists public.agm_rangos (
    parametro    text primary key,             -- clave de columna de agm_parametros / agm_clima (ej. 'ph_agua')
    nombre       text not null,
    unidad       text,
    minimo       numeric(14,4),
    maximo       numeric(14,4),
    publicado_at timestamptz not null default now()
);

create table if not exists public.agm_parametros (
    id                    uuid primary key,                 -- lo genera el teléfono (cola sin señal)
    turno_ciclo_id        uuid not null references public.turnos_ciclo(id),
    fecha                 date not null,                    -- jornada (puede ser ayer o antes)
    ddt                   integer,                          -- fecha − siembra (lo calcula la base)
    tensiometro_12_am     numeric(10,2),
    tensiometro_24_am     numeric(10,2),
    tensiometro_12_pm     numeric(10,2),
    tensiometro_24_pm     numeric(10,2),
    ce_agua               numeric(10,3),
    ph_agua               numeric(10,3),
    ce_gotero             numeric(10,3),
    ph_gotero             numeric(10,3),
    ce_extractor          numeric(10,3),
    ph_extractor          numeric(10,3),
    cloro_cinta           numeric(10,3),
    ce_suelo_antes        numeric(10,3),
    ce_suelo_despues      numeric(10,3),
    foto_calicata         text,                             -- ruta en Storage (AGL la baja y se borra)
    latitud               numeric(10,6),
    longitud              numeric(10,6),
    comentario            text,
    fuera_rango           text[] not null default '{}',     -- parámetros fuera de agm_rangos al guardar
    origen                text not null default 'CAMPO',    -- CAMPO | APPSHEET (histórico importado)
    creado_por            uuid default auth.uid(),
    creado_en             timestamptz not null default now(),
    actualizado_por       uuid,
    actualizado_en        timestamptz,
    constraint agm_parametros_turno_dia unique (turno_ciclo_id, fecha)
);
create index if not exists idx_agm_parametros_fecha on public.agm_parametros (fecha);
-- Las horas de riego salen del turno (Fertirriego › Horas): fuera de aquí (la primera versión de la 109 la tenía)
alter table public.agm_parametros drop column if exists horas_riego;

create table if not exists public.agm_clima (
    id              uuid primary key,
    zona_id         uuid not null references public.zonas(id),
    fecha           date not null,
    eto             numeric(10,3),
    dpv             numeric(10,3),
    viento          numeric(10,3),
    fuera_rango     text[] not null default '{}',
    creado_por      uuid default auth.uid(),
    creado_en       timestamptz not null default now(),
    actualizado_por uuid,
    actualizado_en  timestamptz,
    constraint agm_clima_zona_dia unique (zona_id, fecha)
);

-- ---------------------------------------------------------------- permisos (matriz de la base)

insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('registrar_parametros', 'Registrar parámetros', 'AgroMétricas: registra y completa los parámetros de riego y el clima del día.', 130, true),
    ('corregir_parametros', 'Corregir parámetros', 'AgroMétricas: corrige registros de otras personas o de días anteriores a ayer.', 131, true),
    ('configurar_rangos', 'Configurar rangos', 'AgroMétricas: publica los rangos de cada parámetro (los manda AGL).', 132, true)
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden, escribe = excluded.escribe;

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('agrometricas', 'AgroMétricas · Parámetros de riego',
     'Parámetros de riego por turno y día (tensiómetros, riego, agua y solución, suelo) y clima por estación. Alcance «propietario» = sus estaciones asignadas; «zonal» = las de sus zonas.',
     '/agrometricas', 130,
     array['ver','exportar','registrar_parametros','corregir_parametros','configurar_rangos'])
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, ruta = excluded.ruta,
    orden = excluded.orden, acciones = excluded.acciones;

/** ¿Puede hacer ESTA acción de AgroMétricas en ESTA zona? (turnos por la zona del turno, y el clima): global, zonal (sus zonas) o propietario (tiene una estación asignada en esa zona). */
create or replace function public.fn_agm_puede_zona(p_zona uuid, p_accion text default 'ver')
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when public.fn_es_admin() then true
        when not public.fn_tiene_permiso('agrometricas', p_accion) then false
        else case public.fn_mi_alcance('agrometricas', p_accion)
            when 'global' then true
            when 'zonal' then public.fn_ve_zona_estricta(p_zona)
                or exists (select 1 from public.perfiles_estaciones pe join public.estaciones_riego e on e.id = pe.estacion_id
                           where e.zona_id = p_zona and pe.perfil_id = (select auth.uid()))
            else exists (select 1 from public.perfiles_estaciones pe join public.estaciones_riego e on e.id = pe.estacion_id
                         where e.zona_id = p_zona and pe.perfil_id = (select auth.uid()))
        end
    end
$$;
grant execute on function public.fn_agm_puede_zona(uuid, text) to authenticated;

/** Zona de un turno: la de su estación o, si no tiene, la del turno publicado por AGL. */
create or replace function public._agm_zona_turno(p_turno_ciclo uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(e.zona_id, t.zona_id)
      from public.turnos_ciclo t left join public.estaciones_riego e on e.id = t.estacion_id
     where t.id = p_turno_ciclo
$$;

-- ---------------------------------------------------------------- RLS: leer según alcance; escribir solo por funciones

alter table public.agm_rangos enable row level security;
alter table public.agm_parametros enable row level security;
alter table public.agm_clima enable row level security;

drop policy if exists agm_rangos_leer on public.agm_rangos;
create policy agm_rangos_leer on public.agm_rangos for select to authenticated
    using (public.fn_tiene_permiso('agrometricas', 'ver'));

drop policy if exists agm_parametros_leer on public.agm_parametros;
create policy agm_parametros_leer on public.agm_parametros for select to authenticated
    using (public.fn_agm_puede_zona(public._agm_zona_turno(turno_ciclo_id), 'ver'));

drop policy if exists agm_clima_leer on public.agm_clima;
create policy agm_clima_leer on public.agm_clima for select to authenticated
    using (public.fn_agm_puede_zona(zona_id, 'ver'));

grant select on public.agm_rangos, public.agm_parametros, public.agm_clima to authenticated;

-- ---------------------------------------------------------------- funciones de escritura

/** Parámetros fuera de rango en una fila (jsonb con las columnas numéricas). */
create or replace function public._agm_fuera_rango(p jsonb)
returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(array_agg(r.parametro order by r.parametro), '{}')
      from public.agm_rangos r
     where p ? r.parametro and jsonb_typeof(p -> r.parametro) = 'number'
       and ((r.minimo is not null and (p ->> r.parametro)::numeric < r.minimo)
         or (r.maximo is not null and (p ->> r.parametro)::numeric > r.maximo))
$$;

create or replace function public._agm_num(p jsonb, k text)
returns numeric language sql immutable as $$
    select case when jsonb_typeof(p -> k) = 'number' then (p ->> k)::numeric
                when jsonb_typeof(p -> k) = 'string' and btrim(p ->> k) ~ '^-?[0-9]+([.,][0-9]+)?$'
                    then replace(btrim(p ->> k), ',', '.')::numeric end
$$;

/**
 * Guarda (o completa) los parámetros de un turno y día. p = {id, turno_ciclo_id, fecha, <columnas>…}.
 * - Mismo id ya guardado (reenvío de la cola): devuelve lo guardado sin cambiar nada más que lo nuevo.
 * - Otro id para el mismo turno y día: se COMPLETA esa fila (los campos que vienen con valor la actualizan).
 * - Días anteriores a ayer o registros de otra persona: requieren «Corregir parámetros».
 * -> la fila guardada (jsonb)
 */
create or replace function public.fn_agm_guardar_parametros(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_turno   public.turnos_ciclo%rowtype;
    v_fecha   date := nullif(p ->> 'fecha', '')::date;
    v_id      uuid := nullif(p ->> 'id', '')::uuid;
    v_previa  public.agm_parametros%rowtype;
    v_hoy     date := (now() at time zone 'America/Tegucigalpa')::date;
    v_cols    text[] := array['tensiometro_12_am','tensiometro_24_am','tensiometro_12_pm','tensiometro_24_pm',
                              'ce_agua','ph_agua','ce_gotero','ph_gotero',
                              'ce_extractor','ph_extractor','cloro_cinta','ce_suelo_antes','ce_suelo_despues'];
    v_nums    jsonb := '{}';
    c         text;
    v_fila    public.agm_parametros%rowtype;
    v_existe  boolean;
begin
    if v_id is null or v_fecha is null then
        raise exception 'Faltan el identificador o la fecha del registro.' using errcode = '22023';
    end if;
    select * into v_turno from public.turnos_ciclo where id = nullif(p ->> 'turno_ciclo_id', '')::uuid;
    if not found then
        raise exception 'El turno no existe o ya no está publicado por AGL.' using errcode = '22023';
    end if;
    if v_fecha > v_hoy then
        raise exception 'No se registran parámetros de días futuros.' using errcode = '22023';
    end if;
    if not public.fn_agm_puede_zona(public._agm_zona_turno(v_turno.id), 'registrar_parametros') then
        raise exception 'No tienes permiso para registrar parámetros en este turno.' using errcode = '42501';
    end if;

    select * into v_previa from public.agm_parametros where id = v_id
        or (turno_ciclo_id = v_turno.id and fecha = v_fecha) order by (id = v_id) desc limit 1;
    v_existe := found;   -- el FOREACH de abajo cambia FOUND
    if v_existe and (v_previa.turno_ciclo_id <> v_turno.id or v_previa.fecha <> v_fecha) then
        raise exception 'Este registro ya se guardó para otro turno o fecha.' using errcode = '22023';
    end if;
    if (v_fecha < v_hoy - 1 or (v_existe and v_previa.creado_por is distinct from auth.uid()))
       and not public.fn_agm_puede_zona(public._agm_zona_turno(v_turno.id), 'corregir_parametros') then
        raise exception 'Para corregir días anteriores o registros de otra persona se necesita «Corregir parámetros».'
            using errcode = '42501';
    end if;

    foreach c in array v_cols loop
        if public._agm_num(p, c) is not null then
            v_nums := v_nums || jsonb_build_object(c, public._agm_num(p, c));
        end if;
    end loop;

    if not v_existe then
        insert into public.agm_parametros (id, turno_ciclo_id, fecha) values (v_id, v_turno.id, v_fecha)
        returning * into v_previa;
    end if;

    update public.agm_parametros a set
        ddt                 = case when v_turno.fecha_siembra is not null then v_fecha - v_turno.fecha_siembra end,
        tensiometro_12_am   = coalesce((v_nums ->> 'tensiometro_12_am')::numeric, a.tensiometro_12_am),
        tensiometro_24_am   = coalesce((v_nums ->> 'tensiometro_24_am')::numeric, a.tensiometro_24_am),
        tensiometro_12_pm   = coalesce((v_nums ->> 'tensiometro_12_pm')::numeric, a.tensiometro_12_pm),
        tensiometro_24_pm   = coalesce((v_nums ->> 'tensiometro_24_pm')::numeric, a.tensiometro_24_pm),
        ce_agua             = coalesce((v_nums ->> 'ce_agua')::numeric, a.ce_agua),
        ph_agua             = coalesce((v_nums ->> 'ph_agua')::numeric, a.ph_agua),
        ce_gotero           = coalesce((v_nums ->> 'ce_gotero')::numeric, a.ce_gotero),
        ph_gotero           = coalesce((v_nums ->> 'ph_gotero')::numeric, a.ph_gotero),
        ce_extractor        = coalesce((v_nums ->> 'ce_extractor')::numeric, a.ce_extractor),
        ph_extractor        = coalesce((v_nums ->> 'ph_extractor')::numeric, a.ph_extractor),
        cloro_cinta         = coalesce((v_nums ->> 'cloro_cinta')::numeric, a.cloro_cinta),
        ce_suelo_antes      = coalesce((v_nums ->> 'ce_suelo_antes')::numeric, a.ce_suelo_antes),
        ce_suelo_despues    = coalesce((v_nums ->> 'ce_suelo_despues')::numeric, a.ce_suelo_despues),
        foto_calicata       = coalesce(nullif(p ->> 'foto_calicata', ''), a.foto_calicata),
        latitud             = coalesce(public._agm_num(p, 'latitud'), a.latitud),
        longitud            = coalesce(public._agm_num(p, 'longitud'), a.longitud),
        comentario          = coalesce(nullif(btrim(p ->> 'comentario'), ''), a.comentario),
        actualizado_por     = case when a.creado_en < now() - interval '1 second' then auth.uid() end,
        actualizado_en      = case when a.creado_en < now() - interval '1 second' then now() end
     where a.id = v_previa.id
    returning * into v_fila;

    update public.agm_parametros a set fuera_rango = public._agm_fuera_rango(to_jsonb(a))
     where a.id = v_fila.id
    returning * into v_fila;
    return to_jsonb(v_fila);
end
$$;
grant execute on function public.fn_agm_guardar_parametros(jsonb) to authenticated;

/** Clima del día por zona (ETo, DPV, viento; lo manda el encargado de zona). Mismo criterio de idempotencia y permisos. -> la fila (jsonb) */
create or replace function public.fn_agm_guardar_clima(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_zona   uuid := nullif(p ->> 'zona_id', '')::uuid;
    v_fecha  date := nullif(p ->> 'fecha', '')::date;
    v_id     uuid := nullif(p ->> 'id', '')::uuid;
    v_hoy    date := (now() at time zone 'America/Tegucigalpa')::date;
    v_previa public.agm_clima%rowtype;
    v_fila   public.agm_clima%rowtype;
begin
    if v_id is null or v_fecha is null or v_zona is null then
        raise exception 'Faltan la zona, la fecha o el identificador.' using errcode = '22023';
    end if;
    if v_fecha > v_hoy then
        raise exception 'No se registra clima de días futuros.' using errcode = '22023';
    end if;
    if not public.fn_agm_puede_zona(v_zona, 'registrar_parametros') then
        raise exception 'No tienes permiso para registrar clima en esta zona.' using errcode = '42501';
    end if;
    select * into v_previa from public.agm_clima where id = v_id or (zona_id = v_zona and fecha = v_fecha)
        order by (id = v_id) desc limit 1;
    if found and (v_previa.zona_id <> v_zona or v_previa.fecha <> v_fecha) then
        raise exception 'Este registro ya se guardó para otra zona o fecha.' using errcode = '22023';
    end if;
    if (v_fecha < v_hoy - 1 or (found and v_previa.creado_por is distinct from auth.uid()))
       and not public.fn_agm_puede_zona(v_zona, 'corregir_parametros') then
        raise exception 'Para corregir días anteriores o registros de otra persona se necesita «Corregir parámetros».'
            using errcode = '42501';
    end if;
    if not found then
        insert into public.agm_clima (id, zona_id, fecha) values (v_id, v_zona, v_fecha) returning * into v_previa;
    end if;
    update public.agm_clima a set
        eto    = coalesce(public._agm_num(p, 'eto'), a.eto),
        dpv    = coalesce(public._agm_num(p, 'dpv'), a.dpv),
        viento = coalesce(public._agm_num(p, 'viento'), a.viento),
        actualizado_por = case when a.creado_en < now() - interval '1 second' then auth.uid() end,
        actualizado_en  = case when a.creado_en < now() - interval '1 second' then now() end
     where a.id = v_previa.id
    returning * into v_fila;
    update public.agm_clima a set fuera_rango = public._agm_fuera_rango(to_jsonb(a)) where a.id = v_fila.id
    returning * into v_fila;
    return to_jsonb(v_fila);
end
$$;
grant execute on function public.fn_agm_guardar_clima(jsonb) to authenticated;

/** AGL publica los rangos: [{parametro, nombre, unidad, minimo, maximo}]. Reemplaza los que vienen. -> cuántos */
create or replace function public.fn_agm_publicar_rangos(p jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
    if not (public.fn_es_admin() or public.fn_tiene_permiso('agrometricas', 'configurar_rangos')) then
        raise exception 'No tienes permiso para publicar rangos.' using errcode = '42501';
    end if;
    insert into public.agm_rangos (parametro, nombre, unidad, minimo, maximo, publicado_at)
    select r ->> 'parametro', coalesce(r ->> 'nombre', r ->> 'parametro'), r ->> 'unidad',
           public._agm_num(r, 'minimo'), public._agm_num(r, 'maximo'), now()
      from jsonb_array_elements(coalesce(p, '[]')) r
     where nullif(r ->> 'parametro', '') is not null
    on conflict (parametro) do update set nombre = excluded.nombre, unidad = excluded.unidad,
        minimo = excluded.minimo, maximo = excluded.maximo, publicado_at = excluded.publicado_at;
    get diagnostics n = row_count;
    return n;
end
$$;
grant execute on function public.fn_agm_publicar_rangos(jsonb) to authenticated;

/**
 * Lo que el teléfono necesita para trabajar (y guardar para usar sin señal): turnos activos que la persona puede ver,
 * con su estación, zona y siembra; y los rangos. -> {turnos: [...], rangos: [...]}
 */
create or replace function public.fn_agm_mis_turnos()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'turnos', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', t.id, 'turno', tu.codigo, 'temporada', t.temporada, 'ciclo', t.ciclo,
                       'fecha_siembra', t.fecha_siembra, 'estacion', e.nombre, 'zona_id', coalesce(e.zona_id, t.zona_id),
                       'zona', z.nombre)
                   order by z.nombre, e.nombre, tu.codigo)
              from public.turnos_ciclo t
              join public.turnos tu on tu.id = t.turno_id
              left join public.estaciones_riego e on e.id = t.estacion_id
              left join public.zonas z on z.id = coalesce(e.zona_id, t.zona_id)
             where t.activo and public.fn_agm_puede_zona(coalesce(e.zona_id, t.zona_id), 'ver')), '[]'::jsonb),
        'rangos', coalesce((select jsonb_agg(jsonb_build_object('parametro', parametro, 'minimo', minimo, 'maximo', maximo))
                              from public.agm_rangos), '[]'::jsonb))
$$;
grant execute on function public.fn_agm_mis_turnos() to authenticated;
