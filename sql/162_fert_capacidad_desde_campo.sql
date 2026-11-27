-- =====================================================================
-- 162 · FERTIRRIEGO · LA CAPACIDAD DE ALMACENAJE TAMBIÉN SE CAMBIA DESDE CAMPO (pedido 2026-11-27)
--
-- Antes solo AGL publicaba las capacidades (/FR01 › Configuración › Capacidad de almacenaje) y en producción nunca se
-- publicaron (la pestaña General decía «Aún no hay capacidades»). Ahora:
--   · Si la base no tiene el estándar, se siembra el mismo de AGL (Calcio 5000, Vegetativa 3000, Generativa 3000;
--     Vegetativa↔Generativa se prestan, Calcio nunca). AGL lo sigue mandando al publicar.
--   · Quien tenga la acción «Capacidad de almacenaje» (antes «Declarar préstamo de tanque», misma acción `capacidad`)
--     cambia la capacidad de su estación por solución: fn_fert_capacidad_guardar. Vacío = vuelve al estándar.
--   · Cada cambio queda en fert_capacidad_cambios (quién, cuándo, antes, después). AGL los lee
--     (fn_fert_capacidad_exportar › cambios), los aplica a su configuración y al publicar NO pisa lo cambiado en campo
--     después de su última lectura (p.leido_at): se vuelve a aplicar al final.
-- Correr DESPUÉS de la 152. Idempotente. Todo UPDATE/DELETE con WHERE.
-- Si se vuelve a correr la 152 → correr la 162 otra vez (redefine fn_fert_publicar_capacidades y fn_fert_capacidad_exportar).
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------------------------------------------------------------- 1 · la acción cubre también cambiar la capacidad
update public.acciones
   set nombre = 'Capacidad de almacenaje',
       descripcion = 'Fertirriego: cambia la capacidad de cada solución en la estación y presta el tanque entre Vegetativa y Generativa (Calcio nunca).'
 where codigo = 'capacidad';

-- ---------------------------------------------------------------- 2 · bitácora de cambios de campo (AGL la baja)
create table if not exists public.fert_capacidad_cambios (
    id          uuid primary key default gen_random_uuid(),
    estacion_id uuid not null references public.estaciones_riego(id) on delete cascade,
    material_id uuid not null references public.materiales(id),
    antes       numeric(14,2),            -- null = estaba en el estándar
    despues     numeric(14,2),            -- null = vuelve al estándar
    hecho_por   uuid,
    hecho_at    timestamptz not null default now()
);
comment on table public.fert_capacidad_cambios is
'162: cambios de capacidad hechos desde campo (quién, cuándo, antes y después; null = estándar). AGL los lee y los aplica.';
create index if not exists idx_fert_cap_cambios_at on public.fert_capacidad_cambios (hecho_at);
alter table public.fert_capacidad_cambios enable row level security;
revoke all on public.fert_capacidad_cambios from anon, authenticated;

-- ---------------------------------------------------------------- 3 · estándar de arranque (igual al de AGL) si no hay
insert into public.fert_capacidad_estandar (material_id, capacidad, prestable_con)
select m.id, v.cap, null
  from (values ('103192', 5000.0), ('103190', 3000.0), ('103191', 3000.0)) v(codigo, cap)
  join public.materiales m on m.codigo = v.codigo
 where not exists (select 1 from public.fert_capacidad_estandar)
on conflict (material_id) do nothing;

update public.fert_capacidad_estandar s
   set prestable_con = (select id from public.materiales where codigo = case m.codigo when '103190' then '103191' else '103190' end)
  from public.materiales m
 where m.id = s.material_id and m.codigo in ('103190', '103191') and s.prestable_con is null
   and exists (select 1 from public.fert_capacidad_estandar s2 join public.materiales m2 on m2.id = s2.material_id
                where m2.codigo = case m.codigo when '103190' then '103191' else '103190' end)
   and not exists (select 1 from public.fert_capacidad_estandar x where x.prestable_con is not null);

-- ---------------------------------------------------------------- 4 · campo cambia la capacidad
create or replace function public.fn_fert_capacidad_guardar(p_estacion uuid, p_material uuid, p_capacidad numeric)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estandar numeric;
    v_antes    numeric;
    v_nuevo    numeric := p_capacidad;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if p_estacion is null or not public.fn_fert_puede(p_estacion, 'capacidad') then
        raise exception 'Tu rol no puede cambiar la capacidad en esta estación.' using errcode = '42501';
    end if;
    select capacidad into v_estandar from public.fert_capacidad_estandar where material_id = p_material;
    if v_estandar is null then
        raise exception 'Esa solución no tiene capacidad de almacenaje.';
    end if;
    if v_nuevo is not null and (v_nuevo < 0 or v_nuevo > 1000000) then
        raise exception 'La capacidad va de 0 a 1,000,000.';
    end if;
    if v_nuevo = v_estandar then
        v_nuevo := null;   -- igual al estándar: no es excepción
    end if;
    select capacidad into v_antes from public.fert_capacidad_estacion where estacion_id = p_estacion and material_id = p_material;
    if v_antes is not distinct from v_nuevo then
        return jsonb_build_object('ok', true, 'sin_cambio', true);
    end if;
    if v_nuevo is null then
        delete from public.fert_capacidad_estacion where estacion_id = p_estacion and material_id = p_material;
    else
        insert into public.fert_capacidad_estacion (estacion_id, material_id, capacidad)
        values (p_estacion, p_material, v_nuevo)
        on conflict (estacion_id, material_id) do update set capacidad = excluded.capacidad, actualizado_at = now();
    end if;
    insert into public.fert_capacidad_cambios (estacion_id, material_id, antes, despues, hecho_por)
    values (p_estacion, p_material, v_antes, v_nuevo, (select auth.uid()));
    return jsonb_build_object('ok', true, 'capacidad', coalesce(v_nuevo, v_estandar), 'estandar', v_nuevo is null);
