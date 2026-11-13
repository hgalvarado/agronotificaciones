# Seguimiento del proyecto · punto de partida para una conversación nueva

> Actualizado: 2026-11-12 (mañana: 96 probada, AGL /SE03 Conexiones cifradas; bitácora de la noche en `reporte7am.md`). Lo escribe Claude. Al abrir una conversación nueva, **leer este archivo primero**,
> después `MEMORIA_CLAUDE.md` (AgroNotificaciones) y la memoria `agl-ordenes-sap-procesos.md`.
> Responder siempre al usuario **en español, claro y sin jerga**.

---

## 1. Los dos proyectos

| | **AGL Gestión** (donde estamos trabajando) | **AgroNotificaciones** |
|---|---|---|
| Carpeta | `C:\HENRYALVARADO2022\AGLGestion_App` | `C:\HENRYALVARADO2022\agronotificaciones` |
| Tecnología | Python (`engine\python.exe`) + JS sin framework; datos JSON/Parquet en OneDrive | Next.js 16 + Supabase, Vercel |
| Rama | `main` local (commits ahí) | `desarrollo` (commits ahí) |
| Publicar | Lo hace el usuario con `Publicar_Produccion.bat` | Solo con «pasa a producción» del usuario |
| Último commit | `03b55ea` (Fertirriego D + manual) | `desarrollo` = `e3910ab`+; `main` = `7ed69a6` |

---

## 1b. NUEVO (2026-11-11): Fertirriego — une los dos proyectos

Control del producto de nutrición en las estaciones de riego: el estacionero registra en AgroNotificaciones
(teléfono, **sin señal**) lo que recibe, lo que aplica por turno y su saldo; AGL publica turnos/estaciones/
materiales/plan a Supabase y después baja los movimientos para comparar **Plan · Salidas SAP · Aplicado**.
Consignación = recibido − aplicado (SAP solo compara). Diseño completo y decisiones del usuario:
`agronotificaciones/docs/fertirriego-diseno.md` (no volver a preguntar lo que ahí está decidido).

- **Etapa A hecha** (2026-11-11): `agronotificaciones/sql/91_fertirriego_base.sql` (probada en réplica 57/57,
  **sin correr** en Supabase) + AGL `backend/fertirriego_campo.py`, rutas `/api/fertirriego/*`, botón
  «Publicar a campo» en /CF07 (QA con clics 9/9).
- **Pendiente del usuario**: la 91 ya está corrida y el rol «Integración AGL» creado; falta guardar la conexión en
  AGL › **/SE03 Conexiones** (nuevo 2026-11-12: cifrada en `data/sistema`, compartida por OneDrive, clave maestra por
  PC; manual de AGL, sección 2) y darle a su asistente «Mostrar» en Conexiones + T-Code /SE03.
- **Permisos v2** (2026-11-11, antes de la Etapa B, pedido del usuario): varios roles por persona, «Todas las
  zonas» explícito, Permisos por módulo con niveles rápidos, ficha de Usuarios. `sql/92` corrida en desarrollo;
  producción NO debe cambiar para nadie (probado con equivalencia antes/después). Ver MEMORIA_CLAUDE.md.
  Cerrado con `sql/93` (historial, menú desde la base, delegación a jefes de zona), corrida en desarrollo.
- **Fertirriego Etapa B hecha** (app de campo sin señal; `sql/94` y `sql/95` corridas en desarrollo).
- **AGL única fuente de catálogos**: inventario en `agronotificaciones/docs/agl-fuente-unica.md` (falta decidir).
- **Producción**: el usuario decidió NO pasar nada hasta tener todos los módulos nuevos listos y probados.
- **Fertirriego Etapa C hecha** (2026-11-12): relevo con código sin internet y traslados. `sql/96` corrida en
  desarrollo por el usuario (2026-11-12); QA con clics `pruebas/qa/fertirriego_relevo_traslado.ps1` 27/27 y Etapa B 27/27.
- **AGL /SE03 Conexiones** (2026-11-12, pedido del usuario): `backend/conexiones.py` (PBKDF2 + HMAC-SHA256, solo
  biblioteca estándar; DPAPI por ctypes), `frontend/js/views/conexiones.js`, submódulo `conexiones` (Mostrar =
  desbloquear/probar; Modificar = editar). Unitaria 37/37, clics 28/28 (×3), regresión publicar 9/9 y campo 13/13.
  Protección (`0188018`): al cambiar de base se borra lo bajado/publicado con la anterior (el usuario probará desde
  AGL de producción contra Supabase de desarrollo). Pendiente del usuario: rol «Integración AGL» en desarrollo
  necesita `publicar` y quitarle lo que sobra (ver MEMORIA_CLAUDE.md).
