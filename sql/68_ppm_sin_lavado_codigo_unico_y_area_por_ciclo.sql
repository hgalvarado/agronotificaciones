-- =====================================================================
-- 68 · EL PPM SIN EL LAVADO · EL CÓDIGO ÚNICO · EL ÁREA POR CICLO
-- =====================================================================
--
--   A · **EL LAVADO NO LLEVA PRODUCTO.** El ppm se calculaba repartiendo
--       el químico entre el agua de la inyección **y la del lavado**. El
--       lavado es agua limpia que se echa DESPUÉS, para sacar el químico
--       de la tubería: sumarla al denominador diluye en el papel una
--       dilución que no ocurrió, y el número sale más bajo que el real.
--       Un ppm bajo es la clase de error que no se nota —nadie revisa un
--       número prudente—, y el que se aplicó de verdad era más alto.
--
--   B · **DOS JORNALES CON EL MISMO CÓDIGO.** `operadores.codigo` es con
--       lo que se busca a una persona en campo y con lo que se cruza la
--       planilla. Sin unicidad, dos altas con el mismo código parten las
--       horas de alguien en dos fichas y ninguna de las dos cuadra.
--
--   C · **EL ÁREA ES DEL CICLO, Y CAMBIA CUANDO SE SIEMBRA.** Mientras
--       el lote no se ha sembrado, lo que vale es el área del plan; en
--       cuanto hay siembra capturada, vale la sembrada. `fn_area_regable`
--       ya hacía algo parecido, pero sumaba TODOS los ciclos en uno y
--       devolvía el plan mientras la siembra no lo igualara: un lote
--       sembrado a medias enseñaba el área planificada, que es la que no
--       se regó.
--
-- Idempotente.
-- =====================================================================


-- =====================================================================
-- A · EL PPM SE REPARTE SÓLO EN EL AGUA DE LA INYECCIÓN
-- =====================================================================
--
-- La firma CAMBIA: se va `p_horas_lavado`. Y la vieja de seis argumentos
-- se suelta en el mismo paso, no se deja viva.
--
-- Dejar las dos sería repetir la trampa que ya costó una vuelta con
-- `fn_precio_material` y que estuvo a punto de repetirse con la 65:
-- `create or replace` con otra lista de argumentos **no reemplaza nada**,
-- crea una segunda función. A partir de ahí cada quien resuelve por el
-- número de argumentos, la mitad de la plataforma sigue calculando con
-- la fórmula vieja y no hay ningún error que lo delate.

-- Las dos vistas que la usan se sueltan antes: una función con vistas
-- colgando no se puede soltar, y `drop ... cascade` aquí se llevaría por
-- delante las rejas de la 66 sin dejar rastro de que lo hizo.
drop view if exists public.v_desinfeccion_productos;
drop view if exists interno.v_desinfeccion_productos_crudo;
drop view if exists public.v_desinfeccion_ejecucion;
drop view if exists interno.v_desinfeccion_ejecucion_crudo;

drop function if exists public.fn_ppm_desinfeccion(numeric, text, numeric, numeric, numeric, numeric);
drop function if exists public.fn_ppm_desinfeccion(numeric, text, numeric, numeric, numeric);

/**
 * Partes por millón del ingrediente activo en el agua de riego.
 *
 * ── La cuenta ──────────────────────────────────────────────────────
 *
 *   producto puro (L/mz) = dosis_mz × concentración
 *   agua          (m³)   = horas_inyeccion × caudal
 *   ppm                  = producto puro × 1.000 / agua
 *
 * **Por qué el lavado no entra.** La fase de lavado empuja agua limpia
 * por la misma tubería para sacar el químico que quedó dentro. Esa agua
 * no lleva producto, así que no diluye nada: contarla sólo agranda el
 * denominador y rebaja el ppm en el papel. El número que importa es el
 * de la mezcla que salió por el gotero mientras se inyectaba.
 *
 * **La nota dimensional de la 65 sigue en pie**: se parte de la dosis
 * por manzana y no de los litros totales, que es como lo tiene la hoja
 * de los agrónomos. Con una manzana las dos cuentas coinciden; con más,
 * ésta divide entre las manzanas del turno. Está pendiente de contrastar
 * contra un turno real.
 */
