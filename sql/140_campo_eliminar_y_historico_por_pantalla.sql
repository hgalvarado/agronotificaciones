-- =====================================================================
-- 140 · CAMPO · ELIMINAR POR COMPLETO PARA TODO LO REGISTRADO + REGISTRO HISTÓRICO POR PANTALLA
-- =====================================================================
-- Pedido del usuario (2026-11-23):
--   6. «Como administrador debo poder eliminar por completo algún registro.»
--   8. «En todo módulo debemos poder registrar histórico: un mismo módulo (el de AgroNotificaciones), y que se pueda
--       elegir en qué pantalla quiero dar permiso de registrar.»
--
-- (1) ELIMINAR POR COMPLETO (extiende la 119–121, que cubre Fertirriego):
--     · Permiso `eliminar_definitivo` ahora también en las pantallas «inyeccion» y «motores» (acciones de la pantalla).
--       Nunca se concede por nivel rápido; no se da a ningún rol (solo el administrador, fn_es_admin). Se da a mano en Permisos.
--     · fn_campo_eliminar_documento(tipo, documento, motivo): iny_aplicacion · mot_registro · mot_recepcion ·
--       mot_mantenimiento · mot_asignacion. Motivo >= 15 letras. Copia de auditoría en la MISMA tabla fert_eliminaciones
--       (columna nueva `modulo`; la copia viaja a AGL y se borra de aquí con el mecanismo de la 121: huella sha256, purga a 180 días).
--     · Saldos coherentes: Inyección resta lo borrado de fert_saldos (libro de la bodega); Motores resta de mot_saldos (libro del
--       tanque) y recalcula las lecturas y horas desde el último mantenimiento.
--     · Lo que el teléfono reenvíe con el id de algo eliminado se rechaza (la 119 ya lo hace por operaciones_ids).
--     · Listados para la pantalla de Administración › Eliminar registros (filtro por módulo) y la auditoría de los 3 módulos.
--     · AgroMétricas ya tiene su propio «Eliminar por completo» (sql/125, con tumba que AGL aplica): NO se duplica.
--
-- (2) REGISTRO HISTÓRICO POR PANTALLA (generaliza la 116):
--     · fert_historico_permisos.pantalla (por defecto 'fertirriego'): el permiso temporal es por PERSONA + ESTACIÓN + PANTALLA.
--     · Catálogo de pantallas que lo admiten: pantallas.registra_historico (columna nueva; se marca en fertirriego, inyeccion y
--       motores). No hay lista fija en el código: lo que se marque aquí aparece en el selector «¿En qué pantalla?».
--       AgroMétricas NO se marca: ya admite días anteriores con «Corregir parámetros» (sql/109/125).
--     · Quién lo otorga: administrador o «Configurar» en ESA pantalla (nada de roles escritos en el código).
--     · Inyección (operación aplicacion_lote con `historica: true`): día PASADO, exige el permiso vigente en la estación,
--       NO exige la custodia y NO descuenta la bodega (el histórico no mueve inventario). Marca REGISTRO_HISTORICO.
--     · Motores (operación motor_registro_diario con `historica: true`): día PASADO, permiso vigente, sin custodia y SIN
--       mover el libro de diésel del tanque (solo guarda horómetro, visor, horas y gastado). Marca REGISTRO_HISTORICO.
--       Recepciones de diésel, mantenimientos y asignaciones históricos NO se construyen (decisión de seguridad: serían
--       movimientos de inventario/estado sin respaldo físico).
--     · Todo se valida en la base (security definer + permiso); la pantalla solo lo ofrece.
--
-- Correr DESPUÉS de la 139. Idempotente. Todo UPDATE/DELETE lleva WHERE (Supabase lo rechaza sin él).
-- SI SE VUELVE A CORRER 116/117 (redefinen el permiso y su índice único), 119/120/121 (redefinen listados y la función de
-- AGL), 129/132/139 (_iny_op_aplicacion_lote) o 130/136 (_mot_op_registro_diario), CORRER LA 140 OTRA VEZ.
-- =====================================================================

do $$
begin
    if to_regclass('public.fert_historico_permisos') is null or to_regclass('public.fert_eliminaciones') is null then
        raise exception '140: faltan las migraciones 116 y 119–121 (Registro histórico y Eliminar por completo).';
    end if;
    if to_regclass('public.iny_aplicaciones') is null or to_regclass('public.mot_registros') is null then
        raise exception '140: faltan las migraciones 129 y 130 (Inyección y Motores).';
    end if;
    if to_regclass('public.mot_mov_bajada') is null then
        raise exception '140: falta la migración 135 (movimientos de tanque que bajan a AGL).';
    end if;
end $$;


-- ---------------------------------------------------------------- 1 · catálogo de pantallas con registro histórico

do $$
begin
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'pantallas' and column_name = 'registra_historico') then
        alter table public.pantallas add column registra_historico boolean not null default false;
        update public.pantallas set registra_historico = true where codigo in ('fertirriego', 'inyeccion', 'motores');
    end if;
end $$;
comment on column public.pantallas.registra_historico is
'140: la pantalla admite «Registro histórico» (permiso temporal por persona + estación + pantalla). El selector de Administración › Registro histórico se llena con las pantallas marcadas aquí.';


-- ---------------------------------------------------------------- 2 · permiso histórico por pantalla

alter table public.fert_historico_permisos add column if not exists pantalla text not null default 'fertirriego';
comment on column public.fert_historico_permisos.pantalla is '140: pantalla (public.pantallas.codigo) donde vale el permiso temporal.';

drop index if exists public.uq_fert_historico_activo;
create unique index if not exists uq_fert_historico_activo_pantalla
    on public.fert_historico_permisos (persona_id, estacion_id, pantalla) where revocado_at is null;

/** ¿La persona tiene el permiso vigente en esa pantalla? (p_dia = día de captura UTC-6; 7 días de gracia para sincronizar). */
create or replace function public._campo_historico_vigente(p_persona uuid, p_estacion uuid, p_dia date, p_pantalla text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.fert_historico_permisos h
        where h.persona_id = p_persona and h.estacion_id = p_estacion and h.pantalla = p_pantalla and h.revocado_at is null
          and h.hasta >= p_dia and h.hasta + 7 >= public._fert_hoy())
