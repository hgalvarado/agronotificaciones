-- =====================================================================
-- 64 · EL CAUDAL, LA TASA DE LA TEMPORADA Y LAS PARTES POR MILLÓN
-- =====================================================================
--
--   A · **LA TASA DE CAMBIO ESTABA EN EL SITIO EQUIVOCADO.** `fn_precio_material`
--       convertía los dólares con `fn_tasa_cambio`, que lee el catálogo
--       `catalogo_tasas_cambio` de la 59 — una tabla que en la
--       instalación está VACÍA. Resultado: para un químico comprado en
--       dólares la función devolvía NULO y la pantalla, que no rellena
--       con nulos, se quedaba quieta. De ahí el «no reacciona».
--
--       La tasa que la finca registra a mano es la de la TEMPORADA, así
--       que ahí es donde hay que leerla.
--
--   B · **EL CAUDAL.** Hasta ahora las partes por millón se escribían a
--       mano porque faltaba el caudal del agua (lo dijo la 59 con todas
--       sus letras). Ya no falta: se captura por turno.
--
--   C · **LAS PARTES POR MILLÓN, CALCULADAS.** La vista de químicos las
--       deduce con la misma fórmula que la pantalla, para que el reporte
--       y la captura no puedan discrepar.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · LA TASA DE CAMBIO DE LA TEMPORADA
-- =====================================================================
-- Nullable y SIN valor por omisión, a propósito. Un 25 de fábrica
-- costearía en silencio toda una temporada con una tasa que nadie
-- escribió, y un costo con una tasa inventada es peor que un hueco: el
-- hueco se ve.

alter table public.temporadas
    add column if not exists tasa_hnl_usd numeric(12,4)
        check (tasa_hnl_usd is null or tasa_hnl_usd > 0);

comment on column public.temporadas.tasa_hnl_usd is
    'Lempiras por dólar que rigen esta temporada. Se registra a mano; de aquí sale la conversión de los químicos importados.';

-- Semilla de cortesía: si el catálogo de tasas de la 59 tiene una para
-- el arranque de la temporada, se hereda. Corre una sola vez —sólo
-- rellena lo que está nulo— para no pisar lo que alguien ya escribió.
update public.temporadas t
   set tasa_hnl_usd = public.fn_tasa_cambio(t.fecha_inicio)
 where t.tasa_hnl_usd is null
   and public.fn_tasa_cambio(t.fecha_inicio) is not null;

/**
 * La tasa que rige una fecha, mirando primero a la TEMPORADA.
 *
 * Orden, y el orden es la decisión:
 *
 *   1. La tasa escrita a mano en la temporada que se pasa, o —si no se
 *      pasa— en la que contiene la fecha. Es la que la finca registra y
 *      la que manda.
 *   2. El catálogo `catalogo_tasas_cambio` de la 59, por si alguien lo
 *      alimenta: una tasa por fecha es más fina que una por temporada.
 *   3. Nulo. No se inventa un 25.
 *
 * La temporada gana al catálogo porque es lo que el encargo pide y
 * porque es lo que de verdad se mantiene: una tabla que nadie llena no
 * puede gobernar el costo de nada.
 */
create or replace function public.fn_tasa_de_temporada(
    p_fecha date,
    p_temporada_id uuid default null
)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(
        (select t.tasa_hnl_usd
           from public.temporadas t
          where (p_temporada_id is not null and t.id = p_temporada_id)
             or (p_temporada_id is null
                 and p_fecha between t.fecha_inicio and coalesce(t.fecha_fin, p_fecha))
          order by t.fecha_inicio desc
          limit 1),
        public.fn_tasa_cambio(p_fecha)
    )
$$;

grant execute on function public.fn_tasa_de_temporada(date, uuid) to authenticated;

-- Las vistas que la nombran se van ANTES de soltar la función vieja, y
-- se rehacen enteras más abajo. Sin esto, `drop function` se lleva por
-- delante lo que no sabe que depende de ella — o falla, que es peor a
-- mitad de una migración.
drop view if exists public.v_desinfeccion_productos;
drop view if exists interno.v_desinfeccion_productos_crudo;

-- **Y hay que soltar la de DOS argumentos.** `create or replace` con un
-- argumento más no reemplaza: crea una segunda función con el mismo
-- nombre, y entonces `fn_precio_material(x, y)` deja de resolverse —
-- «function is not unique»— y el disparador y la pantalla se caen a la
-- vez. Una sobrecarga que sólo añade un parámetro con valor por omisión
-- es siempre ambigua con la que no lo tiene.
drop function if exists public.fn_precio_material(uuid, date);

