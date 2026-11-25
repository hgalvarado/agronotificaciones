-- =====================================================================
-- 149 · MOTORES · VISTA GENERAL (permiso propio), HISTORIAL DE TODA LA TEMPORADA Y RESUMEN POR MOTOR
-- =====================================================================
-- Pedidos del usuario (2026-11-25):
--   A. «Ver general» (acción nueva `ver_general` en la pantalla `motores`): suministro de combustible y taller ven TODOS los motores
--      en tiempo real (ubicación, tanque, semáforo de mantenimiento) y el historial de cada motor, SIN acceso a las demás pestañas ni
--      a modificar nada. Solo lectura: las funciones de lectura (fn_mot_motores_resumen, fn_mot_ficha_completa) también la aceptan,
--      más una política de SOLO LECTURA (general_leer) en las tablas que alimentan el tiempo real. No se concede a ningún rol:
--      solo el administrador hasta que se asigne en Permisos (junto con «Campo · ver», que abre el menú Campo).
--      `auditar` sigue sirviendo y también ve la vista General.
--   B. Historial de TODA la temporada activa: fn_mot_estado_campo baja desde el inicio de la temporada activa (nunca menos de 45 días ni
--      más de 400) con tope de 400 registros por motor; el teléfono recibe también la temporada (`temporada`). La visibilidad se calcula
--      una vez (v_ests), nunca por fila. fn_mot_temporadas() lista las temporadas para pedir las anteriores.
--   C. fn_mot_resumen_temporada(p_temporada): por motor, por estación y total: días trabajados, horas, horas estimadas aparte, galones
--      gastados, galones recibidos, rendimiento medio (gal/h de los días con horas), RPM ponderada por horas, mantenimientos y el
--      desglose por tramo de custodia. Sin anulados; sin pruebas salvo en modo de pruebas.
--
-- Correr DESPUÉS de la 147 (y 148). Idempotente (dos corridas seguidas sin error). Todo UPDATE/DELETE lleva WHERE.
-- ORDEN: si se vuelve a correr la 147 (redefine fn_mot_estado_campo, fn_mot_motores_resumen, fn_mot_ficha_completa) → CORRER LA 149
-- OTRA VEZ (y la 148 antes si hace falta). Parches por texto con marcas «149:» dentro de las funciones.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.fn_mot_motores_resumen()') is null or to_regprocedure('public.fn_mot_ficha_completa(uuid,date,date)') is null
       or to_regprocedure('public.fn_mot_estado_campo(date)') is null then
        raise exception '149: falta correr antes la 147 (Motores: tanques y custodia).';
    end if;
end $$;

-- ---------------------------------------------------------------- 1 · permiso «ver_general» (solo lectura)
insert into public.acciones (codigo, nombre, descripcion, orden, escribe, nivel) values
    ('ver_general', 'Vista general', 'Motores: ver TODOS los motores en tiempo real (ubicación, tanque, mantenimiento) y el historial de cada uno, sin poder registrar ni modificar nada. Para suministro de combustible y taller. Se asigna junto con «Campo · ver» (que abre el menú).', 129, false, 4)
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, escribe = excluded.escribe;
update public.pantallas
   set acciones = acciones || 'ver_general'::text
 where codigo = 'motores' and not ('ver_general' = any(acciones));
-- No se concede a ningún rol: solo el administrador (fn_es_admin) hasta que se asigne en Permisos.

/** ¿Puede ver TODOS los motores? (administrador, «Vista general» o «Auditar»). Solo lectura. */
create or replace function public._mot_lector_general()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin() or public.fn_tiene_permiso('motores', 'ver_general') or public.fn_tiene_permiso('motores', 'auditar')
$$;
revoke execute on function public._mot_lector_general() from public, anon;
grant  execute on function public._mot_lector_general() to authenticated;