$$;
revoke execute on function public._campo_historico_vigente(uuid, uuid, date, text) from public, anon, authenticated;

-- El de Fertirriego (116) sigue igual para sus funciones, ahora acotado a su pantalla
create or replace function public._fert_historico_vigente(p_persona uuid, p_estacion uuid, p_dia date)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public._campo_historico_vigente(p_persona, p_estacion, p_dia, 'fertirriego')
$$;
revoke execute on function public._fert_historico_vigente(uuid, uuid, date) from public, anon, authenticated;

/** Administrar el permiso de una pantalla: administrador o «Configurar» en ESA pantalla. */
create or replace function public._campo_historico_admin(p_pantalla text)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not exists (select 1 from public.pantallas where codigo = p_pantalla and registra_historico) then
        raise exception 'Esa pantalla no admite registro histórico.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso(p_pantalla, 'configurar')) then
        raise exception 'Tu rol no tiene «Configurar» en esa pantalla: solo quien administra otorga el registro histórico.'
            using errcode = '42501';
    end if;
end;
$$;
revoke execute on function public._campo_historico_admin(text) from public, anon, authenticated;

/** Pantallas donde quien llama puede dar el permiso (para el selector «¿En qué pantalla?»). */
create or replace function public.fn_campo_historico_pantallas()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'nombre', p.nombre) order by p.orden, p.nombre), '[]'::jsonb)
      from public.pantallas p
     where p.registra_historico and (select auth.uid()) is not null
       and (public.fn_es_admin() or public.fn_tiene_permiso(p.codigo, 'configurar'))
$$;

create or replace function public.fn_campo_historico_otorgar(
    p_persona uuid, p_estaciones uuid[], p_hasta date, p_nota text default null, p_pantalla text default 'fertirriego')
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_est uuid;
    v_n   integer := 0;
begin
    perform public._campo_historico_admin(p_pantalla);
    if not exists (select 1 from public.perfiles where id = p_persona) then
        raise exception 'La persona no existe.';
    end if;
    if p_estaciones is null or cardinality(p_estaciones) = 0 then
        raise exception 'Elige al menos una estación.';
    end if;
    if p_hasta is null or p_hasta < public._fert_hoy() then
        raise exception 'La fecha límite no puede ser anterior a hoy.';
    end if;
    if p_hasta > public._fert_hoy() + 90 then
        raise exception 'El permiso es temporal: la fecha límite no puede pasar de 90 días desde hoy.';
    end if;
    foreach v_est in array p_estaciones loop
        if not exists (select 1 from public.estaciones_riego where id = v_est) then
            raise exception 'Una estación no existe.';
        end if;
        update public.fert_historico_permisos
           set hasta = p_hasta, otorgado_por = (select auth.uid()), otorgado_at = now(),
               nota = coalesce(nullif(btrim(p_nota), ''), nota)
         where persona_id = p_persona and estacion_id = v_est and pantalla = p_pantalla and revocado_at is null;
        if not found then
            insert into public.fert_historico_permisos (persona_id, estacion_id, hasta, otorgado_por, nota, pantalla)
            values (p_persona, v_est, p_hasta, (select auth.uid()), nullif(btrim(p_nota), ''), p_pantalla);
        end if;
        v_n := v_n + 1;
    end loop;
    return v_n;
end;
$$;

create or replace function public.fn_campo_historico_revocar(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_pantalla text;
begin
    select h.pantalla into v_pantalla from public.fert_historico_permisos h where h.id = p_id and h.revocado_at is null;
    if v_pantalla is null then
        raise exception 'Ese permiso no existe o ya estaba revocado.';
    end if;
    perform public._campo_historico_admin(v_pantalla);
    update public.fert_historico_permisos
       set revocado_at = now(), revocado_por = (select auth.uid())
     where id = p_id and revocado_at is null;
end;
$$;

/** Lista para quien administra (solo las pantallas que administra); vigentes primero. */
create or replace function public.fn_campo_historico_listar(p_solo_vigentes boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if jsonb_array_length(public.fn_campo_historico_pantallas()) = 0 then
        raise exception 'Tu rol no tiene «Configurar» en ninguna pantalla con registro histórico.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(x order by x->>'orden', x->>'persona')
        from (
            select jsonb_build_object(
                'id', h.id, 'persona_id', h.persona_id, 'persona', p.nombre,
                'estacion_id', h.estacion_id, 'estacion', e.nombre,
                'pantalla', h.pantalla, 'pantalla_nombre', pa.nombre,
                'hasta', h.hasta, 'dias_restantes', greatest(h.hasta - public._fert_hoy(), -1),
                'otorgado_por', o.nombre, 'otorgado_at', h.otorgado_at, 'revocado_at', h.revocado_at, 'nota', h.nota,
                'estado', case when h.revocado_at is not null then 'REVOCADO'
                               when h.hasta < public._fert_hoy() then 'VENCIDO' else 'VIGENTE' end,
                'orden', case when h.revocado_at is null and h.hasta >= public._fert_hoy() then '0' else '1' end) as x
            from public.fert_historico_permisos h
            join public.perfiles p on p.id = h.persona_id
            join public.estaciones_riego e on e.id = h.estacion_id
            left join public.pantallas pa on pa.codigo = h.pantalla
            left join public.perfiles o on o.id = h.otorgado_por
            where (not p_solo_vigentes or (h.revocado_at is null and h.hasta >= public._fert_hoy()))
              and (public.fn_es_admin() or public.fn_tiene_permiso(h.pantalla, 'configurar'))
            order by h.otorgado_at desc limit 300) t), '[]'::jsonb);
end;
$$;

-- Las funciones de la 116 siguen respondiendo (acotadas a Fertirriego)
create or replace function public.fn_fert_historico_otorgar(p_persona uuid, p_estaciones uuid[], p_hasta date, p_nota text default null)
returns integer
language sql security definer set search_path = public, pg_temp as $$
    select public.fn_campo_historico_otorgar(p_persona, p_estaciones, p_hasta, p_nota, 'fertirriego')
$$;
create or replace function public.fn_fert_historico_revocar(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public.fn_campo_historico_revocar(p_id);
end;
$$;
create or replace function public.fn_fert_historico_listar(p_solo_vigentes boolean default false)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(x), '[]'::jsonb)
      from jsonb_array_elements(public.fn_campo_historico_listar(p_solo_vigentes)) x
     where x->>'pantalla' = 'fertirriego'
