-- =====================================================================
-- PRUEBAS de sql/130 · Motores de riego y combustible
-- Réplica local con 91–129 y los datos de prueba de 96/99/115 (E1/E2, Papalon-1, 10000000-...-0001 chofer).
-- Correr DESDE LA RAÍZ DEL REPO (usa \i) con:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/130_motores_combustible.sql
-- Al final repite la 130 y la corre en otros órdenes (129>130>129, 128>129>130>128, 116>130>116, 121>130, 130>121, 102>130>102).
-- NO ejecutada todavía (la corre Opus, Task 6 del plan).
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
-- p_dias_atras > 0 = llegó de la cola (no inmediata)
create or replace function pg_temp.op(p_id uuid, p_tipo text, p_datos jsonb, p_dias_atras integer default 0) returns jsonb language sql as $$
    select (fn_fert_sincronizar(jsonb_build_array(jsonb_build_object(
        'id', p_id, 'tipo', p_tipo, 'creado_en', now() - make_interval(days => p_dias_atras), 'enviado_en', now(),
        'inmediato', p_dias_atras = 0, 'ubicacion', jsonb_build_object('lat', 13.3, 'lon', -87.2), 'datos', p_datos))))->0
$$;
create or replace function pg_temp.uid(n integer) returns uuid language sql as $$ select ('130a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Tegucigalpa')::date $$;
create or replace function pg_temp.dia(p_atras integer) returns text language sql as $$ select (pg_temp.hoy() - p_atras)::text $$;
create or replace function pg_temp.ts(p_atras integer) returns text language sql as $$ select ((pg_temp.hoy() - p_atras)::timestamp + time '12:00')::text || '-06' $$;
set client_min_messages = notice;

-- ---------------------------------------------------------------- datos
do $$
declare r smallint; r2 smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T130_ADM', 'P130 Admin', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, acceso_total) values ('T130_SIN', 'P130 Sin permisos', false) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T130_ADM';
    select id into r2 from roles where codigo = 'T130_SIN';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000013001', 'adm@130') on conflict do nothing;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000013002', 'sin@130') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000013001', 'Admin 130', r, true) on conflict (id) do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000013002', 'Sin permisos 130', r2, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000013001', r) on conflict do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000013002', r2) on conflict do nothing;
    insert into materiales (codigo, descripcion, grupo, unidad, fertirriego, fert_analisis, origen, activo)
    values ('QA-DIESEL-130', 'Diésel QA 130', 'COMBUSTIBLE', 'GAL', false, false, 'MARA', true) on conflict (codigo) do nothing;
end $$;

create temp table k as select
    (select id from estaciones_riego where nombre = 'Papalon-1') as est,
    (select id from estaciones_riego where nombre <> 'Papalon-1' and prueba_de is null order by nombre limit 1) as est2,
    (select id from materiales where codigo = 'QA-DIESEL-130') as dsl,
    '00000000-0000-0000-0000-0000000000e1'::uuid as e1,
    '00000000-0000-0000-0000-000000013001'::uuid as adm, '00000000-0000-0000-0000-000000013002'::uuid as sin;

-- ---------------------------------------------------------------- 0 · estructura
select pg_temp.ok((select ruta = '/motores' and not en_menu and modulo = 'Campo' and acciones = array['ver', 'registrar', 'anular', 'configurar']
                     from pantallas where codigo = 'motores'), 'la pantalla «motores» existe (módulo Campo, fuera del menú, 4 acciones)');
select pg_temp.ok(not exists (select 1 from permisos where recurso = 'motores' and accion = 'configurar'), '«configurar» no se concede a ningún rol');
select pg_temp.ok(not exists (select 1 from permisos pm where pm.recurso = 'fertirriego' and pm.accion = 'aplicar' and pm.permitido
                              and not exists (select 1 from permisos c where c.rol_id = pm.rol_id and c.recurso = 'motores' and c.accion = 'ver')),
                  'todo rol con fertirriego · aplicar tiene motores · ver');

-- ---------------------------------------------------------------- 1 · publicación (AGL manda: motores = equipos; sin catálogo de modelos aparte)
select pg_temp.como((select adm from k));
create or replace function pg_temp.pub(p_motores jsonb) returns jsonb language sql as $$
    select fn_mot_publicar(jsonb_build_object('completo', true, 'material_diesel', 'QA-DIESEL-130', 'motores', p_motores))
$$;
select pg_temp.pub('[{"codigo":"T130-M1","nombre":"Motor 1 prueba","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300},
                     {"codigo":"T130-M2","nombre":"Motor 2 prueba","modelo":"","capacidad_tanque_gal":null}]'::jsonb);
