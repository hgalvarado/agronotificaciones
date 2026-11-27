-- =====================================================================
-- 160 · Motores: reemplazo temporal (pedido 2026-11-27)
--
-- En campo un motor se daña, lo reparan ahí mismo (no se lleva a ningún lado) y mientras tanto ponen otro motor en su tanque.
-- Cuando lo reparan, se vuelve a activar y se quita el sustituto. Antes eran 4 trámites sueltos (llevar al taller, recibir el
-- otro, retirar el otro, recibir del taller) y el dañado desaparecía de su estación.
--
-- Ahora, una sola operación del teléfono (cola sin señal, la misma `motor_asignar` con tipo nuevo):
--   · REEMPLAZO      (datos: equipo_id = dañado, sustituto_id, fecha_hora, horometro = del sustituto, horometro_danado?, motivo?)
--       el dañado queda «En reparación» (AL_TALLER con motivo DANO_REEMPLAZO) y su tanque pasa al sustituto:
--         - sustituto de repuesto (sin estación / retirado) → INSTALADO en ese tanque;
--         - sustituto que trabaja en OTRA estación      → TRASLADADO a ese tanque (se recuerda de dónde vino).
--   · REEMPLAZO_FIN  (datos: equipo_id = dañado ya reparado, fecha_hora, horometro = del reparado, horometro_sustituto?)
--       el sustituto vuelve a su estación y a su tanque (si sigue libre) o queda sin estación (si era de repuesto o su
--       tanque ya lo ocupa otro motor), y el reparado vuelve a su tanque (DE_VUELTA).
-- Por dentro son los movimientos de siempre (_mot_aplicar_asignacion): mismos permisos (retirar/recibir/mover), mismo
-- historial, custodia y AGL sin cambios. La tabla `mot_reemplazos` solo recuerda el par para mostrarlo y deshacerlo.
--
-- Si se vuelve a correr la 130 (y con ella su cadena 144 → 147 → … → 153) o la 147 → CORRER LA 160 OTRA VEZ AL FINAL.
-- La 160 se niega a correr si fn_mot_estado_campo no es la de la 147 (sin `v_ests`).
-- Idempotente. Sin UPDATE/DELETE sin WHERE.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create table if not exists public.mot_reemplazos (
    id                 uuid primary key,
    estacion_id        uuid not null references public.estaciones_riego(id),
    tanque_id          uuid not null references public.mot_tanques(id),
    motor_danado       uuid not null references public.mot_motores(equipo_id),
    motor_sustituto    uuid not null references public.mot_motores(equipo_id),
    origen_estacion_id uuid references public.estaciones_riego(id),
    origen_tanque_id   uuid references public.mot_tanques(id),
    desde              timestamptz not null,
    hasta              timestamptz,
    motivo             text,
    creado_por         uuid,
    cerrado_por        uuid,
    fin_operacion      uuid,
    creado_at          timestamptz not null default now()
);
create unique index if not exists mot_reemplazos_un_activo on public.mot_reemplazos (motor_danado) where hasta is null;
alter table public.mot_reemplazos enable row level security;
comment on table public.mot_reemplazos is
'Reemplazo temporal de un motor en reparación (sql/160). Solo recuerda el par; los movimientos reales van en mot_asignaciones.';

-- uuid fijo derivado del id de la operación (idempotente: la misma operación produce los mismos ids)
create or replace function public._mot_uuid_hijo(p_id uuid, p_sufijo text)
returns uuid language sql immutable as $$ select md5(p_id::text || ':' || p_sufijo)::uuid $$;

