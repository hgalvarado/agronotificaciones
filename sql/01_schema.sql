-- =====================================================================
-- AGRONOTIFICACIONES · Esquema relacional para Supabase (PostgreSQL)
-- Migración desde AppSheet / Google Sheets
-- Autor: Arquitectura propuesta - Claude
-- =====================================================================
-- Convenciones:
--   * PK: uuid default gen_random_uuid() (requiere extensión pgcrypto/pgcrypto o pgsodium; Supabase la trae activa)
--   * Auditoría: created_at, updated_at, created_by en todas las tablas transaccionales
--   * Catálogos: campo "activo" boolean en vez de 0/1 (mapeo directo de tu columna ESTADO)
--   * Nombres en snake_case, en español, para que el equipo de campo y Torre de Control
--     reconozcan el dominio sin traducir mentalmente.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------
-- 0. ROLES Y USUARIOS (RBAC)
-- ---------------------------------------------------------------------
-- Los usuarios se autentican con Supabase Auth (auth.users). Esta tabla
-- extiende cada usuario con su rol, departamento y estado operativo.

create table public.roles (
    id            smallint primary key,
    codigo        text not null unique,   -- 'ADMIN' | 'TORRE_CONTROL' | 'DIGITADOR'
    nombre        text not null,
    descripcion   text
);

insert into public.roles (id, codigo, nombre) values
    (1, 'ADMIN', 'Administrador'),
    (2, 'TORRE_CONTROL', 'Torre de Control'),
    (3, 'DIGITADOR', 'Digitador de Campo');

