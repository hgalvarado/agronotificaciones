-- ============================================================================================================
-- MIGRACIÓN 138 · Motores: permisos por acción y «Recibir motor» sin motivo
--   Pedido del usuario (2026-11-23): el estacionero hace en el campo el trabajo de recibir, mover, retirar y dar
--   mantenimiento a los motores, así que cada cosa tiene su propio permiso (antes todo colgaba de «Configurar»).
--     motor_recibir        Recibir / instalar un motor en la estación (también «devolver del taller»)
--     motor_mover          Mover un motor a otra estación
--     motor_retirar        Retirar un motor (fin de temporada, daño y reemplazo, taller)
--     motor_mantenimiento  Registrar un mantenimiento
--     registrar            (ya existía) Registrar horas y combustible (registro diario y recibir diésel)
--   «Configurar» sigue valiendo para todo lo anterior (compatibilidad); a ningún rol se le da nada aquí: el usuario
--   asigna las acciones desde Permisos por módulo (nivel «Operar» las enciende; «Estacionero» = esa selección).
--   Recibir un motor ya no pide «motivo»: el motivo (fin de temporada, daño y reemplazo, traslado, otro) solo
--   aplica al mover o retirar. La recepción guarda además horómetro, diésel en el tanque y observación.
--   Requiere 130 (y 133–135 si están). Si se vuelve a correr la 130, correr la 138 después.
--   No cambia la regla «motor no asignado en esa fecha» (eso es de la 136).
-- ============================================================================================================

-- ---------------------------------------------------------------- (a) acciones y pantalla
insert into public.acciones (codigo, nombre, descripcion, orden, escribe, nivel) values
    ('motor_recibir', 'Recibir motor', 'Motores: recibir (instalar) un motor en la estación, o devolverlo del taller.', 124, true, 2),
    ('motor_mover', 'Mover motor', 'Motores: mover un motor de una estación a otra.', 125, true, 2),
    ('motor_retirar', 'Retirar motor', 'Motores: retirar un motor de la estación (fin de temporada, daño y reemplazo, taller).', 126, true, 2),
    ('motor_mantenimiento', 'Registrar mantenimiento', 'Motores: registrar un mantenimiento preventivo o correctivo.', 127, true, 2)
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, escribe = excluded.escribe;

update public.pantallas
   set acciones = array['ver', 'registrar', 'motor_recibir', 'motor_mover', 'motor_retirar', 'motor_mantenimiento', 'anular', 'configurar'],
       descripcion = 'Horas, diésel y mantenimiento de los motores de riego: registrar horas y combustible, recibir, mover y retirar motores y '
                     'registrar mantenimientos, cada cosa con su permiso. Se llega desde Campo (no está en el menú). «Configurar» (todo lo anterior) es del administrador.'
 where codigo = 'motores';

-- ---------------------------------------------------------------- (b) columnas de la recepción
alter table public.mot_asignaciones add column if not exists horometro   numeric;
alter table public.mot_asignaciones add column if not exists diesel_gal  numeric;
alter table public.mot_asignaciones add column if not exists observacion text;

-- ---------------------------------------------------------------- (c) permiso por acción (+ configurar, por compatibilidad)
create or replace function public._mot_autorizar_accion(p_estacion uuid, p_accion text, p_ver boolean default true)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('motores', p_accion) or public.fn_tiene_permiso('motores', 'configurar')) then
        raise exception 'Tu rol no tiene el permiso «%» en Motores y combustible. Se asigna en Permisos.',
            coalesce((select a.nombre from public.acciones a where a.codigo = p_accion), p_accion) using errcode = '42501';
    end if;
    if p_estacion is not null then
        if not exists (select 1 from public.estaciones_riego where id = p_estacion) then
            raise exception 'La estación no existe. Actualiza la aplicación.';
        end if;
        if p_ver and not public.fn_fert_puede(p_estacion, 'ver') then
            raise exception 'No tienes acceso a esa estación.' using errcode = '42501';
        end if;
    end if;
