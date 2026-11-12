-- =====================================================================
-- PRUEBAS de sql/92 · SOLO EN LA RÉPLICA LOCAL (crea personas y roles de prueba)
-- psql -h localhost -p 5499 -U postgres -d fert_qa -X -v ON_ERROR_STOP=1 -f pruebas/sql/92_permisos.sql
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

set client_min_messages = notice;

-- ---------------------------------------------------------------------
-- 0 · La migración no le cambió nada a nadie
-- ---------------------------------------------------------------------
select pg_temp.ok((select count(*) = 0 from perfiles p
                   where not exists (select 1 from seguridad.perfiles_roles pr where pr.perfil_id = p.id and pr.rol_id = p.rol_id)),
                  'cada persona tiene su rol de siempre en seguridad.perfiles_roles');
select pg_temp.ok((select count(*) = 0 from perfiles p
                   where not p.todas_las_zonas and not exists (select 1 from perfiles_zonas pz where pz.perfil_id = p.id)),
                  'quien no tenía zonas quedó con «Todas las zonas»');
select pg_temp.ok((select count(*) = 0 from perfiles p
                   where p.todas_las_zonas and exists (select 1 from perfiles_zonas pz where pz.perfil_id = p.id)),
                  'quien tenía zonas sigue restringido a ellas');
select pg_temp.ok((select count(*) = 0 from pantallas where modulo is null), 'toda pantalla tiene módulo');

-- ---------------------------------------------------------------------
-- Datos: dos roles nuevos y dos personas
-- ---------------------------------------------------------------------
do $$
declare r_a smallint; r_b smallint;
begin
    insert into roles (codigo, nombre) values ('T92_A', 'Prueba 92 A') on conflict (codigo) do nothing;
    insert into roles (codigo, nombre) values ('T92_B', 'Prueba 92 B') on conflict (codigo) do nothing;
    select id into r_a from roles where codigo = 'T92_A';
    select id into r_b from roles where codigo = 'T92_B';
    insert into permisos (rol_id, recurso, accion, alcance, condicion) values
        (r_a, 'tickets', 'ver', 'propietario', 'sin_restriccion'),
        (r_a, 'tickets', 'editar', 'propietario', 'solo_abiertos_registrando'),
        (r_b, 'tickets', 'ver', 'zonal', 'sin_restriccion'),
        (r_b, 'tickets', 'editar', 'zonal', 'sin_restriccion'),
        (r_b, 'labores', 'ver', 'global', 'sin_restriccion')
    on conflict (rol_id, recurso, accion) do nothing;

    insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-000000009201', 'p1@prueba.local'),
        ('00000000-0000-0000-0000-000000009202', 'p2@prueba.local')
    on conflict do nothing;
    insert into perfiles (id, nombre, rol_id) values
        ('00000000-0000-0000-0000-000000009201', 'Persona dos roles', r_a),
        ('00000000-0000-0000-0000-000000009202', 'Persona zonas', r_b)
    on conflict (id) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- 1 · Varios roles: unión
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000009201');
select pg_temp.ok(fn_mi_alcance('tickets', 'ver') = 'propietario' and not fn_tiene_permiso('labores', 'ver'),
                  'con un rol: tickets propietario y sin Labores');

insert into seguridad.perfiles_roles (perfil_id, rol_id) select '00000000-0000-0000-0000-000000009201', id from roles where codigo = 'T92_B';
select pg_temp.ok(fn_mi_alcance('tickets', 'ver') = 'zonal', 'con dos roles: el alcance más amplio (zonal)');
select pg_temp.ok(fn_tiene_permiso('labores', 'ver'), 'con dos roles: suma las pantallas del segundo');
select pg_temp.ok((select condicion = 'sin_restriccion' from fn_permiso_de('tickets', 'editar')),
                  'con dos roles: la condición menos restrictiva');
select pg_temp.ok((select count(*) = count(distinct recurso || ':' || accion) from fn_mis_permisos()),
                  'fn_mis_permisos no repite llaves');