$$;
/** Los permisos vigentes de quien llama en FERTIRRIEGO (el teléfono de Fertirriego los pide con este nombre). */
create or replace function public.fn_fert_historico_mis_permisos()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'estacion_id', h.estacion_id, 'hasta', h.hasta,
                                                 'dias_restantes', h.hasta - public._fert_hoy(), 'nota', h.nota)
                             order by h.hasta), '[]'::jsonb)
    from public.fert_historico_permisos h
    where h.persona_id = (select auth.uid()) and h.revocado_at is null and h.hasta >= public._fert_hoy()
      and h.pantalla = 'fertirriego'
$$;

/** Lo que el teléfono de Inyección/Motores necesita saber de quien llama: permiso histórico vigente y «Eliminar por completo». */
create or replace function public.fn_campo_mis_permisos(p_pantalla text)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select jsonb_build_object(
        'eliminar_definitivo', (select auth.uid()) is not null
                               and (public.fn_es_admin() or public.fn_tiene_permiso(p_pantalla, 'eliminar_definitivo')),
        'historico', coalesce((
            select jsonb_agg(jsonb_build_object('id', h.id, 'estacion_id', h.estacion_id, 'hasta', h.hasta,
                                                'dias_restantes', h.hasta - public._fert_hoy(), 'nota', h.nota)
                             order by h.hasta)
              from public.fert_historico_permisos h
             where h.persona_id = (select auth.uid()) and h.revocado_at is null and h.hasta >= public._fert_hoy()
               and h.pantalla = p_pantalla), '[]'::jsonb))
$$;

do $$
declare
    f text;
begin
    foreach f in array array[
        'public.fn_campo_historico_pantallas()', 'public.fn_campo_historico_otorgar(uuid, uuid[], date, text, text)',
        'public.fn_campo_historico_revocar(uuid)', 'public.fn_campo_historico_listar(boolean)',
        'public.fn_fert_historico_otorgar(uuid, uuid[], date, text)', 'public.fn_fert_historico_revocar(uuid)',
        'public.fn_fert_historico_listar(boolean)', 'public.fn_fert_historico_mis_permisos()', 'public.fn_campo_mis_permisos(text)']
    loop
        execute format('revoke execute on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated', f);
    end loop;
end $$;


-- ---------------------------------------------------------------- 3 · autorización del registro histórico en la operación

/**
 * Inyección / Motores: quien registra un HISTÓRICO necesita el permiso de registrar de la pantalla, ver la estación y el
 * permiso temporal vigente en ELLA; NO se exige la custodia. El día debe ser anterior al día de captura (UTC-6).
 * Devuelve las observaciones (REGISTRO_HISTORICO).
 */
create or replace function public._campo_autorizar_historico(p_pantalla text, p_estacion uuid, p_dia date, p_creado timestamptz)
returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_yo       uuid := (select auth.uid());
    v_captura  date := (least(coalesce(p_creado, now()), now()) at time zone 'America/Tegucigalpa')::date;
begin
    if v_yo is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if p_pantalla = 'inyeccion' then
        perform public._iny_exigir_permiso('registrar');
    elsif p_pantalla = 'motores' then
        perform public._mot_exigir_permiso('registrar');
    else
        raise exception 'Esa pantalla no admite registro histórico.';
    end if;
    if p_estacion is null or not exists (select 1 from public.estaciones_riego where id = p_estacion) then
        raise exception 'La estación no existe. Actualiza la aplicación.';
    end if;
    if not public.fn_fert_puede(p_estacion, 'ver') then
        raise exception 'No tienes acceso a esa estación.' using errcode = '42501';
    end if;
    if not public._campo_historico_vigente(v_yo, p_estacion, v_captura, p_pantalla) then
        raise exception 'No tienes el permiso «Registro histórico» vigente en esta estación para esta pantalla (vencido, revocado o no otorgado). Pídelo al administrador.'
            using errcode = '42501';
    end if;
    if p_dia is null or p_dia >= v_captura then
        raise exception 'El registro histórico es solo de días pasados: elige un día anterior a hoy.';
    end if;
    return array['REGISTRO_HISTORICO'];
end;
$$;
revoke execute on function public._campo_autorizar_historico(text, uuid, date, timestamptz) from public, anon, authenticated;


-- ---------------------------------------------------------------- 4 · parches a las operaciones (por texto, con marca)

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
        raise exception '140: en % se esperaba 1 aparición de «%» y hay % (¿faltan 129/132/139 o 130/136?)', p_fn, left(v_viejo, 80), v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '140: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- Inyección: la variable
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    E'    v_canon    text;\n',
    E'    v_canon    text;\n    v_hist     boolean := lower(btrim(coalesce(d->>''historica'', ''''))) in (''true'', ''t'', ''1'');   -- 140:historica\n',
    '140:historica');

-- Inyección: un histórico no exige la custodia (permiso temporal) y deja su marca
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    E'    v_obs := public._iny_autorizar(v_estacion, ''registrar'', p_creado, p_inmediato, p_en_nombre);\n',
    E'    if v_hist then\n'
    || E'        -- 140:autorizar · registro histórico: permiso temporal, sin custodia, día pasado\n'
    || E'        v_obs := public._campo_autorizar_historico(''inyeccion'', v_estacion, (v_fecha at time zone ''America/Tegucigalpa'')::date, p_creado);\n'
    || E'    else\n'
    || E'        v_obs := public._iny_autorizar(v_estacion, ''registrar'', p_creado, p_inmediato, p_en_nombre);\n'
    || E'    end if;\n',
    '140:autorizar');

-- Inyección: un histórico NO descuenta la bodega
select pg_temp.parchar('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)',
    E'        if public._iny_linea_de_bodega(d, v_lineas, l.material_id) then\n',
    E'        if public._iny_linea_de_bodega(d, v_lineas, l.material_id) and not v_hist then   -- 140:sin-bodega\n',
    '140:sin-bodega');

-- Motores: la variable
select pg_temp.parchar('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)',
    E'    v_cuenta boolean;\n',
    E'    v_cuenta boolean;\n    v_hist   boolean := lower(btrim(coalesce(d->>''historica'', ''''))) in (''true'', ''t'', ''1'');   -- 140:historica\n',
    '140:historica');

