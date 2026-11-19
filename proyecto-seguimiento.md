# Seguimiento del proyecto · punto de partida para cualquier conversación nueva

> **Actualizado: 2026-11-18** (publicado a producción: alerta de inventario, PWA, anular diferencia de relevo; ver §8 «2026-11-18»). Antes: 2026-11-15 (noche) (4 subagentes: Comparativo v2, AgroMétricas 111/112, Catálogos Fase A 105,
> Seguridad AGL capas 1–3; todo integrado, ver §8). Lo escribe y mantiene Claude.
> Al abrir una conversación nueva: **leer este archivo primero**, después `agronotificaciones/MEMORIA_CLAUDE.md`
> (detalle técnico, historial y lecciones) y la memoria `agl-ordenes-sap-procesos.md`.
> Hay una copia idéntica en `C:\HENRYALVARADO2022\AGLGestion_App\proyecto-seguimiento.md`: **actualizar las dos al
> terminar cada bloque de trabajo.**
> Responder siempre al usuario **en español, claro y sin jerga**.

---

## 1. Qué hace cada proyecto

| | **AgroNotificaciones** | **AGL Gestión** |
|---|---|---|
| Para qué | Plataforma web/teléfono «**Monitoreo agrícola integral**»: tickets de maquinaria (horómetros, labores), controles (Planes, Rotación, Desinfección), costos, catálogos, usuarios y permisos, y **Fertirriego** en campo (sin señal). Va a ser **multifunción**: cada rol con su menú. | Sistema de gestión de la Torre de Control: catálogos maestros (MARA, temporadas, lotes, turnos, estaciones…), planificación, órdenes SAP (/OS01), LTP, Trasplante y Turnos de Riego, análisis de Fertirriego (/FR01). **AGL manda**: es la fuente más actualizada. |
| Carpeta | `C:\HENRYALVARADO2022\agronotificaciones` | `C:\HENRYALVARADO2022\AGLGestion_App` |
| Tecnología | Next.js 16 + Supabase (Postgres), Vercel | Python (`engine\python.exe`) + JS sin framework; datos JSON/Parquet en OneDrive |
| Ramas | Commits en `desarrollo`; `main` = producción (Vercel publica desde `main`) | `main` local (commits ahí) |
| Bases | Producción `ooxoqopaiavfhfxxtzgh` (`.env.produccion.local`), desarrollo `ifzwqdstpoyoidsflvuo` (`.env.local`) | Datos en `Torre Control dv\data` (OneDrive) |
| Publicar | Claude, solo cuando el usuario dice **«pasa a producción»** | El usuario, con `Publicar_Produccion.bat` y reiniciar `Iniciar_Plataforma` |
| Estado hoy | `main` = `87c0d62` (publicado 2026-11-18 noche) | `main` = `e843f1f` (sin publicar: Planificación de lotes que recuerda proceso/ciclo y enfoca la fecha, Polinización con checklist de semanas, sin DDT Hoy y con encabezado de reporte; ocultar carpeta corregido para otra PC, Comparativo sin límite por unidad, con código nutricional Plan/SAP/Real, ⓘ, tarjetas por medida, %, colores y Área, solo turnos de /TR02, aportes y detalle por DDT a la vista, /FA02, /SE04, /FR01 › Catálogos) |

**Cómo se unen:** **Supabase es solo un intermediario** (pedido firme del usuario: «que el almacenamiento gratis dure
muchísimo, llenar lo mínimo»). AGL publica a Supabase lo que el campo necesita (turnos, estaciones, materiales, plan) y
baja lo que el campo registra. Lo terminado se baja a AGL y se borra de Supabase («Terminar ciclo»).

---

## 2. Reglas de trabajo (acordadas, no se discuten)

**Enrutamiento de modelos y ahorro de tokens** (regla del usuario, 2026-11-15; obligatoria)
- Prioridad: gastar el mínimo de tokens sin bajar la calidad ni romper la sincronización AgroNotificaciones ↔ AGL.
  Claude actúa como **arquitecto y orquestador**: reparte el trabajo en subagentes con el modelo justo
  (herramienta Agent, parámetro `model`).
- **Haiku** (básico, obligatorio): explorar carpetas, leer logs, `git status`/`log`/`diff`, comandos simples de terminal,
  formatear texto, escribir o actualizar documentación (este archivo, `MEMORIA_CLAUDE.md`, manuales).
- **Sonnet** (intermedio, obligatorio): escribir código (Python de AGL, Next.js/TypeScript de AgroNotificaciones),
  refactorizar, lógica de negocio, SQL y migraciones, endpoints/APIs, pruebas unitarias y QA con clics de rutina.
- **Opus** (crítico, EXCLUSIVO): solo para (1) validaciones finales de seguridad, cifrado o autenticación (p. ej. /SE04,
  RLS, permisos); (2) aprobar antes de hacer merge de ramas complejas a `main`; (3) pruebas de integración críticas del
  flujo completo local ↔ en línea (AGL ↔ Supabase ↔ teléfono); (4) diseño de arquitectura profunda.
- Cómo aplicarlo:
  - Cada encargo a un subagente lleva `model` explícito. Ante la duda entre dos niveles, el más barato. Opus revisa al
    final lo que Sonnet construyó solo en los casos del punto anterior.
  - Briefs cortos que apunten a archivos en vez de copiarlos. Pocos agentes a la vez. No releer lo que ya está en contexto.
  - El modelo de la conversación principal lo elige el usuario con `/model`. Para el día a día conviene `/model sonnet`,
    y `/model opus` solo para las tareas críticas.
  - El límite de uso es compartido: los subagentes en Opus agotaron el límite de 5 horas el 2026-11-15. Por eso esta regla.

**Generales**
- Responder en español, claro, sin jerga. Ser eficiente: analizar antes de repetir una prueba lenta; una corrida para
  confirmar; tope de 30 min reintentando y avisar.
