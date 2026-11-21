# Seguimiento del proyecto · punto de partida para cualquier conversación nueva

> **Actualizado: 2026-11-20.** Lo escribe y mantiene Claude. Detalle técnico e historial: `agronotificaciones/MEMORIA_CLAUDE.md`.
> Al abrir una conversación nueva: **leer este archivo primero**, después `MEMORIA_CLAUDE.md` y la memoria `agl-ordenes-sap-procesos.md`.
> Hay una copia idéntica en `C:\HENRYALVARADO2022\AGLGestion_App\proyecto-seguimiento.md`: **actualizar las dos al terminar cada bloque.**
> Responder siempre al usuario **en español, claro y sin jerga**.

---

## 1. Qué hace cada proyecto

| | **AgroNotificaciones** | **AGL Gestión** |
|---|---|---|
| Para qué | Plataforma web/teléfono «**Monitoreo agrícola integral**»: tickets de maquinaria, controles, catálogos, permisos y **Fertirriego** en campo (sin señal). | Gestión de la Torre de Control: catálogos maestros, planificación, órdenes SAP (/OS01), LTP, turnos (/TR02), análisis de Fertirriego (/FR01). **AGL manda.** |
| Carpeta / tecnología | `C:\HENRYALVARADO2022\agronotificaciones`· Next.js 16 + Supabase, Vercel | `C:\HENRYALVARADO2022\AGLGestion_App`· Python + JS, datos JSON/Parquet en OneDrive |
| Ramas / publicar | `desarrollo` (commits); `main` = producción. Publica Claude solo con «pasa a producción» | `main` local. Publica el usuario: `Publicar_Produccion.bat` y reiniciar |
| Estado hoy | `main` = `7a17a2b` (publicado 2026-11-19; sql 118–121 corridas en producción) · `desarrollo` = `296a7f2` | `main` = `16adc8f` (publicado) |

**Cómo se unen:** Supabase es **solo un intermediario** («llenar lo mínimo»). AGL publica a Supabase lo que el campo necesita
y baja lo que el campo registra. Lo terminado se baja a AGL, se verifica (sha256) y se borra de Supabase.

---

## 2. Reglas de trabajo (acordadas, no se discuten)

**Enrutamiento de modelos y ahorro de tokens** (regla del usuario, 2026-11-15; actualizada para pruebas únicas)
- Prioridad: gastar el mínimo de tokens sin bajar la calidad ni romper la sincronización AgroNotificaciones ↔ AGL.
  Claude actúa como **arquitecto y orquestador**: reparte el trabajo en subagentes con el modelo justo
  (herramienta Agent, parámetro `model`).
- **Haiku** (básico, obligatorio): explorar carpetas, leer logs, `git status`/`log`/`diff`, comandos simples de terminal,
  formatear texto, escribir o actualizar documentación (este archivo, `MEMORIA_CLAUDE.md`, manuales).
  - *PROHIBIDO:* ejecutar pruebas, builds de verificación o QA.
- **Sonnet** (intermedio, obligatorio): escribir código (Python de AGL, Next.js/TypeScript de AgroNotificaciones),
  refactorizar, lógica de negocio, SQL y migraciones, endpoints/APIs.
  - *PROHIBIDO:* ejecutar suites de pruebas, pruebas unitarias, QA con clics o levantar servidores para validar.
    Sonnet escribe el código, verifica sintaxis mentalmente y entrega directo al orquestador.
- **Opus** (crítico y **ÚNICO encargado de pruebas**, EXCLUSIVO):
  1. **Puerta única de pruebas y QA:** es el ÚNICO autorizado para ejecutar pruebas (unitarias, integración, QA de flujo
     local ↔ en línea: AGL ↔ Supabase ↔ teléfono) y verificar que todo compile y funcione.
  2. Validaciones finales de seguridad, cifrado o autenticación (p. ej. `/SE04`, RLS, permisos).
  3. Aprobar antes de hacer merge de ramas complejas a `main`.
  4. Diseño de arquitectura profunda.

**Regla estricta anti-redundancia de pruebas (obligatoria):**
- **Cero pruebas intermedias:** ni el orquestador, ni Haiku, ni Sonnet ejecutan pruebas. Todo el desarrollo se hace en
  bloque y **se prueba UNA sola vez al final con Opus**.
- **Si una prueba falla en Opus:** Opus NO reescribe código extenso. Devuelve el error exacto y la línea que falló al
  orquestador para que **Sonnet** aplique el fix. Luego Opus re-ejecuta *únicamente* la prueba que falló, no toda la suite.

