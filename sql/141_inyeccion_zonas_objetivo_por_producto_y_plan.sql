-- =====================================================================
-- 141 · INYECCIÓN · LOTES POR ZONA, OBJETIVO POR PRODUCTO Y PLAN PARA DECIDIR EN CAMPO
-- =====================================================================
-- Pedido del usuario (2026-11-23):
--   (a) «Los lotes deben filtrarse por zona: no pueden haber lotes de zona 1 cuando el usuario tiene asignada solo la
--       zona 2A». El teléfono recibe SOLO los lotes (y el plan) de las zonas de la persona (`perfiles_zonas`; quien tiene
--       «Todas las zonas» o es administrador ve todos: `fn_tiene_zonas()`), y la base RECHAZA registrar un lote de otra
--       zona (`_iny_op_aplicacion_lote`, parche 141:zona). Lote sin zona asignada = no se ofrece a quien tiene zonas
--       recortadas (misma regla estricta de AgroMétricas/Desinfección).
--   (b) «El objetivo se debe elegir por producto, no por registro»: `iny_aplicaciones_detalle.objetivo_ids/objetivos`.
--       El registro conserva `objetivo_ids/objetivos` como la UNIÓN de los de sus productos (compatibilidad: AGL, el
--       cumplimiento, lo ya bajado y los envíos viejos de la cola, que traen un solo objetivo para todo el registro y
--       se heredan a cada producto). Las filas anteriores a la 141 NO se rellenan (su huella de AGL no cambia).
--   (c) Plan para decidir en campo: `iny_plan` guarda la variedad del lote, las observaciones del Excel del LTP, «Control
--       sobre» (qué controla) y el % de aplicación; el teléfono los recibe en el plan.
--
-- Correr DESPUÉS de la 129, 132, 139 (y 92). Idempotente. UPDATE/DELETE llevan WHERE. Parches con marca propia 141.
-- Si se vuelve a correr la 129 o la 132 (redefinen _iny_op_aplicacion_lote, fn_iny_publicar, fn_iny_estado_campo,
-- _iny_fila y _iny_lotes_campo) o la 139 (fn_iny_estado_campo), CORRER LA 141 OTRA VEZ.
--
-- Huellas: `_iny_fila` suma `objetivo_ids/objetivos` al detalle SOLO cuando el detalle los tiene; los registros ya bajados
-- (detalle sin esas claves) conservan su huella. `de_bodega` sigue fuera de la huella (como en la 139).
-- =====================================================================

do $$
begin
    if to_regprocedure('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)') is null
       or to_regprocedure('public._iny_lotes_campo()') is null
       or to_regprocedure('public._iny_linea_de_bodega(jsonb,jsonb,uuid)') is null
       or to_regprocedure('public.fn_tiene_zonas()') is null then
        raise exception '141: falta correr la 92, 129, 132 y 139 antes.';
    end if;
end $$;


-- ---------------------------------------------------------------- columnas nuevas
alter table public.iny_plan add column if not exists variedad text;
alter table public.iny_plan add column if not exists observaciones text;      -- columna «Observaciones» del LTP
alter table public.iny_plan add column if not exists controla text;           -- columna «Control sobre» del LTP
alter table public.iny_plan add column if not exists pct_aplicacion numeric;  -- % de aplicación (calculado × 100)

alter table public.iny_aplicaciones_detalle add column if not exists objetivo_ids uuid[];
alter table public.iny_aplicaciones_detalle add column if not exists objetivos text[];
comment on column public.iny_aplicaciones_detalle.objetivo_ids is
    '141: objetivos de ESTE producto (ids del catálogo iny_objetivos). null = registro anterior a la 141 o enviado con un objetivo único para todo el registro (ver iny_aplicaciones.objetivo_ids).';


-- ---------------------------------------------------------------- zonas
/** ¿La zona es de la persona? Sin recorte de zonas (admin o «Todas las zonas») = sí. Zona vacía + recorte = no. */
create or replace function public._iny_zona_visible(p_zona uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select not public.fn_tiene_zonas()
        or (p_zona is not null and exists (
              select 1 from public.perfiles_zonas pz
               where pz.perfil_id = (select auth.uid()) and pz.zona_id = p_zona))
$$;
revoke execute on function public._iny_zona_visible(uuid) from public, anon;
grant  execute on function public._iny_zona_visible(uuid) to authenticated;

/** ¿Esta línea del plan es de un lote de las zonas de la persona? (por lote_temporada_id; si falta, por nomenclatura + temporada) */
create or replace function public._iny_plan_visible(p_lote_temporada uuid, p_lote text, p_temporada text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select not public.fn_tiene_zonas()
        or exists (
            select 1
              from public.lotes_temporada lt
              left join public.lotes lc on lc.id = lt.lote_id
              left join public.temporadas t on t.id = lt.temporada_id
             where (lt.id = p_lote_temporada
                    or (p_lote_temporada is null
                        and public._iny_norm_lote(lc.nomenclatura) = public._iny_norm_lote(p_lote)
                        and public._fert_llave(t.nombre) = public._fert_llave(p_temporada)))
               and public._iny_zona_visible(lt.zona_id))
$$;
revoke execute on function public._iny_plan_visible(uuid, text, text) from public, anon;
grant  execute on function public._iny_plan_visible(uuid, text, text) to authenticated;

/** Lotes del catálogo para el selector del teléfono: SOLO de las zonas de la persona, con su zona. */
create or replace function public._iny_lotes_campo()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'lote_temporada_id', lt.id, 'nomenclatura', l.nomenclatura, 'nombre', l.nombre,
               'temporada', t.nombre, 'activa', t.activa, 'zona_id', lt.zona_id, 'zona', z.nombre)
               order by l.nomenclatura, t.nombre), '[]'::jsonb)
      from public.lotes_temporada lt
      join public.lotes l on l.id = lt.lote_id and l.activo
      join public.temporadas t on t.id = lt.temporada_id
      left join public.zonas z on z.id = lt.zona_id
     where lt.activo
       and (t.activa or exists (select 1 from public.iny_plan p where public._fert_llave(p.temporada) = public._fert_llave(t.nombre)))
       and public._iny_zona_visible(lt.zona_id)
