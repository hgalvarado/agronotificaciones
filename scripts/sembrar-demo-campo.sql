-- =====================================================================
-- DATOS DE DEMOSTRACIÓN de Campo (Inyección + Fertirriego) · SOLO BASE DE DESARROLLO
-- Estación de prueba «PRUEBA · DEMO Campo» (Zona 1), modo de pruebas (sql/98) con Henry Alvarado como participante.
-- Idempotente (UUID fijos de operación, upserts). Todo lo propio lleva el prefijo DEMO. Borrar: scripts/borrar-demo-campo.sql
-- Uso:  psql "$SUPABASE_DB_URL_DESARROLLO" -v ON_ERROR_STOP=1 -f scripts/sembrar-demo-campo.sql
-- =====================================================================
\set ON_ERROR_STOP 1
\set henry '242d3401-cbc6-47b6-8272-91ce3533f24d'
select set_config('request.jwt.claim.sub', :'henry', false);
set client_min_messages = warning;

-- estación REAL oculta «DEMO Campo» (la de prueba cuelga de ella) + modo de pruebas con Henry
insert into estaciones_riego (nombre, zona_id, activo)
select 'DEMO Campo', (select id from zonas where nombre = 'Zona 1'), false
 where not exists (select 1 from estaciones_riego where nombre = 'DEMO Campo');
select fn_fert_pruebas_activar(array[(select id from estaciones_riego where nombre = 'DEMO Campo')], array[:'henry'::uuid]) is not null as modo_pruebas;

-- productos DEMO + turno DEMO de Fertirriego (sobre la estación real; el modo de pruebas lo remapea a la de prueba)
select fn_fert_publicar(jsonb_build_object('temporada', 'Temporada 2026-2027',
  'materiales', jsonb_build_array(
     jsonb_build_object('codigo', 'DEMO-A', 'descripcion', 'DEMO ABAMECTINA', 'unidad', 'L', 'grupo', '1800'),
     jsonb_build_object('codigo', 'DEMO-B', 'descripcion', 'DEMO TRICHODERMA', 'unidad', 'KG', 'grupo', '1800'),
     jsonb_build_object('codigo', 'DEMO-C', 'descripcion', 'DEMO OXICLORURO DE COBRE', 'unidad', 'L', 'grupo', '1800'),
     jsonb_build_object('codigo', 'DEMO-D', 'descripcion', 'DEMO PRODUCTO FUERA DE PLAN', 'unidad', 'L', 'grupo', '1800'),
     jsonb_build_object('codigo', 'DEMO-E', 'descripcion', 'DEMO AZOXISTROBINA', 'unidad', 'L', 'grupo', '1800'),
     jsonb_build_object('codigo', 'DEMO-F1', 'descripcion', 'DEMO NITRATO DE CALCIO', 'unidad', 'KG', 'grupo', '1800'),
     jsonb_build_object('codigo', 'DEMO-F2', 'descripcion', 'DEMO UREA', 'unidad', 'KG', 'grupo', '1800'),
     jsonb_build_object('codigo', 'DEMO-F3', 'descripcion', 'DEMO ACIDO FOSFORICO', 'unidad', 'L', 'grupo', '1800')),
  'turnos', jsonb_build_array(jsonb_build_object('agl_id', 'TR-DEMO-1', 'turno', 'DEMO-T1', 'temporada', 'Temporada 2026-2027', 'ciclo', 'Ciclo 1',
     'fecha_siembra', (((now() at time zone 'America/Tegucigalpa')::date) - 25)::text, 'estacion', 'PRUEBA · DEMO Campo', 'zona', 'Zona 1', 'area_mz', 24, 'estado', 'Creado')),
  'plan', '[]'::jsonb)) is not null as publicado_fert;

-- custodia de Henry en la estación de prueba (desde hace 31 días para que valgan los registros de los últimos 30)
do $$
declare v_est uuid := (select id from estaciones_riego where nombre = 'PRUEBA · DEMO Campo');
begin
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = '242d3401-cbc6-47b6-8272-91ce3533f24d' and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, '242d3401-cbc6-47b6-8272-91ce3533f24d', 'DEMO');
    end if;
    update fert_custodia set desde = now() - interval '31 days' where estacion_id = v_est and estado = 'ACTIVA';
    -- la custodia «al momento» se lee de fert_relevos.recibido_at (sql/95)
    update fert_relevos set recibido_at = now() - interval '31 days' where estacion_id = v_est and estado = 'ASIGNADO' and recibe_id = '242d3401-cbc6-47b6-8272-91ce3533f24d';