**Reglas operativas:**
- Cada encargo a un subagente lleva `model` explícito. Ante la duda entre dos niveles, usar el más barato.
- Briefs cortos que apunten a rutas de archivos en vez de pegar código. Pocos agentes a la vez. No releer lo que ya está en contexto.
- El modelo de la conversación principal lo elige el usuario con `/model` (`/model sonnet` para el día a día; `/model opus` solo para tareas críticas).
- El límite de uso es compartido (los subagentes en Opus agotaron el límite de 5 horas el 2026-11-15). Invocar a Opus
  **una sola vez por bloque funcional terminado**, nunca tras cada archivo editado.

**Generales**
- **QA con clics reales** sigue obligatoria antes de entregar (Edge sin ventana + CDP), pero la ejecuta **SOLO Opus, una vez por bloque**.
- **Supabase es solo un intermediario:** todo lo documental (auditorías, bitácoras, copias de registros, informes) se baja a AGL,
  se consulta desde AGL y se borra de Supabase tras verificar la copia (sha256). En AgroNotificaciones no van pantallas de bitácora ni auditoría.
- **«Eliminar por completo»** (borrar de verdad) es solo del administrador y nunca se enciende con los niveles rápidos de Permisos.
- Secretos nunca en el chat ni en servicios externos; las credenciales de usuarios técnicos las pone el usuario.
- Fechas y horas en **UTC-6 (America/Tegucigalpa)**. No se asume «hoy»: los capturadores registran jornadas de ayer.
- **No hardcodear nombres de roles**: todo por la matriz de permisos de la base.
- Mobile-first, botones de dedo (≥44 px), operable con teclado, verbos estándar (Guardar, Editar, Eliminar, Importar, Exportar).

**AgroNotificaciones**
- Commits en `desarrollo`. **Nunca** push/merge a `main` sin «pasa a producción» (merge en un worktree aparte; el `CLAUDE.md` del usuario tiene cambios locales).
- **Claude no ejecuta SQL de estructura (DDL).** Entrega `sql/NN_*.sql`, lo prueba (solo Opus) y el usuario lo corre: **primero desarrollo, después producción**.
- Migraciones de permisos: equivalencia antes/después sobre un clon de producción.
- Supabase rechaza `UPDATE`/`DELETE` sin `WHERE` aun dentro de funciones: **todo** lleva `WHERE`.
- Toda migración es idempotente y se prueba en distintos **órdenes de corrida** (p. ej. 100>101>100): quien redefine una función ya parchada debe traer ese parche.
- No usar `npm run build` en la carpeta del usuario (borra su `.next`); se compila en el worktree de QA. Borrados: listar primero y borrar por id exacto.

**AGL**
- **Datos de producción solo lectura para Claude:** `C:\Users\Hhernandez\OneDrive - Agropecuaria Montelibano\Escritorio\TORRE DE CONTROL\Torre Control dv\data`.
- No usar ni detener los servidores del usuario (puertos **5000** y **5001**). Las pruebas van en una copia aislada.
- La publicación (`arranque.py`) **nunca** modifica datos del usuario ni `data/sistema/menu_schema.json`.
- `backend/catalogos.py` es **CRLF**: editar solo con la herramienta Edit. Toda vista nueva declara `canales`.

**SAP:** solo **lectura**, en una **sesión propia** (CreateSession → minimizada → CloseSession). Se restaura el portapapeles.

---

## 3. Qué hay hoy (lo hecho)

### 3.1 AgroNotificaciones (en producción, `main` = `7a17a2b`)
- **Tickets de maquinaria**: horómetros y labores, revisión por lotes, continuidad de horómetros, procesos del ticket (Registrando → Revisando → Pendiente aprobación → Notificado en SAP), «Mover proceso», cerrar ticket.
- **Permisos v2** (92–93, 97): varios roles por persona, «Todas las zonas», permisos por módulo, historial de accesos, delegación (el Jefe de zona solo administra **Estacioneros**). **Menú por rol** (103): el menú nunca da permisos.
- **Desinfección desde AGL** (104): DDT y siembra salen de `turnos_ciclo`. Tablas viejas de Trasplante y Riego retiradas (con respaldo).
- **Eliminar por completo** (119–121, publicado): solo administrador, motivo ≥ 15 letras, solo en línea; botón en el detalle del teléfono y en Administración › Eliminar registros (`/admin/fertirriego-eliminar`). Antes de borrar en Supabase, AGL baja la copia, verifica el sha256 y la confirma (auditoría privada `fert_eliminaciones`, filas mínimas que se limpian a los 180 días). Los turnos archivados no se borran (reactivar primero).
  - Riesgos conocidos: borrar una recepción ya consumida deja saldo negativo (se avisa); borrar algo anterior a un conteo puede descuadrar; quien tenga «ver» en Conexión AGL puede leer las copias.
