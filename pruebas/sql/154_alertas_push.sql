-- =====================================================================
-- PRUEBAS de sql/154 · Alertas con avisos push y Centro de alertas
-- Réplica local con 91–153 + la 154 ya corrida. Desde la RAÍZ del repo:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/154_alertas_push.sql
-- Autosuficiente: crea 3 roles de prueba, 4 usuarios y 2 estaciones/zonas; al final todo se borra (por id exacto).
-- NO ejecutada todavía (la corre Opus). Corre la 154 dos veces antes.
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
create or replace function pg_temp.id(n integer) returns uuid language sql as
$$ select ('154a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- Datos: zonas Z1/Z2, estaciones E1 (Z1) y E2 (Z2); roles 9541 (global), 9542 (zonal), 9543 (sin permiso)
insert into public.zonas (id, nombre) values (pg_temp.id(1), 'T154-Z1'), (pg_temp.id(2), 'T154-Z2') on conflict (id) do nothing;
insert into public.estaciones_riego (id, nombre, zona_id) values (pg_temp.id(11), 'T154-E1', pg_temp.id(1)), (pg_temp.id(12), 'T154-E2', pg_temp.id(2)) on conflict (id) do nothing;
insert into public.roles (id, codigo, nombre) values (9541, 'T154_GLOBAL', 'T154 global'), (9542, 'T154_ZONAL', 'T154 zonal'), (9543, 'T154_NADA', 'T154 nada') on conflict (id) do nothing;
insert into public.permisos (rol_id, recurso, accion, permitido, alcance) values
    (9541, 'alertas', 'ver', true, 'global'), (9542, 'alertas', 'ver', true, 'zonal')
on conflict (rol_id, recurso, accion) do update set permitido = true, alcance = excluded.alcance;
-- Usuarios: 1 global, 2 jefe de zona Z1, 3 sin permiso, 4 zonal con «todas las zonas»
insert into auth.users (id, email) select pg_temp.id(100 + n), 't154_' || n || '@example.test' from generate_series(1, 4) n on conflict (id) do nothing;
insert into public.perfiles (id, nombre, rol_id, todas_las_zonas) values
    (pg_temp.id(101), 'T154 global', 9541, false), (pg_temp.id(102), 'T154 jefe Z1', 9542, false),
    (pg_temp.id(103), 'T154 sin permiso', 9543, false), (pg_temp.id(104), 'T154 zonal todas', 9542, true)
on conflict (id) do update set rol_id = excluded.rol_id, todas_las_zonas = excluded.todas_las_zonas;
insert into public.perfiles_zonas (perfil_id, zona_id) values (pg_temp.id(102), pg_temp.id(1)) on conflict do nothing;
-- El usuario técnico de AGL: permiso de publicar
insert into public.permisos (rol_id, recurso, accion, permitido, alcance) values (9541, 'fertirriego_agl', 'publicar', true, 'global')
on conflict (rol_id, recurso, accion) do update set permitido = true;

-- ---------------------------------------------------------------- 1 · alcance y destinatarios
select pg_temp.ok(public._alerta_alcance(pg_temp.id(101)) = 'global', 'rol global = alcance global');
select pg_temp.ok(public._alerta_alcance(pg_temp.id(102)) = 'zonal', 'jefe = alcance zonal');
select pg_temp.ok(public._alerta_alcance(pg_temp.id(103)) is null, 'sin permiso = sin alcance (nadie recibe)');
select pg_temp.ok(public._alerta_ve(pg_temp.id(102), pg_temp.id(1), pg_temp.id(11)) is not null, 'jefe Z1 ve alerta de su zona');
select pg_temp.ok(public._alerta_ve(pg_temp.id(102), pg_temp.id(2), pg_temp.id(12)) is null, 'jefe Z1 NO ve alerta de Z2');
select pg_temp.ok(public._alerta_ve(pg_temp.id(102), null, null) is null, 'jefe Z1 NO ve alerta sin zona ni estación');
select pg_temp.ok(public._alerta_ve(pg_temp.id(101), null, null) = 'global', 'global ve alerta sin zona');
select pg_temp.ok(public._alerta_ve(pg_temp.id(104), pg_temp.id(2), pg_temp.id(12)) = 'global', '«todas las zonas» recibe todo');
select pg_temp.ok(public._alerta_ve(pg_temp.id(103), pg_temp.id(1), pg_temp.id(11)) is null, 'sin permiso no ve nada');

-- ---------------------------------------------------------------- 2 · publicar: idempotencia, enlace profundo, permisos
select pg_temp.como(pg_temp.id(103));
do $$ begin
    begin
        perform public.fn_alerta_publicar('{"clave":"t154|x","titulo":"x"}'::jsonb);
        raise exception 'FALLA: un usuario sin permiso de integración pudo publicar';
    exception when sqlstate '42501' then raise notice 'ok  sin permiso de integración no publica'; end;
end $$;
select pg_temp.como(pg_temp.id(101));
create temp table r1 as select public.fn_alerta_publicar(jsonb_build_object(
    'clave', 't154|cuadre|E1|TQ1', 'tipo', 'cuadre_combustible', 'gravedad', 'alta', 'estacion', 'T154-E1',
    'titulo', repeat('t', 80), 'cuerpo', repeat('c', 200),
    'destino', jsonb_build_object('pantalla', 'motores', 'pestana', 'historial', 'tanque_id', 'TQ1', 'fecha', '2026-11-17', 'registro_id', 'R1'))) as j;
select pg_temp.ok((select (j->>'nuevo')::boolean from r1), 'primera publicación = nuevo');
select pg_temp.ok((select length(titulo) = 60 and length(cuerpo) = 140 from public.alertas where clave = 't154|cuadre|E1|TQ1'), 'título ≤60 y cuerpo ≤140');
select pg_temp.ok((select zona_id = pg_temp.id(1) and estacion_id = pg_temp.id(11) from public.alertas where clave = 't154|cuadre|E1|TQ1'), 'estación y zona resueltas desde los catálogos');
select pg_temp.ok((select url = '/motores?pestana=historial&estacion=' || pg_temp.id(11) || '&tanque=TQ1&registro=R1&fecha=2026-11-17' from public.alertas where clave = 't154|cuadre|E1|TQ1'), 'enlace profundo armado con estación, tanque, registro y fecha');
select pg_temp.ok(not (select (public.fn_alerta_publicar(jsonb_build_object('clave', 't154|cuadre|E1|TQ1', 'titulo', 'otra vez'))->>'nuevo')::boolean), 'repetir una abierta NO crea otra');
select pg_temp.ok((select count(*) = 1 from public.alertas where clave = 't154|cuadre|E1|TQ1'), 'una sola fila por clave');
select pg_temp.ok((select notificada_at is null from public.alertas where clave = 't154|cuadre|E1|TQ1'), 'repetir no cambia el estado de aviso');

-- ---------------------------------------------------------------- 3 · lectura, atención y alcance en el listado
select pg_temp.como(pg_temp.id(102));
select pg_temp.ok(public.fn_alertas_no_leidas() = 1, 'el jefe Z1 tiene 1 sin leer');
select pg_temp.ok(jsonb_array_length(public.fn_alertas_listar('{}')) >= 1, 'el jefe la ve en su lista');
select pg_temp.como(pg_temp.id(101));
select public.fn_alerta_publicar('{"clave":"t154|z2","tipo":"saldo_negativo","estacion":"T154-E2","titulo":"Z2"}'::jsonb);
select pg_temp.como(pg_temp.id(102));
set role authenticated;
select pg_temp.ok(not exists (select 1 from public.alertas where clave = 't154|z2'), 'RLS: el jefe Z1 no lee alertas de Z2');
select pg_temp.ok(exists (select 1 from public.alertas where clave = 't154|cuadre|E1|TQ1'), 'RLS: el jefe Z1 sí lee la de su zona');
reset role;
select pg_temp.ok(public.fn_alertas_marcar(array[(select id from public.alertas where clave = 't154|cuadre|E1|TQ1')], 'leida') = 1, 'marcar leída');
select pg_temp.ok(public.fn_alertas_no_leidas() = 0, 'sin leer baja a 0');
select pg_temp.ok(public.fn_alertas_marcar(array[(select id from public.alertas where clave = 't154|z2')], 'leida') = 0, 'no puede marcar una alerta de otra zona');
select pg_temp.ok(public.fn_alertas_marcar(array[(select id from public.alertas where clave = 't154|cuadre|E1|TQ1')], 'atendida', 'Se revisó el visor') = 1, 'atender');
select pg_temp.ok((select estado = 'atendida' and atendida_por = pg_temp.id(102) and atendida_nota = 'Se revisó el visor' from public.alertas where clave = 't154|cuadre|E1|TQ1'), 'atender queda con quién, cuándo y nota (lo ve AGL)');
select pg_temp.ok((select (x->>'estado_usuario') = 'atendida' from jsonb_array_elements(public.fn_alertas_listar('{"estado":["atendida"]}')) x limit 1), 'el filtro de estado atendida la encuentra');

-- ---------------------------------------------------------------- 4 · reaparece una atendida: se reabre y se vuelve a avisar
select pg_temp.como(pg_temp.id(101));
select pg_temp.ok((public.fn_alerta_publicar(jsonb_build_object('clave', 't154|cuadre|E1|TQ1', 'titulo', 'de nuevo', 'estacion', 'T154-E1'))->>'nuevo')::boolean, 'una atendida que reaparece = nuevo');
select pg_temp.ok((select estado = 'abierta' and notificada_at is null and reaperturas = 1 from public.alertas where clave = 't154|cuadre|E1|TQ1'), 'se reabre sin aviso previo');
select pg_temp.ok(not exists (select 1 from public.alertas_lecturas where alerta_id = (select id from public.alertas where clave = 't154|cuadre|E1|TQ1')), 'al reabrir vuelve a ser «nueva» para todos');
select pg_temp.ok(public.fn_alerta_resolver('t154|cuadre|E1|TQ1'), 'AGL resuelve');
select pg_temp.ok(not public.fn_alerta_resolver('t154|cuadre|E1|TQ1'), 'resolver dos veces no hace nada');

-- ---------------------------------------------------------------- 5 · despacho: preferencias, 24 h, sin dispositivo, silencio
select public.fn_alerta_publicar(jsonb_build_object('clave', 't154|d1', 'tipo', 'saldo_negativo', 'estacion', 'T154-E1', 'titulo', 'Despacho'));
insert into public.push_suscripciones (perfil_id, endpoint, p256dh, auth) values (pg_temp.id(102), 'https://t154.example/1', 'k', 'a') on conflict (endpoint) do update set activa = true;
insert into public.push_preferencias (perfil_id, tipo, activo) values (pg_temp.id(104), 'saldo_negativo', false) on conflict (perfil_id, tipo) do update set activo = false;
create temp table plan as select public.fn_alertas_plan_despacho(20, null) as j;
select pg_temp.ok((select count(*) >= 1 from plan, jsonb_array_elements(j)), 'el plan trae la alerta pendiente');
select pg_temp.ok(exists (select 1 from plan, jsonb_array_elements(j) a, jsonb_array_elements(a->'envios') e where e->>'perfil_id' = pg_temp.id(102)::text), 'el jefe de Z1 con teléfono está en el plan');
select pg_temp.ok(not exists (select 1 from plan, jsonb_array_elements(j) a, jsonb_array_elements(a->'envios') e where e->>'perfil_id' in (pg_temp.id(103)::text, pg_temp.id(104)::text)), 'sin permiso y con el tipo apagado NO están en el plan');
select pg_temp.ok((select resultado = 'omitido_pref' from public.alertas_envios where perfil_id = pg_temp.id(104) and alerta_id = (select id from public.alertas where clave = 't154|d1')), 'se registra «lo apagó»');
select pg_temp.ok((select resultado = 'sin_dispositivo' from public.alertas_envios where perfil_id = pg_temp.id(101) and alerta_id = (select id from public.alertas where clave = 't154|d1')), 'el global sin teléfono queda como «sin dispositivo»');
select public.fn_alerta_registrar_envio((select id from public.alertas where clave = 't154|d1'), pg_temp.id(102), (select id from public.push_suscripciones where endpoint = 'https://t154.example/1'), 'enviado');
select public.fn_alerta_cerrar_despacho((select id from public.alertas where clave = 't154|d1'));
select pg_temp.ok((select notificada_at is not null from public.alertas where clave = 't154|d1'), 'cerrar despacho marca notificada');
-- 24 h: reenviar sin forzar no repite al mismo destinatario
update public.alertas set notificada_at = null, despacho_inicio = null where clave = 't154|d1';
create temp table plan2 as select public.fn_alertas_plan_despacho(20, (select id from public.alertas where clave = 't154|d1')) as j;
select pg_temp.ok(not exists (select 1 from plan2, jsonb_array_elements(j) a, jsonb_array_elements(a->'envios') e where e->>'perfil_id' = pg_temp.id(102)::text), 'no se repite al mismo destinatario dentro de 24 h');
-- reenviar (control) sí repite
select pg_temp.ok(public.fn_alerta_reenviar((select id from public.alertas where clave = 't154|d1')), 'control reenvía');
create temp table plan3 as select public.fn_alertas_plan_despacho(20, (select id from public.alertas where clave = 't154|d1')) as j;
select pg_temp.ok(exists (select 1 from plan3, jsonb_array_elements(j) a, jsonb_array_elements(a->'envios') e where e->>'perfil_id' = pg_temp.id(102)::text), 'reenviar forzado sí llega de nuevo');
-- silencio
select public.fn_alerta_cerrar_despacho((select id from public.alertas where clave = 't154|d1'));
select public.fn_alerta_publicar(jsonb_build_object('clave', 't154|d2', 'tipo', 'capacidad_llena', 'estacion', 'T154-E1', 'titulo', 'Silenciada'));
select pg_temp.ok(public.fn_alerta_silenciar('capacidad_llena', null, 2) is not null, 'silenciar un tipo');
create temp table plan4 as select public.fn_alertas_plan_despacho(20, null) as j;
select pg_temp.ok(not exists (select 1 from plan4, jsonb_array_elements(j) a where a->'alerta'->>'clave' = 't154|d2'), 'una alerta de tipo silenciado no sale');
select pg_temp.ok(exists (select 1 from public.alertas_envios en join public.alertas a on a.id = en.alerta_id where a.clave = 't154|d2' and en.resultado = 'silenciada'), 'queda registrada como silenciada');

-- ---------------------------------------------------------------- 6 · control solo para alcance global
select pg_temp.como(pg_temp.id(102));
do $$ begin
    begin perform public.fn_alertas_control(); raise exception 'FALLA: un jefe de zona vio el Control';
    exception when sqlstate '42501' then raise notice 'ok  el Control exige alcance total'; end;
    begin perform public.fn_alerta_reenviar(gen_random_uuid()); raise exception 'FALLA: un jefe de zona reenvió';
    exception when sqlstate '42501' then raise notice 'ok  reenviar exige alcance total'; end;
end $$;
select pg_temp.como(pg_temp.id(101));
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.fn_alertas_control()->'suscripciones') s where s->>'perfil_id' = pg_temp.id(101)::text and jsonb_array_length(s->'dispositivos') = 0), 'el Control lista a quien tiene el permiso y NO tiene teléfono');

