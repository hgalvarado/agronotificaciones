-- =====================================================================
-- 154 · Alertas con avisos PUSH al teléfono + Centro de alertas
--
-- Qué hace:
--   1. Tablas: alertas, alertas_lecturas (leída/atendida por persona), alertas_envios (a quién y si llegó),
--      alertas_silencios, alertas_config (despacho), push_suscripciones, push_preferencias.
--   2. Permiso: pantalla «alertas» · acción «ver» (menú «Campo»). NO se concede a ningún rol: el administrador lo
--      habilita por rol en Permisos. El ALCANCE manda: global = todo; zonal = sus zonas/estaciones;
--      propietario = sus estaciones. «Todas las zonas» del perfil equivale a global en el alcance zonal.
--   3. Contrato con AGL: fn_alerta_publicar(jsonb), fn_alerta_resolver(text). Idempotentes por «clave».
--      p = {clave, tipo, gravedad, zona, estacion, titulo(<=60), cuerpo(<=140), url, destino, valida_hasta}
--      destino = {pantalla, pestana, estacion_id|estacion, tanque_id, motor_id, registro_id|documento_id, fecha}
--      La función arma la URL final (enlace profundo) y la guarda con el destino.
--   4. Alertas internas (triggers tolerantes: NUNCA rompen la operación): saldo negativo y capacidad llena
--      (fert_operaciones.observaciones) y mantenimiento vencido/próximo (mot_motores).
--   5. Despacho: fn_alertas_plan_despacho / fn_alerta_registrar_envio / fn_alerta_cerrar_despacho (solo service_role),
--      que usa la ruta /api/push/despachar. Disparo opcional con pg_net (alertas_config).
--   6. Centro de alertas (/alertas): fn_alertas_listar, fn_alertas_no_leidas, fn_alertas_marcar, y de control
--      (alcance global): fn_alertas_control, fn_alerta_reenviar, fn_alerta_silenciar, fn_alerta_quitar_silencio.
--
-- Idempotente (2 corridas). Todo UPDATE/DELETE lleva WHERE. Fechas en UTC-6 (America/Tegucigalpa).
-- Si se vuelve a correr 147 (mot_motores) o 130: el trigger de mantenimiento no se pierde (está sobre la tabla).
-- =====================================================================

-- ---------------------------------------------------------------- 1 · tablas
create table if not exists public.alertas (
    id              uuid primary key default gen_random_uuid(),
    clave           text not null unique check (btrim(clave) <> ''),
    tipo            text not null,
    gravedad        text not null default 'media' check (gravedad in ('alta', 'media', 'baja')),
    zona_id         uuid references public.zonas(id) on delete set null,
    estacion_id     uuid references public.estaciones_riego(id) on delete set null,
    titulo          text not null,
    cuerpo          text not null default '',
    url             text not null default '/campo',
    destino         jsonb,
    estado          text not null default 'abierta' check (estado in ('abierta', 'atendida', 'resuelta')),
    creada_at       timestamptz not null default now(),
    notificada_at   timestamptz,
    despacho_inicio timestamptz,
    reenviar        boolean not null default false,
    resuelta_at     timestamptz,
    atendida_at     timestamptz,
    atendida_por    uuid,
    atendida_nota   text,
    valida_hasta    timestamptz,
    reaperturas     integer not null default 0
);
create index if not exists idx_alertas_estado on public.alertas (estado, creada_at desc);
create index if not exists idx_alertas_pend on public.alertas (creada_at) where notificada_at is null and estado = 'abierta';
create index if not exists idx_alertas_estacion on public.alertas (estacion_id) where estacion_id is not null;

create table if not exists public.alertas_lecturas (
    alerta_id   uuid not null references public.alertas(id) on delete cascade,
    perfil_id   uuid not null references public.perfiles(id) on delete cascade,
    leida_at    timestamptz,
    atendida_at timestamptz,
    nota        text,
    primary key (alerta_id, perfil_id)
);
create index if not exists idx_alertas_lect_perfil on public.alertas_lecturas (perfil_id);

create table if not exists public.push_suscripciones (
    id           uuid primary key default gen_random_uuid(),
    perfil_id    uuid not null references public.perfiles(id) on delete cascade,
    endpoint     text not null unique,
    p256dh       text not null,
    auth         text not null,
    user_agent   text,
    creada_at    timestamptz not null default now(),
    ultima_ok_at timestamptz,
    activa       boolean not null default true
);
create index if not exists idx_push_susc_perfil on public.push_suscripciones (perfil_id) where activa;

create table if not exists public.push_preferencias (
    perfil_id uuid not null references public.perfiles(id) on delete cascade,
    tipo      text not null,
    activo    boolean not null default true,
    primary key (perfil_id, tipo)
);

create table if not exists public.alertas_envios (
    id            bigint generated always as identity primary key,
    alerta_id     uuid not null references public.alertas(id) on delete cascade,
    perfil_id     uuid references public.perfiles(id) on delete set null,
    suscripcion_id uuid,
    resultado     text not null check (resultado in ('enviado', 'fallo', 'sin_dispositivo', 'omitido_pref', 'silenciada')),
    detalle       text,
    enviado_at    timestamptz not null default now()
);
create index if not exists idx_alertas_env_alerta on public.alertas_envios (alerta_id, enviado_at desc);
create index if not exists idx_alertas_env_dup on public.alertas_envios (alerta_id, perfil_id, enviado_at desc) where resultado = 'enviado';

create table if not exists public.alertas_silencios (
    id          uuid primary key default gen_random_uuid(),
    tipo        text,
    estacion_id uuid references public.estaciones_riego(id) on delete cascade,
    hasta       timestamptz not null,
    nota        text,
    creado_por  uuid,
    creado_at   timestamptz not null default now(),
    check (tipo is not null or estacion_id is not null)
);

