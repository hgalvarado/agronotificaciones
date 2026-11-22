# AgroMétricas › Parámetros de riego · diseño (parte 1 de la migración)

> 2026-11-13. Base: `docs/agrometricas-migracion.md`. Construcción: después de la renovación del límite (domingo
> 2026-11-15, tras el Comparativo de Fertirriego). Nada de esto toca AppSheet (sigue en producción hasta apagarlo).

## 1. Lo que dicen los datos de AppSheet (hoja «Registro de parametros», 9 935 filas, solo lectura)

| Grupo | Columnas (qué tan llenas) | Lectura |
|---|---|---|
| Identidad | Temporada, Ciclo, Fecha registro, DDT (100 %), turno | DDT y temporada se escribían a mano → **DDT con 20 546** (error). Ahora salen de AGL. |
| Tensiómetros | 12 y 24 cm, AM y PM (93 %) | El dato diario principal. Rango visto 0–218. |
| Riego | Horas de riego (52 %), % fertilización (32 %), extra fertilización (0 %), «No fertilización» (94 %, apunta a otro registro) y su fecha de ejecución (35 %) | % con valores como 1002 % (error). «No fertilización» = número de la fertilización del programa: revisar a qué tabla apunta antes de migrar. |
| Agua y solución | CE/pH de agua (52 %), gotero (36 %), extractor (36 %), cloro en cinta (26 %) | **pH 797, CE 934** = decimales sin punto. |
| Suelo | CE antes/después del riego (27 % / 16 %), **foto de calicata** (37 %, ~3 600 fotos en Drive) | Las fotos NO van a Supabase. |
| Clima | ETo, DPV, viento (51 %) | **ETo 5 048** (error). Es dato del día por zona o estación, no por turno: hoy se repite en cada turno. |
| GPS | Ubicación (30 %, varias en 0,0) | |

## 2. Cómo se mejora (diseño nuevo)

- **Módulo «AgroMétricas»** con menú de botones grandes; botón «Parámetros de riego».
- **Se elige solo el turno** (lista de AGL vía `turnos_ciclo`, filtrada por la zona o estación de la persona). Temporada,
  ciclo, variedad y **DDT se calculan** (fecha − siembra). La fecha es la de la jornada: puede ser ayer o antes.
- **Formulario por secciones plegables**, con lo diario arriba:
  1. Tensiómetros (12/24 · AM/PM): siempre abierta.
  2. Riego: horas, % de fertilización, extra, número de fertilización del plan.
  3. Agua y solución: CE/pH de agua, gotero y extractor, cloro en cinta.
  4. Suelo: CE antes/después y foto de la calicata.
- **Clima una sola vez por día y estación** (ETo, DPV, viento), no por turno. Si después hay estación meteorológica, se
  carga sola.
- **Rangos por parámetro** (catálogo en AGL: mínimo, máximo y «crítico»), con aviso en el momento:
  «pH 797 está fuera de rango, ¿quisiste decir 7.97?». Se avisa, no se bloquea (puede ser una lectura real).
- **Sin señal**: igual que Fertirriego (cola local con UUID e idempotente); se guarda en segundo plano.
- **Fotos de calicata**: se comprimen en el teléfono. Supabase las guarda solo hasta que AGL las baja a OneDrive; después
  se borran (Supabase solo como intermediario).
- **Un registro por turno y día**: si ya existe, se abre para completarlo (no se duplica).

## 3. Datos

- Supabase: `agm_parametros` (turno_ciclo, fecha, lecturas en columnas numéricas, uuid del teléfono, quién, cuándo) y
  `agm_clima` (estación, fecha, ETo, DPV, viento). Permisos por la matriz (`fn_tiene_permiso`), sin roles en el código.
  Próximo número de SQL libre: **109** (105–108 reservados a la unificación de catálogos).
- AGL: catálogo «Rangos de parámetros», baja periódica a archivos por mes, gráficas (tensiómetros vs DDT, CE/pH contra
  rangos, por turno, estación, zona y semana ISO).
