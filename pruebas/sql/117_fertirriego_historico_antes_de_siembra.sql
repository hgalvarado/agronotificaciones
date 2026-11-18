-- =====================================================================
-- PRUEBAS de sql/117 · registro histórico acepta días ANTES de la siembra (DDT negativo)
-- Base: réplica con 91–116 (ya corrió pruebas/sql/116_*.sql; el turno T1002-T36 siembra 2026-10-29 y su plan tiene DDT -5 el 2026-10-24).
-- Correr DESDE LA RAÍZ DEL REPO con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/117_fertirriego_historico_antes_de_siembra.sql
-- Al final repite las migraciones en otros órdenes (117>117, 116>117, 100>101>116>117>117, 102>116>117, 115>116>117).
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function pg_temp.como(p uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false) $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
    if p_cond is distinct from true then raise exception 'FALLA: %', p_msg; end if;
    raise notice 'ok  %', p_msg;
end $$;
create or replace function pg_temp.falla(p_sql text, p_msg text, p_texto text default null) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: % (no falló)', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    if p_texto is not null and position(p_texto in sqlerrm) = 0 then
        raise exception 'FALLA: % (mensaje inesperado: %)', p_msg, sqlerrm;
    end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
/** Una operación; p_dias_atras simula captura sin señal (creado_en en el pasado). */
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', now() - make_interval(days => p_dias_atras), 'enviado_en', now(),
        'inmediato', p_dias_atras = 0, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('117a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
/** Libro, saldos y envases de las estaciones reales: debe quedar idéntico. */
create or replace function pg_temp.inv() returns jsonb language sql as $$
    select jsonb_build_object(
        'movs', (select count(*) from fert_movimientos), 'cursor', (select coalesce(max(cursor), 0) from fert_movimientos),
        'saldos', (select coalesce(jsonb_object_agg(s.estacion_id || '|' || s.material_id, s.disponible), '{}') from fert_saldos s),
        'envases', (select count(*) from fert_envases_movimientos))
$$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T116_ADM', 'P116 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T116_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000011601', 'adm@116') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000011601', 'Admin 116', r, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000011601', r) on conflict do nothing;
    -- limpia permisos de corridas anteriores (tabla nueva: solo de esta prueba)
    delete from fert_historico_permisos where persona_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from estaciones_riego where nombre = 'Zamora') as est2,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    (select id from materiales where codigo = '101478') as b,
    '430302c1-3572-4c38-bdcf-155efb0983ab'::uuid as tc,     -- T1002-T36, siembra 2026-10-29, Papalon-1
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1, '00000000-0000-0000-0000-0000000000e2'::uuid as e2,
    '00000000-0000-0000-0000-000000011601'::uuid as adm;

create or replace function pg_temp.hist(p_id uuid, p_fecha date, p_extra jsonb default '{}', p_dias_atras integer default 0) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'aplicacion_historica', jsonb_build_object(
        'estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k), 'fecha', p_fecha::text,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 5))) || p_extra, p_dias_atras)
$$;


-- 0 · Preparación: permiso vigente de E1 en Papalon-1
select pg_temp.como((select adm from k));
update fert_historico_permisos set revocado_at = now() where persona_id = (select e1 from k) and revocado_at is null;
select fn_fert_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() + 5, 'prueba 117');
create temp table i0 as select pg_temp.inv() as x;
select pg_temp.como((select e1 from k));

-- 1 · Línea base: con solo la 116 se rechaza (solo se comprueba si el texto viejo sigue ahí)
do $$ begin
    if position('anterior a la siembra del turno (%)' in pg_get_functiondef('public._fert_op_aplicacion_historica(uuid, jsonb, timestamptz)'::regprocedure)) > 0 then
        if (select pg_temp.hist(pg_temp.uid(1), date '2026-10-20')->>'estado') <> 'RECHAZADO' then
            raise exception 'FALLA: la 116 sola debía rechazar antes de la siembra';
        end if;
        raise notice 'ok  línea base: con solo la 116, antes de la siembra se rechaza';
    else
        raise notice 'ok  línea base: la 117 ya estaba aplicada';
    end if;
end $$;

\i sql/117_fertirriego_historico_antes_de_siembra.sql
select pg_temp.como((select e1 from k));

create or replace function pg_temp.finales(p_etiqueta text) returns void language plpgsql as $$
declare
    v_adm uuid := '00000000-0000-0000-0000-000000011601';
    v_e1  uuid := '00000000-0000-0000-0000-0000000000e1';
    v_est uuid := (select id from estaciones_riego where nombre = 'Papalon-1');
    v_tc  uuid := '430302c1-3572-4c38-bdcf-155efb0983ab';
    v_a   uuid := (select id from materiales where codigo = 'QA-SOLCA');
    v_id  uuid := gen_random_uuid();
    v_r   jsonb;
