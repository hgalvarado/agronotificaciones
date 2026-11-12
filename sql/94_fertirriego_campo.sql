-- =====================================================================
-- MIGRACIÓN 94 · Fertirriego (Etapa B): lo que el teléfono descarga para trabajar sin señal
-- =====================================================================
-- fn_fert_estado_campo(p_desde) devuelve en UNA llamada (la señal en campo es intermitente) todo lo que la app de
-- campo necesita para trabajar sin internet: sus estaciones con permisos y custodia, personas, turnos y plan,
-- materiales, choferes y vehículos, saldos, movimientos y documentos recientes, y el resultado de sus últimos
-- envíos. Solo lo que la persona puede ver (fn_fert_puede). Solo lectura: no cambia nada.
--
-- Además enciende Fertirriego en el menú (pantallas.en_menu, migración 93): aparece solo a quien tenga «Ver» en
-- «Fertirriego · Estaciones». Nadie más ve nada nuevo.
-- Idempotente.
-- =====================================================================

create or replace function public.fn_fert_estado_campo(p_desde date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_yo       uuid := (select auth.uid());
    v_est      uuid[];
    v_turnos   uuid[];
    v_desde    timestamptz;
    v_res      jsonb;
begin
    if v_yo is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'ver')) then
        raise exception 'Tu rol no tiene «Ver» en Fertirriego.' using errcode = '42501';
    end if;

    v_est := array(
        select e.id from public.estaciones_riego e
        where e.activo and public.fn_fert_puede(e.id, 'ver')
        order by e.nombre);

    v_turnos := array(
        select tc.id from public.turnos_ciclo tc
        where tc.estacion_id = any(v_est) and tc.activo);

    -- Desde cuándo bajar movimientos: lo pedido, o desde la siembra más antigua de sus turnos activos (la temporada
    -- por ciclo que pidió el usuario), con un tope de un año.
    v_desde := greatest(
        coalesce(p_desde::timestamptz,
                 (select min(tc.fecha_siembra) - 30 from public.turnos_ciclo tc where tc.id = any(v_turnos))::timestamptz,
                 now() - interval '120 days'),
        now() - interval '365 days');

    select jsonb_build_object(
        'servidor_en', now(),
        'desde', v_desde,
        'yo', (select jsonb_build_object('id', p.id, 'nombre', p.nombre) from public.perfiles p where p.id = v_yo),

        'estaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', e.id, 'nombre', e.nombre, 'zona_id', e.zona_id,
                'zona', (select z.nombre from public.zonas z where z.id = e.zona_id),
                'custodio_id', c.custodio_id,
                'custodio', (select p.nombre from public.perfiles p where p.id = c.custodio_id),
                'custodia_estado', c.estado, 'custodia_desde', c.desde,
                'permisos', jsonb_build_object(
                    'recibir', public.fn_fert_puede(e.id, 'recibir'),
                    'aplicar', public.fn_fert_puede(e.id, 'aplicar'),
                    'contar', public.fn_fert_puede(e.id, 'contar'),
                    'relevo', public.fn_fert_puede(e.id, 'relevo'),
                    'anular', public.fn_fert_puede(e.id, 'anular'),
                    'en_nombre_de', public.fn_fert_puede(e.id, 'en_nombre_de'),
                    'administrar', public.fn_fert_puede(e.id, 'administrar_estaciones'),
                    'gestionar_choferes', public.fn_fert_puede(e.id, 'gestionar_choferes')),
                'personas', coalesce((
                    select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre)
                    from public.perfiles_estaciones pe join public.perfiles p on p.id = pe.perfil_id
                    where pe.estacion_id = e.id and p.activo), '[]'::jsonb)
            ) order by e.nombre)
            from public.estaciones_riego e
            left join public.fert_custodia c on c.estacion_id = e.id
            where e.id = any(v_est)), '[]'::jsonb),

        'turnos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', tc.id, 'turno', t.codigo, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
                'fecha_siembra', tc.fecha_siembra, 'estacion_id', tc.estacion_id, 'orden_sap', tc.orden_sap,
                'plan', tc.plan, 'area_mz', tc.area_mz, 'activo', tc.activo
            ) order by t.codigo)
            from public.turnos_ciclo tc join public.turnos t on t.id = tc.turno_id
            where tc.id = any(v_turnos)), '[]'::jsonb),

        'plan', coalesce((
            select jsonb_agg(jsonb_build_object(
                'turno_ciclo_id', fp.turno_ciclo_id, 'fecha', fp.fecha, 'ddt', fp.ddt, 'material_id', fp.material_id,
                'cantidad', fp.cantidad, 'horas_riego', fp.horas_riego
            ) order by fp.fecha)
            from public.fert_plan fp where fp.turno_ciclo_id = any(v_turnos)), '[]'::jsonb),

        'materiales', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'codigo', m.codigo, 'descripcion', m.descripcion,
                                                'unidad', m.unidad) order by m.descripcion)
            from public.materiales m where m.fertirriego and m.activo), '[]'::jsonb),

        'choferes', coalesce((
            select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'validado', c.validado) order by c.nombre)
            from public.fert_choferes c where c.activo), '[]'::jsonb),
        'vehiculos', coalesce((
            select jsonb_agg(jsonb_build_object('id', v.id, 'placa', v.placa, 'tipo', v.tipo, 'marca', v.marca,
                                                'color', v.color, 'validado', v.validado) order by v.placa)
            from public.fert_vehiculos v where v.activo), '[]'::jsonb),
        'choferes_vehiculos', coalesce((
            select jsonb_agg(jsonb_build_object('chofer_id', cv.chofer_id, 'vehiculo_id', cv.vehiculo_id,
                                                'ultima_vez', cv.ultima_vez))
            from public.fert_choferes_vehiculos cv), '[]'::jsonb),

        'saldos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion_id', s.estacion_id, 'material_id', s.material_id,
                                                'disponible', s.disponible, 'en_transito', s.en_transito))
            from public.fert_saldos s where s.estacion_id = any(v_est)), '[]'::jsonb),

        'movimientos', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', m.id, 'cursor', m.cursor, 'estacion_id', m.estacion_id, 'material_id', m.material_id,
                'tipo', m.tipo, 'cantidad', m.cantidad, 'fecha_hora', m.fecha_hora, 'turno_ciclo_id', m.turno_ciclo_id,
                'documento_tipo', m.documento_tipo, 'documento_id', m.documento_id, 'anula_id', m.anula_id,
                'registrado_por', m.registrado_por
            ) order by m.fecha_hora, m.cursor)
            from public.fert_movimientos m
            where m.estacion_id = any(v_est) and m.fecha_hora >= v_desde), '[]'::jsonb),

        -- Saldo de cada estación y material ANTES de «desde» (para que el kardex arranque bien)
        'saldos_previos', coalesce((
            select jsonb_agg(jsonb_build_object('estacion_id', x.estacion_id, 'material_id', x.material_id, 'saldo', x.saldo))
            from (select m.estacion_id, m.material_id, sum(m.cantidad) as saldo
                  from public.fert_movimientos m
                  where m.estacion_id = any(v_est) and m.fecha_hora < v_desde
                  group by 1, 2) x), '[]'::jsonb),

        'recepciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', r.id, 'estacion_id', r.estacion_id, 'fecha_hora', r.fecha_hora, 'chofer_id', r.chofer_id,
                'vehiculo_id', r.vehiculo_id, 'lugar', r.lugar, 'documento', r.documento, 'comentario', r.comentario,
                'registrado_por', r.registrado_por, 'anulado_at', r.anulado_at, 'motivo_anulacion', r.motivo_anulacion))
            from public.fert_recepciones r where r.estacion_id = any(v_est) and r.fecha_hora >= v_desde), '[]'::jsonb),

        'aplicaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', a.id, 'estacion_id', a.estacion_id, 'turno_ciclo_id', a.turno_ciclo_id, 'fecha', a.fecha,
                'fecha_hora', a.fecha_hora, 'ejecutor_id', a.ejecutor_id, 'ejecutor2_id', a.ejecutor2_id,
                'comentario', a.comentario, 'registrado_por', a.registrado_por, 'anulado_at', a.anulado_at,
                'motivo_anulacion', a.motivo_anulacion,
                'lineas', (select jsonb_agg(jsonb_build_object('material_id', d.material_id, 'cantidad', d.cantidad,
                                                               'en_plan', d.en_plan))
                           from public.fert_aplicaciones_detalle d where d.aplicacion_id = a.id)))
            from public.fert_aplicaciones a where a.estacion_id = any(v_est) and a.fecha_hora >= v_desde), '[]'::jsonb),

        'bitacora_riego', coalesce((
            select jsonb_agg(jsonb_build_object(
                'turno_ciclo_id', b.turno_ciclo_id, 'fecha', b.fecha, 'horas_fertilizacion', b.horas_fertilizacion,
                'horas_riego', b.horas_riego, 'hora_inicio', b.hora_inicio, 'hora_fin', b.hora_fin,
                'ejecutor_id', b.ejecutor_id, 'ejecutor2_id', b.ejecutor2_id, 'comentario', b.comentario))
            from public.fert_bitacora_riego b where b.estacion_id = any(v_est) and b.fecha >= v_desde::date), '[]'::jsonb),

        -- Lo último que mandó ESTA persona (para que el teléfono sepa qué llegó, qué se marcó y qué se rechazó)
        'mis_operaciones', coalesce((
            select jsonb_agg(jsonb_build_object('id', o.id, 'tipo', o.tipo, 'resultado', o.resultado,
                                                'mensaje', o.mensaje, 'observaciones', o.observaciones,
                                                'recibido_en', o.recibido_en) order by o.recibido_en desc)
            from (select * from public.fert_operaciones where perfil_id = v_yo order by recibido_en desc limit 100) o),
            '[]'::jsonb)
    ) into v_res;

    return v_res;
end;
$$;

grant execute on function public.fn_fert_estado_campo(date) to authenticated;

-- Fertirriego en el menú (aparece solo a quien tenga «Ver»)
update public.pantallas
   set en_menu = true, icono = coalesce(icono, 'gota'), ruta = '/fertirriego'
 where codigo = 'fertirriego';