-- ---------------------------------------------------------------- 2 · lectura directa (tiempo real) solo para quien ve todo
-- Políticas EXTRA de solo lectura (se suman a fert_leer). Solo las tablas que mueve el tiempo real de la vista General.
do $$
declare t text;
begin
    foreach t in array array['mot_motores', 'mot_registros', 'mot_recepciones', 'mot_custodias'] loop
        if to_regclass('public.' || t) is not null then
            execute format('drop policy if exists general_leer on public.%I', t);
            execute format('create policy general_leer on public.%I for select to authenticated using ((select public._mot_lector_general()))', t);
        end if;
    end loop;
    -- Realtime (como la 84): sin esto la vista General se pone al día al volver a la ventana o con «Actualizar»
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach t in array array['mot_motores', 'mot_registros', 'mot_recepciones', 'mot_custodias'] loop
            if to_regclass('public.' || t) is not null and not exists (
                   select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
                execute format('alter publication supabase_realtime add table public.%I', t);
            end if;
        end loop;
    end if;
end $$;

-- ---------------------------------------------------------------- 3 · parches (marcas propias 149)
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
        raise exception '149: en % se esperaba 1 aparición de «%» y hay % (¿falta la 147?)', p_fn, left(v_viejo, 80), v_n;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
end $$;

-- 3a · lista de motores (General): acepta «Vista general» y trae tanque con saldo/capacidad e intervalo de mantenimiento
select pg_temp.parchar('public.fn_mot_motores_resumen()',
    $p$if not (public.fn_es_admin() or public.fn_tiene_permiso('motores', 'auditar')) then$p$,
    $p$if not (public._mot_lector_general() /* 149:permiso-resumen */) then$p$,
    '149:permiso-resumen');
select pg_temp.parchar('public.fn_mot_motores_resumen()',
    $p$'tanque_id', mo.tanque_id, 'tanque', t.nombre,$p$,
    $p$'tanque_id', mo.tanque_id, 'tanque', t.nombre, /* 149:resumen */
                   'capacidad_gal', t.capacidad_gal,
                   'saldo_gal', case when mo.tanque_id is null then null else coalesce((select s.disponible from public.mot_saldos s where s.tanque_id = mo.tanque_id), 0) end,
                   'intervalo_horas', public._mot_intervalo(mo.equipo_id), 'aviso_horas', mo.aviso_horas,
                   'horas_desde_mant', mo.horas_desde_mant, 'horas_est_desde_mant', mo.horas_est_desde_mant,$p$,
    '149:resumen');

-- 3b · ficha completa: acepta «Vista general» y trae zona/tanque para los indicadores
select pg_temp.parchar('public.fn_mot_ficha_completa(uuid,date,date)',
    $p$if not (public.fn_es_admin() or public.fn_tiene_permiso('motores', 'auditar')) then$p$,
    $p$if not (public._mot_lector_general() /* 149:permiso-ficha */) then$p$,
    '149:permiso-ficha');
select pg_temp.parchar('public.fn_mot_ficha_completa(uuid,date,date)',
    $p$'intervalo_horas', public._mot_intervalo(mo.equipo_id))$p$,
    $p$'intervalo_horas', public._mot_intervalo(mo.equipo_id), 'aviso_horas', mo.aviso_horas, /* 149:ficha */
                                            'tanque', (select t.nombre from public.mot_tanques t where t.id = mo.tanque_id),
                                            'capacidad_gal', (select t.capacidad_gal from public.mot_tanques t where t.id = mo.tanque_id),
                                            'saldo_gal', case when mo.tanque_id is null then null else coalesce((select s.disponible from public.mot_saldos s where s.tanque_id = mo.tanque_id), 0) end,
                                            'zona', (select z.nombre from public.zonas z where z.id = er.zona_id))$p$,
    '149:ficha');

-- 3c · lo que baja el teléfono: permiso, temporada y ventana de toda la temporada activa
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$'auditar', public.fn_es_admin() or public.fn_tiene_permiso('motores', 'auditar')),$p$,
    $p$'auditar', public.fn_es_admin() or public.fn_tiene_permiso('motores', 'auditar'),
            'ver_general', public._mot_lector_general() /* 149:general */),$p$,
    '149:general');
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$v_desde := coalesce(p_desde, v_hoy - 45);$p$,
    $p$-- 149:temporada · desde el inicio de la temporada activa (nunca menos de 45 días ni más de 400)
    v_desde := coalesce(p_desde,
        (select greatest(least(t.fecha_inicio, v_hoy - 45), v_hoy - 400) from public.temporadas t where t.activa order by t.fecha_inicio desc limit 1),
        v_hoy - 45);$p$,
    '149:temporada');
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$'servidor_en', now(),$p$,
    $p$'servidor_en', now(),
        'temporada', (select jsonb_build_object('id', t.id, 'nombre', t.nombre, 'desde', t.fecha_inicio, 'hasta', t.fecha_fin)
                        from public.temporadas t where t.activa order by t.fecha_inicio desc limit 1), /* 149:tempo-json */$p$,
    '149:tempo-json');
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$where r.fecha >= v_desde and r.estacion_id = any(v_ests)), '[]'::jsonb),$p$,
    $p$where r.fecha >= v_desde and r.estacion_id = any(v_ests)
               and r.id in (select x.id from (select q.id, row_number() over (partition by q.equipo_id order by q.fecha desc) as n
                                                from public.mot_registros q where q.estacion_id = any(v_ests) and q.fecha >= v_desde) x
                             where x.n <= 400 /* 149:tope */)), '[]'::jsonb),$p$,
    '149:tope');