- **Histórico**: las 9 935 filas a AGL (no a Supabase). Los valores fuera de rango se importan **marcados** (no se
  corrigen solos); el usuario decide en una pantalla de revisión. Las fotos de Drive se enlazan o se copian a OneDrive.
  Se verifican los conteos contra la hoja.

## 4. Respuestas del usuario (2026-11-13, no volver a preguntar)
1. **Quién registra**: los **parametristas** (dependen del jefe de zona, igual que el estacionero). Se les asignan sus
   estaciones (`perfiles_estaciones`) y el alcance sale de la matriz de permisos.
2. **Clima**: lo manda por correo el encargado de zona o lo registra el parametrista → **una vez por ZONA y día**
   (`agm_clima.zona_id`).
3. **Rangos**: no hay referencia escrita. Propuesta: AGL los **calcula del histórico** (percentiles 5–95 por parámetro,
   y por fase/DDT donde haya datos), el usuario los revisa con los de campo y los publica.
4. **«No fertilización» y % de fertilización NO se registran en Parámetros**: el número de fertilización es el DDT del
   plan del turno (ya está en Fertirriego) y el **% de fertilización se agrega a Fertirriego › Horas** del turno
   (pendiente: SQL + formulario en Fertirriego).
5. **Fotos de calicata**: las viejas quedan con **enlace a Drive**; las nuevas se guardan en OneDrive (el teléfono las
   sube a Supabase Storage de paso y AGL las baja a OneDrive y las borra de Supabase).


## 5. Sin señal: IndexedDB

- **Decisión (2026-11-21)**: lo que se captura en campo se guarda en **IndexedDB** (base `agn-agrometricas-<usuario>`), igual
  que Fertirriego. Antes vivía en `localStorage` (cuota ~5 MB: las fotos de calicata como texto podían llenarla y perder
  datos; el navegador puede vaciarla).
- **Por qué no SQLite**: el navegador no trae SQLite nativo. Habría que cargar un motor WASM (peso extra, y persiste encima
  de IndexedDB/OPFS de todos modos). IndexedDB es transaccional, guarda archivos (Blob) y ya está probado en Fertirriego.
- **Almacenes**: `cola` (pendientes, llave = UUID), `rechazados`, `datos` (catálogo de turnos y rangos `turnos`, hora de
  `ultimo_envio`) y `fotos` (Blob JPEG; la cola solo guarda `tieneFoto`). El pendiente y su foto se escriben en una sola
  transacción: o entran los dos o ninguno. Un registro **no sale de la cola** hasta que la base confirma o lo rechaza de
  forma definitiva.
- **Migración desde localStorage**: al abrir, si existen `agm_cola_<usuario>`, `agm_rechazados_<usuario>` o
  `agm_datos_<usuario>`, se pasan a IndexedDB (fotos data URL → Blob), se **leen de vuelta** para confirmar y solo entonces
  se borran de localStorage. Si algo no se confirma, se queda lo viejo y se reintenta en la próxima apertura.
- **Pantalla**: «N pendientes de enviar», «Último envío», botón **Exportar pendientes** (JSON de respaldo con las fotos) y
  un aviso discreto si el navegador no concede almacenamiento persistente (`navigator.storage.persist()`, pedido al abrir).
- **Abrir sin señal**: `public/sw.js` guarda `/agrometricas` y `/agrometricas/parametros` (la página que se abre le pide
  guardarlas) más los `/_next/static`. Los turnos y rangos (`fn_agm_mis_turnos`) se guardan en IndexedDB cada vez que se
  abre con señal; se muestra «Turnos al <fecha>».
- **Mis registros** (sin SQL): sección plegable al final de Parámetros con lo que esa persona guardó desde ese teléfono
  (cola «Sin enviar» + rechazados con motivo + almacén `historial` de IndexedDB, versión 2 de la base, con solo un resumen de
  texto de ~1 KB sin fotos, guardado al confirmarse y podado a 14 días / 200 registros). Agrupado por día (UTC-6), 15 al abrir
  y «Ver más». Lógica en `lib/agrometricas/historialPura.ts`, pantalla `components/agrometricas/MisRegistros.tsx`.
