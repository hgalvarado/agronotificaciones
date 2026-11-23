-- =====================================================================
-- 129 · CAMPO · INYECCIÓN / DRENCH / ASEGURAMIENTO DE CALIDAD POR LOTE
-- =====================================================================
-- Bloque 2 de «Campo» (plan docs/superpowers/plans/2026-11-22-campo-bloque2-inyeccion-por-lote.md, Task 3;
-- spec docs/superpowers/specs/2026-11-22-campo-inyeccion-motores-design.md §6.3).
--
--   (a) materiales: datos técnicos OPCIONALES (plagas_controla, carencia_dias, restricciones, notas_tecnicas) y la
--       marca iny_activo (producto que alimenta Inyección). ingrediente_activo y concentracion ya existen (sql/61).
--   (b) Libro: tipo de movimiento APLICACION_LOTE (cantidad negativa, sin turno). La bodega es UNA por estación: lo que
--       se aplica por lote descuenta del mismo saldo de Fertirriego.
--   (c) Tablas PARALELAS iny_* (no tocan fert_aplicaciones ni los paquetes de «Terminar ciclo» de la 102):
--       iny_categorias, iny_plan, iny_aplicaciones, iny_aplicaciones_detalle, iny_bajada_config.
--   (d) Operación «aplicacion_lote» del despachador (teléfono, cola sin señal) y su anulación propia.
--       Observaciones: SIN_PLAN, CATEGORIA_INACTIVA, SALDO_NEGATIVO, AREA_MAYOR_AL_LOTE + las de _fert_autorizar.
--       «acepta_negativo: true» en datos = casilla «aplicar sin inventario» (el sincronizador manda inmediato=false).
--   (e) AGL: fn_iny_publicar (categorías, plan por lote, datos técnicos) y la bajada con huella sha256
--       (fn_iny_exportar / fn_iny_confirmar_bajada / fn_iny_purgar_bajadas / fn_iny_bajada_retencion), patrón de la 122.
--   (f) Teléfono: fn_iny_estado_campo (no repite saldos ni movimientos: ya vienen en fn_fert_estado_campo).
--   (g) Pantalla de permisos «inyeccion» (módulo Campo, ruta /inyeccion, fuera del menú): ver, registrar, anular,
--       configurar. «ver» y «registrar» a todo rol con fertirriego · aplicar; «anular» a quien tiene fertirriego · anular;
--       «configurar» solo administrador (nadie lo recibe por esta migración).
--
-- Correr DESPUÉS de la 128 (y de la 102/116/119: parchan las mismas funciones). Idempotente. Todo UPDATE/DELETE lleva
-- WHERE. Si se vuelve a correr la 99, 100, 101, 102, 116, 119 o 128 (redefinen o parchan _fert_procesar), correr la 129
-- otra vez. La marca de cada parche es propia (129) y no aparece en los parches de otras migraciones.
-- Los productos de inyección quedan con fertirriego = true (se reciben y cuentan con los formularios de Fertirriego) y
-- fert_analisis = false (no entran al análisis de fertilizantes). Aparecen en los selectores de Fertirriego: no hay un
-- filtro por clasificación disponible en fn_fert_estado_campo sin tocarla (queda anotado).
-- =====================================================================


-- ---------------------------------------------------------------- (a) materiales
alter table public.materiales add column if not exists plagas_controla text;
alter table public.materiales add column if not exists carencia_dias   integer check (carencia_dias >= 0);
alter table public.materiales add column if not exists restricciones   text;
alter table public.materiales add column if not exists notas_tecnicas  text;
alter table public.materiales add column if not exists iny_activo      boolean not null default false;

comment on column public.materiales.iny_activo is '129: producto que alimenta Inyección/Drench/Calidad (lo marca AGL al publicar).';
comment on column public.materiales.carencia_dias is '129: período de carencia (PPU) en días. Vacío = sin dato; 0 = sin carencia.';


-- ---------------------------------------------------------------- (b) tipo de movimiento APLICACION_LOTE
do $$
declare
    v_nombre text;
    v_def    text;
