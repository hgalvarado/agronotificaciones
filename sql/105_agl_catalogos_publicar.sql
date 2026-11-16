-- =====================================================================
-- 105 · AGL PUBLICA LOS CATÁLOGOS: ZONAS, TEMPORADAS, ESTACIONES Y TURNOS (Fase A, primer bloque)
-- =====================================================================
-- Plan aprobado: docs/agl-fuente-unica.md (decisiones del usuario del 2026-11-13). AGL es la ÚNICA fuente; Supabase
-- solo recibe (intermediario). Este bloque cubre zonas, temporadas, estaciones de riego y turnos. Materiales,
-- variedades, tareas y lotes van después (106+). Nada se pone de solo lectura todavía (eso es la fase B).
--
-- Qué trae:
--   1 · Respaldo de las 4 tablas (y del historial de tasas) en `respaldo.*_m105`, solo la primera vez.
--   2 · Columna `agl_id` en zonas, temporadas, estaciones_riego y turnos: el id de AGL de cada fila. La primera
--       publicación lo anota (cruce por nombre normalizado); desde ahí se cruza por ese id: un cambio de nombre
--       en AGL renombra aquí, no duplica. Los ids de Supabase NO cambian (tickets, Fertirriego, Desinfección…
--       siguen apuntando a lo mismo).
--   3 · `seguridad.agl_publicaciones`: bitácora de cada publicación real, con la foto ANTES de cada fila tocada
--       (sirve para deshacer a mano). Fuera de `public` (no se expone por la API).
--   4 · Pantalla de permisos «Catálogos · Conexión AGL» (catalogos_agl: ver, publicar). La reciben los roles que
--       ya tienen las mismas casillas en «Fertirriego · Conexión AGL» (el usuario técnico de AGL). Sin nombres de
--       rol en el código.
--   5 · fn_agl_publicar_catalogos(p jsonb): con `simular: true` (por defecto) devuelve la VISTA PREVIA sin escribir:
--       qué se crea, qué se actualiza (y qué campos), cómo se emparejó cada fila (por id de AGL, por nombre, por
--       parecido o elegida por el usuario), qué se desactiva y qué NO se desactiva y por qué. Devuelve una huella:
--       la publicación real exige la misma huella (lo que se aplica es exactamente lo que se vio).
--       Reglas:
--         - Nunca borra nada. Lo que AGL ya no tiene queda `activo = false` (solo si el paquete viene `completo`).
--         - No desactiva una estación con saldo, custodio, turnos publicados o traslados pendientes; ni un turno
--           con turnos de Fertirriego vivos o plan de Desinfección en la temporada activa; ni una zona que se
--           queda con estaciones o turnos activos, lotes en la temporada activa o personas que solo tienen esa zona.
--         - Las estaciones «PRUEBA · X» (modo de pruebas) no se tocan nunca.
--         - Columnas que AGL deja vacías (responsable, correo, teléfono) no borran lo que hay aquí.
--         - Temporadas: nunca se desactivan por faltar en AGL; si AGL trae más de una «Activa», se detiene.
--           La tasa de AGL entra al historial de tasas como una vigencia más (desde hoy, UTC-6), sin tocar lo
--           anterior; si la temporada no tiene ninguna, desde su fecha de inicio.
--   6 · fn_fert_publicar («Publicar a campo»): las estaciones también se cruzan por `agl_id` (parche puntual que
--       conserva los de la 102). No desactiva nada: eso solo lo hace la publicación de catálogos, con vista previa.
--   7 · Materiales: el código « 100019» (con espacio delante) pasa a «100019» SOLO si no existe ya otro «100019».
--       Si existen los dos, no se toca (se resuelve en el bloque de materiales).
--
-- Correr DESPUÉS de la 104 (y en cualquier orden respecto de la 109/110). Idempotente. Sin CASCADE.
-- Todo UPDATE/DELETE lleva WHERE (Supabase lo exige aun dentro de funciones).
--
-- REVERSA (no toca datos de las tablas existentes, salvo lo que ya se haya publicado):
--   drop function if exists public.fn_agl_publicar_catalogos(jsonb), public._agl_parecido(text, text),
--        public._agl_trigramas(text), public._agl_digitos(text);
--   drop table if exists seguridad.agl_publicaciones;
--   alter table public.zonas drop column if exists agl_id;   (ídem temporadas, estaciones_riego, turnos)
--   delete from public.permisos where recurso = 'catalogos_agl';  delete from public.pantallas where codigo = 'catalogos_agl';
--   Para deshacer una publicación: la columna `cambios` de seguridad.agl_publicaciones trae «antes» de cada fila.
-- =====================================================================


-- ---------------------------------------------------------------- 1 · respaldo (solo la primera vez)

create schema if not exists respaldo;
revoke all on schema respaldo from public, anon, authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['zonas', 'temporadas', 'estaciones_riego', 'turnos', 'historial_tasas_temporada'] loop
        if to_regclass('respaldo.' || t || '_m105') is null then
            execute format('create table respaldo.%I as table public.%I', t || '_m105', t);
        end if;
    end loop;
    if to_regclass('respaldo.materiales_m105') is null then
        create table respaldo.materiales_m105 as
            select * from public.materiales where codigo <> btrim(codigo) or btrim(codigo) = '100019';
    end if;
end $$;


-- ---------------------------------------------------------------- 2 · id de AGL en cada catálogo

alter table public.zonas            add column if not exists agl_id text;
alter table public.temporadas       add column if not exists agl_id text;
alter table public.estaciones_riego add column if not exists agl_id text;
alter table public.turnos           add column if not exists agl_id text;

create unique index if not exists zonas_agl_id_key            on public.zonas (agl_id)            where agl_id is not null;
create unique index if not exists temporadas_agl_id_key       on public.temporadas (agl_id)       where agl_id is not null;
create unique index if not exists estaciones_riego_agl_id_key on public.estaciones_riego (agl_id) where agl_id is not null;
create unique index if not exists turnos_agl_id_key           on public.turnos (agl_id)           where agl_id is not null;

comment on column public.zonas.agl_id is '105: id de la zona en AGL (/ZN01). AGL manda; se cruza por este id.';
comment on column public.temporadas.agl_id is '105: id de la temporada en AGL (/TM01). AGL manda; se cruza por este id.';
comment on column public.estaciones_riego.agl_id is '105: id de la estación en AGL (/ER01). AGL manda; se cruza por este id.';
comment on column public.turnos.agl_id is '105: id del turno en AGL (/TR01). AGL manda; se cruza por este id.';


-- ---------------------------------------------------------------- 3 · bitácora de publicaciones

create table if not exists seguridad.agl_publicaciones (
    id            bigint generated always as identity primary key,
    publicado_por uuid,
    publicado_at  timestamptz not null default now(),
    huella        text not null,
    completo      boolean not null default false,
    resumen       jsonb not null default '{}',
    cambios       jsonb not null default '[]',
    avisos        text[] not null default '{}'
);
comment on table seguridad.agl_publicaciones is
'105: cada publicación de catálogos desde AGL (fn_agl_publicar_catalogos). «cambios» guarda antes y después de cada fila.';
alter table seguridad.agl_publicaciones enable row level security;
revoke all on seguridad.agl_publicaciones from public, anon, authenticated;


