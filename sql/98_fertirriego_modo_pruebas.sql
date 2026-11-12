-- =====================================================================
-- 98 · FERTIRRIEGO · MODO DE PRUEBAS
-- =====================================================================
-- Pedido del usuario (2026-11-12): poder probar Fertirriego en PRODUCCIÓN con algunos usuarios sin ensuciar lo real:
--   - El administrador activa el modo, elige las estaciones y los participantes.
--   - Los participantes, mientras el modo está activo, registran SOLO en prueba; los demás siguen normal.
--   - AGL ignora lo de prueba.
--   - Desactivar sin borrar: se conserva hasta 30 días; si no se reactiva, se borra solo. «Borrar» lo borra ya.
--   - Lo de prueba se borra de verdad (Supabase es solo intermediario: no guardar basura).
--
-- Cómo (lo más simple y sin tocar las reglas de cada registro): una ESTACIÓN DE PRUEBA por cada estación real
-- elegida («PRUEBA · <nombre>», estaciones_riego.prueba_de = la real). Todo lo de prueba vive en esas estaciones:
-- bodega, custodia, relevos, traslados y movimientos propios, separados de lo real por construcción.
--   - Ven los turnos y el plan de la estación real (para recibir y aplicar como en serio).
--   - fn_fert_puede: la estación de prueba solo para participantes (y el administrador); un participante, mientras
--     el modo está activo, no puede tocar estaciones reales.
--   - Traslados solo entre estaciones de la misma clase (prueba con prueba).
--   - fn_fert_exportar (AGL) no incluye nada de las estaciones de prueba.
-- Correr DESPUÉS de la 96. Idempotente. No cambia nada para nadie mientras no se active.

-- ---------------------------------------------------------------- estructura

alter table public.estaciones_riego add column if not exists prueba_de uuid references public.estaciones_riego(id);
comment on column public.estaciones_riego.prueba_de is
'98: si no es nula, esta es la ESTACIÓN DE PRUEBA de esa estación real (modo de pruebas de Fertirriego).';
create unique index if not exists estaciones_riego_prueba_de_key on public.estaciones_riego (prueba_de) where prueba_de is not null;

create table if not exists seguridad.fert_pruebas (
    id             boolean primary key default true check (id),
    activo         boolean not null default false,
    activado_en    timestamptz,
    desactivado_en timestamptz,
    cambiado_por   uuid
);
insert into seguridad.fert_pruebas (id) values (true) on conflict do nothing;

create table if not exists seguridad.fert_pruebas_participantes (
    perfil_id   uuid primary key references public.perfiles(id) on delete cascade,
    agregado_en timestamptz not null default now()
);
alter table seguridad.fert_pruebas enable row level security;
alter table seguridad.fert_pruebas_participantes enable row level security;
revoke all on seguridad.fert_pruebas, seguridad.fert_pruebas_participantes from public, anon, authenticated;

-- ---------------------------------------------------------------- reglas

/** ¿Quien pregunta está en pruebas AHORA? (modo activo y es participante) */
create or replace function public.fn_fert_en_pruebas()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select activo from seguridad.fert_pruebas), false)
       and exists (select 1 from seguridad.fert_pruebas_participantes where perfil_id = (select auth.uid()))
$$;

create or replace function public._fert_es_prueba(p_estacion uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select prueba_de is not null from public.estaciones_riego where id = p_estacion), false)
$$;

-- fn_fert_puede original → _fert_puede_base (una sola vez); la nueva agrega la regla de pruebas por encima
do $$
begin
    if to_regprocedure('public._fert_puede_base(uuid,text)') is null then
        alter function public.fn_fert_puede(uuid, text) rename to _fert_puede_base;
    end if;
end $$;

create or replace function public.fn_fert_puede(p_estacion uuid, p_accion text default 'ver')
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when public._fert_es_prueba(p_estacion)
            then (public.fn_fert_en_pruebas() or public.fn_es_admin()) and public._fert_puede_base(p_estacion, p_accion)
        when public.fn_fert_en_pruebas() then false          -- en pruebas: nada real
        else public._fert_puede_base(p_estacion, p_accion)
    end
