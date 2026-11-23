-- =====================================================================
-- PRUEBAS de sql/131 · devolución a bodega con todo el detalle (chofer, vehículo, destino, saldos, anulación)
-- Réplica local con 91–129 y los datos de prueba de 96/99/115 (E1/E2, Papalon-1, QA-SOLCA). Independiente de la prueba 128.
-- Correr DESDE LA RAÍZ DEL REPO (usa \i) con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/131_devolucion_detalle.sql
-- Al final repite la 131 y la corre en los órdenes 128>131, 129>131 y 116>128>131.
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
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', now() - make_interval(days => p_dias_atras), 'enviado_en', now(),
        'inmediato', p_dias_atras = 0, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('131a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.saldo(p_est uuid, p_mat uuid) returns numeric language sql as $$
    select coalesce((select disponible from fert_saldos where estacion_id = p_est and material_id = p_mat), 0) $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
\i sql/131_devolucion_bodega_detalle.sql
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T131_ADM', 'P131 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T131_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000013101', 'adm@131') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000013101', 'Admin 131', r, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000013101', r) on conflict do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    (select id from materiales where codigo = '101478') as b,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000013101'::uuid as adm,
    '10000000-0000-0000-0000-000000000001'::uuid as chofer,
    '131c0000-0000-4000-8000-000000000001'::uuid as veh,
    '131c0000-0000-4000-8000-000000000002'::uuid as chofer2;

create or replace function pg_temp.dev(p_id uuid, p_destino text, p_motivo text, p_lineas jsonb, p_extra jsonb default null, p_dias_atras integer default 0) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'devolucion_bodega', jsonb_build_object('estacion_id', (select est from k), 'destino', p_destino,
        'motivo', p_motivo, 'lineas', p_lineas) || coalesce(p_extra, '{}'::jsonb), p_dias_atras)
$$;
create or replace function pg_temp.completo() returns jsonb language sql as $$
    select jsonb_build_object('chofer_id', (select chofer from k), 'vehiculo_id', (select veh from k) ) $$;
create or replace function pg_temp.l(p_mat uuid, p_cant numeric) returns jsonb language sql as $$
    select jsonb_build_object('material_id', p_mat, 'cantidad', p_cant) $$;

-- ---------------------------------------------------------------- 0 · columnas y catálogos
select pg_temp.ok((select count(*) = 5 from information_schema.columns where table_name = 'fert_devoluciones_bodega'
                    and column_name in ('chofer_id', 'vehiculo_id', 'chofer_nombre', 'vehiculo_placa', 'vehiculo_tipo')),
                  'la tabla tiene chofer, vehículo y sus copias');
select pg_temp.como((select e1 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(1), 'vehiculo', jsonb_build_object('vehiculo_id', (select veh from k), 'placa', 'TRC131', 'tipo', 'Tractor'))->>'estado') like 'ACEPTADO%',
                  'vehículo de prueba creado');
select pg_temp.ok((pg_temp.op(pg_temp.uid(2), 'chofer', jsonb_build_object('chofer_id', (select chofer2 from k), 'nombre', 'Juan Pérez 131'))->>'estado') like 'ACEPTADO%',
                  'chofer de prueba creado');

-- ---------------------------------------------------------------- 1 · saldo y custodia
select pg_temp.como((select adm from k));
do $$
declare v_est uuid := (select est from k);
begin
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 131');
    end if;
    update fert_custodia set desde = now() - interval '2 hours' where estacion_id = v_est;
end $$;
select pg_temp.como((select e1 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(3), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'chofer_id', (select chofer from k),
        'fecha_hora', now() - interval '1 hour', 'lineas', jsonb_build_array(pg_temp.l((select a from k), 100), pg_temp.l((select b from k), 10))))->>'estado') like 'ACEPTADO%',
        'recepción de partida');
create temp table s0 as select pg_temp.saldo((select est from k), (select a from k)) as a;

