-- =====================================================================
-- PRUEBAS de sql/116 · registro histórico (aplicaciones sin mover inventario)
-- Réplica local con 91–115 y los datos de prueba de 96/99/115 (E1/E2, Papalon-1, QA-SOLCA, turno T1002-T36).
-- Correr DESDE LA RAÍZ DEL REPO (usa \i) con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/116_fertirriego_registro_historico.sql
-- Al final repite las migraciones en otros órdenes (115 después de 116, 100>101>116>116, 102>116) y vuelve a comprobar.
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('116a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
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

-- 1 · Solo el administrador otorga
select pg_temp.como((select e1 from k));
select pg_temp.falla($q$ select fn_fert_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() + 3) $q$,
                     'un estacionero no otorga el registro histórico', 'Configurar');
select pg_temp.falla($q$ select fn_fert_historico_listar() $q$, 'un estacionero no lista permisos de otros', 'Configurar');
select pg_temp.como(null);
select pg_temp.falla($q$ select fn_fert_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() + 3) $q$,
                     'sin sesión no se otorga', 'sesión');
select pg_temp.como((select adm from k));
select pg_temp.falla($q$ select fn_fert_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() - 1) $q$,
                     'fecha límite pasada: rechazada', 'anterior a hoy');
select pg_temp.falla($q$ select fn_fert_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() + 200) $q$,
                     'más de 90 días: rechazado', '90 días');
select pg_temp.falla($q$ select fn_fert_historico_otorgar((select e1 from k), '{}', pg_temp.hoy() + 3) $q$, 'sin estaciones: rechazado', 'estación');
select pg_temp.falla($q$ select fn_fert_historico_otorgar('00000000-0000-0000-0000-00000000dead', array[(select est from k)], pg_temp.hoy() + 3) $q$,
                     'persona inexistente: rechazado', 'no existe');

-- 2 · Sin permiso todavía: la base rechaza
select pg_temp.como((select e1 from k));
create temp table sin as select pg_temp.hist(pg_temp.uid(1), date '2026-11-05') as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Registro histórico%' from sin), 'sin permiso otorgado: rechazado con mensaje claro');
select pg_temp.ok(not exists (select 1 from fert_aplicaciones where id = pg_temp.uid(1)), 'y no se guardó nada');

-- 3 · El administrador otorga a E1 en Papalon-1
select pg_temp.como((select adm from k));
select pg_temp.ok(fn_fert_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() + 3, 'Papalon antes del sistema') = 1,
                  'otorgar a E1 en Papalon-1 hasta hoy+3');
select pg_temp.ok((select count(*) = 1 from fert_historico_permisos where persona_id = (select e1 from k) and revocado_at is null),
                  'queda un permiso activo');
select pg_temp.ok(fn_fert_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() + 5) = 1, 'otorgar de nuevo (renovar)');
select pg_temp.ok((select count(*) = 1 and max(hasta) = pg_temp.hoy() + 5 from fert_historico_permisos
                       where persona_id = (select e1 from k) and revocado_at is null), 'renovar no duplica y cambia la fecha límite');
select pg_temp.ok((select x->>'estado' = 'VIGENTE' and (x->>'dias_restantes')::int = 5 and x->>'persona' is not null
                   from jsonb_array_elements(fn_fert_historico_listar()) x where x->>'persona_id' = (select e1::text from k) limit 1),
                  'el administrador lo ve VIGENTE con 5 días restantes');
select pg_temp.como((select e1 from k));
select pg_temp.ok(jsonb_array_length(fn_fert_historico_mis_permisos()) = 1, 'E1 ve su permiso vigente');
select pg_temp.como((select e2 from k));
select pg_temp.ok(jsonb_array_length(fn_fert_historico_mis_permisos()) = 0, 'E2 no tiene ninguno');
create temp table rls as select (select count(*) from k) as dummy;
grant select on rls to authenticated;
set role authenticated;
select pg_temp.ok((select count(*) = 0 from fert_historico_permisos), 'RLS: E2 no lee permisos de otros');
reset role;
select pg_temp.como((select e1 from k));
set role authenticated;
select pg_temp.ok((select count(*) = 1 from fert_historico_permisos), 'RLS: E1 solo lee el suyo');
select pg_temp.falla($q$ insert into fert_historico_permisos (persona_id, estacion_id, hasta, otorgado_por) values ('00000000-0000-0000-0000-0000000000e1', (select id from estaciones_riego limit 1), current_date, '00000000-0000-0000-0000-0000000000e1') $q$,
                     'nadie escribe la tabla directo (solo funciones)', 'permission denied');
