-- =====================================================================
-- 116 · FERTIRRIEGO · REGISTRO HISTÓRICO (aplicaciones anteriores al sistema, SIN mover el inventario)
-- =====================================================================
-- Pedido del usuario (2026-11-18): hay estaciones que ya operaban antes de poner Fertirriego en marcha. El
-- administrador necesita que una persona concreta registre lo que YA se aplicó sin mover el inventario y sin
-- inventar entregas. Contrato: docs/fertirriego-historico.md.
--   1. Permiso temporal «Registro histórico»: lo otorga SOLO quien administra (admin o «Configurar» en Fertirriego,
--      igual que el modo de pruebas), por PERSONA y ESTACIÓN, con fecha límite (inclusive, UTC-6); se revoca antes.
--      Tabla public.fert_historico_permisos (solo lectura por RLS; se escribe con funciones).
--   2. Operación nueva «aplicacion_historica» (teléfono, cola sin señal): mismos datos que una aplicación, pero
--      día PASADO (< hoy en UTC-6, sin ser anterior a la siembra del turno), exige el permiso vigente en ESA
--      estación (no exige custodia) y NO crea movimientos (ni saldos, ni libro, ni envases). Se guarda en
--      fert_aplicaciones con historica = true y el texto fijo «Registro inicial del proceso». Duplicado
--      (mismo turno + DDT/fecha + mismos productos) → observación POSIBLE_DUPLICADO, sin rechazar.
--   3. Se puede anular con motivo (quien tenga «Anular»; no genera movimientos). No admite devoluciones.
--   4. AGL: fn_fert_exportar saca las históricas en la lista APARTE «aplicaciones_historicas» y NO en
--      «aplicaciones»; como no tienen movimientos, no cuentan como «Real». «Terminar ciclo» las archiva con el turno.
--   5. Terminar ciclo (102): la columna nueva no entra a la huella cuando es false/null (misma lección de la 112), así
--      que turnos archivados antes de la 116 siguen reactivándose.
--
-- Correr DESPUÉS de la 115. Idempotente. Todo UPDATE/DELETE lleva WHERE. Si se vuelve a correr la 95, 99, 100, 102 o 115,
-- correr la 116 otra vez (parches por texto con marca).
-- =====================================================================


-- ---------------------------------------------------------------- 1 · columna y tabla de permisos

alter table public.fert_aplicaciones add column if not exists historica boolean default false;
comment on column public.fert_aplicaciones.historica is
'116: registro inicial del proceso (antes de usar el sistema). No mueve el inventario. null = false (turnos archivados antes de la 116).';

create table if not exists public.fert_historico_permisos (
    id           uuid primary key default gen_random_uuid(),
    persona_id   uuid not null references public.perfiles(id),
    estacion_id  uuid not null references public.estaciones_riego(id),
    hasta        date not null,
    otorgado_por uuid not null references public.perfiles(id),
    otorgado_at  timestamptz not null default now(),
    revocado_at  timestamptz,
    revocado_por uuid references public.perfiles(id),
    nota         text
);
comment on table public.fert_historico_permisos is
'116: permiso temporal «Registro histórico» por persona y estación. Vigente = sin revocar y hasta >= día (UTC-6).';
create unique index if not exists uq_fert_historico_activo
    on public.fert_historico_permisos (persona_id, estacion_id) where revocado_at is null;
create index if not exists idx_fert_historico_persona on public.fert_historico_permisos (persona_id, hasta);

alter table public.fert_historico_permisos enable row level security;
drop policy if exists fert_leer on public.fert_historico_permisos;
create policy fert_leer on public.fert_historico_permisos for select to authenticated
    using (persona_id = (select auth.uid())
           or public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'configurar'));
revoke all on public.fert_historico_permisos from anon, authenticated;
grant select on public.fert_historico_permisos to authenticated;


-- ---------------------------------------------------------------- 2 · funciones del permiso

