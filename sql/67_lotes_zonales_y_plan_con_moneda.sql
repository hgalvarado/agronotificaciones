-- =====================================================================
-- 67 · EL SELECTOR DE LOTES, SELLADO · Y EL PLAN CON MONEDA Y DOSIS
-- =====================================================================
--
--   A · **LA FUGA ZONAL QUE QUEDÓ VIVA.** La 66 selló las vistas y las
--       policies, pero `fn_lotes_desinfeccion` es `security definer` y
--       **no miraba la zona en absoluto**: se salta la RLS por diseño y
--       devolvía los lotes de toda la finca. El selector de lotes de la
--       captura los enseñaba enteros a un usuario zonal.
--
--       Que el recorte estuviera en React no vale: la función se llama
--       por RPC y el navegador no es una puerta. Se sella aquí.
--
--   B · **MISMO LOTE, MISMO PRODUCTO, DOSIS DISTINTA.** La llave de la
--       60 era lote + ciclo + producto, y eso impide planificar el mismo
--       químico a 300 L/mz en una parte del lote y a 350 en otra — que
--       es como de verdad se planifica cuando el lote no es homogéneo.
--       La dosis entra en la llave.
--
--   C · **LA MONEDA DEL COSTO PLANIFICADO.** El químico se importa, y
--       hasta ahora `costo_litro` era un número sin moneda que las
--       columnas generadas trataban como lempiras. Escribir ahí un
--       precio en dólares multiplicaba el presupuesto por veintiséis sin
--       que nadie lo viera.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · LOS LOTES QUE SE PUEDEN ELEGIR, Y SÓLO ÉSOS
-- =====================================================================
-- Cambia la firma —gana la pantalla— así que hay que soltarla antes.
-- La pantalla es un argumento y no una suposición: el mismo catálogo de
-- lotes sirve a Planificación y a Ejecución, que desde la 66 son dos
-- permisos distintos y pueden tener alcances distintos. Adivinarlo aquí
-- sería elegir por el usuario cuál de los dos le conviene.
drop function if exists public.fn_lotes_desinfeccion(uuid, uuid);

create function public.fn_lotes_desinfeccion(
    p_temporada_id uuid,
    p_ejecucion_id uuid default null,
    p_pantalla     text default 'desinfeccion_ejecucion'
) returns table (
    lote_temporada_id uuid,
    nomenclatura      text,
    lote_nombre       text,
    zona_id           uuid,
    area_neta         numeric,
    mz_planeadas      numeric,
    mz_ejecutadas     numeric,
    mz_restantes      numeric
)
language sql stable security definer set search_path = public, pg_temp as $$
    select
        lt.id,
        lo.nomenclatura,
        lo.nombre,
        lt.zona_id,
        coalesce(lt.area_neta, 0),
        coalesce(public.fn_area_regable(lt.id), 0)          as mz_planeadas,
        coalesce(d.hechas, 0)                               as mz_ejecutadas,
        greatest(coalesce(public.fn_area_regable(lt.id), 0) - coalesce(d.hechas, 0), 0)
                                                            as mz_restantes
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    left join lateral (
        select sum(dl.mz_cubiertas) as hechas
        from public.desinfeccion_ejecucion_lotes dl
        join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
        where dl.lote_temporada_id = lt.id
          and e.temporada_id = p_temporada_id
          and (p_ejecucion_id is null or e.id <> p_ejecucion_id)
    ) d on true
    where lt.temporada_id = p_temporada_id
      and lt.activo
      -- Sin permiso de ver esa pantalla no hay lotes que ofrecer. Es
      -- `security definer`: si no se comprueba aquí, no lo comprueba
      -- nadie.
      and (select public.fn_permitido_de(p_pantalla, 'ver'))
      -- Y el recorte zonal, con la ESTRICTA de la 66: sin zonas
      -- asignadas no se ve nada, y un lote sin zona tampoco. Un lote sin
      -- zona es un dato incompleto, no un pase libre.
      and case (select public.fn_mi_alcance(p_pantalla, 'ver'))
          when 'global'      then true
          -- Un lote no tiene dueño: el alcance «propietario» sobre un
          -- catálogo no puede recortar por ahí, así que recorta igual
          -- que el zonal. Dejarlo en `true` sería la fuga de siempre.
          else (select public.fn_ve_zona_estricta(lt.zona_id))
      end
    order by lo.nomenclatura
$$;

comment on function public.fn_lotes_desinfeccion(uuid, uuid, text) is
    'Los lotes de la temporada con sus manzanas pendientes, YA recortados por la zona del usuario.';

grant execute on function public.fn_lotes_desinfeccion(uuid, uuid, text) to authenticated;