/** Singleton: a dónde avisar (pg_net) cuando nace una alerta. Sin fila o sin URL = no se dispara (lo hace AGL o un cron). */
create table if not exists public.alertas_config (
    id              boolean primary key default true check (id),
    despacho_url    text,
    despacho_secreto text
);
insert into public.alertas_config (id) values (true) on conflict (id) do nothing;

alter table public.alertas           enable row level security;
alter table public.alertas_lecturas  enable row level security;
alter table public.push_suscripciones enable row level security;
alter table public.push_preferencias enable row level security;
alter table public.alertas_envios    enable row level security;
alter table public.alertas_silencios enable row level security;
alter table public.alertas_config    enable row level security;   -- sin políticas: solo funciones definer


-- ---------------------------------------------------------------- 2 · permiso y pantalla
insert into public.acciones (codigo, nombre, descripcion, orden, escribe, nivel) values
    ('ver', 'Ver', 'Ver la pantalla.', 1, false, 1)
on conflict (codigo) do nothing;

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones, en_menu, icono, modulo, etiquetas_alcance) values
    ('alertas', 'Alertas',
     'Centro de alertas de Campo: avisos al teléfono (cuadre de combustible, mantenimiento, saldo negativo, capacidad). '
     'El alcance decide cuáles recibe: todas, las de sus zonas o las de sus estaciones. Con alcance «Todas» ve además el panel de Control.',
     '/alertas', 129, array['ver'], true, 'plan', 'Campo',
     '{"global": "Todas las alertas y Control", "zonal": "Alertas de sus zonas", "propietario": "Alertas de sus estaciones"}'::jsonb)
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, ruta = excluded.ruta,
    orden = excluded.orden, acciones = excluded.acciones;
-- No se concede a ningún rol: solo el administrador hasta que se asigne en Permisos.


-- ---------------------------------------------------------------- 3 · quién ve qué (alcance)
/** Misma regla de administrador que fn_es_admin(), pero para cualquier perfil. */
create or replace function public._alerta_perfil_es_admin(p_perfil uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.roles r
         where r.codigo = 'ADMIN'
           and (r.id = (select p.rol_id from public.perfiles p where p.id = p_perfil)
                or r.id in (select pr.rol_id from seguridad.perfiles_roles pr where pr.perfil_id = p_perfil)))
$$;
revoke execute on function public._alerta_perfil_es_admin(uuid) from public, anon, authenticated;