create or replace function public._fert_hoy()
returns date language sql stable as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
revoke execute on function public._fert_hoy() from public, anon, authenticated;

/** ¿La persona tiene el permiso vigente? p_dia = día de captura (UTC-6); el servidor da 7 días de gracia para sincronizar. */
create or replace function public._fert_historico_vigente(p_persona uuid, p_estacion uuid, p_dia date)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.fert_historico_permisos h
        where h.persona_id = p_persona and h.estacion_id = p_estacion and h.revocado_at is null
          and h.hasta >= p_dia and h.hasta + 7 >= public._fert_hoy())
$$;
revoke execute on function public._fert_historico_vigente(uuid, uuid, date) from public, anon, authenticated;

create or replace function public._fert_historico_admin()
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'configurar')) then
        raise exception 'Tu rol no tiene «Configurar» en Fertirriego: solo quien administra otorga el registro histórico.'
            using errcode = '42501';
    end if;
end;
$$;
revoke execute on function public._fert_historico_admin() from public, anon, authenticated;

/** Otorga (o renueva) el permiso a una persona en una o varias estaciones. Devuelve cuántas estaciones quedaron. */
create or replace function public.fn_fert_historico_otorgar(p_persona uuid, p_estaciones uuid[], p_hasta date, p_nota text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_est uuid;
    v_n   integer := 0;
begin
    perform public._fert_historico_admin();
    if not exists (select 1 from public.perfiles where id = p_persona) then
        raise exception 'La persona no existe.';
    end if;
    if p_estaciones is null or cardinality(p_estaciones) = 0 then
        raise exception 'Elige al menos una estación.';
    end if;
    if p_hasta is null or p_hasta < public._fert_hoy() then
        raise exception 'La fecha límite no puede ser anterior a hoy.';
    end if;
    if p_hasta > public._fert_hoy() + 90 then
        raise exception 'El permiso es temporal: la fecha límite no puede pasar de 90 días desde hoy.';
    end if;
    foreach v_est in array p_estaciones loop
        if not exists (select 1 from public.estaciones_riego where id = v_est) then
            raise exception 'Una estación no existe.';
        end if;
        update public.fert_historico_permisos
           set hasta = p_hasta, otorgado_por = (select auth.uid()), otorgado_at = now(),
               nota = coalesce(nullif(btrim(p_nota), ''), nota)
         where persona_id = p_persona and estacion_id = v_est and revocado_at is null;
        if not found then
            insert into public.fert_historico_permisos (persona_id, estacion_id, hasta, otorgado_por, nota)
            values (p_persona, v_est, p_hasta, (select auth.uid()), nullif(btrim(p_nota), ''));
        end if;
        v_n := v_n + 1;
    end loop;
    return v_n;
end;
$$;

create or replace function public.fn_fert_historico_revocar(p_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    perform public._fert_historico_admin();
    update public.fert_historico_permisos
       set revocado_at = now(), revocado_por = (select auth.uid())
     where id = p_id and revocado_at is null;
    if not found then
        raise exception 'Ese permiso no existe o ya estaba revocado.';
    end if;
end;
$$;

/** Lista para el administrador: vigentes primero. */
create or replace function public.fn_fert_historico_listar(p_solo_vigentes boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._fert_historico_admin();
    return coalesce((
        select jsonb_agg(x order by x->>'orden', x->>'persona')
        from (
            select jsonb_build_object(
                'id', h.id, 'persona_id', h.persona_id, 'persona', p.nombre,
                'estacion_id', h.estacion_id, 'estacion', e.nombre,
                'hasta', h.hasta, 'dias_restantes', greatest(h.hasta - public._fert_hoy(), -1),
                'otorgado_por', o.nombre, 'otorgado_at', h.otorgado_at, 'revocado_at', h.revocado_at, 'nota', h.nota,
                'estado', case when h.revocado_at is not null then 'REVOCADO'
                               when h.hasta < public._fert_hoy() then 'VENCIDO' else 'VIGENTE' end,
                'orden', case when h.revocado_at is null and h.hasta >= public._fert_hoy() then '0' else '1' end) as x
            from public.fert_historico_permisos h
            join public.perfiles p on p.id = h.persona_id
            join public.estaciones_riego e on e.id = h.estacion_id
            left join public.perfiles o on o.id = h.otorgado_por
            where not p_solo_vigentes or (h.revocado_at is null and h.hasta >= public._fert_hoy())
            order by h.otorgado_at desc limit 300) t), '[]'::jsonb);
end;
$$;

/** Los permisos vigentes de quien llama (para el teléfono: botón «Registrar histórico»). */
create or replace function public.fn_fert_historico_mis_permisos()
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'estacion_id', h.estacion_id, 'hasta', h.hasta,
                                                 'dias_restantes', h.hasta - public._fert_hoy(), 'nota', h.nota)
                             order by h.hasta), '[]'::jsonb)
    from public.fert_historico_permisos h
    where h.persona_id = (select auth.uid()) and h.revocado_at is null and h.hasta >= public._fert_hoy()
