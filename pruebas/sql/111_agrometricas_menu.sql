-- =====================================================================
-- PRUEBAS de sql/111 · AgroMétricas en el menú (réplica con la 109; correr después de la 111)
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
    if p_cond is distinct from true then raise exception 'FALLA: %', p_msg; end if;
    raise notice 'ok  %', p_msg;
end $$;
set client_min_messages = notice;

select pg_temp.ok((select en_menu and icono = 'chart' and ruta = '/agrometricas' from pantallas where codigo = 'agrometricas'),
                  'AgroMétricas en el menú con el ícono chart y su ruta');
select pg_temp.ok((select modulo = 'AgroMétricas' from pantallas where codigo = 'agrometricas'), 'módulo AgroMétricas (Permisos y etiqueta del menú)');
select pg_temp.ok((select etiquetas_alcance ->> 'zonal' = 'Sus zonas' and etiquetas_alcance ->> 'global' = 'Todas las zonas'
                   from pantallas where codigo = 'agrometricas'), 'nombres de los alcances por zona');
select pg_temp.ok((select descripcion like '%clima por zona%' from pantallas where codigo = 'agrometricas'), 'descripción: clima por zona');
select pg_temp.ok((select count(*) = 1 from pantallas where en_menu and ruta = '/agrometricas'), 'una sola entrada de menú para la ruta');

-- Lo cambiado a mano se respeta al volver a correr la 111 (simulado dentro de una transacción)
begin;
update pantallas set icono = 'gauge' where codigo = 'agrometricas';
\ir ../../sql/111_agrometricas_menu.sql
select pg_temp.ok((select icono = 'gauge' and en_menu from pantallas where codigo = 'agrometricas'), 'un ícono puesto a mano se respeta');
rollback;

-- (Sin la 109: la 111 se corre en una base sin la pantalla y no hace nada; se comprueba aparte.)
\echo '=== 111: TODAS LAS PRUEBAS PASARON ==='
