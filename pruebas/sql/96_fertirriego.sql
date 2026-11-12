-- PRUEBAS de sql/96 (réplica local, después de 91..95 y sus pruebas): relevo, traslados y exportación a AGL.
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
/** El código que mostraría el teléfono de una persona en un momento. */
create or replace function pg_temp.codigo(p_perfil uuid, p_momento timestamptz) returns text language sql as $$
    select fn_fert_totp((select secreto from fert_llaves where perfil_id = p_perfil), floor(extract(epoch from p_momento) / 30)::bigint)
$$;
/** Un registro del teléfono. */
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_creado timestamptz default now(),
                                      p_inmediato boolean default true) returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', p_creado, 'enviado_en', now(), 'inmediato', p_inmediato,
        'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
set client_min_messages = notice;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from estaciones_riego where nombre = 'Zamora') as est2,
    (select id from materiales where codigo = 'QA-SOLCA') as solca,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1, '00000000-0000-0000-0000-0000000000e2'::uuid as e2,
    '00000000-0000-0000-0000-0000000000e3'::uuid as e3, '00000000-0000-0000-0000-00000000000a'::uuid as jefe,
    (select p.id from perfiles p join roles r on r.id = p.rol_id where r.acceso_total limit 1) as admin;

-- Permisos de prueba: estacioneros trasladan; el jefe autoriza
insert into permisos (rol_id, recurso, accion, alcance)
select r.id, 'fertirriego', 'trasladar', 'propietario' from roles r where r.codigo = 'T_EST'
on conflict (rol_id, recurso, accion) do update set permitido = true;
insert into permisos (rol_id, recurso, accion, alcance)
select r.id, 'fertirriego', 'autorizar_traslado', 'zonal' from roles r where r.codigo = 'T_JEFE'
on conflict (rol_id, recurso, accion) do update set permitido = true;

-- La historia de las pruebas anteriores pasa a «hace 3 horas»: estas pruebas usan horas de los últimos 20 minutos
update fert_relevos set entregado_at = entregado_at - interval '3 hours', recibido_at = recibido_at - interval '3 hours';
update fert_custodia set desde = desde - interval '3 hours';

-- Arranque: E1 con Papalon-1 (desde hace 1 h)
select pg_temp.como((select jefe from k));
select fn_fert_asignar_custodia((select est from k), (select e1 from k), 'Prueba 96');
update fert_custodia set desde = now() - interval '1 hour' where estacion_id = (select est from k);
update fert_relevos set recibido_at = now() - interval '1 hour', entregado_at = now() - interval '1 hour'
 where estacion_id = (select est from k) and estado = 'ASIGNADO' and motivo = 'Prueba 96';

-- =====================================================================
-- RELEVO
-- =====================================================================
select pg_temp.como((select e1 from k));
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000001', 'relevo_entregar', jsonb_build_object(
        'estacion_id', (select est from k), 'nota', 'Todo en orden',
        'novedades', jsonb_build_array(jsonb_build_object('turno_ciclo_id', (select id from turnos_ciclo where agl_id = 'TR-QA-1'),
                                                          'estado', 'EN_APLICACION', 'nota', 'Va por la mitad'))),
        now() - interval '20 minutes'))->>'estado' = 'ACEPTADO', 'E1 entrega la estación con su bitácora de novedades');
select pg_temp.ok((select estado = 'EN_ENTREGA' from fert_custodia where estacion_id = (select est from k)), 'la estación queda «en entrega»');
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000002', 'conteo', jsonb_build_object('estacion_id', (select est from k),
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select solca from k), 'cantidad_real', 1)))))->>'estado'
    = 'RECHAZADO', 'quien entregó queda bloqueado (ya no registra)');

select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000003', 'relevo_recibir', jsonb_build_object(
        'estacion_id', (select est from k), 'entrega_id', (select e1 from k), 'codigo', '000000',
        'momento_codigo', now() - interval '10 minutes'), now() - interval '10 minutes'))->>'estado'
    = 'RECHAZADO', 'código equivocado: rechazado, nunca pasa');
select pg_temp.ok((select estado = 'EN_ENTREGA' from fert_custodia where estacion_id = (select est from k)), 'con código malo la estación no cambia de manos');

select pg_temp.ok((r->>'estado') = 'ACEPTADO_CON_OBSERVACIONES' and (r->'observaciones') ? 'DIFERENCIA_RELEVO',
                  'código correcto + una diferencia declarada: recibida y marcada para revisar')
