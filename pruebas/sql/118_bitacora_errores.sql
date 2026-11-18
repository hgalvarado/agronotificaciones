-- =====================================================================
-- PRUEBAS de sql/118 · bitácora de errores por usuario
-- Base: réplica con 91–117. Correr DESDE LA RAÍZ DEL REPO:
--   psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/118_bitacora_errores.sql
-- Repite la 118 (118>118) y comprueba que nada cambia para los roles existentes (equivalencia antes/después).
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
create or replace function pg_temp.falla(p_sql text, p_msg text, p_texto text default null) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: % (no falló)', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    if p_texto is not null and position(p_texto in sqlerrm) = 0 then
        raise exception 'FALLA: % (mensaje inesperado: %)', p_msg, sqlerrm;
    end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
grant execute on function pg_temp.como(uuid), pg_temp.ok(boolean, text), pg_temp.falla(text, text, text) to public;
set client_min_messages = notice;

-- ---------------------------------------------------------------- equivalencia: foto ANTES de la 118
create temp table antes as
select r.id as rol_id, (select count(*) from permisos p where p.rol_id = r.id) as n_permisos from roles r;
create temp table antes_total as select count(*) as n from permisos;

\i sql/118_bitacora_errores.sql

do $$
begin
    if (select count(*) from permisos) <> (select n from antes_total) then raise exception 'FALLA: la 118 cambió public.permisos'; end if;
    if exists (select 1 from antes a where a.n_permisos <> (select count(*) from permisos p where p.rol_id = a.rol_id)) then
        raise exception 'FALLA: la 118 cambió los permisos de algún rol';
    end if;
    raise notice 'ok  equivalencia: public.permisos idéntica antes y después (ningún rol existente cambia)';
end $$;

