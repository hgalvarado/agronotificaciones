-- =====================================================================
-- PRUEBAS de sql/128 · menú Campo y devolución a bodega
-- Réplica local con 91–127 y los datos de prueba de 96/99/115 (E1/E2, Papalon-1, QA-SOLCA).
-- Correr DESDE LA RAÍZ DEL REPO (usa \i) con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/128_devolucion_bodega.sql
-- Al final repite la 128 y la corre en otros órdenes (116>128>116, 121>128, 128>121, 100>128, 99/102/119>128).
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
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('128a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.saldo(p_est uuid, p_mat uuid) returns numeric language sql as $$
    select coalesce((select disponible from fert_saldos where estacion_id = p_est and material_id = p_mat), 0) $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T128_ADM', 'P128 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T128_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000012801', 'adm@128') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000012801', 'Admin 128', r, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000012801', r) on conflict do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    (select id from materiales where codigo = '101478') as b,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1, '00000000-0000-0000-0000-0000000000e2'::uuid as e2,
    '00000000-0000-0000-0000-000000012801'::uuid as adm;

create or replace function pg_temp.dev(p_id uuid, p_destino text, p_motivo text, p_lineas jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'devolucion_bodega', jsonb_build_object('estacion_id', (select est from k), 'destino', p_destino,
        'motivo', p_motivo, 'lineas', p_lineas), p_dias_atras)
$$;
create or replace function pg_temp.l(p_mat uuid, p_cant numeric) returns jsonb language sql as $$
    select jsonb_build_object('material_id', p_mat, 'cantidad', p_cant) $$;

-- ---------------------------------------------------------------- 0 · pantalla Campo y permisos
select pg_temp.ok((select ruta = '/campo' and en_menu and modulo = 'Campo' and acciones = array['ver'] from pantallas where codigo = 'campo'),
                  'la pantalla «campo» existe (ruta /campo, en el menú, módulo Campo, acción ver)');
select pg_temp.ok(not exists (select 1 from permisos pm where pm.recurso in ('fertirriego', 'agrometricas') and pm.accion = 'ver' and pm.permitido
                              and not exists (select 1 from permisos c where c.rol_id = pm.rol_id and c.recurso = 'campo' and c.accion = 'ver')),
                  'todo rol que ve Fertirriego o AgroMétricas tiene «Campo · ver»');
select pg_temp.ok(not exists (select 1 from permisos c where c.recurso = 'campo' and c.accion = 'ver'
                              and not exists (select 1 from permisos pm where pm.rol_id = c.rol_id and pm.accion = 'ver' and pm.permitido
                                              and pm.recurso in ('fertirriego', 'agrometricas'))
                              and c.rol_id <> (select id from roles where codigo = 'T128_ADM')),
                  '«Campo · ver» solo para quien ya veía alguna ficha');

-- ---------------------------------------------------------------- 1 · saldo inicial y custodia
select pg_temp.como((select adm from k));
do $$
declare v_est uuid := (select est from k);
begin
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 128');
    end if;
    update fert_custodia set desde = now() - interval '2 hours' where estacion_id = v_est;
end $$;
create temp table s0 as select pg_temp.saldo((select est from k), (select a from k)) as a,
                               pg_temp.saldo((select est from k), (select b from k)) as b;
select pg_temp.ok((pg_temp.op(pg_temp.uid(1), 'recepcion', jsonb_build_object('estacion_id', (select est from k),
        'fecha_hora', now() - interval '1 hour', 'lineas', jsonb_build_array(pg_temp.l((select a from k), 100), pg_temp.l((select b from k), 10))))->>'estado')
        like 'ACEPTADO%', 'recepción de 100 y 10 (saldo de partida)');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0) + 100, 'saldo de A = partida + 100');

