# «Campo» · estado y traspaso (leer primero si abres una conversación nueva)

> Escrito el 2026-11-22 por Claude. Objetivo: que cualquier conversación nueva entienda el trabajo de «Campo» sin que el
> usuario explique nada. Actualizar al terminar cada bloque. Lo más importante primero; detalle de contratos al final.
> También leer: `proyecto-seguimiento.md` (reglas y pendientes), `MEMORIA_CLAUDE.md`, y las memorias
> `catalogos-existentes-nunca-duplicar`, `pruebas-visuales-en-navegador`, `pruebas-automaticas-con-limite-de-tiempo`.

## 1. Qué es y por qué

El usuario (Torre de Control, Agropecuaria Montelibano) quiere **un solo lugar «Campo»** donde se vea y se mueva todo lo
que pasa en una **estación de riego**, en vez de un módulo nuevo por cada tema. Hay dos proyectos que se hablan:
**AgroNotificaciones** (Next.js 16 + Supabase, teléfono y web, `C:\HENRYALVARADO2022\agronotificaciones`) y **AGL**
(Python + JS de escritorio, `C:\HENRYALVARADO2022\AGLGestion_App`). **AGL manda** (catálogos, planes, análisis);
**Supabase es solo un intermediario**: lo registrado en campo se baja a AGL con huella sha256 y se purga de Supabase
(retención 30 días). Quien registra en el campo es quien tiene la estación a cargo (estacionero, supervisor o jefe);
el parametrista solo usa AgroMétricas.

Documentos de diseño y planes (todos aprobados por el usuario):
- Diseño: `docs/superpowers/specs/2026-11-22-campo-inyeccion-motores-design.md` (§9 llamadas mías, §10 aclaración del tanque).
- Planes: `docs/superpowers/plans/2026-11-22-campo-bloque1-menu-y-devolucion-a-bodega.md`, `...-bloque2-inyeccion-por-lote.md`,
  `...-bloque3-motores-y-combustible.md`. Anterior: `...2026-11-21-planificador-actividades-campo-design.md`.

## 2. Reglas que mandan (el usuario las puso; no se discuten)

1. **Catálogos únicos**: todo campo con catálogo existente (lotes, equipos/Flota, estaciones, materiales/MARA, turnos,
   choferes y vehículos de campo, temporadas, zonas) se llena SIEMPRE desde él; prohibido listas paralelas, listas fijas en
   código o texto libre. Se guarda id (FK) y se valida en la base. Lo que falte se agrega al catálogo existente (AGL dueño) con
   control de duplicados. (Nació de que Inyección permitía escribir lotes a mano.)
2. **Nada a producción de AgroNotificaciones** sin que el usuario diga «pasa a producción». Claude SÍ corre los `sql/NN_*.sql`
   en **desarrollo** (cadena `SUPABASE_DB_URL_DESARROLLO` de `.env.local`, nunca impresa; verificar que contenga el ref
   `ifzwqdstpoyoidsflvuo` y NO `ooxoqopaiavfhfxxtzgh`; psql en `C:\Program Files\PostgreSQL\17\bin\psql.exe`; correr dos veces
   para comprobar idempotencia). **Producción la corre SOLO el usuario**, después de que Vercel publique el código.
3. **Modelos y pruebas**: Sonnet escribe código/SQL y NO ejecuta pruebas; **Opus es el único que ejecuta pruebas, UNA vez por
   bloque, tope 25 min** (copiar el tope en cada brief). Lo visual se revisa directo en Chrome (servidor de desarrollo
   `localhost:3000`, que el orquestador enciende con `npm run dev` si está apagado; AGL en `localhost:5001`/`5000` solo mirando).
4. **Todo lo que el usuario pida se anota de inmediato en `proyecto-seguimiento.md`** (ambas copias: agronotificaciones y
   AGLGestion_App) y solo se borra cuando está hecho Y aprobado por él.
5. **Movimiento de producto = dinero**: todo debe quedar detallado (quién, a dónde, en qué vehículo, cuándo, cuánto, saldo
   antes/después, quién anuló y por qué). Sin dudas al aire.
6. Reglas de siempre: UTC-6; mobile-first; botones ≥44 px; tema oscuro; sin hardcodear roles (matriz de permisos); verbos
   estándar; `UPDATE`/`DELETE` siempre con `WHERE`; SQL idempotente con `pg_temp.parchar(fn, viejo, nuevo, marca)`;
   bucles/consultas de red con freno (hooks `scripts/revisar-bucles.mjs` y `scripts/revisar_bucles.mjs`).
7. Edita `AGLGestion_App/backend/catalogos.py` solo con la herramienta Edit (CRLF). AGL solo escritorio (no teléfono).