- **Código**: `lib/agrometricas/colaPura.ts` (lógica pura, probada en `pruebas/unit/agrometricas_cola.test.mjs`),
  `almacen.ts` (IndexedDB), `cola.ts` (Supabase). Las funciones de `cola.ts` ahora son asíncronas.

## 6. Baja a AGL (sql/122)

**Regla**: Supabase es solo un intermediario. Parámetros (`agm_parametros`), clima (`agm_clima`), calicatas
(`agm_calicatas`) y las fotos del bucket `agrometricas` se **bajan a AGL**, se verifican con sha256 y recién entonces se
borran de Supabase. Mismo patrón que Terminar ciclo (102) y lo eliminado (121).

**Quién**: el usuario técnico «Integración AGL» con los permisos que ya tiene en la matriz (`fertirriego_agl`): **ver**
para leer, **publicar** para confirmar y purgar. No hay permisos nuevos ni nombres de rol en el código.

**Qué hace AGL (en este orden)**
1. `fn_agm_exportar({desde?, hasta?, limite?, despues_de?})`: trae en lotes lo «por bajar» (nunca bajado, o cambiado
   después de bajarlo). Cada fila trae su `texto` exacto (jsonb sin las marcas de bajada), su `huella` (= sha256 hex del
   texto), el turno de AGL (`turno_agl_id`, `turno`, `temporada`, `ciclo`), la zona y la `foto` `{ruta, bytes}`.
   `sha256_lote` = sha256 de las huellas unidas con `|`, ordenadas por `cursor` (comparación binaria).
2. AGL guarda la fila en su almacén, **baja la foto** de Storage (`agrometricas/<ruta>`) a OneDrive y verifica el sha256 de
   cada texto (y el tamaño de la foto contra `bytes`).
3. `fn_agm_confirmar_bajada({lote:[{tabla,id,huella}], cuantos, sha256_lote})`: **no borra**. La base recalcula la huella
   de cada fila; las que coinciden quedan marcadas (`bajado_a_agl_en`, `huella`); las que cambiaron entre la lectura y la
   confirmación vuelven en `rechazadas` y siguen «por bajar». Un `cuantos` o `sha256_lote` que no cuadra rechaza todo el lote.
4. `fn_agm_purgar_bajadas({limite?, retencion_dias?})`: borra de Supabase solo lo confirmado cuya huella actual sigue
   igual y que lleva más de la **retención** desde la confirmación (**7 días** por defecto; se lee o cambia con
   `fn_agm_bajada_retencion(dias)`; el parámetro `retencion_dias` solo puede aumentarla). Devuelve
   `{parametros, clima, calicatas, fotos[], hay_mas}`. **AGL borra las `fotos` de Storage** con la llave de servicio (la
   base no toca Storage); una foto solo aparece en la lista si ninguna fila restante la usa. Si `hay_mas`, repetir.

**Reglas**
- **Editado después de bajado**: la huella cambia, la fila vuelve a «por bajar», no se purga hasta reconfirmarla. AGL debe
  reemplazar su copia por `id` (upsert).
- **Calicata**: es fija por ciclo y el teléfono la consulta; se baja pronto pero solo se borra de Supabase cuando su
  turno ya no está activo (ciclo terminado).
- **Retención**: los 7 días cubren a un teléfono que estuvo sin señal y reenvía con el mismo UUID (si la fila ya no está,
  se vuelve a crear como «por bajar» y AGL la recibe otra vez por `id`).
- Una foto que quedó huérfana por reemplazo (la fila apunta a otra ruta) no la lista la purga; AGL puede limpiar el
  bucket por antigüedad.
- Probado en réplica: `pruebas/sql/122_agrometricas_bajar.sql`.
- **Borrado de fotos (sql/123)**: AGL borra las fotos de `fotos[]` del bucket `agrometricas` con el token del usuario técnico. La 123 agrega la política DELETE de `storage.objects` solo para ese bucket y solo con «Conexión AGL · publicar». Alternativa: guardar la llave de servicio en AGL /SE03.
- El usuario «Integración AGL» necesita además `agrometricas · ver` (la política de lectura de fotos lo exige: sin ella no puede bajar ni, por RLS, borrar fotos).

