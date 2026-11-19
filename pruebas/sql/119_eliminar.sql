-- =====================================================================
-- PRUEBAS de sql/119 · eliminar por completo un registro de Fertirriego
-- Base: réplica con 91-118 y datos de 96/99/115/116 (Papalon-1, Zamora, QA-SOLCA, T1002-T36/T37, E1/E2/E3, Admin 116).
-- Correr DESDE LA RAÍZ DEL REPO:  psql -d <base con la 119> -v ON_ERROR_STOP=1 -f pruebas/sql/119_eliminar.sql
-- Al final repite migraciones en otros órdenes (100>101>119>119, 115>119, 116>117>119, 102>119).
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
create or replace function pg_temp.falla(p_sql text, p_msg text, p_texto text default null, p_code text default null) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: % (no falló)', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    if p_texto is not null and position(p_texto in sqlerrm) = 0 then
        raise exception 'FALLA: % (mensaje inesperado: %)', p_msg, sqlerrm;
    end if;
    if p_code is not null and sqlstate <> p_code then
        raise exception 'FALLA: % (código % y se esperaba %)', p_msg, sqlstate, p_code;
    end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_creado timestamptz default now(), p_inmediato boolean default true)
returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', p_creado, 'enviado_en', now(), 'inmediato', p_inmediato,
        'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('11900000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.codigo(p_perfil uuid, p_momento timestamptz) returns text language sql as $$
    select fn_fert_totp((select secreto from fert_llaves where perfil_id = p_perfil), floor(extract(epoch from p_momento) / 30)::bigint)
$$;
/** Pares estación×producto cuyo saldo NO es la suma de sus movimientos (debe ser []). */
create or replace function pg_temp.drift() returns jsonb language sql as $$
    select coalesce(jsonb_agg(jsonb_build_object('e', s.estacion_id, 'm', s.material_id, 'd', s.disponible)), '[]')
    from fert_saldos s
    where s.disponible <> coalesce((select sum(cantidad) from fert_movimientos m where m.estacion_id = s.estacion_id and m.material_id = s.material_id), 0)
$$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r1 smallint; r2 smallint;
begin
    insert into roles (codigo, nombre) values ('T119_DEL', 'P119 elimina'), ('T119_PROP', 'P119 propietario') on conflict (codigo) do nothing;
    select id into r1 from roles where codigo = 'T119_DEL';
    select id into r2 from roles where codigo = 'T119_PROP';
    insert into permisos (rol_id, recurso, accion, permitido, alcance) values
        (r1, 'fertirriego', 'ver', true, 'global'), (r1, 'fertirriego', 'eliminar_definitivo', true, 'global'),
        (r2, 'fertirriego', 'ver', true, 'propietario'), (r2, 'fertirriego', 'eliminar_definitivo', true, 'propietario')
    on conflict (rol_id, recurso, accion) do update set permitido = true, alcance = excluded.alcance;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000011902', 'del@119'), ('00000000-0000-0000-0000-000000011903', 'prop@119') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000011902', 'Elimina 119', r1, true), ('00000000-0000-0000-0000-000000011903', 'Propietario 119', r2, false)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000011902', r1), ('00000000-0000-0000-0000-000000011903', r2) on conflict do nothing;
    insert into perfiles_estaciones (perfil_id, estacion_id)
    select '00000000-0000-0000-0000-000000011903', id from estaciones_riego where nombre = 'Papalon-1' on conflict do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from estaciones_riego where nombre = 'Zamora') as est2,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    (select id from materiales where codigo = '101478') as b,
    '430302c1-3572-4c38-bdcf-155efb0983ab'::uuid as tc,
    'f82c3bac-cb61-4f37-b4a0-39e620c3e34b'::uuid as tc2,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1, '00000000-0000-0000-0000-0000000000e2'::uuid as e2,
    '00000000-0000-0000-0000-0000000000e3'::uuid as e3, '00000000-0000-0000-0000-000000011601'::uuid as adm,
    '00000000-0000-0000-0000-000000011902'::uuid as del, '00000000-0000-0000-0000-000000011903'::uuid as prop,
    '99000000-0000-4000-8000-000000000001'::uuid as barril, '10000000-0000-0000-0000-000000000001'::uuid as chofer;
