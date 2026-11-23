-- =====================================================================
-- 131 · CAMPO · DEVOLUCIÓN A BODEGA con TODO el detalle (quién retiró, en qué vehículo)
-- =====================================================================
-- Pedido del usuario (2026-11-22) tras probar la 128: «en la bitácora no puedo ver quién fue a retirar el producto,
-- no sé si fue a la bodega, suministro o al taller, si fue en camión o en carro, no sé nada; es producto,
-- prácticamente dinero; todo tiene que quedar bien detallado y no dejar dudas al aire».
--
--   · fert_devoluciones_bodega: chofer_id, vehiculo_id (catálogos de campo de la recepción, 99) y COPIAS del
--     nombre del chofer, la placa/identificación y el tipo de vehículo (del catálogo) tal como se
--     eligieron ese día (si luego se une o renombra un chofer/vehículo, el registro no cambia).
--     Filas anteriores a la 131: esas columnas quedan en null y el teléfono las muestra «sin dato (registro anterior)».
--   · _fert_op_devolucion_bodega (parche por texto, marcas propias): el chofer y el vehículo son OBLIGATORIOS
--     (la recepción deja el vehículo opcional; aquí no, porque es producto que sale), y el vehículo debe tener su tipo en el catálogo (no se pide aparte).
--     Sigue ignorando líneas en 0 y rechazando lo que pase del saldo. Aprende la pareja chofer-vehículo (como la recepción).
--   · fn_fert_estado_campo(date) (parche, patrón 116): el teléfono recibe «devoluciones_bodega» con TODO resuelto:
--     destino, quién la registró, chofer, vehículo, motivo, cuándo, GPS, productos con saldo antes y después,
--     y si fue anulada quién, cuándo y motivo.
--   · fn_fert_exportar(bigint, integer) (parche sobre el bloque de la 128): AGL recibe los mismos campos.
--
-- Correr DESPUÉS de la 128 y la 129. Idempotente. Todo UPDATE/DELETE lleva WHERE.
-- Si se vuelve a correr la 128 (recrea _fert_op_devolucion_bodega sin estos parches), la 99/100 (fn_fert_exportar,
-- fn_fert_estado_campo) o la 116, correr la 131 otra vez. Las columnas y datos no se pierden.
-- =====================================================================


-- ---------------------------------------------------------------- (a) columnas
alter table public.fert_devoluciones_bodega add column if not exists chofer_id       uuid references public.fert_choferes(id);
alter table public.fert_devoluciones_bodega add column if not exists vehiculo_id     uuid references public.fert_vehiculos(id);
alter table public.fert_devoluciones_bodega add column if not exists chofer_nombre   text;
alter table public.fert_devoluciones_bodega add column if not exists vehiculo_placa  text;
alter table public.fert_devoluciones_bodega add column if not exists vehiculo_tipo   text;

comment on column public.fert_devoluciones_bodega.chofer_id is
'131: quién retiró el producto (catálogo de choferes de campo). Null = registro anterior a la 131.';
comment on column public.fert_devoluciones_bodega.vehiculo_tipo is
'131: tipo del vehículo según el catálogo de vehículos de campo (copia de ese día; no hay lista aparte).';

create index if not exists idx_fert_dev_bodega_chofer on public.fert_devoluciones_bodega (chofer_id) where chofer_id is not null;