/**
 * El precio de un material en una fecha, YA EN LEMPIRAS.
 *
 * Mismo contrato de siempre —dos argumentos, sigue sirviendo a las
 * vistas y al disparador— más un tercero opcional con la temporada, que
 * es lo que la pantalla y el disparador SÍ saben y la fecha sola no
 * puede decir cuando dos temporadas se solapan.
 *
 * Si el precio está en dólares y no hay tasa por ningún lado devuelve
 * nulo. Es lo mismo que hacía antes; lo que cambia es que ahora hay un
 * sitio donde poner la tasa que la finca de verdad usa.
 */
create or replace function public.fn_precio_material(
    p_material_id uuid,
    p_fecha date,
    p_temporada_id uuid default null
)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when h.moneda = 'USD'
            then h.precio_unitario * public.fn_tasa_de_temporada(p_fecha, p_temporada_id)
        else h.precio_unitario
    end
    from public.historial_precios_materiales h
    where h.material_id = p_material_id
      and h.fecha_inicio <= p_fecha
      and (h.fecha_fin is null or h.fecha_fin >= p_fecha)
    order by h.fecha_inicio desc
    limit 1
$$;

grant execute on function public.fn_precio_material(uuid, date, uuid) to authenticated;

/**
 * Por qué NO hay precio, cuando no lo hay.
 *
 * La pantalla se quedaba muda: elegías el químico y el costo seguía en
 * blanco, sin decir si es que el material no tiene precio, si es que
 * ninguno cubre esa fecha, o si es que está en dólares y falta la tasa.
 * Tres causas distintas con tres arreglos distintos, y la misma celda
 * vacía para las tres.
 *
 * Devuelve el precio y, cuando no hay, el motivo. Un hueco explicado es
 * una tarea; un hueco mudo es una llamada de teléfono.
 */
create or replace function public.fn_precio_material_detalle(
    p_material_id uuid,
    p_fecha date,
    p_temporada_id uuid default null
)
returns table (precio numeric, moneda text, motivo text)
language sql stable security definer set search_path = public, pg_temp as $$
    with vigente as (
        select h.*
        from public.historial_precios_materiales h
        where h.material_id = p_material_id
          and h.fecha_inicio <= p_fecha
          and (h.fecha_fin is null or h.fecha_fin >= p_fecha)
        order by h.fecha_inicio desc
        limit 1
    ),
    tasa as (select public.fn_tasa_de_temporada(p_fecha, p_temporada_id) as v)
    select
        case
            when v.moneda = 'USD' then v.precio_unitario * tasa.v
            else v.precio_unitario
        end,
        v.moneda,
        case
            when v.moneda = 'USD' and tasa.v is null then 'sin_tasa'
            else null
        end
    from vigente v cross join tasa
    union all
    -- Sin fila vigente hay que distinguir «este material no tiene
    -- precios» de «tiene, pero ninguno cubre ese día».
    select null::numeric, null::text,
           case when exists (select 1 from public.historial_precios_materiales h
                             where h.material_id = p_material_id)
                then 'fuera_de_vigencia'
                else 'sin_precio'
           end
    where not exists (select 1 from vigente)
$$;

grant execute on function public.fn_precio_material_detalle(uuid, date, uuid) to authenticated;

-- =====================================================================
-- B · EL CAUDAL DEL AGUA
-- =====================================================================
-- Metros cúbicos por hora que entrega la estación. Con 20 por omisión,
-- que es el caudal de la mayoría de las estaciones de la finca, y
-- editable: la que no da 20 se corrige en el turno.
--
-- Esta columna es lo que la 59 decía que faltaba para poder calcular las
-- partes por millón. Ya no falta.

alter table public.desinfeccion_ejecucion
    add column if not exists caudal_agua numeric(10,2) not null default 20
        check (caudal_agua >= 0);

comment on column public.desinfeccion_ejecucion.caudal_agua is
    'Metros cúbicos por hora de la estación. Con las horas de inyección y lavado da el agua total, que es el divisor de las ppm.';

-- =====================================================================
-- C · LAS PARTES POR MILLÓN
-- =====================================================================
/**
 * El número que lleva delante un porcentaje escrito a mano.
 *
 * `concentracion` es TEXTO en el catálogo —«42%», «42 %», «1,3%»— porque
 * así llega de la etiqueta del producto. Para calcular hace falta el
 * número, y sacarlo con una expresión regular en cada sitio que lo
 * necesite es garantizar que un día dos sitios lo saquen distinto.
 *
 * Nulo si no hay un número reconocible: no se asume 100.
 */
