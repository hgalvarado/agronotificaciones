-- =====================================================================
-- 127 · AGROMÉTRICAS · ÍNDICE DE CRECIMIENTO (IC) dentro de Parámetros de riego
-- =====================================================================
-- Pedido del usuario (2026-11-21/22): el parametrista mide el IC SIEMPRE por turno, preferiblemente del DDT 5 al DDT 20,
-- en la misma pantalla y con la misma cola sin señal que los parámetros. Quiere CONTROL para cambiar los parámetros de la
-- fórmula durante la temporada.
--
-- Fórmula (confirmada con los 3 132 registros del histórico de AppSheet: |IC calculado − IC real| ≤ 0.005, o sea redondeo a 2 decimales):
--     IC = hojas / (DDT ^ exponente_ddt) / divisor            (inicial: divisor 10, exponente 1  →  hojas / DDT / 10)
--     Plan IC por DDT (5–20): tabla única para todas las variedades (hoja IC_Plan de AppSheet).
--
-- Decisiones:
--   1. El capturador registra solo las HOJAS (dato crudo). El IC y el plan se calculan con la versión de fórmula VIGENTE a la
--      FECHA del registro (agm_ic_formula.vigente_desde ≤ fecha; la más reciente gana; sin ninguna anterior, la primera).
--   2. Cambiar la fórmula NO recalcula lo ya guardado: hay que pedirlo (fn_agm_ic_recalcular, con vista previa y confirmación).
--   3. Un IC por turno y día (índice único parcial entre los NO eliminados). Un segundo registro del mismo turno y día es una
--      CORRECCIÓN y solo entra con p.correccion = true (el teléfono lo pide con una casilla); sin ella se rechaza (22023).
--   4. El DDT sale de la siembra del turno; fuera de 5–20 solo se avisa en el teléfono (nunca se bloquea).
--   5. Permisos: SIN acciones nuevas; usa los de la pantalla «agrometricas»: registrar = «Registrar parámetros», corregir días
--      anteriores a ayer o registros ajenos = «Corregir parámetros», fórmula y recalcular = «Configurar rangos»,
--      eliminar = «Eliminar por completo» (eliminar_definitivo, solo administrador salvo concesión en Permisos).
--      Visibilidad por zona del turno, igual que la 125. Ningún nombre de rol.
--   6. Baja a AGL con el patrón de la 122/125: fn_agm_ic_exportar / confirmar_bajada / purgar_bajadas (huella sha256, tumbas,
--      no se purga lo de un turno activo). Las versiones de fórmula las lee AGL con fn_agm_ic_exportar_formulas().
--
-- Requiere 109, 122 y 125 (usa fn_agm_puede_zona, _agm_zona_turno, _agm_num, _agm_puede_*_registro, _agm_exigir_agl,
-- agm_bajada_config, turno_lotes, _agm_uuid_appsheet). Solo crea objetos con nombre propio (agm_ic_*): correr/re-correr la 109,
-- 122 o 125 en cualquier orden no la rompe. Idempotente. Todo UPDATE/DELETE lleva WHERE (Supabase safeupdate).
-- =====================================================================

-- ---------------------------------------------------------------- 1 · tablas
create table if not exists public.agm_ic_formula (
    id             uuid primary key default gen_random_uuid(),
    vigente_desde  date not null,
    divisor        numeric(10,4) not null check (divisor > 0),
    exponente_ddt  numeric(6,3) not null default 1 check (exponente_ddt between 0 and 3),
    notas          text,
    creado_por     uuid default auth.uid(),
    creado_en      timestamptz not null default now(),
    constraint agm_ic_formula_fecha unique (vigente_desde)
);

create table if not exists public.agm_ic_plan (
    version_id  uuid not null references public.agm_ic_formula(id) on delete cascade,
    ddt         integer not null check (ddt between 1 and 60),
    ic_plan     numeric(10,4) not null check (ic_plan >= 0),
    primary key (version_id, ddt)
);

create table if not exists public.agm_ic_registros (
    id                  uuid primary key,                       -- lo genera el teléfono (cola sin señal) o AGL (histórico)
    turno_ciclo_id      uuid not null references public.turnos_ciclo(id),
    zona_id             uuid,                                   -- zona del turno al registrar (informativo)
    fecha               date not null,
    ddt                 integer,
    hojas               numeric(10,2) not null check (hojas >= 0),
    ic_real             numeric(10,4),
    ic_plan             numeric(10,4),
    version_formula_id  uuid references public.agm_ic_formula(id),
    comentario          text,
    origen              text not null default 'CAMPO',          -- CAMPO | APPSHEET
    id_appsheet         text,
    creado_por          uuid default auth.uid(),
    creado_en           timestamptz not null default now(),
    editado_en          timestamptz,
    editado_por         uuid,
    eliminado_en        timestamptz,
    eliminado_por       uuid,
    eliminado_motivo    text,
    bajado_a_agl_en     timestamptz,
    huella              text
);
create unique index if not exists agm_ic_registros_turno_dia_viva
    on public.agm_ic_registros (turno_ciclo_id, fecha) where eliminado_en is null;
create unique index if not exists agm_ic_registros_id_appsheet_uq
    on public.agm_ic_registros (id_appsheet) where id_appsheet is not null;
create index if not exists idx_agm_ic_registros_fecha on public.agm_ic_registros (fecha);
create index if not exists idx_agm_ic_registros_creado_por on public.agm_ic_registros (creado_por);

alter table public.agm_ic_formula   enable row level security;
alter table public.agm_ic_plan      enable row level security;
alter table public.agm_ic_registros enable row level security;

drop policy if exists agm_ic_formula_leer on public.agm_ic_formula;
create policy agm_ic_formula_leer on public.agm_ic_formula for select to authenticated
    using (public.fn_es_admin() or public.fn_tiene_permiso('agrometricas', 'ver'));
drop policy if exists agm_ic_plan_leer on public.agm_ic_plan;
create policy agm_ic_plan_leer on public.agm_ic_plan for select to authenticated
    using (public.fn_es_admin() or public.fn_tiene_permiso('agrometricas', 'ver'));
drop policy if exists agm_ic_registros_leer on public.agm_ic_registros;
create policy agm_ic_registros_leer on public.agm_ic_registros for select to authenticated
    using (eliminado_en is null and public.fn_agm_puede_zona(public._agm_zona_turno(turno_ciclo_id), 'ver'));
grant select on public.agm_ic_formula, public.agm_ic_plan, public.agm_ic_registros to authenticated;
-- escribir: solo por las funciones (security definer)

-- ---------------------------------------------------------------- 2 · versión inicial de la fórmula y plan (valores reales de IC_Plan)
insert into public.agm_ic_formula (vigente_desde, divisor, exponente_ddt, notas, creado_por)
values ('2000-01-01', 10, 1, 'Fórmula inicial (AppSheet): hojas / DDT / 10. Plan IC por DDT de la hoja IC_Plan.', null)
on conflict (vigente_desde) do nothing;