## 7. Registros de la temporada (sql/125)

**Pedido (2026-11-21)**: los 107 registros de 2026-2027 que vivían solo en AGL (importados de AppSheet por «Glopez», «Rwlopez»,
«gbetancourth») aparecen en Supabase como si los hubieran ingresado esos usuarios (cruce por correo: noelopez@agl.com,
rudylopez@agl.com, gustavobetancourth@agrolibano.com). **Visibilidad (ajustada 2026-11-21)**: el administrador ve todo; quien tenga
`agrometricas · ver` en la zona del turno ve **todos** los registros de esa zona, aunque los haya capturado otro. Editar y eliminar no cambian.

**Funciones** (todas `jsonb`, mensajes en español)
- `fn_agm_cargar_appsheet({registros:[{id_appsheet, fecha, turno_ciclo_id (= id del turno en AGL, `turnos_ciclo.agl_id`),
  usuario_appsheet, <13 valores>, latitud?, longitud?, comentario?}], mapa_usuarios:{Glopez:'correo',…}})` → `{insertadas,
  ya_existian, sin_usuario:[{id_appsheet, usuario_appsheet}], sin_turno:[{id_appsheet, turno}], en_conflicto:[{id_appsheet,
  existente}], invalidas:[{id_appsheet, error}]}`. Solo el usuario técnico (`fertirriego_agl · publicar`). Idempotente: el `id`
  es determinista (sha-256 de `'agm_appsheet:' || id_appsheet`, versión 5/variante RFC; AGL puede recalcularlo) y lo ya cargado
  no se toca (no pisa ediciones). Sin autor o sin turno **no se carga** (se informa para reintentar). Nacen ya «bajados»
  (AGL los tiene): solo vuelven a bajar si alguien los edita.
- `fn_agm_mis_registros({temporada?, turno? (código EXACTO, sin distinguir mayúsculas), turno_contiene? (búsqueda parcial por código), turno_ciclo_id?, zona_id?, desde?, hasta?, texto?, limite? (50, máx. 1000), pagina?
  (desde 0), orden? 'desc'|'asc', lote? (texto exacto, p. ej. '1002-120'), lotes? (arreglo, selección múltiple)})` → `{total, limite, pagina, registros:[…]}`. Cada registro trae todas las columnas con
  valores (para graficar), `turno, temporada, ciclo, estacion, zona, lotes:[{lote, nombre}], creado_por_nombre, creado_por_email, editado_por_nombre`,
  y `puede_editar`, `puede_eliminar`. No trae eliminados, huella ni datos internos. Visibles: administrador (todos) y cualquiera con
  `agrometricas · ver` en la zona del turno (todos los de la zona). `puede_editar` (dueño con «Registrar parámetros» en la zona, encargado con
  «Corregir» o administrador) y `puede_eliminar` (solo `eliminar_definitivo`) se calculan por fila. **Filtro por lote**: `lote`/`lotes`
  devuelven los registros de TODOS los turnos que contengan ese lote (un lote como 1002-120 «Areanales-2» está en T1002-T36, T37, T38…).
- `public.turno_lotes(turno_ciclo_id → turnos_ciclo on delete cascade, lote, nombre, area_mz; pk (turno_ciclo_id, lote); índice por lote)`:
  lotes de cada turno; RLS de lectura con la misma regla de zona («ver»). `fn_agm_publicar_turno_lotes({turnos:[{turno_ciclo_id (= agl_id),
  lotes:[{lote, nombre?, area_mz?}]}]})` → `{turnos, lotes, sin_turno:[agl_id], invalidos:[…]}`: solo el usuario técnico (`fertirriego_agl · publicar`),
  REEMPLAZA los lotes de cada turno (idempotente). `fn_agm_lotes_visibles()` → `[{lote, nombre, turnos:[código de turno]}]` de lo que el usuario ve
  (para el selector). `fn_agm_cargar_appsheet` acepta `lotes` por registro y los guarda solo si el turno aún no tiene.