begin
    perform set_config('request.jwt.claim.sub', v_adm::text, false);
    update fert_historico_permisos set revocado_at = now() where persona_id = v_e1 and revocado_at is null;
    perform fn_fert_historico_otorgar(v_e1, array[v_est], (now() at time zone 'America/Tegucigalpa')::date + 2);
    perform set_config('request.jwt.claim.sub', v_e1::text, false);
    v_r := pg_temp.op(v_id, 'aplicacion_historica', jsonb_build_object('estacion_id', v_est, 'turno_ciclo_id', v_tc, 'fecha', '2026-10-22',
           'lineas', jsonb_build_array(jsonb_build_object('material_id', v_a, 'cantidad', 2))));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: pre-siembra no aceptada: %', p_etiqueta, v_r; end if;
    if (select ddt_real from fert_aplicaciones where id = v_id) <> -7 then raise exception 'FALLA [%]: ddt_real', p_etiqueta; end if;
    v_r := pg_temp.op(gen_random_uuid(), 'aplicacion_historica', jsonb_build_object('estacion_id', v_est, 'turno_ciclo_id', v_tc,
           'fecha', ((now() at time zone 'America/Tegucigalpa')::date)::text,
           'lineas', jsonb_build_array(jsonb_build_object('material_id', v_a, 'cantidad', 2))));
    if v_r->>'estado' <> 'RECHAZADO' then raise exception 'FALLA [%]: hoy debe seguir rechazado', p_etiqueta; end if;
    perform set_config('request.jwt.claim.sub', v_adm::text, false);
    v_r := pg_temp.op(gen_random_uuid(), 'anulacion', jsonb_build_object('documento_tipo', 'aplicacion', 'documento_id', v_id, 'motivo', 'prueba final 117'));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: anular: %', p_etiqueta, v_r; end if;
    raise notice 'ok  finales [%]', p_etiqueta;
end $$;

-- 2 · Antes de la siembra: ahora se registra
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from (select pg_temp.hist(pg_temp.uid(2), date '2026-10-20', jsonb_build_object('ddt_plan', -5)) r) x),
                  'histórica ANTES de la siembra (2026-10-20, siembra 10-29) con el DDT -5 del plan: aceptada');
select pg_temp.ok((select historica and ddt_plan = -5 and fecha_plan = date '2026-10-24' and ddt_real = -9 and fecha = date '2026-10-20'
                   from fert_aplicaciones where id = pg_temp.uid(2)), 'se guarda con ddt_plan = -5, fecha_plan 10-24 y ddt_real = -9');
select pg_temp.ok((select count(*) = 1 and bool_and(not en_plan) from fert_aplicaciones_detalle where aplicacion_id = pg_temp.uid(2)), 'QA-SOLCA no es del plan del DDT -5: queda fuera de plan (observación, no rechazo)');
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from (select pg_temp.op(pg_temp.uid(6), 'aplicacion_historica', jsonb_build_object(
        'estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k), 'fecha', '2026-10-24', 'ddt_plan', -5,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select id from materiales where codigo = '100114'), 'cantidad', 3)))) r) x), 'producto del plan en su DDT -5 (día del plan): aceptada');
select pg_temp.ok((select count(*) = 1 and bool_and(en_plan) from fert_aplicaciones_detalle where aplicacion_id = pg_temp.uid(6)) and (select ddt_real = -5 from fert_aplicaciones where id = pg_temp.uid(6)), 'queda en plan y ddt_real = -5');
select pg_temp.ok(pg_temp.inv() = (select x from i0), 'y no mueve el inventario');
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from (select pg_temp.hist(pg_temp.uid(3), date '2026-10-15', jsonb_build_object('extra', true)) r) x), 'extra antes de la siembra: aceptada');
select pg_temp.ok((select extra and ddt_plan is null and ddt_real = -14 from fert_aplicaciones where id = pg_temp.uid(3)), 'ddt_real = -14 y sin DDT del plan');
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from (select pg_temp.hist(pg_temp.uid(4), date '2026-10-29', jsonb_build_object('extra', true)) r) x), 'el mismo día de la siembra: aceptada');
select pg_temp.ok((select ddt_real = 0 from fert_aplicaciones where id = pg_temp.uid(4)), 'ddt_real = 0');
select pg_temp.ok((select r->>'estado' = 'ACEPTADO_CON_OBSERVACIONES' and r::text like '%POSIBLE_DUPLICADO%'
                   from (select pg_temp.hist(pg_temp.uid(5), date '2026-10-20', jsonb_build_object('ddt_plan', -5)) r) x), 'el mismo DDT negativo otra vez: POSIBLE_DUPLICADO (se acepta)');

