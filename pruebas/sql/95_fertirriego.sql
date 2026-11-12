-- PRUEBAS de sql/95 (réplica local, después de 91 + sus pruebas). La custodia se mira al REGISTRAR.
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
set client_min_messages = notice;

-- E2 recibe la estación AHORA (el jefe se la asigna)
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select fn_fert_asignar_custodia((select id from estaciones_riego where nombre = 'Papalon-1'), '00000000-0000-0000-0000-0000000000e2', 'Prueba 95');

-- E2 registra una entrega que LLEGÓ hace una hora (antes de su jornada): se acepta, la registra él
select pg_temp.como('00000000-0000-0000-0000-0000000000e2');
select pg_temp.ok((public.fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', '95000000-0000-0000-0000-000000000001', 'tipo', 'recepcion', 'creado_en', now(), 'enviado_en', now(),
        'inmediato', true, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2),
        'datos', jsonb_build_object('estacion_id', (select id from estaciones_riego where nombre = 'Papalon-1'),
            'fecha_hora', now() - interval '1 hour', 'chofer_id', '10000000-0000-0000-0000-000000000001',
            'lineas', jsonb_build_array(jsonb_build_object('material_id', (select id from materiales where codigo = 'QA-SOLCA'), 'cantidad', 10)))))))->0->>'estado'
    = 'ACEPTADO', 'una entrega que llegó antes de su jornada la registra quien tiene la estación ahora');
select pg_temp.ok((select fecha_hora < now() - interval '50 minutes' from fert_recepciones where id = '95000000-0000-0000-0000-000000000001'),
                  'la hora del hecho se conserva tal como se escribió');

-- Y la puede anular (es suya y la registró en su jornada, aunque el hecho sea anterior)
select pg_temp.ok((public.fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', '95000000-0000-0000-0000-000000000002', 'tipo', 'anulacion', 'creado_en', now(), 'enviado_en', now(),
        'inmediato', true, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2),
        'datos', jsonb_build_object('documento_tipo', 'recepcion', 'documento_id', '95000000-0000-0000-0000-000000000001', 'motivo', 'Prueba')))))->0->>'estado'
    = 'ACEPTADO', 'anula lo suyo de su jornada aunque el hecho sea anterior');

-- E1 ya NO tiene la estación: con señal, se rechaza
select pg_temp.como('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok((public.fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', '95000000-0000-0000-0000-000000000003', 'tipo', 'conteo', 'creado_en', now(), 'enviado_en', now(),
        'inmediato', true, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2),
        'datos', jsonb_build_object('estacion_id', (select id from estaciones_riego where nombre = 'Papalon-1'),
            'lineas', jsonb_build_array(jsonb_build_object('material_id', (select id from materiales where codigo = 'QA-SOLCA'), 'cantidad_real', 1)))))))->0->>'estado'
    = 'RECHAZADO', 'quien entregó la estación ya no registra en ella');

select pg_temp.como(null);
select 'TODAS LAS PRUEBAS OK' as resultado;
