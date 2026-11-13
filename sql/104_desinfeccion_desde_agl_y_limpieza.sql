-- =====================================================================
-- 104 · DESINFECCIÓN TOMA LA SIEMBRA DE AGL + RETIRO DE TRASPLANTE Y RIEGO
-- =====================================================================
-- Pedido del usuario (2026-11-12): «ya vive en AGL y ya que son los mismos turnos entonces lo vamos a subir de AGL…
-- que supabase sea solo un intermediario, que ese almacenamiento gratis nos dure muchísimo, tratar de llenar lo mínimo».
--
-- Qué hace:
--   1 · RESPALDO (opcional, ver la BANDERA justo abajo): copia las tablas viejas al esquema `respaldo`.
--   2 · DESINFECCIÓN DESDE AGL:
--       - `_desinf_siembra_turno`: la fecha de siembra de UN turno en una temporada y ciclo, sacada de
--         `turnos_ciclo` (lo publica AGL con fn_fert_publicar, sql/91). Regla para elegir cuando hay varias: ver la
--         función.
--       - `fn_desinfeccion_siembras_agl`: la misma consulta para la pantalla (security definer + permiso).
--       - `desinfeccion_plan.turno_id`: el turno de AGL del que la línea copió su siembra (para «Sincronizar»).
--       - `fn_area_lote_ciclo`: el área del lote en el ciclo ya no mira siembras / planes_siembra; ahora:
--         área planificada en el plan de desinfección > área neta del lote.
--       - Informe ejecutivo: la siembra sale del turno de AGL de cada ejecución (si falta, la congelada del plan).
--   3 · RETIRO: tablas, vistas, funciones, políticas (se van con su tabla), tipos y pantallas de Trasplante
--       (siembras, planes_siembra, recepción de plántulas…) y de Turnos de riego (turnos_riego, su detalle,
--       planes_nutricionales). NO toca `turnos` ni `estaciones_riego` (los usan Desinfección y Fertirriego).
--
-- Sin CASCADE: si algo que no conocemos dependiera de lo que se borra, la migración se DETIENE y no se borra nada
-- (todo va en una sola transacción). Cada UPDATE/DELETE lleva WHERE (Supabase rechaza los que no).
-- Idempotente: se puede correr dos veces.
--
-- ORDEN (decidido con el usuario):
--   a) Respaldo a archivos en el PC:  scripts\respaldar-tablas-viejas.ps1 -Entorno desarrollo   (y luego produccion)
--   b) Esta migración en DESARROLLO; probar; luego en PRODUCCIÓN.
--   c) Publicar el código. El código VIEJO sigue funcionando con la 104 puesta (el DDT queda en blanco y el
--      autollenado dice «sin siembra»), así que la 104 puede ir ANTES que el código.
--
-- BANDERA DE RESPALDO EN LA BASE (v_respaldar, en el bloque 1):
--   true  (por defecto, regla acordada): además del archivo local, copia las tablas a `respaldo.*_m104`. Es la red
--         de seguridad si algo falla, pero ESAS COPIAS OCUPAN EL MISMO ESPACIO que las tablas originales: el
--         almacenamiento gratuito no se libera hasta borrarlas (`drop table respaldo.<tabla>_m104;`).
--   false: no copia nada dentro de la base y el espacio se libera de inmediato. Úsalo SOLO si ya corriste el
--         script de respaldo a archivos y comprobaste que los .json están en respaldos\<fecha>\.
--
-- Para restaurar una tabla:  create table public.siembras as table respaldo.siembras_m104;
-- (restricciones, políticas y disparadores están en las migraciones 26–29, 40, 46, 79–82).
-- =====================================================================

begin;

create schema if not exists respaldo;
revoke all on schema respaldo from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1 · RESPALDO EN LA BASE (opcional)
-- ---------------------------------------------------------------------
do $$
declare
    v_respaldar constant boolean := true;   -- ← BANDERA. false = no copiar dentro de la base (ver el encabezado)
    t text;
    origen bigint;
    copia bigint;
    col record;