-- 3 · Lo demás sigue rechazándose
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%días pasados%' from (select pg_temp.hist(pg_temp.uid(21), pg_temp.hoy()) r) x), 'hoy: sigue rechazado');
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%días pasados%' from (select pg_temp.hist(pg_temp.uid(22), pg_temp.hoy() + 1) r) x), 'futura: sigue rechazada');
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from (select pg_temp.hist(pg_temp.uid(23), date '2026-10-20', jsonb_build_object('turno_ciclo_id', '00000000-0000-0000-0000-00000000dead')) r) x), 'turno inexistente: rechazado');
select pg_temp.como((select e2 from k));
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Registro histórico%' from (select pg_temp.hist(pg_temp.uid(24), date '2026-10-20') r) x), 'sin permiso: sigue rechazado (también antes de la siembra)');
select pg_temp.como((select e1 from k));
select pg_temp.ok(pg_temp.inv() = (select x from i0), 'los rechazos no movieron nada');

-- 4 · La aplicación NORMAL nunca tuvo la restricción de siembra
select pg_temp.ok(position('anterior a la siembra' in pg_get_functiondef('public._fert_op_aplicacion(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) = 0,
                  'la aplicación normal no tiene la validación de siembra');

-- 5 · Teléfono y AGL con DDT real negativo
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'aplicaciones') a
                          where a->>'id' = pg_temp.uid(2)::text and (a->>'ddt_real')::int = -9 and (a->>'historica')::boolean), 'el teléfono trae ddt_real = -9');
select pg_temp.como((select adm from k));
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_exportar(0, 100000)->'aplicaciones_historicas') a
                          where a->>'id' = pg_temp.uid(2)::text and (a->>'ddt_real')::int = -9), 'AGL recibe la histórica pre-siembra con ddt_real = -9 en aplicaciones_historicas');

-- 6 · Terminar ciclo / Reactivar con histórica pre-siembra
create temp table antes as select
    (select count(*) from fert_aplicaciones where turno_ciclo_id = (select tc from k)) as n_apl,
    (select count(*) from fert_aplicaciones where turno_ciclo_id = (select tc from k) and historica and ddt_real < 0) as n_neg;
select pg_temp.ok((select n_neg >= 3 from antes), 'hay históricas con DDT real negativo en el turno');
create temp table pe as select fn_fert_exportar_turno('TR-20261029-221913-F511') as x;
select pg_temp.ok((select (x->'filas'->'fert_aplicaciones') @> '[{"ddt_real": -9, "historica": true}]'::jsonb from pe), 'el paquete conserva ddt_real negativo');
create temp table ar as select fn_fert_archivar_turno('TR-20261029-221913-F511', (select x->>'huella' from pe)) as x;
select pg_temp.ok((select count(*) = 0 from fert_aplicaciones where turno_ciclo_id = (select tc from k)), 'Terminar ciclo: salen de Supabase');
select fn_fert_restaurar_turno((select x from pe));
select pg_temp.ok((select count(*) = (select n_apl from antes) and count(*) filter (where historica and ddt_real < 0) = (select n_neg from antes)
                   from fert_aplicaciones where turno_ciclo_id = (select tc from k)), 'Reactivar: mismas filas, con DDT real negativo');
select pg_temp.ok((select x->>'huella' = fn_fert_exportar_turno('TR-20261029-221913-F511')->>'huella' from pe), 'y la huella vuelve idéntica');

-- 7 · Órdenes de corrida
select pg_temp.finales('estado actual');
\i sql/117_fertirriego_historico_antes_de_siembra.sql
\i sql/117_fertirriego_historico_antes_de_siembra.sql
select pg_temp.finales('117>117');
\i sql/116_fertirriego_registro_historico.sql
select pg_temp.como((select e1 from k));
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%anterior a la siembra%' from (select pg_temp.hist(pg_temp.uid(31), date '2026-10-20') r) x),
                  'tras correr la 116 encima vuelve la restricción (se repara con la 117)');
\i sql/117_fertirriego_historico_antes_de_siembra.sql
select pg_temp.finales('116>117');
\i sql/100_fertirriego_piloto2.sql
\i sql/101_fertirriego_pruebas_en_agl.sql
\i sql/116_fertirriego_registro_historico.sql
\i sql/117_fertirriego_historico_antes_de_siembra.sql
\i sql/117_fertirriego_historico_antes_de_siembra.sql
select pg_temp.finales('100>101>116>117>117');
\i sql/102_fertirriego_archivo_turnos.sql
\i sql/116_fertirriego_registro_historico.sql
\i sql/117_fertirriego_historico_antes_de_siembra.sql
select pg_temp.finales('102>116>117');
\i sql/115_fertirriego_anular_diferencia_relevo.sql
\i sql/116_fertirriego_registro_historico.sql
\i sql/117_fertirriego_historico_antes_de_siembra.sql
select pg_temp.finales('115>116>117');

select 'FIN 117 OK' as resultado;
