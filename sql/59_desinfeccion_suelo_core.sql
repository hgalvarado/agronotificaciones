-- =====================================================================
-- 59 · DESINFECCIÓN DE SUELO — NÚCLEO
-- =====================================================================
--
-- Fase 1 del módulo: las tablas, su RLS, los cálculos que no pueden
-- quedar en el navegador y las vistas con su reja. Sin pantallas todavía.
--
-- LA FORMA DEL MÓDULO
--
--   PLAN            qué se va a aplicar, lote por lote, con su costo
--                   previsto. Se congela la fecha de siembra a propósito:
--                   ver más abajo.
--
--   EJECUCIÓN       lo que de verdad pasó, en tres fases encadenadas
--                   —preriego, lecturas, aplicación— sobre un TURNO de
--                   riego, que es la unidad con la que se riega.
--     └ LOTES       qué lotes tocó ese turno y cuántas manzanas de cada
--                   uno. Un turno riega varios lotes: por eso es una
--                   tabla aparte y no tres columnas.
--
--   PERSONAL        la mano de obra de esa ejecución.
--   LOGÍSTICA       la bolsa absorbente de la zona: el acarreo que no es
--                   de nadie en particular y se reparte entre todos.
--
-- TRES DECISIONES QUE NO SON OBVIAS
--
--   · `fecha_siembra_congelada` guarda la fecha de siembra TAL COMO
--     ESTABA cuando se hizo el plan, y no apunta a la siembra. Si la
--     siembra se mueve, el plan de desinfección no debe moverse solo:
--     ya se compró el producto y ya se cuadró la cuadrilla. Que las dos
--     fechas se separen es información, no un error que corregir.
--
--   · Los totales del plan son COLUMNAS GENERADAS. Un total que se
--     calcula en el navegador acaba distinto del que se calcula en el
--     reporte, y nadie sabe cuál es el bueno.
--
--   · La bolsa de logística NO se reparte al guardarla. Se reparte al
--     LEERLA, en la vista de costos, por manzanas de la zona. Si se
--     repartiera al guardar, agregar un lote a la zona obligaría a
--     recalcular hacia atrás todo lo ya repartido.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · LA PANTALLA EN LA MATRIZ
-- =====================================================================
-- Primero la casilla: sin ella, el RLS de más abajo exigiría un permiso
-- que nadie puede conceder y el módulo nacería cerrado para todos. Es lo
-- que el guardián de la 44 llama «una llave sin casilla».

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('desinfeccion', 'Desinfección de suelo',
     'Plan y ejecución de la desinfección: preriego, lecturas, aplicación y sus costos.',
     '/controles/desinfeccion', 57,
     array['ver','crear','editar','eliminar','exportar','importar'])
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta = excluded.ruta,
    acciones = excluded.acciones;

-- =====================================================================
-- B · CATÁLOGO DE TASAS DE CAMBIO
-- =====================================================================
-- Va en el bloque de Organización, con las temporadas y los proveedores:
-- es un dato de la empresa, no de campo.
--
-- El nombre de la columna es `tasa_hnl_usd` y no `tasa_hdl_usd`: el
-- código ISO del lempira es HNL. Una columna bautizada con una moneda
-- que no existe se arrastra para siempre, y se corrige una sola vez.