begin
    if not v_respaldar then
        raise notice '104: respaldo en la base APAGADO. Debe existir el respaldo a archivos (scripts\respaldar-tablas-viejas.ps1).';
        return;
    end if;

    foreach t in array array['siembras', 'siembra_productos', 'siembras_terminadas', 'planes_siembra',
                             'recepcion_plantulas', 'turnos_riego', 'turnos_riego_detalle', 'planes_nutricionales']
    loop
        if to_regclass('public.' || t) is null then
            raise notice 'public.% ya no existe: se omite su respaldo', t;
            continue;
        end if;
        if to_regclass('respaldo.' || t || '_m104') is null then
            execute format('create table respaldo.%I as table public.%I', t || '_m104', t);
        end if;
        execute format('select count(*) from public.%I', t) into origen;
        execute format('select count(*) from respaldo.%I', t || '_m104') into copia;
        if origen <> copia then
            raise exception 'El respaldo de % no coincide (% filas en public, % en respaldo). No se borró nada.', t, origen, copia;
        end if;
        raise notice 'Respaldo de %: % filas', t, copia;
    end loop;

    -- Pantallas y permisos que se retiran
    if to_regclass('respaldo.pantallas_m104') is null then
        create table respaldo.pantallas_m104 as
            select * from public.pantallas where codigo in ('trasplante_plan', 'trasplante_diario', 'turnos_riego');
        create table respaldo.permisos_m104 as
            select * from public.permisos where recurso in ('trasplante_plan', 'trasplante_diario', 'turnos_riego');
        create table respaldo.navegacion_rol_m104 as
            select * from public.navegacion_rol where pantalla in ('trasplante_plan', 'trasplante_diario', 'turnos_riego');
        create table respaldo.vistas_tabla_m104 as
            select * from public.vistas_tabla where pantalla in ('trasplante_plan', 'trasplante_diario', 'turnos_riego');
    end if;

    -- Las columnas con tipos que se borran (estado_turno_riego, fuente_agua) quedan como TEXTO en la copia
    for col in
        select c.table_name, c.column_name
        from information_schema.columns c
        where c.table_schema = 'respaldo' and c.table_name like '%\_m104'
          and c.udt_name in ('estado_turno_riego', 'fuente_agua')
    loop
        execute format('alter table respaldo.%I alter column %I type text using %I::text',
                       col.table_name, col.column_name, col.column_name);
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2 · DESINFECCIÓN DESDE AGL
-- ---------------------------------------------------------------------

/**
 * La siembra de UN turno en una temporada y ciclo, desde lo que publicó AGL (`turnos_ciclo`).
 *
 * Cruce: el turno por id (AGL crea/usa la fila de `turnos` por código al publicar); la temporada por NOMBRE
 * normalizado (AGL manda «Temporada 2026-2027», igual que `temporadas.nombre`); el ciclo por su NÚMERO (AGL escribe
 * «Ciclo 1», «Ciclo-1»…). Solo filas ACTIVAS y con fecha de siembra.
 *
 * Si quedan VARIAS (el mismo turno publicado dos veces en la temporada y ciclo, p. ej. un registro rehecho en AGL),
 * se elige por FECHA contra `p_referencia` (la fecha de la aplicación o del preriego; sin ella, hoy en Honduras):
 *   1º la PRIMERA siembra en o después de la referencia: la desinfección se hace ANTES de trasplantar, así que la
 *      siembra que prepara es la siguiente;
 *   2º si todas son anteriores, la MÁS RECIENTE antes de la referencia;
 *   desempate: la publicada más tarde.
 * `candidatos` dice cuántas había, para que la pantalla pueda avisarlo.
 */
create or replace function public._desinf_siembra_turno(
    p_turno_id uuid, p_temporada_id uuid, p_ciclo integer, p_referencia date default null)
returns table (turno_ciclo_id uuid, fecha_siembra date, agl_id text, area_mz numeric, candidatos integer)
language sql stable
set search_path = public, pg_temp
as $$
    with ref as (
        select coalesce(p_referencia, public.fn_hoy()) as dia,
               (select public._fert_llave(t.nombre) from public.temporadas t where t.id = p_temporada_id) as llave
    ),
    c as (
        select tc.id, tc.fecha_siembra, tc.agl_id, tc.area_mz, tc.publicado_at,
               count(*) over () as n
        from public.turnos_ciclo tc, ref
        where tc.turno_id = p_turno_id
          and tc.activo
          and tc.fecha_siembra is not null
          and public._fert_llave(tc.temporada) = ref.llave
          and (p_ciclo is null or nullif(substring(tc.ciclo from '[0-9]+'), '')::integer = p_ciclo)
    )
    select c.id, c.fecha_siembra, c.agl_id, c.area_mz, c.n::integer
    from c, ref
    order by (c.fecha_siembra < ref.dia),                                          -- primero las de o después
             case when c.fecha_siembra >= ref.dia then c.fecha_siembra end asc,     -- la siguiente
             c.fecha_siembra desc,                                                  -- o la última antes
             c.publicado_at desc, c.agl_id
    limit 1
$$;

comment on function public._desinf_siembra_turno(uuid, uuid, integer, date) is
    'Siembra de un turno (temporada + ciclo) publicada por AGL en turnos_ciclo. Con varias: la primera en o después de la referencia; si no, la última antes.';

revoke execute on function public._desinf_siembra_turno(uuid, uuid, integer, date) from public, anon, authenticated;

/**
 * Para la pantalla de Desinfección: la siembra (de AGL) de los turnos de una temporada y ciclo.
 * `p_turnos` vacío = todos los turnos que AGL publicó. `security definer` porque `turnos_ciclo` solo lo leen
 * estacioneros y AGL (sql/91); aquí se exige un permiso de Desinfección.
 */