$$;

revoke execute on function public.fn_fert_historico_otorgar(uuid, uuid[], date, text) from public, anon;
revoke execute on function public.fn_fert_historico_revocar(uuid) from public, anon;
revoke execute on function public.fn_fert_historico_listar(boolean) from public, anon;
revoke execute on function public.fn_fert_historico_mis_permisos() from public, anon;
grant execute on function public.fn_fert_historico_otorgar(uuid, uuid[], date, text) to authenticated;
grant execute on function public.fn_fert_historico_revocar(uuid) to authenticated;
grant execute on function public.fn_fert_historico_listar(boolean) to authenticated;
grant execute on function public.fn_fert_historico_mis_permisos() to authenticated;


-- ---------------------------------------------------------------- 3 · la operación «aplicacion_historica»

create or replace function public._fert_op_aplicacion_historica(p_id uuid, d jsonb, p_creado timestamptz)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_yo       uuid := (select auth.uid());
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_turno    uuid := public._fert_uuid(d->>'turno_ciclo_id');
    v_captura  date := (least(p_creado, now()) at time zone 'America/Tegucigalpa')::date;   -- día en que se capturó (UTC-6)
    v_fecha    date;
    v_fecha_h  timestamptz;
    v_ejec     uuid := coalesce(public._fert_uuid(d->>'ejecutor_id'), v_yo);
    v_ejec2    uuid := public._fert_uuid(d->>'ejecutor2_id');
    v_extra    boolean := coalesce((d->>'extra')::boolean, false);
    v_ddt_plan integer := case when v_extra then null else nullif(btrim(coalesce(d->>'ddt_plan', '')), '')::integer end;
    v_f_plan   date := case when v_extra then null else nullif(btrim(coalesce(d->>'fecha_plan', '')), '')::date end;
    v_tc       public.turnos_ciclo%rowtype;
    v_obs      text[] := '{}';
    v_en_plan  boolean;
    v_mats     uuid[];
    v_com      text := nullif(btrim(d->>'comentario'), '');
    l          record;
