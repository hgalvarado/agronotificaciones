-- =====================================================================
-- 77 · TELECOM: ESTADO FÍSICO DEL EQUIPO, MONEDA DEL PLAN Y UPDATE SELLADO
--
-- Ejecutar en el SQL Editor DESPUÉS de la 76.
--
--   A · `telecom_equipos` gana su ESTADO FÍSICO (Activo, Dañado,
--       Reparación, Devuelto), la fecha en que se devolvió y una nota.
--       No sustituye a `estado` (EN_BODEGA / ASIGNADO / DANADO): ése dice
--       DÓNDE está el aparato y lo mantiene la base; éste dice CÓMO está.
--
--   B · `telecom_planes` gana `moneda` y `costo_origen`. Mismo patrón de
--       la 67: `costo_mensual` sigue siendo SIEMPRE lempiras —es lo que
--       suman las líneas y el tablero— y lo escrito en dólares entra por
--       el par nuevo y lo convierte un disparador con la tasa vigente.
--
--   C · Las vistas crudas de equipos y líneas se rehacen con las columnas
--       nuevas AL FINAL (create or replace no admite otra cosa) y su
--       envoltorio de `public` se vuelve a armar con la reja de la 66.
--
--   D · Policies de UPDATE con `with check` explícito en todo telecom, y
--       `telecom_asignaciones` pasa a `fn_verificar_permiso` CON dueño:
--       la vista ya recortaba por propietario, la tabla no, así que por
--       PostgREST un alcance «propietario» podía editar la entrega de otro.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · ESTADO FÍSICO DEL EQUIPO
-- =====================================================================

alter table public.telecom_equipos
    add column if not exists estado_fisico    varchar(40) not null default 'Activo',
    add column if not exists fecha_devolucion date,
    add column if not exists notas_estado     text;

-- Catálogo cerrado en la base: escrito a mano, «Reparacion», «reparación»
-- y «En reparación» serían tres estados en el mismo reporte.
do $$
begin
    if not exists (select 1 from pg_constraint
                   where conname = 'telecom_equipos_estado_fisico_chk') then
        alter table public.telecom_equipos
            add constraint telecom_equipos_estado_fisico_chk
            check (estado_fisico in ('Activo', 'Dañado', 'Reparación', 'Devuelto'));
    end if;
    if not exists (select 1 from pg_constraint
                   where conname = 'telecom_equipos_devolucion_chk') then
        alter table public.telecom_equipos
            add constraint telecom_equipos_devolucion_chk
            check (fecha_devolucion is null or fecha_compra is null
                   or fecha_devolucion >= fecha_compra);
    end if;
end $$;

comment on column public.telecom_equipos.estado_fisico is
'CÓMO está el aparato (Activo, Dañado, Reparación, Devuelto). DÓNDE está lo dice `estado`, que mantiene la base.';
comment on column public.telecom_equipos.fecha_devolucion is
'Día en que el equipo se devolvió al proveedor o salió de la flota. Fecha de Honduras.';

-- =====================================================================
-- B · MONEDA DEL PLAN
-- =====================================================================

alter table public.telecom_planes
    add column if not exists moneda text not null default 'HNL'
        check (moneda in ('HNL', 'USD')),
    add column if not exists costo_origen numeric(12,4)
        check (costo_origen is null or costo_origen >= 0);

comment on column public.telecom_planes.costo_origen is
'El costo tal como se escribió, en su moneda. `costo_mensual` es su equivalente en lempiras y es el que cuenta.';
comment on column public.telecom_planes.costo_mensual is
'SIEMPRE en lempiras. Si el plan está en dólares, lo calcula el disparador con la tasa vigente.';

/**
 * Mantiene `costo_mensual` (lempiras) a partir de `costo_origen` + `moneda`.
 *
 * Tres casos, en este orden:
 *   1. Se tocó SÓLO `costo_mensual` (la celda de lempiras del catálogo):
 *      lo último que se escribió manda → el plan pasa a HNL con ese costo.
 *   2. Hay `costo_origen`: se convierte. Sin tasa no se inventa una: se
 *      conserva el lempira anterior y se avisa.
 *   3. Alta sin `costo_origen` (filas viejas, `crearPlan`): se declara en
 *      lempiras lo que vino en `costo_mensual`.
 */