- **Fertirriego Etapa D hecha en AGL** (2026-11-12): «Bajar de campo» y pestaña **Campo** en /CF07 (comparativo
  Plan · Cargado SAP · Aplicado, consignación valorizada, relevos a revisar). `backend/fertirriego_analisis.py`.
- **Manuales**: `agronotificaciones/docs/manuales/` (estacionero, jefe de zona, administrador, guion de la charla;
  el del estacionero también dentro de la app) y `AGLGestion_App/docs/manual_fertirriego_AGL.md`.
- **Siguiente**: Etapa E (alertas, sugerencia de envío, cierre mensual; faltan umbrales del usuario); decisiones de
  catálogos (AGL única fuente).
- **2026-11-12 · Producción**: código publicado (`main` = `f54812e`) y SQL 91–98 corridas en producción (verificado).
- **2026-11-12 · Prueba piloto 1 (10 observaciones)**: `sql/99` corrida en DESARROLLO; contrato en
  `agronotificaciones/docs/fertirriego-piloto1.md`. AgroNoti `desarrollo` = `6f003d2` (QA con clics 29/29 + regresiones).
  AGL `10ac7da` + `2327c54` (Clasificación de productos en /FR01: solo «Fertilizante» entra al comparativo).
  **Pendiente del usuario**: revisar la Clasificación en /FR01 (el grupo 6400 viene sugerido como fertilizante y
  tiene melaza, EVADE, cloro…); publicar AGL; cuando diga «pasa a producción»: código + `sql/99` en producción.
  (2026-11-12: pasó a producción, `main` = `a20c8f0`; la 99 la corre el usuario en producción.)
- **2026-11-13 · Prueba piloto 2**: contrato `agronotificaciones/docs/fertirriego-piloto2.md`. `sql/100` (teléfono y AGL
  reciben todo el detalle) y `sql/101` (AGL baja APARTE lo del modo de pruebas, solo mientras está activo) corridas en
  DESARROLLO. AgroNoti `desarrollo` = `aaf1cc3` (clics piloto2 33/33, piloto1 29/29, campo 37/37, relevo 27/27,
  modo pruebas 8/8). AGL `424dfb3` (Análisis, comparativo con gráficos Chart.js, todo lo registrado, «Ver datos de
  prueba»; unitarias 55/55 + 14 + 37 + 17, clics 35/35 y 24/24). Pendiente: publicar AGL; «pasa a producción» =
  código + `sql/100` y `sql/101` en producción.
- **2026-11-13 · Producción**: piloto 2 publicado (`main` = `171108f`), SQL 99–101 en producción (100 corregida).
- **2026-11-13 · Ronda «AgroNotificaciones fina»** (4 agentes): Terminar ciclo / Reactivar turno (`sql/102` + AGL /TR02
  `04a4687`; doc `agronotificaciones/docs/fertirriego-archivo-turnos.md`), Menú por rol (`sql/103`, QA 25/25),
  Desinfección desde AGL + retiro de Trasplante/Riego (`sql/104`, QA 24/24; respaldo de desarrollo en
  `respaldos/20261112_2244_desarrollo_tablas_viejas`), análisis de catálogos (`docs/agl-fuente-unica.md`, decisiones
  aceptadas). Lema «Monitoreo agrícola integral». 103 y 104 corridas en desarrollo; falta la 102.

## 2. En qué estábamos: AGL › /OS01 Gestor de Órdenes SAP

La idea: SAP es la única fuente de verdad. /OS01 replica la COHV (órdenes) y la KOB1 (salidas/costos reales),
las cruza con la planificación de lotes y muestra qué falta crear y cuánto se ha gastado.

### 2.1 Lo hecho (commits de AGL, en orden)

1. `98f8684` · Procesos **AP / LEV / CAT** (/PR01), Estructura PEP por proceso, Catálogo de Órdenes (/OS03),
   «Período SAP» en /TM01 (`backend/estructura_sap.py`).
2. `180a96c` · **Tablero de la Planificación** (`backend/tablero_ordenes.py`): por proceso, fila = lote,
   columna = orden del catálogo, estado automático contra el Machote; «No aplica» por clic.
3. `fd574ec` · La plataforma **se actualiza sola** (sin F5): `backend/cambios.py` + `frontend/js/actualizacionViva.js`.
   Órdenes opcionales («Obligatoria» en /OS03) y fecha de siembra.
4. `ba72a01` · Pestaña **Salidas SAP** (`backend/salidas_sap.py`): partidas por orden, Costo por lote (Lps/mz,
   turnos repartidos por % de área). Catálogo **/OS04 Clases de Coste** (21100 y 511999 = liquidación, no gasto).