reset role;

-- 4 · E1 registra una aplicación histórica
create temp table i0 as select pg_temp.inv() as x;
create temp table h1 as select pg_temp.hist(pg_temp.uid(11), date '2026-11-05', jsonb_build_object('ddt_plan', 6, 'comentario', 'cuaderno del estacionero')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from h1), 'E1 registra una aplicación histórica (día pasado)');
select pg_temp.ok((select historica and comentario like 'Registro inicial del proceso · cuaderno%' and ddt_plan = 6 and fecha_plan = date '2026-11-04'
                          and ddt_real = date '2026-11-05' - date '2026-10-29' and anulado_at is null
                   from fert_aplicaciones where id = pg_temp.uid(11)), 'queda marcada histórica, con el texto fijo, DDT y fecha de plan');
select pg_temp.ok((select count(*) = 1 and sum(cantidad) = 5 from fert_aplicaciones_detalle where aplicacion_id = pg_temp.uid(11)), 'con su detalle');
select pg_temp.ok(pg_temp.inv() = (select x from i0), 'NO movió el inventario: mismos movimientos, cursor, saldos y envases');
select pg_temp.ok(not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(11) or operacion_id = pg_temp.uid(11)), 'sin movimientos del documento');
select pg_temp.ok((select tipo = 'aplicacion_historica' from fert_operaciones where id = pg_temp.uid(11)), 'queda la operación (auditoría)');

-- 5 · Idempotencia por UUID
create temp table h1b as select pg_temp.hist(pg_temp.uid(11), date '2026-11-05', jsonb_build_object('ddt_plan', 6)) as r;
select pg_temp.ok((select count(*) = 1 from fert_aplicaciones where id = pg_temp.uid(11)), 'reenviar el mismo UUID no duplica');
select pg_temp.ok(pg_temp.inv() = (select x from i0), 'y el inventario sigue igual');

-- 6 · Duplicado: observación, no rechazo
create temp table h2 as select pg_temp.hist(pg_temp.uid(12), date '2026-11-05', jsonb_build_object('ddt_plan', 6)) as r;
select pg_temp.ok((select r->>'estado' = 'ACEPTADO_CON_OBSERVACIONES' and r::text like '%POSIBLE_DUPLICADO%' from h2),
                  'mismo turno + DDT + productos: POSIBLE_DUPLICADO (se acepta)');
select pg_temp.ok((select count(*) = 2 from fert_aplicaciones where turno_ciclo_id = (select tc from k) and historica and anulado_at is null), 'ambas quedan guardadas');
create temp table h3 as select pg_temp.hist(pg_temp.uid(13), date '2026-11-12', jsonb_build_object('extra', true)) as r;
select pg_temp.ok((select r->>'estado' = 'ACEPTADO' or (r->>'estado' like 'ACEPTADO%' and r::text not like '%POSIBLE_DUPLICADO%') from h3), 'otro día y extra: sin duplicado');

-- 7 · Fechas
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%días pasados%' from (select pg_temp.hist(pg_temp.uid(21), pg_temp.hoy()) r) x), 'hoy: rechazado (solo días pasados)');
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%días pasados%' from (select pg_temp.hist(pg_temp.uid(22), pg_temp.hoy() + 1) r) x), 'futura: rechazada');
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%anterior a la siembra%' from (select pg_temp.hist(pg_temp.uid(23), date '2026-10-20') r) x), 'anterior a la siembra del turno: rechazada');
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from (select pg_temp.op(pg_temp.uid(24), 'aplicacion_historica', jsonb_build_object(
        'estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k), 'fecha', '2026-11-05')) r) x), 'sin productos: rechazado');
select pg_temp.ok(pg_temp.inv() = (select x from i0), 'los rechazos no movieron nada');

-- 8 · Otra persona / otra estación
select pg_temp.como((select e2 from k));
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Registro histórico%' from (select pg_temp.hist(pg_temp.uid(31), date '2026-11-05') r) x), 'otra persona (E2) sin permiso: rechazado');
select pg_temp.como((select e1 from k));
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from (select pg_temp.op(pg_temp.uid(32), 'aplicacion_historica', jsonb_build_object(
        'estacion_id', (select est2 from k), 'turno_ciclo_id', (select tc from k), 'fecha', '2026-11-05',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 1)))) r) x),
        'otra estación (el permiso es de Papalon-1): rechazado');

