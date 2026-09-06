-- =====================================================================
-- AGRONOTIFICACIONES · Row Level Security (RLS) en Supabase
-- =====================================================================
-- Estrategia:
--   1. Funciones helper (SECURITY DEFINER) que resuelven rol y permisos
--      del usuario autenticado a partir de la tabla perfiles/permisos.
--   2. Administrador: bypass total (política "true" en todas las tablas).
--   3. Torre de Control: ve todo, edita transacciones (incluso cerradas),
--      inserta/edita en catálogos habilitados, NUNCA borra.
--   4. Digitador: sólo ve y edita SUS PROPIOS registros (usuario_id = auth.uid())
--      y sólo mientras el ticket esté ABIERTO. Nunca borra.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Funciones helper
-- ---------------------------------------------------------------------

create or replace function public.fn_mi_rol() returns text
language sql stable security definer as $$
    select r.codigo
    from public.perfiles p
    join public.roles r on r.id = p.rol_id
    where p.id = auth.uid()
$$;

create or replace function public.fn_es_admin() returns boolean
language sql stable security definer as $$
    select public.fn_mi_rol() = 'ADMIN'
$$;

create or replace function public.fn_tiene_permiso(p_recurso text, p_accion text) returns boolean
language sql stable security definer as $$
    select
        public.fn_es_admin()
        or exists (
            select 1
            from public.perfiles p
            join public.permisos pm on pm.rol_id = p.rol_id
            where p.id = auth.uid()
              and pm.recurso = p_recurso
              and pm.accion = p_accion
        )
$$;

-- ---------------------------------------------------------------------
-- 1. Habilitar RLS en todas las tablas de negocio
-- ---------------------------------------------------------------------
alter table public.perfiles            enable row level security;
alter table public.temporadas          enable row level security;
alter table public.zonas               enable row level security;
alter table public.lotes               enable row level security;
alter table public.lotes_temporada     enable row level security;
alter table public.familias_equipo     enable row level security;
alter table public.categorias_equipo   enable row level security;
alter table public.equipos             enable row level security;
alter table public.implementos         enable row level security;
alter table public.operadores          enable row level security;
alter table public.categorias_labor    enable row level security;
alter table public.labores             enable row level security;
alter table public.tareas_sap          enable row level security;
alter table public.labores_tareas      enable row level security;
alter table public.labores_implementos enable row level security;
alter table public.tarifas_equipo      enable row level security;
alter table public.tarifas_labor       enable row level security;
alter table public.tickets             enable row level security;
alter table public.horometros          enable row level security;
alter table public.registros           enable row level security;
alter table public.registro_detalle    enable row level security;
alter table public.log_auditoria       enable row level security;
alter table public.permisos            enable row level security;
alter table public.roles               enable row level security;

-- ---------------------------------------------------------------------
-- 2. PERFILES — cada usuario ve el suyo; admin ve todos
-- ---------------------------------------------------------------------
create policy perfiles_select on public.perfiles for select
    using (id = auth.uid() or public.fn_es_admin() or public.fn_mi_rol() = 'TORRE_CONTROL');
create policy perfiles_update_admin on public.perfiles for update
    using (public.fn_es_admin());
create policy perfiles_insert_admin on public.perfiles for insert
    with check (public.fn_es_admin());
-- Nadie borra perfiles vía API (se desactiva, no se elimina)

-- roles y permisos: sólo lectura para todos, escritura sólo admin (panel admin)
create policy roles_select_all on public.roles for select using (true);
create policy permisos_select_all on public.permisos for select using (true);
create policy permisos_write_admin on public.permisos for all
    using (public.fn_es_admin()) with check (public.fn_es_admin());

-- ---------------------------------------------------------------------
-- 3. CATÁLOGOS — patrón repetible
-- ---------------------------------------------------------------------
-- Lectura: cualquier usuario autenticado activo puede leer catálogos
-- (los necesita para poblar selects en los formularios de campo).
-- Escritura: según tabla permisos; DELETE reservado a Administrador.

-- Plantilla aplicada a: temporadas, zonas, lotes, lotes_temporada,
-- familias_equipo, categorias_equipo, equipos, implementos, operadores,
-- categorias_labor, labores, tareas_sap, labores_tareas, labores_implementos

create policy temporadas_select on public.temporadas for select using (auth.uid() is not null);
create policy temporadas_write  on public.temporadas for insert with check (public.fn_es_admin());
create policy temporadas_update on public.temporadas for update using (public.fn_es_admin());
create policy temporadas_delete on public.temporadas for delete using (public.fn_es_admin());

