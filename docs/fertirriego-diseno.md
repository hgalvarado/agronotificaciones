# Fertirriego · Control de producto en estaciones de riego (diseño)

> Estado: **borrador para aprobación del usuario** (2026-11-11). Lo escribe Claude.
> Une AgroNotificaciones (captura en campo, PWA) y AGL (análisis). Supabase es el intermediario.

---

## 1. Objetivo

Saber, por turno y por estación, si se cumple la cadena **Plan asignado → Salida SAP → Aplicación en campo**,
cuánto producto queda en cada estación (incluida la **consignación**, que sale sin cargo en SAP) y quién
tuvo el producto en cada momento. Para evitar pérdidas, robos y errores, y para decidir cuánto mandar.

## 2. Hechos del proceso (confirmados por el usuario)

| Hecho | Consecuencia en el diseño |
|---|---|
| Todo producto (soluciones, hidrosolubles, ácidos) va dentro del turno; toda salida de almacén va a la orden del turno | La comparación 3 vías es **por turno-ciclo y material** |
| Plan y SAP están en **producto terminado** (solución líquida); fábrica la prepara | No se descomponen recetas: se compara a nivel de solución |
| Lo cargado a la orden ya salió del inventario del almacén. Lo que está en la estación sigue siendo inventario del almacén, en un «almacén externo» (la estación) | **Consignación = recibido − aplicado** (el saldo del kardex, digitado por el estacionero). SAP **solo compara**, nunca calcula la consignación |
| Por ahora solo digita el estacionero | Opción administrativa **apagada** «Entrega declarada por el chofer» (ver 4.6) |
| Llega en L o KG sueltos (se llena la estación según capacidad) | Captura directa en la unidad del material, sin envases |
| 1 estacionero por jornada (día y noche) | Concepto de **custodia** y **relevo** de estación |
| Choferes: lista fija ampliable; un chofer usa uno o varios camiones | Catálogos chofer y vehículo (placa, tipo, color, marca), relación muchos a muchos |
| Aplicación: un registro por turno con horas de fertilización, horas de riego, ejecutor, hora inicio/fin (opcionales) | Cabecera de aplicación por turno-día |
| Hay traslados entre estaciones; el que recibe acepta o rechaza | Traslado en dos pasos con producto «en tránsito» |
| Jefes de zona / parametristas = mini-administradores de SUS estaciones | Permisos con alcance zonal + asignación de estaciones |
| Arranque con todas las estaciones (hoy < 10 turnos completos) | Sin piloto; volumen inicial bajo |
| Se empieza con **funcionamiento sin señal** | La app de campo nace «offline-first» |

## 3. Arquitectura

```
AGL (PC)  ── publica ──▶  Supabase  ◀── graba/lee ──  AgroNotificaciones (teléfono, sin señal OK)
          ◀── baja ─────           (cola local → envía al volver la señal)
```

- **AGL es el dueño** de turnos-ciclo, estaciones, materiales y plan. Los publica (upsert) en Supabase.
- **Supabase es el dueño** de los movimientos de campo. AGL los baja de forma incremental (cursor) y
  guarda en `data/fertirriego/AAAA-MM.parquet`. Idempotente (UUID por movimiento).
- AGL entra con un usuario técnico con permiso `integracion_agl` (matriz), nunca con la llave maestra.
- Sincronización en una sola PC a la vez (candado de archivo, como `inventario_sincronizacion`).
- **Cierre mensual**: AGL confirma que tiene el mes → Supabase deja el «Saldo inicial» del mes siguiente
  y archiva el detalle. Mantiene la base pequeña (plan gratis).

## 4. Conceptos clave

### 4.1 Kardex (libro de movimientos) — solo se agrega, nunca se edita ni borra
Tipos: `SALDO_INICIAL`, `RECEPCION` (+), `APLICACION` (−), `TRASLADO_SALIDA` (−, a tránsito),
`TRASLADO_ENTRADA` (+), `TRASLADO_DEVUELTO` (+, rechazo), `AJUSTE_CONTEO` (±), `DIFERENCIA_RELEVO` (±),
`ANULACION` (contrario al anulado, con motivo).

