-- =====================================================================
-- 130 · CAMPO · MOTORES DE RIEGO Y COMBUSTIBLE
-- =====================================================================
-- Bloque 3 de «Campo» (plan docs/superpowers/plans/2026-11-22-campo-bloque3-motores-y-combustible.md, Task 1;
-- spec docs/superpowers/specs/2026-11-22-campo-inyeccion-motores-design.md §6.4 y §10).
--
--   (a) Tablas mot_*: catálogo (modelos y motores, lo publica AGL), tanques (UNO POR MOTOR, §10), libro inalterable
--       de tanques mot_movimientos + saldo vivo mot_saldos (NO se toca fert_saldos ni fert_movimientos: su llave es
--       estación × material y «Terminar ciclo» de la 102 / «Eliminar» de la 119 dependen de ella), asignaciones con
--       historial, registro diario (la hoja FTR_F-MA-103), recepciones de diésel y mantenimientos.
--   (b) Operaciones del despachador (cola sin señal, UUID, custodia): motor_asignar, motor_retiro,
--       motor_registro_diario, motor_mantenimiento, diesel_recibir y su anulación (documento_tipo motor_registro,
--       diesel_recepcion, motor_mantenimiento, motor_asignacion).
--   (c) AGL: fn_mot_publicar y la bajada con huella sha256 (fn_mot_exportar / confirmar / purgar / retención).
--   (d) Teléfono: fn_mot_estado_campo y fn_mot_ultimo.
--   (e) Pantalla de permisos «motores» (módulo Campo, ruta /motores, fuera del menú): ver, registrar, anular,
--       configurar. «ver» y «registrar» a todo rol con fertirriego · aplicar; «anular» a quien ya tiene
--       fertirriego · anular; «configurar» a NADIE (solo el administrador).
--
-- Decisiones (orquestador, 2026-11-22): un solo registro por motor y día; el visor realinea el saldo del tanque con un
-- movimiento visible AJUSTE_VISOR (o SALDO_INICIAL el primer día) sin aprobación de jefe; el mantenimiento lo registra
-- quien tiene «configurar»; las alertas son de AGL; el intervalo de mantenimiento se guarda por modelo y es editable
-- (motor > modelo > categorias_equipo.ciclo_horas; sin dato el motor aparece «sin intervalo»).
--
-- Correr DESPUÉS de la 128 y la 129 (y de 102/116/119: parchan la misma función). Idempotente. Todo UPDATE/DELETE lleva
-- WHERE. Si se vuelve a correr la 99, 100, 101, 102, 116, 119, 128 o 129 (redefinen o parchan _fert_procesar), correr la
-- 130 otra vez. La marca de cada parche es propia (130) y no aparece en los parches de otras migraciones.
-- «Terminar ciclo» (102) ignora estas tablas (no son de un turno); «Eliminar por completo» (119) NO se amplía.
-- Horas para mantenimiento: se guardan como contador vivo en mot_motores (no depende de que sigan las filas viejas:
-- la bajada a AGL purga registros pasados).
-- =====================================================================


-- ---------------------------------------------------------------- (a) tablas
create table if not exists public.mot_tanques (
    id              uuid primary key default gen_random_uuid(),
    estacion_id     uuid references public.estaciones_riego(id) on delete cascade,   -- null = viaja con el motor
    motor_equipo_id uuid references public.equipos(id),
    nombre          text not null,
    capacidad_gal   numeric check (capacidad_gal is null or capacidad_gal > 0),
    material_id     uuid references public.materiales(id),                          -- el diésel
    activo          boolean not null default true,
    creado_en       timestamptz not null default now()
);
create unique index if not exists mot_tanques_un_motor on public.mot_tanques (motor_equipo_id) where activo and motor_equipo_id is not null;
create index if not exists idx_mot_tanques_estacion on public.mot_tanques (estacion_id) where activo;

create table if not exists public.mot_motores (
    equipo_id          uuid primary key references public.equipos(id),
    modelo             text,                    -- informativo (viene de la flota de AGL); el intervalo lo resuelve AGL por modelo y llega ya en cada motor
    intervalo_horas    integer check (intervalo_horas is null or intervalo_horas > 0),
    aviso_horas        integer check (aviso_horas is null or aviso_horas >= 0),
    capacidad_tanque_gal numeric,
    estado             text not null default 'SIN_ASIGNAR' check (estado in ('SIN_ASIGNAR', 'EN_ESTACION', 'TALLER', 'RETIRADO')),
    estacion_id        uuid references public.estaciones_riego(id) on delete set null,
    tanque_id          uuid references public.mot_tanques(id) on delete set null,
    horo_ultimo        numeric,
    visor_ultimo       numeric,
    fecha_ultimo       date,
    horas_desde_mant   numeric not null default 0,
    ultimo_mant_at     timestamptz,
    mant_ref_fecha     date,                    -- desde qué día cuentan las horas (null = todas)
    mant_ref_incl      boolean not null default true,  -- true: cuenta el propio día de referencia (instalación); false: desde el día siguiente (mantenimiento)
    activo             boolean not null default true,
    publicado_at       timestamptz
);
create unique index if not exists mot_motores_un_tanque on public.mot_motores (tanque_id) where estado = 'EN_ESTACION' and tanque_id is not null;
create index if not exists idx_mot_motores_estacion on public.mot_motores (estacion_id) where estacion_id is not null;

create table if not exists public.mot_movimientos (
    id            bigint generated always as identity primary key,
    operacion_id  uuid not null references public.fert_operaciones(id) on delete cascade,
    tanque_id     uuid not null references public.mot_tanques(id) on delete cascade,
    material_id   uuid not null references public.materiales(id),
    tipo          text not null check (tipo in ('SALDO_INICIAL', 'RECEPCION_DIESEL', 'CONSUMO_MOTOR', 'AJUSTE_VISOR', 'DEVOLUCION_TANQUE', 'ANULACION')),
    cantidad      numeric(14,4) not null,
    fecha_hora    timestamptz not null,
    documento_tipo text,
    documento_id  uuid,
    anula_id      bigint,
    registrado_por uuid,
    creado_en     timestamptz not null default now()
);
create index if not exists idx_mot_mov_tanque on public.mot_movimientos (tanque_id, fecha_hora);
create index if not exists idx_mot_mov_doc on public.mot_movimientos (documento_id);

create table if not exists public.mot_saldos (
    tanque_id   uuid primary key references public.mot_tanques(id) on delete cascade,
    material_id uuid references public.materiales(id),
    disponible  numeric(14,4) not null default 0,
    updated_at  timestamptz
);

-- el libro no se edita ni se borra (la base de pruebas y el administrador sí; igual que fert_movimientos)
create or replace function public._mot_libro_inalterable()
returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
    v_est uuid;
    v_existe boolean;
begin
    if coalesce(current_setting('mot.libro_permitir', true), '') = 'on'
       or current_user in ('service_role', 'postgres', 'supabase_admin') then
        return case when tg_op = 'DELETE' then old else new end;
    end if;
    select t.estacion_id, true into v_est, v_existe from public.mot_tanques t where t.id = old.tanque_id;
    -- tanque ya borrado (cascada de «Borrar modo de pruebas» o de la estación) o estación de prueba
    if not coalesce(v_existe, false) or (v_est is not null and public._fert_es_prueba(v_est)) then
        return case when tg_op = 'DELETE' then old else new end;
    end if;
    raise exception 'El libro de combustible no se edita ni se borra: un error se corrige anulando.';
end;
$$;
revoke execute on function public._mot_libro_inalterable() from public, anon, authenticated;

drop trigger if exists mot_movimientos_inalterable on public.mot_movimientos;
create trigger mot_movimientos_inalterable before update or delete on public.mot_movimientos
for each row execute function public._mot_libro_inalterable();

create table if not exists public.mot_asignaciones (
    id               uuid primary key references public.fert_operaciones(id) on delete cascade,
    equipo_id        uuid not null references public.equipos(id),
    tipo             text not null check (tipo in ('INSTALADO', 'TRASLADADO', 'RETIRADO', 'AL_TALLER', 'DE_VUELTA')),
    estacion_origen  uuid references public.estaciones_riego(id) on delete set null,
    estacion_destino uuid references public.estaciones_riego(id) on delete set null,
    tanque_id        uuid references public.mot_tanques(id) on delete set null,
    fecha_hora       timestamptz not null,
    motivo           text not null,
    motivo_codigo    text check (motivo_codigo in ('FIN_TEMPORADA', 'DANO_REEMPLAZO', 'CAMBIO_ESTACION', 'MANTENIMIENTO', 'OTRO')),
    destino_saldo    text check (destino_saldo in ('CON_EL_MOTOR', 'DEVUELTO', 'QUEDA_EN_TANQUE')),
    destino_devolucion text check (destino_devolucion in ('SUMINISTROS', 'BODEGA', 'TALLER')),
    saldo_gal        numeric,
    horas_base       numeric,
    antes            jsonb,                     -- cómo estaba todo antes (para anular la asignación)
    registrado_por   uuid,
    creado_en        timestamptz not null default clock_timestamp(),
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text,
    bajado_a_agl_en  timestamptz,
    huella           text
);
create index if not exists idx_mot_asig_equipo on public.mot_asignaciones (equipo_id, fecha_hora desc);

