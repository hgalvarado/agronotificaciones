-- =====================================================================
-- 65 · EL HISTORIAL DE TASAS Y LAS PPM SOBRE LA DOSIS POR MANZANA
-- =====================================================================
--
--   A · **LA TASA, CON VIGENCIAS.** La 64 la puso como una columna suelta
--       en `temporadas`: un solo número por temporada y sin memoria. El
--       lempira se mueve dentro del año, así que un costo de marzo tiene
--       que cuadrarse con la tasa de marzo aunque en octubre sea otra.
--       Es el mismo patrón que ya tienen las tarifas de puesto y los
--       precios de material: versionar en vez de sobreescribir.
--
--   B · **LA COLUMNA `ppm` MANUAL SE VA.** Desde la 64 las ppm se
--       calculan por producto. Dos números con el mismo nombre en la
--       misma pantalla es la ambigüedad que un día cuesta una discusión.
--
--   C · **LAS PPM, SOBRE LA DOSIS POR MANZANA.** El encargo corrige la
--       variable de entrada: la cuenta parte de `dosis_mz`, no de los
--       litros totales.
--
--       ⚠ **LEER ESTO ANTES DE DAR EL NÚMERO POR BUENO.** Dimensionalmente
--       las dos fórmulas no dicen lo mismo, y la diferencia entre ellas
--       es exactamente las manzanas del turno:
--
--           con litros   → cc de producto / m³ de agua  = ppm
--           con dosis_mz → (cc/mz) / m³                 = ppm ÷ mz
--
--       Un turno de 10 mz da un número DIEZ VECES MENOR con la fórmula
--       nueva. Si el agua total del turno (`horas × caudal`) es el agua
--       que recibieron TODAS las manzanas, la concentración de esa agua
--       es la de arriba. Para que la de abajo sea una concentración, el
--       caudal tendría que ser el de UNA manzana.
--
--       Se implementa lo pedido porque la fórmula sale de la hoja de los
--       agrónomos y ellos saben qué mide su caudal. Queda escrito aquí y
--       en la BITÁCORA para que, si el número sale bajo, se sepa dónde
--       mirar sin tener que reconstruir esta conversación.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · EL HISTORIAL DE TASAS DE LA TEMPORADA
-- =====================================================================

/**
 * La tasa de cambio de una temporada, con su vigencia.
 *
 * Versionada por lo mismo que las tarifas de puesto y los precios de
 * material: un costo capturado en marzo no puede cambiar porque en
 * octubre se mueva el lempira. Sin vigencias, corregir la tasa de hoy
 * reescribiría el costo de todo lo ya capturado.
 */
