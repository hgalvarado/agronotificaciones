-- =====================================================================
-- 134 · DEVOLUCIÓN A BODEGA · AGL recibe saldo antes/después por producto y el GPS completo
-- =====================================================================
-- Pedido del usuario (2026-11-22): «es dinero, no dejar dudas al aire». La 131 ya manda al teléfono el saldo antes y
-- después; aquí la exportación a AGL (fn_fert_exportar, lista «devoluciones_bodega» de la 128/131) agrega:
--   · por línea: saldo_antes y saldo_despues de la estación (se calculan del libro fert_movimientos en orden de cursor,
--     igual que el teléfono: saldo después = suma de movimientos hasta el DEVOLUCION_BODEGA de ese producto;
--     antes = después + cantidad devuelta);
--   · GPS: «precision» (m) junto a lat/lon que ya agregó la 131.
-- Correr DESPUÉS de la 131. Idempotente (parches con marca). Sin UPDATE/DELETE.
-- Órdenes: 131>134>131 (la 131 ve su marca y no toca; queda el parche de la 134). Si se vuelve a correr la 128 o la 131 (salvo en el orden 131>134>131), o la 99/100
-- (recrea fn_fert_exportar), correr 128 > 131 > 134 otra vez.
-- =====================================================================

create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada
    end if;
    if v_n <> 1 then
        raise exception '134: en % se esperaba 1 aparición de «%» y hay %', p_fn, v_viejo, v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '134: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- GPS: precisión (el bloque con lat/lon es el de la 131)
select pg_temp.parchar('public.fn_fert_exportar(bigint, integer)',
    $p$'anulado_por', (select x.nombre from public.perfiles x where x.id = d.anulado_por),$p$,
    $p$'precision', o.precision_m,   -- 134: GPS con precisión
                'anulado_por', (select x.nombre from public.perfiles x where x.id = d.anulado_por),$p$,
    $p$134: GPS con precisión$p$);

-- Líneas: saldo antes y después
select pg_temp.parchar('public.fn_fert_exportar(bigint, integer)',
    $p$'cantidad', x.cantidad, 'origen', m.origen, 'grupo', m.grupo, 'analisis', m.fert_analisis))
                                    from public.fert_devoluciones_bodega_detalle x join public.materiales m on m.id = x.material_id$p$,
    $p$'cantidad', x.cantidad, 'origen', m.origen, 'grupo', m.grupo, 'analisis', m.fert_analisis,
                                        'saldo_antes', s.despues + x.cantidad, 'saldo_despues', s.despues))   -- 134: saldo antes y después
                                    from public.fert_devoluciones_bodega_detalle x join public.materiales m on m.id = x.material_id
                                    left join lateral (
                                        select (select sum(m2.cantidad) from public.fert_movimientos m2
                                                 where m2.estacion_id = d.estacion_id and m2.material_id = x.material_id
                                                   and m2.cursor <= mv.cursor) as despues
                                          from public.fert_movimientos mv
                                         where mv.documento_id = d.id and mv.material_id = x.material_id
                                           and mv.tipo = 'DEVOLUCION_BODEGA'
                                         limit 1) s on true$p$,
    $p$134: saldo antes y después$p$);

notify pgrst, 'reload schema';
