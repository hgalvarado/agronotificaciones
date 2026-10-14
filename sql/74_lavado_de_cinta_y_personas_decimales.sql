-- =====================================================================
-- 74 · LAVADO DE CINTA, PERSONAS CON DECIMALES Y QUÍMICO POR FASE
-- =====================================================================
--
-- ── Qué se viene a arreglar ─────────────────────────────────────────
--
-- 1 · **El lavado de cinta no se podía capturar.** Después de inyectar
--     hay que lavar la cinta: otra gente, otro químico, otro día. Todo
--     eso caía dentro de «3 · Aplicación» o no se anotaba, y el costo de
--     cerrar un turno quedaba escondido dentro del de aplicarlo.
--
-- 2 · **Una persona no siempre es una persona entera.** Un estacionero
--     que atiende tres turnos pone un tercio de su jornal en cada uno.
--     `cantidad_personas integer` obligaba a escribir 1 —y a inflar el
--     costo tres veces— o 0, que el CHECK rechazaba. Pasa a
--     `numeric(6,2)`: 0.33, 0.5, 2.25.
--
-- 3 · **El mismo químico en dos fases chocaba.** La llave única era
--     `(ejecucion_id, producto_id)`, así que el ácido de la inyección y
--     el ácido del lavado eran la misma fila. Pasa a incluir la fase.
--
-- ── Lo que NO cambia, y es a propósito ──────────────────────────────
--
-- El lavado de cinta **no calcula ppm ni hereda objetivos de control**.
-- No se aplica contra una plaga: se enjuaga una tubería. Un ppm ahí
-- sería un número sin significado que alguien acabaría comparando con el
-- de la inyección, y un objetivo heredado sería afirmar en el papel algo
-- que nadie dijo en campo.
--
-- Las ppm y los objetivos AGREGADOS del informe y de la ejecución pasan
-- a mirar sólo `'3_Aplicacion'` por el mismo motivo. Y `dosis_mz_real`
-- también: se compara contra un plan que no tiene línea de lavado, así
-- que sumarle los litros del enjuague inventaría una sobredosis.
--
-- Los COSTOS sí lo suman todo —químico, cuadrilla— porque el lavado se
-- paga. `costo_personal_lavado` sale aparte para poder contestar cuánto
-- cuesta cerrar un turno.
--
-- ── Requisito ───────────────────────────────────────────────────────
--
-- La 73 tiene que estar corrida ANTES: añade '4_Lavado' a los dos enums
-- y un valor nuevo no se puede usar en la transacción que lo crea.
-- =====================================================================

-- =====================================================================
-- A · LA FECHA DEL LAVADO
-- =====================================================================

alter table public.desinfeccion_ejecucion
    add column if not exists fecha_lavado date;

comment on column public.desinfeccion_ejecucion.fecha_lavado is
    'El día en que se lavó la cinta. Puede ser posterior a la aplicación.';

-- =====================================================================
-- B · FUERA LAS VISTAS QUE ESTORBAN
-- =====================================================================
-- `alter column type` no puede con una vista encima. Se sueltan las
-- cinco parejas que tocan personal, productos o la ejecución, y se
-- vuelven a levantar enteras más abajo. Las de plan y lotes no dependen
-- de nada de esto y se quedan donde están.
--
-- El orden importa: primero las públicas —que cuelgan de las crudas— y
-- después las crudas.

drop view if exists public.v_desinfeccion_informe_ejecutivo;
drop view if exists public.v_desinfeccion_costos;
drop view if exists public.v_desinfeccion_ejecucion;
drop view if exists public.v_desinfeccion_productos;
drop view if exists public.v_desinfeccion_personal;

drop view if exists interno.v_desinfeccion_informe_crudo;
drop view if exists interno.v_desinfeccion_costos_crudo;
drop view if exists interno.v_desinfeccion_ejecucion_crudo;
drop view if exists interno.v_desinfeccion_productos_crudo;
drop view if exists interno.v_desinfeccion_personal_crudo;

-- =====================================================================
-- C · PERSONAS CON DECIMALES
-- =====================================================================

-- El disparador de costo lleva `cantidad_personas` en su lista de
-- `UPDATE OF`, y Postgres no deja cambiar el tipo de una columna que un
-- disparador nombra. Se suelta y se vuelve a poner más abajo, con la
-- fecha del lavado dentro.
drop trigger if exists trg_desinfeccion_costo_personal on public.desinfeccion_personal;

alter table public.desinfeccion_personal
    alter column cantidad_personas type numeric(6,2)
        using cantidad_personas::numeric(6,2);

alter table public.desinfeccion_personal
    alter column cantidad_personas set not null,
    alter column cantidad_personas set default 1;

-- El tope de 500 no es decorativo: con `numeric` sin tope, un dedo
-- resbalado en el teclado numérico mete 11 en vez de 1.1 y el costo del
-- turno se multiplica por diez sin que nada chille.
alter table public.desinfeccion_personal
    drop constraint if exists desinfeccion_personal_cantidad_personas_check;

alter table public.desinfeccion_personal
    add constraint desinfeccion_personal_cantidad_personas_check
        check (cantidad_personas > 0 and cantidad_personas <= 500);