create table if not exists public.historial_tasas_temporada (
    id           uuid primary key default gen_random_uuid(),
    temporada_id uuid not null references public.temporadas(id) on delete cascade,
    tasa_hnl_usd numeric(12,4) not null check (tasa_hnl_usd > 0),
    fecha_inicio date not null,
    -- Abierta por arriba: la vigente es la que no tiene fin.
    fecha_fin    date,
    comentario   text,
    created_at   timestamptz not null default now(),

    constraint historial_tasas_rango check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

comment on table public.historial_tasas_temporada is
    'Lempiras por dólar de cada temporada, con vigencia. De aquí sale la conversión de los químicos importados.';

-- Dos tasas de la misma temporada que arrancan el mismo día es una
-- ambigüedad que nadie resuelve después: cuál de las dos rige.
create unique index if not exists historial_tasas_uidx
    on public.historial_tasas_temporada (temporada_id, fecha_inicio);

create index if not exists historial_tasas_busqueda_idx
    on public.historial_tasas_temporada (temporada_id, fecha_inicio desc);

alter table public.historial_tasas_temporada enable row level security;

-- Leer es abierto, igual que el historial de precios de la 61: un costo
-- sin su tasa no se puede interpretar, y esconderla sólo consigue que el
-- reporte salga en blanco. Escribir va con el bloque donde viven las
-- temporadas.
drop policy if exists historial_tasas_select on public.historial_tasas_temporada;
create policy historial_tasas_select on public.historial_tasas_temporada for select
    using ((select auth.uid()) is not null);

drop policy if exists historial_tasas_write on public.historial_tasas_temporada;
create policy historial_tasas_write on public.historial_tasas_temporada for all
    using ((select public.fn_tiene_permiso('catalogo_cultivos', 'editar')))
    with check ((select public.fn_tiene_permiso('catalogo_cultivos', 'crear'))
             or (select public.fn_tiene_permiso('catalogo_cultivos', 'editar')));

-- La tasa suelta de la 64 se MUDA al historial antes de que la columna
-- desaparezca: quien ya la escribió no puede perderla por un cambio de
-- forma de la tabla. Arranca el día que arranca la temporada y queda
-- abierta, que es lo que significaba cuando era una columna.
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'temporadas'
                 and column_name = 'tasa_hnl_usd')
    then
        insert into public.historial_tasas_temporada
            (temporada_id, tasa_hnl_usd, fecha_inicio, comentario)
        select t.id, t.tasa_hnl_usd, t.fecha_inicio,
               'Heredada de la columna suelta de la 64'
          from public.temporadas t
         where t.tasa_hnl_usd is not null
           and not exists (select 1 from public.historial_tasas_temporada h
                           where h.temporada_id = t.id)
        on conflict (temporada_id, fecha_inicio) do nothing;
    end if;
end $$;

/**
 * La tasa que rige una fecha.
 *
 * Orden, y el orden es la decisión:
 *
 *   1. El HISTORIAL de la temporada —la que se pasa, o la que contiene
 *      la fecha—, tomando la vigencia que cubre ese día.
 *   2. Si ninguna vigencia lo cubre, la más reciente de esa temporada
 *      que haya empezado antes. Una tasa vieja es peor que una nueva,
 *      pero mucho mejor que un hueco: el costo se puede corregir, el
 *      hueco hay que investigarlo.
 *   3. El catálogo `catalogo_tasas_cambio` de la 59, por si alguien lo
 *      alimenta.
 *   4. Nulo. No se inventa un 25: una tasa inventada costea en silencio
 *      toda una temporada, y un hueco se ve.
 */
create or replace function public.fn_tasa_de_temporada(
    p_fecha date,
    p_temporada_id uuid default null
)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    with suyas as (
        select h.*
        from public.historial_tasas_temporada h
        where (p_temporada_id is not null and h.temporada_id = p_temporada_id)
           or (p_temporada_id is null and h.temporada_id in (
                 select t.id from public.temporadas t
                 where p_fecha between t.fecha_inicio and coalesce(t.fecha_fin, p_fecha)))
    )
    select coalesce(
        -- La vigencia que cubre el día.
        (select s.tasa_hnl_usd from suyas s
          where s.fecha_inicio <= p_fecha
            and (s.fecha_fin is null or s.fecha_fin >= p_fecha)
          order by s.fecha_inicio desc limit 1),
        -- O la última que empezó antes de ese día.
        (select s.tasa_hnl_usd from suyas s
          where s.fecha_inicio <= p_fecha
          order by s.fecha_inicio desc limit 1),
        public.fn_tasa_cambio(p_fecha)
    )
$$;

grant execute on function public.fn_tasa_de_temporada(date, uuid) to authenticated;

-- =====================================================================
-- B · LAS VISTAS, Y LA COLUMNA `ppm` QUE SE VA
-- =====================================================================
-- Las dos vistas que nombran `ppm` o el cálculo se sueltan antes de
-- tocar la columna, y se rehacen enteras al final.

drop view if exists public.v_desinfeccion_ejecucion;
drop view if exists interno.v_desinfeccion_ejecucion_crudo;
drop view if exists public.v_desinfeccion_productos;
drop view if exists interno.v_desinfeccion_productos_crudo;

