# Motores y combustible · rediseño (tanques fijos, custodia por tramos, ayudas visuales)

Fecha: 2026-11-24. Estado: SQL escrito (`sql/147_motores_tanques_custodia.sql`), sin correr. UI y AGL pendientes.
Reemplaza §10 del diseño `2026-11-22-campo-inyeccion-motores-design.md` (el tanque ya NO es «uno por motor que viaja con él»).

## 1. Decisiones del usuario (2026-11-24)
A. El diésel ya no pasa por la bodega de la estación: se recibe y se maneja solo en Motores y combustible (recepción al TANQUE; el suministro no rebaja bodega). Revierte lo de la 144 para el diésel.
B. Hay 30 TANQUES FIJOS (no son del motor ni de una estación). Cada tanque: nombre, zona, capacidad (gal), activo, saldo; se ASIGNA a una estación (puede quedar sin estación).
C. El registro diario rebaja el tanque por lo GASTADO (visor inicial − final); sube con cada suministro; el saldo del libro se compara con el visor.
D. Historial por CUSTODIA: la estación ve solo lo ocurrido mientras el motor estuvo en ella; el auditor / Torre de Control ve todo con línea de tiempo.
E. Mantenimiento corrido por el HORÓMETRO DEL MOTOR (sigue al motor), con semáforo.
F. Seguridad: nada se pierde; anular con motivo ≥ 15 letras (flujo existente); permisos por la matriz.
G. (adicional) Ayudas visuales: claras, dinámicas y de guía rápida; el historial muestra TODOS los campos de la hoja física y señales de incoherencia.

## 2. Modelo de datos (qué cambia)
| Pieza | Antes (130/138/144) | Ahora (147) |
|---|---|---|
| `mot_tanques` | uno por motor, `estacion_id` null = «viaja con el motor» | catálogo FIJO; `estacion_id` = asignación (nullable); `motor_equipo_id` = motor conectado hoy; + `zona_id`, `asignado_at/por`; nombre único (sin mayúsculas) entre activos |
| `mot_tanque_historial` | — | quién asignó el tanque a qué estación y cuándo |
| `mot_custodias` | — | tramos del motor: `ubicacion` (ESTACION/TALLER/RETIRADO), estación, tanque, desde, hasta, `horo_entrada`, `horo_salida`; se abre/cierra al recibir, mover, retirar, taller; un disparador lo revierte al anular o eliminar la asignación |
| `mot_registros` | hoja sin caudal/operador | + `caudal_ini`, `caudal_fin`, `operador` (firma), `dif_visor_gal` (visor − libro), `custodia_id`, `horas_estimadas` + `rend_ref_gal_h` (solo mantenimiento; vacías = fuera de la huella de AGL); `mot_motores.horas_est_desde_mant` |
| diésel | producto de la bodega (`fert_saldos`) | entra al tanque (`mot_recepciones.tanque_id`, libro `mot_movimientos`); la bodega queda como DIESEL_LEGADO (no se mueve) |
| permiso | ver / registrar / motor_* / anular / configurar | + `auditar` (nadie por defecto; admin pasa por `fn_es_admin`) |

Siembra: los 30 tanques del usuario, por nombre, ligando la zona (`zonas`, nombre normalizado «Zona-2A» = «zona 2a») y la estación (`estaciones_riego`) SOLO si el nombre coincide y es único (nunca estaciones de prueba). Los tanques por-motor que creó la 130 en desarrollo NO se borran: se completan si el nombre coincide; los demás quedan como están y se desactivan a mano (`fn_mot_tanque_guardar`, solo sin saldo ni motor).