- **QA obligatoria con clics reales** antes de entregar (Edge sin ventana + CDP). «Verifícalo siempre tú»: no dar por
  hecho nada que no se comprobó (p. ej. la columna `permitido` de los permisos).
- Información del usuario privada; **secretos nunca en el chat** ni en servicios externos. Las credenciales de
  usuarios técnicos las pone el usuario.
- Fechas y horas en **UTC-6 (America/Tegucigalpa)**. No se asume «hoy»: los capturadores registran jornadas de ayer.
- **No hardcodear nombres de roles**: todo por la matriz de permisos de la base.
- Mobile-first, botones de dedo (≥44 px), operable con teclado, verbos estándar (Guardar, Editar, Eliminar…).
- Al terminar cada bloque: actualizar este archivo (aquí y la copia en AGL) y `MEMORIA_CLAUDE.md`.

**AgroNotificaciones**
- Commits en `desarrollo`. **Nunca** push/merge a `main` sin «pasa a producción». El merge se hace en un worktree
  aparte (el `CLAUDE.md` del usuario tiene cambios locales que no se tocan).
- **Claude no ejecuta SQL de estructura (DDL) en Supabase.** Entrega `sql/NN_*.sql`, lo prueba en la réplica local y el
  usuario lo corre: **primero desarrollo, después producción**.
- «Estos permisos nuevos no tienen que afectar a los usuarios ya en producción»: toda migración de permisos se prueba
  con equivalencia antes/después sobre un clon de producción.
- Supabase rechaza `UPDATE`/`DELETE` sin `WHERE` aun dentro de funciones: **todo** lleva `WHERE`.
- Toda migración es idempotente y se prueba también en distintos **órdenes de corrida** (p. ej. 100>101>100): una
  migración que redefine una función ya parchada por otra debe traer ese parche.
- No usar `npm run build` en la carpeta del usuario (borra su `.next`). Se compila en el worktree de QA.
- Borrados en bases: listar primero y borrar por id exacto, nunca con patrones amplios.
- Tablas que se retiran: respaldo previo (archivo con `scripts/respaldar-tablas-viejas.ps1` y/o esquema `respaldo`).

**AGL**
- **Datos de producción solo lectura para Claude:**
  `C:\Users\Hhernandez\OneDrive - Agropecuaria Montelibano\Escritorio\TORRE DE CONTROL\Torre Control dv\data`.
- No usar ni detener los servidores del usuario (puertos **5000** y **5001**). Las pruebas van en una copia aislada.
- La publicación (`arranque.py`) **nunca** modifica datos del usuario (solo crea carpetas) ni
  `data/sistema/menu_schema.json`.
- Las semillas de catálogos solo aplican a instalaciones nuevas; cambios a catálogos existentes los hace el usuario.
- `backend/catalogos.py` es **CRLF**: editar solo con la herramienta Edit.
- Toda vista nueva declara `canales`; una vista que escribe en una carpeta de sus propios canales se remonta sola.

**SAP**
- Solo **lectura**, en una **sesión propia** (CreateSession → minimizada → CloseSession). Se restaura el portapapeles.

---

## 3. Qué hay hoy (lo hecho)

### 3.1 AgroNotificaciones (en producción, `main` = `1778ddb`; SQL corridas hasta la 104 en las dos bases)
- **Tickets de maquinaria**: horómetros y labores, revisión por lotes, continuidad de horómetros, procesos del ticket
  (Registrando → Revisando → Pendiente aprobación → Notificado en SAP), «Mover proceso», cerrar ticket.
- **Permisos v2** (92–93, 97): varios roles por persona, «Todas las zonas», permisos por módulo con niveles,
  historial de accesos, delegación a jefes de zona; el **Jefe de zona** solo administra **Estacioneros**
  («Usuarios que administra este rol»); el Digitador de campo depende del administrador.
- **Menú por rol** (103): Administración › Menú por rol (casilla «Diseñar menú»). Sin diseño, cada rol ve el menú de
  siempre. El menú nunca da permisos. Lo olvidado cae en «Otros».
- **Fertirriego** (91–102): ver §3.3.
- **Desinfección desde AGL** (104): el DDT y la siembra salen de `turnos_ciclo` (publicado por AGL). Se retiraron las
  tablas viejas de Trasplante y Riego y sus pantallas. Respaldos en `respaldos\20261112_2244_desarrollo_tablas_viejas`
  y `respaldos\20261112_2344_produccion_tablas_viejas`.
- Lema de la app: «Monitoreo agrícola integral».

### 3.2 AGL (en producción, `main` = `04a4687`)
- /SE03 **Conexiones** cifradas (clave maestra por PC); al cambiar de base se borra lo bajado de la otra.
- /FR01 **Fertirriego**: Sincronizar todo, **Clasificación de productos** (por grupo de artículos: «Publicar a las
  estaciones» y «Fertilizante (entra al análisis)»), **Análisis** administrativo, **Comparativo** Plan · SAP · Real con
  gráficos, todo lo registrado en campo (recepciones, aplicaciones, conteos, envases, relevos, traslados, rechazados),
  «**Ver datos de prueba**» (aparte, solo con el modo de pruebas activo).
- /TR02 **Terminar ciclo / Reactivar** (se ven al **marcar turnos**; columna «Campo»; botón «Turnos archivados»).
- Bitácora de cambios del LTP con evidencias.
- **Mi Día /MD01** (2026-11-13): **Alt + M** lo abre en ventana emergente desde cualquier pantalla (Esc o Alt + M la
  cierran, guardando); editar el texto de una tarea (doble clic o ✎; el clic en el texto ya no la marca);
  **@usuario** comparte la tarea (aparece en el Mi Día de esa persona el mismo día; marcar hecha se refleja en los dos;
  si quien la recibe la quita, no vuelve); la nota vinculada del Cerebro (↗) se abre en ventana sin salir de Mi Día.
  QA con clics 27/27 (`agl_qa_midia.ps1` en el scratchpad de QA), prueba del servidor 7/7.