create or replace function public.fn_desinfeccion_siembras_agl(
    p_temporada_id uuid, p_ciclo integer default null, p_turnos uuid[] default null, p_referencia date default null)
returns table (turno_id uuid, turno_codigo text, fecha_siembra date, agl_id text, area_mz numeric, candidatos integer)
language sql stable security definer
set search_path = public, pg_temp
as $$
    select t.id, t.codigo, s.fecha_siembra, s.agl_id, s.area_mz, s.candidatos
    from public.turnos t
    cross join lateral public._desinf_siembra_turno(t.id, p_temporada_id, p_ciclo, p_referencia) s
    where (p_turnos is null or t.id = any(p_turnos))
      and exists (select 1 from public.turnos_ciclo x where x.turno_id = t.id)
      and (public.fn_tiene_permiso('desinfeccion_plan', 'ver')
           or public.fn_tiene_permiso('desinfeccion_ejecucion', 'ver')
           or public.fn_tiene_permiso('desinfeccion_reporte', 'ver'))
    order by t.codigo
$$;

revoke execute on function public.fn_desinfeccion_siembras_agl(uuid, integer, uuid[], date) from public, anon;
grant execute on function public.fn_desinfeccion_siembras_agl(uuid, integer, uuid[], date) to authenticated;

-- El turno de AGL del que la línea del plan copió la siembra. Opcional: las líneas viejas no lo tienen.
alter table public.desinfeccion_plan
    add column if not exists turno_id uuid references public.turnos(id);
comment on column public.desinfeccion_plan.turno_id is
    'Turno (publicado por AGL) del que se copió fecha_siembra_congelada. Lo usa «Sincronizar».';

/**
 * Área de un lote en un ciclo. Antes: sembrado (siembras) > plan de siembra (planes_siembra) > neta.
 * Esas tablas se retiran (Trasplante vive en AGL), así que ahora: lo planificado en el plan de DESINFECCIÓN para ese
 * lote y ciclo (la mayor de sus líneas: todas las líneas de un lote comparten el área) > área neta del lote.
 */
create or replace function public.fn_area_lote_ciclo(p_lote_temporada_id uuid, p_ciclo integer default null)
returns numeric
language sql stable
set search_path = public, pg_temp
as $$
    with p as (
        select coalesce(sum(m.area), 0) as planificada
        from (select dp.ciclo, max(dp.area_planificada_mz) as area
              from public.desinfeccion_plan dp
              where dp.lote_temporada_id = p_lote_temporada_id
                and (p_ciclo is null or dp.ciclo = p_ciclo)
              group by dp.ciclo) m
    ),
    n as (
        select coalesce(lt.area_neta, 0) as neta
        from public.lotes_temporada lt
        where lt.id = p_lote_temporada_id
    )
    select case when p.planificada > 0 then p.planificada else n.neta end
    from p, n
$$;

-- Plan: se expone el turno de AGL (al final, para no mover columnas)
create or replace view interno.v_desinfeccion_plan_crudo with (security_invoker = off) as
SELECT p.id,
    p.temporada_id,
    tm.nombre AS temporada_nombre,
    p.lote_temporada_id,
    lo.nomenclatura AS lote_nomenclatura,
    lo.nombre AS lote_nombre,
    lt.zona_id,
    z.nombre AS zona_nombre,
    p.ciclo,
    p.fecha_siembra_congelada,
    p.dias_aplicacion,
    p.fecha_aplicacion,
    p.dias_preriego,
    p.fecha_preriego,
    p.variedad_id,
    v.nombre AS variedad_nombre,
    v.ddt_cosecha,
        CASE
            WHEN v.ddt_cosecha IS NOT NULL THEN p.fecha_siembra_congelada + v.ddt_cosecha
            ELSE NULL::date
        END AS fecha_cosecha,
    p.producto_id,
    m.descripcion AS producto_nombre,
    m.codigo AS producto_codigo,
    m.ingrediente_activo,
    m.concentracion,
    p.dosis_mz,
    p.area_planificada_mz,
    p.costo_litro,
    p.total_litros,
    p.total_costo,
    p.costo_mz,
    p.moneda,
    p.costo_origen,
    p.comentarios,
    p.usuario_id,
    pe.nombre AS usuario_nombre,
    p.created_at,
    p.turno_id,
    tu.codigo AS turno_codigo
   FROM desinfeccion_plan p
     JOIN lotes_temporada lt ON lt.id = p.lote_temporada_id
     JOIN lotes lo ON lo.id = lt.lote_id
     LEFT JOIN zonas z ON z.id = lt.zona_id
     JOIN temporadas tm ON tm.id = p.temporada_id
     LEFT JOIN variedades v ON v.id = p.variedad_id
     LEFT JOIN materiales m ON m.id = p.producto_id
     LEFT JOIN perfiles pe ON pe.id = p.usuario_id
     LEFT JOIN turnos tu ON tu.id = p.turno_id;

