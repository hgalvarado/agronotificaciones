-- =====================================================================
-- PRUEBAS de sql/93 · SOLO EN LA RÉPLICA LOCAL (después de la 92)
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
create or replace function pg_temp.falla(p_sql text, p_msg text) returns void language plpgsql as $$
begin
    execute p_sql;
    raise exception 'FALLA: %', p_msg;
exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 80);
end $$;

set client_min_messages = notice;

-- ---------------------------------------------------------------------
-- Datos: rol jefe (usuarios zonal), rol delegable, rol no delegable; zonas Z1 y Z2
-- ---------------------------------------------------------------------
do $$
declare r_jefe smallint; r_dele smallint; r_nodele smallint; z1 uuid; z2 uuid;
begin
    select id into z1 from zonas order by nombre limit 1;
    select id into z2 from zonas order by nombre offset 1 limit 1;
    insert into roles (codigo, nombre) values ('T93_JEFE', 'Prueba 93 jefe') on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, delegable) values ('T93_DELE', 'Prueba 93 delegable', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre) values ('T93_NODELE', 'Prueba 93 no delegable') on conflict (codigo) do nothing;
    select id into r_jefe from roles where codigo = 'T93_JEFE';
    select id into r_dele from roles where codigo = 'T93_DELE';
    select id into r_nodele from roles where codigo = 'T93_NODELE';
    insert into permisos (rol_id, recurso, accion, alcance) values
        (r_jefe, 'usuarios', 'ver', 'zonal'), (r_jefe, 'usuarios', 'editar', 'zonal'), (r_jefe, 'usuarios', 'crear', 'zonal')
    on conflict (rol_id, recurso, accion) do nothing;

    insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-000000009301', 'j@p'), ('00000000-0000-0000-0000-000000009302', 'a@p'),
        ('00000000-0000-0000-0000-000000009303', 'b@p'), ('00000000-0000-0000-0000-000000009304', 'n@p')
    on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000009301', 'Jefe Z1', r_jefe, false),
        ('00000000-0000-0000-0000-000000009302', 'Persona Z1', r_dele, false),
        ('00000000-0000-0000-0000-000000009303', 'Persona Z2', r_dele, false),
        ('00000000-0000-0000-0000-000000009304', 'Nueva sin zonas', r_dele, false)
    on conflict (id) do nothing;
    insert into perfiles_zonas values ('00000000-0000-0000-0000-000000009301', z1), ('00000000-0000-0000-0000-000000009302', z1),
                                      ('00000000-0000-0000-0000-000000009303', z2)
    on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- P5 · Delegación
-- ---------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000009301');
select pg_temp.ok(fn_puedo_editar_persona('00000000-0000-0000-0000-000000009302'), 'el jefe edita a alguien de su zona con rol delegable');
select pg_temp.ok(not fn_puedo_editar_persona('00000000-0000-0000-0000-000000009303', true), 'el jefe no ve a alguien de otra zona');
select pg_temp.ok(fn_puedo_editar_persona('00000000-0000-0000-0000-000000009304', true), 'el jefe ve a alguien recién creado sin zonas');
select pg_temp.ok(not fn_puedo_editar_persona('00000000-0000-0000-0000-000000009301'), 'el jefe no se cambia a sí mismo los accesos');
select pg_temp.ok(not fn_puedo_editar_persona((select p.id from perfiles p join roles r on r.id = p.rol_id where r.acceso_total limit 1), true)
                  or exists (select 1 from perfiles_zonas pz where pz.perfil_id = (select p.id from perfiles p join roles r on r.id = p.rol_id where r.acceso_total limit 1)),
                  'el jefe no ve administradores ajenos a su zona');
select pg_temp.ok((select count(*) from fn_personas_visibles() v where v in ('00000000-0000-0000-0000-000000009303')) = 0,
                  'la lista de Usuarios del jefe no trae otras zonas');

select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009302',
       array[(select id from roles where codigo = 'T93_DELE')]::smallint[], null, false,
       array[(select id from zonas order by nombre limit 1)]::uuid[]);
