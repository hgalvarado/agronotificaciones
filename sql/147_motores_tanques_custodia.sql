-- =====================================================================
-- 147 · MOTORES Y COMBUSTIBLE · REDISEÑO: TANQUES FIJOS, CUSTODIA POR TRAMOS, DIÉSEL SOLO EN MOTORES,
--       MANTENIMIENTO POR HORÓMETRO Y AYUDAS VISUALES
-- =====================================================================
-- Pedido del usuario (2026-11-24; spec docs/superpowers/specs/2026-11-24-motores-rediseno.md):
--   A. El DIÉSEL ya NO pasa por la bodega de la estación: se recibe en el TANQUE (Motores y combustible) y el suministro
--      del registro diario no rebaja la bodega (revierte lo de la 144 para el diésel). Lo que la 144 dejó en la bodega
--      (fert_saldos / fert_movimientos, recepciones con tanque_id null) NO se borra: se etiqueta DIESEL_LEGADO en la bodega
--      general y se saca con una Devolución a bodega o un Conteo (flujos que ya existen).
--   B. TANQUES FIJOS (los 30 de la lista del usuario): un tanque es un registro propio (nombre, zona, capacidad, activo,
--      saldo) que NO viaja con el motor. Se ASIGNA a una estación (estacion_id; null = sin estación todavía) y el motor se
--      conecta a un tanque libre de su estación. Siembra idempotente por nombre (sin distinguir mayúsculas), zona y
--      estación ligadas solo si coinciden con `zonas` / `estaciones_riego`.
--   C. Registro diario: GASTADO = visor inicial − visor final (como la hoja FTR_F-MA-103); el tanque baja por lo gastado y
--      sube con cada suministro/recepción; el saldo del libro se compara con el visor (dif_visor_gal + alerta). Campos de la
--      hoja que faltaban: lectura de caudal inicial/final y operador (firma). Todo se guarda y se muestra.
--   D. HISTORIAL POR CUSTODIA: `mot_custodias` (tramos: motor, estación/tanque, desde, hasta, horómetro de entrada y
--      salida). La estación solo ve lo registrado en ella; al mover el motor, lo anterior NO aparece en el destino. Con el
--      permiso nuevo «auditar» (motores) se ve la ficha completa con línea de tiempo.
--   E. MANTENIMIENTO por horómetro del motor (sigue al motor aunque cambie de estación): semáforo verde/amarillo/rojo
--      calculado en la base (_mot_semaforo) y «qué toca hacer ahora» (_mot_estado_motor) para el teléfono.
--   F. Auditoría: nada se pierde (tramos, historial de asignación de tanques, anulación con motivo, permisos existentes).
--   G. AYUDAS VISUALES: señales calculadas en la base (_mot_senales): horómetro que retrocede o salta, huecos de días,
--      visor que no cuadra con el día anterior + suministros, saldo del tanque contra el visor, rendimiento fuera de lo
--      normal del propio motor, consumo sin horas, etc. El teléfono recibe las mismas reglas en datos (spec §Ayudas).
--
-- Correr DESPUÉS de la 130, 136, 138, 140, 144 y 145 (necesita sus piezas; comprueba y avisa). Idempotente.
-- Todo UPDATE/DELETE lleva WHERE. Parches por texto con pg_temp.parchar y marcas propias «147:».
-- ORDEN: si se vuelve a correr 130, 136, 138, 140, 144 o 145 (redefinen o parchan _mot_op_registro_diario,
-- _mot_op_diesel_recibir, _mot_aplicar_asignacion, fn_mot_estado_campo, _mot_filas o fn_fert_bodega_general) → CORRER LA 147
-- OTRA VEZ. Las funciones que esta migración redefine por completo llevan, en comentarios, las marcas de los parches de
-- la 136/138/140/144 para que correr esas migraciones DESPUÉS no falle (las saltan), aunque sí habría que repetir la 147
-- si pisan _mot_op_diesel_recibir.
-- =====================================================================