$$;
grant execute on function public.fn_fert_puede(uuid, text) to authenticated;
revoke execute on function public._fert_puede_base(uuid, text) from public, anon, authenticated;

-- Traslados: solo entre estaciones de la misma clase
create or replace function public._fert_traslado_misma_clase()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if public._fert_es_prueba(new.origen_id) is distinct from public._fert_es_prueba(new.destino_id) then
        raise exception 'No se puede trasladar entre una estación de prueba y una real.';
    end if;
    return new;
end;
$$;
drop trigger if exists fert_traslados_misma_clase on public.fert_traslados;
create trigger fert_traslados_misma_clase before insert or update of origen_id, destino_id on public.fert_traslados
for each row execute function public._fert_traslado_misma_clase();

-- ---------------------------------------------------------------- ajustes a funciones existentes (por texto, con verificación)

create or replace function pg_temp.parchar(p_fn regprocedure, p_cambios text[][])
returns void language plpgsql as $$
declare
    d text := pg_get_functiondef(p_fn);
    i int;
begin
    if position('prueba_de' in d) > 0 or position('_fert_pruebas_purgar' in d) > 0 then
        return;   -- ya parchada (la migración se puede correr otra vez)
    end if;
    for i in 1 .. array_length(p_cambios, 1) loop
        if position(p_cambios[i][1] in d) = 0 then
            raise exception '98: no encontré en % el texto esperado: %', p_fn, p_cambios[i][1];
        end if;
        d := replace(d, p_cambios[i][1], p_cambios[i][2]);
    end loop;
    execute d;
end;
$$;

-- Estado del teléfono: la estación de prueba ve los turnos y el plan de su estación real; destinos de la misma clase
select pg_temp.parchar('public.fn_fert_estado_campo(date)', array[
    array['where tc.estacion_id = any(v_est) and tc.activo',
          'where (tc.estacion_id = any(v_est) or tc.estacion_id in (select e9.prueba_de from public.estaciones_riego e9 where e9.id = any(v_est))) and tc.activo'],
    array['''estacion_id'', tc.estacion_id, ''orden_sap''',
          '''estacion_id'', case when public.fn_fert_en_pruebas() then coalesce((select e9.id from public.estaciones_riego e9 where e9.prueba_de = tc.estacion_id and e9.id = any(v_est) limit 1), tc.estacion_id) else tc.estacion_id end, ''orden_sap'''],
    array['from public.estaciones_riego e where e.activo), ''[]''::jsonb)',
          'from public.estaciones_riego e where e.activo and ((e.prueba_de is not null) = public.fn_fert_en_pruebas())), ''[]''::jsonb)']
]);

-- Aplicar: el turno de la estación real vale para su estación de prueba (no queda «turno de otra estación»)
select pg_temp.parchar('public._fert_op_aplicacion(uuid,jsonb,timestamp with time zone,boolean,uuid)', array[
    array['if v_tc.estacion_id is distinct from v_estacion then',
          'if v_tc.estacion_id is distinct from coalesce((select e9.prueba_de from public.estaciones_riego e9 where e9.id = v_estacion), v_estacion) then']
]);

-- AGL: nada de las estaciones de prueba
select pg_temp.parchar('public.fn_fert_exportar(bigint,integer)', array[
    array['select * from public.fert_movimientos where cursor > coalesce(p_cursor, 0) order by cursor limit v_lim',
          'select * from public.fert_movimientos where cursor > coalesce(p_cursor, 0) and estacion_id not in (select e9.id from public.estaciones_riego e9 where e9.prueba_de is not null) order by cursor limit v_lim'],
    array['join public.estaciones_riego e on e.id = b.estacion_id', 'join public.estaciones_riego e on e.id = b.estacion_id and e.prueba_de is null'],
    array['join public.estaciones_riego e on e.id = s.estacion_id', 'join public.estaciones_riego e on e.id = s.estacion_id and e.prueba_de is null'],
    array['join public.estaciones_riego e on e.id = r.estacion_id', 'join public.estaciones_riego e on e.id = r.estacion_id and e.prueba_de is null']
]);

-- ---------------------------------------------------------------- borrar y purgar