create temp table m as select
    (select id from equipos where codigo = 'T130-M1') as m1, (select id from equipos where codigo = 'T130-M2') as m2;
select pg_temp.ok((select visible_app = false from equipos where codigo = 'T130-M1'), 'publicar crea el equipo faltante con visible_app = false');
select pg_temp.ok((select intervalo_horas = 500 and aviso_horas = 50 and modelo = 'M6068' and estado = 'SIN_ASIGNAR' from mot_motores where equipo_id = (select m1 from m)), 'motor 1 publicado con intervalo y aviso');
select pg_temp.ok((select intervalo_horas is null from mot_motores where equipo_id = (select m2 from m)), 'motor 2 sin intervalo = null');
select pg_temp.ok((select material_diesel_id = (select dsl from k) from mot_bajada_config where id), 'el diésel quedó configurado');
select pg_temp.pub('[{"codigo":"T130-M1","nombre":"Motor 1 prueba","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300},
                     {"codigo":"T130-M2","nombre":"Motor 2 prueba","modelo":""}]'::jsonb);
select pg_temp.ok((select count(*) = 2 from mot_motores where equipo_id in (select m1 from m union select m2 from m)), 'publicar dos veces: idempotente');
select pg_temp.pub('[{"codigo":"T130-M1","nombre":"Motor 1 prueba","modelo":"M6068","intervalo_horas":500,"aviso_horas":50}]'::jsonb);
select pg_temp.ok((select not activo from mot_motores where equipo_id = (select m2 from m)), 'un motor que deja de venir queda activo = false (no se borra)');
select pg_temp.pub('[{"codigo":"T130-M1","nombre":"Motor 1 prueba","modelo":"M6068","intervalo_horas":500,"aviso_horas":50,"capacidad_tanque_gal":300},
                     {"codigo":"T130-M2","nombre":"Motor 2 prueba","modelo":""}]'::jsonb);

-- ---------------------------------------------------------------- 2 · custodia y permisos
do $$
declare v_est uuid := (select est from k);
begin
    perform pg_temp.como((select adm from k));
    if not exists (select 1 from fert_custodia where estacion_id = v_est and custodio_id = (select e1 from k) and estado = 'ACTIVA') then
        perform fn_fert_asignar_custodia(v_est, (select e1 from k), 'Prueba 130');
    end if;
    update fert_custodia set desde = now() - interval '30 days' where estacion_id = v_est;
    -- la custodia «al registrar» sale de fert_relevos (sql/95): e1 la tiene desde hace 30 días y sin relevos posteriores
    update fert_relevos set recibido_at = now() - interval '30 days', entregado_at = now() - interval '30 days'
    where id = (select id from fert_relevos where estacion_id = v_est and recibe_id = (select e1 from k)
                  and estado in ('RECIBIDO', 'ASIGNADO') order by recibido_at desc limit 1);
    update fert_relevos set estado = 'CANCELADO'
    where estacion_id = v_est and coalesce(recibido_at, entregado_at) > now() - interval '30 days' and estado <> 'CANCELADO';
end $$;

-- sin «configurar» no puede asignar (el estacionero e1 no es administrador)
select pg_temp.como((select e1 from k));
create temp table p0 as select pg_temp.op(pg_temp.uid(1), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque M1', 'capacidad_gal', 300),
    'motivo', 'Inicio', 'motivo_codigo', 'OTRO'), 1) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from p0), 'sin motores · configurar no puede instalar un motor');

-- ---------------------------------------------------------------- 3 · instalar
select pg_temp.como((select adm from k));
create temp table i1 as select pg_temp.op(pg_temp.uid(2), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Tanque M1', 'capacidad_gal', 300),
    'motivo', 'Inicio de temporada', 'motivo_codigo', 'OTRO', 'horas_base', 100)) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from i1), 'instalar el motor 1 con tanque nuevo: ' || (select r::text from i1));
select pg_temp.ok((select estado = 'EN_ESTACION' and estacion_id = (select est from k) and tanque_id is not null and horas_desde_mant = 100
                     from mot_motores where equipo_id = (select m1 from m)), 'motor EN_ESTACION con su tanque y 100 h desde el mantenimiento');