create table if not exists public.mot_registros (
    id               uuid primary key references public.fert_operaciones(id) on delete cascade,
    equipo_id        uuid not null references public.equipos(id),
    estacion_id      uuid not null references public.estaciones_riego(id) on delete cascade,
    tanque_id        uuid not null references public.mot_tanques(id) on delete cascade,
    fecha            date not null,
    horo_ini         numeric(12,2) not null,
    horo_fin         numeric(12,2) not null,
    horas            numeric(10,2) not null check (horas >= 0),
    visor_ini        numeric(12,2) not null,
    visor_fin        numeric(12,2) not null,
    recibido_gal     numeric(12,2) not null default 0,
    gastado_gal      numeric(12,2) not null check (gastado_gal >= 0),
    rendimiento_gal_h numeric(10,2),
    rpm              integer check (rpm between 0 and 6000),
    horo_cambiado    boolean not null default false,
    visor_cambiado   boolean not null default false,
    comentario       text,
    registrado_por   uuid,
    fecha_hora       timestamptz not null,
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text,
    bajado_a_agl_en  timestamptz,
    huella           text
);
create unique index if not exists mot_registros_un_dia on public.mot_registros (equipo_id, fecha) where anulado_at is null;
create index if not exists idx_mot_reg_estacion on public.mot_registros (estacion_id, fecha desc);

create table if not exists public.mot_recepciones (
    id               uuid primary key references public.fert_operaciones(id) on delete cascade,
    tanque_id        uuid not null references public.mot_tanques(id) on delete cascade,
    estacion_id      uuid not null references public.estaciones_riego(id) on delete cascade,
    galones          numeric(12,2) not null check (galones > 0),
    chofer_id        uuid references public.fert_choferes(id),
    vehiculo_id      uuid references public.fert_vehiculos(id),
    fecha_hora       timestamptz not null,
    comentario       text,
    registrado_por   uuid,
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text,
    bajado_a_agl_en  timestamptz,
    huella           text
);
create index if not exists idx_mot_rec_tanque on public.mot_recepciones (tanque_id, fecha_hora desc);

create table if not exists public.mot_mantenimientos (
    id               uuid primary key references public.fert_operaciones(id) on delete cascade,
    equipo_id        uuid not null references public.equipos(id),
    estacion_id      uuid references public.estaciones_riego(id) on delete set null,
    fecha_hora       timestamptz not null,
    horometro        numeric(12,2),
    tipo             text not null check (tipo in ('PREVENTIVO', 'CORRECTIVO')),
    nota             text,
    horas_antes      numeric,
    registrado_por   uuid,
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text,
    bajado_a_agl_en  timestamptz,
    huella           text
);
create index if not exists idx_mot_mant_equipo on public.mot_mantenimientos (equipo_id, fecha_hora desc);

create table if not exists public.mot_bajada_config (
    id                boolean primary key default true check (id),
    retencion_dias    integer not null default 30 check (retencion_dias between 0 and 365),
    material_diesel_id uuid references public.materiales(id)
);
alter table public.mot_bajada_config add column if not exists material_diesel_id uuid references public.materiales(id);
insert into public.mot_bajada_config (id) values (true) on conflict (id) do nothing;
alter table public.mot_bajada_config enable row level security;   -- sin políticas: solo las funciones

-- permisos de lectura: solo las funciones escriben
do $$
declare
    t text;