- `fn_agm_editar_parametro({id, <valores>…, latitud?, longitud?, comentario?})` → `{cambio, registro}`. Solo cambia lo que viene
  (valor vacío = limpiar; no número = error). Dueño (con «Registrar parámetros» en la zona), encargado de la zona o administrador.
  Marca `editado_en/por`; la huella cambia sola y AGL lo vuelve a bajar. No edita turnos archivados («reactívalo en AGL»).
- `fn_agm_eliminar_parametro({id, motivo})` → `{id, eliminado_en}`. Solo con el permiso **«Eliminar por completo»**
  (`agrometricas · eliminar_definitivo`, nivel 4: los niveles rápidos no lo encienden; no se concede a ningún rol, solo el
  administrador; el usuario puede darlo después en Permisos). Motivo ≥ 15 letras. Eliminación lógica (tumba: `eliminado_en/por/motivo`).
- `fn_agm_guardar_parametros` (109) se redefine: la unicidad (turno, fecha) es **parcial** (solo no eliminados), y reenviar el id
  de un eliminado se rechaza (no se resucita). La política de lectura de la tabla oculta los eliminados.

**Baja a AGL (122 ajustada)**: `fn_agm_exportar` trae también las tumbas (`eliminado:true`, la fila trae el motivo) y
`creado_por_email`; AGL las aplica en su copia y confirma con la misma huella. La huella ignora las claves nuevas cuando están
en null (lo confirmado antes de la 125 no vuelve a «por bajar»).

**Retención**: un parámetro de un turno **activo** se queda en Supabase aunque ya esté confirmado (consultable y editable);
se purga cuando el turno ya no está activo (Terminar ciclo) y AGL lo confirmó con huella. Una tumba confirmada se purga pasada
la retención (7 días: cubre a un teléfono sin señal que reenvíe ese UUID). Las fotos siguen el camino de la 122/123.

**Órdenes de corrida**: si se vuelve a correr la 109 o la 122, correr la **125** después. Pruebas: `pruebas/sql/125_agrometricas_registros_temporada.sql`
(la de la 122 describe el comportamiento previo: no se corre sobre una base con la 125).

### Pantalla «Registros de la temporada» (`/agrometricas/registros`)

Pantalla EN LÍNEA (no está en `RUTAS_SIN_SENAL`; sin señal muestra el aviso «Esta pantalla necesita conexión» con Reintentar y recuerda que lo
local sigue en Parámetros › Mis registros). Entrada desde `/agrometricas` y desde un botón en Parámetros de riego. Permiso de página: `agrometricas · ver`;
qué ve, edita y elimina cada persona lo decide la base (`puede_editar`, `puede_eliminar` por fila); el código no nombra roles.

- **Filtros** (`FiltrosRegistros.tsx`, recordados por usuario con `useMemoria`): Temporada, Zona, Turno y Lote con `SelectorMultiple` (búsqueda y Única/Varios),
  Desde/Hasta y búsqueda de texto (400 ms). Un lote trae los registros de todos los turnos que lo contienen y se avisa cuáles son. Las listas salen de
  `fn_agm_mis_turnos` (turnos activos), `fn_agm_lotes_visibles` y lo ya cargado. La base filtra por UNA temporada/zona/turno: con varias selecciones se pide sin ese
  filtro y se recorta en local (`filtrarLocal`; el selector de turno manda `turno` exacto; solo el cuadro de texto hace búsqueda parcial). Con una sola selección el total del servidor coincide con lo mostrado.
- **Vistas** (pestañas): Vista rápida (tarjetas por día/turno con CE, pH, tensiómetros, cloro y horas + sparkline por DDT del turno), Tabla (DataGrid: filtros, orden,
  selección múltiple, edición en línea de los 13 valores solo donde `puede_editar`, «Eliminar» en masa con un solo motivo donde `puede_eliminar`, Excel) y Gráficas
  (una gráfica por parámetro y turno, líneas por DDT, punto rojo = fuera de rango, 24 cm punteado, SVG propio sin librerías). Cada gráfica trae el espacio del IC
  (prop `intervalos` de `GraficasRegistros`: franja por DDT; hoy muestra «Intervalo (IC): próximamente»).