-- ---------------------------------------------------------------- 2 · devolver con saldo
select pg_temp.como((select e1 from k));
create temp table d1 as select pg_temp.dev(pg_temp.uid(11), 'SUMINISTROS', 'Fin de temporada', jsonb_build_array(pg_temp.l((select a from k), 30))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from d1), 'devolver 30 a SUMINISTROS: aceptada');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0) + 70, 'el saldo baja a partida + 70');
select pg_temp.ok((select count(*) = 1 and sum(cantidad) = -30 from fert_movimientos
                   where documento_id = pg_temp.uid(11) and tipo = 'DEVOLUCION_BODEGA' and documento_tipo = 'devolucion_bodega'),
                  'un movimiento DEVOLUCION_BODEGA de −30');
select pg_temp.ok((select destino = 'SUMINISTROS' and motivo = 'Fin de temporada' and anulado_at is null from fert_devoluciones_bodega where id = pg_temp.uid(11)),
                  'queda el documento con destino y motivo');
select pg_temp.ok((select count(*) = 1 and sum(cantidad) = 30 from fert_devoluciones_bodega_detalle where devolucion_id = pg_temp.uid(11)), 'y su detalle');
select pg_temp.ok((select tipo = 'devolucion_bodega' from fert_operaciones where id = pg_temp.uid(11)), 'queda la operación (auditoría)');

-- ---------------------------------------------------------------- 3 · rechazos
create temp table s1 as select pg_temp.saldo((select est from k), (select a from k)) as a, (select count(*) from fert_movimientos) as movs;
create temp table d2 as select pg_temp.dev(pg_temp.uid(12), 'BODEGA', 'Prueba', jsonb_build_array(pg_temp.l((select a from k), 80))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%solo hay%' and r::text like '%' || (select (a - (select a from s0))::text from s1) || '%' from d2),
                  'devolver 80 con 70 disponibles: rechazada, con el saldo en el mensaje');
create temp table d3 as select pg_temp.dev(pg_temp.uid(13), 'OTRO', 'Prueba', jsonb_build_array(pg_temp.l((select a from k), 1))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%destino%' from d3), 'destino fuera de SUMINISTROS/BODEGA/TALLER: rechazado');
create temp table d4 as select pg_temp.dev(pg_temp.uid(14), 'TALLER', '   ', jsonb_build_array(pg_temp.l((select a from k), 1))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%motivo%' from d4), 'motivo vacío: rechazado');
create temp table d5 as select pg_temp.dev(pg_temp.uid(15), 'TALLER', 'Prueba', jsonb_build_array(pg_temp.l((select a from k), 0))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%al menos un producto%' from d5), 'todas las líneas en 0: «Indica al menos un producto»');
create temp table d6 as select pg_temp.dev(pg_temp.uid(16), 'TALLER', 'Prueba', '[]'::jsonb) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%al menos un producto%' from d6), 'sin líneas: rechazado');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s1) and (select count(*) from fert_movimientos) = (select movs from s1),
                  'los rechazos no movieron nada');
select pg_temp.ok(not exists (select 1 from fert_devoluciones_bodega where id in (pg_temp.uid(12), pg_temp.uid(13), pg_temp.uid(14), pg_temp.uid(15), pg_temp.uid(16))),
                  'ni dejaron documentos');

-- ---------------------------------------------------------------- 4 · idempotencia y línea en 0 junto a una válida
create temp table d7 as select pg_temp.dev(pg_temp.uid(11), 'SUMINISTROS', 'Fin de temporada', jsonb_build_array(pg_temp.l((select a from k), 30))) as r;
select pg_temp.ok((select count(*) = 1 from fert_devoluciones_bodega where id = pg_temp.uid(11)), 'reenviar el mismo UUID no duplica el documento');
select pg_temp.ok((select count(*) = 1 from fert_movimientos where documento_id = pg_temp.uid(11) and tipo = 'DEVOLUCION_BODEGA'), 'ni el movimiento');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s1), 'el saldo sigue igual');
create temp table d8 as select pg_temp.dev(pg_temp.uid(18), 'TALLER', 'Reparación', jsonb_build_array(pg_temp.l((select a from k), 5), pg_temp.l((select b from k), 0))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from d8), 'una línea válida y otra en 0: se acepta');
select pg_temp.ok((select count(*) = 1 from fert_devoluciones_bodega_detalle where devolucion_id = pg_temp.uid(18)), 'la línea en 0 se ignora');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s1) - 5, 'baja 5 más');