## 3. Estado por bloque (2026-11-22, todo en la rama `desarrollo`; NADA publicado a producción)

| Bloque | Qué | Código | SQL | Pruebas |
|---|---|---|---|---|
| 1 | Menú «Campo» (`/campo`, tarjetas por permiso) + **Devolución a bodega** | AgroNoti `2700291`, AGL `c2aa348` | `sql/128` **corrida en desarrollo** | Opus: unitarias 44/44, SQL 43/43 en 7 órdenes, equivalencia OK, clics 28/30 (2 fallas eran del script) |
| 2 | **Inyección / Drench / Calidad por lote** (ficha `/inyeccion`, MARA técnico en AGL, categorías LTP, plan por lote, cumplimiento y tendencia) | AgroNoti `bfdef5b`+fix, AGL `c701827`+fix | `sql/129` **corrida en desarrollo** | Opus: unitarias 56/56, SQL 70/70 (9 órdenes), integración AGL↔base 37/37; clics SIN PROBAR |
| 3 | **Motores de riego y combustible** (ficha `/motores`, `sql/130`, AGL pestaña «Motores») | AgroNoti `cebeaf9`, AGL `60ba208` | `sql/130` **corrida en DESARROLLO (2026-11-22, 2 veces)** | QA Opus 2 vueltas: SQL 84/84, integración AGL↔base OK; clics SIN PROBAR |
| fix A | **Devolución con detalle completo** (chofer, vehículo, destino exacto, motivo, GPS, saldo antes/después, anulación) | `cebeaf9` | `sql/131` **corrida en DESARROLLO** | SQL 25/25; falta saldo antes/después en la exportación y que AGL muestre GPS |
| fix B | **Objetivos de Inyección = catálogo en AGL ampliable desde el campo sin duplicados; lote SOLO del catálogo** | `cebeaf9` / AGL `60ba208` | `sql/132` **corrida en DESARROLLO** | SQL 53/53; lote canónico de AGL = ubicación técnica (corregido) |

Próximo número libre de SQL: **133**. Orden de corrida correcto: …→121→128→129→130→131→132. **Si se vuelve a correr** la
128/99/100/116 → correr la 131; si se vuelve a correr la 129 → correr la 132; la 130 sobrevive a ambas. Las pruebas SQL
de la 128 y la 129 asumen el diseño anterior (devolución sin chofer/vehículo; lotes de texto libre) y fallan DESPUÉS de la
131/132: correrlas antes o actualizarlas (la QA lo está haciendo).

## 4. Cómo está construido (mapa de archivos)

**AgroNotificaciones**
- Hub: `src/lib/campo/fichas.ts` (lista de fichas por permiso: Fertirriego, Inyección, Motores, AgroMétricas),
  `src/components/campo/PanelCampo.tsx`, `src/app/(app)/campo/page.tsx`; pantalla `campo` en la matriz (módulo «Campo»).
- Base común de bodega: **Fertirriego** (`sql/91…`, `src/lib/fertirriego/*`, `src/components/fertirriego/*`): libro inalterable
  `fert_movimientos`, `_fert_mover`, despachador `_fert_procesar` (se parcha con `pg_temp.parchar`), custodia y relevo con
  código, traslados, cola sin señal (IndexedDB), `fn_fert_estado_campo` (lo que baja al teléfono), `fn_fert_exportar` (AGL).
- Devolución a bodega: `sql/128` (+ `131` detalle), `FormDevolucionBodega.tsx`, `src/lib/fertirriego/devolucionBodega.ts`,
  tipo de movimiento `DEVOLUCION_BODEGA`, tablas `fert_devoluciones_bodega(+_detalle)`; anulación por
  `_fert_op_anulacion_devolucion_bodega`; destino ∈ {SUMINISTROS, BODEGA, TALLER} (lista cerrada porque no hay catálogo de
  destinos); chofer y vehículo de los catálogos de campo (`fert_choferes`, `fert_vehiculos`, mismos selectores que Recibir).
- Inyección: `sql/129` (+`132`), tablas `iny_*` (categorías, plan, aplicaciones, objetivos, bajada), movimiento
  `APLICACION_LOTE` en el MISMO libro (una bodega por estación), funciones `fn_iny_publicar`, `fn_iny_estado_campo`,
  `fn_iny_exportar/confirmar/purgar/retencion`, `fn_iny_objetivo_agregar`, `fn_iny_objetivos_exportar/confirmar`;
  teléfono `src/lib/inyeccion/*`, `src/components/inyeccion/*`, ruta `src/app/(app)/inyeccion`. Lote = catálogo `lotes`/
  `lotes_temporada` (nomenclatura canónica); objetivos = `iny_objetivos` con `nombre_norm` único (normalización idéntica en
  SQL/TS/JS/Python: minúsculas, sin tildes ni signos, espacios colapsados, plural simple).
