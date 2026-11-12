-- =====================================================================
-- EQUIVALENCIA de la 92 · SOLO EN LA RÉPLICA LOCAL
-- «Foto» de lo que puede cada persona existente, para comparar antes y después de correr la 92.
--   psql ... -d <base> -v etapa=antes   -f pruebas/sql/92_equivalencia.sql   (antes de la 92)
--   psql ... -d <base> -v etapa=despues -f pruebas/sql/92_equivalencia.sql   (después)
-- Y luego:  select * from qa_foto_diferencias;   → debe venir vacío.
-- =====================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table if not exists public.qa_foto (
    etapa text, perfil uuid, prueba text, valor text,
    primary key (etapa, perfil, prueba)
);
delete from public.qa_foto where etapa = :'etapa';
select set_config('qa.etapa', :'etapa', false);

do $$
declare
    p record; z record; pa record; a text; etapa text := current_setting('qa.etapa');
begin
    for p in select id from public.perfiles where id::text not like '00000000-0000-0000-0000-%' order by id loop
        perform set_config('request.jwt.claim.sub', p.id::text, false);

        insert into public.qa_foto values
            (etapa, p.id, 'es_admin', public.fn_es_admin()::text),
            (etapa, p.id, 'es_invitado', public.fn_es_invitado()::text),
            (etapa, p.id, 'tiene_zonas', public.fn_tiene_zonas()::text),
            (etapa, p.id, 'mis_permisos',
             (select string_agg(recurso || ':' || accion || '=' || alcance || '/' || condicion, ',' order by recurso, accion)
              from public.fn_mis_permisos()));

        for z in select id, nombre from public.zonas loop
            insert into public.qa_foto values
                (etapa, p.id, 've_zona:' || z.nombre, public.fn_ve_zona(z.id)::text),
                (etapa, p.id, 've_zona_estricta:' || z.nombre, public.fn_ve_zona_estricta(z.id)::text);
        end loop;
        insert into public.qa_foto values (etapa, p.id, 've_zona:null', public.fn_ve_zona(null)::text);

        for pa in select codigo, acciones from public.pantallas where codigo not like 'fertirriego%' loop
            insert into public.qa_foto values (etapa, p.id, 've_todo:' || pa.codigo, public.fn_ve_todo(pa.codigo)::text);
            foreach a in array pa.acciones loop
                insert into public.qa_foto values
                    (etapa, p.id, 'permiso:' || pa.codigo || ':' || a,
                     (select permitido || '/' || alcance || '/' || condicion from public.fn_permiso_de(pa.codigo, a))),
                    (etapa, p.id, 'tiene:' || pa.codigo || ':' || a, public.fn_tiene_permiso(pa.codigo, a)::text),
                    (etapa, p.id, 'alcance:' || pa.codigo || ':' || a, public.fn_mi_alcance(pa.codigo, a));
            end loop;
        end loop;

        -- Lotes y tickets que ve (las funciones de visibilidad de la 41/42/66)
        insert into public.qa_foto values
            (etapa, p.id, 'lotes_ve', (select count(*) filter (where public.fn_ve_lote(id))::text from public.lotes_temporada)),
            (etapa, p.id, 'lotes_ve_estricto', (select count(*) filter (where public.fn_ve_lote_estricto(id))::text from public.lotes_temporada)),
            (etapa, p.id, 'tickets_ve', (select count(*) filter (where public.fn_ve_ticket(id))::text from public.tickets));
    end loop;
    perform set_config('request.jwt.claim.sub', '', false);
end $$;

create or replace view public.qa_foto_diferencias as
select coalesce(a.perfil, d.perfil) as perfil, coalesce(a.prueba, d.prueba) as prueba,
       a.valor as antes, d.valor as despues
from (select * from public.qa_foto where etapa = 'antes') a
full join (select * from public.qa_foto where etapa = 'despues') d using (perfil, prueba)
where a.valor is distinct from d.valor;

select :'etapa' as etapa, count(*) as datos, count(distinct perfil) as personas from public.qa_foto where etapa = :'etapa';