- /OS01 Gestor de Órdenes SAP (ver §6).
- **/OS06 Grupos de Coste** (2026-11-14, `dbebcb6`, falta que el usuario publique): los grupos de /OS04 ya no son
  fijos; catálogo con Grupo y Activo (nace con los 7 de siempre). La clase guarda el NOMBRE del grupo: renombrar
  renombra sus clases; uno en uso no se elimina, se desactiva. Salidas SAP › Partidas: interruptor «Solo gastos»
  encendido al abrir. QA 18/18 (`agl_qa_grupos.ps1` en el scratchpad). Dar /OS06 en /SE01 a los roles que lo usen.
- **LTP** (2026-11-14, `b9b5773`, falta publicar): semanas en orden al quitar el «Desde» (el Layout guardado con
  Desde=hoy mandaba las semanas anteriores al final; arreglado en DataGrid para todas las tablas) y «Total Producto» del
  plan con la regla SINAGRO de la Corrida (cuadran a 0.085 en 32 M). La plantilla Excel ya generada conserva la fórmula
  vieja hasta «Generar / Actualizar Plantilla». La demanda desde feb-2026 es correcta: plan de la temporada que se
  ejecuta antes de que inicie (confirmado por el usuario; no es un error).

### 3.3 Fertirriego (une los dos proyectos)
Control del producto de nutrición en las estaciones de riego. El estacionero registra en el teléfono (sin señal)
lo que recibe, aplica, cuenta y entrega; AGL publica turnos, plan y materiales, y baja todo para analizar.
Diseño y decisiones: `agronotificaciones/docs/fertirriego-diseno.md`, `fertirriego-piloto1.md`,
`fertirriego-piloto2.md`, `fertirriego-archivo-turnos.md` (no volver a preguntar lo que ahí está decidido).
- Bodega por estación, aplicación por turno con **DDT del plan o Extra** y DDT real, custodia y **relevo** con código
  de 30 s o **código de 12 horas** (relevo de noche), traslados autorizados, conteos, **envases** (saldo por estación,
  entregar vacíos sin producto), productos agrupados (Fertilizantes primero), **productos de campo** fuera de MARA
  (por validar), calculadora de bultos, ppm de cloro, bitácora con detalle y filtros, guardado en segundo plano,
  borradores, Administración › Choferes y catálogos de campo.
- **Modo de pruebas** (98): estaciones «PRUEBA · X», participantes; AGL no lo mezcla; apagar sin borrar (máx. 30 días).
- **Terminar ciclo** (102): AGL baja el turno, verifica huella y lo borra de Supabase; el saldo de bodega no cambia
  (movimiento resumen); el teléfono deja de verlo; **Reactivar** lo sube igual. El libro de movimientos no se edita ni
  se borra desde la app (solo el administrador de la base).
- Manuales: `agronotificaciones/docs/manuales/` (estacionero, jefe de zona, administrador, piloto, guion de charla) y
  `AGLGestion_App/docs/manual_fertirriego_AGL.md`.
- Estado: dos pruebas piloto hechas con estacioneros; en producción, piloto con modo de pruebas activo.
- **Presentación a gerencia** (2026-11-13, para el 14-nov): `agronotificaciones/docs/presentaciones/Fertirriego_Presentacion_Gerencia.pptx`
  (44 diapositivas, INFORMATIVA —no pide aprobación—: qué es, beneficios, quién lo usa y diferencia de roles,
  instalación e inicio de sesión, manual del estacionero y del jefe de zona, administración, AGL, seguridad, ventajas
  y desventajas, cómo se pondrá en marcha; notas del orador; capturas del piloto con nombres de prueba). Se regenera
  con `fertirriego_gerencia_build.js` (pptxgenjs; necesita `login2.png` al lado).

### 3.4 Migraciones SQL (todas corridas en desarrollo y producción)
`91` base Fertirriego · `92–93` Permisos v2 · `94–95` campo sin señal · `96` relevo y traslados · `97` roles que
administra cada rol · `98` modo de pruebas · `99` piloto 1 · `100` detalle completo al teléfono y a AGL · `101` AGL ve
lo de prueba aparte · `102` terminar ciclo / reactivar · `103` menú por rol · `104` Desinfección desde AGL y retiro de
Trasplante/Riego. `105` catálogos desde AGL (Fase A) · `109–110` AgroMétricas · `111` menú AgroMétricas · `112` % de fertilización
(105, 111, 112 NO corridas en Supabase; 109–110 solo en desarrollo). **Próximo número libre: 113** (106–108 reservados para catálogos).

---

## 4. Pendientes (en orden)

