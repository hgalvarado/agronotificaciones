-- =====================================================================
-- 102 · FERTIRRIEGO · ARCHIVAR EL TURNO AL TERMINAR SU CICLO (Supabase solo intermediario)
-- =====================================================================
-- Pedido del usuario (2026-11-13): «quiero que Supabase sea un intermediario… al momento de que un lote se dé por
-- cerrado el ciclo, esa información bajarla (botón de terminado en AGL turnos), pero si lo vuelvo a activar, que se
-- vuelva a subir». Diseño: docs/fertirriego-archivo-turnos.md.
--
-- Dos pasos seguros, siempre desde AGL (usuario técnico con «Fertirriego · Conexión AGL › Publicar», o administrador):
--   1. fn_fert_exportar_turno(agl_id)        → TODO lo del turno (filas tal cual + vista para AGL) y su HUELLA.
--                                             Solo lectura. AGL lo guarda en su carpeta y verifica conteos y huella.
--   2. fn_fert_archivar_turno(agl_id, huella) → borra lo del turno SOLO si la huella sigue igual (nada cambió desde el
--                                             paso 1) y deja el turno inactivo y «archivado».
--   3. fn_fert_restaurar_turno(paquete)      → vuelve a meter las MISMAS filas (mismos id y cursor) y reactiva el turno.
--                                             Idempotente. Se comprueba que la huella de lo restaurado es la original.
--
-- Qué es «del turno» (solo estaciones reales; nada del modo de pruebas): aplicaciones (+ detalle, devoluciones y su
-- detalle), sus movimientos del libro (aplicación, devolución, anulación), la bitácora de riego, el plan y las
-- operaciones (sobres del teléfono) de esos documentos. Lo de la ESTACIÓN (recepciones, conteos, relevos, traslados,
-- envases) no es de un turno y se queda.
--
-- El inventario es por ESTACIÓN: al borrar los movimientos del turno se asienta UN movimiento «ARCHIVO_TURNO» por
-- estación × producto igual a la suma de lo borrado. El saldo no cambia (se verifica dentro de la función). Al
-- restaurar se quita ese consolidado y vuelven los originales.
--
-- El libro (fert_movimientos) pasa a estar protegido por un disparador: nadie lo edita ni lo borra, salvo
--   a) las filas de estaciones de prueba (el modo de pruebas las borra, sql/98), y
--   b) estas funciones, que abren el paso de forma explícita y solo dentro de su transacción (fert.libro_permitir).
--
-- Lo que llegue del teléfono para un turno archivado (capturado sin señal) se RECHAZA con un mensaje claro: queda
-- en «Envíos» del teléfono y guardado como rechazado (AGL lo ve en «Rechazados»). No se pierde.
--
-- Correr DESPUÉS de la 101. Idempotente. Todo UPDATE/DELETE lleva WHERE (Supabase lo exige aun dentro de funciones).
-- =====================================================================


-- ---------------------------------------------------------------- 1 · el turno guarda su archivo

alter table public.turnos_ciclo
    add column if not exists archivado_at       timestamptz,
    add column if not exists archivado_por      uuid,
    add column if not exists archivo_huella     text,
    add column if not exists archivo_conteos    jsonb,
    add column if not exists archivo_documentos uuid[] not null default '{}',
    add column if not exists restaurado_at      timestamptz;

comment on column public.turnos_ciclo.archivado_at is
'102: ciclo terminado en AGL. Sus registros de campo se bajaron a AGL y se borraron de aquí (Supabase es intermediario).';
comment on column public.turnos_ciclo.archivo_huella is '102: huella (sha256) de lo que se archivó; restaurar exige la misma.';
comment on column public.turnos_ciclo.archivo_documentos is
'102: aplicaciones y devoluciones archivadas (para rechazar con mensaje claro lo que el teléfono mande sobre ellas).';


-- ---------------------------------------------------------------- 2 · nuevo tipo de movimiento ARCHIVO_TURNO
-- Se agrega al check que haya (conserva tipos que otras migraciones hayan sumado).

do $$
declare
    v_nombre text;
    v_def    text;