5. `8ec8aaf` · **«Bajar de SAP»** por SAP GUI Scripting (`backend/rpa_sap.py`): COHV → Machote, KOB1 → Salidas.
6. `02a8489` · Opciones al bajar, **Parquet por mes**, **órdenes de servicio** (SERV + /OS05), CAT con formato SAP.
   Probado con SAP real y copia aislada; QA con clics OK. **Aún no publicado por el usuario** (o no confirmado).

### 2.2 Decisiones del usuario (no volver a preguntar)

- **COHV**: solo órdenes **liberadas**, centro **2030**, disposición **HENRYREPORT**. Opción de bajar **todas**
  (sin filtro de PEP, incluye servicio), solo las de la temporada, o un PEP/patrón. Meses por **Fecha entrada**
  (= fecha de creación de la orden). Siempre se le deja **elegir** cuántos meses.
- **KOB1**: disposición **/BAJARNAHUM**; «Cantidad máxima de aciertos» = **999999999** (si no, corta el reporte).
  Por defecto **últimos 2 meses**; opción «Todo el historial». En SAP los meses cerrados no cambian.
- **Almacenamiento**: Parquet, un archivo por mes de contabilización (`AAAA-MM.parquet`, `sin-fecha.parquet`)
  en `data/ordenes_sap_salidas`. Los `SA_*.json` viejos se migran solos a `_archivo/` (40 MB → 0.34 MB).
- **Órdenes de servicio** («T-SERVICIO INTERNO», números de 6 dígitos 300xxx, PEP vacío o tipo `[CARGOS_TALLER]`):
  son **permanentes**, no pertenecen a AP/LEV/CAT. Opción elegida: **«Catálogo + costo»** → proceso **SERV**
  (Permanente, sin temporada), catálogo **/OS05** (descripción, zona, área), costo por mes y zona,
  **no se reparte a lotes**. Se registran desde Planificación › SERV.
- **PEP de CAT** = el de SAP: `{UT}-{VAR}{PER}{CICLO}` (ej. `1001-130-831501`), orden especial `C{UT}-{VAR}`;
  órdenes T900, T901, T910, T911, T912.
- AP/LEV: PEP `{UT}-00{PER}` (ej. `1002-110-0016`; 0016 = temporada 2026-2027).
- Vista Plana (ALV) siempre por defecto; agrupar solo si el usuario lo pide.
- Toda ruta nueva de AGL declara `canales` (para que se actualice sola).

### 2.3 Lo que falta (pendientes)

**Del usuario, en producción, después de publicar `02a8489`** (la publicación NO cambia catálogos guardados):
- [ ] /PR01: estructura de CAT → `{UT}-{VAR}{PER}{CICLO}`; crear **SERV** «Servicios (permanente)» con
      Permanente = Sí y Estructura PEP vacía.
- [ ] /OS03: agregar `T-SERVICIO INTERNO` (SERV, tipo Servicio, Obligatoria = No); para CAT: `T910`, `T911`,
      `T912`, `C{UT}-{VAR}` (Especial).
- [ ] /OS03: Obligatoria = No en T101, T520, T521, T573 (pendiente desde `ba72a01`).
- [ ] Reiniciar `Iniciar_Plataforma`.
- [ ] Primera vez: KOB1 con «Todo el historial»; después 2–3 meses.
- [ ] Catalogar en /OS03 las **332 órdenes liberadas** cuyo material no está (sobre todo T9xx).
- [ ] Clasificar en /OS04 las **753 partidas** con clase de coste sin catalogar; decidir qué cuentas excluir.

**De Claude (próximos pasos posibles, confirmar con el usuario):**
- [ ] Preguntar si tras publicar `02a8489` la ventana de Salidas ya va rápida, o dónde se siente lenta.
- [ ] /OS02 `tareas_sap` está sin uso: decidir si se retira o se aprovecha.
- [ ] Completar descripciones de órdenes CAT cuando el usuario las dé.

---

## 3. Lo que NO se toca (reglas firmes)

**AGL**
- Datos de producción (solo lectura para Claude):
  `C:\Users\Hhernandez\OneDrive - Agropecuaria Montelibano\Escritorio\TORRE DE CONTROL\Torre Control dv\data`.
- El servidor del usuario (puerto **5001**) y producción (5000): no se usan para pruebas.
- La publicación (`arranque.py`) **nunca** modifica datos del usuario (solo puede crear carpetas) ni
  `data/sistema/menu_schema.json`.
- Las semillas de catálogos solo aplican a instalaciones nuevas: cambios a catálogos existentes los hace el usuario.
- No publicar: lo hace el usuario.

**SAP**
- Solo **lectura**. Siempre en una **sesión propia** (`CreateSession` → minimizada → `CloseSession`): no tocar
  las ventanas del usuario. El portapapeles del usuario se **restaura**.