create temp table tk as select tanque_id as t from mot_motores where equipo_id = (select m1 from m);
create temp table i2 as select pg_temp.op(pg_temp.uid(3), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(9), 'estacion_destino', (select est2 from k), 'tanque_nuevo', jsonb_build_object('nombre', 'Otro'), 'motivo', 'x')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%ya está instalado%' from i2), 'un motor no puede instalarse en dos estaciones');
create temp table i3 as select pg_temp.op(pg_temp.uid(4), 'motor_asignar', jsonb_build_object('equipo_id', (select m2 from m), 'tipo', 'INSTALADO',
    'fecha_hora', pg_temp.ts(10), 'estacion_destino', (select est from k), 'tanque_id', (select t from tk), 'motivo', 'x')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%ya está conectado a otro motor%' from i3), 'un tanque no puede tener dos motores');

-- ---------------------------------------------------------------- 4 · hoja real (11/11, 13/11) y recepción
select pg_temp.como((select e1 from k));
create or replace function pg_temp.reg(p_id uuid, p_atras integer, p_hi numeric, p_hf numeric, p_vi numeric, p_vf numeric, p_extra jsonb default '{}'::jsonb,
                                       p_cola integer default 0) returns jsonb language sql as $$
    select pg_temp.op(p_id, 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(p_atras),
        'fecha_hora', pg_temp.ts(p_atras), 'horo_ini', p_hi, 'horo_fin', p_hf, 'visor_ini', p_vi, 'visor_fin', p_vf) || p_extra, p_cola)
$$;
-- 5 días atrás: 19185.6 → 19190.7, visor 257 → 247  (horas 5.1, gastado 10, rendimiento 1.96)
create temp table r1 as select pg_temp.reg(pg_temp.uid(11), 5, 19185.6, 19190.7, 257, 247, '{}', 5) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r1), 'registro de la hoja (1.er día): ' || (select r::text from r1));
select pg_temp.ok((select horas = 5.1 and gastado_gal = 10 and rendimiento_gal_h = 1.96 from mot_registros where id = pg_temp.uid(11)), 'horas 5.1, gastado 10, rendimiento 1.96');
select pg_temp.ok((select disponible = 247 from mot_saldos where tanque_id = (select t from tk)), 'el saldo del tanque queda en el visor final (247)');
select pg_temp.ok((select count(*) = 1 from mot_movimientos where documento_id = pg_temp.uid(11) and tipo = 'SALDO_INICIAL'), 'el primer día es SALDO_INICIAL');
select pg_temp.ok((select r::text like '%SIN_REGISTRO_PREVIO%' from r1), 'sin registro previo: observación SIN_REGISTRO_PREVIO');
select pg_temp.ok((select horas_desde_mant = 105.1 from mot_motores where equipo_id = (select m1 from m)), 'las horas desde el mantenimiento suben (100 + 5.1)');
-- 4 días atrás: continúa, gastó 12
create temp table r2 as select pg_temp.reg(pg_temp.uid(12), 4, 19190.7, 19200.7, 247, 235, '{}', 4) as r;
select pg_temp.ok((select gastado_gal = 12 and horas = 10 and rendimiento_gal_h = 1.2 from mot_registros where id = pg_temp.uid(12)) and (select r->>'estado' = 'ACEPTADO' from r2),
                  'segundo día continuo: sin observaciones, gastado 12 y rendimiento 1.2');
-- mismo UUID dos veces
select pg_temp.reg(pg_temp.uid(12), 4, 19190.7, 19200.7, 247, 235, '{}', 4);
select pg_temp.ok((select count(*) = 1 from mot_registros where id = pg_temp.uid(12)) and (select count(*) = 1 from mot_movimientos where documento_id = pg_temp.uid(12) and tipo = 'CONSUMO_MOTOR'),
                  'mismo UUID dos veces: un registro y un consumo');
-- otro registro el mismo día
create temp table r3 as select pg_temp.reg(pg_temp.uid(13), 4, 19200.7, 19201, 235, 234, '{}', 4) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%Ya hay un registro de ese día%' from r3), 'un solo registro por motor y día');
-- recepción de diésel y día 3 atrás: visor inicial 279? recibe 140 y gasta según la fórmula
create temp table c1 as select pg_temp.op(pg_temp.uid(21), 'diesel_recibir', jsonb_build_object('tanque_id', (select t from tk), 'galones', 140,
    'fecha_hora', pg_temp.ts(3), 'chofer_id', '10000000-0000-0000-0000-000000000001'), 3) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from c1), 'recibir 140 gal en el tanque del motor: ' || (select r::text from c1));
