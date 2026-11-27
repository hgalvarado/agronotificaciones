-- =====================================================================
-- 158 · AgroMétricas: permiso propio «Ver registros» (pedido 2026-11-27)
--
-- El usuario quiere dar a algunas personas SOLO «Registros de parámetros» (sin la captura «Parámetros de riego»).
-- Antes las dos fichas de Campo dependían de «AgroMétricas · Ver».
--   · Acción nueva `ver_registros` en la pantalla `agrometricas` (aparece en Permisos por módulo).
--   · Se concede a los roles que HOY tienen «Ver», con el mismo alcance y condición (nadie pierde nada al correrla).
--   · «Ver» = ficha y pantalla de captura (Parámetros de riego). «Ver registros» = ficha y pantalla de Registros.
--   · Para ver registros manda «Ver registros» (si no lo tiene, sigue valiendo «Ver», con su alcance).
-- Reemplaza `_agm_puede_ver_registro` de la 156 (mismas reglas de zona). Si se vuelve a correr la 156 → CORRER LA 158 OTRA VEZ.
-- Idempotente. Sin UPDATE/DELETE sin WHERE.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- 1 · acción y pantalla
insert into public.acciones (codigo, nombre, descripcion, orden, escribe, nivel) values
    ('ver_registros', 'Ver registros', 'AgroMétricas: abrir «Registros de parámetros» (lo registrado en la temporada en sus zonas, gráficas e índice de crecimiento). Sin «Ver» no aparece la captura «Parámetros de riego».', 133, false, 1)
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, escribe = excluded.escribe;

update public.pantallas
   set acciones = acciones || 'ver_registros'::text
 where codigo = 'agrometricas' and not ('ver_registros' = any(acciones));

-- 2 · se concede a quien hoy tiene «Ver» (mismo alcance y condición); no pisa lo que ya se haya decidido
insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
select pm.rol_id, pm.recurso, 'ver_registros', pm.permitido, pm.alcance, pm.condicion
  from public.permisos pm
 where pm.recurso = 'agrometricas' and pm.accion = 'ver' and pm.permitido
   and not exists (select 1 from public.permisos x where x.rol_id = pm.rol_id and x.recurso = 'agrometricas' and x.accion = 'ver_registros');

-- 3 · ver registros: «Ver registros» (o «Ver» si no lo tiene), con las reglas de zona de la 156
create or replace function public._agm_accion_registros()
returns text language sql stable security definer set search_path = public, pg_temp as $$
    select case when public.fn_tiene_permiso('agrometricas', 'ver_registros') then 'ver_registros' else 'ver' end
$$;
revoke execute on function public._agm_accion_registros() from public, anon, authenticated;

create or replace function public._agm_puede_ver_registro(p_creado_por uuid, p_turno uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    with z as (select public._agm_zona_turno(p_turno) as zona), a as (select public._agm_accion_registros() as acc)
    select case
        when public.fn_es_admin() then true
        when not public.fn_tiene_permiso('agrometricas', (select acc from a)) then false
        else case public.fn_mi_alcance('agrometricas', (select acc from a))
            when 'global' then true
            when 'zonal' then public.fn_ve_zona_estricta((select zona from z))
                or exists (select 1 from public.perfiles p where p.id = (select auth.uid()) and p.todas_las_zonas)
            else exists (select 1 from public.perfiles_estaciones pe join public.estaciones_riego e on e.id = pe.estacion_id
                         where e.zona_id = (select zona from z) and e.prueba_de is null and pe.perfil_id = (select auth.uid()))
        end
    end
$$;
revoke execute on function public._agm_puede_ver_registro(uuid, uuid) from public, anon, authenticated;

-- 4 · lo demás que usa la pantalla de Registros acepta «Ver registros»
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def   text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n     integer;
begin
    if position(p_marca in v_def) > 0 then
        return;
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '158: en % se esperaba 1 aparición de «%» y hay %', p_fn, left(v_viejo, 80), v_n;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
end $$;

-- filtros de turnos (la captura sigue pidiendo «Ver» en su pantalla)
select pg_temp.parchar('public.fn_agm_mis_turnos()',
    $p$where t.activo and public.fn_agm_puede_zona(coalesce(e.zona_id, t.zona_id), 'ver')$p$,
    $p$where t.activo and (public.fn_agm_puede_zona(coalesce(e.zona_id, t.zona_id), 'ver')
                                  or public._agm_puede_ver_registro(null, t.id) /* 158:turnos */)$p$,
    '158:turnos');
-- fórmula del índice de crecimiento (para calcular y graficar)
select pg_temp.parchar('public.fn_agm_ic_config()',
    $p$public.fn_tiene_permiso('agrometricas', 'ver')) then$p$,
    $p$public.fn_tiene_permiso('agrometricas', 'ver') or public.fn_tiene_permiso('agrometricas', 'ver_registros') /* 158:ic */) then$p$,
    '158:ic');
select pg_temp.parchar('public.fn_agm_ic_formula_vigente(date)',
    $p$public.fn_tiene_permiso('agrometricas', 'ver')) then$p$,
    $p$public.fn_tiene_permiso('agrometricas', 'ver') or public.fn_tiene_permiso('agrometricas', 'ver_registros') /* 158:ic */) then$p$,
    '158:ic');
