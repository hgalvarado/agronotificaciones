-- =====================================================================
-- 150 · MOTORES · CORREGIR RECEPCIÓN DE COMBUSTIBLE (ATÓMICO), RECÁLCULO DEL DÍA Y SIN «DÍAS SIN REGISTRO»
-- =====================================================================
-- (1) Corrección atómica. La operación `diesel_recibir` acepta `corrige_id` (id de la recepción a corregir) y `motivo` (>= 10 letras):
--     en UNA sola operación (una transacción) anula la vieja (misma función de anulación de siempre, con sus permisos: «Anular»,
--     administrador o el propio registro en su jornada; no exige custodia ni «registrar») y guarda la corregida. Si algo falla, no
--     queda nada a medias (se acabó el duplicado por 2 operaciones). El teléfono manda UNA op `diesel_recibir` con
--     {…datos normales…, corrige_id, motivo} en vez de `anulacion` + `diesel_recibir`. El id de la op es el de la recepción nueva.
-- (2) Recálculo. Al anular o corregir una recepción se recalcula, en los registros diarios NO anulados del mismo tanque y día:
--     recibido_gal (= recepciones vigentes del día + lo que ese registro subió por sí mismo, SUMINISTRO), gastado_gal (solo cambia
--     si el visor subió: «entró diésel durante el día») y rendimiento. Si el gastado cambia y el registro movió el libro, se asienta
--     la diferencia como CONSUMO_MOTOR del mismo registro (así anular el registro después sigue revirtiendo todo). Un registro
--     histórico (no movió el libro) solo actualiza la fila. El saldo del tanque ya cambia por los movimientos de la anulación y de
--     la recepción nueva. Limitación: el suministro «declarado» de un registro no se guardaba; se reconstruye como recepciones
--     vigentes + SUMINISTRO propio del registro.
-- (3) Saldo negativo. Coherente con el resto del módulo (el visor es la realidad, `_mot_mover` no rechaza): anular o corregir una
--     recepción que deje el tanque en negativo SE ACEPTA y la operación queda con la observación SALDO_NEGATIVO.
-- (4) Se quita del servidor la alerta «días sin registro» (FALTA_REGISTRO en `_mot_estado_motor` y HUECO_DIAS en `_mot_senales`):
--     un día sin registro significa que el motor no trabajó. (`registro` sigue en el estado como dato informativo.)
--
-- Correr DESPUÉS de la 147 (y 148/149). Idempotente. Todo UPDATE/DELETE lleva WHERE. Parches por texto con marcas «150:».
-- ORDEN: si se vuelve a correr la 130, 144 o 147 (redefinen _mot_op_anulacion, _mot_op_diesel_recibir, _mot_estado_motor o
-- _mot_senales) → CORRER LA 150 OTRA VEZ.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

