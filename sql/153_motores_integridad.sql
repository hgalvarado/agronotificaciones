-- =====================================================================
-- 153 · MOTORES · INTEGRIDAD DEL TANQUE: CORRECCIÓN EN CADENA, RECEPCIONES CONSUMIDAS Y ELIMINAR SIN DESCUADRES
-- =====================================================================
-- Problemas que cierra (todo es el visor contra el libro del tanque; el visor es la realidad):
-- (1) Corregir/anular un registro diario que NO es el último desplazaba el saldo del tanque (el día intermedio cambia su consumo y
--     los registros posteriores ya habían asentado su propio ajuste). Ahora, tras anular un registro, tras guardar un registro
--     «fuera de orden» y tras eliminarlo por completo, el tanque se REALINEA: saldo = visor final del último registro vigente
--     (no histórico) + lo recibido/suministrado/devuelto en días posteriores a ese registro. La diferencia se asienta como UN
--     movimiento AJUSTE_VISOR (documento_tipo `motor_realineo`), visible en el kardex; si ya cuadra no se asienta nada
--     (idempotente). Los horómetros y las horas hacia el mantenimiento ya se recalculaban (`_mot_recalcular_horas`).
-- (2) Anular una recepción de combustible ya gastada dejaba el tanque en negativo. Nueva regla: si el saldo del libro queda en
--     negativo por esa anulación (y antes no lo estaba) se RECHAZA con un mensaje claro («usa Corregir recepción»); solo un
--     administrador puede aceptarlo, marcando `acepta_saldo_negativo` en la operación, y queda la observación SALDO_NEGATIVO.
--     Lo mismo para «Corregir recepción» (la 150) cuando la corrección empeora un saldo que estaba bien.
-- (3) «Eliminar por completo» una recepción no recalculaba el registro del día; ahora recalcula recibido/gastado/rendimiento del
--     día (la función de la 150) y realinea el tanque; eliminar un registro también realinea.
-- (4) Una corrección de recepción ya no se salta el permiso «registrar» del módulo (solo se salta la custodia: la anulación ya
--     validó «Anular» o su jornada). El mensaje de permiso de la anulación ahora dice «anular o corregir».
--
-- Correr DESPUÉS de la 147–151. Idempotente. Todo UPDATE/DELETE lleva WHERE. Parches por texto con marcas «153:».
-- ORDEN: si se vuelve a correr la 130, 140, 144, 147 o 150 (redefinen o parchan _mot_op_anulacion, _mot_op_diesel_recibir,
-- _mot_op_registro_diario o fn_campo_eliminar_documento) → CORRER LA 153 OTRA VEZ (después de la 150).
-- La 152 está reservada: no se usa aquí.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