create or replace function public.fn_numero_de_texto(p_texto text)
returns numeric
language sql immutable as $$
    select nullif(regexp_replace(
               coalesce(substring(replace(p_texto, ',', '.') from '[0-9]+\.?[0-9]*'), ''),
               '^$', ''), '')::numeric
$$;

comment on function public.fn_numero_de_texto(text) is
    'El número que lleva delante un texto como «42%». Inmutable: la usan las vistas.';

grant execute on function public.fn_numero_de_texto(text) to authenticated;

/**
 * Las partes por millón de un químico aplicado.
 *
 *     agua_total_m3   = (horas_inyeccion + horas_lavado) × caudal
 *     producto_puro_L = litros × (ingrediente_activo% / 100)
 *     ppm             = producto_puro_L × 1000 / agua_total_m3
 *
 * **Por qué los mililitros por metro cúbico SON partes por millón.** Un
 * metro cúbico de agua pesa un millón de gramos y un mililitro de
 * producto pesa aproximadamente un gramo: la división ya viene en
 * millonésimas y no hace falta ningún factor más. Es la razón de que el
 * ×1000 esté ahí y de que no haya un ×1.000.000 por ningún lado.
 *
 * Sin agua devuelve nulo —no cero—: no es que la concentración sea cero,
 * es que todavía no se sabe entre cuánta agua se reparte.
 */
create or replace function public.fn_ppm_desinfeccion(
    p_litros numeric,
    p_concentracion text,
    p_horas_inyeccion numeric,
    p_horas_lavado numeric,
    p_caudal numeric
)
returns numeric
language sql immutable as $$
    select case
        when coalesce(p_caudal, 0) <= 0 then null
        when coalesce(p_horas_inyeccion, 0) + coalesce(p_horas_lavado, 0) <= 0 then null
        when public.fn_numero_de_texto(p_concentracion) is null then null
        else coalesce(p_litros, 0)
             * (public.fn_numero_de_texto(p_concentracion) / 100.0)
             * 1000.0
             / ((coalesce(p_horas_inyeccion, 0) + coalesce(p_horas_lavado, 0)) * p_caudal)
    end
$$;

comment on function public.fn_ppm_desinfeccion(numeric, text, numeric, numeric, numeric) is
    'Partes por millón de un químico: producto puro en cc entre el agua total en m3. Los cc por m3 YA son ppm.';

grant execute on function public.fn_ppm_desinfeccion(numeric, text, numeric, numeric, numeric)
    to authenticated;

-- ------------------- La vista de químicos, otra vez -----------------
-- Se rehace entera porque las columnas nuevas van AL FINAL igual, pero
-- `create or replace view` no admite cambiar lo que ya hay y aquí se
-- añaden cuatro: el desglose del cálculo tiene que poder auditarse desde
-- el reporte, no sólo desde la pantalla.

create view interno.v_desinfeccion_productos_crudo as
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
        coalesce(e.fecha_aplicacion, e.fecha_preriego, current_date),
        e.temporada_id)                        as precio_catalogo,
    coalesce(l.mz_regadas, 0)                  as mz_regadas,
    dp.total_litros / nullif(l.mz_regadas, 0)  as dosis_mz,
    e.usuario_id, dp.created_at,

    /* ------------------------- El desglose ------------------------- */
    -- Las cinco piezas del cálculo, cada una en su columna. Guardar sólo
    -- el resultado obliga a rehacer la cuenta a mano para discutirlo, y
    -- lo que no se puede auditar no se discute: se cree o no se cree.
    e.caudal_agua,
    e.horas_inyeccion,
    e.horas_lavado,
    (coalesce(e.horas_inyeccion, 0) + coalesce(e.horas_lavado, 0)) * e.caudal_agua
                                               as agua_total_m3,
    dp.total_litros * (public.fn_numero_de_texto(m.concentracion) / 100.0)
                                               as producto_puro_litros,
    public.fn_ppm_desinfeccion(dp.total_litros, m.concentracion,
                               e.horas_inyeccion, e.horas_lavado, e.caudal_agua)
                                               as ppm_calculada
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