- Motores: `sql/130`, libro PROPIO por tanque `mot_movimientos`/`mot_saldos` (no toca `fert_saldos` para no romper la huella de
  la 102 ni «Terminar ciclo»), `mot_motores` ligada a `equipos` por `equipo_id` (modelo, intervalo y aviso de mantenimiento),
  `mot_tanques`, registros diarios, recepciones de diésel, mantenimientos, asignaciones con historial; funciones `fn_mot_*`
  (`publicar`, `estado_campo`, `ultimo`, `exportar`, `confirmar_bajada`, `purgar_bajadas`, `bajada_retencion`);
  teléfono `src/lib/motores/*`, `src/components/motores/*`, ruta `src/app/(app)/motores`. Un registro por motor y día;
  gastado = visor_ini − visor_fin + recibido del día; el visor realinea el saldo con ajuste visible `AJUSTE_VISOR`;
  mantenimiento y movimientos de motor solo con «configurar»; daño y reemplazo → el tanque queda en la estación; fin de
  temporada → el saldo se va con el motor o se devuelve.

**AGL** (todo bajo `AGLGestion_App/`)
- Inyección: `backend/inyeccion_config.py` (categorías LTP), `inyeccion_campo.py` (plan por lote, publicar), `inyeccion_bajada.py`,
  `inyeccion_cumplimiento.py` (TOLERANCIA_CANTIDAD = 5 %; estados a tiempo/tarde/temprano/de más/de menos/pendiente/no
  hecho/sin plan), `inyeccion_objetivos.py`; MARA técnico en `backend/catalogos.py`; vistas `frontend/js/views/inyeccion*.js`,
  pestaña «Inyección» y «Motores» dentro de /FR01 (`views/fertirriego.js`); rutas `/api/inyeccion/*` y `/api/motores/*` en
  `server.py` (heredan T-Code /FR01); bajada automática en `backend/fertirriego_auto.py`.
- Motores: `backend/motores_campo.py` (publicar a estaciones), `motores_bajada.py`, `motores_analisis.py` (bandas por motor
  mediana ± 3·MAD, mínimo 8 registros; alertas atendibles con nota; cuadre de combustible), vistas `views/motores*.js`.
  La **Flota** (`flota`) es el catálogo maestro de motores (campos `motor_riego`, `intervalo_horas`, `capacidad_tanque_gal`);
  catálogo `modelos_motor` (modelo → intervalo y aviso) enlazado por el texto normalizado del campo Modelo.
- Fertirriego/devoluciones: `fertirriego_analisis.py` (DEVOLUCION_BODEGA es salida de inventario, no consumo),
  `fertirriego_detalle.py` (`filas_devoluciones_bodega` con todo el detalle).

## 5. Contratos AGL ↔ base (resumen; el detalle exacto está en el SQL)

- Bajada con huella: `fn_*_exportar` devuelve filas `{cursor, id, texto, huella, …}`; huella = sha256 del `texto` tal cual (no
  reserializar); `sha256_lote` = sha256 de las huellas unidas con `|` ordenadas por cursor en binario; AGL guarda, llama a
  `fn_*_confirmar_bajada` y luego `fn_*_purgar_bajadas` (**sumar solo los conteos reales, nunca `retencion_dias`**: error ya visto).
- Inyección: `fn_iny_publicar({temporada, completo, categorias, plan, materiales, objetivos})`; cada línea de plan trae
  `lote` del catálogo, `categoria_clave` normalizada (`ferti-riego|inyeccion`), `material` = código SAP.
- Motores: `fn_mot_exportar` filas con `tabla` en singular (`registro|recepcion|mantenimiento|asignacion`), cursor `r|c|m|a|`;
  estación/zona/equipo/tanque vienen en el sobre (no en `texto`) y AGL los mezcla; confirmar con `{cursor,id,huella}`.
- Desajuste conocido: `fn_mot_exportar` no baja `mot_movimientos` (devoluciones de tanque no restan en el cuadre de AGL).

## 6. Decisiones que tomé yo y el usuario debe confirmar

- Inyección comparte el libro de la bodega y sus productos aparecen también en los selectores de Fertirriego (`fertirriego=true`).
- Tolerancia 5 % en cantidad; objetivo = selección múltiple, al menos uno; categoría inactiva sin señal se acepta con
  `CATEGORIA_INACTIVA`; un producto que ya era fertilizante conserva `fert_analisis`; retención 30 días tras bajar a AGL.
- Anular un consumo con saldo negativo se rechaza (comportamiento viejo de `_fert_mover`, afecta también a Fertirriego).
- Devolución a bodega: el vehículo es obligatorio (pedido del usuario); un vehículo viejo sin tipo en el catálogo la bloquea
  hasta completar su tipo en Administración › Choferes y catálogos de campo.
