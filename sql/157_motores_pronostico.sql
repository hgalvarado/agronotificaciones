-- =====================================================================
-- 157 · Motores: datos para el pronóstico (pedido 2026-11-27)
--
-- La vista General calcula en el teléfono «días de combustible» (galones del tanque ÷ gal/día) y «días para el
-- mantenimiento» (horas que faltan ÷ horas/día). Aquí fn_mot_motores_resumen agrega, por motor, lo de los últimos
-- 14 días (sin anulados): `reciente` = {dias, desde, horas, gal}. `dias` = días distintos con registro.
-- Parche por texto sobre la 149 (marca «157:reciente»). Si se vuelve a correr la 147 o la 149 → CORRER LA 157 OTRA VEZ.
-- Idempotente. Sin UPDATE/DELETE.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

do $$
begin
    if to_regprocedure('public.fn_mot_motores_resumen()') is null then
        raise exception '157: falta fn_mot_motores_resumen (correr 147 y 149 antes).';
    end if;
end $$;

create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def   text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n     integer;
begin
    if position(p_marca in v_def) > 0 then
        return;
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '157: en % se esperaba 1 aparición de «%» y hay % (¿falta la 149?)', p_fn, left(v_viejo, 80), v_n;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
end $$;

select pg_temp.parchar('public.fn_mot_motores_resumen()',
    $p$'horas_desde_mant', mo.horas_desde_mant, 'horas_est_desde_mant', mo.horas_est_desde_mant,$p$,
    $p$'horas_desde_mant', mo.horas_desde_mant, 'horas_est_desde_mant', mo.horas_est_desde_mant, /* 157:reciente */
                   'reciente', (select jsonb_build_object('dias', count(distinct r.fecha), 'desde', public._mot_dia(now()) - 13,
                                                          'horas', coalesce(sum(r.horas), 0), 'gal', coalesce(sum(r.gastado_gal), 0))
                                  from public.mot_registros r
                                 where r.equipo_id = mo.equipo_id and r.anulado_at is null
                                   and r.fecha >= public._mot_dia(now()) - 13),$p$,
    '157:reciente');
