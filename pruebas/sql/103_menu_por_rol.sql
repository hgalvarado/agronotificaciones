-- =====================================================================
-- PRUEBAS de sql/103 · diseñador de menú por rol (réplica local con 91–101 y sus datos de prueba)
-- Orden: pruebas/sql/103_menu_por_rol_antes.sql → sql/103 (dos veces) → este archivo.
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

-- Personas de la prueba: un administrador (acceso total), uno sin el permiso y uno con dos roles
do $$
declare r_adm smallint; r_a smallint; r_b smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T103_ADM', 'P103 Admin', true) on conflict (codigo) do nothing;
    insert into roles (codigo, nombre) values ('T103_A', 'P103 Campo') on conflict (codigo) do nothing;
    insert into roles (codigo, nombre) values ('T103_B', 'P103 Revisa') on conflict (codigo) do nothing;
    select id into r_adm from roles where codigo = 'T103_ADM';
    select id into r_a from roles where codigo = 'T103_A';
    select id into r_b from roles where codigo = 'T103_B';
    insert into permisos (rol_id, recurso, accion, permitido) values
        (r_a, 'fertirriego', 'ver', true), (r_a, 'tickets', 'ver', true),
        (r_b, 'horometros', 'ver', true), (r_b, 'permisos', 'editar', true)
    on conflict do nothing;
    insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-000000010301', 'adm@103'),
        ('00000000-0000-0000-0000-000000010302', 'campo@103'),
        ('00000000-0000-0000-0000-000000010303', 'dos@103')
    on conflict do nothing;
    insert into perfiles (id, nombre, rol_id) values
        ('00000000-0000-0000-0000-000000010301', 'Admin 103', r_adm),
        ('00000000-0000-0000-0000-000000010302', 'Campo 103', r_a),
        ('00000000-0000-0000-0000-000000010303', 'Dos roles 103', r_b)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values
        ('00000000-0000-0000-0000-000000010301', r_adm),
        ('00000000-0000-0000-0000-000000010302', r_a),
        ('00000000-0000-0000-0000-000000010303', r_b),
        ('00000000-0000-0000-0000-000000010303', r_a)
    on conflict do nothing;
end $$;

create or replace function pg_temp.rol(p text) returns smallint language sql as $$ select id from roles where codigo = p $$;
\set ADM '''00000000-0000-0000-0000-000000010301'''
\set CAMPO '''00000000-0000-0000-0000-000000010302'''
\set DOS '''00000000-0000-0000-0000-000000010303'''

-- ---------------------------------------------------------------------
-- 0 · EQUIVALENCIA: sin menú diseñado, nada cambia para nadie
-- ---------------------------------------------------------------------
select pg_temp.ok(not exists (select 1 from seguridad.menu_rol), 'la 103 no diseña ningún menú');

create temp table permisos_despues (perfil_id uuid, recurso text, accion text, alcance text, condicion text);
create temp table navegacion_despues (perfil_id uuid, pantalla text, orden smallint);
create temp table menu_despues (perfil_id uuid, rol_id smallint, disenado boolean);
do $$
declare v uuid;
begin
    for v in select distinct perfil_id from prueba103.permisos_antes
             union select id from perfiles p where not exists (select 1 from prueba103.permisos_antes a where a.perfil_id = p.id)
                                              and p.id::text not like '00000000-0000-0000-0000-0000000103%' loop
        perform pg_temp.como(v);
        insert into permisos_despues select v, recurso, accion, alcance, condicion from public.fn_mis_permisos();
        insert into navegacion_despues select v, pantalla, orden from public.fn_mi_navegacion();
        insert into menu_despues select v, rol_id, disenado from public.fn_mi_menu();
    end loop;
    perform pg_temp.como(null);
end $$;

-- Lo único nuevo: «permisos:disenar_menu» para quien tiene un rol de acceso total (no solo lectura)
create temp table dif as
    (select 'nuevo' lado, * from permisos_despues except select 'nuevo', * from prueba103.permisos_antes)
    union all
    (select 'quitado', * from prueba103.permisos_antes except select 'quitado', * from permisos_despues);
select pg_temp.ok(not exists (select 1 from dif where lado = 'quitado'), 'a nadie se le quita ningún permiso');
select pg_temp.ok(not exists (select 1 from dif where not (lado = 'nuevo' and recurso = 'permisos' and accion = 'disenar_menu')),
                  'el único permiso nuevo es «Diseñar menú»');