- Motores (preguntas que el usuario aún no contestó; se usaron los valores por defecto del plan): ¿los motores ya están en la
  Flota de AGL con tipo «Bomba» (en «A81 M6068» entiendo código A81, modelo 6068)?; ¿quién da el intervalo de mantenimiento por
  modelo (p. ej. 500 h)?; el visor corrige el saldo con ajuste visible (sin aprobación de jefe); un registro por motor y día;
  el jefe (permiso «configurar») registra mantenimientos; alertas solo en AGL (no campana ni Planificador).
- La hoja de papel de referencia: `AGLGestion_App/Control de Consumo de horas y combustible bombas de riego.jpeg`
  (FTR_F-MA-103). El caudal NO se registra.

## 7. Qué falta para cerrar el trabajo (en orden)

1. **QA de Opus de las migraciones 130/131/132 y de AGL** (lanzada; resultado en este archivo cuando llegue). Corregir lo que falle
   (Sonnet) y que Opus repita solo lo fallado.
2. **Correr 130, 131 y 132 en DESARROLLO** (Claude lo hace, dos veces, y verifica) y luego revisar lo visual en Chrome
   (`localhost:3000/campo`, `/inyeccion`, `/motores`, devolución con detalle) y, si el usuario quiere, QA con clics de Opus
   (crear y borrar su usuario QA y su estación de prueba).
3. **Pendientes técnicos conocidos**: «Eliminar por completo» (119–121) no cubre devoluciones a bodega, inyección ni motores;
   riesgo señalado: `inyeccion_campo.lotes_del_catalogo` depende del campo de temporada de `catalogos.listar("lotes")` (revisar con
   datos reales, y que `public.lotes` esté sincronizado con AGL, sql/105); el saldo local del teléfono no reproduce el
   `AJUSTE_VISOR`; el saldo corrido de la Bitácora sale desordenado si varios registros caen en el mismo minuto (viejo);
   botón «Quitar producto» del editor de líneas ~32 px; tema claro de Campo sin probar; QA con clics de Inyección y Motores;
   alimentar el Planificador con mantenimientos próximos (opcional).
4. **Bloque 4 (cuadre y alertas)**: ya hay cuadre y alertas por motor en AGL; falta integrarlos al Planificador si el usuario quiere.
5. **Para producción (solo con «pasa a producción»)**: merge de `desarrollo` a `main` en un worktree aparte (el `CLAUDE.md` del
   usuario tiene cambios locales), esperar a Vercel, y que el USUARIO corra 128→129→130→131→132 en producción; AGL:
   `Publicar_Produccion.bat /SI` y que el usuario reinicie AGL. Dar al usuario técnico «Integración AGL» el permiso
   `fertirriego_agl · publicar` (ya lo tiene para Fertirriego) para publicar Inyección/Motores.

## 8. Recetas rápidas

- Encender el servidor de desarrollo: `npm run dev` en `agronotificaciones` (puerto 3000). Nunca `npm run build` allí.
- Correr una migración en desarrollo (PowerShell): leer la cadena de `.env.local` (`SUPABASE_DB_URL_DESARROLLO`), comprobar
  el ref, `psql $u -v ON_ERROR_STOP=1 -f sql\NNN_*.sql` dos veces; verificar con `select` (nunca imprimir la cadena).
  Permisos: tabla `permisos(rol_id, recurso, accion, permitido, …)`; pantallas en `pantallas(codigo, modulo, ruta, en_menu…)`.
- QA: worktree + `npx next build` + `npx next start -p 3100`, usuario QA temporal (crear y borrar), réplica SQL en `pg_qa`
  puerto 5499 sobre clones de `t117`. Detalles en `proyecto-seguimiento.md` §5.
- Publicar AGL: `Publicar_Produccion.bat /SI` (en PowerShell: `& cmd.exe /c ".\Publicar_Produccion.bat /SI"`, tarda minutos;
  copia a `…\TORRE DE CONTROL\Torre Control dv`). El usuario reinicia AGL.
- Supabase «Log Query» (panel Usage) sube cuando se leen logs desde el panel; no es la app y no se factura (100 GB incluidos).


## Resultado QA 2026-11-22 (Opus, 2 vueltas)
- Corregido: alias `l` en 132, CRLF en parchar 132, orden de tipos en 130, `lotes_del_catalogo` por id de temporada y canónico = ubicación técnica (AGL, sin commit), normalización de mayúsculas con tilde en 132.
- Pendiente: pruebas SQL 128/129 con el diseño viejo (actualizar); saldo antes/después y GPS de la devolución en AGL; `mot_movimientos` no se exporta; clics de Inyección/Motores; verificar el cambio de canónico con datos reales de AGL.
