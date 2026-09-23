-- =====================================================================
-- 47 · Telecomunicaciones: líneas, equipos y a quién los tiene
--
-- Ejecutar en el SQL Editor DESPUÉS de la 46.
--
-- Tres cosas que hasta ahora vivían en un Excel: los NÚMEROS que paga la
-- empresa, los EQUIPOS que compró y QUIÉN tiene cada cosa ahora mismo.
--
-- La idea que sostiene el diseño: una línea y un equipo son cosas
-- duraderas —el número 9999-9999 sigue siendo el mismo aunque pase por
-- seis personas— y la asignación es un HECHO con fecha de principio y de
-- fin. Por eso la asignación es una tabla aparte y no tres columnas en
-- la línea: guardar «a quién se le dio» dentro de la línea borra al
-- anterior cada vez, y entonces no hay historial que consultar.
--
-- De ahí sale todo lo demás:
--   · el estado de la línea y del equipo NO se teclea: lo pone un
--     disparador a partir de las asignaciones vigentes, y así no puede
--     decir «Disponible» algo que alguien tiene en el bolsillo;
--   · una línea y un equipo tienen COMO MUCHO una asignación vigente, y
--     eso lo garantiza un índice, no la buena voluntad de la pantalla;
--   · el historial es la propia tabla leída al revés.
-- =====================================================================

-- =====================================================================
-- PARTE A · Quién puede recibir un equipo
--
-- El catálogo de `operadores` era de operadores de maquinaria. El
-- teléfono también lo llevan contadores, jefes de zona y gerencia, y
-- crear un segundo catálogo de personas sería tener dos listas del mismo
-- señor que se desincronizan al primer cambio de puesto.
-- =====================================================================

do $$
begin
    if not exists (select 1 from pg_type where typname = 'tipo_perfil') then
        create type public.tipo_perfil as enum ('OPERADOR', 'ADMINISTRATIVO');
    end if;
end $$;

-- Es un ARRAY y no un valor suelto: el mismo señor puede manejar el
-- tractor y llevar el teléfono de la finca, y obligarle a ser una cosa
-- sola lo sacaría de una de las dos listas.
alter table public.operadores
    add column if not exists tipo_perfil public.tipo_perfil[]
        not null default array['OPERADOR']::public.tipo_perfil[];

comment on column public.operadores.tipo_perfil is
'Para qué listas sirve esta persona. OPERADOR: maneja equipo y sale en la captura de labores. ADMINISTRATIVO: recibe línea o teléfono. Puede ser las dos cosas.';

create index if not exists operadores_tipo_perfil_idx
    on public.operadores using gin (tipo_perfil);

/**
 * El catálogo de personas, con su perfil legible.
 *
 * Es la misma tabla `operadores` vista con el nombre que le corresponde
 * ahora que no sólo guarda operadores. Los módulos nuevos leen de aquí;
 * los viejos siguen leyendo `operadores` y nada se rompe.
 */
create or replace view public.catalogo_personal as
select o.id,
       o.codigo,
       o.nombre,
       o.tipo_perfil,
       'OPERADOR'       = any(o.tipo_perfil) as es_operador,
       'ADMINISTRATIVO' = any(o.tipo_perfil) as es_administrativo,
       o.activo
from public.operadores o;

alter view public.catalogo_personal set (security_invoker = on);
grant select on public.catalogo_personal to authenticated;

-- =====================================================================
-- PARTE B · Catálogo de planes
--
-- El «Plan $1» no se reconoce por su nombre: se marca con una bandera.
-- Buscarlo por texto significa que el día que Tigo lo llame «Plan
-- Retención L1» el botón deja de encontrarlo sin avisar.
-- =====================================================================

create table if not exists public.telecom_planes (
    id            uuid primary key default gen_random_uuid(),
    nombre        text not null unique,
    proveedor     text,
    costo_mensual numeric(10,2),
    /** El plan mínimo con el que se retiene el número sin usarlo. */
    es_retencion  boolean not null default false,
    activo        boolean not null default true
);

comment on column public.telecom_planes.es_retencion is
'El plan barato con el que se conserva el número cuando ya nadie lo usa. Se marca aquí y no se busca por nombre: el proveedor le cambia el nombre y el botón dejaría de encontrarlo.';

-- Uno solo puede ser el de retención: con dos, «pasar a Plan $1» no
-- sabría a cuál mover y elegiría el primero que encontrara.
create unique index if not exists telecom_planes_retencion_idx
    on public.telecom_planes (es_retencion) where es_retencion;