begin
    select c.conname, pg_get_constraintdef(c.oid) into v_nombre, v_def
      from pg_constraint c
     where c.conrelid = 'public.fert_movimientos'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%TRASLADO_SALIDA%'
     limit 1;
    if v_nombre is null then
        raise exception '129: no se encontró el check de tipo de fert_movimientos.';
    end if;
    if v_def not like '%APLICACION_LOTE%' then
        if position('''ANULACION''::text' in v_def) = 0 then
            raise exception '129: el check de tipo de fert_movimientos no trae ANULACION: %', v_def;
        end if;
        -- Se conserva TODO lo que ya admite (DEVOLUCION_BODEGA, ARCHIVO_TURNO…) y se agrega el tipo nuevo
        execute format('alter table public.fert_movimientos drop constraint %I', v_nombre);
        execute format('alter table public.fert_movimientos add constraint %I %s', v_nombre,
                       replace(v_def, '''ANULACION''::text', '''ANULACION''::text, ''APLICACION_LOTE''::text'));
    end if;
end $$;


-- ---------------------------------------------------------------- (c) tablas
/** Categorías del LTP que alimentan el módulo (las elige el administrador en AGL). Una inactiva NO se borra. */
create table if not exists public.iny_categorias (
    clave        text primary key,                     -- departamento|categoría normalizados
    departamento text,
    categoria    text,
    tipo         text not null default 'otra' check (tipo in ('inyeccion', 'drench', 'calidad', 'otra')),
    etiqueta     text,
    activo       boolean not null default true,
    publicado_at timestamptz not null default now()
);

/** Plan por lote publicado por AGL: una línea por (temporada, turno, lote, categoría, DDT, producto). */
create table if not exists public.iny_plan (
    id               uuid primary key default gen_random_uuid(),
    temporada        text not null,
    ciclo            text,
    turno_agl_id     text not null,
    turno            text,
    estacion_id      uuid references public.estaciones_riego(id),
    lote             text not null,
    lote_temporada_id uuid references public.lotes_temporada(id),
    categoria_clave  text not null references public.iny_categorias(clave),
    ddt              integer,
    fecha_plan       date,
    material_id      uuid not null references public.materiales(id),
    dosis_mz         numeric,
    area_mz          numeric,
    cantidad_plan    numeric,
    publicado_at     timestamptz not null default now(),
    unique (temporada, turno_agl_id, lote, categoria_clave, ddt, material_id)
);
create index if not exists idx_iny_plan_turno on public.iny_plan (temporada, turno_agl_id);
create index if not exists idx_iny_plan_estacion on public.iny_plan (estacion_id, fecha_plan);

/** Aplicación por lote (un documento; varios productos en el detalle). */
create table if not exists public.iny_aplicaciones (
    id                uuid primary key references public.fert_operaciones(id) on delete cascade,
    estacion_id       uuid not null references public.estaciones_riego(id),
    lote              text not null,
    lote_temporada_id uuid references public.lotes_temporada(id),
    temporada         text,
    ciclo             text,
    turno_agl_id      text,
    categoria_clave   text references public.iny_categorias(clave),
    fecha             date not null,
    fecha_hora        timestamptz not null,
    area_mz           numeric not null check (area_mz > 0),
    objetivos         text[] not null check (cardinality(objetivos) > 0
                                             and objetivos <@ array['PLAGA', 'MALEZA', 'BACTERIA', 'ENFERMEDAD', 'HONGO']),
    comentario        text,
    registrado_por    uuid,
    anulado_at        timestamptz,
    anulado_por       uuid,
    motivo_anulacion  text,
    bajado_a_agl_en   timestamptz,
    huella            text
);
create index if not exists idx_iny_apl_estacion on public.iny_aplicaciones (estacion_id, fecha desc);
create index if not exists idx_iny_apl_lote on public.iny_aplicaciones (lote, temporada);

create table if not exists public.iny_aplicaciones_detalle (
    aplicacion_id uuid not null references public.iny_aplicaciones(id) on delete cascade,
    material_id   uuid not null references public.materiales(id),
    cantidad      numeric(14,4) not null check (cantidad > 0),
    dosis_mz      numeric(14,4),           -- cantidad / área, calculada en la función (round 4)
    en_plan       boolean not null,
    plan_id       uuid,                    -- sin FK: el plan se puede reemplazar al republicar
    ddt_plan      integer,
    primary key (aplicacion_id, material_id)
);

create table if not exists public.iny_bajada_config (
    id             boolean primary key default true check (id),
    retencion_dias integer not null default 30 check (retencion_dias between 0 and 365)
);
insert into public.iny_bajada_config (id) values (true) on conflict (id) do nothing;
alter table public.iny_bajada_config enable row level security;   -- sin políticas: solo las funciones

do $$
declare
    t text;
begin
    foreach t in array array['iny_categorias', 'iny_plan', 'iny_aplicaciones', 'iny_aplicaciones_detalle'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('grant select on public.%I to authenticated', t);
        execute format('drop policy if exists fert_leer on public.%I', t);
    end loop;
end $$;

create policy fert_leer on public.iny_categorias for select to authenticated
    using (public.fn_es_admin() or public.fn_tiene_permiso('inyeccion', 'ver'));
create policy fert_leer on public.iny_plan for select to authenticated
    using ((public.fn_es_admin() or public.fn_tiene_permiso('inyeccion', 'ver'))
           and (estacion_id is null or public.fn_fert_puede(estacion_id, 'ver')));
create policy fert_leer on public.iny_aplicaciones for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.iny_aplicaciones_detalle for select to authenticated
    using (exists (select 1 from public.iny_aplicaciones a
                   where a.id = aplicacion_id and public.fn_fert_puede(a.estacion_id, 'ver')));


-- ---------------------------------------------------------------- (g) pantalla y permisos (antes que las funciones que los usan)
insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('registrar', 'Registrar', 'Campo: registra aplicaciones (por ejemplo, Inyección por lote).', 122, true)
on conflict (codigo) do nothing;

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones, en_menu, icono, modulo) values
    ('inyeccion', 'Inyección · Campo',
     'Inyección, drench y aseguramiento de calidad por lote: registro desde la estación a cargo, contra el plan del LTP. '
     'Se llega desde Campo (no está en el menú). «Configurar» es solo del administrador.',
     '/inyeccion', 122, array['ver', 'registrar', 'anular', 'configurar'], false, 'gota', 'Campo')
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, ruta = excluded.ruta,
    orden = excluded.orden, acciones = excluded.acciones;

update public.pantallas
   set modulo = coalesce(modulo, 'Campo'),
       etiquetas_alcance = coalesce(etiquetas_alcance,
           '{"global": "Todas las estaciones", "zonal": "Estaciones de sus zonas", "propietario": "Sus estaciones"}'::jsonb)
 where codigo = 'inyeccion';

-- «ver» y «registrar» a quien ya aplica en Fertirriego (mismo alcance); «anular» a quien ya anula. No se pisa lo existente.
insert into public.permisos (rol_id, recurso, accion, permitido, alcance)
select distinct pm.rol_id, 'inyeccion', a.accion, true, pm.alcance
  from public.permisos pm
 cross join (values ('ver'), ('registrar')) a(accion)
 where pm.recurso = 'fertirriego' and pm.accion = 'aplicar' and pm.permitido
on conflict (rol_id, recurso, accion) do nothing;

insert into public.permisos (rol_id, recurso, accion, permitido, alcance)
select distinct pm.rol_id, 'inyeccion', 'anular', true, pm.alcance
  from public.permisos pm
 where pm.recurso = 'fertirriego' and pm.accion = 'anular' and pm.permitido
on conflict (rol_id, recurso, accion) do nothing;


-- ---------------------------------------------------------------- ayudas internas
create or replace function public._iny_exigir_permiso(p_accion text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('inyeccion', p_accion)) then
        raise exception 'Tu rol no tiene «%» en Inyección. Se configura en Permisos.', p_accion using errcode = '42501';
    end if;
end $$;
revoke execute on function public._iny_exigir_permiso(text) from public, anon, authenticated;

create or replace function public._iny_exigir_agl(p_accion text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', p_accion)) then
        raise exception 'Tu rol no tiene permiso para %: se necesita Conexión AGL · %.',
            case when p_accion = 'ver' then 'leer lo registrado en Inyección' else 'publicar o confirmar lo de Inyección' end,
            p_accion using errcode = '42501';
    end if;
end $$;
revoke execute on function public._iny_exigir_agl(text) from public, anon, authenticated;

/** Huella: sha256 (hex) del texto de la fila (jsonb canónico, ya sin bajado_a_agl_en ni huella). */
create or replace function public._iny_huella(p_fila jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
    select encode(sha256(convert_to(p_fila::text, 'UTF8')), 'hex')
$$;
revoke execute on function public._iny_huella(jsonb) from public, anon, authenticated;

/** Permiso de Inyección + estación + custodia (la misma de Fertirriego: «aplicar»). */
create or replace function public._iny_autorizar(
    p_estacion uuid, p_accion text, p_momento timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._iny_exigir_permiso(p_accion);
    return public._fert_autorizar(p_estacion, 'aplicar', p_momento, p_inmediato, p_en_nombre);
end $$;
revoke execute on function public._iny_autorizar(uuid, text, timestamptz, boolean, uuid) from public, anon, authenticated;

create or replace function public._iny_lote_temporada(p_lote text, p_temporada text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
    select lt.id
      from public.lotes l
      join public.lotes_temporada lt on lt.lote_id = l.id
      join public.temporadas t on t.id = lt.temporada_id
     where l.nomenclatura = btrim(p_lote) and public._fert_llave(t.nombre) = public._fert_llave(p_temporada)
     limit 1
$$;
revoke execute on function public._iny_lote_temporada(text, text) from public, anon, authenticated;

/** Área del lote para validar el área cubierta: la mayor entre lo publicado en el plan (suma de cohortes) y fn_area_lote_ciclo. 0 = se desconoce. */
create or replace function public._iny_area_lote(p_lote text, p_temporada text, p_ciclo text)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_plan numeric;
    v_lt   uuid := public._iny_lote_temporada(p_lote, p_temporada);
    v_fn   numeric := 0;
begin
    select coalesce(sum(x.a), 0) into v_plan
      from (select max(p.area_mz) as a from public.iny_plan p
             where lower(btrim(p.lote)) = lower(btrim(p_lote))
               and (p_temporada is null or public._fert_llave(p.temporada) = public._fert_llave(p_temporada))
             group by p.turno_agl_id) x;
    if v_lt is not null then
        v_fn := coalesce(public.fn_area_lote_ciclo(v_lt, nullif(regexp_replace(coalesce(p_ciclo, ''), '\D', '', 'g'), '')::integer), 0);
    end if;
    return greatest(coalesce(v_plan, 0), coalesce(v_fn, 0));
end $$;
revoke execute on function public._iny_area_lote(text, text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------- (d) la operación
create or replace function public._iny_op_aplicacion_lote(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_fecha    timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_dia      date;
    v_lote     text := nullif(btrim(coalesce(d->>'lote', '')), '');
    v_temp     text := nullif(btrim(coalesce(d->>'temporada', '')), '');
    v_ciclo    text := nullif(btrim(coalesce(d->>'ciclo', '')), '');
    v_turno    text := nullif(btrim(coalesce(d->>'turno_agl_id', '')), '');
    v_clave    text := nullif(btrim(coalesce(d->>'categoria_clave', '')), '');
    v_cat      public.iny_categorias%rowtype;
    v_area     numeric;
    v_area_lote numeric;
    v_obj      text[];
    v_lineas   jsonb;
    v_obs      text[];
    v_plan     public.iny_plan%rowtype;
    v_t        text;
    v_c        text;
    l          record;
begin
    if v_estacion is null or not exists (select 1 from public.estaciones_riego where id = v_estacion) then
        raise exception 'La estación no existe. Actualiza la aplicación.';
    end if;
    if v_lote is null then
        raise exception 'Indica el lote.';
    end if;
    begin
        v_area := nullif(replace(btrim(coalesce(d->>'area_mz', '')), ',', '.'), '')::numeric;
    exception when others then
        v_area := null;
    end;
    if v_area is null or v_area <= 0 then
        raise exception 'Indica el área cubierta.';
    end if;

    if d->'objetivos' is null or jsonb_typeof(d->'objetivos') <> 'array' then
        raise exception 'Elige al menos un objetivo.';
    end if;
    select coalesce(array_agg(distinct upper(btrim(x))), '{}') into v_obj from jsonb_array_elements_text(d->'objetivos') x;
    if cardinality(v_obj) = 0 then
        raise exception 'Elige al menos un objetivo.';
    end if;
    if exists (select 1 from unnest(v_obj) o where o not in ('PLAGA', 'MALEZA', 'BACTERIA', 'ENFERMEDAD', 'HONGO')) then
        raise exception 'Objetivo no válido (usa plaga, maleza, bacteria, enfermedad u hongo).';
    end if;

    -- Las líneas con cantidad 0 o vacía se ignoran (igual que en el teléfono)
    if d->'lineas' is null or jsonb_typeof(d->'lineas') <> 'array' then
        raise exception 'Indica al menos un producto.';
    end if;
    select coalesce(jsonb_agg(x.value), '[]'::jsonb) into v_lineas
      from jsonb_array_elements(d->'lineas') x
     where not (coalesce(nullif(btrim(x.value->>'cantidad'), ''), '0') ~ '^0*([.,]0*)?$');
    if jsonb_array_length(v_lineas) = 0 then
        raise exception 'Indica al menos un producto.';
    end if;

    v_obs := public._iny_autorizar(v_estacion, 'registrar', p_creado, p_inmediato, p_en_nombre);
    v_dia := (v_fecha at time zone 'America/Tegucigalpa')::date;

    -- Categoría: una desactivada (o ausente) se acepta si llega de la cola sin señal; queda anotada
    if v_clave is not null then
        select * into v_cat from public.iny_categorias where clave = v_clave;
        if not found then
            v_clave := null;
            v_obs := public._fert_obs(v_obs, array['CATEGORIA_INACTIVA']);
        elsif not v_cat.activo then
            v_obs := public._fert_obs(v_obs, array['CATEGORIA_INACTIVA']);
        end if;
    end if;

    -- Área contra el área del lote: en línea se rechaza; si llegó tarde (sin señal) se acepta con observación
    v_area_lote := public._iny_area_lote(v_lote, v_temp, v_ciclo);
    if v_area_lote > 0 and v_area > v_area_lote * 1.0001 then
        if p_inmediato then
            raise exception 'El área cubierta (% mz) es mayor que el área del lote (% mz).', round(v_area, 4), round(v_area_lote, 4);
        end if;
        v_obs := public._fert_obs(v_obs, array['AREA_MAYOR_AL_LOTE']);
    end if;

    insert into public.iny_aplicaciones
        (id, estacion_id, lote, lote_temporada_id, temporada, ciclo, turno_agl_id, categoria_clave, fecha, fecha_hora,
         area_mz, objetivos, comentario, registrado_por)
    values
        (p_id, v_estacion, v_lote, public._iny_lote_temporada(v_lote, v_temp), v_temp, v_ciclo, v_turno, v_clave, v_dia, v_fecha,
         v_area, v_obj, nullif(btrim(coalesce(d->>'comentario', '')), ''), (select auth.uid()));

    for l in select * from public._fert_lineas(v_lineas) loop
        -- línea del plan más cercana a la fecha de la aplicación (varias cohortes del mismo lote: la más próxima)
        select p.* into v_plan
          from public.iny_plan p
         where lower(btrim(p.lote)) = lower(v_lote)
           and p.material_id = l.material_id
           and (v_temp is null or public._fert_llave(p.temporada) = public._fert_llave(v_temp))
           and (v_clave is null or p.categoria_clave = v_clave)
           and (v_turno is null or p.turno_agl_id = v_turno)
           and (v_ciclo is null or p.ciclo is null or p.ciclo = v_ciclo)
         order by abs(p.fecha_plan - v_dia), p.fecha_plan
         limit 1;
        if found then
            v_t := coalesce(v_t, v_plan.turno_agl_id);
            v_c := coalesce(v_c, v_plan.ciclo);
            insert into public.iny_aplicaciones_detalle (aplicacion_id, material_id, cantidad, dosis_mz, en_plan, plan_id, ddt_plan)
            values (p_id, l.material_id, l.cantidad, round(l.cantidad / v_area, 4), true, v_plan.id, v_plan.ddt);
        else
            v_obs := public._fert_obs(v_obs, array['SIN_PLAN']);
            insert into public.iny_aplicaciones_detalle (aplicacion_id, material_id, cantidad, dosis_mz, en_plan, plan_id, ddt_plan)
            values (p_id, l.material_id, l.cantidad, round(l.cantidad / v_area, 4), false, null, null);
        end if;
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'APLICACION_LOTE',
                     -l.cantidad, v_fecha, null, 'aplicacion_lote', p_id, p_inmediato));
    end loop;

    -- Con plan, la aplicación hereda turno y ciclo del plan que cubrió (lo que el teléfono no mandó)
    update public.iny_aplicaciones
       set turno_agl_id = coalesce(turno_agl_id, v_t), ciclo = coalesce(ciclo, v_c)
     where id = p_id;
    return v_obs;
end;
$$;
revoke execute on function public._iny_op_aplicacion_lote(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;

-- Anulación propia (mismas reglas que la de la devolución a bodega: «Anular», o su propio registro en su jornada)
create or replace function public._iny_op_anulacion_aplicacion_lote(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_doc      uuid := public._fert_uuid(d->>'documento_id');
    v_motivo   text := nullif(btrim(d->>'motivo'), '');
    v_estacion uuid;
    v_autor    uuid;
    v_anulado  timestamptz;
    v_registro timestamptz;
    v_custodia public.fert_custodia%rowtype;
    v_obs      text[] := '{}';
    m          record;
begin
    if v_motivo is null then
        raise exception 'Indica el motivo de la anulación.';
    end if;
    select x.estacion_id, x.registrado_por, x.anulado_at into v_estacion, v_autor, v_anulado
      from public.iny_aplicaciones x where x.id = v_doc for update;
    if v_estacion is null then
        raise exception 'El registro a anular no existe.';
    end if;
    if v_anulado is not null then
        raise exception 'Ese registro ya estaba anulado.';
    end if;

    select coalesce(o.creado_en, o.recibido_en) into v_registro from public.fert_operaciones o where o.id = v_doc;

    if not (public.fn_es_admin()
            or (public.fn_tiene_permiso('inyeccion', 'anular') and public.fn_fert_puede(v_estacion, 'anular'))) then
        select * into v_custodia from public.fert_custodia where estacion_id = v_estacion;
        if not (v_autor = (select auth.uid())
                and v_custodia.custodio_id = (select auth.uid())
                and v_custodia.estado = 'ACTIVA'
                and v_custodia.desde <= coalesce(v_registro, now())) then
            raise exception 'Solo puedes anular tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'
                using errcode = '42501';
        end if;
    end if;

    for m in select * from public.fert_movimientos mv
             where mv.documento_id = v_doc and mv.anula_id is null and mv.tipo <> 'ANULACION'
             order by mv.cursor loop
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, m.estacion_id, m.material_id, 'ANULACION',
                     -m.cantidad, p_creado, m.turno_ciclo_id, 'aplicacion_lote', v_doc, p_inmediato, m.id));
    end loop;

    update public.iny_aplicaciones
       set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo
     where id = v_doc;
    return v_obs;
end;
$$;
revoke execute on function public._iny_op_anulacion_aplicacion_lote(uuid, jsonb, timestamptz, boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------- parches al despachador (marca propia 129)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer := (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    if v_n <> 1 then
        raise exception '129: en % se esperaba 1 aparición de «%» y hay % (¿falta correr la 128?)', p_fn, p_viejo, v_n;
    end if;
    begin
        execute replace(v_def, p_viejo, p_nuevo);
    exception when others then
        raise exception '129: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- tipo válido
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$'devolucion', 'devolucion_bodega', 'anulacion',$p$,
    $p$'aplicacion_lote', 'devolucion', 'devolucion_bodega', 'anulacion',$p$,
    $p$'aplicacion_lote', 'devolucion',$p$);   -- (la lista de la 128 queda intacta: su marca sigue presente)

-- a qué función va
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$        when 'devolucion_bodega'  then public._fert_op_devolucion_bodega(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)$p$,
    $p$        when 'devolucion_bodega'  then public._fert_op_devolucion_bodega(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'aplicacion_lote'    then public._iny_op_aplicacion_lote(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)$p$,
    $p$_iny_op_aplicacion_lote($p$);

-- anulación del tipo nuevo (extiende el case de la 128 con otra rama)
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$else public._fert_op_anulacion(v_id, v_datos, v_creado, v_inmediato) end$p$,
    $p$when v_datos->>'documento_tipo' = 'aplicacion_lote'
                                            then public._iny_op_anulacion_aplicacion_lote(v_id, v_datos, v_creado, v_inmediato)
                                            else public._fert_op_anulacion(v_id, v_datos, v_creado, v_inmediato) end$p$,
    $p$_iny_op_anulacion_aplicacion_lote($p$);


-- ---------------------------------------------------------------- (e) AGL publica
/**
 * p = {temporada?, completo?: true, categorias: [{clave, departamento, categoria, tipo, etiqueta, activo}],
 *      plan: [{temporada, ciclo, turno_agl_id, turno, estacion, lote, categoria_clave, ddt, fecha_plan, material (código),
 *              dosis_mz, area_mz, cantidad_plan}],
 *      materiales: [{codigo, descripcion, unidad, grupo, ingrediente_activo, plagas_controla, carencia_dias,
 *                    restricciones, notas_tecnicas}]}
 * -> {categorias, lineas, materiales, avisos: [texto]}. Permiso: fertirriego_agl · publicar.
 * Las categorías que ya no vienen (con «completo») quedan activo = false, NO se borran; el plan de cada (temporada, turno)
 * que llega se reemplaza.
 */
create or replace function public.fn_iny_publicar(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p       jsonb := coalesce(p, '{}'::jsonb);
    v_completo boolean := coalesce((v_p->>'completo')::boolean, true);
    v_temp    text := nullif(btrim(coalesce(v_p->>'temporada', '')), '');
    v_avisos  text[] := '{}';
    v_n_cat   integer := 0;
    v_n_lin   integer := 0;
    v_n_mat   integer := 0;
    v_claves  text[] := '{}';
    v_codigos text[] := '{}';
    v_turnos  text[] := '{}';
    c         record;
    m         record;
    x         record;
    v_est     uuid;
    v_mat     uuid;
begin
    perform public._iny_exigir_agl('publicar');

    for c in select * from jsonb_to_recordset(coalesce(v_p->'categorias', '[]'::jsonb))
             as t(clave text, departamento text, categoria text, tipo text, etiqueta text, activo boolean) loop
        continue when nullif(btrim(c.clave), '') is null;
        insert into public.iny_categorias (clave, departamento, categoria, tipo, etiqueta, activo, publicado_at)
        values (btrim(c.clave), c.departamento, c.categoria,
                case when c.tipo in ('inyeccion', 'drench', 'calidad', 'otra') then c.tipo else 'otra' end,
                c.etiqueta, coalesce(c.activo, true), now())
        on conflict (clave) do update
        set departamento = excluded.departamento, categoria = excluded.categoria, tipo = excluded.tipo,
            etiqueta = excluded.etiqueta, activo = excluded.activo, publicado_at = now();
        v_claves := v_claves || btrim(c.clave);
        v_n_cat := v_n_cat + 1;
    end loop;
    if v_completo then
        update public.iny_categorias set activo = false where activo and not (clave = any(v_claves));
    end if;

    for m in select * from jsonb_to_recordset(coalesce(v_p->'materiales', '[]'::jsonb))
             as t(codigo text, descripcion text, unidad text, grupo text, ingrediente_activo text, plagas_controla text,
                  carencia_dias integer, restricciones text, notas_tecnicas text) loop
        continue when nullif(btrim(m.codigo), '') is null or btrim(m.codigo) like 'CAMPO-%';
        insert into public.materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo, iny_activo,
                                       ingrediente_activo, plagas_controla, carencia_dias, restricciones, notas_tecnicas)
        values (btrim(m.codigo), m.descripcion, nullif(btrim(m.grupo), ''), m.unidad, true, false, 'MARA', true, true,
                nullif(btrim(m.ingrediente_activo), ''), nullif(btrim(m.plagas_controla), ''), m.carencia_dias,
                nullif(btrim(m.restricciones), ''), nullif(btrim(m.notas_tecnicas), ''))
        on conflict (codigo) do update
        set unidad = coalesce(excluded.unidad, materiales.unidad),
            descripcion = coalesce(materiales.descripcion, excluded.descripcion),
            grupo = coalesce(materiales.grupo, excluded.grupo),
            fertirriego = true, activo = true, iny_activo = true,
            ingrediente_activo = coalesce(excluded.ingrediente_activo, materiales.ingrediente_activo),
            plagas_controla = excluded.plagas_controla,     -- AGL manda: vacío aquí = sin dato
            carencia_dias = excluded.carencia_dias,
            restricciones = excluded.restricciones,
            notas_tecnicas = excluded.notas_tecnicas;
        v_codigos := v_codigos || btrim(m.codigo);
        v_n_mat := v_n_mat + 1;
    end loop;
    if v_completo then
        update public.materiales set iny_activo = false where iny_activo and not (codigo = any(v_codigos));
    end if;

    -- Plan: se reemplaza el de cada (temporada, turno) que llega
    for x in select distinct nullif(btrim(t.temporada), '') as temporada, nullif(btrim(t.turno_agl_id), '') as turno_agl_id
               from jsonb_to_recordset(coalesce(v_p->'plan', '[]'::jsonb)) as t(temporada text, turno_agl_id text) loop
        continue when x.temporada is null or x.turno_agl_id is null;
        delete from public.iny_plan where temporada = x.temporada and turno_agl_id = x.turno_agl_id;
        v_turnos := v_turnos || x.turno_agl_id;
    end loop;
    if v_completo and v_temp is not null then
        delete from public.iny_plan where temporada = v_temp and not (turno_agl_id = any(v_turnos));
    end if;

    for x in select * from jsonb_to_recordset(coalesce(v_p->'plan', '[]'::jsonb))
             as t(temporada text, ciclo text, turno_agl_id text, turno text, estacion text, lote text, categoria_clave text,
                  ddt integer, fecha_plan date, material text, dosis_mz numeric, area_mz numeric, cantidad_plan numeric) loop
        continue when nullif(btrim(x.temporada), '') is null or nullif(btrim(x.turno_agl_id), '') is null
                      or nullif(btrim(x.lote), '') is null;
        if not exists (select 1 from public.iny_categorias where clave = x.categoria_clave) then
            v_avisos := v_avisos || format('Línea sin categoría publicada (%s, lote %s): se omite.', coalesce(x.categoria_clave, '—'), x.lote);
            continue;
        end if;
        v_mat := (select id from public.materiales where codigo = btrim(x.material));
        if v_mat is null then
            v_avisos := v_avisos || format('Producto %s no existe en el catálogo: se omite (lote %s).', coalesce(x.material, '—'), x.lote);
            continue;
        end if;
        v_est := (select s.id from public.estaciones_riego s where public._fert_llave(s.nombre) = public._fert_llave(x.estacion) limit 1);
        if v_est is null and nullif(btrim(x.estacion), '') is not null then
            v_avisos := v_avisos || format('Estación «%s» no existe aquí (turno %s).', x.estacion, coalesce(x.turno, x.turno_agl_id));
        end if;
        insert into public.iny_plan (temporada, ciclo, turno_agl_id, turno, estacion_id, lote, lote_temporada_id, categoria_clave,
                                     ddt, fecha_plan, material_id, dosis_mz, area_mz, cantidad_plan, publicado_at)
        values (btrim(x.temporada), x.ciclo, btrim(x.turno_agl_id), x.turno, v_est, btrim(x.lote),
                public._iny_lote_temporada(x.lote, x.temporada), x.categoria_clave, x.ddt, x.fecha_plan, v_mat,
                x.dosis_mz, x.area_mz, x.cantidad_plan, now())
        on conflict (temporada, turno_agl_id, lote, categoria_clave, ddt, material_id) do update
        set ciclo = excluded.ciclo, turno = excluded.turno, estacion_id = excluded.estacion_id,
            lote_temporada_id = excluded.lote_temporada_id, fecha_plan = excluded.fecha_plan,
            dosis_mz = excluded.dosis_mz, area_mz = excluded.area_mz, cantidad_plan = excluded.cantidad_plan,
            publicado_at = now();
        v_n_lin := v_n_lin + 1;
    end loop;

    return jsonb_build_object('categorias', v_n_cat, 'lineas', v_n_lin, 'materiales', v_n_mat, 'avisos', to_jsonb(v_avisos));
end
$$;
revoke execute on function public.fn_iny_publicar(jsonb) from public, anon;
grant  execute on function public.fn_iny_publicar(jsonb) to authenticated;


-- ---------------------------------------------------------------- bajada a AGL con huella
/** Fila de la bajada: la aplicación (sin marcas de bajada) + su detalle, todo dentro del texto de la huella. */
create or replace function public._iny_fila(a public.iny_aplicaciones)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
    select ((to_jsonb(a) - 'bajado_a_agl_en') - 'huella')
           || jsonb_build_object('detalle', coalesce((
                select jsonb_agg(jsonb_build_object(
                           'material_id', d.material_id, 'material', m.codigo, 'cantidad', d.cantidad, 'dosis_mz', d.dosis_mz,
                           'en_plan', d.en_plan, 'plan_id', d.plan_id, 'ddt_plan', d.ddt_plan)
                       order by d.material_id)
                  from public.iny_aplicaciones_detalle d join public.materiales m on m.id = d.material_id
                 where d.aplicacion_id = a.id), '[]'::jsonb))
$$;
revoke execute on function public._iny_fila(public.iny_aplicaciones) from public, anon, authenticated;

create or replace function public._iny_filas()
returns table (cursor text, id uuid, estacion_id uuid, fecha date, fila jsonb, texto text, huella text,
               huella_guardada text, bajado_a_agl_en timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
    select 'a|' || a.id::text, a.id, a.estacion_id, a.fecha, f.j, f.j::text, public._iny_huella(f.j), a.huella, a.bajado_a_agl_en
      from public.iny_aplicaciones a
     cross join lateral (select public._iny_fila(a) as j) f
$$;
revoke execute on function public._iny_filas() from public, anon, authenticated;

/**
 * p = {desde?, hasta?, limite?: 1..1000 (200), despues_de?: cursor}
 * -> {generado, hay_mas, siguiente, cuantos, sha256_lote,
 *     filas: [{cursor: 'a|<id>', id, estacion_id, estacion, zona, fecha, fila: {...aplicación, detalle: [...]}, texto, huella}]}
 * Solo lo «por bajar» (nunca bajado o cambiado después de bajarlo). Orden por cursor (binario).
 */
create or replace function public.fn_iny_exportar(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_p      jsonb := coalesce(p, '{}'::jsonb);
    v_lim    integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 200), 1), 1000);
    v_desde  date := nullif(v_p ->> 'desde', '')::date;
    v_hasta  date := nullif(v_p ->> 'hasta', '')::date;
    v_desp   text := nullif(v_p ->> 'despues_de', '');
    v_filas  jsonb;
    v_mas    boolean;
    v_sig    text;
    v_cuantos integer;
    v_lote   text;
begin
    perform public._iny_exigir_agl('ver');
    with f as (
        select x.* from public._iny_filas() x
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
               'cursor', l.cursor, 'id', l.id, 'estacion_id', l.estacion_id, 'estacion', e.nombre, 'zona', z.nombre,
               'fecha', l.fecha, 'fila', l.fila, 'texto', l.texto, 'huella', l.huella
           ) order by l.cursor collate "C"), '[]'::jsonb),
           max(l.cursor collate "C"),
           count(*),
           encode(sha256(convert_to(coalesce(string_agg(l.huella, '|' order by l.cursor collate "C"), ''), 'UTF8')), 'hex')
      into v_mas, v_filas, v_sig, v_cuantos, v_lote
      from lim l
      left join public.estaciones_riego e on e.id = l.estacion_id
      left join public.zonas z on z.id = e.zona_id;
    return jsonb_build_object('generado', now(), 'hay_mas', coalesce(v_mas, false), 'siguiente', v_sig,
                              'cuantos', v_cuantos, 'sha256_lote', v_lote, 'filas', v_filas);
end
$$;
revoke execute on function public.fn_iny_exportar(jsonb) from public, anon;
grant  execute on function public.fn_iny_exportar(jsonb) to authenticated;

/**
 * p = {lote: [{id, huella}], cuantos, sha256_lote}; sha256_lote = sha256 de las huellas unidas con '|' ordenadas por
 * 'a|<id>' (binario). La base RECALCULA la huella de cada fila: coincide = se marca; cambió = sigue «por bajar».
 * -> {confirmadas: [{id}], rechazadas: [{id}]}. No borra nada. Permiso: fertirriego_agl · publicar.
 */
create or replace function public.fn_iny_confirmar_bajada(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_lote jsonb := p -> 'lote';
    v_ok   jsonb;
    v_mal  jsonb;
begin
    perform public._iny_exigir_agl('publicar');
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
            select string_agg(x ->> 'huella', '|' order by ('a|' || (x ->> 'id')) collate "C")
              from jsonb_array_elements(v_lote) x), ''), 'UTF8')), 'hex') then
        raise exception 'La huella del lote no coincide: no se confirma nada. Vuelve a bajar y a verificar.' using errcode = '22023';
    end if;

    update public.iny_aplicaciones a set bajado_a_agl_en = now(), huella = c.h
      from (select (x ->> 'id')::uuid as id, x ->> 'huella' as h from jsonb_array_elements(v_lote) x) c
     where a.id = c.id and public._iny_huella(public._iny_fila(a)) = c.h;

    -- (sentencias aparte: ven el efecto de la anterior)
    select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id')), '[]'::jsonb) into v_ok
      from jsonb_array_elements(v_lote) x
     where exists (select 1 from public._iny_filas() f
                    where f.id = (x ->> 'id')::uuid and f.bajado_a_agl_en is not null
                      and f.huella_guardada = x ->> 'huella' and f.huella = f.huella_guardada);
    select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id')), '[]'::jsonb) into v_mal
      from jsonb_array_elements(v_lote) x
     where not exists (select 1 from public._iny_filas() f
                        where f.id = (x ->> 'id')::uuid and f.bajado_a_agl_en is not null
                          and f.huella_guardada = x ->> 'huella' and f.huella = f.huella_guardada);
    return jsonb_build_object('confirmadas', v_ok, 'rechazadas', v_mal);
