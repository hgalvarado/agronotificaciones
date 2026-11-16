-- =====================================================================
-- 110 · AgroMétricas: calicata fija por ciclo (con la PRECISIÓN del GPS) y fotos de calicata
--
--   agm_calicatas   una por turno y ciclo (turnos_ciclo): se instala una vez y no se mueve en todo el ciclo. Se
--                   guarda la ubicación con su precisión (metros). Medir otra vez solo la reemplaza si la nueva es
--                   MÁS precisa, o si la persona pide reubicarla (con «Corregir parámetros»).
--   Fotos           bucket privado «agrometricas» (Storage). El teléfono sube la foto del día y agm_parametros guarda
--                   la ruta; AGL la baja a OneDrive y la borra de aquí (Supabase solo intermediario).
-- Requiere la 109. Idempotente. Todo UPDATE/DELETE lleva WHERE.
-- =====================================================================

create table if not exists public.agm_calicatas (
    turno_ciclo_id uuid primary key references public.turnos_ciclo(id),
    latitud        numeric(10,7) not null,
    longitud       numeric(10,7) not null,
    precision_m    numeric(8,2) not null,          -- radio de precisión que dio el GPS (más chico = mejor)
    lecturas       integer not null default 1,     -- lecturas que se tomaron para quedarse con la mejor
    medido_por     uuid default auth.uid(),
    medido_en      timestamptz not null default now()
);

alter table public.agm_calicatas enable row level security;
drop policy if exists agm_calicatas_leer on public.agm_calicatas;
create policy agm_calicatas_leer on public.agm_calicatas for select to authenticated
    using (public.fn_agm_puede_zona(public._agm_zona_turno(turno_ciclo_id), 'ver'));
grant select on public.agm_calicatas to authenticated;

/**
 * Guarda la ubicación de la calicata del turno. p = {turno_ciclo_id, latitud, longitud, precision_m, lecturas,
 * reubicar}. Sin «reubicar»: si ya hay una igual o más precisa, se queda la que estaba.
 * -> {calicata, cambio: true|false}
 */
create or replace function public.fn_agm_guardar_calicata(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_turno  uuid := nullif(p ->> 'turno_ciclo_id', '')::uuid;
    v_zona   uuid;
    v_lat    numeric := public._agm_num(p, 'latitud');
    v_lon    numeric := public._agm_num(p, 'longitud');
    v_prec   numeric := public._agm_num(p, 'precision_m');
    v_reubicar boolean := coalesce((p ->> 'reubicar')::boolean, false);
    v_previa public.agm_calicatas%rowtype;
    v_cambio boolean := false;
begin
    v_zona := public._agm_zona_turno(v_turno);
    if v_turno is null or v_zona is null and not exists (select 1 from public.turnos_ciclo where id = v_turno) then
        raise exception 'El turno no existe o ya no está publicado por AGL.' using errcode = '22023';
    end if;
    if v_lat is null or v_lon is null or v_prec is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 then
        raise exception 'La ubicación no es válida.' using errcode = '22023';
    end if;
    if not public.fn_agm_puede_zona(v_zona, 'registrar_parametros') then
        raise exception 'No tienes permiso para registrar la calicata de este turno.' using errcode = '42501';
    end if;
    select * into v_previa from public.agm_calicatas where turno_ciclo_id = v_turno;
    if found and v_reubicar and not public.fn_agm_puede_zona(v_zona, 'corregir_parametros') then
        raise exception 'Para mover la calicata se necesita «Corregir parámetros».' using errcode = '42501';
    end if;
    if not found then
        insert into public.agm_calicatas (turno_ciclo_id, latitud, longitud, precision_m, lecturas)
        values (v_turno, v_lat, v_lon, v_prec, greatest(coalesce(public._agm_num(p, 'lecturas')::int, 1), 1));
        v_cambio := true;
    elsif v_reubicar or v_prec < v_previa.precision_m then
        update public.agm_calicatas set latitud = v_lat, longitud = v_lon, precision_m = v_prec,
               lecturas = greatest(coalesce(public._agm_num(p, 'lecturas')::int, 1), 1), medido_por = auth.uid(), medido_en = now()
         where turno_ciclo_id = v_turno;
        v_cambio := true;
    end if;
    return jsonb_build_object('cambio', v_cambio,
        'calicata', (select to_jsonb(c) from public.agm_calicatas c where c.turno_ciclo_id = v_turno));
end
$$;
grant execute on function public.fn_agm_guardar_calicata(jsonb) to authenticated;

-- ---------------------------------------------------------------- fotos (Storage; se omite donde no hay Storage)
do $$
begin
    if to_regclass('storage.buckets') is null then
        raise notice 'Sin Storage (réplica local): se omite el bucket de fotos.';
        return;
    end if;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('agrometricas', 'agrometricas', false, 3145728, array['image/jpeg', 'image/webp', 'image/png'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists agm_fotos_subir on storage.objects';
    execute $p$create policy agm_fotos_subir on storage.objects for insert to authenticated
        with check (bucket_id = 'agrometricas' and public.fn_tiene_permiso('agrometricas', 'registrar_parametros'))$p$;
    execute 'drop policy if exists agm_fotos_reemplazar on storage.objects';
    execute $p$create policy agm_fotos_reemplazar on storage.objects for update to authenticated
        using (bucket_id = 'agrometricas' and owner = auth.uid())$p$;
    execute 'drop policy if exists agm_fotos_ver on storage.objects';
    execute $p$create policy agm_fotos_ver on storage.objects for select to authenticated
        using (bucket_id = 'agrometricas' and public.fn_tiene_permiso('agrometricas', 'ver'))$p$;
end
$$;