do $$
begin
    if position('150:corregir' in pg_get_functiondef('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) = 0
       or position('150:saldo' in pg_get_functiondef('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)'::regprocedure)) = 0
          and position('153:saldo' in pg_get_functiondef('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)'::regprocedure)) = 0 then
        raise exception '153: faltan los cambios de la 150: corre la 147, la 150 y vuelve a correr la 153.';
    end if;
end $$;

-- ---------------------------------------------------------------- 1 · operación de servicio (para asentar un realineo sin operación de teléfono)
create or replace function public._mot_op_realineo(p_motivo text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid := gen_random_uuid();
begin
    insert into public.fert_operaciones (id, tipo, perfil_id, creado_en, recibido_en, inmediato, datos, resultado, mensaje)
    values (v_id, 'motor_realineo', coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid), now(), now(), true,
            jsonb_build_object('motivo', p_motivo), 'ACEPTADO', p_motivo);
    return v_id;
end $$;
revoke execute on function public._mot_op_realineo(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2 · realinear el tanque con el visor del último registro
/**
 * Deja el saldo del tanque = visor final del último registro vigente (no histórico) + lo que entró DESPUÉS de ese día
 * (recepciones, suministros, devoluciones; ya con sus anulaciones). p_op = operación que asienta el ajuste (null = se crea una de
 * servicio solo si hace falta). Devuelve el ajuste asentado (0 si ya cuadraba). No hace nada dentro de una corrección
 * (`mot.sin_recalculo` = on: la corrección lo llama al final).
 */
create or replace function public._mot_realinear_tanque(p_tanque uuid, p_op uuid default null)
returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r      record;
    v_esp  numeric;
    v_dif  numeric;
    v_mat  uuid;
    v_op   uuid := p_op;
begin
    if p_tanque is null then
        return 0;
    end if;
    if coalesce(current_setting('mot.sin_recalculo', true), '') = 'on' then
        return 0;
    end if;
    select x.fecha, x.visor_fin into r
      from public.mot_registros x
      left join public.fert_operaciones o on o.id = x.id
     where x.tanque_id = p_tanque and x.anulado_at is null
       and not coalesce('REGISTRO_HISTORICO' = any(o.observaciones), false)
     order by x.fecha desc, x.fecha_hora desc, x.id desc
     limit 1;
    if not found then
        return 0;   -- sin registro vigente no hay visor contra el cual alinear
    end if;
    select r.visor_fin + coalesce(sum(m.cantidad + coalesce((select sum(a.cantidad) from public.mot_movimientos a where a.anula_id = m.id), 0)), 0)
      into v_esp
      from public.mot_movimientos m
     where m.tanque_id = p_tanque and m.anula_id is null
       and m.tipo in ('RECEPCION_DIESEL', 'SUMINISTRO', 'DEVOLUCION_TANQUE')
       and public._mot_dia(m.fecha_hora) > r.fecha;
    v_dif := public._mot_saldo_actual(p_tanque) - v_esp;
    if abs(v_dif) <= 0.005 then
        return 0;
    end if;
    v_mat := coalesce((select t.material_id from public.mot_tanques t where t.id = p_tanque),
                      (select c.material_diesel_id from public.mot_bajada_config c where c.id));
    if v_mat is null then
        return 0;
    end if;
    if v_op is null then
        v_op := public._mot_op_realineo('Realineo del tanque con el visor');
    end if;
    perform public._mot_mover(v_op, p_tanque, v_mat, 'AJUSTE_VISOR', -v_dif, now(), 'motor_realineo', null);
    return -v_dif;
end $$;
revoke execute on function public._mot_realinear_tanque(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3 · parches (marca propia 153)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def   text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n     integer;
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '153: en % se esperaba 1 aparición de «%» y hay % (¿faltan 130/140/144/147/150?)', p_fn, left(v_viejo, 80), v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '153: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- 3a · anular una recepción: si ya se gastó (el tanque quedaría en negativo) se rechaza; luego el tanque se realinea con el visor
select pg_temp.parchar('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)',
$p$    if v_tipo = 'diesel_recepcion' and coalesce(current_setting('mot.sin_recalculo', true), '') <> 'on'
       and public._mot_saldo_actual((select z.tanque_id from public.mot_recepciones z where z.id = v_doc)) < 0 then
        return array['SALDO_NEGATIVO'];
    end if;
$p$,
$p$    -- 150:saldo (esta marca se conserva a propósito: la 150 no debe volver a ponerse encima de la 153)
    if v_tipo = 'diesel_recepcion' and coalesce(current_setting('mot.sin_recalculo', true), '') <> 'on' then   -- 153:saldo
        declare
            v_t   uuid    := (select z.tanque_id from public.mot_recepciones z where z.id = v_doc);
            v_g   numeric := (select z.galones from public.mot_recepciones z where z.id = v_doc);
            v_s   numeric := public._mot_saldo_actual((select z.tanque_id from public.mot_recepciones z where z.id = v_doc));
            v_neg boolean := false;
        begin
            if v_s < 0 and v_s + v_g >= 0 then
                -- antes estaba bien y esta anulación lo deja en negativo: ese diésel ya se gastó
                if not (public.fn_es_admin() and lower(coalesce(d->>'acepta_saldo_negativo', '')) in ('true', 't', '1')) then
                    raise exception 'No se puede anular: ese diésel ya se gastó y el tanque quedaría en % gal. Usa «Corregir recepción» para cambiar los galones.', round(v_s, 2);
                end if;
                v_neg := true;
            elsif v_s < 0 then
                v_neg := true;   -- ya estaba en negativo: no se bloquea al usuario
            end if;
            perform public._mot_realinear_tanque(v_t, p_id);
            if v_neg then
                return array['SALDO_NEGATIVO'];
            end if;
        end;
    end if;
$p$,
$p$153:saldo$p$);

-- 3b · anular un registro diario: el tanque se realinea con el visor del último registro que quede (corregir un día intermedio)
select pg_temp.parchar('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)',
$p$        perform public._mot_refrescar_ultimo(v_equipo);
$p$,
$p$        perform public._mot_refrescar_ultimo(v_equipo);
        -- 153:realinear · el visor es la realidad: el saldo del tanque vuelve a seguir al último registro vigente
        perform public._mot_realinear_tanque((select z.tanque_id from public.mot_registros z where z.id = v_doc), p_id);
$p$,
$p$153:realinear$p$);

-- 3c · mensaje de permiso (también aplica a corregir)
select pg_temp.parchar('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)',
$p$'Solo puedes anular tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'$p$,
$p$'Solo puedes anular o corregir tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'   /* 153:msg */$p$,
$p$153:msg$p$);

-- 3d · recibir diésel: una corrección no se salta el permiso «registrar» (solo la custodia, que ya validó la anulación)
select pg_temp.parchar('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)',
$p$    if nullif(btrim(coalesce(d->>'corrige_id', '')), '') is null then   -- 150:autorizar · una corrección ya validó sus permisos al anular
        v_obs := public._mot_autorizar(t.estacion_id, 'registrar', p_creado, p_inmediato, p_en_nombre);
    end if;
$p$,
$p$    if nullif(btrim(coalesce(d->>'corrige_id', '')), '') is null then   -- 150:autorizar · una corrección ya validó sus permisos al anular
        v_obs := public._mot_autorizar(t.estacion_id, 'registrar', p_creado, p_inmediato, p_en_nombre);
    else
        perform public._mot_exigir_permiso('registrar');   -- 153:autorizar · la custodia ya la validó la anulación; el permiso del módulo se exige igual
    end if;
$p$,
$p$153:autorizar$p$);

-- 3e · corregir una recepción: rechaza si empeora un saldo que estaba bien (salvo administrador que lo confirma) y realinea los tanques
select pg_temp.parchar('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)',
$p$        if public._mot_saldo_actual(t.id) < 0
           or public._mot_saldo_actual(coalesce((select z.tanque_id from public.mot_recepciones z where z.id = public._fert_uuid(d->>'corrige_id')), t.id)) < 0 then
            v_obs := public._fert_obs(v_obs, array['SALDO_NEGATIVO']);
        end if;
$p$,
$p$        -- 153:corregir-saldo
        declare
            v_to  uuid;
            v_go  numeric;
            v_neg boolean := false;
        begin
            select z.tanque_id, z.galones into v_to, v_go from public.mot_recepciones z where z.id = public._fert_uuid(d->>'corrige_id');
            v_to := coalesce(v_to, t.id);
            v_go := coalesce(v_go, 0);
            if v_to = t.id then
                if public._mot_saldo_actual(t.id) < 0 and public._mot_saldo_actual(t.id) - (v_gal - v_go) >= 0 then
                    v_neg := true;
                end if;
            else
                if public._mot_saldo_actual(t.id) < 0 and public._mot_saldo_actual(t.id) - v_gal >= 0 then
                    v_neg := true;
                end if;
                if public._mot_saldo_actual(v_to) < 0 and public._mot_saldo_actual(v_to) + v_go >= 0 then
                    v_neg := true;
                end if;
            end if;
            if v_neg and not (public.fn_es_admin() and lower(coalesce(d->>'acepta_saldo_negativo', '')) in ('true', 't', '1')) then
                raise exception 'No se puede corregir: ese diésel ya se gastó y el tanque quedaría en negativo. Revisa los galones o los registros del día.';
            end if;
            if v_neg or public._mot_saldo_actual(t.id) < 0 or public._mot_saldo_actual(v_to) < 0 then
                v_obs := public._fert_obs(v_obs, array['SALDO_NEGATIVO']);
            end if;
            perform public._mot_realinear_tanque(t.id, p_id);
            if v_to <> t.id then
                perform public._mot_realinear_tanque(v_to, p_id);
            end if;
        end;
$p$,
$p$153:corregir-saldo$p$);

-- 3f · registro diario «fuera de orden» (día que no es el último): el tanque se realinea con el visor del último registro
select pg_temp.parchar('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)',
$p$        perform public._mot_mover(p_id, v_tanque, v_mat, 'CONSUMO_MOTOR', -v_gast, v_fh, 'motor_registro', p_id);
    end if;
$p$,
$p$        perform public._mot_mover(p_id, v_tanque, v_mat, 'CONSUMO_MOTOR', -v_gast, v_fh, 'motor_registro', p_id);
        if not v_reciente then
            perform public._mot_realinear_tanque(v_tanque, p_id);   -- 153:realinear · un día intermedio no desplaza el saldo del tanque
        end if;
    end if;
$p$,
$p$153:realinear$p$);

-- 3g · eliminar por completo: un registro realinea el tanque; una recepción recalcula el registro del día y realinea
select pg_temp.parchar('public.fn_campo_eliminar_documento(text, uuid, text)',
$p$                perform public._mot_refrescar_ultimo(v_equipo);
$p$,
$p$                perform public._mot_refrescar_ultimo(v_equipo);
                perform public._mot_realinear_tanque(v_tanque);   -- 153:realinear-registro
$p$,
$p$153:realinear-registro$p$);

select pg_temp.parchar('public.fn_campo_eliminar_documento(text, uuid, text)',
$p$                delete from public.mot_recepciones where id = p_documento;
$p$,
$p$                delete from public.mot_recepciones where id = p_documento;
                -- 153:recalcular-recepcion · el registro del día se recalcula con el diésel que quedó y el tanque se realinea con el visor
                declare
                    v_aux uuid := public._mot_op_realineo('Eliminar recepción de combustible');
                begin
                    perform public._mot_recalcular_recibido(v_tanque, v_dia, v_aux);
                    perform public._mot_realinear_tanque(v_tanque, v_aux);
                    if public._mot_saldo_actual(v_tanque) < 0 then
                        v_avisos := array_append(v_avisos, 'SALDO_NEGATIVO: el tanque quedó en negativo; revisa las recepciones y los registros.');
                    end if;
                end;
$p$,
$p$153:recalcular-recepcion$p$);

select pg_temp.parchar('public.fn_campo_eliminar_documento(text, uuid, text)',
$p$'Ya hay un registro diario de ese día calculado con ese diésel recibido: revísalo (el gastado no se recalcula solo).'$p$,
$p$'El registro diario de ese día se recalculó con el diésel que quedó.'   /* 153:aviso */$p$,
$p$153:aviso$p$);

set client_min_messages = notice;