### 4.2 Custodia y relevo de estación
- Cada estación tiene **un custodio** a la vez. Solo el custodio registra movimientos en ella
  (o un mini-administrador «en nombre de», que queda registrado).
- **Relevo**: A pulsa «Entregar estación» → estado *En entrega*, A queda bloqueado. B ve los saldos y
  «Recibe conforme» o marca las diferencias por producto → B pasa a ser custodio. Las diferencias quedan
  como `DIFERENCIA_RELEVO` a nombre del relevo (no se ajustan en silencio) y generan alerta al jefe.
- B rechaza → vuelve a A con motivo. Nadie llega → el jefe puede **asignar custodia** con motivo (bitácora).
- Bitácora de relevos: quién entregó, quién recibió, horas, saldos declarados, diferencias.

### 4.3 Traslado entre estaciones
Origen crea (destino, productos, cantidades, **motivo**, **quién autoriza**) → *Por autorizar* →
autorizado → sale del origen a **en tránsito** → destino *Acepta* (cantidad recibida; la diferencia queda
marcada) o *Rechaza* (vuelve al origen). El producto en tránsito no lo puede usar nadie.

### 4.4 Aplicación por turno-día
**Un solo paso obligatorio**: «Preparé / apliqué el turno X» con las cantidades → **descuenta la bodega en
ese momento** (cuando el producto sale al tanque). La bitácora de riego (horas de fertilización, horas de
riego, inicio y fin) se completa **después y sin tocar el inventario**, por el mismo estacionero, el del
relevo o el jefe. «En curso» no es un paso: se deduce (preparada y sin horas). El relevo muestra solo los
turnos en curso como novedad. Si no se aplicó todo: «Devolver a bodega» con motivo (excepción).
Por qué: de noche se olvidan pasos; el inventario no puede depender de cerrar estados.

Cabecera: fecha, turno-ciclo, estación, horas de fertilización, horas de riego, ejecutor, hora inicio y
fin (opcionales), comentario. Líneas: material y cantidad, **propuestas desde el plan del día** (un toque
si se aplicó lo planificado). Un registro por turno-día (si ya existe, se agregan líneas, como Tickets v2).
Se permite aplicar cualquier material del catálogo, aunque no esté en el plan (queda marcado «fuera de plan»).

### 4.5 Recepción
Fecha y hora, estación, chofer, vehículo, lugar de entrega, n.º de documento/remisión, líneas (material,
cantidad). Chofer y vehículo se eligen de la lista o se crean al vuelo (quedan «por validar»).

### 4.6 Opción administrativa (apagada): entrega declarada por el chofer
Interruptor en `fert_configuracion`, que solo cambia quien tenga la acción `configurar`. Encendida: el chofer
(usuario con acción `declarar_entrega`) registra cuánto entregó y en qué estación; el estacionero registra
lo que entró a su bodega; la diferencia queda marcada *Revisar*. El inventario de la estación sigue
moviéndose **solo con lo que el estacionero recibe y aplica**. Apagada (por defecto): solo digita el estacionero.

## 5. Seguridad y prevención de boicot

1. **Ninguna escritura directa** a las tablas: todo pasa por funciones `security definer` que validan
   permiso (`fn_tiene_permiso`), zona/estación asignada, custodia y estado. (Lección de `sql/89`.)
2. **Libro inalterable**: sin UPDATE/DELETE. Errores → anulación con motivo; el original sigue visible.
3. Anular: el autor mientras siga siendo custodio en esa jornada; después, solo quien tenga
   `anular` con alcance sobre la estación.
4. **Saldo no negativo**: en línea se bloquea; si llega de un envío sin señal, se acepta (es la realidad
   física) y se marca *Revisar*. **Nunca se pierde un registro de campo: lo dudoso se marca, no se borra.**
5. Cada registro guarda: quién lo grabó, quién lo ejecutó, «en nombre de», teléfono, hora del teléfono y
   hora del servidor (se marca si difieren mucho → reloj manipulado o envío tardío).
6. Movimiento de alguien que no era custodio a esa hora (envío tardío) → aceptado y marcado *Fuera de custodia*.
7. Roles sin nombres en el código: acciones nuevas en la matriz (`ver`, `recibir`, `aplicar`, `contar`,
   `relevo`, `trasladar`, `autorizar_traslado`, `anular`, `en_nombre_de`, `asignar_custodia`,
   `gestionar_choferes`, `integracion_agl`) + asignación persona↔estación + `perfiles_zonas`.