-- ---------------------------------------------------------------- 4 · permisos (sin nombres de rol)

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones, modulo)
values ('catalogos_agl', 'Catálogos · Conexión AGL',
        'Para el usuario técnico de AGL: publica zonas, temporadas, estaciones de riego y turnos (AGL es la fuente). «Ver» = vista previa.',
        null, 86, array['ver', 'publicar'], 'Catálogos')
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, acciones = excluded.acciones,
    modulo = coalesce(public.pantallas.modulo, excluded.modulo);

-- Quien ya publica a Fertirriego desde AGL (misma conexión) recibe lo mismo aquí. Solo filas nuevas.
insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
select pm.rol_id, 'catalogos_agl', pm.accion, pm.permitido, 'global', 'sin_restriccion'
from public.permisos pm
where pm.recurso = 'fertirriego_agl' and pm.accion in ('ver', 'publicar') and pm.permitido
on conflict (rol_id, recurso, accion) do nothing;


-- ---------------------------------------------------------------- 5 · parecido entre nombres (sin extensiones)

/** Trigramas de la llave normalizada (sin mayúsculas, espacios ni guiones). */
create or replace function public._agl_trigramas(p text)
returns text[]
language sql immutable set search_path = public, pg_temp as $$
    select coalesce(array_agg(distinct substr(x.s, i, 3)), '{}')
    from (select '  ' || coalesce(public._fert_llave(p), '') || ' ' as s) x
    cross join lateral generate_series(1, greatest(length(x.s) - 2, 0)) i
$$;

/** Solo los dígitos de un nombre («Papalon-2» → «2»): dos nombres con números distintos NO son la misma estación. */
create or replace function public._agl_digitos(p text)
returns text
language sql immutable as $$
    select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g')
$$;

/** Parecido 0..1 (Jaccard de trigramas). 0 si los dos traen números y no coinciden. */
create or replace function public._agl_parecido(a text, b text)
returns numeric
language sql immutable set search_path = public, pg_temp as $$
    select case
        when public._agl_digitos(a) <> '' and public._agl_digitos(b) <> ''
             and public._agl_digitos(a) <> public._agl_digitos(b) then 0::numeric
        else coalesce((
            select round(
                (select count(*) from (select unnest(public._agl_trigramas(a)) intersect select unnest(public._agl_trigramas(b))) i)::numeric
                / nullif((select count(*) from (select unnest(public._agl_trigramas(a)) union select unnest(public._agl_trigramas(b))) u), 0),
                3)), 0::numeric)
    end
$$;


-- ---------------------------------------------------------------- 6 · la publicación

