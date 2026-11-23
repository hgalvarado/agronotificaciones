-- =====================================================================
-- 136 · Envíos con problemas: nada se queda «guindado»
-- =====================================================================
-- Pedido del usuario (2026-11-23): un registro rechazado («el diésel no estaba publicado», «el motor no estaba asignado
-- en esa fecha») se quedaba colgado: la persona no podía descartarlo ni reintentarlo y el administrador no podía hacer
-- nada desde su computadora.
--
--   1. Lo rechazado YA queda guardado en `fert_operaciones` (resultado RECHAZADO, con el mensaje y los datos): no hace
--      falta otra tabla. Se le agregan las columnas de seguimiento (revision_*).
--   2. Registro diario del motor (`_mot_op_registro_diario`): que el motor no estuviera asignado (o estuviera en el taller
--      / retirado) en esa fecha YA NO rechaza: hay que poder registrar el pasado. Se acepta con la observación
--      MOTOR_NO_ASIGNADO_EN_FECHA / MOTOR_EN_TALLER_EN_FECHA / MOTOR_RETIRADO_EN_FECHA, usando la estación y el tanque
--      actuales del motor. Solo se rechaza si el motor no está instalado en ninguna parte (no hay dónde asentar el diésel).
--   3. La persona puede pedir ayuda o descartar su registro rechazado (queda constancia): fn_fert_problema_ayuda /
--      fn_fert_problema_resolver. fn_fert_estado_envios le dice al teléfono qué pasó con lo rechazado (si el administrador
--      lo aceptó o lo resolvió, sale de su lista).
--   4. El administrador (permiso «Eliminar por completo» de Fertirriego o administrador; NUNCA por nombre de rol) ve
--      TODOS los problemas de todas las estaciones (fn_fert_problemas) y puede: «Aceptar de todos modos»
--      (fn_fert_problema_aceptar: vuelve a procesar el registro como la persona que lo hizo, sin la regla del saldo ni la
--      de «inmediato»), «Descartar / Marcar resuelto» (fn_fert_problema_resolver) con nota.
--
-- Idempotente. Si se vuelve a correr la 130 hay que correr esta otra vez (la 130 redefine _mot_op_registro_diario).
-- Todo UPDATE/DELETE lleva WHERE.
-- =====================================================================

-- ---------------------------------------------------------------- 1 · seguimiento
alter table public.fert_operaciones add column if not exists revision_estado text;
alter table public.fert_operaciones add column if not exists revision_accion text;
alter table public.fert_operaciones add column if not exists revision_nota   text;
alter table public.fert_operaciones add column if not exists revision_por    uuid;
alter table public.fert_operaciones add column if not exists revision_en     timestamptz;

do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'fert_operaciones_revision_estado_chk') then
        alter table public.fert_operaciones
            add constraint fert_operaciones_revision_estado_chk
            check (revision_estado is null or revision_estado in ('AYUDA', 'RESUELTO'));
    end if;
end $$;

create index if not exists idx_fert_operaciones_problemas
    on public.fert_operaciones (recibido_en desc)
    where resultado = 'RECHAZADO';

comment on column public.fert_operaciones.revision_estado is
'136: null = sin revisar · AYUDA = la persona pidió ayuda al administrador · RESUELTO = ya se atendió (aceptado, descartado o resuelto).';
comment on column public.fert_operaciones.revision_accion is
'136: ACEPTADO_DE_TODOS_MODOS · DESCARTADO_POR_USUARIO · DESCARTADO · RESUELTO.';


-- ---------------------------------------------------------------- 2 · parche del registro diario del motor
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
        raise exception '136: en % se esperaba 1 aparición de «%» y hay % (¿falta correr la 130?)', p_fn, left(v_viejo, 80), v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '136: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

select pg_temp.parchar('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)',
$p$    select * into est from public._mot_estado_en(v_eq, v_momento);
    if est.tipo is null then
        raise exception 'El motor no estaba instalado en ninguna estación el %.', to_char(v_fecha, 'DD/MM/YYYY');
    end if;
    if est.tipo = 'AL_TALLER' then
        raise exception 'El motor está en el taller: no se registra el día.';
    end if;
    if est.tipo = 'RETIRADO' then
        raise exception 'El motor estaba retirado de la estación el %.', to_char(v_fecha, 'DD/MM/YYYY');
    end if;
    v_est := est.estacion_id;
    v_tanque := est.tanque_id;

    v_obs := public._mot_autorizar(v_est, 'registrar', p_creado, p_inmediato, p_en_nombre);
$p$,
$p$    select * into est from public._mot_estado_en(v_eq, v_momento);
    v_est := est.estacion_id;
    v_tanque := est.tanque_id;
    if est.tipo is null or est.tipo in ('AL_TALLER', 'RETIRADO') or v_est is null or v_tanque is null then
        -- 136: un registro histórico NO se rechaza porque el motor no estuviera asignado en esa fecha: se acepta con una
        -- observación y se asienta en la estación y el tanque donde el motor está AHORA.
        v_est := coalesce(v_est, mo.estacion_id);
        v_tanque := coalesce(v_tanque, mo.tanque_id);
        if v_est is null or v_tanque is null then
            raise exception 'El motor no está instalado en ninguna estación (ni tiene tanque): no hay dónde asentar el diésel. Pide a quien configura que lo instale en Motores › Mover motor y vuelve a intentarlo.';
        end if;
        v_obs := array[case est.tipo when 'AL_TALLER' then 'MOTOR_EN_TALLER_EN_FECHA'
                                     when 'RETIRADO' then 'MOTOR_RETIRADO_EN_FECHA'
                                     else 'MOTOR_NO_ASIGNADO_EN_FECHA' end];
    end if;

    v_obs := public._fert_obs(v_obs, public._mot_autorizar(v_est, 'registrar', p_creado, p_inmediato, p_en_nombre));
$p$,
$p$MOTOR_NO_ASIGNADO_EN_FECHA$p$);