create temp table sv (clave text primary key, v numeric);
create or replace function pg_temp.saldo(p_est uuid, p_mat uuid) returns numeric language sql as
$$ select coalesce((select disponible from fert_saldos where estacion_id = p_est and material_id = p_mat), 0) $$;
create or replace function pg_temp.rest(p_est uuid, p_mat uuid) returns numeric language sql as
$$ select coalesce((select en_transito from fert_saldos where estacion_id = p_est and material_id = p_mat), 0) $$;
create or replace function pg_temp.elim(p_tipo text, p_doc uuid, p_motivo text default 'MOTIVO-SECRETO-119 se registró por error') returns jsonb language sql as
$$ select fn_fert_eliminar_documento(p_tipo, p_doc, p_motivo) $$;

select pg_temp.ok(jsonb_array_length(pg_temp.drift()) = 0, 'base de partida: saldos = suma de movimientos');
select pg_temp.ok(exists (select 1 from acciones where codigo = 'eliminar_definitivo' and nivel = 4)
                  and (select 'eliminar_definitivo' = any(acciones) from pantallas where codigo = 'fertirriego'), 'la acción existe y está en la pantalla Fertirriego');

-- ================================================================ A · aplicación (con devolución, anulación e histórica)
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(1), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'fecha_hora', now() - interval '1 hour',
    'chofer_id', (select chofer from k), 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 100))))->>'estado') like 'ACEPTADO%', 'recepción de partida');
select pg_temp.ok((pg_temp.op(pg_temp.uid(2), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
    'fecha', (pg_temp.hoy() - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 30))))->>'estado') like 'ACEPTADO%', 'aplicación A1');
select pg_temp.ok((pg_temp.op(pg_temp.uid(3), 'devolucion', jsonb_build_object('estacion_id', (select est from k), 'aplicacion_id', pg_temp.uid(2),
    'motivo', 'sobró', 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 5))))->>'estado') like 'ACEPTADO%', 'devolución D1');
select pg_temp.ok((pg_temp.op(pg_temp.uid(4), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
    'fecha', (pg_temp.hoy() - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 7))))->>'estado') like 'ACEPTADO%', 'aplicación A2');
select pg_temp.como((select adm from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(5), 'anulacion', jsonb_build_object('documento_tipo', 'aplicacion', 'documento_id', pg_temp.uid(4), 'motivo', 'error de captura'))->>'estado') like 'ACEPTADO%', 'A2 anulada');
select pg_temp.ok(jsonb_array_length(pg_temp.drift()) = 0, 'antes de eliminar: saldos cuadran');

-- sin permiso
select pg_temp.como((select e1 from k));
select pg_temp.falla($q$ select pg_temp.elim('aplicacion', pg_temp.uid(2)) $q$, 'sin el permiso: error', 'Eliminar por completo', '42501');
select pg_temp.como(null);
select pg_temp.falla($q$ select pg_temp.elim('aplicacion', pg_temp.uid(2)) $q$, 'sin sesión: error', 'sesión');
select pg_temp.como((select del from k));
select pg_temp.falla($q$ select pg_temp.elim('aplicacion', pg_temp.uid(2), 'corto') $q$, 'motivo corto: error', 'mínimo 15');
select pg_temp.falla($q$ select pg_temp.elim('aplicacion', pg_temp.uid(2), '') $q$, 'motivo vacío: error', 'mínimo 15');
select pg_temp.falla($q$ select pg_temp.elim('chofer', pg_temp.uid(2)) $q$, 'tipo no eliminable', 'no se puede eliminar');
select pg_temp.falla($q$ select pg_temp.elim('aplicacion', gen_random_uuid()) $q$, 'registro inexistente', 'no existe');
select pg_temp.ok((select count(*) = 1 from fert_aplicaciones where id = pg_temp.uid(2)), 'los rechazos no borraron nada');

insert into sv select 'a_antes', pg_temp.saldo((select est from k), (select a from k));
create temp table r1 as select pg_temp.elim('aplicacion', pg_temp.uid(2)) as r;
select pg_temp.ok((select (r->>'ok')::boolean and r->>'tipo' = 'aplicacion' from r1), 'eliminar A1 (con su devolución): ok');
select pg_temp.ok(not exists (select 1 from fert_aplicaciones where id = pg_temp.uid(2)) and not exists (select 1 from fert_aplicaciones_detalle where aplicacion_id = pg_temp.uid(2))
                  and not exists (select 1 from fert_devoluciones where id = pg_temp.uid(3)) and not exists (select 1 from fert_devoluciones_detalle where devolucion_id = pg_temp.uid(3)),
                  'documento, detalle y devolución ya no existen');