create or replace function public.fn_agl_publicar_catalogos(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_simular  boolean := coalesce((p->>'simular')::boolean, true);    -- por defecto SOLO vista previa
    v_completo boolean := coalesce((p->>'completo')::boolean, false);
    v_hoy      date := (now() at time zone 'America/Tegucigalpa')::date;
    v_avisos   text[] := '{}';
    v_huella   text;
    v_pub_id   bigint;
    v_activas  integer;
    v_temp_act text;
    v_n        integer;
    v_lista    text;
    r  record;
    c  record;
    v_id     uuid;
    v_antes  jsonb;
    v_despues jsonb;
    v_zona   uuid;
    v_tasa   numeric;
    v_desde  date;
    v_cat    text;
begin
    -- ---- quién ----
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if v_simular then
        if not (public.fn_es_admin() or public.fn_tiene_permiso('catalogos_agl', 'ver')
                or public.fn_tiene_permiso('catalogos_agl', 'publicar')) then
            raise exception 'Este usuario no tiene «Ver» en «Catálogos · Conexión AGL».' using errcode = '42501';
        end if;
    elsif not (public.fn_es_admin() or public.fn_tiene_permiso('catalogos_agl', 'publicar')) then
        raise exception 'Este usuario no tiene «Publicar» en «Catálogos · Conexión AGL».' using errcode = '42501';
    end if;

    -- ---- el paquete ----
    foreach v_cat in array array['zonas', 'temporadas', 'estaciones', 'turnos'] loop
        if p ? v_cat and jsonb_typeof(p->v_cat) <> 'array' then
            raise exception 'El paquete trae «%» y no es una lista.', v_cat using errcode = '22023';
        end if;
    end loop;

    if to_regclass('pg_temp._agl_in') is null then
        create temp table _agl_in (
        catalogo text, agl_id text, nombre text, llave text, datos jsonb, local_pedido text
    ) on commit drop;
    end if;
    truncate _agl_in;
    insert into _agl_in
    select k.cat, nullif(btrim(x->>'agl_id'), ''), nullif(btrim(x->>k.campo), ''), public._fert_llave(x->>k.campo), x,
           nullif(btrim(x->>'local_id'), '')
    from (values ('zonas', 'nombre'), ('temporadas', 'nombre'), ('estaciones', 'nombre'), ('turnos', 'codigo')) k(cat, campo)
    cross join lateral jsonb_array_elements(coalesce(p->k.cat, '[]')) x;

    select string_agg(format('%s (%s)', catalogo, coalesce(nombre, agl_id, '?')), ', ') into v_lista
    from _agl_in where agl_id is null or nombre is null;
    if v_lista is not null then
        raise exception 'Filas sin id de AGL o sin nombre: %.', v_lista using errcode = '22023';
    end if;
    select string_agg(format('%s «%s»', catalogo, nombre), ', ') into v_lista
    from (select catalogo, min(nombre) nombre from _agl_in group by catalogo, agl_id having count(*) > 1
          union all
          select catalogo, min(nombre) from _agl_in group by catalogo, llave having count(*) > 1) d;
    if v_lista is not null then
        raise exception 'AGL trae repetidos (mismo id o mismo nombre): %. Corrígelo en AGL.', v_lista using errcode = '22023';
    end if;

    select count(*) into v_activas from _agl_in where catalogo = 'temporadas' and (datos->>'activa')::boolean;
    if v_activas > 1 then
        raise exception 'AGL tiene % temporadas «Activa». Debe haber una sola (/TM01).', v_activas using errcode = '22023';
    end if;
    select string_agg(nombre, ', ') into v_lista
    from _agl_in where catalogo = 'temporadas'
      and ((datos->>'fecha_inicio') is null or (datos->>'fecha_fin') is null
           or (datos->>'fecha_fin')::date < (datos->>'fecha_inicio')::date);
    if v_lista is not null then
        raise exception 'Temporadas con fechas incompletas o al revés: %.', v_lista using errcode = '22023';
    end if;

    -- ---- el plan: una fila por cambio (o por fila sin cambios, para mostrar el emparejamiento) ----
    if to_regclass('pg_temp._agl_plan') is null then
        create temp table _agl_plan (
        orden     integer,
        catalogo  text,
        accion    text,          -- crear · actualizar · sin_cambios · desactivar · protegida · conflicto · solo_local
        local_id  uuid,
        agl_id    text,
        nombre    text,          -- como queda (o como está, si no cambia)
        antes     jsonb,
        despues   jsonb,
        por       text,          -- agl_id · nombre · parecido · elegida · nueva
        parecido  numeric,
        candidatos jsonb,
        motivo    text
    ) on commit drop;
    end if;
    truncate _agl_plan;

    -- =========== ZONAS ===========
    for r in select * from _agl_in where catalogo = 'zonas' order by llave loop
        v_id := (select z.id from public.zonas z where z.agl_id = r.agl_id);
        if v_id is not null then
            insert into _agl_plan (orden, catalogo, local_id, agl_id, por) values (1, 'zonas', v_id, r.agl_id, 'agl_id');
        else
            v_id := (select z.id from public.zonas z
                     where public._fert_llave(z.nombre) = r.llave
                       and (z.agl_id is null or z.agl_id not in (select agl_id from _agl_in where catalogo = 'zonas'))
                       and z.id not in (select local_id from _agl_plan where catalogo = 'zonas' and local_id is not null)
                     limit 1);
            insert into _agl_plan (orden, catalogo, local_id, agl_id, por)
            values (1, 'zonas', coalesce(v_id, gen_random_uuid()), r.agl_id, case when v_id is null then 'nueva' else 'nombre' end);
        end if;
    end loop;
    -- (las nuevas no tienen fila en zonas: «antes» queda nulo)
    update _agl_plan pl
       set antes = (select jsonb_build_object('nombre', z.nombre, 'responsable', z.responsable,
                                              'correo_electronico', z.correo_electronico, 'telefono', z.telefono,
                                              'activo', z.activo, 'agl_id', z.agl_id)
                    from public.zonas z where z.id = pl.local_id),
           despues = jsonb_build_object(
                       'nombre', i.nombre,
                       'responsable', coalesce(nullif(btrim(i.datos->>'responsable'), ''),
                                               (select z.responsable from public.zonas z where z.id = pl.local_id)),
                       'correo_electronico', coalesce(nullif(btrim(i.datos->>'correo'), ''),
                                                      (select z.correo_electronico from public.zonas z where z.id = pl.local_id)),
                       'telefono', coalesce(nullif(btrim(i.datos->>'telefono'), ''),
                                            (select z.telefono from public.zonas z where z.id = pl.local_id)),
                       'activo', true, 'agl_id', i.agl_id)
      from _agl_in i
     where pl.catalogo = 'zonas' and i.catalogo = 'zonas' and i.agl_id = pl.agl_id;

    -- =========== TEMPORADAS ===========
    for r in select * from _agl_in where catalogo = 'temporadas' order by llave loop
        v_id := (select t.id from public.temporadas t where t.agl_id = r.agl_id);
        if v_id is not null then
            insert into _agl_plan (orden, catalogo, local_id, agl_id, por) values (2, 'temporadas', v_id, r.agl_id, 'agl_id');
        else
            v_id := (select t.id from public.temporadas t
                     where public._fert_llave(t.nombre) = r.llave
                       and (t.agl_id is null or t.agl_id not in (select agl_id from _agl_in where catalogo = 'temporadas'))
                       and t.id not in (select local_id from _agl_plan where catalogo = 'temporadas' and local_id is not null)
                     limit 1);
            insert into _agl_plan (orden, catalogo, local_id, agl_id, por)
            values (2, 'temporadas', coalesce(v_id, gen_random_uuid()), r.agl_id, case when v_id is null then 'nueva' else 'nombre' end);
        end if;
    end loop;
    update _agl_plan pl
       set antes = (select jsonb_build_object('nombre', t.nombre, 'fecha_inicio', t.fecha_inicio, 'fecha_fin', t.fecha_fin,
                                              'activa', t.activa, 'agl_id', t.agl_id)
                    from public.temporadas t where t.id = pl.local_id),
           despues = jsonb_build_object(
               'nombre', i.nombre, 'fecha_inicio', (i.datos->>'fecha_inicio')::date, 'fecha_fin', (i.datos->>'fecha_fin')::date,
               -- sin ninguna «Activa» en AGL no se cambia cuál es la activa aquí
               'activa', case when v_activas = 1 then coalesce((i.datos->>'activa')::boolean, false)
                              else coalesce((select t.activa from public.temporadas t where t.id = pl.local_id), false) end,
               'agl_id', i.agl_id)
      from _agl_in i
     where pl.catalogo = 'temporadas' and i.catalogo = 'temporadas' and i.agl_id = pl.agl_id;
    if v_activas = 0 and exists (select 1 from _agl_in where catalogo = 'temporadas') then
        v_avisos := v_avisos || 'AGL no tiene ninguna temporada «Activa»: no se cambia cuál es la activa aquí.'::text;
    end if;
    -- Temporadas que AGL no tiene: nunca se tocan (solo se informan)
    insert into _agl_plan (orden, catalogo, accion, local_id, agl_id, nombre, antes, motivo)
    select 2, 'temporadas', 'solo_local', t.id, t.agl_id, t.nombre,
           jsonb_build_object('nombre', t.nombre, 'activa', t.activa),
           case when t.activa and v_activas = 1 then 'Está activa aquí y AGL tiene otra activa: deja de ser la activa.'
                else 'No está en AGL: no se toca (las temporadas nunca se desactivan desde aquí).' end
    from public.temporadas t
    where exists (select 1 from _agl_in where catalogo = 'temporadas')
      and t.id not in (select local_id from _agl_plan where catalogo = 'temporadas');

    -- Tasa de cambio: una vigencia más si AGL trae una distinta de la vigente
    for r in select pl.local_id, pl.por, (i.datos->>'tasa_cambio_usd')::numeric tasa, (i.datos->>'fecha_inicio')::date inicio,
                    (i.datos->>'fecha_fin')::date fin, i.nombre
             from _agl_plan pl join _agl_in i on i.catalogo = 'temporadas' and i.agl_id = pl.agl_id
             where pl.catalogo = 'temporadas' and coalesce((i.datos->>'tasa_cambio_usd')::numeric, 0) > 0 loop
        v_tasa := (select h.tasa_hnl_usd from public.historial_tasas_temporada h
                   where h.temporada_id = r.local_id and h.fecha_inicio <= greatest(v_hoy, r.inicio)
                   order by h.fecha_inicio desc limit 1);
        if v_tasa is null and exists (select 1 from public.historial_tasas_temporada h where h.temporada_id = r.local_id) then
            v_tasa := (select h.tasa_hnl_usd from public.historial_tasas_temporada h
                       where h.temporada_id = r.local_id order by h.fecha_inicio limit 1);
        end if;
        continue when v_tasa is not null and v_tasa = round(r.tasa, 4);
        v_desde := case when v_tasa is null then r.inicio else least(greatest(v_hoy, r.inicio), r.fin) end;
        insert into _agl_plan (orden, catalogo, accion, local_id, agl_id, nombre, antes, despues, motivo)
        values (3, 'tasas', 'crear', r.local_id, null, r.nombre,
                case when v_tasa is null then null else jsonb_build_object('tasa_hnl_usd', v_tasa) end,
                jsonb_build_object('tasa_hnl_usd', round(r.tasa, 4), 'fecha_inicio', v_desde),
                case when v_tasa is null then 'La temporada no tenía tasa: rige desde su inicio.'
                     else format('Nueva vigencia desde %s (lo anterior no cambia).', to_char(v_desde, 'DD/MM/YYYY')) end);
    end loop;

    -- =========== ESTACIONES (solo las reales; las «PRUEBA · X» no se tocan) ===========
    if to_regclass('pg_temp._agl_est') is null then
        create temp table _agl_est (
        agl_id text, nombre text, llave text, datos jsonb, local_pedido text,
        local_id uuid, por text, parecido numeric, candidatos jsonb
    ) on commit drop;
    end if;
    truncate _agl_est;
    insert into _agl_est (agl_id, nombre, llave, datos, local_pedido)
    select agl_id, nombre, llave, datos, local_pedido from _agl_in where catalogo = 'estaciones';

    -- a) por id de AGL
    update _agl_est a set local_id = e.id, por = 'agl_id'
      from public.estaciones_riego e
     where e.agl_id = a.agl_id and e.prueba_de is null;
    -- b) la que eligió el usuario en la vista previa («nueva» = crear una aparte)
    for r in select * from _agl_est where local_id is null and local_pedido is not null loop
        if r.local_pedido = 'nueva' then
            update _agl_est set por = 'nueva_pedida' where agl_id = r.agl_id;
            continue;
        end if;
        begin
            v_id := r.local_pedido::uuid;
        exception when invalid_text_representation then
            v_id := null;
        end;
        if v_id is null or not exists (
                select 1 from public.estaciones_riego e
                where e.id = v_id and e.prueba_de is null
                  and (e.agl_id is null or e.agl_id not in (select agl_id from _agl_est)))
           or exists (select 1 from _agl_est x where x.local_id = v_id) then
            v_avisos := v_avisos || format('Estación «%s»: la estación elegida para emparejar ya no está disponible; se empareja sola.', r.nombre);
            continue;
        end if;
        update _agl_est set local_id = v_id, por = 'elegida' where agl_id = r.agl_id;
    end loop;
    -- c) por nombre normalizado
    for r in select * from _agl_est where local_id is null and por is null order by llave loop
        v_id := (select e.id from public.estaciones_riego e
                 where e.prueba_de is null and public._fert_llave(e.nombre) = r.llave
                   and (e.agl_id is null or e.agl_id not in (select agl_id from _agl_est))
                   and e.id not in (select x.local_id from _agl_est x where x.local_id is not null)
                 limit 1);
        if v_id is not null then
            update _agl_est set local_id = v_id, por = 'nombre' where agl_id = r.agl_id;
        end if;
    end loop;
    -- d) por parecido (si cambió un poco el nombre): el mejor, si gana claro (≥ 0.5 y 0.1 sobre el segundo)
    loop
        select a.agl_id, e.id eid, public._agl_parecido(a.nombre, e.nombre) sim,
               coalesce((select max(public._agl_parecido(a.nombre, e2.nombre)) from public.estaciones_riego e2
                         where e2.prueba_de is null and e2.id <> e.id
                           and (e2.agl_id is null or e2.agl_id not in (select agl_id from _agl_est))
                           and e2.id not in (select x.local_id from _agl_est x where x.local_id is not null)), 0) segundo,
               coalesce((select max(public._agl_parecido(a2.nombre, e.nombre)) from _agl_est a2
                         where a2.local_id is null and (a2.por is null or a2.por = 'dudosa') and a2.agl_id <> a.agl_id), 0) rival
          into c
          from _agl_est a cross join public.estaciones_riego e
         where a.local_id is null and a.por is null
           and e.prueba_de is null
           and (e.agl_id is null or e.agl_id not in (select agl_id from _agl_est))
           and e.id not in (select x.local_id from _agl_est x where x.local_id is not null)
         order by 3 desc, a.llave, e.nombre
         limit 1;
        exit when not found or c.sim < 0.5;
        if c.sim - c.segundo >= 0.1 and c.sim - c.rival >= 0.1 then
            update _agl_est set local_id = c.eid, por = 'parecido', parecido = c.sim where agl_id = c.agl_id;
        else
            update _agl_est set por = 'dudosa' where agl_id = c.agl_id;   -- empate: que elija el usuario
        end if;
    end loop;
    -- candidatos para elegir en la vista previa (los 3 más parecidos, de las que quedan libres)
    update _agl_est a
       set candidatos = (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'nombre', q.nombre, 'parecido', q.sim)
                                                   order by q.sim desc, q.nombre), '[]')
                         from (select e.id, e.nombre, public._agl_parecido(a.nombre, e.nombre) sim
                               from public.estaciones_riego e
                               where e.prueba_de is null
                                 and (e.agl_id is null or e.agl_id not in (select agl_id from _agl_est))
                                 and e.id not in (select x.local_id from _agl_est x where x.local_id is not null and x.agl_id <> a.agl_id)
                                 and e.id is distinct from a.local_id
                               order by 3 desc, e.nombre limit 3) q
                         where q.sim > 0)
     where a.por in ('parecido', 'dudosa', 'nueva_pedida', 'elegida') or a.local_id is null;

    insert into _agl_plan (orden, catalogo, local_id, agl_id, por, parecido, candidatos)
    select 4, 'estaciones', coalesce(a.local_id, gen_random_uuid()), a.agl_id,
           case when a.local_id is not null then a.por
                when a.por = 'dudosa' then 'dudosa'
                when a.por = 'nueva_pedida' then 'nueva_elegida'
                else 'nueva' end,
           a.parecido, a.candidatos
    from _agl_est a;

    -- =========== TURNOS ===========
    for r in select * from _agl_in where catalogo = 'turnos' order by llave loop
        v_id := (select t.id from public.turnos t where t.agl_id = r.agl_id);
        if v_id is not null then
            insert into _agl_plan (orden, catalogo, local_id, agl_id, por) values (5, 'turnos', v_id, r.agl_id, 'agl_id');
        else
            v_id := (select t.id from public.turnos t
                     where public._fert_llave(t.codigo) = r.llave
                       and (t.agl_id is null or t.agl_id not in (select agl_id from _agl_in where catalogo = 'turnos'))
                       and t.id not in (select local_id from _agl_plan where catalogo = 'turnos' and local_id is not null)
                     limit 1);
            insert into _agl_plan (orden, catalogo, local_id, agl_id, por)
            values (5, 'turnos', coalesce(v_id, gen_random_uuid()), r.agl_id, case when v_id is null then 'nueva' else 'nombre' end);
        end if;
    end loop;

    -- ---- zona de estaciones y turnos: la zona de AGL (por su id en este paquete o ya anotado; si no, por nombre) ----
    if to_regclass('pg_temp._agl_zona') is null then
        create temp table _agl_zona (agl_id text, nombre text, local_id uuid) on commit drop;
    end if;
    truncate _agl_zona;
    insert into _agl_zona
    select pl.agl_id, pl.despues->>'nombre', pl.local_id from _agl_plan pl where pl.catalogo = 'zonas';

    update _agl_plan pl
       set antes = (select jsonb_build_object('nombre', e.nombre, 'zona_id', e.zona_id,
                                              'zona', (select z.nombre from public.zonas z where z.id = e.zona_id),
                                              'activo', e.activo, 'agl_id', e.agl_id)
                    from public.estaciones_riego e where e.id = pl.local_id),
           despues = jsonb_build_object('nombre', i.nombre, 'activo', true, 'agl_id', i.agl_id,
                                        'zona_id', coalesce(zz.local_id, (select e.zona_id from public.estaciones_riego e where e.id = pl.local_id)),
                                        'zona', coalesce(zz.nombre, (select z.nombre from public.zonas z join public.estaciones_riego e on e.zona_id = z.id where e.id = pl.local_id)))
      from _agl_in i
      left join lateral (
          select coalesce(
                     (select jsonb_build_object('id', g.local_id, 'n', g.nombre) from _agl_zona g where g.agl_id = nullif(btrim(i.datos->>'zona_agl_id'), '')),
                     (select jsonb_build_object('id', z.id, 'n', z.nombre) from public.zonas z where z.agl_id = nullif(btrim(i.datos->>'zona_agl_id'), '')),
                     (select jsonb_build_object('id', g.local_id, 'n', g.nombre) from _agl_zona g where public._fert_llave(g.nombre) = public._fert_llave(i.datos->>'zona') limit 1),
                     (select jsonb_build_object('id', z.id, 'n', z.nombre) from public.zonas z where public._fert_llave(z.nombre) = public._fert_llave(i.datos->>'zona') limit 1)
                 ) j
      ) zj on true
      left join lateral (select (zj.j->>'id')::uuid local_id, zj.j->>'n' nombre) zz on true
     where pl.catalogo in ('estaciones', 'turnos') and i.catalogo = pl.catalogo and i.agl_id = pl.agl_id;

    -- turnos: «codigo» y «activo» en vez de nombre
    update _agl_plan pl
       set antes = (select jsonb_build_object('codigo', t.codigo, 'zona_id', t.zona_id,
                                              'zona', (select z.nombre from public.zonas z where z.id = t.zona_id),
                                              'activo', t.activo, 'agl_id', t.agl_id)
                    from public.turnos t where t.id = pl.local_id),
           despues = (pl.despues - 'nombre')
                     || jsonb_build_object('codigo', i.nombre,
                                           'activo', coalesce(lower(btrim(i.datos->>'estado')), 'activo') not in ('inactivo', 'eliminado'))
      from _agl_in i
     where pl.catalogo = 'turnos' and i.catalogo = 'turnos' and i.agl_id = pl.agl_id;

    -- aviso de zona que no se encontró
    select string_agg(format('%s «%s» (zona «%s»)', pl.catalogo, coalesce(pl.despues->>'nombre', pl.despues->>'codigo'), i.datos->>'zona'), ', ')
      into v_lista
      from _agl_plan pl join _agl_in i on i.catalogo = pl.catalogo and i.agl_id = pl.agl_id
     where pl.catalogo in ('estaciones', 'turnos') and pl.despues->>'zona_id' is null
       and coalesce(nullif(btrim(i.datos->>'zona'), ''), nullif(btrim(i.datos->>'zona_agl_id'), '')) is not null;
    if v_lista is not null then
        v_avisos := v_avisos || format('Zona no encontrada (se deja como está): %s.', v_lista);
    end if;

    update _agl_plan pl set nombre = coalesce(pl.despues->>'nombre', pl.despues->>'codigo')
     where pl.accion is null;

    -- ---- crear / actualizar / sin cambios ----
    update _agl_plan pl
       set accion = case when pl.antes is null then 'crear'
                         when (pl.antes - 'zona') = (pl.despues - 'zona') then 'sin_cambios'
                         else 'actualizar' end
     where pl.accion is null;

    -- ---- nombres que chocarían con otra fila (único en la tabla): no se renombra, se avisa ----
    update _agl_plan pl
       set despues = case when pl.accion = 'crear' then pl.despues else pl.despues || jsonb_build_object('nombre', pl.antes->>'nombre') end,
           accion  = case when pl.accion = 'crear' then 'conflicto' else pl.accion end,
           motivo  = format('Ya existe otra «%s» aquí que no es la misma de AGL: no se %s. Revisa el emparejamiento.',
                            pl.despues->>'nombre', case when pl.accion = 'crear' then 'crea' else 'cambia el nombre' end)
     where pl.catalogo in ('zonas', 'temporadas', 'estaciones')
       and pl.accion in ('crear', 'actualizar')
       and (pl.antes is null or pl.antes->>'nombre' <> pl.despues->>'nombre')
       and exists (select 1 from (
               select id, nombre from public.zonas where pl.catalogo = 'zonas'
               union all select id, nombre from public.temporadas where pl.catalogo = 'temporadas'
               union all select id, nombre from public.estaciones_riego where pl.catalogo = 'estaciones') o
           where o.nombre = pl.despues->>'nombre' and o.id <> pl.local_id
             -- salvo que esa otra también cambie de nombre en esta publicación
             and not exists (select 1 from _agl_plan p2 where p2.catalogo = pl.catalogo and p2.local_id = o.id
                               and p2.accion in ('actualizar') and p2.despues->>'nombre' <> o.nombre));
    update _agl_plan pl
       set despues = case when pl.accion = 'crear' then pl.despues else pl.despues || jsonb_build_object('codigo', pl.antes->>'codigo') end,
           accion  = case when pl.accion = 'crear' then 'conflicto' else pl.accion end,
           motivo  = format('Ya existe otro turno «%s» aquí que no es el mismo de AGL: no se %s.',
                            pl.despues->>'codigo', case when pl.accion = 'crear' then 'crea' else 'cambia el código' end)
     where pl.catalogo = 'turnos' and pl.accion in ('crear', 'actualizar')
       and (pl.antes is null or pl.antes->>'codigo' <> pl.despues->>'codigo')
       and exists (select 1 from public.turnos o where o.codigo = pl.despues->>'codigo' and o.id <> pl.local_id);
    -- si lo único que cambiaba era el nombre que choca, queda como «conflicto» (que se vea en la vista previa)
    update _agl_plan pl set accion = case when pl.motivo like 'Ya existe otr%' then 'conflicto' else 'sin_cambios' end
     where pl.accion = 'actualizar' and (pl.antes - 'zona') = (pl.despues - 'zona');
    update _agl_plan pl set nombre = coalesce(pl.despues->>'nombre', pl.despues->>'codigo') where pl.catalogo <> 'tasas';

    -- =========== LO QUE AGL YA NO TIENE (solo con «completo» y si el catálogo vino con filas) ===========
    if v_completo and jsonb_array_length(coalesce(p->'estaciones', '[]')) > 0 then
        insert into _agl_plan (orden, catalogo, accion, local_id, agl_id, nombre, antes, despues, motivo)
        select 6, 'estaciones', case when q.motivos = '' then 'desactivar' else 'protegida' end, q.id, q.agl_id, q.nombre,
               jsonb_build_object('activo', true), jsonb_build_object('activo', q.motivos <> ''),
               nullif(concat_ws(' ', nullif(q.motivos, ''), nullif(q.avisos, '')), '')
        from (
            select e.id, e.agl_id, e.nombre,
                   concat_ws(' · ',
                       case when exists (select 1 from public.fert_saldos s where s.estacion_id = e.id and (s.disponible <> 0 or s.en_transito <> 0))
                            then 'Tiene producto en bodega: trasládalo primero' end,
                       case when exists (select 1 from public.fert_custodia u where u.estacion_id = e.id and u.custodio_id is not null)
                            then 'Tiene custodio: entrégala primero' end,
                       case when exists (select 1 from public.turnos_ciclo tc where tc.estacion_id = e.id and tc.activo and tc.archivado_at is null)
                            then format('Tiene %s turno(s) publicados a campo: «Publicar a campo» y vuelve a publicar catálogos',
                                        (select count(*) from public.turnos_ciclo tc where tc.estacion_id = e.id and tc.activo and tc.archivado_at is null)) end,
                       case when exists (select 1 from public.fert_traslados ft where (ft.origen_id = e.id or ft.destino_id = e.id)
                                           and ft.estado in ('POR_AUTORIZAR', 'EN_TRANSITO'))
                            then 'Tiene traslados pendientes' end) motivos,
                   concat_ws(' ',
                       case when exists (select 1 from public.perfiles_estaciones pe where pe.estacion_id = e.id)
                            then format('(Aviso: %s persona(s) asignada(s); reasígnalas en Usuarios.)',
                                        (select count(*) from public.perfiles_estaciones pe where pe.estacion_id = e.id)) end,
                       case when exists (select 1 from public.estaciones_riego e2 where e2.prueba_de = e.id)
                            then '(Aviso: tiene su estación de prueba; esa sigue igual.)' end) avisos
            from public.estaciones_riego e
            where e.activo and e.prueba_de is null
              and e.id not in (select local_id from _agl_plan where catalogo = 'estaciones')
        ) q;
    end if;

    if v_completo and jsonb_array_length(coalesce(p->'turnos', '[]')) > 0 then
        insert into _agl_plan (orden, catalogo, accion, local_id, agl_id, nombre, antes, despues, motivo)
        select 7, 'turnos', case when q.motivos = '' then 'desactivar' else 'protegida' end, q.id, q.agl_id, q.codigo,
               jsonb_build_object('activo', true), jsonb_build_object('activo', q.motivos <> ''), nullif(q.motivos, '')
        from (
            select t.id, t.agl_id, t.codigo,
                   concat_ws(' · ',
                       case when exists (select 1 from public.turnos_ciclo tc where tc.turno_id = t.id and tc.activo and tc.archivado_at is null)
                            then 'Tiene turnos de Fertirriego publicados' end,
                       case when exists (select 1 from public.desinfeccion_plan dp join public.temporadas te on te.id = dp.temporada_id
                                         where dp.turno_id = t.id and te.activa)
                            then 'Está en el plan de Desinfección de la temporada activa' end) motivos
            from public.turnos t
            where t.activo and t.id not in (select local_id from _agl_plan where catalogo = 'turnos')
        ) q;
    end if;

    if v_completo and jsonb_array_length(coalesce(p->'zonas', '[]')) > 0 then
        -- cómo quedan estaciones y turnos después de esta publicación
        if to_regclass('pg_temp._agl_final') is null then
            create temp table _agl_final (catalogo text, id uuid, zona_id uuid, activo boolean) on commit drop;
        end if;
        truncate _agl_final;
        insert into _agl_final
        select 'estaciones', e.id,
               coalesce((select (pl.despues->>'zona_id')::uuid from _agl_plan pl where pl.catalogo = 'estaciones' and pl.local_id = e.id
                           and pl.accion in ('crear', 'actualizar', 'sin_cambios', 'conflicto')), e.zona_id),
               coalesce((select (pl.despues->>'activo')::boolean from _agl_plan pl where pl.catalogo = 'estaciones' and pl.local_id = e.id), e.activo)
        from public.estaciones_riego e
        union all
        select 'estaciones', pl.local_id, (pl.despues->>'zona_id')::uuid, true from _agl_plan pl where pl.catalogo = 'estaciones' and pl.accion = 'crear'
        union all
        select 'turnos', t.id,
               coalesce((select (pl.despues->>'zona_id')::uuid from _agl_plan pl where pl.catalogo = 'turnos' and pl.local_id = t.id
                           and pl.accion in ('crear', 'actualizar', 'sin_cambios', 'conflicto')), t.zona_id),
               coalesce((select (pl.despues->>'activo')::boolean from _agl_plan pl where pl.catalogo = 'turnos' and pl.local_id = t.id), t.activo)
        from public.turnos t
        union all
        select 'turnos', pl.local_id, (pl.despues->>'zona_id')::uuid, (pl.despues->>'activo')::boolean from _agl_plan pl where pl.catalogo = 'turnos' and pl.accion = 'crear';

        insert into _agl_plan (orden, catalogo, accion, local_id, agl_id, nombre, antes, despues, motivo)
        select 8, 'zonas', case when q.motivos = '' then 'desactivar' else 'protegida' end, q.id, q.agl_id, q.nombre,
               jsonb_build_object('activo', true), jsonb_build_object('activo', q.motivos <> ''),
               nullif(concat_ws(' ', nullif(q.motivos, ''), nullif(q.avisos, '')), '')
        from (
            select z.id, z.agl_id, z.nombre,
                   concat_ws(' · ',
                       case when exists (select 1 from _agl_final f where f.catalogo = 'estaciones' and f.zona_id = z.id and f.activo)
                            then format('Quedan %s estación(es) activas en esta zona',
                                        (select count(*) from _agl_final f where f.catalogo = 'estaciones' and f.zona_id = z.id and f.activo)) end,
                       case when exists (select 1 from _agl_final f where f.catalogo = 'turnos' and f.zona_id = z.id and f.activo)
                            then format('Quedan %s turno(s) activos en esta zona',
                                        (select count(*) from _agl_final f where f.catalogo = 'turnos' and f.zona_id = z.id and f.activo)) end,
                       case when exists (select 1 from public.lotes_temporada lt join public.temporadas te on te.id = lt.temporada_id
                                         where lt.zona_id = z.id and te.activa)
                            then 'Tiene lotes en la temporada activa' end,
                       case when q_solo.n > 0
                            then format('%s persona(s) solo tienen esta zona: asígnales una zona de AGL en Usuarios', q_solo.n) end
                   ) motivos,
                   case when q_solo.n = 0 and exists (select 1 from public.perfiles_zonas pz where pz.zona_id = z.id)
                        then format('(Aviso: la tienen asignada %s; también tienen zonas de AGL, no pierden nada. La asignación se quita en la fase C.)',
                                    (select string_agg(pf.nombre, ', ' order by pf.nombre) from public.perfiles_zonas pz
                                     join public.perfiles pf on pf.id = pz.perfil_id where pz.zona_id = z.id)) end avisos
            from public.zonas z
            -- personas (activas, sin «Todas las zonas») que no tienen ninguna zona de AGL además de esta
            cross join lateral (
                select count(*) n from public.perfiles_zonas pz join public.perfiles pf on pf.id = pz.perfil_id
                where pz.zona_id = z.id and pf.activo and not coalesce(pf.todas_las_zonas, false)
                  and not exists (select 1 from public.perfiles_zonas pz2
                                  where pz2.perfil_id = pz.perfil_id
                                    and pz2.zona_id in (select y.local_id from _agl_plan y where y.catalogo = 'zonas' and y.orden = 1))
            ) q_solo
            where z.activo and z.id not in (select local_id from _agl_plan where catalogo = 'zonas')
        ) q;
    end if;

    -- Emparejamiento dudoso (dos estaciones de aquí igual de parecidas): que elija el usuario
    if exists (select 1 from _agl_plan where catalogo = 'estaciones' and por = 'dudosa') then
        v_avisos := v_avisos || format('Estaciones con emparejamiento dudoso (elige con cuál va cada una antes de publicar): %s.',
                                       (select string_agg(nombre, ', ' order by nombre) from _agl_plan where catalogo = 'estaciones' and por = 'dudosa'));
    end if;

    -- ---- huella: lo mismo que se ve es lo que se aplica (los ids nuevos no cuentan: se generan cada vez) ----
    select md5(coalesce(string_agg(
               concat_ws('|', catalogo, accion, case when antes is null then '' else local_id::text end,
                         agl_id, despues::text, motivo),
               '¦' order by catalogo, coalesce(agl_id, ''), case when antes is null then '' else local_id::text end, accion), ''))
      into v_huella
      from _agl_plan where accion <> 'sin_cambios';

    -- =========== APLICAR ===========
    if not v_simular then
        if nullif(p->>'huella', '') is null then
            raise exception 'Falta la huella de la vista previa: primero mira la vista previa y luego publica.' using errcode = '22023';
        end if;
        if p->>'huella' <> v_huella then
            raise exception 'Los datos cambiaron desde la vista previa (en AGL o en AgroNotificaciones). Mira la vista previa otra vez antes de publicar.'
                using errcode = 'P0001';
        end if;
        if exists (select 1 from _agl_plan where catalogo = 'estaciones' and por = 'dudosa') then
            raise exception 'Hay estaciones con emparejamiento dudoso: elige en la vista previa con cuál va cada una.' using errcode = '22023';
        end if;
        perform set_config('agl.publicando', 'si', true);   -- para la fase B (solo lectura salvo dentro de esta función)

        begin
            -- zonas
            insert into public.zonas (id, nombre, responsable, correo_electronico, telefono, activo, agl_id)
            select pl.local_id, pl.despues->>'nombre', pl.despues->>'responsable', pl.despues->>'correo_electronico',
                   pl.despues->>'telefono', true, pl.agl_id
            from _agl_plan pl where pl.catalogo = 'zonas' and pl.accion = 'crear';
            update public.zonas z
               set nombre = pl.despues->>'nombre', responsable = pl.despues->>'responsable',
                   correo_electronico = pl.despues->>'correo_electronico', telefono = pl.despues->>'telefono',
                   activo = true, agl_id = pl.agl_id
              from _agl_plan pl
             where pl.catalogo = 'zonas' and pl.accion = 'actualizar' and z.id = pl.local_id;

            -- temporadas (primero las que dejan de ser activas; el disparador deja una sola activa)
            insert into public.temporadas (id, nombre, fecha_inicio, fecha_fin, activa, agl_id)
            select pl.local_id, pl.despues->>'nombre', (pl.despues->>'fecha_inicio')::date, (pl.despues->>'fecha_fin')::date,
                   false, pl.agl_id
            from _agl_plan pl where pl.catalogo = 'temporadas' and pl.accion = 'crear';
            update public.temporadas t
               set nombre = pl.despues->>'nombre', fecha_inicio = (pl.despues->>'fecha_inicio')::date,
                   fecha_fin = (pl.despues->>'fecha_fin')::date, activa = false, agl_id = pl.agl_id
              from _agl_plan pl
             where pl.catalogo = 'temporadas' and pl.accion in ('crear', 'actualizar') and t.id = pl.local_id
               and not (pl.despues->>'activa')::boolean;
            update public.temporadas t
               set nombre = pl.despues->>'nombre', fecha_inicio = (pl.despues->>'fecha_inicio')::date,
                   fecha_fin = (pl.despues->>'fecha_fin')::date, activa = true, agl_id = pl.agl_id
              from _agl_plan pl
             where pl.catalogo = 'temporadas' and pl.accion in ('crear', 'actualizar') and t.id = pl.local_id
               and (pl.despues->>'activa')::boolean;

            -- tasas (una vigencia más)
            insert into public.historial_tasas_temporada (temporada_id, tasa_hnl_usd, fecha_inicio, comentario)
            select pl.local_id, (pl.despues->>'tasa_hnl_usd')::numeric, (pl.despues->>'fecha_inicio')::date, 'Publicada desde AGL (/TM01)'
            from _agl_plan pl where pl.catalogo = 'tasas' and pl.accion = 'crear'
            on conflict (temporada_id, fecha_inicio) do update
                set tasa_hnl_usd = excluded.tasa_hnl_usd, comentario = excluded.comentario;

            -- estaciones
            insert into public.estaciones_riego (id, nombre, zona_id, activo, agl_id)
            select pl.local_id, pl.despues->>'nombre', (pl.despues->>'zona_id')::uuid, true, pl.agl_id
            from _agl_plan pl where pl.catalogo = 'estaciones' and pl.accion = 'crear';
            update public.estaciones_riego e
               set nombre = pl.despues->>'nombre', zona_id = (pl.despues->>'zona_id')::uuid, activo = true, agl_id = pl.agl_id
              from _agl_plan pl
             where pl.catalogo = 'estaciones' and pl.accion = 'actualizar' and pl.orden = 4 and e.id = pl.local_id;

            -- turnos
            insert into public.turnos (id, codigo, zona_id, activo, agl_id)
            select pl.local_id, pl.despues->>'codigo', (pl.despues->>'zona_id')::uuid, (pl.despues->>'activo')::boolean, pl.agl_id
            from _agl_plan pl where pl.catalogo = 'turnos' and pl.accion = 'crear';
            update public.turnos t
               set codigo = pl.despues->>'codigo', zona_id = (pl.despues->>'zona_id')::uuid,
                   activo = (pl.despues->>'activo')::boolean, agl_id = pl.agl_id
              from _agl_plan pl
             where pl.catalogo = 'turnos' and pl.accion = 'actualizar' and pl.orden = 5 and t.id = pl.local_id;

            -- lo que AGL ya no tiene: inactivo (nunca se borra)
            update public.estaciones_riego e set activo = false
              from _agl_plan pl where pl.catalogo = 'estaciones' and pl.accion = 'desactivar' and e.id = pl.local_id and e.activo;
            update public.turnos t set activo = false
              from _agl_plan pl where pl.catalogo = 'turnos' and pl.accion = 'desactivar' and t.id = pl.local_id and t.activo;
            update public.zonas z set activo = false
              from _agl_plan pl where pl.catalogo = 'zonas' and pl.accion = 'desactivar' and z.id = pl.local_id and z.activo;
        exception when unique_violation then
            raise exception 'No se pudo publicar: dos filas quedarían con el mismo nombre (%). No se cambió nada.', sqlerrm
                using errcode = 'P0001';
        end;

        insert into seguridad.agl_publicaciones (publicado_por, huella, completo, resumen, cambios, avisos)
        values ((select auth.uid()), v_huella, v_completo,
                (select coalesce(jsonb_object_agg(catalogo, n), '{}') from (
                    select catalogo, jsonb_object_agg(accion, k) n from (
                        select catalogo, accion, count(*) k from _agl_plan group by 1, 2) a group by 1) b),
                (select coalesce(jsonb_agg(jsonb_build_object('catalogo', catalogo, 'accion', accion, 'id', local_id,
                                                             'agl_id', agl_id, 'antes', antes, 'despues', despues) order by orden, nombre), '[]')
                 from _agl_plan where accion in ('crear', 'actualizar', 'desactivar')),
                v_avisos)
        returning id into v_pub_id;
    end if;

    -- ---- el informe (vista previa o resultado) ----
    return jsonb_build_object(
        'simulado', v_simular,
        'publicacion', v_pub_id,
        'huella', v_huella,
        'completo', v_completo,
        'resumen', (select coalesce(jsonb_object_agg(catalogo, n), '{}') from (
                        select catalogo, jsonb_object_agg(accion, k) n from (
                            select catalogo, accion, count(*) k from _agl_plan group by 1, 2) a group by 1) b),
        'cambios', (select coalesce(jsonb_agg(jsonb_build_object(
                        'catalogo', pl.catalogo, 'accion', pl.accion, 'local_id', case when pl.antes is null then null else pl.local_id end,
                        'agl_id', pl.agl_id, 'nombre', pl.nombre, 'nombre_local', case when pl.orden >= 6 then pl.nombre else coalesce(pl.antes->>'nombre', pl.antes->>'codigo') end,
                        'por', pl.por, 'parecido', pl.parecido, 'candidatos', pl.candidatos, 'motivo', pl.motivo,
                        'campos', (select coalesce(jsonb_agg(k order by k), '[]') from jsonb_object_keys(coalesce(pl.despues, '{}')) k
                                   where k not in ('zona') and pl.antes is not null and pl.antes->k is distinct from pl.despues->k),
                        'antes', pl.antes, 'despues', pl.despues)
                        order by pl.orden, case pl.accion when 'conflicto' then 0 when 'protegida' then 1 when 'desactivar' then 2
                                                          when 'crear' then 3 when 'actualizar' then 4 else 5 end, pl.nombre), '[]')
                    from _agl_plan pl),
        -- estaciones de aquí que se pueden elegir para emparejar (las reales que no tomó otra de AGL por su id)
        'estaciones_locales', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'activo', e.activo,
                                    'zona', (select z.nombre from public.zonas z where z.id = e.zona_id)) order by e.nombre), '[]')
                               from public.estaciones_riego e
                               where e.prueba_de is null
                                 and (e.agl_id is null or e.agl_id not in (select agl_id from _agl_est))),
        'avisos', to_jsonb(v_avisos));