select pg_temp.ok(not exists (
    select 1 from (select distinct perfil_id from dif) d
    where not exists (select 1 from seguridad.perfiles_roles pr join roles r on r.id = pr.rol_id
                      where pr.perfil_id = d.perfil_id and r.acceso_total)),
    '«Diseñar menú» solo lo ganan personas con un rol de acceso total');
select pg_temp.ok((select count(*) from dif) = (select count(distinct a.perfil_id) from prueba103.permisos_antes a
                    where exists (select 1 from seguridad.perfiles_roles pr join roles r on r.id = pr.rol_id
                                  where pr.perfil_id = a.perfil_id and r.acceso_total and not r.solo_lectura)),
                  'y lo ganan TODAS las de acceso total');
select pg_temp.ok(not exists (select * from navegacion_despues except select * from prueba103.navegacion_antes)
                  and not exists (select * from prueba103.navegacion_antes except select * from navegacion_despues),
                  'la barra del teléfono (fn_mi_navegacion) queda idéntica');
select pg_temp.ok(not exists (select 1 from menu_despues where disenado), 'fn_mi_menu: ningún rol diseñado → la app usa el menú de siempre');
select pg_temp.ok((select count(distinct perfil_id) from menu_despues) = (select count(*) from perfiles p
                    where p.id::text not like '00000000-0000-0000-0000-0000000103%'),
                  'fn_mi_menu responde una fila por rol a cada persona');
select pg_temp.ok((select count(*) from menu_despues m join perfiles p on p.id = m.perfil_id where m.rol_id = p.rol_id)
                  = (select count(*) from perfiles p where p.id::text not like '00000000-0000-0000-0000-0000000103%'),
                  'cada persona trae su rol principal');

-- ---------------------------------------------------------------------
-- 1 · Quién puede diseñar
-- ---------------------------------------------------------------------
select pg_temp.como(:ADM);
select pg_temp.ok(fn_tiene_permiso('permisos', 'disenar_menu'), 'el rol de acceso total tiene «Diseñar menú»');
select pg_temp.como(:DOS);
select pg_temp.ok(not fn_tiene_permiso('permisos', 'disenar_menu'), '«Editar» en Permisos no basta');
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'), '[{"tipo":"pantalla","destino":"tickets"}]')$$,
                     'sin «Diseñar menú» no se guarda');
select pg_temp.falla($$select * from fn_menus_roles()$$, 'sin «Diseñar menú» no se listan los menús');
select pg_temp.falla($$select fn_restablecer_menu_rol(pg_temp.rol('T103_A'))$$, 'sin «Diseñar menú» no se restablece');
select pg_temp.falla($$select fn_copiar_menu_rol(pg_temp.rol('T103_A'), pg_temp.rol('T103_B'))$$, 'sin «Diseñar menú» no se copia');
select pg_temp.falla($$select * from fn_menu_permisos_rol(pg_temp.rol('T103_A'))$$, 'sin «Diseñar menú» no hay vista previa');
select pg_temp.como(null);
select pg_temp.ok(not has_table_privilege('authenticated', 'seguridad.menu_rol', 'select')
                  and not has_table_privilege('authenticated', 'seguridad.menu_rol', 'insert')
                  and not has_table_privilege('authenticated', 'seguridad.menu_rol', 'delete'),
                  'authenticated no toca la tabla: solo por funciones');

-- ---------------------------------------------------------------------
-- 2 · Guardar, validar, leer
-- ---------------------------------------------------------------------
select pg_temp.como(:ADM);
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'), '[]')$$, 'un menú vacío no se guarda');
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'), '{"a":1}')$$, 'un menú que no es lista no se guarda');
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'),
    '[{"tipo":"pantalla","destino":"tickets"},{"tipo":"grupo","etiqueta":"X","hijos":[{"destino":"tickets"}]}]')$$,
    'una pantalla repetida no se guarda');
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'),
    '[{"tipo":"grupo","etiqueta":"Campo","hijos":[]},{"tipo":"grupo","etiqueta":"campo","hijos":[]}]')$$,
    'dos grupos con el mismo nombre no se guardan');
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'),
    '[{"tipo":"grupo","etiqueta":"A","hijos":[{"tipo":"grupo","etiqueta":"B","hijos":[]}]}]')$$,
    'no hay grupos dentro de grupos');
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'), '[{"tipo":"grupo","hijos":[]}]')$$,
    'un grupo sin nombre no se guarda');
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'), '[{"tipo":"pantalla","destino":"Tickets; drop"}]')$$,
    'un destino con caracteres raros no se guarda');
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'), '[{"tipo":"pantalla","destino":"tickets","icono":"<svg>"}]')$$,
    'un ícono raro no se guarda');