## 6. Sin señal (offline-first)

- PWA real: `manifest` + service worker propio (sin librerías; la red corporativa las complica).
- IndexedDB: copia de lo necesario (estaciones asignadas, turnos-ciclo, materiales, plan de los próximos
  días, choferes, vehículos, saldos, custodia) + **cola de envío** con UUID generado en el teléfono.
- Saldo en pantalla = saldo del servidor + movimientos pendientes (con insignia «por enviar»).
- Envío por lotes a una función (`fn_fertirriego_sincronizar`) que responde por registro:
  aceptado / ya existía / aceptado con observación / rechazado (motivo visible al usuario).
- Sin señal se puede: recibir, aplicar, contar, entregar/recibir estación (ver pregunta P2).
  Traslados: crear sí; aceptar requiere haber recibido el traslado (necesita señal al menos una vez).
- Next.js 16: la parte de campo debe poder abrir sin servidor → pantalla cliente cacheada. Revisar
  `node_modules/next/dist/docs/` antes de construir.

## 7. Vistas

**Teléfono (estacionero / mini-admin)**
- *Mi estación*: tarjetas por producto con saldo, en tránsito, alerta si no alcanza para el plan próximo.
- Botones: **Recibir · Aplicar · Contar · Trasladar · Entregar estación**.
- *Por turno* (temporada → ciclo → turno → días → movimientos), mínimo la temporada completa.
- *Bitácora / kardex*: Fecha-hora · Movimiento · Turno/Origen · Entrada · Salida · Saldo.
- *Resumen*: recibido, aplicado, saldo, plan vs aplicado por turno.
- *Bitácora de relevos y traslados*.

**AGL (análisis)**
- Comparativo 3 vías por turno-ciclo × material (por día y acumulado del ciclo): Plan · Cargado SAP ·
  Aplicado, % y semáforo con tolerancia; también horas de riego plan vs real.
- Consignación por estación = **recibido − aplicado** (saldo del kardex), valorizada con precio MARA.
  Sigue siendo inventario del almacén, en la estación.
- Comparación con SAP (solo comparar): por turno, cargado a la orden vs aplicado. Si se aplicó más de lo
  cargado, se señala (la diferencia salió de la consignación).
- Sugerencia de envío: plan de los próximos N días − saldo.
- Pérdidas: ajustes de conteo, diferencias en relevos y traslados, por estación y por persona.

## 8. Modelo de datos (Supabase, nombres tentativos)

| Tabla | Origen | Contenido |
|---|---|---|
| `turnos_ciclo` | AGL | id AGL (`id_transaccion`), turno, temporada, ciclo, fecha siembra, estación, orden SAP, plan, área, estado |
| `fert_plan` | AGL | turno_ciclo, fecha, DDT, material, cantidad, unidad, horas riego, volumen m³ |
| `materiales` (+`unidad`) | AGL | Se publican los de grupo fertilizantes (1800) |
| `estaciones_riego` | AGL | Existente; AGL sincroniza por nombre/código |
| `perfiles_estaciones` | Campo | Persona ↔ estación asignada |
| `choferes`, `vehiculos`, `choferes_vehiculos` | Campo | Catálogos con alta rápida «por validar» |
| `estacion_custodia`, `estacion_relevos`, `estacion_relevos_detalle` | Campo | Custodio actual y bitácora |
| `fert_recepciones` (+detalle) | Campo | Documento de recepción |
| `fert_aplicaciones` (+detalle) | Campo | Cabecera turno-día y líneas |
| `fert_traslados` (+detalle) | Campo | Estados y cantidades enviada/recibida |
| `fert_conteos` (+detalle) | Campo | Conteo físico |
| `inventario_movimientos` | Campo | Libro inalterable; `cursor bigint` para AGL; uuid cliente |
| `inventario_saldos` | Calculada | estación × material: disponible, en tránsito |
| `fert_sync_agl` | Ambos | Cursor, cierres mensuales |

## 8b. Etapa A · construida (2026-11-11)

