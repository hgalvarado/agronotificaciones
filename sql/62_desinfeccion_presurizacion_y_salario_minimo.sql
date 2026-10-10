-- =====================================================================
-- 62 · DESINFECCIÓN — LA PRESURIZACIÓN EN RELOJ Y EL SALARIO MÍNIMO
--      MARCADO
-- =====================================================================
--
-- La 61 ya dejó resueltos el cruce de medianoche, los envases, el
-- ingrediente activo, el historial de precios, `es_jornal` y la
-- cuadrilla por fase. Lo que queda del encargo son dos cosas de base y
-- las dos son de la misma familia: **quitar los dos últimos sitios
-- donde un número se escribe a mano cuando la base podía calcularlo.**
--
--   A · La PRESURIZACIÓN deja de ser un número y pasa a ser un par de
--       horas, como el preriego, la inyección y el lavado. Con eso, las
--       cuatro fases del riego se capturan igual y ninguna puede
--       discrepar de las otras al cruzar la medianoche.
--   B · Se va `horas_lavado_manual`. La 61 la dejó como red para no
--       tirar lo ya capturado; cumplida esa función, dos entradas para
--       una sola salida son una ambigüedad que un día cuesta cara.
--   C · El SALARIO MÍNIMO se marca con una bandera en `puestos_trabajo`
--       en vez de buscarse por nombre. La 61 dejó esa búsqueda escrita
--       y señalada como frágil; esto es lo que ahí se prometió.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · LO QUE SE PIERDE, DICHO EN VOZ ALTA
-- =====================================================================
-- Un número de horas no se puede convertir en un par de horas de reloj:
-- «3.5 horas» no dice si fue de 22:00 a 01:30 o de 06:00 a 09:30. Así
-- que la migración no inventa horas. Lo que hace es CONTAR lo que se va
-- a perder y decirlo, para que quien corra esto sepa si tiene que
-- recapturar algo o si —como en una base recién instalada— no hay nada
-- que recapturar.

do $$
declare
    v_pres integer := 0;
    v_lav  integer := 0;
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
                 and column_name = 'horas_presurizacion' and is_generated = 'NEVER')
    then
        execute 'select count(*) from public.desinfeccion_ejecucion
                 where coalesce(horas_presurizacion, 0) <> 0' into v_pres;
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
                 and column_name = 'horas_lavado_manual')
    then
        execute 'select count(*) from public.desinfeccion_ejecucion
                 where coalesce(horas_lavado_manual, 0) <> 0
                   and (hora_inicio_lavado is null or hora_fin_lavado is null)' into v_lav;
    end if;

    if v_pres > 0 or v_lav > 0 then
        raise notice '62 · Se pierden números escritos a mano: % fila(s) con horas de presurización y % con horas de lavado sin reloj. Hay que recapturarlas con hora de inicio y fin.',
            v_pres, v_lav;
    else
        raise notice '62 · No hay horas escritas a mano que perder.';
    end if;
end $$;

-- =====================================================================
-- B · LA PRESURIZACIÓN, EN RELOJ
-- =====================================================================

-- La vista de ejecución nombra las tres columnas que se van. Es la única
-- que las nombra —las otras seis miran fechas y turnos, no horas—, así
-- que sólo se rehace ésa.
drop view if exists public.v_desinfeccion_ejecucion;
drop view if exists interno.v_desinfeccion_ejecucion_crudo;

alter table public.desinfeccion_ejecucion
    add column if not exists inicio_presurizacion time,
    add column if not exists fin_presurizacion    time;

comment on column public.desinfeccion_ejecucion.inicio_presurizacion is
    'Hora en que arrancó la presurización. Con su par calcula las horas, cruzando la medianoche.';

-- El orden importa: el total lee el lavado, el lavado lee el manual.
-- Se sueltan de afuera hacia adentro.
alter table public.desinfeccion_ejecucion drop column if exists total_horas_riego;
alter table public.desinfeccion_ejecucion drop column if exists horas_lavado;
alter table public.desinfeccion_ejecucion drop column if exists horas_lavado_manual;
alter table public.desinfeccion_ejecucion drop column if exists horas_presurizacion;

-- Una columna generada no puede leer otra generada: cada una repite su
-- expresión. Es el precio de que la base sea la única que calcula, y se
-- paga una vez aquí en vez de en cada pantalla que sume mal.
alter table public.desinfeccion_ejecucion
    add column horas_presurizacion numeric(10,2) generated always as (
        public.fn_horas_entre(inicio_presurizacion, fin_presurizacion)
    ) stored;

alter table public.desinfeccion_ejecucion
    add column horas_lavado numeric(10,2) generated always as (
        public.fn_horas_entre(hora_inicio_lavado, hora_fin_lavado)
    ) stored;

alter table public.desinfeccion_ejecucion
    add column total_horas_riego numeric(10,2) generated always as (
        public.fn_horas_entre(inicio_presurizacion, fin_presurizacion)
        + public.fn_horas_entre(hora_inicio_iny, hora_fin_iny)
        + public.fn_horas_entre(hora_inicio_lavado, hora_fin_lavado)
    ) stored;

comment on column public.desinfeccion_ejecucion.total_horas_riego is
    'Presurización + inyección + lavado, las tres por reloj y cruzando la medianoche. Generada.';

