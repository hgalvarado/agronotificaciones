-- =====================================================================
-- PRUEBAS de sql/136, 138, 139 y 140 (un solo archivo: comparten los datos de partida)
--   136 envíos con problemas · 138 permisos por acción de Motores · 139 bodega general + Inyección de_bodega
--   140 eliminar por completo (Inyección / Motores) + registro histórico por pantalla
-- Réplica local con 91–140 y los datos de prueba de 96/99/115 (E1, Papalon-1, QA-SOLCA, 101478, chofer 1000…0001).
-- Correr DESDE LA RAÍZ DEL REPO sobre un CLON nuevo (deja datos):
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/140_campo_136_a_140.sql
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function pg_temp.como(p uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', coalesce(p::text, ''), false) $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
    if p_cond is distinct from true then raise exception 'FALLA: %', p_msg; end if;
    raise notice 'ok  %', p_msg;
end $$;
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', now() - make_interval(days => p_dias_atras), 'enviado_en', now(),
        'inmediato', p_dias_atras = 0, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
-- ¿lanza error con ese texto?
create or replace function pg_temp.falla(p_sql text, p_txt text) returns boolean language plpgsql as $$
begin
    execute p_sql;
    return false;
exception when others then
    raise notice '   (error esperado: %)', sqlerrm;
    return sqlerrm ilike '%' || p_txt || '%';
end $$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('140a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.dia(p_atras integer) returns text language sql as $$ select (pg_temp.hoy() - p_atras)::text $$;
create or replace function pg_temp.ts(p_atras integer) returns text language sql as $$ select ((pg_temp.hoy() - p_atras)::timestamp + time '12:00')::text || '-06' $$;
create or replace function pg_temp.saldo(p_est uuid, p_mat uuid) returns numeric language sql as $$
    select coalesce((select disponible from fert_saldos where estacion_id = p_est and material_id = p_mat), 0) $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint; r2 smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T140_ADM', 'P140 Admin', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, acceso_total) values ('T140_SIN', 'P140 Sin permisos', false) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T140_ADM';
    select id into r2 from roles where codigo = 'T140_SIN';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000014001', 'adm@140') on conflict do nothing;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000014002', 'sin@140') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000014001', 'Admin 140', r, true) on conflict (id) do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000014002', 'Sin permisos 140', r2, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000014001', r) on conflict do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000014002', r2) on conflict do nothing;
    insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
    values ('QA-DIESEL-140', 'Diésel QA 140', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true) on conflict (codigo) do nothing;
    insert into temporadas (nombre, fecha_inicio, fecha_fin, activa) values ('Temp 26-27', date '2026-01-01', date '2026-12-31', false) on conflict (nombre) do nothing;
    insert into lotes (nomenclatura, nombre) values ('L140-1', 'Lote prueba 140') on conflict (nomenclatura) do nothing;
    insert into lotes_temporada (lote_id, temporada_id, area_neta)
    select l.id, t.id, 5 from lotes l, temporadas t where l.nomenclatura = 'L140-1' and t.nombre = 'Temp 26-27' on conflict (lote_id, temporada_id) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from materiales where codigo = 'QA-SOLCA') as a,
    (select id from materiales where codigo = '101478') as b,
    (select id from materiales where codigo = 'QA-DIESEL-140') as dsl,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000014001'::uuid as adm, '00000000-0000-0000-0000-000000014002'::uuid as sin,
    (select rol_id from perfiles where id = '00000000-0000-0000-0000-0000000000e1') as rol_e1;
select pg_temp.ok((select est is not null and a is not null and b is not null and rol_e1 is not null from k), 'datos de partida (Papalon-1, QA-SOLCA, 101478, rol de E1)');
-- E1 sin ningún permiso de Motores salvo ver/registrar (lo de la 138 se le da y quita aquí)
delete from permisos where rol_id = (select rol_e1 from k) and recurso = 'motores' and accion in ('motor_recibir', 'motor_mover', 'motor_retirar', 'motor_mantenimiento', 'configurar', 'eliminar_definitivo');
insert into permisos (rol_id, recurso, accion, permitido) values ((select rol_e1 from k), 'motores', 'ver', true), ((select rol_e1 from k), 'motores', 'registrar', true),
    ((select rol_e1 from k), 'inyeccion', 'ver', true), ((select rol_e1 from k), 'inyeccion', 'registrar', true)