insert into public.agm_ic_plan (version_id, ddt, ic_plan)
select f.id, v.ddt, v.ic_plan
  from public.agm_ic_formula f
 cross join (values (5, 0.30), (6, 0.33), (7, 0.35), (8, 0.33), (9, 0.36), (10, 0.38), (11, 0.48), (12, 0.63),
                    (13, 0.74), (14, 0.89), (15, 1.05), (16, 1.08), (17, 1.12), (18, 1.18), (19, 1.24), (20, 1.30)) v(ddt, ic_plan)
 where f.vigente_desde = date '2000-01-01'
   and not exists (select 1 from public.agm_ic_plan x where x.version_id = f.id)   -- no pisa lo que el usuario ya editó
on conflict do nothing;

-- ---------------------------------------------------------------- 3 · ayudas internas
/** IC = hojas / (ddt ^ exponente) / divisor, a 4 decimales. null si falta algo o el DDT no es positivo. */
create or replace function public._agm_ic_calc(p_hojas numeric, p_ddt integer, p_divisor numeric, p_exp numeric)
returns numeric language sql immutable set search_path = public, pg_temp as $$
    select case when p_hojas is null or p_ddt is null or p_ddt <= 0 or p_divisor is null or p_divisor <= 0 then null
                else round(p_hojas / power(p_ddt::numeric, coalesce(p_exp, 1)) / p_divisor, 4) end
$$;
revoke execute on function public._agm_ic_calc(numeric, integer, numeric, numeric) from public, anon, authenticated;

/** Versión vigente a una fecha: la de vigente_desde más reciente que no pase de la fecha; sin ninguna, la primera. */
create or replace function public._agm_ic_version(p_fecha date)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(
        (select f.id from public.agm_ic_formula f where f.vigente_desde <= p_fecha order by f.vigente_desde desc limit 1),
        (select f.id from public.agm_ic_formula f order by f.vigente_desde asc limit 1))
$$;
revoke execute on function public._agm_ic_version(date) from public, anon, authenticated;

create or replace function public._agm_ic_plan_de(p_version uuid, p_ddt integer)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
    select x.ic_plan from public.agm_ic_plan x where x.version_id = p_version and x.ddt = p_ddt
$$;
revoke execute on function public._agm_ic_plan_de(uuid, integer) from public, anon, authenticated;

/** Una versión de fórmula con su plan, como jsonb. */
create or replace function public._agm_ic_version_json(p_version uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'id', f.id, 'vigente_desde', f.vigente_desde, 'divisor', f.divisor, 'exponente_ddt', f.exponente_ddt, 'notas', f.notas,
        'creado_en', f.creado_en,
        'plan', coalesce((select jsonb_agg(jsonb_build_object('ddt', x.ddt, 'ic_plan', x.ic_plan) order by x.ddt)
                            from public.agm_ic_plan x where x.version_id = f.id), '[]'::jsonb))
      from public.agm_ic_formula f where f.id = p_version
$$;
revoke execute on function public._agm_ic_version_json(uuid) from public, anon, authenticated;

