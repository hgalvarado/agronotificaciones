-- =====================================================================
-- 142 · INYECCIÓN · PLAN DE LOTES SIN TURNO (fecha estimada) PARA EL TELÉFONO
-- =====================================================================
-- Decisiones del usuario (2026-11-23): el plan de Inyección sale de la Ruta de siembra; los lotes que todavía NO tienen turno de
-- riego se publican igual al teléfono, por la estación de su zona (AGL decide la estación: solo cuando la zona tiene UNA estación),
-- con una fecha ESTIMADA (siembra de la Ruta + DDT) marcada como tal hasta que el lote tenga turno.
--
-- Contrato con AGL (sin cambiar tablas de clave): una línea de un lote sin turno llega con
--   turno_agl_id = 'SIN-TURNO|<lote normalizado>'  (un «turno» por lote: así la reposición del plan por turno y las marcas
--                                                    «turno|DDT» del teléfono siguen funcionando sin tocarlas),
--   turno = null, fecha_estimada = true, estacion = la de su zona, fecha_plan = siembra + DDT (null si la Ruta no trae fecha).
-- Cuando el lote recibe turno en /TR02 AGL publica la línea con su turno real; la de SIN-TURNO desaparece sola (la publicación es
-- completa y reemplaza por turno).
--
-- Lo que NO cambia: el filtro de zonas de la 141 (`_iny_plan_visible`), `_iny_fila` y las huellas ya bajadas (la aplicación de un
-- lote sin turno guarda turno_agl_id = 'SIN-TURNO|…' tal cual llegó del plan; AGL empareja por lote + producto, no por turno),
-- `_iny_op_aplicacion_lote` (no exige turno: busca la línea del plan por lote/producto/fecha y valida zona, área y objetivos igual).
--
-- Correr DESPUÉS de la 129, 132, 139 y 141. Idempotente. UPDATE/DELETE llevan WHERE. Parches con marca propia 142.
-- Si se vuelve a correr la 129 o la 132 (redefinen fn_iny_publicar y fn_iny_estado_campo), la 139 (fn_iny_estado_campo) o la 141
-- (los parchea), CORRER LA 141 Y LUEGO LA 142 OTRA VEZ.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.fn_iny_publicar(jsonb)') is null
       or to_regprocedure('public.fn_iny_estado_campo(date)') is null
       or to_regprocedure('public._iny_plan_visible(uuid,text,text)') is null then
        raise exception '142: falta correr la 129, 132, 139 y 141 antes.';
    end if;
end $$;

alter table public.iny_plan add column if not exists fecha_estimada boolean;
comment on column public.iny_plan.fecha_estimada is
    '142: true = lote sin turno; fecha_plan es la siembra de la Ruta + DDT (estimada) hasta que el lote tenga turno. null/false = fecha del turno.';


-- ---------------------------------------------------------------- parches (marca propia 142)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer;
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '142: en % se esperaba 1 aparición de «%» y hay % (¿falta correr la 141?)', p_fn, v_viejo, v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '142: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- AGL publica la marca «fecha estimada» de cada línea del plan
select pg_temp.parchar('public.fn_iny_publicar(jsonb)',
    $p$pct_aplicacion numeric) loop$p$,
    $p$pct_aplicacion numeric, fecha_estimada boolean) loop   -- 142:fecha-estimada$p$,
    '142:fecha-estimada');
select pg_temp.parchar('public.fn_iny_publicar(jsonb)',
    $p$pct_aplicacion, publicado_at)$p$,
    $p$pct_aplicacion, fecha_estimada, publicado_at)$p$,
    $p$pct_aplicacion, fecha_estimada, publicado_at)$p$);
select pg_temp.parchar('public.fn_iny_publicar(jsonb)',
    $p$x.pct_aplicacion, now())$p$,
    $p$x.pct_aplicacion, coalesce(x.fecha_estimada, false), now())$p$,
    $p$coalesce(x.fecha_estimada, false)$p$);
select pg_temp.parchar('public.fn_iny_publicar(jsonb)',
    $p$pct_aplicacion = excluded.pct_aplicacion,$p$,
    $p$pct_aplicacion = excluded.pct_aplicacion, fecha_estimada = excluded.fecha_estimada,$p$,
    $p$fecha_estimada = excluded.fecha_estimada$p$);

-- el teléfono recibe la marca (los planes viejos quedan en false)
select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$'pct_aplicacion', p.pct_aplicacion)$p$,
    $p$'pct_aplicacion', p.pct_aplicacion,
                       'fecha_estimada', coalesce(p.fecha_estimada, false))$p$,
    $p$'fecha_estimada', coalesce(p.fecha_estimada, false)$p$);

notify pgrst, 'reload schema';
