-- =====================================================================
-- PRUEBAS de sql/97 · SOLO EN LA RÉPLICA LOCAL (después de la 93)
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
    raise notice 'ok  % (%)', p_msg, left(sqlerrm, 90);
end $$;
set client_min_messages = notice;

-- Datos: jefe (Usuarios zonal) en Z1; estacionero y digitador de Z1 (ambos «delegable», como el caso del usuario);
-- estacionero de Z2; uno con estacionero + digitador; un administrador.
do $$
declare r_jefe smallint; r_est smallint; r_dig smallint; r_adm smallint; z1 uuid; z2 uuid;
begin
    select id into z1 from zonas order by nombre limit 1;
    select id into z2 from zonas order by nombre offset 1 limit 1;
    insert into roles (codigo, nombre) values ('T97_JEFE', 'P97 Jefe de zona') on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, delegable) values ('T97_EST', 'P97 Estacionero', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, delegable) values ('T97_DIG', 'P97 Digitador de campo', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre, acceso_total) values ('T97_ADM', 'P97 Admin', true) on conflict (codigo) do nothing;
    select id into r_jefe from roles where codigo = 'T97_JEFE';
    select id into r_est from roles where codigo = 'T97_EST';
    select id into r_dig from roles where codigo = 'T97_DIG';
    select id into r_adm from roles where codigo = 'T97_ADM';
    insert into permisos (rol_id, recurso, accion, alcance) values
        (r_jefe, 'usuarios', 'ver', 'zonal'), (r_jefe, 'usuarios', 'editar', 'zonal'), (r_jefe, 'usuarios', 'crear', 'zonal'),
        (r_jefe, 'permisos', 'ver', 'global')
    on conflict (rol_id, recurso, accion) do nothing;
    insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-000000009701', 'j@97'), ('00000000-0000-0000-0000-000000009702', 'e1@97'),
        ('00000000-0000-0000-0000-000000009703', 'd1@97'), ('00000000-0000-0000-0000-000000009704', 'e2@97'),
        ('00000000-0000-0000-0000-000000009705', 'ed@97'), ('00000000-0000-0000-0000-000000009706', 'adm@97'),
        ('00000000-0000-0000-0000-000000009707', 'nueva@97')
    on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000009701', 'Jefe Z1', r_jefe, false),
        ('00000000-0000-0000-0000-000000009702', 'Estacionero Z1', r_est, false),
        ('00000000-0000-0000-0000-000000009703', 'Digitador Z1', r_dig, false),
        ('00000000-0000-0000-0000-000000009704', 'Estacionero Z2', r_est, false),
        ('00000000-0000-0000-0000-000000009705', 'Est+Dig Z1', r_est, false),
        ('00000000-0000-0000-0000-000000009706', 'Admin', r_adm, true),
        ('00000000-0000-0000-0000-000000009707', 'Nueva sin zonas', r_est, false)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000009701', r_jefe), ('00000000-0000-0000-0000-000000009702', r_est),
        ('00000000-0000-0000-0000-000000009703', r_dig), ('00000000-0000-0000-0000-000000009704', r_est),
        ('00000000-0000-0000-0000-000000009705', r_est), ('00000000-0000-0000-0000-000000009705', r_dig),
        ('00000000-0000-0000-0000-000000009706', r_adm), ('00000000-0000-0000-0000-000000009707', r_est)
    on conflict do nothing;
    insert into perfiles_zonas values
        ('00000000-0000-0000-0000-000000009701', z1), ('00000000-0000-0000-0000-000000009702', z1),
        ('00000000-0000-0000-0000-000000009703', z1), ('00000000-0000-0000-0000-000000009704', z2),
        ('00000000-0000-0000-0000-000000009705', z1)
    on conflict do nothing;
end $$;

-- 1 · SIN listas: igual que la 93 (equivalencia para producción)
select pg_temp.como('00000000-0000-0000-0000-000000009701');
select pg_temp.ok(not fn_administro_por_lista(), 'sin listas configuradas: manda la marca «delegable»');
select pg_temp.ok(fn_puedo_editar_persona('00000000-0000-0000-0000-000000009702'), 'sin listas: el jefe edita al estacionero de su zona (como antes)');
select pg_temp.ok(fn_puedo_editar_persona('00000000-0000-0000-0000-000000009703'), 'sin listas: el jefe edita al digitador delegable de su zona (como antes: el problema del usuario)');
select pg_temp.ok(not fn_puedo_editar_persona('00000000-0000-0000-0000-000000009704', true), 'sin listas: no ve a alguien de otra zona');

-- 2 · Solo un administrador configura listas
select pg_temp.falla($q$ select fn_guardar_roles_administra((select id from roles where codigo='T97_JEFE'), array[(select id from roles where codigo='T97_EST')]) $q$,
                     'el jefe NO puede configurar qué administra su rol');
select pg_temp.como('00000000-0000-0000-0000-000000009706');
select pg_temp.falla($q$ select fn_guardar_roles_administra((select id from roles where codigo='T97_JEFE'), array[(select id from roles where codigo='T97_ADM')]) $q$,
                     'no se puede administrar un rol con acceso total');
