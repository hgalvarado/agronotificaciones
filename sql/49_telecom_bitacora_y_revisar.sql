-- =====================================================================
-- 49 · Bitácora de solicitudes, estado «Revisar» y puestos
--
-- Ejecutar en el SQL Editor DESPUÉS de la 48.
--
-- Tres cosas:
--   · lo que se le PIDE al proveedor —cambiar de plan, suspender, portar—
--     no dejaba rastro: se pedía por teléfono y luego nadie sabía cuándo
--     ni quién. Ahora cada solicitud queda con fecha, responsable y
--     comentario, que es lo que hace falta para reclamar;
--   · una entrega puede estar EN DUDA sin estar finalizada —el equipo no
--     aparece, el colaborador se fue sin devolverlo— y meterla en el
--     mismo saco que las vigentes la escondía;
--   · el puesto se escribía a mano y terminaba con tres redacciones del
--     mismo cargo en el mismo reporte.
-- =====================================================================

-- =====================================================================
-- PARTE A · El estado «Revisar»
--
-- Un valor nuevo en el enum, no una columna aparte: es un estado más de
-- la asignación y tenerlo como bandera suelta permitiría una fila
-- finalizada y en revisión a la vez, que no significa nada.
-- =====================================================================

-- Va entre VIGENTE y FINALIZADA: el orden del enum es el orden en que se
-- leen, y «en revisión» está en medio de las dos.
--
-- Suelta y no dentro de un `do`: `add value` no se puede USAR en la misma
-- transacción en la que se declara, así que en el resto de esta migración
-- no aparece la palabra «REVISAR» ni una vez. Lo que se pregunta es
-- `estado <> 'FINALIZADA'` —«todavía lo tiene»—, que además dice mejor lo
-- que importa: una entrega en revisión sigue teniendo el equipo fuera.
alter type public.estado_asignacion add value if not exists 'REVISAR' after 'VIGENTE';

-- =====================================================================
-- PARTE B · Catálogo de puestos
-- =====================================================================

create table if not exists public.telecom_puestos (
    id     uuid primary key default gen_random_uuid(),
    nombre text not null unique,
    activo boolean not null default true
);

comment on table public.telecom_puestos is
'Cargos de quien recibe una línea o un equipo. Catálogo y no texto libre: escrito a mano, el mismo cargo sale con tres redacciones en el mismo reporte.';

alter table public.telecom_puestos enable row level security;

do $$
declare t text;
begin
    foreach t in array array['telecom_puestos']
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

-- Los que ya se escribieron a mano, rescatados: el catálogo nace con lo
-- que la empresa ya usa en vez de en blanco.
insert into public.telecom_puestos (nombre)
select distinct btrim(a.puesto)
from public.telecom_asignaciones a
where coalesce(btrim(a.puesto), '') <> ''
on conflict (nombre) do nothing;

-- =====================================================================
-- PARTE C · La bitácora de solicitudes
--
-- Tabla y no un `jsonb` dentro de la línea: es un HECHO con fecha,
-- responsable y comentario, y se consulta por fecha y por responsable
-- —«qué le pedimos a Tigo este mes»— que dentro de un jsonb obliga a
-- recorrer todas las líneas para contestarlo.
-- =====================================================================

do $$
begin
    if not exists (select 1 from pg_type where typname = 'accion_solicitada') then
        create type public.accion_solicitada as enum (
            'CAMBIO_PLAN',
            'SUSPENSION',
            'REACTIVACION',
            'PORTABILIDAD',
            'CANCELACION',
            'REPOSICION_SIM',
            'RECLAMO',
            'OTRA'
        );
    end if;
end $$;

create table if not exists public.telecom_bitacora (
    id            uuid primary key default gen_random_uuid(),
    linea_numero  text not null references public.telecom_lineas(numero) on update cascade on delete cascade,
    -- La fecha de la SOLICITUD, en días de Honduras. Es la que se le
    -- reclama al proveedor, y por eso no es el instante del servidor.
    fecha         date not null default (now() at time zone 'America/Tegucigalpa')::date,
    accion        public.accion_solicitada not null,
    /** Lo que se pidió, con las palabras de quien lo pidió. */
    detalle       text,
    comentarios   text,
    /** Quién la pidió. Sale de la sesión, no de un campo del formulario. */
    responsable   uuid references public.perfiles(id),
    creado_en     timestamptz not null default now()
);

comment on table public.telecom_bitacora is
'Qué se le pidió al proveedor sobre cada línea y cuándo. Es el rastro con el que se reclama: sin él, un cambio de plan pedido por teléfono no existe.';

create index if not exists telecom_bitacora_linea_idx
    on public.telecom_bitacora (linea_numero, fecha desc, creado_en desc);

alter table public.telecom_bitacora enable row level security;

drop policy if exists telecom_bitacora_select on public.telecom_bitacora;
create policy telecom_bitacora_select on public.telecom_bitacora for select
    using ((select public.fn_tiene_permiso('telecom', 'ver')));