begin
    if v_yo is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if v_estacion is null or not exists (select 1 from public.estaciones_riego where id = v_estacion) then
        raise exception 'La estación no existe. Actualiza la aplicación.';
    end if;
    if not public.fn_fert_puede(v_estacion, 'ver') then
        raise exception 'Tu rol no tiene acceso a esta estación en Fertirriego.' using errcode = '42501';
    end if;
    if not public._fert_historico_vigente(v_yo, v_estacion, v_captura) then
        raise exception 'No tienes el permiso «Registro histórico» vigente en esta estación (vencido, revocado o no otorgado). Pídelo al administrador.'
            using errcode = '42501';
    end if;

    begin
        v_fecha := nullif(btrim(coalesce(d->>'fecha', '')), '')::date;
    exception when others then
        raise exception 'La fecha de la aplicación no es válida.';
    end;
    if v_fecha is null then
        raise exception 'Indica el día en que se aplicó.';
    end if;
    if v_fecha >= v_captura then
        raise exception 'El registro histórico es solo de días pasados: elige un día anterior a hoy.';
    end if;

    select * into v_tc from public.turnos_ciclo where id = v_turno;
    if not found then
        raise exception 'El turno no existe. Actualiza la aplicación.';
    end if;
    if v_tc.estacion_id is distinct from coalesce((select e9.prueba_de from public.estaciones_riego e9 where e9.id = v_estacion), v_estacion) then
        v_obs := public._fert_obs(v_obs, array['OTRA_ESTACION']);
    end if;
    if v_tc.fecha_siembra is not null and v_fecha < v_tc.fecha_siembra then
        raise exception 'La aplicación no puede ser anterior a la siembra del turno (%).', to_char(v_tc.fecha_siembra, 'DD/MM/YYYY');
    end if;
    if not exists (select 1 from public.perfiles where id = v_ejec)
       or (v_ejec2 is not null and not exists (select 1 from public.perfiles where id = v_ejec2)) then
        raise exception 'El estacionero que ejecutó no existe.';
    end if;

    -- DDT del plan: se completa el que falte (fecha ↔ DDT) desde el plan del turno
    if v_ddt_plan is not null and v_f_plan is null then
        v_f_plan := (select min(p.fecha) from public.fert_plan p where p.turno_ciclo_id = v_turno and p.ddt = v_ddt_plan);
    elsif v_f_plan is not null and v_ddt_plan is null then
        v_ddt_plan := (select min(p.ddt) from public.fert_plan p where p.turno_ciclo_id = v_turno and p.fecha = v_f_plan);
    end if;
    if (v_ddt_plan is not null or v_f_plan is not null)
       and not exists (select 1 from public.fert_plan p where p.turno_ciclo_id = v_turno and p.fecha = v_f_plan) then
        v_obs := public._fert_obs(v_obs, array['DDT_SIN_PLAN']);
    end if;

    v_mats := array(select distinct x.material_id from public._fert_lineas(d->'lineas') x order by 1);   -- valida las líneas

    -- ¿Ya hay una aplicación (normal o histórica) del mismo turno + DDT/fecha + mismos productos?
    if exists (select 1 from public.fert_aplicaciones a
               where a.turno_ciclo_id = v_turno and a.anulado_at is null and a.id <> p_id
                 and (a.fecha = v_fecha or (v_f_plan is not null and a.fecha_plan = v_f_plan))
                 and array(select z.material_id from public.fert_aplicaciones_detalle z
                           where z.aplicacion_id = a.id order by z.material_id) = v_mats) then
        v_obs := public._fert_obs(v_obs, array['POSIBLE_DUPLICADO']);
    end if;

    v_fecha_h := (v_fecha::timestamp + interval '12 hours') at time zone 'America/Tegucigalpa';

    insert into public.fert_aplicaciones
        (id, estacion_id, turno_ciclo_id, fecha, fecha_hora, ejecutor_id, ejecutor2_id, comentario, registrado_por,
         ddt_plan, fecha_plan, extra, ddt_real, historica)
    values
        (p_id, v_estacion, v_turno, v_fecha, v_fecha_h, v_ejec, v_ejec2,
         'Registro inicial del proceso' || coalesce(' · ' || v_com, ''), v_yo,
         v_ddt_plan, v_f_plan, v_extra, v_fecha - v_tc.fecha_siembra, true);

    for l in select * from public._fert_lineas(d->'lineas') loop
        if v_extra then
            v_en_plan := false;
        elsif v_f_plan is not null then
            v_en_plan := exists (select 1 from public.fert_plan p where p.turno_ciclo_id = v_turno and p.fecha = v_f_plan
                                                                 and p.material_id = l.material_id);
        else
            v_en_plan := exists (select 1 from public.fert_plan p where p.turno_ciclo_id = v_turno and p.material_id = l.material_id);
        end if;
        if not v_en_plan and not v_extra then
            v_obs := public._fert_obs(v_obs, array['FUERA_DE_PLAN']);
        end if;
        insert into public.fert_aplicaciones_detalle (aplicacion_id, material_id, cantidad, en_plan)
        values (p_id, l.material_id, l.cantidad, v_en_plan);
        -- A propósito NO se llama a _fert_mover: lo histórico no toca saldos, libro ni envases.
    end loop;
    return v_obs;