-- operación hija de servicio (mot_asignaciones.id apunta a fert_operaciones): mismo autor y estación que la del teléfono
create or replace function public._mot_op_hija(p_padre uuid, p_sufijo text, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid := public._mot_uuid_hijo(p_padre, p_sufijo);
begin
    insert into public.fert_operaciones (id, tipo, estacion_id, perfil_id, en_nombre_de, creado_en, recibido_en, inmediato, datos, resultado, mensaje)
    select v_id, 'motor_asignar', o.estacion_id,
           coalesce(o.perfil_id, (select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid), o.en_nombre_de,
           coalesce(o.creado_en, now()), now(), true, p_datos || jsonb_build_object('de_operacion', p_padre), 'ACEPTADO',
           'Parte del reemplazo temporal'
      from (select 1) u left join public.fert_operaciones o on o.id = p_padre
    on conflict (id) do nothing;
    return v_id;
end $$;
revoke execute on function public._mot_op_hija(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public._mot_reemplazo(p_id uuid, d jsonb, p_creado timestamptz, p_tipo text)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_danado  uuid := public._fert_uuid(d->>'equipo_id');
    v_sust    uuid := public._fert_uuid(d->>'sustituto_id');
    v_fecha   timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_fecha2  timestamptz;
    md        public.mot_motores%rowtype;
    ms        public.mot_motores%rowtype;
    r         public.mot_reemplazos%rowtype;
    v_obs     text[] := '{}';
    v_cod_d   text;
    v_cod_s   text;
    v_motivo  text := nullif(btrim(coalesce(d->>'motivo', '')), '');
    v_libre   boolean;
    v_d       jsonb;
begin
    v_fecha2 := v_fecha + interval '1 second';   -- el segundo movimiento va justo después (historial y custodia en orden)
    select * into md from public.mot_motores where equipo_id = v_danado;
    if not found then
        raise exception 'El motor no está en el catálogo de motores (AGL). Actualiza la aplicación.';
    end if;
    v_cod_d := (select e.codigo from public.equipos e where e.id = v_danado);

    if p_tipo = 'REEMPLAZO' then
        if md.estado <> 'EN_ESTACION' or md.tanque_id is null then
            raise exception 'El motor % no está trabajando en un tanque.', coalesce(v_cod_d, '');
        end if;
        if v_sust is null or v_sust = v_danado then
            raise exception 'Elige el motor que lo va a reemplazar.';
        end if;
        select * into ms from public.mot_motores where equipo_id = v_sust;
        if not found then
            raise exception 'El motor sustituto no está en el catálogo de motores (AGL).';
        end if;
        v_cod_s := (select e.codigo from public.equipos e where e.id = v_sust);
        if ms.estado = 'TALLER' then
            raise exception 'El motor % está en reparación: no puede reemplazar a otro.', coalesce(v_cod_s, '');
        end if;
        if ms.estado = 'EN_ESTACION' and ms.estacion_id = md.estacion_id then
            raise exception 'El motor % ya trabaja en esta estación.', coalesce(v_cod_s, '');
        end if;
        if exists (select 1 from public.mot_reemplazos x where x.motor_danado = v_danado and x.hasta is null) then
            raise exception 'El motor % ya tiene un reemplazo temporal.', coalesce(v_cod_d, '');
        end if;

        -- 1 · el dañado queda en reparación (libera el tanque; el diésel se queda en el tanque)
        v_obs := v_obs || public._mot_aplicar_asignacion(p_id, jsonb_build_object(
            'equipo_id', v_danado, 'fecha_hora', v_fecha, 'motivo_codigo', 'DANO_REEMPLAZO',
            'motivo', coalesce(v_motivo, 'En reparación · reemplazo temporal por ' || coalesce(v_cod_s, 'otro motor')),
            'horometro', d->'horometro_danado'), p_creado, 'AL_TALLER');

        -- 2 · el sustituto entra a ese tanque (de repuesto: se instala; de otra estación: se traslada)
        v_d := jsonb_build_object(
            'equipo_id', v_sust, 'fecha_hora', v_fecha2, 'estacion_destino', md.estacion_id, 'tanque_id', md.tanque_id,
            'motivo_codigo', 'CAMBIO_ESTACION', 'motivo', 'Reemplazo temporal de ' || coalesce(v_cod_d, 'otro motor'),
            'horometro', d->'horometro', 'observacion', 'Reemplazo temporal de ' || coalesce(v_cod_d, 'otro motor'),
            'tipo', case when ms.estado = 'EN_ESTACION' then 'TRASLADADO' else 'INSTALADO' end);
        v_obs := v_obs || public._mot_aplicar_asignacion(public._mot_op_hija(p_id, 'sustituto', v_d), v_d, p_creado, v_d->>'tipo');

        insert into public.mot_reemplazos (id, estacion_id, tanque_id, motor_danado, motor_sustituto, origen_estacion_id,
                                           origen_tanque_id, desde, motivo, creado_por)
        values (p_id, md.estacion_id, md.tanque_id, v_danado, v_sust,
                case when ms.estado = 'EN_ESTACION' then ms.estacion_id end,
                case when ms.estado = 'EN_ESTACION' then ms.tanque_id end, v_fecha, v_motivo, (select auth.uid()))
        on conflict (id) do nothing;
        return v_obs;
    end if;

    -- ------------------------------ REEMPLAZO_FIN: se activa el reparado y se quita el sustituto
    select * into r from public.mot_reemplazos where motor_danado = v_danado and hasta is null for update;
    if not found then
        raise exception 'El motor % no tiene un reemplazo temporal abierto.', coalesce(v_cod_d, '');
    end if;
    if md.estado <> 'TALLER' then
        raise exception 'El motor % ya no está en reparación. Revisa su historial.', coalesce(v_cod_d, '');
    end if;
    select * into ms from public.mot_motores where equipo_id = r.motor_sustituto;
    v_cod_s := (select e.codigo from public.equipos e where e.id = r.motor_sustituto);

    -- 1 · el sustituto sale del tanque (si todavía está ahí)
    if ms.estado = 'EN_ESTACION' and ms.tanque_id = r.tanque_id then
        v_libre := r.origen_tanque_id is not null and exists (
            select 1 from public.mot_tanques t
             where t.id = r.origen_tanque_id and t.activo and t.estacion_id = r.origen_estacion_id and t.motor_equipo_id is null);
        if v_libre then
            v_d := jsonb_build_object(
                'equipo_id', r.motor_sustituto, 'fecha_hora', v_fecha, 'estacion_destino', r.origen_estacion_id,
                'tanque_id', r.origen_tanque_id, 'motivo_codigo', 'CAMBIO_ESTACION',
                'motivo', 'Fin del reemplazo de ' || coalesce(v_cod_d, 'otro motor') || ': regresa a su estación',
                'horometro', d->'horometro_sustituto', 'tipo', 'TRASLADADO');
            v_obs := v_obs || public._mot_aplicar_asignacion(public._mot_op_hija(p_id, 'sustituto', v_d), v_d, p_creado, 'TRASLADADO');
        else
            v_d := jsonb_build_object(
                'equipo_id', r.motor_sustituto, 'fecha_hora', v_fecha, 'motivo_codigo', 'OTRO',
                'motivo', 'Fin del reemplazo de ' || coalesce(v_cod_d, 'otro motor')
                          || case when r.origen_tanque_id is not null then ' (su tanque de origen ya tiene otro motor)' else '' end,
                'horometro', d->'horometro_sustituto');
            v_obs := v_obs || public._mot_aplicar_asignacion(public._mot_op_hija(p_id, 'sustituto', v_d), v_d, p_creado, 'RETIRADO');
            if r.origen_tanque_id is not null then
                v_obs := public._fert_obs(v_obs, array['SUSTITUTO_SIN_TANQUE_ORIGEN']);
            end if;
        end if;
    end if;

    -- 2 · el reparado vuelve a su tanque
    if exists (select 1 from public.mot_tanques t where t.id = r.tanque_id and t.motor_equipo_id is not null and t.motor_equipo_id <> v_danado) then
        raise exception 'El tanque ya lo usa otro motor. Quita ese motor primero.';
    end if;
    v_obs := v_obs || public._mot_aplicar_asignacion(p_id, jsonb_build_object(
        'equipo_id', v_danado, 'fecha_hora', v_fecha2, 'estacion_destino', r.estacion_id, 'tanque_id', r.tanque_id,
        'horometro', d->'horometro', 'observacion', 'Reparado · fin del reemplazo temporal'), p_creado, 'DE_VUELTA');
    -- en el historial se lee «Reparado y reactivado» (la regla general pone «Regreso del taller» sin código)
    update public.mot_asignaciones
       set motivo = 'Reparado · fin del reemplazo temporal (sale ' || coalesce(v_cod_s, 'el sustituto') || ')', motivo_codigo = 'DANO_REEMPLAZO'
     where id = p_id;

    update public.mot_reemplazos set hasta = v_fecha, cerrado_por = (select auth.uid()), fin_operacion = p_id where id = r.id;
    return v_obs;
end $$;
revoke execute on function public._mot_reemplazo(uuid, jsonb, timestamptz, text) from public, anon, authenticated;

/** datos = {equipo_id, tipo: INSTALADO|TRASLADADO|AL_TALLER|DE_VUELTA|REEMPLAZO|REEMPLAZO_FIN, ...} (160: los dos últimos) */
create or replace function public._mot_op_asignar(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tipo text := upper(btrim(coalesce(d->>'tipo', '')));
begin
    if v_tipo in ('REEMPLAZO', 'REEMPLAZO_FIN') then
        return public._mot_reemplazo(p_id, d, p_creado, v_tipo);
    end if;
    if v_tipo not in ('INSTALADO', 'TRASLADADO', 'AL_TALLER', 'DE_VUELTA') then
        raise exception 'Tipo de movimiento del motor no válido.';
    end if;
    return public._mot_aplicar_asignacion(p_id, d, p_creado, v_tipo);
end $$;
revoke execute on function public._mot_op_asignar(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;

-- reemplazos abiertos de las estaciones que ve la persona (para el teléfono)
create or replace function public._mot_reemplazos_activos(p_ests uuid[])
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'estacion_id', r.estacion_id, 'tanque_id', r.tanque_id,
               'motor_danado', r.motor_danado, 'motor_sustituto', r.motor_sustituto,
               'danado_codigo', ed.codigo, 'danado_nombre', ed.nombre, 'sustituto_codigo', es.codigo,
               'origen_estacion_id', r.origen_estacion_id, 'origen_estacion', eo.nombre,
               'desde', r.desde, 'motivo', r.motivo) order by r.desde), '[]'::jsonb)
      from public.mot_reemplazos r
      join public.mot_motores md on md.equipo_id = r.motor_danado and md.estado = 'TALLER'
      left join public.equipos ed on ed.id = r.motor_danado
      left join public.equipos es on es.id = r.motor_sustituto
      left join public.estaciones_riego eo on eo.id = r.origen_estacion_id
     where r.hasta is null and r.estacion_id = any(p_ests)
$$;
revoke execute on function public._mot_reemplazos_activos(uuid[]) from public, anon, authenticated;

create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def   text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n     integer;
begin
    if position(p_marca in v_def) > 0 then
        return;
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '160: en % se esperaba 1 aparición de «%» y hay %', p_fn, left(v_viejo, 80), v_n;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
end $$;

do $$
begin
    if position('v_ests' in pg_get_functiondef('public.fn_mot_estado_campo(date)'::regprocedure)) = 0 then
        raise exception '160: fn_mot_estado_campo no es la de la 147 (falta v_ests). Corre antes la cadena 147 → 153.';
    end if;
end $$;

select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$'servidor_en', now(),$p$,
    $p$'servidor_en', now(),
        'reemplazos', public._mot_reemplazos_activos(v_ests) /* 160:reemplazos */,$p$,
    '160:reemplazos');
