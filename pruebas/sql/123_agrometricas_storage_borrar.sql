-- PRUEBAS de sql/123 (NO ejecutadas). psql -v ON_ERROR_STOP=1 -f pruebas/sql/123_agrometricas_storage_borrar.sql
-- Réplica con 91-123. Si no hay storage.objects crea un stub mínimo (con RLS) dentro de la transacción. Termina en ROLLBACK.
\set ON_ERROR_STOP 1
begin;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if p_cond is distinct from true then raise exception 'FALLA: %', p_msg; end if; raise notice 'ok  %', p_msg; end $$;
do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if to_regclass('storage.objects') is null then
        create schema if not exists storage;
        create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid);
        alter table storage.objects enable row level security;
    end if;
    grant usage on schema storage to authenticated;
    grant select, delete on storage.objects to authenticated;
end $$;
\i sql/123_agrometricas_storage_borrar.sql
do $$
declare r1 smallint; r2 smallint;
begin
    insert into roles (codigo, nombre) values ('T123_PUB', 'P123 AGL publicar'), ('T123_NADA', 'P123 sin AGL') on conflict (codigo) do nothing;
    select id into r1 from roles where codigo = 'T123_PUB'; select id into r2 from roles where codigo = 'T123_NADA';
    insert into permisos (rol_id, recurso, accion, permitido, alcance) values
        (r1, 'fertirriego_agl', 'publicar', true, 'global'), (r2, 'agrometricas', 'ver', true, 'global')
    on conflict (rol_id, recurso, accion) do update set permitido = true, alcance = excluded.alcance;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000012301', 'pub@123'), ('00000000-0000-0000-0000-000000012302', 'nada@123') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values
        ('00000000-0000-0000-0000-000000012301', 'Pub 123', r1, true), ('00000000-0000-0000-0000-000000012302', 'Nada 123', r2, true) on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000012301', r1), ('00000000-0000-0000-0000-000000012302', r2) on conflict do nothing;
end $$;
insert into storage.objects (bucket_id, name) values
    ('agrometricas', 'f123/a.jpg'), ('agrometricas', 'f123/b.jpg'), ('otro_bucket_123', 'f123/x.jpg');
grant select on all tables in schema pg_temp to public;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012302', false);
delete from storage.objects where name = 'f123/a.jpg';
select pg_temp.ok((select count(*) = 1 from storage.objects where name = 'f123/a.jpg'), 'sin permiso: no borra (la foto sigue)');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000012301', false);
delete from storage.objects where name = 'f123/a.jpg' and bucket_id = 'agrometricas';
select pg_temp.ok((select count(*) = 0 from storage.objects where name = 'f123/a.jpg'), 'con AGL · publicar: borra la foto');
delete from storage.objects where bucket_id = 'otro_bucket_123';
select pg_temp.ok((select count(*) = 1 from storage.objects where bucket_id = 'otro_bucket_123'), 'otro bucket: no borra aunque tenga permiso');
reset role;
-- idempotencia 123>123: una sola política
\i sql/123_agrometricas_storage_borrar.sql
\i sql/123_agrometricas_storage_borrar.sql
select pg_temp.ok((select count(*) = 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'agm_fotos_borrar'), 'tras repetir la 123 hay una sola política de borrar');
select 'FIN 123 OK' as resultado;
rollback;