- **Bitácora de Fertirriego** por día (lo más reciente arriba); los productos de un mismo registro se muestran juntos en un bloque con sangría «hecho junto», expandido por defecto, con Expandir/Contraer bloques.
- **Bitácora de errores** (118, `/admin/errores`): publicada, pero **pendiente mover a AGL** (§4).

### 3.2 AGL (`main` = `16adc8f`)
- /SE03 **Conexiones** cifradas (clave maestra por PC). /SE04 **Seguridad**: la PC del dueño se oculta sola (revisión de Opus aprobada con observaciones, `docs/seguridad-agl.md`).
- /FR01 **Fertirriego**: Sincronizar todo, **Clasificación de productos** (grupo → «Publicar a las estaciones» / «Fertilizante (entra al análisis)»), **Análisis** (incluye históricas), **Comparativo** Plan · SAP · Real con códigos nutricionales, gráficos y «Las tres», **Eliminados** (solo consulta), «Ver datos de prueba».
- Comparativo: solo turnos de /TR02 y salidas SAP de sus órdenes; sin límite por unidad; porcentajes y diferencias con color; Área (mz); fecha de corte siempre «Al». Constantes de elementos en /CF08.
- /CF07 **Cálculo de Fertilizantes**: selector «Plan Nutricional a calcular» (V0 o simulación de /PN02); totales sin separar por unidad.
- /TR02 **Terminar ciclo / Reactivar** y «Vista ALV por lote». /OS01 **Gestor de Órdenes SAP** (§6); Partidas con Responsable, Estado, Área, Dosis y Gasto/mz. /OS06 **Grupos de Coste**.
- **DataGrid de toda AGL**: botón «Filtros» (varias columnas), menú rápido Alt+↓ / Shift+F10 (ordenar, filtrar, agrupar), encabezados con teclado, Enter/F2 edita.
- Planificación de lotes y Polinización (checklist de semanas), LTP (semanas en orden; «Total Producto» con regla SINAGRO), **Mi Día** (Alt + M; @usuario comparte tareas).

### 3.3 Fertirriego (une los dos proyectos)
El estacionero registra en el teléfono (sin señal) lo que recibe, aplica, cuenta y entrega; AGL publica turnos, plan y materiales, y baja todo para analizar.
Diseño y decisiones (no volver a preguntar): `agronotificaciones/docs/fertirriego-diseno.md`, `fertirriego-piloto1.md`, `fertirriego-piloto2.md`, `fertirriego-archivo-turnos.md`.
- Bodega por estación, aplicación por turno con **DDT del plan o Extra**, custodia y **relevo** con código de 30 s o de **12 horas**, traslados, conteos, envases, productos de campo, guardado en segundo plano, PWA instalable, letra grande y tema oscuro.
- **Aplicar sin inventario** (casilla obligatoria, observación `SALDO_NEGATIVO`). **Anular diferencia de relevo** (115; permiso «Anular», motivo ≥ 25 letras). **GPS opcional** (`SIN_UBICACION`).
- **Registro histórico** (116–117): permiso temporal por persona y estación; aplicaciones históricas que **no mueven inventario** (en AGL cuentan como Real).
- **Modo de pruebas** (98): estaciones «PRUEBA · X», AGL no las mezcla. **Terminar ciclo** (102): AGL baja el turno, verifica la huella y lo borra de Supabase; **Reactivar** lo sube igual.
- Estado: dos pruebas piloto con estacioneros; **en producción ya en modo real** (2026-11-20).
- Manuales: `agronotificaciones/docs/manuales/` y `AGLGestion_App/docs/manual_fertirriego_AGL.md`. Presentación a gerencia: `docs/presentaciones/Fertirriego_Presentacion_Gerencia.pptx`.

