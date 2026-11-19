-- =====================================================================
-- 119 · FERTIRRIEGO · ELIMINAR POR COMPLETO UN REGISTRO
-- =====================================================================
-- Pedido del administrador (2026-11-19): los usuarios se están adaptando y cometen errores que no deben aparecer
-- en el informe. Quien tenga el permiso nuevo «Eliminar por completo» borra DE VERDAD un registro de una estación:
-- el documento, su detalle y sus movimientos (de producto y de envases) desaparecen de la bitácora, del inventario
-- (el saldo se ajusta restando lo borrado), del informe y de lo que baja a AGL. SOLO queda una copia privada en
-- public.fert_eliminaciones (quién, cuándo, motivo, tipo, estación y la copia completa del documento): la leen
-- únicamente quienes tienen el permiso (o el administrador). No entra al estado del teléfono, a la exportación a AGL
-- ni a la huella de «Terminar ciclo» (102).
--
--   1. Permiso nuevo: acción `eliminar_definitivo` («Eliminar por completo», nivel «Todo») en la pantalla Fertirriego.
--      Decisión del usuario (2026-11-19): lo tiene SOLO el administrador. La migración NO se lo da a ningún rol: quien
--      tiene acceso total (fn_es_admin) lo tiene siempre, como las demás acciones; si algún día se quiere dárselo a
--      otro rol, se hace a mano en Permisos › pantalla Fertirriego.
--   2. fn_fert_eliminar_documento(tipo, documento, motivo): aplicacion (con sus devoluciones y anulaciones),
--      recepcion (con envases), conteo, devolucion, relevo (con sus diferencias), traslado (entre dos estaciones:
--      hace falta el permiso en las dos) y bitacora (horas de riego; el «documento» es su operacion_id, que da el
--      listado). Motivo obligatorio (mínimo 15 letras). Turno ya terminado en AGL: se rechaza («reactiva el turno
--      en AGL primero»). Un registro eliminado no se puede eliminar otra vez.
--   3. El libro (fert_movimientos) se abre SOLO dentro de la función (fert.libro_permitir, como la 102) y se cierra
--      al terminar, también en error.
--   4. Saldos: a fert_saldos se le RESTA lo borrado (no se recalcula entero: si ya hubiera una diferencia vieja, no
--      se toca). Un traslado EN_TRANSITO devuelve también el «en tránsito» del destino. Si el saldo de un producto
--      queda en negativo, la respuesta lo avisa.
--   5. Una operación que el teléfono reenvíe con el id de algo eliminado se rechaza con un mensaje claro (no lo
--      vuelve a crear): _fert_procesar consulta los ids de operaciones eliminadas.
--   6. El estado del teléfono trae `permisos.eliminar_definitivo` por estación.
--   7. Listado para la pantalla de Administración › Eliminar registros y consulta de la auditoría.
--
-- Correr DESPUÉS de la 118. Idempotente. Todo UPDATE/DELETE lleva WHERE (Supabase lo rechaza sin él).
-- Si se vuelve a correr la 99 o la 100/101/116 (redefinen _fert_estado_campo_base o _fert_procesar), correr la 119 otra vez.
-- =====================================================================


-- ---------------------------------------------------------------- 1 · permiso

do $$
declare
begin
    insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
        ('eliminar_definitivo', 'Eliminar por completo',
         'Fertirriego: borra de verdad un registro de la estación (documento, detalle y movimientos). Solo queda una copia privada de auditoría. No se puede deshacer desde la app.',
         131, true)
    on conflict (codigo) do update
    set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden, escribe = excluded.escribe;

    update public.acciones set nivel = 4 where codigo = 'eliminar_definitivo';

    update public.pantallas set acciones = acciones || 'eliminar_definitivo'::text
     where codigo = 'fertirriego' and not ('eliminar_definitivo' = any(acciones));

    -- Sin concesiones automáticas: solo el administrador (fn_es_admin) la tiene. Los roles se la dan a mano en Permisos.