-- ---------------------------------------------------------------- (b) parches (con marca; se pueden repetir)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer := (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    if v_n <> 1 then
        raise exception '131: en % se esperaba 1 aparición de «%» y hay %', p_fn, p_viejo, v_n;
    end if;
    begin
        execute replace(v_def, p_viejo, p_nuevo);
    exception when others then
        raise exception '131: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- La operación: variables
select pg_temp.parchar('public._fert_op_devolucion_bodega(uuid, jsonb, timestamptz, boolean, uuid)',
    $p$    v_lineas   jsonb;$p$,
    $p$    v_lineas   jsonb;
    v_chofer   uuid := public._fert_uuid(d->>'chofer_id');            -- 131
    v_vehiculo uuid := public._fert_uuid(d->>'vehiculo_id');
    v_vtipo    text;
    v_chofer_n text;
    v_placa    text;$p$,
    $p$v_chofer_n text;$p$);

-- La operación: validación de quién retiró y en qué (antes de tocar el inventario)
select pg_temp.parchar('public._fert_op_devolucion_bodega(uuid, jsonb, timestamptz, boolean, uuid)',
    $p$    -- Las líneas con cantidad 0 o vacía se ignoran (igual que en el teléfono)$p$,
    $p$    -- 131: valida quién retiró y en qué vehículo (obligatorios: es producto que sale de la estación; el tipo sale del catálogo de vehículos)
    select c.nombre into v_chofer_n from public.fert_choferes c where c.id = v_chofer;
    if v_chofer is null or v_chofer_n is null then
        raise exception 'Indica quién retiró el producto (chofer o persona).';
    end if;
    select v.placa, nullif(btrim(v.tipo), '') into v_placa, v_vtipo from public.fert_vehiculos v where v.id = v_vehiculo;
    if v_vehiculo is null or v_placa is null then
        raise exception 'Indica en qué vehículo se llevaron el producto (placa o identificación).';
    end if;
    if v_vtipo is null then
        raise exception 'El vehículo % no tiene tipo (camión, carro, tractor...) en el catálogo: complétalo en Administración › Choferes y catálogos de campo.', v_placa;
    end if;

    -- Las líneas con cantidad 0 o vacía se ignoran (igual que en el teléfono)$p$,
    $p$131: valida quién retiró$p$);

-- La operación: se guardan chofer, vehículo y las copias de lo elegido
select pg_temp.parchar('public._fert_op_devolucion_bodega(uuid, jsonb, timestamptz, boolean, uuid)',
    $p$    insert into public.fert_devoluciones_bodega (id, estacion_id, fecha_hora, destino, motivo, registrado_por)
    values (p_id, v_estacion, v_fecha, v_destino, v_motivo, (select auth.uid()));$p$,
    $p$    insert into public.fert_devoluciones_bodega (id, estacion_id, fecha_hora, destino, motivo, registrado_por,
                                                 chofer_id, vehiculo_id, chofer_nombre, vehiculo_placa, vehiculo_tipo)
    values (p_id, v_estacion, v_fecha, v_destino, v_motivo, (select auth.uid()),
            v_chofer, v_vehiculo, v_chofer_n, v_placa, v_vtipo);$p$,
    $p$vehiculo_placa, vehiculo_tipo)$p$);

-- La operación: aprende la pareja chofer-vehículo (como la recepción: el siguiente registro ofrece primero ese vehículo)
select pg_temp.parchar('public._fert_op_devolucion_bodega(uuid, jsonb, timestamptz, boolean, uuid)',
    $p$    return v_obs;$p$,
    $p$    -- 131: aprende la pareja chofer-vehículo
    insert into public.fert_choferes_vehiculos (chofer_id, vehiculo_id, ultima_vez)
    values (v_chofer, v_vehiculo, v_fecha)
    on conflict (chofer_id, vehiculo_id) do update set ultima_vez = greatest(fert_choferes_vehiculos.ultima_vez, excluded.ultima_vez);
    return v_obs;$p$,
    $p$131: aprende la pareja$p$);