### De Claude
**CONSTRUIDO 2026-11-18 (sin publicar; `sql/116` NO corrida en ninguna base): Registro histórico de Fertirriego.** Contrato en
`docs/fertirriego-historico.md` y manual del administrador §7 bis. Permiso temporal por persona y estación (Administración ›
Registro histórico), operación `aplicacion_historica` (día pasado, sin custodia, **no crea movimientos**, `fert_aplicaciones.historica`),
duplicado = observación, anulable con «Anular», export a AGL en `aplicaciones_historicas` (no cuenta como Real). Pruebas: réplica
`pruebas/sql/116_*.sql` (todas ok, órdenes 116>116, 115>116, 100>101>116>116, 102>116 y turno archivado antes de la 116 que se
reactiva), unitaria `fertirriego_historico.test.mjs` 6/6, build limpio; **QA con clics `pruebas/qa/fertirriego_historico.ps1` escrita,
SIN correr** (necesita la 116 en desarrollo). Siguiente número libre de SQL: **117**. Recepciones históricas: no se hicieron (opcional).
Lo que sigue: el usuario corre `sql/116` en desarrollo → correr la QA → producción DESPUÉS de que Vercel publique el código.
**(Histórico del pedido, 2026-11-18) Registros históricos de Fertirriego.**
Estaciones que ya operaban antes de poner el módulo en marcha. Diseño aprobado en lo esencial:
- Permiso nuevo «Registro histórico», lo da SOLO el administrador, por persona y estación, **con fecha límite** (temporal); vencido, todo pasa por el proceso normal.
- Se registran sobre todo las **APLICACIONES** (lo más importante). Las recepciones son **opcionales**: si la persona no las recuerda, no se inventan.
- Estos registros **NO mueven el inventario** (tipo de movimiento aparte que ni suma ni resta; etiqueta «Registro inicial del proceso» + quién lo capturó).
- El inventario real arranca después con un conteo de apertura en una fecha de corte que elige el usuario; AGL analiza el histórico por separado.
- Requiere SQL nuevo (número libre: **116**), réplica, QA con clics y dos pasos en Supabase (desarrollo y luego producción). Antes de construir, repasar con el usuario los detalles.
**Hecho en AGL (2026-11-18, falta publicar):** las diferencias de relevo anuladas salen en /FR01 › Relevos marcadas «ANULADA» con su motivo y no cuentan en el valor; Pérdidas ya excluía las anuladas.
**Hecho 2026-11-15 (4 subagentes, integrado):** Comparativo v2 (AGL `d0d3d94`, /FA02 Rangos de Fase), AgroMétricas
111/112 (`04f5c66`, QA 43/43), Catálogos Fase A (`sql/105` + AGL /FR01 › Catálogos `52483db`), Seguridad AGL capas 1–3
(AGL `6a6b925`, /SE04; respaldo en `TORRE DE CONTROL\AGL_Respaldos`, ya creada). AGL `main` = `f444c3f` (merge de las 3).
Preguntas abiertas de cada uno: ver §8.
0. **Esperando respuestas del usuario (§8)** para ajustar Comparativo, % de fertilización, Seguridad y Catálogos.
0b. **AgroMétricas** (`docs/agrometricas-migracion.md`, `docs/agrometricas-parametros-riego.md`): parte 1 cerrada
   (109–112). Falta en AGL: rangos (del histórico, percentiles), bajar los datos y el histórico (9 935 filas, fotos
   viejas por enlace a Drive); probar con un parametrista real limitado a su zona. Después, la parte 2.
1. **Unificación de catálogos con AGL** (`docs/agl-fuente-unica.md`): Fase A primer bloque HECHO (105). Siguen
   materiales, variedades y tareas (106: `catalogos_origen`, `agl_equivalencias`); **lotes al final**; Fase B (pantallas
   en solo lectura) y Fase C (respaldar y borrar duplicados). Las **17 estaciones de AGL son las correctas** (el usuario las revisó); lo que se reduce a 4 son las ZONAS (§ corrección 2026-11-16 en `docs/agl-fuente-unica.md`).
2. **Archivar por mes lo que no es de un turno** (recepciones, conteos, relevos, traslados, envases), igual que
   «Terminar ciclo», para que Supabase guarde lo mínimo (propuesta en `fertirriego-archivo-turnos.md`).
3. **Etapa E de Fertirriego**: alertas (saldo bajo, plan atrasado, diferencias grandes), sugerencia de envío y cierre
   mensual. **Sin umbrales fijos** (dependen de lo cargado del proceso): proponer que se comparen contra el
   comportamiento normal de cada estación y que el usuario ajuste la sensibilidad.
4. Mantener la Clasificación de productos de AGL al día cuando entren grupos nuevos de MARA.

### Del usuario
- **Correr `sql/115` EN PRODUCCIÓN** (anular la diferencia de un relevo): el código ya está publicado (2026-11-18); hasta que se corra, el botón «Anular esta diferencia» avisa «El servidor todavía no está actualizado…». En desarrollo ya está corrida y probada. Si se vuelve a correr la 95 o la 100/101, correr la 115 otra vez.
- **PWA**: quien ya agregó el acceso directo sin logo debe quitarlo y agregarlo de nuevo (el teléfono guarda el icono viejo). Probar en 2–3 teléfonos que ahora ofrezca «Instalar».
- Publicar AGL (`Publicar_Produccion.bat`) y reiniciar: incluye Planificación de lotes y Polinización (`e843f1f`) y lo del Comparativo/Seguridad.
- Pasar del modo de pruebas a uso real cuando termine el piloto (apagar/borrar pruebas; estacioneros a sus
  estaciones reales).
- AGL /OS01: pendientes de catálogos SAP (ver §6.3).
- Correr en DESARROLLO `sql/105`, `sql/111`, `sql/112`; publicar AGL (responder S a la estructura); activar /SE04
  en su PC; dar /FA02 y /SE04 en /SE01; después /FR01 › Catálogos › vista previa.
- Opcional: borrar `respaldo.*_m104` de las bases si quedó la copia interna (libera espacio).

### Decididos «dejar así» (no tocar salvo que el usuario lo pida)
- Tickets repetidos viejos del mismo día en desarrollo: se quedan como están.
- Velocidad de Labores: se deja por ahora.

---

## 5. Cómo trabajar (recetas)

### QA de AgroNotificaciones
- Worktree de QA: `C:\Users\Hhernandez\AppData\Local\Temp\claude\8cd082265f21e390\d424e4b3-aa92-4945-a284-5a2cd4214bdd\scratchpad\qa_prod`
  (`git checkout --detach <commit>` → `npx next build` → `npx next start -p 3100`). Arnés `pruebas/qa/comun.ps1`.
- **El usuario QA de desarrollo se borró (2026-11-13) a pedido del usuario.** Para una QA nueva, crear uno temporal
  (`POST /auth/v1/admin/users` + `perfiles` + `perfiles_zonas`, credenciales en `pruebas/qa/qa_usuario.local.json`,
  ignorado por git) y borrarlo al terminar.