/** Borra TODO lo de las estaciones de prueba y las estaciones de prueba. -> cantidades borradas. */
create or replace function public._fert_pruebas_borrar_todo()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_est  uuid[] := array(select id from public.estaciones_riego where prueba_de is not null);
    v_tras uuid[];
    v_mov  bigint;
    v_ops  bigint;
begin
    if cardinality(v_est) = 0 then
        return jsonb_build_object('estaciones', 0, 'movimientos', 0, 'registros', 0);
    end if;
    v_tras := array(select id from public.fert_traslados where origen_id = any(v_est) or destino_id = any(v_est));
    delete from public.fert_traslados_detalle where traslado_id = any(v_tras);
    delete from public.fert_traslados where id = any(v_tras);
    delete from public.fert_relevos where estacion_id = any(v_est);              -- sus diferencias se van en cascada
    delete from public.fert_movimientos where estacion_id = any(v_est);
    get diagnostics v_mov = row_count;
    delete from public.fert_devoluciones_detalle where devolucion_id in (select id from public.fert_devoluciones where estacion_id = any(v_est));
    delete from public.fert_devoluciones where estacion_id = any(v_est);
    delete from public.fert_aplicaciones_detalle where aplicacion_id in (select id from public.fert_aplicaciones where estacion_id = any(v_est));
    delete from public.fert_aplicaciones where estacion_id = any(v_est);
    delete from public.fert_recepciones_detalle where recepcion_id in (select id from public.fert_recepciones where estacion_id = any(v_est));
    delete from public.fert_recepciones where estacion_id = any(v_est);
    delete from public.fert_conteos_detalle where conteo_id in (select id from public.fert_conteos where estacion_id = any(v_est));
    delete from public.fert_conteos where estacion_id = any(v_est);
    delete from public.fert_bitacora_riego where estacion_id = any(v_est);
    delete from public.fert_saldos where estacion_id = any(v_est);
    delete from public.fert_custodia where estacion_id = any(v_est);
    delete from public.fert_operaciones where estacion_id = any(v_est);
    get diagnostics v_ops = row_count;
    delete from public.perfiles_estaciones where estacion_id = any(v_est);
    delete from public.estaciones_riego where id = any(v_est);
    return jsonb_build_object('estaciones', cardinality(v_est), 'movimientos', v_mov, 'registros', v_ops);
end;
$$;
revoke execute on function public._fert_pruebas_borrar_todo() from public, anon, authenticated;

/** Desactivado hace más de 30 días y sin reactivar: se borra solo (lo llaman la sincronización y el administrador). */
create or replace function public._fert_pruebas_purgar()
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if exists (select 1 from seguridad.fert_pruebas where not activo and desactivado_en < now() - interval '30 days')
       and exists (select 1 from public.estaciones_riego where prueba_de is not null) then
        perform public._fert_pruebas_borrar_todo();
        delete from seguridad.fert_pruebas_participantes where perfil_id is not null;   -- Supabase exige WHERE
    end if;
end;
$$;
revoke execute on function public._fert_pruebas_purgar() from public, anon, authenticated;

-- La sincronización de los teléfonos (frecuente) revisa la purga de 30 días
select pg_temp.parchar('public.fn_fert_sincronizar(jsonb)', array[
    array['    for v_op in select value from jsonb_array_elements(p_ops) with ordinality as x(value, n) order by n loop',
          E'    perform public._fert_pruebas_purgar();\n    for v_op in select value from jsonb_array_elements(p_ops) with ordinality as x(value, n) order by n loop']
]);

-- ---------------------------------------------------------------- administración

create or replace function public._fert_pruebas_exigir_admin()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not (public.fn_es_admin() or (public.fn_tiene_permiso('fertirriego', 'configurar') and public.fn_mi_alcance('fertirriego', 'configurar') = 'global')) then
        raise exception 'Solo el administrador de Fertirriego maneja el modo de pruebas.' using errcode = '42501';
    end if;
end;
$$;

/** Para la pantalla del administrador. */
create or replace function public.fn_fert_pruebas_estado()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v seguridad.fert_pruebas%rowtype;
    v_est uuid[] := array(select id from public.estaciones_riego where prueba_de is not null);