begin
    select c.conname, pg_get_constraintdef(c.oid) into v_nombre, v_def
    from pg_constraint c
    where c.conrelid = 'public.fert_movimientos'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%SALDO_INICIAL%'
    limit 1;
    if v_nombre is null then
        raise exception '102: no encontré el check de tipos de fert_movimientos';
    end if;
    if position('ARCHIVO_TURNO' in v_def) = 0 then
        if position('''ANULACION''::text' in v_def) = 0 then
            raise exception '102: el check de tipos de fert_movimientos no tiene la forma esperada: %', v_def;
        end if;
        execute format('alter table public.fert_movimientos drop constraint %I', v_nombre);
        execute format('alter table public.fert_movimientos add constraint %I %s', v_nombre,
                       replace(v_def, '''ANULACION''::text', '''ANULACION''::text, ''ARCHIVO_TURNO''::text'));
    end if;
end $$;


-- ---------------------------------------------------------------- 3 · el libro no se edita ni se borra

-- Invoker (no definer): así current_user es quien de verdad borra. Los usuarios de la app (authenticated/anon) nunca
-- pasan; el administrador de la base (llave de servicio de Supabase o el SQL Editor) sí, para mantenimiento y para
-- que las pruebas limpien lo que crean.
create or replace function public._fert_libro_inalterable()
returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
    if coalesce(current_setting('fert.libro_permitir', true), '') = 'on'
       or current_user in ('service_role', 'postgres', 'supabase_admin')
       or public._fert_es_prueba(old.estacion_id) then
        return case when tg_op = 'DELETE' then old else new end;
    end if;
    raise exception 'El libro de Fertirriego no se edita ni se borra: un error se corrige anulando.';
end;
$$;
revoke execute on function public._fert_libro_inalterable() from public, anon, authenticated;

drop trigger if exists fert_movimientos_inalterable on public.fert_movimientos;
create trigger fert_movimientos_inalterable before update or delete on public.fert_movimientos
for each row execute function public._fert_libro_inalterable();


-- ---------------------------------------------------------------- 4 · reglas comunes

/** Solo el usuario técnico de AGL (Conexión AGL › Publicar) o un administrador. */
create or replace function public._fert_archivo_exigir()
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'publicar')) then
        raise exception 'Este usuario no tiene «Publicar» en «Fertirriego · Conexión AGL».' using errcode = '42501';
    end if;
end;
$$;
revoke execute on function public._fert_archivo_exigir() from public, anon, authenticated;

/** Mensaje para lo que llega del campo sobre un turno archivado. */
create or replace function public._fert_msg_archivado(p_tc uuid)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select format('El turno %s ya terminó su ciclo: se cerró en AGL el %s. Este registro NO se aplicó; queda en «Envíos» '
                  || 'y guardado como rechazado (AGL lo ve). Si hace falta, pide que reactiven el turno en AGL y vuelve a registrarlo.',
                  coalesce(t.codigo, 'elegido'), to_char(tc.archivado_at at time zone 'America/Tegucigalpa', 'DD/MM/YYYY'))
    from public.turnos_ciclo tc left join public.turnos t on t.id = tc.turno_id
    where tc.id = p_tc
$$;
revoke execute on function public._fert_msg_archivado(uuid) from public, anon, authenticated;

/** Antes de procesar un registro del teléfono: ¿es de un turno archivado? → se rechaza con mensaje claro. */
create or replace function public._fert_exigir_turno_vivo(p_tipo text, d jsonb)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_tc  uuid;
    v_doc uuid;
begin
    if p_tipo in ('aplicacion', 'bitacora') then
        v_tc := (select id from public.turnos_ciclo
                 where id = public._fert_uuid(d->>'turno_ciclo_id') and archivado_at is not null);
    elsif p_tipo in ('devolucion', 'anulacion') then
        v_doc := public._fert_uuid(coalesce(d->>'aplicacion_id', d->>'documento_id'));
        if v_doc is not null
           and not exists (select 1 from public.fert_aplicaciones where id = v_doc)
           and not exists (select 1 from public.fert_devoluciones where id = v_doc) then
            v_tc := (select id from public.turnos_ciclo
                     where archivado_at is not null and v_doc = any(archivo_documentos) limit 1);
        end if;
    end if;
    if v_tc is not null then
        raise exception '%', public._fert_msg_archivado(v_tc);
    end if;
end;
$$;
revoke execute on function public._fert_exigir_turno_vivo(text, jsonb) from public, anon, authenticated;

/** Respaldo de la regla anterior en la tabla misma (por si llega por otro camino). Lo de prueba no se toca. */
create or replace function public._fert_turno_archivado_guardia()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if coalesce(current_setting('fert.libro_permitir', true), '') = 'on' or new.turno_ciclo_id is null then
        return new;
    end if;
    if tg_table_name = 'fert_movimientos' then
        if new.tipo = 'ARCHIVO_TURNO' then
            return new;
        end if;
    end if;
    if not public._fert_es_prueba(new.estacion_id)
       and exists (select 1 from public.turnos_ciclo where id = new.turno_ciclo_id and archivado_at is not null) then
        raise exception '%', public._fert_msg_archivado(new.turno_ciclo_id);
    end if;
    return new;
end;
$$;
revoke execute on function public._fert_turno_archivado_guardia() from public, anon, authenticated;

drop trigger if exists fert_turno_archivado on public.fert_aplicaciones;
create trigger fert_turno_archivado before insert on public.fert_aplicaciones
for each row execute function public._fert_turno_archivado_guardia();
drop trigger if exists fert_turno_archivado on public.fert_bitacora_riego;
create trigger fert_turno_archivado before insert or update on public.fert_bitacora_riego
for each row execute function public._fert_turno_archivado_guardia();
drop trigger if exists fert_turno_archivado on public.fert_movimientos;
create trigger fert_turno_archivado before insert on public.fert_movimientos
for each row execute function public._fert_turno_archivado_guardia();


