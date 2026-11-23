-- =====================================================================
-- 139 · Bodega general de la estación + Inyección sin obligar a que el producto esté en la bodega
-- (pedido del usuario 2026-11-23, puntos 5 y 12)
--
--   (a) fn_fert_bodega_general(): UNA lista con todo lo que hay en la estación: fertilizantes, productos de
--       inyección/drench/calidad, envases en consignación y el diésel de los tanques de los motores. Es una UNIÓN de
--       lo que ya existe (fert_saldos, fert_envases_movimientos, mot_saldos): no duplica datos ni crea catálogos.
--       Cada fila trae saldo, unidad, última recepción y de dónde vino. La ven quienes tienen «Ver» en la estación.
--   (b) Inyección: cada línea trae «de_bodega» (true = «Sí, lo tomé de la bodega de la estación»: descuenta del saldo;
--       false o ausente = «No, vino aparte»: NO mueve inventario). Nunca se inventa un saldo negativo: si dijo que sí
--       y no alcanza, rige la regla de siempre (en línea se rechaza; con la casilla «sin inventario» se acepta y queda
--       SALDO_NEGATIVO). La respuesta se guarda en iny_aplicaciones_detalle.de_bodega.
--       OJO: un envío viejo de la cola que no trae «de_bodega» ya NO descuenta (decisión del usuario: por defecto no).
--   Si se vuelve a correr la 129 o la 132, correr esta otra vez. Orden: ...129 > 130 > 132 > 138 > 139.
-- =====================================================================

do $$
begin
    if to_regclass('public.iny_aplicaciones_detalle') is null
       or to_regprocedure('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)') is null then
        raise exception '139: falta correr antes la 129 (Inyección por lote) y la 132.';
    end if;
    if to_regclass('public.mot_tanques') is null or to_regclass('public.mot_bajada_config') is null then
        raise exception '139: falta correr antes la 130 (Motores y combustible).';
    end if;
end $$;

-- ---------------------------------------------------------------- (b) Inyección sin bodega
alter table public.iny_aplicaciones_detalle add column if not exists de_bodega boolean;
comment on column public.iny_aplicaciones_detalle.de_bodega is
    '139: true = se tomó de la bodega de la estación (descontó); false = vino aparte (no descontó); null = registro anterior a la 139.';

/** ¿Esta línea se toma de la bodega? Solo con true explícito (en la línea o, si falta, en el registro). */
create or replace function public._iny_linea_de_bodega(d jsonb, p_lineas jsonb, p_material uuid)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v text;
begin
    select x.value->>'de_bodega' into v
      from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x
     where public._fert_uuid(x.value->>'material_id') = p_material
     limit 1;
    v := coalesce(v, d->>'de_bodega');
    return lower(btrim(coalesce(v, ''))) in ('true', 't', '1');
end;
$$;
revoke execute on function public._iny_linea_de_bodega(jsonb, jsonb, uuid) from public, anon, authenticated;

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
        raise exception '139: en % se esperaba 1 aparición de «%» y hay % (¿falta correr la 129?)', p_fn, v_viejo, v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '139: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- Solo mueve la bodega la línea que dijo «Sí, lo tomé de la bodega»; la respuesta queda en el detalle
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    $p$        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'APLICACION_LOTE',
                     -l.cantidad, v_fecha, null, 'aplicacion_lote', p_id, p_inmediato));$p$,
    $p$        -- 139:de_bodega · solo la línea marcada «lo tomé de la bodega» descuenta; las demás vinieron aparte
        update public.iny_aplicaciones_detalle
           set de_bodega = public._iny_linea_de_bodega(d, v_lineas, l.material_id)
         where aplicacion_id = p_id and material_id = l.material_id;
        if public._iny_linea_de_bodega(d, v_lineas, l.material_id) then
            v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'APLICACION_LOTE',
                         -l.cantidad, v_fecha, null, 'aplicacion_lote', p_id, p_inmediato));
        end if;$p$,
    $p$139:de_bodega$p$);