end $$;


-- ---------------------------------------------------------------- 2 · auditoría privada

create table if not exists public.fert_eliminaciones (
    id                  uuid primary key default gen_random_uuid(),
    tipo                text not null,
    documento_id        uuid not null,
    estacion_id         uuid,
    estacion            text,
    estacion2_id        uuid,                        -- el destino de un traslado
    estacion2           text,
    turno_ciclo_id      uuid,
    fecha_documento     timestamptz,                 -- cuándo ocurrió lo eliminado (hora del registro)
    registrado_por      uuid,                        -- quien lo había registrado
    registrado_por_nombre text,
    resumen             text,
    motivo              text not null,
    eliminado_por       uuid not null,
    eliminado_por_nombre text,
    eliminado_at        timestamptz not null default now(),
    conteos             jsonb not null default '{}'::jsonb,
    operaciones_ids     uuid[] not null default '{}',   -- para rechazar si el teléfono las reenvía
    snapshot            jsonb not null
);
comment on table public.fert_eliminaciones is
'119: auditoría PRIVADA de lo eliminado por completo en Fertirriego (copia del documento, detalle, movimientos, envases y operaciones). No entra a informes, estado del teléfono, exportación a AGL ni huella de Terminar ciclo.';

create index if not exists idx_fert_eliminaciones_fecha on public.fert_eliminaciones (eliminado_at desc);
create index if not exists idx_fert_eliminaciones_doc on public.fert_eliminaciones (documento_id);
create index if not exists idx_fert_eliminaciones_ops on public.fert_eliminaciones using gin (operaciones_ids);

alter table public.fert_eliminaciones enable row level security;
revoke all on public.fert_eliminaciones from public, anon, authenticated;
-- Sin políticas: solo se lee por fn_fert_eliminaciones_listar / fn_fert_eliminacion_copia (con el permiso)


-- ---------------------------------------------------------------- 3 · apoyo

create or replace function public._fert_eliminar_exigir()
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'eliminar_definitivo')) then
        raise exception 'Tu rol no tiene «Eliminar por completo» en Fertirriego. Se concede en Permisos.'
            using errcode = '42501';
    end if;
end;
$$;
revoke execute on function public._fert_eliminar_exigir() from public, anon, authenticated;


-- ---------------------------------------------------------------- 4 · eliminar

