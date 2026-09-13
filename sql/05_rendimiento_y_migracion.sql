-- =====================================================================
-- AGRONOTIFICACIONES · Migración 05
-- (a) Optimización de RLS   (b) Preparación para migrar datos viejos
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01, 02, 03 y 04.
-- =====================================================================


-- =====================================================================
-- PARTE A · OPTIMIZACIÓN DE RENDIMIENTO EN RLS
-- =====================================================================
-- Problema: las políticas de 02_rls_policies.sql llaman a fn_mi_rol() y
-- fn_tiene_permiso() directamente. PostgreSQL las evalúa UNA VEZ POR FILA,
-- y cada llamada hace un JOIN contra perfiles+roles. Con 16 mil registros
-- (los que vas a migrar) eso son 16 mil consultas extra por cada SELECT.
--
-- Solución (patrón oficial de Supabase): envolver la llamada en un
-- subquery `(select fn(...))`. Así el planificador la convierte en un
-- InitPlan y la evalúa UNA SOLA VEZ por consulta, no por fila.
-- Lo mismo aplica a auth.uid().
-- =====================================================================

-- --------------------------- TICKETS ---------------------------------
drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        or usuario_id = (select auth.uid())
    );

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert
    with check (
        (select public.fn_tiene_permiso('ticket','create'))
        and usuario_id = (select auth.uid())
    );

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        or (usuario_id = (select auth.uid()) and estado = 'ABIERTO')
    )
    with check (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        or usuario_id = (select auth.uid())
    );

-- ------------------------- HOROMETROS --------------------------------
drop policy if exists horometros_select on public.horometros;
create policy horometros_select on public.horometros for select
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        or exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = (select auth.uid())
        )
    );

drop policy if exists horometros_insert on public.horometros;
create policy horometros_insert on public.horometros for insert
    with check (
        (select public.fn_tiene_permiso('horometro','create'))
        and exists (
            select 1 from public.tickets t
            where t.id = ticket_id
              and t.usuario_id = (select auth.uid())
              and t.estado = 'ABIERTO'
        )
    );

drop policy if exists horometros_update on public.horometros;
create policy horometros_update on public.horometros for update
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        or exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = (select auth.uid()) and t.estado = 'ABIERTO'
        )
    );

-- -------------------------- REGISTROS --------------------------------
drop policy if exists registros_select on public.registros;
create policy registros_select on public.registros for select
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        or exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = (select auth.uid())
        )
    );

drop policy if exists registros_insert on public.registros;
create policy registros_insert on public.registros for insert
    with check (
        (select public.fn_tiene_permiso('registro','create'))
        and exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = (select auth.uid()) and t.estado = 'ABIERTO'
        )
    );

drop policy if exists registros_update on public.registros;
create policy registros_update on public.registros for update
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        or exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = (select auth.uid()) and t.estado = 'ABIERTO'
        )
    );

-- ----------------------- REGISTRO_DETALLE ----------------------------
drop policy if exists registro_detalle_select on public.registro_detalle;
create policy registro_detalle_select on public.registro_detalle for select
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        or exists (
            select 1 from public.registros r
            join public.tickets t on t.id = r.ticket_id
            where r.id = registro_id and t.usuario_id = (select auth.uid())
        )
    );

drop policy if exists registro_detalle_insert on public.registro_detalle;
create policy registro_detalle_insert on public.registro_detalle for insert
    with check (
        (select public.fn_tiene_permiso('registro','create'))
        and exists (
            select 1 from public.registros r
            join public.tickets t on t.id = r.ticket_id
            where r.id = registro_id and t.usuario_id = (select auth.uid()) and t.estado = 'ABIERTO'
        )
    );

drop policy if exists registro_detalle_update on public.registro_detalle;
create policy registro_detalle_update on public.registro_detalle for update
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        or exists (
            select 1 from public.registros r
            join public.tickets t on t.id = r.ticket_id
            where r.id = registro_id and t.usuario_id = (select auth.uid()) and t.estado = 'ABIERTO'
        )
    );

-- ------------------- CATÁLOGOS (lectura) -----------------------------
-- `auth.uid() is not null` también se evalúa por fila; se envuelve igual.
drop policy if exists temporadas_select on public.temporadas;
create policy temporadas_select on public.temporadas for select using ((select auth.uid()) is not null);

drop policy if exists zonas_select on public.zonas;
create policy zonas_select on public.zonas for select using ((select auth.uid()) is not null);

drop policy if exists lotes_select on public.lotes;
create policy lotes_select on public.lotes for select using ((select auth.uid()) is not null);

drop policy if exists lotes_temporada_select on public.lotes_temporada;
create policy lotes_temporada_select on public.lotes_temporada for select using ((select auth.uid()) is not null);

drop policy if exists equipos_select on public.equipos;
create policy equipos_select on public.equipos for select using ((select auth.uid()) is not null);

drop policy if exists implementos_select on public.implementos;
create policy implementos_select on public.implementos for select using ((select auth.uid()) is not null);

drop policy if exists operadores_select on public.operadores;
create policy operadores_select on public.operadores for select using ((select auth.uid()) is not null);

drop policy if exists categorias_labor_select on public.categorias_labor;
create policy categorias_labor_select on public.categorias_labor for select using ((select auth.uid()) is not null);

drop policy if exists labores_select on public.labores;
create policy labores_select on public.labores for select using ((select auth.uid()) is not null);

