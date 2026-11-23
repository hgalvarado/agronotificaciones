-- =====================================================================
-- 135 · MOTORES · la bajada a AGL incluye el libro de tanques (devoluciones)
-- =====================================================================
-- fn_mot_exportar (130) no bajaba mot_movimientos, y el cuadre de combustible de AGL no podía explicar las devoluciones de
-- tanque. Ahora baja los asientos DEVOLUCION_TANQUE y las ANULACION que los anulan:
--   cursor 'v|<id>' (prefijo propio: 'm|' ya es mantenimiento), tabla 'movimiento' (singular), id = uuid determinístico
--   md5('mot_movimiento|'||id) (la fila trae además movimiento_id = id bigint original y anula_id sigue siendo bigint).
--   La marca «bajado» y la huella viven en mot_mov_bajada, porque el libro es inalterable (trigger). fn_mot_exportar no
--   cambia: lee _mot_filas, que aquí se redefine (mismas columnas). Contrato intacto: huella = sha256 del texto de la fila
--   tal cual (no reserializar); sha256_lote = sha256 de las huellas unidas con '|' por cursor binario.
--   fn_mot_confirmar_bajada marca los movimientos; fn_mot_purgar_bajadas los IGNORA a propósito (el libro y las
--   proyecciones no se purgan, igual que en la 130).
-- Correr DESPUÉS de la 130. Idempotente. Si se vuelve a correr la 130 (redefine _mot_filas, fn_mot_confirmar_bajada y
-- fn_mot_purgar_bajadas), CORRER LA 135 OTRA VEZ. Todo UPDATE/DELETE lleva WHERE.
-- =====================================================================

create table if not exists public.mot_mov_bajada (
    movimiento_id   bigint primary key references public.mot_movimientos(id) on delete cascade,
    uid             uuid not null unique,
    bajado_a_agl_en timestamptz,
    huella          text
);
alter table public.mot_mov_bajada enable row level security;   -- sin políticas: solo las funciones

