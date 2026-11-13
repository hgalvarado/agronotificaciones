-- =====================================================================
-- PRUEBAS de sql/103 · PASO 1 (correr ANTES de la 103): foto de lo que cada persona ve hoy.
-- Orden: este archivo → sql/103_menu_por_rol.sql (dos veces: idempotente) → pruebas/sql/103_menu_por_rol.sql
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

drop schema if exists prueba103 cascade;
create schema prueba103;
create table prueba103.permisos_antes (perfil_id uuid, recurso text, accion text, alcance text, condicion text);
create table prueba103.navegacion_antes (perfil_id uuid, pantalla text, orden smallint);

do $$
declare
    v uuid;
begin
    for v in select id from public.perfiles loop
        perform set_config('request.jwt.claim.sub', v::text, false);
        insert into prueba103.permisos_antes select v, recurso, accion, alcance, condicion from public.fn_mis_permisos();
        insert into prueba103.navegacion_antes select v, pantalla, orden from public.fn_mi_navegacion();
    end loop;
    perform set_config('request.jwt.claim.sub', '', false);
end $$;

select (select count(distinct perfil_id) from prueba103.permisos_antes) as personas,
       (select count(*) from prueba103.permisos_antes) as permisos,
       (select count(*) from prueba103.navegacion_antes) as barra;
