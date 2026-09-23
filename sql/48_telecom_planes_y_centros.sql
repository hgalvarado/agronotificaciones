-- =====================================================================
-- 48 · Los planes de verdad y el catálogo de centros de costo
--
-- Ejecutar en el SQL Editor DESPUÉS de la 47.
--
-- Dos huecos de la 47:
--   · el catálogo de planes nacía con un solo plan —el de retención— así
--     que el selector de «Nueva línea» sólo ofrecía ése;
--   · el centro de costo y el departamento se escribían a mano en cada
--     entrega, y «CC-100», «CC100» y «cc 100» terminaban siendo tres
--     centros distintos en el mismo reporte.
-- =====================================================================

-- =====================================================================
-- PARTE A · Centros de costo
-- =====================================================================

create table if not exists public.telecom_centros_costo (
    id      uuid primary key default gen_random_uuid(),
    codigo  text not null unique,
    nombre  text,
    activo  boolean not null default true
);

comment on table public.telecom_centros_costo is
'Centros de costo a los que se carga una línea o un equipo. Catálogo y no texto libre: escrito a mano, el mismo centro sale de tres formas distintas en el mismo reporte.';

alter table public.telecom_centros_costo enable row level security;

drop policy if exists telecom_centros_costo_select on public.telecom_centros_costo;
create policy telecom_centros_costo_select on public.telecom_centros_costo for select
    using ((select public.fn_tiene_permiso('telecom', 'ver')));

drop policy if exists telecom_centros_costo_insert on public.telecom_centros_costo;
create policy telecom_centros_costo_insert on public.telecom_centros_costo for insert
    with check ((select public.fn_tiene_permiso('telecom', 'crear')));

drop policy if exists telecom_centros_costo_update on public.telecom_centros_costo;
create policy telecom_centros_costo_update on public.telecom_centros_costo for update
    using ((select public.fn_tiene_permiso('telecom', 'editar')));

drop policy if exists telecom_centros_costo_delete on public.telecom_centros_costo;
create policy telecom_centros_costo_delete on public.telecom_centros_costo for delete
    using ((select public.fn_tiene_permiso('telecom', 'eliminar')));

grant select, insert, update, delete on public.telecom_centros_costo to authenticated;

-- Los que ya se escribieron a mano en las entregas, rescatados: así el
-- catálogo nace con lo que la empresa ya usa en vez de en blanco.
insert into public.telecom_centros_costo (codigo)
select distinct btrim(a.centro_costo)
from public.telecom_asignaciones a
where coalesce(btrim(a.centro_costo), '') <> ''
on conflict (codigo) do nothing;

-- =====================================================================
-- PARTE B · Los planes que se venden de verdad
--
-- Se insertan sólo si faltan. No se toca ninguno que ya exista: los
-- costos los ajusta el usuario en el catálogo y una migración que los
-- reescribiera le borraría la negociación con el proveedor.
-- =====================================================================

insert into public.telecom_planes (nombre, proveedor, costo_mensual, es_retencion, activo)
values ('Plan 13.99', null, 13.99, false, true),
       ('Plan 16.99', null, 16.99, false, true),
       ('Plan 21.99', null, 21.99, false, true)
on conflict (nombre) do nothing;

-- El de retención existe desde la 47; se le pone su costo si quedó nulo.
update public.telecom_planes
set costo_mensual = 1.00
where es_retencion and costo_mensual is null;

-- =====================================================================
-- Comprobación
-- =====================================================================
do $$
declare v_planes integer; v_centros integer;
begin
    select count(*) into v_planes  from public.telecom_planes where activo;
    select count(*) into v_centros from public.telecom_centros_costo;
    raise notice 'Migración 48 aplicada. Planes activos: %, centros de costo: %.', v_planes, v_centros;
end $$;
