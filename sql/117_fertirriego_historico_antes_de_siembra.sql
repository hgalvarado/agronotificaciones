-- =====================================================================
-- 117 · FERTIRRIEGO · REGISTRO HISTÓRICO: aceptar aplicaciones ANTES de la siembra (DDT negativo)
-- =====================================================================
-- Pedido del usuario (2026-11-18): el plan tiene aplicaciones previas a la siembra (DDT negativos), así que el
-- registro histórico NO debe rechazar un día anterior a la siembra del turno (la 116 lo hacía). Se quita esa
-- validación de _fert_op_aplicacion_historica; sigue exigiendo día PASADO (< hoy UTC-6), permiso vigente, etc.
--   - ddt_real = día − fecha de siembra (negativo si fue antes). La columna es integer sin restricción de signo.
--   - La aplicación normal (_fert_op_aplicacion) nunca tuvo esta restricción: no se toca.
--   - El duplicado POSIBLE_DUPLICADO y el export a AGL no dependen del signo del DDT.
--
-- Correr DESPUÉS de la 116. Idempotente. Si se vuelve a correr la 116, correr la 117 otra vez (la 116 reescribe la función).
-- =====================================================================

create or replace function pg_temp.parchar117(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer := (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada
    end if;
    if v_n <> 1 then
        raise exception '117: en % se esperaba 1 aparición del bloque y hay % (¿se corrió la 116 antes?)', p_fn, v_n;
    end if;
    execute replace(v_def, p_viejo, p_nuevo);
end $$;

select pg_temp.parchar117('public._fert_op_aplicacion_historica(uuid, jsonb, timestamptz)',
    E'    if v_tc.fecha_siembra is not null and v_fecha < v_tc.fecha_siembra then\n'
    || E'        raise exception ''La aplicación no puede ser anterior a la siembra del turno (%).'', to_char(v_tc.fecha_siembra, ''DD/MM/YYYY'');\n'
    || E'    end if;\n',
    E'    -- 117: se permite un día anterior a la siembra (aplicaciones del plan con DDT negativo)\n',
    '117: se permite un día anterior a la siembra');