on conflict do nothing;
update permisos set permitido = true where rol_id = (select rol_e1 from k) and recurso in ('motores', 'inyeccion') and accion in ('ver', 'registrar');

-- custodia de E1 desde hace 30 días (como en la prueba 130)
do $$
declare v_est uuid := (select est from k);
begin
    perform pg_temp.como((select adm from k));
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 140');
    end if;
    update fert_custodia set desde = now() - interval '30 days' where estacion_id = v_est;
    update fert_relevos set recibido_at = now() - interval '30 days', entregado_at = now() - interval '30 days'
    where id = (select id from fert_relevos where estacion_id = v_est and recibe_id = (select e1 from k)
                  and estado in ('RECIBIDO', 'ASIGNADO') order by recibido_at desc limit 1);
    update fert_relevos set estado = 'CANCELADO'
    where estacion_id = v_est and coalesce(recibido_at, entregado_at) > now() - interval '30 days' and estado <> 'CANCELADO';
end $$;

-- ================================================================ 138 · Motores: permisos por acción
select pg_temp.como((select adm from k));
select fn_mot_publicar(jsonb_build_object('completo', true, 'material_diesel', 'QA-DIESEL-140', 'motores',
    '[{"codigo":"T140-M1","nombre":"Motor 1 prueba 140","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300},
      {"codigo":"T140-M2","nombre":"Motor 2 prueba 140","modelo":""}]'::jsonb));
create temp table m as select (select id from equipos where codigo = 'T140-M1') as m1, (select id from equipos where codigo = 'T140-M2') as m2;
select pg_temp.ok((select acciones @> array['motor_recibir', 'motor_mover', 'motor_retirar', 'motor_mantenimiento', 'eliminar_definitivo'] from pantallas where codigo = 'motores'),
                  'la pantalla motores trae las 4 acciones nuevas y eliminar_definitivo');
select pg_temp.ok(not exists (select 1 from permisos where recurso = 'motores' and accion like 'motor\_%' and permitido and rol_id <> (select rol_e1 from k)),
                  'la 138 no concede las acciones nuevas a ningún rol');

select pg_temp.como((select e1 from k));
create temp table p1 as select pg_temp.op(pg_temp.uid(1), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque 140', 'capacidad_gal', 300)), 10) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Recibir motor%' from p1), 'sin motor_recibir: recibir motor rechazado: ' || (select r->>'mensaje' from p1));
select pg_temp.ok((select (fn_mot_estado_campo()->'permisos'->>'motor_recibir')::boolean = false), 'estado de campo: motor_recibir = false');

insert into permisos (rol_id, recurso, accion, permitido) values ((select rol_e1 from k), 'motores', 'motor_recibir', true) on conflict do nothing;
update permisos set permitido = true where rol_id = (select rol_e1 from k) and recurso = 'motores' and accion = 'motor_recibir';
create temp table p2 as select pg_temp.op(pg_temp.uid(2), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque 140', 'capacidad_gal', 300),
    'horometro', 1000, 'diesel_gal', 200, 'observacion', 'Llegó con 200 gal', 'horas_base', 0), 10) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from p2), 'con motor_recibir y SIN motivo: recibir motor aceptado: ' || (select r::text from p2));
select pg_temp.ok((select motivo = 'Recepción del motor' and horometro = 1000 and diesel_gal = 200 and observacion = 'Llegó con 200 gal'
                     from mot_asignaciones where id = pg_temp.uid(2)), 'la recepción guarda motivo automático, horómetro, diésel y observación');
create temp table tk as select tanque_id as t from mot_motores where equipo_id = (select m1 from m);
select pg_temp.ok((select disponible = 200 from mot_saldos where tanque_id = (select t from tk)), 'el diésel de la recepción queda como saldo inicial del tanque (200)');
select pg_temp.ok((select (fn_mot_estado_campo()->'permisos'->>'motor_recibir')::boolean and not (fn_mot_estado_campo()->'permisos'->>'motor_mover')::boolean
                          and jsonb_typeof(fn_mot_estado_campo()->'otras_estaciones') = 'array'),
                  'estado de campo: banderas por acción y otras_estaciones');
create temp table p3 as select pg_temp.op(pg_temp.uid(3), 'motor_mantenimiento', jsonb_build_object('equipo_id', (select m1 from m), 'fecha_hora', pg_temp.ts(9),
    'horometro', 1000, 'tipo', 'PREVENTIVO', 'nota', 'Aceite'), 9) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%mantenimiento%' from p3), 'sin motor_mantenimiento: mantenimiento rechazado');