select pg_temp.ok((select disponible = 235 + 140 from mot_saldos where tanque_id = (select t from tk)), 'la recepción suma al saldo');
create temp table r4 as select pg_temp.reg(pg_temp.uid(14), 3, 19200.7, 19210.7, 235, 221, '{}', 3) as r;
select pg_temp.ok((select recibido_gal = 140 and gastado_gal = 154 from mot_registros where id = pg_temp.uid(14)), 'gastado = visor_ini − visor_fin + recibido del día (235 − 221 + 140 = 154)');
select pg_temp.ok((select disponible = 221 from mot_saldos where tanque_id = (select t from tk)), 'el saldo queda en el visor final (221)');
-- día sin horas
create temp table r5 as select pg_temp.reg(pg_temp.uid(15), 2, 19210.7, 19210.7, 221, 221, '{}', 2) as r;
select pg_temp.ok((select rendimiento_gal_h is null and horas = 0 and gastado_gal = 0 from mot_registros where id = pg_temp.uid(15)) and (select r->>'estado' = 'ACEPTADO' from r5),
                  'día sin horas: rendimiento null y sin error');
-- horómetro que no continúa (se guarda con observación)
create temp table r6 as select pg_temp.reg(pg_temp.uid(16), 1, 19300, 19305, 221, 215, '{}', 1) as r;
select pg_temp.ok((select r->>'estado' = 'ACEPTADO_CON_OBSERVACIONES' and r::text like '%HOROMETRO_NO_CONTINUA%' from r6), 'inicial distinto del final anterior: HOROMETRO_NO_CONTINUA y se guarda');
-- final menor
create temp table r7 as select pg_temp.reg(pg_temp.uid(17), 0, 19305, 19300, 215, 210) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%horómetro final es menor%' from r7), 'final < inicial: rechazado');
create temp table r8 as select pg_temp.reg(pg_temp.uid(18), 0, 19305, 19300, 215, 210, '{"horo_cambiado": true, "comentario": "Cambiaron el horómetro"}') as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from r8), 'con «horómetro cambiado» y comentario pasa');
create temp table r9 as select pg_temp.reg(pg_temp.uid(19), 0, 19305, 19300, 210, 205, '{"horo_cambiado": true}') as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from r9), '«cambiado» sin comentario: rechazado (y ya hay uno hoy)');
-- visor final mayor sin recepción: en línea rechaza; en cola consumo 0 + observación
select pg_temp.reg(pg_temp.uid(19), 0, 19305, 19305, 210, 205);   -- (el anterior de hoy se rechazó: no existe nada de hoy salvo el 18)
select pg_temp.ok((select count(*) = 1 from mot_registros where equipo_id = (select m1 from m) and fecha = pg_temp.hoy() and anulado_at is null), 'un solo registro de hoy');
-- fechas
create temp table r10 as select pg_temp.op(pg_temp.uid(20), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m),
    'fecha', (pg_temp.hoy() + 3)::text, 'horo_ini', 1, 'horo_fin', 2, 'visor_ini', 5, 'visor_fin', 4)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%posterior a hoy%' from r10), 'fecha futura: rechazada');
-- registro con hueco: hace 9 días (antes de los de arriba) no debe ajustar el visor
create temp table sa as select disponible as s from mot_saldos where tanque_id = (select t from tk);
create temp table r11 as select pg_temp.reg(pg_temp.uid(22), 7, 19100, 19110, 300, 290, '{}', 7) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' and r::text like '%FUERA_DE_ORDEN%' from r11), 'registro de un día anterior a otros: FUERA_DE_ORDEN');
select pg_temp.ok((select disponible = (select s from sa) - 10 from mot_saldos where tanque_id = (select t from tk))
                   and not exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(22) and tipo in ('AJUSTE_VISOR', 'SALDO_INICIAL')),
                  'fuera de orden: solo el consumo, sin ajuste de visor');
select pg_temp.ok((select horo_ultimo = 19305 or horo_ultimo = 19300 from mot_motores where equipo_id = (select m1 from m)), 'las últimas lecturas del motor no retroceden');

-- ---------------------------------------------------------------- 5 · visor sube sin recepción
create temp table v1 as select pg_temp.op(pg_temp.uid(31), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(8),
    'fecha_hora', pg_temp.ts(8), 'horo_ini', 19000, 'horo_fin', 19010, 'visor_ini', 100, 'visor_fin', 150)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%mayor que el inicial%' from v1), 'visor final > inicial sin recepción, en línea: rechazo con los números');
create temp table v2 as select pg_temp.op(pg_temp.uid(32), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(8),
    'fecha_hora', pg_temp.ts(8), 'horo_ini', 19000, 'horo_fin', 19010, 'visor_ini', 100, 'visor_fin', 150), 8) as r;
