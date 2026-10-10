-- =====================================================================
-- 61 · DESINFECCIÓN — LA NOCHE, LOS ENVASES Y LA CUADRILLA POR FASE
-- =====================================================================
--
-- Nueve fricciones de campo, auditadas sobre la 60. Las que son de base:
--
--   A · Las horas que CRUZAN LA MEDIANOCHE. Se desinfecta de noche: de
--       22:00 a 01:00 son tres horas, y hasta ahora eran cero —peor
--       todavía, el preriego invertido ni siquiera dejaba guardar la
--       fila—.
--   B · Los envases con los que el químico llega al campo.
--   C · El catálogo de materiales: ingrediente activo, concentración y
--       un HISTORIAL de precios, en lempiras o en dólares.
--   D · El jornal, marcado en el catálogo de operadores.
--   E · La cuadrilla por FASE, sin jornadas y con salario a mano.
--   F · Las manzanas que quedan por desinfectar de cada lote.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · LAS HORAS QUE CRUZAN LA MEDIANOCHE
-- =====================================================================
-- La 60 calculaba `greatest(fin - inicio, interval '0')`, que para un
-- turno nocturno da CERO: de 22:00 a 01:00 la resta es negativa y el
-- `greatest` la aplasta. Era el caso que más importa, porque la
-- desinfección se hace de noche.
--
-- La regla nueva está en una sola función para que las cuatro columnas
-- que la usan no puedan discrepar. Es `immutable` —sólo mira sus dos
-- argumentos— y por eso Postgres la admite dentro de una columna
-- generada.
--
-- Qué NO hace: adivinar turnos de más de 24 horas. Un turno que empieza
-- a las 22:00 y termina a las 21:00 del día siguiente se lee como una
-- hora, no como veintitrés. Para eso harían falta fechas, no horas, y
-- esa es otra migración.

create or replace function public.fn_horas_entre(p_inicio time, p_fin time)
returns numeric
language sql immutable as $$
    select case
        when p_inicio is null or p_fin is null then 0
        when p_fin >= p_inicio then extract(epoch from (p_fin - p_inicio)) / 3600.0
        -- Cruce de medianoche: 22:00 → 01:00 son 3 horas, no −21.
        else extract(epoch from ((p_fin - p_inicio) + interval '24 hours')) / 3600.0
    end
$$;

comment on function public.fn_horas_entre(time, time) is
    'Horas entre dos horas del día, cruzando la medianoche. Immutable: la usan columnas generadas.';

grant execute on function public.fn_horas_entre(time, time) to authenticated;

-- El CHECK de la 59 prohibía que el preriego terminara antes de empezar.
-- Con turnos nocturnos eso es lo NORMAL, así que la restricción deja de
-- tener sentido: se va.
alter table public.desinfeccion_ejecucion
    drop constraint if exists desinfeccion_horas_preriego;

-- Las vistas se van antes de tocar columnas y se rehacen enteras al
-- final, igual que en la 60.
do $$
declare
    v text;
begin
    foreach v in array array['v_desinfeccion_plan', 'v_desinfeccion_ejecucion',
                             'v_desinfeccion_lotes', 'v_desinfeccion_personal',
                             'v_desinfeccion_logistica', 'v_desinfeccion_costos',
                             'v_desinfeccion_productos']
    loop
        execute format('drop view if exists public.%I', v);
        execute format('drop view if exists interno.%I', v || '_crudo');
    end loop;
end $$;

/* ------------------------- El lavado, con horas -------------------- */
-- `horas_lavado` era un número escrito a mano: no tenía horas, así que
-- no podía cruzar la medianoche. Ahora tiene su par de horas como las
-- otras dos fases.
--
-- Lo ya capturado NO se pierde: el número viejo se queda en
-- `horas_lavado_manual` y manda mientras no haya horas. Dos entradas y
-- una salida, con precedencia explícita, es preferible a tirar lo
-- capturado o a dejar dos columnas que un día digan cosas distintas.

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
          and column_name = 'horas_lavado'
          and is_generated = 'NEVER')
    then
        alter table public.desinfeccion_ejecucion
            rename column horas_lavado to horas_lavado_manual;
    end if;
end $$;

alter table public.desinfeccion_ejecucion
    add column if not exists horas_lavado_manual numeric(10,2) default 0,
    add column if not exists hora_inicio_lavado time,
    add column if not exists hora_fin_lavado    time;

