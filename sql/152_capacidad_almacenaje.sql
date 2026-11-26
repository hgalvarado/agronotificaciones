-- =====================================================================
-- 152 · FERTIRRIEGO · CAPACIDAD DE ALMACENAJE DE LAS SOLUCIONES POR ESTACIÓN
-- =====================================================================
-- Pedido del usuario (2026-11-25): saber cuánto puede guardar cada estación de cada solución líquida
-- (Calcio 5000, Vegetativa 3000, Generativa 3000 por defecto; hay excepciones) para que AGL sepa cuánto puede ENVIAR
-- y la estación sepa cuánto puede RECIBIR. Vegetativa y Generativa se pueden PRESTAR el tanque entre sí; Calcio NUNCA.
--
-- Diseño: docs/superpowers/specs/2026-11-25-capacidad-almacenaje.md. Resumen:
--   · La «solución» ES un material del catálogo (MARA, grupo 1800: 103190 Vegetativa, 103191 Generativa, 103192 Calcio).
--     No hay lista paralela: la capacidad cuelga de materiales.id. Unidad = la del material (L), la misma del saldo.
--   · fert_capacidad_estandar  = valor por defecto por solución (+ con quién se puede prestar; Calcio = null). Lo publica AGL.
--   · fert_capacidad_estacion  = excepciones por estación y solución. Lo publica AGL.
--   · fert_capacidad_prestamos = «el tanque de A llena B» en una estación, con vigencia y quién lo declaró
--     (la estación con el permiso «capacidad», o AGL al publicar). Solo entre soluciones mutuamente prestables.
--   · _fert_cap_efectiva(estación, fecha) = capacidad base y efectiva (con préstamo) por solución.
--   · fn_fert_estado_campo trae `capacidades` y `permisos.capacidad` al teléfono.
--   · Recibir NO se bloquea: si el saldo pasa la capacidad efectiva queda la observación EXCEDE_CAPACIDAD
--     (el teléfono pide confirmar, como SALDO_NEGATIVO).
--   · fn_fert_publicar_capacidades (AGL publica) y fn_fert_capacidad_exportar (AGL lee los préstamos de las estaciones).
--
-- Correr DESPUÉS de la 151. Idempotente. Todo UPDATE/DELETE lleva WHERE.
-- Si se vuelve a correr la 99/100 (_fert_op_recepcion, fn_fert_estado_campo), la 116, la 119 o la 131, correr la 152 otra vez.
-- =====================================================================

-- ---------------------------------------------------------------- 1 · permiso
do $$
begin
    insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
        ('capacidad', 'Declarar préstamo de tanque',
         'Fertirriego: declara que el tanque de Vegetativa o Generativa se usa para la otra solución (Calcio nunca).', 132, true)
    on conflict (codigo) do update
    set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden, escribe = excluded.escribe;

    update public.acciones set nivel = 3 where codigo = 'capacidad';

    update public.pantallas set acciones = acciones || 'capacidad'::text
     where codigo = 'fertirriego' and not ('capacidad' = any(acciones));
    -- Sin concesiones automáticas: el administrador la tiene; los roles se la dan en Permisos.
end $$;

-- ---------------------------------------------------------------- 2 · tablas
create table if not exists public.fert_capacidad_estandar (
    material_id    uuid primary key references public.materiales(id),
    capacidad      numeric(14,2) not null check (capacidad > 0),
    prestable_con  uuid references public.materiales(id),
    actualizado_at timestamptz not null default now(),
    check (prestable_con is distinct from material_id)
);
comment on table public.fert_capacidad_estandar is
'152: capacidad por defecto de cada solución (en la unidad del material) y con cuál se puede prestar el tanque (null = nunca, p. ej. Calcio). Lo publica AGL.';

create table if not exists public.fert_capacidad_estacion (
    estacion_id    uuid not null references public.estaciones_riego(id) on delete cascade,
    material_id    uuid not null references public.fert_capacidad_estandar(material_id) on delete cascade,
    capacidad      numeric(14,2) not null check (capacidad >= 0),
    actualizado_at timestamptz not null default now(),
    primary key (estacion_id, material_id)
);
comment on table public.fert_capacidad_estacion is '152: excepciones de capacidad por estación y solución. Lo publica AGL.';