-- ---------------------------------------------------------------- 2 · rechazos por falta de detalle
create temp table r1 as select pg_temp.dev(pg_temp.uid(11), 'TALLER', 'Reparación', jsonb_build_array(pg_temp.l((select a from k), 5))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%quién retiró%' from r1), 'sin chofer: rechazada');
create temp table r2 as select pg_temp.dev(pg_temp.uid(12), 'TALLER', 'Reparación', jsonb_build_array(pg_temp.l((select a from k), 5)),
        jsonb_build_object('chofer_id', (select chofer from k))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%vehículo%' from r2), 'sin vehículo: rechazada');
insert into fert_vehiculos (id, placa, tipo, validado) values ('131c0000-0000-4000-8000-000000000003', 'SINTIPO131', null, true) on conflict (id) do nothing;
create temp table r3 as select pg_temp.dev(pg_temp.uid(13), 'TALLER', 'Reparación', jsonb_build_array(pg_temp.l((select a from k), 5)),
        jsonb_build_object('chofer_id', (select chofer from k), 'vehiculo_id', '131c0000-0000-4000-8000-000000000003')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%no tiene tipo%' from r3), 'vehículo sin tipo en el catálogo: rechazada');
create temp table r5 as select pg_temp.dev(pg_temp.uid(15), 'OTRO', 'Reparación', jsonb_build_array(pg_temp.l((select a from k), 5)), pg_temp.completo()) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%destino%' from r5), 'destino inválido: rechazada');
create temp table r6 as select pg_temp.dev(pg_temp.uid(16), 'TALLER', 'Reparación', jsonb_build_array(pg_temp.l((select a from k), 5)),
        jsonb_build_object('chofer_id', '131c0000-0000-4000-8000-0000000000ff', 'vehiculo_id', (select veh from k))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%quién retiró%' from r6), 'chofer que no existe: rechazada');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0)
                  and not exists (select 1 from fert_devoluciones_bodega where id between pg_temp.uid(11) and pg_temp.uid(16)),
                  'los rechazos no movieron el saldo ni dejaron documentos');

-- ---------------------------------------------------------------- 3 · devolución completa
create temp table d1 as select pg_temp.dev(pg_temp.uid(21), 'TALLER', 'Reparación de bomba',
        jsonb_build_array(pg_temp.l((select a from k), 30), pg_temp.l((select b from k), 0)), pg_temp.completo()) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from d1), 'devolución completa a TALLER con chofer y vehículo: aceptada');
select pg_temp.ok((select destino = 'TALLER' and chofer_id = (select chofer from k) and vehiculo_id = (select veh from k)
                          and vehiculo_placa = 'TRC131' and vehiculo_tipo = 'Tractor' and chofer_nombre is not null
                   from fert_devoluciones_bodega where id = pg_temp.uid(21)),
                  'quedan el destino exacto, el chofer, la placa y el tipo de vehículo');
select pg_temp.ok(exists (select 1 from fert_choferes_vehiculos where chofer_id = (select chofer from k) and vehiculo_id = (select veh from k)),
                  'aprende la pareja chofer-vehículo');
select pg_temp.ok((select count(*) = 1 from fert_devoluciones_bodega_detalle where devolucion_id = pg_temp.uid(21)), 'la línea en 0 se ignora');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0) - 30, 'el saldo baja 30');

-- ---------------------------------------------------------------- 4 · lo que recibe el teléfono
create temp table est1 as select fn_fert_estado_campo() as j;
select pg_temp.ok((select jsonb_typeof(j->'devoluciones_bodega') = 'array' from est1), 'el estado del teléfono trae devoluciones_bodega');
do $$
declare v jsonb;
begin
    select x into v from est1, jsonb_array_elements(j->'devoluciones_bodega') x where x->>'id' = pg_temp.uid(21)::text;
    if v is null then raise exception 'FALLA: la devolución no está en el estado'; end if;
    if v->>'destino' <> 'TALLER' or v->>'motivo' <> 'Reparación de bomba' then raise exception 'FALLA: destino/motivo %', v; end if;
    if v->>'chofer' is null or v->>'vehiculo' <> 'TRC131' or v->>'vehiculo_tipo' <> 'Tractor' then raise exception 'FALLA: chofer/vehículo %', v; end if;
    if v->>'registrado_por_nombre' is null then raise exception 'FALLA: quién la registró %', v; end if;
    if v->'operacion' is null or v->'operacion'->>'creado_en' is null then raise exception 'FALLA: operación (fecha/GPS) %', v; end if;
    if (v->'operacion'->>'lat') is null then raise exception 'FALLA: sin GPS %', v; end if;
    if jsonb_array_length(v->'lineas') <> 1 then raise exception 'FALLA: líneas %', v; end if;
    if (v->'lineas'->0->>'cantidad')::numeric <> 30
       or (v->'lineas'->0->>'saldo_antes')::numeric <> (select a from s0)
       or (v->'lineas'->0->>'saldo_despues')::numeric <> (select a from s0) - 30 then
        raise exception 'FALLA: saldos antes/después %', v;
    end if;
    if v->>'anulado_at' is not null then raise exception 'FALLA: no debería estar anulada'; end if;
    raise notice 'ok  estado del teléfono: destino, chofer, vehículo, quién registró, GPS, saldos antes y después';
end $$;

