-- Pruebas de sql/110 (réplica; después de la 109). psql -v adm=<uuid admin> -v turno=<turnos_ciclo.id> -f
begin;
create temp table r (n serial, ok boolean, prueba text);
select set_config('request.jwt.claim.sub', :'adm', true);
select public.fn_agm_guardar_calicata(jsonb_build_object('turno_ciclo_id', :'turno', 'latitud', 13.4087, 'longitud', -87.5359, 'precision_m', 12, 'lecturas', 4)) as a \gset
insert into r(ok, prueba) select (:'a'::jsonb ->> 'cambio')::boolean and (:'a'::jsonb -> 'calicata' ->> 'precision_m')::numeric = 12, 'primera ubicación con su precisión';
select public.fn_agm_guardar_calicata(jsonb_build_object('turno_ciclo_id', :'turno', 'latitud', 13.5, 'longitud', -87.6, 'precision_m', 30)) as b \gset
insert into r(ok, prueba) select not (:'b'::jsonb ->> 'cambio')::boolean and (:'b'::jsonb -> 'calicata' ->> 'latitud')::numeric = 13.4087, 'una medición peor NO la mueve';
select public.fn_agm_guardar_calicata(jsonb_build_object('turno_ciclo_id', :'turno', 'latitud', 13.40871, 'longitud', -87.53591, 'precision_m', 3.5)) as c \gset
insert into r(ok, prueba) select (:'c'::jsonb ->> 'cambio')::boolean and (:'c'::jsonb -> 'calicata' ->> 'precision_m')::numeric = 3.5, 'una más precisa la mejora';
do $$ begin perform public.fn_agm_guardar_calicata('{"turno_ciclo_id":"00000000-0000-0000-0000-000000000000","latitud":1,"longitud":1,"precision_m":1}'); insert into r(ok, prueba) values (false, 'turno inexistente rechazado');
exception when others then insert into r(ok, prueba) values (true, 'turno inexistente rechazado'); end $$;
insert into r(ok, prueba) select (select count(*) from agm_calicatas) = 1, 'una sola calicata por turno y ciclo';
select n, case when ok then 'OK' else 'FALLO' end, prueba from r order by n;
select count(*) filter (where ok) || '/' || count(*) from r;
rollback;