select pg_temp.falla($q$ select fn_guardar_roles_administra((select id from roles where codigo='T97_JEFE'), array[(select id from roles where codigo='T97_JEFE')]) $q$,
                     'un rol no se administra a sí mismo');
select fn_guardar_roles_administra((select id from roles where codigo='T97_JEFE'), array[(select id from roles where codigo='T97_EST')]);
select pg_temp.ok((select count(*) from fn_roles_administra() where rol_id = (select id from roles where codigo='T97_JEFE')) = 1,
                  'el administrador guarda: Jefe de zona administra Estacionero');

-- 3 · CON lista: el jefe solo administra estacioneros de su zona
select pg_temp.como('00000000-0000-0000-0000-000000009701');
select pg_temp.ok(fn_administro_por_lista(), 'con lista: manda la lista');
select pg_temp.ok(array(select fn_roles_que_administro()) = array[(select id from roles where codigo='T97_EST')], 'roles que administra el jefe: solo Estacionero');
select pg_temp.ok(fn_puedo_editar_persona('00000000-0000-0000-0000-000000009702'), 'edita al estacionero de su zona');
select pg_temp.ok(not fn_puedo_editar_persona('00000000-0000-0000-0000-000000009703'), 'NO edita al digitador de su zona');
select pg_temp.ok(not fn_puedo_editar_persona('00000000-0000-0000-0000-000000009703', true), 'ni lo ve en la lista (no depende de él)');
select pg_temp.ok(not fn_puedo_editar_persona('00000000-0000-0000-0000-000000009705'), 'NO edita a quien es estacionero Y digitador');
select pg_temp.ok(not fn_puedo_editar_persona('00000000-0000-0000-0000-000000009704', true), 'no ve al estacionero de otra zona');
select pg_temp.ok(fn_puedo_editar_persona('00000000-0000-0000-0000-000000009707', true), 've al estacionero recién creado sin zonas');
select pg_temp.ok(not fn_puedo_editar_persona('00000000-0000-0000-0000-000000009706', true), 'no ve al administrador');
select pg_temp.ok(fn_motivo_no_asignar(array[(select id from roles where codigo='T97_EST')], false, array[(select id from zonas order by nombre limit 1)]) is null,
                  'puede dar Estacionero en su zona');
select pg_temp.ok(fn_motivo_no_asignar(array[(select id from roles where codigo='T97_DIG')], false, array[(select id from zonas order by nombre limit 1)]) like 'Solo puedes asignar los roles que administra tu rol: P97 Estacionero%',
                  'no puede dar Digitador (y dice cuáles sí)');
select pg_temp.ok(fn_motivo_no_asignar(array[(select id from roles where codigo='T97_EST')], false, array[(select id from zonas order by nombre offset 1 limit 1)]) = 'Solo puedes asignar tus zonas.',
                  'no puede dar otra zona');
select pg_temp.falla($q$ select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009702', array[(select id from roles where codigo='T97_DIG')], null, null, null) $q$,
                     'no puede convertir al estacionero en digitador');
select pg_temp.falla($q$ select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009703', null, null, null, array[(select id from zonas order by nombre limit 1)]) $q$,
                     'no puede tocar las zonas del digitador');
select fn_guardar_accesos_persona('00000000-0000-0000-0000-000000009707', array[(select id from roles where codigo='T97_EST')], null, null, array[(select id from zonas order by nombre limit 1)]);
select pg_temp.ok(exists (select 1 from perfiles_zonas where perfil_id = '00000000-0000-0000-0000-000000009707'), 'asigna su zona a un estacionero nuevo');

-- 4 · El administrador sigue administrando a todos
select pg_temp.como('00000000-0000-0000-0000-000000009706');
select pg_temp.ok(fn_puedo_editar_persona('00000000-0000-0000-0000-000000009703') and fn_puedo_editar_persona('00000000-0000-0000-0000-000000009704'),
                  'el administrador edita a todos');

-- 5 · Quitar la lista: vuelve a como estaba
select fn_guardar_roles_administra((select id from roles where codigo='T97_JEFE'), array[]::smallint[]);
select pg_temp.como('00000000-0000-0000-0000-000000009701');
select pg_temp.ok(not fn_administro_por_lista() and fn_puedo_editar_persona('00000000-0000-0000-0000-000000009703'), 'sin lista otra vez: comportamiento de la 93');

-- 6 · PostgREST: la tabla nueva NO está en public (no vuelve ambiguo perfiles?select=*,roles(*))
select pg_temp.ok(to_regclass('public.roles_administra') is null and to_regclass('seguridad.roles_administra') is not null, 'tabla fuera de public');
select pg_temp.ok((select count(*) from information_schema.table_constraints tc join information_schema.constraint_column_usage cu using (constraint_name)
                   where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY' and cu.table_name = 'roles' and tc.table_name = 'perfiles') = 1,
                  'perfiles sigue con UNA sola relación hacia roles en public');

\echo '---- 97: todas las pruebas pasaron'