begin
    foreach t in array array['mot_motores', 'mot_tanques', 'mot_movimientos', 'mot_saldos',
                             'mot_asignaciones', 'mot_registros', 'mot_recepciones', 'mot_mantenimientos'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('grant select on public.%I to authenticated', t);
        execute format('drop policy if exists fert_leer on public.%I', t);
    end loop;
end $$;

create policy fert_leer on public.mot_motores for select to authenticated
    using ((public.fn_es_admin() or public.fn_tiene_permiso('motores', 'ver'))
           and (estacion_id is null or public.fn_fert_puede(estacion_id, 'ver')));
create policy fert_leer on public.mot_tanques for select to authenticated
    using ((public.fn_es_admin() or public.fn_tiene_permiso('motores', 'ver'))
           and (estacion_id is null or public.fn_fert_puede(estacion_id, 'ver')));
create policy fert_leer on public.mot_movimientos for select to authenticated
    using (exists (select 1 from public.mot_tanques t where t.id = tanque_id
                   and (public.fn_es_admin() or public.fn_tiene_permiso('motores', 'ver'))
                   and (t.estacion_id is null or public.fn_fert_puede(t.estacion_id, 'ver'))));
create policy fert_leer on public.mot_saldos for select to authenticated
    using (exists (select 1 from public.mot_tanques t where t.id = tanque_id
                   and (public.fn_es_admin() or public.fn_tiene_permiso('motores', 'ver'))
                   and (t.estacion_id is null or public.fn_fert_puede(t.estacion_id, 'ver'))));
create policy fert_leer on public.mot_asignaciones for select to authenticated
    using ((public.fn_es_admin() or public.fn_tiene_permiso('motores', 'ver'))
           and (coalesce(estacion_destino, estacion_origen) is null or public.fn_fert_puede(coalesce(estacion_destino, estacion_origen), 'ver')));
create policy fert_leer on public.mot_registros for select to authenticated
    using ((public.fn_es_admin() or public.fn_tiene_permiso('motores', 'ver')) and public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.mot_recepciones for select to authenticated
    using ((public.fn_es_admin() or public.fn_tiene_permiso('motores', 'ver')) and public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.mot_mantenimientos for select to authenticated
    using ((public.fn_es_admin() or public.fn_tiene_permiso('motores', 'ver'))
           and (estacion_id is null or public.fn_fert_puede(estacion_id, 'ver')));


-- ---------------------------------------------------------------- (e) pantalla y permisos (antes que las funciones que los usan)
insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('registrar', 'Registrar', 'Campo: registra aplicaciones y lecturas (por ejemplo, Inyección por lote o el registro diario de un motor).', 122, true)
on conflict (codigo) do nothing;

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones, en_menu, icono, modulo) values
    ('motores', 'Motores y combustible · Campo',
     'Horas, diésel y mantenimiento de los motores de riego: registro diario desde la estación a cargo, recibir diésel en el tanque '
     'del motor y avisos de mantenimiento. Se llega desde Campo (no está en el menú). «Configurar» (mover motores, mantenimiento) '
     'es solo del administrador.',
     '/motores', 123, array['ver', 'registrar', 'anular', 'configurar'], false, 'tractor', 'Campo')
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, ruta = excluded.ruta,
    orden = excluded.orden, acciones = excluded.acciones;

update public.pantallas
   set modulo = coalesce(modulo, 'Campo'),
       etiquetas_alcance = coalesce(etiquetas_alcance,
           '{"global": "Todas las estaciones", "zonal": "Estaciones de sus zonas", "propietario": "Sus estaciones"}'::jsonb)
 where codigo = 'motores';

insert into public.permisos (rol_id, recurso, accion, permitido, alcance)
select distinct pm.rol_id, 'motores', a.accion, true, pm.alcance
  from public.permisos pm
 cross join (values ('ver'), ('registrar')) a(accion)
 where pm.recurso = 'fertirriego' and pm.accion = 'aplicar' and pm.permitido
on conflict (rol_id, recurso, accion) do nothing;

insert into public.permisos (rol_id, recurso, accion, permitido, alcance)
select distinct pm.rol_id, 'motores', 'anular', true, pm.alcance
  from public.permisos pm
 where pm.recurso = 'fertirriego' and pm.accion = 'anular' and pm.permitido
on conflict (rol_id, recurso, accion) do nothing;


-- ---------------------------------------------------------------- (b) ayudas internas
create or replace function public._mot_exigir_permiso(p_accion text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('motores', p_accion)) then
        raise exception 'Tu rol no tiene «%» en Motores y combustible. Se configura en Permisos.', p_accion using errcode = '42501';
    end if;
end $$;
revoke execute on function public._mot_exigir_permiso(text) from public, anon, authenticated;

create or replace function public._mot_exigir_agl(p_accion text)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', p_accion)) then
        raise exception 'Tu rol no tiene permiso para %: se necesita Conexión AGL · %.',
            case when p_accion = 'ver' then 'leer lo registrado en Motores y combustible' else 'publicar o confirmar lo de Motores y combustible' end,
            p_accion using errcode = '42501';
    end if;
end $$;
revoke execute on function public._mot_exigir_agl(text) from public, anon, authenticated;

create or replace function public._mot_huella(p_fila jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
    select encode(sha256(convert_to(p_fila::text, 'UTF8')), 'hex')
$$;
revoke execute on function public._mot_huella(jsonb) from public, anon, authenticated;

/** Texto a número sin romper (null si no es número; acepta coma decimal). */
create or replace function public._mot_num(p text)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
begin
    return nullif(replace(btrim(coalesce(p, '')), ',', '.'), '')::numeric;
exception when others then
    return null;
end $$;
revoke execute on function public._mot_num(text) from public, anon, authenticated;

create or replace function public._mot_dia(p_momento timestamptz)
returns date language sql immutable set search_path = public, pg_temp as $$
    select (p_momento at time zone 'America/Tegucigalpa')::date
$$;
revoke execute on function public._mot_dia(timestamptz) from public, anon, authenticated;

/** Permiso del módulo + estación + custodia (la misma de Fertirriego: «aplicar»). */
create or replace function public._mot_autorizar(
    p_estacion uuid, p_accion text, p_momento timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._mot_exigir_permiso(p_accion);
    return public._fert_autorizar(p_estacion, 'aplicar', p_momento, p_inmediato, p_en_nombre);
end $$;
revoke execute on function public._mot_autorizar(uuid, text, timestamptz, boolean, uuid) from public, anon, authenticated;

/** «Configurar» (o administrador) + poder ver la estación; sin custodia. p_estacion null = motor sin estación. */
create or replace function public._mot_autorizar_config(p_estacion uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._mot_exigir_permiso('configurar');
    if p_estacion is not null then
        if not exists (select 1 from public.estaciones_riego where id = p_estacion) then
            raise exception 'La estación no existe. Actualiza la aplicación.';
        end if;
        if not public.fn_fert_puede(p_estacion, 'ver') then
            raise exception 'No tienes acceso a esa estación.' using errcode = '42501';
        end if;
    end if;
end $$;
revoke execute on function public._mot_autorizar_config(uuid) from public, anon, authenticated;

/** Asienta un movimiento del tanque y actualiza su saldo vivo. No rechaza saldo negativo: el visor es la realidad. */
create or replace function public._mot_mover(
    p_operacion uuid, p_tanque uuid, p_material uuid, p_tipo text, p_cantidad numeric,
    p_fecha_hora timestamptz, p_doc_tipo text, p_doc_id uuid, p_anula bigint default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if p_cantidad = 0 then
        return;
    end if;
    insert into public.mot_movimientos
        (operacion_id, tanque_id, material_id, tipo, cantidad, fecha_hora, documento_tipo, documento_id, anula_id, registrado_por)
    values
        (p_operacion, p_tanque, p_material, p_tipo, p_cantidad, p_fecha_hora, p_doc_tipo, p_doc_id, p_anula, (select auth.uid()));
    insert into public.mot_saldos as s (tanque_id, material_id, disponible, updated_at)
    values (p_tanque, p_material, p_cantidad, now())
    on conflict (tanque_id)
    do update set disponible = s.disponible + excluded.disponible, updated_at = now();
end $$;
revoke execute on function public._mot_mover(uuid, uuid, uuid, text, numeric, timestamptz, text, uuid, bigint) from public, anon, authenticated;

create or replace function public._mot_saldo_actual(p_tanque uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select s.disponible from public.mot_saldos s where s.tanque_id = p_tanque), 0)
$$;
revoke execute on function public._mot_saldo_actual(uuid) from public, anon, authenticated;

create or replace function public._mot_saldo_en(p_tanque uuid, p_momento timestamptz)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(sum(m.cantidad), 0) from public.mot_movimientos m where m.tanque_id = p_tanque and m.fecha_hora <= p_momento
$$;
revoke execute on function public._mot_saldo_en(uuid, timestamptz) from public, anon, authenticated;

/** Dónde estaba el motor EN ESE MOMENTO (por el historial de asignación): tipo del último movimiento, estación y tanque. */
create or replace function public._mot_estado_en(p_equipo uuid, p_momento timestamptz)
returns table (tipo text, estacion_id uuid, tanque_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
    select a.tipo,
           case when a.tipo in ('INSTALADO', 'TRASLADADO', 'DE_VUELTA') then a.estacion_destino end,
           case when a.tipo in ('INSTALADO', 'TRASLADADO', 'DE_VUELTA') then a.tanque_id end
      from public.mot_asignaciones a
     where a.equipo_id = p_equipo and a.anulado_at is null and a.fecha_hora <= p_momento
     order by a.fecha_hora desc, a.creado_en desc
     limit 1
$$;
revoke execute on function public._mot_estado_en(uuid, timestamptz) from public, anon, authenticated;

/** Estación del motor en ese momento (null si no estaba instalado). */
create or replace function public._mot_estacion_en(p_equipo uuid, p_momento timestamptz)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
    select e.estacion_id from public._mot_estado_en(p_equipo, p_momento) e
$$;
revoke execute on function public._mot_estacion_en(uuid, timestamptz) from public, anon, authenticated;

/** Última lectura final con fecha ANTERIOR a p_fecha (la propia tabla; si ya se purgó, lo guardado en el motor). */
create or replace function public._mot_lectura_anterior(p_equipo uuid, p_fecha date)
returns table (fecha date, horo_fin numeric, visor_fin numeric)
language sql stable security definer set search_path = public, pg_temp as $$
    select x.fecha, x.horo_fin, x.visor_fin from (
        select r.fecha, r.horo_fin, r.visor_fin, 1 as o
          from public.mot_registros r
         where r.equipo_id = p_equipo and r.anulado_at is null and r.fecha < p_fecha
         order by r.fecha desc limit 1
    ) x
    union all
    select m.fecha_ultimo, m.horo_ultimo, m.visor_ultimo
      from public.mot_motores m
     where m.equipo_id = p_equipo and m.fecha_ultimo is not null and m.fecha_ultimo < p_fecha
       and not exists (select 1 from public.mot_registros r where r.equipo_id = p_equipo and r.anulado_at is null and r.fecha < p_fecha)
$$;
revoke execute on function public._mot_lectura_anterior(uuid, date) from public, anon, authenticated;

/** Intervalo de mantenimiento: el del motor (AGL lo resuelve por modelo), si no el de la categoría del equipo. null = sin dato. */
create or replace function public._mot_intervalo(p_equipo uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(m.intervalo_horas, c.ciclo_horas)
      from public.mot_motores m
      join public.equipos e on e.id = m.equipo_id
      left join public.categorias_equipo c on c.id = e.categoria_id
     where m.equipo_id = p_equipo
$$;
revoke execute on function public._mot_intervalo(uuid) from public, anon, authenticated;

/**
 * Recalcula las horas desde el último mantenimiento DESDE LAS TABLAS: base declarada al instalar (si es más reciente que el
 * último mantenimiento) + horas de los registros posteriores. Lo usan mantenimiento y las anulaciones (no la captura diaria,
 * que suma de forma incremental y no depende de filas viejas ya purgadas).
 */
create or replace function public._mot_recalcular_horas(p_equipo uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    m  public.mot_mantenimientos%rowtype;
    a  public.mot_asignaciones%rowtype;
    v_base numeric := 0;
    v_ref  date;
    v_incl boolean := true;
    v_horas numeric;
begin
    select * into m from public.mot_mantenimientos where equipo_id = p_equipo and anulado_at is null order by fecha_hora desc limit 1;
    select * into a from public.mot_asignaciones where equipo_id = p_equipo and anulado_at is null and horas_base is not null
     order by fecha_hora desc, creado_en desc limit 1;
    if m.id is not null and (a.id is null or m.fecha_hora >= a.fecha_hora) then
        v_base := 0; v_ref := public._mot_dia(m.fecha_hora); v_incl := false;
    elsif a.id is not null then
        v_base := a.horas_base; v_ref := public._mot_dia(a.fecha_hora); v_incl := true;
    end if;
    select coalesce(sum(r.horas), 0) into v_horas
      from public.mot_registros r
     where r.equipo_id = p_equipo and r.anulado_at is null
       and (v_ref is null or (case when v_incl then r.fecha >= v_ref else r.fecha > v_ref end));
    update public.mot_motores
       set horas_desde_mant = v_base + v_horas, mant_ref_fecha = v_ref, mant_ref_incl = v_incl,
           ultimo_mant_at = (select max(x.fecha_hora) from public.mot_mantenimientos x where x.equipo_id = p_equipo and x.anulado_at is null)
     where equipo_id = p_equipo;
end $$;
revoke execute on function public._mot_recalcular_horas(uuid) from public, anon, authenticated;

/** Últimos valores del motor desde sus registros no anulados (null si no queda ninguno). */
create or replace function public._mot_refrescar_ultimo(p_equipo uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r record;
begin
    select x.horo_fin, x.visor_fin, x.fecha into r
      from public.mot_registros x where x.equipo_id = p_equipo and x.anulado_at is null order by x.fecha desc limit 1;
    update public.mot_motores
       set horo_ultimo = r.horo_fin, visor_ultimo = r.visor_fin, fecha_ultimo = r.fecha
     where equipo_id = p_equipo;
end $$;
revoke execute on function public._mot_refrescar_ultimo(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------- (b) operación: recibir diésel
create or replace function public._mot_op_diesel_recibir(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t      public.mot_tanques%rowtype;
    v_gal  numeric := public._mot_num(d->>'galones');
    v_fecha timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_obs  text[];
    v_mat  uuid;
    v_chofer uuid := public._fert_uuid(d->>'chofer_id');
    v_vehiculo uuid := public._fert_uuid(d->>'vehiculo_id');
begin
    if v_chofer is not null and not exists (select 1 from public.fert_choferes where id = v_chofer) then
        raise exception 'El chofer no está en el catálogo. Actualiza la aplicación.';
    end if;
    if v_vehiculo is not null and not exists (select 1 from public.fert_vehiculos where id = v_vehiculo) then
        raise exception 'El vehículo no está en el catálogo. Actualiza la aplicación.';
    end if;
    select * into t from public.mot_tanques where id = public._fert_uuid(d->>'tanque_id') and activo;
    if not found then
        raise exception 'El tanque no existe o ya no está activo. Actualiza la aplicación.';
    end if;
    if t.estacion_id is null then
        raise exception 'El tanque no está en ninguna estación.';
    end if;
    if v_gal is null or v_gal <= 0 then
        raise exception 'Indica los galones recibidos.';
    end if;
    v_obs := public._mot_autorizar(t.estacion_id, 'registrar', p_creado, p_inmediato, p_en_nombre);
    v_mat := coalesce(t.material_id, (select c.material_diesel_id from public.mot_bajada_config c where c.id));
    if v_mat is null then
        raise exception 'AGL todavía no publica el producto diésel. Avisa a la Torre de Control.';
    end if;

    insert into public.mot_recepciones (id, tanque_id, estacion_id, galones, chofer_id, vehiculo_id, fecha_hora, comentario, registrado_por)
    values (p_id, t.id, t.estacion_id, v_gal, v_chofer, v_vehiculo, v_fecha,
            nullif(btrim(coalesce(d->>'comentario', '')), ''), (select auth.uid()));
    perform public._mot_mover(p_id, t.id, v_mat, 'RECEPCION_DIESEL', v_gal, v_fecha, 'diesel_recepcion', p_id);
    update public.fert_operaciones set estacion_id = t.estacion_id where id = p_id;
    return v_obs;
end $$;
revoke execute on function public._mot_op_diesel_recibir(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------- (b) operación: registro diario
create or replace function public._mot_op_registro_diario(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_eq     uuid := public._fert_uuid(d->>'equipo_id');
    mo       public.mot_motores%rowtype;
    v_fecha  date;
    v_hoy    date := public._mot_dia(now());
    v_momento timestamptz;
    est      record;
    v_est    uuid;
    v_tanque uuid;
    v_mat    uuid;
    v_fh     timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_hi     numeric := public._mot_num(d->>'horo_ini');
    v_hf     numeric := public._mot_num(d->>'horo_fin');
    v_vi     numeric := public._mot_num(d->>'visor_ini');
    v_vf     numeric := public._mot_num(d->>'visor_fin');
    v_rpm_t  text := nullif(btrim(coalesce(d->>'rpm', '')), '');
    v_rpm    integer;
    v_hc     boolean := coalesce((d->>'horo_cambiado')::boolean, false);
    v_vc     boolean := coalesce((d->>'visor_cambiado')::boolean, false);
    v_coment text := nullif(btrim(coalesce(d->>'comentario', '')), '');
    v_recib  numeric;
    v_gast   numeric;
    v_horas  numeric;
    v_rend   numeric;
    v_obs    text[];
    prev     record;
    v_primero boolean;
    v_reciente boolean;
    v_saldo  numeric;
    v_ajuste numeric;
    v_cuenta boolean;
begin
    select * into mo from public.mot_motores where equipo_id = v_eq for update;
    if not found then
        raise exception 'El motor no está en el catálogo de motores (AGL). Actualiza la aplicación.';
    end if;
    begin
        v_fecha := nullif(btrim(coalesce(d->>'fecha', '')), '')::date;
    exception when others then
        v_fecha := null;
    end;
    if v_fecha is null then
        raise exception 'Indica la fecha del registro.';
    end if;
    if v_fecha > v_hoy then
        raise exception 'La fecha no puede ser posterior a hoy.';
    end if;

    -- el motor puede haberse movido: la estación y el tanque son los de ESA fecha
    v_momento := ((v_fecha + 1)::timestamp at time zone 'America/Tegucigalpa') - interval '1 second';
    select * into est from public._mot_estado_en(v_eq, v_momento);
    if est.tipo is null then
        raise exception 'El motor no estaba instalado en ninguna estación el %.', to_char(v_fecha, 'DD/MM/YYYY');
    end if;
    if est.tipo = 'AL_TALLER' then
        raise exception 'El motor está en el taller: no se registra el día.';
    end if;
    if est.tipo = 'RETIRADO' then
        raise exception 'El motor estaba retirado de la estación el %.', to_char(v_fecha, 'DD/MM/YYYY');
    end if;
    v_est := est.estacion_id;
    v_tanque := est.tanque_id;

    v_obs := public._mot_autorizar(v_est, 'registrar', p_creado, p_inmediato, p_en_nombre);

    if exists (select 1 from public.mot_registros where equipo_id = v_eq and fecha = v_fecha and anulado_at is null) then
        raise exception 'Ya hay un registro de ese día; anúlalo si estaba mal.';
    end if;
    if v_hi is null or v_hf is null or v_vi is null or v_vf is null or v_hi < 0 or v_hf < 0 or v_vi < 0 or v_vf < 0 then
        raise exception 'Escribe números válidos en el horómetro y el visor.';
    end if;
    if (v_hc or v_vc) and v_coment is null then
        raise exception 'Explica el cambio del horómetro o del visor en las observaciones.';
    end if;
    if v_rpm_t is not null then
        v_rpm := case when v_rpm_t ~ '^\d{1,5}$' then v_rpm_t::integer else null end;
        if v_rpm is null or v_rpm > 6000 then
            raise exception 'Las revoluciones deben estar entre 0 y 6000.';
        end if;
    end if;
    if v_hf < v_hi and not v_hc then
        raise exception 'El horómetro final es menor que el inicial.';
    end if;

    v_mat := coalesce((select t.material_id from public.mot_tanques t where t.id = v_tanque),
                      (select c.material_diesel_id from public.mot_bajada_config c where c.id));
    if v_mat is null then
        raise exception 'AGL todavía no publica el producto diésel. Avisa a la Torre de Control.';
    end if;

    -- lo recibido ese día (hora de Honduras) en ESTE tanque
    select coalesce(sum(r.galones), 0) into v_recib
      from public.mot_recepciones r
     where r.tanque_id = v_tanque and r.anulado_at is null and public._mot_dia(r.fecha_hora) = v_fecha;
    v_gast := v_vi - v_vf + v_recib;
    if v_gast < 0 then
        if p_inmediato then
            raise exception 'El visor final (%) es mayor que el inicial (%) y no hay diésel recibido ese día: registra la recepción o corrige la lectura.',
                v_vf, v_vi;
        end if;
        v_gast := 0;
        v_obs := public._fert_obs(v_obs, array['VISOR_SUBE_SIN_RECEPCION']);
    end if;
    v_horas := greatest(v_hf - v_hi, 0);
    v_rend := case when v_horas > 0 then round(v_gast / v_horas, 2) end;

    select * into prev from public._mot_lectura_anterior(v_eq, v_fecha);
    if prev.fecha is null then
        v_obs := public._fert_obs(v_obs, array['SIN_REGISTRO_PREVIO']);
    else
        if not v_hc and abs(v_hi - prev.horo_fin) > 0.005 then
            v_obs := public._fert_obs(v_obs, array['HOROMETRO_NO_CONTINUA']);
        end if;
        if not v_vc and prev.visor_fin is not null and abs(v_vi - prev.visor_fin) > 0.005 then
            v_obs := public._fert_obs(v_obs, array['VISOR_NO_CONTINUA']);
        end if;
    end if;
    if v_horas = 0 and v_gast > 0 then
        v_obs := public._fert_obs(v_obs, array['CONSUMO_SIN_HORAS']);
    end if;

    insert into public.mot_registros
        (id, equipo_id, estacion_id, tanque_id, fecha, horo_ini, horo_fin, horas, visor_ini, visor_fin, recibido_gal, gastado_gal,
         rendimiento_gal_h, rpm, horo_cambiado, visor_cambiado, comentario, registrado_por, fecha_hora)
    values
        (p_id, v_eq, v_est, v_tanque, v_fecha, v_hi, v_hf, v_horas, v_vi, v_vf, v_recib, v_gast,
         v_rend, v_rpm, v_hc, v_vc, v_coment, (select auth.uid()), v_fh);

    -- libro del tanque: el visor final es la verdad (se realinea con un ajuste visible) y luego el consumo
    v_primero := not exists (select 1 from public.mot_movimientos m where m.tanque_id = v_tanque and m.tipo = 'SALDO_INICIAL');
    v_reciente := mo.fecha_ultimo is null or v_fecha > mo.fecha_ultimo;
    if not v_reciente then
        v_obs := public._fert_obs(v_obs, array['FUERA_DE_ORDEN']);
    else
        v_saldo := public._mot_saldo_actual(v_tanque);
        v_ajuste := v_vf + v_gast - v_saldo;
        if abs(v_ajuste) > 0.0001 then
            perform public._mot_mover(p_id, v_tanque, v_mat, case when v_primero then 'SALDO_INICIAL' else 'AJUSTE_VISOR' end,
                                      v_ajuste, v_fh, 'motor_registro', p_id);
        end if;
    end if;
    perform public._mot_mover(p_id, v_tanque, v_mat, 'CONSUMO_MOTOR', -v_gast, v_fh, 'motor_registro', p_id);

    -- proyección del motor: últimas lecturas (solo si es el más reciente) y horas hacia el mantenimiento (suma incremental)
    v_cuenta := mo.mant_ref_fecha is null or (case when mo.mant_ref_incl then v_fecha >= mo.mant_ref_fecha else v_fecha > mo.mant_ref_fecha end);
    update public.mot_motores
       set horo_ultimo = case when v_reciente then v_hf else horo_ultimo end,
           visor_ultimo = case when v_reciente then v_vf else visor_ultimo end,
           fecha_ultimo = case when v_reciente then v_fecha else fecha_ultimo end,
           horas_desde_mant = horas_desde_mant + case when v_cuenta then v_horas else 0 end
     where equipo_id = v_eq;
    update public.fert_operaciones set estacion_id = v_est where id = p_id;
    return v_obs;
end $$;
revoke execute on function public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------- (b) operación: mantenimiento
create or replace function public._mot_op_mantenimiento(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_eq    uuid := public._fert_uuid(d->>'equipo_id');
    mo      public.mot_motores%rowtype;
    v_fecha timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_tipo  text := upper(btrim(coalesce(d->>'tipo', '')));
    v_horo  numeric := public._mot_num(d->>'horometro');
begin
    select * into mo from public.mot_motores where equipo_id = v_eq for update;
    if not found then
        raise exception 'El motor no está en el catálogo de motores (AGL). Actualiza la aplicación.';
    end if;
    perform public._mot_autorizar_config(mo.estacion_id);
    if v_tipo not in ('PREVENTIVO', 'CORRECTIVO') then
        raise exception 'Indica si el mantenimiento fue preventivo o correctivo.';
    end if;
    if v_fecha > now() + interval '5 minutes' then
        raise exception 'El mantenimiento no puede ser en el futuro.';
    end if;
    if nullif(btrim(coalesce(d->>'horometro', '')), '') is not null and (v_horo is null or v_horo < 0) then
        raise exception 'El horómetro del mantenimiento no es válido.';
    end if;
    insert into public.mot_mantenimientos (id, equipo_id, estacion_id, fecha_hora, horometro, tipo, nota, horas_antes, registrado_por)
    values (p_id, v_eq, mo.estacion_id, v_fecha, v_horo, v_tipo, nullif(btrim(coalesce(d->>'nota', '')), ''), mo.horas_desde_mant, (select auth.uid()));
    perform public._mot_recalcular_horas(v_eq);
    update public.fert_operaciones set estacion_id = mo.estacion_id where id = p_id and mo.estacion_id is not null;
    return '{}';
end $$;
revoke execute on function public._mot_op_mantenimiento(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------- (b) operaciones: asignar, trasladar, retirar, taller
/**
 * Núcleo de los movimientos del motor. p_tipo: INSTALADO | TRASLADADO | RETIRADO | AL_TALLER | DE_VUELTA.
 *   Salida (TRASLADADO, RETIRADO, AL_TALLER): si el tanque tiene diésel, se exige destino_saldo
 *     CON_EL_MOTOR (el tanque viaja), DEVUELTO (movimiento DEVOLUCION_TANQUE a SUMINISTROS/BODEGA/TALLER y el tanque se
 *     inactiva) o QUEDA_EN_TANQUE (el tanque y su saldo quedan en la estación, sin motor). Daño y reemplazo fija QUEDA_EN_TANQUE.
 *   Entrada (INSTALADO, DE_VUELTA, destino de TRASLADADO): el tanque es el indicado (de la estación, sin motor), el que
 *     viaja con el motor, o uno nuevo (tanque_nuevo).
 */
create or replace function public._mot_aplicar_asignacion(p_id uuid, d jsonb, p_creado timestamptz, p_tipo text)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_eq     uuid := public._fert_uuid(d->>'equipo_id');
    mo       public.mot_motores%rowtype;
    v_fecha  timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_motivo text := nullif(btrim(coalesce(d->>'motivo', '')), '');
    v_codigo text := nullif(upper(btrim(coalesce(d->>'motivo_codigo', ''))), '');
    v_dest   uuid := public._fert_uuid(d->>'estacion_destino');
    v_salida boolean := p_tipo in ('TRASLADADO', 'RETIRADO', 'AL_TALLER');
    v_entrada boolean := p_tipo in ('INSTALADO', 'DE_VUELTA', 'TRASLADADO');
    t_orig   public.mot_tanques%rowtype;
    t_dest   public.mot_tanques%rowtype;
    v_saldo  numeric := 0;
    v_dsaldo text := nullif(upper(btrim(coalesce(d->>'destino_saldo', ''))), '');
    v_ddev   text := nullif(upper(btrim(coalesce(d->>'destino_devolucion', ''))), '');
    v_base   numeric := public._mot_num(d->>'horas_base');
    v_antes  jsonb;
    v_tanque uuid;
    v_origen uuid;
    v_nuevo  jsonb := d->'tanque_nuevo';
    v_mat    uuid;
    v_tanques_antes jsonb := '[]'::jsonb;
    v_creado_id uuid;
begin
    select * into mo from public.mot_motores where equipo_id = v_eq for update;
    if not found then
        raise exception 'El motor no está en el catálogo de motores (AGL). Actualiza la aplicación.';
    end if;
    if v_motivo is null then
        raise exception 'Escribe el motivo.';
    end if;
    if v_codigo is not null and v_codigo not in ('FIN_TEMPORADA', 'DANO_REEMPLAZO', 'CAMBIO_ESTACION', 'MANTENIMIENTO', 'OTRO') then
        raise exception 'Motivo no válido.';
    end if;
    if v_fecha > now() + interval '5 minutes' then
        raise exception 'El movimiento no puede ser en el futuro.';
    end if;
    if nullif(btrim(coalesce(d->>'horas_base', '')), '') is not null and (v_base is null or v_base < 0) then
        raise exception 'Las horas desde el último mantenimiento no son válidas.';
    end if;

    v_origen := mo.estacion_id;
    -- estado de partida
    if v_salida and mo.estado <> 'EN_ESTACION' then
        raise exception 'El motor no está instalado en una estación.';
    end if;
    if p_tipo = 'INSTALADO' and mo.estado = 'EN_ESTACION' then
        raise exception 'El motor ya está instalado en otra estación. Trasládalo o retíralo primero.';
    end if;
    if p_tipo = 'DE_VUELTA' and mo.estado <> 'TALLER' then
        raise exception 'El motor no está en el taller.';
    end if;
    if v_entrada then
        if v_dest is null or not exists (select 1 from public.estaciones_riego where id = v_dest) then
            raise exception 'Elige la estación de destino.';
        end if;
        if p_tipo = 'TRASLADADO' and v_dest = v_origen then
            raise exception 'La estación de destino es la misma donde ya está el motor.';
        end if;
    end if;
    -- permisos: configurar en origen y destino
    if v_salida then perform public._mot_autorizar_config(v_origen); end if;
    if v_entrada then perform public._mot_autorizar_config(v_dest); end if;

    v_antes := jsonb_build_object('motor', jsonb_build_object('estado', mo.estado, 'estacion_id', mo.estacion_id, 'tanque_id', mo.tanque_id,
                                                              'horas_desde_mant', mo.horas_desde_mant));

    -- ------------------------------ salida
    if v_salida then
        select * into t_orig from public.mot_tanques where motor_equipo_id = v_eq and activo for update;
        if found then
            v_tanques_antes := v_tanques_antes || jsonb_build_object('id', t_orig.id, 'estacion_id', t_orig.estacion_id,
                                                                     'motor_equipo_id', t_orig.motor_equipo_id, 'activo', t_orig.activo);
            v_saldo := public._mot_saldo_actual(t_orig.id);
            if v_codigo = 'DANO_REEMPLAZO' then
                v_dsaldo := 'QUEDA_EN_TANQUE';
            end if;
            if v_saldo > 0.0001 and v_dsaldo is null then
                raise exception 'El tanque tiene % gal de diésel: indica qué pasa con ese diésel (se va con el motor, se devuelve o queda en el tanque).', round(v_saldo, 2);
            end if;
            if v_dsaldo is not null and v_dsaldo not in ('CON_EL_MOTOR', 'DEVUELTO', 'QUEDA_EN_TANQUE') then
                raise exception 'Destino del diésel no válido.';
            end if;
            v_dsaldo := coalesce(v_dsaldo, 'QUEDA_EN_TANQUE');
            if v_dsaldo = 'DEVUELTO' then
                if v_ddev is null or v_ddev not in ('SUMINISTROS', 'BODEGA', 'TALLER') then
                    raise exception 'Indica a dónde se devuelve el diésel (suministros, bodega o taller).';
                end if;
                v_mat := coalesce(t_orig.material_id, (select c.material_diesel_id from public.mot_bajada_config c where c.id));
                if v_saldo <> 0 and v_mat is not null then
                    perform public._mot_mover(p_id, t_orig.id, v_mat, 'DEVOLUCION_TANQUE', -v_saldo, v_fecha, 'motor_asignacion', p_id);
                end if;
                update public.mot_tanques set activo = false, motor_equipo_id = null where id = t_orig.id;
            elsif v_dsaldo = 'CON_EL_MOTOR' then
                update public.mot_tanques set estacion_id = null where id = t_orig.id;      -- viaja con el motor
            else
                update public.mot_tanques set motor_equipo_id = null where id = t_orig.id;  -- se queda en la estación
            end if;
        end if;
        update public.mot_motores
           set estado = case p_tipo when 'RETIRADO' then 'RETIRADO' when 'AL_TALLER' then 'TALLER' else estado end,
               estacion_id = null,
               tanque_id = case when t_orig.id is not null and v_dsaldo = 'CON_EL_MOTOR' then t_orig.id else null end
         where equipo_id = v_eq;
        v_tanque := t_orig.id;
    end if;

    -- ------------------------------ entrada
    if v_entrada then
        v_tanque := public._fert_uuid(d->>'tanque_id');
        if v_tanque is not null then
            select * into t_dest from public.mot_tanques where id = v_tanque for update;
            if not found or not t_dest.activo then
                raise exception 'Ese tanque no existe o ya no está activo.';
            end if;
            if not ((t_dest.estacion_id = v_dest) or (t_dest.estacion_id is null and t_dest.motor_equipo_id = v_eq)) then
                raise exception 'Ese tanque no está en la estación de destino.';
            end if;
            if t_dest.motor_equipo_id is not null and t_dest.motor_equipo_id <> v_eq then
                raise exception 'Ese tanque ya está conectado a otro motor.';
            end if;
        else
            -- el tanque que viaja con el motor
            select * into t_dest from public.mot_tanques where motor_equipo_id = v_eq and activo and estacion_id is null for update;
            if found then
                v_tanque := t_dest.id;
            end if;
        end if;
        if v_tanque is null and v_nuevo is not null and jsonb_typeof(v_nuevo) = 'object' then
            if nullif(btrim(coalesce(v_nuevo->>'nombre', '')), '') is null then
                raise exception 'Escribe el nombre del tanque nuevo.';
            end if;
            v_mat := coalesce(public._fert_uuid(v_nuevo->>'material_id'), (select c.material_diesel_id from public.mot_bajada_config c where c.id));
            insert into public.mot_tanques (estacion_id, motor_equipo_id, nombre, capacidad_gal, material_id)
            values (v_dest, v_eq, btrim(v_nuevo->>'nombre'), nullif(public._mot_num(v_nuevo->>'capacidad_gal'), 0), v_mat)
            returning id into v_tanque;
            v_creado_id := v_tanque;
        end if;
        if v_tanque is null then
            raise exception 'Indica el tanque del motor: elige uno de la estación o crea uno nuevo.';
        end if;
        -- un tanque que ya viajaba con el motor y no es el elegido: no se pierde diésel en silencio
        if exists (select 1 from public.mot_tanques x where x.motor_equipo_id = v_eq and x.activo and x.id <> v_tanque) then
            if exists (select 1 from public.mot_tanques x where x.motor_equipo_id = v_eq and x.activo and x.id <> v_tanque
                          and public._mot_saldo_actual(x.id) > 0.0001) then
                raise exception 'El motor trae su propio tanque con diésel: no se puede conectar a otro.';
            end if;
            update public.mot_tanques set activo = false, motor_equipo_id = null where motor_equipo_id = v_eq and activo and id <> v_tanque;
        end if;
        select * into t_dest from public.mot_tanques where id = v_tanque;
        if v_creado_id is null and not exists (select 1 from jsonb_array_elements(v_tanques_antes) x where (x->>'id')::uuid = v_tanque) then
            v_tanques_antes := v_tanques_antes || jsonb_build_object('id', t_dest.id, 'estacion_id', t_dest.estacion_id,
                                                                     'motor_equipo_id', t_dest.motor_equipo_id, 'activo', t_dest.activo);
        end if;
        update public.mot_tanques set estacion_id = v_dest, motor_equipo_id = v_eq where id = v_tanque;
        update public.mot_motores
           set estado = 'EN_ESTACION', estacion_id = v_dest, tanque_id = v_tanque
         where equipo_id = v_eq;
    end if;

    v_antes := v_antes || jsonb_build_object('tanques', v_tanques_antes, 'tanque_creado', v_creado_id);
    insert into public.mot_asignaciones
        (id, equipo_id, tipo, estacion_origen, estacion_destino, tanque_id, fecha_hora, motivo, motivo_codigo, destino_saldo,
         destino_devolucion, saldo_gal, horas_base, antes, registrado_por)
    values
        (p_id, v_eq, p_tipo, v_origen, case when v_entrada then v_dest end, v_tanque, v_fecha, v_motivo, v_codigo,
         case when v_salida then v_dsaldo end, case when v_salida and v_dsaldo = 'DEVUELTO' then v_ddev end,
         case when v_salida then v_saldo end, v_base, v_antes, (select auth.uid()));
    if v_base is not null then
        perform public._mot_recalcular_horas(v_eq);
    end if;
    update public.fert_operaciones set estacion_id = coalesce(case when v_entrada then v_dest end, v_origen) where id = p_id;
    return '{}';
end $$;
revoke execute on function public._mot_aplicar_asignacion(uuid, jsonb, timestamptz, text) from public, anon, authenticated;

/** datos = {equipo_id, tipo: INSTALADO|TRASLADADO|AL_TALLER|DE_VUELTA, fecha_hora, estacion_destino?, tanque_id?, tanque_nuevo?, motivo, motivo_codigo, destino_saldo?, destino_devolucion?, horas_base?} */
create or replace function public._mot_op_asignar(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tipo text := upper(btrim(coalesce(d->>'tipo', '')));
begin
    if v_tipo not in ('INSTALADO', 'TRASLADADO', 'AL_TALLER', 'DE_VUELTA') then
        raise exception 'Tipo de movimiento del motor no válido.';
    end if;
    return public._mot_aplicar_asignacion(p_id, d, p_creado, v_tipo);
end $$;
revoke execute on function public._mot_op_asignar(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;

/** datos = {equipo_id, fecha_hora, motivo, motivo_codigo: FIN_TEMPORADA|DANO_REEMPLAZO|OTRO, destino_saldo, destino_devolucion?} */
create or replace function public._mot_op_retiro(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    return public._mot_aplicar_asignacion(p_id, d, p_creado, 'RETIRADO');
end $$;
revoke execute on function public._mot_op_retiro(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------- (b) anulación
/**
 * d = {documento_tipo: motor_registro|diesel_recepcion|motor_mantenimiento|motor_asignacion, documento_id, motivo}.
 * «Anular» (o administrador); el propio registro o recepción en su jornada también. Revierte el libro con movimientos
 * ANULACION. Anular una asignación solo si es la última del motor y no hay registros posteriores.
 */
create or replace function public._mot_op_anulacion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tipo   text := d->>'documento_tipo';
    v_doc    uuid := public._fert_uuid(d->>'documento_id');
    v_motivo text := nullif(btrim(d->>'motivo'), '');
    v_estacion uuid;
    v_autor  uuid;
    v_anulado timestamptz;
    v_equipo uuid;
    v_registro timestamptz;
    v_custodia public.fert_custodia%rowtype;
    a        public.mot_asignaciones%rowtype;
    m        record;
    x        jsonb;
begin
    if v_motivo is null then
        raise exception 'Indica el motivo de la anulación.';
    end if;
    if v_tipo = 'motor_registro' then
        select r.estacion_id, r.registrado_por, r.anulado_at, r.equipo_id into v_estacion, v_autor, v_anulado, v_equipo
          from public.mot_registros r where r.id = v_doc for update;
    elsif v_tipo = 'diesel_recepcion' then
        select r.estacion_id, r.registrado_por, r.anulado_at into v_estacion, v_autor, v_anulado
          from public.mot_recepciones r where r.id = v_doc for update;
    elsif v_tipo = 'motor_mantenimiento' then
        select r.estacion_id, r.registrado_por, r.anulado_at, r.equipo_id into v_estacion, v_autor, v_anulado, v_equipo
          from public.mot_mantenimientos r where r.id = v_doc for update;
    elsif v_tipo = 'motor_asignacion' then
        select * into a from public.mot_asignaciones where id = v_doc for update;
        v_estacion := coalesce(a.estacion_destino, a.estacion_origen); v_autor := a.registrado_por; v_anulado := a.anulado_at; v_equipo := a.equipo_id;
    else
        raise exception 'No se puede anular ese tipo de registro.';
    end if;
    if not found and v_estacion is null and v_autor is null then
        raise exception 'El registro a anular no existe.';
    end if;
    if v_anulado is not null then
        raise exception 'Ese registro ya estaba anulado.';
    end if;

    select coalesce(o.creado_en, o.recibido_en) into v_registro from public.fert_operaciones o where o.id = v_doc;

    if not (public.fn_es_admin()
            or (public.fn_tiene_permiso('motores', 'anular') and (v_estacion is null or public.fn_fert_puede(v_estacion, 'anular')))) then
        select * into v_custodia from public.fert_custodia where estacion_id = v_estacion;
        if not (v_tipo in ('motor_registro', 'diesel_recepcion')
                and v_autor = (select auth.uid())
                and v_custodia.custodio_id = (select auth.uid())
                and v_custodia.estado = 'ACTIVA'
                and v_custodia.desde <= coalesce(v_registro, now())) then
            raise exception 'Solo puedes anular tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'
                using errcode = '42501';
        end if;
    end if;

    if v_tipo = 'motor_asignacion' then
        if exists (select 1 from public.mot_asignaciones z where z.equipo_id = a.equipo_id and z.anulado_at is null and z.id <> a.id
                      and (z.fecha_hora, z.creado_en) > (a.fecha_hora, a.creado_en)) then
            raise exception 'Solo se puede anular el último movimiento del motor.';
        end if;
        if exists (select 1 from public.mot_registros r where r.equipo_id = a.equipo_id and r.anulado_at is null
                      and r.fecha > public._mot_dia(a.fecha_hora)) then
            raise exception 'El motor ya tiene registros posteriores a ese movimiento: anúlalos primero.';
        end if;
    end if;

    -- revertir el libro del tanque
    for m in select * from public.mot_movimientos mv
             where mv.documento_id = v_doc and mv.anula_id is null and mv.tipo <> 'ANULACION' order by mv.id loop
        perform public._mot_mover(p_id, m.tanque_id, m.material_id, 'ANULACION', -m.cantidad, p_creado, v_tipo, v_doc, m.id);
    end loop;

    if v_tipo = 'motor_registro' then
        update public.mot_registros set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo where id = v_doc;
        perform public._mot_refrescar_ultimo(v_equipo);
        perform public._mot_recalcular_horas(v_equipo);
    elsif v_tipo = 'diesel_recepcion' then
        update public.mot_recepciones set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo where id = v_doc;
    elsif v_tipo = 'motor_mantenimiento' then
        update public.mot_mantenimientos set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo where id = v_doc;
        perform public._mot_recalcular_horas(v_equipo);
    else
        -- deshacer la asignación con lo que se guardó de «antes»
        for x in select e from jsonb_array_elements(coalesce(a.antes->'tanques', '[]'::jsonb)) e loop
            update public.mot_tanques
               set estacion_id = nullif(x->>'estacion_id', '')::uuid, motor_equipo_id = nullif(x->>'motor_equipo_id', '')::uuid,
                   activo = coalesce((x->>'activo')::boolean, true)
             where id = (x->>'id')::uuid;
        end loop;
        if nullif(a.antes->>'tanque_creado', '') is not null then
            update public.mot_tanques set activo = false, motor_equipo_id = null where id = (a.antes->>'tanque_creado')::uuid;
        end if;
        update public.mot_motores
           set estado = coalesce(a.antes->'motor'->>'estado', 'SIN_ASIGNAR'),
               estacion_id = nullif(a.antes->'motor'->>'estacion_id', '')::uuid,
               tanque_id = nullif(a.antes->'motor'->>'tanque_id', '')::uuid
         where equipo_id = a.equipo_id;
        update public.mot_asignaciones set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo where id = v_doc;
        perform public._mot_recalcular_horas(a.equipo_id);
    end if;
    return '{}';
end $$;
revoke execute on function public._mot_op_anulacion(uuid, jsonb, timestamptz, boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------- (b) parches al despachador (marca propia 130)
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
        raise exception '130: en % se esperaba 1 aparición de «%» y hay % (¿falta correr la 128 o la 129?)', p_fn, p_viejo, v_n;
    end if;
    begin
        execute replace(v_def, p_viejo, p_nuevo);
    exception when others then
        raise exception '130: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- tipos válidos
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$'devolucion_bodega', 'anulacion',$p$,
    $p$'devolucion_bodega', 'anulacion', 'motor_asignar', 'motor_retiro', 'motor_registro_diario', 'motor_mantenimiento', 'diesel_recibir',$p$,
    $p$'motor_asignar', 'motor_retiro'$p$);

-- a qué función va cada operación (anclado en la línea de la 128, que la 129 no cambia)
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$        when 'devolucion_bodega'  then public._fert_op_devolucion_bodega(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)$p$,
    $p$        when 'devolucion_bodega'  then public._fert_op_devolucion_bodega(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'motor_asignar'          then public._mot_op_asignar(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'motor_retiro'           then public._mot_op_retiro(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'motor_registro_diario'  then public._mot_op_registro_diario(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'motor_mantenimiento'    then public._mot_op_mantenimiento(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'diesel_recibir'         then public._mot_op_diesel_recibir(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)$p$,
    $p$_mot_op_asignar($p$);

-- anulación de los tipos nuevos (otra rama del case de la anulación)
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$else public._fert_op_anulacion(v_id, v_datos, v_creado, v_inmediato) end$p$,
    $p$when v_datos->>'documento_tipo' in ('motor_registro', 'diesel_recepcion', 'motor_mantenimiento', 'motor_asignacion')
                                            then public._mot_op_anulacion(v_id, v_datos, v_creado, v_inmediato)
                                            else public._fert_op_anulacion(v_id, v_datos, v_creado, v_inmediato) end$p$,
    $p$_mot_op_anulacion($p$);


-- ---------------------------------------------------------------- (c) AGL publica
/**
 * p = {completo?: true, material_diesel?: código del producto diésel (MARA),
 *      motores: [{codigo, nombre, modelo, intervalo_horas, aviso_horas, capacidad_tanque_gal}]}   (AGL ya resuelve el intervalo por modelo)
 * -> {motores, equipos_creados, desactivados, avisos: [texto]}. Permiso: fertirriego_agl · publicar.
 * Crea los equipos que falten (visible_app = false, no estorban en Tickets) y no toca los que ya existen. Los modelos y
 * motores que ya no vienen (con «completo») quedan activo = false: NO se borran.
 */
create or replace function public.fn_mot_publicar(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p        jsonb := coalesce(p, '{}'::jsonb);
    v_completo boolean := coalesce((v_p->>'completo')::boolean, true);
    v_avisos   text[] := '{}';
    v_n_mot    integer := 0;
    v_creados  integer := 0;
    v_desact   integer := 0;
    v_codigos  text[] := '{}';
    v_diesel   uuid;
    v_codigo_d text := nullif(btrim(coalesce(v_p->>'material_diesel', '')), '');
    x          record;
    v_eq       uuid;
begin
    perform public._mot_exigir_agl('publicar');

    if v_codigo_d is not null then
        select id into v_diesel from public.materiales where codigo = v_codigo_d;
        if v_diesel is null then
            v_avisos := v_avisos || format('El producto diésel %s no existe en el catálogo: los tanques no podrán recibir.', v_codigo_d);
        else
            update public.mot_bajada_config set material_diesel_id = v_diesel where id;
        end if;
    end if;

    for x in select * from jsonb_to_recordset(coalesce(v_p->'motores', '[]'::jsonb))
             as t(codigo text, nombre text, modelo text, intervalo_horas integer, aviso_horas integer, capacidad_tanque_gal numeric) loop
        continue when nullif(btrim(x.codigo), '') is null;
        v_eq := (select id from public.equipos where codigo = btrim(x.codigo));
        if v_eq is null then
            insert into public.equipos (codigo, nombre, visible_app)
            values (btrim(x.codigo), coalesce(nullif(btrim(x.nombre), ''), btrim(x.codigo)), false)
            returning id into v_eq;
            v_creados := v_creados + 1;
        end if;
        if nullif(btrim(x.modelo), '') is null then
            v_avisos := v_avisos || format('El motor %s no tiene modelo.', x.codigo);
        end if;
        if x.intervalo_horas is null or x.intervalo_horas <= 0 then
            v_avisos := v_avisos || format('El motor %s no tiene intervalo de mantenimiento.', x.codigo);
        end if;
        insert into public.mot_motores (equipo_id, modelo, intervalo_horas, aviso_horas, capacidad_tanque_gal, activo, publicado_at)
        values (v_eq, nullif(btrim(x.modelo), ''), case when x.intervalo_horas > 0 then x.intervalo_horas end,
                case when x.aviso_horas >= 0 then x.aviso_horas end, nullif(x.capacidad_tanque_gal, 0), true, now())
        on conflict (equipo_id) do update
        set modelo = excluded.modelo, intervalo_horas = excluded.intervalo_horas, aviso_horas = excluded.aviso_horas,
            capacidad_tanque_gal = excluded.capacidad_tanque_gal, activo = true, publicado_at = now();
        v_codigos := v_codigos || btrim(x.codigo);
        v_n_mot := v_n_mot + 1;
    end loop;
    if v_completo then
        update public.mot_motores set activo = false
         where activo and equipo_id not in (select e.id from public.equipos e where e.codigo = any(v_codigos));
        get diagnostics v_desact = row_count;
    end if;

    return jsonb_build_object('motores', v_n_mot, 'equipos_creados', v_creados,
                              'desactivados', v_desact, 'avisos', to_jsonb(v_avisos));
end
$$;
revoke execute on function public.fn_mot_publicar(jsonb) from public, anon;
grant  execute on function public.fn_mot_publicar(jsonb) to authenticated;


-- ---------------------------------------------------------------- (c) bajada a AGL con huella
/**
 * Las 4 tablas que bajan, con su fila «hashable» (sin bajado_a_agl_en ni huella, con «tabla»). Cursor: 'r|' registro,
 * 'c|' recepción, 'm|' mantenimiento, 'a|' asignación + el id. p_ids = solo esos ids.
 */
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
    )
    select u.cursor, u.tabla, u.id, u.estacion_id, u.equipo_id, u.tanque_id, u.fecha, u.fila, u.fila::text,
           public._mot_huella(u.fila), u.hg, u.b
      from u
$$;
revoke execute on function public._mot_filas(uuid[]) from public, anon, authenticated;

/**
 * p = {desde?, hasta?, limite?: 1..1000 (200), despues_de?: cursor}
 * -> {generado, hay_mas, siguiente, cuantos, sha256_lote,
 *     filas: [{cursor, tabla: registro|recepcion|mantenimiento|asignacion, id, estacion_id, estacion, zona, equipo_id,
 *              equipo_codigo, equipo_nombre, tanque_id, tanque_nombre, fecha, fila, texto, huella}]}
 * Solo lo «por bajar» (nunca bajado o cambiado después de bajarlo). Orden por cursor (binario).
 */
create or replace function public.fn_mot_exportar(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_p      jsonb := coalesce(p, '{}'::jsonb);
    v_lim    integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 200), 1), 1000);
    v_desde  date := nullif(v_p ->> 'desde', '')::date;
    v_hasta  date := nullif(v_p ->> 'hasta', '')::date;
    v_desp   text := nullif(v_p ->> 'despues_de', '');
    v_filas  jsonb;
    v_mas    boolean;
    v_sig    text;
    v_cuantos integer;
    v_lote   text;
begin
    perform public._mot_exigir_agl('ver');
    with f as (
        select x.* from public._mot_filas() x
         where (x.bajado_a_agl_en is null or x.huella_guardada is distinct from x.huella)
           and (v_desde is null or x.fecha >= v_desde)
           and (v_hasta is null or x.fecha <= v_hasta)
           and (v_desp is null or x.cursor collate "C" > v_desp collate "C")
         order by x.cursor collate "C"
         limit v_lim + 1
    ), lim as (
        select * from f order by cursor collate "C" limit v_lim
    )
    select (select count(*) > v_lim from f),
           coalesce(jsonb_agg(jsonb_build_object(
               'cursor', l.cursor, 'tabla', l.tabla, 'id', l.id, 'estacion_id', l.estacion_id, 'estacion', e.nombre, 'zona', z.nombre,
               'equipo_id', l.equipo_id, 'equipo_codigo', q.codigo, 'equipo_nombre', q.nombre,
               'tanque_id', l.tanque_id, 'tanque_nombre', t.nombre,
               'fecha', l.fecha, 'fila', l.fila, 'texto', l.texto, 'huella', l.huella
           ) order by l.cursor collate "C"), '[]'::jsonb),
           max(l.cursor collate "C"),
           count(*),
           encode(sha256(convert_to(coalesce(string_agg(l.huella, '|' order by l.cursor collate "C"), ''), 'UTF8')), 'hex')
      into v_mas, v_filas, v_sig, v_cuantos, v_lote
      from lim l
      left join public.estaciones_riego e on e.id = l.estacion_id
      left join public.zonas z on z.id = e.zona_id
      left join public.equipos q on q.id = l.equipo_id
      left join public.mot_tanques t on t.id = l.tanque_id;
    return jsonb_build_object('generado', now(), 'hay_mas', coalesce(v_mas, false), 'siguiente', v_sig,
                              'cuantos', v_cuantos, 'sha256_lote', v_lote, 'filas', v_filas);
end
$$;
revoke execute on function public.fn_mot_exportar(jsonb) from public, anon;
grant  execute on function public.fn_mot_exportar(jsonb) to authenticated;

/**
 * p = {lote: [{cursor, id, huella}], cuantos, sha256_lote}; sha256_lote = sha256 de las huellas unidas con '|' ordenadas por
 * cursor (binario). La base RECALCULA la huella de cada fila: coincide = se marca; cambió = sigue «por bajar».
 * -> {confirmadas: [{id}], rechazadas: [{id}]}. No borra nada. Permiso: fertirriego_agl · publicar.
 */
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

/** d = {dias?: 0..365}: sin «dias» devuelve la retención; con «dias» la cambia. -> {retencion_dias}. */
create or replace function public.fn_mot_bajada_retencion(d jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_dias integer := nullif(coalesce(d, '{}'::jsonb) ->> 'dias', '')::integer;
    v      integer;
begin
    perform public._mot_exigir_agl('publicar');
    if v_dias is not null then
        if v_dias not between 0 and 365 then
            raise exception 'La retención va de 0 a 365 días.' using errcode = '22023';
        end if;
        update public.mot_bajada_config set retencion_dias = v_dias where id;
    end if;
    select retencion_dias into v from public.mot_bajada_config where id;
    return jsonb_build_object('retencion_dias', v);
end
$$;
revoke execute on function public.fn_mot_bajada_retencion(jsonb) from public, anon;
grant  execute on function public.fn_mot_bajada_retencion(jsonb) to authenticated;

/**
 * p = {limite?: 1..5000 (500), retencion_dias?: solo puede AUMENTAR la configurada}
 * Borra de Supabase lo confirmado hace más de la retención cuya huella actual = la confirmada. NO purga el libro
 * (mot_movimientos) ni las proyecciones (mot_motores, mot_tanques, mot_saldos); conserva el último registro y la última
 * asignación vigente de cada motor. -> {registros, recepciones, mantenimientos, asignaciones, hay_mas, retencion_dias}
 */
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
     where f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
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


-- ---------------------------------------------------------------- (d) lo que baja el teléfono
/**
 * -> {servidor_en, permisos: {ver, registrar, anular, configurar}, material_diesel_id, motores, tanques_sin_motor,
 *     registros (45 días), recepciones (45 días), mantenimientos (el último de cada motor), asignaciones (las últimas 20
 *     de cada motor)} solo de las estaciones que la persona ve. Con «configurar» también salen los motores sin estación
 *     (en el taller, retirados, sin asignar) para poder reinstalarlos.
 * motores[i] = {equipo_id, codigo, nombre, modelo, estado, estacion_id, tanque: {id, nombre, capacidad_gal, saldo_gal} | null,
 *               horo_ultimo, visor_ultimo, fecha_ultimo, intervalo_horas, aviso_horas, horas_desde_mant, horas_para_mant}
 */
create or replace function public.fn_mot_estado_campo(p_desde date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_hoy   date := public._mot_dia(now());
    v_desde date;
    v_conf  boolean;
begin
    perform public._mot_exigir_permiso('ver');
    v_desde := coalesce(p_desde, v_hoy - 45);
    v_conf := public.fn_es_admin() or public.fn_tiene_permiso('motores', 'configurar');
    return jsonb_build_object(
        'servidor_en', now(),
        'permisos', jsonb_build_object(
            'ver', true,
            'registrar', public.fn_es_admin() or public.fn_tiene_permiso('motores', 'registrar'),
            'anular', public.fn_es_admin() or public.fn_tiene_permiso('motores', 'anular'),
            'configurar', v_conf),
        'material_diesel_id', (select c.material_diesel_id from public.mot_bajada_config c where c.id),
        'motores', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'equipo_id', x.equipo_id, 'codigo', x.codigo, 'nombre', x.nombre, 'modelo', x.modelo, 'estado', x.estado,
                       'estacion_id', x.estacion_id,
                       'tanque', case when x.tanque_id is null then null else jsonb_build_object(
                           'id', x.tanque_id, 'nombre', x.tanque_nombre, 'capacidad_gal', coalesce(x.cap_tanque, x.capacidad_tanque_gal),
                           'saldo_gal', x.saldo) end,
                       'horo_ultimo', x.horo_ultimo, 'visor_ultimo', x.visor_ultimo, 'fecha_ultimo', x.fecha_ultimo,
                       'intervalo_horas', x.intervalo, 'aviso_horas', x.aviso, 'horas_desde_mant', x.horas_desde_mant,
                       'horas_para_mant', case when x.intervalo is null then null else x.intervalo - x.horas_desde_mant end)
                   order by x.codigo)
              from (select mo.*, e.codigo, e.nombre,
                           mo.aviso_horas as aviso,
                           coalesce(mo.intervalo_horas, c.ciclo_horas) as intervalo,
                           t.nombre as tanque_nombre, t.capacidad_gal as cap_tanque,
                           coalesce((select s.disponible from public.mot_saldos s where s.tanque_id = mo.tanque_id), 0) as saldo
                      from public.mot_motores mo
                      join public.equipos e on e.id = mo.equipo_id
                      left join public.categorias_equipo c on c.id = e.categoria_id
                      left join public.mot_tanques t on t.id = mo.tanque_id
                     where mo.activo
                       and ((mo.estacion_id is not null and public.fn_fert_puede(mo.estacion_id, 'ver'))
                            or (mo.estacion_id is null and v_conf))) x), '[]'::jsonb),
        'tanques_sin_motor', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', t.id, 'nombre', t.nombre, 'estacion_id', t.estacion_id, 'capacidad_gal', t.capacidad_gal,
                       'saldo_gal', coalesce((select s.disponible from public.mot_saldos s where s.tanque_id = t.id), 0)) order by t.nombre)
              from public.mot_tanques t
             where t.activo and t.motor_equipo_id is null and t.estacion_id is not null
               and public.fn_fert_puede(t.estacion_id, 'ver')), '[]'::jsonb),
        'registros', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'equipo_id', r.equipo_id, 'estacion_id', r.estacion_id, 'tanque_id', r.tanque_id, 'fecha', r.fecha,
                       'horo_ini', r.horo_ini, 'horo_fin', r.horo_fin, 'horas', r.horas, 'visor_ini', r.visor_ini, 'visor_fin', r.visor_fin,
                       'recibido_gal', r.recibido_gal, 'gastado_gal', r.gastado_gal, 'rendimiento_gal_h', r.rendimiento_gal_h, 'rpm', r.rpm,
                       'horo_cambiado', r.horo_cambiado, 'visor_cambiado', r.visor_cambiado, 'comentario', r.comentario,
                       'registrado_por', r.registrado_por, 'fecha_hora', r.fecha_hora, 'anulado_at', r.anulado_at,
                       'motivo_anulacion', r.motivo_anulacion, 'observaciones', to_jsonb(o.observaciones))
                   order by r.fecha desc, r.fecha_hora desc)
              from public.mot_registros r
              left join public.fert_operaciones o on o.id = r.id
             where r.fecha >= v_desde and public.fn_fert_puede(r.estacion_id, 'ver')), '[]'::jsonb),
        'recepciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'tanque_id', r.tanque_id, 'estacion_id', r.estacion_id, 'galones', r.galones, 'chofer_id', r.chofer_id,
                       'vehiculo_id', r.vehiculo_id, 'fecha_hora', r.fecha_hora, 'comentario', r.comentario,
                       'registrado_por', r.registrado_por, 'anulado_at', r.anulado_at, 'motivo_anulacion', r.motivo_anulacion)
                   order by r.fecha_hora desc)
              from public.mot_recepciones r
             where public._mot_dia(r.fecha_hora) >= v_desde and public.fn_fert_puede(r.estacion_id, 'ver')), '[]'::jsonb),
        'mantenimientos', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', q.id, 'equipo_id', q.equipo_id, 'estacion_id', q.estacion_id, 'fecha_hora', q.fecha_hora, 'horometro', q.horometro,
                       'tipo', q.tipo, 'nota', q.nota, 'horas_antes', q.horas_antes))
              from (select distinct on (m.equipo_id) m.* from public.mot_mantenimientos m
                     where m.anulado_at is null and (m.estacion_id is null or public.fn_fert_puede(m.estacion_id, 'ver'))
                     order by m.equipo_id, m.fecha_hora desc) q), '[]'::jsonb),
        'asignaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', q.id, 'equipo_id', q.equipo_id, 'tipo', q.tipo, 'estacion_origen', q.estacion_origen,
                       'estacion_destino', q.estacion_destino, 'tanque_id', q.tanque_id, 'fecha_hora', q.fecha_hora, 'motivo', q.motivo,
                       'motivo_codigo', q.motivo_codigo, 'destino_saldo', q.destino_saldo, 'destino_devolucion', q.destino_devolucion,
                       'saldo_gal', q.saldo_gal, 'anulado_at', q.anulado_at) order by q.fecha_hora desc)
              from (select a.*, row_number() over (partition by a.equipo_id order by a.fecha_hora desc, a.creado_en desc) as n
                      from public.mot_asignaciones a
                     where coalesce(a.estacion_destino, a.estacion_origen) is null
                        or public.fn_fert_puede(coalesce(a.estacion_destino, a.estacion_origen), 'ver')) q
             where q.n <= 20), '[]'::jsonb)
    );