do $$
begin
    if to_regclass('public.mot_registros') is null or to_regclass('public.mot_tanques') is null then
        raise exception '147: falta correr antes la 130 (Motores y combustible).';
    end if;
    if to_regprocedure('public._mot_autorizar_accion(uuid,text,boolean)') is null then
        raise exception '147: falta correr antes la 138 (permisos de motores).';
    end if;
    if to_regprocedure('public.fn_campo_eliminar_documento(text,uuid,text)') is null then
        raise exception '147: falta correr antes la 140.';
    end if;
    if position('144:sum-mov' in pg_get_functiondef('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) = 0
       and position('147:registro' in pg_get_functiondef('public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid)'::regprocedure)) = 0 then
        raise exception '147: falta correr antes la 144 (diésel).';
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mot_motores' and column_name = 'prueba_de') then
        raise exception '147: falta correr antes la 145 (modo de pruebas de Campo).';
    end if;
end $$;


-- ---------------------------------------------------------------- 1 · columnas nuevas
alter table public.mot_tanques add column if not exists zona_id uuid references public.zonas(id);
alter table public.mot_tanques add column if not exists asignado_at timestamptz;
alter table public.mot_tanques add column if not exists asignado_por uuid;
comment on column public.mot_tanques.estacion_id is
    '147: estación a la que está ASIGNADO el tanque (null = sin estación). El tanque es fijo: NO se mueve con el motor.';
comment on column public.mot_tanques.motor_equipo_id is
    '147: motor conectado ahora al tanque (null = libre). El motor se mueve; el tanque se queda.';

alter table public.mot_registros add column if not exists caudal_ini    numeric(12,2) check (caudal_ini is null or caudal_ini >= 0);
alter table public.mot_registros add column if not exists caudal_fin    numeric(12,2) check (caudal_fin is null or caudal_fin >= 0);
alter table public.mot_registros add column if not exists operador      text;
alter table public.mot_registros add column if not exists dif_visor_gal numeric(12,2);
alter table public.mot_registros add column if not exists custodia_id   uuid;
comment on column public.mot_registros.dif_visor_gal is
    '147: visor inicial menos el saldo del libro del tanque antes del consumo. Negativo = faltan galones; positivo = sobran. null = primer día o histórico.';
comment on column public.mot_registros.recibido_gal is
    '147: columna «Suministro de combustible» de la hoja: lo declarado en el registro o, si no, lo recibido ese día en el tanque.';

create or replace function public._mot_norm(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
    select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
revoke execute on function public._mot_norm(text) from public, anon, authenticated;

-- nombre único (sin distinguir mayúsculas) entre los tanques activos; si ya hay duplicados no se crea (se avisa)
do $$
begin
    if exists (select 1 from (select public._mot_norm(nombre) n from public.mot_tanques where activo group by 1 having count(*) > 1) x) then
        raise notice '147: hay tanques activos con el mismo nombre; no se crea el índice único. Desactiva los duplicados y corre la 147 otra vez.';
    else
        create unique index if not exists mot_tanques_nombre_unico on public.mot_tanques (public._mot_norm(nombre)) where activo;
    end if;
end $$;


-- ---------------------------------------------------------------- 2 · tablas: custodias e historial de asignación de tanques
create table if not exists public.mot_custodias (
    id                  uuid primary key default gen_random_uuid(),
    equipo_id           uuid not null references public.equipos(id) on delete cascade,
    ubicacion           text not null check (ubicacion in ('ESTACION', 'TALLER', 'RETIRADO')),
    estacion_id         uuid references public.estaciones_riego(id) on delete cascade,
    tanque_id           uuid references public.mot_tanques(id) on delete cascade,
    desde               timestamptz not null,
    hasta               timestamptz,
    horo_entrada        numeric(12,2),
    horo_salida         numeric(12,2),
    asignacion_entrada  uuid,        -- mot_asignaciones.id que abrió el tramo (sin FK: el tramo se revierte por disparador)
    asignacion_salida   uuid,
    creado_en           timestamptz not null default clock_timestamp()
);
create unique index if not exists mot_custodias_un_abierto on public.mot_custodias (equipo_id) where hasta is null;
create index if not exists idx_mot_cust_equipo on public.mot_custodias (equipo_id, desde desc);
create index if not exists idx_mot_cust_estacion on public.mot_custodias (estacion_id, desde desc);
comment on table public.mot_custodias is
    '147: tramos de custodia del motor (dónde estuvo, con qué tanque, desde/hasta y con qué horómetro). Se arma al recibir/mover/retirar; se revierte al anular o eliminar el movimiento.';

create table if not exists public.mot_tanque_historial (
    id            bigint generated always as identity primary key,
    tanque_id     uuid not null references public.mot_tanques(id) on delete cascade,
    estacion_antes uuid references public.estaciones_riego(id) on delete set null,
    estacion_nueva uuid references public.estaciones_riego(id) on delete set null,
    motivo        text,
    hecho_por     uuid,
    hecho_en      timestamptz not null default now()
);
create index if not exists idx_mot_tq_hist on public.mot_tanque_historial (tanque_id, hecho_en desc);

do $$
declare t text;
begin
    foreach t in array array['mot_custodias', 'mot_tanque_historial'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('grant select on public.%I to authenticated', t);
        execute format('drop policy if exists fert_leer on public.%I', t);
    end loop;
end $$;

create policy fert_leer on public.mot_custodias for select to authenticated
    using (public.fn_es_admin() or public.fn_tiene_permiso('motores', 'auditar')
           or (public.fn_tiene_permiso('motores', 'ver') and estacion_id is not null and public.fn_fert_puede(estacion_id, 'ver')));
create policy fert_leer on public.mot_tanque_historial for select to authenticated
    using (public.fn_es_admin() or public.fn_tiene_permiso('motores', 'auditar') or public.fn_tiene_permiso('motores', 'configurar'));

-- disparador: anular o eliminar un movimiento del motor revierte su tramo (reabre el anterior)
create or replace function public._mot_custodia_revertir()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
    if tg_op = 'UPDATE' and not (old.anulado_at is null and new.anulado_at is not null) then
        return new;
    end if;
    delete from public.mot_custodias where asignacion_entrada = v_id;
    update public.mot_custodias
       set hasta = null, horo_salida = null, asignacion_salida = null
     where asignacion_salida = v_id;
    return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public._mot_custodia_revertir() from public, anon, authenticated;

drop trigger if exists mot_asignaciones_custodia_rev_upd on public.mot_asignaciones;
create trigger mot_asignaciones_custodia_rev_upd after update of anulado_at on public.mot_asignaciones
for each row execute function public._mot_custodia_revertir();
drop trigger if exists mot_asignaciones_custodia_rev_del on public.mot_asignaciones;
create trigger mot_asignaciones_custodia_rev_del after delete on public.mot_asignaciones
for each row execute function public._mot_custodia_revertir();

-- relleno de los tramos a partir del historial de asignaciones que ya existe (solo motores sin tramos)
do $$
declare
    e record;
    a public.mot_asignaciones%rowtype;
begin
    for e in select distinct x.equipo_id from public.mot_asignaciones x
              where x.anulado_at is null
                and not exists (select 1 from public.mot_custodias c where c.equipo_id = x.equipo_id) loop
        for a in select * from public.mot_asignaciones z where z.equipo_id = e.equipo_id and z.anulado_at is null
                  order by z.fecha_hora, z.creado_en loop
            update public.mot_custodias
               set hasta = a.fecha_hora, asignacion_salida = a.id,
                   horo_salida = coalesce(a.horometro,
                       (select r.horo_fin from public.mot_registros r
                         where r.equipo_id = a.equipo_id and r.anulado_at is null and r.fecha <= public._mot_dia(a.fecha_hora)
                         order by r.fecha desc limit 1))
             where equipo_id = e.equipo_id and hasta is null;
            insert into public.mot_custodias (equipo_id, ubicacion, estacion_id, tanque_id, desde, horo_entrada, asignacion_entrada)
            values (a.equipo_id,
                    case when a.tipo in ('INSTALADO', 'TRASLADADO', 'DE_VUELTA') then 'ESTACION'
                         when a.tipo = 'AL_TALLER' then 'TALLER' else 'RETIRADO' end,
                    case when a.tipo in ('INSTALADO', 'TRASLADADO', 'DE_VUELTA') then a.estacion_destino end,
                    case when a.tipo in ('INSTALADO', 'TRASLADADO', 'DE_VUELTA') then a.tanque_id end,
                    a.fecha_hora, a.horometro, a.id);
        end loop;
    end loop;
    -- el tramo de cada registro (solo los que aún no se han bajado a AGL; custodia_id no sale en la huella de la bajada)
    update public.mot_registros r
       set custodia_id = (select c.id from public.mot_custodias c
                           where c.equipo_id = r.equipo_id and c.desde <= r.fecha_hora and (c.hasta is null or c.hasta > r.fecha_hora)
                           order by c.desde desc limit 1)
     where r.custodia_id is null;
end $$;


-- ---------------------------------------------------------------- 3 · permiso «auditar»
insert into public.acciones (codigo, nombre, descripcion, orden, escribe, nivel) values
    ('auditar', 'Auditar', 'Motores: ver la ficha completa de un motor (todos los tramos de custodia, horómetros, consumos y señales), sin importar en qué estación estuvo.', 128, false, 3)
on conflict (codigo) do nothing;
update public.pantallas
   set acciones = acciones || 'auditar'::text
 where codigo = 'motores' and not ('auditar' = any(acciones));
-- No se concede a ningún rol: solo el administrador (fn_es_admin) hasta que se asigne en Permisos.


-- ---------------------------------------------------------------- 4 · siembra de los 30 tanques (idempotente)
do $$
declare
    x record;
    v_zona uuid;
    v_est  uuid;
    v_n    integer;
    v_id   uuid;
begin
    for x in select * from (values
        ('Carretales', 'Zona-1', 300), ('Congolon', 'Zona-1', 350), ('Tanque del Fertilizador Congolon', 'Zona-1', 55),
        ('Embarcadero Rio', 'Zona-1', 300), ('Embarcadero Pozo', 'Zona-1', 350), ('Estiquirin', 'Zona-1', 500),
        ('Vega', 'Zona-1', 450), ('Vega Generador', 'Zona-1', 55),
        ('Espino Laguna Pozo-1', 'Zona-2A', 160), ('Espino Laguna', 'Zona-2A', 150), ('Espino Laguna Pozo-2', 'Zona-2A', 110),
        ('Espino Mendez Laguna', 'Zona-2A', 300), ('Espino Mendez Pozo', 'Zona-2A', 110), ('Tololar', 'Zona-2A', 550),
        ('Papalon-1', 'Zona-2A', 600), ('Papalon-2', 'Zona-2A', 270), ('Papalon-3', 'Zona-2A', 170),
        ('Tanque Llenar Laguna Papalon', 'Zona-2A', 110), ('Tanque Generador Papalon', 'Zona-2A', 55),
        ('Teresa Cañera', 'Zona-3A', 300), ('Teresa Aguacate', 'Zona-3A', 300), ('Tanque Rio Estacion A', 'Zona-3A', 300),
        ('Rubio', 'Zona-3A', 300), ('Zamora', 'Zona-3A', 300),
        ('Tanque Bomba-4y5 Rio', 'Zona-3B', 300), ('Estacion-C', 'Zona-3B', 500), ('Glorieta', 'Zona-3B', 290),
        ('Tanque Gomez', 'Zona-3B', 500), ('Sierra Rio-1', 'Zona-3B', 270), ('Sierra Rio-2', 'Zona-3B', 500)
    ) as t(nombre, zona, cap) loop
        v_zona := (select z.id from public.zonas z
                    where regexp_replace(lower(z.nombre), '[^a-z0-9]', '', 'g') = regexp_replace(lower(x.zona), '[^a-z0-9]', '', 'g')
                    order by z.id limit 1);
        -- estación: solo si coincide el nombre exacto (sin mayúsculas ni espacios de más) y es única; nunca una de prueba
        select count(*), (array_agg(e.id))[1] into v_n, v_est
          from public.estaciones_riego e
         where e.activo and e.prueba_de is null and public._mot_norm(e.nombre) = public._mot_norm(x.nombre);
        if v_n <> 1 then v_est := null; end if;

        select t.id into v_id from public.mot_tanques t where t.activo and public._mot_norm(t.nombre) = public._mot_norm(x.nombre) limit 1;
        if v_id is null then
            insert into public.mot_tanques (estacion_id, nombre, capacidad_gal, zona_id, asignado_at)
            values (v_est, x.nombre, x.cap, v_zona, case when v_est is not null then now() end)
            returning id into v_id;
            if v_est is not null then
                insert into public.mot_tanque_historial (tanque_id, estacion_antes, estacion_nueva, motivo)
                values (v_id, null, v_est, '147: siembra inicial (el nombre coincide con la estación)');
            end if;
        else
            -- ya existía (de la 130 o de una corrida anterior): solo se completan los datos que faltan, sin tocar lo ya asignado
            update public.mot_tanques
               set zona_id = coalesce(zona_id, v_zona), capacidad_gal = coalesce(capacidad_gal, x.cap)
             where id = v_id and (zona_id is null or capacidad_gal is null);
        end if;
    end loop;
end $$;


-- ---------------------------------------------------------------- 5 · semáforo de mantenimiento, estado «qué toca ahora» y señales
/** Mantenimiento por horómetro del MOTOR (sigue al motor aunque cambie de estación). nivel: verde | amarillo | rojo | gris. */
create or replace function public._mot_semaforo(p_equipo uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    mo     public.mot_motores%rowtype;
    v_int  integer;
    v_av   numeric;
    v_fal  numeric;
    v_niv  text;
    v_txt  text;
begin
    select * into mo from public.mot_motores where equipo_id = p_equipo;
    if not found then
        return null;
    end if;
    v_int := public._mot_intervalo(p_equipo);
    if v_int is null then
        return jsonb_build_object('nivel', 'gris', 'horas_desde_mant', mo.horas_desde_mant, 'intervalo_horas', null, 'faltan_horas', null,
                                  'aviso_horas', null, 'texto', 'Sin intervalo de mantenimiento: pide cargarlo en AGL (Modelos de motor de riego).');
    end if;
    v_av := coalesce(mo.aviso_horas, round(v_int * 0.10), 50);          -- aviso del modelo; si no hay, 10 % del intervalo; si no, 50 h
    v_fal := v_int - mo.horas_desde_mant;
    v_niv := case when v_fal <= 0 then 'rojo' when v_fal <= v_av then 'amarillo' else 'verde' end;
    v_txt := case v_niv
                 when 'rojo' then format('Mantenimiento VENCIDO hace %s h (cada %s h)', trim_scale(round(-v_fal, 1))::text, v_int)
                 when 'amarillo' then format('Faltan %s h para el mantenimiento (cada %s h)', trim_scale(round(v_fal, 1))::text, v_int)
                 else format('Mantenimiento al día: faltan %s h', trim_scale(round(v_fal, 1))::text) end;
    return jsonb_build_object('nivel', v_niv, 'horas_desde_mant', mo.horas_desde_mant, 'intervalo_horas', v_int,
                              'faltan_horas', round(v_fal, 1), 'aviso_horas', v_av, 'texto', v_txt);
end $$;
revoke execute on function public._mot_semaforo(uuid) from public, anon, authenticated;

/** Todo lo que el estacionero necesita ver de un vistazo: semáforos y «qué toca hacer ahora» (ordenado por urgencia). */
create or replace function public._mot_estado_motor(p_equipo uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    mo     public.mot_motores%rowtype;
    c      public.mot_custodias%rowtype;
    v_hoy  date := public._mot_dia(now());
    v_sem  jsonb;
    v_ahora jsonb := '[]'::jsonb;
    v_dias integer;
    v_reg  jsonb;
    v_tq   jsonb := null;
    v_saldo numeric;
    v_cap  numeric;
    v_niv  text := 'verde';
    v_tramo jsonb := null;
begin
    select * into mo from public.mot_motores where equipo_id = p_equipo;
    if not found then
        return null;
    end if;
    v_sem := public._mot_semaforo(p_equipo);
    select * into c from public.mot_custodias where equipo_id = p_equipo and hasta is null;
    if c.id is not null then
        v_tramo := jsonb_build_object('id', c.id, 'ubicacion', c.ubicacion, 'estacion_id', c.estacion_id, 'tanque_id', c.tanque_id,
                                      'desde', c.desde, 'horo_entrada', c.horo_entrada,
                                      'dias', greatest(v_hoy - public._mot_dia(c.desde), 0));
    end if;

    if v_sem->>'nivel' in ('rojo', 'amarillo') then
        v_ahora := v_ahora || jsonb_build_object('nivel', v_sem->>'nivel', 'codigo', 'MANTENIMIENTO', 'texto', v_sem->>'texto');
    end if;

    if mo.estado = 'EN_ESTACION' then
        if mo.fecha_ultimo is null then
            v_reg := jsonb_build_object('nivel', 'amarillo', 'dias_sin_registro', null, 'texto', 'Todavía no tiene registros: registra el primer día.');
        else
            v_dias := greatest(v_hoy - 1 - mo.fecha_ultimo, 0);
            v_reg := case when v_dias = 0 then jsonb_build_object('nivel', 'verde', 'dias_sin_registro', 0, 'texto', 'Registro al día.')
                          when v_dias = 1 then jsonb_build_object('nivel', 'amarillo', 'dias_sin_registro', 1, 'texto', 'Falta el registro de ayer.')
                          else jsonb_build_object('nivel', case when v_dias >= 3 then 'rojo' else 'amarillo' end, 'dias_sin_registro', v_dias,
                                                  'texto', format('Faltan %s días sin registro (desde el %s).', v_dias,
                                                                  to_char(mo.fecha_ultimo + 1, 'DD/MM'))) end;
        end if;
        if v_reg->>'nivel' <> 'verde' then
            v_ahora := v_ahora || jsonb_build_object('nivel', v_reg->>'nivel', 'codigo', 'FALTA_REGISTRO', 'texto', v_reg->>'texto');
        end if;

        if mo.tanque_id is null then
            v_tq := jsonb_build_object('nivel', 'rojo', 'texto', 'El motor no tiene tanque conectado.');
            v_ahora := v_ahora || jsonb_build_object('nivel', 'rojo', 'codigo', 'SIN_TANQUE', 'texto', 'El motor no tiene tanque conectado.');
        else
            v_saldo := public._mot_saldo_actual(mo.tanque_id);
            v_cap := (select coalesce(t.capacidad_gal, mo.capacidad_tanque_gal) from public.mot_tanques t where t.id = mo.tanque_id);
            v_tq := case when v_saldo <= 0 then jsonb_build_object('nivel', 'rojo', 'saldo_gal', v_saldo, 'capacidad_gal', v_cap,
                                                                   'texto', 'El tanque está vacío según el libro: recibe diésel o cuéntalo con el visor.')
                         when v_cap is not null and v_saldo <= v_cap * 0.15
                              then jsonb_build_object('nivel', 'amarillo', 'saldo_gal', v_saldo, 'capacidad_gal', v_cap,
                                                      'texto', format('Tanque bajo: quedan %s gal (%s %% de %s).', trim_scale(round(v_saldo, 1))::text,
                                                                      round(v_saldo * 100 / v_cap), trim_scale(v_cap)::text))
                         else jsonb_build_object('nivel', 'verde', 'saldo_gal', v_saldo, 'capacidad_gal', v_cap,
                                                 'texto', format('Tanque con %s gal.', trim_scale(round(v_saldo, 1))::text)) end;
            if v_tq->>'nivel' <> 'verde' then
                v_ahora := v_ahora || jsonb_build_object('nivel', v_tq->>'nivel', 'codigo', 'TANQUE', 'texto', v_tq->>'texto');
            end if;
        end if;
    end if;

    -- el peor nivel manda; la lista «ahora» sale ordenada de lo más urgente a lo menos
    select coalesce(jsonb_agg(x order by case x->>'nivel' when 'rojo' then 1 when 'amarillo' then 2 else 3 end), '[]'::jsonb)
      into v_ahora from jsonb_array_elements(v_ahora) x;
    v_niv := case when exists (select 1 from jsonb_array_elements(v_ahora) x where x->>'nivel' = 'rojo') then 'rojo'
                  when exists (select 1 from jsonb_array_elements(v_ahora) x where x->>'nivel' = 'amarillo') then 'amarillo'
                  else 'verde' end;
    return jsonb_build_object('equipo_id', p_equipo, 'nivel', v_niv, 'mantenimiento', v_sem, 'registro', v_reg, 'tanque', v_tq,
                              'tramo', v_tramo, 'ahora', v_ahora);
end $$;
revoke execute on function public._mot_estado_motor(uuid) from public, anon, authenticated;

/**
 * Señales por día de registro de cada motor (todas se calculan con los datos del propio registro y del anterior; el teléfono
 * aplica las mismas reglas sin red). nivel: rojo | amarillo | info. Tolerancia de galones: 3.
 */
create or replace function public._mot_senales(p_equipos uuid[], p_desde date default null, p_hasta date default null)
returns table (equipo_id uuid, registro_id uuid, fecha date, nivel text, codigo text, texto text)
language sql stable security definer set search_path = public, pg_temp as $$
    with r as (
        select x.*,
               lag(x.fecha)       over w as p_fecha,
               lag(x.horo_fin)    over w as p_hf,
               lag(x.visor_fin)   over w as p_vf,
               lag(x.estacion_id) over w as p_est,
               lag(x.tanque_id)   over w as p_tq
          from public.mot_registros x
         where x.equipo_id = any(p_equipos) and x.anulado_at is null
        window w as (partition by x.equipo_id order by x.fecha)
    )
    select r.equipo_id, r.id, r.fecha, s.nivel, s.codigo, s.texto
      from r
      left join lateral (
          select percentile_cont(0.5) within group (order by q.rendimiento_gal_h) as med, count(*) as n
            from (select z.rendimiento_gal_h from public.mot_registros z
                   where z.equipo_id = r.equipo_id and z.anulado_at is null and z.fecha < r.fecha
                     and z.rendimiento_gal_h is not null and z.horas > 0
                   order by z.fecha desc limit 10) q) m on true
      left join lateral (
          select coalesce(sum(mv.cantidad), 0) as suma
            from public.mot_movimientos mv
           where mv.tanque_id = r.tanque_id and mv.tipo in ('RECEPCION_DIESEL', 'SUMINISTRO')
             and r.p_fecha is not null
             and public._mot_dia(mv.fecha_hora) > r.p_fecha and public._mot_dia(mv.fecha_hora) <= r.fecha
             and not exists (select 1 from public.mot_movimientos a where a.anula_id = mv.id)) u on true
      cross join lateral (values
        ('rojo', 'HORO_RETROCEDE',
            case when r.p_hf is not null and not r.horo_cambiado and r.horo_ini < r.p_hf - 0.005
                 then format('El horómetro retrocede: inicia en %s y el día anterior terminó en %s.', trim_scale(r.horo_ini)::text, trim_scale(r.p_hf)::text) end),
        ('amarillo', 'HORO_SALTA',
            case when r.p_hf is not null and not r.horo_cambiado and r.horo_ini > r.p_hf + 0.005
                 then format('El horómetro no continúa: inicia en %s y el día anterior terminó en %s (salto de %s h).',
                             trim_scale(r.horo_ini)::text, trim_scale(r.p_hf)::text, trim_scale(round(r.horo_ini - r.p_hf, 2))::text) end),
        ('amarillo', 'HUECO_DIAS',
            case when r.p_fecha is not null and r.fecha - r.p_fecha > 1 and r.p_est is not distinct from r.estacion_id
                 then format('Faltan %s día(s) sin registro (del %s al %s).', r.fecha - r.p_fecha - 1,
                             to_char(r.p_fecha + 1, 'DD/MM'), to_char(r.fecha - 1, 'DD/MM')) end),
        ('rojo', 'VISOR_FALTA',
            case when r.p_fecha is not null and r.p_tq is not distinct from r.tanque_id and r.p_vf is not null and not r.visor_cambiado
                      and r.visor_ini - (r.p_vf + u.suma) < -3
                 then format('El visor inicial (%s gal) es menor de lo esperado (%s gal): faltan %s gal sin explicar entre el día anterior y hoy.',
                             trim_scale(r.visor_ini)::text, trim_scale(round(r.p_vf + u.suma, 1))::text,
                             trim_scale(round((r.p_vf + u.suma) - r.visor_ini, 1))::text) end),
        ('amarillo', 'VISOR_SOBRA',
            case when r.p_fecha is not null and r.p_tq is not distinct from r.tanque_id and r.p_vf is not null and not r.visor_cambiado
                      and r.visor_ini - (r.p_vf + u.suma) > 3
                 then format('El visor inicial (%s gal) es mayor de lo esperado (%s gal): ¿falta registrar un suministro de %s gal?',
                             trim_scale(r.visor_ini)::text, trim_scale(round(r.p_vf + u.suma, 1))::text,
                             trim_scale(round(r.visor_ini - (r.p_vf + u.suma), 1))::text) end),
        ('rojo', 'SALDO_FALTA',
            case when r.dif_visor_gal is not null and r.dif_visor_gal < -3
                 then format('El tanque debía tener %s gal y el visor marca %s: faltan %s gal.',
                             trim_scale(round(r.visor_ini - r.dif_visor_gal, 1))::text, trim_scale(r.visor_ini)::text, trim_scale(abs(r.dif_visor_gal))::text) end),
        ('amarillo', 'SALDO_SOBRA',
            case when r.dif_visor_gal is not null and r.dif_visor_gal > 3
                 then format('El tanque debía tener %s gal y el visor marca %s: sobran %s gal.',
                             trim_scale(round(r.visor_ini - r.dif_visor_gal, 1))::text, trim_scale(r.visor_ini)::text, trim_scale(r.dif_visor_gal)::text) end),
        (case when m.med > 0 and (r.rendimiento_gal_h > m.med * 1.75 or r.rendimiento_gal_h < m.med * 0.4) then 'rojo' else 'amarillo' end,
         'RENDIMIENTO',
            case when r.horas > 0 and r.rendimiento_gal_h is not null and m.n >= 5 and m.med > 0
                      and (r.rendimiento_gal_h > m.med * 1.35 or r.rendimiento_gal_h < m.med * 0.65)
                 then format('Gastó %s gal en %s h (%s gal/h). Lo normal en este motor es %s gal/h: debió gastar cerca de %s gal.',
                             trim_scale(r.gastado_gal)::text, trim_scale(r.horas)::text, trim_scale(r.rendimiento_gal_h)::text,
                             trim_scale(round(m.med::numeric, 2))::text, trim_scale(round((m.med * r.horas)::numeric, 1))::text) end),
        ('rojo', 'CONSUMO_SIN_HORAS',
            case when r.horas = 0 and r.gastado_gal > 0
                 then format('Gastó %s gal con 0 horas de motor.', trim_scale(r.gastado_gal)::text) end),
        ('amarillo', 'HORAS_SIN_CONSUMO',
            case when r.horas >= 1 and r.gastado_gal = 0
                 then format('Trabajó %s h y no gastó diésel.', trim_scale(r.horas)::text) end),
        ('rojo', 'HORAS_IMPOSIBLES',
            case when r.horas > 24 then format('Más de 24 horas en un día (%s h).', trim_scale(r.horas)::text) end),
        ('info', 'SIN_RPM',
            case when r.rpm is null then 'No se anotaron las revoluciones del motor.' end)
      ) as s(nivel, codigo, texto)
     where s.texto is not null
       and (p_desde is null or r.fecha >= p_desde) and (p_hasta is null or r.fecha <= p_hasta)
$$;
revoke execute on function public._mot_senales(uuid[], date, date) from public, anon, authenticated;


-- ---------------------------------------------------------------- 6 · mover / recibir / retirar el motor (tanque fijo + tramo de custodia)
-- (reemplaza la de la 130 y 138; marcas incluidas para que correr la 138 después la salte: 'Recepción del motor' 'motor_retirar' 'SALDO_INICIAL')
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
    v_base   numeric := public._mot_num(d->>'horas_base');
    v_horo   numeric := public._mot_num(d->>'horometro');
    v_diesel numeric := public._mot_num(d->>'diesel_gal');
    v_antes  jsonb;
    v_tanque uuid;
    v_origen uuid;
    v_nuevo  jsonb := d->'tanque_nuevo';
    v_mat    uuid;
    v_tanques_antes jsonb := '[]'::jsonb;
    v_creado_id uuid;
    v_libres integer;
    v_obs    text[] := '{}';
    v_conf   boolean := public.fn_es_admin() or public.fn_tiene_permiso('motores', 'configurar');
    v_horo_mov numeric;
begin
    -- 147:asignacion · marcas de la 138 incluidas: 'Recepción del motor' · 'motor_retirar' · 'SALDO_INICIAL'
    select * into mo from public.mot_motores where equipo_id = v_eq for update;
    if not found then
        raise exception 'El motor no está en el catálogo de motores (AGL). Actualiza la aplicación.';
    end if;
    if p_tipo in ('INSTALADO', 'DE_VUELTA') then
        v_codigo := null;
        v_motivo := case p_tipo when 'INSTALADO' then 'Recepción del motor' else 'Regreso del taller' end;
    elsif v_motivo is null and v_codigo is not null then
        v_motivo := case v_codigo when 'FIN_TEMPORADA' then 'Fin de temporada' when 'DANO_REEMPLAZO' then 'Daño o reemplazo'
                                  when 'CAMBIO_ESTACION' then 'Traslado a otra estación' when 'MANTENIMIENTO' then 'Mantenimiento' else null end;
    end if;
    if v_motivo is null then
        raise exception 'Elige el motivo.';
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
    if nullif(btrim(coalesce(d->>'horometro', '')), '') is not null and (v_horo is null or v_horo < 0) then
        raise exception 'El horómetro no es válido.';
    end if;
    if v_diesel is not null and v_diesel < 0 then
        raise exception 'El diésel del tanque no puede ser negativo.';
    end if;

    v_origen := mo.estacion_id;
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
    -- permisos por acción (138)
    if p_tipo = 'TRASLADADO' then
        perform public._mot_autorizar_accion(v_origen, 'motor_mover', false);
        perform public._mot_autorizar_accion(v_dest, 'motor_mover', false);
        if not (public.fn_fert_puede(v_origen, 'ver') or public.fn_fert_puede(v_dest, 'ver')) then
            raise exception 'No tienes acceso a ninguna de las dos estaciones.' using errcode = '42501';
        end if;
    else
        if v_salida then perform public._mot_autorizar_accion(v_origen, 'motor_retirar'); end if;
        if v_entrada then perform public._mot_autorizar_accion(v_dest, 'motor_recibir'); end if;
    end if;

    v_antes := jsonb_build_object('motor', jsonb_build_object('estado', mo.estado, 'estacion_id', mo.estacion_id, 'tanque_id', mo.tanque_id,
                                                              'horas_desde_mant', mo.horas_desde_mant));

    -- ------------------------------ salida: el TANQUE SE QUEDA en la estación (solo se desconecta el motor)
    if v_salida then
        select * into t_orig from public.mot_tanques where motor_equipo_id = v_eq and activo for update;
        if found then
            v_tanques_antes := v_tanques_antes || jsonb_build_object('id', t_orig.id, 'estacion_id', t_orig.estacion_id,
                                                                     'motor_equipo_id', t_orig.motor_equipo_id, 'activo', t_orig.activo);
            v_saldo := public._mot_saldo_actual(t_orig.id);
            update public.mot_tanques set motor_equipo_id = null where id = t_orig.id;
        end if;
        update public.mot_motores
           set estado = case p_tipo when 'RETIRADO' then 'RETIRADO' when 'AL_TALLER' then 'TALLER' else estado end,
               estacion_id = null, tanque_id = null
         where equipo_id = v_eq;
        v_tanque := t_orig.id;
    end if;

    -- ------------------------------ entrada: un tanque LIBRE asignado a la estación de destino
    if v_entrada then
        v_tanque := public._fert_uuid(d->>'tanque_id');
        if v_tanque is not null then
            select * into t_dest from public.mot_tanques where id = v_tanque for update;
            if not found or not t_dest.activo then
                raise exception 'Ese tanque no existe o ya no está activo.';
            end if;
            if t_dest.estacion_id is distinct from v_dest then
                raise exception 'Ese tanque no está asignado a la estación de destino. Torre de Control lo asigna en Motores › Tanques.';
            end if;
            if t_dest.motor_equipo_id is not null and t_dest.motor_equipo_id <> v_eq then
                raise exception 'Ese tanque ya está conectado a otro motor.';
            end if;
        elsif v_nuevo is not null and jsonb_typeof(v_nuevo) = 'object' then
            -- crear un tanque es catálogo: solo quien configura (o la estación de práctica del modo de pruebas)
            if not (v_conf or public._fert_es_prueba(v_dest)) then
                raise exception 'Los tanques son fijos: elige uno de la lista. Para agregar uno nuevo, pídelo a Torre de Control.';
            end if;
            if nullif(btrim(coalesce(v_nuevo->>'nombre', '')), '') is null then
                raise exception 'Escribe el nombre del tanque nuevo.';
            end if;
            if exists (select 1 from public.mot_tanques x where x.activo and public._mot_norm(x.nombre) = public._mot_norm(v_nuevo->>'nombre')) then
                raise exception 'Ya existe un tanque con ese nombre: elígelo de la lista.';
            end if;
            insert into public.mot_tanques (estacion_id, nombre, capacidad_gal, material_id, zona_id, asignado_at, asignado_por)
            values (v_dest, btrim(v_nuevo->>'nombre'), nullif(public._mot_num(v_nuevo->>'capacidad_gal'), 0),
                    coalesce(public._fert_uuid(v_nuevo->>'material_id'), (select c.material_diesel_id from public.mot_bajada_config c where c.id)),
                    (select e.zona_id from public.estaciones_riego e where e.id = v_dest), now(), (select auth.uid()))
            returning id into v_tanque;
            v_creado_id := v_tanque;
            select * into t_dest from public.mot_tanques where id = v_tanque;
        else
            select count(*) into v_libres from public.mot_tanques
             where estacion_id = v_dest and activo and (motor_equipo_id is null or motor_equipo_id = v_eq);
            if v_libres = 1 then
                select * into t_dest from public.mot_tanques
                 where estacion_id = v_dest and activo and (motor_equipo_id is null or motor_equipo_id = v_eq) for update;
                v_tanque := t_dest.id;
            elsif v_libres = 0 and public._fert_es_prueba(v_dest)
                  and not exists (select 1 from public.mot_tanques x where x.estacion_id = v_dest and x.activo) then
                -- modo de pruebas: un tanque de práctica por estación de prueba (se borra con «Borrar lo de prueba»)
                insert into public.mot_tanques (estacion_id, nombre, capacidad_gal, zona_id, asignado_at)
                values (v_dest, 'PRUEBA-T-' || substr(v_dest::text, 1, 8), 100, (select e.zona_id from public.estaciones_riego e where e.id = v_dest), now())
                returning id into v_tanque;
                v_creado_id := v_tanque;
                select * into t_dest from public.mot_tanques where id = v_tanque;
            elsif v_libres = 0 then
                raise exception 'La estación no tiene un tanque libre. Pide a Torre de Control asignarle un tanque (Motores › Tanques).';
            else
                raise exception 'La estación tiene varios tanques libres: elige el que usará el motor.';
            end if;
        end if;
        -- un tanque viejo conectado a este motor y que no es el elegido se desconecta (sin tocar su diésel)
        for t_orig in select * from public.mot_tanques x where x.motor_equipo_id = v_eq and x.activo and x.id <> v_tanque for update loop
            if not exists (select 1 from jsonb_array_elements(v_tanques_antes) y where (y->>'id')::uuid = t_orig.id) then
                v_tanques_antes := v_tanques_antes || jsonb_build_object('id', t_orig.id, 'estacion_id', t_orig.estacion_id,
                                                                         'motor_equipo_id', t_orig.motor_equipo_id, 'activo', t_orig.activo);
            end if;
        end loop;
        update public.mot_tanques set motor_equipo_id = null where motor_equipo_id = v_eq and activo and id <> v_tanque;
        if v_creado_id is null and not exists (select 1 from jsonb_array_elements(v_tanques_antes) y where (y->>'id')::uuid = v_tanque) then
            v_tanques_antes := v_tanques_antes || jsonb_build_object('id', t_dest.id, 'estacion_id', t_dest.estacion_id,
                                                                     'motor_equipo_id', t_dest.motor_equipo_id, 'activo', t_dest.activo);
        end if;
        update public.mot_tanques set motor_equipo_id = v_eq where id = v_tanque;
        update public.mot_motores
           set estado = 'EN_ESTACION', estacion_id = v_dest, tanque_id = v_tanque
         where equipo_id = v_eq;
    end if;

    -- ------------------------------ tramo de custodia: se cierra el abierto y se abre el nuevo
    v_horo_mov := coalesce(v_horo, mo.horo_ultimo);
    update public.mot_custodias
       set hasta = v_fecha, horo_salida = v_horo_mov, asignacion_salida = p_id
     where equipo_id = v_eq and hasta is null;
    insert into public.mot_custodias (equipo_id, ubicacion, estacion_id, tanque_id, desde, horo_entrada, asignacion_entrada)
    values (v_eq,
            case when v_entrada then 'ESTACION' when p_tipo = 'AL_TALLER' then 'TALLER' else 'RETIRADO' end,
            case when v_entrada then v_dest end, case when v_entrada then v_tanque end, v_fecha, v_horo_mov, p_id);
    if v_entrada and v_horo is not null and mo.horo_ultimo is not null and abs(v_horo - mo.horo_ultimo) > 0.005 then
        v_obs := public._fert_obs(v_obs, array['HOROMETRO_NO_CONTINUA']);
    end if;

    v_antes := v_antes || jsonb_build_object('tanques', v_tanques_antes, 'tanque_creado', v_creado_id);
    insert into public.mot_asignaciones
        (id, equipo_id, tipo, estacion_origen, estacion_destino, tanque_id, fecha_hora, motivo, motivo_codigo, destino_saldo,
         destino_devolucion, saldo_gal, horas_base, antes, registrado_por, horometro, diesel_gal, observacion)
    values
        (p_id, v_eq, p_tipo, v_origen, case when v_entrada then v_dest end, v_tanque, v_fecha, v_motivo, v_codigo,
         case when v_salida then 'QUEDA_EN_TANQUE' end, null, case when v_salida then v_saldo end, v_base, v_antes, (select auth.uid()),
         v_horo, v_diesel, nullif(btrim(coalesce(d->>'observacion', '')), ''));

    -- diésel declarado al recibir: el visor manda; se asienta la diferencia con el tanque (movimiento visible)
    if v_entrada and v_tanque is not null and v_diesel is not null then
        v_mat := coalesce((select tt.material_id from public.mot_tanques tt where tt.id = v_tanque),
                          (select c.material_diesel_id from public.mot_bajada_config c where c.id));
        if v_mat is not null then
            perform public._mot_mover(p_id, v_tanque, v_mat,
                                      case when exists (select 1 from public.mot_movimientos z where z.tanque_id = v_tanque) then 'AJUSTE_VISOR' else 'SALDO_INICIAL' end,
                                      v_diesel - public._mot_saldo_actual(v_tanque), v_fecha, 'motor_asignacion', p_id);
        end if;
    end if;
    if v_base is not null then
        perform public._mot_recalcular_horas(v_eq);
    end if;
    update public.fert_operaciones set estacion_id = coalesce(case when v_entrada then v_dest end, v_origen) where id = p_id;
    return v_obs;
end $$;
revoke execute on function public._mot_aplicar_asignacion(uuid, jsonb, timestamptz, text) from public, anon, authenticated;


-- ---------------------------------------------------------------- 7 · recibir diésel = entra al TANQUE (no a la bodega)
create or replace function public._mot_op_diesel_recibir(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t        public.mot_tanques%rowtype;
    v_tanque uuid := public._fert_uuid(d->>'tanque_id');
    v_est    uuid := public._fert_uuid(d->>'estacion_id');     -- un envío de la 144 traía la estación: si solo hay un tanque, es ese
    v_n      integer;
    v_gal    numeric := public._mot_num(d->>'galones');
    v_fecha  timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_obs    text[];
    v_mat    uuid;
    v_chofer uuid := public._fert_uuid(d->>'chofer_id');
    v_vehiculo uuid := public._fert_uuid(d->>'vehiculo_id');
begin
    -- 147:diesel-tanque · el diésel NO pasa por la bodega: entra al tanque indicado
    if v_chofer is not null and not exists (select 1 from public.fert_choferes where id = v_chofer) then
        raise exception 'El chofer no está en el catálogo. Actualiza la aplicación.';
    end if;
    if v_vehiculo is not null and not exists (select 1 from public.fert_vehiculos where id = v_vehiculo) then
        raise exception 'El vehículo no está en el catálogo. Actualiza la aplicación.';
    end if;
    if v_tanque is null then
        if v_est is null then
            raise exception 'Elige el tanque donde se recibe el diésel.';
        end if;
        select count(*), (array_agg(x.id))[1] into v_n, v_tanque from public.mot_tanques x where x.estacion_id = v_est and x.activo;
        if v_n = 0 then
            raise exception 'La estación no tiene tanque asignado: pide a Torre de Control asignarle uno (Motores › Tanques).';
        elsif v_n > 1 then
            raise exception 'La estación tiene varios tanques: elige en cuál se recibe el diésel.';
        end if;
    end if;
    select * into t from public.mot_tanques where id = v_tanque and activo;
    if not found then
        raise exception 'El tanque no existe o ya no está activo. Actualiza la aplicación.';
    end if;
    if t.estacion_id is null then
        raise exception 'El tanque no está asignado a ninguna estación.';
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


-- ---------------------------------------------------------------- 8 · registro diario (la hoja FTR_F-MA-103 completa)
-- Reemplaza la de la 130 con los parches 136, 140 y 144 YA incluidos (marcas en comentarios) y los cambios del 147:
-- gastado = visor inicial − visor final; el suministro NO sale de la bodega; caudal y operador; diferencia contra el libro.
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
    v_ci     numeric := public._mot_num(d->>'caudal_ini');
    v_cf     numeric := public._mot_num(d->>'caudal_fin');
    v_oper   text := nullif(btrim(coalesce(d->>'operador', '')), '');
    v_hc     boolean := coalesce((d->>'horo_cambiado')::boolean, false);
    v_vc     boolean := coalesce((d->>'visor_cambiado')::boolean, false);
    v_coment text := nullif(btrim(coalesce(d->>'comentario', '')), '');
    v_sum_decl numeric := public._mot_num(d->>'suministro_gal');
    v_rec_dia numeric := 0;
    v_recib  numeric;
    v_extra  numeric := 0;
    v_gast   numeric;
    v_horas  numeric;
    v_rend   numeric;
    v_obs    text[] := '{}';
    prev     record;
    v_primero boolean;
    v_reciente boolean;
    v_saldo  numeric;
    v_ajuste numeric;
    v_dif    numeric;
    v_cuenta boolean;
    v_hist   boolean := lower(btrim(coalesce(d->>'historica', ''))) in ('true', 't', '1');
    v_sem    jsonb;
    v_cust   uuid;
begin
    -- 147:registro · marcas de parches anteriores incluidos: MOTOR_NO_ASIGNADO_EN_FECHA · 140:historica · 140:autorizar ·
    -- 140:sin-libro · 140:sin-consumo · 144:sum-calc · 144:msg · 144:sum-mov
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

    -- el motor puede haberse movido: la estación y el tanque son los de ESA fecha (tramo de custodia)
    v_momento := ((v_fecha + 1)::timestamp at time zone 'America/Tegucigalpa') - interval '1 second';
    select * into est from public._mot_estado_en(v_eq, v_momento);
    v_est := est.estacion_id;
    v_tanque := est.tanque_id;
    if est.tipo is null or est.tipo in ('AL_TALLER', 'RETIRADO') or v_est is null or v_tanque is null then
        -- un histórico NO se rechaza porque el motor no estuviera asignado ese día: se acepta con una observación y se asienta
        -- en la estación y el tanque donde el motor está AHORA (MOTOR_NO_ASIGNADO_EN_FECHA)
        v_est := coalesce(v_est, mo.estacion_id);
        v_tanque := coalesce(v_tanque, mo.tanque_id);
        if v_est is null or v_tanque is null then
            raise exception 'El motor no está instalado en ninguna estación (ni tiene tanque): no hay dónde asentar el diésel. Pide a quien configura que lo instale en Motores › Mover motor y vuelve a intentarlo.';
        end if;
        v_obs := array[case est.tipo when 'AL_TALLER' then 'MOTOR_EN_TALLER_EN_FECHA'
                                     when 'RETIRADO' then 'MOTOR_RETIRADO_EN_FECHA'
                                     else 'MOTOR_NO_ASIGNADO_EN_FECHA' end];
    end if;

    if v_hist then
        -- 140:historica / 140:autorizar · permiso temporal, sin custodia, día pasado
        v_obs := public._fert_obs(v_obs, public._campo_autorizar_historico('motores', v_est, v_fecha, p_creado));
    else
        v_obs := public._fert_obs(v_obs, public._mot_autorizar(v_est, 'registrar', p_creado, p_inmediato, p_en_nombre));
    end if;

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
    if (nullif(btrim(coalesce(d->>'caudal_ini', '')), '') is not null and (v_ci is null or v_ci < 0))
       or (nullif(btrim(coalesce(d->>'caudal_fin', '')), '') is not null and (v_cf is null or v_cf < 0)) then
        raise exception 'La lectura de caudal debe ser un número.';
    end if;
    if v_oper is not null and length(v_oper) > 80 then
        raise exception 'El nombre del operador es muy largo.';
    end if;
    if v_sum_decl is not null and v_sum_decl < 0 then
        raise exception 'El suministro de combustible no puede ser negativo.';
    end if;
    if v_hf < v_hi and not v_hc then
        raise exception 'El horómetro final es menor que el inicial.';
    end if;

    v_mat := coalesce((select t.material_id from public.mot_tanques t where t.id = v_tanque),
                      (select c.material_diesel_id from public.mot_bajada_config c where c.id));
    if v_mat is null then
        raise exception 'AGL todavía no publica el producto diésel. Avisa a la Torre de Control.';
    end if;

    -- 144:sum-calc · suministro del día: lo que escribe quien registra, o lo recibido ese día en ESTE tanque (recepciones)
    select coalesce(sum(r.galones), 0) into v_rec_dia
      from public.mot_recepciones r
     where r.tanque_id = v_tanque and r.anulado_at is null and public._mot_dia(r.fecha_hora) = v_fecha;
    v_recib := coalesce(v_sum_decl, v_rec_dia);
    -- lo declarado que NO está en recepciones entra al tanque con este registro (no doble: solo la diferencia)
    if v_sum_decl is not null and not v_hist then
        v_extra := greatest(v_sum_decl - v_rec_dia, 0);
    end if;

    -- 147:gast · GASTADO = visor inicial − visor final (la hoja); el visor inicial ya incluye el suministro de antes
    v_gast := v_vi - v_vf;
    if v_gast < 0 then
        if v_recib > 0 and (v_vf - v_vi) <= v_recib + 0.5 then
            v_gast := greatest(v_vi + v_recib - v_vf, 0);                       -- entró diésel durante el día
            v_obs := public._fert_obs(v_obs, array['SUMINISTRO_DURANTE_DIA']);
        elsif p_inmediato then
            -- 144:msg
            raise exception 'El visor final (%) es mayor que el inicial (%): si entró diésel, anota el suministro; si no, corrige la lectura.',
                v_vf, v_vi;
        else
            v_gast := 0;
            v_obs := public._fert_obs(v_obs, array['VISOR_SUBE_SIN_RECEPCION']);
        end if;
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
        if not v_vc and prev.visor_fin is not null and abs(v_vi - prev.visor_fin) > 0.005 and v_recib = 0 then
            v_obs := public._fert_obs(v_obs, array['VISOR_NO_CONTINUA']);
        end if;
    end if;
    if v_horas = 0 and v_gast > 0 then
        v_obs := public._fert_obs(v_obs, array['CONSUMO_SIN_HORAS']);
    end if;

    v_cust := (select c.id from public.mot_custodias c
                where c.equipo_id = v_eq and c.desde <= v_momento and (c.hasta is null or c.hasta > v_momento)
                order by c.desde desc limit 1);

    insert into public.mot_registros
        (id, equipo_id, estacion_id, tanque_id, fecha, horo_ini, horo_fin, horas, visor_ini, visor_fin, recibido_gal, gastado_gal,
         rendimiento_gal_h, rpm, horo_cambiado, visor_cambiado, comentario, registrado_por, fecha_hora,
         caudal_ini, caudal_fin, operador, custodia_id)
    values
        (p_id, v_eq, v_est, v_tanque, v_fecha, v_hi, v_hf, v_horas, v_vi, v_vf, v_recib, v_gast,
         v_rend, v_rpm, v_hc, v_vc, v_coment, (select auth.uid()), v_fh,
         v_ci, v_cf, v_oper, v_cust);

    -- libro del tanque: el suministro declarado sin recepción lo SUBE (nunca baja la bodega); 140:sin-libro / 140:sin-consumo:
    -- un histórico no mueve nada.
    v_reciente := mo.fecha_ultimo is null or v_fecha > mo.fecha_ultimo;
    if v_hist then
        null;
    else
        if v_extra > 0 then
            -- 144:sum-mov (sin bodega): sube el tanque
            perform public._mot_mover(p_id, v_tanque, v_mat, 'SUMINISTRO', v_extra, v_momento, 'motor_registro', p_id);
        end if;
        v_primero := not exists (select 1 from public.mot_movimientos m where m.tanque_id = v_tanque and m.tipo = 'SALDO_INICIAL');
        if not v_reciente then
            v_obs := public._fert_obs(v_obs, array['FUERA_DE_ORDEN']);
        else
            v_saldo := public._mot_saldo_actual(v_tanque);
            v_ajuste := v_vf + v_gast - v_saldo;                              -- = visor inicial (+ suministro del día) − saldo del libro
            if not v_primero then
                v_dif := v_ajuste;   -- lo que el visor dice menos lo que el libro del tanque creía (faltan si es negativo)
                update public.mot_registros set dif_visor_gal = round(v_dif, 2) where id = p_id;
                if abs(v_dif) > 3 then
                    v_obs := public._fert_obs(v_obs, array[case when v_dif < 0 then 'VISOR_MENOR_QUE_SALDO' else 'VISOR_MAYOR_QUE_SALDO' end]);
                end if;
            end if;
            if abs(v_ajuste) > 0.0001 then
                perform public._mot_mover(p_id, v_tanque, v_mat, case when v_primero then 'SALDO_INICIAL' else 'AJUSTE_VISOR' end,
                                          v_ajuste, v_fh, 'motor_registro', p_id);
            end if;
        end if;
        -- 140:sin-consumo · el tanque baja por lo GASTADO
        perform public._mot_mover(p_id, v_tanque, v_mat, 'CONSUMO_MOTOR', -v_gast, v_fh, 'motor_registro', p_id);
    end if;

    -- proyección del motor: últimas lecturas (solo si es el más reciente) y horas hacia el mantenimiento (suma incremental)
    v_cuenta := mo.mant_ref_fecha is null or (case when mo.mant_ref_incl then v_fecha >= mo.mant_ref_fecha else v_fecha > mo.mant_ref_fecha end);
    update public.mot_motores
       set horo_ultimo = case when v_reciente then v_hf else horo_ultimo end,
           visor_ultimo = case when v_reciente then v_vf else visor_ultimo end,
           fecha_ultimo = case when v_reciente then v_fecha else fecha_ultimo end,
           horas_desde_mant = horas_desde_mant + case when v_cuenta then v_horas else 0 end
     where equipo_id = v_eq;

    v_sem := public._mot_semaforo(v_eq);
    if v_sem->>'nivel' = 'rojo' then
        v_obs := public._fert_obs(v_obs, array['MANTENIMIENTO_VENCIDO']);
    elsif v_sem->>'nivel' = 'amarillo' then
        v_obs := public._fert_obs(v_obs, array['MANTENIMIENTO_PROXIMO']);
    end if;
    update public.fert_operaciones set estacion_id = v_est where id = p_id;
    return v_obs;
end $$;
revoke execute on function public._mot_op_registro_diario(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------- 9 · parches (marca propia 147)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def   text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n     integer;
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '147: en % se esperaba 1 aparición de «%» y hay % (¿faltan 130/135/138/139/144/145?)', p_fn, left(v_viejo, 80), v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '147: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- 9a · lo que baja el teléfono: ayudas visuales, tanques, tramos y señales
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
$p$'material_diesel_id', (select c.material_diesel_id from public.mot_bajada_config c where c.id),$p$,
$p$'material_diesel_id', (select c.material_diesel_id from public.mot_bajada_config c where c.id),
        'ayuda', coalesce((select jsonb_agg(public._mot_estado_motor(q.equipo_id) order by q.codigo)
                             from (select mo2.equipo_id, e2.codigo from public.mot_motores mo2 join public.equipos e2 on e2.id = mo2.equipo_id
                                    where mo2.activo and mo2.estacion_id is not null and public.fn_fert_puede(mo2.estacion_id, 'ver')) q), '[]'::jsonb),
        'senales', coalesce((select jsonb_agg(jsonb_build_object('equipo_id', s.equipo_id, 'registro_id', s.registro_id, 'fecha', s.fecha,
                                                                 'nivel', s.nivel, 'codigo', s.codigo, 'texto', s.texto) order by s.fecha desc, s.codigo)
                               from public._mot_senales(array(select distinct rr.equipo_id from public.mot_registros rr
                                                               where rr.fecha >= v_desde and rr.anulado_at is null
                                                                 and public.fn_fert_puede(rr.estacion_id, 'ver')), v_desde, null) s
                              where exists (select 1 from public.mot_registros r3 where r3.id = s.registro_id and public.fn_fert_puede(r3.estacion_id, 'ver'))), '[]'::jsonb),
        'tanques', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'zona_id', t.zona_id, 'estacion_id', t.estacion_id,
                                                                  'capacidad_gal', t.capacidad_gal, 'motor_equipo_id', t.motor_equipo_id,
                                                                  'saldo_gal', coalesce((select s.disponible from public.mot_saldos s where s.tanque_id = t.id), 0)) order by t.nombre)
                               from public.mot_tanques t
                              where t.activo and ((t.estacion_id is not null and public.fn_fert_puede(t.estacion_id, 'ver')) or (t.estacion_id is null and v_conf))), '[]'::jsonb),
        'tramos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'equipo_id', c.equipo_id, 'ubicacion', c.ubicacion, 'estacion_id', c.estacion_id,
                                                                 'tanque_id', c.tanque_id, 'desde', c.desde, 'hasta', c.hasta,
                                                                 'horo_entrada', c.horo_entrada, 'horo_salida', c.horo_salida) order by c.desde desc)
                              from public.mot_custodias c
                             where c.estacion_id is not null and public.fn_fert_puede(c.estacion_id, 'ver')), '[]'::jsonb),$p$,