do $$ begin
    perform * from fn_permisos_de_perfil('00000000-0000-0000-0000-000000009201');
    raise exception 'FALLA: vio la ficha de permisos sin permiso de Usuarios';
exception when insufficient_privilege then raise notice 'ok  la ficha de permisos pide «Ver» en Usuarios';
end $$;

-- Acceso total por un rol secundario
select pg_temp.ok(not fn_es_admin(), 'sin rol de acceso total no es administrador');
insert into seguridad.perfiles_roles (perfil_id, rol_id) select '00000000-0000-0000-0000-000000009201', id from roles where acceso_total limit 1;
select pg_temp.ok(fn_es_admin(), 'un rol secundario con acceso total lo hace administrador');
select pg_temp.ok((select count(*) = count(distinct recurso || ':' || accion) from fn_mis_permisos()),
                  'administrador con varios roles: sin llaves repetidas');
select pg_temp.ok((select roles is not null from fn_permisos_de_perfil('00000000-0000-0000-0000-000000009201')
                   where recurso = 'tickets' and accion = 'ver'), 'la ficha dice qué rol da cada permiso');
delete from seguridad.perfiles_roles where perfil_id = '00000000-0000-0000-0000-000000009201'
   and rol_id in (select id from roles where acceso_total);

-- Solo lectura + otro rol: ya no es invitado
insert into seguridad.perfiles_roles (perfil_id, rol_id) select '00000000-0000-0000-0000-000000009201', id from roles where solo_lectura limit 1;
select pg_temp.ok(not fn_es_invitado(), 'Invitado + otro rol: no queda en solo lectura');
delete from seguridad.perfiles_roles where perfil_id = '00000000-0000-0000-0000-000000009201'
   and rol_id in (select id from roles where solo_lectura);

-- No se puede quitar el rol principal
do $$ begin
    delete from seguridad.perfiles_roles where perfil_id = '00000000-0000-0000-0000-000000009201'
       and rol_id = (select rol_id from perfiles where id = '00000000-0000-0000-0000-000000009201');
    raise exception 'FALLA: se quitó el rol principal';
exception when check_violation then raise notice 'ok  no se puede quitar el rol principal';
end $$;

-- Cambiar el principal REEMPLAZA al anterior (como antes de la 92): nadie conserva permisos de su rol viejo
update perfiles set rol_id = (select id from roles where codigo = 'T92_B') where id = '00000000-0000-0000-0000-000000009201';
select pg_temp.ok((select array_agg(r.codigo) = array['T92_B'] from seguridad.perfiles_roles pr join roles r on r.id = pr.rol_id
                   where pr.perfil_id = '00000000-0000-0000-0000-000000009201'),
                  'cambiar el rol principal quita el anterior (no queda con permisos viejos)');
insert into seguridad.perfiles_roles (perfil_id, rol_id) select '00000000-0000-0000-0000-000000009201', id from roles where codigo = 'T92_A';

-- Acción apagada: el alcance guardado del rol principal, como antes
update permisos set permitido = false, alcance = 'zonal'
 where rol_id = (select id from roles where codigo = 'T92_B') and recurso = 'labores' and accion = 'ver';
select pg_temp.ok((select not permitido and alcance = 'zonal' from fn_permiso_de('labores', 'ver')),
                  'acción apagada: devuelve el alcance guardado, igual que antes');
update permisos set permitido = true, alcance = 'global'
 where rol_id = (select id from roles where codigo = 'T92_B') and recurso = 'labores' and accion = 'ver';

-- ---------------------------------------------------------------------
-- 2 · «Todas las zonas» explícito
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000009202');
update perfiles set todas_las_zonas = false where id = '00000000-0000-0000-0000-000000009202';
select pg_temp.ok(fn_tiene_zonas() and not fn_ve_zona((select id from zonas limit 1))
                  and not fn_ve_zona_estricta((select id from zonas limit 1)),
                  'sin «Todas» y sin zonas: no ve ninguna zona (ya no es «ve todo»)');