-- El teléfono ve la respuesta en el historial (la huella de AGL no cambia: _iny_fila no se toca)
select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$'en_plan', d.en_plan, 'ddt_plan', d.ddt_plan)$p$,
    $p$'en_plan', d.en_plan, 'ddt_plan', d.ddt_plan, 'de_bodega', d.de_bodega)$p$,
    $p$'de_bodega', d.de_bodega$p$);


-- ---------------------------------------------------------------- (a) Bodega general
/**
 * Todo lo que hay en las estaciones que la persona ve. tipo: FERTILIZANTE | INYECCION | OTRO | ENVASE | DIESEL.
 * `clave` = id del producto, del envase o del tanque (para cruzar con el saldo local del teléfono).
 */
create or replace function public.fn_fert_bodega_general()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_yo     uuid := (select auth.uid());
    v_est    uuid[];
    v_diesel uuid;
begin
    if v_yo is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'ver')) then
        raise exception 'Tu rol no tiene «Ver» en Fertirriego.' using errcode = '42501';
    end if;
    v_est := array(select e.id from public.estaciones_riego e where e.activo and public.fn_fert_puede(e.id, 'ver'));
    select c.material_diesel_id into v_diesel from public.mot_bajada_config c where c.id;

    return jsonb_build_object(
        'servidor_en', now(),
        'filas', coalesce((
            select jsonb_agg(x.fila order by x.estacion_id, x.orden, x.nombre)
            from (
                -- Productos (fertilizantes, inyección y otros): el saldo del libro de la estación
                select s.estacion_id, 1 as orden, coalesce(m.descripcion, m.codigo) as nombre,
                       jsonb_build_object(
                           'estacion_id', s.estacion_id,
                           'tipo', case when m.fert_analisis then 'FERTILIZANTE' when m.iny_activo then 'INYECCION' else 'OTRO' end,
                           'clave', m.id, 'material_id', m.id, 'codigo', m.codigo, 'nombre', coalesce(m.descripcion, m.codigo),
                           'unidad', m.unidad, 'grupo', m.grupo, 'saldo', s.disponible,
                           'ultima_recepcion', coalesce(ur.fecha_hora, um.fecha_hora),
                           'procedencia', case
                               when ur.fecha_hora is not null then
                                   nullif(concat_ws(' · ', nullif(ur.chofer, ''), nullif(ur.placa, ''), nullif(ur.lugar, '')), '')
                               when um.tipo = 'TRASLADO_ENTRADA' then 'Traslado desde otra estación'
                               when um.tipo = 'SALDO_INICIAL' then 'Saldo inicial'
                               else null end) as fila
                  from public.fert_saldos s
                  join public.materiales m on m.id = s.material_id
                  left join lateral (
                      select r.fecha_hora, c.nombre as chofer, v.placa, r.lugar
                        from public.fert_recepciones_detalle d
                        join public.fert_recepciones r on r.id = d.recepcion_id
                        left join public.fert_choferes c on c.id = r.chofer_id
                        left join public.fert_vehiculos v on v.id = r.vehiculo_id
                       where d.material_id = s.material_id and r.estacion_id = s.estacion_id and r.anulado_at is null
                       order by r.fecha_hora desc limit 1) ur on true
                  left join lateral (
                      select mv.fecha_hora, mv.tipo
                        from public.fert_movimientos mv
                       where mv.estacion_id = s.estacion_id and mv.material_id = s.material_id
                         and mv.tipo in ('TRASLADO_ENTRADA', 'SALDO_INICIAL') and mv.anula_id is null
                         and not exists (select 1 from public.fert_movimientos a where a.anula_id = mv.id)
                       order by mv.fecha_hora desc limit 1) um on true
                 where s.estacion_id = any(v_est) and s.disponible <> 0
                union all
                -- Envases en consignación (movimientos con signo)
                select e.estacion_id, 2, t.nombre,
                       jsonb_build_object(
                           'estacion_id', e.estacion_id, 'tipo', 'ENVASE', 'clave', t.id, 'material_id', null, 'codigo', null,
                           'nombre', t.nombre, 'unidad', 'envases', 'grupo', 'Envases', 'saldo', e.saldo,
                           'ultima_recepcion', e.ultima,
                           'procedencia', (select nullif(concat_ws(' · ', nullif(c.nombre, ''), nullif(v.placa, ''), nullif(r.lugar, '')), '')
                                             from public.fert_envases_movimientos em
                                             join public.fert_recepciones r on r.id = em.documento_id
                                             left join public.fert_choferes c on c.id = r.chofer_id
                                             left join public.fert_vehiculos v on v.id = r.vehiculo_id
                                            where em.estacion_id = e.estacion_id and em.envase_id = e.envase_id
                                              and em.motivo = 'RECEPCION' and em.anula_id is null
                                              and not exists (select 1 from public.fert_envases_movimientos a where a.anula_id = em.id)
                                            order by em.fecha_hora desc limit 1))
                  from (select em.estacion_id, em.envase_id, sum(em.cantidad)::integer as saldo,
                               (select max(u.fecha_hora) from public.fert_envases_movimientos u
                                 where u.estacion_id = em.estacion_id and u.envase_id = em.envase_id
                                   and u.motivo = 'RECEPCION' and u.anula_id is null
                                   and not exists (select 1 from public.fert_envases_movimientos a where a.anula_id = u.id)) as ultima
                          from public.fert_envases_movimientos em
                         where em.estacion_id = any(v_est)
                         group by em.estacion_id, em.envase_id
                        having sum(em.cantidad) <> 0) e
                  join public.fert_envases_tipos t on t.id = e.envase_id
                union all
                -- Diésel de los tanques que están en la estación (del tanque fijo o del motor instalado ahí)
                select z.estacion_id, 3, coalesce(dm.descripcion, 'Diésel'),
                       jsonb_build_object(
                           'estacion_id', z.estacion_id, 'tipo', 'DIESEL', 'clave', z.tanque_id, 'material_id', dm.id, 'codigo', dm.codigo,
                           'nombre', coalesce(dm.descripcion, 'Diésel'), 'unidad', coalesce(dm.unidad, 'GAL'), 'grupo', 'Diésel',
                           'saldo', z.saldo, 'ultima_recepcion', z.ultima,
                           'procedencia', z.procedencia,
                           'detalle', z.tanque || coalesce(' · motor ' || z.motor, ''))
                  from (select t.id as tanque_id, coalesce(mo.estacion_id, t.estacion_id) as estacion_id, t.nombre as tanque,
                               eq.codigo as motor, t.material_id,
                               coalesce(sa.disponible, 0) as saldo,
                               rc.fecha_hora as ultima,
                               nullif(concat_ws(' · ', nullif(rc.chofer, ''), nullif(rc.placa, '')), '') as procedencia
                          from public.mot_tanques t
                          left join public.mot_motores mo on mo.tanque_id = t.id and mo.estado = 'EN_ESTACION'
                          left join public.equipos eq on eq.id = mo.equipo_id
                          left join public.mot_saldos sa on sa.tanque_id = t.id
                          left join lateral (
                              select r.fecha_hora, c.nombre as chofer, v.placa
                                from public.mot_recepciones r
                                left join public.fert_choferes c on c.id = r.chofer_id
                                left join public.fert_vehiculos v on v.id = r.vehiculo_id
                               where r.tanque_id = t.id and r.anulado_at is null
                               order by r.fecha_hora desc limit 1) rc on true
                         where t.activo) z
                  left join public.materiales dm on dm.id = coalesce(z.material_id, v_diesel)
                 where z.estacion_id = any(v_est)
            ) x), '[]'::jsonb)
    );
end
$$;
revoke execute on function public.fn_fert_bodega_general() from public, anon;
grant  execute on function public.fn_fert_bodega_general() to authenticated;

notify pgrst, 'reload schema';
