-- =====================================================================
-- 161 · Motores: el visor sigue al TANQUE, no al motor (pedido 2026-11-27)
--
-- Con el reemplazo temporal (sql/160) otro motor gasta del mismo tanque entre dos registros del motor dañado. Las señales
-- VISOR_FALTA / VISOR_SOBRA comparaban el visor inicial con el registro anterior DEL MISMO MOTOR y avisaban «faltan 10 gal»
-- (Estacion-A, MPERK-A73, 20-nov: el M6068-A75 gastó esos 10 gal). Ahora se compara con el registro anterior DEL MISMO TANQUE
-- (de cualquier motor; el mismo día, en orden de hora). El horómetro sigue siendo por motor.
-- Parche por texto a _mot_senales (de la 147, con parches de la 150 y la 155). Si se vuelve a correr la 147, 150 o 155 →
-- CORRER LA 161 OTRA VEZ. Idempotente (marca 161:tanque).
-- El teléfono tiene la misma regla (src/lib/motores/senales.ts).
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- Un solo parche con todo (la marca va en el primero; los demás se aplican en la misma redefinición)
do $$
declare
    v_def text := replace(pg_get_functiondef('public._mot_senales(uuid[],date,date)'::regprocedure), E'\r\n', E'\n');
    n integer;
begin
    if position('161:tanque' in v_def) > 0 then
        -- 161b · empate del mismo día y hora: primero el de visor más alto (dentro del día el tanque solo baja), no el uuid
        if position('x.fecha_hora, x.visor_ini desc, x.id' in v_def) = 0 then
            v_def := replace(v_def, 'partition by x.tanque_id order by x.fecha, x.fecha_hora, x.id', 'partition by x.tanque_id order by x.fecha, x.fecha_hora, x.visor_ini desc, x.id');
            execute v_def;
        end if;
        return;
    end if;
    -- 1 · base con los registros de los mismos tanques y el anterior por tanque
    n := (length(v_def) - length(replace(v_def, $p$               lag(x.tanque_id)   over w as p_tq
          from public.mot_registros x
         where x.equipo_id = any(p_equipos) and x.anulado_at is null$p$, ''))) / length($p$               lag(x.tanque_id)   over w as p_tq
          from public.mot_registros x
         where x.equipo_id = any(p_equipos) and x.anulado_at is null$p$);
    if n <> 1 then raise exception '161: no se encontró la base de _mot_senales (%)', n; end if;
    v_def := replace(v_def, $p$               lag(x.tanque_id)   over w as p_tq
          from public.mot_registros x
         where x.equipo_id = any(p_equipos) and x.anulado_at is null$p$,
        $p$               lag(x.tanque_id)   over w as p_tq,
               lag(x.fecha)       over wt as t_fecha,   /* 161:tanque · anterior del MISMO TANQUE (de cualquier motor) */
               lag(x.visor_fin)   over wt as t_vf
          from public.mot_registros x
         where (x.equipo_id = any(p_equipos)
                or x.tanque_id in (select y.tanque_id from public.mot_registros y where y.equipo_id = any(p_equipos) and y.anulado_at is null))
           and x.anulado_at is null$p$);

    n := (length(v_def) - length(replace(v_def, 'window w as (partition by x.equipo_id order by x.fecha)', ''))) / length('window w as (partition by x.equipo_id order by x.fecha)');
    if n <> 1 then raise exception '161: no se encontró la ventana de _mot_senales (%)', n; end if;
    v_def := replace(v_def, 'window w as (partition by x.equipo_id order by x.fecha)',
        'window w as (partition by x.equipo_id order by x.fecha, x.fecha_hora), wt as (partition by x.tanque_id order by x.fecha, x.fecha_hora, x.visor_ini desc, x.id)');

    -- 2 · suministros entre el anterior del tanque y este
    if position('r.p_fecha is not null   -- 155:senales' in v_def) = 0 then raise exception '161: falta el parche de la 155 en _mot_senales'; end if;
    v_def := replace(v_def, 'r.p_fecha is not null   -- 155:senales', 'r.t_fecha is not null   -- 155:senales');
    v_def := replace(v_def, 'public._mot_dia(mv.fecha_hora) > r.p_fecha and', 'public._mot_dia(mv.fecha_hora) > r.t_fecha and');
    v_def := replace(v_def, 'public._mot_dia(mv.fecha_hora) >= r.p_fecha and', 'public._mot_dia(mv.fecha_hora) >= r.t_fecha and');

    -- 3 · VISOR_FALTA / VISOR_SOBRA contra el anterior del tanque
    n := (length(v_def) - length(replace(v_def, 'r.p_fecha is not null and r.p_tq is not distinct from r.tanque_id and r.p_vf is not null', ''))) / length('r.p_fecha is not null and r.p_tq is not distinct from r.tanque_id and r.p_vf is not null');
    if n <> 2 then raise exception '161: se esperaban 2 condiciones de visor y hay %', n; end if;
    v_def := replace(v_def, 'r.p_fecha is not null and r.p_tq is not distinct from r.tanque_id and r.p_vf is not null', 'r.t_fecha is not null and r.t_vf is not null');
    v_def := replace(v_def, 'r.p_vf + u.suma', 'r.t_vf + u.suma');

    -- 4 · solo se devuelven los motores pedidos (la base ahora trae también los de sus tanques)
    n := (length(v_def) - length(replace(v_def, '     where s.texto is not null', ''))) / length('     where s.texto is not null');
    if n <> 1 then raise exception '161: no se encontró el filtro final de _mot_senales (%)', n; end if;
    v_def := replace(v_def, '     where s.texto is not null', '     where s.texto is not null and r.equipo_id = any(p_equipos)');

    execute v_def;
end $$;