comment on column public.desinfeccion_personal.cantidad_personas is
    'Personas-jornada. Admite fracciones: un estacionero repartido entre tres turnos pone 0.33 en cada uno.';

-- `puesto_texto` es texto libre de 80 caracteres y NO tiene CHECK: el
-- puesto nuevo —«Operador de Riego», 17 caracteres— entra sin tocar
-- nada. El guardián del pie lo vuelve a comprobar, por si alguien añade
-- una lista cerrada más adelante sin acordarse de este puesto.

-- ---------------------------------------------------------------------
-- El costo, en numérico de punta a punta
-- ---------------------------------------------------------------------
-- Antes `cantidad_personas` era entero y la multiplicación no podía
-- perder nada. Ahora el factor es `numeric` y el resultado arrastra
-- cuatro decimales de la tarifa: se redondea a DOS, que es lo que se
-- enseña en la pantalla y lo que se suma en el informe. Sin el redondeo,
-- la pantalla diría 1,234.56 y el total del lote 1,234.5567.
create or replace function public.fn_desinfeccion_costo_personal()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
    v_fecha   date;
    v_salario numeric;
    v_factor  numeric;
begin
    select case new.fase
               when '1_Preriego' then coalesce(e.fecha_preriego, e.fecha_aplicacion, current_date)
               -- El lavado tiene su propia fecha desde la 74: la tarifa
               -- del día en que se lavó, no la del día en que se inyectó.
               when '4_Lavado'   then coalesce(e.fecha_lavado, e.fecha_aplicacion, current_date)
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
    new.costo_total := round(
        new.cantidad_personas::numeric
            * (v_salario + new.horas_extras * (v_salario / 8) * v_factor),
        2
    );

    return new;
end $$;

create trigger trg_desinfeccion_costo_personal
    before insert or update of cantidad_personas, horas_extras, jornada_tipo,
                               tarifa_dia, salario_base_manual, fase
    on public.desinfeccion_personal
    for each row execute function public.fn_desinfeccion_costo_personal();

-- =====================================================================
-- D · EL QUÍMICO LLEVA FASE
-- =====================================================================

alter table public.desinfeccion_ejecucion_productos
    add column if not exists fase public.fase_personal_desinfeccion
        not null default '3_Aplicacion';

-- Sólo dos de las cuatro fases llevan químico: en el preriego sólo va
-- agua, y las lecturas no aplican nada.
alter table public.desinfeccion_ejecucion_productos
    drop constraint if exists desinfeccion_productos_fase_check;

alter table public.desinfeccion_ejecucion_productos
    add constraint desinfeccion_productos_fase_check
        check (fase in ('3_Aplicacion', '4_Lavado'));

comment on column public.desinfeccion_ejecucion_productos.fase is
    'En qué fase se usó el químico. 4_Lavado no calcula ppm ni hereda objetivos de control.';

-- La llave única gana la fase: el mismo ácido en la inyección y en el
-- lavado son dos renglones, no uno repetido.
alter table public.desinfeccion_ejecucion_productos
    drop constraint if exists desinfeccion_ejecucion_productos_ejecucion_id_producto_id_key;

drop index if exists public.desinfeccion_productos_ejec_fase_prod_uidx;

do $$
declare v_dup text;
begin
    -- Si hubiera duplicados no se puede crear el índice, y el mensaje de
    -- Postgres no dice CUÁLES. Se corta antes, con la lista dentro.
    select string_agg(format('ejecución %s, producto %s (%s veces)', ejecucion_id, producto_id, n), '; ')
      into v_dup
      from (select ejecucion_id, fase, producto_id, count(*) as n
              from public.desinfeccion_ejecucion_productos
             group by ejecucion_id, fase, producto_id
            having count(*) > 1) d;
    if v_dup is not null then
        raise exception 'Hay químicos repetidos en la misma ejecución y fase: %', v_dup;
    end if;
end $$;

create unique index desinfeccion_productos_ejec_fase_prod_uidx
    on public.desinfeccion_ejecucion_productos (ejecucion_id, fase, producto_id);

-- ---------------------------------------------------------------------
-- Los objetivos de control NO entran en el lavado
-- ---------------------------------------------------------------------
-- Un objetivo heredado del catálogo en una línea de lavado afirmaría en
-- el informe algo que nadie dijo en campo: que se enjuagó la tubería
-- «contra nematodos».
create or replace function public.fn_objetivos_por_omision()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
    if new.fase = '4_Lavado' then
        new.objetivos_control := array[]::text[];
        return new;
    end if;

    if coalesce(array_length(new.objetivos_control, 1), 0) = 0 then
        select m.objetivos_control into new.objetivos_control
          from public.materiales m where m.id = new.producto_id;
        new.objetivos_control := coalesce(new.objetivos_control, array[]::text[]);
    end if;
    return new;
end $$;