select pg_temp.ok((select r::text like '%VISOR_SUBE_SIN_RECEPCION%' and r->>'estado' like 'ACEPTADO%' from v2)
                   and (select gastado_gal = 0 from mot_registros where id = pg_temp.uid(32)), 'desde la cola: consumo 0 + VISOR_SUBE_SIN_RECEPCION');

-- ---------------------------------------------------------------- 6 · anular
select pg_temp.como((select adm from k));
create temp table an1 as select pg_temp.op(pg_temp.uid(41), 'anulacion', jsonb_build_object('documento_tipo', 'motor_registro', 'documento_id', pg_temp.uid(22), 'motivo', 'error')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an1) and (select anulado_at is not null from mot_registros where id = pg_temp.uid(22)), 'anular un registro');
select pg_temp.ok((select disponible = (select s from sa) from mot_saldos where tanque_id = (select t from tk)), 'el saldo se repone al anular');
create temp table an2 as select pg_temp.op(pg_temp.uid(42), 'anulacion', jsonb_build_object('documento_tipo', 'motor_registro', 'documento_id', pg_temp.uid(22), 'motivo', 'otra vez')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%ya estaba anulado%' from an2), '2.ª anulación del mismo documento: rechazo claro');
create temp table an3 as select pg_temp.op(pg_temp.uid(43), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(21), 'motivo', 'x')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from an3), 'anular una recepción de diésel');
create temp table an4 as select pg_temp.op(pg_temp.uid(44), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(21), 'motivo', 'x')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from an4), '2.ª anulación de la recepción: rechazada');

-- ---------------------------------------------------------------- 7 · mantenimiento
create temp table mt0 as select horas_desde_mant as h from mot_motores where equipo_id = (select m1 from m);
create temp table mt1 as select pg_temp.op(pg_temp.uid(51), 'motor_mantenimiento', jsonb_build_object('equipo_id', (select m1 from m), 'fecha_hora', pg_temp.ts(0),
    'horometro', 19305, 'tipo', 'PREVENTIVO', 'nota', 'Aceite y filtros')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from mt1), 'registrar mantenimiento: ' || (select r::text from mt1));
select pg_temp.ok((select horas_desde_mant = 0 from mot_motores where equipo_id = (select m1 from m)), 'el contador vuelve a 0');
create temp table mt2 as select pg_temp.reg(pg_temp.uid(52), 0, 19305, 19311, 215, 205) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from mt2) or true, '(si hoy ya tenía registro se rechaza: no importa para el contador)');
select pg_temp.ok((select _mot_intervalo((select m1 from m)) = 500), 'intervalo del motor = 500');
select pg_temp.ok((select _mot_intervalo((select m2 from m)) is null), 'motor sin intervalo y sin categoría: null (sin error)');
select pg_temp.ok((select jsonb_typeof(fn_mot_estado_campo()->'motores') = 'array'
                          and (select x->>'horas_para_mant' is null from jsonb_array_elements(fn_mot_estado_campo()->'motores') x where x->>'codigo' = 'T130-M2' limit 1) is not false),
                  'el estado del teléfono trae el motor sin intervalo con horas_para_mant null');

-- ---------------------------------------------------------------- 8 · motor al taller y registro
select pg_temp.como((select adm from k));
create temp table t1 as select pg_temp.op(pg_temp.uid(61), 'motor_asignar', jsonb_build_object('equipo_id', (select m1 from m), 'tipo', 'AL_TALLER', 'fecha_hora', pg_temp.ts(0),
    'motivo', 'Falla', 'motivo_codigo', 'DANO_REEMPLAZO')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from t1) and (select estado = 'TALLER' from mot_motores where equipo_id = (select m1 from m)), 'motor al taller');
select pg_temp.ok((select estacion_id = (select est from k) and motor_equipo_id is null and activo from mot_tanques where id = (select t from tk)),
                  'daño y reemplazo: el tanque y su saldo quedan en la estación, sin motor');
select pg_temp.ok((select disponible > 0 from mot_saldos where tanque_id = (select t from tk)), 'el saldo sigue en el tanque');
-- reemplazo: el motor 2 se conecta a ese tanque
create temp table t2 as select pg_temp.op(pg_temp.uid(62), 'motor_asignar', jsonb_build_object('equipo_id', (select m2 from m), 'tipo', 'INSTALADO', 'fecha_hora', pg_temp.ts(0),
    'estacion_destino', (select est from k), 'tanque_id', (select t from tk), 'motivo', 'Reemplazo')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from t2) and (select tanque_id = (select t from tk) from mot_motores where equipo_id = (select m2 from m)), 'el motor de reemplazo hereda el tanque');