-- ---------------------------------------------------------------- 5 · anulada: quién, cuándo y motivo
select pg_temp.como((select adm from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(31), 'anulacion', jsonb_build_object('documento_tipo', 'devolucion_bodega',
        'documento_id', pg_temp.uid(21), 'motivo', 'Se devolvió por error'))->>'estado') like 'ACEPTADO%', 'se anula');
do $$
declare v jsonb;
begin
    select x into v from jsonb_array_elements(fn_fert_estado_campo()->'devoluciones_bodega') x where x->>'id' = pg_temp.uid(21)::text;
    if v->>'anulado_at' is null or v->>'anulado_por_nombre' <> 'Admin 131' or v->>'motivo_anulacion' <> 'Se devolvió por error' then
        raise exception 'FALLA: anulación (quién/cuándo/motivo) %', v;
    end if;
    raise notice 'ok  anulada muestra quién, cuándo y motivo';
end $$;

-- ---------------------------------------------------------------- 6 · exportación a AGL
do $$
declare v_x jsonb := fn_fert_exportar(0, 100000);
        a jsonb;
begin
    select x into a from jsonb_array_elements(v_x->'devoluciones_bodega') x where x->>'id' = pg_temp.uid(21)::text;
    if a is null then raise exception 'FALLA: AGL no trae la devolución'; end if;
    if a->>'destino' <> 'TALLER' or a->>'vehiculo' <> 'TRC131' or a->>'vehiculo_tipo' <> 'Tractor' or a->>'chofer' is null
       or a->>'anulado_por' <> 'Admin 131' or a->>'lat' is null then
        raise exception 'FALLA: campos para AGL %', a;
    end if;
    raise notice 'ok  exportación a AGL con destino, chofer, vehículo, GPS y anulación';
end $$;

-- ---------------------------------------------------------------- 7 · re-corridas y órdenes
create or replace function pg_temp.finales(p_etiqueta text) returns void language plpgsql as $$
begin
    if position('131: valida quién retiró' in pg_get_functiondef('public._fert_op_devolucion_bodega(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) = 0 then
        raise exception 'FALLA [%]: _fert_op_devolucion_bodega sin el parche de la 131', p_etiqueta;
    end if;
    if position('131: devoluciones a bodega con TODO' in pg_get_functiondef('public.fn_fert_estado_campo(date)'::regprocedure)) = 0 then
        raise exception 'FALLA [%]: fn_fert_estado_campo sin el parche de la 131', p_etiqueta;
    end if;
    if position('vehiculo_tipo' in pg_get_functiondef('public.fn_fert_exportar(bigint, integer)'::regprocedure)) = 0 then
        raise exception 'FALLA [%]: fn_fert_exportar sin el parche de la 131', p_etiqueta;
    end if;
    raise notice 'ok  finales [%]', p_etiqueta;
end $$;
create or replace function pg_temp.ciclo(p_etiqueta text, p_n integer) returns void language plpgsql as $$
declare v_r jsonb;
begin
    perform pg_temp.como((select e1 from k));
    v_r := pg_temp.op(pg_temp.uid(p_n), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'chofer_id', (select chofer from k),
              'lineas', jsonb_build_array(pg_temp.l((select a from k), 10))));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: recibir: %', p_etiqueta, v_r; end if;
    v_r := pg_temp.dev(pg_temp.uid(p_n + 1), 'SUMINISTROS', 'Fin de temporada', jsonb_build_array(pg_temp.l((select a from k), 4)), pg_temp.completo());
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: devolver: %', p_etiqueta, v_r; end if;
    v_r := pg_temp.dev(pg_temp.uid(p_n + 2), 'SUMINISTROS', 'Sin chofer', jsonb_build_array(pg_temp.l((select a from k), 1)));
    if v_r->>'estado' <> 'RECHAZADO' then raise exception 'FALLA [%]: debía rechazar sin chofer: %', p_etiqueta, v_r; end if;
    perform pg_temp.finales(p_etiqueta);
end $$;
select pg_temp.finales('estado actual');
\i sql/131_devolucion_bodega_detalle.sql
select pg_temp.ciclo('131 repetida', 100);
\i sql/128_campo_menu_y_devolucion_bodega.sql
\i sql/131_devolucion_bodega_detalle.sql
select pg_temp.ciclo('128>131', 110);
\i sql/129_campo_inyeccion_por_lote.sql
\i sql/131_devolucion_bodega_detalle.sql
select pg_temp.ciclo('129>131', 120);
\i sql/116_fertirriego_registro_historico.sql
\i sql/128_campo_menu_y_devolucion_bodega.sql
\i sql/131_devolucion_bodega_detalle.sql
select pg_temp.ciclo('116>128>131', 130);

select 'FIN 131 OK' as resultado;
