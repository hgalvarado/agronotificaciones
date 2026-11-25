-- =====================================================================
-- PRUEBAS de sql/151 · la huella de la vista previa no cambia sola cuando AGL trae una ZONA NUEVA.
-- Réplica local con la 105 (y la 151) y SIN publicaciones previas (p. ej. clon de cat_b). Correr desde la raíz:
--   psql -h localhost -p 5499 -U postgres -d <base> -f pruebas/sql/151_huella_estable.sql
-- Sin la 151 la prueba 1 FALLA (reproduce el error de producción). Todo corre en transacciones que se deshacen.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
\set paquete `cat pruebas/sql/105_paquete_agl.json`

do $$
declare r smallint;
begin
    insert into roles (codigo, nombre, acceso_total) values ('T151_ADM', 'P151 Admin', true) on conflict (codigo) do nothing;
    select id into r from roles where codigo = 'T151_ADM';
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000015101', 'adm@151') on conflict do nothing;
    insert into perfiles (id, nombre, rol_id, todas_las_zonas) values ('00000000-0000-0000-0000-000000015101', 'Admin 151', r, true)
    on conflict (id) do nothing;
    insert into seguridad.perfiles_roles (perfil_id, rol_id) values ('00000000-0000-0000-0000-000000015101', r) on conflict do nothing;
end $$;

create table if not exists public.qa151_paquete (j jsonb);
truncate public.qa151_paquete;
insert into public.qa151_paquete values (:'paquete');

create or replace function public.qa151_ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
    if p_cond is distinct from true then raise exception 'FALLA: %', p_msg; end if;
    raise notice 'ok  %', p_msg;
end $$;
/** Paquete de AGL + zona nueva «I+D» con una estación nueva y un turno nuevo en esa zona. */
create or replace function public.qa151_pq(p_zona text default 'Investigación y Desarrollo (I+D)') returns jsonb language sql as $$
    select jsonb_set(jsonb_set(jsonb_set(j,
        '{zonas}', (j->'zonas') || jsonb_build_array(jsonb_build_object('agl_id', 'QA151-Z', 'nombre', p_zona, 'responsable', 'QA'))),
        '{estaciones}', (j->'estaciones') || jsonb_build_array(jsonb_build_object('agl_id', 'QA151-E', 'nombre', 'Laboratorio QA151',
                                                                                   'zona_agl_id', 'QA151-Z', 'zona', p_zona, 'local_id', 'nueva'))),
        '{turnos}', (j->'turnos') || jsonb_build_array(jsonb_build_object('agl_id', 'QA151-T', 'codigo', 'TQA151-T01',
                                                                         'zona_agl_id', 'QA151-Z', 'zona', p_zona, 'estado', 'Activo')))
    from public.qa151_paquete
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000015101', false);
set client_min_messages = notice;

begin;
create temp table v1 as select public.fn_agl_publicar_catalogos(qa151_pq()) r;
create temp table v2 as select public.fn_agl_publicar_catalogos(qa151_pq()) r;
select qa151_ok((select count(*) from jsonb_array_elements(r->'cambios') x where x->>'catalogo' = 'zonas' and x->>'accion' = 'crear') = 1,
                'la vista previa crea la zona nueva') from v1;
select qa151_ok((select x->'despues'->>'zona_id' from jsonb_array_elements(r->'cambios') x where x->>'nombre' = 'Laboratorio QA151') is not null
                and (select x->'despues'->>'zona_id' from jsonb_array_elements(r->'cambios') x where x->>'nombre' = 'TQA151-T01') is not null,
                'estación y turno nuevos apuntan a la zona nueva') from v1;
-- 1 · sin la 151 esto fallaba siempre
select qa151_ok((select r->>'huella' from v1) = (select r->>'huella' from v2), 'dos vistas previas iguales = misma huella');
-- 3 · publicar con esa huella
create temp table p1 as select public.fn_agl_publicar_catalogos(qa151_pq() || jsonb_build_object('simular', false, 'huella', (select r->>'huella' from v2))) r;
select qa151_ok((select r->>'publicacion' from p1) is not null, 'publica con la huella de la vista previa');
select qa151_ok((select count(*) from zonas where nombre = 'Investigación y Desarrollo (I+D)' and activo) = 1, 'la zona nueva existe');
select qa151_ok((select z.nombre from estaciones_riego e join zonas z on z.id = e.zona_id where e.nombre = 'Laboratorio QA151')
                = 'Investigación y Desarrollo (I+D)', 'la estación nueva con la zona nueva');
select qa151_ok((select z.nombre from turnos t join zonas z on z.id = t.zona_id where t.codigo = 'TQA151-T01')
                = 'Investigación y Desarrollo (I+D)', 'el turno nuevo con la zona nueva');
create temp table v3 as select public.fn_agl_publicar_catalogos(qa151_pq()) r;
select qa151_ok((select count(*) from jsonb_array_elements(r->'cambios') x where x->>'accion' <> 'sin_cambios') = 0,
                'después de publicar: todo sin cambios') from v3;
rollback;

-- 4 · un cambio de verdad (renombrar la zona nueva) sigue rechazándose
begin;
create temp table v4 as select public.fn_agl_publicar_catalogos(qa151_pq()) r;
do $$ begin
    perform public.fn_agl_publicar_catalogos(public.qa151_pq('Zona I+D renombrada')
        || jsonb_build_object('simular', false, 'huella', (select r->>'huella' from v4)));
    raise exception 'FALLA: publicó con la zona renombrada';
exception when raise_exception then
    if sqlerrm like 'FALLA%' then raise; end if;
    if sqlerrm not like 'Los datos cambiaron desde la vista previa%' then raise exception 'FALLA: otro error: %', sqlerrm; end if;
    raise notice 'ok  zona renombrada después de la vista previa: %', sqlerrm;
end $$;
select qa151_ok(not exists (select 1 from zonas where nombre in ('Zona I+D renombrada', 'Investigación y Desarrollo (I+D)')), 'no se creó nada');
rollback;

select set_config('request.jwt.claim.sub', '', false);
drop function public.qa151_ok(boolean, text), public.qa151_pq(text);
drop table public.qa151_paquete;
\echo '151: TODAS LAS PRUEBAS PASARON'