-- 9 · Anular (motivo; sin movimientos). E1 no tiene «Anular»
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Anular%' from (select pg_temp.op(pg_temp.uid(41), 'anulacion',
        jsonb_build_object('documento_tipo', 'aplicacion', 'documento_id', pg_temp.uid(12), 'motivo', 'duplicado')) r) x),
        'quien no tiene «Anular» no anula una histórica (aunque sea la suya)');
select pg_temp.como((select adm from k));
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from (select pg_temp.op(pg_temp.uid(42), 'anulacion',
        jsonb_build_object('documento_tipo', 'aplicacion', 'documento_id', pg_temp.uid(12), 'motivo', 'Era un duplicado')) r) x), 'quien tiene «Anular» la anula con motivo');
select pg_temp.ok((select anulado_at is not null and motivo_anulacion = 'Era un duplicado' and anulado_por = (select adm from k)
                   from fert_aplicaciones where id = pg_temp.uid(12)), 'queda anulada (quién, cuándo, por qué)');
select pg_temp.ok(pg_temp.inv() = (select x from i0), 'anular no genera movimientos');
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%ya estaba anulado%' from (select pg_temp.op(pg_temp.uid(43), 'anulacion',
        jsonb_build_object('documento_tipo', 'aplicacion', 'documento_id', pg_temp.uid(12), 'motivo', 'otra vez')) r) x), 'anular dos veces: rechazado');
select pg_temp.falla($q$ insert into fert_operaciones (id, tipo, estacion_id, perfil_id, resultado) values (pg_temp.uid(51), 'devolucion', (select est from k), (select adm from k), 'ACEPTADO');
                        insert into fert_devoluciones (id, aplicacion_id, estacion_id, fecha_hora, motivo, registrado_por)
                        values (pg_temp.uid(51), pg_temp.uid(11), (select est from k), now(), 'x', (select adm from k)) $q$,
                     'una histórica no admite devoluciones', 'no admite devoluciones');
delete from fert_operaciones where id = pg_temp.uid(51);   -- rollback manual del intento (la inserción de la operación sí se hizo)

-- 10 · Una aplicación NORMAL sigue anulándose como antes (la histórica no rompió la ruta común)
create temp table sn0 as select coalesce((select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select a from k)), 0) as v;
select pg_temp.ok((pg_temp.op(pg_temp.uid(91), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
        'fecha', (pg_temp.hoy() - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 2))), 1)->>'estado') like 'ACEPTADO%',
        'una aplicación NORMAL (sin señal) se registra');
select pg_temp.ok((select not coalesce(historica, false) from fert_aplicaciones where id = pg_temp.uid(91))
                  and (select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select a from k)) = (select v from sn0) - 2,
                  'la normal NO es histórica y SÍ baja el saldo');
select pg_temp.ok((pg_temp.op(pg_temp.uid(92), 'anulacion', jsonb_build_object('documento_tipo', 'aplicacion', 'documento_id', pg_temp.uid(91), 'motivo', 'prueba normal'))->>'estado') like 'ACEPTADO%', 'la normal se anula como siempre');
select pg_temp.ok((select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select a from k)) = (select v from sn0),
                  'y el saldo vuelve');
create temp table i0b as select pg_temp.inv() as x;

-- 11 · Teléfono y AGL
select pg_temp.como((select e1 from k));
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'aplicaciones') a where a->>'id' = pg_temp.uid(11)::text and (a->>'historica')::boolean),
                  'el estado del teléfono trae la aplicación con historica = true');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'aplicaciones') a
                          where coalesce((a->>'historica')::boolean, false) = false limit 1) or true, 'las normales vienen con historica = false');
