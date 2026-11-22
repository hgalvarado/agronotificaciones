-- =====================================================================
-- 125 · AGROMÉTRICAS · REGISTROS DE LA TEMPORADA (histórico de AppSheet en Supabase, ver / editar / eliminar)
-- =====================================================================
-- Pedido del usuario (2026-11-21): los 107 registros de 2026-2027 que hoy viven SOLO en AGL (importados de AppSheet por
-- «Glopez», «Rwlopez», «gbetancourth») aparecen en Supabase como si los hubieran ingresado esos usuarios de AgroNotificaciones
-- (el cruce es por correo). Cada usuario ve los suyos; el encargado de zona ve los de su(s) zona(s); el administrador ve todos.
--
--   1. Columnas nuevas (nullable) en agm_parametros: id_appsheet, editado_en/por, eliminado_en/por/motivo. «origen» ya existía
--      (109; si faltara se agrega). La unicidad (turno, fecha) pasa a ser PARCIAL (solo registros no eliminados) para que se pueda
--      volver a registrar ese día después de eliminar; índice único parcial por id_appsheet.
--   2. fn_agm_cargar_appsheet(p)    AGL sube los registros (usuario técnico: «Conexión AGL · publicar»). UUID determinista
--                                   por id_appsheet (idempotente; NO pisa lo editado en la app). Nacen ya «bajados» (AGL los tiene).
--   3. fn_agm_mis_registros(p)      lista paginada y filtrable para la pantalla y las gráficas, con visibilidad por persona,
--                                   zona (encargado = «Corregir parámetros» en la zona del turno) o administrador.
--   4. fn_agm_editar_parametro(p)   dueño, encargado de la zona o administrador. Marca editado_en/por; la huella cambia sola y
--                                   AGL lo vuelve a bajar.
--   5. fn_agm_eliminar_parametro(p) SOLO con el permiso nuevo «Eliminar por completo» (acción `eliminar_definitivo`, nivel 4,
--                                   no se enciende con los niveles rápidos; no se concede a ningún rol: solo el administrador).
--                                   Motivo ≥ 15 letras. Eliminación LÓGICA (tumba) que AGL aplica en su copia y confirma.
--   6. Exportación 122 ajustada: incluye tumbas y el correo del autor; la huella ignora las claves nuevas cuando están en null
--      (así lo ya confirmado antes de la 125 NO vuelve a «por bajar»). Retención: un parámetro de un turno ACTIVO no se purga
--      aunque ya esté confirmado (se queda en Supabase para consultarlo y editarlo); se purga cuando el turno ya no está activo
--      (Terminar ciclo, 102) y AGL lo confirmó con huella. Una tumba confirmada se purga pasada la retención (cubre a un teléfono
--      sin señal que reenvíe ese UUID). Las fotos siguen el camino de la 122/123.
--
-- Requiere 109, 110, 122 (y 102 para «archivado»). Idempotente. Todo UPDATE/DELETE lleva WHERE.
-- ÓRDENES: la 125 redefine fn_agm_guardar_parametros y la política de lectura (109) y _agm_huella/_agm_filas/fn_agm_exportar/
-- fn_agm_purgar_bajadas (122). Si se vuelve a correr la 109 o la 122, correr la 125 DESPUÉS.
-- =====================================================================

-- ---------------------------------------------------------------- 1 · columnas y unicidad
alter table public.agm_parametros add column if not exists origen text not null default 'CAMPO';
alter table public.agm_parametros add column if not exists id_appsheet text;
alter table public.agm_parametros add column if not exists editado_en timestamptz;
alter table public.agm_parametros add column if not exists editado_por uuid;
alter table public.agm_parametros add column if not exists eliminado_en timestamptz;
alter table public.agm_parametros add column if not exists eliminado_por uuid;
alter table public.agm_parametros add column if not exists eliminado_motivo text;

alter table public.agm_parametros drop constraint if exists agm_parametros_turno_dia;
create unique index if not exists agm_parametros_turno_dia_viva
    on public.agm_parametros (turno_ciclo_id, fecha) where eliminado_en is null;
create unique index if not exists agm_parametros_id_appsheet_uq
    on public.agm_parametros (id_appsheet) where id_appsheet is not null;
create index if not exists idx_agm_parametros_creado_por on public.agm_parametros (creado_por);