- Pruebas con clics existentes: `fertirriego_campo`, `fertirriego_piloto1`, `fertirriego_piloto2`,
  `fertirriego_relevo_traslado`, `fertirriego_modo_pruebas`, `fertirriego_archivo_turnos`, `menu_por_rol`,
  `desinfeccion_desde_agl`, `permisos_v2`, `permisos_delegacion`, `usuarios_v3`, `tickets_movil`, entre otras.
- Réplica SQL local: PostgreSQL 17, puerto **5499**, usuario `postgres` (trust). Bases útiles: `qa` (producción hasta
  la 90), `prod101`/`prodall` (clon de producción con migraciones), `t99r`/`tall` (con datos de prueba).
  Pruebas en `pruebas/sql/NN_*.sql`; las de 100–102 corren **en cadena** después de la de la 99.
- Pruebas unitarias: `node --test pruebas/unit/<archivo>.mjs` (uno por uno).

### QA de AGL
- Copia aislada (robocopy `backend`, `frontend`, `data` a una carpeta de trabajo), `entorno.local.cfg` con
  `ENTORNO=DEV` y un puerto libre (5094–5097); Supabase falso en otro puerto (ej. `supabase_falso100.py`).
- Login en la copia: reemplazar `password_hash` de `halvarado` con `security.generar_hash(<clave temporal>)`.
- Carpetas nuevas: `arranque.inicializar` sobre la copia. Los SmartSelect necesitan clic de ratón real (CDP).

### Trampas que ya costaron tiempo
- PowerShell: variables sin distinción de mayúsculas (`$radio` = `$RADIO`); `"$var?.x"` → usar `${var}?.x`;
  `R` es un alias; `@(Invoke-RestMethod …)` envuelve la lista entera (usar `foreach`); `.ps1` en UTF-8 con BOM;
  Windows PowerShell 5.1 no deja poner el encabezado `Range` y a veces no trae `ErrorDetails`.
- En la app: `Tarjeta` no pasa atributos `data-*` (envolver en `div`); `innerText` sale en MAYÚSCULAS en etiquetas
  (usar `textContent`); un clic antes de que React tome la página se pierde (repetir hasta ver el efecto); con el
  guardado en segundo plano, esperar ~1.5 s antes de mirar la cola.
- Supabase: `errcode 40001` lo reintenta solo (no usarlo en errores que no se resuelven reintentando);
  una tabla puente en `public` con FK a perfiles y roles rompe el login (van en el esquema `seguridad`).
- Mensajes de commit con comillas: `git commit -F <archivo>`.

---

## 6. AGL › /OS01 Gestor de Órdenes SAP

SAP es la única fuente de verdad. /OS01 replica la COHV (órdenes) y la KOB1 (salidas/costos reales), las cruza con la
planificación de lotes y muestra qué falta crear y cuánto se ha gastado.

### 6.1 Hecho (commits de AGL)
`98f8684` procesos AP/LEV/CAT, Estructura PEP, Catálogo de Órdenes (/OS03), Período SAP · `180a96c` Tablero de la
Planificación · `fd574ec` actualización viva · `ba72a01` Salidas SAP, /OS04 Clases de Coste · `8ec8aaf` Bajar de SAP
(RPA) · `02a8489` opciones al bajar, Parquet por mes, órdenes de servicio (SERV + /OS05), CAT con formato SAP.

### 6.2 Decisiones del usuario (no volver a preguntar)
- **COHV**: solo liberadas, centro **2030**, disposición **HENRYREPORT**; bajar todas / temporada / PEP; meses por
  Fecha entrada; siempre se deja elegir cuántos meses.
- **KOB1**: disposición **/BAJARNAHUM**; máximo de aciertos **999999999**; por defecto 2 meses; opción todo el historial.
- Parquet por mes en `data/ordenes_sap_salidas`.
- Órdenes de servicio («T-SERVICIO INTERNO», 300xxx): proceso **SERV** permanente, catálogo /OS05, costo por mes y
  zona, no se reparte a lotes.
- PEP de CAT `{UT}-{VAR}{PER}{CICLO}`, orden especial `C{UT}-{VAR}`; AP/LEV `{UT}-00{PER}` (0016 = 2026-2027).
- Vista plana (ALV) por defecto.

### 6.3 Pendientes del usuario en /OS01
- /PR01: estructura de CAT y crear SERV «Servicios (permanente)».
- /OS03: `T-SERVICIO INTERNO`, `T910`, `T911`, `T912`, `C{UT}-{VAR}`; Obligatoria = No en T101, T520, T521, T573.
- KOB1 la primera vez con «Todo el historial».
- Catalogar las 332 órdenes liberadas sin material en /OS03 y clasificar las 753 partidas en /OS04.

### 6.4 Archivos clave
`backend/rpa_sap.py`, `salidas_sap.py`, `machote_sap.py`, `estructura_sap.py`, `tablero_ordenes.py`, `catalogos.py`
(CRLF), `server.py`; `frontend/js/views/gestorOrdenes.js`, `services/ordenesSap.js`, `css/ordenes.css`.

---

## 7. Al empezar una conversación nueva (lista corta)
1. Leer este archivo y `MEMORIA_CLAUDE.md`.
2. `git status` y `git log -3` en los dos proyectos; no tocar el `CLAUDE.md` local del usuario.
3. Confirmar en qué base se trabaja (desarrollo) y que nada va a producción sin «pasa a producción».
4. Seguir con el primer pendiente de §4, o con lo que el usuario pida.

---

## 8. Preguntas abiertas al usuario — borrar cada una al responderse

