-- =====================================================================
-- PRUEBAS de sql/115 · anular la diferencia de un producto en un relevo
-- Réplica local con 91–114 (y las pruebas de 96/99 con sus datos: E1/E2, Papalon-1, QA-SOLCA, 101478, turno T1002-T36).
-- Correr con: psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/115_fertirriego_anular_diferencia_relevo.sql
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
create or replace function pg_temp.codigo(p_perfil uuid, p_momento timestamptz) returns text language sql as $$
    select fn_fert_totp((select secreto from fert_llaves where perfil_id = p_perfil), floor(extract(epoch from p_momento) / 30)::bigint)
$$;
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb) returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', now(), 'enviado_en', now(), 'inmediato', true,
        'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.saldo(p_est uuid, p_mat uuid) returns numeric language sql as
$$ select coalesce((select disponible from fert_saldos where estacion_id = p_est and material_id = p_mat), 0) $$;
set client_min_messages = notice;

-- Administrador de la prueba
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T115_ADM', 'P115 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T115_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000011501', 'adm@115') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000011501', 'Admin 115', r, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000011501', r) on conflict do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    (select id from materiales where codigo = '101478') as b,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1, '00000000-0000-0000-0000-0000000000e2'::uuid as e2,
    '00000000-0000-0000-0000-000000011501'::uuid as adm,
    '115a0000-0000-4000-8000-000000000001'::uuid as r1;
create temp table s0 as select pg_temp.saldo((select est from k), (select a from k)) as a,
                                pg_temp.saldo((select est from k), (select b from k)) as b;

-- Quien tiene la estación es E1 (si no, se la asigna el administrador)
select pg_temp.como((select adm from k));
do $$
declare v_est uuid := (select est from k);
begin
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 115');
    end if;
    update fert_custodia set desde = now() - interval '2 hours' where estacion_id = v_est;
end $$;

-- 1 · Relevo con dos diferencias (−3 y −2)
select pg_temp.como((select e1 from k));
select pg_temp.ok((pg_temp.op((select r1 from k), 'relevo_entregar', jsonb_build_object('estacion_id', (select est from k), 'nota', 'Prueba 115'))->>'estado')
                  like 'ACEPTADO%', 'E1 entrega la estación');
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op('115a0000-0000-4000-8000-000000000002', 'relevo_recibir', jsonb_build_object(
        'estacion_id', (select est from k), 'entrega_id', (select e1 from k),
        'codigo', pg_temp.codigo((select e1 from k), now()), 'momento_codigo', now(),
        'diferencias', jsonb_build_array(
            jsonb_build_object('material_id', (select a from k), 'cantidad_real', (select a from s0) - 3),
            jsonb_build_object('material_id', (select b from k), 'cantidad_real', (select b from s0) - 2)))))->>'estado'
        = 'ACEPTADO_CON_OBSERVACIONES', 'E2 recibe con dos diferencias');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0) - 3
              and pg_temp.saldo((select est from k), (select b from k)) = (select b from s0) - 2, 'las diferencias bajan el saldo');
select pg_temp.ok((select revisar from fert_relevos where id = (select r1 from k)), 'el relevo queda para revisar');

-- 2 · Reglas
create or replace function pg_temp.anular(p_op uuid, p_mat uuid, p_motivo text) returns jsonb language sql as $$
    select pg_temp.op(p_op, 'anulacion', jsonb_build_object('documento_tipo', 'relevo',
        'documento_id', (select r1 from k), 'material_id', p_mat, 'motivo', p_motivo))
$$;
select pg_temp.como((select adm from k));
select pg_temp.ok((select (r->>'estado') = 'RECHAZADO' and r::text ilike '%25 letras%' from pg_temp.anular('115a0000-0000-4000-8000-000000000011', (select a from k), 'se olvidó') r),
                  'motivo corto: rechazado con mensaje claro');
select pg_temp.ok((select (r->>'estado') = 'RECHAZADO' and r::text ilike '%25 letras%'
                   from pg_temp.anular('115a0000-0000-4000-8000-000000000012', (select a from k), repeat(' ', 30) || 'corto') r),
                  'los espacios no cuentan para el mínimo');
select pg_temp.como((select e2 from k));
select pg_temp.ok((select (r->>'estado') = 'RECHAZADO' and r::text ilike '%Anular%'
                   from pg_temp.anular('115a0000-0000-4000-8000-000000000013', (select a from k), 'Se aplicó el lunes en el turno T36 y nadie lo registró') r),
                  'sin permiso «Anular» falla aunque sea quien recibió (autor del relevo)');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0) - 3, 'los rechazos no mueven el saldo');
select pg_temp.como((select adm from k));
select pg_temp.ok((select (r->>'estado') = 'RECHAZADO' from pg_temp.anular('115a0000-0000-4000-8000-000000000014',
                   '00000000-0000-0000-0000-00000000dead', 'Se aplicó el lunes en el turno T36 y nadie lo registró') r),
                  'producto sin diferencia en ese relevo: rechazado');