select pg_temp.ok(true, 'el jefe guarda roles delegables y su zona');

select pg_temp.falla($$select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009302',
       array[(select id from roles where codigo = 'T93_NODELE')]::smallint[])$$, 'el jefe no puede asignar un rol no delegable');
select pg_temp.falla($$select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009302',
       array[(select id from roles where acceso_total limit 1)]::smallint[])$$, 'el jefe no puede dar acceso total');
select pg_temp.falla($$select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009302', null, null, true)$$,
                     'el jefe no puede dar «Todas las zonas»');
select pg_temp.falla($$select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009302', null, null, null,
       array[(select id from zonas order by nombre offset 1 limit 1)]::uuid[])$$, 'el jefe no puede asignar una zona que no es suya');
select pg_temp.falla($$select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009303', null, null, null,
       array[(select id from zonas order by nombre limit 1)]::uuid[])$$, 'el jefe no puede tocar a alguien de otra zona');
select pg_temp.ok(fn_motivo_no_asignar(array[(select id from roles where codigo = 'T93_NODELE')]::smallint[], false, '{}') is not null,
                  'antes de crear: avisa que el rol no es delegable');

-- Un administrador puede todo, menos quitarse a sí mismo el acceso total
select pg_temp.como((select p.id from perfiles p join roles r on r.id = p.rol_id where r.acceso_total limit 1));
select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009303',
       array[(select id from roles where codigo = 'T93_NODELE')]::smallint[], null, true, '{}');
select pg_temp.ok((select todas_las_zonas from perfiles where id = '00000000-0000-0000-0000-000000009303'), 'el administrador asigna lo que sea');
select pg_temp.falla(format($$select fn_guardar_accesos_persona(%L, array[(select id from roles where codigo = 'T93_DELE')]::smallint[])$$,
                            (select p.id from perfiles p join roles r on r.id = p.rol_id where r.acceso_total limit 1)),
                     'nadie se quita a sí mismo el acceso total');

-- ---------------------------------------------------------------------
-- P3 · Historial
-- ---------------------------------------------------------------------
select pg_temp.ok((select count(*) >= 2 from seguridad.bitacora_accesos where perfil_id = '00000000-0000-0000-0000-000000009303'
                   and por = (select p.id from perfiles p join roles r on r.id = p.rol_id where r.acceso_total limit 1)),
                  'el historial guarda quién cambió los accesos de una persona');
update perfiles set nombre = 'Persona Z2 renombrada' where id = '00000000-0000-0000-0000-000000009303';
select pg_temp.ok(not exists (select 1 from seguridad.bitacora_accesos where perfil_id = '00000000-0000-0000-0000-000000009303'
                              and tabla = 'perfiles' and antes->>'nombre' is not null),
                  'cambiar el nombre no ensucia el historial de accesos');
select fn_guardar_permiso((select id from roles where codigo = 'T93_DELE'), 'tickets', 'ver', true, 'zonal', 'sin_restriccion');
select pg_temp.ok((select recurso = 'tickets:ver' and despues->>'alcance' = 'zonal' from fn_historial_accesos((select id from roles where codigo = 'T93_DELE'), null, 5)
                   where tabla = 'permisos' limit 1), 'el historial de un rol muestra el permiso cambiado');
select pg_temp.ok((select count(*) > 0 from fn_historial_accesos(null, '00000000-0000-0000-0000-000000009303', 50)), 'historial de una persona');

-- ---------------------------------------------------------------------
-- P4 · Menú
-- ---------------------------------------------------------------------
select pg_temp.ok((select icono = 'gota' and not en_menu from pantallas where codigo = 'fertirriego'),
                  'Fertirriego trae su ícono y aún no sale en el menú (hasta la Etapa B)');
select pg_temp.ok(not exists (select 1 from pantallas where en_menu), 'ninguna pantalla existente cambia de menú');

select pg_temp.como(null);
select 'TODAS LAS PRUEBAS OK' as resultado;