create temp table p4 as select pg_temp.op(pg_temp.uid(4), 'motor_retiro', jsonb_build_object('equipo_id', (select m1 from m), 'fecha_hora', pg_temp.ts(9),
    'motivo_codigo', 'FIN_TEMPORADA', 'destino_saldo', 'QUEDA'), 9) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from p4), 'sin motor_retirar: retiro rechazado: ' || (select r->>'mensaje' from p4));

-- ================================================================ 136 · envíos con problemas
-- registro de un día ANTERIOR a la instalación (desde la cola): se acepta con observación
create temp table q1 as select pg_temp.op(pg_temp.uid(11), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(15),
    'fecha_hora', pg_temp.ts(15), 'horo_ini', 990, 'horo_fin', 995, 'visor_ini', 200, 'visor_fin', 195), 15) as r;
select pg_temp.ok((select r->>'estado' = 'ACEPTADO_CON_OBSERVACIONES' and r::text like '%MOTOR_NO_ASIGNADO_EN_FECHA%' from q1),
                  'motor sin asignación en esa fecha: aceptado con MOTOR_NO_ASIGNADO_EN_FECHA: ' || (select r::text from q1));
select pg_temp.ok((select estacion_id = (select est from k) and tanque_id = (select t from tk) from mot_registros where id = pg_temp.uid(11)),
                  'se asienta en la estación y el tanque actuales del motor');
-- motor que no está instalado en ninguna parte: sigue rechazado
create temp table q2 as select pg_temp.op(pg_temp.uid(12), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m2 from m), 'fecha', pg_temp.dia(5),
    'fecha_hora', pg_temp.ts(5), 'horo_ini', 1, 'horo_fin', 2, 'visor_ini', 5, 'visor_fin', 4), 5) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%no hay dónde asentar%' from q2), 'motor sin estación ni tanque: rechazado');
-- en línea, visor que sube sin recepción: rechazado (luego el administrador lo acepta)
create temp table q3 as select pg_temp.op(pg_temp.uid(13), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(3),
    'fecha_hora', pg_temp.ts(3), 'horo_ini', 1000, 'horo_fin', 1005, 'visor_ini', 150, 'visor_fin', 180)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from q3), 'en línea, visor que sube sin recepción: rechazado: ' || (select r->>'mensaje' from q3));

select pg_temp.ok((select jsonb_array_length(fn_fert_estado_envios(array[pg_temp.uid(12), pg_temp.uid(13)])) = 2), 'fn_fert_estado_envios devuelve los dos rechazos propios');
select pg_temp.ok((select (fn_fert_problema_ayuda(pg_temp.uid(12), 'No sé qué hacer')->>'ok')::boolean), 'la persona pide ayuda');
select pg_temp.ok((select revision_estado = 'AYUDA' and revision_nota = 'No sé qué hacer' from fert_operaciones where id = pg_temp.uid(12)), 'queda AYUDA con la nota');
select pg_temp.ok(pg_temp.falla($$select fn_fert_problema_resolver('140a0000-0000-4000-8000-000000000012', 'RESUELTO')$$, 'no puede resolver'),
                  'la persona NO puede marcar RESUELTO');
select pg_temp.ok(pg_temp.falla($$select fn_fert_problemas()$$, 'Eliminar por completo'), 'la persona NO ve fn_fert_problemas');
select pg_temp.ok(pg_temp.falla($$select fn_fert_problema_aceptar('140a0000-0000-4000-8000-000000000013')$$, 'Eliminar por completo'), 'la persona NO puede aceptar');

select pg_temp.como((select adm from k));
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(fn_fert_problemas('AYUDA')) x(v) where (v->>'id')::uuid = pg_temp.uid(12))), 'el administrador ve el pedido de ayuda');
select pg_temp.ok((select jsonb_array_length(fn_fert_estado_envios(array[pg_temp.uid(12)])) = 0), 'fn_fert_estado_envios solo devuelve lo propio');
create temp table ac1 as select fn_fert_problema_aceptar(pg_temp.uid(12), 'probar') as r;
select pg_temp.ok((select (r->>'ok')::boolean = false from ac1) and (select resultado = 'RECHAZADO' from fert_operaciones where id = pg_temp.uid(12)),
                  'aceptar algo que la base sigue rechazando: ok=false y el rechazo queda igual');