end $$;
revoke execute on function public._mot_autorizar_accion(uuid, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- (d) parches a las funciones de la 130
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    if v_n <> 1 then
        raise exception '138: en % se esperaba 1 aparición de «%» y hay % (¿falta correr la 130?)', p_fn, v_viejo, v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '138: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- mantenimiento: su propio permiso
select pg_temp.parchar('public._mot_op_mantenimiento(uuid, jsonb, timestamptz, boolean, uuid)',
    $p$perform public._mot_autorizar_config(mo.estacion_id);$p$,
    $p$perform public._mot_autorizar_accion(mo.estacion_id, 'motor_mantenimiento');$p$,
    $p$_mot_autorizar_accion(mo.estacion_id, 'motor_mantenimiento')$p$);

-- asignaciones: el motivo solo se pide al salir (mover o retirar); recibir lo fija solo
select pg_temp.parchar('public._mot_aplicar_asignacion(uuid, jsonb, timestamptz, text)',
    $p$    if v_motivo is null then
        raise exception 'Escribe el motivo.';
    end if;$p$,
    $p$    if p_tipo in ('INSTALADO', 'DE_VUELTA') then
        v_codigo := null;
        v_motivo := case p_tipo when 'INSTALADO' then 'Recepción del motor' else 'Regreso del taller' end;
    elsif v_motivo is null and v_codigo is not null then
        v_motivo := case v_codigo when 'FIN_TEMPORADA' then 'Fin de temporada' when 'DANO_REEMPLAZO' then 'Daño o reemplazo'
                                  when 'CAMBIO_ESTACION' then 'Traslado a otra estación' when 'MANTENIMIENTO' then 'Mantenimiento' else null end;
    end if;
    if v_motivo is null then
        raise exception 'Elige el motivo.';
    end if;$p$,
    $p$'Recepción del motor'$p$);

-- asignaciones: permisos por acción (traslado: basta ver una de las dos estaciones)
select pg_temp.parchar('public._mot_aplicar_asignacion(uuid, jsonb, timestamptz, text)',
    $p$    if v_salida then perform public._mot_autorizar_config(v_origen); end if;
    if v_entrada then perform public._mot_autorizar_config(v_dest); end if;$p$,
    $p$    if p_tipo = 'TRASLADADO' then
        perform public._mot_autorizar_accion(v_origen, 'motor_mover', false);
        perform public._mot_autorizar_accion(v_dest, 'motor_mover', false);
        if not (public.fn_fert_puede(v_origen, 'ver') or public.fn_fert_puede(v_dest, 'ver')) then
            raise exception 'No tienes acceso a ninguna de las dos estaciones.' using errcode = '42501';
        end if;
    else
        if v_salida then perform public._mot_autorizar_accion(v_origen, 'motor_retirar'); end if;
        if v_entrada then perform public._mot_autorizar_accion(v_dest, 'motor_recibir'); end if;
    end if;$p$,
    $p$'motor_retirar'$p$);

-- asignaciones: horómetro, diésel en el tanque (saldo inicial) y observación de la recepción
select pg_temp.parchar('public._mot_aplicar_asignacion(uuid, jsonb, timestamptz, text)',
    $p$    if v_base is not null then
        perform public._mot_recalcular_horas(v_eq);
    end if;$p$,
    $p$    update public.mot_asignaciones
       set horometro = public._mot_num(d->>'horometro'), diesel_gal = public._mot_num(d->>'diesel_gal'),
           observacion = nullif(btrim(coalesce(d->>'observacion', '')), '')
     where id = p_id;
    if v_entrada and v_tanque is not null and public._mot_num(d->>'diesel_gal') is not null then
        if public._mot_num(d->>'diesel_gal') < 0 then
            raise exception 'El diésel del tanque no puede ser negativo.';
        end if;
        v_mat := coalesce((select tt.material_id from public.mot_tanques tt where tt.id = v_tanque),
                          (select c.material_diesel_id from public.mot_bajada_config c where c.id));
        if v_mat is not null then
            perform public._mot_mover(p_id, v_tanque, v_mat, 'SALDO_INICIAL',
                                      public._mot_num(d->>'diesel_gal') - public._mot_saldo_actual(v_tanque), v_fecha, 'motor_asignacion', p_id);
        end if;
    end if;
    if v_base is not null then
        perform public._mot_recalcular_horas(v_eq);
    end if;$p$,
    $p$'SALDO_INICIAL'$p$);

-- estado de campo: banderas por acción y motores de otras estaciones (para elegir el que se va a recibir o mover)
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$'configurar', v_conf),$p$,
    $p$'configurar', v_conf,
            'motor_recibir', v_conf or public.fn_tiene_permiso('motores', 'motor_recibir'),
            'motor_mover', v_conf or public.fn_tiene_permiso('motores', 'motor_mover'),
            'motor_retirar', v_conf or public.fn_tiene_permiso('motores', 'motor_retirar'),
            'motor_mantenimiento', v_conf or public.fn_tiene_permiso('motores', 'motor_mantenimiento')),$p$,
    $p$'motor_mantenimiento', v_conf$p$);

select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$or (mo.estacion_id is null and v_conf))) x), '[]'::jsonb),$p$,
    $p$or (mo.estacion_id is null and (v_conf or public.fn_tiene_permiso('motores', 'motor_recibir'))))) x), '[]'::jsonb),
        'otras_estaciones', case when v_conf or public.fn_tiene_permiso('motores', 'motor_mover') or public.fn_tiene_permiso('motores', 'motor_recibir') then coalesce((
            select jsonb_agg(jsonb_build_object(
                       'equipo_id', mo.equipo_id, 'codigo', e.codigo, 'nombre', e.nombre, 'modelo', mo.modelo, 'estado', mo.estado,
                       'estacion_id', mo.estacion_id, 'estacion_nombre', er.nombre) order by e.codigo)
              from public.mot_motores mo
              join public.equipos e on e.id = mo.equipo_id
              join public.estaciones_riego er on er.id = mo.estacion_id
             where mo.activo and mo.estacion_id is not null and not public.fn_fert_puede(mo.estacion_id, 'ver')), '[]'::jsonb) else '[]'::jsonb end,$p$,
    $p$'otras_estaciones'$p$);

notify pgrst, 'reload schema';