do $$
declare
    v_def text := pg_get_functiondef('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure);
begin
    if position('147:diesel-tanque' in v_def) = 0 then
        raise exception '150: _mot_op_diesel_recibir no trae el cambio de la 147: corre la 147 y vuelve a correr la 150.';
    end if;
end $$;

-- ---------------------------------------------------------------- 1 · recalcular lo recibido de un tanque en un día
/** Recalcula recibido/gastado/rendimiento de los registros vigentes de ese tanque y día. No hace nada si `mot.sin_recalculo` = on. */
create or replace function public._mot_recalcular_recibido(p_tanque uuid, p_dia date, p_op uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r        public.mot_registros%rowtype;
    v_rec    numeric;
    v_extra  numeric;
    v_nuevo  numeric;
    v_gast   numeric;
    v_dg     numeric;
    v_mat    uuid;
begin
    if p_tanque is null or p_dia is null or p_op is null then
        return;
    end if;
    if coalesce(current_setting('mot.sin_recalculo', true), '') = 'on' then
        return;   -- una corrección lo recalcula UNA vez al final
    end if;
    select coalesce(sum(x.galones), 0) into v_rec
      from public.mot_recepciones x
     where x.tanque_id = p_tanque and x.anulado_at is null and public._mot_dia(x.fecha_hora) = p_dia;
    v_mat := coalesce((select t.material_id from public.mot_tanques t where t.id = p_tanque),
                      (select c.material_diesel_id from public.mot_bajada_config c where c.id));

    for r in select * from public.mot_registros z
              where z.tanque_id = p_tanque and z.fecha = p_dia and z.anulado_at is null
              order by z.fecha_hora, z.id for update loop
        -- lo que el propio registro subió al tanque (suministro declarado que no estaba en recepciones)
        select coalesce(sum(mv.cantidad), 0) into v_extra
          from public.mot_movimientos mv
         where mv.documento_id = r.id and mv.tipo = 'SUMINISTRO'
           and not exists (select 1 from public.mot_movimientos a where a.anula_id = mv.id);
        v_nuevo := v_rec + v_extra;
        v_gast := case when r.visor_fin > r.visor_ini
                       then case when (r.visor_fin - r.visor_ini) <= v_nuevo + 0.5 then greatest(r.visor_ini + v_nuevo - r.visor_fin, 0) else 0 end
                       else r.visor_ini - r.visor_fin end;
        if v_nuevo is not distinct from r.recibido_gal and v_gast is not distinct from r.gastado_gal then
            continue;
        end if;
        v_dg := v_gast - coalesce(r.gastado_gal, 0);
        update public.mot_registros
           set recibido_gal = v_nuevo,
               gastado_gal = v_gast,
               rendimiento_gal_h = case when r.horas > 0 then round(v_gast / r.horas, 2) end
         where id = r.id;
        -- el consumo del libro sigue al gastado (solo si el registro movió el libro: un histórico no mueve nada)
        if v_dg <> 0 and v_mat is not null
           and exists (select 1 from public.mot_movimientos mv
                        where mv.documento_id = r.id and mv.tipo = 'CONSUMO_MOTOR'
                          and not exists (select 1 from public.mot_movimientos a where a.anula_id = mv.id)) then
            perform public._mot_mover(p_op, p_tanque, v_mat, 'CONSUMO_MOTOR', -v_dg, now(), 'motor_registro', r.id);
        end if;
    end loop;
end $$;
revoke execute on function public._mot_recalcular_recibido(uuid, date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2 · parches (marca propia 150)
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
        raise exception '150: en % se esperaba 1 aparición de «%» y hay % (¿faltan 130/144/147?)', p_fn, left(v_viejo, 80), v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '150: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- 2a · anular una recepción: recalcula el día del tanque (salvo dentro de una corrección)
select pg_temp.parchar('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)',
$p$        update public.mot_recepciones set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo where id = v_doc;
$p$,
$p$        update public.mot_recepciones set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo where id = v_doc;
        -- 150:recalcular · lo recibido ese día cambió: se recalcula el registro diario del tanque
        perform public._mot_recalcular_recibido((select z.tanque_id from public.mot_recepciones z where z.id = v_doc),
                                                (select public._mot_dia(z.fecha_hora) from public.mot_recepciones z where z.id = v_doc), p_id);
$p$,
$p$150:recalcular$p$);

-- 2b · anular una recepción que deja el tanque en negativo: se acepta con la observación SALDO_NEGATIVO
select pg_temp.parchar('public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean)',
$p$    return '{}';$p$,
$p$    -- 150:saldo · el visor es la realidad: no se rechaza, se avisa
    if v_tipo = 'diesel_recepcion' and coalesce(current_setting('mot.sin_recalculo', true), '') <> 'on'
       and public._mot_saldo_actual((select z.tanque_id from public.mot_recepciones z where z.id = v_doc)) < 0 then
        return array['SALDO_NEGATIVO'];
    end if;
    return '{}';$p$,
$p$150:saldo$p$);

-- 2c · recibir diésel: corrección atómica (corrige_id + motivo)
select pg_temp.parchar('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)',
$p$    -- 147:diesel-tanque · el diésel NO pasa por la bodega: entra al tanque indicado
$p$,
$p$    -- 150:corregir · con `corrige_id`: anula la recepción vieja y guarda la nueva en ESTA misma operación (todo o nada)
    if nullif(btrim(coalesce(d->>'corrige_id', '')), '') is not null then
        declare
            v_corr  uuid := public._fert_uuid(d->>'corrige_id');
            v_mot   text := nullif(btrim(coalesce(d->>'motivo', '')), '');
        begin
            if v_corr is null or not exists (select 1 from public.mot_recepciones z where z.id = v_corr) then
                raise exception 'La recepción a corregir no existe. Actualiza la aplicación.';
            end if;
            if v_mot is null or length(v_mot) < 10 then
                raise exception 'Escribe por qué se corrige (mínimo 10 letras).';
            end if;
            perform set_config('mot.sin_recalculo', 'on', true);
            v_obs := public._mot_op_anulacion(p_id, jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', v_corr,
                                                                       'motivo', 'Corrección: ' || v_mot), p_creado, p_inmediato);
            perform set_config('mot.sin_recalculo', 'off', true);
        end;
    end if;
    -- 147:diesel-tanque · el diésel NO pasa por la bodega: entra al tanque indicado
$p$,
$p$150:corregir$p$);

select pg_temp.parchar('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)',
$p$    v_obs := public._mot_autorizar(t.estacion_id, 'registrar', p_creado, p_inmediato, p_en_nombre);
$p$,
$p$    if nullif(btrim(coalesce(d->>'corrige_id', '')), '') is null then   -- 150:autorizar · una corrección ya validó sus permisos al anular
        v_obs := public._mot_autorizar(t.estacion_id, 'registrar', p_creado, p_inmediato, p_en_nombre);
    end if;
$p$,
$p$150:autorizar$p$);

select pg_temp.parchar('public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid)',
$p$    update public.fert_operaciones set estacion_id = t.estacion_id where id = p_id;
$p$,
$p$    update public.fert_operaciones set estacion_id = t.estacion_id where id = p_id;
    -- 150:recalcular-final · se recalcula UNA vez el día de la recepción nueva y el de la vieja (si era otro tanque o día)
    perform public._mot_recalcular_recibido(t.id, public._mot_dia(v_fecha), p_id);
    if nullif(btrim(coalesce(d->>'corrige_id', '')), '') is not null then
        perform public._mot_recalcular_recibido((select z.tanque_id from public.mot_recepciones z where z.id = public._fert_uuid(d->>'corrige_id')),
                                                (select public._mot_dia(z.fecha_hora) from public.mot_recepciones z where z.id = public._fert_uuid(d->>'corrige_id')), p_id);
        if public._mot_saldo_actual(t.id) < 0
           or public._mot_saldo_actual(coalesce((select z.tanque_id from public.mot_recepciones z where z.id = public._fert_uuid(d->>'corrige_id')), t.id)) < 0 then
            v_obs := public._fert_obs(v_obs, array['SALDO_NEGATIVO']);
        end if;
    end if;
$p$,
$p$150:recalcular-final$p$);

-- 2d · sin alertas de «días sin registro»: un día sin registro = el motor no trabajó
select pg_temp.parchar('public._mot_estado_motor(uuid)',
$p$        if v_reg->>'nivel' <> 'verde' then
            v_ahora := v_ahora || jsonb_build_object('nivel', v_reg->>'nivel', 'codigo', 'FALTA_REGISTRO', 'texto', v_reg->>'texto');
        end if;
$p$,
$p$        -- 150:sin-falta-registro · sin alerta de días sin registro (si no trabajó, no se registra)
$p$,
$p$150:sin-falta-registro$p$);

select pg_temp.parchar('public._mot_senales(uuid[], date, date)',
$p$case when r.p_fecha is not null and r.fecha - r.p_fecha > 1 and r.p_est is not distinct from r.estacion_id$p$,
$p$case when false /* 150:sin-hueco */ and r.p_fecha is not null and r.fecha - r.p_fecha > 1 and r.p_est is not distinct from r.estacion_id$p$,
$p$150:sin-hueco$p$);

set client_min_messages = notice;
