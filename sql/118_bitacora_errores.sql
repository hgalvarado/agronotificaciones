-- =====================================================================
-- 118 · BITÁCORA DE ERRORES POR USUARIO (Administración › Bitácora de errores)
-- =====================================================================
-- Pedido del usuario (2026-11-18): ver, como administrador, TODO lo que le sale mal a cada usuario en campo
-- (no se sincronizó, se registró pero no se guardó bien, error de pantalla...) con un informe detallado.
-- Contrato y diagnóstico: docs/bitacora-errores.md.
--   1. public.registro_errores: errores del teléfono/navegador, deduplicados por (usuario, huella) con contador de
--      repeticiones. La huella se calcula AQUÍ (no se confía en el cliente). Retención 90 días.
--   2. public.registro_salud: último «latido» de cada usuario (versión, pendientes locales, última sincronización
--      buena, reloj del teléfono...). Con él se detecta «no sincronizó» aun sin ningún error.
--   3. Permiso nuevo: pantalla «errores» con acciones «ver» y «atender». Nadie lo tiene salvo quien tenga acceso
--      total (fn_es_admin) o se lo den en Permisos: los usuarios existentes NO cambian (no se toca public.permisos).
--   4. Escritura SOLO por funciones: fn_errores_registrar (cualquier usuario con sesión, solo sobre sí mismo, con
--      límites y saneamiento), y las de lectura/atención que exigen el permiso.
--   5. Lo que el SERVIDOR rechazó ya vive en fert_operaciones: fn_errores_operaciones_fallidas lo expone sin duplicar.
--
-- Idempotente. Todo UPDATE/DELETE lleva WHERE (Supabase rechaza sin WHERE). Orden recomendado: después de la 117.
-- =====================================================================


-- ---------------------------------------------------------------- 1 · tablas

create table if not exists public.registro_errores (
    id           uuid primary key default gen_random_uuid(),
    usuario_id   uuid not null references public.perfiles(id) on delete cascade,
    creado_en    timestamptz not null default now(),     -- primera vez (hora del servidor al recibirlo)
    ultima_vez   timestamptz not null default now(),
    repeticiones integer not null default 1 check (repeticiones >= 1),
    origen       text not null check (origen in ('navegador', 'sincronizacion', 'guardado', 'pantalla', 'servidor', 'otro')),
    modulo       text,
    ruta         text,
    severidad    text not null default 'error' check (severidad in ('info', 'aviso', 'error', 'critico')),
    codigo       text,
    mensaje      text not null,
    detalle      jsonb not null default '{}'::jsonb,
    huella       text not null,
    estado       text not null default 'nuevo' check (estado in ('nuevo', 'visto', 'atendido')),
    nota_admin   text,
    atendido_por uuid references public.perfiles(id),
    atendido_at  timestamptz,
    hora_cliente timestamptz                              -- hora del teléfono cuando ocurrió (para ver el desfase)
);
comment on table public.registro_errores is
'118: bitácora de errores del teléfono/navegador por usuario. Deduplicada por (usuario_id, huella). Retención 90 días.';
create unique index if not exists uq_registro_errores_huella on public.registro_errores (usuario_id, huella);
create index if not exists idx_registro_errores_usuario on public.registro_errores (usuario_id, ultima_vez desc);
create index if not exists idx_registro_errores_ultima on public.registro_errores (ultima_vez desc);
create index if not exists idx_registro_errores_graves on public.registro_errores (severidad, estado) where estado = 'nuevo';

create table if not exists public.registro_salud (
    usuario_id          uuid primary key references public.perfiles(id) on delete cascade,
    actualizado_en      timestamptz not null default now(),   -- último latido recibido (hora del servidor)
    version_app         text,
    pendientes          integer not null default 0,
    pendiente_mas_viejo_h numeric,
    ultima_sync_ok      timestamptz,
    en_linea            boolean,
    desfase_reloj_s     integer,                              -- hora del teléfono − hora del servidor
    datos               jsonb not null default '{}'::jsonb
);
comment on table public.registro_salud is '118: último latido de salud de cada usuario (una fila por usuario).';

alter table public.registro_errores enable row level security;
alter table public.registro_salud enable row level security;

