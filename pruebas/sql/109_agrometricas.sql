-- Pruebas de sql/109 (réplica local; auth.uid() lee request.jwt.claim.sub). Uso: psql -v adm=<uuid admin> -v otro=<uuid sin permiso> -v turno=<turnos_ciclo.id> -f
\set ON_ERROR_STOP 0
begin;
create temp table r (n serial, ok boolean, prueba text);
grant all on r to public; grant usage on sequence r_n_seq to public;
select set_config('request.jwt.claim.sub', :'adm', true), set_config('x.t', :'turno', true);
insert into r(ok, prueba) select public.fn_agm_publicar_rangos('[{"parametro":"ph_agua","nombre":"pH agua","minimo":4,"maximo":9}]') = 1, 'publica rangos';
-- hoy en Tegucigalpa − 1
select ((now() at time zone 'America/Tegucigalpa')::date - 1) as ayer \gset
select public.fn_agm_guardar_parametros(jsonb_build_object('id','11111111-1111-1111-1111-111111111111','turno_ciclo_id',:'turno','fecha',:'ayer','ph_agua',797,'tensiometro_12_am',30)) as j1 \gset
insert into r(ok, prueba) select (:'j1'::jsonb ->> 'ddt')::int = (:'ayer'::date - t.fecha_siembra) and (:'j1'::jsonb -> 'fuera_rango') = '["ph_agua"]', 'DDT calculado y pH 797 marcado fuera de rango' from turnos_ciclo t where t.id = :'turno';
select public.fn_agm_guardar_parametros(jsonb_build_object('id','11111111-1111-1111-1111-111111111111','turno_ciclo_id',:'turno','fecha',:'ayer','ce_agua','1,5')) as j2 \gset
insert into r(ok, prueba) select (:'j2'::jsonb ->> 'ce_agua')::numeric = 1.5 and (:'j2'::jsonb ->> 'ph_agua')::numeric = 797, 'reenvío completa (coma decimal) sin borrar lo anterior';
select public.fn_agm_guardar_parametros(jsonb_build_object('id','22222222-2222-2222-2222-222222222222','turno_ciclo_id',:'turno','fecha',:'ayer','ph_agua',7.97)) as j3 \gset
insert into r(ok, prueba) select :'j3'::jsonb ->> 'id' = '11111111-1111-1111-1111-111111111111' and (:'j3'::jsonb -> 'fuera_rango') = '[]'
    and (select count(*) from agm_parametros where turno_ciclo_id = :'turno') = 1, 'otro teléfono, mismo turno y día: completa la misma fila (sin duplicar)';
do $$ begin perform public.fn_agm_guardar_parametros(jsonb_build_object('id', gen_random_uuid(), 'turno_ciclo_id', current_setting('x.t'), 'fecha', (now() + interval '3 day')::date)); insert into r(ok, prueba) values (false, 'futuro rechazado');
exception when others then insert into r(ok, prueba) values (sqlerrm like '%futuros%', 'futuro rechazado'); end $$;
select public.fn_agm_guardar_clima(jsonb_build_object('id','33333333-3333-3333-3333-333333333333','zona_id',(select e.zona_id from turnos_ciclo t join estaciones_riego e on e.id = t.estacion_id where t.id=:'turno'),'fecha',:'ayer','eto',5.1,'viento',3)) as c1 \gset
insert into r(ok, prueba) select (:'c1'::jsonb ->> 'eto')::numeric = 5.1, 'clima por zona y día';
select set_config('request.jwt.claim.sub', :'otro', true);
do $$ begin perform public.fn_agm_guardar_parametros(jsonb_build_object('id', gen_random_uuid(), 'turno_ciclo_id', current_setting('x.t'), 'fecha', current_date - 1)); insert into r(ok, prueba) values (false, 'sin permiso rechazado');
exception when others then insert into r(ok, prueba) values (sqlstate = '42501', 'sin permiso rechazado'); end $$;
select n, case when ok then 'OK' else 'FALLO' end, prueba from r order by n;
select count(*) filter (where ok) || '/' || count(*) as total from r;
rollback;
