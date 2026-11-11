-- =====================================================================
-- 87 · HORÓMETROS: EL COMPARATIVO ENCADENA POR LECTURA DENTRO DEL DÍA
--
-- Reporte del usuario (2026-11-10): T6603-A79 el 04 y 05-nov va 19218-19224, 19224-19230, 19230-19234,
-- 19234-19237 —secuencia perfecta— y aun así el comparativo salía +6, −10, +4 en rojo.
--
-- Causa: ese día hay DOS lecturas en turno diurno y una nocturna. La ventana encadenaba dentro del día por
-- turno (diurno antes que nocturno) y luego por hora de captura, así que ponía 19230-19234 (diurno, capturado
-- después) antes de 19224-19230 (nocturno) y la cadena se cruzaba.
--
-- Arreglo: dentro del MISMO día se encadena por la lectura (inicial, luego final): el horómetro sólo avanza,
-- así que ese es el orden real de la jornada aunque el turno esté mal puesto o haya dos del mismo turno. Entre
-- días el orden sigue siendo la fecha; el turno y la hora de captura quedan sólo como desempate.
-- No cambia el «inicio de contador» (tablero nuevo): la partición por contador sigue igual.
--
-- Patrón de la 78: se toma la definición actual de la cruda y sólo se cambia el ORDER BY de la ventana.
-- Las columnas no cambian, así que la vista expuesta (reja 66/78) no se toca. Idempotente.
-- =====================================================================

do $$
declare
    v_def   text;
    v_nueva text;
begin
    v_def := rtrim(btrim(pg_get_viewdef('interno.v_horometros_control_crudo'::regclass, true)), ';');

    if v_def ~* 'ORDER BY b\.fecha, b\.horometro_inicial' then
        raise notice '87 · La ventana ya encadena por lectura; nada que hacer.';
        return;
    end if;

    v_nueva := regexp_replace(
        v_def,
        'ORDER BY b\.fecha, \(?fn_orden_turno\(b\.turno\)\)?, b\.created_at',
        'ORDER BY b.fecha, b.horometro_inicial, b.horometro_final, (fn_orden_turno(b.turno)), b.created_at',
        'i'
    );

    if v_nueva = v_def then
        raise exception '87 · No se encontró el ORDER BY esperado en la ventana de v_horometros_control_crudo. No se cambió nada.';
    end if;

    execute 'create or replace view interno.v_horometros_control_crudo as ' || v_nueva;
    execute 'alter view interno.v_horometros_control_crudo set (security_invoker = off)';
    execute 'revoke all on interno.v_horometros_control_crudo from authenticated, anon';
end $$;

-- Guardianes
do $$
begin
    if pg_get_viewdef('interno.v_horometros_control_crudo'::regclass, true) !~* 'ORDER BY b\.fecha, b\.horometro_inicial' then
        raise exception '87 · La ventana no quedó ordenada por lectura.';
    end if;
    if has_table_privilege('authenticated', 'interno.v_horometros_control_crudo', 'select') then
        raise exception '87 · La cruda quedó alcanzable por authenticated.';
    end if;
end $$;