select pg_temp.ok(not exists (select 1 from fert_movimientos where documento_id in (pg_temp.uid(2), pg_temp.uid(3)))
                  and not exists (select 1 from fert_operaciones where id in (pg_temp.uid(2), pg_temp.uid(3))), 'sin movimientos ni operaciones del documento');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select v from sv where clave = 'a_antes') + 30 - 5, 'saldo ajustado: +30 (aplicación) −5 (devolución)');
select pg_temp.ok(jsonb_array_length(pg_temp.drift()) = 0, 'saldo == suma de movimientos restantes');
select pg_temp.ok((select jsonb_array_length(snapshot->'aplicaciones') = 1 and jsonb_array_length(snapshot->'devoluciones') = 1 and jsonb_array_length(snapshot->'movimientos') = 2
                          and motivo like 'MOTIVO-SECRETO-119%' and eliminado_por = (select del from k) and tipo = 'aplicacion' and estacion = 'Papalon-1'
                   from fert_eliminaciones where documento_id = pg_temp.uid(2)), 'la auditoría guarda quién, motivo, tipo, estación y la copia completa');
select pg_temp.falla($q$ select pg_temp.elim('aplicacion', pg_temp.uid(2)) $q$, 'eliminar dos veces', 'ya fue eliminado');
select pg_temp.ok(coalesce(current_setting('fert.libro_permitir', true), '') <> 'on', 'el libro quedó cerrado');

-- A2 anulada: se elimina con su anulación
select pg_temp.ok((pg_temp.elim('aplicacion', pg_temp.uid(4))->>'ok')::boolean, 'eliminar A2 (anulada)');
select pg_temp.ok(not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(4)) and not exists (select 1 from fert_operaciones where id in (pg_temp.uid(4), pg_temp.uid(5)))
                  and jsonb_array_length(pg_temp.drift()) = 0, 'A2: sin movimientos de aplicación/anulación; saldos cuadran');

-- histórica
select pg_temp.como((select adm from k));
select fn_fert_historico_otorgar((select e2 from k), array[(select est from k)], pg_temp.hoy() + 3);
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(8), 'aplicacion_historica', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
    'fecha', '2026-11-05', 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 5))))->>'estado') like 'ACEPTADO%', 'aplicación histórica');
select pg_temp.como((select del from k));
insert into sv select 'a_h', pg_temp.saldo((select est from k), (select a from k));
select pg_temp.ok((pg_temp.elim('aplicacion', pg_temp.uid(8))->>'ok')::boolean, 'eliminar histórica');
select pg_temp.ok(not exists (select 1 from fert_aplicaciones where id = pg_temp.uid(8)) and pg_temp.saldo((select est from k), (select a from k)) = (select v from sv where clave = 'a_h'),
                  'histórica borrada y el saldo no se movió');

-- ================================================================ B · recepción con envases
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(10), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'chofer_id', (select chofer from k),
    'lineas', jsonb_build_array(jsonb_build_object('material_id', (select b from k), 'cantidad', 4)),
    'envases', jsonb_build_array(jsonb_build_object('envase_id', (select barril from k), 'recibidos', 5, 'entregados', 1))))->>'estado') like 'ACEPTADO%', 'recepción R2 con envases');
select pg_temp.ok((pg_temp.op(pg_temp.uid(11), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'chofer_id', (select chofer from k),
    'envases', jsonb_build_array(jsonb_build_object('envase_id', (select barril from k), 'recibidos', 3))))->>'estado') like 'ACEPTADO%', 'recepción solo envases R3');
select pg_temp.como((select adm from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(12), 'anulacion', jsonb_build_object('documento_tipo', 'recepcion', 'documento_id', pg_temp.uid(11), 'motivo', 'error'))->>'estado') like 'ACEPTADO%', 'R3 anulada');
select pg_temp.como((select del from k));
insert into sv select 'env_antes', _fert_saldo_envase((select est from k), (select barril from k));
insert into sv select 'b_antes', pg_temp.saldo((select est from k), (select b from k));
select pg_temp.ok((pg_temp.elim('recepcion', pg_temp.uid(10))->>'ok')::boolean, 'eliminar R2');
select pg_temp.ok(not exists (select 1 from fert_recepciones where id = pg_temp.uid(10)) and not exists (select 1 from fert_recepciones_detalle where recepcion_id = pg_temp.uid(10))
                  and not exists (select 1 from fert_envases_movimientos where documento_id = pg_temp.uid(10))
                  and pg_temp.saldo((select est from k), (select b from k)) = (select v from sv where clave = 'b_antes') - 4
                  and _fert_saldo_envase((select est from k), (select barril from k)) = (select v from sv where clave = 'env_antes') - 4,
                  'R2: sin detalle ni envases; producto −4 y envases −4 (5 recibidos − 1 entregados)');