**AgroNotificaciones**
- Commits en `desarrollo`; nunca push/merge a `main` sin «pasa a producción».
- Claude **no ejecuta DDL** en Supabase: entrega `sql/NN_*.sql`, los prueba en réplica local y el usuario los corre.
- No usar `npm run build` en la carpeta del usuario.

**Siempre**
- QA obligatoria **con clics reales** antes de entregar.
- Información del usuario privada; secretos nunca en el chat.

---

## 4. Cómo trabajar (recetas)

### QA de AGL (copia aislada)
- robocopy `backend`, `frontend`, `data` a `<scratchpad>\agl_qa`; `entorno.local.cfg` con `ENTORNO=DEV`, `PUERTO=5097`.
- Arrancar: `AGLGestion_App\engine\python.exe backend\server.py` desde la copia; esperar `/api/salud` antes de probar.
- Login: en la COPIA, reemplazar `password_hash` de `halvarado` en `data\seguridad\usuarios.json` con
  `security.generar_hash(<clave temporal>)`.
- Carpetas de catálogos nuevos: correr `arranque.inicializar` sobre la copia (en producción lo hace la publicación).
- Los SmartSelect de AGL solo responden a clic de ratón real (CDP `Input.dispatchMouseEvent`).
- Scripts QA en UTF-8 con BOM; ojo: en PowerShell las variables no distinguen mayúsculas (`$toast` = `$TOAST`).

### Detalles técnicos que costó descubrir
- `backend/catalogos.py` usa **CRLF**: editar solo con la herramienta Edit.
- COHV: el status «LIB.» escrito da «ambiguo»; hay que elegirlo de la lista **F4** (`_elegir_status`).
  La COHV no tiene filtro por fecha de creación: los meses se filtran después de leer.
- Lectura rápida de grids: «Fichero local…» (tbar[1] btn[45]) → portapapeles, parseo por posiciones `|`,
  verificación con muestra y respaldo celda por celda. KOB1 «Otras opciones» = `btnBUT1`.
- Selección múltiple en SAP: subir desde portapapeles (wnd[1] btn[16] borrar, btn[24] subir, btn[8] tomar).
- Formato numérico SAP: coma de miles, punto decimal, signo menos al final.
- NaN de Parquet rompe JSON: `df.astype(object).where(df.notna(), None)`.
- Trabajos RPA: hilo con `pythoncom.CoInitialize`, uno por máquina (otro → 409); estado en
  `GET /api/ordenes_sap/rpa/<id>`.
- Mensajes de commit con comillas: `git commit -F <archivo>`.

### Datos de referencia (SAP, centro 2030)
- 62,886 órdenes en total; 1,122 liberadas (580 de temporada 16, 33 de servicio, 166 CAT).
- KOB1: 2 meses = 5,466 partidas (~40 s); todo = 14,651. COHV todas liberadas ~19 s.
- Costo por lote total (QA): L 36,587,458.76. Servicios (QA): 9 órdenes, L 34,179.15.

---

## 5. Archivos clave de AGL /OS01

| Archivo | Qué hace |
|---|---|
| `backend/rpa_sap.py` | Bajar COHV/KOB1 desde SAP GUI (opciones, trabajos en segundo plano, lectura de grids) |
| `backend/salidas_sap.py` | Salidas en Parquet por mes: guardar, vigente, importar, costo por lote, costo de servicios |
| `backend/machote_sap.py` | Machote (órdenes de la COHV), importar, listar con contexto |
| `backend/estructura_sap.py` | Estructura PEP, servicios, material esperado ({VAR}) |
| `backend/tablero_ordenes.py` | Tablero de la Planificación (incluye SERV) |
| `backend/catalogos.py` | Esquemas de catálogos (/PR01, /OS03, /OS04, /OS05) y semillas — **CRLF** |
| `backend/server.py` | Rutas `/api/ordenes_sap/...` (rpa, salidas, servicios, tablero) |
| `frontend/js/views/gestorOrdenes.js` | Pantalla /OS01: Machote, Planificación, Salidas, Bajar de SAP |
| `frontend/js/services/ordenesSap.js` | Llamadas al servidor de /OS01 |
| `frontend/css/ordenes.css` | Estilos de /OS01 |

---

## 6. AgroNotificaciones: pendientes (sin tocar en esta etapa)

Ver detalle en `MEMORIA_CLAUDE.md` §4:
- Filtro «Horómetro malo» en /horometros (aprobado).
- Duplicados viejos de tickets «Registrado» del mismo día (decidir con el usuario).
- Velocidad de Labores: pedir solo las columnas necesarias en `ControlLabores`.
- Fase 3 captura sin señal (proponer antes de construir); DDT de Desinfección; borrar tablas de Trasplante/Riego;
  borrar usuario QA de desarrollo al final.