end;
$$;
revoke execute on function public._fert_op_aplicacion_historica(uuid, jsonb, timestamptz) from public, anon, authenticated;

-- Una aplicación histórica no admite devoluciones (devolver producto SÍ movería el inventario)
create or replace function public._fert_devolucion_no_historica()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if exists (select 1 from public.fert_aplicaciones a where a.id = new.aplicacion_id and coalesce(a.historica, false)) then
        raise exception 'Una aplicación del registro histórico no admite devoluciones (no movió el inventario).';
    end if;
    return new;
end;
$$;
revoke execute on function public._fert_devolucion_no_historica() from public, anon, authenticated;
drop trigger if exists fert_devolucion_no_historica on public.fert_devoluciones;
create trigger fert_devolucion_no_historica before insert on public.fert_devoluciones
for each row execute function public._fert_devolucion_no_historica();


-- ---------------------------------------------------------------- 4 · ajustes a funciones existentes (por texto, con marca)

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
        raise exception '116: en % se esperaba 1 aparición de «%» y hay %', p_fn, p_viejo, v_n;
    end if;
    begin
        execute replace(v_def, p_viejo, p_nuevo);
    exception when others then
        raise exception '116: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- Despachador: tipo válido y a qué función va
select pg_temp.parchar('public._fert_procesar(jsonb)',
    '''recepcion'', ''aplicacion'', ''bitacora'',',
    '''recepcion'', ''aplicacion'', ''aplicacion_historica'', ''bitacora'',',
    '''aplicacion_historica''');
select pg_temp.parchar('public._fert_procesar(jsonb)',
    E'        when ''bitacora''           then public._fert_op_bitacora(',
    E'        when ''aplicacion_historica'' then public._fert_op_aplicacion_historica(v_id, v_datos, v_creado)\n'
    || E'        when ''bitacora''           then public._fert_op_bitacora(',
    '_fert_op_aplicacion_historica(');

-- Turno archivado (102): también se rechaza con mensaje claro lo histórico
select pg_temp.parchar('public._fert_exigir_turno_vivo(text, jsonb)',
    'p_tipo in (''aplicacion'', ''bitacora'')',
    'p_tipo in (''aplicacion'', ''aplicacion_historica'', ''bitacora'')',
    '''aplicacion_historica''');

-- Anulación (redefinición completa a partir de la versión de la 115, sin depender del texto que tenga la base)
create or replace function public._fert_op_anulacion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tipo     text := d->>'documento_tipo';
    v_doc      uuid := public._fert_uuid(d->>'documento_id');
    v_motivo   text := nullif(btrim(d->>'motivo'), '');
    v_estacion uuid;
    v_autor    uuid;
    v_anulado  timestamptz;
    v_registro timestamptz;
    v_custodia public.fert_custodia%rowtype;
    v_obs      text[] := '{}';
    v_mat      uuid;
    m          record;
