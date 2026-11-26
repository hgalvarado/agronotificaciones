-- 151 · Publicar catálogos desde AGL: la huella de la vista previa deja de cambiar sola.
--
-- Problema (2026-11-25): al publicar catálogos, AgroNotificaciones respondía 400 «Los datos cambiaron desde la vista
-- previa…» aunque nadie hubiera cambiado nada. Causa: cuando AGL trae una ZONA NUEVA (p. ej. «Investigación y
-- Desarrollo (I+D)») la base le inventa un id (gen_random_uuid) en cada llamada, y ese id entraba en la huella
-- (`despues.zona_id` de las estaciones y turnos de esa zona). Vista previa y publicación daban huellas distintas
-- SIEMPRE, y la zona nunca se llegaba a crear (de ahí el aviso «Zona … no existe en AgroNotificaciones»).
--
-- Arreglo: en la huella, el id de una zona que todavía no existe se cuenta como «nueva». Nada más cambia: lo que se
-- aplica sigue siendo exactamente lo que se vio. Idempotente (marca «151:»). Si se vuelve a correr la 105, correr la 151.

create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer := (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;
    end if;
    if v_n <> 1 then
        raise exception '151: en % se esperaba 1 aparición de «%» y hay %', p_fn, p_viejo, v_n;
    end if;
    execute replace(v_def, p_viejo, p_nuevo);
end $$;

select pg_temp.parchar('public.fn_agl_publicar_catalogos(jsonb)',
    E'                         agl_id, despues::text, motivo),',
    E'                         agl_id,   -- 151: el id inventado de una zona nueva no cuenta en la huella\n'
    || E'                         case when despues->>''zona_id'' is not null\n'
    || E'                                   and exists (select 1 from _agl_plan zn where zn.catalogo = ''zonas'' and zn.antes is null\n'
    || E'                                                and zn.local_id::text = _agl_plan.despues->>''zona_id'')\n'
    || E'                              then (despues || jsonb_build_object(''zona_id'', ''zona_nueva''))::text\n'
    || E'                              else despues::text end,\n'
    || E'                         motivo),',
    '151: el id inventado');
