-- =====================================================================
-- 156 · AgroMétricas: los REGISTROS de parámetros se ven solo de las zonas de la persona (pedido 2026-11-27)
--
-- Antes: con alcance «zonal», `_agm_puede_ver_registro` (vía fn_agm_puede_zona) dejaba ver también las zonas donde la
-- persona tiene una ESTACIÓN asignada. En producción dos supervisores de Zona-1 con estaciones en Zona-2A veían los
-- registros de Zona-2A (por estaciones del modo de pruebas) aunque su usuario dice «solo Zona-1».
-- Ahora, para VER registros (Registros de la temporada, IC, horas de riego):
--   · administrador o alcance global → todo;
--   · zonal → solo sus zonas (fn_ve_zona_estricta: zonas marcadas o «Todas las zonas»);
--   · propietario → las zonas de sus estaciones REALES (las de prueba «PRUEBA · X» no dan acceso a otra zona).
-- La CAPTURA (fn_agm_puede_zona) no cambia: quien tiene una estación en otra zona puede seguir registrando ahí.
-- Idempotente. Sin UPDATE/DELETE.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function public._agm_puede_ver_registro(p_creado_por uuid, p_turno uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    with z as (select public._agm_zona_turno(p_turno) as zona)
    select case
        when public.fn_es_admin() then true
        when not public.fn_tiene_permiso('agrometricas', 'ver') then false
        else case public.fn_mi_alcance('agrometricas', 'ver')
            when 'global' then true
            when 'zonal' then public.fn_ve_zona_estricta((select zona from z))
            else exists (select 1 from public.perfiles_estaciones pe join public.estaciones_riego e on e.id = pe.estacion_id
                         where e.zona_id = (select zona from z) and e.prueba_de is null and pe.perfil_id = (select auth.uid()))
        end
    end
$$;
revoke execute on function public._agm_puede_ver_registro(uuid, uuid) from public, anon, authenticated;

comment on function public._agm_puede_ver_registro(uuid, uuid) is
    '156: ver registros de AgroMétricas: global todo; zonal solo sus zonas (estricto, sin sumar zonas de sus estaciones); propietario las zonas de sus estaciones.';