-- Lo capturado a mano se DICE antes de tirarlo. En una base recién
-- instalada no hay nada; en la de la finca puede haber turnos con su ppm
-- escrita, y perderla en silencio es perder un dato que alguien anotó.
do $$
declare v_con integer := 0;
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
                 and column_name = 'ppm')
    then
        execute 'select count(*) from public.desinfeccion_ejecucion
                 where ppm is not null and ppm <> 0' into v_con;
        if v_con > 0 then
            raise notice '65 · Se retira la ppm manual de % turno(s). La calculada por producto la sustituye.', v_con;
        end if;
    end if;
end $$;

alter table public.desinfeccion_ejecucion drop column if exists ppm;

-- La columna suelta de la 64 también se va: su contenido ya está en el
-- historial. Dos sitios donde escribir la misma tasa es la ambigüedad
-- que un día deja un costo convertido con la tasa equivocada.
alter table public.temporadas drop column if exists tasa_hnl_usd;

-- =====================================================================
-- C · LAS PPM, SOBRE LA DOSIS POR MANZANA
-- =====================================================================
/**
 * Las partes por millón de un químico aplicado.
 *
 *     dosis_mz        = litros / manzanas del turno
 *     producto_puro_L = dosis_mz × (ingrediente_activo% / 100)
 *     ppm             = producto_puro_L × 1000 / agua_total_m³
 *
 * **Qué cambió respecto de la 64 y por qué conviene saberlo.** Antes la
 * cuenta partía de los litros TOTALES; ahora parte de la dosis por
 * manzana. El resultado no es el mismo número con otro nombre: es el de
 * antes dividido entre las manzanas del turno. En un turno de 10 mz, las
 * ppm salen diez veces menores.
 *
 * Esto se implementa tal como lo pide la hoja de los agrónomos. La nota
 * dimensional está en la cabecera de esta migración; si el número sale
 * más bajo de lo esperado, ahí está dónde mirar.
 *
 * Sin agua o sin manzanas devuelve nulo —no cero—: no es que la
 * concentración sea cero, es que todavía no se sabe entre cuánto se
 * reparte.
 */
create or replace function public.fn_ppm_desinfeccion(
    p_litros numeric,
    p_concentracion text,
    p_horas_inyeccion numeric,
    p_horas_lavado numeric,
    p_caudal numeric,
    p_mz numeric
)
returns numeric
language sql immutable as $$
    select case
        when coalesce(p_caudal, 0) <= 0 then null
        when coalesce(p_mz, 0) <= 0 then null
        when coalesce(p_horas_inyeccion, 0) + coalesce(p_horas_lavado, 0) <= 0 then null
        when public.fn_numero_de_texto(p_concentracion) is null then null
        else (coalesce(p_litros, 0) / p_mz)
             * (public.fn_numero_de_texto(p_concentracion) / 100.0)
             * 1000.0
             / ((coalesce(p_horas_inyeccion, 0) + coalesce(p_horas_lavado, 0)) * p_caudal)
    end
$$;

comment on function public.fn_ppm_desinfeccion(numeric, text, numeric, numeric, numeric, numeric) is
    'Partes por millón de un químico, partiendo de la DOSIS POR MANZANA. Ver la nota dimensional de la migración 65.';

grant execute on function
    public.fn_ppm_desinfeccion(numeric, text, numeric, numeric, numeric, numeric)
    to authenticated;

-- La de CINCO argumentos de la 64 se va. Dejar las dos vivas haría que
-- la llamada se resolviera por el número de argumentos y que media
-- plataforma siguiera calculando con la fórmula vieja sin avisar —la
-- misma trampa que costó una vuelta con `fn_precio_material`—.
drop function if exists public.fn_ppm_desinfeccion(numeric, text, numeric, numeric, numeric);