Respondidas el 2026-11-15: fases sin huecos OK; Real vs Plan ±5 % OK pero **el usuario siempre elige qué comparar**
(selector); rangos por plan OK; **% de fertilización puede pasar de 100** (sql/113, sin tope); mostrar el % en el
Comparativo; retención/10 min/3 días OK; no vigilar AGL_Respaldos; tasa nueva como vigencia desde hoy OK; vacíos en
AGL respetan lo que hay en AgroNotificaciones. 109–112 y 105 corridas en desarrollo. Inicialización de AGL de
desarrollo hecha (9 T-Codes nuevos); falta agregar /FR01 en /SE02 de desarrollo.

**Hecho 2026-11-15 (noche, con agentes Sonnet):** `sql/113` (% de fertilización sin tope; commit `c2651c8` en `desarrollo`; **falta que el usuario la corra en desarrollo**; si se vuelve a correr la 99/102/112, correr la 113 otra vez) y Comparativo de AGL con selector de comparación (Automática / Real vs Plan / SAP vs Plan / Real vs SAP) y % de fertilización (AGL `main` = `a08db3d`, sin publicar). Pendiente verificar con datos reales tras «Bajar de campo». Siguientes módulos: el usuario decide (catálogos fase 2, AgroMétricas en AGL y archivo mensual quedan en pausa).

**2026-11-15 · A producción (código):** `main` = `f5c65b6`. Falta correr EN PRODUCCIÓN, en este orden: `sql/105`, `109`, `110`, `111`, `112`, `113`. Arreglo «Cuenta pendiente de activación» (`530b74b`): getPerfilActual ignoraba el error de la consulta; ahora reintenta y avisa «No pudimos cargar tu perfil». Próximo número libre de SQL: 114 (106–108 reservados para catálogos).

**2026-11-16 · Corrección del usuario (catálogos):** las ESTACIONES son 17 y las de AGL son las correctas (no hay que dejar 4). Las ZONAS pasan de 7 a 4: 2B → 3A, 2C → 2A, 3C → 3B; 1, 2A, 3A y 3B siguen igual. La publicación de Fase A ya está lista (vista previa primero). Lo que falta para unificar del todo (A2 materiales/variedades/tareas, A3 lotes, B solo lectura, C borrar duplicados) queda **PENDIENTE, no urgente**, por decisión del usuario; pendiente también ver qué ocupa espacio en Supabase (consulta de tamaños) y archivar por mes. Supabase hoy: 46 de 500 MB.

**2026-11-16 · Comparativo de Fertirriego (AGL):** `b058833` «Detalle por DDT» (turno × producto × DDT, cada fuente en su DDT, acumulado a la fecha de corte) y «Aportes juntos» (N, P, K, Ca, Mg a la vez; tabla + gráfico, agrupable); `a91c615` «nada oculto»: SAP sin turno y SAP sin fecha se cuentan y se muestran (SAP asignado + sin turno = total), el chip de período afecta las vistas nuevas, fecha de corte propia. AGL `main` = `a91c615`, falta que el usuario publique. 114 corrida en producción y desarrollo (el administrador asigna personas aun con pruebas). Preguntas abiertas: (1) «SAP sin turno» puede ser ruidoso (órdenes de otras temporadas/procesos y materiales mal clasificados como fertilizante, p. ej. «MUESTRA DE HONGO»): ¿limitar a la temporada seleccionada y revisar la Clasificación de /FR01?; (2) las salidas SAP sin fecha solo salen en el control y el total, no en los gráficos por día. Aviso: `pruebas/prueba_machote_cruce.py` de AGL falla con KeyError procesos_sap incluso en `main` (no es de estos cambios).

**2026-11-16 (tarde) · Comparativo rediseñado** (AGL `f5788b8`, falta publicar): alcance SOLO turnos de /TR02 y las salidas SAP de SUS órdenes (se quitó el aviso «SAP sin turno»: el usuario aclaró que las órdenes de /OS01 son generales). Pantalla en orden: controles agrupados («¿Qué turnos?», «¿Qué comparar?», «¿Hasta qué fecha?», «¿Cómo verlo?»), leyenda, tarjetas, frase «En pocas palabras», sección «Aportes de todos los elementos» (N, P, K, Ca, Mg juntos) y «Detalle de productos por DDT» abiertas al entrar; lo demás plegable. Quedó fuera: resaltado producto↔gráfico en el detalle, encabezados agrupados (el DataGrid no los soporta). Lección: el usuario no ve lo que está escondido tras pestañas chicas; lo que pide debe verse al entrar. AGL no tiene layout para teléfono (min-width 720 px en `styles.css`): ¿cambiarlo?

**2026-11-16 (tarde) · Comparativo: formato y área** (AGL `024581e`, falta publicar): porcentajes con « %» (Excel numérico), diferencias con signo y color (0 = ✓ verde; ±5 %; más rojo, menos ámbar, sin base gris), leyenda fija, y **Área (mz)** del turno o de los turnos elegidos (selector, tarjeta, frase, columnas; suma sin duplicar). DataGrid ganó opciones `porcentaje`, `dif`, `unicoPor`, `claseFila`, `claseSubtotal` (opcionales; efecto lateral: columnas numéricas con `decimales: 0` ahora se exportan a Excel sin decimales). Pendiente de decidir por el usuario: «sin base» (real sin plan) hoy sale gris; antes ámbar, puede esconder alertas.

**2026-11-16 (noche) · Código nutricional + UX del Comparativo** (AGL `main` = `a8bb3ff`, falta publicar): (a) `f8fcf65` pestaña «Constantes de Elementos» en /CF08 y cálculo del código por N/K en mmol (Σ aportes ÷ conversión ÷ constante; constantes = factores de óxido, N sin constante: confirmado por el usuario); verificado: 218 de 218 planes reales coinciden con el código asignado; el endpoint/`hechos=1` entrega `codigos_nutricionales` al navegador; `237bd6d` relación > 6 = código 6 también en Solución Líquida. (b) `416efcd` Detalle turno × producto con SAP−Plan / Aplicado−Plan / Aplicado−SAP; textos largos pasan a ⓘ (`InfoDetalle.js`); bug de la tarjeta SAP−Plan (calculaba siempre en dinero) corregido, tarjetas por Cantidad/Dinero/Unidad, 252 combinaciones probadas; la fecha de corte recorta todo. Dato a revisar por el usuario: ácido fosfórico 0-54-0 tiene P = 104.78 en /CF06 (se esperaría 54). Preguntas abiertas: unidad por defecto en tarjetas (hoy la de más dinero); fecha de corte mayor que «Al»; Detalle turno × producto no respeta el período del clic en el gráfico (viene agregado del servidor).