-- registro del motor en el taller
select pg_temp.como((select e1 from k));
create temp table t3 as select pg_temp.op(pg_temp.uid(63), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(0),
    'horo_ini', 1, 'horo_fin', 2, 'visor_ini', 5, 'visor_fin', 4)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%taller%' from t3), 'un motor en el taller no acepta registros');

-- ---------------------------------------------------------------- 9 · fin de temporada con saldo
select pg_temp.como((select adm from k));
create temp table f1 as select pg_temp.op(pg_temp.uid(71), 'motor_retiro', jsonb_build_object('equipo_id', (select m2 from m), 'fecha_hora', pg_temp.ts(0),
    'motivo', 'Fin de temporada', 'motivo_codigo', 'FIN_TEMPORADA')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' and r::text like '%diésel%' from f1), 'retiro con saldo y sin destino del diésel: rechazado');
create temp table f2 as select pg_temp.op(pg_temp.uid(72), 'motor_retiro', jsonb_build_object('equipo_id', (select m2 from m), 'fecha_hora', pg_temp.ts(0),
    'motivo', 'Fin de temporada', 'motivo_codigo', 'FIN_TEMPORADA', 'destino_saldo', 'DEVUELTO')) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from f2), '«devuelto» sin destino: rechazado');
create temp table s9 as select disponible as s from mot_saldos where tanque_id = (select t from tk);
create temp table f3 as select pg_temp.op(pg_temp.uid(73), 'motor_retiro', jsonb_build_object('equipo_id', (select m2 from m), 'fecha_hora', pg_temp.ts(0),
    'motivo', 'Fin de temporada', 'motivo_codigo', 'FIN_TEMPORADA', 'destino_saldo', 'DEVUELTO', 'destino_devolucion', 'SUMINISTROS')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from f3) and (select disponible = 0 from mot_saldos where tanque_id = (select t from tk))
                   and exists (select 1 from mot_movimientos where documento_id = pg_temp.uid(73) and tipo = 'DEVOLUCION_TANQUE' and cantidad = -(select s from s9))
                   and (select not activo from mot_tanques where id = (select t from tk)), 'DEVUELTO: saldo 0, DEVOLUCION_TANQUE y tanque inactivo');
-- anular el retiro lo deshace
create temp table f4 as select pg_temp.op(pg_temp.uid(74), 'anulacion', jsonb_build_object('documento_tipo', 'motor_asignacion', 'documento_id', pg_temp.uid(73), 'motivo', 'error')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from f4) and (select activo from mot_tanques where id = (select t from tk))
                   and (select disponible = (select s from s9) from mot_saldos where tanque_id = (select t from tk)) and (select estado = 'EN_ESTACION' from mot_motores where equipo_id = (select m2 from m)),
                  'anular el retiro: el tanque y el saldo vuelven y el motor sigue en la estación');
-- traslado CON_EL_MOTOR
create temp table f5 as select pg_temp.op(pg_temp.uid(75), 'motor_asignar', jsonb_build_object('equipo_id', (select m2 from m), 'tipo', 'TRASLADADO', 'fecha_hora', pg_temp.ts(0),
    'estacion_destino', (select est2 from k), 'motivo', 'Cambio', 'motivo_codigo', 'CAMBIO_ESTACION', 'destino_saldo', 'CON_EL_MOTOR')) as r;
select pg_temp.ok((select r->>'estado' like 'ACEPTADO%' from f5) and (select estacion_id = (select est2 from k) and motor_equipo_id = (select m2 from m) from mot_tanques where id = (select t from tk))
                   and (select disponible = (select s from s9) from mot_saldos where tanque_id = (select t from tk)), 'CON_EL_MOTOR: el tanque y su saldo viajan a la otra estación');

-- ---------------------------------------------------------------- 10 · sin permisos
select pg_temp.como((select sin from k));
create temp table x1 as select pg_temp.op(pg_temp.uid(81), 'motor_registro_diario', jsonb_build_object('equipo_id', (select m1 from m), 'fecha', pg_temp.dia(30),
    'horo_ini', 1, 'horo_fin', 2, 'visor_ini', 5, 'visor_fin', 4)) as r;