-- ---------------------------------------------------------------- 7 · RLS de suscripciones y preferencias
select pg_temp.como(pg_temp.id(104));
set role authenticated;
select pg_temp.ok((select count(*) = 0 from public.push_suscripciones where perfil_id = pg_temp.id(102)), 'RLS: no ve suscripciones de otra persona');
reset role;
select pg_temp.ok(public.fn_push_suscribir('https://t154.example/1', 'k2', 'a2', 'UA') is not null, 'reasignar un endpoint compartido lo deja a nombre de quien lo activa');
select pg_temp.como(pg_temp.id(103));
do $$ begin
    begin perform public.fn_push_suscribir('https://t154.example/9', 'k', 'a'); raise exception 'FALLA: sin permiso pudo suscribirse';
    exception when sqlstate '42501' then raise notice 'ok  sin permiso no puede suscribirse'; end;
end $$;

-- ---------------------------------------------------------------- 8 · trigger interno: saldo negativo no rompe nada y no duplica
select pg_temp.como(pg_temp.id(101));
select public._alerta_emitir(jsonb_build_object('clave', 'saldo|' || pg_temp.id(11) || '|opX', 'tipo', 'saldo_negativo', 'titulo', 'Saldo negativo · T154-E1', 'estacion', 'T154-E1'));
select pg_temp.ok((select count(*) = 1 from public.alertas where clave = 'saldo|' || pg_temp.id(11) || '|opX'), 'alerta interna idempotente');

-- ---------------------------------------------------------------- limpieza (por id y clave exactos)
delete from public.alertas where left(clave, 4) = 't154' or clave = 'saldo|' || pg_temp.id(11) || '|opX';
delete from public.alertas_silencios where tipo = 'capacidad_llena' and nota is null;
delete from public.push_preferencias where perfil_id in (pg_temp.id(101), pg_temp.id(102), pg_temp.id(103), pg_temp.id(104));
delete from public.push_suscripciones where perfil_id in (pg_temp.id(101), pg_temp.id(102), pg_temp.id(103), pg_temp.id(104));
delete from public.perfiles_zonas where perfil_id in (pg_temp.id(102));
delete from public.perfiles where id in (pg_temp.id(101), pg_temp.id(102), pg_temp.id(103), pg_temp.id(104));
delete from auth.users where id in (pg_temp.id(101), pg_temp.id(102), pg_temp.id(103), pg_temp.id(104));
delete from public.permisos where rol_id in (9541, 9542, 9543);
delete from public.roles where id in (9541, 9542, 9543);
delete from public.estaciones_riego where id in (pg_temp.id(11), pg_temp.id(12));
delete from public.zonas where id in (pg_temp.id(1), pg_temp.id(2));
\echo 'FIN pruebas 154'
