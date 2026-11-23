-- =====================================================================
-- EQUIVALENCIA de la 130 · SOLO EN LA RÉPLICA LOCAL (clon de producción)
-- «Foto» de lo que puede cada persona existente, antes y después de correr la 130:
--   psql ... -d <base> -v etapa=antes   -f pruebas/sql/130_equivalencia.sql   (antes de la 130)
--   psql ... -d <base> -v etapa=despues -f pruebas/sql/130_equivalencia.sql   (después)
-- Luego:  select * from qa_foto130_diferencias;   → debe venir vacío (las filas NUEVAS de «motores» se excluyen de la foto;
--         aparte se comprueba que nadie las recibe sin tener fertirriego · aplicar / anular, y «configurar» nadie).
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table if not exists public.qa_foto130 (etapa text, perfil uuid, prueba text, valor text, primary key (etapa, perfil, prueba));
delete from public.qa_foto130 where etapa = :'etapa';
select set_config('qa.etapa', :'etapa', false);

do $$
declare p record; pa record; a text; etapa text := current_setting('qa.etapa');
begin
    for p in select id from public.perfiles where id::text not like '00000000-0000-0000-0000-%' order by id loop
        perform set_config('request.jwt.claim.sub', p.id::text, false);
        insert into public.qa_foto130 values (etapa, p.id, 'es_admin', public.fn_es_admin()::text);
        for pa in select codigo, acciones from public.pantallas where codigo <> 'motores' loop
            foreach a in array pa.acciones loop
                insert into public.qa_foto130 values
                    (etapa, p.id, 'tiene:' || pa.codigo || ':' || a, public.fn_tiene_permiso(pa.codigo, a)::text),
                    (etapa, p.id, 'alcance:' || pa.codigo || ':' || a, public.fn_mi_alcance(pa.codigo, a));
            end loop;
        end loop;
    end loop;
end $$;

create or replace view public.qa_foto130_diferencias as
select a.perfil, a.prueba, a.valor as antes, d.valor as despues
  from public.qa_foto130 a
  full join public.qa_foto130 d on d.perfil = a.perfil and d.prueba = a.prueba and d.etapa = 'despues'
 where a.etapa = 'antes' and a.valor is distinct from d.valor;

select 'motores · permisos concedidos que NO se justifican (debe ser 0)' as comprobacion, count(*) as filas
  from public.permisos c
 where c.recurso = 'motores'
   and not (
        (c.accion in ('ver', 'registrar') and exists (select 1 from public.permisos f where f.rol_id = c.rol_id and f.recurso = 'fertirriego' and f.accion = 'aplicar' and f.permitido))
     or (c.accion = 'anular' and exists (select 1 from public.permisos f where f.rol_id = c.rol_id and f.recurso = 'fertirriego' and f.accion = 'anular' and f.permitido)));