## 3. Reglas de operación
- **Recibir motor** (`motor_asignar` INSTALADO/DE_VUELTA/TRASLADADO): exige un tanque LIBRE asignado a la estación destino (si hay uno solo se toma solo; si hay varios se elige; si no hay, error que dice a quién pedirlo). Crear tanque nuevo solo con «Configurar» (control de duplicados) o la práctica del modo de pruebas.
- **Mover/retirar/taller**: el tanque SE QUEDA en la estación con su saldo; solo se desconecta el motor. Ya no se pregunta «qué pasa con el diésel» (se ignora `destino_saldo` de envíos viejos). El horómetro de salida/entrada sale de `horometro` o del último del motor.
- **Recibir diésel** (`diesel_recibir`): al tanque (`tanque_id`; un envío con solo `estacion_id` funciona si la estación tiene un solo tanque). Permiso: «Registrar» de Motores + custodia. No toca `fert_*`.
- **Registro diario**: gastado = `visor_ini − visor_fin` (la hoja). `suministro_gal` es lo declarado en la fila (columna «Suministro» de la hoja); si no se escribe, se muestra lo recibido ese día en el tanque. Lo declarado que no esté en recepciones sube el tanque por la diferencia (sin doble conteo). Si el visor final es mayor que el inicial: se acepta solo si hay suministro que lo explique (observación `SUMINISTRO_DURANTE_DIA`); si no, se rechaza en línea. El tanque se realinea con el visor (movimiento visible `AJUSTE_VISOR`) y la diferencia se guarda en `dif_visor_gal` con observación `VISOR_MENOR_QUE_SALDO` / `VISOR_MAYOR_QUE_SALDO` (tolerancia 3 gal). Histórico (140): no mueve el libro.
- **Horas ESTIMADAS (solo para el mantenimiento)**: si el horómetro no avanza (horas del día = 0, es decir lectura final ≤ inicial) pero hay consumo (gastado > 0), el registro guarda `horas_estimadas = gastado ÷ rendimiento de referencia` y `rend_ref_gal_h`. Referencia = mediana de gal/h de los últimos 30 días del PROPIO motor con horas > 0 y consumo > 0, mínimo 5 días válidos (`_mot_rend_referencia`); sin referencia no se estima (`horas_estimadas` null y observación `SIN_RENDIMIENTO_REFERENCIA`). Las horas desde el último mantenimiento = horómetro real + estimadas (sin doble conteo: un día con horas reales nunca se estima); NUNCA suman al horómetro (`horo_ultimo`, `horas` quedan reales). `_mot_recalcular_horas` (anular, eliminar, mantenimiento) recalcula con las estimadas incluidas. El estacionero puede aclarar en observaciones (el registro se acepta igual).
- **Anular** (130, sin cambios; 147 la hace robusta: antes de restaurar tanques quita el motor de todos los de `antes.tanques`, así también se anulan asignaciones guardadas con el orden viejo): motivo obligatorio; solo el último movimiento del motor; revierte el libro y el tramo.

## 4. Historial por custodia (qué ve cada quien)
- **Estacionero / estación**: `fn_mot_estado_campo` entrega registros, recepciones, `tramos` y asignaciones SOLO de las estaciones que ve; los registros llevan la estación donde se asentaron, así que lo de Papalon-1 no aparece en Espino tras el traslado (los policies RLS usan lo mismo). Del motor solo viaja lo que debe seguirlo: último horómetro/visor, horas desde mantenimiento y semáforo. Si el motor regresa, la estación ve de nuevo SU tramo anterior.
- **Auditor** (`auditar`): `fn_mot_motores_resumen()` (motores activos y movidos con dónde están, semáforo y «qué toca») y `fn_mot_ficha_completa(equipo, desde, hasta)`: todos los tramos con resumen (registros, horas, galones gastados/suministrados, rendimiento, días sin registro), línea de tiempo de movimientos con horómetros, TODOS los registros con TODOS los campos y señales. Límite 800 registros (el resto está en AGL).
- **Torre de Control / AGL**: `fn_mot_catalogo_para_agl()` (tanques + tramos); la bajada de registros conserva el cursor y la huella (§7).

## 5. Ayudas visuales (señales y semáforos)
Todas se calculan en la base y viajan en datos (`fn_mot_estado_campo` → `ayuda`, `senales`, `tanques`, `tramos`; la ficha del auditor trae las mismas). **El teléfono puede derivarlas sin red con las mismas reglas** (usa los registros/recepciones/motor que ya tiene en IndexedDB): son funciones puras de los campos de la hoja, listadas aquí.

Principios de UI: una mirada = un color + una frase («Falta el registro de ayer»); lo urgente arriba (rojo > amarillo > verde); cada señal dice el POR QUÉ con números; tocar la señal abre el día; nunca solo color (siempre texto e ícono).