select pg_temp.falla($$select fn_guardar_menu_rol(pg_temp.rol('T103_A'), '[{"tipo":"pantalla","destino":"tickets"}]', 'costos')$$,
    'la pantalla de inicio tiene que estar en el menú');
select pg_temp.falla($$select fn_guardar_menu_rol(32000::smallint, '[{"tipo":"pantalla","destino":"tickets"}]')$$,
    'un rol que no existe no se guarda');

select pg_temp.ok((fn_guardar_menu_rol(pg_temp.rol('T103_A'),
    '[{"tipo":"grupo","etiqueta":"  Campo  ","icono":"gota","hijos":[{"destino":"fertirriego","etiqueta":"Mi estación"},{"tipo":"pantalla","destino":"tickets","etiqueta":""}]},
      {"tipo":"pantalla","destino":"costos","etiqueta":"Plata","otra":"cosa"}]',
    'fertirriego', false))->>'inicio' = 'fertirriego', 'el administrador guarda el menú del rol Campo');
select pg_temp.ok((select nodos = '[{"tipo":"grupo","etiqueta":"Campo","icono":"gota","hijos":[{"tipo":"pantalla","destino":"fertirriego","etiqueta":"Mi estación"},{"tipo":"pantalla","destino":"tickets"}]},{"tipo":"pantalla","destino":"costos","etiqueta":"Plata"}]'::jsonb
                           and inicio = 'fertirriego' and not incluir_resto and actualizado_por = :ADM
                   from seguridad.menu_rol where rol_id = pg_temp.rol('T103_A')),
                  'se guarda normalizado (sin espacios, sin vacíos, sin campos de más) y con quién lo hizo');
select pg_temp.ok((select count(*) from fn_menus_roles()) = 1, 'fn_menus_roles lista el menú diseñado');
select pg_temp.ok(exists (select 1 from seguridad.bitacora_accesos where tabla = 'menu_rol' and rol_id = pg_temp.rol('T103_A')
                          and por = :ADM), 'queda en el historial de accesos');

-- Guardar de nuevo reemplaza (no duplica)
select fn_guardar_menu_rol(pg_temp.rol('T103_A'),
    '[{"tipo":"grupo","etiqueta":"Campo","icono":"gota","hijos":[{"destino":"fertirriego","etiqueta":"Mi estación"},{"destino":"tickets"}]}]',
    'fertirriego', true);
select pg_temp.ok((select count(*) from seguridad.menu_rol where rol_id = pg_temp.rol('T103_A')) = 1
                  and (select incluir_resto and jsonb_array_length(nodos) = 1 from seguridad.menu_rol where rol_id = pg_temp.rol('T103_A')),
                  'guardar de nuevo reemplaza el menú');

-- Vista previa: lo que puede abrir ese rol
select pg_temp.ok((select array_agg(recurso || ':' || accion order by 1) from fn_menu_permisos_rol(pg_temp.rol('T103_A')))
                  = array['fertirriego:ver', 'tickets:ver'], 'la vista previa trae los permisos del rol Campo');
select pg_temp.ok((select count(*) from fn_menu_permisos_rol(pg_temp.rol('T103_ADM'))) = (select sum(cardinality(acciones)) from pantallas),
                  'un rol de acceso total ve todo en la vista previa');

-- ---------------------------------------------------------------------
-- 3 · Lo que ve cada persona (fn_mi_menu)
-- ---------------------------------------------------------------------
select pg_temp.como(:CAMPO);
select pg_temp.ok((select count(*) = 1 and bool_and(disenado and principal and inicio = 'fertirriego') from fn_mi_menu()),
                  'la persona de Campo recibe su menú diseñado e inicio');