insert into perfiles_zonas (perfil_id, zona_id) select '00000000-0000-0000-0000-000000009202', id from zonas order by nombre limit 1;
select pg_temp.ok(fn_ve_zona((select id from zonas order by nombre limit 1))
                  and not fn_ve_zona((select id from zonas order by nombre offset 1 limit 1)),
                  'con una zona: ve esa y no las demás');
update perfiles set todas_las_zonas = true where id = '00000000-0000-0000-0000-000000009202';
select pg_temp.ok(not fn_tiene_zonas() and fn_ve_zona((select id from zonas order by nombre offset 1 limit 1)),
                  'con «Todas»: ve todas las zonas');
select pg_temp.ok(not fn_ve_zona_estricta((select id from zonas order by nombre offset 1 limit 1)),
                  'las vistas estrictas (Desinfección, Trasplante) no cambian: solo zonas marcadas');

-- Fertirriego zonal sí respeta «Todas»
insert into permisos (rol_id, recurso, accion, alcance)
select id, 'fertirriego', 'ver', 'zonal' from roles where codigo = 'T92_B' on conflict do nothing;
select pg_temp.ok(fn_fert_puede((select id from estaciones_riego where zona_id is not null limit 1), 'ver'),
                  'Fertirriego «Estaciones de sus zonas» + «Todas las zonas»: ve cualquier estación con zona');
update perfiles set todas_las_zonas = false where id = '00000000-0000-0000-0000-000000009202';
select pg_temp.ok(not fn_fert_puede((select e.id from estaciones_riego e where e.zona_id is not null
                                     and e.zona_id <> (select id from zonas order by nombre limit 1) limit 1), 'ver'),
                  'sin «Todas»: solo las estaciones de sus zonas');
update perfiles set todas_las_zonas = true where id = '00000000-0000-0000-0000-000000009202';

-- ---------------------------------------------------------------------
-- 3 · Guardar varios permisos, copiar rol, eliminar rol
-- ---------------------------------------------------------------------
select pg_temp.como((select p.id from perfiles p join roles r on r.id = p.rol_id where r.acceso_total limit 1));
select pg_temp.ok(fn_guardar_permisos_rol((select id from roles where codigo = 'T92_A'), jsonb_build_array(
        jsonb_build_object('recurso', 'horometros', 'accion', 'crear', 'permitido', true, 'alcance', 'zonal'),
        jsonb_build_object('recurso', 'horometros', 'accion', 'editar', 'permitido', true, 'alcance', 'zonal'),
        jsonb_build_object('recurso', 'labores', 'accion', 'ver', 'permitido', false))) = 3,
    'guardar varios permisos de un golpe');
select pg_temp.ok((select permitido and alcance = 'zonal' from permisos p join roles r on r.id = p.rol_id
                   where r.codigo = 'T92_A' and recurso = 'horometros' and accion = 'ver'),
                  'encender una acción enciende «Ver» con el mismo alcance');
do $$ begin
    perform fn_guardar_permisos_rol((select id from roles where codigo = 'T92_A'), jsonb_build_array(
        jsonb_build_object('recurso', 'horometros', 'accion', 'eliminar', 'permitido', true),
        jsonb_build_object('recurso', 'horometros', 'accion', 'no_existe', 'permitido', true)));
    raise exception 'FALLA: se guardó una acción inexistente';
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'ok  todo o nada: una acción inválida no deja nada a medias';
end $$;
select pg_temp.ok(not exists (select 1 from permisos p join roles r on r.id = p.rol_id
                              where r.codigo = 'T92_A' and recurso = 'horometros' and accion = 'eliminar'),
                  'no quedó la parte válida del lote fallido');