create or replace function public.fn_fert_eliminar_documento(p_tipo text, p_documento uuid, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_motivo   text := btrim(coalesce(p_motivo, ''));
    v_yo       uuid := (select auth.uid());
    v_est      uuid;
    v_est2     uuid;
    v_tc       uuid;
    v_fecha    date;
    v_cuando   timestamptz;
    v_quien    uuid;
    v_resumen  text;
    v_docs     uuid[] := '{}';
    v_docs_txt text[];
    v_extra    uuid[] := '{}';
    v_movs     uuid[];
    v_envs     bigint[];
    v_ops      uuid[];
    v_snap     jsonb;
    v_aud      uuid := gen_random_uuid();
    v_n        integer;
    v_cont     jsonb := '{}'::jsonb;
    v_borradas uuid[];
    v_neg      jsonb;
    v_tr       public.fert_traslados%rowtype;
    l          record;
begin
    perform public._fert_eliminar_exigir();
    if p_tipo is null or p_tipo not in ('aplicacion', 'recepcion', 'conteo', 'devolucion', 'relevo', 'traslado', 'bitacora') then
        raise exception 'Ese tipo de registro no se puede eliminar.';
    end if;
    if p_documento is null then
        raise exception 'Indica el registro a eliminar.';
    end if;
    if char_length(v_motivo) < 15 then
        raise exception 'Explica por qué se elimina (mínimo 15 letras).';
    end if;

    -- ---- localizar el registro (y bloquearlo)
    case p_tipo
        when 'aplicacion' then
            select a.estacion_id, a.turno_ciclo_id, a.fecha, a.fecha_hora, a.registrado_por,
                   format('Aplicación · turno %s · día %s%s', coalesce((select t.codigo from public.turnos_ciclo tc join public.turnos t on t.id = tc.turno_id where tc.id = a.turno_ciclo_id), '?'),
                          a.fecha, case when coalesce(a.historica, false) then ' · histórica' else '' end)
              into v_est, v_tc, v_fecha, v_cuando, v_quien, v_resumen
              from public.fert_aplicaciones a where a.id = p_documento for update;
            v_docs := array[p_documento] || array(select d.id from public.fert_devoluciones d where d.aplicacion_id = p_documento);
        when 'devolucion' then
            select d.estacion_id, a.turno_ciclo_id, a.fecha, d.fecha_hora, d.registrado_por,
                   format('Devolución a bodega · aplicación del día %s', a.fecha)
              into v_est, v_tc, v_fecha, v_cuando, v_quien, v_resumen
              from public.fert_devoluciones d join public.fert_aplicaciones a on a.id = d.aplicacion_id
             where d.id = p_documento for update of d, a;
            v_docs := array[p_documento];
        when 'recepcion' then
            select r.estacion_id, r.fecha_hora, r.registrado_por,
                   format('Recepción%s%s', coalesce(' · documento ' || nullif(r.documento, ''), ''),
                          case when not exists (select 1 from public.fert_recepciones_detalle x where x.recepcion_id = r.id) then ' · solo envases' else '' end)
              into v_est, v_cuando, v_quien, v_resumen
              from public.fert_recepciones r where r.id = p_documento for update;
            v_docs := array[p_documento];
        when 'conteo' then
            select c.estacion_id, c.fecha_hora, c.registrado_por, 'Conteo físico de la bodega'
              into v_est, v_cuando, v_quien, v_resumen
              from public.fert_conteos c where c.id = p_documento for update;
            v_docs := array[p_documento];
        when 'relevo' then
            select r.estacion_id, coalesce(r.recibido_at, r.entregado_at, r.created_at), r.registrado_por,
                   format('Relevo · %s → %s · %s', coalesce((select p.nombre from public.perfiles p where p.id = r.entrega_id), '?'),
                          coalesce((select p.nombre from public.perfiles p where p.id = r.recibe_id), '?'), lower(r.estado)),
                   array[r.operacion_entrega, r.operacion_recibe]
              into v_est, v_cuando, v_quien, v_resumen, v_extra
              from public.fert_relevos r where r.id = p_documento for update;
            v_docs := array[p_documento];
        when 'traslado' then
            select * into v_tr from public.fert_traslados where id = p_documento for update;
            if found then
                v_est := v_tr.origen_id;
                v_est2 := v_tr.destino_id;
                v_cuando := v_tr.creado_at;
                v_quien := v_tr.creado_por;
                v_resumen := format('Traslado · %s → %s · %s', (select nombre from public.estaciones_riego where id = v_tr.origen_id),
                                    (select nombre from public.estaciones_riego where id = v_tr.destino_id), lower(v_tr.estado));
                v_extra := array[v_tr.operacion_id];
            end if;
            v_docs := array[p_documento];
        when 'bitacora' then
            select b.estacion_id, b.turno_ciclo_id, b.fecha, b.updated_at, b.updated_by,
                   format('Horas de riego · turno %s · día %s', coalesce((select t.codigo from public.turnos_ciclo tc join public.turnos t on t.id = tc.turno_id where tc.id = b.turno_ciclo_id), '?'), b.fecha)
              into v_est, v_tc, v_fecha, v_cuando, v_quien, v_resumen
              from public.fert_bitacora_riego b where b.operacion_id = p_documento for update;
            v_docs := '{}';
    end case;

    if v_est is null then
        if exists (select 1 from public.fert_eliminaciones x where x.documento_id = p_documento) then
            raise exception 'Ese registro ya fue eliminado.';
        end if;
        if exists (select 1 from public.turnos_ciclo where archivado_at is not null and p_documento = any(archivo_documentos)) then
            raise exception 'Ese registro es de un turno que ya terminó su ciclo en AGL. Reactiva el turno en AGL primero y vuelve a intentar.';
        end if;
        raise exception 'El registro no existe (puede que ya lo hayan eliminado).';
    end if;

    -- ---- turno ya terminado en AGL
    if v_tc is not null and exists (select 1 from public.turnos_ciclo where id = v_tc and archivado_at is not null) then
        raise exception 'Ese registro es de un turno que ya terminó su ciclo en AGL. Reactiva el turno en AGL primero y vuelve a intentar.';
    end if;

    -- ---- permiso en la(s) estación(es)
    if not public.fn_fert_puede(v_est, 'eliminar_definitivo')
       or (v_est2 is not null and not public.fn_fert_puede(v_est2, 'eliminar_definitivo')) then
        raise exception 'No tienes «Eliminar por completo» en la estación de este registro%.',
            case when v_est2 is not null then ' (un traslado necesita el permiso en las dos estaciones)' else '' end
            using errcode = '42501';
    end if;

    v_docs_txt := array(select unnest(v_docs)::text);

    -- ---- qué se va con él
    v_movs := array(
        with recursive m as (
            select id from public.fert_movimientos where documento_id = any(v_docs)
            union
            select x.id from public.fert_movimientos x join m on x.anula_id = m.id
        ) select id from m);
    v_envs := array(
        with recursive m as (
            select id from public.fert_envases_movimientos where documento_id = any(v_docs)
            union
            select x.id from public.fert_envases_movimientos x join m on x.anula_id = m.id
        ) select id from m);
    v_ops := array(
        select distinct o.id from public.fert_operaciones o
        where o.tipo <> 'archivo_turno' and (
              o.id = any(v_docs) or o.id = any(v_extra)
           or o.id in (select m.operacion_id from public.fert_movimientos m where m.id = any(v_movs))
           or o.datos->>'documento_id' = any(v_docs_txt) or o.datos->>'aplicacion_id' = any(v_docs_txt)
           or o.datos->>'traslado_id' = any(v_docs_txt) or o.datos->>'relevo_id' = any(v_docs_txt)
           or (p_tipo = 'bitacora' and (o.id = p_documento
                  or (o.tipo = 'bitacora' and o.datos->>'turno_ciclo_id' = v_tc::text and o.datos->>'fecha' = v_fecha::text)))));

    -- ---- la copia de auditoría (ANTES de borrar)
    v_snap := jsonb_build_object(
        'tipo', p_tipo,
        'aplicaciones', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_aplicaciones x where x.id = any(v_docs)), '[]'::jsonb),
        'aplicaciones_detalle', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_aplicaciones_detalle x where x.aplicacion_id = any(v_docs)), '[]'::jsonb),
        'devoluciones', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_devoluciones x where x.id = any(v_docs)), '[]'::jsonb),
        'devoluciones_detalle', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_devoluciones_detalle x where x.devolucion_id = any(v_docs)), '[]'::jsonb),
        'recepciones', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_recepciones x where x.id = any(v_docs)), '[]'::jsonb),
        'recepciones_detalle', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_recepciones_detalle x where x.recepcion_id = any(v_docs)), '[]'::jsonb),
        'conteos', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_conteos x where x.id = any(v_docs)), '[]'::jsonb),
        'conteos_detalle', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_conteos_detalle x where x.conteo_id = any(v_docs)), '[]'::jsonb),
        'relevos', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_relevos x where x.id = any(v_docs)), '[]'::jsonb),
        'relevos_diferencias', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_relevos_diferencias x where x.relevo_id = any(v_docs)), '[]'::jsonb),
        'traslados', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_traslados x where x.id = any(v_docs)), '[]'::jsonb),
        'traslados_detalle', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_traslados_detalle x where x.traslado_id = any(v_docs)), '[]'::jsonb),
        'bitacora_riego', coalesce((select jsonb_agg(to_jsonb(x)) from public.fert_bitacora_riego x where p_tipo = 'bitacora' and x.operacion_id = p_documento), '[]'::jsonb),
        'movimientos', coalesce((select jsonb_agg(to_jsonb(x) order by x.cursor) from public.fert_movimientos x where x.id = any(v_movs)), '[]'::jsonb),
        'envases_movimientos', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.fert_envases_movimientos x where x.id = any(v_envs)), '[]'::jsonb),
        'operaciones', coalesce((select jsonb_agg(to_jsonb(x) order by x.recibido_en) from public.fert_operaciones x where x.id = any(v_ops)), '[]'::jsonb));

    insert into public.fert_eliminaciones
        (id, tipo, documento_id, estacion_id, estacion, estacion2_id, estacion2, turno_ciclo_id, fecha_documento,
         registrado_por, registrado_por_nombre, resumen, motivo, eliminado_por, eliminado_por_nombre, snapshot)
    values
        (v_aud, p_tipo, p_documento, v_est, (select nombre from public.estaciones_riego where id = v_est),
         v_est2, (select nombre from public.estaciones_riego where id = v_est2), v_tc, v_cuando,
         v_quien, (select nombre from public.perfiles where id = v_quien), v_resumen, v_motivo, v_yo,
         (select nombre from public.perfiles where id = v_yo), v_snap);

    -- ---- borrar (el libro se abre solo aquí y se cierra siempre)
    begin
        perform set_config('fert.libro_permitir', 'on', true);

        -- el saldo de bodega: se resta lo borrado
        update public.fert_saldos s
           set disponible = s.disponible - d.suma, updated_at = now()
          from (select m.estacion_id, m.material_id, sum(m.cantidad) as suma
                from public.fert_movimientos m where m.id = any(v_movs) group by 1, 2) d
         where s.estacion_id = d.estacion_id and s.material_id = d.material_id;

        -- un traslado que iba en camino: se quita lo que estaba «en tránsito» en el destino
        if p_tipo = 'traslado' and v_tr.estado = 'EN_TRANSITO' then
            for l in select * from public.fert_traslados_detalle where traslado_id = p_documento loop
                perform public._fert_en_transito(v_tr.destino_id, l.material_id, -l.cantidad_enviada);
            end loop;
        end if;

        delete from public.fert_envases_movimientos where id = any(v_envs);
        get diagnostics v_n = row_count;
        v_cont := v_cont || jsonb_build_object('envases_movimientos', v_n);
        delete from public.fert_movimientos where id = any(v_movs);
        get diagnostics v_n = row_count;
        v_cont := v_cont || jsonb_build_object('movimientos', v_n);

        -- la custodia no cambia de dueño; solo deja de apuntar al relevo borrado (y una entrega a medias vuelve a «activa»)
        update public.fert_custodia
           set estado = case when estado = 'EN_ENTREGA' then 'ACTIVA' else estado end, relevo_id = null, updated_at = now()
         where relevo_id = any(v_docs);

        delete from public.fert_relevos_diferencias where relevo_id = any(v_docs);
        delete from public.fert_relevos where id = any(v_docs);
        delete from public.fert_traslados_detalle where traslado_id = any(v_docs);
        delete from public.fert_traslados where id = any(v_docs);
        delete from public.fert_devoluciones_detalle where devolucion_id = any(v_docs);
        delete from public.fert_devoluciones where id = any(v_docs);
        delete from public.fert_aplicaciones_detalle where aplicacion_id = any(v_docs);
        delete from public.fert_aplicaciones where id = any(v_docs);
        delete from public.fert_recepciones_detalle where recepcion_id = any(v_docs);
        delete from public.fert_recepciones where id = any(v_docs);
        delete from public.fert_conteos_detalle where conteo_id = any(v_docs);
        delete from public.fert_conteos where id = any(v_docs);
        if p_tipo = 'bitacora' then
            delete from public.fert_bitacora_riego where operacion_id = p_documento;
        end if;
        v_cont := v_cont || jsonb_build_object('registros', coalesce(cardinality(v_docs), 0) + case when p_tipo = 'bitacora' then 1 else 0 end);

        with d as (
            delete from public.fert_operaciones o
            where o.id = any(v_ops)
              and not exists (select 1 from public.fert_movimientos m where m.operacion_id = o.id)
              and not exists (select 1 from public.fert_bitacora_riego b where b.operacion_id = o.id)
              and not exists (select 1 from public.fert_aplicaciones a where a.id = o.id)
              and not exists (select 1 from public.fert_recepciones r where r.id = o.id)
              and not exists (select 1 from public.fert_conteos c where c.id = o.id)
              and not exists (select 1 from public.fert_devoluciones x where x.id = o.id)
            returning o.id)
        select coalesce(array_agg(id), '{}') into v_borradas from d;
        v_cont := v_cont || jsonb_build_object('operaciones', cardinality(v_borradas));

        perform set_config('fert.libro_permitir', 'off', true);
    exception when others then
        perform set_config('fert.libro_permitir', 'off', true);
        raise;
    end;

    update public.fert_eliminaciones set conteos = v_cont, operaciones_ids = v_borradas where id = v_aud;

    -- ¿algún producto quedó en negativo por esto? (se avisa; no se rechaza)
    v_neg := coalesce((
        select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'material', coalesce(m.descripcion, m.codigo), 'saldo', s.disponible))
        from public.fert_saldos s
        join public.estaciones_riego e on e.id = s.estacion_id
        join public.materiales m on m.id = s.material_id
        where s.disponible < 0
          and exists (select 1 from jsonb_array_elements(v_snap->'movimientos') x
                      where (x->>'estacion_id')::uuid = s.estacion_id and (x->>'material_id')::uuid = s.material_id)), '[]'::jsonb);

    return jsonb_build_object('ok', true, 'tipo', p_tipo, 'auditoria_id', v_aud, 'eliminados', v_cont, 'saldos_negativos', v_neg);