create or replace function public._mot_filas(p_ids uuid[] default null)
returns table (cursor text, tabla text, id uuid, estacion_id uuid, equipo_id uuid, tanque_id uuid, fecha date,
               fila jsonb, texto text, huella text, huella_guardada text, bajado_a_agl_en timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
    with u as (
        select 'r|' || r.id::text as cursor, 'registro'::text as tabla, r.id, r.estacion_id, r.equipo_id, r.tanque_id, r.fecha,
               ((to_jsonb(r) - 'bajado_a_agl_en') - 'huella') || jsonb_build_object('tabla', 'registro') as fila,
               r.huella as hg, r.bajado_a_agl_en as b
          from public.mot_registros r where p_ids is null or r.id = any(p_ids)
        union all
        select 'c|' || r.id::text, 'recepcion', r.id, r.estacion_id, null::uuid, r.tanque_id, public._mot_dia(r.fecha_hora),
               ((to_jsonb(r) - 'bajado_a_agl_en') - 'huella') || jsonb_build_object('tabla', 'recepcion'), r.huella, r.bajado_a_agl_en
          from public.mot_recepciones r where p_ids is null or r.id = any(p_ids)
        union all
        select 'm|' || r.id::text, 'mantenimiento', r.id, r.estacion_id, r.equipo_id, null::uuid, public._mot_dia(r.fecha_hora),
               ((to_jsonb(r) - 'bajado_a_agl_en') - 'huella') || jsonb_build_object('tabla', 'mantenimiento'), r.huella, r.bajado_a_agl_en
          from public.mot_mantenimientos r where p_ids is null or r.id = any(p_ids)
        union all
        select 'a|' || r.id::text, 'asignacion', r.id, coalesce(r.estacion_destino, r.estacion_origen), r.equipo_id, r.tanque_id, public._mot_dia(r.fecha_hora),
               ((to_jsonb(r) - 'bajado_a_agl_en') - 'huella') || jsonb_build_object('tabla', 'asignacion'), r.huella, r.bajado_a_agl_en
          from public.mot_asignaciones r where p_ids is null or r.id = any(p_ids)
        union all
        select 'v|' || x.uid::text, 'movimiento', x.uid, tq.estacion_id, tq.motor_equipo_id, m.tanque_id, public._mot_dia(m.fecha_hora),
               (to_jsonb(m) - 'id') || jsonb_build_object('id', x.uid, 'movimiento_id', m.id, 'tabla', 'movimiento'),
               b.huella, b.bajado_a_agl_en
          from public.mot_movimientos m
          cross join lateral (select md5('mot_movimiento|' || m.id::text)::uuid as uid) x
          join public.mot_tanques tq on tq.id = m.tanque_id
          left join public.mot_mov_bajada b on b.movimiento_id = m.id
         where (p_ids is null or x.uid = any(p_ids))
           and (m.tipo = 'DEVOLUCION_TANQUE'
                or (m.tipo = 'ANULACION' and exists (select 1 from public.mot_movimientos o
                                                      where o.id = m.anula_id and o.tipo = 'DEVOLUCION_TANQUE')))
    )
    select u.cursor, u.tabla, u.id, u.estacion_id, u.equipo_id, u.tanque_id, u.fecha, u.fila, u.fila::text,
           public._mot_huella(u.fila), u.hg, u.b
      from u
$$;
revoke execute on function public._mot_filas(uuid[]) from public, anon, authenticated;

create or replace function public.fn_mot_confirmar_bajada(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_lote jsonb := p -> 'lote';
    v_ids  uuid[];
    v_ok   jsonb;
    v_mal  jsonb;
begin
    perform public._mot_exigir_agl('publicar');
    if v_lote is null or jsonb_typeof(v_lote) <> 'array' then
        raise exception 'Se esperaba {lote: [{cursor, id, huella}], cuantos, sha256_lote}.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_lote) x
                where nullif(x ->> 'id', '') is null or nullif(x ->> 'huella', '') is null or nullif(x ->> 'cursor', '') is null) then
        raise exception 'El lote trae filas sin cursor, id o huella.' using errcode = '22023';
    end if;
    if coalesce(nullif(p ->> 'cuantos', '')::integer, -1) <> jsonb_array_length(v_lote) then
        raise exception 'El conteo del lote no coincide con la lista (cuantos = %, filas = %).',
            coalesce(p ->> 'cuantos', 'null'), jsonb_array_length(v_lote) using errcode = '22023';
    end if;
    if coalesce(p ->> 'sha256_lote', '') <> encode(sha256(convert_to(coalesce((
            select string_agg(x ->> 'huella', '|' order by (x ->> 'cursor') collate "C")
              from jsonb_array_elements(v_lote) x), ''), 'UTF8')), 'hex') then
        raise exception 'La huella del lote no coincide: no se confirma nada. Vuelve a bajar y a verificar.' using errcode = '22023';
    end if;
    v_ids := array(select (x ->> 'id')::uuid from jsonb_array_elements(v_lote) x);

    update public.mot_registros t set bajado_a_agl_en = now(), huella = c.h
      from (select f.id, f.huella as h from public._mot_filas(v_ids) f
             join jsonb_array_elements(v_lote) x on (x ->> 'id')::uuid = f.id and x ->> 'huella' = f.huella
            where f.tabla = 'registro') c
     where t.id = c.id;
    update public.mot_recepciones t set bajado_a_agl_en = now(), huella = c.h
      from (select f.id, f.huella as h from public._mot_filas(v_ids) f
             join jsonb_array_elements(v_lote) x on (x ->> 'id')::uuid = f.id and x ->> 'huella' = f.huella
            where f.tabla = 'recepcion') c
     where t.id = c.id;
    update public.mot_mantenimientos t set bajado_a_agl_en = now(), huella = c.h
      from (select f.id, f.huella as h from public._mot_filas(v_ids) f
             join jsonb_array_elements(v_lote) x on (x ->> 'id')::uuid = f.id and x ->> 'huella' = f.huella
            where f.tabla = 'mantenimiento') c
     where t.id = c.id;
    update public.mot_asignaciones t set bajado_a_agl_en = now(), huella = c.h
      from (select f.id, f.huella as h from public._mot_filas(v_ids) f
             join jsonb_array_elements(v_lote) x on (x ->> 'id')::uuid = f.id and x ->> 'huella' = f.huella
            where f.tabla = 'asignacion') c
     where t.id = c.id;

    -- libro de tanques: la marca vive en mot_mov_bajada (el libro es inalterable)
    insert into public.mot_mov_bajada (movimiento_id, uid, bajado_a_agl_en, huella)
    select m.id, f.id, now(), f.huella
      from public._mot_filas(v_ids) f
      join public.mot_movimientos m on md5('mot_movimiento|' || m.id::text)::uuid = f.id
      join jsonb_array_elements(v_lote) x on (x ->> 'id')::uuid = f.id and x ->> 'huella' = f.huella
     where f.tabla = 'movimiento'
    on conflict (movimiento_id) do update set bajado_a_agl_en = excluded.bajado_a_agl_en, huella = excluded.huella;

    -- (sentencias aparte: ven el efecto de las anteriores)
    select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id')), '[]'::jsonb) into v_ok
      from jsonb_array_elements(v_lote) x
     where exists (select 1 from public._mot_filas(v_ids) f
                    where f.id = (x ->> 'id')::uuid and f.bajado_a_agl_en is not null
                      and f.huella_guardada = x ->> 'huella' and f.huella = f.huella_guardada);
    select coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id')), '[]'::jsonb) into v_mal
      from jsonb_array_elements(v_lote) x
     where not exists (select 1 from public._mot_filas(v_ids) f
                        where f.id = (x ->> 'id')::uuid and f.bajado_a_agl_en is not null
                          and f.huella_guardada = x ->> 'huella' and f.huella = f.huella_guardada);
    return jsonb_build_object('confirmadas', v_ok, 'rechazadas', v_mal);
end
$$;
revoke execute on function public.fn_mot_confirmar_bajada(jsonb) from public, anon;
grant  execute on function public.fn_mot_confirmar_bajada(jsonb) to authenticated;

create or replace function public.fn_mot_purgar_bajadas(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p   jsonb := coalesce(p, '{}'::jsonb);
    v_lim integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 500), 1), 5000);
    v_ret integer;
    v_r   integer; v_c integer; v_m integer; v_a integer;
    v_mas boolean;