### 3.4 Migraciones SQL (91–121)
- **91** base Fertirriego · **92–93** permisos v2 · **94–95** campo sin señal · **96** relevo y traslados · **97** roles que administra cada rol · **98** modo de pruebas · **99** piloto 1 · **100** detalle completo al teléfono y a AGL · **101** AGL ve lo de prueba aparte · **102** terminar ciclo / reactivar · **103** menú por rol · **104** Desinfección desde AGL y retiro de Trasplante/Riego · **105** catálogos Fase A · **109–110** AgroMétricas (parámetros y calicata) · **111** menú AgroMétricas · **112–113** % de fertilización (113 sin tope) · **114** asignar personas aun con pruebas · **115** anular diferencia de relevo · **116** registro histórico · **117** fechas anteriores a la siembra · **118** bitácora de errores (buzón) · **119** eliminar por completo · **120** purga de lo eliminado al bajar a AGL · **121** copia verificada antes de borrar.
- **Producción:** corridas hasta la 121 (verificado el 2026-11-19). **Desarrollo:** hasta la 121.
- Si se vuelve a correr la 99, 100, 101, 102, 115 o 116, correr la **117** después. Si se vuelve a correr la 119 o la 120, correr la **121** otra vez.
- 106–108 reservadas para catálogos. **Próximo número libre: 122.**

---

## 4. Pendientes (en orden)

### De Claude
0. **HECHO en AGL `main` = `89aee68` (2026-11-20), falta que el usuario publique** (`Publicar_Produccion.bat` + reiniciar): (a) Fertirriego rápido y dinámico (caché en parquet, sincronización cada 2 min solo en la PC del dueño, columnas del detalle según fuentes y medida, ficha del turno con edad y lotes); (b) Comparativo: panel «Información del turno» al elegir turnos, banderitas Plan/Real/SAP junto a la fecha en Detalle por DDT, barra de turnos fija y compacta, títulos de sección y encabezados de tabla fijos, Ficha del turno instantánea (se recorta del cubo completo, precargado); (d) /TR02: la plantilla compartida de turnos trae «Fuente de Agua» (última columna) y **Ctrl+V en la tabla de Turnos de Riego** (todas las columnas pegables, todos o nada, validado en el servidor; `PUT /api/turnos_riego/pegar`; QA Opus 9/9 + clics 7/7). (c) **Compartir** cada sección (Excel, PDF, HTML dinámico; PNG y SVG en Gráficos y Ficha) con la sección completa y la ficha del turno (`docs/fertirriego-compartir-secciones-diseno.md`, módulos `frontend/js/utils/compartir*.js` y `pdfInforme.js`). QA de Opus: Node 11/11, clics OK (24 archivos de Compartir verificados), re-prueba PDF OK. **Pendiente menor:** columnas de texto largas se cortan con «…» en el PDF; cifras de la Ficha van como texto en Excel/HTML; falta ver en producción la banderita azul de SAP; medir tiempos reales con datos de producción.
0b. **HECHO y EN PRODUCCIÓN (`main` = `97fb9c4`, 2026-11-21): /labores y /horometros ya no se congelan en «Consultando…» al editar.** Causa: cada edición esperaba releer el rango entero y un aviso de Realtime dejaba `cargando` encendido. Arreglo: `useConsultaViva` (apaga «cargando», `parchar`, `silenciarAvisos`, descarta lecturas viejas), `ControlLabores` (parche local instantáneo, relectura solo de los horómetros tocados con reintento, cola de guardados uno a la vez), `DataGrid` (la celda revierte si falla el guardado), `ControlHorometros` (lanza el error, recarga silenciosa). Sin SQL nuevo (índices ya existen). QA Opus final: labores 47/47 (escritorio y 412 px), horómetros 11/11, regresiones 9/9, 4/4, 15/15. **Pendientes menores:** mensaje en español cuando falla la red en /horometros («TypeError: Failed to fetch» sale crudo); la carga completa del rango son ~23 tramos en serie (~8 s por 22 000 líneas; bajaría con una RPC con `join_collapse_limit=1`, requeriría sql nuevo); revisar en producción.
0c. **HECHO en `desarrollo`, en QA (2026-11-21), 4 pedidos de Fertirriego** (sin SQL nuevo): (1) el aviso «Registro inicial del proceso» del registro histórico ya no flota (línea discreta en `FormAplicacion`/`DetalleDocumento`); (2) `FormAplicacion` trae la sección plegable «Registrar horas de riego» (`CamposHoras`, `lib/fertirriego/horas.ts`, la comparte `FormBitacora`): manda `aplicacion` + `bitacora` juntas; (3) en «Por turno» (`VistaTurnos`) Aplicar y Horas quedan inhabilitados si no tiene la estación a cargo (`puedeRegistrar`; supuesto: «estación asignada» = a cargo; sin estaciones ya no hay botones); (4) `leerLineas`: cantidad 0 = vacía (no se registra), vale para aplicar, recibir, traslado y detalle. El 2026-11-21 pasó a producción (`main` = `45118c8`). Después: la sección «Registrar horas de riego» también va en el **Registro histórico** (solo con «Aplicar» en la estación: la base lo exige; si un usuario de histórico no lo tiene, haría falta un sql nuevo que acepte el permiso histórico en `_fert_op_bitacora`). QA Opus 22/22; **falta publicar**. Pendiente de prueba: caso «Registrar por otro» en Por turno (la prueba tenía una espera floja, ya ajustada) y traslado con cantidad 0.
1. **SIGUIENTE a construir: bitácora de errores → AGL (sql/122).** Sin pantalla de bitácora en AgroNotificaciones (quitar `/admin/errores`). El teléfono sigue enviando errores y latidos al buzón de Supabase; AGL los baja con huella, los guarda y los borra (retención 30 días). En AGL: informe detallado (qué pasó, causa, por qué, cómo solucionarlo), semáforo por usuario, marcar atendido con nota, exportar a Excel. Diseño: `docs/bitacora-errores.md`.
2. **Archivar por mes** lo que no es de un turno (recepciones, conteos, relevos, traslados, envases), como «Terminar ciclo».
3. **Etapa E de Fertirriego:** alertas, sugerencia de envío y cierre mensual. Sin umbrales fijos: comparar contra el comportamiento normal de cada estación.
4. **Catálogos con AGL** (`docs/agl-fuente-unica.md`): en pausa. Faltan materiales, variedades, tareas (106), lotes y limpieza de duplicados.
5. **AgroMétricas en AGL:** rangos del histórico, bajar datos (9 935 filas), probar con un parametrista real; luego la parte 2.
6. Mantener la Clasificación de productos al día cuando entren grupos nuevos de MARA.
7. **Menores:** título del modal muy alto con letra grande (`Modal.tsx`); «Estacionero» partido en el encabezado; selectores de la bitácora sin alternar única/múltiple; recepciones históricas (opcional); probar Shift+F10 en Edge; decidir si la × de filtros de AGL quita también el filtro aplicado; regresión `fertirriego_campo.ps1` sin correr tras el cambio a listas.