- **Supabase**: `sql/91_fertirriego_base.sql`. Pruebas en réplica: `pruebas/sql/91_fertirriego.sql` (57/57,
  idempotente). Puerta única de escritura: `fn_fert_sincronizar(lote)`; tipos: `recepcion`, `aplicacion`,
  `bitacora`, `conteo`, `devolucion`, `anulacion`, `chofer`, `vehiculo` (relevo y traslados: Etapa C).
  Administración con señal: `fn_fert_asignar_persona`, `fn_fert_asignar_custodia`, `fn_fert_configurar`.
  Llaves del código de relevo: `fn_fert_mis_llaves()`; TOTP `fn_fert_totp` (vector RFC 6238 verificado).
  Cruce de nombres AGL ↔ aquí tolerante (`_fert_llave`: «Zona-1» = «Zona 1»).
- **AGL**: `backend/fertirriego_campo.py` + `POST /api/fertirriego/publicar`, `GET /api/fertirriego/estado`
  (submódulo «calculo_fertilizantes»), botón **«Publicar a campo»** en /CF07. Conexión (`url`, `anon_key`,
  `correo`, `clave` del usuario técnico): desde 2026-11-12 **cifrada y compartida** en
  `data/sistema/conexiones_<DEV|PROD>.cifrado.json`, configurada en AGL **/SE03 Conexiones** (`backend/conexiones.py`;
  clave maestra recordada por Windows/DPAPI en cada PC; pedido del usuario: que su asistente sincronice sin él). El
  archivo anterior `%LOCALAPPDATA%\AGLGestion\fertirriego_<DEV|PROD>.json` se sigue leyendo si no hay cifrado. QA con clics 9/9 (copia aislada + Supabase falso hacia la réplica): 10 turnos, 17 estaciones,
  181 materiales, 1,131 filas de plan en < 1 s.
- Para usarla: el usuario técnico necesita un rol con «Fertirriego · Conexión AGL»: Ver + Publicar.

## 8c. Etapa B · construida (2026-11-11)

App de campo en `/fertirriego` que funciona sin señal: `sql/94` (fn_fert_estado_campo: todo lo del teléfono en una
llamada) y `sql/95` (la custodia se mira al registrar). Datos del teléfono en IndexedDB por persona; cada registro con
UUID en una cola que se envía sola; service worker solo para esta pantalla. Productos, estaciones, turnos y plan vienen
de AGL (MARA y /TR02); en AgroNotificaciones no se crean. QA con clics 27/27.

## 8d. Etapa C · construida (2026-11-12) — `sql/96` (probada en réplica 34/34; **falta correrla en desarrollo**)

- **Relevo**: quien entrega deja novedades por turno (en aplicación / preparado / pendiente / terminado) y queda
  bloqueado (custodia EN_ENTREGA); su teléfono muestra un código TOTP de 6 dígitos (30 s) calculado con su llave
  (WebCrypto, `lib/fertirriego/codigo.ts`). Quien recibe lo escribe en SU teléfono, que lo verifica sin internet con
  las llaves de sus compañeros (±1 paso; 5 fallos = 5 min de bloqueo); la base lo vuelve a verificar
  (`fn_fert_totp_valido`, ±2 pasos sobre `momento_codigo`). Cuadre por producto: diferencias → `DIFERENCIA_RELEVO`
  y relevo «revisar». Entrega y recepción pueden llegar en cualquier orden (se juntan). Con señal: método SESION.
  Rechazar (con motivo) devuelve la custodia a quien entregaba; cancelar la entrega antes de que la reciban.
- **Traslados**: crear (custodia del origen, autorizador ≠ uno mismo y con «Autorizar traslado» sobre el origen),
  autorizar (sale del origen, `en_transito` en el destino), aceptar con lo que llegó (≤ enviado; menos =
  `DIFERENCIA_TRASLADO`) o rechazar (vuelve al origen), cancelar antes de autorizar.
- **Exportación a AGL**: `fn_fert_exportar(cursor, limite)` (solo «Fertirriego · Conexión AGL › Ver»).
- QA con clics listo para correr tras la 96: `pruebas/qa/fertirriego_relevo_traslado.ps1` (dos personas en el mismo
  navegador; el código se lee de la pantalla de quien entrega). Regresión de la Etapa B sin la 96: 27/27.