$p$'ayuda', coalesce((select jsonb_agg(public._mot_estado_motor$p$);

select pg_temp.parchar('public.fn_mot_estado_campo(date)',
$p$'motor_mantenimiento', v_conf or public.fn_tiene_permiso('motores', 'motor_mantenimiento')),$p$,
$p$'motor_mantenimiento', v_conf or public.fn_tiene_permiso('motores', 'motor_mantenimiento'),
            'auditar', public.fn_es_admin() or public.fn_tiene_permiso('motores', 'auditar')),$p$,
$p$'auditar', public.fn_es_admin()$p$);

select pg_temp.parchar('public.fn_mot_estado_campo(date)',
$p$'horo_cambiado', r.horo_cambiado, 'visor_cambiado', r.visor_cambiado, 'comentario', r.comentario,$p$,
$p$'horo_cambiado', r.horo_cambiado, 'visor_cambiado', r.visor_cambiado, 'comentario', r.comentario,
                       'caudal_ini', r.caudal_ini, 'caudal_fin', r.caudal_fin, 'operador', r.operador, 'dif_visor_gal', r.dif_visor_gal,
                       'custodia_id', r.custodia_id,
                       'registrado_por_nombre', (select p.nombre from public.perfiles p where p.id = r.registrado_por),$p$,
$p$'registrado_por_nombre'$p$);