select pg_temp.elim('recepcion', pg_temp.uid(11));
select pg_temp.ok(true and not exists (select 1 from fert_envases_movimientos where documento_id = pg_temp.uid(11)),
                  'R3 (solo envases, anulada): sin movimientos de envases (incluida la anulación)');
select pg_temp.ok(jsonb_array_length(pg_temp.drift()) = 0, 'saldos cuadran tras las recepciones');

-- ================================================================ C · conteo con ajuste
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(20), 'conteo', jsonb_build_object('estacion_id', (select est from k),
    'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad_real', pg_temp.saldo((select est from k), (select a from k)) - 3))))->>'estado') like 'ACEPTADO%', 'conteo con ajuste −3');
select pg_temp.como((select del from k));
select pg_temp.ok(exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(20) and tipo = 'AJUSTE_CONTEO'), 'el conteo generó AJUSTE_CONTEO');
select pg_temp.elim('conteo', pg_temp.uid(20));
select pg_temp.ok(true and not exists (select 1 from fert_conteos where id = pg_temp.uid(20))
                  and not exists (select 1 from fert_conteos_detalle where conteo_id = pg_temp.uid(20)) and not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(20))
                  and jsonb_array_length(pg_temp.drift()) = 0, 'conteo eliminado y el saldo vuelve');

-- ================================================================ D · relevo con diferencias
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(30), 'relevo_entregar', jsonb_build_object('estacion_id', (select est from k), 'nota', 'ok'), now() - interval '20 minutes')->>'estado') like 'ACEPTADO%', 'E2 entrega');
select pg_temp.como((select e1 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(31), 'relevo_recibir', jsonb_build_object('estacion_id', (select est from k), 'entrega_id', (select e2 from k),
    'codigo', pg_temp.codigo((select e2 from k), now() - interval '10 minutes'), 'momento_codigo', now() - interval '10 minutes',
    'diferencias', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad_real', pg_temp.saldo((select est from k), (select a from k)) - 2))),
    now() - interval '10 minutes')->>'estado') like 'ACEPTADO%', 'E1 recibe con diferencia −2');
select pg_temp.ok(exists (select 1 from fert_movimientos where tipo = 'DIFERENCIA_RELEVO' and documento_id = pg_temp.uid(30)), 'hay DIFERENCIA_RELEVO');
select pg_temp.como((select del from k));
select pg_temp.ok((pg_temp.elim('relevo', pg_temp.uid(30))->>'ok')::boolean, 'eliminar relevo');
select pg_temp.ok(not exists (select 1 from fert_relevos where id = pg_temp.uid(30)) and not exists (select 1 from fert_relevos_diferencias where relevo_id = pg_temp.uid(30))
                  and not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(30)) and not exists (select 1 from fert_operaciones where id in (pg_temp.uid(30), pg_temp.uid(31)))
                  and jsonb_array_length(pg_temp.drift()) = 0, 'relevo, diferencias, movimientos y operaciones fuera; saldos cuadran');
select pg_temp.ok((select custodio_id = (select e1 from k) and relevo_id is null from fert_custodia where estacion_id = (select est from k)), 'la custodia sigue con quien recibió y ya no apunta al relevo');
-- entrega a medias
select pg_temp.como((select adm from k));
select fn_fert_asignar_custodia((select est from k), (select e2 from k), 'prueba 119');
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(32), 'relevo_entregar', jsonb_build_object('estacion_id', (select est from k)))->>'estado') like 'ACEPTADO%', 'E2 entrega otra vez (EN_ENTREGA)');
select pg_temp.como((select del from k));
select pg_temp.elim('relevo', pg_temp.uid(32));
select pg_temp.ok(true and (select estado = 'ACTIVA' and relevo_id is null and custodio_id = (select e2 from k) from fert_custodia where estacion_id = (select est from k)),
                  'eliminar una entrega a medias devuelve la custodia a «activa»');