-- La reja de siempre: la parte de pantalla como InitPlan y la de fila
-- como predicado de columna (forma canónica de la 55).
create view public.v_desinfeccion_productos as
select x.* from interno.v_desinfeccion_productos_crudo x
where (select public.fn_permitido_de('desinfeccion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else x.usuario_id = (select auth.uid())
        or not (select public.fn_tiene_zonas())
        or x.zona_id in (select public.fn_mis_zonas())
  end;

grant select on public.v_desinfeccion_productos to authenticated;

-- La de ejecución gana el caudal, que la pantalla necesita al cargar un
-- turno ya capturado.
drop view if exists public.v_desinfeccion_ejecucion;
drop view if exists interno.v_desinfeccion_ejecucion_crudo;

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
    e.caudal_agua,
    (coalesce(e.horas_inyeccion, 0) + coalesce(e.horas_lavado, 0)) * e.caudal_agua
                                     as agua_total_m3,
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

create view public.v_desinfeccion_ejecucion as
select x.* from interno.v_desinfeccion_ejecucion_crudo x
where (select public.fn_permitido_de('desinfeccion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else true
  end;

grant select on public.v_desinfeccion_ejecucion to authenticated;

-- El disparador del costo ahora pasa la temporada, que él SÍ conoce: la
-- fecha sola no puede desempatar dos temporadas que se solapen.
create or replace function public.fn_desinfeccion_costo_producto()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_fecha     date;
    v_temporada uuid;
    v_precio    numeric;
begin
    if coalesce(new.costo_litro, 0) > 0 then
        return new;
    end if;

    select coalesce(e.fecha_aplicacion, e.fecha_preriego, current_date), e.temporada_id
      into v_fecha, v_temporada
      from public.desinfeccion_ejecucion e
     where e.id = new.ejecucion_id;

    v_precio := public.fn_precio_material(
        new.producto_id, coalesce(v_fecha, current_date), v_temporada);
    new.costo_litro := coalesce(v_precio, 0);
    return new;
end;
$$;

-- =====================================================================
-- D · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_falta text;
begin
    -- El encargo pide asegurarse de que el lavado sea generado. Lo es
    -- desde la 62, sobre `hora_inicio_lavado`/`hora_fin_lavado` y con
    -- `fn_horas_entre`. Aquí se comprueba en vez de rehacerlo: tocar una
    -- columna generada que ya está bien sólo puede empeorarla.
    select string_agg(column_name, ', ') into v_falta
    from information_schema.columns
    where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
      and column_name in ('horas_lavado', 'horas_inyeccion')
      and is_generated = 'NEVER';
    if v_falta is not null then
        raise exception 'Estas horas no son generadas y las ppm las necesitan: %', v_falta;
    end if;

    if (select pg_get_expr(d.adbin, d.adrelid)
          from pg_attrdef d
          join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
         where d.adrelid = 'public.desinfeccion_ejecucion'::regclass
           and a.attname = 'horas_lavado') !~ 'fn_horas_entre'
    then
        raise exception 'horas_lavado dejó de usar fn_horas_entre: no cruzaría la medianoche.';
    end if;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
          and column_name = 'caudal_agua')
    then
        raise exception 'Falta caudal_agua.';
    end if;

    -- Dos `fn_precio_material` a la vez es una llamada ambigua que
    -- tumba el disparador y la pantalla de golpe.
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'fn_precio_material') <> 1
    then
        raise exception 'Hay más de una fn_precio_material: la llamada sería ambigua.';
    end if;

    -- Las ppm, con la cuenta del encargo: 2 h de inyección y 1 de lavado
    -- a 20 m3/h son 60 m3; 100 L al 42 % son 42 L de producto puro, o
    -- 42.000 cc; 42.000 / 60 = 700 ppm.
    if public.fn_ppm_desinfeccion(100, '42%', 2, 1, 20) <> 700 then
        raise exception 'La fórmula de ppm no da lo que debe: %',
            public.fn_ppm_desinfeccion(100, '42%', 2, 1, 20);
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

    if has_schema_privilege('authenticated', 'interno', 'usage') then
        raise exception 'authenticated puede entrar al esquema interno.';
    end if;
end $$;

-- =====================================================================
-- Qué NO hace esta migración, a propósito:
--
--   · No le pone valor por omisión a `temporadas.tasa_hnl_usd`. Una tasa
--     inventada costea en silencio; un hueco se ve. **Hay que escribirla
--     a mano en la temporada antes de que un químico en dólares traiga
--     su precio.**
--   · No toca la columna `ppm` de la cabecera, que es captura manual
--     desde la 59. Ahora que el caudal existe, la calculada por producto
--     la deja sin oficio: se retira cuando la finca confirme que el
--     número nuevo cuadra con el suyo.
--   · No toca el importador de Excel del módulo. Sigue pendiente.
-- =====================================================================