-- =====================================================================
-- B · LA DOSIS ENTRA EN LA LLAVE
-- =====================================================================
-- Un lote no es homogéneo: media parte pide 300 L/mz y la otra 350. Con
-- la llave de la 60 eso era imposible de planificar sin inventarse un
-- producto distinto, que es peor que no poder.

drop index if exists public.desinfeccion_plan_lote_ciclo_producto_uidx;

create unique index if not exists desinfeccion_plan_lote_ciclo_prod_dosis_uidx
    on public.desinfeccion_plan (lote_temporada_id, ciclo, producto_id, dosis_mz)
    nulls not distinct;

comment on index public.desinfeccion_plan_lote_ciclo_prod_dosis_uidx is
    'Un lote admite el mismo producto a dosis distintas en el mismo ciclo; lo que no admite es la misma dosis dos veces.';

-- =====================================================================
-- C · LA MONEDA DEL COSTO PLANIFICADO
-- =====================================================================
-- **Por qué no basta con guardar la moneda al lado.** `total_costo` y
-- `costo_mz` son columnas generadas sobre `costo_litro`, y las generadas
-- no pueden llamar a una función que lea tablas —la tasa vive en una—.
-- Así que `costo_litro` se queda siendo SIEMPRE lempiras, que es lo que
-- esas columnas ya suponían, y lo que se escribe a mano entra por un
-- par nuevo: el número tal cual y su moneda.
--
-- Dos columnas y un disparador, en vez de una columna ambigua.

alter table public.desinfeccion_plan
    add column if not exists moneda text not null default 'HNL'
        check (moneda in ('HNL', 'USD')),
    -- Lo que se escribió, en la moneda que se escribió. Nulo quiere
    -- decir «esta fila es anterior a la 67, o se escribió el lempira
    -- directo»: entonces manda `costo_litro` y aquí no se toca nada.
    add column if not exists costo_origen numeric(14,4)
        check (costo_origen is null or costo_origen >= 0);

comment on column public.desinfeccion_plan.costo_origen is
    'El costo tal como se escribió, en su moneda. `costo_litro` es su equivalente en lempiras, y es el que cuenta.';

comment on column public.desinfeccion_plan.costo_litro is
    'SIEMPRE en lempiras: es lo que suman las columnas generadas. Si se escribió en dólares, lo convierte el disparador.';

/**
 * Pasa a lempiras lo que se escribió en otra moneda.
 *
 * La tasa es la de la TEMPORADA del plan y la de la fecha de aplicación
 * —la misma `fn_tasa_de_temporada` que convierte el precio de los
 * químicos capturados—, no la de hoy: un plan de marzo se presupuesta
 * con la tasa de marzo.
 *
 * Si no hay tasa, **no se inventa una**: se deja el costo en cero y se
 * avisa. Un presupuesto convertido con una tasa inventada es peor que un
 * hueco, porque el hueco se ve.
 */
create or replace function public.fn_desinfeccion_plan_moneda()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tasa numeric;
begin
    -- Sin costo escrito en el par nuevo, manda lo que venga en
    -- `costo_litro`: es como se guardaba antes de la 67 y como lo sigue
    -- escribiendo cualquier fila vieja que se reedite.
    if new.costo_origen is null then
        return new;
    end if;

    if new.moneda = 'USD' then
        v_tasa := public.fn_tasa_de_temporada(
            coalesce(new.fecha_aplicacion,
                     new.fecha_siembra_congelada + coalesce(new.dias_aplicacion, 0),
                     current_date),
            new.temporada_id);
        if v_tasa is null then
            raise notice 'Plan: el costo está en dólares y la temporada no tiene tasa de cambio. Se guarda en cero hasta que se registre una.';
            new.costo_litro := 0;
            return new;
        end if;
        new.costo_litro := new.costo_origen * v_tasa;
    else
        new.costo_litro := new.costo_origen;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_desinfeccion_plan_moneda on public.desinfeccion_plan;
create trigger trg_desinfeccion_plan_moneda
    before insert or update of costo_origen, moneda, dias_aplicacion, fecha_siembra_congelada
    on public.desinfeccion_plan
    for each row execute function public.fn_desinfeccion_plan_moneda();

-- Lo que ya estaba se declara en lempiras, que es lo que era.
update public.desinfeccion_plan
   set costo_origen = costo_litro
 where costo_origen is null and coalesce(costo_litro, 0) > 0;

-- ------------------- La vista del plan, otra vez --------------------
-- Gana las dos columnas nuevas. `create or replace view` sólo admite
-- añadir al final y aquí además cambia la cruda, así que se rehace.

drop view if exists public.v_desinfeccion_plan;
drop view if exists interno.v_desinfeccion_plan_crudo;