begin
    if v_motivo is null then
        raise exception 'Indica el motivo de la anulación.';
    end if;

    -- Diferencia de un producto en un relevo: permiso propio y motivo detallado
    if v_tipo = 'relevo' then
        v_mat := public._fert_uuid(d->>'material_id');
        if v_mat is null then
            raise exception 'Indica el producto cuya diferencia se anula.';
        end if;
        select r.estacion_id into v_estacion from public.fert_relevos r where r.id = v_doc;
        if v_estacion is null then
            raise exception 'El relevo no existe.';
        end if;
        select x.anulado_at into v_anulado from public.fert_relevos_diferencias x
         where x.relevo_id = v_doc and x.material_id = v_mat for update;
        if not found then
            raise exception 'Ese relevo no tiene diferencia de ese producto.';
        end if;
        if v_anulado is not null then
            raise exception 'Esa diferencia ya estaba anulada.';
        end if;
        if not public.fn_fert_puede(v_estacion, 'anular') then
            raise exception 'Solo quien tenga «Anular» en esta estación puede anular la diferencia de un relevo.'
                using errcode = '42501';
        end if;
        if char_length(v_motivo) < 25 then
            raise exception 'Explica con detalle por qué se anula (mínimo 25 letras): qué producto se aplicó, cuándo y quién no lo registró.';
        end if;

        for m in select * from public.fert_movimientos mv
                 where mv.documento_tipo = 'relevo' and mv.documento_id = v_doc and mv.material_id = v_mat
                   and mv.tipo = 'DIFERENCIA_RELEVO' and mv.anula_id is null
                   and not exists (select 1 from public.fert_movimientos a where a.anula_id = mv.id)
                 order by mv.cursor loop
            v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, m.estacion_id, m.material_id, 'ANULACION',
                         -m.cantidad, p_creado, m.turno_ciclo_id, 'relevo', v_doc, p_inmediato, m.id));
        end loop;

        update public.fert_relevos_diferencias
           set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo
         where relevo_id = v_doc and material_id = v_mat;
        if not exists (select 1 from public.fert_relevos_diferencias where relevo_id = v_doc and anulado_at is null) then
            update public.fert_relevos set revisar = false where id = v_doc;
        end if;
        return v_obs;
    end if;

    case v_tipo
        when 'recepcion' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_recepciones where id = v_doc;
        when 'aplicacion' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_aplicaciones where id = v_doc;
            if exists (select 1 from public.fert_devoluciones where aplicacion_id = v_doc and anulado_at is null) then
                raise exception 'Esa aplicación tiene devoluciones: anúlalas primero.';
            end if;
        when 'conteo' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_conteos where id = v_doc;
        when 'devolucion' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_devoluciones where id = v_doc;
        else
            raise exception 'No se puede anular ese tipo de registro.';
    end case;

    if v_estacion is null then
        raise exception 'El registro a anular no existe.';
    end if;
    if v_anulado is not null then
        raise exception 'Ese registro ya estaba anulado.';
    end if;

    -- Cuándo se REGISTRÓ (el id del documento es el de su operación)
    select coalesce(o.creado_en, o.recibido_en) into v_registro from public.fert_operaciones o where o.id = v_doc;

    if v_tipo = 'aplicacion' and exists (select 1 from public.fert_aplicaciones h where h.id = v_doc and coalesce(h.historica, false)) then   -- 116
        -- Una histórica la anula solo quien tiene «Anular» (la excepción de «tus registros de tu jornada» no aplica)
        if not public.fn_fert_puede(v_estacion, 'anular') then
            raise exception 'Solo quien tenga «Anular» en esta estación puede anular un registro histórico.' using errcode = '42501';
        end if;
    elsif not public.fn_fert_puede(v_estacion, 'anular') then
        select * into v_custodia from public.fert_custodia where estacion_id = v_estacion;
        if not (v_autor = (select auth.uid())
                and v_custodia.custodio_id = (select auth.uid())
                and v_custodia.estado = 'ACTIVA'
                and v_custodia.desde <= coalesce(v_registro, now())) then
            raise exception 'Solo puedes anular tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'
                using errcode = '42501';
        end if;
    end if;

    for m in select * from public.fert_movimientos mv
             where mv.documento_id = v_doc and mv.anula_id is null and mv.tipo <> 'ANULACION'
             order by mv.cursor loop
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, m.estacion_id, m.material_id, 'ANULACION',
                     -m.cantidad, p_creado, m.turno_ciclo_id, v_tipo, v_doc, p_inmediato, m.id));
    end loop;

    execute format('update public.%I set anulado_at = now(), anulado_por = $1, motivo_anulacion = $2 where id = $3',
                   case v_tipo when 'recepcion' then 'fert_recepciones' when 'aplicacion' then 'fert_aplicaciones'
                               when 'conteo' then 'fert_conteos' else 'fert_devoluciones' end)
        using (select auth.uid()), v_motivo, v_doc;
    return v_obs;