-- Teléfono: la lista de devoluciones a bodega, con todo resuelto (sin depender de catálogos que el teléfono pudiera no tener)
select pg_temp.parchar('public.fn_fert_estado_campo(date)',
    E'    -- Nombres de todas las personas que aparecen',
    E'    -- 131: devoluciones a bodega con TODO el detalle (destino, quién retiró, vehículo, motivo, saldo antes y después, anulación)\n'
    || E'    v_res := v_res || jsonb_build_object(''devoluciones_bodega'', coalesce((\n'
    || E'        select jsonb_agg(jsonb_build_object(\n'
    || E'            ''id'', d.id, ''estacion_id'', d.estacion_id, ''fecha_hora'', d.fecha_hora, ''destino'', d.destino, ''motivo'', d.motivo,\n'
    || E'            ''registrado_por'', d.registrado_por,\n'
    || E'            ''registrado_por_nombre'', (select x.nombre from public.perfiles x where x.id = d.registrado_por),\n'
    || E'            ''chofer_id'', d.chofer_id, ''chofer'', coalesce(d.chofer_nombre, (select c.nombre from public.fert_choferes c where c.id = d.chofer_id)),\n'
    || E'            ''vehiculo_id'', d.vehiculo_id, ''vehiculo'', coalesce(d.vehiculo_placa, (select v.placa from public.fert_vehiculos v where v.id = d.vehiculo_id)),\n'
    || E'            ''vehiculo_tipo'', d.vehiculo_tipo,\n'
    || E'            ''anulado_at'', d.anulado_at, ''anulado_por'', d.anulado_por,\n'
    || E'            ''anulado_por_nombre'', (select x.nombre from public.perfiles x where x.id = d.anulado_por),\n'
    || E'            ''motivo_anulacion'', d.motivo_anulacion,\n'
    || E'            ''operacion'', public._fert_operacion_json(d.id),\n'
    || E'            ''lineas'', coalesce((\n'
    || E'                select jsonb_agg(jsonb_build_object(''material_id'', x.material_id, ''cantidad'', x.cantidad,\n'
    || E'                           ''saldo_antes'', s.despues + x.cantidad, ''saldo_despues'', s.despues) order by m.descripcion)\n'
    || E'                from public.fert_devoluciones_bodega_detalle x\n'
    || E'                join public.materiales m on m.id = x.material_id\n'
    || E'                left join lateral (\n'
    || E'                    select (select sum(m2.cantidad) from public.fert_movimientos m2\n'
    || E'                             where m2.estacion_id = d.estacion_id and m2.material_id = x.material_id and m2.cursor <= mv.cursor) as despues\n'
    || E'                      from public.fert_movimientos mv\n'
    || E'                     where mv.documento_id = d.id and mv.material_id = x.material_id and mv.tipo = ''DEVOLUCION_BODEGA''\n'
    || E'                     limit 1) s on true\n'
    || E'                where x.devolucion_id = d.id), ''[]''::jsonb))\n'
    || E'            order by d.fecha_hora)\n'
    || E'        from public.fert_devoluciones_bodega d\n'
    || E'        where d.estacion_id = any(v_est) and d.fecha_hora >= v_desde), ''[]''::jsonb));\n\n'
    || E'    -- Nombres de todas las personas que aparecen',
    $p$131: devoluciones a bodega con TODO el detalle$p$);

-- AGL: los mismos campos en la lista «devoluciones_bodega» del bloque de la 128 (destino, chofer, vehículo, GPS, quién anuló)
select pg_temp.parchar('public.fn_fert_exportar(bigint, integer)',
    $p$'motivo', d.motivo, 'registrado_por', p.nombre,$p$,
    $p$'motivo', d.motivo, 'registrado_por', p.nombre,
                'chofer', coalesce(d.chofer_nombre, (select c.nombre from public.fert_choferes c where c.id = d.chofer_id)),
                'vehiculo', coalesce(d.vehiculo_placa, (select v.placa from public.fert_vehiculos v where v.id = d.vehiculo_id)),
                'vehiculo_tipo', d.vehiculo_tipo,
                'lat', o.lat, 'lon', o.lon,
                'anulado_por', (select x.nombre from public.perfiles x where x.id = d.anulado_por),$p$,
    $p$'vehiculo_tipo', d.vehiculo_tipo,$p$);

notify pgrst, 'reload schema';
