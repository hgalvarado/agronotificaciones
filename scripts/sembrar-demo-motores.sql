-- =====================================================================
-- DATOS DE DEMOSTRACIÓN de Motores y combustible (sql/147) · SOLO BASE DE DESARROLLO
-- Requiere: sql/130-147 corridas y la demo de Campo (scripts/sembrar-demo-campo.sql: estación «PRUEBA · DEMO Campo», Henry en modo de pruebas).
-- Qué crea (todo con prefijo DEMO, en estaciones de PRUEBA: modo de pruebas sql/98 + sql/145):
--   Motor A  · estación «PRUEBA · DEMO Campo»   : 25 días completos (hoja FTR_F-MA-103), rendimiento normal, 2 recepciones de diésel; mantenimiento VERDE.
--   Motor B  · «PRUEBA · DEMO Motores B»        : hueco de 3 días, día con horómetro SIN avance y consumo (horas estimadas), horómetro que
--                                                 RETROCEDE, un día de consumo alto; mantenimiento AMARILLO; tanque BAJO.
--   Motor C  · «PRUEBA · DEMO Motores C»        : recién instalado, 3 días; mantenimiento VENCIDO (rojo).
--   Motor D  · «PRUEBA · DEMO Motores D» → MOVIDO a «PRUEBA · DEMO Campo» a mitad: dos tramos de custodia (el tanque se queda en D).
-- Por qué 4 estaciones: el modo de pruebas da UN motor de práctica por estación de prueba (sql/145) y un motor real no puede entrar a una de prueba.
-- Idempotente (UUID deterministas por motor y día; upserts). Borrar: scripts/borrar-demo-motores.sql
-- Uso:  psql "$SUPABASE_DB_URL_DESARROLLO" -v ON_ERROR_STOP=1 -f scripts/sembrar-demo-motores.sql
-- =====================================================================
\set ON_ERROR_STOP 1
\set henry '242d3401-cbc6-47b6-8272-91ce3533f24d'
select set_config('request.jwt.claim.sub', :'henry', false);
set client_min_messages = warning;

-- producto diésel del catálogo (si AGL aún no lo publicó en desarrollo) + configuración
insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
select 'DEMO-DIESEL', 'DEMO DIESEL', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true
 where not exists (select 1 from materiales where codigo = 'DEMO-DIESEL') and not exists (select 1 from mot_bajada_config where material_diesel_id is not null);
select fn_mot_publicar(jsonb_build_object('completo', false, 'material_diesel', 'DEMO-DIESEL', 'motores', '[]'::jsonb)) is not null as diesel_configurado
 where exists (select 1 from materiales where codigo = 'DEMO-DIESEL') and not exists (select 1 from mot_bajada_config where material_diesel_id is not null);

-- estaciones reales ocultas B, C y D (las de prueba cuelgan de ellas) + modo de pruebas con Henry (agrega los motores de práctica)
insert into estaciones_riego (nombre, zona_id, activo)
select n, (select id from zonas where nombre = 'Zona 1'), false
  from unnest(array['DEMO Motores B', 'DEMO Motores C', 'DEMO Motores D']) n
 where not exists (select 1 from estaciones_riego where nombre = n);
select fn_fert_pruebas_activar(array(select id from estaciones_riego where nombre in ('DEMO Campo', 'DEMO Motores B', 'DEMO Motores C', 'DEMO Motores D')),
                               array[:'henry'::uuid]) is not null as modo_pruebas;

-- custodia de Henry en las 4 estaciones de prueba desde hace 40 días (la custodia «al momento» se lee de fert_relevos.recibido_at, sql/95)
do $$
declare v_est uuid;
begin
    for v_est in select id from estaciones_riego where prueba_de is not null and nombre in
                 ('PRUEBA · DEMO Campo', 'PRUEBA · DEMO Motores B', 'PRUEBA · DEMO Motores C', 'PRUEBA · DEMO Motores D') loop
        if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = '242d3401-cbc6-47b6-8272-91ce3533f24d' and estado = 'ACTIVA') then
            perform fn_fert_asignar_custodia(v_est, '242d3401-cbc6-47b6-8272-91ce3533f24d', 'DEMO');
        end if;
        update fert_custodia set desde = least(desde, now() - interval '40 days') where estacion_id = v_est and estado = 'ACTIVA';
        update fert_relevos set recibido_at = least(recibido_at, now() - interval '40 days')
         where estacion_id = v_est and estado = 'ASIGNADO' and recibe_id = '242d3401-cbc6-47b6-8272-91ce3533f24d';
    end loop;
end $$;

insert into fert_choferes (id, nombre, validado) values ('d3b00000-0000-4000-8000-00000000c001', 'DEMO Chofer Diésel', true) on conflict do nothing;