- **Detalle** (`DetalleRegistro.tsx`): todos los valores, foto de la calicata (enlace firmado del bucket `agrometricas`; si no se puede ver, no se muestra), quién y cuándo,
  Editar (`fn_agm_editar_parametro`, solo manda lo que cambió, avisos de rango como la captura) y Eliminar (`ModalEliminar`: motivo ≥ 15 letras + casilla; `fn_agm_eliminar_parametro`).
- **Paginación del servidor**: 50 por página y «Ver más». Estados vacío, cargando y error en español.
- **Horas de riego y % de fertilización**: son un parámetro más; ver «Horas de riego y % en los registros (sql/126)» más abajo.
- **Código**: lógica pura en `src/lib/agrometricas/registrosPura.ts` (agrupar, series por DDT, escala SVG, motivo, validación de edición, parámetros de consulta); pruebas
  `pruebas/unit/agrometricas_registros.test.mjs`. Requiere la **125** corrida.

### Horas de riego y % de fertilización en los registros (sql/126) y Resumen (pedido 2026-11-22)

**Relación con Fertirriego**: `fert_bitacora_riego` tiene UNA fila por `(turno_ciclo_id, fecha)` (PK desde la 91; `pct_fertilizacion` desde la 112,
`horas_riego`, `horas_fertilizacion`), la misma clave que `agm_parametros` (`turno_ciclo_id`, `fecha`). Como la clave es única **no se suma ni se
pondera nada**: se trae la fila tal cual. **`sql/126_agrometricas_horas_riego_en_registros.sql`** redefine `fn_agm_mis_registros` (mismos filtros que la 125):
- cada registro trae `horas_riego`, `horas_fertilizacion`, `pct_fertilizacion` del mismo turno y día (vacíos si ese día no hay bitácora);
- los días con horas/% y **sin parámetros vivos** salen como filas del turno con `solo_horas = true`, id de texto `h:<turno_ciclo_id>:<fecha>`, DDT = fecha − siembra,
  `puede_editar`/`puede_eliminar` en `false` (se corrigen en Fertirriego › Horas), y entran en `total`, paginación y todos los filtros; una bitácora toda vacía no genera fila;
  si se elimina el parámetro de un día que tiene bitácora, ese día pasa a ser fila solo-horas (no se duplica);
- **permisos**: SECURITY DEFINER, `search_path` fijo; una fila solo sale si la persona ve el turno por `AgroMétricas · ver` en su zona (o es administrador), la misma regla
  de la 125; no se devuelve ninguna otra columna de Fertirriego (ni cantidades, productos, ejecutores, horas de inicio/fin ni cloro). Un turno archivado (102) ya no tiene bitácora en Supabase;
- sin DDL; requiere 125 y 112; si se vuelve a correr la 125, correr la 126 después. Pruebas escritas: `pruebas/sql/126_agrometricas_horas_riego_en_registros.sql`.
- **AGL**: el Resumen de AGL ya espera `horas_riego` (grupo «Horas de riego» en `backend/agrometricas_resumen.py`) y varios módulos de AGL leen la bitácora de Fertirriego
  (`fertirriego_*`); el % de fertilización lo baja Fertirriego (112). Lo que NO baja es unirlas al registro de parámetros por turno y día (eso es de esta pantalla, en línea).