create function public.fn_ppm_desinfeccion(
    p_litros numeric,
    p_concentracion text,
    p_horas_inyeccion numeric,
    p_caudal numeric,
    p_mz numeric
)
returns numeric
language sql immutable as $$
    select case
        when coalesce(p_caudal, 0) <= 0 then null
        when coalesce(p_mz, 0) <= 0 then null
        -- Sin horas de inyección no hubo mezcla que medir. Antes bastaba
        -- con que hubiera horas de LAVADO para que saliera un número, y
        -- ese número era producto dividido entre agua sin producto.
        when coalesce(p_horas_inyeccion, 0) <= 0 then null
        when public.fn_numero_de_texto(p_concentracion) is null then null
        else (coalesce(p_litros, 0) / p_mz)
             * (public.fn_numero_de_texto(p_concentracion) / 100.0)
             * 1000.0
             / (p_horas_inyeccion * p_caudal)
    end
$$;

comment on function public.fn_ppm_desinfeccion(numeric, text, numeric, numeric, numeric) is
    'ppm del ingrediente activo. El agua es la de la INYECCIÓN; el lavado es agua limpia y no diluye (migración 68).';

grant execute on function
    public.fn_ppm_desinfeccion(numeric, text, numeric, numeric, numeric)
    to authenticated;


-- --------------------------- Los químicos ---------------------------
-- La vista se rehace entera: `agua_total_m3` cambia de significado y
-- `create or replace view` no deja cambiar una columna existente.
--
-- `horas_lavado` se queda EN LA VISTA aunque ya no entre en el cálculo:
-- es un dato de la captura y la pantalla lo enseña. Lo que se va es su
-- participación en el agua.