drop policy if exists tareas_sap_select on public.tareas_sap;
create policy tareas_sap_select on public.tareas_sap for select using ((select auth.uid()) is not null);

drop policy if exists labores_tareas_select on public.labores_tareas;
create policy labores_tareas_select on public.labores_tareas for select using ((select auth.uid()) is not null);

drop policy if exists labores_implementos_select on public.labores_implementos;
create policy labores_implementos_select on public.labores_implementos for select using ((select auth.uid()) is not null);

-- ------------------------- ÍNDICES -----------------------------------
-- Las políticas hacen EXISTS sobre estas columnas: sin índice, cada
-- verificación es un scan completo de la tabla.
create index if not exists tickets_usuario_idx        on public.tickets (usuario_id);
create index if not exists tickets_fecha_idx          on public.tickets (fecha desc);
create index if not exists horometros_ticket_idx      on public.horometros (ticket_id);
create index if not exists registros_ticket_idx       on public.registros (ticket_id);
create index if not exists registros_horometro_idx    on public.registros (horometro_id);
create index if not exists registro_detalle_reg_idx   on public.registro_detalle (registro_id);
create index if not exists registro_detalle_lote_idx  on public.registro_detalle (lote_temporada_id);
create index if not exists perfiles_rol_idx           on public.perfiles (rol_id);


-- =====================================================================
-- PARTE B · PREPARACIÓN PARA MIGRAR LOS DATOS VIEJOS
-- =====================================================================
-- Los datos actuales usan IDs hexadecimales de AppSheet ('c93bd6c3',
-- '1001-010', 'A08'...). Esos IDs aparecen también en tus archivos de
-- liquidación SAP, así que hay que CONSERVARLOS aunque la app nueva use
-- uuid internamente. Sin esto, después de migrar no habría forma de
-- cruzar un registro nuevo contra los reportes históricos.
--
-- Importante: agrega estas columnas AHORA, antes de cargar datos reales.
-- =====================================================================

alter table public.temporadas       add column if not exists id_legacy text;
alter table public.zonas            add column if not exists id_legacy text;
alter table public.lotes            add column if not exists id_legacy text;
alter table public.lotes_temporada  add column if not exists id_legacy text;
alter table public.equipos          add column if not exists id_legacy text;
alter table public.implementos      add column if not exists id_legacy text;
alter table public.operadores       add column if not exists id_legacy text;
alter table public.labores          add column if not exists id_legacy text;
alter table public.tareas_sap       add column if not exists id_legacy text;
alter table public.tickets          add column if not exists id_legacy text;
alter table public.horometros       add column if not exists id_legacy text;
alter table public.registros        add column if not exists id_legacy text;
alter table public.registro_detalle add column if not exists id_legacy text;

-- Únicos parciales: permiten muchos NULL (los registros nuevos que crees
-- desde la app) pero impiden importar dos veces el mismo registro viejo.
-- Esto hace que la migración sea REPETIBLE sin duplicar nada.
create unique index if not exists temporadas_legacy_uidx       on public.temporadas (id_legacy) where id_legacy is not null;
create unique index if not exists zonas_legacy_uidx            on public.zonas (id_legacy) where id_legacy is not null;
create unique index if not exists lotes_legacy_uidx            on public.lotes (id_legacy) where id_legacy is not null;
create unique index if not exists lotes_temporada_legacy_uidx  on public.lotes_temporada (id_legacy) where id_legacy is not null;
create unique index if not exists equipos_legacy_uidx          on public.equipos (id_legacy) where id_legacy is not null;
create unique index if not exists implementos_legacy_uidx      on public.implementos (id_legacy) where id_legacy is not null;
create unique index if not exists operadores_legacy_uidx       on public.operadores (id_legacy) where id_legacy is not null;
create unique index if not exists labores_legacy_uidx          on public.labores (id_legacy) where id_legacy is not null;
create unique index if not exists tareas_sap_legacy_uidx       on public.tareas_sap (id_legacy) where id_legacy is not null;
create unique index if not exists tickets_legacy_uidx          on public.tickets (id_legacy) where id_legacy is not null;
create unique index if not exists horometros_legacy_uidx       on public.horometros (id_legacy) where id_legacy is not null;
create unique index if not exists registros_legacy_uidx        on public.registros (id_legacy) where id_legacy is not null;
create unique index if not exists registro_detalle_legacy_uidx on public.registro_detalle (id_legacy) where id_legacy is not null;

comment on column public.tickets.id_legacy is
'IDTICKET original de AppSheet/Google Sheets. NULL en los tickets creados en la app nueva.';


-- =====================================================================
-- PARTE C · GESTIÓN DE USUARIOS DESDE LA APP
-- =====================================================================
-- Para que el Administrador pueda ver y editar los perfiles de todos los
-- usuarios desde la plataforma (hoy la política sólo deja ver el propio).
-- =====================================================================

drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select
    using (
        id = (select auth.uid())
        or (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
    );

drop policy if exists perfiles_update_admin on public.perfiles;
create policy perfiles_update_admin on public.perfiles for update
    using ((select public.fn_es_admin()))
    with check ((select public.fn_es_admin()));

drop policy if exists perfiles_insert_admin on public.perfiles;
create policy perfiles_insert_admin on public.perfiles for insert
    with check ((select public.fn_es_admin()));