create table if not exists public.fert_capacidad_prestamos (
    id                  uuid primary key default gen_random_uuid(),
    estacion_id         uuid not null references public.estaciones_riego(id) on delete cascade,
    cede_material_id    uuid not null references public.materiales(id),
    recibe_material_id  uuid not null references public.materiales(id),
    desde               date not null,
    hasta               date,
    origen              text not null check (origen in ('ESTACION', 'AGL')),
    declarado_por       uuid references public.perfiles(id),
    motivo              text,
    activo              boolean not null default true,
    creado_at           timestamptz not null default now(),
    cerrado_at          timestamptz,
    cerrado_por         uuid references public.perfiles(id),
    check (cede_material_id <> recibe_material_id),
    check (hasta is null or hasta >= desde)
);
comment on table public.fert_capacidad_prestamos is
'152: «el tanque de la solución A se usa para B» en una estación, con vigencia. Quién lo declaró: la estación (permiso «capacidad») o AGL.';
create unique index if not exists uq_fert_cap_prestamo_vivo on public.fert_capacidad_prestamos (estacion_id, cede_material_id) where activo;
create index if not exists idx_fert_cap_prestamo_est on public.fert_capacidad_prestamos (estacion_id) where activo;

do $$
declare t text;
begin
    foreach t in array array['fert_capacidad_estandar', 'fert_capacidad_estacion', 'fert_capacidad_prestamos'] loop
        execute format('alter table public.%I enable row level security', t);
    end loop;
end $$;
-- Sin políticas: se lee y escribe solo con las funciones (security definer) de abajo.

create or replace function public._fert_cap_hoy() returns date
language sql stable as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;

/** Un préstamo solo es válido entre soluciones MUTUAMENTE prestables (Vegetativa↔Generativa) y sin encadenar. */
create or replace function public._fert_cap_validar_prestamo() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
    if not new.activo then
        return new;   -- cerrar un préstamo siempre se puede
    end if;
    if not exists (select 1 from public.fert_capacidad_estandar a
                    where a.material_id = new.cede_material_id and a.prestable_con = new.recibe_material_id)
       or not exists (select 1 from public.fert_capacidad_estandar b
                       where b.material_id = new.recibe_material_id and b.prestable_con = new.cede_material_id) then
        raise exception 'Ese tanque no se puede prestar: solo Vegetativa y Generativa se prestan entre sí (Calcio nunca, no se mezcla).';
    end if;
    if exists (select 1 from public.fert_capacidad_prestamos x
                               where x.estacion_id = new.estacion_id and x.activo and x.id <> new.id
                                 and (x.recibe_material_id = new.cede_material_id or x.cede_material_id = new.recibe_material_id)) then
        raise exception 'Ya hay un préstamo vigente en sentido contrario en esta estación. Quítalo primero.';
    end if;
    return new;
end $$;

drop trigger if exists trg_fert_cap_validar_prestamo on public.fert_capacidad_prestamos;
create trigger trg_fert_cap_validar_prestamo before insert or update of cede_material_id, recibe_material_id, activo
    on public.fert_capacidad_prestamos for each row execute function public._fert_cap_validar_prestamo();

-- ---------------------------------------------------------------- 3 · capacidad efectiva
/**
 * Por solución de la estación: capacidad base (excepción de la estación o estándar), capacidad efectiva (con préstamo
 * vigente a esa fecha: quien cede queda en 0; quien recibe suma la base del que cede) y los datos del préstamo.
 * Las estaciones de prueba usan la configuración de la real. Interna (el teléfono la ve vía fn_fert_estado_campo).
 */
create or replace function public._fert_cap_efectiva(p_estacion uuid, p_fecha date default null)
returns table (
    material_id uuid, capacidad_base numeric, capacidad_efectiva numeric, prestable_con uuid,
    cede_a uuid, recibe_de uuid, prestamo_id uuid, prestamo_origen text, prestamo_desde date, prestamo_hasta date, prestamo_por text)
language sql stable security definer set search_path = public, pg_temp as $$
    with cfg as (select coalesce(e.prueba_de, e.id) as id from public.estaciones_riego e where e.id = p_estacion),
    f as (select coalesce(p_fecha, public._fert_cap_hoy()) as d),
    base as (
        select s.material_id, s.prestable_con, coalesce(o.capacidad, s.capacidad) as cap
          from public.fert_capacidad_estandar s
          cross join cfg
          left join public.fert_capacidad_estacion o on o.estacion_id = cfg.id and o.material_id = s.material_id),
    pr as (
        select p.* from public.fert_capacidad_prestamos p, f
         where p.estacion_id = p_estacion and p.activo and p.desde <= f.d and (p.hasta is null or p.hasta >= f.d))
    select b.material_id,
           b.cap,
           case when c.id is not null then 0::numeric
                else b.cap + coalesce((select sum(b2.cap) from pr r join base b2 on b2.material_id = r.cede_material_id
                                        where r.recibe_material_id = b.material_id), 0) end,
           b.prestable_con,
           c.recibe_material_id,
           r.cede_material_id,
           coalesce(c.id, r.id),
           coalesce(c.origen, r.origen),
           coalesce(c.desde, r.desde),
           coalesce(c.hasta, r.hasta),
           (select x.nombre from public.perfiles x where x.id = coalesce(c.declarado_por, r.declarado_por))
      from base b
      left join pr c on c.cede_material_id = b.material_id
      left join pr r on r.recibe_material_id = b.material_id