create table if not exists public.catalogo_tasas_cambio (
    id            uuid primary key default gen_random_uuid(),
    fecha_inicio  date not null,
    -- Abierta por arriba: la tasa vigente es la que no tiene fin, igual
    -- que en `tarifas_equipo`. Cerrarla es lo que abre la siguiente.
    fecha_fin     date,
    tasa_hnl_usd  numeric(12,4) not null check (tasa_hnl_usd > 0),
    created_at    timestamptz not null default now(),

    constraint tasas_cambio_rango check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

comment on table public.catalogo_tasas_cambio is
    'La tasa lempira/dólar por periodo. Versionada para no distorsionar un costo histórico cuando la tasa cambia.';

-- Dos tasas abiertas a la vez es una ambigüedad que nadie resuelve
-- después: cuál de las dos rige.
create unique index if not exists tasas_cambio_abierta_uidx
    on public.catalogo_tasas_cambio (fecha_inicio)
    where fecha_fin is null;

create index if not exists tasas_cambio_rango_idx
    on public.catalogo_tasas_cambio (fecha_inicio desc);

/** La tasa que regía en una fecha. Nula si no hay ninguna que la cubra. */
create or replace function public.fn_tasa_cambio(p_fecha date)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select t.tasa_hnl_usd
    from public.catalogo_tasas_cambio t
    where t.fecha_inicio <= p_fecha
      and (t.fecha_fin is null or t.fecha_fin >= p_fecha)
    order by t.fecha_inicio desc
    limit 1
$$;

grant execute on function public.fn_tasa_cambio(date) to authenticated;

-- =====================================================================
-- C · LA TARIFA DEL PERSONAL
-- =====================================================================
-- El encargo dice «puesto_id (FK tarifas)». Esa tarifa YA EXISTE: es
-- `tarifas_puesto`, de la migración 11, con su vigencia y su temporada.
-- No se crea otra — dos tablas de salarios es garantizar que dentro de
-- un año digan cosas distintas y nadie sepa cuál rige.
--
-- Lo único que hay que traducir es la unidad: allí el costo es POR HORA
-- y el encargo razona en JORNADAS. La jornada son ocho horas, que es la
-- misma base sobre la que él calcula la hora extra, así que la
-- conversión es una multiplicación y queda en un solo sitio.

/** El costo de la HORA de un puesto en una fecha. */
create or replace function public.fn_costo_hora_puesto(p_puesto_id uuid, p_fecha date)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select t.costo_hora
    from public.tarifas_puesto t
    where t.puesto_trabajo_id = p_puesto_id
      and t.vigente_desde <= p_fecha
      and (t.vigente_hasta is null or t.vigente_hasta >= p_fecha)
    order by t.vigente_desde desc
    limit 1
$$;

/** Y el de la JORNADA: ocho horas, la misma base de la hora extra. */
create or replace function public.fn_tarifa_puesto(p_puesto_id uuid, p_fecha date)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(public.fn_costo_hora_puesto(p_puesto_id, p_fecha), 0) * 8
$$;

grant execute on function public.fn_costo_hora_puesto(uuid, date) to authenticated;
grant execute on function public.fn_tarifa_puesto(uuid, date)     to authenticated;

-- =====================================================================
-- D · EL PLAN
-- =====================================================================

create table if not exists public.desinfeccion_plan (
    id                       uuid primary key default gen_random_uuid(),
    temporada_id             uuid not null references public.temporadas(id) on delete cascade,
    lote_temporada_id        uuid not null references public.lotes_temporada(id) on delete cascade,
    ciclo                    smallint not null default 1 check (ciclo > 0),

    -- La fecha de siembra COPIADA, no referenciada. Si la siembra se
    -- mueve, el plan no se mueve solo: ya se compró el producto.
    fecha_siembra_congelada  date not null,
    dias_aplicacion          integer not null default 0,
    -- Generada: `date + integer` es inmutable, así que Postgres la
    -- admite y nadie puede dejarla desalineada de sus dos fuentes.
    fecha_aplicacion         date generated always as
                                 (fecha_siembra_congelada + dias_aplicacion) stored,

    variedad_id              uuid references public.variedades(id),
    -- El producto de desinfección es un INSUMO, así que sale de
    -- `materiales` y no de `catalogo_productos`, que son los cultivos.
    producto_id              uuid references public.materiales(id),

    dosis_mz                 numeric(12,4) not null default 0 check (dosis_mz >= 0),
    area_planificada_mz      numeric(12,4) not null default 0 check (area_planificada_mz >= 0),
    costo_litro              numeric(12,4) not null default 0 check (costo_litro >= 0),

    -- Los tres totales, calculados por la base. Un total que se calcula
    -- en el navegador acaba distinto del del reporte.
    total_litros             numeric(14,4) generated always as (dosis_mz * area_planificada_mz) stored,
    total_costo              numeric(14,4) generated always as
                                 (dosis_mz * area_planificada_mz * costo_litro) stored,
    costo_mz                 numeric(14,4) generated always as
                                 (case when area_planificada_mz > 0
                                       then dosis_mz * area_planificada_mz * costo_litro
                                            / area_planificada_mz
                                       else 0 end) stored,

    usuario_id               uuid not null default auth.uid() references public.perfiles(id),
    comentarios              text,
    created_at               timestamptz not null default now(),

    -- Un lote no se planifica dos veces en el mismo ciclo: si hace falta
    -- cambiarlo, se edita la fila.
    unique (lote_temporada_id, ciclo)
);

comment on column public.desinfeccion_plan.fecha_siembra_congelada is
    'La fecha de siembra tal como estaba al planificar. Copiada a propósito: si la siembra se mueve, el plan no se mueve solo.';

create index if not exists desinfeccion_plan_temporada_idx
    on public.desinfeccion_plan (temporada_id, fecha_aplicacion desc);
create index if not exists desinfeccion_plan_lote_idx
    on public.desinfeccion_plan (lote_temporada_id);
create index if not exists desinfeccion_plan_usuario_idx
    on public.desinfeccion_plan (usuario_id);

-- =====================================================================
-- E · LA EJECUCIÓN, EN TRES FASES
-- =====================================================================

do $$
begin
    if not exists (select 1 from pg_type where typname = 'estado_desinfeccion') then
        create type public.estado_desinfeccion as enum
            ('1_Preriego', '2_Lecturas', '3_Aplicacion');
    end if;
end $$;

create table if not exists public.desinfeccion_ejecucion (
    id            uuid primary key default gen_random_uuid(),
    temporada_id  uuid not null references public.temporadas(id) on delete cascade,
    turno_id      uuid not null references public.turnos(id),
    estado        public.estado_desinfeccion not null default '1_Preriego',

    /* ---------------------- Fase 1 · Preriego ---------------------- */
    fecha_preriego       date,
    hora_inicio_preriego time,
    hora_fin_preriego    time,
    obs_preriego         text,

    /* ---------------------- Fase 2 · Lecturas ---------------------- */
    -- JSONB y no una tabla: hoy son lecturas de tensiómetro y mañana
    -- serán otras. Mientras el frontend sea el único que las lee, el
    -- esquema libre ahorra una migración por cada aparato nuevo. El día
    -- que haya que agregarlas o graficarlas, se normaliza.
    lecturas_tensiometro jsonb not null default '[]'::jsonb,

    /* --------------------- Fase 3 · Aplicación --------------------- */
    fecha_aplicacion     date,
    estacion_riego_id    uuid references public.estaciones_riego(id),
    horas_presurizacion  numeric(10,2) default 0 check (horas_presurizacion >= 0),
    hora_inicio_iny      time,
    hora_fin_iny         time,
    horas_lavado         numeric(10,2) default 0 check (horas_lavado >= 0),
    total_horas_riego    numeric(10,2) default 0 check (total_horas_riego >= 0),

    -- Las partes por millón llegan a mano por ahora: la fórmula depende
    -- del caudal de la estación, que todavía no se captura. Queda como
    -- columna normal, sin trigger, a propósito.
    ppm                  numeric(12,4),

    ce_antes             numeric(10,4),
    ce_durante           numeric(10,4),
    ce_despues           numeric(10,4),
    calibracion_entrada  numeric(10,4),
    calibracion_salida   numeric(10,4),
    calibracion_campo    numeric(10,4),

    producto_id          uuid references public.materiales(id),
    litros_acido         numeric(12,4) default 0 check (litros_acido >= 0),
    costo_litro_acido    numeric(12,4) default 0 check (costo_litro_acido >= 0),
    costo_acido          numeric(14,4) generated always as
                             (coalesce(litros_acido, 0) * coalesce(costo_litro_acido, 0)) stored,

    usuario_id           uuid not null default auth.uid() references public.perfiles(id),
    created_at           timestamptz not null default now(),

    constraint desinfeccion_horas_preriego
        check (hora_fin_preriego is null or hora_inicio_preriego is null
               or hora_fin_preriego >= hora_inicio_preriego)
);

comment on column public.desinfeccion_ejecucion.lecturas_tensiometro is
    'Lecturas de la fase 2, en JSON libre. Se normaliza el día que haya que sumarlas o graficarlas.';
comment on column public.desinfeccion_ejecucion.ppm is
    'A mano por ahora: la fórmula depende del caudal de la estación, que todavía no se captura.';

create index if not exists desinfeccion_ejec_temporada_idx
    on public.desinfeccion_ejecucion (temporada_id, fecha_aplicacion desc);
create index if not exists desinfeccion_ejec_turno_idx
    on public.desinfeccion_ejecucion (turno_id);
create index if not exists desinfeccion_ejec_usuario_idx
    on public.desinfeccion_ejecucion (usuario_id);

-- --------------------- Los lotes que tocó el turno -------------------
-- Un turno riega varios lotes, y cada uno con sus manzanas. Por eso es
-- una tabla y no tres columnas: con columnas, el cuarto lote no cabe.

create table if not exists public.desinfeccion_ejecucion_lotes (
    id                uuid primary key default gen_random_uuid(),
    ejecucion_id      uuid not null references public.desinfeccion_ejecucion(id) on delete cascade,
    lote_temporada_id uuid not null references public.lotes_temporada(id) on delete cascade,
    mz_cubiertas      numeric(12,4) not null default 0 check (mz_cubiertas >= 0),
    created_at        timestamptz not null default now(),

    unique (ejecucion_id, lote_temporada_id)
);

create index if not exists desinfeccion_ejec_lotes_idx
    on public.desinfeccion_ejecucion_lotes (ejecucion_id);
create index if not exists desinfeccion_ejec_lotes_lote_idx
    on public.desinfeccion_ejecucion_lotes (lote_temporada_id);

-- =====================================================================
-- F · PERSONAL, Y SU CÁLCULO
-- =====================================================================

do $$
begin
    if not exists (select 1 from pg_type where typname = 'jornada_desinfeccion') then
        create type public.jornada_desinfeccion as enum ('Diurna', 'Nocturna');
    end if;
end $$;

create table if not exists public.desinfeccion_personal (
    id                uuid primary key default gen_random_uuid(),
    ejecucion_id      uuid not null references public.desinfeccion_ejecucion(id) on delete cascade,
    puesto_id         uuid not null references public.puestos_trabajo(id),
    -- Opcional: una cuadrilla de seis se anota por puesto, sin nombres.
    operador_id       uuid references public.operadores(id),
    cantidad_personas integer not null default 1 check (cantidad_personas > 0),
    jornadas          numeric(10,2) not null default 0 check (jornadas >= 0),
    horas_extras      numeric(10,2) not null default 0 check (horas_extras >= 0),
    jornada_tipo      public.jornada_desinfeccion not null default 'Diurna',

    -- Lo pone el trigger. No es columna generada porque depende de la
    -- TARIFA VIGENTE, que vive en otra tabla y cambia con el tiempo: una
    -- columna generada sólo puede mirar su propia fila.
    costo_total       numeric(14,4) not null default 0,
    tarifa_dia        numeric(12,4),

    created_at        timestamptz not null default now()
);

comment on column public.desinfeccion_personal.tarifa_dia is
    'La tarifa con la que se calculó, copiada. Sin ella, cambiar la tarifa haría irreproducible un costo ya cerrado.';

create index if not exists desinfeccion_personal_idx
    on public.desinfeccion_personal (ejecucion_id);

/**
 * El costo de la mano de obra de una línea.
 *
 *     costo = personas × ( tarifa_día × jornadas
 *                        + horas_extras × (tarifa_día / 8) × factor )
 *
 * El factor es 1.25 de día y 1.75 de noche, y la hora extra se calcula
 * sobre base ocho horas. Va en la base y no en el navegador porque el
 * mismo número lo tiene que dar el reporte, la exportación a Excel y la
 * pantalla; tres implementaciones de la misma fórmula son tres números.
 *
 * La tarifa se COPIA a la fila. Si mañana sube el salario, lo ya
 * capturado no puede cambiar de costo solo.
 */
create or replace function public.fn_desinfeccion_costo_personal()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_fecha  date;
    v_tarifa numeric;
    v_factor numeric;
begin
    -- La fecha de la ejecución manda sobre la tarifa: una jornada de
    -- marzo se paga con la tarifa de marzo aunque se capture en mayo.
    select coalesce(e.fecha_aplicacion, e.fecha_preriego, current_date)
      into v_fecha
      from public.desinfeccion_ejecucion e
     where e.id = new.ejecucion_id;

    v_tarifa := coalesce(new.tarifa_dia, public.fn_tarifa_puesto(new.puesto_id, v_fecha), 0);
    v_factor := case new.jornada_tipo when 'Nocturna' then 1.75 else 1.25 end;

    new.tarifa_dia := v_tarifa;
    new.costo_total := new.cantidad_personas
        * (v_tarifa * new.jornadas + new.horas_extras * (v_tarifa / 8) * v_factor);

    return new;
end;
$$;

drop trigger if exists trg_desinfeccion_costo_personal on public.desinfeccion_personal;
create trigger trg_desinfeccion_costo_personal
    before insert or update of puesto_id, cantidad_personas, jornadas, horas_extras,
                               jornada_tipo, tarifa_dia
    on public.desinfeccion_personal
    for each row execute function public.fn_desinfeccion_costo_personal();

-- =====================================================================
-- G · LOGÍSTICA ZONAL — LA BOLSA ABSORBENTE
-- =====================================================================
-- El acarreo de la zona no es de ningún lote en particular. Se captura
-- por zona y se reparte al LEER, no al guardar: repartirlo al guardar
-- obligaría a recalcular hacia atrás cada vez que se agrega un lote.

create table if not exists public.desinfeccion_logistica (
    id             uuid primary key default gen_random_uuid(),
    temporada_id   uuid not null references public.temporadas(id) on delete cascade,
    zona_id        uuid not null references public.zonas(id),
    fecha          date not null,
    equipo_id      uuid not null references public.equipos(id),
    implemento_id  uuid references public.implementos(id),
    operador_id    uuid references public.operadores(id),
    horas_trabajo  numeric(10,2) not null default 0 check (horas_trabajo >= 0),

    costo_total    numeric(14,4) not null default 0,
    costo_hora     numeric(12,4),

    usuario_id     uuid not null default auth.uid() references public.perfiles(id),
    comentarios    text,
    created_at     timestamptz not null default now()
);

comment on table public.desinfeccion_logistica is
    'La bolsa de acarreo de la zona. Se reparte entre los lotes al leer la vista de costos, por manzanas.';

create index if not exists desinfeccion_logistica_idx
    on public.desinfeccion_logistica (temporada_id, zona_id, fecha desc);
create index if not exists desinfeccion_logistica_usuario_idx
    on public.desinfeccion_logistica (usuario_id);

/**
 * El costo de una línea de logística.
 *
 * Sale de `tarifas_equipo`, que es la tarifa por hora del equipo en esa
 * fecha, por las horas trabajadas. El implemento no entra: no tiene
 * tabla de tarifas, y cobrar por él un número inventado es peor que no
 * cobrarlo. Cuando la tenga, se suma aquí.
 */
create or replace function public.fn_desinfeccion_costo_logistica()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_hora numeric;
begin
    select t.costo_hora into v_hora
      from public.tarifas_equipo t
     where t.equipo_id = new.equipo_id
       and t.vigente_desde <= new.fecha
       and (t.vigente_hasta is null or t.vigente_hasta >= new.fecha)
     order by t.vigente_desde desc
     limit 1;

    new.costo_hora := coalesce(new.costo_hora, v_hora, 0);
    new.costo_total := new.horas_trabajo * new.costo_hora;
    return new;
end;
$$;

drop trigger if exists trg_desinfeccion_costo_logistica on public.desinfeccion_logistica;
create trigger trg_desinfeccion_costo_logistica
    before insert or update of equipo_id, fecha, horas_trabajo, costo_hora
    on public.desinfeccion_logistica
    for each row execute function public.fn_desinfeccion_costo_logistica();

-- =====================================================================
-- H · RLS
-- =====================================================================
-- La forma canónica de la 55: la parte de pantalla como InitPlan, la de
-- fila como predicados, y la zona sólo cuando el alcance es zonal.

do $$
declare
    t text;
begin
    foreach t in array array['desinfeccion_plan', 'desinfeccion_ejecucion',
                             'desinfeccion_ejecucion_lotes', 'desinfeccion_personal',
                             'desinfeccion_logistica', 'catalogo_tasas_cambio']
    loop
        execute format('alter table public.%I enable row level security', t);
    end loop;
end $$;

/* ------------------------------- Plan ------------------------------ */

drop policy if exists desinfeccion_plan_select on public.desinfeccion_plan;
create policy desinfeccion_plan_select on public.desinfeccion_plan for select
    using (
        (select public.fn_permitido_de('desinfeccion', 'ver'))
        and case (select public.fn_mi_alcance('desinfeccion', 'ver'))
            when 'global'      then true
            when 'propietario' then usuario_id = (select auth.uid())
            else usuario_id = (select auth.uid())
                 or not (select public.fn_tiene_zonas())
                 or desinfeccion_plan.lote_temporada_id in (select public.fn_mis_lotes())
        end
    );

drop policy if exists desinfeccion_plan_insert on public.desinfeccion_plan;
create policy desinfeccion_plan_insert on public.desinfeccion_plan for insert
    with check ((select public.fn_verificar_permiso('desinfeccion', 'crear')));

drop policy if exists desinfeccion_plan_update on public.desinfeccion_plan;
create policy desinfeccion_plan_update on public.desinfeccion_plan for update
    using ((select public.fn_verificar_permiso('desinfeccion', 'editar',
                                               desinfeccion_plan.usuario_id)));

drop policy if exists desinfeccion_plan_delete on public.desinfeccion_plan;
create policy desinfeccion_plan_delete on public.desinfeccion_plan for delete
    using ((select public.fn_verificar_permiso('desinfeccion', 'eliminar',
                                               desinfeccion_plan.usuario_id)));

/* ----------------------------- Ejecución --------------------------- */

drop policy if exists desinfeccion_ejec_select on public.desinfeccion_ejecucion;
create policy desinfeccion_ejec_select on public.desinfeccion_ejecucion for select
    using (
        (select public.fn_permitido_de('desinfeccion', 'ver'))
        and case (select public.fn_mi_alcance('desinfeccion', 'ver'))
            when 'global'      then true
            when 'propietario' then usuario_id = (select auth.uid())
            else usuario_id = (select auth.uid())
                 or not (select public.fn_tiene_zonas())
                 or exists (select 1 from public.turnos tn
                             where tn.id = desinfeccion_ejecucion.turno_id
                               and (select public.fn_ve_zona(tn.zona_id)))
        end
    );

drop policy if exists desinfeccion_ejec_insert on public.desinfeccion_ejecucion;
create policy desinfeccion_ejec_insert on public.desinfeccion_ejecucion for insert
    with check ((select public.fn_verificar_permiso('desinfeccion', 'crear')));

drop policy if exists desinfeccion_ejec_update on public.desinfeccion_ejecucion;
create policy desinfeccion_ejec_update on public.desinfeccion_ejecucion for update
    using ((select public.fn_verificar_permiso('desinfeccion', 'editar',
                                               desinfeccion_ejecucion.usuario_id)));

drop policy if exists desinfeccion_ejec_delete on public.desinfeccion_ejecucion;
create policy desinfeccion_ejec_delete on public.desinfeccion_ejecucion for delete
    using ((select public.fn_verificar_permiso('desinfeccion', 'eliminar',
                                               desinfeccion_ejecucion.usuario_id)));

/* --------------- Lo que cuelga de una ejecución -------------------- */
-- Las tres hijas heredan: se puede tocar la línea si se puede tocar su
-- ejecución. Escribir la regla otra vez en cada una es garantizar que
-- dentro de un año digan tres cosas distintas.

create or replace function public.fn_ve_desinfeccion(p_ejecucion_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (select 1 from public.desinfeccion_ejecucion e where e.id = p_ejecucion_id)
$$;

/** El dueño de una ejecución, sin volver a pasar por su RLS. */
create or replace function public.fn_dueno_desinfeccion(p_ejecucion_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select e.usuario_id from public.desinfeccion_ejecucion e where e.id = p_ejecucion_id
$$;

grant execute on function public.fn_ve_desinfeccion(uuid)    to authenticated;
grant execute on function public.fn_dueno_desinfeccion(uuid) to authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['desinfeccion_ejecucion_lotes', 'desinfeccion_personal']
    loop
        execute format('drop policy if exists %I on public.%I', t || '_select', t);
        execute format($p$
            create policy %I on public.%I for select
            using (
                (select public.fn_permitido_de('desinfeccion', 'ver'))
                and (select public.fn_verificar_permiso('desinfeccion', 'ver',
                        (select public.fn_dueno_desinfeccion(%I.ejecucion_id))))
            )
        $p$, t || '_select', t, t);

        execute format('drop policy if exists %I on public.%I', t || '_write', t);
        execute format($p$
            create policy %I on public.%I for all
            using ((select public.fn_verificar_permiso('desinfeccion', 'editar',
                        (select public.fn_dueno_desinfeccion(%I.ejecucion_id)))))
            with check ((select public.fn_verificar_permiso('desinfeccion', 'crear')))
        $p$, t || '_write', t, t);
    end loop;
end $$;

/* ----------------------------- Logística --------------------------- */

drop policy if exists desinfeccion_logistica_select on public.desinfeccion_logistica;
create policy desinfeccion_logistica_select on public.desinfeccion_logistica for select
    using (
        (select public.fn_permitido_de('desinfeccion', 'ver'))
        and case (select public.fn_mi_alcance('desinfeccion', 'ver'))
            when 'global'      then true
            when 'propietario' then usuario_id = (select auth.uid())
            else usuario_id = (select auth.uid())
                 or not (select public.fn_tiene_zonas())
                 or desinfeccion_logistica.zona_id in (select public.fn_mis_zonas())
        end
    );

drop policy if exists desinfeccion_logistica_insert on public.desinfeccion_logistica;
create policy desinfeccion_logistica_insert on public.desinfeccion_logistica for insert
    with check ((select public.fn_verificar_permiso('desinfeccion', 'crear')));

drop policy if exists desinfeccion_logistica_update on public.desinfeccion_logistica;
create policy desinfeccion_logistica_update on public.desinfeccion_logistica for update
    using ((select public.fn_verificar_permiso('desinfeccion', 'editar',
                                               desinfeccion_logistica.usuario_id)));

drop policy if exists desinfeccion_logistica_delete on public.desinfeccion_logistica;
create policy desinfeccion_logistica_delete on public.desinfeccion_logistica for delete
    using ((select public.fn_verificar_permiso('desinfeccion', 'eliminar',
                                               desinfeccion_logistica.usuario_id)));

/* --------------------------- El catálogo --------------------------- */
-- La tasa de cambio va con el bloque de Organización de la 58. Leerla es
-- abierto: un costo sin su tasa no se puede interpretar, y esconderla
-- sólo consigue que el reporte salga en blanco.

drop policy if exists tasas_cambio_select on public.catalogo_tasas_cambio;
create policy tasas_cambio_select on public.catalogo_tasas_cambio for select
    using ((select auth.uid()) is not null);

drop policy if exists tasas_cambio_write on public.catalogo_tasas_cambio;
create policy tasas_cambio_write on public.catalogo_tasas_cambio for all
    using ((select public.fn_tiene_permiso('catalogo_organizacion', 'editar')))
    with check ((select public.fn_tiene_permiso('catalogo_organizacion', 'crear'))
             or (select public.fn_tiene_permiso('catalogo_organizacion', 'editar')));

-- =====================================================================
-- I · LAS VISTAS, CON SU REJA
-- =====================================================================
-- Patrón de la 56/57: la cruda en `interno` con `security_invoker = off`
-- —así resuelve los nombres de los catálogos aunque quien pregunta no
-- tenga permiso sobre ellos— y la expuesta en `public` con la reja de SU
-- pantalla. Nadie entra a `interno`.

create schema if not exists interno;

/* ----------------------------- El plan ----------------------------- */

create or replace view interno.v_desinfeccion_plan_crudo as
select
    p.id,
    p.temporada_id,
    tm.nombre                as temporada_nombre,
    p.lote_temporada_id,
    lo.nomenclatura          as lote_nomenclatura,
    lo.nombre                as lote_nombre,
    lt.zona_id,
    z.nombre                 as zona_nombre,
    p.ciclo,
    p.fecha_siembra_congelada,
    p.dias_aplicacion,
    p.fecha_aplicacion,
    p.variedad_id,
    v.nombre                 as variedad_nombre,
    p.producto_id,
    m.descripcion            as producto_nombre,
    m.codigo                 as producto_codigo,
    p.dosis_mz,
    p.area_planificada_mz,
    p.costo_litro,
    p.total_litros,
    p.total_costo,
    p.costo_mz,
    p.comentarios,
    p.usuario_id,
    pe.nombre                as usuario_nombre,
    p.created_at
from public.desinfeccion_plan p
join public.lotes_temporada lt on lt.id = p.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.temporadas tm      on tm.id = p.temporada_id
left join public.variedades v  on v.id = p.variedad_id
left join public.materiales m  on m.id = p.producto_id
left join public.perfiles pe   on pe.id = p.usuario_id;

/* -------------------------- La ejecución --------------------------- */

create or replace view interno.v_desinfeccion_ejecucion_crudo as
select
    e.id,
    e.temporada_id,
    tm.nombre               as temporada_nombre,
    e.turno_id,
    tn.nombre               as turno_nombre,
    tn.codigo               as turno_codigo,
    tn.zona_id,
    z.nombre                as zona_nombre,
    e.estado,
    e.fecha_preriego,
    e.hora_inicio_preriego,
    e.hora_fin_preriego,
    e.obs_preriego,
    e.lecturas_tensiometro,
    e.fecha_aplicacion,
    e.estacion_riego_id,
    er.nombre               as estacion_riego_nombre,
    e.horas_presurizacion,
    e.hora_inicio_iny,
    e.hora_fin_iny,
    e.horas_lavado,
    e.total_horas_riego,
    e.ppm,
    e.ce_antes,
    e.ce_durante,
    e.ce_despues,
    e.calibracion_entrada,
    e.calibracion_salida,
    e.calibracion_campo,
    e.producto_id,
    m.descripcion           as producto_nombre,
    e.litros_acido,
    e.costo_litro_acido,
    e.costo_acido,
    -- Lo que cuelga, resumido: la pantalla lo necesita en la lista y
    -- bajarlo aparte serían dos consultas por fila.
    coalesce(l.mz_regadas, 0)        as mz_regadas,
    coalesce(l.lotes_regados, 0)     as lotes_regados,
    coalesce(pr.costo_personal, 0)   as costo_personal,
    e.usuario_id,
    pf.nombre               as usuario_nombre,
    e.created_at
from public.desinfeccion_ejecucion e
join public.temporadas tm            on tm.id = e.temporada_id
join public.turnos tn                on tn.id = e.turno_id
left join public.zonas z             on z.id = tn.zona_id
left join public.estaciones_riego er on er.id = e.estacion_riego_id
left join public.materiales m        on m.id = e.producto_id
left join public.perfiles pf         on pf.id = e.usuario_id
left join lateral (
    select sum(x.mz_cubiertas) as mz_regadas, count(*) as lotes_regados
    from public.desinfeccion_ejecucion_lotes x
    where x.ejecucion_id = e.id
) l on true
left join lateral (
    select sum(x.costo_total) as costo_personal
    from public.desinfeccion_personal x
    where x.ejecucion_id = e.id
) pr on true;

/* ------------------------ Los lotes regados ------------------------ */

create or replace view interno.v_desinfeccion_lotes_crudo as
select
    dl.id,
    dl.ejecucion_id,
    e.temporada_id,
    e.fecha_aplicacion,
    e.turno_id,
    tn.nombre        as turno_nombre,
    dl.lote_temporada_id,
    lo.nomenclatura  as lote_nomenclatura,
    lo.nombre        as lote_nombre,
    lt.zona_id,
    z.nombre         as zona_nombre,
    dl.mz_cubiertas,
    e.usuario_id,
    dl.created_at
from public.desinfeccion_ejecucion_lotes dl
join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
join public.lotes_temporada lt       on lt.id = dl.lote_temporada_id
join public.lotes lo                 on lo.id = lt.lote_id
left join public.zonas z             on z.id = lt.zona_id;

/* ---------------------------- Personal ----------------------------- */

create or replace view interno.v_desinfeccion_personal_crudo as
select
    dp.id,
    dp.ejecucion_id,
    e.temporada_id,
    e.fecha_aplicacion,
    e.turno_id,
    tn.nombre        as turno_nombre,
    dp.puesto_id,
    pt.codigo        as puesto_codigo,
    pt.descripcion   as puesto_nombre,
    dp.operador_id,
    op.nombre        as operador_nombre,
    dp.cantidad_personas,
    dp.jornadas,
    dp.horas_extras,
    dp.jornada_tipo,
    dp.tarifa_dia,
    dp.costo_total,
    e.usuario_id,
    dp.created_at
from public.desinfeccion_personal dp
join public.desinfeccion_ejecucion e on e.id = dp.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
join public.puestos_trabajo pt       on pt.id = dp.puesto_id
left join public.operadores op       on op.id = dp.operador_id;

/* ---------------------------- Logística ---------------------------- */

create or replace view interno.v_desinfeccion_logistica_crudo as
select
    dg.id,
    dg.temporada_id,
    tm.nombre       as temporada_nombre,
    dg.zona_id,
    z.nombre        as zona_nombre,
    dg.fecha,
    dg.equipo_id,
    eq.codigo       as equipo_codigo,
    eq.nombre       as equipo_nombre,
    dg.implemento_id,
    im.nombre       as implemento_nombre,
    dg.operador_id,
    op.nombre       as operador_nombre,
    dg.horas_trabajo,
    dg.costo_hora,
    dg.costo_total,
    dg.comentarios,
    dg.usuario_id,
    pe.nombre       as usuario_nombre,
    dg.created_at
from public.desinfeccion_logistica dg
join public.temporadas tm       on tm.id = dg.temporada_id
join public.zonas z             on z.id = dg.zona_id
join public.equipos eq          on eq.id = dg.equipo_id
left join public.implementos im on im.id = dg.implemento_id
left join public.operadores op  on op.id = dg.operador_id
left join public.perfiles pe    on pe.id = dg.usuario_id;

/* ====================== LA VISTA ANALÍTICA ========================= */
/**
 * El costo por lote: químico + personal + su parte de la bolsa zonal.
 *
 * Las tres piezas no se suman igual, y ahí está todo el asunto:
 *
 *   · El QUÍMICO del turno se reparte entre los lotes que ese turno
 *     regó, por manzanas. Un turno que regó tres lotes no carga el ácido
 *     entero a ninguno.
 *
 *   · El PERSONAL de la ejecución, igual: la cuadrilla trabajó el turno
 *     completo, no un lote.
 *
 *   · La BOLSA DE LOGÍSTICA de la zona se reparte entre TODAS las
 *     manzanas regadas de esa zona en la temporada. Y se reparte AQUÍ,
 *     al leer: si se repartiera al guardar, agregar un lote obligaría a
 *     recalcular hacia atrás todo lo ya repartido.
 *
 * Las divisiones van con `nullif` por el mismo motivo en los tres casos:
 * una zona sin manzanas regadas todavía no es un error, es una zona que
 * aún no ha empezado — y dividir entre cero tumbaría el reporte entero.
 */
create or replace view interno.v_desinfeccion_costos_crudo as
with regado as (
    select
        dl.lote_temporada_id,
        dl.ejecucion_id,
        e.temporada_id,
        lt.zona_id,
        dl.mz_cubiertas
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.lotes_temporada lt       on lt.id = dl.lote_temporada_id
),
-- Cuántas manzanas llevó cada ejecución: el divisor del reparto interno.
por_ejecucion as (
    select ejecucion_id, sum(mz_cubiertas) as mz_total
    from regado group by ejecucion_id
),
-- Y cuántas lleva cada zona en la temporada: el divisor de la bolsa.
por_zona as (
    select temporada_id, zona_id, sum(mz_cubiertas) as mz_zona
    from regado group by temporada_id, zona_id
),
bolsa as (
    select temporada_id, zona_id, sum(costo_total) as bolsa_zona
    from public.desinfeccion_logistica
    group by temporada_id, zona_id
),
personal as (
    select ejecucion_id, sum(costo_total) as costo_personal
    from public.desinfeccion_personal group by ejecucion_id
)
select
    r.lote_temporada_id,
    lo.nomenclatura                                   as lote_nomenclatura,
    lo.nombre                                         as lote_nombre,
    r.temporada_id,
    tm.nombre                                         as temporada_nombre,
    r.zona_id,
    z.nombre                                          as zona_nombre,

    sum(r.mz_cubiertas)                               as mz_regadas,

    -- Químico: el ácido de cada ejecución, por la parte del lote.
    sum(coalesce(e.costo_acido, 0)
        * r.mz_cubiertas / nullif(pe_.mz_total, 0))   as costo_quimico,

    -- Personal: igual, a prorrata de manzanas dentro de la ejecución.
    sum(coalesce(pr.costo_personal, 0)
        * r.mz_cubiertas / nullif(pe_.mz_total, 0))   as costo_personal,

    -- Bolsa: la de la zona entre las manzanas de la zona, por las del
    -- lote. `max` y no `sum` porque la bolsa es una por zona y el join
    -- la repite en cada fila de regado.
    max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0))
        * sum(r.mz_cubiertas)                         as costo_logistica,

    sum(coalesce(e.costo_acido, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas)
                                                      as costo_total,

    (sum(coalesce(e.costo_acido, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas))
      / nullif(sum(r.mz_cubiertas), 0)                as costo_mz
from regado r
join public.desinfeccion_ejecucion e on e.id = r.ejecucion_id
join public.lotes_temporada lt       on lt.id = r.lote_temporada_id
join public.lotes lo                 on lo.id = lt.lote_id
join public.temporadas tm            on tm.id = r.temporada_id
left join public.zonas z             on z.id = r.zona_id
left join por_ejecucion pe_          on pe_.ejecucion_id = r.ejecucion_id
left join por_zona pz                on pz.temporada_id = r.temporada_id
                                    and pz.zona_id is not distinct from r.zona_id
left join bolsa b                    on b.temporada_id = r.temporada_id
                                    and b.zona_id is not distinct from r.zona_id
left join personal pr                on pr.ejecucion_id = r.ejecucion_id
group by r.lote_temporada_id, lo.nomenclatura, lo.nombre,
         r.temporada_id, tm.nombre, r.zona_id, z.nombre;

-- --------------------- Las expuestas, con su reja -------------------

do $$
declare
    v record;
    v_dueno text;
    v_zona  text;
begin
    for v in
        select * from (values
            ('v_desinfeccion_plan',       'usuario_id', 'lote_temporada_id'),
            ('v_desinfeccion_ejecucion',  'usuario_id', null),
            ('v_desinfeccion_lotes',      'usuario_id', 'lote_temporada_id'),
            ('v_desinfeccion_personal',   'usuario_id', null),
            ('v_desinfeccion_logistica',  'usuario_id', 'zona_id'),
            ('v_desinfeccion_costos',     null,         'zona_id')
        ) as t(vista, col_dueno, col_zona)
    loop
        execute format('alter view interno.%I set (security_invoker = off)', v.vista || '_crudo');

        v_dueno := case when v.col_dueno is not null
                        then format('x.%I = (select auth.uid())', v.col_dueno)
                        else 'true' end;

        v_zona := case
            when v.col_zona = 'zona_id' then
                format('%s or not (select public.fn_tiene_zonas()) '
                    || 'or x.zona_id in (select public.fn_mis_zonas())', v_dueno)
            when v.col_zona is not null then
                format('%s or not (select public.fn_tiene_zonas()) '
                    || 'or x.%I in (select public.fn_mis_lotes())', v_dueno, v.col_zona)
            else 'true'
        end;

        execute format('drop view if exists public.%I', v.vista);
        execute format($sql$
            create view public.%I as
            select x.* from interno.%I x
            where (select public.fn_permitido_de('desinfeccion', 'ver'))
              and case (select public.fn_mi_alcance('desinfeccion', 'ver'))
                  when 'global'      then true
                  when 'propietario' then %s
                  else %s
              end
        $sql$, v.vista, v.vista || '_crudo', v_dueno, v_zona);

        execute format('grant select on public.%I to authenticated', v.vista);
    end loop;
end $$;

-- =====================================================================
-- J · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_falta text;
begin
    -- 1 · Las seis vistas del módulo existen, con su cruda en `interno`.
    select string_agg(v, ', ') into v_falta
    from unnest(array['v_desinfeccion_plan','v_desinfeccion_ejecucion','v_desinfeccion_lotes',
                      'v_desinfeccion_personal','v_desinfeccion_logistica',
                      'v_desinfeccion_costos']) as v
    where not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'interno' and c.relname = v || '_crudo');
    if v_falta is not null then
        raise exception 'Faltan vistas crudas del módulo: %', v_falta;
    end if;

    -- 2 · Ninguna cruda en `public`, nadie de fuera en `interno`,
    --     ninguna expuesta sin reja. Lo de la 56/57, otra vez.
    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.relname like '%\_crudo';
    if v_falta is not null then
        raise exception 'Vistas crudas sueltas en public: %', v_falta;
    end if;

    select string_agg(r.rolname, ', ') into v_falta
    from unnest(array['authenticated','anon','public']) as r(rolname)
    where has_schema_privilege(r.rolname, 'interno', 'usage');
    if v_falta is not null then
        raise exception 'Estos roles pueden entrar al esquema interno: %', v_falta;
    end if;

    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and exists (select 1 from pg_class cr join pg_namespace nr on nr.oid = cr.relnamespace
                  where nr.nspname = 'interno' and cr.relname = c.relname || '_crudo')
      and pg_get_viewdef(c.oid, true) !~ 'fn_permitido_de';
    if v_falta is not null then
        raise exception 'Vistas sin reja de permiso: %', v_falta;
    end if;

    -- 3 · Toda tabla nueva con su RLS encendido Y con policies: encender
    --     RLS sin policies deja la tabla cerrada sin que nadie lo diga.
    select string_agg(t, ', ') into v_falta
    from unnest(array['desinfeccion_plan','desinfeccion_ejecucion','desinfeccion_ejecucion_lotes',
                      'desinfeccion_personal','desinfeccion_logistica',
                      'catalogo_tasas_cambio']) as t
    where not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t and c.relrowsecurity)
       or not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = t);
    if v_falta is not null then
        raise exception 'Tablas sin RLS o sin policies: %', v_falta;
    end if;

    -- 4 · Y ninguna función nueva sin `search_path`.
    select string_agg(p.proname, ', ') into v_falta
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
                       where c like 'search_path=%');
    if v_falta is not null then
        raise exception 'Funciones security definer sin search_path: %', v_falta;
    end if;
end $$;

do $$
declare
    v_faltan integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    if v_faltan > 0 then
        raise exception 'Quedaron % llaves sin casilla en la matriz.', v_faltan;
    end if;
end $$;