### 5.1 Semáforos del motor (tarjeta del motor)
| Señal | Niveles | Fuente / regla |
|---|---|---|
| Mantenimiento (`_mot_semaforo`) | verde; amarillo si faltan ≤ aviso; rojo vencido; gris sin intervalo | `mot_motores.horas_desde_mant` (horómetro del motor, sigue al motor) contra `intervalo_horas` (motor > modelo > categoría). Aviso = `aviso_horas` del modelo; si no hay, 10 % del intervalo; si no, 50 h. Texto: «Faltan 40 h para el mantenimiento (cada 500 h)» / «Mantenimiento VENCIDO hace 5 h» |
| Registro al día | verde / amarillo (falta ayer o 2 días) / rojo (3 o más) | `fecha_ultimo` contra hoy en UTC-6: «Falta el registro de ayer», «Faltan 4 días sin registro (desde el 20/11)» |
| Tanque | verde / amarillo ≤ 15 % de la capacidad / rojo vacío o sin tanque | `mot_saldos` y `capacidad_gal`: «Tanque bajo: quedan 80 gal (13 % de 600)» |
| Nivel general | peor de los anteriores | `ayuda[i].nivel` |
| «Qué toca ahora» | lista ordenada por urgencia | `ayuda[i].ahora[]`: MANTENIMIENTO, FALTA_REGISTRO, TANQUE, SIN_TANQUE. El teléfono muestra el primero como botón de acción («Registrar ayer», «Registrar mantenimiento», «Recibir diésel») |
| Horas estimadas | texto en el semáforo de mantenimiento | `horas_estimadas` del semáforo: «… · incluye 4 h estimadas» (en la tarjeta, en el detalle y en la ficha del auditor) |
| Al registrar el día | aviso al guardar | observaciones `MANTENIMIENTO_PROXIMO` / `MANTENIMIENTO_VENCIDO` (el teléfono las muestra como banner) |

### 5.2 Señales por día de registro (cada fila del historial)
Cada fila muestra TODOS los campos de la hoja física (fecha, horómetro inicial/final, horas, galones iniciales/finales, gastados, rendimiento gal/h, RPM, suministro, caudal inicial/final, operador/firma, quién y cuándo, observaciones, diferencia con el visor) y debajo sus señales:

| Código | Nivel | Condición (datos del día y del registro anterior del mismo motor) | Texto ejemplo |
|---|---|---|---|
| HORO_RETROCEDE | rojo | `horo_ini < horo_fin_anterior` (sin «horómetro cambiado») | «El horómetro retrocede: inicia en 1000 y el día anterior terminó en 1015.» |
| HORO_SALTA | amarillo | `horo_ini > horo_fin_anterior` | «No continúa… (salto de 5 h).» |
| HUECO_DIAS | amarillo | días entre registros > 1 en la misma estación | «Faltan 2 día(s) sin registro (del 18/11 al 19/11).» |
| VISOR_FALTA / VISOR_SOBRA | rojo / amarillo | `visor_ini` contra `visor_fin_anterior + suministros entre ambos días` (mismo tanque), tolerancia 3 gal | «El visor inicial (120) es menor de lo esperado (130): faltan 10 gal sin explicar.» |
| SALDO_FALTA / SALDO_SOBRA | rojo / amarillo | `dif_visor_gal` (visor inicial − saldo del libro), tolerancia 3 gal | «El tanque debía tener 130 gal y el visor marca 120: faltan 10 gal.» |
| RENDIMIENTO | amarillo (rojo si > 1.75× o < 0.4×) | con ≥ 5 días previos con horas: gal/h fuera de ±35 % de la mediana de los últimos 10 del MISMO motor (compara «gastado» contra horas × rendimiento esperado) | «Gastó 30 gal en 5 h (6 gal/h). Lo normal es 2 gal/h: debió gastar cerca de 10 gal.» |
| HORO_SIN_AVANCE_CON_CONSUMO | amarillo | horas = 0 (horómetro sin avance) y gastado > 0 (reemplaza a CONSUMO_SIN_HORAS) | «Horómetro sin avance con consumo (8 gal): no se tomó o está dañado. Se estimaron 4 h solo para el mantenimiento (referencia 2 gal/h); el horómetro no se modificó.» / sin referencia: «Sin rendimiento de referencia para estimar horas (se necesitan 5 días con horas en los últimos 30).» |
| HORAS_SIN_CONSUMO | amarillo | horas ≥ 1 y gastado = 0 | «Trabajó 6 h y no gastó diésel.» |
| HORAS_IMPOSIBLES | rojo | horas > 24 | «Más de 24 horas en un día.» |
| SIN_RPM | info | sin RPM | «No se anotaron las revoluciones.» |
| Observaciones de captura | info/amarillo | `fert_operaciones.observaciones`: MOTOR_NO_ASIGNADO_EN_FECHA, REGISTRO_HISTORICO, SUMINISTRO_DURANTE_DIA, FUERA_DE_ORDEN… | chips con texto en español |