select pg_temp.como(:DOS);
select pg_temp.ok((select array_agg(rol_id::text || ':' || principal || ':' || disenado) from fn_mi_menu())
                  = array[pg_temp.rol('T103_B') || ':true:false', pg_temp.rol('T103_A') || ':false:true'],
                  'con dos roles: principal primero; uno diseñado y el otro con el de siempre');
select pg_temp.como(null);
select pg_temp.ok((select count(*) from fn_mi_menu()) = 0, 'sin sesión no hay menú');

-- El menú no da acceso: la persona de Campo NO gana «costos» por tenerlo en un menú
select pg_temp.como(:ADM);
select fn_guardar_menu_rol(pg_temp.rol('T103_A'),
    '[{"tipo":"pantalla","destino":"costos"},{"tipo":"pantalla","destino":"fertirriego"}]', null, true);
select pg_temp.como(:CAMPO);
select pg_temp.ok(not fn_tiene_permiso('costos', 'ver')
                  and not exists (select 1 from fn_mis_permisos() where recurso = 'costos'),
                  'poner una pantalla en el menú NO da permiso para abrirla');

-- ---------------------------------------------------------------------
-- 4 · Copiar, restablecer, copiar rol
-- ---------------------------------------------------------------------
select pg_temp.como(:ADM);
select pg_temp.falla($$select fn_copiar_menu_rol(pg_temp.rol('T103_A'), pg_temp.rol('T103_A'))$$, 'no se copia un rol sobre sí mismo');
select pg_temp.ok(fn_copiar_menu_rol(pg_temp.rol('T103_A'), pg_temp.rol('T103_B')), 'copiar el menú de Campo a Revisa');
select pg_temp.ok((select b.nodos = a.nodos and b.incluir_resto = a.incluir_resto from seguridad.menu_rol a, seguridad.menu_rol b
                   where a.rol_id = pg_temp.rol('T103_A') and b.rol_id = pg_temp.rol('T103_B')), 'la copia es idéntica');
select pg_temp.ok(not fn_copiar_menu_rol(pg_temp.rol('T103_ADM'), pg_temp.rol('T103_B')), 'copiar de un rol sin diseño responde «no»');
select pg_temp.ok(not exists (select 1 from seguridad.menu_rol where rol_id = pg_temp.rol('T103_B')),
                  'y deja el destino con el menú de siempre');

do $$ begin perform public.fn_copiar_rol((select id from roles where codigo = 'T103_A'), 'P103 Copia'); end $$;
select pg_temp.ok((select m.nodos from seguridad.menu_rol m join roles r on r.id = m.rol_id where r.nombre = 'P103 Copia')
                  = (select nodos from seguridad.menu_rol where rol_id = pg_temp.rol('T103_A')),
                  'copiar un rol (fn_copiar_rol) también copia su menú');
do $$ begin perform public.fn_eliminar_rol((select id from roles where nombre = 'P103 Copia')); end $$;
select pg_temp.ok(not exists (select 1 from seguridad.menu_rol m where not exists (select 1 from roles r where r.id = m.rol_id)),
                  'eliminar el rol borra su menú');

select pg_temp.ok(fn_restablecer_menu_rol(pg_temp.rol('T103_A')), 'restablecer el menú de Campo');
select pg_temp.ok(not fn_restablecer_menu_rol(pg_temp.rol('T103_A')), 'restablecer otra vez no hace nada');
select pg_temp.como(:CAMPO);
select pg_temp.ok((select bool_and(not disenado) from fn_mi_menu()), 'restablecido: vuelve al menú de siempre');

-- ---------------------------------------------------------------------
-- Limpieza: la réplica queda como estaba (menos la foto de la prueba)
-- ---------------------------------------------------------------------
select pg_temp.como(null);
delete from seguridad.menu_rol where rol_id in (select id from roles where codigo like 'T103_%');
delete from perfiles where id::text like '00000000-0000-0000-0000-0000000103%';   -- sus roles se van en cascada
delete from auth.users where id::text like '00000000-0000-0000-0000-0000000103%';
delete from permisos where rol_id in (select id from roles where codigo like 'T103_%');
delete from roles where codigo like 'T103_%';
select pg_temp.ok(not exists (select 1 from seguridad.menu_rol), 'limpieza: sin menús de prueba');
drop schema prueba103 cascade;
\echo 'TODAS LAS PRUEBAS DE LA 103 PASARON'