create temp table sq as select disponible as s from mot_saldos where tanque_id = (select t from tk);
create temp table ac2 as select fn_fert_problema_aceptar(pg_temp.uid(13), 'Se cargó diésel sin anotar') as r;
select pg_temp.ok((select (r->>'ok')::boolean from ac2), 'aceptar de todos modos: ' || (select r::text from ac2));
select pg_temp.ok((select resultado = 'ACEPTADO_CON_OBSERVACIONES' and revision_estado = 'RESUELTO' and revision_accion = 'ACEPTADO_DE_TODOS_MODOS'
                          and 'ACEPTADO_POR_ADMIN' = any(observaciones) and perfil_id = (select e1 from k)
                     from fert_operaciones where id = pg_temp.uid(13)), 'el envío queda aceptado, resuelto, con ACEPTADO_POR_ADMIN y como de la persona');
select pg_temp.ok((select registrado_por = (select e1 from k) from mot_registros where id = pg_temp.uid(13)), 'el registro diario existe y es de la persona');
select pg_temp.ok(pg_temp.falla($$select fn_fert_problema_aceptar('140a0000-0000-4000-8000-000000000013')$$, 'ya no está rechazado'), 'aceptar dos veces: error claro');
select pg_temp.como((select e1 from k));
select pg_temp.ok((select (fn_fert_problema_resolver(pg_temp.uid(12), 'DESCARTADO_POR_USUARIO', 'Lo registro de nuevo')->>'ok')::boolean), 'la persona descarta su envío');
select pg_temp.ok((select revision_estado = 'RESUELTO' and revision_accion = 'DESCARTADO_POR_USUARIO' from fert_operaciones where id = pg_temp.uid(12)), 'queda RESUELTO · DESCARTADO_POR_USUARIO');
select pg_temp.como((select adm from k));
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(fn_fert_problemas()) x(v) where (v->>'id')::uuid in (pg_temp.uid(12), pg_temp.uid(13)))),
                  'los resueltos salen de ABIERTOS');

-- ================================================================ 139 · Inyección con/sin bodega y bodega general
select fn_iny_publicar(jsonb_build_object('temporada', 'Temp 26-27', 'completo', true,
    'categorias', '[{"clave":"ferti-riego|inyeccion","departamento":"Ferti-Riego","categoria":"Inyección","tipo":"inyeccion","etiqueta":"Inyección","activo":true}]'::jsonb,
    'materiales', jsonb_build_array(jsonb_build_object('codigo', 'QA-SOLCA', 'ingrediente_activo', 'Abamectina'), jsonb_build_object('codigo', '101478')),
    'plan', '[]'::jsonb));
create or replace function pg_temp.apl(p_id uuid, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'aplicacion_lote', jsonb_build_object('estacion_id', (select est from k), 'lote', 'L140-1',
        'categoria_clave', 'ferti-riego|inyeccion', 'temporada', 'Temp 26-27', 'area_mz', 5, 'objetivos', jsonb_build_array('PLAGA'),
        'fecha_hora', now() - make_interval(days => p_dias_atras)) || p_datos, p_dias_atras)
$$;
select pg_temp.como((select e1 from k));
select pg_temp.ok((pg_temp.op(pg_temp.uid(20), 'recepcion', jsonb_build_object('estacion_id', (select est from k), 'chofer_id', '10000000-0000-0000-0000-000000000001',
        'fecha_hora', now() - interval '1 hour', 'lineas', jsonb_build_array(jsonb_build_object('material_id', (select a from k), 'cantidad', 100),
                                                                              jsonb_build_object('material_id', (select b from k), 'cantidad', 100))))->>'estado') like 'ACEPTADO%',
                  'recepción de 100 y 100');
create temp table s0 as select pg_temp.saldo((select est from k), (select a from k)) as a, pg_temp.saldo((select est from k), (select b from k)) as b;
create temp table y1 as select pg_temp.apl(pg_temp.uid(21), jsonb_build_object('lineas', jsonb_build_array(
    jsonb_build_object('material_id', (select a from k), 'cantidad', 10, 'de_bodega', true),
    jsonb_build_object('material_id', (select b from k), 'cantidad', 2)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from y1), 'inyección con una línea de bodega y otra no: ' || (select r::text from y1));
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from s0) - 10, 'de_bodega = true descuenta (−10)');
select pg_temp.ok(pg_temp.saldo((select est from k), (select b from k)) = (select b from s0), 'de_bodega ausente NO descuenta');
select pg_temp.ok((select bool_and(de_bodega = (material_id = (select a from k))) from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(21)),
                  'el detalle guarda de_bodega true / false');