-- ---------------------------------------------------------------- 3 · apoyo
create or replace function public._fert_problemas_exigir()
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'eliminar_definitivo')) then
        raise exception 'Tu rol no tiene «Eliminar por completo» en Fertirriego. Se concede en Permisos.'
            using errcode = '42501';
    end if;
end;
$$;
revoke execute on function public._fert_problemas_exigir() from public, anon, authenticated;

create or replace function public._fert_es_admin_problemas()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select (select auth.uid()) is not null
       and (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'eliminar_definitivo'))
$$;
revoke execute on function public._fert_es_admin_problemas() from public, anon, authenticated;


-- ---------------------------------------------------------------- 4 · lo que ve el teléfono de lo rechazado
/** p_ids = ids de los envíos que el teléfono tiene como RECHAZADOS. Devuelve lo que la base sabe de ellos. Solo los propios. */
create or replace function public.fn_fert_estado_envios(p_ids uuid[])
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'resultado', o.resultado, 'revision_estado', o.revision_estado,
               'revision_accion', o.revision_accion, 'revision_nota', o.revision_nota)), '[]'::jsonb)
      from public.fert_operaciones o
     where o.id = any(coalesce(p_ids, '{}')) and o.perfil_id = (select auth.uid())
$$;
grant execute on function public.fn_fert_estado_envios(uuid[]) to authenticated;

/** La persona pide ayuda sobre un envío suyo rechazado: el administrador lo ve marcado. */
create or replace function public.fn_fert_problema_ayuda(p_id uuid, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    n integer;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    update public.fert_operaciones
       set revision_estado = 'AYUDA',
           revision_nota = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), revision_nota),
           revision_en = now()
     where id = p_id and perfil_id = (select auth.uid()) and resultado = 'RECHAZADO'
       and revision_estado is distinct from 'RESUELTO';
    get diagnostics n = row_count;
    return jsonb_build_object('ok', n > 0);
end;
$$;
grant execute on function public.fn_fert_problema_ayuda(uuid, text) to authenticated;

/**
 * Cierra un problema. La persona solo puede DESCARTAR el suyo (queda constancia). El administrador puede
 * RESUELTO / DESCARTADO de cualquiera, con nota.
 */