-- Motores: un histórico no exige la custodia (permiso temporal) y deja su marca
select pg_temp.parchar('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)',
    E'    v_obs := public._fert_obs(v_obs, public._mot_autorizar(v_est, ''registrar'', p_creado, p_inmediato, p_en_nombre));\n',
    E'    if v_hist then\n'
    || E'        -- 140:autorizar · registro histórico: permiso temporal, sin custodia, día pasado\n'
    || E'        v_obs := public._fert_obs(v_obs, public._campo_autorizar_historico(''motores'', v_est, v_fecha, p_creado));\n'
    || E'    else\n'
    || E'        v_obs := public._fert_obs(v_obs, public._mot_autorizar(v_est, ''registrar'', p_creado, p_inmediato, p_en_nombre));\n'
    || E'    end if;\n',
    '140:autorizar');

-- Motores: un histórico no toca el libro del tanque (ni ajuste del visor ni consumo)
select pg_temp.parchar('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)',
    E'    if not v_reciente then\n',
    E'    if v_hist then\n        null;   -- 140:sin-libro · el histórico no mueve el diésel del tanque\n    elsif not v_reciente then\n',
    '140:sin-libro');
select pg_temp.parchar('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)',
    E'    perform public._mot_mover(p_id, v_tanque, v_mat, ''CONSUMO_MOTOR'', -v_gast, v_fh, ''motor_registro'', p_id);\n',
    E'    if not v_hist then   -- 140:sin-consumo\n'
    || E'        perform public._mot_mover(p_id, v_tanque, v_mat, ''CONSUMO_MOTOR'', -v_gast, v_fh, ''motor_registro'', p_id);\n'
    || E'    end if;\n',
    '140:sin-consumo');


-- ---------------------------------------------------------------- 5 · ELIMINAR POR COMPLETO · permiso y auditoría

alter table public.fert_eliminaciones add column if not exists modulo text not null default 'fertirriego';
comment on column public.fert_eliminaciones.modulo is '140: fertirriego | inyeccion | motores.';

do $$
begin
    update public.acciones
       set descripcion = 'Campo: borra de verdad un registro (Fertirriego, Inyección o Motores): documento, detalle y movimientos. Solo queda una copia privada de auditoría. No se puede deshacer desde la app.'
     where codigo = 'eliminar_definitivo';
    update public.pantallas set acciones = acciones || 'eliminar_definitivo'::text
     where codigo in ('inyeccion', 'motores') and not ('eliminar_definitivo' = any(acciones));
    -- Sin concesiones automáticas: solo el administrador (fn_es_admin). Los roles se la dan a mano en Permisos.
end $$;

/** Cualquiera de las tres pantallas (para entrar a la pantalla de Administración). */
create or replace function public._campo_eliminar_exigir_alguno()
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin()
            or public.fn_tiene_permiso('fertirriego', 'eliminar_definitivo')
            or public.fn_tiene_permiso('inyeccion', 'eliminar_definitivo')
            or public.fn_tiene_permiso('motores', 'eliminar_definitivo')) then
        raise exception 'Tu rol no tiene «Eliminar por completo». Se concede en Permisos.' using errcode = '42501';
    end if;
end;
$$;
revoke execute on function public._campo_eliminar_exigir_alguno() from public, anon, authenticated;

create or replace function public._campo_eliminar_exigir(p_pantalla text)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso(p_pantalla, 'eliminar_definitivo')) then
        raise exception 'Tu rol no tiene «Eliminar por completo» en esta pantalla. Se concede en Permisos.' using errcode = '42501';
    end if;
end;
$$;
revoke execute on function public._campo_eliminar_exigir(text) from public, anon, authenticated;


-- ---------------------------------------------------------------- 6 · ELIMINAR POR COMPLETO · la función