-- 9b · bajada a AGL: las columnas nuevas vacías NO entran a la huella (los ya bajados no se vuelven a «cambiar»); custodia_id nunca sale
select pg_temp.parchar('public._mot_filas(uuid[])',
$p$((to_jsonb(r) - 'bajado_a_agl_en') - 'huella') || jsonb_build_object('tabla', 'registro')$p$,
$p$(((to_jsonb(r) - 'bajado_a_agl_en') - 'huella') - 'custodia_id'
                 - (select coalesce(array_agg(k.k), '{}'::text[]) from (values ('caudal_ini', r.caudal_ini::text), ('caudal_fin', r.caudal_fin::text),
                        ('operador', r.operador), ('dif_visor_gal', r.dif_visor_gal::text)) k(k, v) where k.v is null)   -- 147:huella
                 ) || jsonb_build_object('tabla', 'registro')$p$,
$p$147:huella$p$);

-- 9c · bodega general: el diésel que quedó en la bodega (144) se muestra como LEGADO (no se sigue usando)
select pg_temp.parchar('public.fn_fert_bodega_general()',
$p$when m.id = v_diesel then 'DIESEL' when$p$,
$p$when m.id = v_diesel then 'DIESEL_LEGADO' when$p$,
$p$'DIESEL_LEGADO'$p$);