## 8e. Etapa D · construida en AGL (2026-11-12)

`backend/fertirriego_analisis.py`: **Bajar de campo** (por cursor, sin duplicar; `data/fertirriego/movimientos_AAAA-MM.json`
y `campo.json` con saldos, bitácora y relevos a revisar), **comparativo** turno × producto (Plan del MRP · Cargado SAP
por orden del turno · Aplicado neto con devoluciones y anulaciones; semáforo ±5 %, «fuera de plan») y **consignación**
valorizada con MARA. Pestaña **Campo** en /CF07. Pruebas: unitaria 14/14, clics 13/13 (contra la réplica con la 96).

## 8f. Manuales

`docs/manuales/` (estacionero, jefe de zona, administrador, guion de la charla) y en AGL `docs/manual_fertirriego_AGL.md`.
El del estacionero se abre dentro de la app («¿Cómo se usa?»), también sin señal.

## 9. Etapas

| Etapa | Contenido |
|---|---|
| A | SQL: tablas, funciones seguras, permisos. AGL publica turnos-ciclo, estaciones, materiales, plan |
| B | App de campo offline-first: Mi estación, Recibir, Aplicar, Contar, Bitácora, Por turno, choferes/vehículos |
| C | Relevo de estación y traslados |
| D | AGL baja movimientos: comparativo 3 vías, consignación, por cargar a SAP, pérdidas |
| E | Alertas, sugerencia de envío, cierre mensual, herramientas del mini-administrador |

Arranque: conteo inicial en todas las estaciones el día X → `SALDO_INICIAL`.

## 10. Preguntas abiertas

Respuestas del usuario (2026-11-11):

- **P1 Relevo**: «Recibo conforme» + diferencias, sin conteo obligatorio. **Bitácora de novedades
  obligatoria** en cada relevo: estado de cada turno de la estación (ej. «T36 todavía en aplicación»,
  «T37 ya preparado en tanques») + notas libres.
- **P2 Relevo sin señal con código tipo autenticador (TOTP, 6 dígitos, cambia cada 30 s)**, **verificado
  en el propio teléfono, sin internet** (un código incorrecto NUNCA pasa):
  - Cada usuario tiene una llave secreta; la base la genera y nunca la muestra.
  - Mientras hay señal, cada teléfono descarga las llaves de los compañeros de SUS estaciones
    (guardadas como llave WebCrypto no exportable). Igual que el servidor de un banco verifica el token.
  - El que entrega pulsa «Entregar estación» → su teléfono muestra su código y queda bloqueado.
  - El que recibe escribe el código en SU teléfono → el teléfono lo calcula con la llave del que entrega
    y la hora → si no coincide, **rechaza en el acto**. Tolerancia ±1 ventana (30 s).
  - 5 intentos fallidos → bloqueo de 5 min (impide adivinar). La base vuelve a verificar al sincronizar
    (segunda revisión) y cruza con el registro de entrega del otro teléfono.
  - Requisitos: haber abierto la app con señal al menos una vez después de ser asignado a la estación;
    hora del teléfono correcta (la da la red celular aun sin datos). Si la hora está mal, se avisa.
  - Con señal también se puede: el que recibe entra con su cuenta en el mismo teléfono y acepta.
  - Cancelar una entrega: con señal y si nadie la recibió; si no, el jefe asigna la custodia.
- **P3 Traslados**: el autorizador aprueba en su teléfono.
- **P4 Documentos**: opcionales, no se piden. Menos trámites; lo importante es el registro. Traslados
  normalmente entre estaciones de la misma zona.
- **P5 GPS obligatorio**: se exige el permiso de ubicación. Si el teléfono no logra ubicarse en un tiempo
  razonable, se guarda marcado «sin ubicación» (regla de oro: no se pierde el registro).
- **P6 Aplicación**: un registro, ejecutor principal + segundo ejecutor opcional (el relevo puede llegar
  a mitad de una aplicación).
- **P7 Comparación**: fecha plan = fecha de siembra + DDT. Por día, acumulado del día y acumulado del ciclo.
- **P8 AGL manda** en turnos, estaciones, materiales y plan. Los extras fuera de plan que piden en campo
  se registran como recepción y aplicación normal, marcadas «fuera de plan».