Fila resumen por tramo (auditor): registros, horas, gal gastados/suministrados, rendimiento promedio, días sin registro, horómetro de entrada → salida.
Calculado en la base: `_mot_semaforo`, `_mot_estado_motor`, `_mot_senales`. Derivable en el teléfono sin red: todas las de §5.2 y los semáforos de §5.1 (necesitan solo `motor` + `registros` + `recepciones` + `tanques` ya sincronizados).

## 6. Riesgos
- **Dos formas de anotar un suministro** (recepción y columna del registro): se evita el doble conteo con la regla «solo la diferencia»; si el estacionero anota ambas con valores distintos, el visor lo delata (`dif_visor_gal`).
- **Visor inicial incluye el suministro** (como la hoja física). Un suministro DURANTE el día con consumo mayor puede dar una diferencia falsa: se explica en la ayuda del formulario.
- **Tanques duplicados**: los de la 130 (por motor) pueden coincidir en estación con los 30 sembrados; el auto-elegir «tanque libre» exige exactamente 1: si hay duplicados, se pide elegir y se pide a Torre de Control desactivar el viejo.
- **Anclas de parches**: la 147 reemplaza por completo `_mot_aplicar_asignacion`, `_mot_op_diesel_recibir` y `_mot_op_registro_diario` (con marcas de 136/138/140/144 en comentarios para que correr esas migraciones DESPUÉS salte sus parches); parcha por texto `fn_mot_estado_campo`, `_mot_filas` y `fn_fert_bodega_general` (se detiene con un mensaje claro si el ancla no está).
- **Huella de bajada a AGL**: las columnas nuevas vacías se quitan de la fila hasheada y `custodia_id` nunca sale, para que lo ya bajado no se marque «cambiado» (lección de la 112).
- **Purga**: `mot_custodias` y `mot_tanque_historial` NO se purgan (son pocas filas y respaldan la auditoría).
- **Modo de pruebas (145)**: la estación de prueba crea sola un tanque de práctica `PRUEBA-T-xxxx` al recibir el motor de práctica; la purga lo borra (FK en cascada). Los tanques reales nunca se asignan a estaciones de prueba (`fn_mot_tanque_asignar` lo rechaza).
- **Rendimiento de `fn_mot_estado_campo`** (statement timeout como Inyección/146): se reescribe completa; las estaciones visibles se calculan UNA vez (`v_ests`) y todo filtra con `estacion_id = any(v_ests)` (la RLS de `mot_custodias` usa `_mot_ests_visibles()` como subselect una vez por consulta); `_mot_filas` y `_mot_senales` también evitan trabajo por fila (el contexto de señales se acota a la ventana −60 días). Respuesta más chica: ventana de registros y recepciones de 45 días (parámetro `p_desde`), tramos y asignaciones acotados (10 por motor), `jsonb_strip_nulls` en las filas (el teléfono debe tratar una clave ausente como null) y los nombres de quien registró van UNA vez en `personas {id: nombre}` (en vez de `registrado_por_nombre` por fila). Objetivo < 1.5 s con 30 motores y ~19 000 registros (admin, estacionero, usuario con recorte de zonas): lo mide Opus.
- Las horas estimadas dependen de la calidad del rendimiento de referencia: un motor nuevo no tiene (primeras 5 jornadas con horas); un motor con horómetro dañado por semanas sigue sumando estimadas (visible en el semáforo y en las señales para que se repare).
- El tanque de la 130 con nombre repetido en catálogo sembrado se ADOPTA una sola vez (capacidad del catálogo; zona y estación si faltan y coinciden); correcciones posteriores con `fn_mot_tanque_guardar` no se pisan.
- El diésel legado de la bodega (144) no se borra: se saca con Devolución a bodega o Conteo.

## 7. Orden de corrida y relación con migraciones anteriores
130 → 136 → 138 → 139 → 140 → 144 → 145 → **147**. Si se vuelve a correr 130, 136, 138, 140, 144 o 145: correr la 147 otra vez (la 144 redefine `_mot_op_diesel_recibir`). Probar: 144>147, 145>147, 147>147, 147>136/138/140 (saltan por marcas), 130..145>147>144>147.
Pruebas viejas que describen el modelo anterior y SE CORREN ANTES de la 147 (no se modificaron): 130 (tanque por motor, CON_EL_MOTOR), 144 (diésel a bodega y suministro que rebaja bodega), 140 («bodega general: diésel del tanque»), 145 (instala con `tanque_nuevo`). Tras la 147 esos casos ya no aplican; `pruebas/sql/147_motores_tanques_custodia.sql` cubre el comportamiento nuevo.