end $$;

create temp table k as select
  (select id from estaciones_riego where nombre = 'PRUEBA · DEMO Campo') est,
  (select id from turnos_ciclo where agl_id = 'TR-DEMO-1') tc,
  (select id from materiales where codigo = 'DEMO-A') a, (select id from materiales where codigo = 'DEMO-B') b,
  (select id from materiales where codigo = 'DEMO-C') c, (select id from materiales where codigo = 'DEMO-D') d,
  (select id from materiales where codigo = 'DEMO-E') e, (select id from materiales where codigo = 'DEMO-F1') f1,
  (select id from materiales where codigo = 'DEMO-F2') f2, (select id from materiales where codigo = 'DEMO-F3') f3;
create function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create function pg_temp.pl(lote text, ddt int, dias int, mat text, dosis numeric) returns jsonb language sql as $$
  select jsonb_build_object('temporada','Temporada 2026-2027','ciclo','Ciclo 1','turno_agl_id','TR-DEMO-1','turno','DEMO-T1','estacion','DEMO Campo',
    'lote',lote,'categoria_clave','ferti-riego|inyeccion','ddt',ddt,'fecha_plan',(pg_temp.hoy() + dias)::text,'material',mat,'dosis_mz',dosis,'area_mz',8,'cantidad_plan',dosis*8) $$;

-- plan de Inyección: 3 lotes reales de Zona 1, 10 líneas, 4 productos (algunas vencidas, otras futuras)
select fn_iny_publicar(jsonb_build_object('temporada','Temporada 2026-2027','completo',false,
  'categorias','[{"clave":"ferti-riego|inyeccion","departamento":"Ferti-Riego","categoria":"Inyección","tipo":"inyeccion","etiqueta":"Inyección","activo":true}]'::jsonb,
  'materiales', jsonb_build_array(jsonb_build_object('codigo','DEMO-A','ingrediente_activo','Abamectina'), jsonb_build_object('codigo','DEMO-B','ingrediente_activo','Trichoderma harzianum'),
      jsonb_build_object('codigo','DEMO-C','ingrediente_activo','Oxicloruro de cobre'), jsonb_build_object('codigo','DEMO-D'), jsonb_build_object('codigo','DEMO-E','ingrediente_activo','Azoxistrobina')),
  'plan', jsonb_build_array(
    pg_temp.pl('1002-020',5,-20,'DEMO-A',2), pg_temp.pl('1002-020',10,-14,'DEMO-B',1), pg_temp.pl('1002-020',15,-8,'DEMO-C',0.5), pg_temp.pl('1002-020',25,6,'DEMO-E',2.5),
    pg_temp.pl('1002-025',5,-18,'DEMO-A',2), pg_temp.pl('1002-025',10,-12,'DEMO-B',1), pg_temp.pl('1002-025',20,-3,'DEMO-C',0.5), pg_temp.pl('1002-025',30,10,'DEMO-E',2),
    pg_temp.pl('1001-160',8,-10,'DEMO-A',2), pg_temp.pl('1001-160',12,-5,'DEMO-C',0.5)))) is not null as publicado_iny;

create function pg_temp.op(n int, tipo text, datos jsonb, dias int) returns text language sql as $$
  select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
    'id', ('d3a00000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'tipo', tipo,
    'creado_en', now() - make_interval(days => dias), 'enviado_en', now(), 'inmediato', false,
    'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', datos))))->0->>'estado' $$;
create function pg_temp.ln(m uuid, c numeric) returns jsonb language sql as $$ select jsonb_build_object('material_id',m,'cantidad',c,'de_bodega',true) $$;
create function pg_temp.f(dias int) returns text language sql as $$ select (pg_temp.hoy() - dias)::text $$;

insert into fert_choferes (id, nombre, validado) values ('d3a00000-0000-4000-8000-00000000c001', 'DEMO Chofer', true) on conflict do nothing;
-- Fertirriego: recepciones, conteos, aplicaciones, horas de riego, una anulación
select pg_temp.op(1,'recepcion', jsonb_build_object('estacion_id',(select est from k),'chofer_id','d3a00000-0000-4000-8000-00000000c001','fecha',pg_temp.f(28),
   'lineas', jsonb_build_array(pg_temp.ln((select a from k),100), pg_temp.ln((select b from k),60), pg_temp.ln((select c from k),50), pg_temp.ln((select d from k),40),
      pg_temp.ln((select e from k),80), pg_temp.ln((select f1 from k),400), pg_temp.ln((select f2 from k),300), pg_temp.ln((select f3 from k),120))), 28);