select pg_temp.ok(fn_copiar_rol((select id from roles where codigo = 'T92_A'), 'Prueba 92 copia') is not null, 'copiar rol');
select pg_temp.ok((select count(*) from permisos p join roles r on r.id = p.rol_id where r.nombre = 'Prueba 92 copia')
                  = (select count(*) from permisos p join roles r on r.id = p.rol_id where r.codigo = 'T92_A'),
                  'la copia tiene los mismos permisos');

do $$ begin
    perform fn_eliminar_rol((select id from roles where codigo = 'T92_B'));
    raise exception 'FALLA: se eliminó un rol en uso';
exception when sqlstate '2BP01' then raise notice 'ok  no se elimina un rol que alguien tiene (aunque sea secundario)';
end $$;
select fn_eliminar_rol((select id from roles where nombre = 'Prueba 92 copia'));
select pg_temp.ok(not exists (select 1 from roles where nombre = 'Prueba 92 copia'), 'eliminar un rol sin personas');

-- Borrar una persona arrastra sus roles (el candado del principal no estorba)
delete from perfiles where id = '00000000-0000-0000-0000-000000009202';
select pg_temp.ok(not exists (select 1 from seguridad.perfiles_roles where perfil_id = '00000000-0000-0000-0000-000000009202'),
                  'borrar una persona borra sus roles');

-- ---------------------------------------------------------------------
-- 4 · La tabla de roles por persona NO está en «public» (si estuviera, la API haría ambigua la consulta
--     perfiles → roles con que se entra a la aplicación) y se maneja por funciones
-- ---------------------------------------------------------------------
select pg_temp.ok(to_regclass('public.perfiles_roles') is null and to_regclass('seguridad.perfiles_roles') is not null,
                  'perfiles_roles vive fuera de «public»: no rompe perfiles?select=*,roles(*)');
select pg_temp.ok((select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
                   join pg_namespace n on n.oid = t.relnamespace
                   where n.nspname = 'public' and c.contype = 'f' and c.confrelid = 'public.roles'::regclass) =
                  (select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid
                   join pg_namespace n on n.oid = t.relnamespace
                   where n.nspname = 'public' and c.contype = 'f' and c.confrelid = 'public.roles'::regclass
                     and t.relname in ('perfiles', 'permisos', 'navegacion_rol')),
                  'en «public» solo perfiles, permisos y navegacion_rol apuntan a roles (como antes)');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000009203', 'p3@prueba.local') on conflict do nothing;
insert into perfiles (id, nombre, rol_id) select '00000000-0000-0000-0000-000000009203', 'Persona asignar', id from roles where codigo = 'T92_A';
select fn_asignar_roles('00000000-0000-0000-0000-000000009203',
                        array[(select id from roles where codigo = 'T92_A'), (select id from roles where codigo = 'T92_B')]::smallint[],
                        (select id from roles where codigo = 'T92_B'));
select pg_temp.ok((select rol_id = (select id from roles where codigo = 'T92_B') from perfiles where id = '00000000-0000-0000-0000-000000009203')
                  and (select count(*) = 2 from seguridad.perfiles_roles where perfil_id = '00000000-0000-0000-0000-000000009203'),
                  'fn_asignar_roles: dos roles y cambia el principal');
select fn_asignar_roles('00000000-0000-0000-0000-000000009203',
                        array[(select id from roles where codigo = 'T92_A')]::smallint[], (select id from roles where codigo = 'T92_A'));
select pg_temp.ok((select array_agg(rol_id) = array[(select id from roles where codigo = 'T92_A')]
                   from seguridad.perfiles_roles where perfil_id = '00000000-0000-0000-0000-000000009203'),
                  'fn_asignar_roles: queda exactamente lo pedido');
select pg_temp.ok((select count(*) >= 3 from fn_roles_de_perfiles()), 'fn_roles_de_perfiles lista los roles');
delete from perfiles where id = '00000000-0000-0000-0000-000000009203';

select pg_temp.como(null);
select 'TODAS LAS PRUEBAS OK' as resultado;
