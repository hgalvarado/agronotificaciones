-- =====================================================================
-- AGRONOTIFICACIONES · Migración 07
-- Catálogo de departamentos
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01–06.
--
-- Hasta ahora el departamento se escribía a mano en el perfil del usuario
-- y se copiaba al ticket. Eso abre la puerta a "Mecanizacion",
-- "Mecanización" y "mecanizacion" conviviendo como tres departamentos
-- distintos — justo el tipo de suciedad que después arruina un reporte.
--
-- Decisión de diseño: se crea el catálogo para alimentar el desplegable,
-- pero perfiles.departamento y tickets.departamento SIGUEN siendo texto.
-- Motivo: tus hojas viejas guardan el departamento como texto libre
-- ('Mecanizacion', 'FitoProteccion'), y al migrar el histórico se copia
-- tal cual sin depender de que exista una fila equivalente en el catálogo.
-- Se gana la consistencia hacia adelante sin arriesgar la migración.
-- =====================================================================

create table if not exists public.departamentos (
    id         uuid primary key default gen_random_uuid(),
    nombre     text not null unique,
    activo     boolean not null default true,
    id_legacy  text,
    created_at timestamptz not null default now()
);

create unique index if not exists departamentos_legacy_uidx
    on public.departamentos (id_legacy) where id_legacy is not null;

alter table public.departamentos enable row level security;

create policy departamentos_select on public.departamentos for select
    using ((select auth.uid()) is not null);

create policy departamentos_insert on public.departamentos for insert
    with check ((select public.fn_es_admin()) or (select public.fn_mi_rol()) = 'TORRE_CONTROL');

create policy departamentos_update on public.departamentos for update
    using ((select public.fn_es_admin()) or (select public.fn_mi_rol()) = 'TORRE_CONTROL');

create policy departamentos_delete on public.departamentos for delete
    using ((select public.fn_es_admin()));

-- Semilla con los departamentos que ya aparecen en tus datos actuales.
insert into public.departamentos (nombre)
values ('Mecanizacion'), ('FitoProteccion'), ('Torre Control')
on conflict (nombre) do nothing;

-- Además, recupera cualquier departamento que ya se haya escrito a mano
-- en un perfil, para que el desplegable no pierda nada de lo capturado.
insert into public.departamentos (nombre)
select distinct departamento
from public.perfiles
where departamento is not null and btrim(departamento) <> ''
on conflict (nombre) do nothing;