-- ---------------------------------------------------------------- 5 · qué es del turno

/** Los registros de un turno (solo estaciones reales). Lo de tipo ARCHIVO_TURNO no cuenta: es el consolidado. */
create or replace function public._fert_turno_ids(
    p_tc uuid,
    out aplicaciones uuid[], out devoluciones uuid[], out movimientos uuid[], out operaciones uuid[],
    out bitacora date[], out plan bigint[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    aplicaciones := array(
        select a.id from public.fert_aplicaciones a
        join public.estaciones_riego e on e.id = a.estacion_id and e.prueba_de is null
        where a.turno_ciclo_id = p_tc order by a.id);
    devoluciones := array(
        select d.id from public.fert_devoluciones d where d.aplicacion_id = any(aplicaciones) order by d.id);
    movimientos := array(
        select m.id from public.fert_movimientos m
        join public.estaciones_riego e on e.id = m.estacion_id and e.prueba_de is null
        where (m.turno_ciclo_id = p_tc or m.documento_id = any(aplicaciones) or m.documento_id = any(devoluciones))
          and m.tipo <> 'ARCHIVO_TURNO'
        order by m.cursor);
    bitacora := array(
        select b.fecha from public.fert_bitacora_riego b
        where b.turno_ciclo_id = p_tc
          and not public._fert_es_prueba(coalesce(
                  (select o.estacion_id from public.fert_operaciones o where o.id = b.operacion_id), b.estacion_id))
        order by b.fecha);
    plan := array(select p.id from public.fert_plan p where p.turno_ciclo_id = p_tc order by p.id);
    operaciones := array(
        select distinct x from (
            select unnest(aplicaciones) as x
            union select unnest(devoluciones)
            union select m.operacion_id from public.fert_movimientos m where m.id = any(movimientos)
            union select b.operacion_id from public.fert_bitacora_riego b where b.turno_ciclo_id = p_tc and b.fecha = any(bitacora)
            union select o.id from public.fert_operaciones o
                  where o.tipo = 'bitacora' and o.resultado <> 'RECHAZADO'
                    and o.datos->>'turno_ciclo_id' = p_tc::text and not public._fert_es_prueba(o.estacion_id)
        ) y where x is not null order by 1);
end;
$$;
revoke execute on function public._fert_turno_ids(uuid) from public, anon, authenticated;

/**
 * Las filas tal cual (to_jsonb de cada fila, en orden fijo). Su texto da la huella. Las horas se escriben en UTC
 * para que la huella no dependa de la zona horaria de la sesión.
 */
create or replace function public._fert_turno_filas(p_tc uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' as $$
declare
    i record;
begin
    select * into i from public._fert_turno_ids(p_tc);
    return jsonb_build_object(
        'fert_operaciones', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)
                                      from public.fert_operaciones x where x.id = any(i.operaciones)), '[]'::jsonb),
        'fert_aplicaciones', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)
                                       from public.fert_aplicaciones x where x.id = any(i.aplicaciones)), '[]'::jsonb),
        'fert_aplicaciones_detalle', coalesce((select jsonb_agg(to_jsonb(x) order by x.aplicacion_id, x.material_id)
                                               from public.fert_aplicaciones_detalle x where x.aplicacion_id = any(i.aplicaciones)), '[]'::jsonb),
        'fert_devoluciones', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)
                                       from public.fert_devoluciones x where x.id = any(i.devoluciones)), '[]'::jsonb),
        'fert_devoluciones_detalle', coalesce((select jsonb_agg(to_jsonb(x) order by x.devolucion_id, x.material_id)
                                               from public.fert_devoluciones_detalle x where x.devolucion_id = any(i.devoluciones)), '[]'::jsonb),
        'fert_movimientos', coalesce((select jsonb_agg(to_jsonb(x) order by x.cursor)
                                      from public.fert_movimientos x where x.id = any(i.movimientos)), '[]'::jsonb),
        'fert_bitacora_riego', coalesce((select jsonb_agg(to_jsonb(x) order by x.fecha)
                                         from public.fert_bitacora_riego x where x.turno_ciclo_id = p_tc and x.fecha = any(i.bitacora)), '[]'::jsonb),
        'fert_plan', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)
                               from public.fert_plan x where x.id = any(i.plan)), '[]'::jsonb));
end;
$$;
revoke execute on function public._fert_turno_filas(uuid) from public, anon, authenticated;

