# Fertirriego · cambios tras la segunda prueba piloto (2026-11-13)

Contrato entre la base (`sql/100_fertirriego_piloto2.sql`), la app de campo y AGL. Lo de la piloto 1 sigue en
`docs/fertirriego-piloto1.md`.

## Pedidos (resumen)

1. Pestaña Turno: botones Aplicar / Horas grandes (dedo) y en TODAS las tarjetas de DDT.
2. Bitácora: al tocar un registro, primero el DETALLE completo (quién, cuándo, chofer, vehículo, turnos, DDT,
   productos, envases, comentario, ubicación/observaciones). Abajo «Anular» y «Devolver sobrante»; los campos de
   motivo/cantidades aparecen solo al tocar uno. Si no toca ninguno, el pie dice solo «Listo».
3. Bitácora (lista): nombre de quien hizo cada movimiento; filtros por turno, producto, tipo, fecha o rango, cantidad.
4. Envases: entregar/recibir envases SIN recibir producto (el camión pasa a llevar vacíos). Queda con chofer,
   vehículo, quién lo registró, hora y ubicación. Se ve en la bitácora.
5. Productos agrupados por su grupo (sin grupo = «Otros insumos»); Fertilizantes primero y destacados, en bodega,
   conteo y selectores.
6. Calculadora junto a cada cantidad: «bultos × kg por bulto» (9, 12.5, 25, 50, 100…) y operaciones simples; el
   resultado se pone en el campo.
7. AGL: todo lo que se registra en AgroNotificaciones se ve en AGL; comparativo con gráficos de línea Plan · SAP · Real
   y gráficos/tablas de diferencias; análisis para la parte administrativa.

## Base · sql/100

### fn_fert_estado_campo (teléfono) · se agrega
- `nombres`: `{ "<perfil_id>": "Nombre" }` de toda persona que aparece en lo que baja (registrado_por de movimientos,
  recepciones, aplicaciones, conteos y envases; ejecutor/ejecutor2; relevos; custodios).
- `envases_movimientos`: `[{id, estacion_id, envase_id, cantidad, motivo, documento_tipo, documento_id, fecha_hora,
  registrado_por}]` de sus estaciones desde `desde`.
- `conteos`: `[{id, estacion_id, fecha_hora, comentario, registrado_por, anulado_at, motivo_anulacion,
  lineas: [{material_id, saldo_sistema, cantidad_real, diferencia}]}]` desde `desde`.
- `choferes_todos`/`vehiculos_todos` NO: los inactivos se muestran con el nombre que viene en `recepciones[]`:
  cada recepción trae ahora `chofer` (nombre) y `vehiculo` (placa).
- Cada recepción, aplicación y conteo trae `operacion`: `{creado_en, recibido_en, lat, lon, observaciones}` (de
  fert_operaciones), para el detalle.

### Envases sin producto (punto 4)
Ya lo acepta la base desde la 99: operación `recepcion` con `lineas: []` y `envases` (chofer obligatorio). La app lo
ofrece como acción propia «Envases» (Entregar vacíos / Recibir envases). Se guarda `datos.solo_envases = true`
(informativo).

### fn_fert_exportar (AGL) · se agrega (todo, no solo movimientos)
Sin parámetros nuevos. Además de lo de la 99:
- `recepciones`: todas (estaciones reales), con estación, zona, fecha_hora, chofer, vehículo (placa, tipo), documento,
  turnos (códigos), comentario, registrado_por (nombre), creado_en/recibido_en, lat/lon, observaciones, anulado_at,
  motivo_anulacion, `lineas` [{material, texto, unidad, cantidad, origen, grupo, analisis}], `envases`
  [{envase, recibidos, entregados}], `solo_envases`.
- `aplicaciones`: todas, con estación, turno (código, agl_id), fecha, ddt_plan, fecha_plan, extra, ddt_real,
  ejecutor, ejecutor2, registrado_por, comentario, observaciones, anulado, `lineas` [{material, cantidad, en_plan,
  analisis, origen}], `devoluciones` [{material, cantidad, motivo, fecha_hora}].
- `conteos`: todos, con líneas (saldo_sistema, cantidad_real, diferencia).
- `envases_movimientos`: todos, con estación, envase, cantidad, motivo, chofer, vehículo, registrado_por, fecha_hora.
- `relevos`: todos (no solo los «a revisar»), con método, entrega, recibe, fechas, novedades, notas, diferencias.
- `traslados`: todos, con origen, destino, estado, motivo, autorizador, fechas, líneas enviadas/recibidas.
- `rechazados`: operaciones RECHAZADAS de los últimos 90 días (tipo, estación, persona, mensaje, fecha).
Todo excluye las estaciones de prueba.

## AGL (punto 7) · lo decide el agente con este marco
- Guardar todo lo anterior en la carpeta de campo de AGL y mostrarlo en /FR01 (pestañas o secciones).
- Comparativo: tabla + gráficos de línea acumulados Plan · Cargado SAP · Aplicado (real) por turno, por estación y
  por producto (solo fertilizantes), con selector; gráfico de barras de diferencias (Real − Plan, Real − SAP) y
  tabla de diferencias con semáforo.
- Análisis administrativo sugerido: cumplimiento del plan por turno/estación (% aplicado vs plan), atraso de DDT
  (DDT real − DDT plan), aplicaciones extra, consignación (recibido − aplicado) valorizada, diferencias de conteo y
  relevo (posibles pérdidas), envases por estación (salen/entran, saldo), cloro por turno, quién registra qué.
