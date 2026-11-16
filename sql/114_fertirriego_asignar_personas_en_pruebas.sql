-- =====================================================================
-- 114 · Asignar personas a estaciones aunque el modo de pruebas esté activo + mensajes claros
-- =====================================================================
-- Problema (producción, 2026-11-16): con el modo de pruebas activo (98), fn_fert_puede devuelve false para toda estación
-- REAL a los participantes, incluido el Administrador. Asignar a una persona a «Papalon-1» fallaba con
-- «Tu rol no tiene esa acción», que es falso: el rol sí la tiene.
--
-- Decisión del usuario: «soy el administrador, tengo que poder asignar usuarios reales aunque haya una prueba corriendo»
-- y «quiero mensajes claros».
--
-- Qué cambia (SOLO fn_fert_asignar_persona; asignar o quitar a una PERSONA de una estación es configuración, no mueve
-- inventario):
--   - Se decide con el permiso de la matriz (_fert_puede_base: «Administrar estaciones» + alcance; el Administrador pasa),
--     SIN el bloqueo del modo de pruebas. Nada de nombres de rol escritos aquí.
--   - Una estación de PRUEBA sigue exigiendo estar en pruebas (o ser Administrador), como en la 98.
--   - Los mensajes dicen la causa real. Se lanzan con el código por defecto (P0001) a propósito: con 42501 la pantalla
--     les antepone «Tu rol no tiene esa acción en esta pantalla», que es lo que confundía.
--   - La custodia (fn_fert_asignar_custodia) y todo lo demás de Fertirriego NO cambian: en pruebas siguen sin tocar
--     lo real.
--
-- Requiere la 91 y la 98. Idempotente. No hay UPDATE ni DELETE de datos.
-- Si alguien vuelve a correr la 91, correr esta otra vez (la 91 redefine la función).
-- =====================================================================

do $$
begin
    if to_regprocedure('public._fert_puede_base(uuid,text)') is null then
        raise exception 'Falta la sql/98 (modo de pruebas): corre primero la 98.';
    end if;
end $$;

create or replace function public.fn_fert_asignar_persona(p_estacion uuid, p_perfil uuid, p_asignar boolean default true)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_nombre text;
    v_base   boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;

    select nombre into v_nombre from public.estaciones_riego where id = p_estacion;
    if v_nombre is null then
        raise exception 'La estación no existe.';
    end if;

    -- El permiso de la matriz, sin el bloqueo del modo de pruebas.
    v_base := public._fert_puede_base(p_estacion, 'administrar_estaciones');
    if not v_base then
        raise exception 'No tienes el permiso «Administrar estaciones» (Fertirriego) para la estación «%»: o tu rol no lo tiene, o la estación no es de tus zonas/estaciones. Pídelo en Administración › Permisos.', v_nombre;
    end if;
    -- Una estación de PRUEBA solo la toca quien participa en las pruebas o el Administrador.
    if public._fert_es_prueba(p_estacion) and not (public.fn_fert_en_pruebas() or public.fn_es_admin()) then
        raise exception 'La estación «%» es de PRUEBA y tú no participas en las pruebas de Fertirriego. Pide a quien administra el modo de pruebas que te agregue.', v_nombre;
    end if;

    if not exists (select 1 from public.perfiles where id = p_perfil and activo) then
        raise exception 'La persona no existe o está inactiva.';
    end if;

    if p_asignar then
        insert into public.perfiles_estaciones (perfil_id, estacion_id, created_by)
        values (p_perfil, p_estacion, (select auth.uid()))
        on conflict do nothing;
    else
        if exists (select 1 from public.fert_custodia where estacion_id = p_estacion and custodio_id = p_perfil) then
            raise exception 'Esa persona tiene la estación «%» a cargo. Asigna la custodia a otra persona primero.', v_nombre;
        end if;
        delete from public.perfiles_estaciones where perfil_id = p_perfil and estacion_id = p_estacion;
    end if;
end;
$$;

grant execute on function public.fn_fert_asignar_persona(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