create or replace function public.fn_telecom_planes_moneda()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tasa numeric;
begin
    if tg_op = 'UPDATE'
       and new.costo_mensual is distinct from old.costo_mensual
       and new.costo_origen  is not distinct from old.costo_origen
       and new.moneda        is not distinct from old.moneda
    then
        new.moneda       := 'HNL';
        new.costo_origen := new.costo_mensual;
        return new;
    end if;

    if new.costo_origen is null then
        if new.costo_mensual is not null then
            new.moneda       := 'HNL';
            new.costo_origen := new.costo_mensual;
        end if;
        return new;
    end if;

    if new.moneda = 'USD' then
        v_tasa := public.fn_tasa_de_temporada(
                      (now() at time zone 'America/Tegucigalpa')::date);
        if v_tasa is null then
            raise notice 'Plan «%»: está en dólares y no hay tasa de cambio vigente. Se conserva el costo en lempiras anterior.', new.nombre;
            if tg_op = 'UPDATE' then
                new.costo_mensual := old.costo_mensual;
            end if;
            return new;
        end if;
        new.costo_mensual := round(new.costo_origen * v_tasa, 2);
    else
        new.costo_mensual := round(new.costo_origen, 2);
    end if;

    return new;
end;
$$;

drop trigger if exists trg_telecom_planes_moneda on public.telecom_planes;
create trigger trg_telecom_planes_moneda
    before insert or update of costo_origen, moneda, costo_mensual
    on public.telecom_planes
    for each row execute function public.fn_telecom_planes_moneda();

-- Lo que ya estaba era lempiras.
update public.telecom_planes
   set costo_origen = costo_mensual, moneda = 'HNL'
 where costo_origen is null and costo_mensual is not null;

-- =====================================================================
-- C · VISTAS: CRUDAS CON LAS COLUMNAS NUEVAS + ENVOLTORIO CON REJA
-- =====================================================================
-- El envoltorio fijó su lista de columnas al crearse (`select x.*`), así
-- que se tira ANTES y se rearma DESPUÉS de tocar la cruda.

drop view if exists public.v_telecom_equipos;
drop view if exists public.v_telecom_lineas;

create or replace view interno.v_telecom_equipos_crudo as
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
       a.fecha_entrega,
       -- 77 · al final: `create or replace` sólo admite columnas nuevas detrás.
       e.estado_fisico,
       e.fecha_devolucion,
       e.notas_estado
from public.telecom_equipos e
left join public.telecom_asignaciones a
       on a.equipo_imei = e.imei and a.estado <> 'FINALIZADA'
left join public.operadores o on o.id = a.empleado_id;

alter view interno.v_telecom_equipos_crudo set (security_invoker = off);

create or replace view interno.v_telecom_lineas_crudo as
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
       (select count(*) from public.telecom_bitacora b where b.linea_numero = l.numero)
           as solicitudes,
       (select max(b.fecha) from public.telecom_bitacora b where b.linea_numero = l.numero)
           as ultima_solicitud,
       -- 77
       p.moneda        as plan_moneda,
       p.costo_origen  as plan_costo_origen
from public.telecom_lineas l
left join public.telecom_planes p on p.id = l.plan_id
left join public.telecom_asignaciones a
       on a.linea_numero = l.numero and a.estado <> 'FINALIZADA'
left join public.operadores o on o.id = a.empleado_id;

alter view interno.v_telecom_lineas_crudo set (security_invoker = off);

revoke all on interno.v_telecom_equipos_crudo from authenticated, anon;
revoke all on interno.v_telecom_lineas_crudo  from authenticated, anon;

-- La reja, idéntica a la de la 66 para estas dos: sin dueño ('false' en
-- propietario) y sin dimensión zonal ('nada').
do $$
declare v text;
begin
    foreach v in array array['v_telecom_equipos', 'v_telecom_lineas']
    loop
        execute format($sql$
            create view public.%I as
            select x.* from interno.%I x
            where (select public.fn_permitido_de('telecom', 'ver'))
              and case (select public.fn_mi_alcance('telecom', 'ver'))
                  when 'global'      then true
                  when 'propietario' then false
                  else true
              end
        $sql$, v, v || '_crudo');
        execute format('grant select on public.%I to authenticated', v);
    end loop;
end $$;

-- =====================================================================
-- D · POLICIES DE UPDATE (y las de asignaciones, con dueño)
-- =====================================================================

-- Catálogos y tablas sin dueño: misma puerta de siempre, ahora con la
-- comprobación de la fila NUEVA escrita y no implícita.
do $$
declare t text;
begin
    foreach t in array array['telecom_planes', 'telecom_lineas', 'telecom_equipos',
                             'telecom_centros_costo', 'telecom_puestos', 'telecom_bitacora']
    loop
        if to_regclass('public.' || t) is null then
            raise notice '77 · No existe public.%; se omite.', t;
            continue;
        end if;
        execute format('drop policy if exists %1$s_update on public.%1$I', t);
        execute format(
            'create policy %1$s_update on public.%1$I for update '
            || 'using ((select public.fn_tiene_permiso(''telecom'',''editar''))) '
            || 'with check ((select public.fn_tiene_permiso(''telecom'',''editar'')))', t);
    end loop;