-- =====================================================================
-- C · EL SALARIO MÍNIMO, MARCADO
-- =====================================================================
-- La 61 lo buscaba por nombre («el puesto que se llame salario mínimo»)
-- y dejó dicho que eso se rompe el día que alguien renombre el puesto.
-- La bandera lo vuelve explícito: quien administra el catálogo decide
-- cuál es, y el nombre pasa a ser sólo un nombre.

alter table public.puestos_trabajo
    add column if not exists es_salario_minimo boolean not null default false;

comment on column public.puestos_trabajo.es_salario_minimo is
    'Marca el puesto cuya tarifa es el salario mínimo. De aquí sale el salario que propone la cuadrilla.';

-- La semilla corre UNA vez: hereda lo que la 61 adivinaba por nombre,
-- para que quien ya tenía el puesto creado no se quede sin propuesta.
-- Si ya hay uno marcado a mano, no se toca.
do $$
begin
    if not exists (select 1 from public.puestos_trabajo where es_salario_minimo) then
        update public.puestos_trabajo
           set es_salario_minimo = true
         where id = (
            select id from public.puestos_trabajo
             where lower(translate(coalesce(descripcion, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
                       like '%salario%minimo%'
                or lower(translate(coalesce(codigo, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
                       like '%salario%minimo%'
             order by activo desc, created_at
             limit 1);
    end if;
end $$;

-- Dos puestos marcados a la vez es una ambigüedad que nadie resuelve
-- después: cuál de los dos es el salario mínimo. El índice parcial deja
-- marcar exactamente uno.
create unique index if not exists puestos_salario_minimo_uidx
    on public.puestos_trabajo (es_salario_minimo) where es_salario_minimo;

/**
 * El salario mínimo vigente, por jornada.
 *
 * Ya no busca por nombre: sale del puesto MARCADO. Si no hay ninguno
 * marcado devuelve nulo —el formulario deja el campo vacío y la persona
 * lo escribe—, que es preferible a proponer un salario equivocado.
 */
create or replace function public.fn_salario_minimo_dia(p_fecha date)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select t.costo_hora * 8
    from public.tarifas_puesto t
    join public.puestos_trabajo pt on pt.id = t.puesto_trabajo_id
    where pt.es_salario_minimo
      and t.vigente_desde <= p_fecha
      and (t.vigente_hasta is null or t.vigente_hasta >= p_fecha)
    order by t.vigente_desde desc
    limit 1
$$;

grant execute on function public.fn_salario_minimo_dia(date) to authenticated;

-- =====================================================================
-- D · LA VISTA DE EJECUCIÓN, OTRA VEZ
-- =====================================================================
-- Idéntica a la de la 61 salvo por el par de horas nuevo: las columnas
-- que lee la pantalla no cambian de nombre, sólo se les suman las dos
-- horas de la presurización.

create schema if not exists interno;

create view interno.v_desinfeccion_ejecucion_crudo as
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
    e.inicio_presurizacion, e.fin_presurizacion, e.horas_presurizacion,
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

alter view interno.v_desinfeccion_ejecucion_crudo set (security_invoker = off);

-- La reja, con la misma forma canónica de la 55: la parte de pantalla
-- como InitPlan y la de fila como predicado de columna.
create view public.v_desinfeccion_ejecucion as
select x.* from interno.v_desinfeccion_ejecucion_crudo x
where (select public.fn_permitido_de('desinfeccion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else true
  end;

grant select on public.v_desinfeccion_ejecucion to authenticated;

-- =====================================================================
-- E · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_falta text;
begin
    -- Ninguna de las tres columnas de horas puede volver a ser escribible.
    select string_agg(column_name, ', ') into v_falta
    from information_schema.columns
    where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
      and column_name in ('horas_presurizacion', 'horas_lavado', 'total_horas_riego')
      and is_generated = 'NEVER';
    if v_falta is not null then
        raise exception 'Estas horas siguen escribiéndose a mano: %', v_falta;
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
                 and column_name = 'horas_lavado_manual')
    then
        raise exception 'La 62 no logró soltar horas_lavado_manual.';
    end if;

    if (select count(*) from public.puestos_trabajo where es_salario_minimo) > 1 then
        raise exception 'Hay más de un puesto marcado como salario mínimo.';
    end if;

    if not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'interno' and c.relname = 'v_desinfeccion_ejecucion_crudo')
    then
        raise exception 'La vista cruda de ejecución no se rehízo.';
    end if;

    if (select pg_get_viewdef('public.v_desinfeccion_ejecucion'::regclass, true))
       !~ 'fn_permitido_de'
    then
        raise exception 'v_desinfeccion_ejecucion se quedó sin reja de permiso.';
    end if;

    if has_schema_privilege('authenticated', 'interno', 'usage') then
        raise exception 'authenticated puede entrar al esquema interno.';
    end if;
end $$;

-- =====================================================================
-- Qué NO hace esta migración, a propósito:
--
--   · No toca el importador de Excel del módulo ni la fórmula de PPM:
--     quedan pedidos para después, y siguen anotados en la BITÁCORA.
--   · No adivina horas de reloj a partir de los números viejos. Ver A.
--   · No marca un puesto de salario mínimo si no había ninguno que se
--     llamara así: marcar el equivocado es peor que no proponer nada.
-- =====================================================================