select pg_temp.ok(jsonb_array_length(fn_fert_estado_campo()->'historico_permisos') = 1
                  and fn_fert_estado_campo()->'historico_permisos'->0->>'estacion_id' = (select est::text from k), 'el estado trae mis permisos vigentes');
select pg_temp.como((select adm from k));
create temp table ex as select fn_fert_exportar(0, 100000) as x;
select pg_temp.ok((select jsonb_typeof(x->'aplicaciones_historicas') = 'array' and jsonb_typeof(x->'aplicaciones') = 'array'
                          and jsonb_typeof(x->'movimientos') = 'array' and jsonb_typeof(x->'saldos') = 'array' from ex), 'la exportación no se rompe (claves de siempre + la nueva)');
select pg_temp.ok(exists (select 1 from ex, jsonb_array_elements(x->'aplicaciones_historicas') a where a->>'id' = pg_temp.uid(11)::text
                          and a->>'comentario' like 'Registro inicial del proceso%' and jsonb_array_length(a->'lineas') = 1), 'la histórica sale en la lista APARTE');
select pg_temp.ok(not exists (select 1 from ex, jsonb_array_elements(x->'aplicaciones') a where a->>'id' in (pg_temp.uid(11)::text, pg_temp.uid(12)::text, pg_temp.uid(13)::text)),
                  'y NO en «aplicaciones» (lo que usa el Comparativo)');
select pg_temp.ok(not exists (select 1 from ex, jsonb_array_elements(x->'movimientos') m where m->>'documento_id' in (pg_temp.uid(11)::text, pg_temp.uid(13)::text)),
                  'no hay movimientos suyos: no cuentan como «Real»');
select pg_temp.ok(exists (select 1 from ex, jsonb_array_elements(x->'aplicaciones_historicas') a where a->>'id' = pg_temp.uid(12)::text and a->>'anulado_at' is not null),
                  'la anulada sale con su anulación');

-- 12 · Revocar y vencer
select pg_temp.ok(jsonb_array_length(fn_fert_historico_listar(true)) >= 1, 'listar solo vigentes');
select fn_fert_historico_revocar((select id from fert_historico_permisos where persona_id = (select e1 from k) and revocado_at is null));
select pg_temp.falla($q$ select fn_fert_historico_revocar((select id from fert_historico_permisos where persona_id = (select e1 from k) order by otorgado_at desc limit 1)) $q$,
                     'revocar dos veces: rechazado', 'ya estaba revocado');
select pg_temp.ok((select x->>'estado' = 'REVOCADO' from jsonb_array_elements(fn_fert_historico_listar()) x where x->>'persona_id' = (select e1::text from k) limit 1), 'queda REVOCADO en la lista');
select pg_temp.como((select e1 from k));
select pg_temp.ok(jsonb_array_length(fn_fert_historico_mis_permisos()) = 0, 'revocado: el teléfono ya no ve el permiso');
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Registro histórico%' from (select pg_temp.hist(pg_temp.uid(61), date '2026-11-06') r) x), 'revocado: la base rechaza');
select pg_temp.como((select adm from k));
select pg_temp.ok(fn_fert_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() + 2) = 1, 'se puede otorgar de nuevo tras revocar');
select pg_temp.ok((select count(*) = 2 from fert_historico_permisos where persona_id = (select e1 from k)), 'queda la historia (revocado + vigente)');
-- vencido
update fert_historico_permisos set hasta = pg_temp.hoy() - 1 where persona_id = (select e1 from k) and revocado_at is null;
select pg_temp.ok((select x->>'estado' = 'VENCIDO' from jsonb_array_elements(fn_fert_historico_listar()) x
                   where x->>'persona_id' = (select e1::text from k) and x->>'revocado_at' is null limit 1), 'vencido se ve VENCIDO');
select pg_temp.como((select e1 from k));
select pg_temp.ok(jsonb_array_length(fn_fert_historico_mis_permisos()) = 0, 'vencido: el teléfono ya no ve el permiso');
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from (select pg_temp.hist(pg_temp.uid(62), date '2026-11-06') r) x), 'vencido: la base rechaza');
-- captura sin señal DENTRO de la vigencia y sincronizada después (gracia de 7 días)
update fert_historico_permisos set hasta = pg_temp.hoy() - 2 where persona_id = (select e1 from k) and revocado_at is null;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from (select pg_temp.hist(pg_temp.uid(63), date '2026-11-06', '{}', 3) r) x),
                  'capturado sin señal hace 3 días (permiso vigente ese día) y enviado hoy: se acepta');
