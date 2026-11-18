\set ON_ERROR_STOP 1
set client_min_messages = warning;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000011803', false);
select fn_errores_registrar('[
 {"origen":"pantalla","modulo":"fertirriego","ruta":"/fertirriego","severidad":"error","mensaje":"Cannot read properties of undefined (reading ''find'') con un nombre de producto larguisimo que debe romperse en varias lineas sin recortarse nunca","detalle":{"version":"0.1.0","pila":"TypeError: x\n at a (b.js:1:2)"}},
 {"origen":"sincronizacion","modulo":"fertirriego","severidad":"aviso","codigo":"40001","mensaje":"could not serialize access due to concurrent update","repeticiones":4},
 {"origen":"guardado","modulo":"fertirriego","severidad":"critico","mensaje":"QuotaExceededError: The quota has been exceeded"},
 {"tipo":"latido","version":"0.0.9","pendientes":3,"pendiente_mas_viejo_h":30,"ultima_sync_ok":"2026-11-17T03:00:00Z","en_linea":false,"hora_telefono":"2026-11-18T20:00:00Z","datos":{"navegador":"Chrome Android"}}
]'::jsonb);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000011804', false);
select fn_errores_registrar('[{"tipo":"latido","version":"0.1.0","pendientes":0,"ultima_sync_ok":"2026-11-18T17:00:00Z","en_linea":true,"hora_telefono":"2026-11-18T18:50:00Z"}]'::jsonb);
insert into fert_operaciones (id, tipo, perfil_id, creado_en, recibido_en, resultado, mensaje)
values (gen_random_uuid(), 'aplicacion', '00000000-0000-0000-0000-000000011803', now() - interval '5 hours', now() - interval '1 hour', 'RECHAZADO', 'No alcanza el saldo de PRODUCTO-CON-NOMBRE-MUY-LARGO-PARA-PROBAR-QUE-NO-SE-CORTA en la bodega: quedaría en -5.'),
       (gen_random_uuid(), 'conteo', '00000000-0000-0000-0000-000000011804', now() - interval '2 hours', now() - interval '2 hours', 'ACEPTADO_CON_OBSERVACIONES', null);
update fert_operaciones set observaciones = array['RELOJ'] where resultado = 'ACEPTADO_CON_OBSERVACIONES' and perfil_id = '00000000-0000-0000-0000-000000011804' and tipo = 'conteo';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000011801', false);
\pset tuples_only on
\pset format unaligned
\o resumen.json
select fn_errores_resumen_por_usuario();
\o listar.json
select fn_errores_listar('{"limite":500}');
\o ops.json
select fn_errores_operaciones_fallidas(null, null, null, false);
\o