create view interno.v_desinfeccion_plan_crudo as
select
    p.id, p.temporada_id, tm.nombre as temporada_nombre,
    p.lote_temporada_id, lo.nomenclatura as lote_nomenclatura, lo.nombre as lote_nombre,
    lt.zona_id, z.nombre as zona_nombre,
    p.ciclo, p.fecha_siembra_congelada, p.dias_aplicacion, p.fecha_aplicacion,
    p.variedad_id, v.nombre as variedad_nombre,
    p.producto_id, m.descripcion as producto_nombre, m.codigo as producto_codigo,
    m.ingrediente_activo, m.concentracion,
    p.dosis_mz, p.area_planificada_mz, p.costo_litro,
    p.total_litros, p.total_costo, p.costo_mz,
    -- El número tal como se escribió, al lado del convertido: ver los
    -- dos juntos es lo que deja auditar la conversión sin abrir la base.
    p.moneda, p.costo_origen,
    p.comentarios, p.usuario_id, pe.nombre as usuario_nombre, p.created_at
from public.desinfeccion_plan p
join public.lotes_temporada lt on lt.id = p.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.temporadas tm      on tm.id = p.temporada_id
left join public.variedades v  on v.id = p.variedad_id
left join public.materiales m  on m.id = p.producto_id
left join public.perfiles pe   on pe.id = p.usuario_id;

alter view interno.v_desinfeccion_plan_crudo set (security_invoker = off);

-- La reja de la 66, intacta: pantalla granular y recorte estricto.
create view public.v_desinfeccion_plan as
select x.* from interno.v_desinfeccion_plan_crudo x
where (select public.fn_permitido_de('desinfeccion_plan', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_plan', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_lote_estricto(x.lote_temporada_id))
  end;

grant select on public.v_desinfeccion_plan to authenticated;

-- =====================================================================
-- D · LOS GUARDIANES
-- =====================================================================

do $$
declare v_falta text;
begin
    -- La fuga de A: la función tiene que mirar la zona. Es definer, así
    -- que si no la mira ella no la mira nadie.
    if (select pg_get_functiondef(p.oid)
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace::oid
           and p.proname = 'fn_lotes_desinfeccion') !~ 'fn_ve_zona_estricta'
    then
        raise exception 'fn_lotes_desinfeccion volvió a quedarse sin recorte zonal.';
    end if;

    if (select count(*) from pg_proc p
         where p.pronamespace = 'public'::regnamespace::oid
           and p.proname = 'fn_lotes_desinfeccion') <> 1
    then
        raise exception 'Hay más de una fn_lotes_desinfeccion: la llamada sería ambigua.';
    end if;

    if not exists (select 1 from pg_indexes
                   where schemaname = 'public'
                     and indexname = 'desinfeccion_plan_lote_ciclo_prod_dosis_uidx')
    then
        raise exception 'Falta la llave única del plan con la dosis.';
    end if;

    if exists (select 1 from pg_indexes
               where schemaname = 'public'
                 and indexname = 'desinfeccion_plan_lote_ciclo_producto_uidx')
    then
        raise exception 'La llave vieja sigue viva: impediría las dosis diferenciadas.';
    end if;

    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and exists (select 1 from pg_class cr join pg_namespace nr on nr.oid = cr.relnamespace
                  where nr.nspname = 'interno' and cr.relname = c.relname || '_crudo')
      and pg_get_viewdef(c.oid, true) !~ 'fn_permitido_de';
    if v_falta is not null then
        raise exception 'Vistas sin reja de permiso: %', v_falta;
    end if;

    -- Y la de la 66, que no se puede perder al rehacer una vista.
    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, true) ~ 'fn_mi_alcance'
      and pg_get_viewdef(c.oid, true) ~ 'fn_tiene_zonas';
    if v_falta is not null then
        raise exception 'Rejas que se abren cuando el usuario no tiene zonas: %', v_falta;
    end if;

    if has_schema_privilege('authenticated', 'interno', 'usage') then
        raise exception 'authenticated puede entrar al esquema interno.';
    end if;
end $$;

-- =====================================================================
-- Qué cambia de comportamiento:
--
--   · El selector de lotes de Desinfección deja de ofrecer los de otras
--     zonas a un usuario zonal. Si alguien se queda sin lotes que
--     elegir, lo primero que hay que mirar son sus zonas.
--   · El mismo lote con el mismo producto admite ahora varias dosis en
--     el mismo ciclo. Lo que ya no admite es repetir la MISMA dosis.
--   · Un costo planificado en dólares sin tasa de temporada se guarda en
--     CERO y lo avisa, en vez de presupuestar con una tasa inventada.
-- =====================================================================