create or replace function public.fn_fert_problema_resolver(p_id uuid, p_accion text, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_admin boolean := public._fert_es_admin_problemas();
    v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
    n integer;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if p_accion not in ('DESCARTADO_POR_USUARIO', 'DESCARTADO', 'RESUELTO') then
        raise exception 'Acción no válida.';
    end if;
    if p_accion <> 'DESCARTADO_POR_USUARIO' and not v_admin then
        raise exception 'Tu rol no puede resolver envíos de otras personas.' using errcode = '42501';
    end if;
    update public.fert_operaciones
       set revision_estado = 'RESUELTO', revision_accion = p_accion,
           revision_nota = coalesce(v_nota, revision_nota),
           revision_por = (select auth.uid()), revision_en = now()
     where id = p_id and resultado = 'RECHAZADO'
       and (v_admin or perfil_id = (select auth.uid()));
    get diagnostics n = row_count;
    return jsonb_build_object('ok', n > 0);
end;
$$;
grant execute on function public.fn_fert_problema_resolver(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------- 5 · lo que ve el administrador
/**
 * p_estado: 'ABIERTOS' (rechazados sin resolver; por defecto) · 'AYUDA' (los que pidieron ayuda) · 'RESUELTOS' · 'TODOS'.
 * Devuelve [{id, tipo, estacion_id, estacion, quien_id, quien, en_nombre_de, recibido_en, mensaje, datos, revision_*}]
 */
create or replace function public.fn_fert_problemas(
    p_estado text default 'ABIERTOS', p_estacion uuid default null, p_desde date default null, p_hasta date default null,
    p_quien uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v jsonb;
begin
    perform public._fert_problemas_exigir();
    select coalesce(jsonb_agg(q.x order by q.recibido_en desc), '[]'::jsonb) into v
      from (
        select jsonb_build_object(
                   'id', o.id, 'tipo', o.tipo, 'estacion_id', o.estacion_id, 'estacion', e.nombre,
                   'quien_id', o.perfil_id, 'quien', p.nombre, 'recibido_en', o.recibido_en, 'mensaje', o.mensaje,
                   'datos', o.datos, 'revision_estado', o.revision_estado, 'revision_accion', o.revision_accion,
                   'revision_nota', o.revision_nota, 'revision_en', o.revision_en,
                   'revision_por', (select p2.nombre from public.perfiles p2 where p2.id = o.revision_por)) as x,
               o.recibido_en
          from public.fert_operaciones o
          left join public.estaciones_riego e on e.id = o.estacion_id
          left join public.perfiles p on p.id = o.perfil_id
         where o.resultado = 'RECHAZADO'
           and (p_estacion is null or o.estacion_id = p_estacion)
           and (p_quien is null or o.perfil_id = p_quien)
           and (p_desde is null or (o.recibido_en at time zone 'America/Tegucigalpa')::date >= p_desde)
           and (p_hasta is null or (o.recibido_en at time zone 'America/Tegucigalpa')::date <= p_hasta)
           and case coalesce(p_estado, 'ABIERTOS')
                 when 'ABIERTOS'  then o.revision_estado is distinct from 'RESUELTO'
                 when 'AYUDA'     then o.revision_estado = 'AYUDA'
                 when 'RESUELTOS' then o.revision_estado = 'RESUELTO'
                 else true end
         order by o.recibido_en desc
         limit 500
      ) q;
    return v;
end;
$$;
grant execute on function public.fn_fert_problemas(text, uuid, date, date, uuid) to authenticated;

/**
 * «Aceptar de todos modos»: el administrador vuelve a procesar el registro rechazado COMO LA PERSONA que lo hizo
 * (sus permisos, su estación) pero sin la regla de «inmediato» ni la del saldo (se acepta con SALDO_NEGATIVO). Si aun así
 * la base lo rechaza (permiso, turno archivado, producto sin publicar…) no cambia nada y devuelve el motivo.
 * Un registro aceptado así lleva la observación ACEPTADO_POR_ADMIN.
 */
create or replace function public.fn_fert_problema_aceptar(p_id uuid, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r        public.fert_operaciones%rowtype;
    v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
    v_admin  uuid := (select auth.uid());
    v_sub    text := current_setting('request.jwt.claim.sub', true);
    v_obs    text[];
    v_op     jsonb;
begin
    perform public._fert_problemas_exigir();
    select * into r from public.fert_operaciones where id = p_id for update;
    if not found or r.resultado <> 'RECHAZADO' then
        raise exception 'Ese envío ya no está rechazado.';
    end if;
    if r.revision_estado = 'RESUELTO' then
        raise exception 'Ese envío ya se resolvió.';
    end if;
    v_op := jsonb_build_object(
        'id', r.id, 'tipo', r.tipo, 'creado_en', coalesce(r.creado_en, r.recibido_en), 'enviado_en', now(),
        'inmediato', false, 'dispositivo', r.dispositivo, 'en_nombre_de', r.en_nombre_de,
        'ubicacion', case when r.lat is null then null
                          else jsonb_build_object('lat', r.lat, 'lon', r.lon, 'precision', r.precision_m) end,
        'datos', r.datos || jsonb_build_object('acepta_negativo', true, 'forzar', true));

    begin
        -- subtransacción: si falla, el borrado del rechazo se deshace solo
        delete from public.fert_operaciones where id = r.id;
        perform set_config('request.jwt.claim.sub', r.perfil_id::text, true);
        v_obs := public._fert_procesar(v_op);
        perform set_config('request.jwt.claim.sub', coalesce(v_sub, v_admin::text), true);
    exception when others then
        perform set_config('request.jwt.claim.sub', coalesce(v_sub, v_admin::text), true);
        return jsonb_build_object('ok', false, 'mensaje', sqlerrm);
    end;

    update public.fert_operaciones
       set observaciones = public._fert_obs(observaciones, array['ACEPTADO_POR_ADMIN']),
           resultado = 'ACEPTADO_CON_OBSERVACIONES',
           revision_estado = 'RESUELTO', revision_accion = 'ACEPTADO_DE_TODOS_MODOS',
           revision_nota = v_nota, revision_por = v_admin, revision_en = now()
     where id = r.id;
    return jsonb_build_object('ok', true, 'observaciones', to_jsonb(public._fert_obs(v_obs, array['ACEPTADO_POR_ADMIN'])));
end;
$$;
grant execute on function public.fn_fert_problema_aceptar(uuid, text) to authenticated;

-- Nota: el diagnóstico que se muestra en pantalla vive en src/lib/fertirriego/errorEnvio.ts (un solo catálogo de textos).
