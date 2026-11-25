-- =====================================================================
-- 148 · MOTORES · LAS RECEPCIONES DE COMBUSTIBLE SIEMPRE LLEGAN AL TELÉFONO (arregla «no sale en el historial»)
-- =====================================================================
-- Problema: `fn_mot_estado_campo` solo mandaba lo de los últimos 45 días. Una recepción con fecha anterior (p. ej. registrada
-- con una fecha vieja) subía el saldo del tanque pero no salía en el Historial ni en la tabla (ni quién, cuándo, cuánto).
-- Arreglo: además de la ventana, van SIEMPRE las 10 recepciones más recientes de cada tanque de la estación (y sus nombres).
-- Correr DESPUÉS de la 147. Idempotente. Si se vuelve a correr la 147 → correr la 148.
-- =====================================================================
do $$
begin
    if to_regprocedure('public.fn_mot_estado_campo(date)') is null then
        raise exception '148: falta correr la 147 antes.';
    end if;
end $$;

create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer;
begin
    if position(p_marca in v_def) > 0 then return; end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '148: en % se esperaba 1 aparición de «%» y hay %', p_fn, v_viejo, v_n;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
end $$;

select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$where public._mot_dia(r.fecha_hora) >= v_desde and r.estacion_id = any(v_ests)), '[]'::jsonb),$p$,
    $p$where r.estacion_id = any(v_ests)
               and (public._mot_dia(r.fecha_hora) >= v_desde
                    or r.id in (select x.id from (select q.id, row_number() over (partition by q.tanque_id order by q.fecha_hora desc) as n
                                                     from public.mot_recepciones q where q.estacion_id = any(v_ests)) x where x.n <= 10 /* 148:recientes */))), '[]'::jsonb),$p$,
    '148:recientes');

select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$where public._mot_dia(r.fecha_hora) >= v_desde and r.estacion_id = any(v_ests))), '{}'::jsonb),$p$,
    $p$where r.estacion_id = any(v_ests)
                                     and (public._mot_dia(r.fecha_hora) >= v_desde
                                          or r.id in (select x.id from (select q.id, row_number() over (partition by q.tanque_id order by q.fecha_hora desc) as n
                                                                           from public.mot_recepciones q where q.estacion_id = any(v_ests)) x where x.n <= 10 /* 148:personas */)))), '{}'::jsonb),$p$,
    '148:personas');

notify pgrst, 'reload schema';