end
$$;
revoke execute on function public.fn_mot_estado_campo(date) from public, anon;
grant  execute on function public.fn_mot_estado_campo(date) to authenticated;

/**
 * Último registro del motor con fecha ANTERIOR a p_fecha: respaldo del teléfono cuando está en línea y no tiene estado
 * local. -> {fecha, horo_fin, visor_fin, origen: 'motor'|'ticket'|null}. Sin registro del motor cae a la última lectura de
 * horómetro de Tickets (visor_fin null).
 */
create or replace function public.fn_mot_ultimo(p_equipo uuid, p_fecha date)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    r record;
begin
    perform public._mot_exigir_permiso('ver');
    select * into r from public._mot_lectura_anterior(p_equipo, p_fecha);
    if r.fecha is not null then
        return jsonb_build_object('fecha', r.fecha, 'horo_fin', r.horo_fin, 'visor_fin', r.visor_fin, 'origen', 'motor');
    end if;
    select l.horometro_final as horo_fin, l.fecha into r from public.fn_ultima_lectura_equipo(p_equipo, p_fecha) l limit 1;
    if r.fecha is not null and r.horo_fin is not null then
        return jsonb_build_object('fecha', r.fecha, 'horo_fin', r.horo_fin, 'visor_fin', null, 'origen', 'ticket');
    end if;
    return jsonb_build_object('fecha', null, 'horo_fin', null, 'visor_fin', null, 'origen', null);
end
$$;
revoke execute on function public.fn_mot_ultimo(uuid, date) from public, anon;
grant  execute on function public.fn_mot_ultimo(uuid, date) to authenticated;

notify pgrst, 'reload schema';