create or replace function public._agm_ic_huella(p_fila jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
    select encode(sha256(convert_to(((p_fila - 'bajado_a_agl_en') - 'huella')::text, 'UTF8')), 'hex')
$$;
revoke execute on function public._agm_ic_huella(jsonb) from public, anon, authenticated;

create or replace function public._agm_ic_exigir_sesion()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
end $$;
revoke execute on function public._agm_ic_exigir_sesion() from public, anon, authenticated;

create or replace function public._agm_ic_exigir_configurar()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._agm_ic_exigir_sesion();
    if not (public.fn_es_admin() or public.fn_tiene_permiso('agrometricas', 'configurar_rangos')) then
        raise exception 'No tienes permiso para configurar la fórmula del índice de crecimiento (se necesita «Configurar rangos»).'
            using errcode = '42501';
    end if;
end $$;
revoke execute on function public._agm_ic_exigir_configurar() from public, anon, authenticated;

-- ---------------------------------------------------------------- 4 · fórmula: lectura (teléfono y pantalla de administración)
/** Todas las versiones con su plan, para guardarlas en el teléfono (cálculo en vivo sin señal) y para la pantalla de fórmula. */
create or replace function public.fn_agm_ic_config()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._agm_ic_exigir_sesion();
    if not (public.fn_es_admin() or public.fn_tiene_permiso('agrometricas', 'ver')) then
        raise exception 'No tienes permiso para ver AgroMétricas.' using errcode = '42501';
    end if;
    return jsonb_build_object('versiones', coalesce((
        select jsonb_agg(public._agm_ic_version_json(f.id) order by f.vigente_desde) from public.agm_ic_formula f), '[]'::jsonb));
end $$;
revoke execute on function public.fn_agm_ic_config() from public, anon;
grant  execute on function public.fn_agm_ic_config() to authenticated;

/** La versión vigente a una fecha (hoy en UTC-6 si no se indica). */
create or replace function public.fn_agm_ic_formula_vigente(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_f date := coalesce(p_fecha, (now() at time zone 'America/Tegucigalpa')::date);
begin
    perform public._agm_ic_exigir_sesion();
    if not (public.fn_es_admin() or public.fn_tiene_permiso('agrometricas', 'ver')) then
        raise exception 'No tienes permiso para ver AgroMétricas.' using errcode = '42501';
    end if;
    return public._agm_ic_version_json(public._agm_ic_version(v_f));
end $$;
revoke execute on function public.fn_agm_ic_formula_vigente(date) from public, anon;
grant  execute on function public.fn_agm_ic_formula_vigente(date) to authenticated;

-- ---------------------------------------------------------------- 5 · fórmula: guardar una versión
/**
 * p = {vigente_desde: 'YYYY-MM-DD', divisor (>0), exponente_ddt (0..3, 1), notas?, plan?: [{ddt, ic_plan}]}
 * Si ya hay una versión con esa fecha de vigencia se REEMPLAZA (y su plan); si no, se crea. Sin `plan` se copia el de la
 * versión vigente a esa fecha. NO recalcula nada: lo ya guardado conserva sus valores hasta fn_agm_ic_recalcular.
 * -> la versión (jsonb)
 */
create or replace function public.fn_agm_ic_guardar_formula(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_desde  date := nullif(p ->> 'vigente_desde', '')::date;
    v_div    numeric := public._agm_num(p, 'divisor');
    v_exp    numeric := coalesce(public._agm_num(p, 'exponente_ddt'), 1);
    v_notas  text := nullif(btrim(coalesce(p ->> 'notas', '')), '');
    v_id     uuid;
    v_base   uuid;
    v_item   jsonb;
    v_ddt    numeric;
    v_val    numeric;
    v_vistos integer[] := '{}';
begin
    perform public._agm_ic_exigir_configurar();
    if v_desde is null then
        raise exception 'Indica desde qué fecha rige la fórmula.' using errcode = '22023';
    end if;
    if v_div is null or v_div <= 0 or v_div >= 1000000 then
        raise exception 'El divisor debe ser un número mayor que 0.' using errcode = '22023';
    end if;
    if v_exp < 0 or v_exp > 3 then
        raise exception 'El exponente del DDT debe estar entre 0 y 3.' using errcode = '22023';
    end if;
    if p ? 'plan' and jsonb_typeof(p -> 'plan') is distinct from 'array' then
        raise exception 'El plan debe ser una lista [{ddt, ic_plan}].' using errcode = '22023';
    end if;
    if p ? 'plan' then
        for v_item in select x from jsonb_array_elements(p -> 'plan') x loop
            v_ddt := public._agm_num(v_item, 'ddt');
            v_val := public._agm_num(v_item, 'ic_plan');
            if v_ddt is null or v_ddt <> trunc(v_ddt) or v_ddt < 1 or v_ddt > 60 then
                raise exception 'Cada fila del plan necesita un DDT entero entre 1 y 60.' using errcode = '22023';
            end if;
            if v_val is null or v_val < 0 or v_val >= 1000000 then
                raise exception 'El IC del plan en el DDT % no es válido.', v_ddt::integer using errcode = '22023';
            end if;
            if v_ddt::integer = any (v_vistos) then
                raise exception 'El DDT % está repetido en el plan.', v_ddt::integer using errcode = '22023';
            end if;
            v_vistos := v_vistos || v_ddt::integer;
        end loop;
    end if;

    -- plan de partida (si no viene) = el de la versión vigente a esa fecha, ANTES de tocar nada
    v_base := public._agm_ic_version(v_desde);

    select id into v_id from public.agm_ic_formula where vigente_desde = v_desde;
    if v_id is null then
        insert into public.agm_ic_formula (vigente_desde, divisor, exponente_ddt, notas)
        values (v_desde, v_div, v_exp, v_notas) returning id into v_id;
    else
        update public.agm_ic_formula set divisor = v_div, exponente_ddt = v_exp, notas = v_notas where id = v_id;
    end if;

    if p ? 'plan' then
        delete from public.agm_ic_plan where version_id = v_id;
        insert into public.agm_ic_plan (version_id, ddt, ic_plan)
        select v_id, (public._agm_num(x, 'ddt'))::integer, public._agm_num(x, 'ic_plan')
          from jsonb_array_elements(p -> 'plan') x;
    elsif v_base is not null and v_base <> v_id
          and not exists (select 1 from public.agm_ic_plan where version_id = v_id) then
        insert into public.agm_ic_plan (version_id, ddt, ic_plan)
        select v_id, x.ddt, x.ic_plan from public.agm_ic_plan x where x.version_id = v_base;
    end if;
    return public._agm_ic_version_json(v_id);
end $$;
revoke execute on function public.fn_agm_ic_guardar_formula(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_guardar_formula(jsonb) to authenticated;

-- ---------------------------------------------------------------- 6 · registrar (idempotente, uno o un lote de la cola)
/** Guarda UN registro. Lanza con mensajes en español. -> la fila (jsonb sin marcas internas) + 'repetido' | 'correccion'. */
create or replace function public._agm_ic_guardar_uno(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id     uuid := nullif(p ->> 'id', '')::uuid;
    v_fecha  date := nullif(p ->> 'fecha', '')::date;
    v_hoy    date := (now() at time zone 'America/Tegucigalpa')::date;
    v_turno  public.turnos_ciclo%rowtype;
    v_hojas  numeric := public._agm_num(p, 'hojas');
    v_crudo  text := nullif(btrim(coalesce(p ->> 'hojas', '')), '');
    v_corr   boolean := coalesce(nullif(p ->> 'correccion', '')::boolean, false);
    v_nota   text := nullif(btrim(coalesce(p ->> 'comentario', '')), '');
    v_prev   public.agm_ic_registros%rowtype;
    v_ver    uuid;
    v_f      public.agm_ic_formula%rowtype;
    v_ddt    integer;
    v_fila   public.agm_ic_registros%rowtype;
    v_zona   uuid;
begin
    if v_id is null or v_fecha is null then
        raise exception 'Faltan el identificador o la fecha del registro.' using errcode = '22023';
    end if;
    select * into v_turno from public.turnos_ciclo where id = nullif(p ->> 'turno_ciclo_id', '')::uuid;
    if not found then
        raise exception 'El turno no existe o ya no está publicado por AGL.' using errcode = '22023';
    end if;
    if v_fecha > v_hoy then
        raise exception 'No se registran índices de crecimiento de días futuros.' using errcode = '22023';
    end if;
    v_zona := public._agm_zona_turno(v_turno.id);
    if not public.fn_agm_puede_zona(v_zona, 'registrar_parametros') then
        raise exception 'No tienes permiso para registrar el índice de crecimiento en este turno.' using errcode = '42501';
    end if;
    if v_crudo is null then
        raise exception 'Escribe el número de hojas.' using errcode = '22023';
    end if;
    if v_hojas is null then
        raise exception 'El número de hojas no es un número.' using errcode = '22P02';
    end if;
    if v_hojas < 0 or v_hojas >= 100000 then
        raise exception 'El número de hojas no es válido. Revisa la lectura.' using errcode = '22003';
    end if;

    -- ¿ya está? (por id: reenvío de la cola; o el mismo turno y día)
    select * into v_prev from public.agm_ic_registros
     where id = v_id or (turno_ciclo_id = v_turno.id and fecha = v_fecha and eliminado_en is null)
     order by (id = v_id) desc limit 1;
    if found then
        if v_prev.eliminado_en is not null then
            raise exception 'Este registro fue eliminado por un administrador y no se vuelve a guardar.' using errcode = '22023';
        end if;
        if v_prev.turno_ciclo_id <> v_turno.id or v_prev.fecha <> v_fecha then
            raise exception 'Este registro ya se guardó para otro turno o fecha.' using errcode = '22023';
        end if;
        if v_prev.id = v_id then
            return (to_jsonb(v_prev) - array['huella', 'bajado_a_agl_en']) || jsonb_build_object('repetido', true);   -- reenvío: nada que hacer
        end if;
        if not v_corr then
            raise exception 'Este turno ya tiene su índice de crecimiento de ese día. Confírmalo como corrección para reemplazarlo.'
                using errcode = '22023';
        end if;
    end if;
    if (v_fecha < v_hoy - 1 or (v_prev.id is not null and v_prev.creado_por is distinct from auth.uid()))
       and not public.fn_agm_puede_zona(v_zona, 'corregir_parametros') then
        raise exception 'Para corregir días anteriores o registros de otra persona se necesita «Corregir parámetros».'
            using errcode = '42501';
    end if;

    v_ver := public._agm_ic_version(v_fecha);
    select * into v_f from public.agm_ic_formula where id = v_ver;
    v_ddt := case when v_turno.fecha_siembra is not null then v_fecha - v_turno.fecha_siembra end;

    if v_prev.id is null then
        insert into public.agm_ic_registros (id, turno_ciclo_id, zona_id, fecha, ddt, hojas, ic_real, ic_plan, version_formula_id, comentario)
        values (v_id, v_turno.id, v_zona, v_fecha, v_ddt, v_hojas,
                public._agm_ic_calc(v_hojas, v_ddt, v_f.divisor, v_f.exponente_ddt), public._agm_ic_plan_de(v_ver, v_ddt), v_ver, v_nota)
        returning * into v_fila;
        return to_jsonb(v_fila) - array['huella', 'bajado_a_agl_en'];
    end if;

    -- corrección del registro del día
    update public.agm_ic_registros a set
        ddt = v_ddt, hojas = v_hojas,
        ic_real = public._agm_ic_calc(v_hojas, v_ddt, v_f.divisor, v_f.exponente_ddt),
        ic_plan = public._agm_ic_plan_de(v_ver, v_ddt), version_formula_id = v_ver,
        comentario = coalesce(v_nota, a.comentario),
        editado_en = now(), editado_por = auth.uid()
     where a.id = v_prev.id
    returning * into v_fila;
    return (to_jsonb(v_fila) - array['huella', 'bajado_a_agl_en']) || jsonb_build_object('correccion', true);
end $$;
revoke execute on function public._agm_ic_guardar_uno(jsonb) from public, anon, authenticated;

/**
 * p = {id, turno_ciclo_id, fecha, hojas, comentario?, correccion?}  → la fila guardada (idempotente por id).
 * p = {registros: [ {…}, {…} ]} (lote de la cola) → {resultados: [{id, ok, registro | error, codigo}]} (un fallo no frena a los demás).
 */
create or replace function public.fn_agm_ic_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r   jsonb;
    v_o jsonb := '[]'::jsonb;
begin
    perform public._agm_ic_exigir_sesion();
    if p is null or jsonb_typeof(p) <> 'object' then
        raise exception 'Se esperaba {id, turno_ciclo_id, fecha, hojas} o {registros: [...]}.' using errcode = '22023';
    end if;
    if jsonb_typeof(p -> 'registros') = 'array' then
        for r in select x from jsonb_array_elements(p -> 'registros') x loop
            begin
                v_o := v_o || jsonb_build_object('id', r ->> 'id', 'ok', true, 'registro', public._agm_ic_guardar_uno(r));
            exception when others then
                v_o := v_o || jsonb_build_object('id', r ->> 'id', 'ok', false, 'error', sqlerrm, 'codigo', sqlstate);
            end;
        end loop;
        return jsonb_build_object('resultados', v_o);
    end if;
    return public._agm_ic_guardar_uno(p);
end $$;
revoke execute on function public.fn_agm_ic_registrar(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_registrar(jsonb) to authenticated;

-- ---------------------------------------------------------------- 7 · mis registros (lista y gráficas)
/**
 * p = {temporada?, turno? (código exacto), turno_contiene?, turno_ciclo_id?, zona_id?, desde?, hasta?, texto?,
 *      lote?, lotes? (arreglo; todos los turnos que los contienen), limite? (1..1000, 50), pagina? (0), orden? 'desc'|'asc'}
 * Visibles: administrador todos; los demás, los de las zonas donde tengan «ver» (sin importar quién los capturó). Sin eliminados.
 * -> {total, limite, pagina, registros: [{...fila sin marcas internas, turno, temporada, ciclo, estacion, zona, lotes,
 *     creado_por_nombre, creado_por_email, editado_por_nombre, puede_editar, puede_eliminar}]}
 */
create or replace function public.fn_agm_ic_mis_registros(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
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
    perform public._agm_ic_exigir_sesion();
    v_elim := public._agm_puede_eliminar_registro();
    select array_agg(distinct btrim(q.x)) into v_lotes
      from (select x from jsonb_array_elements_text(case when jsonb_typeof(v_p -> 'lotes') = 'array' then v_p -> 'lotes' else '[]'::jsonb end) x
            union all select v_p ->> 'lote') q
     where nullif(btrim(q.x), '') is not null;

    with f as (
        select a.id, a.fecha
          from public.agm_ic_registros a
          join public.turnos_ciclo tc on tc.id = a.turno_ciclo_id
          join public.turnos tu on tu.id = tc.turno_id
          left join public.estaciones_riego e on e.id = tc.estacion_id
          left join public.zonas z on z.id = coalesce(e.zona_id, tc.zona_id)
          left join public.perfiles pf on pf.id = a.creado_por
         where a.eliminado_en is null
           and (v_temp is null or tc.temporada = v_temp)
           and (v_tc is null or tc.id = v_tc)
           and (v_turno is null or lower(btrim(tu.codigo)) = lower(v_turno))
           and (v_turno_c is null or tu.codigo ilike '%' || v_turno_c || '%')
           and (v_zona is null or coalesce(e.zona_id, tc.zona_id) = v_zona)
           and (v_lotes is null or exists (select 1 from public.turno_lotes tl where tl.turno_ciclo_id = tc.id and tl.lote = any (v_lotes)))
           and (v_desde is null or a.fecha >= v_desde)
           and (v_hasta is null or a.fecha <= v_hasta)
           and (v_txt is null or concat_ws(' ', tu.codigo, z.nombre, e.nombre, pf.nombre, a.comentario, a.id_appsheet, a.fecha::text) ilike '%' || v_txt || '%')
           and public._agm_puede_ver_registro(a.creado_por, a.turno_ciclo_id)
    ), pg as (
        select f.id from f
         order by case when v_asc then f.fecha end asc, case when not v_asc then f.fecha end desc, f.id
         limit v_lim offset v_pag * v_lim
    )
    select (select count(*) from f),
           coalesce(jsonb_agg(
               (to_jsonb(a) - array['bajado_a_agl_en', 'huella', 'creado_por', 'editado_por',
                                    'eliminado_en', 'eliminado_por', 'eliminado_motivo'])
               || jsonb_build_object(
                   'turno', tu.codigo, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
                   'estacion', e.nombre, 'zona_id', coalesce(e.zona_id, tc.zona_id), 'zona', z.nombre,
                   'lotes', coalesce((select jsonb_agg(jsonb_build_object('lote', tl.lote, 'nombre', tl.nombre) order by tl.lote)
                                        from public.turno_lotes tl where tl.turno_ciclo_id = tc.id), '[]'::jsonb),
                   'creado_por_nombre', pf.nombre,
                   'creado_por_email', (select lower(u.email) from auth.users u where u.id = a.creado_por),
                   'editado_por_nombre', pe.nombre,
                   'puede_editar', public._agm_puede_editar_registro(a.creado_por, a.turno_ciclo_id),
                   'puede_eliminar', v_elim)
               order by case when v_asc then a.fecha end asc, case when not v_asc then a.fecha end desc, tu.codigo, a.id), '[]'::jsonb)
      into v_total, v_regs
      from pg
      join public.agm_ic_registros a on a.id = pg.id
      join public.turnos_ciclo tc on tc.id = a.turno_ciclo_id
      join public.turnos tu on tu.id = tc.turno_id
      left join public.estaciones_riego e on e.id = tc.estacion_id
      left join public.zonas z on z.id = coalesce(e.zona_id, tc.zona_id)
      left join public.perfiles pf on pf.id = a.creado_por
      left join public.perfiles pe on pe.id = a.editado_por;
    return jsonb_build_object('total', v_total, 'limite', v_lim, 'pagina', v_pag, 'registros', v_regs);
end $$;
revoke execute on function public.fn_agm_ic_mis_registros(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_mis_registros(jsonb) to authenticated;

-- ---------------------------------------------------------------- 8 · editar
/**
 * p = {id, hojas?, comentario?}. Dueño (con «Registrar parámetros» en la zona), encargado de la zona (Corregir) o administrador.
 * Recalcula con la MISMA versión de fórmula que ya tenía el registro (editar no cambia de versión en silencio).
 * -> {cambio: true|false, registro}
 */
create or replace function public.fn_agm_ic_editar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id    uuid := nullif(p ->> 'id', '')::uuid;
    v_a     public.agm_ic_registros%rowtype;
    v_f     public.agm_ic_formula%rowtype;
    v_hojas numeric;
    v_nota  text;
    v_fila  public.agm_ic_registros%rowtype;
begin
    perform public._agm_ic_exigir_sesion();
    if v_id is null then
        raise exception 'Indica el registro a editar.' using errcode = '22023';
    end if;
    select * into v_a from public.agm_ic_registros where id = v_id for update;
    if not found or v_a.eliminado_en is not null then
        raise exception 'El registro no existe o ya fue eliminado.' using errcode = '22023';
    end if;
    if not public._agm_puede_editar_registro(v_a.creado_por, v_a.turno_ciclo_id) then
        raise exception 'No tienes permiso para editar este registro (solo su dueño, el encargado de la zona o el administrador).'
            using errcode = '42501';
    end if;
    if exists (select 1 from public.turnos_ciclo where id = v_a.turno_ciclo_id and archivado_at is not null) then
        raise exception 'El turno ya fue terminado en AGL: reactívalo allá para editar este registro.' using errcode = '22023';
    end if;
    if p ? 'hojas' then
        if nullif(btrim(coalesce(p ->> 'hojas', '')), '') is null then
            raise exception 'El número de hojas no puede quedar vacío.' using errcode = '22023';
        end if;
        v_hojas := public._agm_num(p, 'hojas');
        if v_hojas is null then
            raise exception 'El número de hojas no es un número.' using errcode = '22P02';
        end if;
        if v_hojas < 0 or v_hojas >= 100000 then
            raise exception 'El número de hojas no es válido. Revisa la lectura.' using errcode = '22003';
        end if;
    else
        v_hojas := v_a.hojas;
    end if;
    v_nota := case when p ? 'comentario' then nullif(btrim(coalesce(p ->> 'comentario', '')), '') else v_a.comentario end;
    if v_hojas = v_a.hojas and v_nota is not distinct from v_a.comentario then
        return jsonb_build_object('cambio', false, 'registro', to_jsonb(v_a) - array['huella', 'bajado_a_agl_en']);
    end if;
    select * into v_f from public.agm_ic_formula where id = v_a.version_formula_id;
    update public.agm_ic_registros a set
        hojas = v_hojas, comentario = v_nota,
        ic_real = case when v_f.id is not null then public._agm_ic_calc(v_hojas, a.ddt, v_f.divisor, v_f.exponente_ddt) else a.ic_real end,
        editado_en = now(), editado_por = auth.uid()
     where a.id = v_id
    returning * into v_fila;
    return jsonb_build_object('cambio', true, 'registro', to_jsonb(v_fila) - array['huella', 'bajado_a_agl_en']);
end $$;
revoke execute on function public.fn_agm_ic_editar(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_editar(jsonb) to authenticated;

-- ---------------------------------------------------------------- 9 · eliminar (tumba)
/** p = {id, motivo}. SOLO «Eliminar por completo» (o administrador). Motivo ≥ 15 letras. Eliminación lógica que AGL aplica y confirma. */
create or replace function public.fn_agm_ic_eliminar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id     uuid := nullif(p ->> 'id', '')::uuid;
    v_motivo text := btrim(coalesce(p ->> 'motivo', ''));
    v_a      public.agm_ic_registros%rowtype;
    v_cuando timestamptz := now();
begin
    perform public._agm_ic_exigir_sesion();
    if not public._agm_puede_eliminar_registro() then
        raise exception 'Tu rol no tiene «Eliminar por completo» en AgroMétricas. Se concede en Permisos.' using errcode = '42501';
    end if;
    if v_id is null then
        raise exception 'Indica el registro a eliminar.' using errcode = '22023';
    end if;
    if char_length(v_motivo) < 15 then
        raise exception 'Explica por qué se elimina (mínimo 15 letras).' using errcode = '22023';
    end if;
    select * into v_a from public.agm_ic_registros where id = v_id for update;
    if not found then
        raise exception 'El registro no existe.' using errcode = '22023';
    end if;
    if v_a.eliminado_en is not null then
        raise exception 'Este registro ya fue eliminado.' using errcode = '22023';
    end if;
    update public.agm_ic_registros set eliminado_en = v_cuando, eliminado_por = auth.uid(), eliminado_motivo = v_motivo
     where id = v_id;
    return jsonb_build_object('id', v_id, 'eliminado_en', v_cuando);
end $$;
revoke execute on function public.fn_agm_ic_eliminar(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_eliminar(jsonb) to authenticated;

-- ---------------------------------------------------------------- 10 · recalcular (explícito, con vista previa)
/** Lo que cambiaría un recálculo: por cada registro NO eliminado, el IC y el plan con la versión vigente a SU fecha. Solo zonas con «Configurar rangos». */
create or replace function public._agm_ic_recalc_filas(p_desde date, p_hasta date, p_tc uuid, p_temp text)
returns table (id uuid, turno text, fecha date, ddt integer, hojas numeric,
               ic_real_antes numeric, ic_real_despues numeric, ic_plan_antes numeric, ic_plan_despues numeric,
               version_antes uuid, version_despues uuid)
language sql stable security definer set search_path = public, pg_temp as $$
    select r.id, tu.codigo, r.fecha, r.ddt, r.hojas, r.ic_real,
           public._agm_ic_calc(r.hojas, r.ddt, f.divisor, f.exponente_ddt),
           r.ic_plan, public._agm_ic_plan_de(f.id, r.ddt), r.version_formula_id, f.id
      from public.agm_ic_registros r
      join public.turnos_ciclo tc on tc.id = r.turno_ciclo_id
      join public.turnos tu on tu.id = tc.turno_id
      join public.agm_ic_formula f on f.id = public._agm_ic_version(r.fecha)
     where r.eliminado_en is null
       and (p_desde is null or r.fecha >= p_desde) and (p_hasta is null or r.fecha <= p_hasta)
       and (p_tc is null or r.turno_ciclo_id = p_tc) and (p_temp is null or tc.temporada = p_temp)
       and public.fn_agm_puede_zona(public._agm_zona_turno(r.turno_ciclo_id), 'configurar_rangos')
$$;
revoke execute on function public._agm_ic_recalc_filas(date, date, uuid, text) from public, anon, authenticated;

/**
 * p = {previsualizar?: true (por defecto), desde?, hasta?, turno_ciclo_id?, temporada?}
 * Recalcula IC real y plan de los registros NO eliminados con la versión de fórmula vigente a la fecha de cada uno
 * (solo de las zonas donde la persona tiene «Configurar rangos»). Con previsualizar = true NO escribe: devuelve cuántos cambian
 * y una muestra. Con previsualizar = false aplica (los registros cambiados quedan «por bajar» a AGL).
 * -> {previsualizacion: true, total, cambian, muestra: [{id, turno, fecha, ddt, hojas, ic_real_antes, ic_real_despues, ic_plan_antes, ic_plan_despues}]}
 *    o {previsualizacion: false, total, actualizados}
 */
create or replace function public.fn_agm_ic_recalcular(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p     jsonb := coalesce(p, '{}'::jsonb);
    v_prev  boolean := coalesce(nullif(v_p ->> 'previsualizar', '')::boolean, true);
    v_desde date := nullif(v_p ->> 'desde', '')::date;
    v_hasta date := nullif(v_p ->> 'hasta', '')::date;
    v_tc    uuid := nullif(v_p ->> 'turno_ciclo_id', '')::uuid;
    v_temp  text := nullif(btrim(v_p ->> 'temporada'), '');
    v_total integer;
    v_cambian integer;
    v_muestra jsonb;
    v_act   integer;
begin
    perform public._agm_ic_exigir_configurar();
    select count(*) into v_total from public._agm_ic_recalc_filas(v_desde, v_hasta, v_tc, v_temp);
    select count(*) into v_cambian from public._agm_ic_recalc_filas(v_desde, v_hasta, v_tc, v_temp) x
     where x.ic_real_antes is distinct from x.ic_real_despues or x.ic_plan_antes is distinct from x.ic_plan_despues
        or x.version_antes is distinct from x.version_despues;
    if v_prev then
        select coalesce(jsonb_agg(q.m order by q.fecha desc, q.turno), '[]'::jsonb) into v_muestra from (
            select x.fecha, x.turno,
                   jsonb_build_object('id', x.id, 'turno', x.turno, 'fecha', x.fecha, 'ddt', x.ddt, 'hojas', x.hojas,
                       'ic_real_antes', x.ic_real_antes, 'ic_real_despues', x.ic_real_despues,
                       'ic_plan_antes', x.ic_plan_antes, 'ic_plan_despues', x.ic_plan_despues) as m
              from public._agm_ic_recalc_filas(v_desde, v_hasta, v_tc, v_temp) x
             where x.ic_real_antes is distinct from x.ic_real_despues or x.ic_plan_antes is distinct from x.ic_plan_despues
                or x.version_antes is distinct from x.version_despues
             order by x.fecha desc, x.turno limit 50) q;
        return jsonb_build_object('previsualizacion', true, 'total', v_total, 'cambian', v_cambian, 'muestra', v_muestra);
    end if;

    update public.agm_ic_registros a set
        ic_real = x.ic_real_despues, ic_plan = x.ic_plan_despues, version_formula_id = x.version_despues,
        editado_en = now(), editado_por = auth.uid()
      from public._agm_ic_recalc_filas(v_desde, v_hasta, v_tc, v_temp) x
     where a.id = x.id
       and (x.ic_real_antes is distinct from x.ic_real_despues or x.ic_plan_antes is distinct from x.ic_plan_despues
            or x.version_antes is distinct from x.version_despues);
    get diagnostics v_act = row_count;
    return jsonb_build_object('previsualizacion', false, 'total', v_total, 'actualizados', v_act);
end $$;
revoke execute on function public.fn_agm_ic_recalcular(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_recalcular(jsonb) to authenticated;

-- ---------------------------------------------------------------- 11 · cargar el histórico de AppSheet (lo sube AGL)
/**
 * p = {registros: [{id_appsheet, fecha, turno_ciclo_id (= turnos_ciclo.agl_id), usuario_appsheet, hojas, ddt?, ic_plan?, comentario?}],
 *      mapa_usuarios: {Glopez: 'correo', …}}  (igual que fn_agm_cargar_appsheet de la 125)
 * IC real = fórmula vigente a la fecha (no se confía en el IC_Real de AppSheet, que venía redondeado a 2 decimales); el plan
 * de AppSheet se respeta si viene (en 22 de 3 133 filas difería de la tabla). DDT: el de AppSheet si viene, si no fecha − siembra.
 * Idempotente por id_appsheet (no pisa ediciones). Un turno y día ya registrado queda en `en_conflicto` (AppSheet tiene 77
 * repetidos). Nacen ya «bajados» (AGL los tiene). Solo AGL (Conexión AGL · publicar).
 * -> {insertadas, ya_existian, sin_usuario, sin_turno, en_conflicto, invalidas}
 */
create or replace function public.fn_agm_ic_cargar_appsheet(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_mapa  jsonb := '{}'::jsonb;
    r       jsonb;
    v_idapp text;
    v_fecha date;
    v_tc    public.turnos_ciclo%rowtype;
    v_user  uuid;
    v_mail  text;
    v_id    uuid;
    v_n     integer;
    v_hojas numeric;
    v_ddt   integer;
    v_ver   uuid;
    v_f     public.agm_ic_formula%rowtype;
    v_planp numeric;
    v_ins   integer := 0;
    v_ya    integer := 0;
    v_sinu  jsonb := '[]'::jsonb;
    v_sint  jsonb := '[]'::jsonb;
    v_conf  jsonb := '[]'::jsonb;
    v_inv   jsonb := '[]'::jsonb;
    v_ex    uuid;
begin
    perform public._agm_exigir_agl('publicar');
    if p is null or jsonb_typeof(p -> 'registros') is distinct from 'array' then
        raise exception 'Se esperaba {registros: [...], mapa_usuarios: {...}}.' using errcode = '22023';
    end if;
    select coalesce(jsonb_object_agg(lower(btrim(k)), lower(btrim(v))), '{}'::jsonb) into v_mapa
      from jsonb_each_text(coalesce(p -> 'mapa_usuarios', '{}'::jsonb)) as t(k, v);

    for r in select x from jsonb_array_elements(p -> 'registros') x loop
        v_idapp := nullif(btrim(r ->> 'id_appsheet'), '');
        begin
            if v_idapp is null then
                v_inv := v_inv || jsonb_build_object('id_appsheet', null, 'error', 'Falta id_appsheet.');
                continue;
            end if;
            v_fecha := nullif(r ->> 'fecha', '')::date;
            v_hojas := public._agm_num(r, 'hojas');
            if v_fecha is null or v_hojas is null or v_hojas < 0 or v_hojas >= 100000 then
                v_inv := v_inv || jsonb_build_object('id_appsheet', v_idapp, 'error', 'Falta la fecha o el número de hojas, o no es válido.');
                continue;
            end if;
            v_id := public._agm_uuid_appsheet('ic:' || v_idapp);
            if exists (select 1 from public.agm_ic_registros where id = v_id or id_appsheet = v_idapp) then
                v_ya := v_ya + 1;
                continue;
            end if;
            select * into v_tc from public.turnos_ciclo where agl_id = nullif(btrim(r ->> 'turno_ciclo_id'), '');
            if not found then
                v_sint := v_sint || jsonb_build_object('id_appsheet', v_idapp, 'turno', r ->> 'turno_ciclo_id');
                continue;
            end if;
            v_mail := v_mapa ->> lower(btrim(coalesce(r ->> 'usuario_appsheet', '')));
            v_user := null;
            if v_mail is not null then
                select u.id into v_user from auth.users u join public.perfiles pf on pf.id = u.id
                 where lower(u.email) = v_mail limit 1;
            end if;
            if v_user is null then
                v_sinu := v_sinu || jsonb_build_object('id_appsheet', v_idapp, 'usuario_appsheet', r ->> 'usuario_appsheet');
                continue;
            end if;

            v_ddt := coalesce(public._agm_num(r, 'ddt')::integer,
                              case when v_tc.fecha_siembra is not null then v_fecha - v_tc.fecha_siembra end);
            v_ver := public._agm_ic_version(v_fecha);
            select * into v_f from public.agm_ic_formula where id = v_ver;
            v_planp := coalesce(public._agm_num(r, 'ic_plan'), public._agm_ic_plan_de(v_ver, v_ddt));

            insert into public.agm_ic_registros (id, turno_ciclo_id, zona_id, fecha, ddt, hojas, ic_real, ic_plan, version_formula_id,
                                                 comentario, origen, id_appsheet, creado_por, creado_en)
            values (v_id, v_tc.id, public._agm_zona_turno(v_tc.id), v_fecha, v_ddt, v_hojas,
                    public._agm_ic_calc(v_hojas, v_ddt, v_f.divisor, v_f.exponente_ddt), v_planp, v_ver,
                    nullif(btrim(r ->> 'comentario'), ''), 'APPSHEET', v_idapp, v_user,
                    ((v_fecha::timestamp + interval '12 hours') at time zone 'America/Tegucigalpa'))
            on conflict do nothing;
            get diagnostics v_n = row_count;
            if v_n = 0 then
                select id into v_ex from public.agm_ic_registros
                 where turno_ciclo_id = v_tc.id and fecha = v_fecha and eliminado_en is null limit 1;
                v_conf := v_conf || jsonb_build_object('id_appsheet', v_idapp, 'existente', v_ex);
                continue;
            end if;
            update public.agm_ic_registros a set bajado_a_agl_en = now(), huella = public._agm_ic_huella(to_jsonb(a))
             where a.id = v_id;
            v_ins := v_ins + 1;
        exception when others then
            v_inv := v_inv || jsonb_build_object('id_appsheet', v_idapp, 'error', sqlerrm);
        end;
    end loop;
    return jsonb_build_object('insertadas', v_ins, 'ya_existian', v_ya, 'sin_usuario', v_sinu, 'sin_turno', v_sint,
                              'en_conflicto', v_conf, 'invalidas', v_inv);
end $$;
revoke execute on function public.fn_agm_ic_cargar_appsheet(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_cargar_appsheet(jsonb) to authenticated;

-- ---------------------------------------------------------------- 12 · baja a AGL (patrón 122/125)
/** Las filas con su huella actual y la guardada (cursor 'i|<id>'). */
create or replace function public._agm_ic_filas()
returns table (cursor text, id uuid, turno_ciclo_id uuid, fecha date, fila jsonb, texto text,
               huella text, huella_guardada text, bajado_a_agl_en timestamptz, turno_activo boolean)
language sql stable security definer set search_path = public, pg_temp as $$
    select 'i|' || a.id::text, a.id, a.turno_ciclo_id, a.fecha,
           (to_jsonb(a) - 'bajado_a_agl_en') - 'huella',
           ((to_jsonb(a) - 'bajado_a_agl_en') - 'huella')::text,
           public._agm_ic_huella(to_jsonb(a)), a.huella, a.bajado_a_agl_en,
           (select t.activo from public.turnos_ciclo t where t.id = a.turno_ciclo_id)
      from public.agm_ic_registros a
$$;
revoke execute on function public._agm_ic_filas() from public, anon, authenticated;

/**
 * p = {desde?, hasta?, limite? (1..1000, 200), despues_de? (cursor)}
 * -> {generado, hay_mas, siguiente, cuantos, sha256_lote, filas: [{cursor, id, turno_ciclo_id, turno_agl_id, turno, temporada, ciclo,
 *     zona_id, zona, fecha, fila, texto, huella, eliminado, creado_por_email}]}
 * Solo lo «por bajar» (nunca bajado, o cambiado después). Incluye tumbas. Permiso: Conexión AGL · ver.
 */
create or replace function public.fn_agm_ic_exportar(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_p     jsonb := coalesce(p, '{}'::jsonb);
    v_lim   integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 200), 1), 1000);
    v_desde date := nullif(v_p ->> 'desde', '')::date;
    v_hasta date := nullif(v_p ->> 'hasta', '')::date;
    v_desp  text := nullif(v_p ->> 'despues_de', '');
    v_filas jsonb;
    v_mas   boolean;
    v_sig   text;
    v_cuantos integer;
    v_lote  text;
begin
    perform public._agm_exigir_agl('ver');
    with f as (
        select x.* from public._agm_ic_filas() x
         where (x.bajado_a_agl_en is null or x.huella_guardada is distinct from x.huella)
           and (v_desde is null or x.fecha >= v_desde)
           and (v_hasta is null or x.fecha <= v_hasta)
           and (v_desp is null or x.cursor collate "C" > v_desp collate "C")
         order by x.cursor collate "C"
         limit v_lim + 1
    ), lim as (
        select * from f order by cursor collate "C" limit v_lim
    )
    select (select count(*) > v_lim from f),
           coalesce(jsonb_agg(jsonb_build_object(
               'cursor', l.cursor, 'id', l.id, 'turno_ciclo_id', l.turno_ciclo_id,
               'turno_agl_id', tc.agl_id, 'turno', tu.codigo, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
               'zona_id', coalesce(e.zona_id, tc.zona_id), 'zona', z.nombre,
               'fecha', l.fecha, 'fila', l.fila, 'texto', l.texto, 'huella', l.huella,
               'eliminado', (l.fila ->> 'eliminado_en') is not null,
               'creado_por_email', (select lower(u.email) from auth.users u where u.id = nullif(l.fila ->> 'creado_por', '')::uuid)
           ) order by l.cursor collate "C"), '[]'::jsonb),
           max(l.cursor collate "C"),
           count(*),
           encode(sha256(convert_to(coalesce(string_agg(l.huella, '|' order by l.cursor collate "C"), ''), 'UTF8')), 'hex')
      into v_mas, v_filas, v_sig, v_cuantos, v_lote
      from lim l
      left join public.turnos_ciclo tc on tc.id = l.turno_ciclo_id
      left join public.turnos tu on tu.id = tc.turno_id
      left join public.estaciones_riego e on e.id = tc.estacion_id
      left join public.zonas z on z.id = coalesce(e.zona_id, tc.zona_id);
    return jsonb_build_object('generado', now(), 'hay_mas', coalesce(v_mas, false), 'siguiente', v_sig,
                              'cuantos', v_cuantos, 'sha256_lote', v_lote, 'filas', v_filas);
end $$;
revoke execute on function public.fn_agm_ic_exportar(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_exportar(jsonb) to authenticated;

/** AGL lee todas las versiones de fórmula con su plan (para la gráfica IC real vs plan y su botón «Fórmula del IC»). Conexión AGL · ver. */
create or replace function public.fn_agm_ic_exportar_formulas()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._agm_exigir_agl('ver');
    return jsonb_build_object('generado', now(), 'versiones', coalesce((
        select jsonb_agg(public._agm_ic_version_json(f.id) order by f.vigente_desde) from public.agm_ic_formula f), '[]'::jsonb));
end $$;
revoke execute on function public.fn_agm_ic_exportar_formulas() from public, anon;
grant  execute on function public.fn_agm_ic_exportar_formulas() to authenticated;

/**
 * p = {lote: [{id, huella}], cuantos, sha256_lote}. Igual que fn_agm_confirmar_bajada (122): valida conteo y huella del lote,
 * recalcula la huella de cada fila y solo marca las que coinciden. NO borra. Conexión AGL · publicar.
 * -> {confirmadas: [{id}], rechazadas: [{id}]}
 */
create or replace function public.fn_agm_ic_confirmar_bajada(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_lote jsonb := p -> 'lote';
    v_ok   jsonb;
    v_mal  jsonb;
begin
    perform public._agm_exigir_agl('publicar');
    if v_lote is null or jsonb_typeof(v_lote) <> 'array' then
        raise exception 'Se esperaba {lote: [{id, huella}], cuantos, sha256_lote}.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_lote) x where nullif(x ->> 'id', '') is null or nullif(x ->> 'huella', '') is null) then
        raise exception 'El lote trae filas sin id o sin huella.' using errcode = '22023';
    end if;
    if coalesce(nullif(p ->> 'cuantos', '')::integer, -1) <> jsonb_array_length(v_lote) then
        raise exception 'El conteo del lote no coincide con la lista (cuantos = %, filas = %).',
            coalesce(p ->> 'cuantos', 'null'), jsonb_array_length(v_lote) using errcode = '22023';
    end if;
    if coalesce(p ->> 'sha256_lote', '') <> encode(sha256(convert_to(coalesce((
            select string_agg(x ->> 'huella', '|' order by ('i|' || (x ->> 'id')) collate "C")
              from jsonb_array_elements(v_lote) x), ''), 'UTF8')), 'hex') then
        raise exception 'La huella del lote no coincide: no se confirma nada. Vuelve a bajar y a verificar.' using errcode = '22023';
    end if;

    update public.agm_ic_registros a set bajado_a_agl_en = now(), huella = c.h
      from (select (x ->> 'id')::uuid as id, x ->> 'huella' as h from jsonb_array_elements(v_lote) x) c
     where a.id = c.id and public._agm_ic_huella(to_jsonb(a)) = c.h;

    -- sentencias aparte: ven el efecto del update
    select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id')), '[]'::jsonb) into v_ok
      from jsonb_array_elements(v_lote) x
     where exists (select 1 from public._agm_ic_filas() f
                    where f.id = (x ->> 'id')::uuid and f.bajado_a_agl_en is not null
                      and f.huella_guardada = x ->> 'huella' and f.huella = f.huella_guardada);
    select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id')), '[]'::jsonb) into v_mal
      from jsonb_array_elements(v_lote) x
     where not exists (select 1 from public._agm_ic_filas() f
                        where f.id = (x ->> 'id')::uuid and f.bajado_a_agl_en is not null
                          and f.huella_guardada = x ->> 'huella' and f.huella = f.huella_guardada);
    return jsonb_build_object('confirmadas', v_ok, 'rechazadas', v_mal);
end $$;
revoke execute on function public.fn_agm_ic_confirmar_bajada(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_confirmar_bajada(jsonb) to authenticated;

/**
 * p = {limite? (1..5000, 500), retencion_dias? (solo puede AUMENTAR la configurada en agm_bajada_config)}
 * Borra lo confirmado cuya huella actual sigue igual y que pasó la retención, SOLO si es una tumba o su turno ya no está activo
 * (lo de un turno activo se queda en Supabase para consultarlo y editarlo). Conexión AGL · publicar. -> {registros, hay_mas, retencion_dias}
 */
create or replace function public.fn_agm_ic_purgar_bajadas(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p   jsonb := coalesce(p, '{}'::jsonb);
    v_lim integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 500), 1), 5000);
    v_ret integer;
    v_n   integer;
    v_mas boolean;
begin
    perform public._agm_exigir_agl('publicar');
    select retencion_dias into v_ret from public.agm_bajada_config where id;
    v_ret := greatest(coalesce(v_ret, 7), coalesce(nullif(v_p ->> 'retencion_dias', '')::integer, 0));

    select count(*) > v_lim into v_mas
      from public._agm_ic_filas() f
     where f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
       and f.bajado_a_agl_en < now() - make_interval(days => v_ret)
       and ((f.fila ->> 'eliminado_en') is not null or f.turno_activo is false);

    with c as (
        select f.id from public._agm_ic_filas() f
         where f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
           and f.bajado_a_agl_en < now() - make_interval(days => v_ret)
           and ((f.fila ->> 'eliminado_en') is not null or f.turno_activo is false)
         order by f.cursor collate "C"
         limit v_lim
    ), d as (
        delete from public.agm_ic_registros a using c
         where a.id = c.id and a.huella is not null and public._agm_ic_huella(to_jsonb(a)) = a.huella
        returning a.id
    )
    select count(*) into v_n from d;
    return jsonb_build_object('registros', v_n, 'hay_mas', coalesce(v_mas, false) and v_n > 0, 'retencion_dias', v_ret);
end $$;
revoke execute on function public.fn_agm_ic_purgar_bajadas(jsonb) from public, anon;
grant  execute on function public.fn_agm_ic_purgar_bajadas(jsonb) to authenticated;

notify pgrst, 'reload schema';