-- los 4 motores de práctica (uno por estación de prueba), con nombre DEMO
create temp table k as select
  (select id from estaciones_riego where nombre = 'PRUEBA · DEMO Campo') ea,
  (select id from estaciones_riego where nombre = 'PRUEBA · DEMO Motores B') eb,
  (select id from estaciones_riego where nombre = 'PRUEBA · DEMO Motores C') ec,
  (select id from estaciones_riego where nombre = 'PRUEBA · DEMO Motores D') ed;
create temp table mm as select
  (select m.equipo_id from mot_motores m where m.prueba_de = (select ea from k)) ma,
  (select m.equipo_id from mot_motores m where m.prueba_de = (select eb from k)) mb,
  (select m.equipo_id from mot_motores m where m.prueba_de = (select ec from k)) mc,
  (select m.equipo_id from mot_motores m where m.prueba_de = (select ed from k)) md;
update equipos set nombre = 'DEMO Motor A · 25 días completos' where id = (select ma from mm);
update equipos set nombre = 'DEMO Motor B · huecos, señales, tanque bajo' where id = (select mb from mm);
update equipos set nombre = 'DEMO Motor C · recién instalado, mantenimiento vencido' where id = (select mc from mm);
update equipos set nombre = 'DEMO Motor D · movido de estación' where id = (select md from mm);
update mot_motores set modelo = 'DEMO M6068', intervalo_horas = 500, aviso_horas = 50 where equipo_id in (select ma from mm union select mb from mm union select mc from mm union select md from mm);