select pg_temp.op(2,'recepcion', jsonb_build_object('estacion_id',(select est from k),'chofer_id','d3a00000-0000-4000-8000-00000000c001','fecha',pg_temp.f(12),
   'lineas', jsonb_build_array(pg_temp.ln((select f1 from k),200), pg_temp.ln((select f2 from k),150), pg_temp.ln((select a from k),40))), 12);
select pg_temp.op(3,'conteo', jsonb_build_object('estacion_id',(select est from k),'fecha',pg_temp.f(20),
   'lineas', jsonb_build_array(jsonb_build_object('material_id',(select f1 from k),'cantidad_real',385))), 20);
select pg_temp.op(4,'aplicacion', jsonb_build_object('estacion_id',(select est from k),'turno_ciclo_id',(select tc from k),'fecha',pg_temp.f(18),'extra',true,
   'lineas', jsonb_build_array(pg_temp.ln((select f1 from k),40), pg_temp.ln((select f2 from k),25))), 18);
select pg_temp.op(5,'aplicacion', jsonb_build_object('estacion_id',(select est from k),'turno_ciclo_id',(select tc from k),'fecha',pg_temp.f(11),'extra',true,
   'lineas', jsonb_build_array(pg_temp.ln((select f1 from k),45), pg_temp.ln((select f3 from k),10))), 11);
select pg_temp.op(6,'aplicacion', jsonb_build_object('estacion_id',(select est from k),'turno_ciclo_id',(select tc from k),'fecha',pg_temp.f(6),'extra',true,
   'lineas', jsonb_build_array(pg_temp.ln((select f2 from k),30))), 6);
select pg_temp.op(7,'aplicacion', jsonb_build_object('estacion_id',(select est from k),'turno_ciclo_id',(select tc from k),'fecha',pg_temp.f(2),'extra',true,
   'lineas', jsonb_build_array(pg_temp.ln((select f1 from k),999))), 2);   -- registrada por error: se anula abajo
select pg_temp.op(8,'anulacion', jsonb_build_object('estacion_id',(select est from k),'documento_tipo','aplicacion',
   'documento_id','d3a00000-0000-4000-8000-000000000007','motivo','DEMO: cantidad mal digitada (999 en lugar de 99)'), 2);
select pg_temp.op(9,'conteo', jsonb_build_object('estacion_id',(select est from k),'fecha',pg_temp.f(4),
   'lineas', jsonb_build_array(jsonb_build_object('material_id',(select f2 from k),'cantidad_real',398), jsonb_build_object('material_id',(select f3 from k),'cantidad_real',108))), 4);
select pg_temp.op(10,'bitacora', jsonb_build_object('turno_ciclo_id',(select tc from k),'fecha',pg_temp.f(18),'horas_riego',6,'horas_fertilizacion',2,'ppm_cloro_cabezal','1.5','ppm_cloro_campo',0.8), 18);
select pg_temp.op(11,'bitacora', jsonb_build_object('turno_ciclo_id',(select tc from k),'fecha',pg_temp.f(11),'horas_riego',5,'horas_fertilizacion',1.5), 11);
select pg_temp.op(12,'bitacora', jsonb_build_object('turno_ciclo_id',(select tc from k),'fecha',pg_temp.f(6),'horas_riego',7,'horas_fertilizacion',2.5,'ppm_cloro_cabezal','1.2'), 6);

-- Inyección: 12 aplicaciones por lote (a tiempo, tarde, temprano, de más, de menos, sin plan)
create function pg_temp.apl(n int, lote text, m uuid, c numeric, dias int, obj text) returns text language sql as $$
  select pg_temp.op(n,'aplicacion_lote', jsonb_build_object('estacion_id',(select est from k),'lote',lote,'categoria_clave','ferti-riego|inyeccion',
    'temporada','Temporada 2026-2027','turno_agl_id','TR-DEMO-1','area_mz',8,'objetivos',jsonb_build_array(obj),'fecha_hora',now()-make_interval(days=>dias),
    'lineas', jsonb_build_array(pg_temp.ln(m,c))), dias) $$;