create or replace function public._fert_huella(p jsonb)
returns text
language sql immutable as $$
    select encode(sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;

create or replace function public._fert_conteos_filas(f jsonb)
returns jsonb
language sql immutable as $$
    select jsonb_build_object(
        'operaciones', jsonb_array_length(f->'fert_operaciones'),
        'aplicaciones', jsonb_array_length(f->'fert_aplicaciones'),
        'lineas', jsonb_array_length(f->'fert_aplicaciones_detalle'),
        'devoluciones', jsonb_array_length(f->'fert_devoluciones'),
        'devoluciones_lineas', jsonb_array_length(f->'fert_devoluciones_detalle'),
        'movimientos', jsonb_array_length(f->'fert_movimientos'),
        'bitacora', jsonb_array_length(f->'fert_bitacora_riego'),
        'plan', jsonb_array_length(f->'fert_plan'))
$$;

/** Suma del libro por estación × producto, para los pares de unos movimientos. Para comprobar que el saldo no cambia. */
create or replace function public._fert_saldos_pares(p_pares jsonb)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_object_agg(k.e || '|' || k.m, (select coalesce(sum(m.cantidad), 0) from public.fert_movimientos m
                                                           where m.estacion_id = k.e::uuid and m.material_id = k.m::uuid)), '{}'::jsonb)
    from (select distinct x->>'estacion_id' as e, x->>'material_id' as m from jsonb_array_elements(p_pares) x) k
$$;
revoke execute on function public._fert_saldos_pares(jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------- 6 · paso 1: exportar (solo lectura)

create or replace function public.fn_fert_exportar_turno(p_agl_id text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp set timezone = 'UTC' as $$
declare
    v_tc    public.turnos_ciclo%rowtype;
    v_cod   text;
    i       record;
    v_filas jsonb;
begin
    perform public._fert_archivo_exigir();
    select * into v_tc from public.turnos_ciclo where agl_id = btrim(p_agl_id);
    if not found then
        raise exception 'El turno % no está publicado en esta base de AgroNotificaciones.', p_agl_id;
    end if;
    v_cod := (select codigo from public.turnos where id = v_tc.turno_id);

    if v_tc.archivado_at is not null then
        return jsonb_build_object('version', 1, 'agl_id', v_tc.agl_id, 'turno', v_cod, 'ya_archivado', true,
                                  'archivado_at', v_tc.archivado_at, 'huella', v_tc.archivo_huella,
                                  'conteos', v_tc.archivo_conteos);
    end if;

    select * into i from public._fert_turno_ids(v_tc.id);
    v_filas := public._fert_turno_filas(v_tc.id);

    return jsonb_build_object(
        'version', 1, 'agl_id', v_tc.agl_id, 'ya_archivado', false, 'generado', now(),
        'turno', v_cod, 'temporada', v_tc.temporada, 'ciclo', v_tc.ciclo, 'fecha_siembra', v_tc.fecha_siembra,
        'orden_sap', v_tc.orden_sap, 'area_mz', v_tc.area_mz,
        'estacion', (select e.nombre from public.estaciones_riego e where e.id = v_tc.estacion_id),
        'zona', (select z.nombre from public.zonas z where z.id = v_tc.zona_id),
        'turno_ciclo_id', v_tc.id,
        'huella', public._fert_huella(v_filas),
        'conteos', public._fert_conteos_filas(v_filas),
        'filas', v_filas,
        -- Lo que quedará en el libro en su lugar (un consolidado por estación × producto)
        'consolidado', coalesce((
            select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'material', mt.codigo, 'texto_material', mt.descripcion,
                                                'unidad', mt.unidad, 'cantidad', s.cantidad) order by e.nombre, mt.codigo)
            from (select m.estacion_id, m.material_id, sum(m.cantidad) as cantidad
                  from public.fert_movimientos m where m.id = any(i.movimientos) group by 1, 2 having sum(m.cantidad) <> 0) s
            join public.estaciones_riego e on e.id = s.estacion_id
            join public.materiales mt on mt.id = s.material_id), '[]'::jsonb),
        -- Lo mismo con la forma de fn_fert_exportar, para que AGL lo siga mostrando después de archivar
        'agl', jsonb_build_object(
            'movimientos', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'cursor', m.cursor, 'id', m.id, 'fecha_hora', m.fecha_hora, 'tipo', m.tipo, 'cantidad', m.cantidad,
                    'estacion', e.nombre, 'zona', z.nombre, 'material', mt.codigo, 'texto_material', mt.descripcion,
                    'unidad', mt.unidad, 'origen', mt.origen, 'grupo', mt.grupo, 'analisis', mt.fert_analisis,
                    'turno', v_cod, 'turno_agl_id', v_tc.agl_id, 'temporada', v_tc.temporada, 'ciclo', v_tc.ciclo,
                    'orden_sap', v_tc.orden_sap, 'fecha_turno', ap.fecha,
                    'ddt_plan', ap.ddt_plan, 'fecha_plan', ap.fecha_plan, 'extra', ap.extra, 'ddt_real', ap.ddt_real,
                    'recepcion_turnos', null,
                    'comentario', ap.comentario,
                    'documento_tipo', m.documento_tipo, 'documento_id', m.documento_id, 'anula_id', m.anula_id,
                    'registrado_por', p.nombre,
                    'ejecutor', (select pp.nombre from public.perfiles pp where pp.id = ap.ejecutor_id),
                    'observaciones', (select o.observaciones from public.fert_operaciones o where o.id = m.operacion_id)
                ) order by m.cursor)
                from public.fert_movimientos m
                join public.estaciones_riego e on e.id = m.estacion_id
                left join public.zonas z on z.id = e.zona_id
                join public.materiales mt on mt.id = m.material_id
                left join public.fert_aplicaciones ap on ap.id = m.documento_id
                left join public.perfiles p on p.id = m.registrado_por
                where m.id = any(i.movimientos)), '[]'::jsonb),
            'aplicaciones', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'id', a.id, 'estacion', e.nombre, 'zona', z.nombre, 'turno', v_cod, 'turno_agl_id', v_tc.agl_id,
                    'fecha', a.fecha, 'fecha_hora', a.fecha_hora, 'ddt_plan', a.ddt_plan, 'fecha_plan', a.fecha_plan,
                    'extra', a.extra, 'ddt_real', a.ddt_real,
                    'ejecutor', (select x.nombre from public.perfiles x where x.id = a.ejecutor_id),
                    'ejecutor2', (select x.nombre from public.perfiles x where x.id = a.ejecutor2_id),
                    'registrado_por', p.nombre, 'comentario', a.comentario, 'observaciones', to_jsonb(o.observaciones),
                    'creado_en', o.creado_en, 'recibido_en', o.recibido_en,
                    'anulado_at', a.anulado_at, 'motivo_anulacion', a.motivo_anulacion,
                    'lineas', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'texto', m.descripcion, 'unidad', m.unidad,
                                            'cantidad', d.cantidad, 'en_plan', d.en_plan, 'origen', m.origen, 'analisis', m.fert_analisis))
                                        from public.fert_aplicaciones_detalle d join public.materiales m on m.id = d.material_id
                                        where d.aplicacion_id = a.id), '[]'::jsonb),
                    'devoluciones', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'cantidad', dd.cantidad,
                                                  'motivo', dv.motivo, 'fecha_hora', dv.fecha_hora, 'anulado_at', dv.anulado_at))
                                              from public.fert_devoluciones dv
                                              join public.fert_devoluciones_detalle dd on dd.devolucion_id = dv.id
                                              join public.materiales m on m.id = dd.material_id
                                              where dv.aplicacion_id = a.id), '[]'::jsonb))
                    order by a.fecha, a.fecha_hora)
                from public.fert_aplicaciones a
                join public.estaciones_riego e on e.id = a.estacion_id
                left join public.zonas z on z.id = e.zona_id
                left join public.perfiles p on p.id = a.registrado_por
                left join public.fert_operaciones o on o.id = a.id
                where a.id = any(i.aplicaciones)), '[]'::jsonb),
            'bitacora_riego', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'turno_agl_id', v_tc.agl_id, 'turno', v_cod, 'fecha', b.fecha, 'estacion', e.nombre,
                    'horas_fertilizacion', b.horas_fertilizacion, 'horas_riego', b.horas_riego,
                    'hora_inicio', b.hora_inicio, 'hora_fin', b.hora_fin,
                    'ppm_cloro_cabezal', b.ppm_cloro_cabezal, 'ppm_cloro_campo', b.ppm_cloro_campo,
                    'ejecutor', (select p.nombre from public.perfiles p where p.id = b.ejecutor_id)) order by b.fecha)
                from public.fert_bitacora_riego b
                join public.estaciones_riego e on e.id = b.estacion_id
                where b.turno_ciclo_id = v_tc.id and b.fecha = any(i.bitacora)), '[]'::jsonb)));