drop policy if exists telecom_bitacora_insert on public.telecom_bitacora;
create policy telecom_bitacora_insert on public.telecom_bitacora for insert
    with check ((select public.fn_tiene_permiso('telecom', 'crear')));

drop policy if exists telecom_bitacora_update on public.telecom_bitacora;
create policy telecom_bitacora_update on public.telecom_bitacora for update
    using ((select public.fn_tiene_permiso('telecom', 'editar')));

drop policy if exists telecom_bitacora_delete on public.telecom_bitacora;
create policy telecom_bitacora_delete on public.telecom_bitacora for delete
    using ((select public.fn_tiene_permiso('telecom', 'eliminar')));

grant select, insert, update, delete on public.telecom_bitacora to authenticated;

/**
 * Registra una solicitud al proveedor.
 *
 * El responsable sale de la SESIÓN y no de un parámetro: quien registra
 * es quien firma, y dejar que el formulario diga quién lo pidió vacía de
 * sentido la bitácora el día que hay que reclamar.
 */
create or replace function public.fn_telecom_registrar_solicitud(
    p_linea_numero text,
    p_accion       text,
    p_detalle      text default null,
    p_comentarios  text default null,
    p_fecha        date default null
) returns public.telecom_bitacora
language plpgsql
set search_path = public, pg_temp as $$
declare v_fila public.telecom_bitacora;
begin
    insert into public.telecom_bitacora
        (linea_numero, fecha, accion, detalle, comentarios, responsable)
    values (
        p_linea_numero,
        coalesce(p_fecha, (now() at time zone 'America/Tegucigalpa')::date),
        p_accion::public.accion_solicitada,
        nullif(btrim(coalesce(p_detalle, '')), ''),
        nullif(btrim(coalesce(p_comentarios, '')), ''),
        auth.uid()
    )
    returning * into v_fila;
    return v_fila;
end $$;

grant execute on function public.fn_telecom_registrar_solicitud(text, text, text, text, date) to authenticated;

/** La bitácora de una línea, de lo más reciente a lo más viejo. */
create or replace function public.fn_telecom_bitacora(p_linea_numero text)
returns table (
    id          uuid,
    fecha       date,
    accion      public.accion_solicitada,
    detalle     text,
    comentarios text,
    responsable text
)
language sql stable
set search_path = public, pg_temp as $$
    select b.id, b.fecha, b.accion, b.detalle, b.comentarios, pe.nombre
    from public.telecom_bitacora b
    left join public.perfiles pe on pe.id = b.responsable
    where b.linea_numero = p_linea_numero
    order by b.fecha desc, b.creado_en desc
$$;

grant execute on function public.fn_telecom_bitacora(text) to authenticated;

-- =====================================================================
-- PARTE D · «Todavía lo tiene» deja de ser «está vigente»
--
-- Con el estado nuevo, una entrega puede estar en revisión y el equipo
-- sigue fuera. Todo lo que preguntaba `estado = 'VIGENTE'` pasa a
-- preguntar `estado <> 'FINALIZADA'`, que es lo que de verdad importa:
-- si no se ha devuelto, la línea no está libre.
-- =====================================================================

drop index if exists public.telecom_una_linea_vigente;
drop index if exists public.telecom_un_equipo_vigente;

create unique index if not exists telecom_una_linea_abierta
    on public.telecom_asignaciones (linea_numero)
    where estado <> 'FINALIZADA' and linea_numero is not null;

create unique index if not exists telecom_un_equipo_abierto
    on public.telecom_asignaciones (equipo_imei)
    where estado <> 'FINALIZADA' and equipo_imei is not null;

drop index if exists public.telecom_asignaciones_devolucion_idx;
create index if not exists telecom_asignaciones_devolucion_idx
    on public.telecom_asignaciones (fecha_devolucion_programada)
    where estado <> 'FINALIZADA';

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
                             where a.linea_numero = t and a.estado <> 'FINALIZADA')
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
                             where a.equipo_imei = t and a.estado <> 'FINALIZADA')
                    then 'ASIGNADO'::public.estado_equipo
                else 'EN_BODEGA'::public.estado_equipo
            end
        where e.imei = t;
    end loop;

    return null;
end $$;

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
                             where a.linea_numero = old.linea_numero and a.estado <> 'FINALIZADA')
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
                             where a.equipo_imei = old.equipo_imei and a.estado <> 'FINALIZADA')
                    then 'ASIGNADO'::public.estado_equipo
                else 'EN_BODEGA'::public.estado_equipo
            end
        where e.imei = old.equipo_imei;
    end if;
    return null;
end $$;

-- Finalizar cierra cualquier entrega abierta, esté vigente o en revisión.
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
    where id = p_id and estado <> 'FINALIZADA'
    returning * into v_fila;

    if v_fila.id is null then
        raise exception 'Esa asignación ya está finalizada o no existe.';
    end if;
    return v_fila;
end $$;