$$;
revoke execute on function public._fert_cap_efectiva(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4 · parches de funciones existentes
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    if v_n <> 1 then
        raise exception '152: en % se esperaba 1 aparición de «%» y hay %', p_fn, v_viejo, v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '152: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- Recibir: si lo recibido deja una solución por encima de su capacidad efectiva, queda la observación (no se bloquea)
select pg_temp.parchar('public._fert_op_recepcion(uuid, jsonb, timestamptz, boolean, uuid)',
    $p$    return v_obs;$p$,
    $p$    -- 152: aviso de capacidad de almacenaje (no bloquea; el teléfono pidió confirmar)
    if exists (
        select 1
          from public.fert_recepciones_detalle rd
          join public._fert_cap_efectiva(v_estacion) c on c.material_id = rd.material_id
          join public.fert_saldos s on s.estacion_id = v_estacion and s.material_id = rd.material_id
         where rd.recepcion_id = p_id and s.disponible > c.capacidad_efectiva) then
        v_obs := public._fert_obs(v_obs, array['EXCEDE_CAPACIDAD']);
    end if;
    return v_obs;$p$,
    $p$152: aviso de capacidad$p$);

-- Teléfono: permiso por estación
select pg_temp.parchar('public._fert_estado_campo_base(date)',
    $p$'eliminar_definitivo', public.fn_fert_puede(e.id, 'eliminar_definitivo')),$p$,
    $p$'eliminar_definitivo', public.fn_fert_puede(e.id, 'eliminar_definitivo'),
                    'capacidad', public.fn_fert_puede(e.id, 'capacidad')),$p$,
    $p$'capacidad', public.fn_fert_puede$p$);

-- Teléfono: capacidades por estación y solución
select pg_temp.parchar('public.fn_fert_estado_campo(date)',
    E'    -- Nombres de todas las personas que aparecen',
    E'    -- 152: capacidad de almacenaje por estación y solución (con el préstamo vigente)\n'
    || E'    v_res := v_res || jsonb_build_object(''capacidades'', coalesce((\n'
    || E'        select jsonb_agg(jsonb_build_object(\n'
    || E'            ''estacion_id'', ee, ''material_id'', c.material_id, ''capacidad_base'', c.capacidad_base,\n'
    || E'            ''capacidad'', c.capacidad_efectiva, ''prestable_con'', c.prestable_con,\n'
    || E'            ''cede_a'', c.cede_a, ''recibe_de'', c.recibe_de, ''prestamo_id'', c.prestamo_id,\n'
    || E'            ''prestamo_origen'', c.prestamo_origen, ''prestamo_desde'', c.prestamo_desde,\n'
    || E'            ''prestamo_hasta'', c.prestamo_hasta, ''prestamo_por'', c.prestamo_por))\n'
    || E'        from unnest(v_est) ee cross join lateral public._fert_cap_efectiva(ee) c), ''[]''::jsonb));\n\n'
    || E'    -- Nombres de todas las personas que aparecen',
    $p$152: capacidad de almacenaje por estación y solución$p$);