comment on column public.desinfeccion_ejecucion.horas_lavado_manual is
    'El número que se escribía a mano antes de la 61. Manda sólo si no hay horas de lavado.';

/* ------------------- Las cuatro columnas, otra vez ------------------ */
-- Una columna generada no puede leer otra generada, así que el total
-- repite las expresiones en vez de sumar las columnas. Es el precio de
-- que la base sea la única que calcula.

alter table public.desinfeccion_ejecucion drop column if exists horas_preriego;
alter table public.desinfeccion_ejecucion
    add column horas_preriego numeric(10,2) generated always as (
        public.fn_horas_entre(hora_inicio_preriego, hora_fin_preriego)
    ) stored;

alter table public.desinfeccion_ejecucion drop column if exists horas_inyeccion;
alter table public.desinfeccion_ejecucion
    add column horas_inyeccion numeric(10,2) generated always as (
        public.fn_horas_entre(hora_inicio_iny, hora_fin_iny)
    ) stored;

alter table public.desinfeccion_ejecucion drop column if exists horas_lavado;
alter table public.desinfeccion_ejecucion
    add column horas_lavado numeric(10,2) generated always as (
        case
            when hora_inicio_lavado is not null and hora_fin_lavado is not null
                then public.fn_horas_entre(hora_inicio_lavado, hora_fin_lavado)
            else coalesce(horas_lavado_manual, 0)
        end
    ) stored;

alter table public.desinfeccion_ejecucion drop column if exists total_horas_riego;
alter table public.desinfeccion_ejecucion
    add column total_horas_riego numeric(10,2) generated always as (
        coalesce(horas_presurizacion, 0)
        + public.fn_horas_entre(hora_inicio_iny, hora_fin_iny)
        + case
            when hora_inicio_lavado is not null and hora_fin_lavado is not null
                then public.fn_horas_entre(hora_inicio_lavado, hora_fin_lavado)
            else coalesce(horas_lavado_manual, 0)
          end
    ) stored;

comment on column public.desinfeccion_ejecucion.total_horas_riego is
    'Presurización + inyección + lavado, cruzando la medianoche. Generada: no se escribe a mano.';

-- =====================================================================
-- B · LOS ENVASES DEL QUÍMICO
-- =====================================================================
-- Cómo llegó el producto al campo. Va en la línea del químico y no en la
-- cabecera porque cada producto llega en lo suyo: el ácido en canaca y
-- el desinfectante en barril.

alter table public.desinfeccion_ejecucion_productos
    add column if not exists cantidad_envases integer not null default 0
        check (cantidad_envases >= 0),
    -- Texto libre y no un enum: el día que llegue en un envase nuevo, el
    -- enum obliga a una migración y la captura se para. La lista cerrada
    -- vive en la pantalla, que se cambia sin tocar la base.
    add column if not exists tipo_envase varchar(40);

comment on column public.desinfeccion_ejecucion_productos.tipo_envase is
    'Canaca, Barril, Galón, Litro… Texto libre a propósito: la lista la propone la pantalla.';

-- =====================================================================
-- C · EL CATÁLOGO DE MATERIALES, Y SUS PRECIOS EN EL TIEMPO
-- =====================================================================

alter table public.materiales
    add column if not exists ingrediente_activo text,
    add column if not exists concentracion      text;

comment on column public.materiales.ingrediente_activo is
    'Metam sodio, 1-3 dicloropropeno… Lo que de verdad actúa, para poder comparar productos.';

/**
 * El precio de un material en el tiempo, en la moneda en que se compró.
 *
 * Versionado por lo mismo que las tarifas de puesto: un costo capturado
 * en marzo no puede cambiar porque en octubre suba el producto. Y con
 * moneda, porque el químico se importa: guardar dólares convertidos a la
 * tasa de hoy es perder el dato original.
 */