**Resumen** (primera pestaña de `/agrometricas/registros`; `ResumenRegistros.tsx`, `GraficasResumen.tsx`, lógica pura `resumenPura.ts`, pruebas `pruebas/unit/agrometricas_resumen.test.mjs`):
mismo diseño que el Resumen de AGL (tarjetas, mapa de calor turnos × días, líneas por DDT, turnos al mismo DDT) **sin** «Normal histórico» ni comparativo con la temporada pasada.
Filtros propios (recordados): Lote (al elegirlo salen todos sus turnos), Ciclo («Ciclo N»), Zona, Turno (`SelectorMultiple`: búsqueda y única/varios), rango Desde/Hasta (por defecto
los últimos 14 días) y parámetro (CE, pH, tensiómetros, cloro, horas de riego, % de fertilización) con su medida. **Cálculo en el cliente**: pide `fn_agm_mis_registros` por páginas de 1000
(máx. 10 páginas) desde min(Desde, hoy−13) hasta max(Hasta, hoy) con `lotes` y zona única en la base; ciclo, varias zonas y turnos se recortan en local; sin función de agregado nueva.
«Registro» (tarjetas) = fila de parámetros; un día solo-horas no cuenta como registro del parametrista pero sí aparece en el mapa y las líneas de Horas y % de fertilización.
Mapa: color = intensidad relativa del valor mostrado (no hay rangos); gris = sin registro; borde rojo = fuera de rango al guardar. SVG propio con clases de Tailwind (claro/oscuro).
**Zona**: se muestra como en AGL («Zona-2A») con `nombreZona` (si el nombre de la tabla `zonas` ya empieza por «Zona» se deja tal cual). **«Registró»**: `quienRegistro` = nombre, si no correo, nunca el UUID.

## 8. Índice de crecimiento (IC) · `sql/127`

Pedido del usuario (2026-11-21): el IC se mide **siempre por turno**, preferiblemente del **DDT 5 al 20**, lo mide el **mismo parametrista** que captura
los parámetros y quiere **control para cambiar los parámetros de la fórmula durante la temporada**. Va dentro de Parámetros de riego (misma pantalla,
misma cola sin señal en IndexedDB, misma baja a AGL).

**Fórmula** (confirmada con los datos reales de AppSheet en `data/agrometricas_historico/indice_crecimiento.parquet`, 3 136 filas; 3 132 con datos): `IC = hojas / DDT / 10`.
La diferencia máxima contra el `ic_real` de AppSheet es 0.005, o sea que AppSheet redondeaba a 2 decimales; las 4 filas restantes no tienen hojas ni DDT (IC 0, basura).
Se generaliza a `IC = hojas / (DDT ^ exponente_ddt) / divisor` (inicial: divisor 10, exponente 1). El **plan IC** es una tabla por DDT 5–20
(`ic_plan.parquet`: 0.30, 0.33, 0.35, 0.33, 0.36, 0.38, 0.48, 0.63, 0.74, 0.89, 1.05, 1.08, 1.12, 1.18, 1.24, 1.30), igual para todas las variedades
(en 22 de 3 133 filas el plan guardado en AppSheet difería de la tabla; el histórico conserva el suyo).

**Decisiones**
1. El capturador registra **solo las hojas** (dato crudo). El IC y el plan se calculan con la **versión de fórmula vigente a la fecha del registro**
   (`agm_ic_formula.vigente_desde ≤ fecha`, la más reciente; sin ninguna anterior, la primera).
2. Cambiar la fórmula **no recalcula** lo ya guardado. «Recalcular» es explícito: vista previa (qué cambiaría) y confirmación.
3. **Un IC por turno y día** (índice único parcial entre los no eliminados). Un segundo registro del mismo turno y día es una **corrección**: en el teléfono se
   confirma con la casilla «Corregir el índice ya registrado de este día» (manda `correccion: true`); sin ella la base lo rechaza (22023).
4. El DDT sale de la siembra del turno. **Fuera de 5–20 solo se avisa** en el teléfono (nunca bloquea). Sin siembra o antes de la siembra: no se calcula el IC (se guardan las hojas).
5. Permisos: **sin acciones nuevas**. Registrar = «Registrar parámetros»; corregir días anteriores a ayer o registros ajenos = «Corregir parámetros»;
   guardar fórmula y recalcular = «Configurar rangos» (`configurar_rangos`); eliminar = «Eliminar por completo» (`eliminar_definitivo`, solo administrador salvo concesión).
   Lo que se ve y edita lo decide la zona del turno, igual que la 125 (`_agm_puede_ver_registro`, `_agm_puede_editar_registro`). Ningún nombre de rol.