-- ---------------------------------------------------------------- 5 · sin señal (llega tarde): igual se rechaza si no alcanza
create temp table d9 as select pg_temp.dev(pg_temp.uid(19), 'BODEGA', 'Tarde', jsonb_build_array(pg_temp.l((select a from k), 9999)), 2) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%solo hay%' from d9), 'enviada tarde (cola sin señal) y sin saldo: rechazada');

-- ---------------------------------------------------------------- 6 · quien no tiene la estación a cargo: observación
select pg_temp.como((select e2 from k));
create temp table d10 as select pg_temp.dev(pg_temp.uid(20), 'BODEGA', 'Fin de temporada', jsonb_build_array(pg_temp.l((select b from k), 2))) as r;
select pg_temp.ok((select r->>'estado' = 'ACEPTADO_CON_OBSERVACIONES' and r::text like '%FUERA_DE_CUSTODIA%' from d10),
                  'sin la estación a cargo: se guarda con FUERA_DE_CUSTODIA');

-- ---------------------------------------------------------------- 7 · anular
select pg_temp.como((select adm from k));
create temp table s2 as select pg_temp.saldo((select est from k), (select a from k)) as a;
create temp table an1 as select pg_temp.op(pg_temp.uid(31), 'anulacion', jsonb_build_object('documento_tipo', 'devolucion_bodega',
        'documento_id', pg_temp.uid(11), 'motivo', 'Se devolvió por error')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an1), 'quien tiene «Anular» anula la devolución');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s2) + 30, 'el saldo vuelve a lo anterior (+30)');
select pg_temp.ok((select anulado_at is not null and motivo_anulacion = 'Se devolvió por error' from fert_devoluciones_bodega where id = pg_temp.uid(11)), 'queda anulada con su motivo');
create temp table an2 as select pg_temp.op(pg_temp.uid(32), 'anulacion', jsonb_build_object('documento_tipo', 'devolucion_bodega',
        'documento_id', pg_temp.uid(11), 'motivo', 'Otra vez')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%ya estaba anulado%' from an2), 'anular dos veces: rechazado');
create temp table an3 as select pg_temp.op(pg_temp.uid(33), 'anulacion', jsonb_build_object('documento_tipo', 'devolucion_bodega',
        'documento_id', pg_temp.uid(11), 'motivo', '')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from an3), 'anular sin motivo: rechazado');
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s2) + 30, 'los rechazos no movieron el saldo');

-- ---------------------------------------------------------------- 8 · RLS y exportación a AGL
select pg_temp.como((select e1 from k));
set role authenticated;
select pg_temp.ok((select count(*) >= 1 from fert_devoluciones_bodega), 'RLS: quien ve la estación lee las devoluciones');
reset role;
select pg_temp.como((select adm from k));
do $$
declare v_x jsonb := fn_fert_exportar(0, 100000);
begin
    if not exists (select 1 from jsonb_array_elements(v_x->'devoluciones_bodega') a
                   where a->>'id' = pg_temp.uid(18)::text and a->>'destino' = 'TALLER' and jsonb_array_length(a->'lineas') = 1) then
        raise exception 'FALLA: la exportación a AGL no trae devoluciones_bodega';
    end if;
    if exists (select 1 from jsonb_array_elements(v_x->'aplicaciones') a where a->>'id' = pg_temp.uid(18)::text) then
        raise exception 'FALLA: la devolución a bodega salió como aplicación';
    end if;
    raise notice 'ok  exportación a AGL con devoluciones_bodega';
end $$;

-- ---------------------------------------------------------------- 9 · invariantes tras volver a correr / otros órdenes
create or replace function pg_temp.finales(p_etiqueta text) returns void language plpgsql as $$
declare
    v_def text;