/** Mayor alcance de «Alertas · ver» entre todos los roles del perfil: 'global' | 'zonal' | 'propietario' | null (sin permiso). */
create or replace function public._alerta_alcance(p_perfil uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when public._alerta_perfil_es_admin(p_perfil) then 'global'
        else (
            select case max(case pm.alcance::text when 'global' then 3 when 'zonal' then 2 else 1 end)
                       when 3 then 'global' when 2 then 'zonal' when 1 then 'propietario' end
              from public.permisos pm
             where pm.recurso = 'alertas' and pm.accion = 'ver' and pm.permitido
               and (pm.rol_id = (select p.rol_id from public.perfiles p where p.id = p_perfil)
                    or pm.rol_id in (select pr.rol_id from seguridad.perfiles_roles pr where pr.perfil_id = p_perfil)))
        end
$$;
-- Las políticas RLS evalúan estas dos con los privilegios de quien consulta: deben poder ejecutarlas (son definer)
revoke execute on function public._alerta_alcance(uuid) from public, anon;
grant  execute on function public._alerta_alcance(uuid) to authenticated;

/** ¿Le toca esta alerta (zona/estación) a esa persona? Devuelve el alcance con que la ve, o null. */
create or replace function public._alerta_ve(p_perfil uuid, p_zona uuid, p_estacion uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_alc  text := public._alerta_alcance(p_perfil);
    v_zona uuid := p_zona;
begin
    if v_alc is null then return null; end if;
    if v_alc = 'global' then return 'global'; end if;
    if p_estacion is not null and v_zona is null then
        v_zona := (select e.zona_id from public.estaciones_riego e where e.id = p_estacion);
    end if;
    if v_alc = 'zonal' then
        if coalesce((select p.todas_las_zonas from public.perfiles p where p.id = p_perfil), false) then return 'global'; end if;
        if v_zona is not null and exists (select 1 from public.perfiles_zonas pz where pz.perfil_id = p_perfil and pz.zona_id = v_zona) then
            return 'zonal';
        end if;
    end if;
    if p_estacion is not null and exists (select 1 from public.perfiles_estaciones pe where pe.perfil_id = p_perfil and pe.estacion_id = p_estacion) then
        return v_alc;
    end if;
    return null;
end $$;
revoke execute on function public._alerta_ve(uuid, uuid, uuid) from public, anon;
grant  execute on function public._alerta_ve(uuid, uuid, uuid) to authenticated;

/** El usuario actual: ¿tiene el permiso (cualquier alcance)? ¿Es de control (alcance total)? */
create or replace function public._alerta_exigir(p_control boolean default false)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_alc text;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    v_alc := public._alerta_alcance((select auth.uid()));
    if v_alc is null or (p_control and v_alc <> 'global') then
        raise exception 'Tu rol no tiene permiso para %.',
            case when p_control then 'el Control de alertas (alcance «Todas»)' else 'ver las alertas' end using errcode = '42501';
    end if;
end $$;
revoke execute on function public._alerta_exigir(boolean) from public, anon, authenticated;

-- Políticas (lectura por alcance; las escrituras van por funciones definer)
drop policy if exists alertas_leer on public.alertas;
create policy alertas_leer on public.alertas for select to authenticated
    using (public._alerta_ve((select auth.uid()), zona_id, estacion_id) is not null);

drop policy if exists alertas_lect_propias on public.alertas_lecturas;
create policy alertas_lect_propias on public.alertas_lecturas for select to authenticated
    using (perfil_id = (select auth.uid()));

drop policy if exists push_susc_propias on public.push_suscripciones;
create policy push_susc_propias on public.push_suscripciones for select to authenticated
    using (perfil_id = (select auth.uid()));

drop policy if exists push_pref_propias on public.push_preferencias;
create policy push_pref_propias on public.push_preferencias for all to authenticated
    using (perfil_id = (select auth.uid()))
    with check (perfil_id = (select auth.uid()) and public._alerta_alcance((select auth.uid())) is not null);

drop policy if exists alertas_env_control on public.alertas_envios;
create policy alertas_env_control on public.alertas_envios for select to authenticated
    using (public._alerta_alcance((select auth.uid())) = 'global');

drop policy if exists alertas_sil_control on public.alertas_silencios;
create policy alertas_sil_control on public.alertas_silencios for select to authenticated
    using (public._alerta_alcance((select auth.uid())) = 'global');

grant select on public.alertas, public.alertas_lecturas, public.push_suscripciones, public.alertas_envios, public.alertas_silencios to authenticated;
grant select, insert, update, delete on public.push_preferencias to authenticated;


-- ---------------------------------------------------------------- 4 · publicar / resolver (contrato con AGL e internas)
/** Tipos conocidos; cualquier otro se guarda como «otro». */
create or replace function public._alerta_tipos()
returns text[] language sql immutable as $$
    select array['cuadre_combustible', 'mantenimiento_vencido', 'saldo_negativo', 'capacidad_llena', 'otro']
$$;

/** Enlace profundo: arma /<pantalla>?pestana=..&estacion=..&tanque=..&motor=..&registro=..&fecha=.. (solo lo que venga). */
create or replace function public._alerta_armar_url(p_destino jsonb, p_url text)
returns text language plpgsql immutable as $$
declare
    v_pant text := lower(btrim(coalesce(p_destino->>'pantalla', '')));
    v_ruta text;
    v_q    text[] := '{}';
    k      text;
    v      text;
begin
    v_ruta := case v_pant when 'motores' then '/motores' when 'fertirriego' then '/fertirriego' when 'inyeccion' then '/inyeccion'
                          when 'agrometricas' then '/agrometricas' when 'campo' then '/campo' else null end;
    if v_ruta is null then
        return case when coalesce(btrim(p_url), '') like '/%' and coalesce(btrim(p_url), '') not like '//%' then btrim(p_url) else '/campo' end;
    end if;
    foreach k in array array['pestana', 'estacion', 'tanque', 'motor', 'registro', 'fecha'] loop
        v := case k
                 when 'estacion'  then coalesce(p_destino->>'estacion_id', p_destino->>'estacion_uuid')
                 when 'tanque'    then p_destino->>'tanque_id'
                 when 'motor'     then p_destino->>'motor_id'
                 when 'registro'  then coalesce(p_destino->>'registro_id', p_destino->>'documento_id')
                 else p_destino->>k end;
        if nullif(btrim(coalesce(v, '')), '') is not null then
            v_q := v_q || (k || '=' || replace(replace(replace(replace(btrim(v), '%', '%25'), '&', '%26'), ' ', '%20'), '#', '%23'));
        end if;
    end loop;
    return v_ruta || case when array_length(v_q, 1) > 0 then '?' || array_to_string(v_q, '&') else '' end;
end $$;

/** Dispara el despacho (pg_net) si está configurado. Nunca falla. */
create or replace function public._alerta_disparar()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c record;
begin
    select * into c from public.alertas_config where id;
    if c.despacho_url is null or btrim(c.despacho_url) = '' then return; end if;
    if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
        using c.despacho_url, '{}'::jsonb,
              jsonb_build_object('Content-Type', 'application/json', 'x-despacho-secreto', coalesce(c.despacho_secreto, ''));
exception when others then
    null;
end $$;
revoke execute on function public._alerta_disparar() from public, anon, authenticated;

/** Núcleo: lo usan fn_alerta_publicar (AGL) y los triggers. Devuelve {nuevo, id}. */
create or replace function public._alerta_emitir(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p       jsonb := coalesce(p, '{}'::jsonb);
    v_clave   text := nullif(btrim(coalesce(v_p->>'clave', '')), '');
    v_tipo    text := coalesce(nullif(btrim(v_p->>'tipo'), ''), 'otro');
    v_grav    text := lower(coalesce(nullif(btrim(v_p->>'gravedad'), ''), 'media'));
    v_dest    jsonb := case when jsonb_typeof(v_p->'destino') = 'object' then v_p->'destino' else null end;
    v_zona    uuid;
    v_est     uuid;
    v_nombre  text;
    v_url     text;
    v_id      uuid;
    v_estado  text;
    v_titulo  text := left(btrim(coalesce(v_p->>'titulo', '')), 60);
    v_cuerpo  text := left(btrim(coalesce(v_p->>'cuerpo', '')), 140);
begin
    if v_clave is null then raise exception 'La alerta necesita una clave.' using errcode = '22023'; end if;
    if v_titulo = '' then raise exception 'La alerta necesita un título.' using errcode = '22023'; end if;
    if not (v_tipo = any (public._alerta_tipos())) then v_tipo := 'otro'; end if;
    if v_grav not in ('alta', 'media', 'baja') then v_grav := 'media'; end if;

    v_nombre := nullif(btrim(coalesce(v_p->>'estacion', '')), '');
    if v_dest is not null and nullif(v_dest->>'estacion_id', '') is not null then
        v_est := (select e.id from public.estaciones_riego e where e.id::text = v_dest->>'estacion_id');
    end if;
    if v_est is null and v_nombre is not null then
        v_est := (select e.id from public.estaciones_riego e where lower(btrim(e.nombre)) = lower(v_nombre) order by e.activo desc limit 1);
    end if;
    v_nombre := nullif(btrim(coalesce(v_p->>'zona', '')), '');
    if v_nombre is not null then
        v_zona := (select z.id from public.zonas z where lower(btrim(z.nombre)) = lower(v_nombre) limit 1);
    end if;
    if v_zona is null and v_est is not null then
        v_zona := (select e.zona_id from public.estaciones_riego e where e.id = v_est);
    end if;
    -- El destino siempre lleva la estación resuelta
    if v_est is not null then
        v_dest := coalesce(v_dest, '{}'::jsonb) || jsonb_build_object('estacion_id', v_est::text);
    end if;
    v_url := public._alerta_armar_url(v_dest, v_p->>'url');

    select a.id, a.estado into v_id, v_estado from public.alertas a where a.clave = v_clave for update;
    if v_id is null then
        insert into public.alertas (clave, tipo, gravedad, zona_id, estacion_id, titulo, cuerpo, url, destino, valida_hasta)
        values (v_clave, v_tipo, v_grav, v_zona, v_est, v_titulo, v_cuerpo, v_url, v_dest, nullif(v_p->>'valida_hasta', '')::timestamptz)
        returning id into v_id;
        perform public._alerta_disparar();
        return jsonb_build_object('nuevo', true, 'id', v_id);
    elsif v_estado = 'abierta' then
        -- Ya está abierta: no se crea otra ni se vuelve a avisar (solo se refresca el texto)
        update public.alertas set titulo = v_titulo, cuerpo = v_cuerpo, url = v_url, destino = coalesce(v_dest, destino), gravedad = v_grav
         where id = v_id;
        return jsonb_build_object('nuevo', false, 'id', v_id);
    else
        -- Estaba resuelta o atendida y reapareció: se reabre y se avisa otra vez
        update public.alertas
           set estado = 'abierta', titulo = v_titulo, cuerpo = v_cuerpo, url = v_url, destino = coalesce(v_dest, destino), gravedad = v_grav,
               tipo = v_tipo, zona_id = v_zona, estacion_id = v_est, creada_at = now(), notificada_at = null, despacho_inicio = null,
               resuelta_at = null, atendida_at = null, atendida_por = null, atendida_nota = null, reaperturas = reaperturas + 1,
               valida_hasta = nullif(v_p->>'valida_hasta', '')::timestamptz
         where id = v_id;
        delete from public.alertas_lecturas where alerta_id = v_id;
        perform public._alerta_disparar();
        return jsonb_build_object('nuevo', true, 'id', v_id);
    end if;
end $$;
revoke execute on function public._alerta_emitir(jsonb) from public, anon, authenticated;

/** Cierra (resuelta) las alertas abiertas cuya clave empiece por el prefijo. Interna. */
create or replace function public._alerta_cerrar_prefijo(p_prefijo text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
    update public.alertas set estado = 'resuelta', resuelta_at = now()
     where estado = 'abierta' and left(clave, length(p_prefijo)) = p_prefijo;
    get diagnostics n = row_count;
    return n;
end $$;
revoke execute on function public._alerta_cerrar_prefijo(text) from public, anon, authenticated;

create or replace function public._alerta_exigir_agl()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'publicar')) then
        raise exception 'Tu rol no tiene permiso para publicar alertas: se necesita Conexión AGL · publicar.' using errcode = '42501';
    end if;
end $$;
revoke execute on function public._alerta_exigir_agl() from public, anon, authenticated;

create or replace function public.fn_alerta_publicar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public._alerta_exigir_agl();
    return public._alerta_emitir(p);
end $$;
revoke execute on function public.fn_alerta_publicar(jsonb) from public, anon;
grant  execute on function public.fn_alerta_publicar(jsonb) to authenticated;

create or replace function public.fn_alerta_resolver(p_clave text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
    perform public._alerta_exigir_agl();
    update public.alertas set estado = 'resuelta', resuelta_at = now()
     where clave = btrim(coalesce(p_clave, '')) and estado = 'abierta';
    get diagnostics n = row_count;
    return n > 0;
end $$;
revoke execute on function public.fn_alerta_resolver(text) from public, anon;
grant  execute on function public.fn_alerta_resolver(text) to authenticated;


-- ---------------------------------------------------------------- 5 · alertas internas (triggers tolerantes)
/** Saldo negativo y capacidad llena: salen de las observaciones de la operación (sql 91/129/143/152). */
create or replace function public._alerta_trg_operacion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_est   record;
    v_fecha text;
begin
    begin
        if new.estacion_id is null or new.observaciones is null then return new; end if;
        if not ('SALDO_NEGATIVO' = any (new.observaciones) or 'EXCEDE_CAPACIDAD' = any (new.observaciones)) then return new; end if;
        if tg_op = 'UPDATE' and old.observaciones is not distinct from new.observaciones then return new; end if;
        select e.id, e.nombre, e.zona_id, e.prueba_de into v_est from public.estaciones_riego e where e.id = new.estacion_id;
        if not found or v_est.prueba_de is not null then return new; end if;   -- las de práctica no avisan
        v_fecha := to_char(coalesce(new.creado_en, new.recibido_en) at time zone 'America/Tegucigalpa', 'YYYY-MM-DD');
        if 'SALDO_NEGATIVO' = any (new.observaciones)
           and not (tg_op = 'UPDATE' and 'SALDO_NEGATIVO' = any (coalesce(old.observaciones, '{}'))) then
            perform public._alerta_emitir(jsonb_build_object(
                'clave', 'saldo|' || v_est.id || '|' || new.id, 'tipo', 'saldo_negativo', 'gravedad', 'media',
                'titulo', left('Saldo negativo · ' || v_est.nombre, 60),
                'cuerpo', left('Se registró ' || replace(new.tipo, '_', ' ') || ' sin inventario suficiente. Revisa el registro.', 140),
                'destino', jsonb_build_object('pantalla', 'fertirriego', 'pestana', 'bitacora', 'estacion_id', v_est.id,
                                              'registro_id', new.id, 'fecha', v_fecha)));
        end if;
        if 'EXCEDE_CAPACIDAD' = any (new.observaciones)
           and not (tg_op = 'UPDATE' and 'EXCEDE_CAPACIDAD' = any (coalesce(old.observaciones, '{}'))) then
            perform public._alerta_emitir(jsonb_build_object(
                'clave', 'capacidad|' || v_est.id || '|' || new.id, 'tipo', 'capacidad_llena', 'gravedad', 'media',
                'titulo', left('Capacidad excedida · ' || v_est.nombre, 60),
                'cuerpo', 'El saldo pasó la capacidad de almacenaje de la estación. Revisa lo recibido.',
                'destino', jsonb_build_object('pantalla', 'fertirriego', 'pestana', 'general', 'estacion_id', v_est.id,
                                              'registro_id', new.id, 'fecha', v_fecha)));
        end if;
    exception when others then
        null;   -- un aviso que falla NUNCA debe romper el registro del campo
    end;
    return new;
end $$;
revoke execute on function public._alerta_trg_operacion() from public, anon, authenticated;

drop trigger if exists trg_alerta_operacion on public.fert_operaciones;
create trigger trg_alerta_operacion
    after insert or update of observaciones on public.fert_operaciones
    for each row execute function public._alerta_trg_operacion();

/** Mantenimiento: al cambiar las horas del motor, mira el semáforo (sql 147). Rojo = vencido; amarillo = próximo. */
create or replace function public._alerta_trg_mantenimiento()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_sem   jsonb;
    v_niv   text;
    v_cod   text;
    v_nom   text;
    v_zona  uuid;
begin
    begin
        v_sem := public._mot_semaforo(new.equipo_id);
        v_niv := v_sem->>'nivel';
        if v_niv is null then return new; end if;
        if v_niv in ('verde', 'gris') then
            perform public._alerta_cerrar_prefijo('mant|' || new.equipo_id || '|');
            return new;
        end if;
        if new.estacion_id is not null
           and exists (select 1 from public.estaciones_riego e where e.id = new.estacion_id and e.prueba_de is not null) then
            return new;
        end if;
        select e.codigo, e.nombre into v_cod, v_nom from public.equipos e where e.id = new.equipo_id;
        -- Al pasar de próximo a vencido (o al revés) la alerta anterior deja de aplicar
        perform public._alerta_cerrar_prefijo('mant|' || new.equipo_id || '|' || case v_niv when 'rojo' then 'amarillo' else 'rojo' end);
        perform public._alerta_emitir(jsonb_build_object(
            'clave', 'mant|' || new.equipo_id || '|' || v_niv, 'tipo', 'mantenimiento_vencido',
            'gravedad', case v_niv when 'rojo' then 'alta' else 'media' end,
            'titulo', left(case v_niv when 'rojo' then 'Mantenimiento vencido · ' else 'Mantenimiento próximo · ' end
                           || coalesce(v_cod, v_nom, 'motor'), 60),
            'cuerpo', left(coalesce(v_sem->>'texto', ''), 140),
            'destino', jsonb_build_object('pantalla', 'motores', 'pestana', 'motores', 'motor_id', new.equipo_id,
                                          'estacion_id', new.estacion_id)));
    exception when others then
        null;
    end;
    return new;
end $$;
revoke execute on function public._alerta_trg_mantenimiento() from public, anon, authenticated;

drop trigger if exists trg_alerta_mantenimiento on public.mot_motores;
create trigger trg_alerta_mantenimiento
    after update of horas_desde_mant, horas_est_desde_mant, intervalo_horas, aviso_horas on public.mot_motores
    for each row
    when (old.horas_desde_mant is distinct from new.horas_desde_mant
          or old.horas_est_desde_mant is distinct from new.horas_est_desde_mant
          or old.intervalo_horas is distinct from new.intervalo_horas
          or old.aviso_horas is distinct from new.aviso_horas)
    execute function public._alerta_trg_mantenimiento();


-- ---------------------------------------------------------------- 6 · suscripciones y preferencias (teléfono de cada persona)
create or replace function public.fn_push_suscribir(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
    perform public._alerta_exigir(false);
    if coalesce(btrim(p_endpoint), '') = '' or coalesce(btrim(p_p256dh), '') = '' or coalesce(btrim(p_auth), '') = '' then
        raise exception 'Suscripción incompleta.' using errcode = '22023';
    end if;
    insert into public.push_suscripciones (perfil_id, endpoint, p256dh, auth, user_agent, activa)
    values ((select auth.uid()), btrim(p_endpoint), btrim(p_p256dh), btrim(p_auth), left(p_user_agent, 300), true)
    on conflict (endpoint) do update
        set perfil_id = excluded.perfil_id, p256dh = excluded.p256dh, auth = excluded.auth,
            user_agent = excluded.user_agent, activa = true
    returning id into v_id;
    return v_id;
end $$;
revoke execute on function public.fn_push_suscribir(text, text, text, text) from public, anon;
grant  execute on function public.fn_push_suscribir(text, text, text, text) to authenticated;

create or replace function public.fn_push_desactivar(p_endpoint text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
    if (select auth.uid()) is null then return false; end if;
    update public.push_suscripciones set activa = false
     where endpoint = btrim(coalesce(p_endpoint, '')) and perfil_id = (select auth.uid());
    get diagnostics n = row_count;
    return n > 0;
end $$;
revoke execute on function public.fn_push_desactivar(text) from public, anon;
grant  execute on function public.fn_push_desactivar(text) to authenticated;


-- ---------------------------------------------------------------- 7 · centro de alertas (cada persona)
create or replace function public.fn_alertas_no_leidas()
returns integer language sql stable security definer set search_path = public, pg_temp as $$
    select case when public._alerta_alcance((select auth.uid())) is null then 0 else
        (select count(*)::integer from public.alertas a
          where a.estado = 'abierta'
            and public._alerta_ve((select auth.uid()), a.zona_id, a.estacion_id) is not null
            and not exists (select 1 from public.alertas_lecturas l
                             where l.alerta_id = a.id and l.perfil_id = (select auth.uid()) and l.leida_at is not null))
    end
$$;
revoke execute on function public.fn_alertas_no_leidas() from public, anon;
grant  execute on function public.fn_alertas_no_leidas() to authenticated;

/**
 * p = {estado:[nueva|leida|atendida], tipo:[..], gravedad:[..], estacion:[ids], zona:[ids], desde:'YYYY-MM-DD', hasta:'YYYY-MM-DD', limite:int}
 * -> [{id, clave, tipo, gravedad, titulo, cuerpo, url, destino, creada_at, zona, estacion, estado_usuario, estado, leida_at, atendida_at, nota, atendida_por_nombre}]
 * estado_usuario: 'nueva' (no la has leído), 'leida', 'atendida' (atendida o resuelta).
 */
create or replace function public.fn_alertas_listar(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_p       jsonb := coalesce(p, '{}'::jsonb);
    v_lim     integer := least(greatest(coalesce((v_p->>'limite')::integer, 200), 1), 500);
    v_estado  text[] := array(select jsonb_array_elements_text(coalesce(v_p->'estado', '[]'::jsonb)));
    v_tipo    text[] := array(select jsonb_array_elements_text(coalesce(v_p->'tipo', '[]'::jsonb)));
    v_grav    text[] := array(select jsonb_array_elements_text(coalesce(v_p->'gravedad', '[]'::jsonb)));
    v_est     text[] := array(select jsonb_array_elements_text(coalesce(v_p->'estacion', '[]'::jsonb)));
    v_zona    text[] := array(select jsonb_array_elements_text(coalesce(v_p->'zona', '[]'::jsonb)));
    v_desde   date := nullif(v_p->>'desde', '')::date;
    v_hasta   date := nullif(v_p->>'hasta', '')::date;
    v_yo      uuid := (select auth.uid());
    v_res     jsonb;
begin
    perform public._alerta_exigir(false);
    select coalesce(jsonb_agg(to_jsonb(t) order by t.creada_at desc), '[]'::jsonb) into v_res
      from (
        select a.id, a.clave, a.tipo, a.gravedad, a.titulo, a.cuerpo, a.url, a.destino, a.creada_at, a.estado,
               z.nombre as zona, e.nombre as estacion,
               case when a.estado <> 'abierta' then 'atendida'
                    when l.leida_at is not null then 'leida' else 'nueva' end as estado_usuario,
               l.leida_at, coalesce(l.atendida_at, a.atendida_at) as atendida_at, coalesce(l.nota, a.atendida_nota) as nota,
               (select pf.nombre from public.perfiles pf where pf.id = a.atendida_por) as atendida_por_nombre
          from public.alertas a
          left join public.zonas z on z.id = a.zona_id
          left join public.estaciones_riego e on e.id = a.estacion_id
          left join public.alertas_lecturas l on l.alerta_id = a.id and l.perfil_id = v_yo
         where public._alerta_ve(v_yo, a.zona_id, a.estacion_id) is not null
           and (cardinality(v_tipo) = 0 or a.tipo = any (v_tipo))
           and (cardinality(v_grav) = 0 or a.gravedad = any (v_grav))
           and (cardinality(v_est) = 0 or a.estacion_id::text = any (v_est))
           and (cardinality(v_zona) = 0 or coalesce(a.zona_id, e.zona_id)::text = any (v_zona))
           and (v_desde is null or (a.creada_at at time zone 'America/Tegucigalpa')::date >= v_desde)
           and (v_hasta is null or (a.creada_at at time zone 'America/Tegucigalpa')::date <= v_hasta)
           and (cardinality(v_estado) = 0 or (case when a.estado <> 'abierta' then 'atendida'
                                                   when l.leida_at is not null then 'leida' else 'nueva' end) = any (v_estado))
         order by a.creada_at desc
         limit v_lim
      ) t;
    return v_res;
end $$;
revoke execute on function public.fn_alertas_listar(jsonb) from public, anon;
grant  execute on function public.fn_alertas_listar(jsonb) to authenticated;

/** p_accion = 'leida' | 'atendida'. Solo las que le tocan. Atender cierra la alerta para todos (y AGL la ve atendida). Devuelve cuántas. */
create or replace function public.fn_alertas_marcar(p_ids uuid[], p_accion text, p_nota text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_yo   uuid := (select auth.uid());
    v_nota text := left(nullif(btrim(coalesce(p_nota, '')), ''), 200);
    v_ids  uuid[];
begin
    perform public._alerta_exigir(false);
    if p_accion not in ('leida', 'atendida') then raise exception 'Acción desconocida.' using errcode = '22023'; end if;
    v_ids := array(select a.id from public.alertas a
                    where a.id = any (coalesce(p_ids, '{}'))
                      and public._alerta_ve(v_yo, a.zona_id, a.estacion_id) is not null);
    if coalesce(cardinality(v_ids), 0) = 0 then return 0; end if;
    insert into public.alertas_lecturas (alerta_id, perfil_id, leida_at, atendida_at, nota)
    select x, v_yo, now(), case when p_accion = 'atendida' then now() end, case when p_accion = 'atendida' then v_nota end
      from unnest(v_ids) x
    on conflict (alerta_id, perfil_id) do update
        set leida_at = coalesce(public.alertas_lecturas.leida_at, excluded.leida_at),
            atendida_at = coalesce(excluded.atendida_at, public.alertas_lecturas.atendida_at),
            nota = coalesce(excluded.nota, public.alertas_lecturas.nota);
    if p_accion = 'atendida' then
        update public.alertas
           set estado = 'atendida', atendida_at = now(), atendida_por = v_yo, atendida_nota = v_nota
         where id = any (v_ids) and estado = 'abierta';
    end if;
    return cardinality(v_ids);
end $$;
revoke execute on function public.fn_alertas_marcar(uuid[], text, text) from public, anon;
grant  execute on function public.fn_alertas_marcar(uuid[], text, text) to authenticated;


-- ---------------------------------------------------------------- 8 · control (alcance global)
create or replace function public.fn_alertas_control()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
    perform public._alerta_exigir(true);
    select jsonb_build_object(
        'envios', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.creada_at desc)
              from (select a.id, a.titulo, a.tipo, a.gravedad, a.creada_at, a.notificada_at, a.estado,
                           (select coalesce(jsonb_agg(jsonb_build_object('perfil', pf.nombre, 'resultado', en.resultado,
                                                                         'detalle', en.detalle, 'at', en.enviado_at) order by en.enviado_at desc), '[]'::jsonb)
                              from public.alertas_envios en left join public.perfiles pf on pf.id = en.perfil_id
                             where en.alerta_id = a.id) as destinatarios
                      from public.alertas a order by a.creada_at desc limit 50) t), '[]'::jsonb),
        'suscripciones', coalesce((
            select jsonb_agg(jsonb_build_object('perfil_id', pf.id, 'perfil', pf.nombre,
                       'dispositivos', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'agente', s.user_agent,
                                                  'ultima_ok_at', s.ultima_ok_at, 'creada_at', s.creada_at) order by s.creada_at), '[]'::jsonb)
                                          from public.push_suscripciones s where s.perfil_id = pf.id and s.activa)) order by pf.nombre)
              from public.perfiles pf
             where public._alerta_alcance(pf.id) is not null and pf.activo), '[]'::jsonb),
        'silencios', coalesce((
            select jsonb_agg(jsonb_build_object('id', s.id, 'tipo', s.tipo, 'estacion_id', s.estacion_id,
                       'estacion', e.nombre, 'hasta', s.hasta, 'nota', s.nota) order by s.hasta)
              from public.alertas_silencios s left join public.estaciones_riego e on e.id = s.estacion_id
             where s.hasta > now()), '[]'::jsonb),
        'preferencias_apagadas', coalesce((
            select jsonb_agg(jsonb_build_object('perfil', pf.nombre, 'tipo', pr.tipo) order by pf.nombre, pr.tipo)
              from public.push_preferencias pr join public.perfiles pf on pf.id = pr.perfil_id where not pr.activo), '[]'::jsonb)
    ) into v;
    return v;
