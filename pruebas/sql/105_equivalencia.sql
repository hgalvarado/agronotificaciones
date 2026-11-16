-- =====================================================================
-- EQUIVALENCIA de la 105 · SOLO EN LA RÉPLICA LOCAL (clon de producción)
-- «Foto» de lo que puede y ve cada persona existente, y de los datos que NO deben cambiar. Se toma tres veces:
--   antes      (sin la 105)
--   migrada    (con la 105, sin publicar)          → diferencias esperadas: solo la pantalla nueva catalogos_agl
--   publicada  (después de publicar los catálogos)  → diferencias esperadas: lo que el plan pide (ver el informe)
--   psql ... -d <base> -v etapa=antes -f pruebas/sql/105_equivalencia.sql
-- Luego:  select * from qa105_diferencias('antes', 'migrada');
-- Las llaves usan ids (no nombres): renombrar una zona no cuenta como diferencia.
-- =====================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table if not exists public.qa105_foto (
    etapa text, perfil uuid, prueba text, valor text,
    primary key (etapa, perfil, prueba)
);
delete from public.qa105_foto where etapa = :'etapa';
select set_config('qa.etapa', :'etapa', false);

do $$
declare
    p record; z record; pa record; e record; a text; etapa text := current_setting('qa.etapa');
    v_cero uuid := '00000000-0000-0000-0000-000000000000';
    t text;
begin
    -- Datos que la 105 y la publicación NO deben tocar (huella del contenido completo)
    foreach t in array array['tickets', 'registros', 'registro_detalle', 'horometros', 'desinfeccion_plan',
                             'desinfeccion_ejecucion', 'desinfeccion_logistica', 'lotes', 'lotes_temporada',
                             'perfiles', 'perfiles_zonas', 'perfiles_estaciones', 'permisos', 'roles',
                             'turnos_ciclo', 'fert_plan', 'fert_movimientos', 'fert_saldos', 'fert_custodia',
                             'tarifas_puesto', 'planes', 'rotacion_plan', 'rotacion_avance', 'historial_tasas_temporada',
                             'agm_parametros', 'agm_clima'] loop
        if to_regclass('public.' || t) is not null then
            execute format('insert into public.qa105_foto select %L, %L, %L, (select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) from public.%I x)',
                           etapa, v_cero, 'datos:' || t, '|', '', t);
        end if;
    end loop;
    -- Ids de los catálogos (ninguno debe desaparecer)
    insert into public.qa105_foto values
        (etapa, v_cero, 'ids:zonas', (select md5(string_agg(id::text, ',' order by id)) from public.zonas)),
        (etapa, v_cero, 'ids:temporadas', (select md5(string_agg(id::text, ',' order by id)) from public.temporadas)),
        (etapa, v_cero, 'ids:estaciones', (select md5(string_agg(id::text, ',' order by id)) from public.estaciones_riego)),
        (etapa, v_cero, 'ids:turnos', (select md5(string_agg(id::text, ',' order by id)) from public.turnos));

    for p in select id from public.perfiles where id::text not like '00000000-0000-0000-0000-%' order by id loop
        perform set_config('request.jwt.claim.sub', p.id::text, false);

        insert into public.qa105_foto values
            (etapa, p.id, 'es_admin', public.fn_es_admin()::text),
            (etapa, p.id, 'tiene_zonas', public.fn_tiene_zonas()::text),
            (etapa, p.id, 'mis_permisos',
             (select string_agg(recurso || ':' || accion || '=' || alcance || '/' || condicion, ',' order by recurso, accion)
              from public.fn_mis_permisos() where recurso <> 'catalogos_agl'));

        for z in select id from public.zonas loop
            insert into public.qa105_foto values
                (etapa, p.id, 've_zona:' || z.id, public.fn_ve_zona(z.id)::text),
                (etapa, p.id, 've_zona_estricta:' || z.id, public.fn_ve_zona_estricta(z.id)::text);
        end loop;

        for pa in select codigo, acciones from public.pantallas loop
            foreach a in array pa.acciones loop
                insert into public.qa105_foto values
                    (etapa, p.id, 'tiene:' || pa.codigo || ':' || a, public.fn_tiene_permiso(pa.codigo, a)::text),
                    (etapa, p.id, 'alcance:' || pa.codigo || ':' || a, public.fn_mi_alcance(pa.codigo, a));
            end loop;
        end loop;

        -- Fertirriego: qué estación puede ver / recibir
        for e in select id from public.estaciones_riego loop
            insert into public.qa105_foto values
                (etapa, p.id, 'fert_ver:' || e.id, public.fn_fert_puede(e.id, 'ver')::text),
                (etapa, p.id, 'fert_recibir:' || e.id, public.fn_fert_puede(e.id, 'recibir')::text);
        end loop;

        insert into public.qa105_foto values
            (etapa, p.id, 'lotes_ve', (select count(*) filter (where public.fn_ve_lote(id))::text from public.lotes_temporada)),
            (etapa, p.id, 'tickets_ve', (select count(*) filter (where public.fn_ve_ticket(id))::text from public.tickets)),
            (etapa, p.id, 'turnos_de_sus_zonas', (select count(*) filter (where public.fn_ve_zona(zona_id))::text from public.turnos));
    end loop;
    perform set_config('request.jwt.claim.sub', '', false);
end $$;

create or replace function public.qa105_diferencias(a text, b text)
returns table (perfil text, prueba text, antes text, despues text)
language sql as $$
    select coalesce(pf.nombre, x.perfil::text), x.prueba, x.va, x.vb
    from (select coalesce(fa.perfil, fb.perfil) perfil, coalesce(fa.prueba, fb.prueba) prueba, fa.valor va, fb.valor vb
          from (select * from public.qa105_foto where etapa = a) fa
          full join (select * from public.qa105_foto where etapa = b) fb using (perfil, prueba)
          where fa.valor is distinct from fb.valor) x
    left join public.perfiles pf on pf.id = x.perfil
    order by 1, 2
$$;

select :'etapa' as etapa, count(*) as datos, count(distinct perfil) as personas from public.qa105_foto where etapa = :'etapa';