$$;
revoke execute on function public._iny_lotes_campo() from public, anon, authenticated;


-- ---------------------------------------------------------------- objetivo por producto
/**
 * Objetivos del REGISTRO: los del campo `objetivos` si vienen; si no, la unión de los de sus productos con cantidad.
 * Devuelve siempre un arreglo (vacío si no hay ninguno). Los objetos son {id?, nombre?, tipo?} o textos.
 */
create or replace function public._iny_objetivos_registro(d jsonb)
returns jsonb
language sql stable set search_path = public, pg_temp as $$
    select case
        when jsonb_typeof(d->'objetivos') = 'array' and jsonb_array_length(d->'objetivos') > 0 then d->'objetivos'
        else coalesce((
            select jsonb_agg(distinct o.value)
              from jsonb_array_elements(case when jsonb_typeof(d->'lineas') = 'array' then d->'lineas' else '[]'::jsonb end) l
              cross join lateral jsonb_array_elements(case when jsonb_typeof(l.value->'objetivos') = 'array' then l.value->'objetivos' else '[]'::jsonb end) o
             where not (coalesce(nullif(btrim(l.value->>'cantidad'), ''), '0') ~ '^0*([.,]0*)?$')
        ), '[]'::jsonb)
    end
$$;
revoke execute on function public._iny_objetivos_registro(jsonb) from public, anon, authenticated;

/** Objetivos de UN producto: los de su línea; si no trae, los del registro; si tampoco hay, error claro. */
create or replace function public._iny_linea_objetivos(d jsonb, p_lineas jsonb, p_material uuid, p_user uuid)
returns table (ids uuid[], nombres text[])
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_obj jsonb;
begin
    select x.value->'objetivos' into v_obj
      from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x
     where public._fert_uuid(x.value->>'material_id') = p_material
     limit 1;
    if v_obj is null or jsonb_typeof(v_obj) <> 'array' or jsonb_array_length(v_obj) = 0 then
        v_obj := d->'objetivos';
    end if;
    if v_obj is null or jsonb_typeof(v_obj) <> 'array' or jsonb_array_length(v_obj) = 0 then
        raise exception 'Elige al menos un objetivo para cada producto.';
    end if;
    return query select r.ids, r.nombres from public._iny_resolver_objetivos(v_obj, p_user) r;
end $$;
revoke execute on function public._iny_linea_objetivos(jsonb, jsonb, uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------- parches (marca propia 141)
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
        raise exception '141: en % se esperaba 1 aparición de «%» y hay % (¿faltan la 129, 132 o 139?)', p_fn, v_viejo, v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '141: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- (b) el registro acepta objetivos por producto: la validación previa y la resolución usan la UNIÓN
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$    if d->'objetivos' is null or jsonb_typeof(d->'objetivos') <> 'array' then$p$,
    $p$    if jsonb_typeof(public._iny_objetivos_registro(d)) is distinct from 'array' then   -- 141:obj-registro$p$,
    '141:obj-registro');
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$_iny_resolver_objetivos(d->'objetivos', (select auth.uid()))$p$,
    $p$_iny_resolver_objetivos(public._iny_objetivos_registro(d), (select auth.uid()))$p$,
    $p$_iny_resolver_objetivos(public._iny_objetivos_registro(d)$p$);

-- (b) objetivo de CADA producto, justo antes de la respuesta «de la bodega» de la 139
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$        -- 139:de_bodega$p$,
    $p$        -- 141:obj-linea · el objetivo es de CADA producto (si la línea no lo trae, hereda el del registro)
        update public.iny_aplicaciones_detalle dd
           set objetivo_ids = r.ids, objetivos = r.nombres
          from public._iny_linea_objetivos(d, v_lineas, l.material_id, (select auth.uid())) r
         where dd.aplicacion_id = p_id and dd.material_id = l.material_id;
        -- 139:de_bodega$p$,
    '141:obj-linea');