create policy zonas_select on public.zonas for select using (auth.uid() is not null);
create policy zonas_write  on public.zonas for insert with check (public.fn_es_admin() or public.fn_mi_rol() = 'TORRE_CONTROL');
create policy zonas_update on public.zonas for update using (public.fn_es_admin() or public.fn_mi_rol() = 'TORRE_CONTROL');
create policy zonas_delete on public.zonas for delete using (public.fn_es_admin());

create policy lotes_select on public.lotes for select using (auth.uid() is not null);
create policy lotes_write  on public.lotes for insert with check (public.fn_tiene_permiso('catalogo_ubicaciones','create'));
create policy lotes_update on public.lotes for update using (public.fn_tiene_permiso('catalogo_ubicaciones','update'));
create policy lotes_delete on public.lotes for delete using (public.fn_es_admin());

create policy lotes_temporada_select on public.lotes_temporada for select using (auth.uid() is not null);
create policy lotes_temporada_write  on public.lotes_temporada for insert with check (public.fn_tiene_permiso('catalogo_ubicaciones','create'));
create policy lotes_temporada_update on public.lotes_temporada for update using (public.fn_tiene_permiso('catalogo_ubicaciones','update'));
create policy lotes_temporada_delete on public.lotes_temporada for delete using (public.fn_es_admin());

create policy familias_select on public.familias_equipo for select using (auth.uid() is not null);
create policy familias_write  on public.familias_equipo for all using (public.fn_es_admin()) with check (public.fn_es_admin());

create policy categorias_equipo_select on public.categorias_equipo for select using (auth.uid() is not null);
create policy categorias_equipo_write  on public.categorias_equipo for all using (public.fn_es_admin()) with check (public.fn_es_admin());

create policy equipos_select on public.equipos for select using (auth.uid() is not null);
create policy equipos_write  on public.equipos for insert with check (public.fn_tiene_permiso('catalogo_equipos','create'));
create policy equipos_update on public.equipos for update using (public.fn_tiene_permiso('catalogo_equipos','update'));
create policy equipos_delete on public.equipos for delete using (public.fn_es_admin());

create policy implementos_select on public.implementos for select using (auth.uid() is not null);
create policy implementos_write  on public.implementos for insert with check (public.fn_tiene_permiso('catalogo_implementos','create'));
create policy implementos_update on public.implementos for update using (public.fn_tiene_permiso('catalogo_implementos','update'));
create policy implementos_delete on public.implementos for delete using (public.fn_es_admin());

create policy operadores_select on public.operadores for select using (auth.uid() is not null);
create policy operadores_write  on public.operadores for insert with check (public.fn_tiene_permiso('catalogo_operadores','create'));
create policy operadores_update on public.operadores for update using (public.fn_tiene_permiso('catalogo_operadores','update'));
create policy operadores_delete on public.operadores for delete using (public.fn_es_admin());

create policy categorias_labor_select on public.categorias_labor for select using (auth.uid() is not null);
create policy categorias_labor_write  on public.categorias_labor for all using (public.fn_es_admin()) with check (public.fn_es_admin());

create policy labores_select on public.labores for select using (auth.uid() is not null);
create policy labores_write  on public.labores for insert with check (public.fn_tiene_permiso('catalogo_labores','create'));
create policy labores_update on public.labores for update using (public.fn_tiene_permiso('catalogo_labores','update'));
create policy labores_delete on public.labores for delete using (public.fn_es_admin());

create policy tareas_sap_select on public.tareas_sap for select using (auth.uid() is not null);
create policy tareas_sap_write  on public.tareas_sap for all using (public.fn_es_admin()) with check (public.fn_es_admin());

create policy labores_tareas_select on public.labores_tareas for select using (auth.uid() is not null);
create policy labores_tareas_write  on public.labores_tareas for all
    using (public.fn_tiene_permiso('catalogo_labores','update'))
    with check (public.fn_tiene_permiso('catalogo_labores','update'));

create policy labores_implementos_select on public.labores_implementos for select using (auth.uid() is not null);
create policy labores_implementos_write  on public.labores_implementos for all
    using (public.fn_tiene_permiso('catalogo_labores','update'))
    with check (public.fn_tiene_permiso('catalogo_labores','update'));

-- Tarifas (financiero): sólo Admin y Torre de Control las ven/gestionan;
-- el digitador de campo no necesita ni debe ver costos.
create policy tarifas_equipo_select on public.tarifas_equipo for select
    using (public.fn_es_admin() or public.fn_mi_rol() = 'TORRE_CONTROL');
create policy tarifas_equipo_write on public.tarifas_equipo for all
    using (public.fn_es_admin()) with check (public.fn_es_admin());