-- ---------------------------------------------------------------- 4 · temporadas (para pedir las anteriores)
create or replace function public.fn_mot_temporadas()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    if not (public._mot_lector_general() or public.fn_tiene_permiso('motores', 'ver')) then
        raise exception 'Tu rol no tiene «Ver» en Motores y combustible.' using errcode = '42501';
    end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'nombre', t.nombre, 'fecha_inicio', t.fecha_inicio,
                                                         'fecha_fin', t.fecha_fin, 'activa', t.activa) order by t.fecha_inicio desc)
                       from public.temporadas t), '[]'::jsonb);
end $$;
revoke execute on function public.fn_mot_temporadas() from public, anon;
grant  execute on function public.fn_mot_temporadas() to authenticated;

-- ---------------------------------------------------------------- 5 · resumen de la temporada por motor / estación / tramo
/**
 * Cifras para presupuestos. p_temporada null = la activa (si no hay, los últimos 45 días). Quien ve todo (administrador, «Vista
 * general», «Auditar») recibe todo; quien solo tiene «Ver» recibe lo de sus estaciones. Días trabajados = días con horas;
 * rendimiento = galones gastados / horas de los días con horas; RPM = promedio ponderado por horas de los registros con RPM;
 * gal_recibidos = suministro anotado en los registros + diésel recibido en el tanque mientras el motor estuvo en cada tramo.
 */