-- ---------------------------------------------------------------- 10 · administración de tanques, ficha de auditoría, resumen y catálogo para AGL
/** p = {id?, nombre, zona_id?, capacidad_gal?, activo?} → {id}. Permiso: Configurar (Motores). Nombre único entre los activos. */
create or replace function public.fn_mot_tanque_guardar(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id     uuid := public._fert_uuid(p->>'id');
    v_nombre text := nullif(btrim(coalesce(p->>'nombre', '')), '');
    v_zona   uuid := public._fert_uuid(p->>'zona_id');
    v_cap    numeric := public._mot_num(p->>'capacidad_gal');
    v_activo boolean := coalesce((p->>'activo')::boolean, true);
begin
    perform public._mot_exigir_permiso('configurar');
    if v_nombre is null then
        raise exception 'Escribe el nombre del tanque.';
    end if;
    if v_zona is not null and not exists (select 1 from public.zonas where id = v_zona) then
        raise exception 'La zona no existe.';
    end if;
    if nullif(btrim(coalesce(p->>'capacidad_gal', '')), '') is not null and (v_cap is null or v_cap <= 0) then
        raise exception 'La capacidad debe ser mayor que cero.';
    end if;
    if v_activo and exists (select 1 from public.mot_tanques x where x.activo and x.id is distinct from v_id
                              and public._mot_norm(x.nombre) = public._mot_norm(v_nombre)) then
        raise exception 'Ya existe un tanque con ese nombre.';
    end if;
    if v_id is null then
        insert into public.mot_tanques (nombre, zona_id, capacidad_gal, activo) values (v_nombre, v_zona, v_cap, v_activo) returning id into v_id;
    else
        if not exists (select 1 from public.mot_tanques where id = v_id) then
            raise exception 'El tanque no existe.';
        end if;
        if not v_activo and (public._mot_saldo_actual(v_id) > 0.0001
                             or exists (select 1 from public.mot_tanques x where x.id = v_id and x.motor_equipo_id is not null)) then
            raise exception 'No se puede desactivar un tanque con diésel o con un motor conectado.';
        end if;
        update public.mot_tanques set nombre = v_nombre, zona_id = v_zona, capacidad_gal = v_cap, activo = v_activo where id = v_id;
    end if;
    return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.fn_mot_tanque_guardar(jsonb) from public, anon;
grant  execute on function public.fn_mot_tanque_guardar(jsonb) to authenticated;

/** Asigna el tanque a una estación (p_estacion null = sin estación). Con motor conectado no se mueve. */
create or replace function public.fn_mot_tanque_asignar(p_tanque uuid, p_estacion uuid, p_motivo text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    t public.mot_tanques%rowtype;
begin
    perform public._mot_exigir_permiso('configurar');
    select * into t from public.mot_tanques where id = p_tanque and activo for update;
    if not found then
        raise exception 'El tanque no existe o no está activo.';
    end if;
    if p_estacion is not null and not exists (select 1 from public.estaciones_riego where id = p_estacion) then
        raise exception 'La estación no existe.';
    end if;
    if p_estacion is not null and not public.fn_fert_puede(p_estacion, 'ver') then
        raise exception 'No tienes acceso a esa estación.' using errcode = '42501';
    end if;
    if p_estacion is not null and public._fert_es_prueba(p_estacion) and t.nombre not like 'PRUEBA-T-%' then
        raise exception 'Un tanque real no se asigna a una estación de prueba.';
    end if;
    if t.estacion_id is not distinct from p_estacion then
        return jsonb_build_object('id', t.id, 'cambio', false);
    end if;
    if t.motor_equipo_id is not null then
        raise exception 'El tanque tiene un motor conectado: mueve o retira el motor antes de cambiar el tanque de estación.';
    end if;
    update public.mot_tanques set estacion_id = p_estacion, asignado_at = now(), asignado_por = (select auth.uid()) where id = p_tanque;
    insert into public.mot_tanque_historial (tanque_id, estacion_antes, estacion_nueva, motivo, hecho_por)
    values (p_tanque, t.estacion_id, p_estacion, nullif(btrim(coalesce(p_motivo, '')), ''), (select auth.uid()));
    return jsonb_build_object('id', t.id, 'cambio', true);
end $$;
revoke execute on function public.fn_mot_tanque_asignar(uuid, uuid, text) from public, anon;
grant  execute on function public.fn_mot_tanque_asignar(uuid, uuid, text) to authenticated;

/** Lista de tanques para administrar (Configurar o Auditar). */
create or replace function public.fn_mot_tanques_listar()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not (public.fn_es_admin() or public.fn_tiene_permiso('motores', 'configurar') or public.fn_tiene_permiso('motores', 'auditar')) then
        raise exception 'Tu rol no tiene «Configurar» ni «Auditar» en Motores y combustible.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', t.id, 'nombre', t.nombre, 'zona_id', t.zona_id, 'zona', z.nombre, 'estacion_id', t.estacion_id, 'estacion', e.nombre,
                   'capacidad_gal', t.capacidad_gal, 'activo', t.activo, 'motor_equipo_id', t.motor_equipo_id, 'motor', q.codigo,
                   'saldo_gal', coalesce((select s.disponible from public.mot_saldos s where s.tanque_id = t.id), 0),
                   'tipo', case when t.nombre like 'PRUEBA-T-%' then 'PRACTICA' else 'REAL' end) order by z.nombre, t.nombre)
          from public.mot_tanques t
          left join public.zonas z on z.id = t.zona_id
          left join public.estaciones_riego e on e.id = t.estacion_id
          left join public.equipos q on q.id = t.motor_equipo_id
         where t.nombre not like 'PRUEBA-T-%'), '[]'::jsonb);