create function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create function pg_temp.ts(p_atras int, p_hora time) returns text language sql as $$ select ((pg_temp.hoy() - p_atras)::timestamp + p_hora)::text || '-06' $$;
create function pg_temp.uid(p_clave text) returns uuid language sql as $$ select md5('demo-motores-' || p_clave)::uuid $$;
create function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_dias int) returns void language plpgsql as $$
declare r jsonb;
begin
    r := (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', now() - make_interval(days => p_dias), 'enviado_en', now(), 'inmediato', false,
        'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0;
    if r->>'estado' not like 'ACEPTADO%' and not (r->>'estado' = 'YA_EXISTIA' and r->>'resultado' like 'ACEPTADO%') then
        raise exception 'DEMO: % rechazado: %', p_tipo, r::text;
    end if;
end $$;

-- recibir el motor en un tanque nuevo (DEMO) de la estación de prueba
create function pg_temp.instalar(p_clave text, p_tipo text, p_eq uuid, p_est uuid, p_dias int, p_hora time, p_nombre_tanque text, p_cap numeric,
                                 p_horo numeric, p_diesel numeric, p_base numeric) returns void language plpgsql as $$
begin
    perform pg_temp.op(pg_temp.uid(p_clave), 'motor_asignar', jsonb_build_object('equipo_id', p_eq, 'tipo', p_tipo,
        'fecha_hora', pg_temp.ts(p_dias, p_hora), 'estacion_destino', p_est,
        'tanque_nuevo', jsonb_build_object('nombre', p_nombre_tanque, 'capacidad_gal', p_cap),
        'horometro', p_horo, 'diesel_gal', p_diesel, 'horas_base', p_base, 'motivo_codigo', case when p_tipo = 'TRASLADADO' then 'CAMBIO_ESTACION' end), p_dias);
end $$;

-- diésel recibido en un tanque (por nombre)
create function pg_temp.recibir(p_clave text, p_tanque text, p_gal numeric, p_dias int) returns void language sql as $$
    select pg_temp.op(pg_temp.uid(p_clave), 'diesel_recibir', jsonb_build_object('tanque_id', (select id from mot_tanques where nombre = p_tanque),
        'galones', p_gal, 'fecha_hora', pg_temp.ts(p_dias, time '06:00'), 'chofer_id', 'd3b00000-0000-4000-8000-00000000c001',
        'comentario', 'DEMO: pipa de diésel'), p_dias) $$;

/** Registros diarios de la hoja FTR_F-MA-103, del día p_desde al p_hasta (días atrás, en orden). p_rec = {"dia": galones recibidos ese día}.
    p_esp = {"dia": "salta" | "sinavance" | "retro" | "alto"}. Devuelve {horo, visor} finales. */
create function pg_temp.dias(p_clave text, p_eq uuid, p_tanque text, p_desde int, p_hasta int, p_horo numeric, p_visor numeric,
                             p_rec jsonb, p_esp jsonb, p_oper text) returns jsonb language plpgsql as $$
declare
    d int; h numeric; r numeric; g numeric; hi numeric; vi numeric; v_horo numeric := p_horo; v_visor numeric := p_visor;
    v_rec numeric; v_esp text;
begin
    for d in reverse p_desde .. p_hasta loop
        v_esp := p_esp->>(d::text);
        continue when v_esp = 'salta';
        v_rec := coalesce((p_rec->>(d::text))::numeric, 0);
        if v_rec > 0 then
            perform pg_temp.recibir(p_clave || '-rec-' || d, p_tanque, v_rec, d);
            v_visor := v_visor + v_rec;
        end if;
        h := 7 + ((d * 7) % 3);
        r := 2.0 + 0.1 * (((d * 5) % 5) - 2);
        g := round(h * r, 1);
        hi := v_horo;
        if v_esp = 'sinavance' then h := 0; g := 15; end if;
        if v_esp = 'retro' then hi := v_horo - 3; end if;
        if v_esp = 'alto' then g := round(h * 4.2, 1); end if;
        vi := v_visor;
        perform pg_temp.op(pg_temp.uid(p_clave || '-reg-' || d), 'motor_registro_diario', jsonb_strip_nulls(jsonb_build_object(
            'equipo_id', p_eq, 'fecha', (pg_temp.hoy() - d)::text, 'fecha_hora', pg_temp.ts(d, time '12:00'),
            'horo_ini', hi, 'horo_fin', hi + h, 'visor_ini', vi, 'visor_fin', vi - g,
            'rpm', 1450 + ((d * 13) % 5) * 10, 'caudal_ini', 420 + (d % 4) * 5, 'caudal_fin', 425 + (d % 3) * 5,
            'operador', p_oper, 'suministro_gal', case when v_rec > 0 then v_rec end,
            'comentario', case v_esp when 'sinavance' then 'DEMO: el horómetro no marcó; se anotó el consumo del visor'
                                     when 'alto' then 'DEMO: se regó con la bomba a máxima carga' end)), d);
        v_horo := hi + h;
        v_visor := vi - g;
    end loop;
    return jsonb_build_object('horo', v_horo, 'visor', v_visor);
end $$;

-- ---------------------------------------------------------------- Motor A · estación DEMO Campo · 25 días completos
select pg_temp.instalar('a-inst', 'INSTALADO', (select ma from mm), (select ea from k), 27, time '08:00', 'DEMO Tanque A', 600, 1200, 300, 150);
select pg_temp.dias('a', (select ma from mm), 'DEMO Tanque A', 25, 1, 1200, 300, '{"18": 250, "8": 250}', '{}', 'DEMO Luis Pérez') as motor_a;

-- ---------------------------------------------------------------- Motor B · hueco 12-10, sin avance día 6, retroceso día 3, consumo alto día 8; tanque bajo
select pg_temp.instalar('b-inst', 'INSTALADO', (select mb from mm), (select eb from k), 22, time '08:00', 'DEMO Tanque B', 500, 3400, 160, 345);
select pg_temp.dias('b', (select mb from mm), 'DEMO Tanque B', 20, 1, 3400, 160, '{"15": 150}', '{"12": "salta", "11": "salta", "10": "salta", "8": "alto", "6": "sinavance", "3": "retro"}', 'DEMO Marta Flores') as motor_b;

-- ---------------------------------------------------------------- Motor C · recién instalado, 3 días, mantenimiento vencido
select pg_temp.instalar('c-inst', 'INSTALADO', (select mc from mm), (select ec from k), 4, time '08:00', 'DEMO Tanque C', 300, 800, 120, 495);
select pg_temp.dias('c', (select mc from mm), 'DEMO Tanque C', 3, 1, 800, 120, '{}', '{}', 'DEMO Luis Pérez') as motor_c;

-- ---------------------------------------------------------------- Motor D · 13 días en D y luego MOVIDO a DEMO Campo (el tanque se queda en D)
select pg_temp.instalar('d-inst', 'INSTALADO', (select md from mm), (select ed from k), 27, time '08:00', 'DEMO Tanque D', 400, 2000, 200, 100);
create temp table fd as select pg_temp.dias('d1', (select md from mm), 'DEMO Tanque D', 25, 13, 2000, 200, '{"20": 150}', '{}', 'DEMO Marta Flores') as r;
select pg_temp.op(pg_temp.uid('d-mover'), 'motor_asignar', jsonb_build_object('equipo_id', (select md from mm), 'tipo', 'TRASLADADO',
    'fecha_hora', pg_temp.ts(12, time '07:00'), 'estacion_destino', (select ea from k),
    'tanque_nuevo', jsonb_build_object('nombre', 'DEMO Tanque A2', 'capacidad_gal', 400),
    'horometro', (select (r->>'horo')::numeric from fd), 'diesel_gal', 250, 'motivo_codigo', 'CAMBIO_ESTACION'), 12);
select pg_temp.dias('d2', (select md from mm), 'DEMO Tanque A2', 11, 1, (select (r->>'horo')::numeric from fd), 250, '{}', '{}', 'DEMO Luis Pérez') as motor_d;

select 'resumen' as k,
       (select count(*) from mot_registros where equipo_id in (select ma from mm union select mb from mm union select mc from mm union select md from mm) and anulado_at is null) as registros,
       (select count(*) from mot_recepciones where tanque_id in (select id from mot_tanques where nombre like 'DEMO Tanque%')) as recepciones,
       (select count(*) from mot_custodias where equipo_id in (select ma from mm union select mb from mm union select mc from mm union select md from mm)) as tramos;
