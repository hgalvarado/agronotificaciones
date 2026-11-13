-- =====================================================================
-- 100 · FERTIRRIEGO · CAMBIOS DE LA SEGUNDA PRUEBA PILOTO
-- =====================================================================
-- Contrato: docs/fertirriego-piloto2.md. Solo AGREGA información a lo que ya bajan el teléfono y AGL:
--   - Teléfono (fn_fert_estado_campo): nombres de las personas, movimientos de envases, conteos con su detalle y, en
--     cada recepción/aplicación/conteo, chofer, vehículo y datos de la operación (para el detalle de la bitácora).
--   - AGL (fn_fert_exportar): TODO lo registrado (recepciones, aplicaciones, conteos, envases, relevos, traslados y
--     rechazados), no solo los movimientos de bodega.
-- Cómo: la función de la 99 queda como «_base» (sin cambios) y la pública le agrega las claves nuevas. Así lo que ya
-- funciona no se toca. Correr DESPUÉS de la 99. Idempotente. Solo lectura: no cambia ningún dato.
-- =====================================================================

do $$
begin
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = '_fert_estado_campo_base') then
        alter function public.fn_fert_estado_campo(date) rename to _fert_estado_campo_base;
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = '_fert_exportar_base') then
        alter function public.fn_fert_exportar(bigint, integer) rename to _fert_exportar_base;
    end if;
end $$;

revoke execute on function public._fert_estado_campo_base(date) from public, anon, authenticated;

-- ¿AGL ve esta estación? Por defecto solo las reales; fn_fert_exportar_pruebas (sql/101) la cambia dentro de su
-- llamada. Va también aquí para que correr la 100 otra vez (antes o después de la 101) no deje fuera lo de prueba.
create or replace function public._fert_agl_ve(p_prueba_de uuid)
returns boolean
language sql stable as $$
    select case when coalesce(current_setting('fert.agl_pruebas', true), '') = 'on'
                then p_prueba_de is not null
                else p_prueba_de is null end
$$;
revoke execute on function public._fert_exportar_base(bigint, integer) from public, anon, authenticated;

/** Datos de la operación que trajo un documento (para el detalle). */
create or replace function public._fert_operacion_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object('creado_en', o.creado_en, 'recibido_en', o.recibido_en, 'lat', o.lat, 'lon', o.lon,
                              'observaciones', to_jsonb(o.observaciones), 'en_nombre_de', o.en_nombre_de,
                              'perfil_id', o.perfil_id)
    from public.fert_operaciones o where o.id = p_id