create table public.perfiles (
    id             uuid primary key references auth.users(id) on delete cascade,
    nombre         text not null,
    rol_id         smallint not null references public.roles(id),
    departamento   text,                 -- ej. 'Mecanizacion', 'FitoProteccion' (ex USUARIOS.DEPARTAMENTO)
    whatsapp       text,
    activo         boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
comment on table public.perfiles is 'Extiende auth.users con rol y departamento operativo (reemplaza hoja USUARIOS).';

-- Permisos granulares por pantalla/acción -> alimenta el panel administrativo
create table public.permisos (
    id           bigint generated always as identity primary key,
    rol_id       smallint not null references public.roles(id),
    recurso      text not null,   -- ej. 'catalogo_equipos', 'ticket', 'horometro', 'registro', 'catalogo_operadores'
    accion       text not null,   -- 'create' | 'read' | 'update' | 'delete'
    unique (rol_id, recurso, accion)
);
comment on table public.permisos is 'Matriz rol x recurso x acción. Editable desde el panel admin sin tocar código.';

-- Semilla de permisos según los requerimientos del negocio
insert into public.permisos (rol_id, recurso, accion)
select r.id, x.recurso, x.accion
from public.roles r
cross join (values
    -- Administrador: todo, en todos los recursos (se resuelve con bypass en la función has_permission)
    -- Torre de Control
    ('TORRE_CONTROL','ticket','read'), ('TORRE_CONTROL','ticket','update'),
    ('TORRE_CONTROL','horometro','read'), ('TORRE_CONTROL','horometro','update'),
    ('TORRE_CONTROL','registro','read'), ('TORRE_CONTROL','registro','update'),
    ('TORRE_CONTROL','catalogo_ubicaciones','create'), ('TORRE_CONTROL','catalogo_ubicaciones','update'),
    ('TORRE_CONTROL','catalogo_equipos','create'), ('TORRE_CONTROL','catalogo_equipos','update'),
    ('TORRE_CONTROL','catalogo_implementos','create'), ('TORRE_CONTROL','catalogo_implementos','update'),
    ('TORRE_CONTROL','catalogo_operadores','create'), ('TORRE_CONTROL','catalogo_operadores','update'),
    ('TORRE_CONTROL','catalogo_labores','create'), ('TORRE_CONTROL','catalogo_labores','update'),
    -- Digitador (campo)
    ('DIGITADOR','ticket','create'), ('DIGITADOR','ticket','read'), ('DIGITADOR','ticket','update'),
    ('DIGITADOR','horometro','create'), ('DIGITADOR','horometro','read'), ('DIGITADOR','horometro','update'),
    ('DIGITADOR','registro','create'), ('DIGITADOR','registro','read'), ('DIGITADOR','registro','update'),
    ('DIGITADOR','catalogo_operadores','create'),
    ('DIGITADOR','catalogo_implementos','create')
) as x(rol_codigo, recurso, accion)
where r.codigo = x.rol_codigo;

-- ---------------------------------------------------------------------
-- 1. CATÁLOGOS MAESTROS
-- ---------------------------------------------------------------------

create table public.temporadas (
    id            uuid primary key default gen_random_uuid(),
    nombre        text not null,               -- 'Temp. 25-26'
    fecha_inicio  date not null,
    fecha_fin     date not null,
    activa        boolean not null default false,
    unique (nombre)
);
-- Regla: sólo una temporada activa a la vez (se aplica con trigger más abajo)

create table public.zonas (
    id                 uuid primary key default gen_random_uuid(),
    nombre             text not null,          -- '1', '2A', '2B'...
    responsable        text,
    correo_electronico text,
    telefono           text,
    activo             boolean not null default true,
    unique (nombre)
);

-- Lote físico (permanente) separado de su configuración por temporada.
-- Mejora respecto al modelo actual: en AppSheet cada temporada duplica el lote
-- con área y zona propias; aquí el lote es un objeto estable y sus atributos
-- variables por ciclo (área, zona, estado) viven en lotes_temporada.
create table public.lotes (
    id            uuid primary key default gen_random_uuid(),
    nomenclatura  text not null unique,   -- '1001-010'
    nombre        text,                    -- 'Carretillo'
    activo        boolean not null default true
);

create table public.lotes_temporada (
    id             uuid primary key default gen_random_uuid(),
    lote_id        uuid not null references public.lotes(id),
    temporada_id   uuid not null references public.temporadas(id),
    zona_id        uuid references public.zonas(id),
    area_bruta     numeric(10,2),
    area_neta      numeric(10,2) not null check (area_neta >= 0),
    activo         boolean not null default true,
    unique (lote_id, temporada_id)
);
comment on table public.lotes_temporada is 'Área y zona vigente de cada lote en cada temporada (reemplaza UBICACIONES TECNICAS).';

create table public.familias_equipo (
    id      uuid primary key default gen_random_uuid(),
    nombre  text not null unique     -- 'DVJD-F01'
);

create table public.categorias_equipo (
    id             uuid primary key default gen_random_uuid(),
    tipo           text not null,     -- 'Equipos'
    categoria      text not null,     -- 'Tractores'
    subcategoria   text,
    ciclo_horas    integer            -- intervalo de mantenimiento (ex Categorias.Ciclos)
);

create table public.equipos (
    id              uuid primary key default gen_random_uuid(),
    codigo          text not null unique,      -- 'A08' (código operativo corto, visible en campo)
    nombre          text not null,             -- 'T2450-A08'
    familia_id      uuid references public.familias_equipo(id),
    categoria_id    uuid references public.categorias_equipo(id),
    distrito        text,                       -- 'DV'
    en_mantenimiento boolean not null default false,
    visible_app     boolean not null default true,  -- ex "Enlistar"
    activo          boolean not null default true,
    comentario      text
);
create index on public.equipos (codigo);

create table public.implementos (
    id          uuid primary key default gen_random_uuid(),
    codigo      text not null unique,     -- 'DVIM-SB1'
    nombre      text not null,
    comentario  text,
    activo      boolean not null default true
);

create table public.operadores (
    id       uuid primary key default gen_random_uuid(),
    codigo   text,                 -- '001251'
    nombre   text not null,
    activo   boolean not null default true
);

create table public.categorias_labor (
    id       uuid primary key default gen_random_uuid(),
    nombre   text not null unique,   -- 'Preparación de Tierra'  (catálogo NUEVO solicitado)
    activo   boolean not null default true
);

create table public.labores (
    id                 uuid primary key default gen_random_uuid(),
    nombre             text not null,          -- 'Romplow'
    categoria_labor_id uuid references public.categorias_labor(id),
    activo             boolean not null default true,
    created_by         uuid references public.perfiles(id),
    unique (nombre)
);

create table public.tareas_sap (
    id          uuid primary key default gen_random_uuid(),
    codigo      text not null unique,   -- 'T100'
    nombre      text not null,          -- 'Preparacion de tierras'
    ejecucion   text,                   -- 'ANTES DE TRASPLANTE'
    activo      boolean not null default true
);

-- Relaciones muchos-a-muchos exigidas por la regla de negocio:
-- cada labor tiene N tareas SAP posibles y N implementos permitidos
create table public.labores_tareas (
    labor_id  uuid not null references public.labores(id) on delete cascade,
    tarea_id  uuid not null references public.tareas_sap(id) on delete cascade,
    primary key (labor_id, tarea_id)
);

create table public.labores_implementos (
    labor_id       uuid not null references public.labores(id) on delete cascade,
    implemento_id  uuid not null references public.implementos(id) on delete cascade,
    primary key (labor_id, implemento_id)
);

-- ---------------------------------------------------------------------
-- 2. MÓDULO FINANCIERO (tarifas) — NUEVO
-- ---------------------------------------------------------------------
-- Se versiona por vigencia para poder recalcular costos históricos sin
-- perder la tarifa que aplicaba en el momento del registro.

create table public.tarifas_equipo (
    id              uuid primary key default gen_random_uuid(),
    equipo_id       uuid not null references public.equipos(id),
    costo_hora      numeric(12,2) not null check (costo_hora >= 0),
    moneda          text not null default 'HNL',
    vigente_desde   date not null,
    vigente_hasta   date,
    created_by      uuid references public.perfiles(id),
    created_at      timestamptz not null default now()
);
create index on public.tarifas_equipo (equipo_id, vigente_desde);

create table public.tarifas_labor (
    id              uuid primary key default gen_random_uuid(),
    labor_id        uuid not null references public.labores(id),
    unidad          text not null check (unidad in ('hora','mz')),
    costo_unidad    numeric(12,2) not null check (costo_unidad >= 0),
    moneda          text not null default 'HNL',
    vigente_desde   date not null,
    vigente_hasta   date,
    created_by      uuid references public.perfiles(id),
    created_at      timestamptz not null default now()
);
create index on public.tarifas_labor (labor_id, vigente_desde);

-- ---------------------------------------------------------------------
-- 3. FLUJO TRANSACCIONAL (core)
-- ---------------------------------------------------------------------

create type public.estado_ticket as enum ('ABIERTO', 'CERRADO');
create type public.turno_tipo    as enum ('DIURNO', 'NOCTURNO');

create table public.tickets (
    id             uuid primary key default gen_random_uuid(),
    codigo         text not null unique,     -- 'flazo-28-08-2024-[1]' generado igual que hoy
    fecha          date not null,
    usuario_id     uuid not null references public.perfiles(id),
    departamento   text,
    estado         public.estado_ticket not null default 'ABIERTO',
    temporada_id   uuid references public.temporadas(id),
    cerrado_at     timestamptz,
    cerrado_by     uuid references public.perfiles(id),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index on public.tickets (usuario_id, estado);

create table public.horometros (
    id                  uuid primary key default gen_random_uuid(),
    ticket_id           uuid not null references public.tickets(id) on delete cascade,
    fecha               date not null,
    turno               public.turno_tipo not null,
    equipo_id           uuid not null references public.equipos(id),
    horometro_inicial   numeric(12,2) not null,
    horometro_final     numeric(12,2) not null,
    horas_maquina       numeric(10,2) generated always as (horometro_final - horometro_inicial) stored,
    horas_hombre        numeric(10,2),
    operador_id         uuid references public.operadores(id),
    comentario          text,
    usuario_id          uuid not null references public.perfiles(id),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    constraint horometro_final_mayor check (horometro_final >= horometro_inicial)
);
create index on public.horometros (ticket_id);
create index on public.horometros (equipo_id, fecha);

create table public.registros (
    id              uuid primary key default gen_random_uuid(),
    ticket_id       uuid not null references public.tickets(id) on delete cascade,
    horometro_id    uuid not null references public.horometros(id) on delete cascade,
    temporada_id    uuid references public.temporadas(id),
    fecha           date not null,
    labor_id        uuid not null references public.labores(id),
    tarea_id        uuid not null references public.tareas_sap(id),
    implemento_id   uuid references public.implementos(id),
    comentarios     text,
    usuario_id      uuid not null references public.perfiles(id),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index on public.registros (horometro_id);
create index on public.registros (ticket_id);
create index on public.registros (labor_id);

create table public.registro_detalle (
    id                uuid primary key default gen_random_uuid(),
    registro_id       uuid not null references public.registros(id) on delete cascade,
    lote_temporada_id uuid not null references public.lotes_temporada(id),
    avance_mz         numeric(10,2) check (avance_mz >= 0),   -- opcional (puede ser null)
    comentarios       text,
    fecha             date not null,
    usuario_id        uuid not null references public.perfiles(id),
    created_at        timestamptz not null default now()
);
create index on public.registro_detalle (registro_id);
create index on public.registro_detalle (lote_temporada_id);

-- ---------------------------------------------------------------------
-- 4. AUDITORÍA GENÉRICA (reemplaza LOG_HOROMETROS y lo extiende a todo)
-- ---------------------------------------------------------------------

create table public.log_auditoria (
    id              bigint generated always as identity primary key,
    tabla           text not null,
    registro_id     uuid not null,
    campo           text not null,
    valor_anterior  text,
    valor_nuevo     text,
    accion          text not null,       -- 'INSERT' | 'UPDATE' | 'DELETE'
    usuario_id      uuid references public.perfiles(id),
    ticket_id       uuid references public.tickets(id),
    fecha_cambio    timestamptz not null default now()
);
create index on public.log_auditoria (tabla, registro_id);

-- Trigger genérico de auditoría para horometros (el caso pedido explícitamente,
-- ya existía como hoja LOG_HOROMETROS). Se puede replicar a registros/tickets.
create or replace function public.fn_audit_horometros() returns trigger
language plpgsql security definer as $$
declare
    v_campo text;
begin
    if tg_op = 'UPDATE' then
        if old.horometro_inicial is distinct from new.horometro_inicial then
            insert into public.log_auditoria(tabla, registro_id, campo, valor_anterior, valor_nuevo, accion, usuario_id, ticket_id)
            values ('horometros', new.id, 'horometro_inicial', old.horometro_inicial::text, new.horometro_inicial::text, 'UPDATE', auth.uid(), new.ticket_id);
        end if;
        if old.horometro_final is distinct from new.horometro_final then
            insert into public.log_auditoria(tabla, registro_id, campo, valor_anterior, valor_nuevo, accion, usuario_id, ticket_id)
            values ('horometros', new.id, 'horometro_final', old.horometro_final::text, new.horometro_final::text, 'UPDATE', auth.uid(), new.ticket_id);
        end if;
        if old.equipo_id is distinct from new.equipo_id then
            insert into public.log_auditoria(tabla, registro_id, campo, valor_anterior, valor_nuevo, accion, usuario_id, ticket_id)
            values ('horometros', new.id, 'equipo_id', old.equipo_id::text, new.equipo_id::text, 'UPDATE', auth.uid(), new.ticket_id);
        end if;
    end if;
    return new;
end;
$$;

create trigger trg_audit_horometros
after update on public.horometros
for each row execute function public.fn_audit_horometros();

-- Garantiza una sola temporada activa
create or replace function public.fn_unica_temporada_activa() returns trigger
language plpgsql as $$
begin
    if new.activa then
        update public.temporadas set activa = false where id <> new.id;
    end if;
    return new;
end;
$$;
create trigger trg_unica_temporada_activa
before insert or update on public.temporadas
for each row execute function public.fn_unica_temporada_activa();

-- updated_at automático
create or replace function public.fn_touch_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;
create trigger trg_touch_tickets before update on public.tickets for each row execute function public.fn_touch_updated_at();
create trigger trg_touch_horometros before update on public.horometros for each row execute function public.fn_touch_updated_at();
create trigger trg_touch_registros before update on public.registros for each row execute function public.fn_touch_updated_at();