create or replace view public.v_desinfeccion_plan as
SELECT id, temporada_id, temporada_nombre, lote_temporada_id, lote_nomenclatura, lote_nombre, zona_id, zona_nombre,
    ciclo, fecha_siembra_congelada, dias_aplicacion, fecha_aplicacion, dias_preriego, fecha_preriego, variedad_id,
    variedad_nombre, ddt_cosecha, fecha_cosecha, producto_id, producto_nombre, producto_codigo, ingrediente_activo,
    concentracion, dosis_mz, area_planificada_mz, costo_litro, total_litros, total_costo, costo_mz, moneda,
    costo_origen, comentarios, usuario_id, usuario_nombre, created_at,
    turno_id, turno_codigo
   FROM interno.v_desinfeccion_plan_crudo x
  WHERE ( SELECT fn_permitido_de('desinfeccion_plan'::text, 'ver'::text) AS fn_permitido_de) AND
        CASE ( SELECT fn_mi_alcance('desinfeccion_plan'::text, 'ver'::text) AS fn_mi_alcance)
            WHEN 'global'::text THEN true
            WHEN 'propietario'::text THEN usuario_id = (( SELECT auth.uid() AS uid))
            ELSE ( SELECT fn_ve_lote_estricto(x.lote_temporada_id) AS fn_ve_lote_estricto)
        END;

/*
 * Informe ejecutivo: misma forma (mismas columnas) que en la 76; solo cambia de DÓNDE sale la siembra.
 *   - fecha_siembra: la del turno de AGL de cada ejecución (regla de _desinf_siembra_turno, referencia = fecha de
 *     aplicación o de preriego de la ejecución). Si AGL no la publicó: la congelada del plan de desinfección.
 *   - origen_siembra: 'real' si la fecha de AGL ya pasó (hoy en Honduras), 'plan' si es futura o es la del plan.
 *   - variedad: la del plan de desinfección (AGL no publica variedades por lote).
 */