grant execute on function public.fn_telecom_finalizar_asignacion(uuid, date) to authenticated;

-- =====================================================================
-- PARTE E · El centro de costo, con su nombre
--
-- «1020» no dice nada en un reporte que lee gerencia; «1020 - Agrícola»
-- sí. El nombre sale del catálogo y no se copia a la asignación: copiado,
-- corregir el nombre del centro dejaría las entregas viejas con el
-- anterior.
-- =====================================================================

-- Se recrean, no se reemplazan: `create or replace view` no admite
-- columnas nuevas en medio, y el centro de costo con su nombre va justo
-- al lado del código, que es donde se lee.
drop view if exists public.v_telecom_asignaciones;
create view public.v_telecom_asignaciones as
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
       cc.nombre  as centro_costo_nombre,
       -- Como se lee en toda la aplicación y en el acta: «1020 - Agrícola».
       case
           when coalesce(btrim(a.centro_costo), '') = '' then null
           when cc.nombre is null then a.centro_costo
           else a.centro_costo || ' - ' || cc.nombre
       end as centro_costo_etiqueta,
       a.departamento,
       a.puesto,
       a.correo_asignado,
       a.accesorios_entregados,
       a.observaciones,
       a.estado,
       pe.nombre as capturo,
       -- Días que faltan para la devolución pactada. Negativo: vencido.
       case when a.estado <> 'FINALIZADA' and a.fecha_devolucion_programada is not null
            then a.fecha_devolucion_programada
                 - (now() at time zone 'America/Tegucigalpa')::date
       end as dias_para_devolucion
from public.telecom_asignaciones a
join public.operadores o        on o.id = a.empleado_id
left join public.telecom_lineas l  on l.numero = a.linea_numero
left join public.telecom_planes pl on pl.id = l.plan_id
left join public.telecom_equipos e on e.imei = a.equipo_imei
left join public.telecom_centros_costo cc on cc.codigo = a.centro_costo
left join public.perfiles pe       on pe.id = a.usuario_id;

alter view public.v_telecom_asignaciones set (security_invoker = on);
grant select on public.v_telecom_asignaciones to authenticated;

drop view if exists public.v_telecom_lineas;
create view public.v_telecom_lineas as
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
       a.fecha_devolucion_programada,
       -- Cuántas solicitudes lleva pedidas al proveedor y la última: es lo
       -- que decide si hace falta abrir la bitácora o no.
       (select count(*) from public.telecom_bitacora b where b.linea_numero = l.numero)
           as solicitudes,
       (select max(b.fecha) from public.telecom_bitacora b where b.linea_numero = l.numero)
           as ultima_solicitud
from public.telecom_lineas l
left join public.telecom_planes p on p.id = l.plan_id
left join public.telecom_asignaciones a
       on a.linea_numero = l.numero and a.estado <> 'FINALIZADA'
left join public.operadores o on o.id = a.empleado_id;

alter view public.v_telecom_lineas set (security_invoker = on);
grant select on public.v_telecom_lineas to authenticated;

drop view if exists public.v_telecom_equipos;
create view public.v_telecom_equipos as
select e.imei,
       e.marca_modelo,
       e.ram,
       e.almacenamiento,
       e.fecha_compra,
       e.fecha_renovacion,
       e.estado,
       e.observaciones,
       e.activo,
       (e.fecha_renovacion - (now() at time zone 'America/Tegucigalpa')::date)
           as dias_para_renovacion,
       a.id       as asignacion_id,
       a.empleado_id,
       o.nombre   as asignado_a,
       o.codigo   as codigo_empleado,
       a.fecha_entrega
from public.telecom_equipos e
left join public.telecom_asignaciones a
       on a.equipo_imei = e.imei and a.estado <> 'FINALIZADA'
left join public.operadores o on o.id = a.empleado_id;

alter view public.v_telecom_equipos set (security_invoker = on);
grant select on public.v_telecom_equipos to authenticated;

drop view if exists public.v_telecom_alertas;
create view public.v_telecom_alertas as
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
where a.estado <> 'FINALIZADA'
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
       on a.equipo_imei = e.imei and a.estado <> 'FINALIZADA'
left join public.operadores o on o.id = a.empleado_id
where e.activo
  and e.fecha_renovacion is not null
  and e.fecha_renovacion <= (now() at time zone 'America/Tegucigalpa')::date + 30;

alter view public.v_telecom_alertas set (security_invoker = on);
grant select on public.v_telecom_alertas to authenticated;

-- =====================================================================
-- Comprobación
-- =====================================================================
do $$
declare v_puestos integer; v_bitacora integer;
begin
    select count(*) into v_puestos  from public.telecom_puestos;
    select count(*) into v_bitacora from public.telecom_bitacora;
    raise notice 'Migración 49 aplicada. Puestos: %, solicitudes en bitácora: %.', v_puestos, v_bitacora;
    raise notice 'El estado «Revisar» ya existe: una entrega en revisión sigue teniendo el equipo fuera.';
end $$;