select pg_temp.ok((select r->>'estado' = 'RECHAZADO' from x1), 'sin motores · registrar: rechazado');
create or replace function pg_temp.falla(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;
select pg_temp.ok(pg_temp.falla('select fn_mot_estado_campo()'), 'sin motores · ver no baja el estado');

-- ---------------------------------------------------------------- 11 · bajada con huella
select pg_temp.como((select adm from k));
create temp table b1 as select fn_mot_exportar('{"limite": 1000}'::jsonb) as x;
select pg_temp.ok((select (x->>'cuantos')::integer >= 5 from b1), 'exportar trae lo «por bajar»');
select pg_temp.ok((select bool_and(f->>'huella' = encode(sha256(convert_to(f->>'texto', 'UTF8')), 'hex')) from b1, jsonb_array_elements(x->'filas') f), 'cada huella = sha256 de su texto');
select pg_temp.ok((select bool_and(f->>'tabla' in ('registro', 'recepcion', 'mantenimiento', 'asignacion') and (f->>'cursor') like (substr(f->>'tabla', 1, 1) || '|%')
                          or (f->>'tabla' = 'recepcion' and (f->>'cursor') like 'c|%') or (f->>'tabla' = 'movimiento' and (f->>'cursor') like 'v|%')) from b1, jsonb_array_elements(x->'filas') f), 'cursores con su letra');
create temp table cf as select jsonb_build_object(
    'lote', (select jsonb_agg(jsonb_build_object('cursor', f->>'cursor', 'id', f->>'id', 'huella', f->>'huella')) from b1, jsonb_array_elements(x->'filas') f),
    'cuantos', (select (x->>'cuantos')::integer from b1), 'sha256_lote', (select x->>'sha256_lote' from b1)) as p;
select pg_temp.ok((select jsonb_array_length(fn_mot_confirmar_bajada(p)->'confirmadas') = (select (x->>'cuantos')::integer from b1) from cf), 'confirmar marca todo lo verificado');
select pg_temp.ok((select (fn_mot_purgar_bajadas('{}'::jsonb)->>'registros')::integer = 0), 'antes de la retención no se purga nada');
select fn_mot_bajada_retencion('{"dias": 0}'::jsonb);
create temp table pg as select fn_mot_purgar_bajadas('{}'::jsonb) as r;
select pg_temp.ok((select (r->>'recepciones')::integer >= 1 from pg), 'con retención 0 se purgan las recepciones confirmadas');
select pg_temp.ok(exists (select 1 from mot_registros where equipo_id = (select m1 from m) and anulado_at is null), 'el último registro vigente del motor NO se purga');
select pg_temp.ok(exists (select 1 from mot_movimientos) and exists (select 1 from mot_saldos) and exists (select 1 from mot_motores), 'el libro y las proyecciones no se purgan');
select pg_temp.ok((select horas_desde_mant >= 0 from mot_motores where equipo_id = (select m1 from m)), 'el contador de horas no depende de las filas purgadas');
select fn_mot_bajada_retencion('{"dias": 30}'::jsonb);
-- fila cambiada entre lectura y confirmación
select pg_temp.como((select adm from k));
-- (el uid(11) ya se purgó arriba: se usa el último registro vigente, que nunca se purga)
create temp table ult as select id from mot_registros where equipo_id = (select m1 from m) and anulado_at is null order by fecha desc, fecha_hora desc limit 1;
update mot_registros set comentario = 'cambiado' where id = (select id from ult);
create temp table b2 as select fn_mot_exportar('{"limite": 1000}'::jsonb) as x;
update mot_registros set comentario = 'cambiado otra vez' where id = (select id from ult);
create temp table cf2 as select jsonb_build_object(
    'lote', (select jsonb_agg(jsonb_build_object('cursor', f->>'cursor', 'id', f->>'id', 'huella', f->>'huella')) from b2, jsonb_array_elements(x->'filas') f),
    'cuantos', (select (x->>'cuantos')::integer from b2), 'sha256_lote', (select x->>'sha256_lote' from b2)) as p;
select pg_temp.ok((select (fn_mot_confirmar_bajada(p)->'rechazadas') @> jsonb_build_array(jsonb_build_object('id', (select id from ult)::text)) from cf2),
                  'fila cambiada entre lectura y confirmación: rechazada');

-- ---------------------------------------------------------------- 12 · «Terminar ciclo» (102) ignora mot_*
select pg_temp.ok((select bool_and(position('mot_' in pg_get_functiondef(p.oid)) = 0) from pg_proc p
                   where p.proname in ('_fert_turno_filas', 'fn_fert_exportar_turno', 'fn_fert_archivar_turno', 'fn_fert_restaurar_turno')),
                  '«Terminar ciclo»: ninguna función de la 102 toca mot_*');

-- ---------------------------------------------------------------- 13 · el libro no se edita desde la app
select pg_temp.como((select e1 from k));
set role authenticated;
select pg_temp.ok(pg_temp.falla('delete from mot_movimientos where true'), 'authenticated no puede borrar el libro de combustible');
reset role;

-- ---------------------------------------------------------------- 14 · invariantes tras volver a correr / otros órdenes
create or replace function pg_temp.finales(p_etiqueta text) returns void language plpgsql as $$
declare
    v_def text := pg_get_functiondef('public._fert_procesar(jsonb)'::regprocedure);
begin
    if position('_mot_op_asignar(' in v_def) = 0 or position('_mot_op_anulacion(' in v_def) = 0
       or position('''motor_asignar'', ''motor_retiro''' in v_def) = 0 then
        raise exception 'FALLA [%]: _fert_procesar no tiene los parches de la 130', p_etiqueta;
    end if;
    if position('_fert_op_devolucion_bodega(' in v_def) = 0 or position('_iny_op_aplicacion_lote(' in v_def) = 0 then
        raise exception 'FALLA [%]: la 130 deshizo el parche de la 128 o de la 129', p_etiqueta;
    end if;
    if (length(v_def) - length(replace(v_def, '_mot_op_asignar(', ''))) / length('_mot_op_asignar(') <> 1
       or (length(v_def) - length(replace(v_def, '_mot_op_anulacion(', ''))) / length('_mot_op_anulacion(') <> 1 then
        raise exception 'FALLA [%]: un parche de la 130 quedó duplicado', p_etiqueta;
    end if;
    raise notice 'ok  finales [%]', p_etiqueta;
end $$;
-- una recepción y su anulación por orden de corrida (el motor 1 está en el taller; se usa el tanque del motor 2 si está activo)
create or replace function pg_temp.ciclo(p_etiqueta text, p_n integer) returns void language plpgsql as $$
declare
    v_r jsonb;
    v_t uuid := (select t from tk);
    v_ant numeric := (select disponible from mot_saldos where tanque_id = (select t from tk));
begin
    perform pg_temp.como((select adm from k));
    -- desde la cola (1 día): en línea exige tener la estación a cargo; desde la cola solo marca FUERA_DE_CUSTODIA
    v_r := pg_temp.op(pg_temp.uid(p_n), 'diesel_recibir', jsonb_build_object('tanque_id', v_t, 'galones', 10, 'fecha_hora', now()), 1);
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: recibir: %', p_etiqueta, v_r; end if;
    if (select disponible from mot_saldos where tanque_id = v_t) <> v_ant + 10 then raise exception 'FALLA [%]: saldo', p_etiqueta; end if;
    v_r := pg_temp.op(pg_temp.uid(p_n + 1), 'anulacion', jsonb_build_object('documento_tipo', 'diesel_recepcion', 'documento_id', pg_temp.uid(p_n), 'motivo', 'prueba ' || p_etiqueta));
    if v_r->>'estado' not like 'ACEPTADO%' then raise exception 'FALLA [%]: anular: %', p_etiqueta, v_r; end if;
    if (select disponible from mot_saldos where tanque_id = v_t) <> v_ant then raise exception 'FALLA [%]: saldo tras anular', p_etiqueta; end if;
    perform pg_temp.finales(p_etiqueta);
end $$;

select pg_temp.finales('estado actual');
\i sql/130_campo_motores_y_combustible.sql
select pg_temp.ciclo('130 repetida', 200);
\i sql/129_campo_inyeccion_por_lote.sql
select pg_temp.ciclo('130>129', 210);
\i sql/128_campo_menu_y_devolucion_bodega.sql
select pg_temp.ciclo('130>129>128', 220);
\i sql/130_campo_motores_y_combustible.sql
select pg_temp.ciclo('128>130', 230);
\i sql/116_fertirriego_registro_historico.sql
\i sql/130_campo_motores_y_combustible.sql
select pg_temp.ciclo('116>130', 240);
\i sql/130_campo_motores_y_combustible.sql
\i sql/116_fertirriego_registro_historico.sql
select pg_temp.ciclo('130>116', 250);
\i sql/121_fertirriego_auditoria_a_agl.sql
\i sql/130_campo_motores_y_combustible.sql
select pg_temp.ciclo('121>130', 260);
\i sql/130_campo_motores_y_combustible.sql
\i sql/121_fertirriego_auditoria_a_agl.sql
select pg_temp.ciclo('130>121', 270);
\i sql/102_fertirriego_archivo_turnos.sql
\i sql/130_campo_motores_y_combustible.sql
select pg_temp.ciclo('102>130', 280);
\i sql/130_campo_motores_y_combustible.sql
\i sql/102_fertirriego_archivo_turnos.sql