create or replace view interno.v_desinfeccion_informe_crudo with (security_invoker = off) as
 WITH regado AS (
         SELECT dl.lote_temporada_id,
            e.ciclo,
            e.temporada_id,
            lt.zona_id,
            dl.ejecucion_id,
            dl.mz_cubiertas,
            e.fecha_preriego,
            e.fecha_lecturas,
            e.fecha_aplicacion,
            e.fecha_lavado,
            e.caudal_agua,
            e.horas_preriego,
            e.horas_inyeccion,
            e.horas_lavado,
            e.total_horas_riego,
            e.estado,
            e.usuario_id,
                CASE
                    WHEN e.equipo_aplicacion::text = 'Otros'::text THEN e.equipo_aplicacion_otro
                    ELSE e.equipo_aplicacion
                END AS equipo_aplicacion_mostrado,
            dl.mz_cubiertas / NULLIF(sum(dl.mz_cubiertas) OVER (PARTITION BY dl.ejecucion_id), 0::numeric) AS factor
           FROM desinfeccion_ejecucion_lotes dl
             JOIN desinfeccion_ejecucion e ON e.id = dl.ejecucion_id
             JOIN lotes_temporada lt ON lt.id = dl.lote_temporada_id
        ), plan AS (
         SELECT p.lote_temporada_id,
            p.ciclo,
            min(p.fecha_siembra_congelada) AS fecha_siembra_plan,
            min(p.fecha_aplicacion) AS fecha_aplicacion_plan,
            min(p.fecha_preriego) AS fecha_preriego_plan,
            min(
                CASE
                    WHEN v.ddt_cosecha IS NOT NULL THEN p.fecha_siembra_congelada + v.ddt_cosecha
                    ELSE NULL::date
                END) AS fecha_cosecha_plan,
            max(p.area_planificada_mz) AS mz_planificadas,
            sum(p.dosis_mz) AS dosis_mz_plan,
            sum(p.total_litros) AS litros_plan,
            sum(p.total_costo) AS costo_plan,
            count(*) AS lineas_plan,
            min(v.nombre) AS variedad_plan,
            jsonb_agg(jsonb_build_object('producto_id', p.producto_id, 'producto_nombre', m.descripcion, 'producto_codigo', m.codigo, 'dosis_mz', p.dosis_mz, 'area_planificada_mz', p.area_planificada_mz, 'total_litros', p.total_litros, 'costo_litro', p.costo_litro, 'total_costo', p.total_costo, 'dias_preriego', p.dias_preriego, 'fecha_preriego', p.fecha_preriego, 'dias_aplicacion', p.dias_aplicacion, 'fecha_aplicacion', p.fecha_aplicacion) ORDER BY m.codigo) AS planes_detalle
           FROM desinfeccion_plan p
             LEFT JOIN variedades v ON v.id = p.variedad_id
             LEFT JOIN materiales m ON m.id = p.producto_id
          GROUP BY p.lote_temporada_id, p.ciclo
        ), agl AS (
         SELECT r.lote_temporada_id,
            r.ciclo,
            max(s.fecha_siembra) AS fecha_siembra
           FROM regado r
             JOIN desinfeccion_ejecucion e ON e.id = r.ejecucion_id
             CROSS JOIN LATERAL _desinf_siembra_turno(e.turno_id, e.temporada_id, e.ciclo::integer, COALESCE(e.fecha_aplicacion, e.fecha_preriego)) s(turno_ciclo_id, fecha_siembra, agl_id, area_mz, candidatos)
          GROUP BY r.lote_temporada_id, r.ciclo
        ), siembra AS (
         SELECT k.lote_temporada_id,
            k.ciclo,
            COALESCE(a.fecha_siembra, pl.fecha_siembra_plan) AS fecha_siembra,
                CASE
                    WHEN a.fecha_siembra IS NOT NULL AND a.fecha_siembra <= fn_hoy() THEN 'real'::text
                    ELSE 'plan'::text
                END AS origen_siembra,
            pl.variedad_plan AS variedad
           FROM ( SELECT DISTINCT regado.lote_temporada_id, regado.ciclo FROM regado) k
             LEFT JOIN agl a ON a.lote_temporada_id = k.lote_temporada_id AND a.ciclo = k.ciclo
             LEFT JOIN plan pl ON pl.lote_temporada_id = k.lote_temporada_id AND pl.ciclo = k.ciclo
        ), quimicos AS (
         SELECT r.lote_temporada_id,
            r.ciclo,
            sum(dp.costo_total * r.factor) AS costo_quimico,
            sum(dp.costo_total * r.factor) FILTER (WHERE dp.fase = '3_Aplicacion'::fase_personal_desinfeccion) AS costo_quimico_aplicacion,
            sum(dp.costo_total * r.factor) FILTER (WHERE dp.fase = '4_Lavado'::fase_personal_desinfeccion) AS costo_quimico_lavado,
            sum(dp.total_litros * r.factor) FILTER (WHERE dp.fase = '3_Aplicacion'::fase_personal_desinfeccion) AS litros_aplicados,
            (array_agg(dp.ppm_calculada ORDER BY dp.total_litros DESC NULLS LAST) FILTER (WHERE dp.fase = '3_Aplicacion'::fase_personal_desinfeccion))[1] AS ppm_principal,
            jsonb_agg(jsonb_build_object('codigo', dp.producto_codigo, 'nombre', dp.producto_nombre, 'concentracion', dp.concentracion, 'fase', dp.fase, 'objetivos', to_jsonb(COALESCE(dp.objetivos_control, ARRAY[]::text[])), 'objetivos_control', to_jsonb(COALESCE(dp.objetivos_control, ARRAY[]::text[])), 'litros_lote', round(dp.total_litros * r.factor, 4), 'litros_turno', dp.total_litros, 'dosis_mz', round(dp.total_litros * r.factor / NULLIF(r.mz_cubiertas, 0::numeric), 4), 'costo_litro', dp.costo_litro, 'costo_lote', round(dp.costo_total * r.factor, 2), 'ppm_calculada', dp.ppm_calculada, 'cantidad_envases', dp.cantidad_envases, 'tipo_envase', dp.tipo_envase, 'litros', round(dp.total_litros * r.factor, 4), 'costo', round(dp.costo_total * r.factor, 2), 'ppm', dp.ppm_calculada) ORDER BY dp.total_litros DESC NULLS LAST) AS detalle
           FROM regado r
             JOIN interno.v_desinfeccion_productos_crudo dp ON dp.ejecucion_id = r.ejecucion_id
          GROUP BY r.lote_temporada_id, r.ciclo
        ), objetivos AS (
         SELECT r.lote_temporada_id,
            r.ciclo,
            COALESCE(array_agg(DISTINCT btrim(o.obj) ORDER BY (btrim(o.obj))), ARRAY[]::text[]) AS objetivos_control
           FROM regado r
             JOIN desinfeccion_ejecucion_productos dp ON dp.ejecucion_id = r.ejecucion_id AND dp.fase = '3_Aplicacion'::fase_personal_desinfeccion
             CROSS JOIN LATERAL unnest(COALESCE(dp.objetivos_control, ARRAY[]::text[])) o(obj)
          WHERE NULLIF(btrim(o.obj), ''::text) IS NOT NULL
          GROUP BY r.lote_temporada_id, r.ciclo
        ), personal AS (
         SELECT r.lote_temporada_id,
            r.ciclo,
            sum(pe_1.costo_total * r.factor) AS costo_personal,
            sum(pe_1.costo_total * r.factor) FILTER (WHERE pe_1.fase = '1_Preriego'::fase_personal_desinfeccion) AS costo_preriego,
            sum(pe_1.costo_total * r.factor) FILTER (WHERE pe_1.fase = '3_Aplicacion'::fase_personal_desinfeccion) AS costo_aplicacion,
            sum(pe_1.costo_total * r.factor) FILTER (WHERE pe_1.fase = '4_Lavado'::fase_personal_desinfeccion) AS costo_lavado,
            jsonb_agg(jsonb_build_object('fase', pe_1.fase, 'puesto_texto', pe_1.puesto_texto, 'operador_nombre', op.nombre, 'cantidad_personas', pe_1.cantidad_personas, 'salario_base_manual', pe_1.salario_base_manual, 'horas_extras', pe_1.horas_extras, 'jornada_tipo', pe_1.jornada_tipo, 'costo_turno', pe_1.costo_total, 'costo_lote', round(pe_1.costo_total * r.factor, 2)) ORDER BY pe_1.fase, pe_1.puesto_texto) AS cuadrilla_detalle
           FROM regado r
             JOIN desinfeccion_personal pe_1 ON pe_1.ejecucion_id = r.ejecucion_id
             LEFT JOIN operadores op ON op.id = pe_1.operador_id
          GROUP BY r.lote_temporada_id, r.ciclo
        ), acarreo AS (
         SELECT fn_logistica_de_lote.lote_temporada_id,
            fn_logistica_de_lote.ciclo,
            fn_logistica_de_lote.costo_logistica,
            fn_logistica_de_lote.detalle AS logistica_detalle
           FROM fn_logistica_de_lote() fn_logistica_de_lote(lote_temporada_id, ciclo, costo_logistica, detalle)
        ), ejecuciones AS (
         SELECT r.lote_temporada_id,
            r.ciclo,
            jsonb_agg(jsonb_build_object('turno_nombre', tn.nombre, 'turno_codigo', tn.codigo, 'mz_cubiertas', r.mz_cubiertas, 'mz_total_turno', round(r.mz_cubiertas / NULLIF(r.factor, 0::numeric), 4), 'factor_lote', round(r.factor, 6), 'fecha_preriego', e.fecha_preriego, 'hora_inicio_preriego', e.hora_inicio_preriego, 'hora_fin_preriego', e.hora_fin_preriego, 'horas_preriego', e.horas_preriego, 'obs_preriego', e.obs_preriego, 'fecha_lecturas', e.fecha_lecturas, 'lecturas_tensiometro', e.lecturas_tensiometro, 'fecha_aplicacion', e.fecha_aplicacion, 'estacion_nombre', er.nombre, 'equipo_aplicacion_mostrado', r.equipo_aplicacion_mostrado, 'caudal_agua', e.caudal_agua, 'inicio_presurizacion', e.inicio_presurizacion, 'fin_presurizacion', e.fin_presurizacion, 'horas_presurizacion', e.horas_presurizacion, 'hora_inicio_iny', e.hora_inicio_iny, 'hora_fin_iny', e.hora_fin_iny, 'horas_inyeccion', e.horas_inyeccion, 'hora_inicio_lavado', e.hora_inicio_lavado, 'hora_fin_lavado', e.hora_fin_lavado, 'horas_lavado', e.horas_lavado, 'total_horas_riego', e.total_horas_riego, 'agua_total_m3', COALESCE(e.horas_inyeccion, 0::numeric) * e.caudal_agua, 'ce_antes', e.ce_antes, 'ce_durante', e.ce_durante, 'ce_despues', e.ce_despues, 'calibracion_entrada', e.calibracion_entrada, 'calibracion_salida', e.calibracion_salida, 'calibracion_campo', e.calibracion_campo, 'fecha_lavado', e.fecha_lavado) ORDER BY e.fecha_aplicacion, tn.codigo) AS ejecuciones_detalle
           FROM regado r
             JOIN desinfeccion_ejecucion e ON e.id = r.ejecucion_id
             JOIN turnos tn ON tn.id = e.turno_id
             LEFT JOIN estaciones_riego er ON er.id = e.estacion_riego_id
          GROUP BY r.lote_temporada_id, r.ciclo
        ), base AS (
         SELECT r.lote_temporada_id,
            r.ciclo,
            lo.nomenclatura AS lote_nomenclatura,
            lo.nombre AS lote_nombre,
            r.zona_id,
            z.nombre AS zona_nombre,
            r.temporada_id,
            tm.nombre AS temporada_nombre,
            min(r.usuario_id::text)::uuid AS usuario_id,
            max(pl.fecha_siembra_plan) AS fecha_siembra_plan,
            max(pl.fecha_aplicacion_plan) AS fecha_aplicacion_plan,
            max(pl.fecha_preriego_plan) AS fecha_preriego_plan,
            max(pl.fecha_cosecha_plan) AS fecha_cosecha_plan,
            min(r.fecha_preriego) AS fecha_preriego,
            min(r.fecha_lecturas) AS fecha_lecturas,
            min(r.fecha_aplicacion) AS fecha_aplicacion,
            max(r.fecha_lavado) AS fecha_lavado,
            max(sb.fecha_siembra) AS fecha_siembra,
            max(sb.origen_siembra) AS origen_siembra,
            max(sb.variedad) AS variedad,
            max(r.equipo_aplicacion_mostrado::text) AS equipo_aplicacion,
            min(r.fecha_preriego) - max(sb.fecha_siembra) AS ddt_preriego,
            min(r.fecha_aplicacion) - max(sb.fecha_siembra) AS ddt_aplicacion,
            max(r.fecha_lavado) - max(sb.fecha_siembra) AS ddt_lavado,
            max(pl.fecha_aplicacion_plan) - max(sb.fecha_siembra) AS ddt_plan,
            max(pl.fecha_preriego_plan) - max(sb.fecha_siembra) AS ddt_preriego_plan,
            sum(r.mz_cubiertas) AS mz_regadas,
            max(pl.mz_planificadas) AS mz_planificadas,
            max(pl.dosis_mz_plan) AS dosis_mz_plan,
            max(r.caudal_agua) AS caudal_agua,
            sum(r.total_horas_riego) AS horas_riego,
            max(r.estado::text) AS estado,
            max(pl.costo_plan) AS costo_plan,
            (array_agg(pl.planes_detalle))[1] AS planes_detalle
           FROM regado r
             JOIN lotes_temporada lt ON lt.id = r.lote_temporada_id
             JOIN lotes lo ON lo.id = lt.lote_id
             JOIN temporadas tm ON tm.id = r.temporada_id
             LEFT JOIN zonas z ON z.id = r.zona_id
             LEFT JOIN plan pl ON pl.lote_temporada_id = r.lote_temporada_id AND pl.ciclo = r.ciclo
             LEFT JOIN siembra sb ON sb.lote_temporada_id = r.lote_temporada_id AND sb.ciclo = r.ciclo
          GROUP BY r.lote_temporada_id, r.ciclo, lo.nomenclatura, lo.nombre, r.zona_id, z.nombre, r.temporada_id, tm.nombre
        )
 SELECT b.lote_temporada_id,
    b.ciclo,
    b.lote_nomenclatura,
    b.lote_nombre,
    b.zona_id,
    b.zona_nombre,
    b.temporada_id,
    b.temporada_nombre,
    b.usuario_id,
    b.fecha_siembra_plan,
    b.fecha_aplicacion_plan,
    b.fecha_preriego_plan,
    b.fecha_cosecha_plan,
    b.fecha_preriego,
    b.fecha_lecturas,
    b.fecha_aplicacion,
    b.fecha_lavado,
    b.fecha_siembra,
    b.origen_siembra,
    b.variedad,
    b.equipo_aplicacion,
    b.ddt_preriego,
    b.ddt_aplicacion,
    b.ddt_lavado,
    b.ddt_plan,
    b.ddt_preriego_plan,
    b.mz_regadas,
    b.mz_planificadas,
    b.dosis_mz_plan,
    b.caudal_agua,
    b.horas_riego,
    b.estado,
    b.costo_plan,
    b.planes_detalle,
    COALESCE(ob.objetivos_control, ARRAY[]::text[]) AS objetivos_control,
    qu.ppm_principal,
    qu.litros_aplicados / NULLIF(b.mz_regadas, 0::numeric) AS dosis_mz_real,
    COALESCE(qu.costo_quimico, 0::numeric) AS costo_quimico,
    COALESCE(qu.costo_quimico_aplicacion, 0::numeric) AS costo_quimico_aplicacion,
    COALESCE(qu.costo_quimico_lavado, 0::numeric) AS costo_quimico_lavado,
    COALESCE(pe.costo_personal, 0::numeric) AS costo_personal,
    COALESCE(pe.costo_preriego, 0::numeric) AS costo_personal_preriego,
    COALESCE(pe.costo_aplicacion, 0::numeric) AS costo_personal_aplicacion,
    COALESCE(pe.costo_lavado, 0::numeric) AS costo_personal_lavado,
    COALESCE(ac.costo_logistica, 0::numeric) AS costo_logistica,
    COALESCE(qu.detalle, '[]'::jsonb) AS productos,
    COALESCE(pe.cuadrilla_detalle, '[]'::jsonb) AS cuadrilla_detalle,
    COALESCE(ac.logistica_detalle, '[]'::jsonb) AS logistica_detalle,
    COALESCE(ej.ejecuciones_detalle, '[]'::jsonb) AS ejecuciones_detalle,
    COALESCE(b.planes_detalle, '[]'::jsonb) AS planes_detalle_json
   FROM base b
     LEFT JOIN objetivos ob ON ob.lote_temporada_id = b.lote_temporada_id AND ob.ciclo = b.ciclo
     LEFT JOIN quimicos qu ON qu.lote_temporada_id = b.lote_temporada_id AND qu.ciclo = b.ciclo
     LEFT JOIN personal pe ON pe.lote_temporada_id = b.lote_temporada_id AND pe.ciclo = b.ciclo
     LEFT JOIN acarreo ac ON ac.lote_temporada_id = b.lote_temporada_id AND ac.ciclo = b.ciclo
     LEFT JOIN ejecuciones ej ON ej.lote_temporada_id = b.lote_temporada_id AND ej.ciclo = b.ciclo;

