# Planificador · Bloque 1 «Plan contra hecho» · plan de construcción

> **Para quien ejecute:** usar `superpowers:subagent-driven-development` o `superpowers:executing-plans`. Cada paso lleva casilla `- [ ]`.
> **Regla del proyecto que manda sobre el flujo TDD habitual** (`proyecto-seguimiento.md` §2): quien escribe código **no ejecuta pruebas**.
> Cada tarea escribe su archivo de prueba junto con el código, pero **todas las pruebas se ejecutan UNA sola vez en la Tarea 8, por Opus**,
> con tope de 25 minutos. Si algo falla, Opus devuelve archivo:línea y se corrige sin reescribir.

**Meta:** una pantalla nueva en AGL (`/PL01`, «Planificador · Plan contra hecho», solo lectura) que muestra, por turno de riego y por semana, qué
actividades del plan tocaban, si se hicieron, y con cuántos días de diferencia contra el DDT, agrupadas por jefe de zona.

**Arquitectura:** un módulo Python puro (`plan_vs_hecho.py`) hace el emparejamiento plan↔hecho sin leer archivos; tres adaptadores leen el plan
(LTP + turnos de `/TR02`) y lo hecho (Fertirriego, salidas SAP T500–T503) con las funciones que AGL ya tiene; un endpoint lo sirve; una vista
con `DataGrid` lo muestra. Nada se escribe en disco ni en Supabase en este bloque.