drop policy if exists errores_leer on public.registro_errores;
create policy errores_leer on public.registro_errores for select to authenticated
    using (public.fn_es_admin() or public.fn_tiene_permiso('errores', 'ver'));
drop policy if exists salud_leer on public.registro_salud;
create policy salud_leer on public.registro_salud for select to authenticated
    using (public.fn_es_admin() or public.fn_tiene_permiso('errores', 'ver'));

revoke all on public.registro_errores from anon, authenticated;
revoke all on public.registro_salud from anon, authenticated;
grant select on public.registro_errores to authenticated;
grant select on public.registro_salud to authenticated;


-- ---------------------------------------------------------------- 2 · permiso y menú (sin tocar public.permisos)

insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('atender', 'Atender', 'Marcar como visto o atendido (con nota) lo que aparece en la bitácora de errores.', 130, true)
on conflict (codigo) do nothing;

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones, modulo) values
    ('errores', 'Administración · Bitácora de errores',
     'Todo lo que les sale mal a los usuarios (no sincronizó, no se guardó, error de pantalla) con el informe de causa y solución. Ver = leer la bitácora; Atender = marcarla como atendida.',
     '/admin/errores', 140, array['ver', 'atender', 'exportar'], 'Administración')
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, ruta = excluded.ruta,
    orden = excluded.orden, acciones = excluded.acciones, modulo = coalesce(public.pantallas.modulo, excluded.modulo);

insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('exportar', 'Exportar', 'Descargar los datos a Excel.', 20, false)
on conflict (codigo) do nothing;


-- ---------------------------------------------------------------- 3 · apoyo

create or replace function public._err_puede_ver()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select (select auth.uid()) is not null and (public.fn_es_admin() or public.fn_tiene_permiso('errores', 'ver'))
$$;
revoke execute on function public._err_puede_ver() from public, anon, authenticated;

create or replace function public._err_exigir(p_accion text)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('errores', p_accion)) then
        raise exception 'Tu rol no tiene «%» en la Bitácora de errores. Se concede en Permisos.', p_accion using errcode = '42501';
    end if;
end;
$$;
revoke execute on function public._err_exigir(text) from public, anon, authenticated;

/** Quita secretos de un jsonb (claves tipo contraseña/token/cookie) y de los textos (JWT, Bearer); acota profundidad y tamaño. */
create or replace function public._err_sanear_texto(p text, p_max integer default 1000)
returns text
language sql immutable as $$
    select left(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p, ''), 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*', '[token]', 'g'),
            '(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+', '\1 [oculto]', 'gi'),
          '((password|contrase[nñ]a|passwd|secret|secreto|apikey|api_key|access_token|refresh_token|authorization|cookie)\s*[=:]\s*)[^\s,;&"'']+', '\1[oculto]', 'gi'),
        p_max)
$$;

create or replace function public._err_sanear(p jsonb, p_nivel integer default 0)
returns jsonb
language plpgsql immutable as $$
declare
    v_out jsonb;
    k text;
    v jsonb;
    n integer := 0;