begin
    v_def := pg_get_functiondef('public._fert_procesar(jsonb)'::regprocedure);
    if position('_fert_op_devolucion_bodega(' in v_def) = 0 or position('''devolucion_bodega'', ''anulacion''' in v_def) = 0 then
        raise exception 'FALLA [%]: _fert_procesar no tiene el parche de la 128', p_etiqueta;
    end if;
    if position('128: salida de inventario' in pg_get_functiondef('public.fn_fert_exportar(bigint, integer)'::regprocedure)) = 0 then
        raise exception 'FALLA [%]: fn_fert_exportar no tiene el parche de la 128', p_etiqueta;
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.fert_movimientos'::regclass
                   and pg_get_constraintdef(oid) like '%DEVOLUCION_BODEGA%') then
        raise exception 'FALLA [%]: el check de tipo no admite DEVOLUCION_BODEGA', p_etiqueta;
    end if;
    if (select count(*) from pantallas where codigo = 'campo') <> 1 then
        raise exception 'FALLA [%]: pantalla campo', p_etiqueta;
    end if;
    raise notice 'ok  finales [%]', p_etiqueta;
end $$;
-- una devolución completa por orden de corrida (sin señal = el id nuevo; el saldo se repone con una recepción)
create or replace function pg_temp.ciclo(p_etiqueta text, p_n integer) returns void language plpgsql as $$
declare
    v_r jsonb;
    v_ant numeric := pg_temp.saldo((select est from k), (select a from k));
begin
    perform pg_temp.como((select adm from k));
    v_r := pg_temp.op(pg_temp.uid(p_n), 'recepcion', jsonb_build_object('estacion_id', (select est from k),
              'lineas', jsonb_build_array(pg_temp.l((select a from k), 10))));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: recibir: %', p_etiqueta, v_r; end if;
    v_r := pg_temp.dev(pg_temp.uid(p_n + 1), 'BODEGA', 'Fin de temporada', jsonb_build_array(pg_temp.l((select a from k), 4)));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: devolver: %', p_etiqueta, v_r; end if;
    if pg_temp.saldo((select est from k), (select a from k)) <> v_ant + 6 then raise exception 'FALLA [%]: saldo', p_etiqueta; end if;
    v_r := pg_temp.op(pg_temp.uid(p_n + 2), 'anulacion', jsonb_build_object('documento_tipo', 'devolucion_bodega',
              'documento_id', pg_temp.uid(p_n + 1), 'motivo', 'prueba ' || p_etiqueta));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: anular: %', p_etiqueta, v_r; end if;
    if pg_temp.saldo((select est from k), (select a from k)) <> v_ant + 10 then raise exception 'FALLA [%]: saldo tras anular', p_etiqueta; end if;
    perform pg_temp.finales(p_etiqueta);
end $$;

select pg_temp.finales('estado actual');
\i sql/128_campo_menu_y_devolucion_bodega.sql
select pg_temp.ciclo('128 repetida', 100);
\i sql/116_fertirriego_registro_historico.sql
select pg_temp.ciclo('116 despues de 128', 110);
\i sql/128_campo_menu_y_devolucion_bodega.sql
select pg_temp.ciclo('116>128>116 (128 al final)', 120);
\i sql/116_fertirriego_registro_historico.sql
select pg_temp.ciclo('116>128>116', 130);
\i sql/121_fertirriego_auditoria_a_agl.sql
\i sql/128_campo_menu_y_devolucion_bodega.sql
select pg_temp.ciclo('121>128', 140);
\i sql/128_campo_menu_y_devolucion_bodega.sql
\i sql/121_fertirriego_auditoria_a_agl.sql
select pg_temp.ciclo('128>121', 150);
\i sql/100_fertirriego_piloto2.sql
\i sql/101_fertirriego_pruebas_en_agl.sql
\i sql/128_campo_menu_y_devolucion_bodega.sql
select pg_temp.ciclo('100>101>128', 160);
\i sql/102_fertirriego_archivo_turnos.sql
\i sql/128_campo_menu_y_devolucion_bodega.sql
select pg_temp.ciclo('102>128', 170);

select 'FIN 128 OK' as resultado;