**Stack:** Python (backend AGL, pandas solo donde ya se usa), JS vanilla en `frontend/js`, `DataGrid` existente, pruebas como scripts en `pruebas/`
(`prueba_*.py`, `prueba_*.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-21-planificador-actividades-campo-design.md` (aprobado por el usuario el 2026-11-21; ver §5, §7, §13, §14, §15).
Repos: código en `C:\HENRYALVARADO2022\AGLGestion_App` (rama `main`, la publica el usuario); este plan y la spec en `agronotificaciones` (`desarrollo`).

## Restricciones globales
- Textos al usuario en español, claros; verbos estándar (Guardar, Editar, Eliminar, Importar, Exportar). Fechas y horas en UTC-6 (America/Tegucigalpa).
- No escribir nombres de roles en el código: permiso por la matriz (submódulo `planificador`, acción `leer`; `exportar` para el Excel).
- La unidad es el **turno de `/TR02`** (siembra con su fecha), no el lote. Fecha del plan = `fecha_siembra` del turno + `DDT` del LTP. **DDT exacto: sin tolerancia**; se muestra la diferencia en días.
- Todo `DataGrid` con filtros, orden, agrupar, exportar y selección (convención del proyecto). La pantalla debe verse bien con la escala automática (`frontend/css/styles.css`): nada de alturas `100vh` sin dividir entre `var(--z, 1)`; usar las ya convertidas.
- Datos de producción (carpeta OneDrive `Torre Control dv\data`) solo lectura. No tocar `data/sistema/menu_schema.json` desde código ni desde la publicación.
- Archivos Python y JS de AGL: respetar el fin de línea que ya tienen (`git show HEAD:<archivo>`; `catalogos.py` es CRLF y solo se edita con la herramienta Edit).
- Fuera de este bloque: programación semanal/diaria, Labores Culturales, Inyección (registro), Mecanización (requiere bajar datos de Supabase), acuerdos de la reunión.

## Review Focus (lo que la spec no dice y puede morder)
1. Un turno sin `fecha_siembra` o sin ciclo/variedad que coincida con el LTP: no debe romper la pantalla; se lista aparte como «Turno sin plan» con el motivo.
2. Dos hechos el mismo día para la misma línea del plan (dos aplicaciones): suman; no crean una línea «extra» falsa.
3. Un hecho que cae lejos de cualquier línea del plan (más de 7 días): es «extra» con su fecha; nunca se pega a una línea ya cumplida.
4. Plan con fecha futura y sin hecho: «pendiente», no «no hecho». Plan vencido sin hecho: «no hecho».
5. Actividades sin fuente de registro todavía (Inyección, Drench, Preparación, Mecanización): se muestran como «Sin registro (aún no hay módulo)», nunca como «no hecho».

## Estructura de archivos
- Crear `backend/plan_vs_hecho.py` — emparejamiento puro y reglas de estado (sin I/O).
- Crear `backend/planificador_fuentes.py` — adaptadores: plan (LTP+turnos), Fertirriego, salidas SAP T500–T503.
- Crear `backend/planificador.py` — servicio `plan_vs_hecho(temporada_id, desde, hasta, perfil)` y tarjetas de Trasplante/Polinización.
- Modificar `backend/server.py` — ruta `GET /api/planificador/plan-vs-hecho`.
- Modificar `backend/menu.py`, `backend/catalogos.py` (lista de transacciones, ~línea 700), `backend/seguridad.py` (submódulos, ~línea 63) — T-code `/PL01`.
- Crear `frontend/js/services/planificador.js`, `frontend/js/views/planificador.js`, `frontend/css/planificador.css`; modificar `frontend/js/app.js` (import + `RUTAS`), `frontend/index.html` (`<section data-vista="torre-control/planificador">` y `<link>` del css), `frontend/js/ui/iconosMenu.js`.
- Crear `pruebas/prueba_plan_vs_hecho.py`, `pruebas/prueba_planificador_fuentes.py`, `pruebas/prueba_planificador_servicio.py`, `pruebas/prueba_planificador_vista.mjs`.

---

### Tarea 1: Emparejamiento plan↔hecho (núcleo puro)

**Archivos:** Crear `backend/plan_vs_hecho.py`; Prueba `pruebas/prueba_plan_vs_hecho.py`.

**Interfaces — Produce:**
```python
TIPOS_CON_FUENTE = {"fertilizacion", "fitoproteccion"}   # el resto => estado "sin_registro"
# linea de plan: {"turno_id","turno","zona","encargado","tipo","departamento","categoria","ddt":int,"fecha_plan":"AAAA-MM-DD",
#                 "productos":[{"material","texto","cantidad_plan":float}]}
# hecho:         {"turno_id","tipo","fecha":"AAAA-MM-DD","fuente":"fertirriego"|"sap","productos":[{"material","cantidad":float}]}
def tipo_de(departamento: str, categoria: str) -> str   # ver reglas abajo
def emparejar(lineas: list[dict], hechos: list[dict], hoy: str, ventana_dias: int = 7) -> list[dict]
# fila resultante = linea + {"estado","fecha_real","dias_dif","productos":[{material,texto,cantidad_plan,cantidad_real}],"origen_real"} ;
# hechos sin linea => {"estado":"extra", "turno_id","tipo","fecha_real","productos":[...]}
```
- Reglas de `tipo_de` (Departamento / Categoría del LTP, sin distinguir mayúsculas ni tildes): `Ferti-Riego`/`Fertilizantes`→`fertilizacion`; `*`/`Inyeccion`→`inyeccion`; `*`/`Drensh`→`drench`; `Fito-Proteccion` (cualquier categoría salvo Inyeccion y «Muestras de suelo»)→`fitoproteccion`; `Muestras de suelo`→`muestreo`; `Preparacion Suelo`, `Trasplante`, `Invernadero`, `Cultivo Rotacion`, `Aseg. Calidad`, `Directos Produccion`, `Metan Sodio`, `Maiz Dulce` y cualquier otro→`preparacion`.
- Reglas de `emparejar`: se empareja por `(turno_id, tipo)`; cada hecho se asigna a la línea sin cumplir más cercana en fecha dentro de `ventana_dias` (empate: la más antigua); varios hechos de la misma línea se suman por material. `estado`: `hecho` si todos los materiales del plan tienen real > 0; `parcial` si alguno sí y alguno no; sin hecho: `pendiente` si `fecha_plan > hoy`, `no_hecho` si `<= hoy`; si el tipo no está en `TIPOS_CON_FUENTE`: `sin_registro`. `dias_dif = fecha_real − fecha_plan` en días (positivo = tarde; con varios hechos, el primero). La cantidad no cambia el estado (se muestra plan contra real).

- [ ] **Paso 1: Escribir `pruebas/prueba_plan_vs_hecho.py`** con estos casos exactos (script con `assert`, estilo de `prueba_turnos_pegado.py`): `tipo_de("Ferti-Riego","Fertilizantes")=="fertilizacion"`; `tipo_de("Fito-Proteccion","Inyeccion")=="inyeccion"`; `tipo_de("Fito-Proteccion","Herbicidas")=="fitoproteccion"`; `tipo_de("Ferti-Riego","Drensh")=="drench"`; `tipo_de("Ferti-Riego","Preparacion Suelo")=="preparacion"`; línea DDT 36 con 2 materiales y hecho el mismo día con ambos → `hecho`, `dias_dif==0`; hecho 2 días después → `dias_dif==2`; solo un material → `parcial`; sin hecho y `fecha_plan` ayer → `no_hecho`; sin hecho y mañana → `pendiente`; tipo `inyeccion` sin hecho → `sin_registro` (nunca `no_hecho`); dos hechos el mismo día suman cantidades y no generan `extra`; hecho a 20 días de cualquier línea → una fila `extra`; hecho de la misma línea ya cumplida más un segundo hecho 3 días después → el segundo se suma a la más cercana sin cumplir o, si no hay, es `extra` (Review Focus 2 y 3).
- [ ] **Paso 2: Implementar** `backend/plan_vs_hecho.py` con las firmas de arriba (funciones puras, sin imports de AGL salvo `datetime`/`unicodedata`).
- [ ] **Paso 3: Commit** `feat(planificador): emparejamiento plan-hecho`

### Tarea 2: Plan desde el LTP y los turnos

**Archivos:** Crear `backend/planificador_fuentes.py` (parte plan); Prueba `pruebas/prueba_planificador_fuentes.py`.

**Consume:** `ltp_insumos.filas_con_dosis(temporada)` (filas con `departamento`, `categoria`, `ddt`, `material`, `texto_breve`, `dosis`, `calculado`, `ciclo`, `variedad` — **verificar en el código que `departamento` y `categoria` vienen en esas filas; si no, leer de la hoja `LTP_Insumos` por el mismo lector**), `fertirriego_cubo.turnos_info(turnos, encargado_de_zona)` (turno: `siembra`, `ciclo`, `zona`, `encargado`, `lotes:[{lote,variedad,area}]`), `plan_vs_hecho.tipo_de`.
**Produce:** `def plan_de_turnos(temporada, turnos_info: dict, desde: str, hasta: str) -> tuple[list[dict], list[dict]]` → `(lineas, turnos_sin_plan)`; una línea por `(turno, tipo, ddt)` con `productos` y `cantidad_plan = área_de_la_variedad_en_el_turno × dosis × %calculado` (misma regla de redondeo que `ltp_corrida`: reutilizar sus helpers `_redondear`/`_decimal`, no copiarlos); `fecha_plan = siembra + ddt días`; solo `desde ≤ fecha_plan ≤ hasta`. `turnos_sin_plan = [{"turno","motivo"}]` (motivos: «Sin fecha de siembra», «Sin ciclo», «Ninguna variedad del turno tiene plan en el LTP»).

- [ ] **Paso 1: Escribir la prueba** con filas de LTP y turnos sintéticos (sin leer Excel): un turno con siembra 2026-11-01, variedad «Jabiru», ciclo «Ciclo 1»; filas LTP DDT 10 (Fertilizantes, 2 materiales) y DDT 12 (Fito-Proteccion/Fungicidas); esperar 2 líneas con `fecha_plan` `2026-11-11` y `2026-11-13`; rango que excluye la segunda → 1 línea; turno sin `siembra` → aparece en `turnos_sin_plan` con motivo «Sin fecha de siembra»; turno con dos variedades suma solo las variedades que tienen fila en el LTP.
- [ ] **Paso 2: Implementar** `plan_de_turnos` (la lectura real del LTP queda en una función aparte `leer_ltp(temporada)` que la prueba reemplaza por datos sintéticos).
- [ ] **Paso 3: Commit** `feat(planificador): plan desde LTP y turnos`

### Tarea 3: Hechos de Fertirriego y de SAP (T500–T503)

**Archivos:** Modificar `backend/planificador_fuentes.py` (parte hechos); Prueba `pruebas/prueba_planificador_fuentes.py` (ampliar).

**Consume:** el constructor de `por_fuente["R"]` (`{(turno_agl_id, material, "AAAA-MM-DD"): cantidad}`) que ya usa `fertirriego_analisis.py` para el Comparativo — **localizarlo y reutilizarlo, no reescribirlo** (incluye las aplicaciones históricas y respeta anuladas); `salidas_sap.listar(perfil, temporada_id)` (filas con contexto `turno`, `tarea_material`, `material`, `cantidad`, `fecha`).
**Produce:**
```python
def hechos_fertirriego(temporada_id) -> list[dict]          # tipo "fertilizacion", fuente "fertirriego", por (turno_id, fecha)
def hechos_sap_fito(perfil, temporada_id, turnos_por_nombre: dict) -> list[dict]   # tipo "fitoproteccion", fuente "sap"
TAREAS_FITO = ("T500", "T501", "T502", "T503")   # Insecticidas, Fungicidas, Foliares, Biológicos
```
- `hechos_sap_fito`: filas con `tarea_material` en `TAREAS_FITO` (comparar por prefijo, p. ej. «T500 Insecticidas»), turno resuelto por el campo `turno` de la salida contra el nombre del turno de `/TR02`; salidas sin turno resoluble se cuentan y se devuelven en un aviso, no se pierden en silencio. `cantidad` es la de la salida (valor absoluto); `fecha` es la de contabilización.

- [ ] **Paso 1: Leer** el formato real de `salidas_sap.listar` (una llamada con `desde_meses` corto en la prueba de Opus; aquí solo confirmar nombres de campos en el código de `_clasificar`/`listar`) y anotar en el docstring los campos usados.
- [ ] **Paso 2: Ampliar la prueba** con salidas sintéticas: 2 salidas T500 y 1 T501 del turno «T1002-T01» → 3 productos en hechos `fitoproteccion` por su fecha; una salida T900 (no fito) se ignora; una salida sin turno resoluble aumenta el contador de avisos; una salida con `cantidad` negativa (abono) no suma como hecho.
- [ ] **Paso 3: Implementar** ambas funciones y **Paso 4: Commit** `feat(planificador): hechos de Fertirriego y SAP`

### Tarea 4: Servicio `plan_vs_hecho` y endpoint

**Archivos:** Crear `backend/planificador.py`; Modificar `backend/server.py` (ruta junto a las `_ruta("GET", r"/api/fertirriego/...` ~línea 1717, `permiso="leer"`); Prueba `pruebas/prueba_planificador_servicio.py`.

**Produce:**
```python
def plan_vs_hecho(temporada_id: str, desde: str, hasta: str, perfil, zona: str | None = None) -> dict
# {"filas":[fila de emparejar + {"semana_iso","mes"}], "turnos_sin_plan":[...], "avisos":[str], "resumen":{"hecho":n,"parcial":n,"no_hecho":n,"pendiente":n,"extra":n,"sin_registro":n},
#  "tarjetas":{"trasplante":{...}, "polinizacion":{...}}}
```
- `hoy` = fecha de hoy en America/Tegucigalpa (reutilizar `fertirriego_cubo.hoy()`). `desde`/`hasta` por defecto: lunes a domingo de la semana actual. Se respeta el alcance por zona del perfil como lo hace `fertirriego_analisis` (reutilizar su filtro; no inventar otro).
- `tarjetas.trasplante` = `trasplante.avance_ut(temporada_id)` resumido (área planificada, sembrada, % de avance); `tarjetas.polinizacion` = `trasplante.polinizacion(temporada_id)` filtrada a las semanas del rango (colmenas plan, entrada, salida por semana).
- Handler `api_planificador_plan_vs_hecho` lee `desde`, `hasta`, `zona` del query string; fechas inválidas → 400 con mensaje en español.

- [ ] **Paso 1: Escribir la prueba** del servicio con las tres fuentes sustituidas por datos sintéticos (inyectadas por parámetro o `monkeypatch` simple): un turno con 1 línea de fertilización hecha, 1 de fito no hecha vencida, 1 de inyección, 1 extra de fertilización → `resumen == {"hecho":1,"no_hecho":1,"sin_registro":1,"extra":1,"parcial":0,"pendiente":0}`; rango por defecto = semana actual; `desde > hasta` lanza `ValueError`.
- [ ] **Paso 2: Implementar** servicio y ruta. **Paso 3: Commit** `feat(planificador): servicio y endpoint plan-vs-hecho`

### Tarea 5: T-code, permisos y menú

**Archivos:** Modificar `backend/catalogos.py` (lista de transacciones ~línea 700: `("/PL01", "Planificador · Plan contra hecho", "torre-control/planificador")`), `backend/menu.py` (`_enlace("planificador", "Planificador", "/PL01", "torre-control/planificador", "calendario")` en Torre Control, junto a los de Riego), `backend/seguridad.py` (submódulo `{"clave": "planificador", "titulo": "Planificador", "tcode": "/PL01"}`), `frontend/js/ui/iconosMenu.js` (`"/PL01": "calendario"`; si el icono no existe, usar el de `"/TR02"`).

- [ ] **Paso 1: Verificar** cómo `menu_schema.json` (datos del usuario, no tocar) convive con `menu.py`: si la pantalla nueva no aparece sola en el menú de un usuario existente, anotarlo en el informe final para que el usuario la coloque con `/SE02` (Diseñador de menú). **Paso 2: Aplicar los cambios** de arriba (`catalogos.py` solo con Edit). **Paso 3: Commit** `feat(planificador): T-code /PL01, permisos y menú`

### Tarea 6: Vista «Plan contra hecho»

**Archivos:** Crear `frontend/js/services/planificador.js` (`async function planVsHecho({desde, hasta, zona})`, con el patrón de `services/` existentes), `frontend/js/views/planificador.js` (`export async function montar(seccion)`), `frontend/css/planificador.css`; Modificar `frontend/js/app.js` (import y entrada en `RUTAS` `"torre-control/planificador"` con `permiso:"leer"`, `submodulo:"planificador"`, `tcode:"/PL01"`, `canales:["turnos_transaccionales","fertirriego","ordenes_sap_salidas","trasplante_transaccional","ltp_insumos"]`, `migas:["Torre Control","Planificador"]`), `frontend/index.html` (`<link rel="stylesheet" href="css/planificador.css">` y `<section data-vista="torre-control/planificador" class="vista-completa" hidden><div data-contenido></div></section>`).

**Comportamiento (copiar el patrón de `views/trasplante.js`/`turnosRiego.js` para cabecera, selector de temporada global y `DataGrid`):**
- Cabecera: título «Planificador · Plan contra hecho», selector de semana (lunes–domingo, botones «‹ Semana anterior» / «Hoy» / «Semana siguiente ›») y filtro de zona.
- Franja de tarjetas: conteo por estado (Hecho, Parcial, No hecho, Pendiente, Extra, Sin registro) con los colores/insignias del proyecto (`Insignia`), más las tarjetas de Trasplante (mz sembradas / planificadas, %) y Polinización (colmenas de la semana).
- `DataGrid` (una fila por línea): Zona, Encargado, Turno, Actividad (tipo legible), DDT, Fecha plan, Fecha real, Días de diferencia, Estado, Productos (n). **Agrupado por Encargado → Turno** por defecto; fila expandible con la tabla Producto · Plan · Real (patrón de la fila expandible de Siembra Diaria). Exportar a Excel con las columnas visibles.
- Estados con etiqueta y color: Hecho (verde), Parcial (ámbar), No hecho (rojo), Pendiente (gris), Extra (azul), «Sin registro (aún no hay módulo)» (gris claro). Lista aparte, plegable, «Turnos sin plan» con su motivo, y avisos del servicio.
- Cargando/errores como el resto de vistas; sin datos: mensaje «No hay actividades planificadas en estas fechas».

- [ ] **Paso 1: Escribir `pruebas/prueba_planificador_vista.mjs`** (Node, como `prueba_cubo_fertirriego.mjs`) para la función pura de la vista que arma las filas del grid desde la respuesta del servicio (`filasGrid(respuesta)`), exportada del módulo de la vista o de un `utils/planificador.js` si la vista importa DOM: etiquetas de estado, orden por encargado/turno/fecha, `dias_dif` formateado («+2 d», «0 d», «−1 d»). 
- [ ] **Paso 2: Implementar** servicio, vista, css y registros. **Paso 3: Commit** `feat(planificador): vista Plan contra hecho (/PL01)`

### Tarea 7: Documentación

**Archivos:** Modificar `proyecto-seguimiento.md` (ambas copias) §4 (punto 0d → «Bloque 1 hecho, en QA»), `docs/superpowers/specs/2026-11-21-planificador-actividades-campo-design.md` (marcar «Aprobado 2026-11-21» y el estado del Bloque 1).
- [ ] **Paso 1:** actualizar ambos. **Paso 2: Commit** `docs: planificador bloque 1`

### Tarea 8: QA única de Opus (tope 25 minutos)

- [ ] **Paso 1 (Opus, solo Opus):** ejecutar `pruebas/prueba_plan_vs_hecho.py`, `prueba_planificador_fuentes.py`, `prueba_planificador_servicio.py` y `node --test pruebas/prueba_planificador_vista.mjs`; salida esperada: todo PASA.
- [ ] **Paso 2 (Opus):** QA con clics en copia aislada (receta `proyecto-seguimiento.md` §5 «QA de AGL»; puerto 5094–5097; Edge sin ventana a 1536×695, `deviceScaleFactor` 1.25): abrir `#/torre-control/planificador`; la semana actual carga sin errores de consola; cambiar de semana con los tres botones; filtrar por zona; expandir una fila y ver Producto/Plan/Real; exportar a Excel; agrupar por Encargado → Turno; ver «Turnos sin plan»; sin franja en blanco ni menús fuera de la ventana. Con datos reales de solo lectura (copia de `data` de desarrollo) comprobar que un turno con aplicaciones registradas de Fertirriego sale `hecho` o `parcial` y que ninguna salida SAP T500–T503 queda sin turno sin aviso.
- [ ] **Paso 3:** Opus devuelve PASA/FALLA con archivo:línea; se corrige y solo se repite lo que falló. Limpieza obligatoria (servidor, navegador, copia, credenciales temporales).
- [ ] **Paso 4:** informe al usuario en español: qué se ve, qué falta (Mecanización, programación), y que debe publicar con `Publicar_Produccion.bat` y, si el menú no lo muestra, ubicarla con `/SE02`.

## Autorrevisión
- Cobertura de la spec: §2 tabla de fuentes (Tareas 2–3; Inyección/Drench/Preparación quedan «sin registro», Mecanización fuera por decisión); §3 nivel 1 y vista del plan (Tareas 2, 4, 6); §5 emparejamiento automático, DDT exacto, extra, estados (Tarea 1); §7 revisión por responsable (agrupado por Encargado, tarjetas Trasplante/Polinización); §13–15 datos reales del LTP y escala 125 % (restricciones globales, Tarea 8).
- Tipos y nombres consistentes entre tareas: `tipo_de`, `emparejar`, `plan_de_turnos`, `hechos_fertirriego`, `hechos_sap_fito`, `plan_vs_hecho`, `filasGrid`.
- Proporción: ocho tareas pequeñas; cada una deja algo comprobable y la prueba se ejecuta una sola vez.