begin
    if p is null then return null; end if;
    if p_nivel > 4 then return to_jsonb('[…]'::text); end if;
    case jsonb_typeof(p)
        when 'object' then
            v_out := '{}'::jsonb;
            for k, v in select * from jsonb_each(p) loop
                n := n + 1;
                exit when n > 40;
                if k ~* '(pass|contrase|secret|secreto|token|cookie|authorization|apikey|api_key|llave|jwt|session|sesion)' then
                    v_out := v_out || jsonb_build_object(left(k, 60), '[oculto]');
                else
                    v_out := v_out || jsonb_build_object(left(k, 60), public._err_sanear(v, p_nivel + 1));
                end if;
            end loop;
            return v_out;
        when 'array' then
            return coalesce((select jsonb_agg(public._err_sanear(e, p_nivel + 1))
                               from (select e from jsonb_array_elements(p) e limit 30) s), '[]'::jsonb);
        when 'string' then
            return to_jsonb(public._err_sanear_texto(p #>> '{}', 1500));
        else
            return p;
    end case;
end;
$$;

/** Huella: el mismo error (aunque cambien números e identificadores) cae en la misma fila. */
create or replace function public._err_huella(p_origen text, p_modulo text, p_ruta text, p_codigo text, p_mensaje text)
returns text
language sql immutable as $$
    select md5(concat_ws('|', coalesce(p_origen, ''), coalesce(p_modulo, ''),
        regexp_replace(coalesce(p_ruta, ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+', '#', 'g'),
        coalesce(p_codigo, ''),
        regexp_replace(lower(coalesce(p_mensaje, '')), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+', '#', 'g')))
$$;


-- ---------------------------------------------------------------- 4 · registrar (lo único que escribe el teléfono)

/**
 * p_lote = [{tipo:'error', origen, modulo, ruta, severidad, codigo, mensaje, detalle, repeticiones, cuando}, ...,
 *           {tipo:'latido', version, pendientes, pendiente_mas_viejo_h, ultima_sync_ok, en_linea, hora_telefono, datos}]
 * Solo se guarda a nombre de quien tiene la sesión. Límites: 50 elementos por envío, 200 filas distintas por hora.
 * Devuelve {recibidos, descartados, limitado}.
 */
create or replace function public.fn_errores_registrar(p_lote jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_uid     uuid := (select auth.uid());
    v_item    jsonb;
    v_n       integer := 0;
    v_ok      integer := 0;
    v_no      integer := 0;
    v_limitado boolean := false;
    v_recientes integer;
    v_origen  text;
    v_sev     text;
    v_msg     text;
    v_modulo  text;
    v_ruta    text;
    v_codigo  text;
    v_huella  text;
    v_rep     integer;
    v_cuando  timestamptz;
    v_det     jsonb;
    v_sync    timestamptz;
    v_hora    timestamptz;
begin
    if v_uid is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if p_lote is null or jsonb_typeof(p_lote) <> 'array' then
        return jsonb_build_object('recibidos', 0, 'descartados', 0, 'limitado', false);
    end if;
    -- Un usuario que no tiene perfil no puede guardar (llave foránea); se ignora sin romper al teléfono
    if not exists (select 1 from public.perfiles where id = v_uid) then
        return jsonb_build_object('recibidos', 0, 'descartados', jsonb_array_length(p_lote), 'limitado', false);
    end if;

    select count(*) into v_recientes from public.registro_errores
     where usuario_id = v_uid and ultima_vez > now() - interval '1 hour';

    for v_item in select e from jsonb_array_elements(p_lote) e limit 50 loop
        v_n := v_n + 1;
        begin
            if jsonb_typeof(v_item) <> 'object' then
                v_no := v_no + 1;
                continue;
            end if;

            if coalesce(v_item->>'tipo', 'error') = 'latido' then
                v_sync := null;
                v_hora := null;
                begin v_sync := (v_item->>'ultima_sync_ok')::timestamptz; exception when others then v_sync := null; end;
                begin v_hora := (v_item->>'hora_telefono')::timestamptz; exception when others then v_hora := null; end;
                insert into public.registro_salud as s
                    (usuario_id, actualizado_en, version_app, pendientes, pendiente_mas_viejo_h, ultima_sync_ok, en_linea, desfase_reloj_s, datos)
                values (v_uid, now(),
                        public._err_sanear_texto(v_item->>'version', 40),
                        least(greatest(coalesce(nullif(v_item->>'pendientes', '')::numeric, 0), 0), 100000)::integer,
                        case when coalesce(v_item->>'pendiente_mas_viejo_h', '') ~ '^-?[0-9.]+$'
                             then least((v_item->>'pendiente_mas_viejo_h')::numeric, 100000) end,
                        v_sync,
                        case when v_item->>'en_linea' in ('true', 'false') then (v_item->>'en_linea')::boolean end,
                        case when v_hora is not null then extract(epoch from (v_hora - now()))::integer end,
                        coalesce(public._err_sanear(v_item->'datos'), '{}'::jsonb))
                on conflict (usuario_id) do update
                   set actualizado_en = now(), version_app = excluded.version_app, pendientes = excluded.pendientes,
                       pendiente_mas_viejo_h = excluded.pendiente_mas_viejo_h,
                       -- la última sincronización buena solo avanza (un latido sin ese dato no la borra)
                       ultima_sync_ok = greatest(s.ultima_sync_ok, excluded.ultima_sync_ok),
                       en_linea = excluded.en_linea, desfase_reloj_s = excluded.desfase_reloj_s, datos = excluded.datos;
                v_ok := v_ok + 1;
                continue;
            end if;

            v_msg := nullif(btrim(public._err_sanear_texto(v_item->>'mensaje', 1000)), '');
            if v_msg is null then
                v_no := v_no + 1;
                continue;
            end if;
            v_origen := case when v_item->>'origen' in ('navegador', 'sincronizacion', 'guardado', 'pantalla', 'servidor', 'otro')
                             then v_item->>'origen' else 'otro' end;
            v_sev := case when v_item->>'severidad' in ('info', 'aviso', 'error', 'critico') then v_item->>'severidad' else 'error' end;
            v_modulo := nullif(left(btrim(coalesce(v_item->>'modulo', '')), 60), '');
            v_ruta := nullif(left(public._err_sanear_texto(split_part(coalesce(v_item->>'ruta', ''), '?', 1), 200), 200), '');
            v_codigo := nullif(left(btrim(coalesce(v_item->>'codigo', '')), 60), '');
            v_rep := least(greatest(coalesce(nullif(v_item->>'repeticiones', '')::numeric, 1), 1), 100000)::integer;
            v_cuando := null;
            begin v_cuando := (v_item->>'cuando')::timestamptz; exception when others then v_cuando := null; end;
            v_det := coalesce(public._err_sanear(v_item->'detalle'), '{}'::jsonb);
            if jsonb_typeof(v_det) <> 'object' then v_det := jsonb_build_object('valor', v_det); end if;
            if length(v_det::text) > 8000 then
                v_det := jsonb_build_object('truncado', true, 'resumen', left(v_det::text, 3000));
            end if;
            v_huella := public._err_huella(v_origen, v_modulo, v_ruta, v_codigo, v_msg);

            -- Lo ya conocido solo suma; lo nuevo cuenta contra el límite por hora
            if not exists (select 1 from public.registro_errores where usuario_id = v_uid and huella = v_huella) then
                if v_recientes >= 200 then
                    v_limitado := true;
                    v_no := v_no + 1;
                    continue;
                end if;
                v_recientes := v_recientes + 1;
            end if;

            insert into public.registro_errores as r
                (usuario_id, origen, modulo, ruta, severidad, codigo, mensaje, detalle, huella, repeticiones, hora_cliente)
            values (v_uid, v_origen, v_modulo, v_ruta, v_sev, v_codigo, v_msg, v_det, v_huella, v_rep, v_cuando)
            on conflict (usuario_id, huella) do update
               set repeticiones = least(r.repeticiones + excluded.repeticiones, 1000000),
                   ultima_vez = now(),
                   detalle = excluded.detalle,
                   hora_cliente = excluded.hora_cliente,
                   severidad = case when array_position(array['info','aviso','error','critico'], excluded.severidad)
                                         > array_position(array['info','aviso','error','critico'], r.severidad)
                                    then excluded.severidad else r.severidad end,
                   -- si ya estaba atendido y vuelve a pasar, regresa a «nuevo» (la nota se conserva)
                   estado = case when r.estado = 'atendido' then 'nuevo' else r.estado end;
            v_ok := v_ok + 1;
        exception when others then
            -- un elemento dañado no tumba el resto
            v_no := v_no + 1;
        end;
    end loop;

    -- Retención 90 días: purga oportunista (2 % de los envíos) para que la base siga ligera
    if random() < 0.02 then
        perform public._err_purgar();
    end if;

    return jsonb_build_object('recibidos', v_ok, 'descartados', v_no + greatest(jsonb_array_length(p_lote) - v_n, 0), 'limitado', v_limitado);
end;
$$;

create or replace function public._err_purgar()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v integer;
begin
    delete from public.registro_errores where ultima_vez < now() - interval '90 days';
    get diagnostics v = row_count;
    delete from public.registro_salud where actualizado_en < now() - interval '90 days';
    return v;
end;
$$;
revoke execute on function public._err_purgar() from public, anon, authenticated;

/** Mantenimiento manual (quien atiende la bitácora). Devuelve cuántos errores viejos se borraron. */
create or replace function public.fn_errores_purgar()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public._err_exigir('atender');
    return public._err_purgar();
end;
$$;


-- ---------------------------------------------------------------- 5 · lectura

/** Lista para el administrador. Filtros (todos opcionales): usuario, desde, hasta, severidad[], modulo, estado, origen, limite. */
create or replace function public.fn_errores_listar(p_filtros jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    f jsonb := coalesce(p_filtros, '{}'::jsonb);
    v_lim integer := least(greatest(coalesce(nullif(f->>'limite', '')::integer, 200), 1), 500);
    v_usuario uuid := nullif(f->>'usuario', '')::uuid;
    v_desde timestamptz := nullif(f->>'desde', '')::timestamptz;
    v_hasta timestamptz := nullif(f->>'hasta', '')::timestamptz;
    v_sev text[] := case when jsonb_typeof(f->'severidad') = 'array' then array(select jsonb_array_elements_text(f->'severidad')) end;
begin
    perform public._err_exigir('ver');
    return coalesce((
        select jsonb_agg(to_jsonb(x) order by x.ultima_vez desc)
        from (
            select r.id, r.usuario_id, p.nombre as usuario, r.creado_en, r.ultima_vez, r.repeticiones, r.origen, r.modulo,
                   r.ruta, r.severidad, r.codigo, r.mensaje, r.detalle, r.estado, r.nota_admin, r.atendido_at,
                   pa.nombre as atendido_por, r.hora_cliente
              from public.registro_errores r
              join public.perfiles p on p.id = r.usuario_id
              left join public.perfiles pa on pa.id = r.atendido_por
             where (v_usuario is null or r.usuario_id = v_usuario)
               and (v_desde is null or r.ultima_vez >= v_desde)
               and (v_hasta is null or r.ultima_vez < v_hasta)
               and (v_sev is null or r.severidad = any(v_sev))
               and (nullif(f->>'modulo', '') is null or r.modulo = f->>'modulo')
               and (nullif(f->>'estado', '') is null or r.estado = f->>'estado')
               and (nullif(f->>'origen', '') is null or r.origen = f->>'origen')
             order by r.ultima_vez desc
             limit v_lim
        ) x), '[]'::jsonb);
end;
$$;

/** Marca como visto/atendido (con nota). Devuelve cuántos cambió. */
create or replace function public.fn_errores_marcar(p_ids uuid[], p_estado text, p_nota text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v integer;
begin
    perform public._err_exigir('atender');
    if p_estado not in ('nuevo', 'visto', 'atendido') then
        raise exception 'Estado no válido: %', p_estado;
    end if;
    if p_ids is null or cardinality(p_ids) = 0 then
        return 0;
    end if;
    update public.registro_errores
       set estado = p_estado,
           nota_admin = case when nullif(btrim(p_nota), '') is not null then left(btrim(p_nota), 1000) else nota_admin end,
           atendido_por = case when p_estado = 'atendido' then (select auth.uid()) else atendido_por end,
           atendido_at = case when p_estado = 'atendido' then now() else atendido_at end
     where id = any(p_ids);
    get diagnostics v = row_count;
    return v;
end;
$$;

/** Operaciones de Fertirriego que el SERVIDOR rechazó o aceptó con observaciones (viven en fert_operaciones). */
create or replace function public.fn_errores_operaciones_fallidas(p_desde timestamptz default null, p_hasta timestamptz default null,
                                                                  p_usuario uuid default null, p_solo_rechazadas boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._err_exigir('ver');
    return coalesce((
        select jsonb_agg(to_jsonb(x) order by x.recibido_en desc)
        from (
            select o.id, o.perfil_id as usuario_id, p.nombre as usuario, o.tipo, o.estacion_id, e.nombre as estacion,
                   o.resultado, o.mensaje, o.observaciones, o.creado_en, o.enviado_en, o.recibido_en,
                   extract(epoch from (o.recibido_en - o.creado_en))::bigint as demora_s, o.inmediato, o.dispositivo,
                   o.en_nombre_de, left(o.datos::text, 1500) as datos_resumen
              from public.fert_operaciones o
              join public.perfiles p on p.id = o.perfil_id
              left join public.estaciones_riego e on e.id = o.estacion_id
             where (o.resultado = 'RECHAZADO' or (not p_solo_rechazadas and o.resultado = 'ACEPTADO_CON_OBSERVACIONES'))
               and (p_desde is null or o.recibido_en >= p_desde)
               and (p_hasta is null or o.recibido_en < p_hasta)
               and (p_usuario is null or o.perfil_id = p_usuario)
             order by o.recibido_en desc
             limit 500
        ) x), '[]'::jsonb);
end;
$$;

/** Una fila por persona con señales de salud (para el semáforo). Incluye a quien tiene latido, errores o rechazos. */
create or replace function public.fn_errores_resumen_por_usuario()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._err_exigir('ver');
    return coalesce((
        select jsonb_agg(to_jsonb(x) order by x.graves_nuevos desc, x.errores_7d desc, x.nombre)
        from (
            select p.id as usuario_id, p.nombre,
                   s.actualizado_en as ultimo_latido, s.version_app, s.pendientes, s.pendiente_mas_viejo_h,
                   s.ultima_sync_ok, s.en_linea, s.desfase_reloj_s,
                   coalesce(e.errores_7d, 0) as errores_7d,
                   coalesce(e.graves_nuevos, 0) as graves_nuevos,
                   coalesce(e.errores_hoy, 0) as errores_hoy,
                   coalesce(o.rechazos_7d, 0) as rechazos_7d,
                   coalesce(o.rechazos_hoy, 0) as rechazos_hoy
              from public.perfiles p
              left join public.registro_salud s on s.usuario_id = p.id
              left join lateral (
                   select count(*) filter (where r.ultima_vez > now() - interval '7 days' and r.severidad in ('error', 'critico'))::int as errores_7d,
                          count(*) filter (where r.severidad in ('error', 'critico') and r.estado = 'nuevo')::int as graves_nuevos,
                          count(*) filter (where r.ultima_vez >= date_trunc('day', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa'
                                           and r.severidad in ('error', 'critico'))::int as errores_hoy
                     from public.registro_errores r where r.usuario_id = p.id) e on true
              left join lateral (
                   select count(*) filter (where op.recibido_en > now() - interval '7 days')::int as rechazos_7d,
                          count(*) filter (where op.recibido_en >= date_trunc('day', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa')::int as rechazos_hoy
                     from public.fert_operaciones op where op.perfil_id = p.id and op.resultado = 'RECHAZADO') o on true
             where p.activo and (s.usuario_id is not null or e.errores_7d > 0 or e.graves_nuevos > 0 or o.rechazos_7d > 0)
        ) x), '[]'::jsonb);
end;
$$;

/** Para el indicador del menú: cuántos errores graves siguen «nuevos». 0 (sin error) para quien no tiene el permiso. */
create or replace function public.fn_errores_graves_nuevos()
returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not public._err_puede_ver() then
        return 0;
    end if;
    return (select count(*)::int from public.registro_errores where estado = 'nuevo' and severidad in ('error', 'critico'));
end;
$$;


-- ---------------------------------------------------------------- 6 · permisos de ejecución

revoke execute on function public.fn_errores_registrar(jsonb) from public, anon;
revoke execute on function public.fn_errores_purgar() from public, anon;
revoke execute on function public.fn_errores_listar(jsonb) from public, anon;
revoke execute on function public.fn_errores_marcar(uuid[], text, text) from public, anon;
revoke execute on function public.fn_errores_operaciones_fallidas(timestamptz, timestamptz, uuid, boolean) from public, anon;
revoke execute on function public.fn_errores_resumen_por_usuario() from public, anon;
revoke execute on function public.fn_errores_graves_nuevos() from public, anon;
grant execute on function public.fn_errores_registrar(jsonb) to authenticated;
grant execute on function public.fn_errores_purgar() to authenticated;
grant execute on function public.fn_errores_listar(jsonb) to authenticated;
grant execute on function public.fn_errores_marcar(uuid[], text, text) to authenticated;
grant execute on function public.fn_errores_operaciones_fallidas(timestamptz, timestamptz, uuid, boolean) to authenticated;
grant execute on function public.fn_errores_resumen_por_usuario() to authenticated;
grant execute on function public.fn_errores_graves_nuevos() to authenticated;

notify pgrst, 'reload schema';