end $$;
revoke execute on function public.fn_mot_tanques_listar() from public, anon;
grant  execute on function public.fn_mot_tanques_listar() to authenticated;

/** Motores activos y movidos de un vistazo, para quien audita (y el administrador). */
create or replace function public.fn_mot_motores_resumen()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if not (public.fn_es_admin() or public.fn_tiene_permiso('motores', 'auditar')) then
        raise exception 'Tu rol no tiene «Auditar» en Motores y combustible. Se concede en Permisos.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'equipo_id', mo.equipo_id, 'codigo', e.codigo, 'nombre', e.nombre, 'modelo', mo.modelo, 'estado', mo.estado,
                   'estacion_id', mo.estacion_id, 'estacion', er.nombre, 'zona', z.nombre,
                   'tanque_id', mo.tanque_id, 'tanque', t.nombre,
                   'horo_ultimo', mo.horo_ultimo, 'fecha_ultimo', mo.fecha_ultimo,
                   'tramos', (select count(*) from public.mot_custodias c where c.equipo_id = mo.equipo_id),
                   'ayuda', public._mot_estado_motor(mo.equipo_id)) order by e.codigo)
          from public.mot_motores mo
          join public.equipos e on e.id = mo.equipo_id
          left join public.estaciones_riego er on er.id = mo.estacion_id
          left join public.zonas z on z.id = er.zona_id
          left join public.mot_tanques t on t.id = mo.tanque_id
         where mo.activo and mo.prueba_de is null), '[]'::jsonb);