-- ---------------------------------------------------------------- 5 · la estación declara o quita el préstamo (necesita señal)
create or replace function public.fn_fert_capacidad_prestamo(
    p_estacion uuid, p_cede uuid, p_recibe uuid, p_activo boolean default true, p_hasta date default null, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if p_estacion is null or not public.fn_fert_puede(p_estacion, 'capacidad') then
        raise exception 'Tu rol no puede declarar el préstamo de tanque en esta estación.' using errcode = '42501';
    end if;
    if p_cede is null then
        raise exception 'Elige la solución cuyo tanque se presta.';
    end if;

    if coalesce(p_activo, true) then
        if p_recibe is null then
            raise exception 'Elige la solución que usará ese tanque.';
        end if;
        if p_hasta is not null and p_hasta < public._fert_cap_hoy() then
            raise exception 'La fecha «hasta» no puede ser anterior a hoy.';
        end if;
        select id into v_id from public.fert_capacidad_prestamos where estacion_id = p_estacion and cede_material_id = p_cede and activo;
        if v_id is null then
            insert into public.fert_capacidad_prestamos (estacion_id, cede_material_id, recibe_material_id, desde, hasta, origen, declarado_por, motivo)
            values (p_estacion, p_cede, p_recibe, public._fert_cap_hoy(), p_hasta, 'ESTACION', (select auth.uid()), left(nullif(btrim(p_motivo), ''), 300))
            returning id into v_id;
        else
            update public.fert_capacidad_prestamos
               set recibe_material_id = p_recibe, hasta = p_hasta, origen = 'ESTACION', declarado_por = (select auth.uid()),
                   motivo = left(nullif(btrim(p_motivo), ''), 300)
             where id = v_id;
        end if;
        return jsonb_build_object('ok', true, 'id', v_id);
    end if;

    update public.fert_capacidad_prestamos
       set activo = false, cerrado_at = now(), cerrado_por = (select auth.uid())
     where estacion_id = p_estacion and cede_material_id = p_cede and activo
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.fn_fert_capacidad_prestamo(uuid, uuid, uuid, boolean, date, text) to authenticated;

-- ---------------------------------------------------------------- 6 · AGL publica la configuración
create or replace function public.fn_fert_publicar_capacidades(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_completo boolean := coalesce((p->>'completo')::boolean, true);
    v_avisos   text[] := '{}';
    v_n_est    integer := 0;
    v_n_exc    integer := 0;
    v_n_pre    integer := 0;
    x          record;
    v_mat      uuid;
    v_otro     uuid;
    v_estac    uuid;
    v_ids      uuid[] := '{}';
    v_id       uuid;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'publicar')) then
        raise exception 'Este usuario no tiene «Publicar» en «Fertirriego · Conexión AGL».' using errcode = '42501';
    end if;

    -- Estándar (primero sin pareja; después la pareja solo si es mutua: Calcio nunca)
    for x in select * from jsonb_to_recordset(coalesce(p->'estandar', '[]')) as t(material text, capacidad numeric, prestable_con text) loop
        v_mat := (select id from public.materiales where codigo = btrim(x.material));
        if v_mat is null then
            v_avisos := v_avisos || format('Capacidad estándar: el material «%s» no existe en AgroNotificaciones.', x.material);
            continue;
        end if;
        if x.capacidad is null or x.capacidad <= 0 then
            v_avisos := v_avisos || format('Capacidad estándar de «%s»: debe ser mayor que 0.', x.material);
            continue;
        end if;
        insert into public.fert_capacidad_estandar as s (material_id, capacidad, prestable_con)
        values (v_mat, x.capacidad, null)
        on conflict (material_id) do update set capacidad = excluded.capacidad, prestable_con = null, actualizado_at = now();
        v_n_est := v_n_est + 1;
    end loop;
    for x in select * from jsonb_to_recordset(coalesce(p->'estandar', '[]')) as t(material text, capacidad numeric, prestable_con text)
              where nullif(btrim(prestable_con), '') is not null loop
        v_mat := (select id from public.materiales where codigo = btrim(x.material));
        v_otro := (select id from public.materiales where codigo = btrim(x.prestable_con));
        continue when v_mat is null or v_otro is null or not exists (select 1 from public.fert_capacidad_estandar where material_id = v_mat);
        if exists (select 1 from jsonb_to_recordset(coalesce(p->'estandar', '[]')) as t2(material text, prestable_con text)
                    where btrim(t2.material) = btrim(x.prestable_con) and btrim(t2.prestable_con) = btrim(x.material)) then
            update public.fert_capacidad_estandar set prestable_con = v_otro where material_id = v_mat;
        else
            v_avisos := v_avisos || format('«%s» ↔ «%s»: el préstamo debe declararse en las dos soluciones; se ignoró.', x.material, x.prestable_con);
        end if;
    end loop;
    if v_completo then
        delete from public.fert_capacidad_estandar
         where material_id not in (select m.id from public.materiales m
                                    where m.codigo in (select btrim(t.material) from jsonb_to_recordset(coalesce(p->'estandar', '[]')) as t(material text)));
    end if;

    -- Excepciones por estación
    if v_completo then
        delete from public.fert_capacidad_estacion where estacion_id is not null;
    end if;
    for x in select * from jsonb_to_recordset(coalesce(p->'estaciones', '[]')) as t(estacion text, material text, capacidad numeric) loop
        v_estac := (select id from public.estaciones_riego where public._fert_llave(nombre) = public._fert_llave(x.estacion) and prueba_de is null limit 1);
        v_mat := (select id from public.materiales where codigo = btrim(x.material));
        if v_estac is null or v_mat is null or not exists (select 1 from public.fert_capacidad_estandar where material_id = v_mat) then
            v_avisos := v_avisos || format('Capacidad de «%s» en «%s»: estación o solución desconocida.', x.material, x.estacion);
            continue;
        end if;
        if x.capacidad is null or x.capacidad < 0 then
            v_avisos := v_avisos || format('Capacidad de «%s» en «%s»: no puede ser negativa.', x.material, x.estacion);
            continue;
        end if;
        insert into public.fert_capacidad_estacion as s (estacion_id, material_id, capacidad)
        values (v_estac, v_mat, x.capacidad)
        on conflict (estacion_id, material_id) do update set capacidad = excluded.capacidad, actualizado_at = now();
        v_n_exc := v_n_exc + 1;
    end loop;

    -- Préstamos declarados por AGL (los de la estación no se tocan)
    for x in select * from jsonb_to_recordset(coalesce(p->'prestamos', '[]'))
             as t(estacion text, cede text, recibe text, desde date, hasta date, motivo text) loop
        v_estac := (select id from public.estaciones_riego where public._fert_llave(nombre) = public._fert_llave(x.estacion) and prueba_de is null limit 1);
        v_mat := (select id from public.materiales where codigo = btrim(x.cede));
        v_otro := (select id from public.materiales where codigo = btrim(x.recibe));
        if v_estac is null or v_mat is null or v_otro is null then
            v_avisos := v_avisos || format('Préstamo en «%s»: estación o solución desconocida.', x.estacion);
            continue;
        end if;
        begin
            select id into v_id from public.fert_capacidad_prestamos where estacion_id = v_estac and cede_material_id = v_mat and activo;
            if v_id is null then
                insert into public.fert_capacidad_prestamos (estacion_id, cede_material_id, recibe_material_id, desde, hasta, origen, motivo)
                values (v_estac, v_mat, v_otro, coalesce(x.desde, public._fert_cap_hoy()), x.hasta, 'AGL', left(nullif(btrim(x.motivo), ''), 300))
                returning id into v_id;
            else
                update public.fert_capacidad_prestamos
                   set recibe_material_id = v_otro, desde = coalesce(x.desde, desde), hasta = x.hasta, origen = 'AGL',
                       motivo = left(nullif(btrim(x.motivo), ''), 300)
                 where id = v_id and origen = 'AGL';
            end if;
            v_ids := v_ids || v_id;
            v_n_pre := v_n_pre + 1;
        exception when others then
            v_avisos := v_avisos || format('Préstamo en «%s»: %s', x.estacion, sqlerrm);
        end;
    end loop;
    if v_completo then
        update public.fert_capacidad_prestamos
           set activo = false, cerrado_at = now()
         where origen = 'AGL' and activo and not (id = any(v_ids));
    end if;

    return jsonb_build_object('estandar', v_n_est, 'excepciones', v_n_exc, 'prestamos', v_n_pre, 'avisos', to_jsonb(v_avisos));