-- --------------------------- Los químicos ---------------------------

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
    -- Las piezas del cálculo, cada una en su columna. Guardar sólo el
    -- resultado obliga a rehacer la cuenta a mano para discutirlo, y lo
    -- que no se puede auditar no se discute: se cree o no se cree.
    e.caudal_agua,
    e.horas_inyeccion,
    e.horas_lavado,
    (coalesce(e.horas_inyeccion, 0) + coalesce(e.horas_lavado, 0)) * e.caudal_agua
                                               as agua_total_m3,
    -- El producto puro sale de la DOSIS, no de los litros totales
    -- (migración 65). Las dos columnas conviven a la vista para que la
    -- diferencia se pueda auditar sin abrir el código.
    (dp.total_litros / nullif(l.mz_regadas, 0))
        * (public.fn_numero_de_texto(m.concentracion) / 100.0)
                                               as producto_puro_litros,
    public.fn_ppm_desinfeccion(dp.total_litros, m.concentracion,
                               e.horas_inyeccion, e.horas_lavado, e.caudal_agua,
                               l.mz_regadas)
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

-- -------------------------- La ejecución ----------------------------
-- Idéntica a la de la 64 salvo por la `ppm` manual, que ya no existe.

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
    e.ce_antes, e.ce_durante, e.ce_despues,
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
    -- Las ppm del turno son las del producto que más PESA, no un
    -- promedio: un promedio entre el desinfectante y el ácido no es la
    -- concentración de ninguno de los dos.
    q.ppm_principal,

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
           string_agg(mm.descripcion, ', ' order by mm.descripcion) as productos_nombres,
           (array_agg(
                public.fn_ppm_desinfeccion(x.total_litros, mm.concentracion,
                                           e.horas_inyeccion, e.horas_lavado,
                                           e.caudal_agua, l.mz_regadas)
                order by x.total_litros desc nulls last))[1]       as ppm_principal
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

-- =====================================================================
-- D · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_falta text;
    v_ppm   numeric;
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'desinfeccion_ejecucion'
                 and column_name = 'ppm')
    then
        raise exception 'La ppm manual sigue en la tabla.';
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'temporadas'
                 and column_name = 'tasa_hnl_usd')
    then
        raise exception 'La tasa suelta de la 64 sigue en temporadas: habría dos sitios donde escribirla.';
    end if;

    -- Una sola `fn_ppm_desinfeccion`: con dos vivas, media plataforma
    -- seguiría calculando con la fórmula vieja sin avisar.
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'fn_ppm_desinfeccion') <> 1
    then
        raise exception 'Hay más de una fn_ppm_desinfeccion: la llamada sería ambigua.';
    end if;

    -- LA CUENTA, a mano. 10 mz, 100 L al 42 % → dosis 10 L/mz; 10 × 0.42
    -- = 4.2 L puros = 4.200 cc. Agua: (2 + 1) × 20 = 60 m³.
    -- 4.200 / 60 = 70.
    v_ppm := public.fn_ppm_desinfeccion(100, '42%', 2, 1, 20, 10);
    if v_ppm <> 70 then
        raise exception 'La fórmula de ppm no da lo que debe: % (se esperaba 70)', v_ppm;
    end if;

    if not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'historial_tasas_temporada'
          and c.relrowsecurity)
       or not exists (select 1 from pg_policies p
                      where p.schemaname = 'public'
                        and p.tablename = 'historial_tasas_temporada')
    then
        raise exception 'historial_tasas_temporada se quedó sin RLS o sin policies.';
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
--   · No resuelve la duda dimensional de las ppm. Implementa lo pedido
--     y lo deja escrito donde se encuentra. Ver la cabecera y §4 de la
--     BITÁCORA.
--   · No toca `catalogo_tasas_cambio` (59), que sigue como último
--     recurso por si alguien la alimenta.
--   · No toca el importador de Excel del módulo. Sigue pendiente.
-- =====================================================================