end $$;
revoke execute on function public.fn_mot_motores_resumen() from public, anon;
grant  execute on function public.fn_mot_motores_resumen() to authenticated;

/**
 * Ficha COMPLETA de un motor (auditoría): todos los tramos de custodia con su resumen, la línea de tiempo de movimientos, y
 * todos los registros con TODOS los campos de la hoja FTR_F-MA-103 y sus señales. Solo con «Auditar» (o administrador).
 * p_desde/p_hasta acotan registros y recepciones (por defecto, todo lo que aún está en Supabase; el resto lo tiene AGL).
 */
create or replace function public.fn_mot_ficha_completa(p_equipo uuid, p_desde date default null, p_hasta date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_hoy date := public._mot_dia(now());
begin
    if not (public.fn_es_admin() or public.fn_tiene_permiso('motores', 'auditar')) then
        raise exception 'Tu rol no tiene «Auditar» en Motores y combustible. Se concede en Permisos.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.mot_motores where equipo_id = p_equipo) then
        raise exception 'El motor no existe.';
    end if;
    return jsonb_build_object(
        'servidor_en', now(),
        'motor', (select jsonb_build_object('equipo_id', mo.equipo_id, 'codigo', e.codigo, 'nombre', e.nombre, 'modelo', mo.modelo, 'estado', mo.estado,
                                            'estacion_id', mo.estacion_id, 'estacion', er.nombre, 'tanque_id', mo.tanque_id,
                                            'horo_ultimo', mo.horo_ultimo, 'visor_ultimo', mo.visor_ultimo, 'fecha_ultimo', mo.fecha_ultimo,
                                            'horas_desde_mant', mo.horas_desde_mant, 'intervalo_horas', public._mot_intervalo(mo.equipo_id))
                    from public.mot_motores mo join public.equipos e on e.id = mo.equipo_id
                    left join public.estaciones_riego er on er.id = mo.estacion_id where mo.equipo_id = p_equipo),
        'ayuda', public._mot_estado_motor(p_equipo),
        'tramos', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', c.id, 'ubicacion', c.ubicacion, 'estacion_id', c.estacion_id, 'estacion', er.nombre, 'zona', z.nombre,
                       'tanque_id', c.tanque_id, 'tanque', t.nombre, 'desde', c.desde, 'hasta', c.hasta,
                       'horo_entrada', c.horo_entrada, 'horo_salida', c.horo_salida,
                       'horas_horometro', case when c.horo_entrada is not null and c.horo_salida is not null then c.horo_salida - c.horo_entrada end,
                       'registros', x.n, 'horas', x.horas, 'gal_gastados', x.gal, 'gal_suministrados', x.sum, 'rendimiento_prom', x.rend,
                       'dias_sin_registro', case when c.ubicacion = 'ESTACION'
                            then greatest((least(coalesce(public._mot_dia(c.hasta), v_hoy), v_hoy) - public._mot_dia(c.desde) + 1) - x.n, 0) end)
                   order by c.desde desc)
              from public.mot_custodias c
              left join public.estaciones_riego er on er.id = c.estacion_id
              left join public.zonas z on z.id = er.zona_id
              left join public.mot_tanques t on t.id = c.tanque_id
              left join lateral (
                  select count(*) as n, coalesce(sum(r.horas), 0) as horas, coalesce(sum(r.gastado_gal), 0) as gal,
                         coalesce(sum(r.recibido_gal), 0) as sum,
                         case when sum(r.horas) > 0 then round(sum(r.gastado_gal) / sum(r.horas), 2) end as rend
                    from public.mot_registros r
                   where r.equipo_id = c.equipo_id and r.anulado_at is null
                     and r.fecha >= public._mot_dia(c.desde) and (c.hasta is null or r.fecha <= public._mot_dia(c.hasta))) x on true
             where c.equipo_id = p_equipo), '[]'::jsonb),
        'movimientos', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', a.id, 'tipo', a.tipo, 'fecha_hora', a.fecha_hora, 'estacion_origen', a.estacion_origen, 'estacion_destino', a.estacion_destino,
                       'tanque_id', a.tanque_id, 'motivo', a.motivo, 'motivo_codigo', a.motivo_codigo, 'horometro', a.horometro, 'diesel_gal', a.diesel_gal,
                       'saldo_gal', a.saldo_gal, 'observacion', a.observacion, 'anulado_at', a.anulado_at, 'motivo_anulacion', a.motivo_anulacion,
                       'registrado_por', (select p.nombre from public.perfiles p where p.id = a.registrado_por)) order by a.fecha_hora desc)
              from public.mot_asignaciones a where a.equipo_id = p_equipo), '[]'::jsonb),
        'registros', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'fecha', r.fecha, 'estacion_id', r.estacion_id, 'tanque_id', r.tanque_id, 'custodia_id', r.custodia_id,
                       'horo_ini', r.horo_ini, 'horo_fin', r.horo_fin, 'horas', r.horas,
                       'visor_ini', r.visor_ini, 'visor_fin', r.visor_fin, 'gastado_gal', r.gastado_gal, 'recibido_gal', r.recibido_gal,
                       'rendimiento_gal_h', r.rendimiento_gal_h, 'rpm', r.rpm, 'caudal_ini', r.caudal_ini, 'caudal_fin', r.caudal_fin,
                       'operador', r.operador, 'dif_visor_gal', r.dif_visor_gal, 'comentario', r.comentario,
                       'horo_cambiado', r.horo_cambiado, 'visor_cambiado', r.visor_cambiado,
                       'registrado_por', (select p.nombre from public.perfiles p where p.id = r.registrado_por), 'fecha_hora', r.fecha_hora,
                       'anulado_at', r.anulado_at, 'motivo_anulacion', r.motivo_anulacion, 'observaciones', to_jsonb(o.observaciones))
                   order by r.fecha desc, r.fecha_hora desc)
              from (select * from public.mot_registros z where z.equipo_id = p_equipo
                       and (p_desde is null or z.fecha >= p_desde) and (p_hasta is null or z.fecha <= p_hasta)
                     order by z.fecha desc limit 800) r
              left join public.fert_operaciones o on o.id = r.id), '[]'::jsonb),
        'recepciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', r.id, 'tanque_id', r.tanque_id, 'estacion_id', r.estacion_id, 'galones', r.galones, 'fecha_hora', r.fecha_hora,
                       'chofer', (select c.nombre from public.fert_choferes c where c.id = r.chofer_id),
                       'vehiculo', (select v.placa from public.fert_vehiculos v where v.id = r.vehiculo_id),
                       'comentario', r.comentario, 'registrado_por', (select p.nombre from public.perfiles p where p.id = r.registrado_por),
                       'anulado_at', r.anulado_at) order by r.fecha_hora desc)
              from public.mot_recepciones r
             where r.tanque_id in (select c.tanque_id from public.mot_custodias c where c.equipo_id = p_equipo and c.tanque_id is not null)
               and (p_desde is null or public._mot_dia(r.fecha_hora) >= p_desde) and (p_hasta is null or public._mot_dia(r.fecha_hora) <= p_hasta)), '[]'::jsonb),
        'mantenimientos', coalesce((
            select jsonb_agg(jsonb_build_object('id', m.id, 'fecha_hora', m.fecha_hora, 'horometro', m.horometro, 'tipo', m.tipo, 'nota', m.nota,
                                                'horas_antes', m.horas_antes, 'estacion_id', m.estacion_id, 'anulado_at', m.anulado_at) order by m.fecha_hora desc)
              from public.mot_mantenimientos m where m.equipo_id = p_equipo), '[]'::jsonb),
        'senales', coalesce((
            select jsonb_agg(jsonb_build_object('registro_id', s.registro_id, 'fecha', s.fecha, 'nivel', s.nivel, 'codigo', s.codigo, 'texto', s.texto)
                             order by s.fecha desc, s.codigo)
              from public._mot_senales(array[p_equipo], p_desde, p_hasta) s), '[]'::jsonb));