begin
    perform public._mot_exigir_agl('publicar');
    select retencion_dias into v_ret from public.mot_bajada_config where id;
    v_ret := greatest(coalesce(v_ret, 30), coalesce(nullif(v_p ->> 'retencion_dias', '')::integer, 0));

    create temp table if not exists _mot_purga (id uuid, tabla text) on commit drop;
    delete from _mot_purga where true;
    insert into _mot_purga (id, tabla)
    select f.id, f.tabla
      from public._mot_filas() f
     where f.tabla <> 'movimiento'   -- el libro de tanques no se purga
       and f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
       and f.bajado_a_agl_en < now() - make_interval(days => v_ret)
       and (case f.tabla
              when 'registro' then
                  exists (select 1 from public.mot_registros r where r.id = f.id and r.anulado_at is not null)
                  or exists (select 1 from public.mot_registros r2 where r2.equipo_id = f.equipo_id and r2.anulado_at is null and r2.fecha > f.fecha)
              when 'asignacion' then
                  exists (select 1 from public.mot_asignaciones a where a.id = f.id and a.anulado_at is not null)
                  or exists (select 1 from public.mot_asignaciones a2, public.mot_asignaciones a1
                              where a1.id = f.id and a2.equipo_id = a1.equipo_id and a2.anulado_at is null and a2.id <> a1.id
                                and (a2.fecha_hora, a2.creado_en) > (a1.fecha_hora, a1.creado_en))
              else true
            end)
     order by f.cursor collate "C"
     limit v_lim + 1;
    select count(*) > v_lim into v_mas from _mot_purga;
    delete from _mot_purga where id in (select x.id from _mot_purga x order by x.id offset v_lim) and v_mas;

    delete from public.mot_registros t where t.id in (select id from _mot_purga where tabla = 'registro');
    get diagnostics v_r = row_count;
    delete from public.mot_recepciones t where t.id in (select id from _mot_purga where tabla = 'recepcion');
    get diagnostics v_c = row_count;
    delete from public.mot_mantenimientos t where t.id in (select id from _mot_purga where tabla = 'mantenimiento');
    get diagnostics v_m = row_count;
    delete from public.mot_asignaciones t where t.id in (select id from _mot_purga where tabla = 'asignacion');
    get diagnostics v_a = row_count;

    return jsonb_build_object('registros', v_r, 'recepciones', v_c, 'mantenimientos', v_m, 'asignaciones', v_a,
                              'hay_mas', coalesce(v_mas, false), 'retencion_dias', v_ret);
end
$$;
revoke execute on function public.fn_mot_purgar_bajadas(jsonb) from public, anon;
grant  execute on function public.fn_mot_purgar_bajadas(jsonb) to authenticated;