-- ---------------------------------------------------------------- datos
do $$
declare ra smallint; rr smallint; rc smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T118_ADM', 'P118 Admin', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre) values ('T118_REV', 'P118 Revisor') on conflict (codigo) do nothing;
    insert into roles (codigo, nombre) values ('T118_CAMPO', 'P118 Campo') on conflict (codigo) do nothing;
    select id into ra from roles where codigo = 'T118_ADM';
    select id into rr from roles where codigo = 'T118_REV';
    select id into rc from roles where codigo = 'T118_CAMPO';
    insert into permisos (rol_id, recurso, accion) values (rr, 'errores', 'ver') on conflict do nothing;
    insert into permisos (rol_id, recurso, accion) values (rc, 'fertirriego', 'ver') on conflict do nothing;
    insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-000000011801', 'adm@118'), ('00000000-0000-0000-0000-000000011802', 'rev@118'),
        ('00000000-0000-0000-0000-000000011803', 'campo@118'), ('00000000-0000-0000-0000-000000011804', 'campo2@118')
        on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000011801', 'Admin 118', ra, true),
        ('00000000-0000-0000-0000-000000011802', 'Revisor 118', rr, true),
        ('00000000-0000-0000-0000-000000011803', 'Campo 118', rc, true),
        ('00000000-0000-0000-0000-000000011804', 'Campo2 118', rc, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000011801', ra), ('00000000-0000-0000-0000-000000011802', rr),
        ('00000000-0000-0000-0000-000000011803', rc), ('00000000-0000-0000-0000-000000011804', rc) on conflict do nothing;
    delete from registro_errores where usuario_id in (select id from perfiles where nombre like '%118');
    delete from registro_salud where usuario_id in (select id from perfiles where nombre like '%118');
    delete from fert_operaciones where perfil_id in (select id from perfiles where nombre like '%118');
end $$;
create temp table k as select
    '00000000-0000-0000-0000-000000011801'::uuid as adm, '00000000-0000-0000-0000-000000011802'::uuid as rev,
    '00000000-0000-0000-0000-000000011803'::uuid as c1, '00000000-0000-0000-0000-000000011804'::uuid as c2;
grant select on k to public;

-- 1 · Registrar: sin sesión se rechaza
select pg_temp.como(null);
select pg_temp.falla($$select fn_errores_registrar('[{"mensaje":"x"}]')$$, 'sin sesión no registra', 'sesión');

-- 2 · Dedupe: mismo error con otros números = una fila con contador
select pg_temp.como((select c1 from k));
select fn_errores_registrar('[{"origen":"navegador","modulo":"fertirriego","ruta":"/fertirriego","severidad":"error","codigo":"TypeError","mensaje":"Falló la operación 123 para la estación 9","detalle":{"pila":"a"}}]');
select fn_errores_registrar('[{"origen":"navegador","modulo":"fertirriego","ruta":"/fertirriego","severidad":"error","codigo":"TypeError","mensaje":"Falló la operación 456 para la estación 77","repeticiones":3}]');
select pg_temp.como((select adm from k));
select pg_temp.ok((select count(*) = 1 and max(repeticiones) = 4 from registro_errores where usuario_id = (select c1 from k)),
                  'mismo error con otros números: UNA fila, repeticiones = 4');
select pg_temp.como((select c2 from k));
select fn_errores_registrar('[{"origen":"navegador","modulo":"fertirriego","ruta":"/fertirriego","severidad":"error","codigo":"TypeError","mensaje":"Falló la operación 1 para la estación 2"}]');
select pg_temp.como((select adm from k));
select pg_temp.ok((select count(*) = 2 from registro_errores where usuario_id in ((select c1 from k), (select c2 from k))), 'cada usuario tiene su propia fila');

-- 3 · Saneamiento
select pg_temp.como((select c1 from k));
select fn_errores_registrar($j$[{"origen":"guardado","modulo":"tickets","severidad":"aviso","mensaje":"Fallo con Bearer abc.def-123 y password=secreto123 y eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.firma_xyz",
  "detalle":{"password":"hunter2","token":"zzz","anidado":{"Authorization":"Bearer q","cookie":"a=b","ok":"visible"},"texto":"clave=1 password: abc"}}]$j$);
select pg_temp.como((select adm from k));
select pg_temp.ok((select mensaje not like '%abc.def%' and mensaje not like '%secreto123%' and mensaje not like '%firma_xyz%' and mensaje like '%[token]%'
                   from registro_errores where usuario_id = (select c1 from k) and modulo = 'tickets'), 'el mensaje no guarda tokens, Bearer ni contraseñas');
select pg_temp.ok((select detalle->>'password' = '[oculto]' and detalle->>'token' = '[oculto]' and detalle#>>'{anidado,Authorization}' = '[oculto]'
                          and detalle#>>'{anidado,cookie}' = '[oculto]' and detalle#>>'{anidado,ok}' = 'visible' and detalle->>'texto' not like '%abc%'
                   from registro_errores where usuario_id = (select c1 from k) and modulo = 'tickets'), 'el detalle oculta claves sensibles (también anidadas) y deja lo demás');

-- 4 · Límites y entradas dañadas
select pg_temp.como((select c1 from k));
select pg_temp.ok((fn_errores_registrar('[1, "x", null, {"mensaje":""}, {"sin":"mensaje"}, {"mensaje":"ok raro","severidad":"hackeado","origen":"inventado"}]')->>'recibidos')::int = 1,
                  'elementos dañados se descartan y el resto se guarda');
select pg_temp.como((select adm from k));
select pg_temp.ok((select severidad = 'error' and origen = 'otro' from registro_errores where usuario_id = (select c1 from k) and mensaje = 'ok raro'), 'severidad y origen inválidos caen a valores seguros');
select pg_temp.como((select c1 from k));
select pg_temp.ok((fn_errores_registrar((select jsonb_agg(jsonb_build_object('mensaje', 'masivo número ' || (g * 7919)::text || ' texto')) from generate_series(1, 80) g))->>'recibidos')::int = 50,
                  'un envío acepta máximo 50 elementos');
do $$
declare i integer; r jsonb;
begin
    for i in 1..6 loop
        r := fn_errores_registrar((select jsonb_agg(jsonb_build_object('mensaje', 'lote ' || i || ' variante ' || md5((i * 100 + g)::text))) from generate_series(1, 50) g));
    end loop;
    if not (r->>'limitado')::boolean then raise exception 'FALLA: no hubo límite de filas distintas por hora'; end if;
    raise notice 'ok  más de 200 filas distintas por hora: se marca limitado';
end $$;
select pg_temp.como((select adm from k));
select pg_temp.ok((select count(*) <= 205 from registro_errores where usuario_id = (select c1 from k)), 'el usuario no pasa de ~200 filas distintas por hora');
select pg_temp.como((select c2 from k));
select fn_errores_registrar(jsonb_build_array(jsonb_build_object('mensaje', 'enorme', 'detalle', jsonb_build_object('pila', repeat('x', 20000)))));
select pg_temp.como((select adm from k));
select pg_temp.ok((select length(detalle::text) < 9000 from registro_errores where usuario_id = (select c2 from k) and mensaje = 'enorme'), 'un detalle gigante se trunca');

-- 5 · Latido
select pg_temp.como((select c2 from k));
select fn_errores_registrar(jsonb_build_array(jsonb_build_object('tipo', 'latido', 'version', '0.1.0', 'pendientes', 3, 'pendiente_mas_viejo_h', 7.5,
        'ultima_sync_ok', (now() - interval '9 hours'), 'en_linea', false, 'hora_telefono', now() + interval '2 hours', 'datos', jsonb_build_object('navegador', 'X', 'token', 'no'))));
select pg_temp.ok((select desfase_reloj_s between 7100 and 7300 from registro_salud where usuario_id = (select c2 from k)), 'el latido calcula el desfase del reloj (+2 h)');
select pg_temp.ok((select datos->>'token' = '[oculto]' from registro_salud where usuario_id = (select c2 from k)), 'el latido también se sanea');
select fn_errores_registrar(jsonb_build_array(jsonb_build_object('tipo', 'latido', 'version', '0.1.1', 'pendientes', 0, 'en_linea', true)));
select pg_temp.como((select adm from k));
select pg_temp.ok((select count(*) = 1 and bool_and(version_app = '0.1.1' and pendientes = 0 and en_linea and ultima_sync_ok is not null) from registro_salud where usuario_id = (select c2 from k)),
                  'el latido se actualiza (una fila por usuario) y un latido sin «última sync» no la borra');

-- 6 · RLS y permisos
set role authenticated;
select pg_temp.como((select c1 from k));
select pg_temp.ok((select count(*) = 0 from registro_errores), 'RLS: un usuario de campo NO ve ninguna fila de la bitácora (ni la suya)');
select pg_temp.ok((select count(*) = 0 from registro_salud), 'RLS: tampoco la salud');
select pg_temp.falla($$select fn_errores_listar('{}')$$, 'campo no lista', 'Bitácora de errores');
select pg_temp.falla($$select fn_errores_resumen_por_usuario()$$, 'campo no ve el resumen', 'Bitácora de errores');
select pg_temp.falla($$select fn_errores_operaciones_fallidas()$$, 'campo no ve operaciones fallidas', 'Bitácora de errores');
select pg_temp.falla($$select fn_errores_marcar(array[gen_random_uuid()], 'atendido', 'x')$$, 'campo no marca', 'atender');
select pg_temp.ok(fn_errores_graves_nuevos() = 0, 'campo: el indicador del menú da 0');
select pg_temp.como((select rev from k));
select pg_temp.ok((select count(*) > 0 from registro_errores), 'RLS: el revisor (permiso «ver») lee la bitácora');
select pg_temp.ok(jsonb_array_length(fn_errores_listar('{}')) > 0, 'el revisor lista');
select pg_temp.falla($$select fn_errores_marcar(array[gen_random_uuid()], 'atendido', 'x')$$, 'el revisor NO atiende (sin «atender»)', 'atender');
select pg_temp.ok(fn_errores_graves_nuevos() > 0, 'el revisor ve el número de graves nuevos');
select pg_temp.falla($$insert into registro_errores (usuario_id, origen, mensaje, huella) values ((select rev from k), 'otro', 'x', 'h')$$, 'nadie escribe directo la tabla', 'permission denied');
reset role;

-- 7 · Listar, filtrar, marcar
select pg_temp.como((select adm from k));
select pg_temp.ok((select jsonb_array_length(fn_errores_listar(jsonb_build_object('usuario', (select c2 from k)))) = 2), 'filtro por usuario (sus 2 filas)');
select pg_temp.ok((select bool_and(x->>'severidad' = 'aviso') and count(*) = 1 from jsonb_array_elements(fn_errores_listar('{"severidad":["aviso"]}')) x
                    where x->>'usuario' = 'Campo 118'), 'filtro por gravedad');
select pg_temp.ok((select bool_and(x->>'modulo' = 'tickets') from jsonb_array_elements(fn_errores_listar('{"modulo":"tickets"}')) x), 'filtro por módulo');
select pg_temp.ok(jsonb_array_length(fn_errores_listar('{"desde":"2999-01-01T00:00:00Z"}')) = 0, 'filtro por fecha');
create temp table e1 as select (x->>'id')::uuid as id from jsonb_array_elements(fn_errores_listar(jsonb_build_object('usuario', (select c2 from k)))) x
                         where x->>'mensaje' = 'enorme' limit 1;
select pg_temp.ok(fn_errores_marcar(array[(select id from e1)], 'atendido', 'Se actualizó la app del teléfono') = 1, 'marcar atendido con nota');
select pg_temp.ok((select estado = 'atendido' and nota_admin like 'Se actualizó%' and atendido_por = (select adm from k) and atendido_at is not null from registro_errores where id = (select id from e1)), 'quedan estado, nota, quién y cuándo');
select pg_temp.falla($$select fn_errores_marcar(array[(select id from e1)], 'borrado', null)$$, 'estado inválido', 'Estado no válido');
select pg_temp.como((select c2 from k));
select fn_errores_registrar('[{"mensaje":"enorme","detalle":{"pila":"y"}}]');
select pg_temp.como((select adm from k));
select pg_temp.ok((select estado = 'nuevo' and nota_admin like 'Se actualizó%' and repeticiones = 2 from registro_errores where id = (select id from e1)), 'si el error reaparece vuelve a «nuevo» y conserva la nota');

-- 8 · Operaciones rechazadas por el servidor (viven en fert_operaciones)
insert into fert_operaciones (id, tipo, perfil_id, creado_en, recibido_en, resultado, mensaje)
values (gen_random_uuid(), 'aplicacion', (select c1 from k), now() - interval '5 hours', now(), 'RECHAZADO', 'Saldo insuficiente de prueba 118'),
       (gen_random_uuid(), 'recepcion', (select c1 from k), now() - interval '1 hour', now(), 'ACEPTADO', null),
       (gen_random_uuid(), 'conteo', (select c1 from k), now() - interval '2 hours', now(), 'ACEPTADO_CON_OBSERVACIONES', null);
select pg_temp.ok((select count(*) = 2 from jsonb_array_elements(fn_errores_operaciones_fallidas(null, null, (select c1 from k))) x), 'operaciones fallidas: rechazada + con observaciones (la aceptada limpia no)');
select pg_temp.ok((select count(*) = 1 from jsonb_array_elements(fn_errores_operaciones_fallidas(null, null, (select c1 from k), true)) x), 'solo rechazadas');
select pg_temp.ok((select (x->>'demora_s')::bigint >= 17000 from jsonb_array_elements(fn_errores_operaciones_fallidas(null, null, (select c1 from k), true)) x limit 1), 'incluye la demora entre la hora del teléfono y la del servidor');
select pg_temp.ok((select (x->>'rechazos_7d')::int = 1 and (x->>'graves_nuevos')::int >= 1 from jsonb_array_elements(fn_errores_resumen_por_usuario()) x where x->>'nombre' = 'Campo 118'), 'resumen por usuario: 1 rechazo y graves nuevos');
select pg_temp.ok((select (x->>'pendientes')::int = 0 and x->>'version_app' = '0.1.1' from jsonb_array_elements(fn_errores_resumen_por_usuario()) x where x->>'nombre' = 'Campo2 118'), 'resumen por usuario: trae el último latido');

-- 9 · Retención 90 días
update registro_errores set ultima_vez = now() - interval '100 days' where usuario_id = (select c1 from k) and modulo = 'tickets';
select pg_temp.ok(fn_errores_purgar() >= 1, 'la purga borra lo de más de 90 días');
select pg_temp.ok((select count(*) = 0 from registro_errores where usuario_id = (select c1 from k) and modulo = 'tickets'), 'y solo eso');

-- 10 · Idempotencia de la migración
create temp table antes2 as select count(*) as n from registro_errores;
\i sql/118_bitacora_errores.sql
select pg_temp.como((select adm from k));
select pg_temp.ok((select count(*) from registro_errores) = (select n from antes2), '118>118: no pierde filas');
select pg_temp.ok((select count(*) = 1 from pantallas where codigo = 'errores' and acciones @> array['ver','atender']), 'pantalla «errores» registrada con ver y atender');
select pg_temp.ok(not exists (select 1 from permisos where recurso = 'errores' and rol_id not in (select id from roles where codigo = 'T118_REV')), 'ningún rol existente recibió el permiso «errores»');

-- limpieza de datos de prueba
select pg_temp.como(null);
delete from registro_errores where usuario_id in (select id from perfiles where nombre like '%118');
delete from registro_salud where usuario_id in (select id from perfiles where nombre like '%118');
delete from fert_operaciones where perfil_id in (select id from perfiles where nombre like '%118');
\echo 'TODAS LAS PRUEBAS 118 PASARON'