## 8. Qué cambia en el teléfono (`src/lib/motores`, `src/components/motores`)
- `estado.ts` / `useMotores.ts`: leer `ayuda`, `senales`, `tanques`, `tramos`, `permisos.auditar`; guardar en IndexedDB; derivar señales sin red (funciones puras en un archivo nuevo `senales.ts` con las reglas de §5.2); el tipo del registro suma `caudal_ini/fin`, `operador`, `dif_visor_gal`, `registrado_por_nombre`.
- `registroDiario.ts` y `FormRegistroMotor.tsx`: formulario = la hoja (fecha, horómetro ini/fin, galones ini/fin del visor, gastado y rendimiento calculados en pantalla, RPM, suministro, caudal ini/fin, operador, observaciones); gastado = ini − fin; aviso inmediato de las señales antes de guardar (continuidad, visor contra el libro); quitar el cálculo «+ suministro» y el texto que dice que sale de la bodega.
- `FormRecibirDiesel.tsx`: elegir TANQUE (de la estación; uno solo = preseleccionado); ya no se arma el saldo de la bodega; quitar el botón de recibir diésel de la Bodega (la bodega solo muestra DIESEL_LEGADO con la leyenda «usar Devolución o Conteo»).
- `FormMoverMotor.tsx` (+ «Recibir motor»): lista de tanques LIBRES de la estación destino; quitar «¿qué pasa con el diésel?»; quitar «crear tanque nuevo» salvo para quien tiene «Configurar».
- `TarjetaMotor.tsx`: semáforos (mantenimiento, registro, tanque) con texto y el botón «qué toca ahora».
- `VistaHistorialMotor.tsx`: fila por día con TODOS los campos y chips de señal; filtros por señal («solo con alertas»); sección «Tramos» (solo los visibles).
- Nueva vista de auditoría (`auditar`): lista `fn_mot_motores_resumen` (activos / movidos), ficha completa con línea de tiempo y resumen por tramo. Nueva pantalla de administración de tanques (`fn_mot_tanques_listar`, `fn_mot_tanque_guardar`, `fn_mot_tanque_asignar`) para «Configurar».
- Permisos: agregar `auditar` a la matriz visible; no concederlo por defecto.

## 9. Qué cambia en AGL
- Bajada (`motores_bajada.py`): las filas `registro` traen `caudal_ini`, `caudal_fin`, `operador`, `dif_visor_gal` cuando existen (nuevas columnas del Parquet, opcionales); las recepciones nuevas traen `tanque_id` (las de la 144 vienen con tanque null: nivel estación).
- Catálogo nuevo: leer `fn_mot_catalogo_para_agl()` (tanques con zona/estación/saldo y tramos de custodia) y guardarlos en AGL (los 30 tanques son catálogo; AGL puede ser su dueño en `/EQ01` en una fase posterior).
- `motores_analisis.py`: el consumo y el rendimiento se agrupan por TRAMO de custodia (estación) además de por motor; el cuadre de combustible compara por TANQUE (recibido − gastado ± ajustes de visor) y no por estación; usar `dif_visor_gal` y las observaciones `VISOR_*_QUE_SALDO`.
- Mantenimiento: AGL sigue resolviendo intervalo/aviso por modelo (`fn_mot_publicar` sin cambios).

## 10. Notas de QA (2026-11-24)
- **Pruebas previas a la 147 que ya fallaban**: `pruebas/sql/140_*` línea ~109 («la pantalla motores trae las 4 acciones nuevas y eliminar_definitivo») falla IGUAL sin la 147 (lo comprobó Opus); es un defecto de esa prueba/orden de migraciones, anterior a esta migración. No se arregla aquí.
- **Idempotencia de la siembra**: todo tanque creado por la 147 queda con una fila `147:` en `mot_tanque_historial` (con o sin estación); solo se «adopta» un tanque viejo de la 130 que NO tenga esa marca, una única vez, y nunca se pisan cambios hechos con `fn_mot_tanque_guardar`.
- **Orden 145→147→145**: el reemplazo de `_mot_filas` deja el texto `not public._mot_es_prueba(u.equipo_id)` dentro de un comentario, que es la marca con que la 145 decide que ya está parchada.