-- (a) la zona del lote tiene que ser de la persona
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$    v_lote := v_canon;$p$,
    $p$    v_lote := v_canon;
    -- 141:zona · el lote tiene que ser de una zona asignada a la persona (admin / «Todas las zonas» = cualquiera)
    if not public._iny_zona_visible((select lz.zona_id from public.lotes_temporada lz where lz.id = v_lt)) then
        raise exception 'El lote «%» es de otra zona y no está asignado a tu usuario. Elige un lote de tu zona.', v_canon;
    end if;$p$,
    '141:zona');

-- (c) AGL publica variedad, observaciones, «Control sobre» y % de aplicación de cada línea del plan
select pg_temp.parchar('public.fn_iny_publicar(jsonb)',
    $p$ddt integer, fecha_plan date, material text, dosis_mz numeric, area_mz numeric, cantidad_plan numeric) loop$p$,
    $p$ddt integer, fecha_plan date, material text, dosis_mz numeric, area_mz numeric, cantidad_plan numeric,
                  variedad text, observaciones text, controla text, pct_aplicacion numeric) loop   -- 141:plan$p$,
    '141:plan');
select pg_temp.parchar('public.fn_iny_publicar(jsonb)',
    $p$ddt, fecha_plan, material_id, dosis_mz, area_mz, cantidad_plan, publicado_at)$p$,
    $p$ddt, fecha_plan, material_id, dosis_mz, area_mz, cantidad_plan, variedad, observaciones, controla,
                                     pct_aplicacion, publicado_at)$p$,
    $p$cantidad_plan, variedad, observaciones, controla,$p$);
select pg_temp.parchar('public.fn_iny_publicar(jsonb)',
    $p$x.dosis_mz, x.area_mz, x.cantidad_plan, now())$p$,
    $p$x.dosis_mz, x.area_mz, x.cantidad_plan, nullif(btrim(coalesce(x.variedad, '')), ''),
                nullif(btrim(coalesce(x.observaciones, '')), ''), nullif(btrim(coalesce(x.controla, '')), ''),
                x.pct_aplicacion, now())$p$,
    $p$nullif(btrim(coalesce(x.variedad, '')), '')$p$);
select pg_temp.parchar('public.fn_iny_publicar(jsonb)',
    $p$cantidad_plan = excluded.cantidad_plan,$p$,
    $p$cantidad_plan = excluded.cantidad_plan, variedad = excluded.variedad, observaciones = excluded.observaciones,
            controla = excluded.controla, pct_aplicacion = excluded.pct_aplicacion,$p$,
    $p$variedad = excluded.variedad$p$);

-- (c)(a) el teléfono recibe esos campos y SOLO el plan de los lotes de sus zonas
select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$'area_mz', p.area_mz, 'cantidad_plan', p.cantidad_plan)$p$,
    $p$'area_mz', p.area_mz, 'cantidad_plan', p.cantidad_plan,
                       'variedad', p.variedad, 'observaciones', p.observaciones, 'controla', p.controla,
                       'pct_aplicacion', p.pct_aplicacion)$p$,
    $p$'pct_aplicacion', p.pct_aplicacion$p$);
select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$and p.fecha_plan between v_desde and v_hoy + 60), '[]'::jsonb),$p$,
    $p$and p.fecha_plan between v_desde and v_hoy + 60
               and public._iny_plan_visible(p.lote_temporada_id, p.lote, p.temporada)), '[]'::jsonb),   -- 141:zona-plan$p$,
    '141:zona-plan');

-- (b) el historial del teléfono ve el objetivo de cada producto
select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$'en_plan', d.en_plan, 'ddt_plan', d.ddt_plan, 'de_bodega', d.de_bodega)$p$,
    $p$'en_plan', d.en_plan, 'ddt_plan', d.ddt_plan, 'de_bodega', d.de_bodega,
                                     'objetivo_ids', to_jsonb(d.objetivo_ids), 'objetivos', to_jsonb(d.objetivos))$p$,
    $p$'objetivo_ids', to_jsonb(d.objetivo_ids), 'objetivos', to_jsonb(d.objetivos)$p$);

-- (b) la bajada a AGL lleva el objetivo de cada producto SOLO cuando existe (las filas viejas conservan su huella)
select pg_temp.parchar('public._iny_fila(public.iny_aplicaciones)',
    $p$'en_plan', d.en_plan, 'plan_id', d.plan_id, 'ddt_plan', d.ddt_plan)$p$,
    $p$'en_plan', d.en_plan, 'plan_id', d.plan_id, 'ddt_plan', d.ddt_plan)
                       || case when d.objetivo_ids is null then '{}'::jsonb
                               else jsonb_build_object('objetivo_ids', to_jsonb(d.objetivo_ids), 'objetivos', to_jsonb(d.objetivos)) end$p$,
    $p$|| case when d.objetivo_ids is null then '{}'::jsonb$p$);

notify pgrst, 'reload schema';