create table if not exists public.historial_precios_materiales (
    id              uuid primary key default gen_random_uuid(),
    material_id     uuid not null references public.materiales(id) on delete cascade,
    moneda          text not null default 'HNL' check (moneda in ('HNL', 'USD')),
    precio_unitario numeric(14,4) not null check (precio_unitario >= 0),
    fecha_inicio    date not null,
    -- Abierto por arriba: el precio vigente es el que no tiene fin.
    fecha_fin       date,
    comentario      text,
    created_at      timestamptz not null default now(),

    constraint historial_precios_rango check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

comment on table public.historial_precios_materiales is
    'Precio por unidad de cada material, con su moneda y su vigencia. De aquí sale el costo del químico.';

-- Dos precios abiertos del mismo material a la vez es una ambigüedad que
-- nadie resuelve después: cuál de los dos rige.
create unique index if not exists historial_precios_abierto_uidx
    on public.historial_precios_materiales (material_id, fecha_inicio);

create index if not exists historial_precios_material_idx
    on public.historial_precios_materiales (material_id, fecha_inicio desc);

alter table public.historial_precios_materiales enable row level security;

-- Leer es abierto, igual que la tasa de cambio de la 59: un costo sin su
-- precio no se puede interpretar, y esconderlo sólo consigue que el
-- reporte salga en blanco. Escribir va con el bloque de catálogo donde
-- viven los materiales.
drop policy if exists historial_precios_select on public.historial_precios_materiales;
create policy historial_precios_select on public.historial_precios_materiales for select
    using ((select auth.uid()) is not null);

drop policy if exists historial_precios_write on public.historial_precios_materiales;
create policy historial_precios_write on public.historial_precios_materiales for all
    using ((select public.fn_tiene_permiso('catalogo_cultivos', 'editar')))
    with check ((select public.fn_tiene_permiso('catalogo_cultivos', 'crear'))
             or (select public.fn_tiene_permiso('catalogo_cultivos', 'editar')));

/**
 * El precio de un material en una fecha, YA EN LEMPIRAS.
 *
 * Si el precio estaba en dólares se convierte con la tasa de ESA fecha
 * —la de la 59—, no con la de hoy: el costo de marzo se cuadra con la
 * tasa de marzo. Si no hay tasa para esa fecha devuelve nulo en vez de
 * inventar una: un costo con una tasa inventada es peor que un hueco.
 */
create or replace function public.fn_precio_material(p_material_id uuid, p_fecha date)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when h.moneda = 'USD' then h.precio_unitario * public.fn_tasa_cambio(p_fecha)
        else h.precio_unitario
    end
    from public.historial_precios_materiales h
    where h.material_id = p_material_id
      and h.fecha_inicio <= p_fecha
      and (h.fecha_fin is null or h.fecha_fin >= p_fecha)
    order by h.fecha_inicio desc
    limit 1
$$;

grant execute on function public.fn_precio_material(uuid, date) to authenticated;

/**
 * El costo por litro de un químico capturado.
 *
 * Se copia a la fila al guardar, igual que la tarifa del personal en la
 * 59: si mañana sube el producto, lo ya capturado no puede cambiar de
 * costo solo. Lo escrito a mano manda sobre el catálogo —hay compras
 * puntuales a otro precio—, y por eso sólo se rellena cuando viene en
 * cero.
 */
create or replace function public.fn_desinfeccion_costo_producto()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_fecha  date;
    v_precio numeric;
begin
    if coalesce(new.costo_litro, 0) > 0 then
        return new;
    end if;

    select coalesce(e.fecha_aplicacion, e.fecha_preriego, current_date)
      into v_fecha
      from public.desinfeccion_ejecucion e
     where e.id = new.ejecucion_id;

    v_precio := public.fn_precio_material(new.producto_id, coalesce(v_fecha, current_date));
    new.costo_litro := coalesce(v_precio, 0);
    return new;
end;
$$;

drop trigger if exists trg_desinfeccion_costo_producto on public.desinfeccion_ejecucion_productos;
create trigger trg_desinfeccion_costo_producto
    before insert or update of producto_id, costo_litro
    on public.desinfeccion_ejecucion_productos
    for each row execute function public.fn_desinfeccion_costo_producto();

-- =====================================================================
-- D · EL JORNAL, EN EL CATÁLOGO DE OPERADORES
-- =====================================================================
-- El selector de la cuadrilla ofrece jornales; el de maquinaria, los
-- operadores de equipo. Son la misma tabla y hacía falta distinguirlos.

alter table public.operadores
    add column if not exists es_jornal boolean not null default false;

comment on column public.operadores.es_jornal is
    'Marca a quien trabaja por jornal. El selector de cuadrilla sólo ofrece éstos.';

create index if not exists operadores_jornal_idx
    on public.operadores (es_jornal) where es_jornal;

-- =====================================================================
-- E · LA CUADRILLA, POR FASE Y CON SALARIO A MANO
-- =====================================================================
-- La cuadrilla del preriego no es la de la aplicación: son dos días y
-- dos grupos. Juntarlas en una sola lista obligaba a recordar de cuál
-- era cada renglón.

do $$
begin
    if not exists (select 1 from pg_type where typname = 'fase_personal_desinfeccion') then
        create type public.fase_personal_desinfeccion as enum ('1_Preriego', '3_Aplicacion');
    end if;
end $$;

alter table public.desinfeccion_personal
    add column if not exists fase public.fase_personal_desinfeccion not null default '3_Aplicacion',
    -- El puesto deja de salir del catálogo: en campo la cuadrilla se
    -- anota como «Supervisor», «Jornal» u «Otro», y obligar a crear un
    -- puesto de trabajo para apuntar un jornal era pedirle al de campo
    -- que administre un catálogo.
    add column if not exists puesto_texto varchar(80),
    -- El salario se escribe. Trae por omisión el mínimo vigente, pero
    -- hay cuadrillas que se pactan distinto y eso no puede obligar a
    -- tocar el catálogo de tarifas.
    add column if not exists salario_base_manual numeric(12,4);

comment on column public.desinfeccion_personal.fase is
    'De qué fase es esta cuadrilla. La del preriego no es la de la aplicación.';

-- Lo que había en el puesto del catálogo se copia al texto ANTES de
-- soltar la columna: perder quién trabajó por un cambio de forma de la
-- tabla es una pérdida que nadie nota hasta que alguien pregunta.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'desinfeccion_personal'
          and column_name = 'puesto_id')
    then
        update public.desinfeccion_personal dp
           set puesto_texto = coalesce(dp.puesto_texto, pt.descripcion, pt.codigo)
          from public.puestos_trabajo pt
         where pt.id = dp.puesto_id and dp.puesto_texto is null;
    end if;