end;
$$;

revoke all on function public.fn_agl_publicar_catalogos(jsonb) from public, anon;
grant execute on function public.fn_agl_publicar_catalogos(jsonb) to authenticated;


-- ---------------------------------------------------------------- 7 · «Publicar a campo» cruza estaciones por agl_id
-- Parche puntual (conserva los parches de la 102). AGL manda «agl_id» en cada estación; si la base no lo tiene,
-- sigue cruzando por nombre como siempre.

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
        raise exception '105: en % se esperaba 1 aparición de «%» y hay %', p_fn, p_viejo, v_n;
    end if;
    execute replace(v_def, p_viejo, p_nuevo);
end $$;

select pg_temp.parchar('public.fn_fert_publicar(jsonb)',
    E'as x(nombre text, zona text) loop',
    E'as x(nombre text, zona text, agl_id text) loop   -- 105: agl_id',
    '105: agl_id');
select pg_temp.parchar('public.fn_fert_publicar(jsonb)',
    E'        update public.estaciones_riego\n           set zona_id = coalesce(v_zona, zona_id), activo = true\n         where public._fert_llave(nombre) = public._fert_llave(e.nombre);\n        if not found then\n            insert into public.estaciones_riego (nombre, zona_id) values (btrim(e.nombre), v_zona);\n        end if;',
    E'        -- 105: primero por el id de AGL (un cambio de nombre en AGL renombra, no duplica); si no, por nombre\n'
    || E'        update public.estaciones_riego s\n'
    || E'           set zona_id = coalesce(v_zona, s.zona_id), activo = true,\n'
    || E'               nombre = case when exists (select 1 from public.estaciones_riego o where o.nombre = btrim(e.nombre) and o.id <> s.id)\n'
    || E'                             then s.nombre else btrim(e.nombre) end\n'
    || E'         where s.agl_id = nullif(btrim(e.agl_id), '''') and s.prueba_de is null;\n'
    || E'        if not found then\n'
    || E'            update public.estaciones_riego s\n'
    || E'               set zona_id = coalesce(v_zona, s.zona_id), activo = true, agl_id = coalesce(s.agl_id, nullif(btrim(e.agl_id), ''''))\n'
    || E'             where public._fert_llave(s.nombre) = public._fert_llave(e.nombre) and s.prueba_de is null\n'
    || E'               and (s.agl_id is null or s.agl_id = nullif(btrim(e.agl_id), '''')\n'
    || E'                    or not exists (select 1 from public.estaciones_riego o where o.agl_id = nullif(btrim(e.agl_id), '''')));\n'
    || E'        end if;\n'
    || E'        if not found then\n'
    || E'            insert into public.estaciones_riego (nombre, zona_id, agl_id)\n'
    || E'            values (btrim(e.nombre), v_zona, nullif(btrim(e.agl_id), ''''));   -- 105\n'
    || E'        end if;',
    '-- 105: primero por el id de AGL');


-- ---------------------------------------------------------------- 8 · material « 100019» (espacio delante)

do $$
begin
    if exists (select 1 from public.materiales where codigo = ' 100019') then
        if exists (select 1 from public.materiales where codigo = '100019') then
            raise notice '105: existen « 100019» y «100019»: no se toca (se unen en el bloque de materiales).';
        else
            update public.materiales set codigo = '100019' where codigo = ' 100019';
        end if;
    end if;
end $$;

notify pgrst, 'reload schema';