-- lote 1002-020  (plan: A16@-20, B8@-14, C4@-8, E20@+6)
select pg_temp.apl(101,'1002-020',(select a from k),16,20,'Plaga');     -- a tiempo
select pg_temp.apl(102,'1002-020',(select b from k),8,14,'Hongo');      -- a tiempo
select pg_temp.apl(103,'1002-020',(select c from k),4,5,'Hongo');       -- tarde (3 días)
select pg_temp.apl(104,'1002-020',(select a from k),6,16,'Plaga');      -- de más (A pasa de 16)
select pg_temp.apl(105,'1002-020',(select e from k),20,1,'Enfermedad'); -- temprano (toca en 6 días)
select pg_temp.apl(106,'1002-020',(select d from k),3,25,'Plaga');      -- sin plan
select pg_temp.apl(107,'1002-020',(select d from k),2,22,'Maleza');     -- sin plan
select pg_temp.apl(108,'1002-020',(select d from k),4,17,'Plaga');      -- sin plan
select pg_temp.apl(109,'1002-020',(select d from k),2.5,12,'Bacteria'); -- sin plan
select pg_temp.apl(110,'1002-020',(select b from k),2,9,'Hongo');       -- de más (B pasa de 8)
select pg_temp.apl(111,'1002-020',(select d from k),3,6,'Maleza');      -- sin plan
select pg_temp.apl(112,'1002-020',(select d from k),1.5,3,'Plaga');     -- sin plan
-- lote 1002-025  (plan: A16@-18, B8@-12, C4@-3, E16@+10)
select pg_temp.apl(121,'1002-025',(select a from k),10,18,'Plaga');     -- de menos
select pg_temp.apl(122,'1002-025',(select b from k),8,12,'Hongo');      -- a tiempo
select pg_temp.apl(123,'1002-025',(select c from k),4,1,'Hongo');       -- tarde (2 días)
select pg_temp.apl(124,'1002-025',(select a from k),4,15,'Plaga');      -- completa A (14 de 16, aún de menos)
select pg_temp.apl(125,'1002-025',(select e from k),16,2,'Enfermedad'); -- temprano
select pg_temp.apl(126,'1002-025',(select d from k),3,27,'Maleza');     -- sin plan
select pg_temp.apl(127,'1002-025',(select d from k),2,21,'Plaga');      -- sin plan
select pg_temp.apl(128,'1002-025',(select b from k),3,26,'Bacteria');   -- temprano (B toca en -12)
select pg_temp.apl(129,'1002-025',(select d from k),5,13,'Hongo');      -- sin plan
select pg_temp.apl(130,'1002-025',(select d from k),1,8,'Plaga');       -- sin plan
select pg_temp.apl(131,'1002-025',(select c from k),1,19,'Hongo');      -- temprano (C toca en -3)
select pg_temp.apl(132,'1002-025',(select d from k),2,4,'Maleza');      -- sin plan
-- lote 1001-160  (plan: A16@-10, C4@-5 sin aplicar = vencida)
select pg_temp.apl(141,'1001-160',(select a from k),20,10,'Plaga');     -- de más (25 %)
select pg_temp.apl(142,'1001-160',(select b from k),5,28,'Hongo');      -- sin plan
select pg_temp.apl(143,'1001-160',(select d from k),3,24,'Maleza');     -- sin plan
select pg_temp.apl(144,'1001-160',(select e from k),4,18,'Enfermedad'); -- sin plan
select pg_temp.apl(145,'1001-160',(select d from k),2,15,'Plaga');      -- sin plan
select pg_temp.apl(146,'1001-160',(select b from k),3,11,'Bacteria');   -- sin plan
select pg_temp.apl(147,'1001-160',(select d from k),1.5,9,'Maleza');    -- sin plan
select pg_temp.apl(148,'1001-160',(select e from k),2,7,'Hongo');       -- sin plan
select pg_temp.apl(149,'1001-160',(select d from k),3,5,'Plaga');       -- sin plan
select pg_temp.apl(150,'1001-160',(select b from k),2,3,'Hongo');       -- sin plan
select pg_temp.apl(151,'1001-160',(select a from k),2,2,'Plaga');       -- de más
select pg_temp.apl(152,'1001-160',(select d from k),1,1,'Maleza');      -- sin plan

select 'resultado' as k, (select count(*) from iny_aplicaciones where estacion_id = (select est from k)) as iny,
       (select count(*) from iny_plan where turno_agl_id = 'TR-DEMO-1') as plan,
       (select count(*) from fert_operaciones where id::text like 'd3a00000%') as ops,
       (select count(*) from fert_operaciones where id::text like 'd3a00000%' and coalesce(resultado::text,'') not like '%ACEPTADO%') as ops_no_aceptadas;
