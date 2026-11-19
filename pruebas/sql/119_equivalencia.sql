-- Equivalencia de permisos de la 119: correr en una base SIN la 119 (91-118), desde la raíz del repo.
--   psql -d <base sin 119> -v ON_ERROR_STOP=1 -f pruebas/sql/119_equivalencia.sql
-- Solo los roles que tenían «Configurar» en Fertirriego ganan «eliminar_definitivo»; nadie más cambia.
\set ON_ERROR_STOP 1
do $$ declare r1 smallint; r2 smallint; begin
    insert into roles (codigo, nombre) values ('T119E_CFG', 'con configurar'), ('T119E_NO', 'sin configurar') on conflict (codigo) do nothing;
    select id into r1 from roles where codigo = 'T119E_CFG'; select id into r2 from roles where codigo = 'T119E_NO';
    insert into permisos (rol_id, recurso, accion, permitido, alcance) values
        (r1, 'fertirriego', 'configurar', true, 'zonal'), (r1, 'fertirriego', 'ver', true, 'zonal'),
        (r2, 'fertirriego', 'anular', true, 'global'), (r2, 'fertirriego', 'ver', true, 'global')
    on conflict (rol_id, recurso, accion) do update set permitido = true;
end $$;
create table if not exists public.t119_antes as select rol_id, recurso, accion, permitido, alcance::text, condicion::text from permisos;
truncate public.t119_antes;
insert into public.t119_antes select rol_id, recurso, accion, permitido, alcance::text, condicion::text from permisos;
\i sql/119_fertirriego_eliminar_registros.sql
do $$
declare n_nuevos integer; n_cambiados integer; n_perdidos integer; v_malos integer;
begin
    select count(*) into n_perdidos from t119_antes a where not exists (select 1 from permisos p where p.rol_id = a.rol_id and p.recurso = a.recurso and p.accion = a.accion
        and p.permitido = a.permitido and p.alcance::text = a.alcance and p.condicion::text = a.condicion);
    if n_perdidos <> 0 then raise exception 'FALLA: % permisos existentes cambiaron o se perdieron', n_perdidos; end if;
    select count(*) into v_malos from permisos p
     where p.accion = 'eliminar_definitivo' and not exists (select 1 from t119_antes a where a.rol_id = p.rol_id and a.recurso = 'fertirriego' and a.accion = 'configurar' and a.permitido);
    if v_malos <> 0 then raise exception 'FALLA: % roles ganaron el permiso sin tener Configurar', v_malos; end if;
    select count(*) into n_nuevos from permisos p where p.accion = 'eliminar_definitivo';
    if n_nuevos <> (select count(*) from t119_antes where recurso = 'fertirriego' and accion = 'configurar' and permitido) then raise exception 'FALLA: no todos los que tenían Configurar lo recibieron'; end if;
    if not exists (select 1 from permisos where accion = 'eliminar_definitivo' and rol_id = (select id from roles where codigo = 'T119E_CFG') and alcance::text = 'zonal') then raise exception 'FALLA: el rol con Configurar no lo recibió'; end if;
    if exists (select 1 from permisos where accion = 'eliminar_definitivo' and rol_id = (select id from roles where codigo = 'T119E_NO')) then raise exception 'FALLA: el rol sin Configurar lo recibió'; end if;
    -- quitárselo a un rol y volver a correr no lo repone
    delete from permisos where accion = 'eliminar_definitivo' and rol_id = (select id from roles where codigo = 'T119E_CFG');
    raise notice 'ok  equivalencia: % rol(es) con Configurar lo recibieron; ningún permiso existente cambió; nadie más lo ganó', n_nuevos;
end $$;
\i sql/119_fertirriego_eliminar_registros.sql
do $$ begin
    if exists (select 1 from permisos where accion = 'eliminar_definitivo' and rol_id = (select id from roles where codigo = 'T119E_CFG')) then raise exception 'FALLA: se repuso un permiso quitado a propósito'; end if;
    raise notice 'ok  volver a correr no repone lo que se quitó';
end $$;
drop table public.t119_antes;
select 'FIN EQUIVALENCIA 119 OK' as resultado;