end;
$$;

revoke all on function public._fert_op_anulacion(uuid, jsonb, timestamptz, boolean) from public, anon, authenticated;

-- Teléfono: cada aplicación dice si es histórica
select pg_temp.parchar('public._fert_estado_campo_base(date)',
    '''ddt_plan'', a.ddt_plan, ''fecha_plan'', a.fecha_plan, ''extra'', a.extra, ''ddt_real'', a.ddt_real,',
    '''ddt_plan'', a.ddt_plan, ''fecha_plan'', a.fecha_plan, ''extra'', a.extra, ''ddt_real'', a.ddt_real, ''historica'', coalesce(a.historica, false),',
    '''historica''');
-- Teléfono: los permisos vigentes de quien llama (para mostrar «Registrar histórico»)
select pg_temp.parchar('public.fn_fert_estado_campo(date)',
    E'    -- Nombres de todas las personas que aparecen',
    E'    v_res := v_res || jsonb_build_object(''historico_permisos'', public.fn_fert_historico_mis_permisos());   -- 116\n'
    || E'    -- Nombres de todas las personas que aparecen',
    'historico_permisos');

-- AGL: las históricas van APARTE (no en «aplicaciones», que es lo que usa el Comparativo)
select pg_temp.parchar('public.fn_fert_exportar(bigint, integer)',
    E'            left join public.fert_operaciones o on o.id = a.id\n            where a.estacion_id = any(v_reales)), ''[]''::jsonb),\n',
    E'            left join public.fert_operaciones o on o.id = a.id\n            where a.estacion_id = any(v_reales) and not coalesce(a.historica, false)), ''[]''::jsonb),\n\n'
    || E'        ''aplicaciones_historicas'', coalesce((   -- 116: registro inicial del proceso; NO mueve inventario ni es «Real»\n'
    || E'            select jsonb_agg(jsonb_build_object(\n'
    || E'                ''id'', a.id, ''estacion'', e.nombre, ''zona'', z.nombre, ''turno'', t.codigo, ''turno_agl_id'', tc.agl_id,\n'
    || E'                ''fecha'', a.fecha, ''ddt_plan'', a.ddt_plan, ''fecha_plan'', a.fecha_plan, ''extra'', a.extra, ''ddt_real'', a.ddt_real,\n'
    || E'                ''ejecutor'', (select x.nombre from public.perfiles x where x.id = a.ejecutor_id),\n'
    || E'                ''registrado_por'', p.nombre, ''comentario'', a.comentario, ''registrado_at'', o.recibido_en,\n'
    || E'                ''anulado_at'', a.anulado_at, ''motivo_anulacion'', a.motivo_anulacion,\n'
    || E'                ''lineas'', coalesce((select jsonb_agg(jsonb_build_object(''material'', m.codigo, ''texto'', m.descripcion, ''unidad'', m.unidad,\n'
    || E'                                        ''cantidad'', d.cantidad, ''en_plan'', d.en_plan, ''origen'', m.origen, ''analisis'', m.fert_analisis))\n'
    || E'                                    from public.fert_aplicaciones_detalle d join public.materiales m on m.id = d.material_id\n'
    || E'                                    where d.aplicacion_id = a.id), ''[]''::jsonb))\n'
    || E'                order by a.fecha, a.fecha_hora)\n'
    || E'            from public.fert_aplicaciones a\n'
    || E'            join public.estaciones_riego e on e.id = a.estacion_id\n'
    || E'            left join public.zonas z on z.id = e.zona_id\n'
    || E'            join public.turnos_ciclo tc on tc.id = a.turno_ciclo_id\n'
    || E'            join public.turnos t on t.id = tc.turno_id\n'
    || E'            left join public.perfiles p on p.id = a.registrado_por\n'
    || E'            left join public.fert_operaciones o on o.id = a.id\n'
    || E'            where a.estacion_id = any(v_reales) and coalesce(a.historica, false)), ''[]''::jsonb),\n',
    '''aplicaciones_historicas''');