end $$;
revoke execute on function public.fn_fert_capacidad_guardar(uuid, uuid, numeric) from public, anon;
grant execute on function public.fn_fert_capacidad_guardar(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------- 5 · AGL: publicar no pisa lo cambiado en campo
-- Se envuelve la publicación de la 152 (que queda como _fert_publicar_capacidades_152): después de publicar, los cambios
-- de campo posteriores a la última lectura de AGL (p.leido_at) se vuelven a aplicar.
do $$
begin
    if not exists (select 1 from pg_proc where proname = '_fert_publicar_capacidades_152' and pronamespace = 'public'::regnamespace) then
        alter function public.fn_fert_publicar_capacidades(jsonb) rename to _fert_publicar_capacidades_152;
        revoke execute on function public._fert_publicar_capacidades_152(jsonb) from public, anon, authenticated;
    elsif exists (select 1 from pg_proc p where p.proname = 'fn_fert_publicar_capacidades' and p.pronamespace = 'public'::regnamespace
                     and position('162:envoltura' in pg_get_functiondef(p.oid)) = 0) then
        -- se volvió a correr la 152: su versión nueva pasa a ser la base
        drop function public._fert_publicar_capacidades_152(jsonb);
        alter function public.fn_fert_publicar_capacidades(jsonb) rename to _fert_publicar_capacidades_152;
        revoke execute on function public._fert_publicar_capacidades_152(jsonb) from public, anon, authenticated;
    end if;
end $$;

create or replace function public.fn_fert_publicar_capacidades(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
-- 162:envoltura
declare
    v_res   jsonb;
    v_leido timestamptz := nullif(p->>'leido_at', '')::timestamptz;
    v_n     integer := 0;
    c       record;
begin
    v_res := public._fert_publicar_capacidades_152(p);
    if v_leido is not null then
        for c in select distinct on (x.estacion_id, x.material_id) x.*
                   from public.fert_capacidad_cambios x
                  where x.hecho_at > v_leido
                    and exists (select 1 from public.fert_capacidad_estandar s where s.material_id = x.material_id)
                  order by x.estacion_id, x.material_id, x.hecho_at desc loop
            if c.despues is null then
                delete from public.fert_capacidad_estacion where estacion_id = c.estacion_id and material_id = c.material_id;
            else
                insert into public.fert_capacidad_estacion (estacion_id, material_id, capacidad)
                values (c.estacion_id, c.material_id, c.despues)
                on conflict (estacion_id, material_id) do update set capacidad = excluded.capacidad, actualizado_at = now();
            end if;
            v_n := v_n + 1;
        end loop;
    end if;
    return v_res || jsonb_build_object('cambios_campo_respetados', v_n);
end $$;
grant execute on function public.fn_fert_publicar_capacidades(jsonb) to authenticated;

-- ---------------------------------------------------------------- 6 · AGL lee también los cambios de campo
do $$
begin
    if not exists (select 1 from pg_proc where proname = '_fert_capacidad_exportar_152' and pronamespace = 'public'::regnamespace) then
        alter function public.fn_fert_capacidad_exportar() rename to _fert_capacidad_exportar_152;
        revoke execute on function public._fert_capacidad_exportar_152() from public, anon, authenticated;
    elsif exists (select 1 from pg_proc p where p.proname = 'fn_fert_capacidad_exportar' and p.pronamespace = 'public'::regnamespace
                     and position('162:envoltura' in pg_get_functiondef(p.oid)) = 0) then
        drop function public._fert_capacidad_exportar_152();
        alter function public.fn_fert_capacidad_exportar() rename to _fert_capacidad_exportar_152;
        revoke execute on function public._fert_capacidad_exportar_152() from public, anon, authenticated;
    end if;
end $$;

create or replace function public.fn_fert_capacidad_exportar()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
-- 162:envoltura
begin
    return public._fert_capacidad_exportar_152() || jsonb_build_object(
        'leido_at', now(),
        'cambios', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', x.id, 'estacion', e.nombre, 'material', m.codigo, 'antes', x.antes, 'despues', x.despues,
                       'hecho_at', x.hecho_at, 'por', coalesce(p.nombre, 'Sin nombre')) order by x.hecho_at)
              from public.fert_capacidad_cambios x
              join public.estaciones_riego e on e.id = x.estacion_id and e.prueba_de is null
              join public.materiales m on m.id = x.material_id
              left join public.perfiles p on p.id = x.hecho_por
             where x.hecho_at > now() - interval '90 days'), '[]'::jsonb));
end $$;
grant execute on function public.fn_fert_capacidad_exportar() to authenticated;
