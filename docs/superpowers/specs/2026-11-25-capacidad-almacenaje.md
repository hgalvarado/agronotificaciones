# Capacidad de almacenaje de soluciones por estación (sql/152)

## Pedido (usuario, 2026-11-25)
Saber cuánto cabe de cada solución líquida en cada estación: AGL sabe cuánto puede ENVIAR y la estación cuánto puede RECIBIR.
Estándar Calcio 5000, Vegetativa 3000, Generativa 3000, con excepciones por estación. Vegetativa y Generativa pueden prestarse
el tanque (la estación lo declara o AGL lo sugiere por el plan); Calcio nunca. Vista «General» en Fertirriego (no se toca la de Motores).

## Investigación
- La «solución» ya es un MATERIAL de MARA (grupo 1800, unidad L): 103190 Vegetativa, 103191 Generativa, 103192 Calcio. El saldo es
  `fert_saldos(estacion_id, material_id)` en la unidad del material. No hace falta catálogo nuevo: la capacidad cuelga de `materiales.id`.
- Recibir = `_fert_op_recepcion` (sql/99) → `_fert_mover`; el teléfono lee `fn_fert_estado_campo` (parchado por 100/116/131).
- AGL publica con `fn_fert_publicar` (sql/91); aquí una función nueva aparte para no re-parchar la grande.

## Decisiones
1. Tablas: `fert_capacidad_estandar` (por material + `prestable_con`), `fert_capacidad_estacion` (excepciones), `fert_capacidad_prestamos`
   (vigencia, origen ESTACION|AGL, quién). Sin políticas RLS: solo por funciones `security definer`.
2. Prestable solo si la pareja es MUTUA en el estándar (trigger + `fn_fert_publicar_capacidades` ignora parejas de un solo lado). Calcio no
   tiene pareja → jamás. Sin préstamos encadenados ni cruzados.
3. Capacidad efectiva (`_fert_cap_efectiva`): quien cede = 0; quien recibe = base propia + base del que cede. Fecha en UTC-6.
4. Recibir NO se bloquea: si el saldo pasa la efectiva queda la observación `EXCEDE_CAPACIDAD` y el teléfono pide marcar «sí llegó»
   (igual que `SALDO_NEGATIVO`).
5. Permiso nuevo `fertirriego · capacidad` (nivel 3). Sin concesiones automáticas: el administrador y quien el admin elija en Permisos.
6. Dueño = AGL (`data/fertirriego_capacidad/capacidad.json`). Publica con «Publicar a campo» (reemplaza el estándar, las excepciones y los
   préstamos de AGL; los de la estación no se tocan) y lee de la base los préstamos que declararon las estaciones.
7. Sugerencia de envío = min(lo que cabe, plan de los próximos N días − saldo). N configurable (7 por defecto). Sugerencia de préstamo:
   la pareja no tiene saldo ni plan en N días y lo que pide el plan de esta solución pasa de su capacidad.

## Supuestos
- Unidad = L (la del material; el saldo y el plan ya vienen en esa unidad). Valores de arranque en AGL por código MARA (103192/103190/103191),
  solo si existen; después se editan en AGL.
- El saldo que ve AGL es el de la última bajada de campo; el del teléfono incluye lo pendiente de enviar.
- Las estaciones de prueba usan la configuración de su estación real.

## Sin resolver
- Cuándo se vence un préstamo declarado sin «hasta»: sigue hasta que alguien lo quite.
- Una estación no puede quitar un préstamo declarado por AGL (AGL lo reafirma al publicar).
- El préstamo declarado en el teléfono necesita señal (no va por la cola sin señal).
- Cantidad en tránsito (`en_transito`) no se cuenta como ocupada.
- El permiso `capacidad` no se concede a ningún rol; hay que dárselo al estacionero en Permisos.