end
$$;
revoke execute on function public.fn_iny_confirmar_bajada(jsonb) from public, anon;
grant  execute on function public.fn_iny_confirmar_bajada(jsonb) to authenticated;

/** d = {dias?: 0..365}: sin «dias» devuelve la retención; con «dias» la cambia. -> {retencion_dias}. */
create or replace function public.fn_iny_bajada_retencion(d jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_dias integer := nullif(coalesce(d, '{}'::jsonb) ->> 'dias', '')::integer;
    v      integer;
begin
    perform public._iny_exigir_agl('publicar');
    if v_dias is not null then
        if v_dias not between 0 and 365 then
            raise exception 'La retención va de 0 a 365 días.' using errcode = '22023';
        end if;
        update public.iny_bajada_config set retencion_dias = v_dias where id;
    end if;
    select retencion_dias into v from public.iny_bajada_config where id;
    return jsonb_build_object('retencion_dias', v);
end
$$;
revoke execute on function public.fn_iny_bajada_retencion(jsonb) from public, anon;
grant  execute on function public.fn_iny_bajada_retencion(jsonb) to authenticated;

/**
 * p = {limite?: 1..5000 (500), retencion_dias?: solo puede AUMENTAR la configurada}
 * Borra de Supabase lo confirmado hace más de la retención (30 días por defecto) cuya huella actual = la confirmada.
 * Los movimientos del libro y la operación (auditoría) se quedan. -> {aplicaciones, hay_mas, retencion_dias}
 */
create or replace function public.fn_iny_purgar_bajadas(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p   jsonb := coalesce(p, '{}'::jsonb);
    v_lim integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 500), 1), 5000);
    v_ret integer;
    v_n   integer;
    v_mas boolean;