end $$;

-- El disparador de la 59 nombra las columnas que se van, así que hay que
-- soltarlo antes. Se vuelve a crear más abajo con la fórmula nueva.
drop trigger if exists trg_desinfeccion_costo_personal on public.desinfeccion_personal;

alter table public.desinfeccion_personal drop column if exists puesto_id;
alter table public.desinfeccion_personal drop column if exists jornadas;

/**
 * El salario mínimo vigente, por jornada.
 *
 * Sale de `tarifas_puesto` buscando el puesto que se llame «salario
 * mínimo». **Es una búsqueda por NOMBRE y conviene saberlo:** si alguien
 * renombra ese puesto, el formulario deja de proponer un salario por
 * omisión —no calcula mal, deja el campo vacío y la persona lo escribe—.
 * El día que estorbe, lo sólido es una bandera en `puestos_trabajo`,
 * igual que `es_jornal` en operadores.
 */
create or replace function public.fn_salario_minimo_dia(p_fecha date)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select t.costo_hora * 8
    from public.tarifas_puesto t
    join public.puestos_trabajo pt on pt.id = t.puesto_trabajo_id
    where (
            lower(translate(coalesce(pt.descripcion, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
                like '%salario%minimo%'
         or lower(translate(coalesce(pt.codigo, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
                like '%salario%minimo%'
          )
      and t.vigente_desde <= p_fecha
      and (t.vigente_hasta is null or t.vigente_hasta >= p_fecha)
    order by t.vigente_desde desc
    limit 1
$$;

grant execute on function public.fn_salario_minimo_dia(date) to authenticated;

/**
 * El costo de una línea de cuadrilla, sin jornadas.
 *
 *     costo = personas × ( salario + horas_extras × (salario / 8) × factor )
 *
 * Cambió respecto de la 59: ya no se multiplica por jornadas. Una línea
 * es una cuadrilla de un día, y los días son fases distintas.
 *
 * La tarifa se sigue COPIANDO a la fila: si mañana sube el salario
 * mínimo, lo ya capturado no puede cambiar de costo solo.
 */
create or replace function public.fn_desinfeccion_costo_personal()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_fecha   date;
    v_salario numeric;
    v_factor  numeric;
begin
    select case new.fase
               when '1_Preriego' then coalesce(e.fecha_preriego, e.fecha_aplicacion, current_date)
               else coalesce(e.fecha_aplicacion, e.fecha_preriego, current_date)
           end
      into v_fecha
      from public.desinfeccion_ejecucion e
     where e.id = new.ejecucion_id;

    v_salario := coalesce(
        new.salario_base_manual,
        new.tarifa_dia,
        public.fn_salario_minimo_dia(coalesce(v_fecha, current_date)),
        0
    );
    v_factor := case new.jornada_tipo when 'Nocturna' then 1.75 else 1.25 end;

    new.tarifa_dia := v_salario;
    new.costo_total := new.cantidad_personas
        * (v_salario + new.horas_extras * (v_salario / 8) * v_factor);

    return new;
end;
$$;

drop trigger if exists trg_desinfeccion_costo_personal on public.desinfeccion_personal;
create trigger trg_desinfeccion_costo_personal
    before insert or update of cantidad_personas, horas_extras, jornada_tipo,
                               tarifa_dia, salario_base_manual, fase
    on public.desinfeccion_personal
    for each row execute function public.fn_desinfeccion_costo_personal();

-- =====================================================================
-- F · LAS MANZANAS QUE LE QUEDAN A CADA LOTE
-- =====================================================================
/**
 * Planeadas y ya desinfectadas, lote por lote.
 *
 * Las planeadas salen del plan de trasplante (`fn_area_regable`): lo
 * planificado, o lo sembrado si el lote ya se terminó. Las ejecutadas
 * son lo que ya se desinfectó en ESTA temporada.
 *
 * `p_ejecucion_id` excluye el turno que se está editando: sin eso,
 * corregir 9.99 a 10.00 parecería que ya está todo hecho.
 *
 * Lo que devuelve es una SUGERENCIA. El formulario la propone y deja
 * escribir otra cosa: el que está en el lote sabe mejor que el plan
 * cuántas manzanas regó.
 */
create or replace function public.fn_lotes_desinfeccion(
    p_temporada_id uuid,
    p_ejecucion_id uuid default null
) returns table (
    lote_temporada_id uuid,
    nomenclatura      text,
    lote_nombre       text,
    zona_id           uuid,
    area_neta         numeric,
    mz_planeadas      numeric,
    mz_ejecutadas     numeric,
    mz_restantes      numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
    select
        lt.id,
        lo.nomenclatura,
        lo.nombre,
        lt.zona_id,
        coalesce(lt.area_neta, 0),
        coalesce(public.fn_area_regable(lt.id), 0)          as mz_planeadas,
        coalesce(d.hechas, 0)                               as mz_ejecutadas,
        greatest(coalesce(public.fn_area_regable(lt.id), 0) - coalesce(d.hechas, 0), 0)
                                                            as mz_restantes
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    left join lateral (
        select sum(dl.mz_cubiertas) as hechas
        from public.desinfeccion_ejecucion_lotes dl
        join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
        where dl.lote_temporada_id = lt.id
          and e.temporada_id = p_temporada_id
          and (p_ejecucion_id is null or e.id <> p_ejecucion_id)
    ) d on true
    where lt.temporada_id = p_temporada_id
      and lt.activo
    order by lo.nomenclatura
$$;

grant execute on function public.fn_lotes_desinfeccion(uuid, uuid) to authenticated;

-- =====================================================================
-- G · LAS VISTAS, OTRA VEZ ENTERAS
-- =====================================================================

create schema if not exists interno;

/* ----------------------------- El plan ----------------------------- */

create or replace view interno.v_desinfeccion_plan_crudo as
select
    p.id, p.temporada_id, tm.nombre as temporada_nombre,
    p.lote_temporada_id, lo.nomenclatura as lote_nomenclatura, lo.nombre as lote_nombre,
    lt.zona_id, z.nombre as zona_nombre,
    p.ciclo, p.fecha_siembra_congelada, p.dias_aplicacion, p.fecha_aplicacion,
    p.variedad_id, v.nombre as variedad_nombre,
    p.producto_id, m.descripcion as producto_nombre, m.codigo as producto_codigo,
    m.ingrediente_activo, m.concentracion,
    p.dosis_mz, p.area_planificada_mz, p.costo_litro,
    p.total_litros, p.total_costo, p.costo_mz,
    p.comentarios, p.usuario_id, pe.nombre as usuario_nombre, p.created_at
from public.desinfeccion_plan p
join public.lotes_temporada lt on lt.id = p.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.temporadas tm      on tm.id = p.temporada_id
left join public.variedades v  on v.id = p.variedad_id
left join public.materiales m  on m.id = p.producto_id
left join public.perfiles pe   on pe.id = p.usuario_id;

/* -------------------------- La ejecución --------------------------- */
-- La mano de obra sale SEPARADA por fase: el reporte del turno la pide
-- así —«cuánto costó el preriego» es una pregunta distinta de «cuánto
-- costó la aplicación»— y sumarlas antes de tiempo pierde esa respuesta.

create or replace view interno.v_desinfeccion_ejecucion_crudo as
select
    e.id, e.temporada_id, tm.nombre as temporada_nombre,
    e.turno_id, tn.nombre as turno_nombre, tn.codigo as turno_codigo,
    tn.zona_id, z.nombre as zona_nombre,
    e.ciclo, e.estado,

    e.fecha_preriego, e.hora_inicio_preriego, e.hora_fin_preriego, e.horas_preriego,
    e.obs_preriego,

    e.fecha_lecturas, e.lecturas_tensiometro,

    e.fecha_aplicacion,
    e.estacion_riego_id, er.nombre as estacion_riego_nombre,
    e.horas_presurizacion,
    e.hora_inicio_iny, e.hora_fin_iny, e.horas_inyeccion,
    e.hora_inicio_lavado, e.hora_fin_lavado, e.horas_lavado,
    e.total_horas_riego,
    e.ppm, e.ce_antes, e.ce_durante, e.ce_despues,
    e.calibracion_entrada, e.calibracion_salida, e.calibracion_campo,

    coalesce(l.mz_regadas, 0)        as mz_regadas,
    coalesce(l.lotes_regados, 0)     as lotes_regados,
    coalesce(pr.costo_preriego, 0)   as costo_personal_preriego,
    coalesce(pr.costo_aplicacion, 0) as costo_personal_aplicacion,
    coalesce(pr.costo_total, 0)      as costo_personal,
    coalesce(q.costo_quimico, 0)     as costo_quimico,
    coalesce(q.productos, 0)         as productos,
    q.productos_nombres,
    coalesce(q.envases, 0)           as envases,

    e.usuario_id, pf.nombre as usuario_nombre, e.created_at
from public.desinfeccion_ejecucion e
join public.temporadas tm            on tm.id = e.temporada_id
join public.turnos tn                on tn.id = e.turno_id
left join public.zonas z             on z.id = tn.zona_id
left join public.estaciones_riego er on er.id = e.estacion_riego_id
left join public.perfiles pf         on pf.id = e.usuario_id
left join lateral (
    select sum(x.mz_cubiertas) as mz_regadas, count(*) as lotes_regados
    from public.desinfeccion_ejecucion_lotes x
    where x.ejecucion_id = e.id
) l on true
left join lateral (
    select
        sum(x.costo_total) filter (where x.fase = '1_Preriego')   as costo_preriego,
        sum(x.costo_total) filter (where x.fase = '3_Aplicacion') as costo_aplicacion,
        sum(x.costo_total)                                        as costo_total
    from public.desinfeccion_personal x
    where x.ejecucion_id = e.id
) pr on true
left join lateral (
    select sum(x.costo_total)                  as costo_quimico,
           count(*)                            as productos,
           sum(x.cantidad_envases)             as envases,
           string_agg(mm.descripcion, ', ' order by mm.descripcion) as productos_nombres
    from public.desinfeccion_ejecucion_productos x
    join public.materiales mm on mm.id = x.producto_id
    where x.ejecucion_id = e.id
) q on true;

/* ------------------------ Los lotes regados ------------------------ */

create or replace view interno.v_desinfeccion_lotes_crudo as
select
    dl.id, dl.ejecucion_id, e.temporada_id, e.fecha_aplicacion,
    e.turno_id, tn.nombre as turno_nombre, e.ciclo,
    dl.lote_temporada_id, lo.nomenclatura as lote_nomenclatura, lo.nombre as lote_nombre,
    lt.zona_id, z.nombre as zona_nombre,
    dl.mz_cubiertas, e.usuario_id, dl.created_at
from public.desinfeccion_ejecucion_lotes dl
join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
join public.lotes_temporada lt       on lt.id = dl.lote_temporada_id
join public.lotes lo                 on lo.id = lt.lote_id
left join public.zonas z             on z.id = lt.zona_id;

/* --------------------------- Los químicos -------------------------- */

create or replace view interno.v_desinfeccion_productos_crudo as
select
    dp.id, dp.ejecucion_id, e.temporada_id,
    e.turno_id, tn.nombre as turno_nombre, tn.zona_id, e.ciclo, e.fecha_aplicacion,
    dp.producto_id, m.codigo as producto_codigo, m.descripcion as producto_nombre,
    m.ingrediente_activo, m.concentracion,
    dp.total_litros, dp.costo_litro, dp.costo_total,
    dp.cantidad_envases, dp.tipo_envase,
    -- El precio de catálogo que REGÍA ese día, al lado del que se
    -- capturó: ver los dos juntos es lo que deja detectar una compra a
    -- otro precio sin tener que abrir el catálogo.
    public.fn_precio_material(dp.producto_id,
        coalesce(e.fecha_aplicacion, e.fecha_preriego, current_date)) as precio_catalogo,
    coalesce(l.mz_regadas, 0)                  as mz_regadas,
    dp.total_litros / nullif(l.mz_regadas, 0)  as dosis_mz,
    e.usuario_id, dp.created_at
from public.desinfeccion_ejecucion_productos dp
join public.desinfeccion_ejecucion e on e.id = dp.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
join public.materiales m             on m.id = dp.producto_id
left join lateral (
    select sum(x.mz_cubiertas) as mz_regadas
    from public.desinfeccion_ejecucion_lotes x
    where x.ejecucion_id = e.id
) l on true;

/* ---------------------------- Personal ----------------------------- */

create or replace view interno.v_desinfeccion_personal_crudo as
select
    dp.id, dp.ejecucion_id, e.temporada_id,
    e.turno_id, tn.nombre as turno_nombre, e.ciclo,
    dp.fase,
    -- La fecha de SU fase, que no es la misma para las dos cuadrillas.
    case dp.fase
        when '1_Preriego' then e.fecha_preriego
        else e.fecha_aplicacion
    end                                        as fecha,
    dp.puesto_texto,
    dp.operador_id, op.codigo as operador_codigo, op.nombre as operador_nombre,
    dp.cantidad_personas, dp.horas_extras, dp.jornada_tipo,
    dp.salario_base_manual, dp.tarifa_dia, dp.costo_total,
    e.usuario_id, dp.created_at
from public.desinfeccion_personal dp
join public.desinfeccion_ejecucion e on e.id = dp.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
left join public.operadores op       on op.id = dp.operador_id;

/* ---------------------------- Logística ---------------------------- */

create or replace view interno.v_desinfeccion_logistica_crudo as
select
    dg.id, dg.temporada_id, tm.nombre as temporada_nombre,
    dg.zona_id, z.nombre as zona_nombre, dg.fecha,
    dg.equipo_id, eq.codigo as equipo_codigo, eq.nombre as equipo_nombre,
    dg.implemento_id, im.nombre as implemento_nombre,
    dg.operador_id, op.nombre as operador_nombre,
    dg.horas_trabajo, dg.costo_hora, dg.costo_total, dg.comentarios,
    dg.usuario_id, pe.nombre as usuario_nombre, dg.created_at
from public.desinfeccion_logistica dg
join public.temporadas tm       on tm.id = dg.temporada_id
join public.zonas z             on z.id = dg.zona_id
join public.equipos eq          on eq.id = dg.equipo_id
left join public.implementos im on im.id = dg.implemento_id
left join public.operadores op  on op.id = dg.operador_id
left join public.perfiles pe    on pe.id = dg.usuario_id;

/* ====================== LA VISTA ANALÍTICA ========================= */
-- El reparto no cambia: químico y personal entre los lotes de SU
-- ejecución por manzanas, y la bolsa de logística entre las manzanas de
-- SU zona. Lo único nuevo es que el personal ya viene de las dos fases.

create or replace view interno.v_desinfeccion_costos_crudo as
with regado as (
    select dl.lote_temporada_id, dl.ejecucion_id, e.temporada_id, lt.zona_id, dl.mz_cubiertas
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.lotes_temporada lt       on lt.id = dl.lote_temporada_id
),
por_ejecucion as (
    select ejecucion_id, sum(mz_cubiertas) as mz_total from regado group by ejecucion_id
),
por_zona as (
    select temporada_id, zona_id, sum(mz_cubiertas) as mz_zona
    from regado group by temporada_id, zona_id
),
bolsa as (
    select temporada_id, zona_id, sum(costo_total) as bolsa_zona
    from public.desinfeccion_logistica group by temporada_id, zona_id
),
personal as (
    select ejecucion_id,
           sum(costo_total)                                        as costo_personal,
           sum(costo_total) filter (where fase = '1_Preriego')     as costo_preriego,
           sum(costo_total) filter (where fase = '3_Aplicacion')   as costo_aplicacion
    from public.desinfeccion_personal group by ejecucion_id
),
quimico as (
    select ejecucion_id, sum(costo_total) as costo_quimico
    from public.desinfeccion_ejecucion_productos group by ejecucion_id
)
select
    r.lote_temporada_id,
    lo.nomenclatura as lote_nomenclatura, lo.nombre as lote_nombre,
    r.temporada_id, tm.nombre as temporada_nombre,
    r.zona_id, z.nombre as zona_nombre,

    sum(r.mz_cubiertas) as mz_regadas,

    sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_quimico,
    sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal,
    sum(coalesce(pr.costo_preriego, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_preriego,
    sum(coalesce(pr.costo_aplicacion, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_aplicacion,

    max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas) as costo_logistica,

    sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas)
                                                      as costo_total,

    (sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
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
left join quimico qu                 on qu.ejecucion_id = r.ejecucion_id
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
            ('v_desinfeccion_productos',  'usuario_id', 'zona_id'),
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
-- H · EL DIAGNÓSTICO DE TARIFAS
-- =====================================================================
-- El encargo dice que el Administrador no puede agregar ni editar
-- Tarifas. **Sobre una base construida desde cero no se reproduce:**
-- `fn_permiso_de` ya devuelve `true` para quien tenga `acceso_total`,
-- `fn_mis_permisos` le expande las seis acciones de la pantalla, la RLS
-- de `tarifas_puesto` le deja insertar y la pantalla lee ese mismo
-- conjunto. Está probado en `t61.sql`.
--
-- Así que en vez de «arreglar» a ciegas algo que aquí funciona, esta
-- migración IMPRIME el estado real de la instalación. Si el problema
-- sigue, el aviso dice en qué de los cuatro eslabones está.

do $$
declare
    v_roles    text;
    v_acciones text;
    v_temp     integer;
begin
    select string_agg(codigo, ', ') into v_roles from public.roles where acceso_total;
    raise notice 'TARIFAS · roles con acceso_total: %', coalesce(v_roles, 'NINGUNO (ese es el problema)');

    select array_to_string(acciones, ', ') into v_acciones
      from public.pantallas where codigo = 'tarifas';
    raise notice 'TARIFAS · acciones declaradas en la pantalla: %',
        coalesce(v_acciones, 'LA PANTALLA NO EXISTE');

    select count(*) into v_temp from public.temporadas;
    raise notice 'TARIFAS · temporadas en la base: % (sin ninguna, la pantalla no puede guardar)', v_temp;

    select string_agg(r.codigo, ', ') into v_roles
      from public.roles r
      join public.permisos p on p.rol_id = r.id
     where p.recurso = 'tarifas' and p.accion = 'editar' and p.permitido;
    raise notice 'TARIFAS · roles de la matriz con «editar»: %', coalesce(v_roles, 'ninguno');
end $$;

-- Lo único que SÍ se repara, porque es objetivo: si la pantalla hubiera
-- perdido alguna de sus acciones, el Administrador no las recibiría —su
-- permiso se expande sobre esta lista—.
update public.pantallas
set acciones = array['ver','crear','editar','eliminar','exportar','importar']
where codigo = 'tarifas'
  and not (acciones @> array['ver','crear','editar','eliminar']);

-- =====================================================================
-- I · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_falta text;
begin
    select string_agg(v, ', ') into v_falta
    from unnest(array['v_desinfeccion_plan','v_desinfeccion_ejecucion','v_desinfeccion_lotes',
                      'v_desinfeccion_productos','v_desinfeccion_personal',
                      'v_desinfeccion_logistica','v_desinfeccion_costos']) as v
    where not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'interno' and c.relname = v || '_crudo');
    if v_falta is not null then
        raise exception 'Faltan vistas crudas del módulo: %', v_falta;
    end if;

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

    if not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'historial_precios_materiales'
          and c.relrowsecurity)
       or not exists (select 1 from pg_policies p
                      where p.schemaname = 'public'
                        and p.tablename = 'historial_precios_materiales')
    then
        raise exception 'historial_precios_materiales se quedó sin RLS o sin policies.';
    end if;

    -- Las columnas que la 61 retira de la cuadrilla: si volvieran,
    -- volvería con ellas la fórmula vieja.
    select string_agg(column_name, ', ') into v_falta
    from information_schema.columns
    where table_schema = 'public' and table_name = 'desinfeccion_personal'
      and column_name in ('puesto_id', 'jornadas');
    if v_falta is not null then
        raise exception 'La cuadrilla todavía tiene columnas de la 59: %', v_falta;
    end if;

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