end $$;
revoke execute on function public.fn_mot_ficha_completa(uuid, date, date) from public, anon;
grant  execute on function public.fn_mot_ficha_completa(uuid, date, date) to authenticated;

/** AGL: tanques (catálogo fijo con saldo) y tramos de custodia de los motores reales. Permiso: Conexión AGL · ver. */
create or replace function public.fn_mot_catalogo_para_agl()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    perform public._mot_exigir_agl('ver');
    return jsonb_build_object(
        'generado', now(),
        'tanques', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', t.id, 'nombre', t.nombre, 'zona', z.nombre, 'estacion_id', t.estacion_id, 'estacion', e.nombre,
                       'capacidad_gal', t.capacidad_gal, 'activo', t.activo, 'motor_codigo', q.codigo,
                       'saldo_gal', coalesce((select s.disponible from public.mot_saldos s where s.tanque_id = t.id), 0)) order by t.nombre)
              from public.mot_tanques t
              left join public.zonas z on z.id = t.zona_id
              left join public.estaciones_riego e on e.id = t.estacion_id
              left join public.equipos q on q.id = t.motor_equipo_id
             where t.nombre not like 'PRUEBA-T-%' and (t.estacion_id is null or not public._fert_es_prueba(t.estacion_id))), '[]'::jsonb),
        'custodias', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', c.id, 'motor_codigo', q.codigo, 'ubicacion', c.ubicacion, 'estacion', e.nombre, 'tanque', t.nombre,
                       'desde', c.desde, 'hasta', c.hasta, 'horo_entrada', c.horo_entrada, 'horo_salida', c.horo_salida) order by q.codigo, c.desde)
              from public.mot_custodias c
              join public.equipos q on q.id = c.equipo_id
              left join public.estaciones_riego e on e.id = c.estacion_id
              left join public.mot_tanques t on t.id = c.tanque_id
             where not public._mot_es_prueba(c.equipo_id)), '[]'::jsonb));
end $$;
revoke execute on function public.fn_mot_catalogo_para_agl() from public, anon;
grant  execute on function public.fn_mot_catalogo_para_agl() to authenticated;

notify pgrst, 'reload schema';
