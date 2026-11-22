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
rudylopez@agl.com, gustavobetancourth@agrolibano.com). Cada usuario ve los suyos; el encargado de zona los de su zona; el
administrador todos.

**Funciones** (todas `jsonb`, mensajes en español)
- `fn_agm_cargar_appsheet({registros:[{id_appsheet, fecha, turno_ciclo_id (= id del turno en AGL, `turnos_ciclo.agl_id`),
  usuario_appsheet, <13 valores>, latitud?, longitud?, comentario?}], mapa_usuarios:{Glopez:'correo',…}})` → `{insertadas,
  ya_existian, sin_usuario:[{id_appsheet, usuario_appsheet}], sin_turno:[{id_appsheet, turno}], en_conflicto:[{id_appsheet,
  existente}], invalidas:[{id_appsheet, error}]}`. Solo el usuario técnico (`fertirriego_agl · publicar`). Idempotente: el `id`
  es determinista (sha-256 de `'agm_appsheet:' || id_appsheet`, versión 5/variante RFC; AGL puede recalcularlo) y lo ya cargado
  no se toca (no pisa ediciones). Sin autor o sin turno **no se carga** (se informa para reintentar). Nacen ya «bajados»
  (AGL los tiene): solo vuelven a bajar si alguien los edita.
- `fn_agm_mis_registros({temporada?, turno?, turno_ciclo_id?, zona_id?, desde?, hasta?, texto?, limite? (50, máx. 1000), pagina?
  (desde 0), orden? 'desc'|'asc'})` → `{total, limite, pagina, registros:[…]}`. Cada registro trae todas las columnas con
  valores (para graficar), `turno, temporada, ciclo, estacion, zona, creado_por_nombre, creado_por_email, editado_por_nombre`,
  y `puede_editar`, `puede_eliminar`. No trae eliminados, huella ni datos internos. Visibles: administrador (todos), dueño (los
  suyos, con `agrometricas · ver`) y encargado de la zona del turno («Corregir parámetros» en esa zona).
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