create or replace function public.fn_campo_eliminar_documento(p_tipo text, p_documento uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_motivo   text := btrim(coalesce(p_motivo, ''));
    v_yo       uuid := (select auth.uid());
    v_modulo   text;
    v_found    boolean := false;
    v_est      uuid;
    v_equipo   uuid;
    v_tanque   uuid;
    v_dia      date;
    v_cuando   timestamptz;
    v_quien    uuid;
    v_resumen  text;
    v_ya_agl   boolean := false;
    v_fmovs    uuid[] := '{}';
    v_movs     bigint[] := '{}';
    v_ops      uuid[];
    v_snap     jsonb;
    v_aud      uuid := gen_random_uuid();
    v_n        integer;
    v_cont     jsonb := '{}'::jsonb;
    v_borradas uuid[];
    v_neg      jsonb := '[]'::jsonb;
    v_avisos   text[] := '{}';
    a          public.mot_asignaciones%rowtype;
    x          jsonb;
begin
    if v_yo is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if p_tipo is null or p_tipo not in ('iny_aplicacion', 'mot_registro', 'mot_recepcion', 'mot_mantenimiento', 'mot_asignacion') then
        raise exception 'Ese tipo de registro no se puede eliminar.';
    end if;
    if p_documento is null then
        raise exception 'Indica el registro a eliminar.';
    end if;
    v_modulo := case when p_tipo = 'iny_aplicacion' then 'inyeccion' else 'motores' end;
    perform public._campo_eliminar_exigir(v_modulo);
    if char_length(v_motivo) < 15 then
        raise exception 'Explica por qué se elimina (mínimo 15 letras).';
    end if;

    -- ---- localizar el registro (y bloquearlo)
    case p_tipo
        when 'iny_aplicacion' then
            select y.estacion_id, y.fecha_hora, y.registrado_por, (y.bajado_a_agl_en is not null),
                   format('Inyección · lote %s · día %s%s', y.lote, y.fecha, case when y.anulado_at is not null then ' · anulada' else '' end)
              into v_est, v_cuando, v_quien, v_ya_agl, v_resumen
              from public.iny_aplicaciones y where y.id = p_documento for update;
            v_found := found;
        when 'mot_registro' then
            select y.estacion_id, y.equipo_id, y.tanque_id, y.fecha_hora, y.registrado_por, (y.bajado_a_agl_en is not null),
                   format('Registro diario · motor %s · día %s%s', coalesce((select q.codigo from public.equipos q where q.id = y.equipo_id), '?'),
                          y.fecha, case when y.anulado_at is not null then ' · anulado' else '' end)
              into v_est, v_equipo, v_tanque, v_cuando, v_quien, v_ya_agl, v_resumen
              from public.mot_registros y where y.id = p_documento for update;
            v_found := found;
        when 'mot_recepcion' then
            select y.estacion_id, y.tanque_id, y.fecha_hora, y.registrado_por, (y.bajado_a_agl_en is not null),
                   format('Diésel recibido · %s gal%s', y.galones, case when y.anulado_at is not null then ' · anulada' else '' end),
                   public._mot_dia(y.fecha_hora)
              into v_est, v_tanque, v_cuando, v_quien, v_ya_agl, v_resumen, v_dia
              from public.mot_recepciones y where y.id = p_documento for update;
            v_found := found;
        when 'mot_mantenimiento' then
            select y.estacion_id, y.equipo_id, y.fecha_hora, y.registrado_por, (y.bajado_a_agl_en is not null),
                   format('Mantenimiento %s · motor %s%s', lower(y.tipo), coalesce((select q.codigo from public.equipos q where q.id = y.equipo_id), '?'),
                          case when y.anulado_at is not null then ' · anulado' else '' end)
              into v_est, v_equipo, v_cuando, v_quien, v_ya_agl, v_resumen
              from public.mot_mantenimientos y where y.id = p_documento for update;
            v_found := found;
        when 'mot_asignacion' then
            select * into a from public.mot_asignaciones where id = p_documento for update;
            v_found := found;
            if v_found then
                v_est := coalesce(a.estacion_destino, a.estacion_origen);
                v_equipo := a.equipo_id;
                v_tanque := a.tanque_id;
                v_cuando := a.fecha_hora;
                v_quien := a.registrado_por;
                v_ya_agl := a.bajado_a_agl_en is not null;
                v_resumen := format('Motor %s · %s%s', coalesce((select q.codigo from public.equipos q where q.id = a.equipo_id), '?'),
                                    lower(a.tipo), case when a.anulado_at is not null then ' · anulada' else '' end);
            end if;
    end case;

    if not v_found then
        if exists (select 1 from public.fert_eliminaciones z where z.documento_id = p_documento) then
            raise exception 'Ese registro ya fue eliminado.';
        end if;
        raise exception 'El registro no existe (puede que ya lo hayan eliminado).';
    end if;

    -- ---- estación (quien no es administrador debe poder ver la estación)
    if v_est is not null and not public.fn_es_admin() and not public.fn_fert_puede(v_est, 'ver') then
        raise exception 'No tienes acceso a la estación de este registro.' using errcode = '42501';
    end if;

    -- ---- una asignación vigente solo se borra si es lo último del motor (igual que al anularla)
    if p_tipo = 'mot_asignacion' and a.anulado_at is null then
        if exists (select 1 from public.mot_asignaciones z where z.equipo_id = a.equipo_id and z.anulado_at is null and z.id <> a.id
                      and (z.fecha_hora, z.creado_en) > (a.fecha_hora, a.creado_en)) then
            raise exception 'Solo se puede eliminar el último movimiento del motor. Elimina primero los posteriores.';
        end if;
        if exists (select 1 from public.mot_registros r where r.equipo_id = a.equipo_id and r.anulado_at is null
                      and r.fecha > public._mot_dia(a.fecha_hora)) then
            raise exception 'El motor ya tiene registros posteriores a ese movimiento: elimínalos o anúlalos primero.';
        end if;
    end if;

    -- ---- qué se va con él (el libro: el original y todas las anulaciones que lo apuntan)
    if p_tipo = 'iny_aplicacion' then
        v_fmovs := array(
            with recursive m as (
                select id from public.fert_movimientos where documento_id = p_documento
                union
                select z.id from public.fert_movimientos z join m on z.anula_id = m.id
            ) select id from m);
    else
        v_movs := array(
            with recursive m as (
                select id from public.mot_movimientos where documento_id = p_documento
                union
                select z.id from public.mot_movimientos z join m on z.anula_id = m.id
            ) select id from m);
    end if;
    v_ops := array(
        select distinct o.id from public.fert_operaciones o
        where o.tipo <> 'archivo_turno' and (
              o.id = p_documento
           or o.datos->>'documento_id' = p_documento::text
           or o.id in (select m.operacion_id from public.fert_movimientos m where m.id = any(v_fmovs))
           or o.id in (select m.operacion_id from public.mot_movimientos m where m.id = any(v_movs))));

    -- ---- la copia de auditoría (ANTES de borrar)
    v_snap := jsonb_build_object(
        'modulo', v_modulo,
        'tipo', p_tipo,
        'iny_aplicaciones', coalesce((select jsonb_agg(to_jsonb(z)) from public.iny_aplicaciones z where p_tipo = 'iny_aplicacion' and z.id = p_documento), '[]'::jsonb),
        'iny_aplicaciones_detalle', coalesce((select jsonb_agg(to_jsonb(z)) from public.iny_aplicaciones_detalle z where p_tipo = 'iny_aplicacion' and z.aplicacion_id = p_documento), '[]'::jsonb),
        'mot_registros', coalesce((select jsonb_agg(to_jsonb(z)) from public.mot_registros z where p_tipo = 'mot_registro' and z.id = p_documento), '[]'::jsonb),
        'mot_recepciones', coalesce((select jsonb_agg(to_jsonb(z)) from public.mot_recepciones z where p_tipo = 'mot_recepcion' and z.id = p_documento), '[]'::jsonb),
        'mot_mantenimientos', coalesce((select jsonb_agg(to_jsonb(z)) from public.mot_mantenimientos z where p_tipo = 'mot_mantenimiento' and z.id = p_documento), '[]'::jsonb),
        'mot_asignaciones', coalesce((select jsonb_agg(to_jsonb(z)) from public.mot_asignaciones z where p_tipo = 'mot_asignacion' and z.id = p_documento), '[]'::jsonb),
        -- Inyección usa el libro de la bodega (la clave `movimientos` es la que AGL sabe purgar); Motores, el libro del tanque
        'movimientos', coalesce((select jsonb_agg(to_jsonb(z) order by z.cursor) from public.fert_movimientos z where z.id = any(v_fmovs)), '[]'::jsonb),
        'mot_movimientos', coalesce((select jsonb_agg(to_jsonb(z) order by z.id) from public.mot_movimientos z where z.id = any(v_movs)), '[]'::jsonb),
        'operaciones', coalesce((select jsonb_agg(to_jsonb(z) order by z.recibido_en) from public.fert_operaciones z where z.id = any(v_ops)), '[]'::jsonb));

    insert into public.fert_eliminaciones
        (id, modulo, tipo, documento_id, estacion_id, estacion, turno_ciclo_id, fecha_documento,
         registrado_por, registrado_por_nombre, resumen, motivo, eliminado_por, eliminado_por_nombre, snapshot)
    values
        (v_aud, v_modulo, p_tipo, p_documento, v_est, (select nombre from public.estaciones_riego where id = v_est), null, v_cuando,
         v_quien, (select nombre from public.perfiles where id = v_quien), v_resumen, v_motivo, v_yo,
         (select nombre from public.perfiles where id = v_yo), v_snap);

    -- ---- borrar (los libros se abren SOLO aquí y se cierran siempre)
    begin
        if p_tipo = 'iny_aplicacion' then
            perform set_config('fert.libro_permitir', 'on', true);
            -- el saldo de la bodega: se resta lo borrado
            update public.fert_saldos s
               set disponible = s.disponible - d.suma, updated_at = now()
              from (select m.estacion_id, m.material_id, sum(m.cantidad) as suma
                      from public.fert_movimientos m where m.id = any(v_fmovs) group by 1, 2) d
             where s.estacion_id = d.estacion_id and s.material_id = d.material_id;
            delete from public.fert_movimientos where id = any(v_fmovs);
            get diagnostics v_n = row_count;
            v_cont := v_cont || jsonb_build_object('movimientos', v_n);
            delete from public.iny_aplicaciones_detalle where aplicacion_id = p_documento;
            delete from public.iny_aplicaciones where id = p_documento;
            v_cont := v_cont || jsonb_build_object('registros', 1);
            perform set_config('fert.libro_permitir', 'off', true);
        else
            perform set_config('mot.libro_permitir', 'on', true);
            -- el saldo del tanque: se resta lo borrado
            update public.mot_saldos s
               set disponible = s.disponible - d.suma, updated_at = now()
              from (select m.tanque_id, sum(m.cantidad) as suma from public.mot_movimientos m where m.id = any(v_movs) group by 1) d
             where s.tanque_id = d.tanque_id;
            delete from public.mot_mov_bajada where movimiento_id = any(v_movs);
            delete from public.mot_movimientos where id = any(v_movs);
            get diagnostics v_n = row_count;
            v_cont := v_cont || jsonb_build_object('movimientos', v_n);

            if p_tipo = 'mot_registro' then
                delete from public.mot_registros where id = p_documento;
                perform public._mot_refrescar_ultimo(v_equipo);
                perform public._mot_recalcular_horas(v_equipo);
            elsif p_tipo = 'mot_recepcion' then
                delete from public.mot_recepciones where id = p_documento;
                if exists (select 1 from public.mot_registros r
                            where r.tanque_id = v_tanque and r.fecha = v_dia and r.anulado_at is null) then
                    v_avisos := array_append(v_avisos,
                        'Ya hay un registro diario de ese día calculado con ese diésel recibido: revísalo (el gastado no se recalcula solo).');
                end if;
            elsif p_tipo = 'mot_mantenimiento' then
                delete from public.mot_mantenimientos where id = p_documento;
                perform public._mot_recalcular_horas(v_equipo);
            else
                -- asignación: si seguía vigente, el motor y los tanques vuelven a como estaban antes (igual que al anularla)
                if a.anulado_at is null then
                    for x in select e from jsonb_array_elements(coalesce(a.antes->'tanques', '[]'::jsonb)) e loop
                        update public.mot_tanques
                           set estacion_id = nullif(x->>'estacion_id', '')::uuid, motor_equipo_id = nullif(x->>'motor_equipo_id', '')::uuid,
                               activo = coalesce((x->>'activo')::boolean, true)
                         where id = (x->>'id')::uuid;
                    end loop;
                    if nullif(a.antes->>'tanque_creado', '') is not null then
                        update public.mot_tanques set activo = false, motor_equipo_id = null where id = (a.antes->>'tanque_creado')::uuid;
                    end if;
                    update public.mot_motores
                       set estado = coalesce(a.antes->'motor'->>'estado', 'SIN_ASIGNAR'),
                           estacion_id = nullif(a.antes->'motor'->>'estacion_id', '')::uuid,
                           tanque_id = nullif(a.antes->'motor'->>'tanque_id', '')::uuid
                     where equipo_id = a.equipo_id;
                end if;
                delete from public.mot_asignaciones where id = p_documento;
                perform public._mot_recalcular_horas(v_equipo);
            end if;
            v_cont := v_cont || jsonb_build_object('registros', 1);
            perform set_config('mot.libro_permitir', 'off', true);
        end if;

        with d as (
            delete from public.fert_operaciones o
            where o.id = any(v_ops)
              and not exists (select 1 from public.fert_movimientos m where m.operacion_id = o.id)
              and not exists (select 1 from public.mot_movimientos m where m.operacion_id = o.id)
              and not exists (select 1 from public.iny_aplicaciones z where z.id = o.id)
              and not exists (select 1 from public.mot_registros z where z.id = o.id)
              and not exists (select 1 from public.mot_recepciones z where z.id = o.id)
              and not exists (select 1 from public.mot_mantenimientos z where z.id = o.id)
              and not exists (select 1 from public.mot_asignaciones z where z.id = o.id)
            returning o.id)
        select coalesce(array_agg(id), '{}') into v_borradas from d;
        v_cont := v_cont || jsonb_build_object('operaciones', cardinality(v_borradas));
    exception when others then
        perform set_config('fert.libro_permitir', 'off', true);
        perform set_config('mot.libro_permitir', 'off', true);
        raise;
    end;

    update public.fert_eliminaciones set conteos = v_cont, operaciones_ids = v_borradas where id = v_aud;

    -- Inyección: ¿algún producto quedó en negativo por esto? (se avisa; no se rechaza)
    if p_tipo = 'iny_aplicacion' then
        v_neg := coalesce((
            select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'material', coalesce(m.descripcion, m.codigo), 'saldo', s.disponible))
            from public.fert_saldos s
            join public.estaciones_riego e on e.id = s.estacion_id
            join public.materiales m on m.id = s.material_id
            where s.disponible < 0
              and exists (select 1 from jsonb_array_elements(v_snap->'movimientos') y
                          where (y->>'estacion_id')::uuid = s.estacion_id and (y->>'material_id')::uuid = s.material_id)), '[]'::jsonb);
    end if;
    if v_ya_agl then
        v_avisos := array_append(v_avisos, 'Este registro ya había bajado a AGL: AGL lo quita al sincronizar lo eliminado.');
    end if;

    return jsonb_build_object('ok', true, 'tipo', p_tipo, 'modulo', v_modulo, 'auditoria_id', v_aud, 'eliminados', v_cont,
                              'saldos_negativos', v_neg, 'avisos', to_jsonb(v_avisos), 'ya_en_agl', v_ya_agl);
