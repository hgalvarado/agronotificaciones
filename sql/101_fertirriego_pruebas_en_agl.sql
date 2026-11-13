-- =====================================================================
-- 101 · FERTIRRIEGO · VER EN AGL LOS DATOS DEL MODO DE PRUEBAS
-- =====================================================================
-- Pedido del usuario (2026-11-13): «los datos que hacemos en las pruebas poder mostrarlos y bajarlos en AGL, y cuando
-- elimine la prueba o la desactive también se deje de ver esos datos».
--   - fn_fert_exportar (lo real) NO cambia: sigue sin incluir nada de prueba.
--   - fn_fert_exportar_pruebas: lo MISMO pero SOLO de las estaciones «PRUEBA · …», y solo mientras el modo de pruebas
--     está ACTIVO. Apagado o borrado → responde {pruebas_activo: false} y AGL borra su copia de prueba.
-- Cómo: una sola regla «¿AGL ve esta estación?» (_fert_agl_ve) reemplaza el filtro fijo «prueba_de is null» de las
-- funciones de exportación; por defecto ve lo real, y solo fn_fert_exportar_pruebas la cambia (dentro de su llamada).
-- Correr DESPUÉS de la 100. Idempotente. Solo lectura de datos.
-- =====================================================================

create or replace function public._fert_agl_ve(p_prueba_de uuid)
returns boolean
language sql stable as $$
    select case when coalesce(current_setting('fert.agl_pruebas', true), '') = 'on'
                then p_prueba_de is not null
                else p_prueba_de is null end
$$;

-- Cambia el filtro fijo por la regla, verificando que el texto esté (si ya se cambió, no hace nada)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_veces integer)
returns void language plpgsql as $$
declare
    v_def text := pg_get_functiondef(p_fn::regprocedure);
    v_n   integer := (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo);
begin
    if v_n = 0 and position(p_nuevo in v_def) > 0 then
        return;   -- ya estaba parchada
    end if;
    if v_n <> p_veces then
        raise exception '101: en % se esperaban % apariciones de «%» y hay %', p_fn, p_veces, p_viejo, v_n;
    end if;
    execute replace(v_def, p_viejo, p_nuevo);
end $$;

select pg_temp.parchar('public._fert_exportar_base(bigint, integer)',
    'estacion_id not in (select e9.id from public.estaciones_riego e9 where e9.prueba_de is not null)',
    'estacion_id in (select e9.id from public.estaciones_riego e9 where public._fert_agl_ve(e9.prueba_de))', 1);
select pg_temp.parchar('public._fert_exportar_base(bigint, integer)',
    'e.prueba_de is null', 'public._fert_agl_ve(e.prueba_de)', 4);
select pg_temp.parchar('public.fn_fert_exportar(bigint, integer)',
    'from public.estaciones_riego where prueba_de is null', 'from public.estaciones_riego where public._fert_agl_ve(prueba_de)', 1);

/** Lo mismo que fn_fert_exportar, pero SOLO lo de prueba y solo con el modo de pruebas activo. */
create or replace function public.fn_fert_exportar_pruebas(p_cursor bigint default 0, p_limite integer default 5000)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_res jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'ver')) then
        raise exception 'Este usuario no tiene «Ver» en «Fertirriego · Conexión AGL».' using errcode = '42501';
    end if;
    if not coalesce((select p.activo from seguridad.fert_pruebas p limit 1), false)
       or not exists (select 1 from public.estaciones_riego where prueba_de is not null) then
        return jsonb_build_object('pruebas_activo', false,
                                  'mensaje', 'El modo de pruebas está apagado: no hay datos de prueba que ver.');
    end if;
    perform set_config('fert.agl_pruebas', 'on', true);
    v_res := public.fn_fert_exportar(p_cursor, p_limite);
    perform set_config('fert.agl_pruebas', 'off', true);
    return v_res || jsonb_build_object(
        'pruebas_activo', true,
        'activado_en', (select p.activado_en from seguridad.fert_pruebas p limit 1),
        'estaciones_prueba', coalesce((select jsonb_agg(jsonb_build_object('estacion', e.nombre, 'real', r.nombre) order by e.nombre)
                                       from public.estaciones_riego e join public.estaciones_riego r on r.id = e.prueba_de), '[]'::jsonb));
end;
$$;

revoke execute on function public.fn_fert_exportar_pruebas(bigint, integer) from public, anon;
grant execute on function public.fn_fert_exportar_pruebas(bigint, integer) to authenticated;

notify pgrst, 'reload schema';