-- ---------------------------------------------------------------------
-- 3 · RETIRO DE TRASPLANTE Y RIEGO
-- ---------------------------------------------------------------------

-- Pantallas y permisos (el menú ya no las muestra desde 2026-11-10; las pantallas viven en AGL)
delete from public.vistas_tabla where pantalla in ('trasplante_plan', 'trasplante_diario', 'turnos_riego');
delete from public.navegacion_rol where pantalla in ('trasplante_plan', 'trasplante_diario', 'turnos_riego');
delete from public.permisos where recurso in ('trasplante_plan', 'trasplante_diario', 'turnos_riego');
delete from public.pantallas where codigo in ('trasplante_plan', 'trasplante_diario', 'turnos_riego');

-- Vistas (las de public envuelven a las «crudas» de interno)
drop view if exists public.v_siembras;
drop view if exists public.v_trasplante_avance_diario;
drop view if exists public.v_recepcion_plantulas;
drop view if exists public.v_turnos_riego;
drop view if exists interno.v_siembras_crudo;
drop view if exists interno.v_trasplante_avance_diario_crudo;
drop view if exists interno.v_recepcion_plantulas_crudo;
drop view if exists interno.v_turnos_riego_crudo;

-- Funciones de consulta y acción (todas sus firmas), ANTES que las tablas y los tipos
do $$
declare
    f text;