from (select pg_temp.op('96000000-0000-0000-0000-000000000004', 'relevo_recibir', jsonb_build_object(
        'estacion_id', (select est from k), 'entrega_id', (select e1 from k),
        'codigo', pg_temp.codigo((select e1 from k), now() - interval '10 minutes'),
        'momento_codigo', now() - interval '10 minutes', 'nota', 'Faltan 3 L',
        'diferencias', jsonb_build_array(jsonb_build_object('material_id', (select solca from k),
                         'cantidad_real', (select disponible - 3 from fert_saldos where estacion_id = (select est from k) and material_id = (select solca from k))))),
        now() - interval '10 minutes') as r) x;
select pg_temp.ok((select estado = 'RECIBIDO' and recibe_id = (select e2 from k) and revisar and codigo_verificado
                   from fert_relevos where id = '96000000-0000-0000-0000-000000000001'),
                  'el relevo queda RECIBIDO por E2, con código verificado y para revisar');
select pg_temp.ok((select custodio_id = (select e2 from k) and estado = 'ACTIVA' from fert_custodia where estacion_id = (select est from k)),
                  'la estación pasa a E2');
select pg_temp.ok((select m.cantidad = d.diferencia and d.cantidad_real = d.saldo_sistema + d.diferencia and d.diferencia <> 0
                   from fert_movimientos m join fert_relevos_diferencias d on d.relevo_id = m.documento_id and d.material_id = m.material_id
                   where m.tipo = 'DIFERENCIA_RELEVO' and m.documento_id = '96000000-0000-0000-0000-000000000001'),
                  'la diferencia queda como movimiento DIFERENCIA_RELEVO (no se ajusta en silencio)');
select pg_temp.ok((select (datos ? 'codigo') = false from fert_operaciones where id = '96000000-0000-0000-0000-000000000004'),
                  'el código no se guarda');

-- Orden inverso: E1 recibe (código de E2) ANTES de que llegue el «entregar» de E2
select pg_temp.como((select e1 from k));
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000005', 'relevo_recibir', jsonb_build_object(
        'estacion_id', (select est from k), 'entrega_id', (select e2 from k),
        'codigo', pg_temp.codigo((select e2 from k), now() - interval '4 minutes'), 'momento_codigo', now() - interval '4 minutes'),
        now() - interval '4 minutes', false))->>'estado' = 'ACEPTADO', 'sin señal: el que recibe envía primero (se acepta)');
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000006', 'relevo_entregar', jsonb_build_object(
        'estacion_id', (select est from k), 'nota', 'Entrego noche',
        'novedades', jsonb_build_array(jsonb_build_object('estado', 'PREPARADO', 'nota', 'T37 en tanques'))),
        now() - interval '5 minutes', false))->>'estado' = 'ACEPTADO', 'después llega el «entregar» de E2');
select pg_temp.ok((select count(*) = 1 from fert_relevos where estacion_id = (select est from k) and entrega_id = (select e2 from k)
                   and recibe_id = (select e1 from k) and entrega_registrada and novedades->0->>'nota' = 'T37 en tanques'),
                  'los dos registros se juntan en UN relevo con sus novedades');
select pg_temp.ok((select custodio_id = (select e1 from k) from fert_custodia where estacion_id = (select est from k)), 'E1 tiene la estación');

-- Cancelar la entrega
select pg_temp.como((select e1 from k));
select pg_temp.op('96000000-0000-0000-0000-000000000007', 'relevo_entregar', jsonb_build_object('estacion_id', (select est from k)));
create temp table r_1 as select pg_temp.op('96000000-0000-0000-0000-000000000008', 'relevo_cancelar',
        jsonb_build_object('relevo_id', '96000000-0000-0000-0000-000000000007', 'motivo', 'Nadie llegó'))->>'estado' as estado;
select pg_temp.ok((select estado = 'ACEPTADO' from r_1) and (select estado = 'ACTIVA' and custodio_id = (select e1 from k) from fert_custodia where estacion_id = (select est from k)),
    'cancelar la entrega devuelve la estación a quien la tenía');