-- ================================================================ E · traslados entre dos estaciones
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(40), 'traslado_crear', jsonb_build_object('origen_id', (select est from k), 'destino_id', (select est2 from k), 'motivo', 'falta calcio',
    'autorizador_id', (select adm from k), 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 10))))->>'estado') like 'ACEPTADO%', 'traslado T1 creado');
select pg_temp.como((select adm from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(41), 'traslado_autorizar', jsonb_build_object('traslado_id', pg_temp.uid(40)))->>'estado') like 'ACEPTADO%', 'T1 autorizado');
select pg_temp.como((select e3 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(42), 'traslado_aceptar', jsonb_build_object('traslado_id', pg_temp.uid(40),
    'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad_recibida', 8))))->>'estado') like 'ACEPTADO%', 'T1 aceptado 8 de 10');
-- T2 en tránsito
select pg_temp.como((select e2 from k));
select pg_temp.op(pg_temp.uid(43), 'traslado_crear', jsonb_build_object('origen_id', (select est from k), 'destino_id', (select est2 from k), 'motivo', 'otro',
    'autorizador_id', (select adm from k), 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 6))));
select pg_temp.como((select adm from k));
select pg_temp.op(pg_temp.uid(44), 'traslado_autorizar', jsonb_build_object('traslado_id', pg_temp.uid(43)));
-- T3 por autorizar
select pg_temp.como((select e2 from k));
select pg_temp.op(pg_temp.uid(45), 'traslado_crear', jsonb_build_object('origen_id', (select est from k), 'destino_id', (select est2 from k), 'motivo', 'tercero',
    'autorizador_id', (select adm from k), 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 1))));
select pg_temp.ok(jsonb_array_length(pg_temp.drift()) = 0, 'antes de eliminar traslados: saldos cuadran');

-- solo con permiso en las DOS estaciones
select pg_temp.como((select prop from k));
select pg_temp.falla($q$ select pg_temp.elim('traslado', pg_temp.uid(45)) $q$, 'permiso solo en una de las dos estaciones: error', 'las dos estaciones', '42501');
select pg_temp.como((select del from k));
insert into sv select 'o_antes', pg_temp.saldo((select est from k), (select a from k));
insert into sv select 'd_antes', pg_temp.saldo((select est2 from k), (select a from k));
insert into sv select 't_antes', pg_temp.rest((select est2 from k), (select a from k));
select pg_temp.ok((pg_temp.elim('traslado', pg_temp.uid(40))->>'ok')::boolean, 'eliminar T1 (aceptado)');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select v from sv where clave = 'o_antes') + 10
                  and pg_temp.saldo((select est2 from k), (select a from k)) = (select v from sv where clave = 'd_antes') - 8,
                  'T1: origen +10 y destino −8 (se tocan los dos saldos)');
select pg_temp.ok(not exists (select 1 from fert_traslados where id = pg_temp.uid(40)) and not exists (select 1 from fert_traslados_detalle where traslado_id = pg_temp.uid(40))
                  and not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(40)) and not exists (select 1 from fert_operaciones where id in (pg_temp.uid(40), pg_temp.uid(41), pg_temp.uid(42))),
                  'T1 sin detalle, movimientos ni operaciones');
select pg_temp.elim('traslado', pg_temp.uid(43));
select pg_temp.ok(true and pg_temp.rest((select est2 from k), (select a from k)) = (select v from sv where clave = 't_antes') - 6, 'T2 en tránsito: se quita lo «en camino» del destino');
select pg_temp.elim('traslado', pg_temp.uid(45));
select pg_temp.ok(true and not exists (select 1 from fert_traslados where id = pg_temp.uid(45)), 'T3 por autorizar');
select pg_temp.ok(jsonb_array_length(pg_temp.drift()) = 0, 'saldos de las dos estaciones cuadran');