end;
$$;


-- ---------------------------------------------------------------- 7 · paso 2: archivar (borra si nada cambió)

create or replace function public.fn_fert_archivar_turno(p_agl_id text, p_huella text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tc      public.turnos_ciclo%rowtype;
    i         record;
    v_filas   jsonb;
    v_huella  text;
    v_conteos jsonb;
    v_antes   jsonb;
    v_despues jsonb;
    v_op      uuid := gen_random_uuid();
    v_otros   integer;
    v_consol  jsonb;
begin
    perform public._fert_archivo_exigir();
    select * into v_tc from public.turnos_ciclo where agl_id = btrim(p_agl_id) for update;
    if not found then
        raise exception 'El turno % no está publicado en esta base de AgroNotificaciones.', p_agl_id;
    end if;
    if v_tc.archivado_at is not null then
        if v_tc.archivo_huella = p_huella then   -- ya se hizo (reintento): misma respuesta, sin tocar nada
            return jsonb_build_object('archivado', true, 'ya_archivado', true, 'agl_id', v_tc.agl_id,
                                      'archivado_at', v_tc.archivado_at, 'conteos', v_tc.archivo_conteos, 'consolidado', '[]'::jsonb);
        end if;
        raise exception 'El turno % ya estaba archivado con otra copia. Reactívalo primero.', p_agl_id;
    end if;

    select * into i from public._fert_turno_ids(v_tc.id);
    v_filas := public._fert_turno_filas(v_tc.id);
    v_huella := public._fert_huella(v_filas);
    if v_huella is distinct from p_huella then
        raise exception 'El turno % cambió desde que AGL lo bajó (llegó algo nuevo del campo o se republicó el plan). '
                        'No se borró nada: vuelve a «Terminar ciclo».', p_agl_id;
        -- Sin errcode 40001 («reintentar»): Supabase reintenta ese código solo y, como la huella nunca cuadra, se
        -- quedaba dando vueltas hasta vencer el tiempo (lo vio la QA en desarrollo).
    end if;
    v_conteos := public._fert_conteos_filas(v_filas);

    -- Nada que quede debe apuntar a lo que se va (si no, se detiene sin borrar)
    select (select count(*) from public.fert_movimientos m where m.operacion_id = any(i.operaciones) and not (m.id = any(i.movimientos)))
         + (select count(*) from public.fert_movimientos m where m.anula_id = any(i.movimientos) and not (m.id = any(i.movimientos)))
         + (select count(*) from public.fert_bitacora_riego b where b.operacion_id = any(i.operaciones)
                and not (b.turno_ciclo_id = v_tc.id and b.fecha = any(i.bitacora)))
         + (select count(*) from public.fert_recepciones r where r.id = any(i.operaciones))
         + (select count(*) from public.fert_conteos c where c.id = any(i.operaciones))
         + (select count(*) from public.fert_aplicaciones a where a.id = any(i.operaciones) and not (a.id = any(i.aplicaciones)))
         + (select count(*) from public.fert_devoluciones d where d.aplicacion_id = any(i.aplicaciones) and not (d.id = any(i.devoluciones)))
      into v_otros;
    if v_otros > 0 then
        raise exception 'El turno % tiene % registro(s) enlazados con otros que no son del turno. No se borró nada.', p_agl_id, v_otros;
    end if;

    v_antes := public._fert_saldos_pares(v_filas->'fert_movimientos');

    perform set_config('fert.libro_permitir', 'on', true);

    delete from public.fert_movimientos where id = any(i.movimientos);
    delete from public.fert_bitacora_riego where turno_ciclo_id = v_tc.id and fecha = any(i.bitacora);
    delete from public.fert_devoluciones_detalle where devolucion_id = any(i.devoluciones);
    delete from public.fert_devoluciones where id = any(i.devoluciones);
    delete from public.fert_aplicaciones_detalle where aplicacion_id = any(i.aplicaciones);
    delete from public.fert_aplicaciones where id = any(i.aplicaciones);
    delete from public.fert_plan where id = any(i.plan);
    delete from public.fert_operaciones where id = any(i.operaciones);

    -- Un consolidado por estación × producto: el saldo de la bodega no cambia
    if exists (select 1 from jsonb_array_elements(v_filas->'fert_movimientos')) then
        insert into public.fert_operaciones
            (id, tipo, estacion_id, perfil_id, creado_en, enviado_en, inmediato, datos, resultado)
        values
            (v_op, 'archivo_turno', v_tc.estacion_id, (select auth.uid()), now(), now(), true,
             jsonb_build_object('agl_id', v_tc.agl_id, 'turno_ciclo_id', v_tc.id, 'huella', v_huella, 'conteos', v_conteos),
             'ACEPTADO');
        insert into public.fert_movimientos
            (operacion_id, estacion_id, material_id, tipo, cantidad, fecha_hora, turno_ciclo_id,
             documento_tipo, documento_id, registrado_por)
        select v_op, (x->>'estacion_id')::uuid, (x->>'material_id')::uuid, 'ARCHIVO_TURNO', sum((x->>'cantidad')::numeric),
               max((x->>'fecha_hora')::timestamptz), v_tc.id, 'archivo_turno', v_op, (select auth.uid())
        from jsonb_array_elements(v_filas->'fert_movimientos') x
        group by 1, 2, 3
        having sum((x->>'cantidad')::numeric) <> 0;
    end if;

    v_despues := public._fert_saldos_pares(v_filas->'fert_movimientos');
    if v_antes is distinct from v_despues then
        raise exception 'El saldo de la bodega habría cambiado al archivar el turno %. No se borró nada.', p_agl_id;
    end if;

    perform set_config('fert.libro_permitir', 'off', true);

    update public.turnos_ciclo
       set activo = false, archivado_at = now(), archivado_por = (select auth.uid()), archivo_huella = v_huella,
           archivo_conteos = v_conteos, archivo_documentos = i.aplicaciones || i.devoluciones
     where id = v_tc.id;

    v_consol := coalesce((
        select jsonb_agg(jsonb_build_object('id', m.id, 'cursor', m.cursor, 'estacion', e.nombre, 'material', mt.codigo,
                                            'cantidad', m.cantidad, 'fecha_hora', m.fecha_hora) order by m.cursor)
        from public.fert_movimientos m
        join public.estaciones_riego e on e.id = m.estacion_id
        join public.materiales mt on mt.id = m.material_id
        where m.turno_ciclo_id = v_tc.id and m.tipo = 'ARCHIVO_TURNO'), '[]'::jsonb);

    insert into public.fert_publicaciones (temporada, publicado_por, conteos, avisos)
    values (v_tc.temporada, (select auth.uid()),
            jsonb_build_object('accion', 'archivar_turno', 'agl_id', v_tc.agl_id, 'huella', v_huella) || v_conteos, '{}');

    return jsonb_build_object('archivado', true, 'ya_archivado', false, 'agl_id', v_tc.agl_id,
                              'archivado_at', now(), 'conteos', v_conteos, 'consolidado', v_consol);
end;
$$;


-- ---------------------------------------------------------------- 8 · reactivar: vuelve a subir lo mismo

create or replace function public.fn_fert_restaurar_turno(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tc      public.turnos_ciclo%rowtype;
    f         jsonb := p->'filas';
    v_ops     uuid[];
    v_arch    uuid[];
    v_quitados jsonb;
    v_antes   jsonb;
    v_despues jsonb;
    v_filas   jsonb;
    t         text;
begin
    perform public._fert_archivo_exigir();
    select * into v_tc from public.turnos_ciclo where agl_id = btrim(p->>'agl_id') for update;
    if not found then
        raise exception 'El turno % no está publicado en esta base de AgroNotificaciones.', coalesce(p->>'agl_id', '(sin id)');
    end if;
    if v_tc.archivado_at is null then   -- ya estaba activo (reintento): no se toca nada
        return jsonb_build_object('restaurado', false, 'ya_estaba_activo', true, 'agl_id', v_tc.agl_id,
                                  'conteos', public._fert_conteos_filas(public._fert_turno_filas(v_tc.id)),
                                  'consolidado_quitado', '[]'::jsonb);
    end if;
    if v_tc.archivo_huella is distinct from p->>'huella' then
        raise exception 'Esa copia no es la del último cierre del turno % en esta base. No se restauró nada.', v_tc.agl_id;
    end if;
    if jsonb_typeof(f) is distinct from 'object' then
        raise exception 'La copia del turno % no trae sus filas.', v_tc.agl_id;
    end if;
    foreach t in array array['fert_operaciones', 'fert_aplicaciones', 'fert_aplicaciones_detalle', 'fert_devoluciones',
                             'fert_devoluciones_detalle', 'fert_movimientos', 'fert_bitacora_riego', 'fert_plan'] loop
        if jsonb_typeof(f->t) is distinct from 'array' then
            raise exception 'La copia del turno % está incompleta (falta %).', v_tc.agl_id, t;
        end if;
    end loop;
    if exists (select 1 from jsonb_array_elements(f->'fert_aplicaciones') x where x->>'turno_ciclo_id' <> v_tc.id::text)
       or exists (select 1 from jsonb_array_elements(f->'fert_bitacora_riego') x where x->>'turno_ciclo_id' <> v_tc.id::text)
       or exists (select 1 from jsonb_array_elements(f->'fert_plan') x where x->>'turno_ciclo_id' <> v_tc.id::text) then
        raise exception 'La copia trae registros de otro turno. No se restauró nada.';
    end if;

    v_antes := public._fert_saldos_pares(f->'fert_movimientos');
    v_ops := array(select (x->>'id')::uuid from jsonb_array_elements(f->'fert_operaciones') x);

    perform set_config('fert.libro_permitir', 'on', true);

    -- Quitar el consolidado del turno (y su operación)
    with q as (
        delete from public.fert_movimientos
        where turno_ciclo_id = v_tc.id and tipo = 'ARCHIVO_TURNO'
        returning id, cursor, operacion_id)
    select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'cursor', q.cursor) order by q.cursor), '[]'::jsonb),
           coalesce(array_agg(distinct q.operacion_id), '{}')
      into v_quitados, v_arch
    from q;
    delete from public.fert_operaciones where id = any(v_arch) and tipo = 'archivo_turno';

    -- Si el teléfono reenvió algo de este turno mientras estaba archivado, quedó como RECHAZADO con el MISMO id:
    -- ese rechazo es un duplicado del original que vuelve ahora.
    delete from public.fert_operaciones where id = any(v_ops) and resultado = 'RECHAZADO';

    insert into public.fert_operaciones
    select * from jsonb_populate_recordset(null::public.fert_operaciones, f->'fert_operaciones') on conflict do nothing;
    insert into public.fert_aplicaciones
    select * from jsonb_populate_recordset(null::public.fert_aplicaciones, f->'fert_aplicaciones') on conflict do nothing;
    insert into public.fert_aplicaciones_detalle
    select * from jsonb_populate_recordset(null::public.fert_aplicaciones_detalle, f->'fert_aplicaciones_detalle') on conflict do nothing;
    insert into public.fert_devoluciones
    select * from jsonb_populate_recordset(null::public.fert_devoluciones, f->'fert_devoluciones') on conflict do nothing;
    insert into public.fert_devoluciones_detalle
    select * from jsonb_populate_recordset(null::public.fert_devoluciones_detalle, f->'fert_devoluciones_detalle') on conflict do nothing;
    insert into public.fert_movimientos overriding system value
    select * from jsonb_populate_recordset(null::public.fert_movimientos, f->'fert_movimientos') on conflict do nothing;
    insert into public.fert_bitacora_riego
    select * from jsonb_populate_recordset(null::public.fert_bitacora_riego, f->'fert_bitacora_riego') on conflict do nothing;
    insert into public.fert_plan overriding system value
    select * from jsonb_populate_recordset(null::public.fert_plan, f->'fert_plan') on conflict do nothing;

    v_despues := public._fert_saldos_pares(f->'fert_movimientos');
    if v_antes is distinct from v_despues then
        raise exception 'El saldo de la bodega habría cambiado al reactivar el turno %. No se restauró nada.', v_tc.agl_id;
    end if;

    perform set_config('fert.libro_permitir', 'off', true);

    -- Comprobación final: lo que quedó es EXACTAMENTE lo que se archivó
    v_filas := public._fert_turno_filas(v_tc.id);
    if public._fert_huella(v_filas) is distinct from v_tc.archivo_huella then
        raise exception 'Lo restaurado del turno % no quedó idéntico a lo archivado. No se restauró nada.', v_tc.agl_id;
    end if;

    update public.turnos_ciclo
       set activo = true, archivado_at = null, archivado_por = null, archivo_huella = null, archivo_conteos = null,
           archivo_documentos = '{}', restaurado_at = now(), publicado_at = now()
     where id = v_tc.id;

    insert into public.fert_publicaciones (temporada, publicado_por, conteos, avisos)
    values (v_tc.temporada, (select auth.uid()),
            jsonb_build_object('accion', 'restaurar_turno', 'agl_id', v_tc.agl_id) || public._fert_conteos_filas(v_filas), '{}');

    return jsonb_build_object('restaurado', true, 'ya_estaba_activo', false, 'agl_id', v_tc.agl_id,
                              'conteos', public._fert_conteos_filas(v_filas), 'consolidado_quitado', v_quitados);