-- Rechazar la entrega
select pg_temp.op('96000000-0000-0000-0000-000000000009', 'relevo_entregar', jsonb_build_object('estacion_id', (select est from k)));
select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000010', 'relevo_rechazar',
        jsonb_build_object('relevo_id', '96000000-0000-0000-0000-000000000009')))->>'estado' = 'RECHAZADO',
    'rechazar sin motivo: no se puede');
create temp table r_2 as select pg_temp.op('96000000-0000-0000-0000-000000000011', 'relevo_rechazar',
        jsonb_build_object('relevo_id', '96000000-0000-0000-0000-000000000009', 'motivo', 'Faltan productos'))->>'estado' as estado;
select pg_temp.ok((select estado = 'ACEPTADO' from r_2) and (select estado = 'ACTIVA' and custodio_id = (select e1 from k) from fert_custodia where estacion_id = (select est from k)),
    'rechazar con motivo: la estación sigue con E1 y el relevo queda para revisar');

-- Con sesión en el mismo teléfono (con señal)
select pg_temp.como((select e1 from k));
select pg_temp.op('96000000-0000-0000-0000-000000000012', 'relevo_entregar', jsonb_build_object('estacion_id', (select est from k)));
select pg_temp.como((select e2 from k));
create temp table r_3 as select pg_temp.op('96000000-0000-0000-0000-000000000013', 'relevo_recibir', jsonb_build_object(
        'estacion_id', (select est from k), 'entrega_id', (select e1 from k), 'metodo', 'SESION'))->>'estado' as estado;
select pg_temp.ok((select estado = 'ACEPTADO' from r_3) and (select custodio_id = (select e2 from k) from fert_custodia where estacion_id = (select est from k)),
    'recibir con sesión en el mismo teléfono');

-- =====================================================================
-- TRASLADOS (E2 tiene Papalon-1; E3 tendrá Zamora)
-- =====================================================================
select pg_temp.como((select admin from k));
select fn_fert_asignar_custodia((select est2 from k), (select e3 from k), 'Prueba 96 traslados');

select pg_temp.como((select e2 from k));
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000020', 'traslado_crear', jsonb_build_object(
        'origen_id', (select est from k), 'destino_id', (select est2 from k), 'motivo', 'Zamora se quedó sin calcio',
        'autorizador_id', (select e2 from k),
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select solca from k), 'cantidad', 10)))))->>'estado' = 'RECHAZADO',
    'no se puede autorizar uno mismo su traslado');
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000021', 'traslado_crear', jsonb_build_object(
        'origen_id', (select est from k), 'destino_id', (select est2 from k), 'motivo', 'Zamora se quedó sin calcio',
        'autorizador_id', (select jefe from k),
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select solca from k), 'cantidad', 10)))))->>'estado' = 'ACEPTADO',
    'crear traslado con motivo y quién autoriza → por autorizar');
create temp table s0 as select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select solca from k);
select pg_temp.ok((select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select solca from k)) = (select disponible from s0),
                  'sin autorizar, la bodega de origen no se mueve');
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000022', 'traslado_autorizar',
        jsonb_build_object('traslado_id', '96000000-0000-0000-0000-000000000021')))->>'estado' = 'RECHAZADO', 'quien lo creó no lo autoriza');

select pg_temp.como((select jefe from k));
select pg_temp.ok((pg_temp.op('96000000-0000-0000-0000-000000000023', 'traslado_autorizar',
        jsonb_build_object('traslado_id', '96000000-0000-0000-0000-000000000021', 'nota', 'Ok')))->>'estado' = 'ACEPTADO',
    'el jefe lo autoriza en su teléfono');
select pg_temp.ok((select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select solca from k)) = (select disponible - 10 from s0)
                  and (select en_transito = 10 from fert_saldos where estacion_id = (select est2 from k) and material_id = (select solca from k)),
                  'autorizado: sale del origen y queda «en camino» al destino');

select pg_temp.como((select e3 from k));
select pg_temp.ok((r->>'estado') = 'ACEPTADO_CON_OBSERVACIONES' and (r->'observaciones') ? 'DIFERENCIA_TRASLADO',
                  'el destino acepta 8 de 10: aceptado y la diferencia queda marcada')
from (select pg_temp.op('96000000-0000-0000-0000-000000000024', 'traslado_aceptar', jsonb_build_object(
        'traslado_id', '96000000-0000-0000-0000-000000000021',
        'lineas', jsonb_build_array(jsonb_build_object('material_id', (select solca from k), 'cantidad_recibida', 8)))) as r) x;