$$;
revoke execute on function public._fert_operacion_json(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------- teléfono

create or replace function public.fn_fert_estado_campo(p_desde date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_res   jsonb := public._fert_estado_campo_base(p_desde);   -- valida sesión y permisos
    v_est   uuid[];
    v_desde timestamptz;
    v_ids   uuid[];
begin
    v_est := array(select (e->>'id')::uuid from jsonb_array_elements(v_res->'estaciones') e);
    v_desde := (v_res->>'desde')::timestamptz;

    -- Recepciones: + chofer, vehículo y operación
    v_res := jsonb_set(v_res, '{recepciones}', coalesce((
        select jsonb_agg(r || jsonb_build_object(
                   'chofer', (select c.nombre from public.fert_choferes c where c.id = (r->>'chofer_id')::uuid),
                   'vehiculo', (select v.placa from public.fert_vehiculos v where v.id = nullif(r->>'vehiculo_id', '')::uuid),
                   'solo_envases', not exists (select 1 from public.fert_recepciones_detalle d where d.recepcion_id = (r->>'id')::uuid),
                   'operacion', public._fert_operacion_json((r->>'id')::uuid)))
        from jsonb_array_elements(v_res->'recepciones') r), '[]'::jsonb));

    -- Aplicaciones: + operación
    v_res := jsonb_set(v_res, '{aplicaciones}', coalesce((
        select jsonb_agg(a || jsonb_build_object('operacion', public._fert_operacion_json((a->>'id')::uuid)))
        from jsonb_array_elements(v_res->'aplicaciones') a), '[]'::jsonb));

    v_res := v_res || jsonb_build_object(
        'conteos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', c.id, 'estacion_id', c.estacion_id, 'fecha_hora', c.fecha_hora, 'comentario', c.comentario,
                'registrado_por', c.registrado_por, 'anulado_at', c.anulado_at, 'motivo_anulacion', c.motivo_anulacion,
                'operacion', public._fert_operacion_json(c.id),
                'lineas', coalesce((select jsonb_agg(jsonb_build_object('material_id', d.material_id, 'saldo_sistema', d.saldo_sistema,
                                                                        'cantidad_real', d.cantidad_real, 'diferencia', d.diferencia))
                                    from public.fert_conteos_detalle d where d.conteo_id = c.id), '[]'::jsonb))
                order by c.fecha_hora)
            from public.fert_conteos c where c.estacion_id = any(v_est) and c.fecha_hora >= v_desde), '[]'::jsonb),
        'envases_movimientos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', m.id, 'estacion_id', m.estacion_id, 'envase_id', m.envase_id, 'cantidad', m.cantidad,
                'motivo', m.motivo, 'documento_tipo', m.documento_tipo, 'documento_id', m.documento_id,
                'fecha_hora', m.fecha_hora, 'registrado_por', m.registrado_por) order by m.fecha_hora, m.id)
            from public.fert_envases_movimientos m where m.estacion_id = any(v_est) and m.fecha_hora >= v_desde), '[]'::jsonb));

    -- Nombres de todas las personas que aparecen
    v_ids := array(
        select distinct x from (
            select (e->>'registrado_por')::uuid x from jsonb_array_elements(v_res->'movimientos') e
            union all select (e->>'registrado_por')::uuid from jsonb_array_elements(v_res->'recepciones') e
            union all select (e->'operacion'->>'perfil_id')::uuid from jsonb_array_elements(v_res->'recepciones') e
            union all select (e->>'registrado_por')::uuid from jsonb_array_elements(v_res->'aplicaciones') e
            union all select nullif(e->>'ejecutor_id', '')::uuid from jsonb_array_elements(v_res->'aplicaciones') e
            union all select nullif(e->>'ejecutor2_id', '')::uuid from jsonb_array_elements(v_res->'aplicaciones') e
            union all select (e->'operacion'->>'perfil_id')::uuid from jsonb_array_elements(v_res->'aplicaciones') e
            union all select (e->>'registrado_por')::uuid from jsonb_array_elements(v_res->'conteos') e
            union all select (e->>'registrado_por')::uuid from jsonb_array_elements(v_res->'envases_movimientos') e
            union all select nullif(e->>'ejecutor_id', '')::uuid from jsonb_array_elements(v_res->'bitacora_riego') e
            union all select nullif(e->>'custodio_id', '')::uuid from jsonb_array_elements(v_res->'estaciones') e
        ) y where x is not null);
    v_res := v_res || jsonb_build_object('nombres', coalesce((
        select jsonb_object_agg(p.id, p.nombre) from public.perfiles p where p.id = any(v_ids)), '{}'::jsonb));
    return v_res;
end;
$$;


-- ---------------------------------------------------------------- AGL

create or replace function public.fn_fert_exportar(p_cursor bigint default 0, p_limite integer default 5000)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_res jsonb := public._fert_exportar_base(p_cursor, p_limite);   -- valida sesión y permisos
    v_reales uuid[] := array(select id from public.estaciones_riego where public._fert_agl_ve(prueba_de));