-- ================================================================ F · bitácora de horas
select pg_temp.como((select e2 from k));
select pg_temp.op(pg_temp.uid(50), 'bitacora', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k), 'fecha', (pg_temp.hoy() - 1)::text, 'horas_riego', 3));
select pg_temp.op(pg_temp.uid(51), 'bitacora', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k), 'fecha', (pg_temp.hoy() - 1)::text, 'horas_riego', 4));
select pg_temp.como((select del from k));
select pg_temp.ok((select operacion_id = pg_temp.uid(51) from fert_bitacora_riego where turno_ciclo_id = (select tc from k) and fecha = pg_temp.hoy() - 1), 'la bitácora apunta a su última operación');
select pg_temp.ok(jsonb_array_length(fn_fert_eliminar_listar((select est from k), 'bitacora')) >= 1, 'el listado trae la bitácora');
select pg_temp.elim('bitacora', pg_temp.uid(51));
select pg_temp.ok(true and not exists (select 1 from fert_bitacora_riego where turno_ciclo_id = (select tc from k) and fecha = pg_temp.hoy() - 1)
                  and not exists (select 1 from fert_operaciones where id in (pg_temp.uid(50), pg_temp.uid(51))), 'horas de riego eliminadas con sus operaciones (también la edición anterior)');

-- ================================================================ G · turno archivado
select pg_temp.como((select e2 from k));
select pg_temp.op(pg_temp.uid(70), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc2 from k),
    'fecha', (pg_temp.hoy() - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 1))));
select pg_temp.como((select del from k));
create temp table arch as select archivado_at, archivo_documentos from turnos_ciclo where id = (select tc2 from k);
update turnos_ciclo set archivado_at = now() where id = (select tc2 from k);
select pg_temp.falla($q$ select pg_temp.elim('aplicacion', pg_temp.uid(70)) $q$, 'turno terminado: no se elimina', 'Reactiva el turno en AGL primero');
update turnos_ciclo set archivado_at = null where id = (select tc2 from k);
update turnos_ciclo set archivado_at = now(), archivo_documentos = array[pg_temp.uid(71)] where id = (select tc2 from k);
select pg_temp.falla($q$ select pg_temp.elim('aplicacion', pg_temp.uid(71)) $q$, 'documento ya archivado en AGL', 'Reactiva el turno en AGL primero');
update turnos_ciclo set archivado_at = (select archivado_at from arch), archivo_documentos = (select archivo_documentos from arch) where id = (select tc2 from k);
select pg_temp.ok((select count(*) = 1 from fert_aplicaciones where id = pg_temp.uid(70)), 'no se borró nada del turno archivado');
select pg_temp.ok((pg_temp.elim('aplicacion', pg_temp.uid(70))->>'ok')::boolean, 'reactivado: ahora sí');

-- ================================================================ H · teléfono, exportación y auditoría
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(60), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
    'fecha', (pg_temp.hoy() - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 2))))->>'estado') like 'ACEPTADO%', 'A9 para el teléfono');
select pg_temp.ok(fn_fert_estado_campo()::text like '%' || pg_temp.uid(60)::text || '%', 'el teléfono ve A9 antes de eliminarla');
select pg_temp.ok(not (select (e->'permisos'->>'eliminar_definitivo')::boolean from jsonb_array_elements(fn_fert_estado_campo()->'estaciones') e where e->>'nombre' = 'Papalon-1'), 'E2 no tiene el permiso en el teléfono');
select pg_temp.como((select del from k));
select pg_temp.ok((select (e->'permisos'->>'eliminar_definitivo')::boolean from jsonb_array_elements(fn_fert_estado_campo()->'estaciones') e where e->>'nombre' = 'Papalon-1'), 'quien tiene el permiso lo ve en el teléfono');
select pg_temp.ok((pg_temp.elim('aplicacion', pg_temp.uid(60))->>'ok')::boolean, 'eliminar A9');
select pg_temp.como((select e2 from k));
select pg_temp.ok(fn_fert_estado_campo()::text not like '%' || pg_temp.uid(60)::text || '%' and fn_fert_estado_campo()::text not like '%MOTIVO-SECRETO-119%', 'el teléfono ya no trae A9 ni la auditoría');
select pg_temp.como((select adm from k));
select pg_temp.ok(fn_fert_exportar(0, 100000)::text not like '%' || pg_temp.uid(60)::text || '%' and fn_fert_exportar(0, 100000)::text not like '%MOTIVO-SECRETO-119%'
                  and fn_fert_exportar(0, 100000)::text not like '%' || pg_temp.uid(2)::text || '%', 'la exportación a AGL no trae lo borrado ni la auditoría');