-- ---------------------------------------------------------------- 2 · huella estable ante columnas nuevas
/** Una fila sin las marcas de bajada y SIN las claves añadidas por la 125 cuando están en null (la huella de lo ya bajado no cambia). */
create or replace function public._agm_limpiar(p_fila jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
    select ((p_fila - 'bajado_a_agl_en') - 'huella')
           - coalesce((select array_agg(k) from unnest(array['id_appsheet', 'editado_en', 'editado_por',
                                                              'eliminado_en', 'eliminado_por', 'eliminado_motivo']) k
                        where (p_fila -> k) = 'null'::jsonb), '{}'::text[])
$$;
revoke execute on function public._agm_limpiar(jsonb) from public, anon, authenticated;

create or replace function public._agm_huella(p_fila jsonb)
returns text language sql immutable set search_path = public, pg_temp as $$
    select encode(sha256(convert_to(public._agm_limpiar(p_fila)::text, 'UTF8')), 'hex')
$$;
revoke execute on function public._agm_huella(jsonb) from public, anon, authenticated;

/** Igual que la 122, con _agm_limpiar en fila y texto. */
create or replace function public._agm_filas()
returns table (tabla text, cursor text, id uuid, turno_ciclo_id uuid, zona_id uuid, fecha date,
               fila jsonb, texto text, huella text, huella_guardada text, bajado_a_agl_en timestamptz,
               foto text, turno_activo boolean)
language sql stable security definer set search_path = public, pg_temp as $$
    with b as (
        select 'parametros'::text as tabla, 'p|' || a.id::text as cursor, a.id as id, a.turno_ciclo_id as tc, null::uuid as zona,
               a.fecha as fecha, to_jsonb(a) as j, a.huella as hg, a.bajado_a_agl_en as bj, nullif(a.foto_calicata, '') as foto
          from public.agm_parametros a
        union all
        select 'clima', 'c|' || c.id::text, c.id, null::uuid, c.zona_id, c.fecha, to_jsonb(c), c.huella, c.bajado_a_agl_en, null
          from public.agm_clima c
        union all
        select 'calicatas', 'l|' || l.turno_ciclo_id::text, l.turno_ciclo_id, l.turno_ciclo_id, null::uuid,
               (l.medido_en at time zone 'America/Tegucigalpa')::date, to_jsonb(l), l.huella, l.bajado_a_agl_en, null
          from public.agm_calicatas l
    )
    select b.tabla, b.cursor, b.id, b.tc, b.zona, b.fecha,
           public._agm_limpiar(b.j),
           public._agm_limpiar(b.j)::text,
           public._agm_huella(b.j), b.hg, b.bj, b.foto,
           (select t.activo from public.turnos_ciclo t where t.id = b.tc)
      from b
$$;
revoke execute on function public._agm_filas() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3 · permiso nuevo (matriz de la base)
do $$
begin
    insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
        ('eliminar_definitivo', 'Eliminar por completo',
         'Borra de verdad un registro (Fertirriego: documento y movimientos; AgroMétricas: un parámetro de riego, queda una tumba que AGL aplica). No se puede deshacer desde la app. Solo el administrador salvo que se conceda en Permisos.',
         131, true)
    on conflict (codigo) do nothing;
    update public.acciones set nivel = 4 where codigo = 'eliminar_definitivo';   -- «Todo»: los niveles rápidos no lo encienden (niveles.ts)
    update public.pantallas set acciones = acciones || 'eliminar_definitivo'::text
     where codigo = 'agrometricas' and not ('eliminar_definitivo' = any(acciones));
    -- Sin concesiones automáticas: solo fn_es_admin() lo tiene. Los roles se lo dan a mano en Permisos.
end $$;

-- ---------------------------------------------------------------- 4 · visibilidad y permisos de una fila
/** ¿Ve ESTE registro? Administrador; el dueño (con «ver»); o el encargado de la zona del turno («Corregir parámetros» en esa zona). */
create or replace function public._agm_puede_ver_registro(p_creado_por uuid, p_turno uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin()
        or (p_creado_por is not null and p_creado_por = (select auth.uid()) and public.fn_tiene_permiso('agrometricas', 'ver'))
        or public.fn_agm_puede_zona(public._agm_zona_turno(p_turno), 'corregir_parametros')
$$;
revoke execute on function public._agm_puede_ver_registro(uuid, uuid) from public, anon, authenticated;

/** ¿Edita ESTE registro? Administrador; su dueño (con «Registrar parámetros» en la zona); o el encargado de la zona. */
create or replace function public._agm_puede_editar_registro(p_creado_por uuid, p_turno uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin()
        or (p_creado_por is not null and p_creado_por = (select auth.uid())
            and public.fn_agm_puede_zona(public._agm_zona_turno(p_turno), 'registrar_parametros'))
        or public.fn_agm_puede_zona(public._agm_zona_turno(p_turno), 'corregir_parametros')
$$;
revoke execute on function public._agm_puede_editar_registro(uuid, uuid) from public, anon, authenticated;

create or replace function public._agm_puede_eliminar_registro()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin() or public.fn_tiene_permiso('agrometricas', 'eliminar_definitivo')
$$;
revoke execute on function public._agm_puede_eliminar_registro() from public, anon, authenticated;

-- La lectura directa de la tabla (pantalla de captura) no ve las eliminadas.
drop policy if exists agm_parametros_leer on public.agm_parametros;
create policy agm_parametros_leer on public.agm_parametros for select to authenticated
    using (eliminado_en is null and public.fn_agm_puede_zona(public._agm_zona_turno(turno_ciclo_id), 'ver'));

-- ---------------------------------------------------------------- 5 · guardar (109) con tumbas
/**
 * Igual que la 109, pero la unicidad (turno, fecha) solo cuenta registros NO eliminados, y un registro eliminado no se
 * reenvía (se rechaza con mensaje claro, no se resucita).
 */
create or replace function public.fn_agm_guardar_parametros(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_turno   public.turnos_ciclo%rowtype;
    v_fecha   date := nullif(p ->> 'fecha', '')::date;
    v_id      uuid := nullif(p ->> 'id', '')::uuid;
    v_previa  public.agm_parametros%rowtype;
    v_hoy     date := (now() at time zone 'America/Tegucigalpa')::date;
    v_cols    text[] := array['tensiometro_12_am','tensiometro_24_am','tensiometro_12_pm','tensiometro_24_pm',
                              'ce_agua','ph_agua','ce_gotero','ph_gotero',
                              'ce_extractor','ph_extractor','cloro_cinta','ce_suelo_antes','ce_suelo_despues'];
    v_nums    jsonb := '{}';
    c         text;
    v_fila    public.agm_parametros%rowtype;
    v_existe  boolean;
begin
    if v_id is null or v_fecha is null then
        raise exception 'Faltan el identificador o la fecha del registro.' using errcode = '22023';
    end if;
    select * into v_turno from public.turnos_ciclo where id = nullif(p ->> 'turno_ciclo_id', '')::uuid;
    if not found then
        raise exception 'El turno no existe o ya no está publicado por AGL.' using errcode = '22023';
    end if;
    if v_fecha > v_hoy then
        raise exception 'No se registran parámetros de días futuros.' using errcode = '22023';
    end if;
    if not public.fn_agm_puede_zona(public._agm_zona_turno(v_turno.id), 'registrar_parametros') then
        raise exception 'No tienes permiso para registrar parámetros en este turno.' using errcode = '42501';
    end if;

    select * into v_previa from public.agm_parametros
     where id = v_id or (turno_ciclo_id = v_turno.id and fecha = v_fecha and eliminado_en is null)
     order by (id = v_id) desc limit 1;
    v_existe := found;   -- el FOREACH de abajo cambia FOUND
    if v_existe and v_previa.eliminado_en is not null then
        raise exception 'Este registro fue eliminado por un administrador y no se vuelve a guardar.' using errcode = '22023';
    end if;
    if v_existe and (v_previa.turno_ciclo_id <> v_turno.id or v_previa.fecha <> v_fecha) then
        raise exception 'Este registro ya se guardó para otro turno o fecha.' using errcode = '22023';
    end if;
    if (v_fecha < v_hoy - 1 or (v_existe and v_previa.creado_por is distinct from auth.uid()))
       and not public.fn_agm_puede_zona(public._agm_zona_turno(v_turno.id), 'corregir_parametros') then
        raise exception 'Para corregir días anteriores o registros de otra persona se necesita «Corregir parámetros».'
            using errcode = '42501';
    end if;

    foreach c in array v_cols loop
        if public._agm_num(p, c) is not null then
            v_nums := v_nums || jsonb_build_object(c, public._agm_num(p, c));
        end if;
    end loop;

    if not v_existe then
        insert into public.agm_parametros (id, turno_ciclo_id, fecha) values (v_id, v_turno.id, v_fecha)
        returning * into v_previa;
    end if;

    update public.agm_parametros a set
        ddt                 = case when v_turno.fecha_siembra is not null then v_fecha - v_turno.fecha_siembra end,
        tensiometro_12_am   = coalesce((v_nums ->> 'tensiometro_12_am')::numeric, a.tensiometro_12_am),
        tensiometro_24_am   = coalesce((v_nums ->> 'tensiometro_24_am')::numeric, a.tensiometro_24_am),
        tensiometro_12_pm   = coalesce((v_nums ->> 'tensiometro_12_pm')::numeric, a.tensiometro_12_pm),
        tensiometro_24_pm   = coalesce((v_nums ->> 'tensiometro_24_pm')::numeric, a.tensiometro_24_pm),
        ce_agua             = coalesce((v_nums ->> 'ce_agua')::numeric, a.ce_agua),
        ph_agua             = coalesce((v_nums ->> 'ph_agua')::numeric, a.ph_agua),
        ce_gotero           = coalesce((v_nums ->> 'ce_gotero')::numeric, a.ce_gotero),
        ph_gotero           = coalesce((v_nums ->> 'ph_gotero')::numeric, a.ph_gotero),
        ce_extractor        = coalesce((v_nums ->> 'ce_extractor')::numeric, a.ce_extractor),
        ph_extractor        = coalesce((v_nums ->> 'ph_extractor')::numeric, a.ph_extractor),
        cloro_cinta         = coalesce((v_nums ->> 'cloro_cinta')::numeric, a.cloro_cinta),
        ce_suelo_antes      = coalesce((v_nums ->> 'ce_suelo_antes')::numeric, a.ce_suelo_antes),
        ce_suelo_despues    = coalesce((v_nums ->> 'ce_suelo_despues')::numeric, a.ce_suelo_despues),
        foto_calicata       = coalesce(nullif(p ->> 'foto_calicata', ''), a.foto_calicata),
        latitud             = coalesce(public._agm_num(p, 'latitud'), a.latitud),
        longitud            = coalesce(public._agm_num(p, 'longitud'), a.longitud),
        comentario          = coalesce(nullif(btrim(p ->> 'comentario'), ''), a.comentario),
        actualizado_por     = case when a.creado_en < now() - interval '1 second' then auth.uid() end,
        actualizado_en      = case when a.creado_en < now() - interval '1 second' then now() end
     where a.id = v_previa.id
    returning * into v_fila;

    update public.agm_parametros a set fuera_rango = public._agm_fuera_rango(to_jsonb(a))
     where a.id = v_fila.id
    returning * into v_fila;
    return to_jsonb(v_fila);
end
$$;
grant execute on function public.fn_agm_guardar_parametros(jsonb) to authenticated;

-- ---------------------------------------------------------------- 6 · uuid determinista del histórico
/**
 * UUID del registro importado: sha-256 de 'agm_appsheet:' || id_appsheet; los 32 primeros hex con versión 5 (carácter 13)
 * y variante RFC (carácter 17 = 8|9|a|b según los 2 bajos bits del hex 17). AGL puede recalcularlo igual.
 */
create or replace function public._agm_uuid_appsheet(p_id text)
returns uuid language sql immutable set search_path = public, pg_temp as $$
    select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-5' || substr(h, 14, 3) || '-'
            || substr('89ab', (('x' || substr(h, 17, 1))::bit(4)::int & 3) + 1, 1) || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
      from (select encode(sha256(convert_to('agm_appsheet:' || p_id, 'UTF8')), 'hex') as h) x
$$;
revoke execute on function public._agm_uuid_appsheet(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 7 · cargar el histórico (AGL)
/**
 * p = {registros: [{id_appsheet, fecha, turno_ciclo_id (= turnos_ciclo.agl_id, el id del turno en AGL), usuario_appsheet,
 *                   tensiometro_12_am … ce_suelo_despues, latitud?, longitud?, comentario?}],
 *      mapa_usuarios: {Glopez: 'noelopez@agl.com', …}}   (la clave se compara sin mayúsculas)
 * El autor se busca por correo en auth.users + perfiles. Sin autor o sin turno: NO se carga y se informa. Idempotente por
 * id_appsheet: lo ya cargado no se toca (ni pisa ediciones). Un registro del mismo turno y día ya existente (de la app o de
 * otro id_appsheet) queda en `en_conflicto`. Nacen ya «bajados» (AGL los tiene): solo vuelven a bajar si se editan.
 * -> {insertadas, ya_existian, sin_usuario:[{id_appsheet, usuario_appsheet}], sin_turno:[{id_appsheet, turno}],
 *     en_conflicto:[{id_appsheet, existente}], invalidas:[{id_appsheet, error}]}
 */
create or replace function public.fn_agm_cargar_appsheet(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_cols  text[] := array['tensiometro_12_am','tensiometro_24_am','tensiometro_12_pm','tensiometro_24_pm',
                            'ce_agua','ph_agua','ce_gotero','ph_gotero','ce_extractor','ph_extractor','cloro_cinta',
                            'ce_suelo_antes','ce_suelo_despues'];
    v_mapa  jsonb := '{}'::jsonb;
    r       jsonb;
    c       text;
    v_idapp text;
    v_fecha date;
    v_tc    public.turnos_ciclo%rowtype;
    v_user  uuid;
    v_mail  text;
    v_id    uuid;
    v_n     integer;
    v_val   numeric;
    v_ins   integer := 0;
    v_ya    integer := 0;
    v_sinu  jsonb := '[]'::jsonb;
    v_sint  jsonb := '[]'::jsonb;
    v_conf  jsonb := '[]'::jsonb;
    v_inv   jsonb := '[]'::jsonb;
    v_ex    uuid;
    v_fila  public.agm_parametros%rowtype;
    v_set   jsonb;
begin
    perform public._agm_exigir_agl('publicar');
    if p is null or jsonb_typeof(p -> 'registros') is distinct from 'array' then
        raise exception 'Se esperaba {registros: [...], mapa_usuarios: {...}}.' using errcode = '22023';
    end if;
    -- claves del mapa en minúsculas
    select coalesce(jsonb_object_agg(lower(btrim(k)), lower(btrim(v))), '{}'::jsonb) into v_mapa
      from jsonb_each_text(coalesce(p -> 'mapa_usuarios', '{}'::jsonb)) as t(k, v);

    for r in select x from jsonb_array_elements(p -> 'registros') x loop
        v_idapp := nullif(btrim(r ->> 'id_appsheet'), '');
        begin
            if v_idapp is null then
                v_inv := v_inv || jsonb_build_object('id_appsheet', null, 'error', 'Falta id_appsheet.');
                continue;
            end if;
            v_fecha := nullif(r ->> 'fecha', '')::date;
            if v_fecha is null then
                v_inv := v_inv || jsonb_build_object('id_appsheet', v_idapp, 'error', 'Falta la fecha.');
                continue;
            end if;
            v_id := public._agm_uuid_appsheet(v_idapp);
            -- ya cargado: no se toca
            if exists (select 1 from public.agm_parametros where id = v_id or id_appsheet = v_idapp) then
                v_ya := v_ya + 1;
                continue;
            end if;
            -- turno (id de AGL)
            select * into v_tc from public.turnos_ciclo where agl_id = nullif(btrim(r ->> 'turno_ciclo_id'), '');
            if not found then
                v_sint := v_sint || jsonb_build_object('id_appsheet', v_idapp, 'turno', r ->> 'turno_ciclo_id');
                continue;
            end if;
            -- autor por correo
            v_mail := v_mapa ->> lower(btrim(coalesce(r ->> 'usuario_appsheet', '')));
            v_user := null;
            if v_mail is not null then
                select u.id into v_user from auth.users u join public.perfiles pf on pf.id = u.id
                 where lower(u.email) = v_mail limit 1;
            end if;
            if v_user is null then
                v_sinu := v_sinu || jsonb_build_object('id_appsheet', v_idapp, 'usuario_appsheet', r ->> 'usuario_appsheet');
                continue;
            end if;
            -- valores
            v_set := '{}'::jsonb;
            foreach c in array v_cols loop
                v_val := public._agm_num(r, c);
                if v_val is not null then
                    if abs(v_val) >= 10000000 then
                        raise exception 'El valor de % es demasiado grande.', c using errcode = '22003';
                    end if;
                    v_set := v_set || jsonb_build_object(c, v_val);
                end if;
            end loop;

            insert into public.agm_parametros (id, turno_ciclo_id, fecha, ddt,
                    tensiometro_12_am, tensiometro_24_am, tensiometro_12_pm, tensiometro_24_pm,
                    ce_agua, ph_agua, ce_gotero, ph_gotero, ce_extractor, ph_extractor, cloro_cinta,
                    ce_suelo_antes, ce_suelo_despues, latitud, longitud, comentario,
                    origen, id_appsheet, creado_por, creado_en)
            values (v_id, v_tc.id, v_fecha, case when v_tc.fecha_siembra is not null then v_fecha - v_tc.fecha_siembra end,
                    (v_set ->> 'tensiometro_12_am')::numeric, (v_set ->> 'tensiometro_24_am')::numeric,
                    (v_set ->> 'tensiometro_12_pm')::numeric, (v_set ->> 'tensiometro_24_pm')::numeric,
                    (v_set ->> 'ce_agua')::numeric, (v_set ->> 'ph_agua')::numeric,
                    (v_set ->> 'ce_gotero')::numeric, (v_set ->> 'ph_gotero')::numeric,
                    (v_set ->> 'ce_extractor')::numeric, (v_set ->> 'ph_extractor')::numeric,
                    (v_set ->> 'cloro_cinta')::numeric, (v_set ->> 'ce_suelo_antes')::numeric,
                    (v_set ->> 'ce_suelo_despues')::numeric,
                    public._agm_num(r, 'latitud'), public._agm_num(r, 'longitud'),
                    nullif(btrim(r ->> 'comentario'), ''),
                    'APPSHEET', v_idapp, v_user, ((v_fecha::timestamp + interval '12 hours') at time zone 'America/Tegucigalpa'))
            on conflict do nothing;
            get diagnostics v_n = row_count;
            if v_n = 0 then
                select id into v_ex from public.agm_parametros
                 where turno_ciclo_id = v_tc.id and fecha = v_fecha and eliminado_en is null limit 1;
                v_conf := v_conf || jsonb_build_object('id_appsheet', v_idapp, 'existente', v_ex);
                continue;
            end if;
            -- fuera de rango y marca de «ya está en AGL» (sentencias aparte: ven la fila)
            update public.agm_parametros a set fuera_rango = public._agm_fuera_rango(to_jsonb(a))
             where a.id = v_id
            returning * into v_fila;
            update public.agm_parametros a set bajado_a_agl_en = now(), huella = public._agm_huella(to_jsonb(a))
             where a.id = v_id;
            v_ins := v_ins + 1;
        exception when others then
            v_inv := v_inv || jsonb_build_object('id_appsheet', v_idapp, 'error', sqlerrm);
        end;
    end loop;
    return jsonb_build_object('insertadas', v_ins, 'ya_existian', v_ya, 'sin_usuario', v_sinu, 'sin_turno', v_sint,
                              'en_conflicto', v_conf, 'invalidas', v_inv);
end
$$;
revoke execute on function public.fn_agm_cargar_appsheet(jsonb) from public, anon;
grant  execute on function public.fn_agm_cargar_appsheet(jsonb) to authenticated;

-- ---------------------------------------------------------------- 8 · mis registros (lista y gráficas)
/**
 * p = {temporada?, turno? (código del turno, sin mayúsculas, o parte), turno_ciclo_id?, zona_id?, desde?, hasta?, texto?,
 *      limite? (1..1000, 50), pagina? (desde 0), orden? 'desc' (por defecto) | 'asc'}
 * Visibles: del administrador todos; del dueño los suyos; del encargado de zona los de su zona. Sin eliminados.
 * -> {total, limite, pagina, registros: [{...todas las columnas del registro (valores para graficar), turno, temporada, ciclo,
 *     estacion, zona_id, zona, creado_por_nombre, creado_por_email, editado_por_nombre, puede_editar, puede_eliminar}]}
 * (no incluye huella, marcas de bajada ni datos de eliminación).
 */
create or replace function public.fn_agm_mis_registros(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_p     jsonb := coalesce(p, '{}'::jsonb);
    v_lim   integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 50), 1), 1000);
    v_pag   integer := greatest(coalesce(nullif(v_p ->> 'pagina', '')::integer, 0), 0);
    v_asc   boolean := lower(coalesce(v_p ->> 'orden', 'desc')) = 'asc';
    v_temp  text := nullif(btrim(v_p ->> 'temporada'), '');
    v_turno text := nullif(btrim(v_p ->> 'turno'), '');
    v_tc    uuid := nullif(v_p ->> 'turno_ciclo_id', '')::uuid;
    v_zona  uuid := nullif(v_p ->> 'zona_id', '')::uuid;
    v_desde date := nullif(v_p ->> 'desde', '')::date;
    v_hasta date := nullif(v_p ->> 'hasta', '')::date;
    v_txt   text := nullif(btrim(v_p ->> 'texto'), '');
    v_total integer;
    v_regs  jsonb;
    v_elim  boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    v_elim := public._agm_puede_eliminar_registro();

    with f as (
        select a.id, a.fecha
          from public.agm_parametros a
          join public.turnos_ciclo tc on tc.id = a.turno_ciclo_id
          join public.turnos tu on tu.id = tc.turno_id
          left join public.estaciones_riego e on e.id = tc.estacion_id
          left join public.zonas z on z.id = coalesce(e.zona_id, tc.zona_id)
          left join public.perfiles pf on pf.id = a.creado_por
         where a.eliminado_en is null
           and (v_temp is null or tc.temporada = v_temp)
           and (v_tc is null or tc.id = v_tc)
           and (v_turno is null or tu.codigo ilike '%' || v_turno || '%')
           and (v_zona is null or coalesce(e.zona_id, tc.zona_id) = v_zona)
           and (v_desde is null or a.fecha >= v_desde)
           and (v_hasta is null or a.fecha <= v_hasta)
           and (v_txt is null or concat_ws(' ', tu.codigo, z.nombre, e.nombre, pf.nombre, a.comentario, a.id_appsheet, a.fecha::text) ilike '%' || v_txt || '%')
           and public._agm_puede_ver_registro(a.creado_por, a.turno_ciclo_id)
    ), pg as (
        select f.id from f
         order by case when v_asc then f.fecha end asc, case when not v_asc then f.fecha end desc, f.id
         limit v_lim offset v_pag * v_lim
    )
    select (select count(*) from f),
           coalesce(jsonb_agg(
               (to_jsonb(a) - array['bajado_a_agl_en', 'huella', 'creado_por', 'actualizado_por', 'editado_por',
                                    'eliminado_en', 'eliminado_por', 'eliminado_motivo'])
               || jsonb_build_object(
                   'turno', tu.codigo, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
                   'estacion', e.nombre, 'zona_id', coalesce(e.zona_id, tc.zona_id), 'zona', z.nombre,
                   'creado_por_nombre', pf.nombre,
                   'creado_por_email', (select lower(u.email) from auth.users u where u.id = a.creado_por),
                   'editado_por_nombre', pe.nombre,
                   'puede_editar', public._agm_puede_editar_registro(a.creado_por, a.turno_ciclo_id),
                   'puede_eliminar', v_elim)
               order by case when v_asc then a.fecha end asc, case when not v_asc then a.fecha end desc, tu.codigo, a.id), '[]'::jsonb)
      into v_total, v_regs
      from pg
      join public.agm_parametros a on a.id = pg.id
      join public.turnos_ciclo tc on tc.id = a.turno_ciclo_id
      join public.turnos tu on tu.id = tc.turno_id
      left join public.estaciones_riego e on e.id = tc.estacion_id
      left join public.zonas z on z.id = coalesce(e.zona_id, tc.zona_id)
      left join public.perfiles pf on pf.id = a.creado_por
      left join public.perfiles pe on pe.id = a.editado_por;
    return jsonb_build_object('total', v_total, 'limite', v_lim, 'pagina', v_pag, 'registros', v_regs);
end
$$;
revoke execute on function public.fn_agm_mis_registros(jsonb) from public, anon;
grant  execute on function public.fn_agm_mis_registros(jsonb) to authenticated;

-- ---------------------------------------------------------------- 9 · editar
/**
 * p = {id, <columnas de valores>…, latitud?, longitud?, comentario?}. Solo cambia lo que viene en p; una clave con valor vacío
 * LIMPIA ese campo. No cambia turno ni fecha. Un valor que no es número se rechaza. Marca editado_en/por; la huella cambia sola.
 * -> {cambio: true|false, registro: {...fila}}
 */
create or replace function public.fn_agm_editar_parametro(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id    uuid := nullif(p ->> 'id', '')::uuid;
    v_cols  text[] := array['tensiometro_12_am','tensiometro_24_am','tensiometro_12_pm','tensiometro_24_pm',
                            'ce_agua','ph_agua','ce_gotero','ph_gotero','ce_extractor','ph_extractor','cloro_cinta',
                            'ce_suelo_antes','ce_suelo_despues'];
    v_a     public.agm_parametros%rowtype;
    v_ant   jsonb;
    v_n     jsonb := '{}'::jsonb;     -- valores nuevos por columna (null = limpiar)
    c       text;
    v_val   numeric;
    v_crudo text;
    v_lat   numeric;
    v_lon   numeric;
    v_ncom  text;
    v_fila  public.agm_parametros%rowtype;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if v_id is null then
        raise exception 'Indica el registro a editar.' using errcode = '22023';
    end if;
    select * into v_a from public.agm_parametros where id = v_id for update;
    if not found or v_a.eliminado_en is not null then
        raise exception 'El registro no existe o ya fue eliminado.' using errcode = '22023';
    end if;
    if not public._agm_puede_editar_registro(v_a.creado_por, v_a.turno_ciclo_id) then
        raise exception 'No tienes permiso para editar este registro (solo su dueño, el encargado de la zona o el administrador).'
            using errcode = '42501';
    end if;
    if exists (select 1 from public.turnos_ciclo where id = v_a.turno_ciclo_id and archivado_at is not null) then
        raise exception 'El turno ya fue terminado en AGL: reactívalo allá para editar este registro.' using errcode = '22023';
    end if;

    foreach c in array v_cols loop
        if p ? c then
            v_crudo := nullif(btrim(coalesce(p ->> c, '')), '');
            v_val := public._agm_num(p, c);
            if v_crudo is not null and v_val is null then
                raise exception 'El valor de % no es un número.', c using errcode = '22023';
            end if;
            if v_val is not null and abs(v_val) >= 10000000 then
                raise exception 'El valor de % es demasiado grande.', c using errcode = '22003';
            end if;
            v_n := v_n || jsonb_build_object(c, v_val);   -- v_val null → JSON null → limpia
        end if;
    end loop;
    if p ? 'latitud' or p ? 'longitud' then
        v_lat := case when p ? 'latitud' then public._agm_num(p, 'latitud') else v_a.latitud end;
        v_lon := case when p ? 'longitud' then public._agm_num(p, 'longitud') else v_a.longitud end;
        if (v_lat is null) <> (v_lon is null)
           or v_lat not between -90 and 90 or v_lon not between -180 and 180 then
            raise exception 'La ubicación no es válida.' using errcode = '22023';
        end if;
    else
        v_lat := v_a.latitud; v_lon := v_a.longitud;
    end if;
    v_ncom := case when p ? 'comentario' then nullif(btrim(coalesce(p ->> 'comentario', '')), '') else v_a.comentario end;

    v_ant := to_jsonb(v_a);
    update public.agm_parametros a set
        tensiometro_12_am = case when v_n ? 'tensiometro_12_am' then (v_n ->> 'tensiometro_12_am')::numeric else a.tensiometro_12_am end,
        tensiometro_24_am = case when v_n ? 'tensiometro_24_am' then (v_n ->> 'tensiometro_24_am')::numeric else a.tensiometro_24_am end,
        tensiometro_12_pm = case when v_n ? 'tensiometro_12_pm' then (v_n ->> 'tensiometro_12_pm')::numeric else a.tensiometro_12_pm end,
        tensiometro_24_pm = case when v_n ? 'tensiometro_24_pm' then (v_n ->> 'tensiometro_24_pm')::numeric else a.tensiometro_24_pm end,
        ce_agua           = case when v_n ? 'ce_agua' then (v_n ->> 'ce_agua')::numeric else a.ce_agua end,
        ph_agua           = case when v_n ? 'ph_agua' then (v_n ->> 'ph_agua')::numeric else a.ph_agua end,
        ce_gotero         = case when v_n ? 'ce_gotero' then (v_n ->> 'ce_gotero')::numeric else a.ce_gotero end,
        ph_gotero         = case when v_n ? 'ph_gotero' then (v_n ->> 'ph_gotero')::numeric else a.ph_gotero end,
        ce_extractor      = case when v_n ? 'ce_extractor' then (v_n ->> 'ce_extractor')::numeric else a.ce_extractor end,
        ph_extractor      = case when v_n ? 'ph_extractor' then (v_n ->> 'ph_extractor')::numeric else a.ph_extractor end,
        cloro_cinta       = case when v_n ? 'cloro_cinta' then (v_n ->> 'cloro_cinta')::numeric else a.cloro_cinta end,
        ce_suelo_antes    = case when v_n ? 'ce_suelo_antes' then (v_n ->> 'ce_suelo_antes')::numeric else a.ce_suelo_antes end,
        ce_suelo_despues  = case when v_n ? 'ce_suelo_despues' then (v_n ->> 'ce_suelo_despues')::numeric else a.ce_suelo_despues end,
        latitud = v_lat, longitud = v_lon, comentario = v_ncom
     where a.id = v_id
    returning * into v_fila;

    update public.agm_parametros a set fuera_rango = public._agm_fuera_rango(to_jsonb(a))
     where a.id = v_id
    returning * into v_fila;

    -- ¿cambió algo de verdad? (sin las marcas de edición)
    if (to_jsonb(v_fila) - array['actualizado_por', 'actualizado_en', 'editado_en', 'editado_por'])
       = (v_ant - array['actualizado_por', 'actualizado_en', 'editado_en', 'editado_por']) then
        return jsonb_build_object('cambio', false, 'registro', to_jsonb(v_fila) - array['huella', 'bajado_a_agl_en']);
    end if;
    update public.agm_parametros a set editado_en = now(), editado_por = auth.uid(),
           actualizado_en = now(), actualizado_por = auth.uid()
     where a.id = v_id
    returning * into v_fila;
    return jsonb_build_object('cambio', true, 'registro', to_jsonb(v_fila) - array['huella', 'bajado_a_agl_en']);
end
$$;
revoke execute on function public.fn_agm_editar_parametro(jsonb) from public, anon;
grant  execute on function public.fn_agm_editar_parametro(jsonb) to authenticated;

-- ---------------------------------------------------------------- 10 · eliminar (tumba)
/**
 * p = {id, motivo}. SOLO con «Eliminar por completo» de AgroMétricas (o administrador). Motivo ≥ 15 letras. Eliminación
 * lógica: eliminado_en/por/motivo; deja de verse en la app; AGL la baja como tumba, la aplica en su copia y confirma (122);
 * tumba y fila se purgan después. -> {id, eliminado_en}
 */
create or replace function public.fn_agm_eliminar_parametro(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id     uuid := nullif(p ->> 'id', '')::uuid;
    v_motivo text := btrim(coalesce(p ->> 'motivo', ''));
    v_a      public.agm_parametros%rowtype;
    v_cuando timestamptz := now();
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not public._agm_puede_eliminar_registro() then
        raise exception 'Tu rol no tiene «Eliminar por completo» en AgroMétricas. Se concede en Permisos.' using errcode = '42501';
    end if;
    if v_id is null then
        raise exception 'Indica el registro a eliminar.' using errcode = '22023';
    end if;
    if char_length(v_motivo) < 15 then
        raise exception 'Explica por qué se elimina (mínimo 15 letras).' using errcode = '22023';
    end if;
    select * into v_a from public.agm_parametros where id = v_id for update;
    if not found then
        raise exception 'El registro no existe.' using errcode = '22023';
    end if;
    if v_a.eliminado_en is not null then
        raise exception 'Este registro ya fue eliminado.' using errcode = '22023';
    end if;
    update public.agm_parametros set eliminado_en = v_cuando, eliminado_por = auth.uid(), eliminado_motivo = v_motivo
     where id = v_id;
    return jsonb_build_object('id', v_id, 'eliminado_en', v_cuando);
end
$$;
revoke execute on function public.fn_agm_eliminar_parametro(jsonb) from public, anon;
grant  execute on function public.fn_agm_eliminar_parametro(jsonb) to authenticated;

-- ---------------------------------------------------------------- 11 · exportar (122) con tumbas y correo
create or replace function public.fn_agm_exportar(p jsonb default '{}'::jsonb)
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
    perform public._agm_exigir_agl('ver');
    with f as (
        select x.* from public._agm_filas() x
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
               'tabla', l.tabla, 'cursor', l.cursor, 'id', l.id,
               'turno_ciclo_id', l.turno_ciclo_id,
               'turno_agl_id', tc.agl_id, 'turno', tu.codigo, 'temporada', tc.temporada, 'ciclo', tc.ciclo,
               'zona_id', coalesce(l.zona_id, e.zona_id, tc.zona_id), 'zona', z.nombre,
               'fecha', l.fecha, 'fila', l.fila, 'texto', l.texto, 'huella', l.huella,
               'eliminado', (l.fila ->> 'eliminado_en') is not null,
               'creado_por_email', (select lower(u.email) from auth.users u where u.id = nullif(l.fila ->> 'creado_por', '')::uuid),
               'foto', case when l.foto is null then null
                            else jsonb_build_object('ruta', l.foto, 'bytes', public._agm_foto_bytes(l.foto)) end
           ) order by l.cursor collate "C"), '[]'::jsonb),
           max(l.cursor collate "C"),
           count(*),
           encode(sha256(convert_to(coalesce(string_agg(l.huella, '|' order by l.cursor collate "C"), ''), 'UTF8')), 'hex')
      into v_mas, v_filas, v_sig, v_cuantos, v_lote
      from lim l
      left join public.turnos_ciclo tc on tc.id = l.turno_ciclo_id
      left join public.turnos tu on tu.id = tc.turno_id
      left join public.estaciones_riego e on e.id = tc.estacion_id
      left join public.zonas z on z.id = coalesce(l.zona_id, e.zona_id, tc.zona_id);
    return jsonb_build_object('generado', now(), 'hay_mas', coalesce(v_mas, false), 'siguiente', v_sig,
                              'cuantos', v_cuantos, 'sha256_lote', v_lote, 'filas', v_filas);
end
$$;
revoke execute on function public.fn_agm_exportar(jsonb) from public, anon;
grant  execute on function public.fn_agm_exportar(jsonb) to authenticated;

-- ---------------------------------------------------------------- 12 · purgar (122) con la regla de retención por turno
/**
 * Igual que la 122, más: un parámetro solo se purga si es una TUMBA confirmada o si su turno ya no está activo (los de un
 * turno activo se quedan en Supabase aunque ya estén bajados). Calicata: como antes (turno inactivo). Clima: como antes.
 */
create or replace function public.fn_agm_purgar_bajadas(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p     jsonb := coalesce(p, '{}'::jsonb);
    v_lim   integer := least(greatest(coalesce(nullif(v_p ->> 'limite', '')::integer, 500), 1), 5000);
    v_ret   integer;
    v_np    integer;
    v_nc    integer;
    v_nl    integer;
    v_fotos text[];
    v_mas   boolean;
begin
    perform public._agm_exigir_agl('publicar');
    select retencion_dias into v_ret from public.agm_bajada_config where id;
    v_ret := greatest(coalesce(v_ret, 7), coalesce(nullif(v_p ->> 'retencion_dias', '')::integer, 0));

    select count(*) > v_lim into v_mas
      from public._agm_filas() f
     where f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
       and f.bajado_a_agl_en < now() - make_interval(days => v_ret)
       and case f.tabla when 'calicatas' then f.turno_activo is false
                        when 'parametros' then (f.fila ->> 'eliminado_en') is not null or f.turno_activo is false
                        else true end;

    with c as (
        select f.tabla, f.id from public._agm_filas() f
         where f.bajado_a_agl_en is not null and f.huella_guardada is not null and f.huella = f.huella_guardada
           and f.bajado_a_agl_en < now() - make_interval(days => v_ret)
           and case f.tabla when 'calicatas' then f.turno_activo is false
                            when 'parametros' then (f.fila ->> 'eliminado_en') is not null or f.turno_activo is false
                            else true end
         order by f.cursor collate "C"
         limit v_lim
    ), dp as (
        delete from public.agm_parametros a using c
         where c.tabla = 'parametros' and a.id = c.id
           and a.huella is not null and public._agm_huella(to_jsonb(a)) = a.huella
        returning a.foto_calicata
    ), dc as (
        delete from public.agm_clima a using c
         where c.tabla = 'clima' and a.id = c.id
           and a.huella is not null and public._agm_huella(to_jsonb(a)) = a.huella
        returning a.id
    ), dl as (
        delete from public.agm_calicatas a using c
         where c.tabla = 'calicatas' and a.turno_ciclo_id = c.id
           and a.huella is not null and public._agm_huella(to_jsonb(a)) = a.huella
        returning a.turno_ciclo_id
    )
    select (select count(*) from dp), (select count(*) from dc), (select count(*) from dl),
           (select array_agg(distinct nullif(foto_calicata, '')) from dp where nullif(foto_calicata, '') is not null)
      into v_np, v_nc, v_nl, v_fotos;

    -- sentencia aparte: ya ve las filas borradas
    return jsonb_build_object(
        'parametros', v_np, 'clima', v_nc, 'calicatas', v_nl,
        'fotos', coalesce((select jsonb_agg(f order by f) from unnest(coalesce(v_fotos, '{}'::text[])) f
                            where not exists (select 1 from public.agm_parametros o where o.foto_calicata = f)), '[]'::jsonb),
        'hay_mas', coalesce(v_mas, false) and (v_np + v_nc + v_nl) > 0,
        'retencion_dias', v_ret);
end
$$;
revoke execute on function public.fn_agm_purgar_bajadas(jsonb) from public, anon;
grant  execute on function public.fn_agm_purgar_bajadas(jsonb) to authenticated;

notify pgrst, 'reload schema';