-- =====================================================================
-- PARTE C · Líneas y equipos
-- =====================================================================

do $$
begin
    if not exists (select 1 from pg_type where typname = 'estado_linea') then
        create type public.estado_linea as enum ('DISPONIBLE', 'ASIGNADA', 'SUSPENDIDA');
    end if;
    if not exists (select 1 from pg_type where typname = 'estado_equipo') then
        create type public.estado_equipo as enum ('EN_BODEGA', 'ASIGNADO', 'DANADO');
    end if;
    if not exists (select 1 from pg_type where typname = 'estado_asignacion') then
        create type public.estado_asignacion as enum ('VIGENTE', 'FINALIZADA');
    end if;
end $$;

create table if not exists public.telecom_lineas (
    -- El número ES la llave. Es lo que la gente dice, lo que factura el
    -- proveedor y lo que se conserva al cambiar de persona.
    numero        text primary key,
    proveedor     text,
    plan_id       uuid references public.telecom_planes(id),
    estado        public.estado_linea not null default 'DISPONIBLE',
    observaciones text,
    activo        boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

comment on table public.telecom_lineas is
'Los números que paga la empresa. El estado NO se teclea: lo mantiene un disparador a partir de las asignaciones vigentes.';

create table if not exists public.telecom_equipos (
    imei          text primary key,
    marca_modelo  text not null,
    ram           text,
    almacenamiento text,
    fecha_compra  date,
    -- Dieciocho meses desde la compra, calculados por la base. Como
    -- columna generada no hay forma de que una pantalla la guarde mal ni
    -- de que dos sitios la calculen distinto.
    fecha_renovacion date generated always as
        ((fecha_compra + interval '18 months')::date) stored,
    estado        public.estado_equipo not null default 'EN_BODEGA',
    observaciones text,
    activo        boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

comment on column public.telecom_equipos.fecha_renovacion is
'Compra + 18 meses. Generada: ni se teclea ni se puede desincronizar de la fecha de compra.';

create index if not exists telecom_equipos_renovacion_idx
    on public.telecom_equipos (fecha_renovacion);

-- =====================================================================
-- PARTE D · Las asignaciones, que son el historial
-- =====================================================================

create table if not exists public.telecom_asignaciones (
    id                          uuid primary key default gen_random_uuid(),
    empleado_id                 uuid not null references public.operadores(id),
    linea_numero                text references public.telecom_lineas(numero) on update cascade,
    equipo_imei                 text references public.telecom_equipos(imei) on update cascade,
    fecha_entrega               date not null default (now() at time zone 'America/Tegucigalpa')::date,
    /** Cuándo toca devolverlo. Nulo en contratos indefinidos. */
    fecha_devolucion_programada date,
    fecha_devolucion_real       date,
    centro_costo                text,
    departamento                text,
    puesto                      text,
    correo_asignado             text,
    /** Cargador, audífonos, forro… Lista abierta: cada entrega trae lo suyo. */
    accesorios_entregados       jsonb not null default '[]'::jsonb,
    observaciones               text,
    estado                      public.estado_asignacion not null default 'VIGENTE',
    usuario_id                  uuid references public.perfiles(id),
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now(),

    -- Una asignación sin línea y sin equipo no asigna nada.
    constraint telecom_asignacion_con_algo
        check (linea_numero is not null or equipo_imei is not null),
    -- Devolver antes de entregar no es una fecha: es un error de dedo.
    constraint telecom_asignacion_fechas
        check (fecha_devolucion_real is null or fecha_devolucion_real >= fecha_entrega),
    -- Finalizada sin fecha de devolución deja el historial cojo.
    constraint telecom_asignacion_cierre
        check (estado <> 'FINALIZADA' or fecha_devolucion_real is not null)
);

comment on table public.telecom_asignaciones is
'Quién tuvo qué y desde cuándo. Es la tabla del historial: no se corrige la anterior al entregar a otro, se cierra y se abre una nueva.';

-- Una línea y un equipo tienen COMO MUCHO una asignación vigente. Va
-- como índice y no como comprobación en la pantalla: dos personas con el
-- mismo teléfono es justo el error que este módulo viene a impedir.
create unique index if not exists telecom_una_linea_vigente
    on public.telecom_asignaciones (linea_numero)
    where estado = 'VIGENTE' and linea_numero is not null;

create unique index if not exists telecom_un_equipo_vigente
    on public.telecom_asignaciones (equipo_imei)
    where estado = 'VIGENTE' and equipo_imei is not null;

create index if not exists telecom_asignaciones_empleado_idx
    on public.telecom_asignaciones (empleado_id, fecha_entrega desc);

create index if not exists telecom_asignaciones_devolucion_idx
    on public.telecom_asignaciones (fecha_devolucion_programada)
    where estado = 'VIGENTE';

drop trigger if exists trg_telecom_lineas_updated on public.telecom_lineas;
create trigger trg_telecom_lineas_updated before update on public.telecom_lineas
    for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_telecom_equipos_updated on public.telecom_equipos;
create trigger trg_telecom_equipos_updated before update on public.telecom_equipos
    for each row execute function public.fn_touch_updated_at();

drop trigger if exists trg_telecom_asignaciones_updated on public.telecom_asignaciones;
create trigger trg_telecom_asignaciones_updated before update on public.telecom_asignaciones
    for each row execute function public.fn_touch_updated_at();

-- ---------------------------------------------------------------------
-- El estado de la línea y del equipo se DEDUCE
--
-- Nadie lo teclea. Si lo tecleara alguien, tarde o temprano habría una
-- línea «Disponible» que está en el bolsillo de un jefe de zona, y esa
-- es la clase de dato que hace que se compre un número de más.
--
-- «Suspendida» y «Dañado» sí son decisiones humanas y por eso el
-- disparador no las pisa: una línea suspendida sigue suspendida aunque
-- su asignación se cierre.
-- ---------------------------------------------------------------------
create or replace function public.fn_telecom_sincronizar_estados()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
    v_lineas text[];
    v_equipos text[];
    t text;
begin
    v_lineas  := array_remove(array[new.linea_numero, old.linea_numero], null);
    v_equipos := array_remove(array[new.equipo_imei,  old.equipo_imei],  null);

    foreach t in array coalesce(v_lineas, '{}')
    loop
        update public.telecom_lineas l
        set estado = case
                when l.estado = 'SUSPENDIDA' then 'SUSPENDIDA'::public.estado_linea
                when exists (select 1 from public.telecom_asignaciones a
                             where a.linea_numero = t and a.estado = 'VIGENTE')
                    then 'ASIGNADA'::public.estado_linea
                else 'DISPONIBLE'::public.estado_linea
            end
        where l.numero = t;
    end loop;

    foreach t in array coalesce(v_equipos, '{}')
    loop
        update public.telecom_equipos e
        set estado = case
                when e.estado = 'DANADO' then 'DANADO'::public.estado_equipo
                when exists (select 1 from public.telecom_asignaciones a
                             where a.equipo_imei = t and a.estado = 'VIGENTE')
                    then 'ASIGNADO'::public.estado_equipo
                else 'EN_BODEGA'::public.estado_equipo
            end
        where e.imei = t;
    end loop;

    return null;
end $$;

-- El borrado necesita `old` y no `new`, así que va en su propia función
-- en vez de llenar la anterior de comprobaciones de `tg_op`.
create or replace function public.fn_telecom_sincronizar_borrado()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
    if old.linea_numero is not null then
        update public.telecom_lineas l
        set estado = case
                when l.estado = 'SUSPENDIDA' then 'SUSPENDIDA'::public.estado_linea
                when exists (select 1 from public.telecom_asignaciones a
                             where a.linea_numero = old.linea_numero and a.estado = 'VIGENTE')
                    then 'ASIGNADA'::public.estado_linea
                else 'DISPONIBLE'::public.estado_linea
            end
        where l.numero = old.linea_numero;
    end if;
    if old.equipo_imei is not null then
        update public.telecom_equipos e
        set estado = case
                when e.estado = 'DANADO' then 'DANADO'::public.estado_equipo
                when exists (select 1 from public.telecom_asignaciones a
                             where a.equipo_imei = old.equipo_imei and a.estado = 'VIGENTE')
                    then 'ASIGNADO'::public.estado_equipo
                else 'EN_BODEGA'::public.estado_equipo
            end
        where e.imei = old.equipo_imei;
    end if;
    return null;
end $$;

drop trigger if exists trg_telecom_sincronizar on public.telecom_asignaciones;
create trigger trg_telecom_sincronizar
    after insert or update on public.telecom_asignaciones
    for each row execute function public.fn_telecom_sincronizar_estados();

drop trigger if exists trg_telecom_sincronizar_borrado on public.telecom_asignaciones;
create trigger trg_telecom_sincronizar_borrado
    after delete on public.telecom_asignaciones
    for each row execute function public.fn_telecom_sincronizar_borrado();

-- =====================================================================
-- PARTE E · Las dos acciones rápidas
-- =====================================================================

/**
 * Cierra una asignación vigente.
 *
 * No borra nada: pone la fecha real de devolución y la pasa a
 * FINALIZADA. La línea y el equipo vuelven solos a estar disponibles
 * —de eso se encarga el disparador— y la asignación se queda en el
 * historial, que es para lo que existe.
 */
create or replace function public.fn_telecom_finalizar_asignacion(
    p_id    uuid,
    p_fecha date default null
) returns public.telecom_asignaciones
language plpgsql
set search_path = public, pg_temp as $$
declare v_fila public.telecom_asignaciones;
begin
    update public.telecom_asignaciones
    set estado = 'FINALIZADA',
        fecha_devolucion_real = coalesce(
            p_fecha, (now() at time zone 'America/Tegucigalpa')::date)
    where id = p_id and estado = 'VIGENTE'
    returning * into v_fila;

    if v_fila.id is null then
        raise exception 'Esa asignación ya está finalizada o no existe.';
    end if;
    return v_fila;
end $$;

grant execute on function public.fn_telecom_finalizar_asignacion(uuid, date) to authenticated;

/**
 * Pasa una línea al plan de retención («Plan $1»).
 *
 * Es lo que se hace cuando alguien se va y el número hay que conservarlo
 * sin pagar el plan completo. Busca el plan por su BANDERA, no por su
 * nombre: el proveedor le cambia el nombre cada temporada.
 */
create or replace function public.fn_telecom_pasar_a_retencion(p_numero text)
returns public.telecom_lineas
language plpgsql
set search_path = public, pg_temp as $$
declare
    v_plan uuid;
    v_fila public.telecom_lineas;
begin
    select id into v_plan from public.telecom_planes
    where es_retencion and activo limit 1;

    if v_plan is null then
        raise exception 'No hay ningún plan marcado como «de retención». Marca el Plan $1 en el catálogo de planes.';
    end if;

    update public.telecom_lineas
    set plan_id = v_plan
    where numero = p_numero
    returning * into v_fila;

    if v_fila.numero is null then
        raise exception 'Esa línea no existe.';
    end if;
    return v_fila;
end $$;

grant execute on function public.fn_telecom_pasar_a_retencion(text) to authenticated;

-- =====================================================================
-- PARTE F · Lo que leen las pantallas
-- =====================================================================

create or replace view public.v_telecom_lineas as
select l.numero,
       l.proveedor,
       l.plan_id,
       p.nombre        as plan_nombre,
       p.costo_mensual as plan_costo,
       p.es_retencion  as plan_es_retencion,
       l.estado,
       l.observaciones,
       l.activo,
       a.id            as asignacion_id,
       a.empleado_id,
       o.nombre        as asignada_a,
       o.codigo        as codigo_empleado,
       a.fecha_entrega,
       a.fecha_devolucion_programada
from public.telecom_lineas l
left join public.telecom_planes p on p.id = l.plan_id
left join public.telecom_asignaciones a
       on a.linea_numero = l.numero and a.estado = 'VIGENTE'
left join public.operadores o on o.id = a.empleado_id;

alter view public.v_telecom_lineas set (security_invoker = on);
grant select on public.v_telecom_lineas to authenticated;

create or replace view public.v_telecom_equipos as
select e.imei,
       e.marca_modelo,
       e.ram,
       e.almacenamiento,
       e.fecha_compra,
       e.fecha_renovacion,
       e.estado,
       e.observaciones,
       e.activo,
       -- Días que faltan para la renovación. Negativo: ya tocaba.
       (e.fecha_renovacion - (now() at time zone 'America/Tegucigalpa')::date)
           as dias_para_renovacion,
       a.id       as asignacion_id,
       a.empleado_id,
       o.nombre   as asignado_a,
       o.codigo   as codigo_empleado,
       a.fecha_entrega
from public.telecom_equipos e
left join public.telecom_asignaciones a
       on a.equipo_imei = e.imei and a.estado = 'VIGENTE'
left join public.operadores o on o.id = a.empleado_id;

alter view public.v_telecom_equipos set (security_invoker = on);
grant select on public.v_telecom_equipos to authenticated;

create or replace view public.v_telecom_asignaciones as
select a.id,
       a.empleado_id,
       o.nombre   as empleado,
       o.codigo   as codigo_empleado,
       a.linea_numero,
       l.proveedor      as linea_proveedor,
       pl.nombre        as plan_nombre,
       pl.es_retencion  as plan_es_retencion,
       a.equipo_imei,
       e.marca_modelo,
       e.ram,
       e.almacenamiento,
       a.fecha_entrega,
       a.fecha_devolucion_programada,
       a.fecha_devolucion_real,
       a.centro_costo,
       a.departamento,
       a.puesto,
       a.correo_asignado,
       a.accesorios_entregados,
       a.observaciones,
       a.estado,
       pe.nombre as capturo,
       -- Días que faltan para la devolución pactada. Negativo: vencido.
       case when a.estado = 'VIGENTE' and a.fecha_devolucion_programada is not null
            then a.fecha_devolucion_programada
                 - (now() at time zone 'America/Tegucigalpa')::date
       end as dias_para_devolucion
from public.telecom_asignaciones a
join public.operadores o        on o.id = a.empleado_id
left join public.telecom_lineas l  on l.numero = a.linea_numero
left join public.telecom_planes pl on pl.id = l.plan_id
left join public.telecom_equipos e on e.imei = a.equipo_imei
left join public.perfiles pe       on pe.id = a.usuario_id;

alter view public.v_telecom_asignaciones set (security_invoker = on);
grant select on public.v_telecom_asignaciones to authenticated;

/**
 * Las alertas del tablero.
 *
 * Dos, y las dos son «se venció algo o está por vencerse»: el contrato
 * temporal que hay que ir a recoger y el equipo al que ya le tocaba
 * renovación. Una sola vista para las dos porque la pantalla las pinta
 * igual y ordenarlas juntas por urgencia es lo que se quiere leer.
 *
 * El «hoy» es el de Honduras (UTC-6) y no el del servidor: a las seis de
 * la tarde de Tegucigalpa el reloj UTC ya es del día siguiente, y una
 * alerta que aparece medio día antes se aprende a ignorar.
 */
create or replace view public.v_telecom_alertas as
select 'DEVOLUCION'::text as tipo,
       a.id::text         as llave,
       o.nombre           as quien,
       coalesce(a.equipo_imei, a.linea_numero) as que,
       coalesce(e.marca_modelo, 'Línea ' || a.linea_numero) as detalle,
       a.fecha_devolucion_programada as fecha,
       (a.fecha_devolucion_programada
        - (now() at time zone 'America/Tegucigalpa')::date) as dias
from public.telecom_asignaciones a
join public.operadores o           on o.id = a.empleado_id
left join public.telecom_equipos e on e.imei = a.equipo_imei
where a.estado = 'VIGENTE'
  and a.fecha_devolucion_programada is not null
  and a.fecha_devolucion_programada
      <= (now() at time zone 'America/Tegucigalpa')::date + 30

union all

select 'RENOVACION',
       e.imei,
       o.nombre,
       e.imei,
       e.marca_modelo,
       e.fecha_renovacion,
       (e.fecha_renovacion - (now() at time zone 'America/Tegucigalpa')::date)
from public.telecom_equipos e
left join public.telecom_asignaciones a
       on a.equipo_imei = e.imei and a.estado = 'VIGENTE'
left join public.operadores o on o.id = a.empleado_id
where e.activo
  and e.fecha_renovacion is not null
  and e.fecha_renovacion <= (now() at time zone 'America/Tegucigalpa')::date + 30;

alter view public.v_telecom_alertas set (security_invoker = on);
grant select on public.v_telecom_alertas to authenticated;

/**
 * La línea de tiempo de una línea o de un equipo.
 *
 * Todas las personas que lo han tenido, de la más reciente a la primera.
 * Es la tabla de asignaciones leída al revés: no hace falta guardar el
 * historial aparte porque el historial ES la tabla.
 */
create or replace function public.fn_telecom_historial(
    p_tipo  text,   -- 'LINEA' | 'EQUIPO'
    p_llave text
) returns table (
    id                    uuid,
    empleado              text,
    codigo_empleado       text,
    departamento          text,
    puesto                text,
    fecha_entrega         date,
    fecha_devolucion_real date,
    dias                  integer,
    estado                public.estado_asignacion,
    observaciones         text
)
language sql stable
set search_path = public, pg_temp as $$
    select a.id,
           o.nombre,
           o.codigo,
           a.departamento,
           a.puesto,
           a.fecha_entrega,
           a.fecha_devolucion_real,
           (coalesce(a.fecha_devolucion_real,
                     (now() at time zone 'America/Tegucigalpa')::date)
            - a.fecha_entrega)::integer,
           a.estado,
           a.observaciones
    from public.telecom_asignaciones a
    join public.operadores o on o.id = a.empleado_id
    where (upper(p_tipo) = 'LINEA'  and a.linea_numero = p_llave)
       or (upper(p_tipo) = 'EQUIPO' and a.equipo_imei  = p_llave)
    order by a.fecha_entrega desc, a.created_at desc
$$;

grant execute on function public.fn_telecom_historial(text, text) to authenticated;

-- =====================================================================
-- PARTE G · Permisos
--
-- Todo pasa por la matriz. Ni un nombre de rol escrito aquí: si la
-- pantalla dice que el rol puede editar, la base lo deja.
-- =====================================================================

alter table public.telecom_planes       enable row level security;
alter table public.telecom_lineas       enable row level security;
alter table public.telecom_equipos      enable row level security;
alter table public.telecom_asignaciones enable row level security;

do $$
declare t text;
begin
    foreach t in array array['telecom_planes','telecom_lineas','telecom_equipos','telecom_asignaciones']
    loop
        execute format('drop policy if exists %1$s_select on public.%1$I', t);
        execute format(
            'create policy %1$s_select on public.%1$I for select using ((select public.fn_tiene_permiso(''telecom'',''ver'')))', t);

        execute format('drop policy if exists %1$s_insert on public.%1$I', t);
        execute format(
            'create policy %1$s_insert on public.%1$I for insert with check ((select public.fn_tiene_permiso(''telecom'',''crear'')))', t);

        execute format('drop policy if exists %1$s_update on public.%1$I', t);
        execute format(
            'create policy %1$s_update on public.%1$I for update using ((select public.fn_tiene_permiso(''telecom'',''editar'')))', t);

        execute format('drop policy if exists %1$s_delete on public.%1$I', t);
        execute format(
            'create policy %1$s_delete on public.%1$I for delete using ((select public.fn_tiene_permiso(''telecom'',''eliminar'')))', t);

        execute format('grant select, insert, update, delete on public.%1$I to authenticated', t);
    end loop;
end $$;

-- La pantalla, en la matriz de permisos. Con TODAS sus acciones: una
-- restricción que la base exige y la matriz no ofrece es una llave
-- escondida, y `fn_permisos_sin_casilla()` la denuncia.
insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('telecom', 'Telecomunicaciones',
     'Líneas, equipos celulares y a quién los tiene asignados',
     '/telecom', 58,
     array['ver','crear','editar','eliminar','exportar','importar'])
on conflict (codigo) do update
set nombre      = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta        = excluded.ruta,
    orden       = excluded.orden,
    acciones    = excluded.acciones;

-- Quien ya administra los catálogos administra también éste: es el
-- mismo trabajo de mantener listas. Se concede por lo que el rol YA
-- puede hacer, no por su nombre.
insert into public.permisos (rol_id, recurso, accion)
select distinct p.rol_id, 'telecom', p.accion
from public.permisos p
where p.recurso = 'catalogos'
  and p.accion in ('ver','crear','editar','eliminar','exportar','importar')
on conflict do nothing;

-- =====================================================================
-- PARTE H · El plan de retención, si no existe
-- =====================================================================

insert into public.telecom_planes (nombre, proveedor, costo_mensual, es_retencion, activo)
select 'Plan $1', null, 1.00, true, true
where not exists (select 1 from public.telecom_planes where es_retencion);

-- =====================================================================
-- Comprobación
-- =====================================================================
do $$
declare
    v_lineas   integer;
    v_equipos  integer;
    v_sin_casilla integer;
begin
    select count(*) into v_lineas  from public.telecom_lineas;
    select count(*) into v_equipos from public.telecom_equipos;
    select count(*) into v_sin_casilla from public.fn_permisos_sin_casilla();

    raise notice 'Migración 47 aplicada. Líneas: %, equipos: %.', v_lineas, v_equipos;
    raise notice 'La pantalla «telecom» quedó en la matriz de permisos con sus seis acciones.';

    if v_sin_casilla > 0 then
        raise warning '% llaves exigidas por la base NO tienen casilla en /admin/permisos.', v_sin_casilla;
    end if;
end $$;