end $$;

-- Asignaciones: tienen dueño (`usuario_id`), así que la tabla evalúa el
-- eje propietario igual que la vista. `fn_telecom_finalizar_asignacion`
-- es `invoker` y hereda esta misma puerta.
drop policy if exists telecom_asignaciones_select on public.telecom_asignaciones;
create policy telecom_asignaciones_select on public.telecom_asignaciones for select
    using ((select public.fn_verificar_permiso('telecom', 'ver', usuario_id)));

drop policy if exists telecom_asignaciones_insert on public.telecom_asignaciones;
create policy telecom_asignaciones_insert on public.telecom_asignaciones for insert
    with check ((select public.fn_verificar_permiso('telecom', 'crear', usuario_id)));

drop policy if exists telecom_asignaciones_update on public.telecom_asignaciones;
create policy telecom_asignaciones_update on public.telecom_asignaciones for update
    using      ((select public.fn_verificar_permiso('telecom', 'editar', usuario_id)))
    with check ((select public.fn_verificar_permiso('telecom', 'editar', usuario_id)));

drop policy if exists telecom_asignaciones_delete on public.telecom_asignaciones;
create policy telecom_asignaciones_delete on public.telecom_asignaciones for delete
    using ((select public.fn_verificar_permiso('telecom', 'eliminar', usuario_id)));

-- =====================================================================
-- GUARDIANES
-- =====================================================================

do $$
declare v_falta text;
begin
    -- 1 · Las columnas llegaron hasta la vista EXPUESTA.
    select string_agg(c, ', ') into v_falta
    from unnest(array['estado_fisico', 'fecha_devolucion', 'notas_estado']) c
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'v_telecom_equipos'
                        and column_name = c);
    if v_falta is not null then
        raise exception '77 · v_telecom_equipos quedó sin: %', v_falta;
    end if;

    select string_agg(c, ', ') into v_falta
    from unnest(array['plan_moneda', 'plan_costo_origen']) c
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'v_telecom_lineas'
                        and column_name = c);
    if v_falta is not null then
        raise exception '77 · v_telecom_lineas quedó sin: %', v_falta;
    end if;

    -- 2 · Interno sigue cerrado.
    if has_schema_privilege('authenticated', 'interno', 'usage') then
        raise exception '77 · authenticated ganó USAGE sobre interno.';
    end if;
    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'interno' and c.relkind = 'v'
      and has_table_privilege('authenticated', c.oid, 'select');
    if v_falta is not null then
        raise exception '77 · Crudas legibles por authenticated: %', v_falta;
    end if;

    -- 3 · Las crudas siguen saltándose el RLS (definer) y las expuestas
    --     llevan reja.
    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'interno'
      and c.relname in ('v_telecom_equipos_crudo', 'v_telecom_lineas_crudo')
      and coalesce(c.reloptions::text, '') not like '%security_invoker=off%'
      and coalesce(c.reloptions::text, '') not like '%security_invoker=false%';
    if v_falta is not null then
        raise exception '77 · Crudas que perdieron security_invoker=off: %', v_falta;
    end if;

    select string_agg(v, ', ') into v_falta
    from unnest(array['v_telecom_equipos', 'v_telecom_lineas']) v
    where pg_get_viewdef(('public.' || v)::regclass, true) not like '%fn_permitido_de%';
    if v_falta is not null then
        raise exception '77 · Vistas expuestas sin reja: %', v_falta;
    end if;

    -- 4 · Ningún UPDATE de telecom sin WITH CHECK.
    select string_agg(tablename || '.' || policyname, ', ') into v_falta
    from pg_policies
    where schemaname = 'public' and tablename like 'telecom\_%'
      and cmd = 'UPDATE' and with_check is null;
    if v_falta is not null then
        raise exception '77 · UPDATE sin WITH CHECK: %', v_falta;
    end if;

    -- 5 · Asignaciones evalúa el dueño en las cuatro.
    select string_agg(policyname, ', ') into v_falta
    from pg_policies
    where schemaname = 'public' and tablename = 'telecom_asignaciones'
      and coalesce(qual, '') || coalesce(with_check, '') not like '%usuario_id%';
    if v_falta is not null then
        raise exception '77 · Policies de asignaciones sin eje propietario: %', v_falta;
    end if;

    -- 6 · El disparador de moneda existe.
    if not exists (select 1 from pg_trigger
                   where tgname = 'trg_telecom_planes_moneda' and not tgisinternal) then
        raise exception '77 · Falta trg_telecom_planes_moneda.';
    end if;
end $$;