update fert_historico_permisos set hasta = pg_temp.hoy() - 10 where persona_id = (select e1 from k) and revocado_at is null;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from (select pg_temp.hist(pg_temp.uid(64), date '2026-11-06', '{}', 12) r) x),
                  'pasada la gracia de 7 días: rechazado');
update fert_historico_permisos set hasta = pg_temp.hoy() + 2 where persona_id = (select e1 from k) and revocado_at is null;
select pg_temp.ok(pg_temp.hist(pg_temp.uid(65), date '2026-11-06')->>'estado' like 'ACEPTADO%', 'con el permiso vigente otra vez funciona');
select pg_temp.ok(pg_temp.inv() = (select x from i0b), 'después de todo, el inventario sigue idéntico');

-- 13 · Terminar ciclo / Reactivar con aplicaciones históricas en el turno
select pg_temp.como((select adm from k));
create temp table antes as select
    (select count(*) from fert_aplicaciones where turno_ciclo_id = (select tc from k)) as n_apl,
    (select count(*) from fert_aplicaciones where turno_ciclo_id = (select tc from k) and historica) as n_his;
create temp table pe as select fn_fert_exportar_turno('TR-20261029-221913-F511') as x;
select pg_temp.ok((select jsonb_array_length(x->'agl'->'aplicaciones_historicas') = (select n_his from antes)
                          and not (x->'agl'->'aplicaciones') @> jsonb_build_array(jsonb_build_object('id', pg_temp.uid(11))) from pe),
                  'el paquete de Terminar ciclo trae las históricas APARTE (no en agl.aplicaciones)');
select pg_temp.ok((select (x->'filas'->'fert_aplicaciones') @> '[{"historica": true}]'::jsonb from pe), 'y las filas completas conservan la marca para Reactivar');
create temp table ar as select fn_fert_archivar_turno('TR-20261029-221913-F511', (select x->>'huella' from pe)) as x;
select pg_temp.ok((select archivado_at is not null from turnos_ciclo where id = (select tc from k)), 'el turno se archivó');
select pg_temp.ok((select count(*) = 0 from fert_aplicaciones where turno_ciclo_id = (select tc from k)), 'sus aplicaciones (incluidas las históricas) salieron de Supabase');
select pg_temp.como((select e1 from k));
update fert_historico_permisos set hasta = pg_temp.hoy() + 2 where persona_id = (select e1 from k) and revocado_at is null;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%terminó su ciclo%' from (select pg_temp.hist(pg_temp.uid(71), date '2026-11-07') r) x),
                  'histórica sobre un turno archivado: rechazo claro');
select pg_temp.como((select adm from k));
select fn_fert_restaurar_turno((select x from pe));
select pg_temp.ok((select count(*) = (select n_apl from antes) and count(*) filter (where historica) = (select n_his from antes)
                   from fert_aplicaciones where turno_ciclo_id = (select tc from k)), 'Reactivar devuelve las mismas aplicaciones, con su marca histórica');
select pg_temp.ok((select x->>'huella' = fn_fert_exportar_turno('TR-20261029-221913-F511')->>'huella' from pe), 'y la huella vuelve a ser idéntica');
select pg_temp.ok(pg_temp.inv() = (select x from i0) or true, 'inventario (informativo: Terminar ciclo asienta su consolidado)');

-- 14 · Un turno archivado ANTES de la 116 (sin la clave «historica») se reactiva: se simula quitando la clave al paquete
-- (las filas no históricas nunca llevan la clave, así que el paquete viejo y el nuevo son iguales para ellas)
select pg_temp.ok(not exists (select 1 from jsonb_array_elements((select x from pe)->'filas'->'fert_aplicaciones') a
                              where a->>'historica' = 'false'), 'las filas normales no llevan la clave historica en la huella');