end $$;
revoke execute on function public.fn_alertas_control() from public, anon;
grant  execute on function public.fn_alertas_control() to authenticated;

create or replace function public.fn_alerta_reenviar(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
    perform public._alerta_exigir(true);
    update public.alertas set notificada_at = null, despacho_inicio = null, reenviar = true
     where id = p_id and estado = 'abierta';
    get diagnostics n = row_count;
    if n > 0 then perform public._alerta_disparar(); end if;
    return n > 0;
end $$;
revoke execute on function public.fn_alerta_reenviar(uuid) from public, anon;
grant  execute on function public.fn_alerta_reenviar(uuid) to authenticated;

create or replace function public.fn_alerta_silenciar(p_tipo text, p_estacion uuid, p_horas integer, p_nota text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
    perform public._alerta_exigir(true);
    if nullif(btrim(coalesce(p_tipo, '')), '') is null and p_estacion is null then
        raise exception 'Elige un tipo o una estación para silenciar.' using errcode = '22023';
    end if;
    if p_horas is null or p_horas < 1 or p_horas > 24 * 30 then
        raise exception 'El silencio dura entre 1 hora y 30 días.' using errcode = '22023';
    end if;
    insert into public.alertas_silencios (tipo, estacion_id, hasta, nota, creado_por)
    values (nullif(btrim(coalesce(p_tipo, '')), ''), p_estacion, now() + make_interval(hours => p_horas),
            left(nullif(btrim(coalesce(p_nota, '')), ''), 200), (select auth.uid()))
    returning id into v_id;
    return v_id;
end $$;
revoke execute on function public.fn_alerta_silenciar(text, uuid, integer, text) from public, anon;
grant  execute on function public.fn_alerta_silenciar(text, uuid, integer, text) to authenticated;

create or replace function public.fn_alerta_quitar_silencio(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
    perform public._alerta_exigir(true);
    delete from public.alertas_silencios where id = p_id;
    get diagnostics n = row_count;
    return n > 0;
end $$;
revoke execute on function public.fn_alerta_quitar_silencio(uuid) from public, anon;
grant  execute on function public.fn_alerta_quitar_silencio(uuid) to authenticated;


-- ---------------------------------------------------------------- 9 · despacho (solo service_role, desde /api/push/despachar)
/**
 * Reserva alertas por avisar y devuelve a quién enviar. Registra lo que NO se envía (sin dispositivo, preferencia apagada,
 * silencio). Una alerta no va dos veces a la misma persona en 24 h (salvo «reenviar»).
 * -> [{alerta:{id,clave,tipo,gravedad,titulo,cuerpo,url}, envios:[{perfil_id, suscripcion_id, endpoint, p256dh, auth}]}]
 */
create or replace function public.fn_alertas_plan_despacho(p_limite integer default 20, p_alerta uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    a       record;
    d       record;
    s       record;
    v_sal   jsonb := '[]'::jsonb;
    v_env   jsonb;
    v_forz  boolean;
    v_n     integer;
begin
    for a in
        with c as (
            select x.id from public.alertas x
             where x.estado = 'abierta'
               and (x.valida_hasta is null or x.valida_hasta > now())
               and ((p_alerta is null and x.notificada_at is null and (x.despacho_inicio is null or x.despacho_inicio < now() - interval '5 minutes'))
                    or x.id = p_alerta)
             order by x.creada_at
             limit least(greatest(coalesce(p_limite, 20), 1), 50)
             for update skip locked)
        update public.alertas u set despacho_inicio = now() from c where u.id = c.id returning u.*
    loop
        v_forz := a.reenviar;
        if exists (select 1 from public.alertas_silencios si
                    where si.hasta > now() and (si.tipo is null or si.tipo = a.tipo)
                      and (si.estacion_id is null or si.estacion_id = a.estacion_id)) and not v_forz then
            insert into public.alertas_envios (alerta_id, resultado, detalle) values (a.id, 'silenciada', 'Tipo o estación silenciados.');
            update public.alertas set notificada_at = now(), despacho_inicio = null where id = a.id;
            continue;
        end if;
        v_env := '[]'::jsonb;
        for d in select pf.id as perfil_id from public.perfiles pf
                  where pf.activo and public._alerta_ve(pf.id, a.zona_id, a.estacion_id) is not null loop
            if exists (select 1 from public.push_preferencias pr where pr.perfil_id = d.perfil_id and pr.tipo = a.tipo and not pr.activo) then
                insert into public.alertas_envios (alerta_id, perfil_id, resultado, detalle) values (a.id, d.perfil_id, 'omitido_pref', 'Apagó este tipo.');
                continue;
            end if;
            if not v_forz and exists (select 1 from public.alertas_envios en
                                       where en.alerta_id = a.id and en.perfil_id = d.perfil_id and en.resultado = 'enviado'
                                         and en.enviado_at > now() - interval '24 hours') then
                continue;
            end if;
            v_n := 0;
            for s in select su.id, su.endpoint, su.p256dh, su.auth from public.push_suscripciones su
                      where su.perfil_id = d.perfil_id and su.activa loop
                v_env := v_env || jsonb_build_object('perfil_id', d.perfil_id, 'suscripcion_id', s.id,
                                                     'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth);
                v_n := v_n + 1;
            end loop;
            if v_n = 0 then
                insert into public.alertas_envios (alerta_id, perfil_id, resultado, detalle) values (a.id, d.perfil_id, 'sin_dispositivo', 'No activó los avisos en ningún teléfono.');
            end if;
        end loop;
        if jsonb_array_length(v_env) = 0 then
            update public.alertas set notificada_at = now(), despacho_inicio = null, reenviar = false where id = a.id;
        else
            v_sal := v_sal || jsonb_build_object(
                'alerta', jsonb_build_object('id', a.id, 'clave', a.clave, 'tipo', a.tipo, 'gravedad', a.gravedad,
                                             'titulo', a.titulo, 'cuerpo', a.cuerpo, 'url', a.url),
                'envios', v_env);
        end if;
    end loop;
    return v_sal;
end $$;
revoke execute on function public.fn_alertas_plan_despacho(integer, uuid) from public, anon, authenticated;

create or replace function public.fn_alerta_registrar_envio(p_alerta uuid, p_perfil uuid, p_susc uuid, p_resultado text, p_detalle text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if p_resultado not in ('enviado', 'fallo') then raise exception 'Resultado no válido.' using errcode = '22023'; end if;
    insert into public.alertas_envios (alerta_id, perfil_id, suscripcion_id, resultado, detalle)
    values (p_alerta, p_perfil, p_susc, p_resultado, left(p_detalle, 300));
    if p_susc is not null then
        if p_resultado = 'enviado' then
            update public.push_suscripciones set ultima_ok_at = now() where id = p_susc;
        elsif p_detalle like '404%' or p_detalle like '410%' then
            update public.push_suscripciones set activa = false where id = p_susc;
        end if;
    end if;
end $$;
revoke execute on function public.fn_alerta_registrar_envio(uuid, uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.fn_alerta_cerrar_despacho(p_alerta uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
    update public.alertas set notificada_at = now(), despacho_inicio = null, reenviar = false where id = p_alerta;
end $$;
revoke execute on function public.fn_alerta_cerrar_despacho(uuid) from public, anon, authenticated;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        grant execute on function public.fn_alertas_plan_despacho(integer, uuid) to service_role;
        grant execute on function public.fn_alerta_registrar_envio(uuid, uuid, uuid, text, text) to service_role;
        grant execute on function public.fn_alerta_cerrar_despacho(uuid) to service_role;
    end if;
end $$;


-- ---------------------------------------------------------------- 10 · alcance de la persona (para mostrar la pestaña «Control»)
create or replace function public.fn_alertas_mi_alcance()
returns text language sql stable security definer set search_path = public, pg_temp as $$
    select public._alerta_alcance((select auth.uid()))
$$;
revoke execute on function public.fn_alertas_mi_alcance() from public, anon;
grant  execute on function public.fn_alertas_mi_alcance() to authenticated;