create or replace function public.fn_mot_resumen_temporada(p_temporada uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_hoy     date := public._mot_dia(now());
    v_t       public.temporadas%rowtype;
    v_desde   date;
    v_hasta   date;
    v_todo    boolean;
    v_pru     boolean := public.fn_fert_en_pruebas();
    v_ests    uuid[];
    v_pruebas uuid[];
    v_out     jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.' using errcode = '42501';
    end if;
    v_todo := public._mot_lector_general();
    if not (v_todo or public.fn_tiene_permiso('motores', 'ver')) then
        raise exception 'Tu rol no tiene «Ver» en Motores y combustible.' using errcode = '42501';
    end if;
    select * into v_t from public.temporadas t
     where t.id = coalesce(p_temporada, (select a.id from public.temporadas a where a.activa order by a.fecha_inicio desc limit 1));
    v_desde := coalesce(v_t.fecha_inicio, v_hoy - 45);
    v_hasta := coalesce(v_t.fecha_fin, v_hoy);
    -- una sola vez (nunca por fila)
    select coalesce(array_agg(e.id), '{}'::uuid[]) into v_ests
      from public.estaciones_riego e where v_todo or public.fn_fert_puede(e.id, 'ver');
    select coalesce(array_agg(e.id), '{}'::uuid[]) into v_pruebas from public.estaciones_riego e where e.prueba_de is not null;

    with reg as (
        select r.equipo_id, r.estacion_id, r.custodia_id, r.fecha, r.horas, coalesce(r.horas_estimadas, 0) as hest,
               r.gastado_gal as gast, r.recibido_gal as sumin, r.rpm
          from public.mot_registros r
         where r.anulado_at is null and r.fecha between v_desde and v_hasta
           and r.estacion_id = any(v_ests) and (v_pru or not (r.estacion_id = any(v_pruebas)))
    ),
    cust as (
        select c.id, c.equipo_id, c.estacion_id, c.tanque_id, c.desde, c.hasta
          from public.mot_custodias c
         where c.ubicacion = 'ESTACION' and c.estacion_id = any(v_ests) and (v_pru or not (c.estacion_id = any(v_pruebas)))
           and public._mot_dia(c.desde) <= v_hasta and (c.hasta is null or public._mot_dia(c.hasta) >= v_desde)
    ),
    rec as (
        select c.id as custodia_id, c.equipo_id, c.estacion_id, sum(q.galones) as gal
          from cust c
          join public.mot_recepciones q on q.tanque_id = c.tanque_id and q.anulado_at is null
           and public._mot_dia(q.fecha_hora) between greatest(public._mot_dia(c.desde), v_desde) and least(coalesce(public._mot_dia(c.hasta), v_hasta), v_hasta)
           -- el recibido_gal del registro ya incluye lo recibido ese día en el tanque (144): solo cuentan aparte los días SIN registro del motor
           and not exists (select 1 from public.mot_registros rr where rr.equipo_id = c.equipo_id and rr.anulado_at is null
                              and rr.fecha = public._mot_dia(q.fecha_hora))
         where c.tanque_id is not null
         group by c.id, c.equipo_id, c.estacion_id
    ),
    mant as (
        select m.equipo_id, m.estacion_id, count(*) as n
          from public.mot_mantenimientos m
         where m.anulado_at is null and public._mot_dia(m.fecha_hora) between v_desde and v_hasta
           and (m.estacion_id is null or (m.estacion_id = any(v_ests) and (v_pru or not (m.estacion_id = any(v_pruebas)))))
         group by m.equipo_id, m.estacion_id
    ),
    tr as (
        select c.equipo_id, c.id, c.estacion_id, c.desde, c.hasta,
               x.dias, x.horas, x.hest, x.gast, x.sumin, x.rend, x.rpm,
               round(x.sumin + coalesce(rc.gal, 0), 2) as recibidos
          from cust c
          left join lateral (
              select count(*) filter (where g.horas > 0) as dias,
                     coalesce(sum(g.horas), 0) as horas, coalesce(sum(g.hest), 0) as hest,
                     coalesce(sum(g.gast), 0) as gast, coalesce(sum(g.sumin), 0) as sumin,
                     case when sum(g.horas) filter (where g.horas > 0) > 0
                          then round(sum(g.gast) filter (where g.horas > 0) / sum(g.horas) filter (where g.horas > 0), 2) end as rend,
                     case when sum(g.horas) filter (where g.rpm is not null and g.horas > 0) > 0
                          then round(sum(g.rpm * g.horas) filter (where g.rpm is not null and g.horas > 0)
                                     / sum(g.horas) filter (where g.rpm is not null and g.horas > 0)) end as rpm
                from reg g
               where g.equipo_id = c.equipo_id
                 and (g.custodia_id = c.id
                      or (g.custodia_id is null and g.estacion_id = c.estacion_id
                          and g.fecha between public._mot_dia(c.desde) and coalesce(public._mot_dia(c.hasta), v_hasta)))) x on true
          left join rec rc on rc.custodia_id = c.id
    ),
    pm as (
        select g.equipo_id,
               count(*) filter (where g.horas > 0) as dias, coalesce(sum(g.horas), 0) as horas, coalesce(sum(g.hest), 0) as hest,
               coalesce(sum(g.gast), 0) as gast, coalesce(sum(g.sumin), 0) as sumin,
               case when sum(g.horas) filter (where g.horas > 0) > 0
                    then round(sum(g.gast) filter (where g.horas > 0) / sum(g.horas) filter (where g.horas > 0), 2) end as rend,
               case when sum(g.horas) filter (where g.rpm is not null and g.horas > 0) > 0
                    then round(sum(g.rpm * g.horas) filter (where g.rpm is not null and g.horas > 0)
                               / sum(g.horas) filter (where g.rpm is not null and g.horas > 0)) end as rpm
          from reg g group by g.equipo_id
    ),
    pe as (
        select g.estacion_id,
               count(*) filter (where g.horas > 0) as dias, coalesce(sum(g.horas), 0) as horas, coalesce(sum(g.hest), 0) as hest,
               coalesce(sum(g.gast), 0) as gast, coalesce(sum(g.sumin), 0) as sumin,
               case when sum(g.horas) filter (where g.horas > 0) > 0
                    then round(sum(g.gast) filter (where g.horas > 0) / sum(g.horas) filter (where g.horas > 0), 2) end as rend,
               case when sum(g.horas) filter (where g.rpm is not null and g.horas > 0) > 0
                    then round(sum(g.rpm * g.horas) filter (where g.rpm is not null and g.horas > 0)
                               / sum(g.horas) filter (where g.rpm is not null and g.horas > 0)) end as rpm
          from reg g group by g.estacion_id
    ),
    tot as (
        select count(*) filter (where g.horas > 0) as dias, coalesce(sum(g.horas), 0) as horas, coalesce(sum(g.hest), 0) as hest,
               coalesce(sum(g.gast), 0) as gast, coalesce(sum(g.sumin), 0) as sumin,
               case when sum(g.horas) filter (where g.horas > 0) > 0
                    then round(sum(g.gast) filter (where g.horas > 0) / sum(g.horas) filter (where g.horas > 0), 2) end as rend,
               case when sum(g.horas) filter (where g.rpm is not null and g.horas > 0) > 0
                    then round(sum(g.rpm * g.horas) filter (where g.rpm is not null and g.horas > 0)
                               / sum(g.horas) filter (where g.rpm is not null and g.horas > 0)) end as rpm
          from reg g
    )
    select jsonb_build_object(
        'temporada', jsonb_build_object('id', v_t.id, 'nombre', v_t.nombre, 'desde', v_desde, 'hasta', v_hasta, 'activa', coalesce(v_t.activa, false)),
        'total', (select jsonb_build_object('dias', t.dias, 'horas', round(t.horas, 2), 'horas_estimadas', round(t.hest, 2),
                                            'gal_gastados', round(t.gast, 2),
                                            'gal_recibidos', round(t.sumin + coalesce((select sum(r.gal) from rec r), 0), 2),
                                            'rendimiento_gal_h', t.rend, 'rpm_prom', t.rpm,
                                            'mantenimientos', coalesce((select sum(m.n) from mant m), 0)) from tot t),
        'motores', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'equipo_id', mo.equipo_id, 'codigo', e.codigo, 'nombre', e.nombre,
                       'dias', coalesce(p.dias, 0), 'horas', round(coalesce(p.horas, 0), 2), 'horas_estimadas', round(coalesce(p.hest, 0), 2),
                       'gal_gastados', round(coalesce(p.gast, 0), 2),
                       'gal_recibidos', round(coalesce(p.sumin, 0) + coalesce((select sum(r.gal) from rec r where r.equipo_id = mo.equipo_id), 0), 2),
                       'rendimiento_gal_h', p.rend, 'rpm_prom', p.rpm,
                       'mantenimientos', coalesce((select sum(m.n) from mant m where m.equipo_id = mo.equipo_id), 0),
                       'tramos', coalesce((
                           select jsonb_agg(jsonb_build_object(
                                      'id', x.id, 'estacion_id', x.estacion_id, 'estacion', er.nombre, 'zona', z.nombre,
                                      'desde', x.desde, 'hasta', x.hasta,
                                      'dias', x.dias, 'horas', round(x.horas, 2), 'horas_estimadas', round(x.hest, 2),
                                      'gal_gastados', round(x.gast, 2), 'gal_recibidos', x.recibidos,
                                      'rendimiento_gal_h', x.rend, 'rpm_prom', x.rpm) order by x.desde)
                             from tr x
                             left join public.estaciones_riego er on er.id = x.estacion_id
                             left join public.zonas z on z.id = er.zona_id
                            where x.equipo_id = mo.equipo_id), '[]'::jsonb)) order by e.codigo)
              from public.mot_motores mo
              join public.equipos e on e.id = mo.equipo_id
              left join pm p on p.equipo_id = mo.equipo_id
             where (mo.prueba_de is null or v_pru)
               and (p.equipo_id is not null or exists (select 1 from tr x where x.equipo_id = mo.equipo_id))), '[]'::jsonb),
        'estaciones', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'estacion_id', er.id, 'estacion', er.nombre, 'zona', z.nombre,
                       'dias', p.dias, 'horas', round(p.horas, 2), 'horas_estimadas', round(p.hest, 2), 'gal_gastados', round(p.gast, 2),
                       'gal_recibidos', round(p.sumin + coalesce((select sum(r.gal) from rec r where r.estacion_id = p.estacion_id), 0), 2),
                       'rendimiento_gal_h', p.rend, 'rpm_prom', p.rpm,
                       'mantenimientos', coalesce((select sum(m.n) from mant m where m.estacion_id = p.estacion_id), 0)) order by z.nombre, er.nombre)
              from pe p
              join public.estaciones_riego er on er.id = p.estacion_id
              left join public.zonas z on z.id = er.zona_id), '[]'::jsonb))
      into v_out;
    return v_out;
end $$;
revoke execute on function public.fn_mot_resumen_temporada(uuid) from public, anon;
grant  execute on function public.fn_mot_resumen_temporada(uuid) to authenticated;

notify pgrst, 'reload schema';
