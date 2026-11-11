-- =====================================================================
-- 83 · RETIRO DEL MÓDULO TELECOM (Líneas Corporativas)
--
-- El módulo se migró a AGL Gestión (Líneas Telefónicas /LN01, /LN02, /LN03) el 2026-11-10.
-- Verificado antes de escribir esto: las 67 líneas, 69 asignaciones, 3 equipos y 6 notas de bitácora de
-- Supabase están en AGL Gestión (64 idénticas; 3 con cambios hechos después allá; 1 línea nueva allá).
--
-- Ejecutar en el SQL Editor DESPUÉS de la 82. Primero en DESARROLLO, luego en PRODUCCIÓN.
--
--   1 · RESPALDO: copia los datos de las 7 tablas y las filas de permisos/pantallas en el esquema
--       `respaldo` (no expuesto por la API) y COMPRUEBA que la copia tenga las mismas filas.
--   2 · RETIRO: permisos y pantalla «telecom», vistas, tablas, funciones y tipos del módulo.
--       Sin CASCADE: si algo que no conocemos dependiera de Telecom, la migración se DETIENE y no se
--       borra nada (todo va en una sola transacción).
--
-- No toca: catalogo_personal, operadores, departamentos, fn_touch_updated_at ni fn_tasa_de_temporada
-- (los usan otros módulos).
--
-- Para restaurar una tabla:  create table public.telecom_lineas as table respaldo.telecom_lineas_20261110;
-- (las restricciones y políticas están en las migraciones 47–49 y 77).
--
-- Idempotente: si ya se corrió, no hace nada.
-- =====================================================================

begin;

create schema if not exists respaldo;
revoke all on schema respaldo from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1 · RESPALDO (solo si las tablas todavía existen)
-- ---------------------------------------------------------------------
do $$
declare
    t text;
    origen bigint;
    copia bigint;
begin
    foreach t in array array['telecom_lineas', 'telecom_equipos', 'telecom_asignaciones', 'telecom_planes',
                             'telecom_puestos', 'telecom_centros_costo', 'telecom_bitacora']
    loop
        if to_regclass('public.' || t) is null then
            raise notice 'public.% ya no existe: se omite su respaldo', t;
            continue;
        end if;
        if to_regclass('respaldo.' || t || '_20261110') is null then
            execute format('create table respaldo.%I as table public.%I', t || '_20261110', t);
        end if;
        execute format('select count(*) from public.%I', t) into origen;
        execute format('select count(*) from respaldo.%I', t || '_20261110') into copia;
        if origen <> copia then
            raise exception 'El respaldo de % no coincide (% filas en public, % en respaldo). No se borró nada.', t, origen, copia;
        end if;
        raise notice 'Respaldo de %: % filas', t, copia;
    end loop;

    if to_regclass('respaldo.permisos_telecom_20261110') is null then
        create table respaldo.permisos_telecom_20261110 as select * from public.permisos where recurso = 'telecom';
        create table respaldo.pantallas_telecom_20261110 as select * from public.pantallas where codigo = 'telecom';
    end if;
end $$;

-- Las columnas con los tipos propios del módulo (estado_linea, estado_equipo, estado_asignacion,
-- accion_solicitada) se guardan como TEXTO en el respaldo: así esos tipos se pueden borrar y el dato se conserva
do $$
declare
    col record;
begin
    for col in
        select c.table_name, c.column_name
        from information_schema.columns c
        where c.table_schema = 'respaldo' and c.table_name like '%_20261110'
          and c.udt_name in ('estado_linea', 'estado_equipo', 'estado_asignacion', 'accion_solicitada')
    loop
        execute format('alter table respaldo.%I alter column %I type text using %I::text', col.table_name, col.column_name, col.column_name);
    end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2 · RETIRO
-- ---------------------------------------------------------------------

-- Permisos y pantalla (el menú ya no la muestra: el código del módulo se retiró en el mismo cambio)
delete from public.permisos where recurso = 'telecom';
delete from public.pantallas where codigo = 'telecom';

-- Vistas (las de public envuelven a las «crudas» de interno)
drop view if exists public.v_telecom_alertas;
drop view if exists public.v_telecom_asignaciones;
drop view if exists public.v_telecom_equipos;
drop view if exists public.v_telecom_lineas;
drop view if exists interno.v_telecom_alertas_crudo;
drop view if exists interno.v_telecom_asignaciones_crudo;
drop view if exists interno.v_telecom_equipos_crudo;
drop view if exists interno.v_telecom_lineas_crudo;

-- Funciones de consulta y acción: ANTES que las tablas (algunas usan el tipo de fila de una tabla, ej.
-- telecom_lineas%rowtype, y la tabla no se puede borrar mientras existan)
drop function if exists public.fn_telecom_bitacora(text);
drop function if exists public.fn_telecom_finalizar_asignacion(uuid, date);
drop function if exists public.fn_telecom_historial(text, text);
drop function if exists public.fn_telecom_pasar_a_retencion(text);
drop function if exists public.fn_telecom_registrar_solicitud(text, text, text, text, date);

-- Tablas (juntas: tienen llaves entre ellas). Sus disparadores y políticas se van con ellas
drop table if exists public.telecom_asignaciones, public.telecom_bitacora, public.telecom_lineas,
    public.telecom_equipos, public.telecom_planes, public.telecom_puestos, public.telecom_centros_costo;

-- Funciones de disparador: DESPUÉS de las tablas (sus disparadores ya no existen)
drop function if exists public.fn_telecom_planes_moneda();
drop function if exists public.fn_telecom_sincronizar_borrado();
drop function if exists public.fn_telecom_sincronizar_estados();

-- Tipos propios del módulo
drop type if exists public.accion_solicitada;
drop type if exists public.estado_asignacion;
drop type if exists public.estado_equipo;
drop type if exists public.estado_linea;

-- Comprobación final: no queda nada de Telecom
do $$
declare
    restos text;
begin
    select string_agg(n.nspname || '.' || c.relname, ', ') into restos
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relname like '%telecom%' and n.nspname in ('public', 'interno');
    if restos is not null then
        raise exception 'Quedaron objetos de Telecom: %. No se aplicó nada.', restos;
    end if;
    raise notice 'Telecom retirado. Respaldo en el esquema «respaldo» (tablas *_20261110).';
end $$;

commit;