begin
    return v_res || jsonb_build_object(
        'recepciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id, 'estacion', e.nombre, 'zona', z.nombre, 'fecha_hora', r.fecha_hora,
                'chofer', c.nombre, 'vehiculo', v.placa, 'vehiculo_tipo', v.tipo, 'documento', r.documento,
                'turnos', (select jsonb_agg(t.codigo order by t.codigo) from public.turnos_ciclo tc
                           join public.turnos t on t.id = tc.turno_id where tc.id = any(r.turnos)),
                'comentario', r.comentario, 'registrado_por', p.nombre,
                'creado_en', o.creado_en, 'recibido_en', o.recibido_en, 'lat', o.lat, 'lon', o.lon,
                'observaciones', to_jsonb(o.observaciones), 'anulado_at', r.anulado_at, 'motivo_anulacion', r.motivo_anulacion,
                'lineas', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'texto', m.descripcion, 'unidad', m.unidad,
                                        'cantidad', d.cantidad, 'origen', m.origen, 'grupo', m.grupo, 'analisis', m.fert_analisis))
                                    from public.fert_recepciones_detalle d join public.materiales m on m.id = d.material_id
                                    where d.recepcion_id = r.id), '[]'::jsonb),
                'envases', coalesce((select jsonb_agg(jsonb_build_object('envase', x.nombre, 'recibidos', x.rec, 'entregados', x.ent))
                                     from (select et.nombre,
                                                  coalesce(sum(em.cantidad) filter (where em.motivo = 'RECEPCION'), 0)::integer as rec,
                                                  coalesce(-sum(em.cantidad) filter (where em.motivo = 'ENTREGA'), 0)::integer as ent
                                           from public.fert_envases_movimientos em
                                           join public.fert_envases_tipos et on et.id = em.envase_id
                                           where em.documento_id = r.id and em.motivo in ('RECEPCION', 'ENTREGA')
                                           group by et.nombre) x), '[]'::jsonb),
                'solo_envases', not exists (select 1 from public.fert_recepciones_detalle d where d.recepcion_id = r.id))
                order by r.fecha_hora)
            from public.fert_recepciones r
            join public.estaciones_riego e on e.id = r.estacion_id
            left join public.zonas z on z.id = e.zona_id
            left join public.fert_choferes c on c.id = r.chofer_id
            left join public.fert_vehiculos v on v.id = r.vehiculo_id
            left join public.perfiles p on p.id = r.registrado_por
            left join public.fert_operaciones o on o.id = r.id
            where r.estacion_id = any(v_reales)), '[]'::jsonb),

        'aplicaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', a.id, 'estacion', e.nombre, 'zona', z.nombre, 'turno', t.codigo, 'turno_agl_id', tc.agl_id,
                'fecha', a.fecha, 'fecha_hora', a.fecha_hora, 'ddt_plan', a.ddt_plan, 'fecha_plan', a.fecha_plan,
                'extra', a.extra, 'ddt_real', a.ddt_real,
                'ejecutor', (select x.nombre from public.perfiles x where x.id = a.ejecutor_id),
                'ejecutor2', (select x.nombre from public.perfiles x where x.id = a.ejecutor2_id),
                'registrado_por', p.nombre, 'comentario', a.comentario, 'observaciones', to_jsonb(o.observaciones),
                'creado_en', o.creado_en, 'recibido_en', o.recibido_en,
                'anulado_at', a.anulado_at, 'motivo_anulacion', a.motivo_anulacion,
                'lineas', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'texto', m.descripcion, 'unidad', m.unidad,
                                        'cantidad', d.cantidad, 'en_plan', d.en_plan, 'origen', m.origen, 'analisis', m.fert_analisis))
                                    from public.fert_aplicaciones_detalle d join public.materiales m on m.id = d.material_id
                                    where d.aplicacion_id = a.id), '[]'::jsonb),
                'devoluciones', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'cantidad', dd.cantidad,
                                              'motivo', dv.motivo, 'fecha_hora', dv.fecha_hora, 'anulado_at', dv.anulado_at))
                                          from public.fert_devoluciones dv
                                          join public.fert_devoluciones_detalle dd on dd.devolucion_id = dv.id
                                          join public.materiales m on m.id = dd.material_id
                                          where dv.aplicacion_id = a.id), '[]'::jsonb))
                order by a.fecha, a.fecha_hora)
            from public.fert_aplicaciones a
            join public.estaciones_riego e on e.id = a.estacion_id
            left join public.zonas z on z.id = e.zona_id
            join public.turnos_ciclo tc on tc.id = a.turno_ciclo_id
            join public.turnos t on t.id = tc.turno_id
            left join public.perfiles p on p.id = a.registrado_por
            left join public.fert_operaciones o on o.id = a.id
            where a.estacion_id = any(v_reales)), '[]'::jsonb),

        'conteos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', c.id, 'estacion', e.nombre, 'zona', z.nombre, 'fecha_hora', c.fecha_hora, 'comentario', c.comentario,
                'registrado_por', p.nombre, 'anulado_at', c.anulado_at, 'motivo_anulacion', c.motivo_anulacion,
                'lineas', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'texto', m.descripcion, 'unidad', m.unidad,
                                        'saldo_sistema', d.saldo_sistema, 'cantidad_real', d.cantidad_real, 'diferencia', d.diferencia,
                                        'origen', m.origen, 'analisis', m.fert_analisis))
                                    from public.fert_conteos_detalle d join public.materiales m on m.id = d.material_id
                                    where d.conteo_id = c.id), '[]'::jsonb))
                order by c.fecha_hora)
            from public.fert_conteos c
            join public.estaciones_riego e on e.id = c.estacion_id
            left join public.zonas z on z.id = e.zona_id
            left join public.perfiles p on p.id = c.registrado_por
            where c.estacion_id = any(v_reales)), '[]'::jsonb),

        'envases_movimientos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', m.id, 'estacion', e.nombre, 'zona', z.nombre, 'envase', et.nombre, 'cantidad', m.cantidad,
                'motivo', m.motivo, 'documento_tipo', m.documento_tipo, 'documento_id', m.documento_id,
                'fecha_hora', m.fecha_hora, 'registrado_por', p.nombre,
                'chofer', (select ch.nombre from public.fert_recepciones r join public.fert_choferes ch on ch.id = r.chofer_id
                           where r.id = m.documento_id),
                'vehiculo', (select v.placa from public.fert_recepciones r join public.fert_vehiculos v on v.id = r.vehiculo_id
                             where r.id = m.documento_id))
                order by m.fecha_hora, m.id)
            from public.fert_envases_movimientos m
            join public.estaciones_riego e on e.id = m.estacion_id
            left join public.zonas z on z.id = e.zona_id
            join public.fert_envases_tipos et on et.id = m.envase_id
            left join public.perfiles p on p.id = m.registrado_por
            where m.estacion_id = any(v_reales)), '[]'::jsonb),

        'relevos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id, 'estacion', e.nombre, 'zona', z.nombre, 'estado', r.estado, 'metodo', r.metodo,
                'entrega', pe.nombre, 'recibe', pr.nombre, 'entregado_at', r.entregado_at, 'recibido_at', r.recibido_at,
                'codigo_verificado', r.codigo_verificado, 'novedades', r.novedades, 'nota_entrega', r.nota_entrega,
                'nota_recibe', r.nota_recibe, 'motivo', r.motivo, 'revisar', r.revisar,
                'diferencias', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'texto', m.descripcion,
                                             'saldo_sistema', d.saldo_sistema, 'cantidad_real', d.cantidad_real, 'diferencia', d.diferencia,
                                             'analisis', m.fert_analisis))
                                         from public.fert_relevos_diferencias d join public.materiales m on m.id = d.material_id
                                         where d.relevo_id = r.id), '[]'::jsonb))
                order by coalesce(r.recibido_at, r.entregado_at, r.created_at))
            from public.fert_relevos r
            join public.estaciones_riego e on e.id = r.estacion_id
            left join public.zonas z on z.id = e.zona_id
            left join public.perfiles pe on pe.id = r.entrega_id
            left join public.perfiles pr on pr.id = r.recibe_id
            where r.estacion_id = any(v_reales)), '[]'::jsonb),

        'traslados', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', t.id, 'origen', eo.nombre, 'destino', ed.nombre, 'estado', t.estado, 'motivo', t.motivo,
                'autorizador', (select x.nombre from public.perfiles x where x.id = t.autorizador_id),
                'creador', (select x.nombre from public.perfiles x where x.id = t.creado_por),
                'creado_at', t.creado_at, 'autorizado_at', t.autorizado_at, 'resuelto_at', t.resuelto_at,
                'nota_autorizacion', t.nota_autorizacion, 'nota_resolucion', t.nota_resolucion,
                'lineas', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'texto', m.descripcion,
                                        'cantidad_enviada', d.cantidad_enviada, 'cantidad_recibida', d.cantidad_recibida,
                                        'analisis', m.fert_analisis))
                                    from public.fert_traslados_detalle d join public.materiales m on m.id = d.material_id
                                    where d.traslado_id = t.id), '[]'::jsonb))
                order by t.creado_at)
            from public.fert_traslados t
            join public.estaciones_riego eo on eo.id = t.origen_id
            join public.estaciones_riego ed on ed.id = t.destino_id
            where t.origen_id = any(v_reales) and t.destino_id = any(v_reales)), '[]'::jsonb),

        'rechazados', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', o.id, 'tipo', o.tipo, 'estacion', e.nombre, 'persona', p.nombre, 'mensaje', o.mensaje,
                'recibido_en', o.recibido_en) order by o.recibido_en desc)
            from public.fert_operaciones o
            left join public.estaciones_riego e on e.id = o.estacion_id
            left join public.perfiles p on p.id = o.perfil_id
            where o.resultado = 'RECHAZADO' and o.recibido_en >= now() - interval '90 days'
              and (o.estacion_id is null or o.estacion_id = any(v_reales))), '[]'::jsonb)
    );
end;
$$;

grant execute on function public.fn_fert_estado_campo(date) to authenticated;
grant execute on function public.fn_fert_exportar(bigint, integer) to authenticated;
revoke execute on function public.fn_fert_estado_campo(date) from public, anon;
revoke execute on function public.fn_fert_exportar(bigint, integer) from public, anon;

notify pgrst, 'reload schema';