**Base** (`sql/127`, requiere 109, 122 y 125; solo crea objetos `agm_ic_*`, correr/re-correr 109/122/125 en cualquier orden no la rompe; no pisa una fórmula ya editada)
- Tablas: `agm_ic_formula` (versiones), `agm_ic_plan` (versión, DDT, IC plan), `agm_ic_registros` (id uuid del teléfono, turno, fecha, DDT, hojas, `ic_real`, `ic_plan`,
  `version_formula_id`, `zona_id`, autor, `editado_*`, tumba `eliminado_*`, `origen`/`id_appsheet`, `bajado_a_agl_en`, `huella`).
- Teléfono: `fn_agm_ic_config()` (todas las versiones con su plan: el teléfono las guarda en IndexedDB, clave `ic_formula`, y calcula sin señal), `fn_agm_ic_formula_vigente(fecha?)`,
  `fn_agm_ic_registrar(p)` (idempotente por id; un objeto, o `{registros: [...]}` = lote de la cola con `resultados` por registro).
- Lista y gráficas: `fn_agm_ic_mis_registros(p)` (mismos filtros que `fn_agm_mis_registros`: temporada, turno exacto, `turno_contiene`, zona, lote/lotes, fechas, texto, paginación; trae `ic_real`, `ic_plan`, `puede_editar`, `puede_eliminar`).
- Edición y baja: `fn_agm_ic_editar` (conserva la versión de fórmula del registro), `fn_agm_ic_eliminar` (motivo ≥ 15 letras, tumba).
- Control: `fn_agm_ic_guardar_formula({vigente_desde, divisor, exponente_ddt, notas?, plan?})` (misma fecha = reemplaza; sin `plan` copia el de la vigente), `fn_agm_ic_recalcular({previsualizar?, desde?, hasta?, turno_ciclo_id?, temporada?})`.
- AGL: `fn_agm_ic_cargar_appsheet` (histórico; UUID determinista `_agm_uuid_appsheet('ic:'||id_appsheet)`; IC con la fórmula vigente, plan y DDT de AppSheet si vienen; 77 repetidos del histórico quedan en `en_conflicto`),
  `fn_agm_ic_exportar` / `fn_agm_ic_confirmar_bajada` / `fn_agm_ic_purgar_bajadas` (patrón 122/125: huella sha256, cursor `i|<id>`, tumbas; no se purga lo de un turno activo) y `fn_agm_ic_exportar_formulas()`.

**Teléfono** (`FormParametros.tsx`, `lib/agrometricas/indicePura.ts`): sección plegable «Índice de crecimiento (IC)»; siempre está, y del DDT 5 al 20 se abre sola con la insignia «Toca medir». Campo de hojas, IC
y plan en vivo con la fórmula vigente a la fecha de la jornada (guardada en el teléfono). La cola lleva el tipo nuevo `indice` (función `fn_agm_ic_registrar`); entra a «Mis registros».
**Administración › Fórmula del IC (AgroMétricas)** (`/admin/agrometricas-ic`, `FormulaIC.tsx`, permiso «Configurar rangos»): versiones, crear/editar versión con tabla de plan y «Recalcular» con vista previa.

**Pruebas (escritas, sin correr)**: `pruebas/sql/127_agrometricas_indice_crecimiento.sql` (fórmula, versiones por fecha, corrección, permisos por zona, recalcular, baja, órdenes 127>127, 125>127>125, 109>127, 122>127) y
`pruebas/unit/agrometricas_indice.test.mjs`.

**Lado AGL (siguiente bloque)**: (1) cargar el histórico del IC (`indice_crecimiento.parquet` → `fn_agm_ic_cargar_appsheet`, mismo mapa de usuarios que parámetros; `idindicecrecimiento` = `id_appsheet`, `idregistroturno` → turno AGL, `numero_hojas`, `ddt`, `ic_plan`);
(2) bajar lo capturado en campo (`fn_agm_ic_exportar` → guardar con huella → `fn_agm_ic_confirmar_bajada` → `fn_agm_ic_purgar_bajadas`, aplicando tumbas) y leer las fórmulas con `fn_agm_ic_exportar_formulas`;
(3) botón «Fórmula del IC» en /AM01 (ver versiones; la edición se hace en AgroNoti); (4) gráfica IC real contra plan por turno (por DDT) usando la fórmula vigente de cada registro.