create view interno.v_desinfeccion_productos_crudo as
select
    dp.id, dp.ejecucion_id, e.temporada_id,
    e.turno_id, tn.nombre as turno_nombre, tn.zona_id, e.ciclo, e.fecha_aplicacion,
    dp.producto_id, m.codigo as producto_codigo, m.descripcion as producto_nombre,
    m.ingrediente_activo, m.concentracion,
    dp.total_litros, dp.costo_litro, dp.costo_total,
    dp.cantidad_envases, dp.tipo_envase,
    public.fn_precio_material(dp.producto_id,
        coalesce(e.fecha_aplicacion, e.fecha_preriego, current_date),
        e.temporada_id)                        as precio_catalogo,
    coalesce(l.mz_regadas, 0)                  as mz_regadas,
    dp.total_litros / nullif(l.mz_regadas, 0)  as dosis_mz,
    e.usuario_id, dp.created_at,

    /* ------------------------- El desglose ------------------------- */
    e.caudal_agua,
    e.horas_inyeccion,
    e.horas_lavado,
    -- **El agua del cálculo: sólo la de la inyección.** La del lavado
    -- sigue a la vista en `horas_lavado`, para que la diferencia se
    -- pueda auditar sin abrir el código.
    coalesce(e.horas_inyeccion, 0) * e.caudal_agua
                                               as agua_total_m3,
    (dp.total_litros / nullif(l.mz_regadas, 0))
        * (public.fn_numero_de_texto(m.concentracion) / 100.0)
                                               as producto_puro_litros,
    public.fn_ppm_desinfeccion(dp.total_litros, m.concentracion,
                               e.horas_inyeccion, e.caudal_agua,
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

-- La reja granular de la 66, tal cual estaba: pantalla propia y recorte
-- estricto por zona.
create view public.v_desinfeccion_productos as
select x.* from interno.v_desinfeccion_productos_crudo x
where (select public.fn_permitido_de('desinfeccion_ejecucion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_ejecucion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_productos to authenticated;


-- -------------------------- La ejecución ----------------------------
-- Idéntica a la de la 66 salvo por las dos cosas que cambia esta
-- migración: `agua_total_m3` y la llamada al ppm. El resto se reproduce
-- tal cual estaba.

create view interno.v_desinfeccion_ejecucion_crudo as
select
    e.id, e.temporada_id, tm.nombre as temporada_nombre,
    e.turno_id, tn.nombre as turno_nombre, tn.codigo as turno_codigo,
    tn.zona_id, z.nombre as zona_nombre,
    e.ciclo, e.estado,

    e.fecha_preriego, e.hora_inicio_preriego, e.hora_fin_preriego,
    e.horas_preriego, e.obs_preriego,

    e.fecha_lecturas, e.lecturas_tensiometro,

    e.fecha_aplicacion, e.estacion_riego_id, er.nombre as estacion_riego_nombre,
    e.inicio_presurizacion, e.fin_presurizacion, e.horas_presurizacion,
    e.hora_inicio_iny, e.hora_fin_iny, e.horas_inyeccion,
    e.hora_inicio_lavado, e.hora_fin_lavado, e.horas_lavado,
    e.total_horas_riego,

    e.caudal_agua,
    -- Sólo la inyección (migración 68).
    coalesce(e.horas_inyeccion, 0) * e.caudal_agua as agua_total_m3,

    e.ce_antes, e.ce_durante, e.ce_despues,
    e.calibracion_entrada, e.calibracion_salida, e.calibracion_campo,

    coalesce(l.mz_regadas, 0)    as mz_regadas,
    coalesce(l.lotes_regados, 0) as lotes_regados,

    coalesce(pr.costo_preriego, 0)   as costo_personal_preriego,
    coalesce(pr.costo_aplicacion, 0) as costo_personal_aplicacion,
    coalesce(pr.costo_total, 0)      as costo_personal,

    coalesce(q.costo_quimico, 0) as costo_quimico,
    coalesce(q.productos, 0)     as productos,
    q.productos_nombres,
    coalesce(q.envases, 0)       as envases,
    q.ppm_principal,

    e.usuario_id, pf.nombre as usuario_nombre, e.created_at
from public.desinfeccion_ejecucion e
join public.temporadas tm on tm.id = e.temporada_id
join public.turnos tn     on tn.id = e.turno_id
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
        sum(x.costo_total) filter (where x.fase = '1_Preriego')    as costo_preriego,
        sum(x.costo_total) filter (where x.fase = '3_Aplicacion')  as costo_aplicacion,
        sum(x.costo_total)                                         as costo_total
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
            order by x.total_litros desc nulls last))[1] as ppm_principal
    from public.desinfeccion_ejecucion_productos x
    join public.materiales mm on mm.id = x.producto_id
    where x.ejecucion_id = e.id
) q on true;

alter view interno.v_desinfeccion_ejecucion_crudo set (security_invoker = off);