end;
$$;

revoke execute on function public.fn_fert_exportar_turno(text) from public, anon;
revoke execute on function public.fn_fert_archivar_turno(text, text) from public, anon;
revoke execute on function public.fn_fert_restaurar_turno(jsonb) from public, anon;
grant execute on function public.fn_fert_exportar_turno(text) to authenticated;
grant execute on function public.fn_fert_archivar_turno(text, text) to authenticated;
grant execute on function public.fn_fert_restaurar_turno(jsonb) to authenticated;


-- ---------------------------------------------------------------- 9 · ajustes a funciones existentes (por texto, verificando)

create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');   -- igual si se corrió con CRLF
    v_n   integer := (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    if v_n <> 1 then
        raise exception '102: en % se esperaba 1 aparición de «%» y hay %', p_fn, p_viejo, v_n;
    end if;
    execute replace(v_def, p_viejo, p_nuevo);
end $$;

-- Teléfono: lo de un turno archivado se rechaza con mensaje claro (antes de tocar nada)
select pg_temp.parchar('public._fert_procesar(jsonb)',
    E'    insert into public.fert_operaciones\n        (id, tipo, estacion_id, perfil_id, en_nombre_de, dispositivo, creado_en, enviado_en, inmediato,',
    E'    perform public._fert_exigir_turno_vivo(v_tipo, v_datos);   -- 102: turno archivado → rechazo claro\n'
    || E'    insert into public.fert_operaciones\n        (id, tipo, estacion_id, perfil_id, en_nombre_de, dispositivo, creado_en, enviado_en, inmediato,',
    '_fert_exigir_turno_vivo');

-- AGL publica: un turno archivado no se reactiva ni se le cambia el plan por publicar (solo con «Reactivar»)
select pg_temp.parchar('public.fn_fert_publicar(jsonb)',
    'estado = excluded.estado, activo = true, publicado_at = now();',
    'estado = excluded.estado, activo = (turnos_ciclo.archivado_at is null), publicado_at = now();   -- 102',
    'activo = (turnos_ciclo.archivado_at is null)');
select pg_temp.parchar('public.fn_fert_publicar(jsonb)',
    E'        v_tc := (select id from public.turnos_ciclo where agl_id = g->>''agl_id'');\n',
    E'        v_tc := (select id from public.turnos_ciclo where agl_id = g->>''agl_id'');\n'
    || E'        if exists (select 1 from public.turnos_ciclo where id = v_tc and archivado_at is not null) then   -- 102\n'
    || E'            v_avisos := v_avisos || format(''Turno %s: ciclo terminado (archivado); su plan no se cambia. Reactívalo en AGL para volver a publicarlo.'', g->>''agl_id'');\n'
    || E'            continue;\n'
    || E'        end if;\n',
    'ciclo terminado (archivado); su plan no se cambia');

notify pgrst, 'reload schema';
