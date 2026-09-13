-- =====================================================================
-- AGRONOTIFICACIONES · Migración 06
-- (a) Corrige el error de usuario_id  (b) Borrado para el Administrador
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01–05.
-- =====================================================================


-- =====================================================================
-- PARTE A · usuario_id automático
-- =====================================================================
-- Error que estabas viendo:
--   null value in column "usuario_id" of relation "horometros"
--   violates not-null constraint
--
-- Las tablas transaccionales exigen usuario_id (es la columna sobre la
-- que se apoya el RLS del Digitador) pero el formulario no lo enviaba.
-- En vez de parchar cada formulario, se resuelve en la base: el valor por
-- defecto es el usuario autenticado. Así ningún insert futuro puede
-- olvidarlo, y durante la migración un valor explícito sigue mandando
-- sobre el default (los registros viejos conservan su autor real).

alter table public.tickets          alter column usuario_id set default auth.uid();
alter table public.horometros       alter column usuario_id set default auth.uid();
alter table public.registros        alter column usuario_id set default auth.uid();
alter table public.registro_detalle alter column usuario_id set default auth.uid();


-- =====================================================================
-- PARTE B · El Administrador puede eliminar
-- =====================================================================
-- El diseño original no daba DELETE a nadie en las tablas transaccionales
-- (para proteger la trazabilidad hacia SAP). Pero el Administrador sí debe
-- poder limpiar: datos de prueba, capturas equivocadas, duplicados.
-- Torre de Control y Digitador siguen SIN poder eliminar nada.

create policy tickets_delete on public.tickets for delete
    using ((select public.fn_es_admin()));

create policy horometros_delete on public.horometros for delete
    using ((select public.fn_es_admin()));

create policy registros_delete on public.registros for delete
    using ((select public.fn_es_admin()));

create policy registro_detalle_delete on public.registro_detalle for delete
    using ((select public.fn_es_admin()));

-- Nota: tickets → horometros → registros → registro_detalle están
-- encadenados con ON DELETE CASCADE, así que borrar un ticket arrastra
-- todo lo que cuelga de él en una sola operación.

-- Las tablas puente también, para poder corregir vinculaciones.
create policy labores_tareas_delete on public.labores_tareas for delete
    using ((select public.fn_es_admin()));

create policy labores_implementos_delete on public.labores_implementos for delete
    using ((select public.fn_es_admin()));


-- =====================================================================
-- PARTE C · Familias de equipo
-- =====================================================================
-- La tabla ya existía (familias_equipo) pero no tenía políticas de
-- escritura útiles ni columna de estado. Se completa para poder
-- administrarla desde la app.

alter table public.familias_equipo add column if not exists activo boolean not null default true;
alter table public.familias_equipo add column if not exists id_legacy text;

create unique index if not exists familias_legacy_uidx
    on public.familias_equipo (id_legacy) where id_legacy is not null;

drop policy if exists familias_select on public.familias_equipo;
create policy familias_select on public.familias_equipo for select
    using ((select auth.uid()) is not null);

drop policy if exists familias_write on public.familias_equipo;
create policy familias_insert on public.familias_equipo for insert
    with check ((select public.fn_tiene_permiso('catalogo_equipos','create')));
create policy familias_update on public.familias_equipo for update
    using ((select public.fn_tiene_permiso('catalogo_equipos','update')));
create policy familias_delete on public.familias_equipo for delete
    using ((select public.fn_es_admin()));