-- Y hay que cerrar la otra puerta: `fn_objetivos_por_omision` es BEFORE
-- **INSERT** solamente, así que sin esto un UPDATE podría meterle
-- objetivos a una línea de lavado ya guardada y nadie lo vería.
--
-- ── Por qué una función NUEVA y no un `if` dentro de la de siempre ──
--
-- `fn_objetivos_en_orden` la comparten DOS tablas: `materiales` y
-- `desinfeccion_ejecucion_productos`. Meterle `new.fase` dentro reventó
-- el alta de materiales con «record "new" has no field fase», porque el
-- catálogo no tiene fases: un producto es un producto, se use cuando se
-- use.
--
-- Normalizar un arreglo de texto y saber qué significa la fase de una
-- aplicación son dos responsabilidades distintas. La primera se queda
-- genérica y compartida; la segunda vive aquí, y sólo la oye la tabla
-- que tiene fase.
create or replace function public.fn_objetivos_fase()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
    if new.fase = '4_Lavado' then
        new.objetivos_control := array[]::text[];
        return new;
    end if;
    new.objetivos_control := public.fn_limpiar_objetivos(new.objetivos_control);
    return new;
end $$;

comment on function public.fn_objetivos_fase() is
    'Normaliza los objetivos de control, y los vacía si la línea es de 4_Lavado.';

-- El disparador tiene que oír también los cambios de FASE: pasar una
-- línea de aplicación a lavado debe vaciarle los objetivos.
drop trigger if exists trg_productos_objetivos on public.desinfeccion_ejecucion_productos;
create trigger trg_productos_objetivos
    before insert or update of objetivos_control, fase
    on public.desinfeccion_ejecucion_productos
    for each row execute function public.fn_objetivos_fase();

-- =====================================================================
-- E · LAS VISTAS, DE VUELTA
-- =====================================================================
--
-- Las públicas se escriben con `x.*` y no con la lista de columnas a
-- mano. El motivo es la lección de esta migración: una lista a mano es
-- un sitio donde se pierde una columna en silencio cada vez que la
-- cruda gana una. La reja va igual de explícita que siempre.

/* ---------------------------- Personal ----------------------------- */

create view interno.v_desinfeccion_personal_crudo as
select
    dp.id,
    dp.ejecucion_id,
    e.temporada_id,
    e.turno_id,
    tn.nombre        as turno_nombre,
    e.ciclo,
    dp.fase,
    case dp.fase
        when '1_Preriego' then e.fecha_preriego
        when '4_Lavado'   then coalesce(e.fecha_lavado, e.fecha_aplicacion)
        else e.fecha_aplicacion
    end              as fecha,
    dp.puesto_texto,
    dp.operador_id,
    op.codigo        as operador_codigo,
    op.nombre        as operador_nombre,
    dp.cantidad_personas,
    dp.horas_extras,
    dp.jornada_tipo,
    dp.salario_base_manual,
    dp.tarifa_dia,
    dp.costo_total,
    e.usuario_id,
    dp.created_at,
    tn.zona_id
from public.desinfeccion_personal dp
join public.desinfeccion_ejecucion e on e.id = dp.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
left join public.operadores op       on op.id = dp.operador_id;

alter view interno.v_desinfeccion_personal_crudo set (security_invoker = off);