create view public.v_desinfeccion_ejecucion as
select x.* from interno.v_desinfeccion_ejecucion_crudo x
where (select public.fn_permitido_de('desinfeccion_ejecucion', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_ejecucion', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_ejecucion to authenticated;


-- =====================================================================
-- B · UN CÓDIGO, UNA PERSONA
-- =====================================================================
--
-- Primero se NORMALIZA y después se cierra la puerta. Hacerlo al revés
-- deja fuera a «001251 » con un espacio, que para la base es otro código
-- y para la planilla es el mismo.
--
-- El vacío pasa a nulo a propósito: `''` no es un código, es la ausencia
-- de uno, y varias ausencias tienen que poder convivir.

update public.operadores
   set codigo = nullif(btrim(codigo), '')
 where codigo is distinct from nullif(btrim(codigo), '');

-- Si ya hay duplicados, el índice no se puede crear y la migración NO
-- debe seguir a medias: se corta aquí diciendo cuáles son. Un error con
-- el listado dentro se arregla en dos minutos; un «no se pudo crear el
-- índice» sin más deja a alguien buscando a ciegas.
do $$
declare v_dups text;
begin
    select string_agg(format('%s (%s fichas)', codigo, n), ', ' order by codigo)
      into v_dups
      from (
        select codigo, count(*) as n
          from public.operadores
         where codigo is not null
         group by codigo
        having count(*) > 1
      ) d;

    if v_dups is not null then
        raise exception
            'Hay códigos de personal repetidos y no se puede marcar la columna como única: %. '
            'Únelos o cámbiales el código en Catálogos → Personal y vuelve a correr esta migración.',
            v_dups;
    end if;
end $$;

-- Parcial: sólo manda sobre los que tienen código. `nulls not distinct`
-- NO se usa aquí a propósito — eso prohibiría tener dos personas sin
-- código, que es el estado normal de un alta a medio llenar.
create unique index if not exists operadores_codigo_uidx
    on public.operadores (codigo)
    where codigo is not null;

comment on index public.operadores_codigo_uidx is
    'Un código, una persona. Parcial: varios sin código conviven (migración 68).';


-- =====================================================================
-- C · EL ÁREA DEL LOTE EN UN CICLO
-- =====================================================================
--
-- La regla, en una línea: **si ya se sembró, manda lo sembrado; si no,
-- manda el plan; y si no hay ni plan ni siembra, el área neta del lote.**
--
-- Lo que cambia respecto de `fn_area_regable`:
--
--   · **Mira el ciclo.** La vieja sumaba todos los ciclos del lote en un
--     solo número. Con dos ciclos en la temporada, el área del segundo
--     salía inflada con la del primero.
--   · **Lo sembrado manda aunque sea menos que el plan.** La vieja sólo
--     daba el área real cuando alcanzaba o pasaba a la planificada; un
--     lote con 10 mz de plan y 6 sembradas enseñaba 10, que son 4 mz que
--     nadie regó.
--
-- «Terminado» no es un estado guardado en ningún sitio: un lote está
-- sembrado cuando tiene siembra capturada en `siembras`, y eso es lo que
-- se pregunta.

create or replace function public.fn_area_lote_ciclo(
    p_lote_temporada_id uuid,
    p_ciclo integer default null
)
returns numeric
language sql stable set search_path = public, pg_temp as $$
    with s as (
        select coalesce(sum(si.avance_mz), 0) as sembrada
        from public.siembras si
        where si.lote_temporada_id = p_lote_temporada_id
          and (p_ciclo is null or si.ciclo = p_ciclo)
    ),
    p as (
        select coalesce(sum(ps.area_plan), 0) as planificada
        from public.planes_siembra ps
        where ps.lote_temporada_id = p_lote_temporada_id
          and (p_ciclo is null or ps.ciclo = p_ciclo)
    ),
    n as (
        select coalesce(lt.area_neta, 0) as neta
        from public.lotes_temporada lt
        where lt.id = p_lote_temporada_id
    )
    select case
        when s.sembrada    > 0 then s.sembrada     -- se sembró: manda lo real
        when p.planificada > 0 then p.planificada  -- todavía en plan
        else n.neta                                -- ni plan ni siembra
    end
    from s, p, n;
$$;

comment on function public.fn_area_lote_ciclo(uuid, integer) is
    'El área del lote en un ciclo: la sembrada si la hay, la del plan si no, el área neta como último recurso (migración 68).';

grant execute on function public.fn_area_lote_ciclo(uuid, integer) to authenticated;

-- De dónde salió el número, para poder decirlo en pantalla. Un área sin
-- su procedencia obliga al usuario a adivinar si está mirando un plan o
-- un hecho, y adivina mal el día que coincidan.
create or replace function public.fn_origen_area_lote_ciclo(
    p_lote_temporada_id uuid,
    p_ciclo integer default null
)
returns text
language sql stable set search_path = public, pg_temp as $$
    select case
        when exists (
            select 1 from public.siembras si
             where si.lote_temporada_id = p_lote_temporada_id
               and (p_ciclo is null or si.ciclo = p_ciclo)
               and si.avance_mz > 0
        ) then 'real'
        when exists (
            select 1 from public.planes_siembra ps
             where ps.lote_temporada_id = p_lote_temporada_id
               and (p_ciclo is null or ps.ciclo = p_ciclo)
               and ps.area_plan > 0
        ) then 'plan'
        else 'neta'
    end
$$;

grant execute on function public.fn_origen_area_lote_ciclo(uuid, integer) to authenticated;


-- --------------------- Los lotes que se pueden regar -----------------
-- Gana el ciclo. Y la vieja de tres argumentos SE SUELTA: con las dos
-- vivas, `fn_lotes_regables(a, b, c)` seguiría resolviendo a la de
-- siempre —la que ignora el ciclo— y el selector seguiría enseñando el
-- área equivocada sin un solo error de por medio.

drop function if exists public.fn_lotes_regables(uuid, uuid, uuid);
drop function if exists public.fn_lotes_regables(uuid, uuid, uuid, integer);

create function public.fn_lotes_regables(
    p_temporada_id uuid,
    p_zona_id uuid default null,
    p_turno_id uuid default null,
    p_ciclo integer default null
)
returns table (
    lote_temporada_id uuid,
    ut                text,
    lote_nombre       text,
    zona              text,
    zona_id           uuid,
    area_total        numeric,
    area_asignada     numeric,
    area_disponible   numeric,
    origen_area       text,
    fecha_siembra     date,
    variedad          text
)
language sql stable set search_path = public, pg_temp as $$
    select
        lt.id,
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        lt.zona_id,
        public.fn_area_lote_ciclo(lt.id, p_ciclo)          as area_total,
        coalesce(a.asignada, 0)                            as area_asignada,
        greatest(public.fn_area_lote_ciclo(lt.id, p_ciclo)
                 - coalesce(a.asignada, 0), 0)             as area_disponible,
        public.fn_origen_area_lote_ciclo(lt.id, p_ciclo)   as origen_area,
        -- La siembra del lote, para el globo de información del
        -- selector: evita abrir trasplante para saber qué hay sembrado.
        sb.fecha_siembra,
        sb.variedad_nombre
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    left join public.zonas z on z.id = lt.zona_id
    left join lateral (
        select sum(d.area_turno) as asignada
        from public.turnos_riego_detalle d
        join public.turnos_riego t on t.id = d.turno_id
        where d.lote_temporada_id = lt.id
          and (p_turno_id is null or d.turno_id <> p_turno_id)
          and (p_ciclo is null or t.ciclo = p_ciclo)
    ) a on true
    left join lateral (
        select x.fecha_siembra, x.variedad_nombre
        from public.fn_siembras_de_lotes(array[lt.id], p_ciclo) x
        limit 1
    ) sb on true
    where lt.temporada_id = p_temporada_id
      and lo.tipo = 'AGRICOLA'
      and lt.activo
      and (p_zona_id is null or lt.zona_id = p_zona_id)
      -- El mismo sellado zonal de la 67: esta función también devuelve
      -- filas de campo y también la llama el navegador por RPC.
      and (select public.fn_permitido_de('turnos_riego', 'ver'))
      and case (select public.fn_mi_alcance('turnos_riego', 'ver'))
          when 'global' then true
          else (select public.fn_ve_zona_estricta(lt.zona_id))
      end
    order by lo.nomenclatura;
$$;

comment on function public.fn_lotes_regables(uuid, uuid, uuid, integer) is
    'Los lotes regables de una temporada, con el área del CICLO y su procedencia. Sellado por zona (migración 68).';

grant execute on function public.fn_lotes_regables(uuid, uuid, uuid, integer) to authenticated;

-- `fn_area_regable` se queda viva: la usan el reporte y el histórico, y
-- cambiarle el criterio a ellos no es lo que se pidió. Pasa a delegar
-- para que no haya dos reglas escritas en dos sitios.
create or replace function public.fn_area_regable(p_lote_temporada_id uuid)
returns numeric
language sql stable set search_path = public, pg_temp as $$
    select public.fn_area_lote_ciclo(p_lote_temporada_id, null)
$$;

comment on function public.fn_area_regable(uuid) is
    'El área del lote sumando todos los ciclos. Delega en fn_area_lote_ciclo desde la 68.';