**2026-11-16 (noche) · Código nutricional en pantalla** (AGL `bb7892c`, falta publicar): el Comparativo muestra el código Plan | SAP | Real (y el asignado por el plan nutricional, con ⚠ si el calculado no coincide) en Aportes, gráficas y tabla por fase, tabla por semana y turno, ficha del turno («se salió en el DDT n»), tarjeta resumen «N de M fases coinciden» y filtro «solo lo que no coincide». Decisión del usuario: **la fecha de corte es SIEMPRE «Al»** (se eliminó el campo propio). Las unidades de las tarjetas no le importan. Pendiente de decidir: colores del código (ámbar = difiere 1, rojo = difiere 2+; en el resto rojo = de más) y qué hacer con fases/semanas con varios códigos asignados (hoy «3 / 4», sin comparar).

**2026-11-16 (noche) · Comparativo sin límite por UMB** (AGL `a32a383`, falta publicar): el usuario NO quiere separar por unidad (L/KG/DO): se quitó el selector «Unidad» y la agrupación por UMB del Comparativo; Cantidad suma todo (aviso en el ⓘ de «Medir en»), Detalle por DDT es una sola lista. Las otras pestañas de /FR01 conservan sus subtotales por UMB. Quien tuviera su propio layout guardado en esas tablas lo pierde una vez. Pregunta abierta: ¿«Medir en» debe arrancar en Cantidad (hoy Dinero)?

**2026-11-16 (noche) · Seguridad AGL: ocultar en otra PC** (AGL `7f2554a`, falta publicar y reiniciar en las dos PC): la PC del dueño se reconoce SOLO por marca local o nombre del equipo (SRADMIN0166); la vieja SEADMIN04 (mismo usuario y correo, la usa el asistente) ya oculta. /SE04 tiene tarjeta «¿Por qué se oculta esta computadora?», «Ocultar/Mostrar ahora» y «Modo prueba». Revisión de seguridad con Opus: aprobado con observaciones (documentadas en `docs/seguridad-agl.md`; capa 1 = disuasión). Pendiente: el asistente no debe tener «Modificar» en /SE04 para que su PC oculte; no usar «Activar en esta PC» en SEADMIN04.

**2026-11-18 · Publicado a producción (código):** `main` = `aa84e8f`. Incluye: (1) **Aplicar sin inventario** (`abe85ba`, `6c3bdf3`): alerta roja fija arriba con casilla OBLIGATORIA; la casilla vale solo para el faltante exacto marcado (antes quedaba marcada de un producto a otro); al confirmar, la aplicación se registra con observación `SALDO_NEGATIVO` (antes, con señal, la base la rechazaba porque `inmediato=true`: la operación ahora lleva `acepta_negativo` y `sobreDe()` pone `inmediato:false`). Los errores de «Guardar» de todos los formularios de campo salen ARRIBA y fijos (`MarcoRegistro`). QA clics 35/37 (los 2 fallos eran de la prueba, ya corregidos). (2) **PWA** (`5eca61e`): el proxy mandaba `/manifest.webmanifest` y `/sw.js` a `/login` sin sesión (307 comprobado en producción) y el único icono era un SVG: ahora son públicos y hay PNG 192/512/maskable + `apple-touch-icon` 180 en `public/marca/`. El SW sigue registrándose solo al abrir /fertirriego (si algún teléfono viejo no ofrece instalar, registrarlo desde todas las pantallas). (3) **Anular la diferencia de un relevo** (`4fef113`, `sql/115`): solo con permiso «Anular» (el autor no basta), motivo ≥ 25 letras, revierte solo ese producto, queda tachada con «Anulada» + motivo/quién/cuándo, y ofrece «Registrar la aplicación olvidada»; SQL 28/28 en réplica, QA clics 23/23 en desarrollo. Flujo para un producto contado de menos que sí se aplicó: anular la diferencia (con motivo específico) → registrar la aplicación. Dato del usuario: era un caso de RELEVO. La app no tiene modo oscuro (los contrastes que vio el emulador son el modo oscuro forzado del navegador, no un defecto). Limpieza: 7 worktrees `worktree-agent-*` y sus ramas borrados; `desarrollo` subido a GitHub. Sigue sin commit el `CLAUDE.md` local del usuario.

**2026-11-18 (tarde) · Registro histórico (en desarrollo, SIN publicar):** `sql/116` (permiso temporal «Registro histórico» por persona y estación, aplicación histórica sin mover inventario, export aparte `aplicaciones_historicas`; AgroNoti `b027c4a`) y `sql/117` (acepta fechas ANTES de la siembra: hay aplicaciones del plan con DDT negativo; `192026f`, `1521e94`). Réplica: 116 83/83, 117 32/32, unitarias 8/8. **Pendiente: QA con clics** (`pruebas/qa/fertirriego_historico.ps1`, caso 7b = DDT −3) porque la base de DESARROLLO (`ifzwqdst…`) NO tenía la 116 aunque el usuario dijo haberla corrido (verificar con `select to_regclass('public.fert_historico_permisos')`; correr 116 y 117 en desarrollo). Producción: tras publicar el código, correr 115 → 116 → 117; si se vuelve a correr 95/99/100/102/115/116, correr 117 después. AGL (`e8a7489`, falta publicar): el Comparativo cuenta los históricos como **Real** (casilla «Incluir registros históricos (N)», encendida), nueva opción **«Las tres (Plan · SAP · Real)»** por defecto; QA 36/36, unitarias 12/12 y 13/13. /FR01 › Análisis ya incluye las históricas (decidido por el usuario; AGL `main` con commit de Análisis, falta publicar). `sql/116` se corrigió (`b086986`: la anulación se redefine completa; el usuario tuvo un error 42P01 «v_custodia» en desarrollo que no se reprodujo en la réplica): pendiente que la corra en DESARROLLO (116 y luego 117) y la QA con clics. Sin probar con datos reales de «Bajar de campo». Recepciones históricas: ampliación posible, no construida.