create policy tarifas_labor_select on public.tarifas_labor for select
    using (public.fn_es_admin() or public.fn_mi_rol() = 'TORRE_CONTROL');
create policy tarifas_labor_write on public.tarifas_labor for all
    using (public.fn_es_admin()) with check (public.fn_es_admin());

-- ---------------------------------------------------------------------
-- 4. TRANSACCIONALES — la parte crítica de seguridad
-- ---------------------------------------------------------------------

-- TICKETS
create policy tickets_select on public.tickets for select
    using (
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        or usuario_id = auth.uid()
    );

create policy tickets_insert on public.tickets for insert
    with check (
        public.fn_tiene_permiso('ticket','create')
        and usuario_id = auth.uid()   -- un digitador nunca puede crear a nombre de otro
    );

create policy tickets_update on public.tickets for update
    using (
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        or (usuario_id = auth.uid() and estado = 'ABIERTO')
    )
    with check (
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        -- el digitador no puede reabrir un ticket cerrado ni cambiar el dueño
        or (usuario_id = auth.uid())
    );

-- Nadie borra tickets vía API (ni admin): se cancelan/anulan con un estado,
-- para preservar trazabilidad hacia SAP. Si de verdad se requiere borrado
-- físico, se habilita sólo vía service_role (fuera de RLS).

-- HOROMETROS (hereda ownership del ticket padre)
create policy horometros_select on public.horometros for select
    using (
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        or exists (select 1 from public.tickets t where t.id = ticket_id and t.usuario_id = auth.uid())
    );

create policy horometros_insert on public.horometros for insert
    with check (
        public.fn_tiene_permiso('horometro','create')
        and exists (
            select 1 from public.tickets t
            where t.id = ticket_id
              and t.usuario_id = auth.uid()
              and t.estado = 'ABIERTO'
        )
    );

create policy horometros_update on public.horometros for update
    using (
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        or exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = auth.uid() and t.estado = 'ABIERTO'
        )
    );

-- REGISTROS (misma regla que horometros)
create policy registros_select on public.registros for select
    using (
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        or exists (select 1 from public.tickets t where t.id = ticket_id and t.usuario_id = auth.uid())
    );

create policy registros_insert on public.registros for insert
    with check (
        public.fn_tiene_permiso('registro','create')
        and exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = auth.uid() and t.estado = 'ABIERTO'
        )
    );

create policy registros_update on public.registros for update
    using (
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        or exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = auth.uid() and t.estado = 'ABIERTO'
        )
    );

-- REGISTRO_DETALLE (hereda de registros -> tickets)
create policy registro_detalle_select on public.registro_detalle for select
    using (
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        or exists (
            select 1 from public.registros r
            join public.tickets t on t.id = r.ticket_id
            where r.id = registro_id and t.usuario_id = auth.uid()
        )
    );

create policy registro_detalle_insert on public.registro_detalle for insert
    with check (
        public.fn_tiene_permiso('registro','create')
        and exists (
            select 1 from public.registros r
            join public.tickets t on t.id = r.ticket_id
            where r.id = registro_id and t.usuario_id = auth.uid() and t.estado = 'ABIERTO'
        )
    );

create policy registro_detalle_update on public.registro_detalle for update
    using (
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        or exists (
            select 1 from public.registros r
            join public.tickets t on t.id = r.ticket_id
            where r.id = registro_id and t.usuario_id = auth.uid() and t.estado = 'ABIERTO'
        )
    );

-- LOG_AUDITORIA: sólo lectura para Admin y Torre de Control (trazabilidad)
create policy log_auditoria_select on public.log_auditoria for select
    using (public.fn_es_admin() or public.fn_mi_rol() = 'TORRE_CONTROL');
-- Inserta sólo el propio trigger (SECURITY DEFINER), nadie más escribe aquí.

-- ---------------------------------------------------------------------
-- 5. Notas de implementación
-- ---------------------------------------------------------------------
-- * Ningún rol tiene policy "for delete" salvo Administrador en catálogos.
--   Esto materializa la regla "Torre de Control y Digitador nunca eliminan".
-- * El cierre de ticket (ABIERTO -> CERRADO) lo hace el propio digitador
--   mediante tickets_update (usuario_id = auth.uid()); a partir de ahí,
--   horometros_update/registros_update ya no lo dejan tocar nada porque
--   exigen estado = 'ABIERTO'. Sólo Admin/Torre de Control pueden seguir
--   editando un ticket cerrado (para correcciones antes de notificar a SAP).
-- * Todas las funciones fn_* son SECURITY DEFINER pero de sólo LECTURA
--   sobre tablas propias del esquema; no exponen escritura oculta.