begin
    perform public._iny_exigir_agl('publicar');
    select retencion_dias into v_ret from public.iny_bajada_config where id;
    v_ret := greatest(coalesce(v_ret, 30), coalesce(nullif(v_p ->> 'retencion_dias', '')::integer, 0));

    select count(*) > v_lim into v_mas
      from public._iny_filas() f
     where f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
       and f.bajado_a_agl_en < now() - make_interval(days => v_ret);

    with c as (
        select f.id from public._iny_filas() f
         where f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
           and f.bajado_a_agl_en < now() - make_interval(days => v_ret)
         order by f.cursor collate "C"
         limit v_lim
    ), dp as (
        delete from public.iny_aplicaciones a using c
         where a.id = c.id and a.huella is not null and public._iny_huella(public._iny_fila(a)) = a.huella
        returning a.id
    )
    select count(*) into v_n from dp;

    return jsonb_build_object('aplicaciones', v_n, 'hay_mas', coalesce(v_mas, false) and v_n > 0, 'retencion_dias', v_ret);
end
$$;
revoke execute on function public.fn_iny_purgar_bajadas(jsonb) from public, anon;
grant  execute on function public.fn_iny_purgar_bajadas(jsonb) to authenticated;


-- ---------------------------------------------------------------- (f) lo que baja el teléfono
/**
 * -> {servidor_en, permisos: {ver, registrar, anular}, categorias (solo activas), plan, materiales, aplicaciones}
 * plan: de las estaciones que la persona ve, de p_desde (o 90 días atrás) a 60 días adelante.
 * aplicaciones: de esas estaciones, últimos 120 días, con su detalle (las anuladas vienen marcadas).
 * No repite saldos ni movimientos: ya vienen en fn_fert_estado_campo.
 */