begin
    for f in
        select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('fn_siembras_de_lotes', 'fn_lotes_regables', 'fn_area_regable',
                            'fn_tope_riego_lote_ciclo', 'fn_origen_tope_riego', 'fn_origen_area_lote_ciclo',
                            'fn_cargar_plan_siembra', 'fn_guardar_productos_siembra', 'fn_marcar_siembra_terminada',
                            'fn_guardar_turno_riego', 'fn_editar_turno_riego',
                            'fn_trasplante_estadisticas', 'fn_trasplante_liquidacion_plantulas',
                            'fn_trasplante_por_semana', 'fn_trasplante_por_ut', 'fn_trasplante_por_variedad',
                            'fn_trasplante_por_zona')
    loop
        execute 'drop function ' || f;
        raise notice 'Función retirada: %', f;
    end loop;
end $$;

-- Tablas (juntas: tienen llaves entre ellas). Sus disparadores y políticas se van con ellas
drop table if exists public.siembra_productos, public.siembras, public.siembras_terminadas, public.planes_siembra,
    public.recepcion_plantulas, public.turnos_riego_detalle, public.turnos_riego, public.planes_nutricionales;

-- Funciones de disparador: DESPUÉS de las tablas (sus disparadores ya no existen).
-- fn_exigir_lote_agricola y fn_touch_updated_at se quedan: las usan otras tablas.
drop function if exists public.fn_validar_area_turno();
drop function if exists public.fn_responsable_del_turno();
drop function if exists public.fn_sincronizar_catalogos_turno();