-- 3 · Anular la diferencia de A
select pg_temp.ok((select (r->>'estado') like 'ACEPTADO%' from pg_temp.anular('115a0000-0000-4000-8000-000000000021', (select a from k),
                   'Se aplicó el lunes en el turno T36 y E1 no lo registró antes de entregar') r), 'anular la diferencia de A con motivo largo');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0), 'A vuelve al inventario');
select pg_temp.ok(pg_temp.saldo((select est from k), (select b from k)) = (select b from s0) - 2, 'la diferencia de B queda intacta');
select pg_temp.ok((select anulado_at is not null and anulado_por = (select adm from k) and motivo_anulacion like 'Se aplicó el lunes%'
                   from fert_relevos_diferencias where relevo_id = (select r1 from k) and material_id = (select a from k)), 'la fila de A queda marcada (quién, cuándo, por qué)');
select pg_temp.ok((select anulado_at is null from fert_relevos_diferencias where relevo_id = (select r1 from k) and material_id = (select b from k)), 'la fila de B sigue vigente');
select pg_temp.ok((select revisar from fert_relevos where id = (select r1 from k)), 'queda para revisar mientras haya otra diferencia');
select pg_temp.ok((select count(*) = 1 from fert_movimientos m
                   where m.tipo = 'ANULACION' and m.documento_tipo = 'relevo' and m.documento_id = (select r1 from k) and m.material_id = (select a from k)
                     and m.anula_id = (select x.id from fert_movimientos x where x.tipo = 'DIFERENCIA_RELEVO' and x.documento_id = (select r1 from k) and x.material_id = (select a from k))),
                  'un movimiento ANULACION que apunta a la diferencia');
select pg_temp.ok((select custodio_id = (select e2 from k) and estado = 'ACTIVA' from fert_custodia where estacion_id = (select est from k)), 'la custodia no cambia');
select pg_temp.ok((select estado = 'RECIBIDO' from fert_relevos where id = (select r1 from k)), 'el relevo sigue RECIBIDO');
select pg_temp.ok((select (r->>'estado') = 'RECHAZADO' and r::text ilike '%ya estaba anulada%'
                   from pg_temp.anular('115a0000-0000-4000-8000-000000000022', (select a from k),
                   'Se aplicó el lunes en el turno T36 y E1 no lo registró antes de entregar') r), 'anular dos veces: rechazado');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0), 'el segundo intento no movió nada');

-- 4 · Estado del teléfono y exportación a AGL
select pg_temp.como((select e2 from k));
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'relevos') r, jsonb_array_elements(r->'diferencias') d
                          where r->>'id' = (select r1::text from k) and d->>'material_id' = (select a::text from k)
                            and d->>'anulado_at' is not null and d->>'motivo_anulacion' like 'Se aplicó%' and d->>'anulado_por_nombre' = 'Admin 115'),
                  'el estado del teléfono trae anulado_at, motivo y quién');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'relevos') r, jsonb_array_elements(r->'diferencias') d
                          where r->>'id' = (select r1::text from k) and d->>'material_id' = (select b::text from k) and d->>'anulado_at' is null),
                  'la diferencia vigente viene sin anulado_at');
select pg_temp.como((select adm from k));
select pg_temp.ok(exists (select 1 from jsonb_array_elements(fn_fert_exportar(0, 100000)->'relevos') r, jsonb_array_elements(r->'diferencias') d
                          where d->>'anulado_at' is not null and d->>'motivo_anulacion' like 'Se aplicó%' and d->>'anulado_por_nombre' = 'Admin 115'),
                  'la exportación a AGL trae los campos de la anulación');

-- 5 · Anular la otra: el relevo deja de pedir revisión
select pg_temp.ok((select (r->>'estado') like 'ACEPTADO%' from pg_temp.anular('115a0000-0000-4000-8000-000000000031', (select b from k),
                   'Se aplicó el martes de noche y no se registró; se corrige antes de contar') r), 'anular la diferencia de B');
select pg_temp.ok(not (select revisar from fert_relevos where id = (select r1 from k)), 'sin diferencias vigentes el relevo ya no pide revisión');
select pg_temp.ok(pg_temp.saldo((select est from k), (select b from k)) = (select b from s0), 'B vuelve al inventario');

-- 6 · Flujo completo: ahora sí se registra la aplicación olvidada
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op('115a0000-0000-4000-8000-000000000041', 'aplicacion', jsonb_build_object(
        'estacion_id', (select est from k), 'turno_ciclo_id', '430302c1-3572-4c38-bdcf-155efb0983ab', 'fecha', (now() at time zone 'America/Tegucigalpa')::date::text,
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 3))))->>'estado') like 'ACEPTADO%',
        'se registra la aplicación olvidada');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0) - 3, 'saldo final de A = saldo inicial − lo aplicado');

-- 7 · Limpieza lógica (no se borra el libro: es inalterable); los datos de prueba quedan en la réplica
select 'FIN 115 OK' as resultado;