### Del usuario
- (Hecho 2026-11-20) El usuario técnico «Integración AGL» ya tiene «Publicar» en producción, y Fertirriego ya está en **modo real** (fuera del modo de pruebas).
- PWA: quien tenga el acceso directo sin logo, que lo quite y lo agregue de nuevo.
- /OS01: pendientes de §6.2. Opcional: borrar `respaldo.*_m104` (libera espacio).

### Decididos «dejar así»
- Tickets repetidos viejos del mismo día en desarrollo. Velocidad de Labores.

---

## 5. Cómo trabajar (recetas)

### QA de AgroNotificaciones (la ejecuta solo Opus)
- Worktree de QA (`scratchpad\qa_prod`): `git checkout --detach <commit>` → `npx next build` → `npx next start -p 3100`. Arnés `pruebas/qa/comun.ps1`; scripts `pruebas/qa/*.ps1`.
- El Edge de QA arranca con `--disable-extensions --disable-sync --no-first-run` (ya lo hace `comun.ps1`): con perfil sincronizado la pestaña de la app quedaba en segundo plano y fallaba a los 2–3 min.
- Los scripts imprimen al final: vigilar el progreso en vivo. Si un script se corta a la fuerza, no corre su limpieza: borrar a mano por nombre (sin olvidar `fert_historico_permisos`).
- Usuario QA temporal: `POST /auth/v1/admin/users` + `perfiles` + `perfiles_zonas`; credenciales en `pruebas/qa/qa_usuario.local.json` (ignorado por git); borrarlo al terminar.
- Réplica SQL: PostgreSQL 17, carpeta `pg_qa`, puerto **5499**, usuario `postgres` (trust). Se apaga con el equipo: `pg_ctl -D <pg_qa> -o "-p 5499" start` (puede tardar minutos).
- Las pruebas SQL 119–121 no se repiten sobre una base usada: clonar `t117` y correr 118→121. Unitarias: `node --test pruebas/unit/<archivo>.mjs`.