create temp table y2 as select pg_temp.apl(pg_temp.uid(22), jsonb_build_object('lineas', jsonb_build_array(
    jsonb_build_object('material_id', (select b from k), 'cantidad', 3, 'de_bodega', false)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from y2) and pg_temp.saldo((select est from k), (select b from k)) = (select b from s0), 'de_bodega = false NO descuenta');

create temp table bg as select fn_fert_bodega_general() as r;
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(r->'filas') x(v) where v->>'tipo' in ('INYECCION', 'FERTILIZANTE') and (v->>'material_id')::uuid = (select a from k)
                                   and (v->>'saldo')::numeric = (select a from s0) - 10) from bg), 'bodega general: el producto con su saldo (QA-SOLCA es fert_analisis: sale FERTILIZANTE)');
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(r->'filas') x(v) where v->>'tipo' = 'DIESEL' and (v->>'clave')::uuid = (select t from tk)) from bg),
                  'bodega general: diésel del tanque del motor');
do $$ declare v jsonb := (select r from bg); begin
    raise notice 'bodega general, tipos presentes: %', (select string_agg(distinct x->>'tipo', ', ') from jsonb_array_elements(v->'filas') x);
end $$;
select pg_temp.como((select sin from k));
select pg_temp.ok(pg_temp.falla($$select fn_fert_bodega_general()$$, 'Ver'), 'bodega general sin «Ver» en Fertirriego: rechazado');

-- ================================================================ 140 · registro histórico por pantalla
select pg_temp.como((select e1 from k));
create temp table h1 as select pg_temp.apl(pg_temp.uid(31), jsonb_build_object('historica', true, 'fecha_hora', now() - interval '3 days', 'lineas', jsonb_build_array(
    jsonb_build_object('material_id', (select a from k), 'cantidad', 4, 'de_bodega', true)))) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Registro histórico%' from h1), 'inyección histórica sin permiso: rechazada');
select pg_temp.ok(pg_temp.falla($$select fn_campo_historico_otorgar('00000000-0000-0000-0000-0000000000e1', array[(select est from k)], (now() at time zone 'America/Tegucigalpa')::date + 5, 'x', 'inyeccion')$$, 'Configurar'),
                  'la persona no puede otorgarse el permiso');
select pg_temp.como((select adm from k));
select pg_temp.ok((select fn_campo_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() + 5, 'Prueba 140', 'inyeccion') >= 1), 'el administrador otorga histórico de Inyección');
select pg_temp.como((select e1 from k));
create temp table sh as select pg_temp.saldo((select est from k), (select a from k)) as a;
create temp table h2 as select pg_temp.apl(pg_temp.uid(32), jsonb_build_object('historica', true, 'fecha_hora', now() - interval '3 days', 'lineas', jsonb_build_array(
    jsonb_build_object('material_id', (select a from k), 'cantidad', 4, 'de_bodega', true)))) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%REGISTRO_HISTORICO%' from h2), 'inyección histórica con permiso: aceptada: ' || (select r::text from h2));
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from sh)
                  and not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(32)), 'el histórico de inyección NO mueve inventario');
-- motores: el permiso de Inyección no vale en Motores
create temp table sm as select disponible as s from mot_saldos where tanque_id = (select t from tk);
create temp table h3 as select pg_temp.op(pg_temp.uid(33), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(2),
    'fecha_hora', pg_temp.ts(2), 'horo_ini', 1005, 'horo_fin', 1010, 'visor_ini', 180, 'visor_fin', 170, 'historica', true)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Registro histórico%' from h3), 'motor histórico sin permiso de la pantalla motores: rechazado');
select pg_temp.como((select adm from k));
select fn_campo_historico_otorgar((select e1 from k), array[(select est from k)], pg_temp.hoy() + 5, 'Prueba 140', 'motores');
select pg_temp.como((select e1 from k));
create temp table h4 as select pg_temp.op(pg_temp.uid(34), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(2),
    'fecha_hora', pg_temp.ts(2), 'horo_ini', 1005, 'horo_fin', 1010, 'visor_ini', 180, 'visor_fin', 170, 'historica', true)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%REGISTRO_HISTORICO%' from h4), 'motor histórico con permiso: aceptado: ' || (select r::text from h4));