select pg_temp.ok((select disponible = 8 and en_transito = 0 from fert_saldos where estacion_id = (select est2 from k) and material_id = (select solca from k)),
                  'el destino suma lo que de verdad llegó');

-- Rechazado: vuelve al origen
select pg_temp.como((select e2 from k));
select pg_temp.op('96000000-0000-0000-0000-000000000025', 'traslado_crear', jsonb_build_object(
        'origen_id', (select est from k), 'destino_id', (select est2 from k), 'motivo', 'Prueba rechazo',
        'autorizador_id', (select jefe from k), 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select solca from k), 'cantidad', 5))));
select pg_temp.como((select jefe from k));
select pg_temp.op('96000000-0000-0000-0000-000000000026', 'traslado_autorizar', jsonb_build_object('traslado_id', '96000000-0000-0000-0000-000000000025'));
select pg_temp.como((select e3 from k));
create temp table r_4 as select pg_temp.op('96000000-0000-0000-0000-000000000027', 'traslado_rechazar', jsonb_build_object(
        'traslado_id', '96000000-0000-0000-0000-000000000025', 'nota', 'No lo pedimos'))->>'estado' as estado;
select pg_temp.ok((select estado = 'ACEPTADO' from r_4) and (select disponible from fert_saldos where estacion_id = (select est from k) and material_id = (select solca from k)) = (select disponible - 10 from s0),
    'rechazado en destino: vuelve completo a la bodega de origen');

-- Cancelar antes de autorizar
select pg_temp.como((select e2 from k));
select pg_temp.op('96000000-0000-0000-0000-000000000028', 'traslado_crear', jsonb_build_object(
        'origen_id', (select est from k), 'destino_id', (select est2 from k), 'motivo', 'Me equivoqué',
        'autorizador_id', (select jefe from k), 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select solca from k), 'cantidad', 1))));
create temp table r_5 as select pg_temp.op('96000000-0000-0000-0000-000000000029', 'traslado_cancelar',
        jsonb_build_object('traslado_id', '96000000-0000-0000-0000-000000000028'))->>'estado' as estado;
select pg_temp.ok((select estado = 'ACEPTADO' from r_5) and (select estado = 'ANULADO' from fert_traslados where id = '96000000-0000-0000-0000-000000000028'),
    'quien lo creó lo cancela antes de que lo autoricen');

-- =====================================================================
-- LO QUE BAJA EL TELÉFONO Y LO QUE BAJA AGL
-- =====================================================================
select pg_temp.ok((select jsonb_array_length(r->'relevos') > 0 and jsonb_array_length(r->'traslados') >= 3
                          and jsonb_array_length(r->'destinos') > 1
                          and jsonb_array_length(r->'estaciones'->0->'autorizadores') > 0
                   from (select fn_fert_estado_campo() r) x), 'el teléfono baja relevos, traslados, destinos y autorizadores');
select pg_temp.como((select jefe from k));
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(fn_fert_estado_campo()->'traslados') t where t->>'autorizador_id' = (select jefe::text from k))),
                  'el jefe ve los traslados que le toca autorizar');

select pg_temp.como('00000000-0000-0000-0000-00000000000b');   -- usuario AGL
select pg_temp.ok((select (r->>'ultimo_cursor')::bigint > 0 and jsonb_array_length(r->'movimientos') > 0
                          and exists (select 1 from jsonb_array_elements(r->'movimientos') m where m->>'turno_agl_id' = 'TR-QA-1' and m->>'tipo' = 'APLICACION')
                   from (select fn_fert_exportar(0, 5000) r) x), 'AGL baja los movimientos con su turno de AGL');
select pg_temp.ok((select jsonb_array_length(fn_fert_exportar((fn_fert_exportar(0, 5000)->>'ultimo_cursor')::bigint, 5000)->'movimientos') = 0),
                  'pedir desde el último cursor no repite nada');
select pg_temp.ok((select (fn_fert_exportar(0, 2)->>'hay_mas')::boolean), 'por tandas: avisa que hay más');
select pg_temp.como((select e1 from k));
do $$ begin
    perform fn_fert_exportar(0, 10);
    raise exception 'FALLA: un estacionero pudo exportar';
exception when insufficient_privilege then raise notice 'ok  solo el usuario de AGL exporta';
end $$;

select pg_temp.como(null);
select 'TODAS LAS PRUEBAS OK' as resultado;