end;
$$;

revoke execute on function public.fn_fert_eliminar_documento(text, uuid, text) from public, anon;
grant execute on function public.fn_fert_eliminar_documento(text, uuid, text) to authenticated;


-- ---------------------------------------------------------------- 5 · listado para la pantalla de Administración

/** Registros eliminables de las estaciones donde quien llama tiene el permiso. */
create or replace function public.fn_fert_eliminar_listar(
    p_estacion uuid default null, p_tipo text default null, p_desde date default null, p_hasta date default null,
    p_limite integer default 300
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_est uuid[];
    v_res jsonb;
begin
    perform public._fert_eliminar_exigir();
    v_est := array(select e.id from public.estaciones_riego e
                   where (p_estacion is null or e.id = p_estacion) and public.fn_fert_puede(e.id, 'eliminar_definitivo'));

    select coalesce(jsonb_agg(to_jsonb(x) order by x.fecha desc), '[]'::jsonb) into v_res from (
        select * from (
            select 'aplicacion'::text as tipo, a.id as documento_id, a.estacion_id, e.nombre as estacion, a.fecha_hora as fecha,
                   a.registrado_por as quien_id, p.nombre as quien,
                   format('Turno %s · día %s · %s producto(s)', coalesce(t.codigo, '?'), a.fecha,
                          (select count(*) from public.fert_aplicaciones_detalle d where d.aplicacion_id = a.id)) as resumen,
                   (a.anulado_at is not null) as anulado, coalesce(a.historica, false) as historica
            from public.fert_aplicaciones a join public.estaciones_riego e on e.id = a.estacion_id
            left join public.perfiles p on p.id = a.registrado_por
            left join public.turnos_ciclo tc on tc.id = a.turno_ciclo_id left join public.turnos t on t.id = tc.turno_id
            where a.estacion_id = any(v_est)
            union all
            select 'recepcion', r.id, r.estacion_id, e.nombre, r.fecha_hora, r.registrado_por, p.nombre,
                   format('%s producto(s)%s%s', (select count(*) from public.fert_recepciones_detalle d where d.recepcion_id = r.id),
                          coalesce(' · documento ' || nullif(r.documento, ''), ''),
                          case when not exists (select 1 from public.fert_recepciones_detalle d where d.recepcion_id = r.id) then ' · solo envases' else '' end),
                   (r.anulado_at is not null), false
            from public.fert_recepciones r join public.estaciones_riego e on e.id = r.estacion_id
            left join public.perfiles p on p.id = r.registrado_por
            where r.estacion_id = any(v_est)
            union all
            select 'conteo', c.id, c.estacion_id, e.nombre, c.fecha_hora, c.registrado_por, p.nombre,
                   format('%s producto(s) contados', (select count(*) from public.fert_conteos_detalle d where d.conteo_id = c.id)),
                   (c.anulado_at is not null), false
            from public.fert_conteos c join public.estaciones_riego e on e.id = c.estacion_id
            left join public.perfiles p on p.id = c.registrado_por
            where c.estacion_id = any(v_est)
            union all
            select 'devolucion', d.id, d.estacion_id, e.nombre, d.fecha_hora, d.registrado_por, p.nombre,
                   format('Sobrante de la aplicación del día %s', a.fecha), (d.anulado_at is not null), false
            from public.fert_devoluciones d join public.estaciones_riego e on e.id = d.estacion_id
            join public.fert_aplicaciones a on a.id = d.aplicacion_id
            left join public.perfiles p on p.id = d.registrado_por
            where d.estacion_id = any(v_est)
            union all
            select 'relevo', r.id, r.estacion_id, e.nombre, coalesce(r.recibido_at, r.entregado_at, r.created_at), r.registrado_por, p.nombre,
                   format('%s → %s · %s', coalesce((select x.nombre from public.perfiles x where x.id = r.entrega_id), '?'),
                          coalesce((select x.nombre from public.perfiles x where x.id = r.recibe_id), '?'), lower(r.estado)),
                   false, false
            from public.fert_relevos r join public.estaciones_riego e on e.id = r.estacion_id
            left join public.perfiles p on p.id = r.registrado_por
            where r.estacion_id = any(v_est)
            union all
            select 'traslado', t.id, t.origen_id, e.nombre, t.creado_at, t.creado_por, p.nombre,
                   format('%s → %s · %s', e.nombre, e2.nombre, lower(t.estado)), (t.estado = 'ANULADO'), false
            from public.fert_traslados t join public.estaciones_riego e on e.id = t.origen_id
            join public.estaciones_riego e2 on e2.id = t.destino_id
            left join public.perfiles p on p.id = t.creado_por
            where t.origen_id = any(v_est) and t.destino_id = any(v_est)
            union all
            select 'bitacora', b.operacion_id, b.estacion_id, e.nombre, b.updated_at, b.updated_by, p.nombre,
                   format('Turno %s · día %s · fert. %s h · riego %s h', coalesce(t.codigo, '?'), b.fecha,
                          coalesce(b.horas_fertilizacion::text, '—'), coalesce(b.horas_riego::text, '—')), false, false
            from public.fert_bitacora_riego b join public.estaciones_riego e on e.id = b.estacion_id
            left join public.perfiles p on p.id = b.updated_by
            left join public.turnos_ciclo tc on tc.id = b.turno_ciclo_id left join public.turnos t on t.id = tc.turno_id
            where b.estacion_id = any(v_est)
        ) u
        where (p_tipo is null or u.tipo = p_tipo)
          and (p_desde is null or (u.fecha at time zone 'America/Tegucigalpa')::date >= p_desde)
          and (p_hasta is null or (u.fecha at time zone 'America/Tegucigalpa')::date <= p_hasta)
        order by u.fecha desc
        limit least(greatest(coalesce(p_limite, 300), 1), 1000)
    ) x;
    return v_res;
end;
$$;

revoke execute on function public.fn_fert_eliminar_listar(uuid, text, date, date, integer) from public, anon;
grant execute on function public.fn_fert_eliminar_listar(uuid, text, date, date, integer) to authenticated;


-- ---------------------------------------------------------------- 6 · consulta de la auditoría (solo lectura)

create or replace function public.fn_fert_eliminaciones_listar(p_limite integer default 200)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._fert_eliminar_exigir();
    return coalesce((
        select jsonb_agg(to_jsonb(x) order by x.eliminado_at desc) from (
            select e.id, e.tipo, e.documento_id, e.estacion, e.estacion2, e.fecha_documento, e.registrado_por_nombre,
                   e.resumen, e.motivo, e.eliminado_por_nombre, e.eliminado_at, e.conteos
            from public.fert_eliminaciones e
            where public.fn_es_admin() or public.fn_fert_puede(e.estacion_id, 'eliminar_definitivo')
            order by e.eliminado_at desc
            limit least(greatest(coalesce(p_limite, 200), 1), 1000)) x), '[]'::jsonb);
end;
$$;
revoke execute on function public.fn_fert_eliminaciones_listar(integer) from public, anon;
grant execute on function public.fn_fert_eliminaciones_listar(integer) to authenticated;

/** La copia completa de una eliminación (para consultar; NO restaura nada). */
create or replace function public.fn_fert_eliminacion_copia(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._fert_eliminar_exigir();
    return (select e.snapshot from public.fert_eliminaciones e
             where e.id = p_id and (public.fn_es_admin() or public.fn_fert_puede(e.estacion_id, 'eliminar_definitivo')));
end;
$$;
revoke execute on function public.fn_fert_eliminacion_copia(uuid) from public, anon;
grant execute on function public.fn_fert_eliminacion_copia(uuid) to authenticated;


-- ---------------------------------------------------------------- 7 · ajustes a funciones existentes (por texto, con marca)

create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer := (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    if v_n <> 1 then
        raise exception '119: en % se esperaba 1 aparición de «%» y hay %', p_fn, p_viejo, v_n;
    end if;
    begin
        execute replace(v_def, p_viejo, p_nuevo);
    exception when others then
        raise exception '119: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- Teléfono: el permiso nuevo por estación
select pg_temp.parchar('public._fert_estado_campo_base(date)',
    '''gestionar_choferes'', public.fn_fert_puede(e.id, ''gestionar_choferes'')),',
    '''gestionar_choferes'', public.fn_fert_puede(e.id, ''gestionar_choferes''),' || E'\n'
    || '                    ''eliminar_definitivo'', public.fn_fert_puede(e.id, ''eliminar_definitivo'')),',
    '''eliminar_definitivo''');

-- Lo que el teléfono reenvíe con el id de algo ya eliminado no lo vuelve a crear
select pg_temp.parchar('public._fert_procesar(jsonb)',
    E'        raise exception ''El registro no trae identificador.'';\n    end if;\n',
    E'        raise exception ''El registro no trae identificador.'';\n    end if;\n'
    || E'    -- 119: algo que un administrador eliminó por completo no se vuelve a guardar\n'
    || E'    if exists (select 1 from public.fert_eliminaciones x where v_id = any(x.operaciones_ids)) then\n'
    || E'        raise exception ''Este registro fue eliminado por completo por un administrador y no se vuelve a guardar. Si hace falta, regístralo de nuevo.'';\n'
    || E'    end if;\n',
    '119: algo que un administrador eliminó');

notify pgrst, 'reload schema';