**2026-11-18 (tarde) · PUBLICADO A PRODUCCIÓN (código AgroNoti): `main` = `a7e385e`.** Incluye registro histórico (UI + admin `/admin/fertirriego-historico`), tickets con texto grande (equipo completo, «Volver al ticket TK-…» + aviso Guardado, área neta y bruta, nombre del lote principal), aviso de falta de inventario COMPACTO fijo sobre Guardar (ya no tapa la pantalla), nombres de producto completos, contrastes del tema oscuro. **FALTA (usuario) en Supabase de PRODUCCIÓN, en este orden: `sql/115`, `sql/116`, `sql/117`** (hasta entonces: «Anular esta diferencia» avisa que el servidor no está actualizado y el botón «Registrar histórico» no aparece). Después publicar AGL (`Publicar_Produccion.bat`: Comparativo con históricas y «Las tres», Análisis con históricas, Polinización, Planificación de lotes) y «Bajar de campo». Lecciones: las pruebas con clics que se atascan hay que cortarlas pronto (el script imprime al final; poner `Write-Host` de diagnóstico); un horómetro reparte sus horas entre las labores (la 2.ª labor del mismo horómetro queda en 0 h); la app SÍ tiene tema oscuro (`html[data-tema='oscuro']`, remapear colores `text-*-900` en `globals.css`). Pendientes menores: la QA del último ajuste de la barra de inventario (commit `47a5997`) estaba corriendo al publicar; QA de tickets sin completar los pasos al 200 %; recepciones históricas (ampliación posible); `Publicar_Produccion.bat` es el nombre real del archivo de AGL.

**2026-11-18 (noche) · PUBLICADO `main` = `4555380`: letra grande en Fertirriego/AppShell.** Nada se oculta con texto de 150–200 %: sin `truncate`, botones con `min-h` (no alto fijo; cambio global en `Primitivos.tsx`), pie de formularios en `flex-wrap`, filas de cantidad que bajan, tablas del detalle de conteo y «Por turno» pasaron a listas (`ul/li`; se conservan `data-detalle-conteo` y `data-producto-tarjeta`), pestañas en varias filas, tamaños px→rem, encabezado con nombre/rol completos. QA `pruebas/qa/fertirriego_texto_grande.ps1` 119/119 (24 y 32 px, 360 y 412 px; detector con control negativo; las 2 primeras corridas dieron falsos «ok» porque la fuente raíz no se aplicaba: la prueba ahora falla si no es la pedida). El usuario ya corrió 115, 116 y 117 en PRODUCCIÓN (2026-11-18). **Pendientes menores:** título del diálogo muy alto con letra grande (dejar la estación como subtítulo en `Modal.tsx`), «Estacionero» se parte a mitad de palabra en el encabezado (`break-words`), regresión `fertirriego_campo.ps1` sin correr tras el cambio de tablas a listas, modo claro y pestañas vacías sin probar; el usuario debe publicar AGL (`Publicar_Produccion.bat`), «Bajar de campo» y dar el permiso en Administración › Registro histórico.

**2026-11-18 (noche) · PUBLICADO `main` = `55c25f1`: ubicación GPS OPCIONAL en Fertirriego** (pedido del usuario; antes era obligatoria). `MarcoRegistro` ya no bloquea «Guardar» si el permiso está denegado ni si el GPS no responde: se guarda igual y la base anota la observación `SIN_UBICACION` (operación ACEPTADO_CON_OBSERVACIONES, lat/lon nulos; la base ya lo aceptaba, sin SQL). Con permiso, el registro lleva lat/lon como antes. QA `pruebas/qa/fertirriego_ubicacion_opcional.ps1` 19/19 (denegado, concedido con ubicación simulada, sin señal). Sin probar: Aplicar/Recibir/Envases/Traslado uno por uno (comparten `MarcoRegistro`), GPS sin respuesta con permiso concedido, teléfono real. Manual del estacionero actualizado («recomendado, no obligatorio»). Ojo: AgroMétricas (`lib/agrometricas/gps.ts`, calicata) sigue pidiendo GPS: NO se tocó.

**SIGUIENTE (pedido 2026-11-18): Bitácora de errores por usuario («blindar el sistema»).** El usuario quiere, como administrador, ver por usuario todo problema en campo: lo que no sincronizó, lo que registró pero no se guardó bien, errores del teléfono; con informe detallado (qué pasó, causa, por qué y cómo solucionarlo). Diseño y estado: `docs/bitacora-errores.md` (SQL 118).


**2026-11-18 (noche) · PUBLICADO `main` = `87c0d62`: Catálogos/Administración con menú en árbol (favoritos, recientes, buscador, hoja móvil) + Bitácora de errores por usuario** (`/admin/errores`, `docs/bitacora-errores.md`). QA bitácora 34/34 con la 118 en desarrollo; admin_catalogos_ux 257/257. **FALTA (usuario): correr `sql/118` en PRODUCCIÓN** (la app funciona sin ella, pero no guarda errores) y dar el permiso «Administración · Bitácora de errores» a quien deba verla. Reiniciar su `npm run build/start` local. Pendientes menores: título del modal alto con letra grande, «Estacionero» partido en el encabezado, regresión `fertirriego_campo.ps1`, selectores de la bitácora sin alternar única/múltiple, publicar AGL.