select pg_temp.ok((select disponible = (select s from sm) from mot_saldos where tanque_id = (select t from tk))
                  and not exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(34)), 'el histórico del motor NO mueve el diésel');
create temp table h5 as select pg_temp.op(pg_temp.uid(35), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(0),
    'fecha_hora', (now() - interval '5 minutes')::text, 'horo_ini', 1010, 'horo_fin', 1011, 'visor_ini', 170, 'visor_fin', 169, 'historica', true)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%días pasados%' from h5), 'histórico de HOY: rechazado');

-- ================================================================ 140 · eliminar por completo
select pg_temp.como((select e1 from k));
select pg_temp.ok(pg_temp.falla($$select fn_campo_eliminar_documento('iny_aplicacion', '140a0000-0000-4000-8000-000000000021', 'Se registró por error en campo')$$, 'Eliminar por completo'),
                  'sin el permiso (no administrador): rechazado');
select pg_temp.como((select adm from k));
select pg_temp.ok(pg_temp.falla($$select fn_campo_eliminar_documento('iny_aplicacion', '140a0000-0000-4000-8000-000000000021', 'corto')$$, 'mínimo 15'), 'motivo corto: rechazado');
select pg_temp.ok(pg_temp.falla($$select fn_campo_eliminar_documento('fert_aplicacion', '140a0000-0000-4000-8000-000000000021', 'Se registró por error en campo')$$, 'no se puede eliminar'),
                  'tipo no válido: rechazado');
create temp table sa as select pg_temp.saldo((select est from k), (select a from k)) as a;
create temp table el1 as select fn_campo_eliminar_documento('iny_aplicacion', pg_temp.uid(21), 'Se registró por error en campo') as r;
select pg_temp.ok((select (r->>'ok')::boolean and r->>'modulo' = 'inyeccion' from el1), 'administrador elimina la inyección: ' || (select r::text from el1));
select pg_temp.ok(pg_temp.saldo((select est from k), (select a from k)) = (select a from sa) + 10, 'el saldo de la bodega se repone (+10)');
select pg_temp.ok(not exists (select 1 from iny_aplicaciones where id = pg_temp.uid(21)) and not exists (select 1 from iny_aplicaciones_detalle where aplicacion_id = pg_temp.uid(21))
                  and not exists (select 1 from fert_movimientos where documento_id = pg_temp.uid(21)), 'documento, detalle y movimientos borrados');
select pg_temp.ok((select modulo = 'inyeccion' and tipo = 'iny_aplicacion' and eliminado_por = (select adm from k) and jsonb_array_length(snapshot->'iny_aplicaciones_detalle') = 2
                     from fert_eliminaciones where documento_id = pg_temp.uid(21)), 'auditoría con módulo, tipo, quién y la copia del detalle');
select pg_temp.ok(pg_temp.falla($$select fn_campo_eliminar_documento('iny_aplicacion', '140a0000-0000-4000-8000-000000000021', 'Se registró por error en campo')$$, 'ya fue eliminado'),
                  'eliminar dos veces: «ya fue eliminado»');
-- motores: el registro aceptado por el administrador (uid 13)
create temp table se as select disponible as s from mot_saldos where tanque_id = (select t from tk);
create temp table mv13 as select coalesce(sum(cantidad), 0) as c from mot_movimientos where documento_id = pg_temp.uid(13);
create temp table el2 as select fn_campo_eliminar_documento('mot_registro', pg_temp.uid(13), 'Registro duplicado por error') as r;
select pg_temp.ok((select (r->>'ok')::boolean and r->>'modulo' = 'motores' from el2), 'administrador elimina un registro diario: ' || (select r::text from el2));
select pg_temp.ok((select disponible = (select s from se) - (select c from mv13) from mot_saldos where tanque_id = (select t from tk))
                  and not exists (select 1 from mot_registros where id = pg_temp.uid(13)) and not exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(13)),
                  'el saldo del tanque se revierte y el registro y sus movimientos se borran');
select pg_temp.ok((select modulo = 'motores' from fert_eliminaciones where documento_id = pg_temp.uid(13)), 'auditoría del registro diario (módulo motores)');
select pg_temp.ok((select jsonb_typeof(fn_campo_eliminados_para_agl()) is not null), 'fn_campo_eliminados_para_agl responde');

\echo 'FIN 140_campo_136_a_140: todo OK'