begin
    perform public._fert_pruebas_exigir_admin();
    select * into v from seguridad.fert_pruebas;
    return jsonb_build_object(
        'activo', v.activo, 'activado_en', v.activado_en, 'desactivado_en', v.desactivado_en,
        'se_borra_el', case when not v.activo and v.desactivado_en is not null and cardinality(v_est) > 0
                            then v.desactivado_en + interval '30 days' end,
        'participantes', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre)
                                   from seguridad.fert_pruebas_participantes x join public.perfiles p on p.id = x.perfil_id), '[]'::jsonb),
        'estaciones', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'real_id', e.prueba_de,
                                                                    'real', r.nombre) order by r.nombre)
                                from public.estaciones_riego e join public.estaciones_riego r on r.id = e.prueba_de), '[]'::jsonb),
        'movimientos', (select count(*) from public.fert_movimientos where estacion_id = any(v_est)),
        'registros', (select count(*) from public.fert_operaciones where estacion_id = any(v_est)));
end;
$$;

/** Activa (o actualiza): crea las estaciones de prueba que falten, fija los participantes y los asigna a ellas. */
create or replace function public.fn_fert_pruebas_activar(p_estaciones uuid[], p_participantes uuid[])
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_real record;
begin
    perform public._fert_pruebas_exigir_admin();
    perform public._fert_pruebas_purgar();
    if coalesce(cardinality(p_estaciones), 0) = 0 then
        raise exception 'Elige al menos una estación para probar.';
    end if;
    if coalesce(cardinality(p_participantes), 0) = 0 then
        raise exception 'Elige al menos un participante.';
    end if;
    for v_real in select e.* from public.estaciones_riego e where e.id = any(p_estaciones) and e.prueba_de is null loop
        insert into public.estaciones_riego (nombre, zona_id, activo, prueba_de)
        values ('PRUEBA · ' || v_real.nombre, v_real.zona_id, true, v_real.id)
        on conflict (prueba_de) where prueba_de is not null do update set zona_id = excluded.zona_id, activo = true;
    end loop;
    delete from seguridad.fert_pruebas_participantes where perfil_id <> all(p_participantes);
    insert into seguridad.fert_pruebas_participantes (perfil_id)
    select x from unnest(p_participantes) x where exists (select 1 from public.perfiles where id = x)
    on conflict do nothing;
    insert into public.perfiles_estaciones (perfil_id, estacion_id)
    select x.perfil_id, e.id from seguridad.fert_pruebas_participantes x cross join public.estaciones_riego e
    where e.prueba_de is not null
    on conflict do nothing;
    update seguridad.fert_pruebas
    set activo = true, activado_en = now(), desactivado_en = null, cambiado_por = (select auth.uid()) where id;
    return public.fn_fert_pruebas_estado();
end;
$$;

/** Desactiva SIN borrar: lo de prueba se conserva 30 días (si no se reactiva, se borra solo). */
create or replace function public.fn_fert_pruebas_desactivar()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public._fert_pruebas_exigir_admin();
    update seguridad.fert_pruebas set activo = false, desactivado_en = now(), cambiado_por = (select auth.uid()) where id;
    return public.fn_fert_pruebas_estado();
end;
$$;

/** Borra ya todo lo de prueba (estaciones de prueba incluidas) y apaga el modo. */
create or replace function public.fn_fert_pruebas_borrar()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v jsonb;
begin
    perform public._fert_pruebas_exigir_admin();
    v := public._fert_pruebas_borrar_todo();
    delete from seguridad.fert_pruebas_participantes where perfil_id is not null;   -- Supabase exige WHERE
    update seguridad.fert_pruebas set activo = false, desactivado_en = now(), cambiado_por = (select auth.uid()) where id;
    return v;
end;
$$;

grant execute on function public.fn_fert_en_pruebas() to authenticated;
grant execute on function public.fn_fert_pruebas_estado() to authenticated;
grant execute on function public.fn_fert_pruebas_activar(uuid[], uuid[]) to authenticated;
grant execute on function public.fn_fert_pruebas_desactivar() to authenticated;
grant execute on function public.fn_fert_pruebas_borrar() to authenticated;