-- Tipos propios de Turnos de riego
drop type if exists public.estado_turno_riego;
drop type if exists public.fuente_agua;

-- Comprobación final: no queda nada de lo retirado y lo que se conserva sigue ahí
do $$
declare
    restos text;
begin
    select string_agg(n.nspname || '.' || c.relname, ', ') into restos
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'interno')
      and c.relname in ('siembras', 'siembra_productos', 'siembras_terminadas', 'planes_siembra', 'recepcion_plantulas',
                        'turnos_riego', 'turnos_riego_detalle', 'planes_nutricionales', 'v_siembras',
                        'v_trasplante_avance_diario', 'v_recepcion_plantulas', 'v_turnos_riego', 'v_siembras_crudo',
                        'v_trasplante_avance_diario_crudo', 'v_recepcion_plantulas_crudo', 'v_turnos_riego_crudo');
    if restos is not null then
        raise exception 'Quedaron objetos de Trasplante/Riego: %. No se aplicó nada.', restos;
    end if;

    select string_agg(p.proname, ', ') into restos
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'interno')
      and p.prosrc ~ '\m(siembras|planes_siembra|siembra_productos|siembras_terminadas|recepcion_plantulas|turnos_riego|turnos_riego_detalle|planes_nutricionales)\M';
    if restos is not null then
        raise exception 'Funciones que todavía leen tablas retiradas: %. No se aplicó nada.', restos;
    end if;

    if to_regclass('public.turnos') is null or to_regclass('public.estaciones_riego') is null
       or to_regclass('public.turnos_ciclo') is null then
        raise exception 'Faltan turnos / estaciones_riego / turnos_ciclo. No se aplicó nada.';
    end if;
    raise notice '104 aplicada: Desinfección lee la siembra de AGL; Trasplante y Riego retirados.';
end $$;

commit;

notify pgrst, 'reload schema';