end $$;
grant execute on function public.fn_fert_publicar_capacidades(jsonb) to authenticated;

-- ---------------------------------------------------------------- 7 · AGL lee lo vigente (incluye lo declarado por las estaciones)
create or replace function public.fn_fert_capacidad_exportar()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'ver')) then
        raise exception 'Este usuario no tiene «Ver» en «Fertirriego · Conexión AGL».' using errcode = '42501';
    end if;
    return jsonb_build_object(
        'estandar', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'capacidad', s.capacidad,
                       'prestable_con', (select m2.codigo from public.materiales m2 where m2.id = s.prestable_con)))
                   from public.fert_capacidad_estandar s join public.materiales m on m.id = s.material_id), '[]'::jsonb),
        'estaciones', coalesce((select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'material', m.codigo, 'capacidad', o.capacidad))
                   from public.fert_capacidad_estacion o join public.estaciones_riego e on e.id = o.estacion_id
                   join public.materiales m on m.id = o.material_id), '[]'::jsonb),
        'prestamos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'estacion', e.nombre,
                       'cede', mc.codigo, 'recibe', mr.codigo, 'desde', p.desde, 'hasta', p.hasta, 'origen', p.origen,
                       'declarado_por', (select x.nombre from public.perfiles x where x.id = p.declarado_por), 'motivo', p.motivo))
                   from public.fert_capacidad_prestamos p join public.estaciones_riego e on e.id = p.estacion_id
                   join public.materiales mc on mc.id = p.cede_material_id join public.materiales mr on mr.id = p.recibe_material_id
                  where p.activo and e.prueba_de is null), '[]'::jsonb));
end $$;
grant execute on function public.fn_fert_capacidad_exportar() to authenticated;

notify pgrst, 'reload schema';