end;
$$;
revoke execute on function public.fn_campo_eliminar_documento(text, uuid, text) from public, anon;
grant execute on function public.fn_campo_eliminar_documento(text, uuid, text) to authenticated;


-- ---------------------------------------------------------------- 7 · listados (pantalla de Administración)

/** Registros eliminables de Inyección y Motores en las estaciones que quien llama ve (con el permiso de cada pantalla). */
create or replace function public.fn_campo_eliminar_listar(
    p_modulo text default null, p_estacion uuid default null, p_tipo text default null,
    p_desde date default null, p_hasta date default null, p_limite integer default 300
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_iny boolean;
    v_mot boolean;
    v_est uuid[];
    v_res jsonb;
begin
    perform public._campo_eliminar_exigir_alguno();
    v_iny := public.fn_es_admin() or public.fn_tiene_permiso('inyeccion', 'eliminar_definitivo');
    v_mot := public.fn_es_admin() or public.fn_tiene_permiso('motores', 'eliminar_definitivo');
    v_est := array(select e.id from public.estaciones_riego e
                   where (p_estacion is null or e.id = p_estacion) and public.fn_fert_puede(e.id, 'ver'));

    select coalesce(jsonb_agg(to_jsonb(x) order by x.fecha desc), '[]'::jsonb) into v_res from (
        select * from (
            select 'iny_aplicacion'::text as tipo, 'inyeccion'::text as modulo, a.id as documento_id, a.estacion_id, e.nombre as estacion,
                   a.fecha_hora as fecha, a.registrado_por as quien_id, p.nombre as quien,
                   format('Lote %s · día %s · %s producto(s) · %s mz', a.lote, a.fecha,
                          (select count(*) from public.iny_aplicaciones_detalle d where d.aplicacion_id = a.id), a.area_mz) as resumen,
                   (a.anulado_at is not null) as anulado,
                   coalesce('REGISTRO_HISTORICO' = any(o.observaciones), false) as historica
            from public.iny_aplicaciones a
            join public.estaciones_riego e on e.id = a.estacion_id
            left join public.perfiles p on p.id = a.registrado_por
            left join public.fert_operaciones o on o.id = a.id
            where v_iny and a.estacion_id = any(v_est)
            union all
            select 'mot_registro', 'motores', r.id, r.estacion_id, e.nombre, r.fecha_hora, r.registrado_por, p.nombre,
                   format('Motor %s · día %s · %s h · %s gal', coalesce(q.codigo, '?'), r.fecha, r.horas, r.gastado_gal),
                   (r.anulado_at is not null), coalesce('REGISTRO_HISTORICO' = any(o.observaciones), false)
            from public.mot_registros r
            join public.estaciones_riego e on e.id = r.estacion_id
            left join public.equipos q on q.id = r.equipo_id
            left join public.perfiles p on p.id = r.registrado_por
            left join public.fert_operaciones o on o.id = r.id
            where v_mot and r.estacion_id = any(v_est)
            union all
            select 'mot_recepcion', 'motores', r.id, r.estacion_id, e.nombre, r.fecha_hora, r.registrado_por, p.nombre,
                   format('Diésel recibido · %s gal', r.galones), (r.anulado_at is not null), false
            from public.mot_recepciones r
            join public.estaciones_riego e on e.id = r.estacion_id
            left join public.perfiles p on p.id = r.registrado_por
            where v_mot and r.estacion_id = any(v_est)
            union all
            select 'mot_mantenimiento', 'motores', m.id, m.estacion_id, e.nombre, m.fecha_hora, m.registrado_por, p.nombre,
                   format('Mantenimiento %s · motor %s', lower(m.tipo), coalesce(q.codigo, '?')), (m.anulado_at is not null), false
            from public.mot_mantenimientos m
            join public.estaciones_riego e on e.id = m.estacion_id
            left join public.equipos q on q.id = m.equipo_id
            left join public.perfiles p on p.id = m.registrado_por
            where v_mot and m.estacion_id = any(v_est)
            union all
            select 'mot_asignacion', 'motores', s.id, coalesce(s.estacion_destino, s.estacion_origen), e.nombre, s.fecha_hora, s.registrado_por, p.nombre,
                   format('Motor %s · %s', coalesce(q.codigo, '?'), lower(s.tipo)), (s.anulado_at is not null), false
            from public.mot_asignaciones s
            join public.estaciones_riego e on e.id = coalesce(s.estacion_destino, s.estacion_origen)
            left join public.equipos q on q.id = s.equipo_id
            left join public.perfiles p on p.id = s.registrado_por
            where v_mot and coalesce(s.estacion_destino, s.estacion_origen) = any(v_est)
        ) u
        where (p_modulo is null or u.modulo = p_modulo)
          and (p_tipo is null or u.tipo = p_tipo)
          and (p_desde is null or (u.fecha at time zone 'America/Tegucigalpa')::date >= p_desde)
          and (p_hasta is null or (u.fecha at time zone 'America/Tegucigalpa')::date <= p_hasta)
        order by u.fecha desc
        limit least(greatest(coalesce(p_limite, 300), 1), 1000)
    ) x;
    return v_res;
end;
$$;
revoke execute on function public.fn_campo_eliminar_listar(text, uuid, text, date, date, integer) from public, anon;
grant execute on function public.fn_campo_eliminar_listar(text, uuid, text, date, date, integer) to authenticated;

/** La auditoría de los tres módulos (solo lectura; no restaura). */
create or replace function public.fn_campo_eliminaciones_listar(p_limite integer default 200)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._campo_eliminar_exigir_alguno();
    return coalesce((
        select jsonb_agg(to_jsonb(x) order by x.eliminado_at desc) from (
            select e.id, e.modulo, e.tipo, e.documento_id, e.estacion, e.estacion2, e.fecha_documento, e.registrado_por_nombre,
                   e.resumen, e.motivo, e.eliminado_por_nombre, e.eliminado_at, e.conteos,
                   e.snapshot_bajado_at, (e.snapshot is null) as copia_en_agl
            from public.fert_eliminaciones e
            where public.fn_es_admin()
               or (e.modulo = 'fertirriego' and public.fn_fert_puede(e.estacion_id, 'eliminar_definitivo'))
               or (e.modulo in ('inyeccion', 'motores') and public.fn_tiene_permiso(e.modulo, 'eliminar_definitivo')
                   and public.fn_fert_puede(e.estacion_id, 'ver'))
            order by e.eliminado_at desc
            limit least(greatest(coalesce(p_limite, 200), 1), 1000)) x), '[]'::jsonb);
end;
$$;
revoke execute on function public.fn_campo_eliminaciones_listar(integer) from public, anon;
grant execute on function public.fn_campo_eliminaciones_listar(integer) to authenticated;

/** «Ver copia»: null con gracia si ya se bajó a AGL. */
create or replace function public.fn_campo_eliminacion_copia(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._campo_eliminar_exigir_alguno();
    return (select e.snapshot from public.fert_eliminaciones e
             where e.id = p_id
               and (public.fn_es_admin()
                    or (e.modulo = 'fertirriego' and public.fn_fert_puede(e.estacion_id, 'eliminar_definitivo'))
                    or (e.modulo in ('inyeccion', 'motores') and public.fn_tiene_permiso(e.modulo, 'eliminar_definitivo')
                        and public.fn_fert_puede(e.estacion_id, 'ver'))));
end;
$$;
revoke execute on function public.fn_campo_eliminacion_copia(uuid) from public, anon;
grant execute on function public.fn_campo_eliminacion_copia(uuid) to authenticated;


-- ---------------------------------------------------------------- 8 · AGL: lo eliminado

-- La lista de identificadores de la 120/121 sigue siendo SOLO de Fertirriego (AGL la usa para purgar sus movimientos por cursor);
-- Inyección y Motores van por su propia función, así el contrato que AGL ya conoce no cambia.
create or replace function public.fn_fert_eliminados_para_agl(p_desde timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    c_limite constant integer := 5000;
    v_res  jsonb;
    v_mas  boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'ver')) then
        raise exception 'Tu rol no tiene permiso para leer lo eliminado de Fertirriego (Conexión AGL · ver).' using errcode = '42501';
    end if;
    with f as (
        select e.id, e.tipo, e.documento_id, e.eliminado_at, e.operaciones_ids, e.snapshot, e.movimientos_ids
        from public.fert_eliminaciones e
        where e.modulo = 'fertirriego' and (p_desde is null or e.eliminado_at > p_desde)
        order by e.eliminado_at, e.id
        limit c_limite + 1
    ), lim as (
        select * from f order by eliminado_at, id limit c_limite
    )
    select
        (select count(*) > c_limite from f),
        coalesce(jsonb_agg(jsonb_build_object(
            'eliminacion_id', l.id,
            'tipo', l.tipo,
            'documento_id', l.documento_id,
            'eliminado_at', l.eliminado_at,
            'movimientos', coalesce(l.movimientos_ids,
                     (select jsonb_agg(jsonb_build_object('cursor', x->'cursor', 'id', x->'id'))
                      from jsonb_array_elements(coalesce(l.snapshot->'movimientos', '[]'::jsonb)) x), '[]'::jsonb),
            'operaciones_ids', to_jsonb(coalesce(l.operaciones_ids, '{}'::uuid[]))
        ) order by l.eliminado_at, l.id), '[]'::jsonb)
    into v_mas, v_res
    from lim l;
    return jsonb_build_object('generado', now(), 'hay_mas', coalesce(v_mas, false), 'eliminados', coalesce(v_res, '[]'::jsonb));
end;
$$;
revoke execute on function public.fn_fert_eliminados_para_agl(timestamptz) from public, anon;
grant  execute on function public.fn_fert_eliminados_para_agl(timestamptz) to authenticated;

/**
 * Inyección y Motores: qué registros se eliminaron (solo identificadores, sin motivo ni nombres) para que AGL los quite de lo
 * que ya bajó. {eliminados: [{eliminacion_id, modulo, tipo, documento_id, eliminado_at}]}. Mismo permiso que fn_fert_eliminados_para_agl.
 */
create or replace function public.fn_campo_eliminados_para_agl(p_desde timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    c_limite constant integer := 5000;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'ver')) then
        raise exception 'Tu rol no tiene permiso para leer lo eliminado (Conexión AGL · ver).' using errcode = '42501';
    end if;
    return jsonb_build_object('generado', now(), 'eliminados', coalesce((
        select jsonb_agg(jsonb_build_object('eliminacion_id', e.id, 'modulo', e.modulo, 'tipo', e.tipo,
                                            'documento_id', e.documento_id, 'eliminado_at', e.eliminado_at)
                         order by e.eliminado_at, e.id)
          from (select z.* from public.fert_eliminaciones z
                 where z.modulo in ('inyeccion', 'motores') and (p_desde is null or z.eliminado_at > p_desde)
                 order by z.eliminado_at, z.id limit c_limite) e), '[]'::jsonb));
end;
$$;
revoke execute on function public.fn_campo_eliminados_para_agl(timestamptz) from public, anon;
grant  execute on function public.fn_campo_eliminados_para_agl(timestamptz) to authenticated;

notify pgrst, 'reload schema';