create or replace function public.fn_iny_estado_campo(p_desde date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_hoy date := (now() at time zone 'America/Tegucigalpa')::date;
    v_desde date;
begin
    perform public._iny_exigir_permiso('ver');
    v_desde := coalesce(p_desde, v_hoy - 90);
    return jsonb_build_object(
        'servidor_en', now(),
        'permisos', jsonb_build_object(
            'ver', true,
            'registrar', public.fn_es_admin() or public.fn_tiene_permiso('inyeccion', 'registrar'),
            'anular', public.fn_es_admin() or public.fn_tiene_permiso('inyeccion', 'anular')),
        'categorias', coalesce((
            select jsonb_agg(jsonb_build_object('clave', c.clave, 'departamento', c.departamento, 'categoria', c.categoria,
                                                'tipo', c.tipo, 'etiqueta', coalesce(c.etiqueta, c.categoria)) order by c.tipo, c.clave)
              from public.iny_categorias c where c.activo), '[]'::jsonb),
        'plan', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', p.id, 'estacion_id', p.estacion_id, 'temporada', p.temporada, 'ciclo', p.ciclo,
                       'turno_agl_id', p.turno_agl_id, 'turno', p.turno, 'lote', p.lote, 'categoria_clave', p.categoria_clave,
                       'ddt', p.ddt, 'fecha_plan', p.fecha_plan, 'material_id', p.material_id, 'dosis_mz', p.dosis_mz,
                       'area_mz', p.area_mz, 'cantidad_plan', p.cantidad_plan)
                   order by p.fecha_plan, p.lote)
              from public.iny_plan p
              join public.iny_categorias c on c.clave = p.categoria_clave and c.activo
             where (p.estacion_id is null or public.fn_fert_puede(p.estacion_id, 'ver'))
               and p.fecha_plan between v_desde and v_hoy + 60), '[]'::jsonb),
        'materiales', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', m.id, 'codigo', m.codigo, 'descripcion', m.descripcion, 'unidad', m.unidad, 'grupo', m.grupo,
                       'ingrediente_activo', m.ingrediente_activo, 'concentracion', m.concentracion,
                       'plagas_controla', m.plagas_controla, 'carencia_dias', m.carencia_dias,
                       'restricciones', m.restricciones, 'notas_tecnicas', m.notas_tecnicas)
                   order by m.descripcion)
              from public.materiales m where m.iny_activo), '[]'::jsonb),
        'aplicaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', a.id, 'estacion_id', a.estacion_id, 'lote', a.lote, 'temporada', a.temporada, 'ciclo', a.ciclo,
                       'turno_agl_id', a.turno_agl_id, 'categoria_clave', a.categoria_clave, 'fecha', a.fecha,
                       'fecha_hora', a.fecha_hora, 'area_mz', a.area_mz, 'objetivos', to_jsonb(a.objetivos),
                       'comentario', a.comentario, 'registrado_por', a.registrado_por, 'anulado_at', a.anulado_at,
                       'motivo_anulacion', a.motivo_anulacion,
                       'observaciones', to_jsonb(o.observaciones),
                       'lineas', coalesce((select jsonb_agg(jsonb_build_object(
                                     'material_id', d.material_id, 'cantidad', d.cantidad, 'dosis_mz', d.dosis_mz,
                                     'en_plan', d.en_plan, 'ddt_plan', d.ddt_plan) order by d.material_id)
                                   from public.iny_aplicaciones_detalle d where d.aplicacion_id = a.id), '[]'::jsonb))
                   order by a.fecha_hora desc)
              from public.iny_aplicaciones a
              left join public.fert_operaciones o on o.id = a.id
             where public.fn_fert_puede(a.estacion_id, 'ver')
               and a.fecha >= v_hoy - 120), '[]'::jsonb)
    );
end
$$;
revoke execute on function public.fn_iny_estado_campo(date) from public, anon;
grant  execute on function public.fn_iny_estado_campo(date) to authenticated;

notify pgrst, 'reload schema';