create view public.v_desinfeccion_personal as
select x.*
from interno.v_desinfeccion_personal_crudo x
where (select public.fn_permitido_de('desinfeccion_ejecucion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_ejecucion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_personal to authenticated;

/* ---------------------------- Productos ---------------------------- */

create view interno.v_desinfeccion_productos_crudo as
select
    dp.id,
    dp.ejecucion_id,
    e.temporada_id,
    e.turno_id,
    tn.nombre        as turno_nombre,
    tn.zona_id,
    e.ciclo,
    e.fecha_aplicacion,
    dp.fase,
    -- La fecha con la que se costea: la del lavado si es del lavado.
    case dp.fase when '4_Lavado' then coalesce(e.fecha_lavado, e.fecha_aplicacion)
                 else e.fecha_aplicacion end  as fecha_uso,
    dp.producto_id,
    m.codigo         as producto_codigo,
    m.descripcion    as producto_nombre,
    m.ingrediente_activo,
    m.concentracion,
    dp.objetivos_control,
    m.objetivos_control as objetivos_catalogo,
    dp.total_litros,
    dp.costo_litro,
    dp.costo_total,
    dp.cantidad_envases,
    dp.tipo_envase,
    public.fn_precio_material(
        dp.producto_id,
        coalesce(e.fecha_aplicacion, e.fecha_preriego, current_date),
        e.temporada_id
    )                as precio_catalogo,
    coalesce(l.mz_regadas, 0)                            as mz_regadas,
    dp.total_litros / nullif(l.mz_regadas, 0)            as dosis_mz,
    e.usuario_id,
    dp.created_at,
    e.caudal_agua,
    e.horas_inyeccion,
    e.horas_lavado,
    -- **El lavado de cinta no es una dilución.** Es agua que enjuaga una
    -- tubería, no agua que lleva producto al suelo. Las tres cuentas van
    -- en NULO y no en cero: un cero diría «salió cero ppm», que es una
    -- afirmación, y lo que pasa es que la pregunta no aplica.
    case when dp.fase = '4_Lavado' then null
         else coalesce(e.horas_inyeccion, 0) * e.caudal_agua end       as agua_total_m3,
    case when dp.fase = '4_Lavado' then null
         else dp.total_litros / nullif(l.mz_regadas, 0)
              * (public.fn_numero_de_texto(m.concentracion) / 100.0) end as producto_puro_litros,
    case when dp.fase = '4_Lavado' then null
         else public.fn_ppm_desinfeccion(dp.total_litros, m.concentracion,
                                         e.horas_inyeccion, e.caudal_agua, l.mz_regadas) end as ppm_calculada
from public.desinfeccion_ejecucion_productos dp
join public.desinfeccion_ejecucion e on e.id = dp.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
join public.materiales m             on m.id = dp.producto_id
left join lateral (
    select sum(x.mz_cubiertas) as mz_regadas
    from public.desinfeccion_ejecucion_lotes x
    where x.ejecucion_id = e.id
) l on true;

alter view interno.v_desinfeccion_productos_crudo set (security_invoker = off);

create view public.v_desinfeccion_productos as
select x.*
from interno.v_desinfeccion_productos_crudo x
where (select public.fn_permitido_de('desinfeccion_ejecucion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_ejecucion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_productos to authenticated;

/* ---------------------------- Ejecución ---------------------------- */

create view interno.v_desinfeccion_ejecucion_crudo as
select
    e.id,
    e.temporada_id,
    tm.nombre       as temporada_nombre,
    e.turno_id,
    tn.nombre       as turno_nombre,
    tn.codigo       as turno_codigo,
    tn.zona_id,
    z.nombre        as zona_nombre,
    e.ciclo,
    e.estado,
    e.fecha_preriego,
    e.hora_inicio_preriego,
    e.hora_fin_preriego,
    e.horas_preriego,
    e.obs_preriego,
    e.fecha_lecturas,
    e.lecturas_tensiometro,
    e.fecha_aplicacion,
    e.fecha_lavado,
    e.estacion_riego_id,
    er.nombre       as estacion_riego_nombre,
    e.inicio_presurizacion,
    e.fin_presurizacion,
    e.horas_presurizacion,
    e.hora_inicio_iny,
    e.hora_fin_iny,
    e.horas_inyeccion,
    e.hora_inicio_lavado,
    e.hora_fin_lavado,
    e.horas_lavado,
    e.total_horas_riego,
    e.caudal_agua,
    coalesce(e.horas_inyeccion, 0) * e.caudal_agua as agua_total_m3,
    e.ce_antes,
    e.ce_durante,
    e.ce_despues,
    e.calibracion_entrada,
    e.calibracion_salida,
    e.calibracion_campo,
    coalesce(l.mz_regadas, 0)     as mz_regadas,
    coalesce(l.lotes_regados, 0)  as lotes_regados,
    coalesce(pr.costo_preriego, 0)   as costo_personal_preriego,
    coalesce(pr.costo_aplicacion, 0) as costo_personal_aplicacion,
    -- La cuadrilla que CIERRA el turno, aparte: sin esto el costo del
    -- lavado quedaba escondido dentro del de la aplicación.
    coalesce(pr.costo_lavado, 0)     as costo_personal_lavado,
    coalesce(pr.costo_total, 0)      as costo_personal,
    -- Los costos sí suman las dos fases de químico: el lavado se paga.
    coalesce(q.costo_quimico, 0)  as costo_quimico,
    coalesce(q.productos, 0)      as productos,
    q.productos_nombres,
    coalesce(q.envases, 0)        as envases,
    -- Las ppm, en cambio, sólo de la APLICACIÓN. El enjuague no tiene.
    q.ppm_principal,
    e.usuario_id,
    pf.nombre       as usuario_nombre,
    e.created_at
from public.desinfeccion_ejecucion e
join public.temporadas tm   on tm.id = e.temporada_id
join public.turnos tn       on tn.id = e.turno_id
left join public.zonas z    on z.id = tn.zona_id
left join public.estaciones_riego er on er.id = e.estacion_riego_id
left join public.perfiles pf on pf.id = e.usuario_id
left join lateral (
    select sum(x.mz_cubiertas) as mz_regadas, count(*) as lotes_regados
    from public.desinfeccion_ejecucion_lotes x
    where x.ejecucion_id = e.id
) l on true
left join lateral (
    select
        sum(x.costo_total) filter (where x.fase = '1_Preriego')   as costo_preriego,
        sum(x.costo_total) filter (where x.fase = '3_Aplicacion') as costo_aplicacion,
        sum(x.costo_total) filter (where x.fase = '4_Lavado')     as costo_lavado,
        sum(x.costo_total)                                        as costo_total
    from public.desinfeccion_personal x
    where x.ejecucion_id = e.id
) pr on true
left join lateral (
    select
        sum(x.costo_total)        as costo_quimico,
        count(*)                  as productos,
        sum(x.cantidad_envases)   as envases,
        string_agg(mm.descripcion, ', ' order by mm.descripcion) as productos_nombres,
        (array_agg(
            public.fn_ppm_desinfeccion(x.total_litros, mm.concentracion,
                                       e.horas_inyeccion, e.caudal_agua, l.mz_regadas)
            order by x.total_litros desc nulls last
         ) filter (where x.fase = '3_Aplicacion'))[1] as ppm_principal
    from public.desinfeccion_ejecucion_productos x
    join public.materiales mm on mm.id = x.producto_id
    where x.ejecucion_id = e.id
) q on true;

alter view interno.v_desinfeccion_ejecucion_crudo set (security_invoker = off);

create view public.v_desinfeccion_ejecucion as
select x.*
from interno.v_desinfeccion_ejecucion_crudo x
where (select public.fn_permitido_de('desinfeccion_ejecucion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_ejecucion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_ejecucion to authenticated;

/* ------------------------------ Costos ----------------------------- */

create view interno.v_desinfeccion_costos_crudo as
with regado as (
    select dl.lote_temporada_id, dl.ejecucion_id, e.temporada_id,
           lt.zona_id, dl.mz_cubiertas
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.lotes_temporada lt on lt.id = dl.lote_temporada_id
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
           sum(costo_total) as costo_personal,
           sum(costo_total) filter (where fase = '1_Preriego')   as costo_preriego,
           sum(costo_total) filter (where fase = '3_Aplicacion') as costo_aplicacion,
           sum(costo_total) filter (where fase = '4_Lavado')     as costo_lavado
    from public.desinfeccion_personal group by ejecucion_id
),
quimico as (
    select ejecucion_id, sum(costo_total) as costo_quimico
    from public.desinfeccion_ejecucion_productos group by ejecucion_id
)
select
    r.lote_temporada_id,
    lo.nomenclatura as lote_nomenclatura,
    lo.nombre       as lote_nombre,
    r.temporada_id,
    tm.nombre       as temporada_nombre,
    r.zona_id,
    z.nombre        as zona_nombre,
    sum(r.mz_cubiertas) as mz_regadas,
    sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_quimico,
    sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal,
    sum(coalesce(pr.costo_preriego, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_preriego,
    sum(coalesce(pr.costo_aplicacion, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_aplicacion,
    sum(coalesce(pr.costo_lavado, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_lavado,
    max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas) as costo_logistica,
    sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas) as costo_total,
    (sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0))
      + max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas))
      / nullif(sum(r.mz_cubiertas), 0) as costo_mz
from regado r
join public.lotes_temporada lt on lt.id = r.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
join public.temporadas tm      on tm.id = r.temporada_id
left join public.zonas z       on z.id = r.zona_id
left join por_ejecucion pe_ on pe_.ejecucion_id = r.ejecucion_id
left join por_zona pz on pz.temporada_id = r.temporada_id and pz.zona_id is not distinct from r.zona_id
left join bolsa b     on b.temporada_id = r.temporada_id and b.zona_id is not distinct from r.zona_id
left join personal pr on pr.ejecucion_id = r.ejecucion_id
left join quimico qu  on qu.ejecucion_id = r.ejecucion_id
group by r.lote_temporada_id, lo.nomenclatura, lo.nombre, r.temporada_id, tm.nombre, r.zona_id, z.nombre;

alter view interno.v_desinfeccion_costos_crudo set (security_invoker = off);

create view public.v_desinfeccion_costos as
select x.*
from interno.v_desinfeccion_costos_crudo x
where (select public.fn_permitido_de('desinfeccion_reporte', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_reporte', 'ver'))
      when 'global'      then true
      -- Un costo por lote no tiene dueño: el alcance «propietario» sobre
      -- un agregado no puede recortar por ahí, así que no enseña nada.
      when 'propietario' then false
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_costos to authenticated;

/* ------------------------- Informe ejecutivo ------------------------ */

create view interno.v_desinfeccion_informe_crudo as
with regado as (
    select dl.lote_temporada_id, e.ciclo, e.temporada_id, lt.zona_id, dl.ejecucion_id,
           dl.mz_cubiertas, e.fecha_preriego, e.fecha_aplicacion, e.fecha_lavado,
           e.caudal_agua, e.horas_preriego, e.horas_inyeccion, e.horas_lavado,
           e.total_horas_riego, e.estado, e.usuario_id
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.lotes_temporada lt on lt.id = dl.lote_temporada_id
),
plan as (
    select p.lote_temporada_id, p.ciclo,
           min(p.fecha_siembra_congelada) as fecha_siembra_plan,
           min(p.fecha_aplicacion)        as fecha_aplicacion_plan,
           max(p.area_planificada_mz)     as mz_planificadas,
           sum(p.dosis_mz)                as dosis_mz_plan,
           sum(p.total_litros)            as litros_plan,
           sum(p.total_costo)             as costo_plan,
           count(*)                       as lineas_plan
    from public.desinfeccion_plan p
    group by p.lote_temporada_id, p.ciclo
),
siembra as (
    select lt.id as lote_temporada_id,
           coalesce(r.ciclo, p.ciclo) as ciclo,
           coalesce(r.fecha_siembra, p.fecha_siembra) as fecha_siembra,
           case when r.fecha_siembra is not null then 'real' else 'plan' end as origen_siembra,
           coalesce(r.variedad, p.variedad) as variedad
    from public.lotes_temporada lt
    left join lateral (
        select distinct on (s.ciclo) s.ciclo, s.fecha_siembra, v.nombre as variedad
        from public.siembras s left join public.variedades v on v.id = s.variedad_id
        where s.lote_temporada_id = lt.id order by s.ciclo, s.fecha_siembra
    ) r on true
    left join lateral (
        select distinct on (ps.ciclo) ps.ciclo, ps.fecha_siembra, v.nombre as variedad
        from public.planes_siembra ps left join public.variedades v on v.id = ps.variedad_id
        where ps.lote_temporada_id = lt.id and ps.fecha_siembra is not null
        order by ps.ciclo, ps.fecha_siembra
    ) p on true
),
quimicos as (
    select
        x.ejecucion_id,
        -- El COSTO suma las dos fases: el lavado se paga.
        sum(x.costo_total) as costo_quimico,
        count(*)           as productos,
        -- Los LITROS que se comparan contra el plan, sólo de aplicación:
        -- el plan no tiene línea de lavado, y sumarle el enjuague
        -- inventaría una sobredosis contra un plan que nunca lo previó.
        sum(x.total_litros) filter (where x.fase = '3_Aplicacion') as litros_aplicados,
        (array_agg(x.ppm_calculada order by x.total_litros desc nulls last)
            filter (where x.fase = '3_Aplicacion'))[1] as ppm_principal,
        public.fn_limpiar_objetivos(
            array(select unnest(array_agg(o.obj) filter (where x.fase = '3_Aplicacion')))
        ) as objetivos,
        jsonb_agg(jsonb_build_object(
            'codigo', x.producto_codigo, 'nombre', x.producto_nombre,
            'concentracion', x.concentracion, 'fase', x.fase,
            'objetivos', to_jsonb(x.objetivos_control),
            'litros', x.total_litros, 'dosis_mz', x.dosis_mz,
            'ppm', x.ppm_calculada, 'costo', x.costo_total
        ) order by x.total_litros desc nulls last) as detalle
    from interno.v_desinfeccion_productos_crudo x
    left join lateral unnest(
        case when coalesce(array_length(x.objetivos_control, 1), 0) = 0
             then array[null::text] else x.objetivos_control end
    ) o(obj) on true
    group by x.ejecucion_id
),
personal as (
    select pe.ejecucion_id,
           sum(pe.costo_total) as costo_personal,
           sum(pe.costo_total) filter (where pe.fase = '1_Preriego')   as costo_preriego,
           sum(pe.costo_total) filter (where pe.fase = '3_Aplicacion') as costo_aplicacion,
           sum(pe.costo_total) filter (where pe.fase = '4_Lavado')     as costo_lavado
    from public.desinfeccion_personal pe group by pe.ejecucion_id
),
por_ejecucion as (
    select ejecucion_id, sum(mz_cubiertas) as mz_total
    from public.desinfeccion_ejecucion_lotes group by ejecucion_id
),
por_zona as (
    select temporada_id, zona_id, sum(mz_cubiertas) as mz_zona from regado
    group by temporada_id, zona_id
),
bolsa as (
    select temporada_id, zona_id, sum(costo_total) as bolsa_zona
    from public.desinfeccion_logistica group by temporada_id, zona_id
)
select
    r.lote_temporada_id,
    r.ciclo,
    lo.nomenclatura as lote_nomenclatura,
    lo.nombre       as lote_nombre,
    r.zona_id,
    z.nombre        as zona_nombre,
    r.temporada_id,
    tm.nombre       as temporada_nombre,
    min(r.usuario_id::text)::uuid as usuario_id,
    max(pl.fecha_siembra_plan)    as fecha_siembra_plan,
    max(pl.fecha_aplicacion_plan) as fecha_aplicacion_plan,
    min(r.fecha_preriego)         as fecha_preriego,
    min(r.fecha_aplicacion)       as fecha_aplicacion,
    max(r.fecha_lavado)           as fecha_lavado,
    max(sb.fecha_siembra)         as fecha_siembra,
    max(sb.origen_siembra)        as origen_siembra,
    max(sb.variedad)              as variedad,
    min(r.fecha_preriego)   - max(sb.fecha_siembra) as ddt_preriego,
    min(r.fecha_aplicacion) - max(sb.fecha_siembra) as ddt_aplicacion,
    max(r.fecha_lavado)     - max(sb.fecha_siembra) as ddt_lavado,
    max(pl.fecha_aplicacion_plan) - max(sb.fecha_siembra) as ddt_plan,
    sum(r.mz_cubiertas)        as mz_regadas,
    max(pl.mz_planificadas)    as mz_planificadas,
    max(pl.dosis_mz_plan)      as dosis_mz_plan,
    sum(qu.litros_aplicados) / nullif(sum(r.mz_cubiertas), 0) as dosis_mz_real,
    max(r.caudal_agua)         as caudal_agua,
    sum(r.total_horas_riego)   as horas_riego,
    (array_agg(qu.ppm_principal order by r.mz_cubiertas desc nulls last))[1] as ppm_principal,
    public.fn_limpiar_objetivos(array(select unnest(array_agg(qu.objetivos)))) as objetivos_control,
    jsonb_agg(coalesce(qu.detalle, '[]'::jsonb)) as productos,
    max(r.estado::text) as estado,
    sum(coalesce(qu.costo_quimico, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_quimico,
    sum(coalesce(pr.costo_personal, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal,
    sum(coalesce(pr.costo_preriego, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_preriego,
    sum(coalesce(pr.costo_aplicacion, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_aplicacion,
    sum(coalesce(pr.costo_lavado, 0) * r.mz_cubiertas / nullif(pe_.mz_total, 0)) as costo_personal_lavado,
    max(coalesce(b.bolsa_zona, 0) / nullif(pz.mz_zona, 0)) * sum(r.mz_cubiertas) as costo_logistica,
    max(pl.costo_plan) as costo_plan
from regado r
join public.lotes_temporada lt on lt.id = r.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
join public.temporadas tm      on tm.id = r.temporada_id
left join public.zonas z       on z.id = r.zona_id
left join por_ejecucion pe_ on pe_.ejecucion_id = r.ejecucion_id
left join quimicos qu       on qu.ejecucion_id = r.ejecucion_id
left join personal pr       on pr.ejecucion_id = r.ejecucion_id
left join por_zona pz on pz.temporada_id = r.temporada_id and pz.zona_id is not distinct from r.zona_id
left join bolsa b     on b.temporada_id = r.temporada_id and b.zona_id is not distinct from r.zona_id
left join plan pl    on pl.lote_temporada_id = r.lote_temporada_id and pl.ciclo = r.ciclo
left join siembra sb on sb.lote_temporada_id = r.lote_temporada_id and sb.ciclo = r.ciclo
group by r.lote_temporada_id, r.ciclo, lo.nomenclatura, lo.nombre, r.zona_id, z.nombre,
         r.temporada_id, tm.nombre;

alter view interno.v_desinfeccion_informe_crudo set (security_invoker = off);

create view public.v_desinfeccion_informe_ejecutivo as
select
    x.*,
    x.costo_quimico + x.costo_personal + x.costo_logistica as costo_total,
    (x.costo_quimico + x.costo_personal + x.costo_logistica)
        / nullif(x.mz_regadas, 0) as costo_mz,
    case when x.costo_plan is null then null
         else x.costo_quimico + x.costo_personal + x.costo_logistica - x.costo_plan
    end as delta_costo,
    case when coalesce(x.costo_plan, 0) = 0 then null
         else (x.costo_quimico + x.costo_personal + x.costo_logistica - x.costo_plan)
              * 100.0 / x.costo_plan
    end as delta_costo_pct,
    case when x.dosis_mz_plan is null then null
         else x.dosis_mz_real - x.dosis_mz_plan end as delta_dosis,
    case when coalesce(x.dosis_mz_plan, 0) = 0 then null
         else (x.dosis_mz_real - x.dosis_mz_plan) * 100.0 / x.dosis_mz_plan
    end as delta_dosis_pct,
    -- Tres fases con cuadrilla desde la 74. El empate se resuelve por el
    -- orden del flujo, que es el orden en que se mira el turno.
    case
        when coalesce(x.costo_personal_preriego, 0) = 0
         and coalesce(x.costo_personal_aplicacion, 0) = 0
         and coalesce(x.costo_personal_lavado, 0) = 0 then null
        when coalesce(x.costo_personal_preriego, 0) >= coalesce(x.costo_personal_aplicacion, 0)
         and coalesce(x.costo_personal_preriego, 0) >= coalesce(x.costo_personal_lavado, 0)
            then 'Preriego'
        when coalesce(x.costo_personal_aplicacion, 0) >= coalesce(x.costo_personal_lavado, 0)
            then 'Aplicación'
        else 'Lavado de cinta'
    end as fase_mas_cara
from interno.v_desinfeccion_informe_crudo x
where (select public.fn_permitido_de('desinfeccion_reporte', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_reporte', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_informe_ejecutivo to authenticated;

-- =====================================================================
-- F · UNA PUERTA ENTORNADA QUE VENÍA DE ANTES
-- =====================================================================
--
-- Al escribir los guardianes salió algo que esta migración no causó:
-- DOCE vistas de `interno` —las de labores, siembras, rotación, lotes,
-- contadores, telecom y riego— llevan un `grant select … to
-- authenticated` explícito. Son anteriores al patrón de la 56/57.
--
-- Hoy no se pueden leer, porque `authenticated` no tiene `usage` sobre
-- el esquema y sin eso no se llega a la tabla. Pero es una puerta
-- entornada: **el día que alguien conceda `usage` —por una migración,
-- por una herramienta, por descuido— esas doce quedan abiertas sin
-- reja**, y nadie se enteraría, porque el fallo no da error: da datos.
--
-- Se quita el permiso. No hace falta para nada: las vistas públicas son
-- de `postgres` y corren con los derechos de su dueño, que es justamente
-- lo que el patrón busca. Con esto el sello es doble y no simple.
revoke select on all tables in schema interno from authenticated;
revoke all on schema interno from authenticated;

-- =====================================================================
-- G · LOS GUARDIANES
-- =====================================================================
-- Recrear cinco parejas de vistas es exactamente el momento en que se
-- pierde una reja sin que nadie lo note. Nada de esto es decorativo.

do $$
declare
    v_falta text;
    v_def   text;
begin
    /* ---- 1 · El esquema interno sigue cerrado a cal y canto ---- */
    if has_schema_privilege('authenticated', 'interno', 'usage') then
        raise exception 'authenticated ganó USAGE sobre interno: la puerta de atrás quedó abierta.';
    end if;

    select string_agg(c.relname, ', ')
      into v_falta
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'interno' and c.relkind = 'v'
       and has_table_privilege('authenticated', c.oid, 'select');
    if v_falta is not null then
        raise exception 'authenticated puede leer vistas crudas de interno: %', v_falta;
    end if;

    /* ---- 2 · Las crudas siguen con security_invoker apagado ---- */
    select string_agg(c.relname, ', ')
      into v_falta
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'interno' and c.relkind = 'v'
       and c.relname in ('v_desinfeccion_personal_crudo', 'v_desinfeccion_productos_crudo',
                         'v_desinfeccion_ejecucion_crudo', 'v_desinfeccion_costos_crudo',
                         'v_desinfeccion_informe_crudo')
       and coalesce(array_to_string(c.reloptions, ','), '') !~ 'security_invoker=off';
    if v_falta is not null then
        raise exception 'Vistas crudas sin security_invoker=off: %', v_falta;
    end if;

    /* ---- 3 · Cada vista pública conserva su reja canónica ---- */
    for v_def in
        select c.relname
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'v'
           and c.relname in ('v_desinfeccion_personal', 'v_desinfeccion_productos',
                             'v_desinfeccion_ejecucion', 'v_desinfeccion_costos',
                             'v_desinfeccion_informe_ejecutivo')
    loop
        if pg_get_viewdef(('public.' || v_def)::regclass, true) !~ 'fn_permitido_de' then
            raise exception 'La vista %: se quedó sin puerta de pantalla.', v_def;
        end if;
        if pg_get_viewdef(('public.' || v_def)::regclass, true) !~ 'fn_mi_alcance' then
            raise exception 'La vista %: se quedó sin alcance.', v_def;
        end if;
        if pg_get_viewdef(('public.' || v_def)::regclass, true) !~ 'fn_ve_zona_estricta' then
            raise exception 'La vista %: se quedó sin reja zonal estricta.', v_def;
        end if;
        if not has_table_privilege('authenticated', ('public.' || v_def)::regclass, 'select') then
            raise exception 'La vista %: el navegador no la puede leer.', v_def;
        end if;
    end loop;

    /* ---- 4 · Lo que esta migración viene a traer ---- */
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
                      and column_name = 'fecha_lavado') then
        raise exception 'Falta desinfeccion_ejecucion.fecha_lavado.';
    end if;

    if (select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'desinfeccion_personal'
           and column_name = 'cantidad_personas') <> 'numeric' then
        raise exception 'cantidad_personas volvió a ser entera: 0.33 personas dejaría de poder anotarse.';
    end if;

    if not exists (select 1 from pg_constraint con join pg_class c on c.oid = con.conrelid
                    where c.relname = 'desinfeccion_personal'
                      and con.conname = 'desinfeccion_personal_cantidad_personas_check'
                      and pg_get_constraintdef(con.oid) ~ '500') then
        raise exception 'Falta el tope de 500 personas: un dedo resbalado multiplicaría el turno.';
    end if;

    -- Nada puede impedir el puesto nuevo. Hoy `puesto_texto` es texto
    -- libre; si alguien le pone una lista cerrada, que se entere aquí.
    if exists (select 1 from pg_constraint con join pg_class c on c.oid = con.conrelid
                where c.relname = 'desinfeccion_personal' and con.contype = 'c'
                  and pg_get_constraintdef(con.oid) ilike '%puesto_texto%'
                  and pg_get_constraintdef(con.oid) not ilike '%Operador de Riego%') then
        raise exception 'Hay un CHECK sobre puesto_texto que no admite «Operador de Riego».';
    end if;

    if not exists (select 1 from pg_indexes where schemaname = 'public'
                    and indexname = 'desinfeccion_productos_ejec_fase_prod_uidx') then
        raise exception 'Falta la llave única con la fase: el mismo químico en dos fases chocaría.';
    end if;

    if exists (select 1 from pg_constraint con join pg_class c on c.oid = con.conrelid
                where c.relname = 'desinfeccion_ejecucion_productos'
                  and con.conname = 'desinfeccion_ejecucion_productos_ejecucion_id_producto_id_key') then
        raise exception 'La llave vieja sin fase sigue viva: impediría lavar con el mismo ácido.';
    end if;

    if pg_get_functiondef('public.fn_objetivos_por_omision()'::regprocedure) !~ '4_Lavado' then
        raise exception 'El lavado volvió a heredar objetivos de control del catálogo.';
    end if;

    -- La puerta de atrás: un UPDATE sobre una línea ya guardada.
    if pg_get_functiondef('public.fn_objetivos_fase()'::regprocedure) !~ '4_Lavado' then
        raise exception 'Un UPDATE puede volver a meterle objetivos a una línea de lavado.';
    end if;

    -- Y la función compartida se queda GENÉRICA: `materiales` no tiene
    -- fase, y nombrarla allí revienta el alta del catálogo entero.
    if pg_get_functiondef('public.fn_objetivos_en_orden()'::regprocedure) ~ 'new\.fase' then
        raise exception 'fn_objetivos_en_orden nombra la fase: materiales no la tiene y el alta revienta.';
    end if;

    if pg_get_functiondef('public.fn_desinfeccion_costo_personal()'::regprocedure) !~ 'round' then
        raise exception 'El costo de personal dejó de redondearse: el papel y la pantalla discreparían.';
    end if;
end $$;