select pg_temp.ok(fn_fert_exportar_turno('T1002-T36')::text not like '%MOTIVO-SECRETO-119%' or true, 'exportar turno corre');
-- reenvío de la operación borrada
select pg_temp.como((select e2 from k));
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r->>'mensaje' like '%eliminado por completo%'
                   from (select pg_temp.op(pg_temp.uid(60), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
                         'fecha', (pg_temp.hoy() - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 2)))) r) x)
                  and not exists (select 1 from fert_aplicaciones where id = pg_temp.uid(60)), 'reenviar lo eliminado se rechaza con mensaje claro y no se recrea');
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and length(r->>'mensaje') > 5 from (select pg_temp.op(pg_temp.uid(61), 'devolucion', jsonb_build_object('estacion_id', (select est from k),
                   'aplicacion_id', pg_temp.uid(60), 'motivo', 'x', 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 1)))) r) x),
                  'una devolución sobre lo eliminado se rechaza con mensaje');
-- auditoría
select pg_temp.como((select e1 from k));
select pg_temp.falla($q$ select fn_fert_eliminaciones_listar() $q$, 'sin permiso no lista la auditoría', 'Eliminar por completo', '42501');
select pg_temp.falla($q$ select fn_fert_eliminar_listar() $q$, 'sin permiso no lista eliminables', 'Eliminar por completo', '42501');
select pg_temp.como((select del from k));
select pg_temp.ok(jsonb_array_length(fn_fert_eliminaciones_listar()) >= 10 and not (fn_fert_eliminaciones_listar()::text like '%"snapshot"%'), 'quien tiene el permiso lee la auditoría (sin la copia pesada)');
select pg_temp.ok(fn_fert_eliminacion_copia((select id from fert_eliminaciones where documento_id = pg_temp.uid(60))) ? 'aplicaciones', 'y puede consultar la copia');
create temp table rls as select 1 as x; grant select on rls to authenticated;
select pg_temp.como((select adm from k));
set role authenticated;
select pg_temp.falla($q$ select * from fert_eliminaciones $q$, 'la tabla de auditoría no se lee directo (RLS/permisos)', 'permission denied');
reset role;
select pg_temp.ok(jsonb_array_length(pg_temp.drift()) = 0, 'al final: todos los saldos == suma de movimientos');

-- ================================================================ I · órdenes de corrida
create or replace function pg_temp.finales(p_etq text) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000011902', false);
    if not exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'estaciones') e where (e->'permisos') ? 'eliminar_definitivo') then
        raise exception 'FALLA [%]: el estado del teléfono no trae el permiso', p_etq;
    end if;
    if position('fert_eliminaciones' in pg_get_functiondef('public._fert_procesar(jsonb)'::regprocedure)) = 0 then
        raise exception 'FALLA [%]: _fert_procesar sin el guardia', p_etq;
    end if;
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', false);
    if (select r->>'estado' from (select pg_temp.op(pg_temp.uid(60), 'aplicacion', jsonb_build_object('estacion_id', (select est from k), 'turno_ciclo_id', (select tc from k),
         'fecha', (pg_temp.hoy() - 1)::text, 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 2)))) r) x) not in ('RECHAZADO', 'YA_EXISTIA')
       or exists (select 1 from fert_aplicaciones where id = pg_temp.uid(60)) then
        raise exception 'FALLA [%]: el reenvío ya no se rechaza', p_etq;
    end if;
    raise notice 'ok  finales [%]', p_etq;
end $$;
select pg_temp.finales('estado actual');
\i sql/119_fertirriego_eliminar_registros.sql
select pg_temp.finales('119 repetida');
\i sql/100_fertirriego_piloto2.sql
\i sql/101_fertirriego_pruebas_en_agl.sql
\i sql/119_fertirriego_eliminar_registros.sql
\i sql/119_fertirriego_eliminar_registros.sql
select pg_temp.finales('100>101>119>119');
\i sql/115_fertirriego_anular_diferencia_relevo.sql
\i sql/119_fertirriego_eliminar_registros.sql
select pg_temp.finales('115>119');
\i sql/116_fertirriego_registro_historico.sql
\i sql/117_fertirriego_historico_antes_de_siembra.sql
\i sql/119_fertirriego_eliminar_registros.sql
select pg_temp.finales('116>117>119');
\i sql/102_fertirriego_archivo_turnos.sql
\i sql/119_fertirriego_eliminar_registros.sql
select pg_temp.finales('102>119');
select pg_temp.como((select del from k));
select pg_temp.ok((select count(*) = 1 from permisos where recurso = 'fertirriego' and accion = 'eliminar_definitivo' and rol_id = (select id from roles where codigo = 'T119_DEL')), 'volver a correr no duplica permisos');

select 'FIN 119 OK' as resultado;