-- AGL «Terminar ciclo» (bloque «agl» del paquete, con la forma de fn_fert_exportar): igual, las históricas APARTE
select pg_temp.parchar('public.fn_fert_exportar_turno(text)',
    E'                where a.id = any(i.aplicaciones)), ''[]''::jsonb),\n',
    E'                where a.id = any(i.aplicaciones) and not coalesce(a.historica, false)), ''[]''::jsonb),\n'
    || E'            ''aplicaciones_historicas'', coalesce((   -- 116\n'
    || E'                select jsonb_agg(jsonb_build_object(\n'
    || E'                    ''id'', a.id, ''estacion'', e.nombre, ''zona'', z.nombre, ''turno'', v_cod, ''turno_agl_id'', v_tc.agl_id,\n'
    || E'                    ''fecha'', a.fecha, ''ddt_plan'', a.ddt_plan, ''fecha_plan'', a.fecha_plan, ''extra'', a.extra, ''ddt_real'', a.ddt_real,\n'
    || E'                    ''ejecutor'', (select x.nombre from public.perfiles x where x.id = a.ejecutor_id),\n'
    || E'                    ''registrado_por'', p.nombre, ''comentario'', a.comentario, ''registrado_at'', o.recibido_en,\n'
    || E'                    ''anulado_at'', a.anulado_at, ''motivo_anulacion'', a.motivo_anulacion,\n'
    || E'                    ''lineas'', coalesce((select jsonb_agg(jsonb_build_object(''material'', m.codigo, ''texto'', m.descripcion, ''unidad'', m.unidad,\n'
    || E'                                            ''cantidad'', d.cantidad, ''en_plan'', d.en_plan, ''origen'', m.origen, ''analisis'', m.fert_analisis))\n'
    || E'                                        from public.fert_aplicaciones_detalle d join public.materiales m on m.id = d.material_id\n'
    || E'                                        where d.aplicacion_id = a.id), ''[]''::jsonb))\n'
    || E'                    order by a.fecha, a.fecha_hora)\n'
    || E'                from public.fert_aplicaciones a\n'
    || E'                join public.estaciones_riego e on e.id = a.estacion_id\n'
    || E'                left join public.zonas z on z.id = e.zona_id\n'
    || E'                left join public.perfiles p on p.id = a.registrado_por\n'
    || E'                left join public.fert_operaciones o on o.id = a.id\n'
    || E'                where a.id = any(i.aplicaciones) and coalesce(a.historica, false)), ''[]''::jsonb),\n',
    '''aplicaciones_historicas''');

-- Huella de «Terminar ciclo» (102): lo no histórico queda IGUAL que antes de la columna (lección de la 112)
select pg_temp.parchar('public._fert_turno_filas(uuid)',
    '''fert_aplicaciones'', coalesce((select jsonb_agg(to_jsonb(x) order by x.id)',
    '''fert_aplicaciones'', coalesce((select jsonb_agg(case when coalesce(x.historica, false) then to_jsonb(x)   -- 116: igual que antes de la columna'
    || E'\n                                                      else to_jsonb(x) - ''historica'' end order by x.id)',
    '116: igual que antes de la columna');

notify pgrst, 'reload schema';