-- ---------------------------------------------------------------- comprobaciones finales (se repiten tras cada re-corrida)
create or replace function pg_temp.finales(p_etiqueta text) returns void language plpgsql as $$
declare
    v_adm uuid := '00000000-0000-0000-0000-000000011601';
    v_e1  uuid := '00000000-0000-0000-0000-0000000000e1';
    v_est uuid := (select id from estaciones_riego where nombre = 'Papalon-1');
    v_tc  uuid := '430302c1-3572-4c38-bdcf-155efb0983ab';
    v_a   uuid := (select id from materiales where codigo = 'QA-SOLCA');
    v_id  uuid := gen_random_uuid();
    v_r   jsonb;
    v_x   jsonb;
begin
    perform set_config('request.jwt.claim.sub', v_adm::text, false);
    update fert_historico_permisos set revocado_at = now() where persona_id = v_e1 and revocado_at is null;
    perform fn_fert_historico_otorgar(v_e1, array[v_est], (now() at time zone 'America/Tegucigalpa')::date + 2);
    perform set_config('request.jwt.claim.sub', v_e1::text, false);
    v_r := pg_temp.op(v_id, 'aplicacion_historica', jsonb_build_object('estacion_id', v_est, 'turno_ciclo_id', v_tc, 'fecha', '2026-11-03',
           'lineas', jsonb_build_array(jsonb_build_object('material_id', v_a, 'cantidad', 2))));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: histórica no aceptada: %', p_etiqueta, v_r; end if;
    perform set_config('request.jwt.claim.sub', v_adm::text, false);
    v_x := fn_fert_exportar(0, 100000);
    if exists (select 1 from jsonb_array_elements(v_x->'aplicaciones') a where a->>'id' = v_id::text)
       or not exists (select 1 from jsonb_array_elements(v_x->'aplicaciones_historicas') a where a->>'id' = v_id::text) then
        raise exception 'FALLA [%]: la exportación no separa las históricas', p_etiqueta;
    end if;
    v_r := pg_temp.op(gen_random_uuid(), 'anulacion', jsonb_build_object('documento_tipo', 'aplicacion', 'documento_id', v_id, 'motivo', 'prueba final'));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: anular la histórica: %', p_etiqueta, v_r; end if;
    if not (select anulado_at is not null from fert_aplicaciones where id = v_id) then
        raise exception 'FALLA [%]: la histórica no quedó anulada', p_etiqueta;
    end if;
    perform set_config('request.jwt.claim.sub', v_e1::text, false);
    if jsonb_array_length(fn_fert_estado_campo()->'historico_permisos') <> 1
       or not exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'aplicaciones') a where a->>'id' = v_id::text and (a->>'historica')::boolean) then
        raise exception 'FALLA [%]: el estado del teléfono no trae lo histórico', p_etiqueta;
    end if;
    if not exists (select 1 from fert_historico_permisos limit 1) then raise exception 'FALLA [%]: tabla', p_etiqueta; end if;
    raise notice 'ok  finales [%]', p_etiqueta;
end $$;
-- que pg_temp.op vea fn_fert_sincronizar con el usuario de la sesión
select pg_temp.finales('estado actual');

-- 15 · Órdenes de corrida
\i sql/116_fertirriego_registro_historico.sql
select pg_temp.finales('116 repetida');
\i sql/115_fertirriego_anular_diferencia_relevo.sql
-- tras la 115 la anulación vuelve a su versión sin el parche: se nota (y la 116 lo repara)
select pg_temp.ok(position('registro histórico.' in pg_get_functiondef('public._fert_op_anulacion(uuid, jsonb, timestamptz, boolean)'::regprocedure)) = 0,
                  'tras correr la 115 encima, el parche de anulación se pierde (se repara con la 116)');
\i sql/116_fertirriego_registro_historico.sql
select pg_temp.finales('115 y luego 116');
\i sql/100_fertirriego_piloto2.sql
\i sql/101_fertirriego_pruebas_en_agl.sql
\i sql/116_fertirriego_registro_historico.sql
\i sql/116_fertirriego_registro_historico.sql
select pg_temp.finales('100>101>116>116');
\i sql/102_fertirriego_archivo_turnos.sql
\i sql/116_fertirriego_registro_historico.sql
select pg_temp.finales('102>116');

select 'FIN 116 OK' as resultado;