### QA de AGL
- Copia aislada (robocopy de `backend`, `frontend`, `data`), `entorno.local.cfg` con `ENTORNO=DEV` y puerto libre (5094–5097); Supabase falso en otro puerto.
- Login: reemplazar `password_hash` de `halvarado` con `security.generar_hash(<clave temporal>)`. Los SmartSelect necesitan clic de ratón real (CDP).
- /SE03 va con `canales: []` (si no, la vista se remonta sola).

### Trampas que ya costaron tiempo
- PowerShell: `$radio` = `$RADIO`; `"$var?.x"` → `${var}?.x`; `R` es alias; `@(Invoke-RestMethod …)` envuelve la lista (usar `foreach`); en 5.1 `@(lista vacía).Count` da 1; `Copy-Item -LiteralPath` con corchetes.
- App: `Tarjeta` no pasa `data-*` (envolver en `div`); `innerText` sale en MAYÚSCULAS (usar `textContent`); un clic antes de que React tome la página se pierde (repetir hasta ver el efecto); la primera corrida tras `next start` puede fallar por arranque en frío.
- Supabase: `40001` se reintenta solo; tabla puente en `public` con FK a perfiles y roles rompe el login (va en `seguridad`); en PostgREST nombrar los embeds (`roles!perfiles_rol_id_fkey`).
- Commits con comillas: `git commit -F <archivo>`.

---

## 6. AGL › /OS01 Gestor de Órdenes SAP

SAP es la única fuente de verdad: /OS01 replica la COHV (órdenes) y la KOB1 (salidas/costos), las cruza con la planificación de lotes y muestra qué falta crear y cuánto se ha gastado.

### 6.1 Decisiones del usuario (no volver a preguntar)
- **COHV**: solo liberadas, centro **2030**, disposición **HENRYREPORT**; meses por Fecha entrada. **KOB1**: disposición **/BAJARNAHUM**; máximo de aciertos **999999999**; por defecto 2 meses.
- Parquet por mes en `data/ordenes_sap_salidas`. Vista plana (ALV) por defecto.
- Órdenes de servicio («T-SERVICIO INTERNO», 300xxx): proceso **SERV** permanente, catálogo /OS05, no se reparte a lotes.
- PEP de CAT `{UT}-{VAR}{PER}{CICLO}`, orden especial `C{UT}-{VAR}`; AP/LEV `{UT}-00{PER}` (0016 = 2026-2027).

### 6.2 Pendientes del usuario en /OS01
- /PR01: estructura de CAT y crear SERV «Servicios (permanente)». /OS03: `T-SERVICIO INTERNO`, `T910`, `T911`, `T912`, `C{UT}-{VAR}`; Obligatoria = No en T101, T520, T521, T573.
- KOB1 la primera vez con «Todo el historial». Catalogar las 332 órdenes sin material y clasificar las 753 partidas en /OS04.

### 6.3 Archivos clave
`backend/rpa_sap.py`, `salidas_sap.py`, `machote_sap.py`, `estructura_sap.py`, `tablero_ordenes.py`, `catalogos.py` (CRLF), `server.py`; `frontend/js/views/gestorOrdenes.js`, `services/ordenesSap.js`, `css/ordenes.css`.

---

## 7. Al empezar una conversación nueva (lista corta)
1. Leer este archivo y `MEMORIA_CLAUDE.md`.
2. `git status` y `git log -3` en los dos proyectos; no tocar el `CLAUDE.md` local del usuario.
3. Confirmar que se trabaja en desarrollo y que nada va a producción sin «pasa a producción».
4. Seguir con el primer pendiente de §4, o con lo que el usuario pida.

---

## 8. Decisiones abiertas del usuario
- **Colores del código nutricional** del Comparativo: ¿ámbar = difiere 1 y rojo = difiere 2 o más? Y fases/semanas con varios códigos asignados (hoy «3 / 4», sin comparar).
- **«Medir en»** del Comparativo: ¿debe arrancar en Cantidad? (hoy Dinero).
- **«Sin base»** (real sin plan): ¿gris o ámbar? (hoy gris; puede esconder alertas).
- **Ácido fosfórico 0-54-0**: P = 104.78 en /CF06 (se esperaba 54). Revisar el dato.
- ~~AGL en teléfono~~: **respondido 2026-11-20: AGL NO se usa en teléfono** (solo escritorio); no probar ni diseñar para móvil en AGL.
- **Permiso «Publicar» al técnico de AGL**: confirmar cómo se asigna (§4, Del usuario).
