# BITÁCORA — AgroNotificaciones

> **Esto es la memoria del proyecto.** Antes de cada intervención importante
> hay que leerla; después de cada una, hay que anotarla aquí. Si una decisión
> no está escrita en este archivo, la siguiente sesión no la conoce.
>
> Documentos hermanos: `ARQUITECTURA.md` (el diseño original de la
> migración), `CLAUDE.md` (las reglas de trabajo), `DESPLIEGUE.md` (cómo
> sube a producción).

---

## 1. Propósito del sistema

AgroNotificaciones sustituye la aplicación de AppSheet + Google Sheets con
la que **Agrolíbano** controla su maquinaria agrícola y la liquidación de
labores en SAP. Es 100 % responsive y mobile-first: casi toda la captura
ocurre desde el teléfono, en campo.

**El flujo central son tres niveles encadenados:**

```
TICKET  ──< HORÓMETRO ──< REGISTRO (labor) ──< DETALLE (lote)
  │            │               │                   │
 día de     lectura del     qué labor y        en qué lote
 trabajo    equipo, turno   qué tarea SAP      y cuántas horas
```

Un ticket recorre cuatro pasos de proceso, y cada paso cierra puertas:

| # | Proceso | Qué significa |
|---|---------|---------------|
| 0 | Registrado | Se está capturando. Todo abierto. |
| 1 | Revisando | Torre de Control lo está revisando. |
| 2 | Pendiente aprobación | Revisión dada por buena. |
| 3 | **Notificado** | Ya se liquidó en SAP. **Sólo lectura para todos**, sin excepción ni casilla que lo abra. |

Alrededor de ese flujo hay módulos de apoyo: trasplante y plan de siembra,
turnos de riego, rotación de cultivos, telecomunicaciones (líneas, equipos
y asignaciones), costos y tarifas, y los catálogos de campo.

**Reglas que nunca se negocian**

- Toda fecha y hora se procesa en **UTC-6 (America/Tegucigalpa)**.
- Cero dependencias de terceros para Excel, PDF y gráficos: el proyecto
  escribe su propio `.xlsx` (`lib/hojas.ts`), su propio PDF
  (`lib/pdf/documento.ts`) y dibuja los gráficos en SVG a mano.
- La seguridad se valida **en RLS**, no en el navegador.
- **Ningún nombre de rol escrito a mano** en el código, ni frontend ni
  backend. Todo pasa por la matriz de permisos de la base.

---

## 2. Arquitectura de permisos (ABAC)

Desde la migración 53 el permiso dejó de ser «está o no está la fila» y
pasó a ser una **tríada**. Cada cruce (Rol × Pantalla × Acción) guarda
tres columnas en `public.permisos`:

### 2.1 La tríada

| Eje | Columna | Valores | Qué decide |
|-----|---------|---------|------------|
| **Acción** | `permitido` | `true` / `false` | Si la casilla está encendida. Apagarla **no borra la fila**: conserva los otros dos ejes para cuando se vuelva a encender. |
| **Alcance** | `alcance` | `global` · `zonal` · `propietario` | **Sobre qué filas.** Global = toda la empresa, sin recorte. Zonal = las zonas asignadas al usuario, más lo que capturó él (sin zonas asignadas equivale a global). Propietario = únicamente lo que capturó él. |
| **Condición** | `condicion` | `sin_restriccion` · `solo_abiertos_registrando` | **Bajo qué estado del ticket.** La segunda sólo deja escribir con el ticket abierto y todavía en «0. Registrado». Sólo aplica a acciones que escriben: en las de lectura la base la ignora. |

Se configura en `/admin/permisos`. Cada celda abre un panel con los tres
ejes (`components/admin/CeldaPermiso.tsx`), y se guarda con
`fn_guardar_permiso`, que lleva dentro las dos reglas de arrastre: apagar
**Ver** apaga lo demás de esa pantalla, y encender cualquier acción
enciende **Ver** con su mismo alcance.

### 2.2 Las funciones

```
fn_permiso_de(pantalla, accion)   → (permitido, alcance, condicion)
fn_permitido_de(pantalla, accion) → boolean     ← se resuelve 1 vez por consulta
fn_mi_alcance(pantalla, accion)   → text        ← se resuelve 1 vez por consulta
fn_verificar_permiso(pantalla, accion, dueño, zona, abierto, nivel) → boolean
```

`fn_verificar_permiso` evalúa los tres ejes contra un registro concreto.
Un parámetro **nulo** quiere decir «este registro no tiene ese atributo»,
y entonces ese eje no recorta: preguntar con los cuatro nulos contesta la
pregunta de pantalla («¿podría llegar a hacerlo?»), que es lo que
necesita un menú para decidir si enseña un botón.

### 2.3 El Administrador y el Invitado

Dos roles no se rigen por la matriz sino por **una bandera en la tabla
`roles`** (migración 54):

- `roles.acceso_total` → `fn_es_admin()`. Llave maestra: pasa por encima
  de todo. Un guardia de sentencia impide dejar la instalación sin
  ninguno, porque entonces nadie podría volver a entrar a Permisos.
- `roles.solo_lectura` → `fn_es_invitado()`. Mira y exporta, nunca
  escribe, marquen lo que marquen en la matriz.

Antes esto eran los literales `= 'ADMIN'` y `= 'INVITADO'` escritos
dentro de las funciones y repetidos en el navegador. Ahora es una
propiedad del rol: **renombrar el rol ya no cambia nada**, y esos dos
roles no aparecen en la matriz porque su regla está por encima de ella.

### 2.4 La forma canónica de una policy de lectura

Desde la migración 55 todas las policies de SELECT se escriben igual, y
el orden importa por rendimiento:

```sql
(select public.fn_permitido_de(PANTALLA, 'ver'))      -- ← una vez por consulta
and case (select public.fn_mi_alcance(PANTALLA, 'ver')) -- ← una vez por consulta
    when 'global'      then true
    when 'propietario' then DUEÑO = (select auth.uid())
    else                    DUEÑO = (select auth.uid()) or VE_LA_ZONA(fila)
end
```

Las dos primeras líneas sólo reciben constantes, así que Postgres las
convierte en **InitPlan** y las evalúa una sola vez. La parte de fila
queda como predicados sobre columnas. El recorte por zona **sólo entra
cuando el alcance es zonal** — ésa es toda la diferencia entre que
«Global» funcione y que no.

**Regla para quien escriba una policy nueva:** nunca poner
`select ... from public.tickets where id = ...` en línea dentro de una
policy. Eso vuelve a aplicar el RLS de `tickets` entero, por cada fila.
Hay que usar una función `security definer` (`fn_dueno_ticket`,
`fn_dueno_registro`, `fn_dueno_detalle`).

### 2.5 El patrón `SECURITY DEFINER` de las vistas (migración 56)

**La regla de negocio:** cada pantalla se rige EXCLUSIVAMENTE por su
propia fila en la matriz. Si Labores dice Global, Labores enseña todo,
aunque los datos cuelguen de un ticket que ese rol no podría abrir.

**Por qué hizo falta.** Una pantalla casi nunca lee una sola tabla.
`/labores` lee `v_labores_control`, que une `registro_detalle` con
`registros`, `horometros`, `tickets` y `lotes_temporada`. Con la vista en
`security_invoker = on` **cada una de esas tablas aplicaba su propio
RLS**, y el resultado era la intersección de todas. Un rol con «Labores:
Global» y «Tickets: Propietario» —que es lo normal, un digitador no
gestiona tickets ajenos— no veía nada: la unión con `tickets` tiraba las
filas antes de que nadie mirara el permiso de Labores. Un recorte que el
Administrador no había pedido y que no podía quitar desde ninguna
casilla, porque la casilla que mandaba era la de otro módulo.

**La forma.** Cada vista de módulo se parte en dos:

```
interno.v_x_crudo   security_invoker = off  → corre como su dueño, NO
                    aplica el RLS de abajo. La unión completa.

public.v_x          select * from interno.v_x_crudo
                    where <reja de SU pantalla>
                    También definer, que es lo que le permite leer la
                    cruda. Es la única que se concede.
```

No se quita un control: **se sustituye por el que corresponde.** La reja
es la misma forma canónica de §2.4.

**Lo más importante: la cruda vive en el esquema `interno`.** El primer
intento las dejó en `public` con un `revoke`, y no sirve: un
`grant select on all tables in schema public to authenticated` —que es
lo que Supabase corre por omisión, y lo que corre cualquiera que repare
permisos a mano— se lo devuelve todo, y entonces la vista que se salta el
RLS queda a un `select` de cualquiera. La prueba lo encontró. En
`interno`, al que `authenticated` no tiene ni `usage`, el permiso no se
concede y se revoca: no existe.

**Qué NO cambia:** las tablas conservan su RLS intacto, así que una
consulta directa a una tabla sigue recortando igual, y **ninguna
escritura pasa por las vistas** — insertar, editar y borrar siguen yendo
por las policies de siempre.

La 56 dejó `telecom` fuera del patrón porque sus tablas no cuelgan de
ninguna tabla padre con permiso propio y allí nunca hubo
estrangulamiento. La **57 lo mete igual**: desde que sus pantallas
esconden botones por fila, sus vistas tienen que traer el dueño y
regirse por su propia casilla como las demás.

**Reglas para quien añada una vista de módulo:**

1. La cruda va en `interno`, nunca en `public`.
2. La expuesta SIEMPRE lleva `fn_permitido_de('<su pantalla>','ver')`.
3. Se añade a la lista del bucle de la migración 56, no se escribe la
   reja a mano: trece rejas escritas a mano acaban siendo trece rejas
   ligeramente distintas, y la que esté mal no la ve nadie.
4. El guardián de la 56 revienta la migración si alguna cruda se queda en
   `public`, si alguien puede entrar a `interno`, o si una expuesta queda
   sin reja.

### 2.6 Los catálogos, por bloque

Desde la 58 no hay una casilla «Catálogos»: hay cinco, una por bloque
(`catalogo_equipos`, `catalogo_labores`, `catalogo_cultivos`,
`catalogo_sap`, `catalogo_organizacion`). Son los mismos bloques con los
que `lib/catalogos/grupos.ts` agrupa el menú, y es el campo `pantalla` de
cada `GrupoDeclarado` el que los une: el menú sólo enseña los bloques en
los que la persona tiene «Ver», y la base aplica esa misma casilla sobre
las tablas de ese bloque.

**Regla para quien agregue un catálogo:** se declara en `GRUPOS` dentro
de su bloque, y su policy pregunta por la pantalla de ESE bloque. Si no
se declara, cae en «Otros catálogos» y queda sin gobernar — un dato
maestro invisible es peor que uno mal colocado, pero uno sin casilla es
peor que los dos.

### 2.7 La misma regla en el navegador

`lib/permisos/clientABAC.ts` → `canExecuteAction(reglas, pantalla,
accion, fila, contexto)` es el reflejo exacto de `fn_verificar_permiso`,
para que la pantalla esconda lo mismo que Postgres rechaza. Evalúa los
tres ejes en el mismo orden, más el tope de NOTIFICADO.

`undefined` en un atributo de la fila quiere decir «esta fila no tiene
ese atributo», y ese eje no recorta — igual que un parámetro nulo en la
base. Por eso `canExecuteAction(reglas, p, a)` **sin fila** contesta la
pregunta de pantalla («¿podría llegar a hacerlo?»), que es la que decide
si se dibuja el botón «Nuevo».

Lo que el navegador NO puede comprobar es el recorte zonal de una fila
cuya zona la vista no expone. En ese caso el eje zonal no recorta en la
pantalla y **la base sigue mandando**: el navegador nunca concede nada,
sólo esconde.

**Está verificado contra la base, no «por parecido»:** las 480
combinaciones de (alcance × condición × acción × dueño × proceso ×
estado) se generan en el navegador y en Postgres y se comparan una por
una. Cero diferencias. Si alguien toca una de las dos, esa prueba lo
dice.

---

## 3. Registro de cambios

### 2026-10-28 — Reporte de Emplasticado gemelo del de Trasplante (identidad Agrolíbano, sin migración)

- **`/plan/[proceso]/reporte`** rediseñado sin tocar cálculos, RPC ni SQL: membrete institucional (banda Verde Agrícola, empresa en Azul Marino serif, línea marino), secciones como tarjetas numeradas. Se retiró el azul #1f3864 del Excel viejo.
  1. **Estadísticas globales** en tarjetas: KPI Plan / Ejecutado / Pendiente (naranja si falta) / % Avance con barra semáforo; la antigua sección «Avance por etapa» pasa a tarjetas por etapa (Plan, Ejecutado, Pendiente, % con píldora semáforo).
  2. Avance diario · 3. Zona y encargado · 4. Lotes ejecutados: `thead` Verde Agrícola, cebra #FAFAFA, bordes #E2E8F0, subtotales #F4F6F8, total con línea verde, % con semáforo (≥100 lima, 80–99 sol, <80 naranja).
  - Botón «Ver» primario verde; «Volver a hoy» secundario contorneado; «reporte retroactivo» en naranja.
- **PDF** (Imprimir → Guardar como PDF, el mismo camino que Trasplante; este reporte no tiene generador nativo): misma hoja de impresión (carta horizontal, márgenes 15 mm, títulos de columna repetidos, filas sin partir, colores exactos) y pie con ondas lima / turquesa #00A99D / naranja.
- **Nuevo `src/components/reporte/Corporativo.tsx`**: Membrete, Bloque, Titulo, Kpi, Dato, Barra, Encabezado, TotalGeneral, PieOndas, clases de fila/subtotal e `IMPRESION_REPORTE`. Son las formas del reporte de Trasplante, para que cualquier reporte futuro salga gemelo.

### 2026-10-27 — Cuadrícula estilo Excel: seleccionar ≠ editar, y key vacía del selector (sin migración)

- **`DataGrid` / `Celda`:** un clic sólo SELECCIONA la celda (foco, rango, copiar/pegar); ya no abre inputs ni el panel de `SelectorCelda`. Se edita con **doble clic, Enter o F2**, o escribiendo encima (en texto/número el carácter reemplaza el valor). Enter guarda y vuelve a la selección; Escape cancela; salir del campo guarda (el `<select>` nativo sale al perder el foco; el panel con buscador sale al elegir o al cerrarse vía `onCerrar`). Supr/Retroceso vacía la celda. Flechas mueven entre celdas editables. Ctrl+V de un valor suelto sobre una celda seleccionada la reemplaza; dentro de un campo en edición, pegado nativo. Arrastrar y Mayús+clic ya no roban el foco.
- **`Selector.tsx` (`PanelOpciones`):** `key={`${valor}-${i}`}` — la opción vacía del catálogo duplicaba `key=""` y React rompía («two children with the same key»). Mismo blindaje en las `<option>` de `SelectorCelda`, que además expone `onCerrar`.

### 2026-10-27 — Portapapeles SAP/Excel en la cuadrícula y envío por Outlook (sin migración)

**Cuadrícula (`DataGrid`), genérico para toda tabla de captura.** Lógica pura en `src/lib/grid/portapapeles.ts` (`parsearTsv` con comillas de Excel y CRLF, `aTsv`, `numeroPegado` «1.234,56»/«1,234.56»/«150,00-», `fechaPegada` «27.10.2026»/«27/10/2026», `valorPegado` por editor —número, fecha, selección por valor/etiqueta/código—, `planearPegado`).
- Clic = celda activa; Mayús+clic o arrastrar = rango (resaltado verde). El rango se reinicia al cambiar filtros/orden/búsqueda.
- **Ctrl+V** de varias celdas (TSV) reparte desde la celda activa hacia la derecha y abajo y guarda celda a celda, en orden, por `onEditarCelda` (mismas validaciones y RLS que a mano). Las columnas de sólo lectura no desplazan lo pegado; valores no admitidos se saltan. Aviso con pegadas / rechazadas / sólo lectura / no válidas. Un valor suelto se pega normal dentro del campo (edición in situ y selectores intactos); sobre un rango marcado lo rellena.
- **Ctrl+C** con rango (o con filas marcadas y sin texto elegido) copia TSV; números crudos, catálogos con su etiqueta. Con texto seleccionado dentro de un campo, copiado nativo.
- Barra de selección: botón «Copiar (SAP/Excel)» (`navigator.clipboard.writeText`, con encabezados).

**Reporte de trasplante → Outlook.** `src/lib/trasplante/correo.ts` arma HTML compatible con Outlook (tablas, estilos en línea, `bgcolor`, hex del UI Kit): membrete, Estadísticas globales (KPI + semáforo por ciclo) y Avance diario (Dif con ▲/▼, «Sin siembra»/«Fuera de plan», subtotales, total del rango; tope 400 filas con aviso). `BotonOutlook` (secundario, junto a «Imprimir o guardar PDF») copia `text/html` + `text/plain` con `ClipboardItem` (respaldo por selección + `execCommand`), abre `mailto:?subject=Reporte Gerencial Trasplante - <fecha>` y muestra «Plantilla copiada. Presiona Ctrl+V en tu correo para pegar el reporte.»

### 2026-10-27 — Cruce maestro del avance diario e identidad visual Agrolíbano (migración 82)

**Base (`82_trasplante_cruce_diario.sql`).** `interno.v_trasplante_avance_diario_crudo`
= siembras agrupadas FULL OUTER JOIN plan agrupado por (temporada, fecha,
ciclo, lote, variedad). Sembrado sin plan → `mz_plan` nulo (origen `real`);
plan sin siembra → `mz_real` nulo (origen `plan`); ambos → `ambos`.
`diferencia` = real − plan (nulos como 0). El plan sin fecha no entra. Expuesta
`v_trasplante_avance_diario` con reja de `trasplante_diario`: global todo,
zonal por lote estricto, propietario por `usuarios` (uuid[] de quienes
capturaron; las filas sólo-plan no tienen dueño). Índices
`siembras(temporada_id, fecha_siembra)` y `planes_siembra(temporada_id,
fecha_siembra)`. Guardianes; corrida dos veces contra PG 16 (real+plan,
sólo plan y sólo real salen en filas propias).

**Reporte, sección 2.** Lee el cruce (`leerAvanceDiario`), no `v_siembras`.
Una fila por lote/variedad del día; columnas Mz real, Mz plan y **Dif real
vs plan** con flecha ▼ (naranja, por debajo) / ▲ (verde vibrante, por
encima); marcas «Sin siembra» y «Fuera de plan»; subtotales por día; cebra
`#FAFAFA`. Ya no hay «Lote plan» en la misma celda.

**Identidad visual (guía de Grupo Agrolíbano / Montelíbano).**

- `globals.css`: rampas `turquesa` (#00A99D) y `sol` (#FFD100); **`sky` y
  `blue` remapeadas a turquesa** (no queda azul genérico en la app); fondo
  #F4F6F8; bordes `slate-200` = #E2E8F0; `--font-display` (Merriweather /
  Playfair) y Montserrat al frente de `--font-sans` — SIN descargar de Google
  Fonts (el `build` falla en redes que lo bloquean; se usan si el equipo las
  tiene instaladas).
- `Primitivos`: botón secundario = blanco, borde y texto Verde Agrícola;
  variante nueva **`alerta`** (Naranja Atardecer, texto blanco), que usa
  «Guardar con exceso» de riego.
- Semáforo de la guía (`semaforo`/`COLOR_SEMAFORO` en `formato.ts`): ≥100 %
  verde vibrante, 80–99 % amarillo sol, <80 % naranja. Lo usan `Porcentaje` y
  las barras del reporte. `SERIES_GRAFICO` con el orden de la guía; el
  gráfico semanal: real en verde vibrante, plan en naranja.
- Reporte (pantalla y papel): membrete con banda Verde Agrícola, empresa en
  Azul Marino con serif de titulares, línea marino de separación, `thead` en
  Verde Agrícola, tarjetas con radio 12 px y borde #E2E8F0, pie con las tres
  ondas (verde vibrante, turquesa, naranja). Márgenes de impresión 15 mm.
- PDF nativo (`lib/pdf/documento.ts`): `PALETA` con los HEX exactos y `rgb()`.
  `informePdf` (desinfección): banda verde + línea marino, bordes #E2E8F0,
  desviaciones en naranja/verde, pie con línea marino y las tres franjas de
  marca. `themeColor` del navegador = #165C27.
- Logos: no hay archivos de logo de Agrolíbano/Montelíbano en el repositorio;
  el membrete los deja fuera hasta que se agreguen a `public/marca/`.

### 2026-10-27 — Hotfix riego: el exceso de área se confirma, no se prohíbe (migración 81)

**Por qué.** El tope de la 80 (mayor de sembrado y plan del ciclo) era duro, y
en campo se riegan lotes antes de capturar su plan o su siembra: el modal no
dejaba guardar trabajo real.

**Base (`81_riego_exceso_forzado.sql`).** `turnos_riego_detalle` gana
`forzar_exceso`, `exceso_mz`, `forzado_por` y `forzado_en`. El disparador
`fn_validar_area_turno` sigue en la base con el mismo tope por ciclo: si la
línea excede y llega con `forzar_exceso = true`, la acepta y escribe cuánto
excedió, quién (la sesión) y cuándo; si excede sin la bandera, rechaza como
antes; si NO excede, apaga la bandera y limpia la auditoría (un «forzado» que
no forzó nada no se registra). `fn_guardar_turno_riego` lee `forzar_exceso` de
cada lote del JSON. Probado contra PG 16: sin bandera rechaza, con bandera
acepta con `exceso_mz` y la línea que no excede queda sin marca.

**Pantalla.** `TurnoRiegoModal`: con lotes por encima del tope aparece el
banner rojo con el detalle (área, libre, tope, exceso) y la casilla
«Confirmo el exceso»; el botón pasa a **«Guardar con exceso»** (variante de
peligro) y sólo se habilita confirmado. La confirmación vale para ESOS
excesos: cambiar un área o un lote la vuelve a pedir. `validarLineas` acepta
`permitirExceso`, `lotesExcedidos` nuevo, `lineasParaGuardar` y
`guardarTurno` llevan la bandera.

**Límites.** El editor en celda (`fn_editar_turno_riego`) no envía la
bandera: desde la celda el tope sigue duro, salvo en una línea ya forzada. El
importador de turnos tampoco la envía.

### 2026-10-27 — Lote planificado contra real, paleta corporativa y tope de riego por ciclo (migración 80)

**Base (`80_lote_plan_en_reporte_y_tope_de_riego.sql`).**

- `v_siembras` gana **`plan_lotes`**: nomenclatura de los lotes que el plan
  programó para esa misma fecha y ciclo (string_agg sobre texto). No se
  llamó `plan_lote` porque ese nombre ya existe desde la 26 y es NUMÉRICO
  (mz del plan del lote; lo leen la cuadrícula y el % de cumplimiento).
  Envoltura por `pg_get_viewdef` y reja de la 66, como en la 79.
- **Bug de riego**: `fn_validar_area_turno` (40) comparaba contra el área de
  TODOS los ciclos del lote y sumaba lo asignado en turnos de TODOS los
  ciclos, mientras el modal mostraba el saldo del ciclo (68). Un turno de
  ciclo 2 sobre un lote regado en el ciclo 1 se rechazaba con cualquier
  área. Ahora todo es del ciclo del turno.
- **Tope de riego** = el MAYOR de lo sembrado y lo planificado en el ciclo; el
  área neta si los dos son cero (`fn_tope_riego_lote_ciclo`). Plan 0 y 3 mz
  sembradas → tope 3 (antes, según el caso, 0 o el área de otro ciclo).
  `fn_area_lote_ciclo` NO se tocó: la desinfección reparte la dosis con ella.
- `fn_lotes_regables`: usa el tope nuevo, trae todos los lotes AGRÍCOLAS
  activos de la zona con o sin plan, y el recorte por zona sólo aplica con
  alcance ZONAL (con «propietario» el selector salía vacío).
- Guardianes; corrida dos veces contra PG 16 (incluye el rechazo correcto en
  el mismo ciclo y la aceptación en otro).

**Riego (pantalla).** El modal muestra el error de `fn_lotes_regables` en vez
de un selector vacío mudo, avisa cuando la zona no tiene lotes y explica la
regla del tope.

**Identidad visual Agrolíbano.** `globals.css`: `brand` = Verde Agrícola
#165C27 (700), nuevas rampas `lima` (#8CC63F), `naranja` (#F37021) y
`marino` (#1A2530); `amber` pasa a ser el naranja corporativo (todas las
advertencias y desfases) y `slate-900`/texto base, el azul marino. Botones,
layout y barras toman la paleta sin tocar pantallas. Modo oscuro ajustado.

**Reporte de trasplante.** `CORP` en `formato.ts` (y `AZUL` = verde
agrícola). Cabeceras verdes, nombre de empresa en marino, tarjetas con
acento (KPI con borde superior, ciclos en lima, zonas en verde), barras
verde/lima/naranja, gráfico semanal con lo real en verde vibrante y atrasos
en naranja. Avance diario: **Lote real** (UT + nombre) contra **Lote plan**
(`plan_lotes`), resaltado en naranja si el lote sembrado no estaba en el
plan de ese día; se quitó «Variedad plan».

### 2026-10-27 — Hotfix de EMERGENCIA: rollback del login al estándar

**Síntoma.** «Ingresando…» colgado; la red mostraba un fetch `?_rsc=` que
tardaba ~10 s y devolvía 307 a `/login?sesion=expirada`.

**Causa.** La navegación suave de Next (`router.replace` + `refresh`) manda
un fetch RSC que pasa por el middleware. Si `getUser` tardaba o fallaba por
red, la regla «cookie que no da usuario = cookie inútil» (69) borraba la
cookie RECIÉN escrita y redirigía a `/login?sesion=expirada`. El sondeo de
cookies del hotfix 3 sólo alargaba la espera.

**Rollback.**

- `FormularioLogin`: `signInWithPassword` y, si sale bien,
  `window.location.href = '/'` (carga completa). Sin `router.*`, sin sondeo,
  sin limpieza previa. Todo error libera el botón y se muestra.
- `middleware.ts`: patrón estándar de `@supabase/ssr`. `getUser()` con
  usuario → avanza (en `/login` → `/`); sin usuario → `/login` sin
  parámetros. Fuera: refresco anticipado, cortafuegos por `?sesion=expirada`
  y borrado de cookies «inútiles». Única excepción: un código EXPLÍCITO de
  sesión muerta de Supabase borra la cookie al redirigir. Un corte de red no
  toca cookies.

### 2026-10-27 — Hotfix 3: login a prueba de carreras

- `FormularioLogin`: vuelve a la navegación de Next (`router.replace('/')` +
  `router.refresh()`), pero sólo después de comprobar que la sesión está
  ASENTADA: `getSession()` la devuelve y existe la cookie
  `sb-…-auth-token(.n)` (hasta ~2 s, pasos de 100 ms). Si no aparece, lo
  dice («el navegador no guardó la sesión: revisa las cookies») en vez de
  quedarse quieto. Credenciales malas, errores de Supabase y de red tienen
  cada uno su mensaje: el login ya no puede fallar en silencio. Doble
  clic bloqueado. Al llegar por `?sesion=expirada` se limpia la sesión local
  y se quita el parámetro de la dirección (`history.replaceState`), para
  que ninguna recarga posterior vuelva a pasar por el cortafuegos.
- `GuardiaSesion`: además de exigir que la página haya tenido sesión, ante
  un `SIGNED_OUT` espera 800 ms y vuelve a preguntar (`getSession`, fuera del
  callback de Supabase, que se bloquea si se le llama dentro). Sólo expulsa
  si de verdad no hay sesión: un evento fantasma ya no saca a nadie.
- Reporte de trasplante: las sub-tarjetas por ciclo de «1. Estadísticas
  globales» ya no muestran Plantas ni Plantas/mz (quedan Plan, Sembrado,
  Pendiente y Lotes). La sección 1 queda sin conteo de plantas.

### 2026-10-27 — Hotfix 2: el login que no entraba

**Causa.** El hotfix anterior añadió al middleware un refresco ANTICIPADO:
`refreshSession()` si al token le quedaban menos de 10 minutos. Justo
después de entrar, el navegador dispara varias peticiones a la vez
(`router.push('/')`, `router.refresh()` y los prefetch de la barra). Cada
una pasaba por el middleware y, con el token dentro de esa ventana —**siempre**
si el proyecto de Supabase tiene la caducidad del JWT en 10 minutos o
menos—, cada una refrescaba con el MISMO token de refresco. Supabase
aceptaba una, contestaba `refresh_token_already_used` a las demás y revocaba
la sesión entera; el middleware lo leía como sesión muerta, borraba las
cookies y devolvía al login. Desde fuera: «Ingresar» no hace nada.

Agravante cuando se llegaba por `/login?sesion=expirada`: `router.refresh()`
re-pedía ESA dirección y el cortafuegos borraba las cookies recién creadas.

**Corrección.**

- Middleware: fuera el refresco anticipado; vuelve al patrón de
  `@supabase/ssr` (sólo `getUser`, que refresca una vez cuando hace falta).
  El cortafuegos de `/login?sesion=expirada` sólo actúa en la carga del
  documento (no en RSC `rsc`, `next-router-prefetch` ni `next-action`).
- `FormularioLogin`: espera la limpieza local antes de `signInWithPassword`,
  exige `data.session` y entra con `window.location.replace('/')` (carga
  completa) en vez de `router.push` + `router.refresh`.
- `GuardiaSesion`: sólo saca al login si ESA página llegó a tener sesión.
- `server.ts`: se quita la opción `auth` redundante (`@supabase/ssr` ya la
  fija).
- Se conservan: validación de fechas de calendario, `esSesionMuerta` por
  mensaje, salida voluntaria.

**Reporte de trasplante:** fuera «Plantas» y «Plantas / mz» de las tarjetas
superiores de Estadísticas globales.

### 2026-10-27 — Hotfix: fechas del reporte de trasplante y la sesión zombi

**Fechas.** Las cinco funciones del reporte (`fn_trasplante_*`) y
`v_siembras` (79) aceptan un `hasta` futuro sin problema: devuelven vacío o
ceros, no hay división ni calendario que reviente. El fallo de fechas real
estaba en la validación: `esFechaIso` sólo miraba la FORMA (`\d{4}-\d{2}-\d{2}`),
así que «2026-11-31» pasaba, JavaScript lo leía como 1-dic y Postgres lo
rechazaba (`date/time field value out of range`) en las cinco consultas a la
vez. Ahora exige un día que exista (ida y vuelta por `Date`) y año 1900–2200.
`fechaLarga`/`fechaCorta` devuelven el texto si la fecha no se puede leer, y el
reporte enseña el error real en vez de «faltan migraciones».

**Sesión zombi** (`refresh_token_not_found` + bucle en el login):

1. **El refresco ocurría en un Server Component.** El middleware sólo
   refrescaba si el token ya estaba por caducar (~90 s). Un render largo —el
   reporte hace cinco RPC y lee siembras por tramos— cruzaba esa ventana y
   el cliente de servidor refrescaba: Supabase rotaba el token de refresco
   pero el Server Component no puede escribir cookies, y el navegador se
   quedaba con el viejo, ya quemado. Ahora el middleware refresca con **10
   min de margen** (`MARGEN_REFRESCO_MS`) y el cliente de servidor lleva
   `autoRefreshToken: false`.
2. **El bucle.** En `/login?sesion=expirada` el middleware ya no pregunta
   nada: borra todas las `sb-*` y pinta el formulario (antes un token de
   acceso aún vivo rebotaba a «/», y «/» devolvía al login).
3. **La resurrección.** Tras una navegación de cliente, el cliente del
   NAVEGADOR seguía con la sesión muerta en memoria y la volvía a escribir
   en la cookie. El login hace `signOut({ scope: 'local' })` al llegar por
   expiración, y `GuardiaSesion` (en el layout) manda con carga COMPLETA a
   `/login?sesion=expirada` cuando Supabase cierra la sesión en el navegador.
   «Salir» marca la salida como voluntaria para no decir «expiró».
4. `esSesionMuerta` reconoce también el MENSAJE «Invalid Refresh Token…»
   cuando el error llega sin `code`.

### 2026-10-27 — Trasplante: edición por modal, lote de variedad trazable y reporte plan contra real (migración 79)

**Base (`79_trasplante_reporte_plan_vs_real.sql`).** `interno.v_siembras_crudo`
se ENVUELVE con su propia `pg_get_viewdef` (patrón 57/78) y gana
`plan_variedad` (variedades del plan para ese lote/ciclo en esa fecha; si el
plan no fecha nada ese día, las del lote/ciclo), `plan_mz` (mz planificadas
para ese lote/ciclo ESE día; NULL = el plan no dice, no es 0) y
`plan_mz_variedad` (plan del lote/ciclo para la variedad sembrada).
`string_agg` sobre texto, nunca `array_agg` de `text[]`. Índice
`planes_siembra (lote_temporada_id, ciclo, fecha_siembra)`. Expuesta con la
reja de la 66 (`trasplante_diario` · lote estricto · dueño). Guardianes;
corrida dos veces contra PG 16.

**Siembra diaria.**

- «Nueva siembra» sale de la cabecera y va a la barra del DataGrid, junto a
  Importar y Excel.
- **Sin edición en celda.** Columna de lápiz al INICIO de la fila que abre
  `EditarSiembraModal` en modo de una fila (fecha, ciclo, lote, variedad,
  mz, plantas, lote de variedad, observaciones y productos; los productos
  se guardan con `fn_guardar_productos_siembra`). `ProductosCelda` queda de
  sólo lectura en la tabla. El cambio en masa sigue igual.
- **Lote de variedad** = `SelectorBuscable` alimentado por Recepción de
  plántulas (`lote_semilla`), filtrado por la variedad elegida y recibido
  hasta la fecha de siembra; un valor viejo que no cuadra se conserva
  marcado. Alta (`SiembraForm`, la página `nueva` ahora lee recepciones) y
  edición comparten `CamposSiembra.tsx`.
- **Productos aplicados**: `SelectorBuscable` con búsqueda por código,
  descripción o grupo, en el alta y en el modal.

**Reporte gerencial.** Sin `max` en Del/Al (simulaciones a futuro).
Rediseño en tarjetas: KPI globales y por ciclo con barra, zonas como
tarjetas con barra por ciclo, cada sección en su tarjeta. Avance diario
con Variedad real / Variedad plan y Mz real / Mz plan; la variedad fuera
del plan se marca en ámbar; subtotales y total del plan cuentan el plan de
cada lote/ciclo/día una sola vez.

**Verificación:** `tsc --noEmit` del módulo en verde, `eslint` sin avisos.
`buildLibs.mjs` no está en el repositorio (vive en `/tmp/pgverif`): no se
pudo correr aquí.

### 2026-10-23 — Corrección de la 78: el botón de fila es «Labores», no «Editar»

- La columna Ticket vuelve a enlazar a `/tickets/[id]`.
- El botón de fila es **Labores (n)** y abre en modal el MISMO panel
  «Labores de este equipo» de la página del horómetro. Ese panel se
  extrajo a `components/registro/PanelLaboresHorometro.tsx` y ahora lo usan
  las dos: la página le pasa las filas del servidor (`inicial`); el modal
  las pide en el navegador (mismo RLS). Permisos con `puedeEnTicket`
  sobre `labores` con el proceso/estado del ticket de la fila.
- `TablaRegistros` gana `onCambio` (tras duplicar/eliminar), porque
  `router.refresh()` no repinta filas leídas en el navegador.
- Al cerrar el modal: `recargar(true)` silencioso; `cantidad_labores` se
  actualiza sin desmontar la cuadrícula. «Agregar» y el lápiz de cada
  labor siguen navegando a sus páginas del ticket, como en el ticket.
- `EditarHorometrosModal` vuelve a su versión anterior (sólo masivo). HI/HF
  se siguen editando en la celda.

### 2026-10-23 — Horómetros: labores por lectura, edición en sitio, tarjetas que filtran y un solo libro SAP (migración 78)

**Base (`78_horometros_labores_count.sql`).** `interno.v_horometros_control_crudo`
gana `cantidad_labores` = `count(*)` de `registros` por `horometro_id`. Se
ENVUELVE con su propia `pg_get_viewdef` (patrón 57), no se reescribe: la
ventana del comparativo y el contador quedan intactos. La cruda es
`definer`, así que el conteo es el real (0 es 0, no «0 de las tuyas»). La
expuesta se rearma con la reja de la 66 (`horometros` · sin zona · dueño).
Guardianes: columna en la expuesta, columnas previas presentes, reja,
cruda inalcanzable y `definer`. Corrida dos veces contra PG 16.

**Pantalla (`ControlHorometros`).**

- La columna Ticket ya no enlaza a `/tickets/[id]`. «Editar» por fila abre
  `EditarHorometrosModal` en modo de UNA fila (nuevo `fila`): HI, HF,
  turno, horas hombre (misma `validarHorasHombre`), equipo, operador y
  comentario; sólo manda lo que cambió. Al guardar, `recargar(true)`
  silencioso: la cuadrícula no se desmonta y conserva filtros, orden y
  búsqueda. El modo masivo (`ids`) sigue igual.
- Columna **Labores** (`cantidad_labores`), insignia roja en 0 con horas.
- Tarjetas «Con desfase» y «Horas sin notificar» son toggles que filtran
  la cuadrícula. **Cambio de lectura:** «Horas sin notificar» suma ahora
  las horas de máquina de jornadas con 0 labores; los huecos del
  comparativo pasan a la tarjeta «Con desfase» («+n h de hueco»). Sin la
  78 la tarjeta vuelve al cálculo viejo y no filtra.
- **Exportar para SAP = un libro** (`construirXlsxHojas`, nuevo en
  `lib/hojas.ts`) con hojas «Horometros» y «Labores». Sale de lo que la
  cuadrícula ENSEÑA (`visibles`: rango, filtros globales, tarjeta,
  cabeceras, búsqueda); las labores se piden a `v_labores_control` por
  `horometro_id` de esas filas, en tandas de 150.
- Engranaje junto al botón: activar/apagar/reordenar columnas por hoja,
  guardado en `localStorage` (`agn.sap.columnas.<clave>`), conciliado por
  NOMBRE de columna (`lib/sap/columnas.ts`, puro). `BotonExportarSap`
  conserva la forma `hoja`/`filas`: Labores sigue igual y también gana el
  engranaje.

**Verificación:** `tsc --noEmit` de lo tocado en verde, `eslint` sin avisos,
`columnas.ts` probado en Node. `buildLibs.mjs` no está en el repositorio
(vive en `/tmp/pgverif`): no se pudo correr aquí.

### 2026-10-23 — Telecom: estado físico, moneda del plan y la tabla a pantalla completa (migración 77)

**Base (`77_telecom_estados_y_moneda.sql`).**

- `telecom_equipos` + `estado_fisico varchar(40) default 'Activo'` con
  `check` cerrado (Activo · Dañado · Reparación · Devuelto),
  `fecha_devolucion date` (≥ compra) y `notas_estado`. No sustituye a
  `estado` (EN_BODEGA/ASIGNADO/DANADO): ése es DÓNDE y lo pone la base;
  éste es CÓMO.
- `telecom_planes` + `moneda` (HNL/USD) y `costo_origen numeric(12,4)`.
  Patrón de la 67: `costo_mensual` sigue SIEMPRE en lempiras y lo calcula
  `trg_telecom_planes_moneda` con `fn_tasa_de_temporada(hoy)`. Sin tasa no
  se inventa: conserva el lempira anterior y avisa. Si alguien corrige la
  celda de lempiras a mano, el plan pasa a HNL con ese valor.
- `interno.v_telecom_equipos_crudo` y `v_telecom_lineas_crudo` rehechas
  con las columnas nuevas AL FINAL (`plan_moneda`, `plan_costo_origen`);
  sus envoltorios de `public` se tiran antes y se rearman con la reja de
  la 66 (`nada`, sin dueño).
- UPDATE con `with check` explícito en las siete tablas de telecom.
  **`telecom_asignaciones` pasa a `fn_verificar_permiso('telecom', acc,
  usuario_id)` en las cuatro**: la vista recortaba por propietario desde
  la 57 y la tabla no, así que por PostgREST un alcance «propietario»
  editaba la entrega de otro.
- Guardianes: columnas en las expuestas, `interno` cerrado, crudas
  `definer`, expuestas con reja, ningún UPDATE de telecom sin `with
  check`, dueño en las cuatro de asignaciones, disparador presente.
  Corrida dos veces (idempotente) contra PG 16 con fixture 47/49/57/66.

**Pantalla.**

- La página de telecom pierde el tope `max-w-6xl`: la cuadrícula ocupa el
  ancho. El resumen «Por departamento / Por centro de costo» sale del
  flujo y queda tras **Ver resumen** (modal, sobre lo filtrado).
- **La celda ya no edita en todo el módulo** (asignaciones, líneas,
  equipos). Cada fila lleva **Editar**:
  asignaciones → `AsignacionModal` en modo edición (colaborador, línea y
  equipo fijos; fechas, CC, departamento, puesto, correo, accesorios,
  observaciones y Vigente/Revisar); líneas → `ModalEditarLinea`;
  equipos → `ModalEquipo` (alta y edición con estado físico, devolución y
  notas).
- Filtros rápidos Colaborador / Departamento / Centro de costo encima de
  las dos tablas de asignaciones; los de cabecera siguen funcionando.
- El selector de centro de costo de la entrega enseña `codigo - nombre`
  y guarda el código. El puesto pasa a catálogo con alta en línea.
- Interruptor **HNL/USD** (`Moneda.tsx`) compartido por Líneas y Planes;
  `PanelPlanes.tsx` enseña cada plan en la moneda elegida y el catálogo
  se escribe en su moneda. `crearPlan` escribe `costo_origen`.

**Verificación:** `tsc --noEmit` del módulo en verde, `eslint` del
módulo sin avisos. `buildLibs.mjs` no está en el repositorio (vive en
`/tmp/pgverif` de las sesiones de pruebas): no se pudo correr aquí.

### 2026-10-15 — El turno repartido, el acarreo por ciclo y el informe que se puede auditar (migración 76)

#### 1. El fallo: un turno sobre dos lotes decía el DOBLE de dosis

Esto no se dedujo leyendo la vista: se **midió** contra PostgreSQL 16
antes de escribir una línea de arreglo. Un turno de 2.000 L sobre dos
lotes de 10 mz cada uno:

```
lote |mz      |dosis_real              |costo_quimico
N-01 |10.0000 |200.0000000000000000    |10000.0000000000000000
S-01 |10.0000 |200.0000000000000000    |10000.0000000000000000
```

2.000 L sobre 20 mz son **100 L/mz**. La vista decía **200**: exactamente
el doble, que es el número de lotes del turno.

La causa: `interno.v_desinfeccion_informe_crudo` cruzaba los químicos por
`ejecucion_id`, así que **cada lote se llevaba los litros enteros del
turno** y los dividía entre SUS manzanas. Con tres lotes habría dicho el
triple.

Lo peor no es el número: es que **el informe se contradecía a sí mismo**.
El costo del químico SÍ se prorrateaba bien (10.000 de 20.000 a cada
uno), así que el mismo papel decía «100 L/mz de costo» y «200 L/mz de
dosis». Quien lo llevara a una reunión no tenía cómo defender ninguno de
los dos.

El arreglo es un factor de participación, calculado una vez y aplicado a
todo lo que sale del turno:

```sql
dl.mz_cubiertas / nullif(sum(dl.mz_cubiertas) over (partition by dl.ejecucion_id), 0)
    as factor
```

Y el expediente lleva ahora **las dos cifras** —`litros_turno` y
`litros_lote`— junto con el factor y las manzanas que lo producen. Sin
ellas el prorrateo es un número que hay que creerse.

#### 2. El acarreo cruzaba los ciclos y cobraba una pata de tres

`desinfeccion_logistica` no tenía ciclo. Un acarreo de enero se repartía
entre las manzanas regadas de agosto, porque la bolsa de la zona era de
la TEMPORADA. Ahora `ciclo smallint not null` es la primera llave del
reparto, y un acarreo de un ciclo sin riego no se le cuelga a nadie.

El costo era `horas × costo_hora` y nada más. El implemento no sumaba
—«todavía no tiene tabla de tarifas»— y el operador tampoco, lo que en la
práctica quería decir que **el acarreo salía más barato de lo que era**
en todos los informes. Son tres patas:

```sql
new.costo_total := round(
    (horas * costo_hora_equipo) + (horas * costo_hora_implemento)
    + (case when operador_id is not null then salario_operador else 0 end), 2);
```

Sin operador el salario se borra: un jornal escrito sin operador no se le
paga a nadie.

**`costo_hora` se mantiene sincronizado**, y además se RECOGE: si llega
escrito y `costo_hora_equipo` viene en cero, se adopta. Sin eso, un
cliente viejo o una importación habrían guardado el acarreo en cero sin
que nadie lo notara — lo encontró `t71`, que seguía insertando por la
columna de antes.

#### 3. Cargo al lote: el acarreo que no es de toda la zona

`tipo_cargo` vale `'zona'` o `'lote'`. El primero es la bolsa de siempre.
El segundo reparte **sólo entre los lotes marcados** (tabla nueva
`desinfeccion_logistica_lotes`, con su RLS de tabla hija), en proporción
a `fn_area_lote_ciclo`, y a partes iguales si nadie capturó área: un
cargo que desaparece porque falta un dato es peor que un reparto
aproximado y visible.

En el formulario la zona **ya no se pregunta** cuando el cargo es al
lote: se deriva de los lotes marcados. Preguntarla aparte invitaba a
dejarla distinta de la de los lotes, y entonces el acarreo lo ve quien no
debe.

#### 4. `delta_costo` comparaba cosas que no se pueden comparar

Medía el costo TOTAL del lote —químico + cuadrilla + acarreo— contra
`costo_plan`, que sólo presupuesta **químico de aplicación**. La
desviación salía siempre en rojo y por eso nadie la miraba. Ahora:

```sql
case when costo_plan is null then null
     else costo_quimico_aplicacion - costo_plan end as delta_costo
```

La vista expone `costo_quimico_aplicacion` y `costo_quimico_lavado` por
separado. El costo total sigue dicho, aparte, donde corresponde.

#### 5. El informe: lo que se retiró y por qué

**La recta del cronograma.** Apilaba los hitos sobre una línea y
alternaba las etiquetas arriba y abajo para que no chocaran. Con cuatro
colaba; con seis —y con un preriego y unas lecturas a un día uno del
otro— los textos se montan justo en la parte que más se mira. Lo
sustituye una **etapa por fila**: la colisión es imposible por
construcción, y de paso cabe el plan Y lo real de cada etapa en la misma
banda, que es la comparación que se viene a hacer. Una etapa sin fechas
ya no desaparece: dice «sin registrar», y el hueco es un dato.

**La barra apilada del costo.** Decía «98 % químico, 2 % acarreo» y ahí
se acababa. Con tres conceptos de los que uno se lleva casi todo, la
proporción no es la pregunta. La sustituyen tres paneles de detalle
—químicos, mano de obra por fase, logística y acarreo— con su total al
pie: la proporción se sigue leyendo y además se puede auditar.

Se cierra con **el detalle operativo por fase**, las cuatro siempre, y
con los turnos que regaron el lote y el factor con el que se repartió.

El PDF hace lo mismo y en una segunda página: sale de las MISMAS
funciones puras que la pantalla, así que no pueden discrepar.

Lo retirado se borró de `informe.ts` en vez de dejarlo «por si acaso»:
dos maneras de calcular el reparto de un costo es exactamente como se
llega a un papel que no coincide con el tablero.

#### 6. Lo que las pruebas encontraron

- `max(jsonb)` no existe: el plan se agrega con `(array_agg(...))[1]`.
- Los guardianes del final comparaban con `!~` contra `pg_get_viewdef`,
  que **normaliza las palabras clave a mayúsculas**. Pasaban por
  casualidad hasta que uno no pasó. Ahora son `!~*`.
- `pg_get_viewdef` también quita el alias de la tabla, así que el
  guardián de `delta_costo` tuvo que aceptar `(x\.)?`.
- `t71` seguía escribiendo el acarreo por `costo_hora` a secas: fue lo
  que destapó el punto 2.
- `productos` dejó de ser un arreglo de arreglos y pasó a ser la lista
  plana del lote. El navegador ya hacía `.flat()`, así que lee bien las
  dos formas.

#### 7. El expediente completo: lo que faltaba del pliego

Una segunda pasada contra el pliego encontró cuatro huecos, y arreglarlos
destapó dos defectos de verdad:

**El DDT de cada etapa.** El cronograma enseñaba plan y real pero no
contra qué día del cultivo. Se calcula en `etapasDe` —una resta de dos
fechas que la fila ya trae— en vez de pedirle a la vista seis columnas
más para no decir nada nuevo. Va pegado a SU fecha, no en otra columna:
separarlos obligaría a cruzar la vista para saber a cuál pertenece.

**Los tres paneles, en tablas.** Eran renglones de texto corrido. Ahora
cada uno tiene sus columnas —Producto / Fase / Litros lote / Dosis-mz /
Costo-L / Costo lote— y el de cuadrilla lleva el resumen por fase y la
insignia de la fase más cara antes de los puestos. A 390 px cada tabla
se arrastra en su propio carril: estrujar seis columnas hace ilegible la
que importa, y ensanchar la página no es una opción.

**El expediente por fase.** Era productos + cuadrilla. Ahora cada fase
lleva lo operativo del turno: el reloj del preriego con sus
observaciones, los tensiómetros, y en la aplicación la estación, el
equipo, el caudal, el agua con producto, los tres tiempos de reloj, la
conductividad y la calibración. En la fase 3 —la única que el plan
presupuesta— va la comparativa **plan contra real producto a producto**,
cruzada por código: lo que aparece en un solo lado aparece igual, porque
un químico planificado que no se aplicó es justo lo que se viene a
buscar.

**Dos defectos que salieron de ahí:**

1. **`undefined` no es `null`.** La vista devuelve `null` para lo no
   capturado, pero a un `jsonb` al que le falta la clave llega
   `undefined`. El filtro comparaba sólo contra `null`, así que colaban
   renglones «Fecha:» sin valor y una fase sin tocar se daba por hecha.
2. **Tres autorrellenos, una carrera.** Equipo, implemento y operador se
   resolvían en tres efectos, y cada uno construía su cambio sobre el
   `entrada` que tenía en la mano al empezar: el último en resolverse
   pisaba a los otros. Medido en el banco —la tarifa del equipo
   desaparecía en cuanto el implemento traía la suya—. Ahora se resuelven
   los tres y se aplica UN cambio.

Y uno de presentación que sólo se ve en el papel: la raya larga `–` no
está en Latin-1 y el motor de PDF la escribía como `?`. Guion simple.

#### 8. La trampa de la 68, otra vez, en otro disfraz

`tparidad` daba 84 diferencias de 192 en el costo del personal. No era
una regresión: el CSV `paridad_personal.csv` estaba generado antes de que
la 74 hiciera `cantidad_personas` decimal, y se comparaba contra él. Es
el mismo fallo que el bundle rancio de la 68 —una prueba en verde (o en
rojo) contra una foto vieja— y conviene recordarlo: **los volcados de
paridad también caducan**. Regenerado contra la 76: 192 de 192.

Suites: `t76.sql` (33 verdes), `tlogistica.mjs` nuevo (35, a 390 px),
`tcalc` 184, `tinforme` 77, `tinformepdf` 60, `tinformeui` 54,
`tdesinf` 136, `tparidad` 192 + 1.152 sin una diferencia, y la cadena SQL
entera de la 42 a la 76 en verde.

### 2026-10-14 — El informe que reventaba, el catálogo de objetivos y las dos fechas del plan (migración 75)

#### 1. `cannot accumulate null arrays`: el informe no daba menos datos, no daba ninguno

```
ERROR:  cannot accumulate null arrays
```

`interno.v_desinfeccion_informe_crudo` agregaba los objetivos así:

```sql
fn_limpiar_objetivos(array(select unnest(array_agg(qu.objetivos))))
```

`qu` viene de un LEFT JOIN con los químicos. **Un turno sin químicos
capturados —o con sólo químicos de lavado— deja `qu.objetivos` en NULO**,
y `array_agg` sobre una columna que ya es `text[]` se niega a acumular un
nulo. No es un aviso que recorte una columna: **la consulta entera
revienta**, así que el informe no enseñaba menos datos, no enseñaba
ninguno.

Y era invisible desde fuera: `count(*)` no evalúa la columna, así que
toda prueba de humo pasaba. Sólo falla cuando alguien pide
`objetivos_control` — es decir, cuando un gerente abre el informe.

La regla, de aquí en adelante: **nunca `array_agg` sobre una columna que
ya es un arreglo.** Se desempaca con `unnest` en origen y se agregan
ESCALARES, que admiten nulos y se filtran.

Y la otra mitad, que es igual de importante: **ese desempaque va en su
propia consulta, unida DESPUÉS de agrupar.** Unirlo antes multiplica las
filas de `regado`, y un químico con tres objetivos triplicaría las
manzanas y los costos del lote. Es la forma silenciosa de romper esto, y
`t75` la vigila con números exactos.

#### 2. Los objetivos dejan de ser texto libre

La 71 los hizo `text[]` libre a propósito —nadie mantiene un catálogo de
plagas, y obligar a darlas de alta deja el campo vacío— y dejó el precio
anotado como deuda: «Nematodos» y «nematodos» eran dos objetivos
distintos en el informe.

Ahora hay catálogo `public.objetivos_control` (código, nombre, grupo),
gobernado por `catalogo_cultivos`, con el nombre único **sin distinguir
mayúsculas**. Pero cerrarlo a secas habría traído el problema contrario:
el día que aparece una plaga que no está dada de alta, quien captura
tendría que abandonar el turno a medio llenar e irse a Catálogos. En la
práctica eso no se hace — se elige lo más parecido y el dato queda mal.
Por eso el selector **crea desde su propio buscador**, sin
`router.refresh()`, igual que el alta de personal.

**Nada de lo ya escrito se pierde**: la migración rescata con `unnest` lo
que exista en `materiales` y en `desinfeccion_ejecucion_productos` y lo
da de alta con grupo «General».

Lo que se guarda sigue siendo el NOMBRE y no el identificador: la columna
es `text[]` y lo que se lee es lo que está escrito. Guardar ids obligaría
a resolverlos en cada vista y en el PDF, y dejaría lo anotado antes de la
75 sin poder enseñarse al lado.

#### 3. El equipo de aplicación

Con qué se aplicó —sistema de riego, inyección u otra cosa— no se
guardaba, y es lo primero que se pregunta cuando un turno sale raro.
«Otros» **obliga a decir cuál**: un «Otros» a secas no contesta nada
dentro de un año, que es justo el hueco que el campo venía a llenar. Y al
cambiar de opción el detalle se limpia solo —dejarlo colgando sería
basura que alguien leería como buena—.

Va en un DISPARADOR y no sólo en un CHECK porque la limpieza no la puede
hacer un CHECK: un CHECK rechaza, no corrige.

#### 4. Las dos fechas del plan

El plan sabía cuándo aplicar, pero no cuándo preparar el suelo ni cuándo
se levanta el lote.

- `desinfeccion_plan.dias_preriego` + `fecha_preriego` **generada**.
- `variedades.ddt_cosecha` → `fecha_cosecha` en la vista del plan.

**Vacío no es cero, en los dos extremos de la cadena.** «No se ha
planificado el preriego» y «se preriega el mismo día que se aplica» son
dos cosas distintas; la segunda se escribe con un cero. Eso obligó a una
rama propia en la edición en celda, donde todos los numéricos mandaban
vacío como 0: borrar la celda habría inventado una fecha de preriego
igual a la de aplicación.

Y sin `ddt_cosecha` en la variedad **no se inventa una fecha**: va en
nulo y la pantalla dice dónde se configura. Una fecha inventada aquí
acaba en el calendario de la finca.

#### 5. Cuatro cosas que salieron al hacerlo

- **La trampa de la columna generada.** `fecha_aplicacion` ya es generada,
  y Postgres no deja que una generada se apoye en otra: «cannot use
  generated column in column generation expression». Hay que repetir la
  suma entera — `(fecha_siembra_congelada + dias_aplicacion) +
  dias_preriego` — y el módulo puro repite la misma expresión por lo
  mismo, no por descuido.
- **Un valor elegido que no está en la lista se escondía.**
  `SelectorMultiple` caía en «1 seleccionado» cuando el valor no estaba
  entre las opciones. Eso tapaba dos casos que importan: el objetivo
  recién creado y, sobre todo, **lo anotado en texto libre antes de la
  75**, que sigue guardado y que nadie dio de alta. Ahora se enseña el
  valor tal cual y se añade al final de la lista, para poder quitarlo.
- **Un banco que pasa con el *bundle* viejo no prueba nada.** `build.mjs`
  falló al faltarle los stubs del catálogo nuevo, y `tdesinf` siguió
  dando 124 verdes contra el código de antes. Es la trampa de la 68 otra
  vez: el banco sólo vale si se reconstruye, y por eso `buildLibs` y
  `build` van antes de correr nada.
- **Una prueba que depende de la paridad de los clics es frágil.** El
  `tdesinf` alternaba una sección con dos clics y daba por hecho en qué
  estado quedaba; al cambiar qué sección abre el banner de guardado, el
  segundo clic la cerró. Ahora se deja en el estado pedido, se tarde lo
  que se tarde.

#### Cómo se comprobó

`t75` (39) nuevo contra PostgreSQL 16 real: el informe con un turno sin
químicos, con sólo químicos de lavado y con tres químicos de 1, 2 y 0
objetivos —y las manzanas y el costo SIN multiplicar—; el catálogo con su
reja probada contra dos usuarios de verdad (el capturador lee pero no da
de alta); el rescate del texto libre, idempotente; el equipo con sus tres
opciones y los tres rechazos; y las dos fechas al día exacto, con el cero
distinguido del nulo.

En el navegador a 390 px: `tdesinf` 136 (el selector de catálogo, el alta
desde el buscador y el equipo con su «Otros»), `texcelplan` 57 (la
columna opcional, con el vacío distinguido del cero), `tinforme` 41 (el
hito de cosecha). Veintiuna suites SQL y veintidós de navegador, más los
bancos de hidratación y sesión. `tsc`, `eslint` y `build` limpios.

### 2026-10-14 — La fase 4, personas con decimales y los avisos que señalan (migraciones 73 y 74)

#### 1. El lavado de cinta no se podía capturar

Después de inyectar hay que lavar la cinta: **otra gente, otro químico,
otro día**. Todo eso caía dentro de «3 · Aplicación» o no se anotaba, y
el costo de CERRAR un turno quedaba escondido dentro del de aplicarlo.

Entra como cuarta fase en los dos enums, y el `4_Lavado` va en **archivo
propio** (la 73): es la trampa #14 de esta misma bitácora, y la 74 usa el
valor nuevo en un CHECK, en un DEFAULT y en tres `FILTER`. Juntos, el
archivo entero reventaría con «unsafe use of new value».

Lo que el lavado **no** hace, y es a propósito:

- **No calcula ppm.** No es una dilución: es agua que enjuaga una
  tubería, no agua que lleva producto al suelo. `ppm_calculada`,
  `agua_total_m3` y `producto_puro_litros` van en NULO y no en cero — un
  cero diría «salieron cero ppm», que es una afirmación; aquí la
  pregunta no aplica.
- **No hereda objetivos de control.** Enjuagar no es aplicar «contra
  nematodos», y heredar el objetivo del catálogo sería afirmarlo en el
  informe. Lo vacía un disparador al insertar **y otro al actualizar**:
  `fn_objetivos_por_omision` es BEFORE INSERT solamente, así que sin el
  segundo un UPDATE podía colarlos después.

Las ppm y los objetivos AGREGADOS del informe y de la ejecución pasan a
mirar sólo `'3_Aplicacion'` por lo mismo. Y `dosis_mz_real` también: se
compara contra un plan que no tiene línea de lavado, así que sumarle los
litros del enjuague inventaría una sobredosis contra algo que nunca se
previó.

Los COSTOS sí lo suman todo —el lavado se paga—, y
`costo_personal_lavado` sale aparte en las tres vistas para poder
contestar cuánto cuesta cerrar un turno. `fase_mas_cara` ya compara las
tres.

#### 2. Una persona no siempre es una persona entera

Un estacionero que atiende tres turnos pone **un tercio** de su jornal en
cada uno. `cantidad_personas integer` obligaba a escribir 1 —y a inflar
el costo tres veces— o 0, que el CHECK rechazaba.

Pasa a `numeric(6,2)`, con tope de 500: sin tope, un dedo resbalado mete
11 en vez de 1.1 y el costo del turno se multiplica por diez sin que
nada chille.

**El `Math.trunc` del repositorio era el fallo gemelo.** Guardaba
`Math.trunc(aNumeroCero(p.cantidadPersonas)) || 1`: 0.33 se truncaba a 0
y el `|| 1` lo subía a 1. Aunque la columna hubiera admitido decimales,
el navegador los habría tirado antes de llegar.

El costo se redondea ahora a dos decimales **en los dos sitios** —el
disparador y el módulo puro—: con 0.33 personas la pantalla decía
1,234.5567 y el informe 1,234.56.

#### 3. El mismo químico en dos fases

La llave única era `(ejecucion_id, producto_id)`, así que el ácido de la
inyección y el ácido del lavado eran la misma fila y la segunda
rebotaba. Pasa a `(ejecucion_id, fase, producto_id)`. Repetirlo DENTRO de
una fase sigue prohibido, que eso sí es un renglón duplicado.

#### 4. Los avisos señalan, en vez de describir

`validarEjecucion` devuelve UN texto: el primer problema. Sirve para no
guardar basura, pero deja a la persona buscando a ojo cuál de los
cuarenta campos se queja — y con el acordeón plegado, ni sabe en qué
sección mirar. Peor: si el problema no encajaba en ninguna de las tres
expresiones regulares, **se pulsaba Guardar y no pasaba nada**, que para
quien está en campo es la aplicación colgada.

`validarFormularioDetallado` devuelve las dos cosas que la pantalla
necesita para señalar: el mapa `campo → qué corregir` y el resumen por
sección. Con eso:

- El borde del campo se pinta en rojo y debajo sale qué escribir **con un
  ejemplo** («ej. 0.33, 0.5 o 2»). El color es un segundo canal, nunca el
  único.
- La cabecera del acordeón lleva «⚠️ Revisar datos» **aunque esté
  plegada**, que es justo cuando hace falta.
- Al guardar se abre la primera sección con problema y el banner dice
  cuál es y qué pasa. Si el fallo viene de la base, lleva además una
  línea `Detalle técnico para supervisor: [code] message` — la traducción
  al castellano es para quien captura; un `constraint` no se arregla con
  ella.

**La regla que no se podía romper: el guardado incremental.** Se asignan
los lotes un día, se riega otro, se aplica un tercero y se lava un
cuarto. Una sección vacía no es un error, es que todavía no le toca. Lo
que sí es un error es una fila TOCADA y a medias. Y hasta el primer
intento de guardar sólo se marcan los errores de FORMATO: un formulario
que nace en rojo enseña a ignorar el rojo.

#### 5. Tres cosas que salieron al hacerlo

- **`fn_objetivos_en_orden` la comparten dos tablas.** Meterle
  `new.fase` dentro reventó el alta de `materiales` entero con «record
  "new" has no field fase»: un producto del catálogo no tiene fases.
  Normalizar un arreglo de texto y saber qué significa una fase son dos
  responsabilidades distintas; la segunda vive ahora en
  `fn_objetivos_fase`, y sólo la oye la tabla que tiene fase.
- **El `<button>` dentro del `<label>`, otra vez.** Envolví el selector
  de producto en un `Campo` para colgarle el mensaje de error, y `Campo`
  es un `<label>`: el botón del selector le robó el nombre accesible y
  `tdesinf` dejó de encontrarlo. El error va como hermano, no como hijo.
- **Doce vistas de `interno` tenían un `grant select` a
  `authenticated`** desde antes del patrón de la 56/57. Inerte mientras
  no haya `usage` sobre el esquema, pero una puerta entornada: el día
  que alguien conceda `usage`, quedan abiertas sin reja. La 74 lo revoca
  — las vistas públicas son de `postgres` y corren con los derechos de
  su dueño, así que no hacía falta para nada.

#### 6. Y una que se vio en el papel

Los cinco hitos del PDF no cabían en cuatro columnas calculadas a mano:
la siembra y «Contra el plan» acababan dibujados uno encima del otro. En
un PDF eso no es un aviso de consola, es un informe ilegible que alguien
lleva a una reunión. Ahora la lista se arma con lo que HAY y se reparte
sola en filas de cuatro, y el marco crece con ella.

#### Cómo se comprobó

`t74` (44) nuevo contra PostgreSQL 16 real: 0.33 y 0.5 personas con la
paridad del disparador al centavo, el mismo ácido en las dos fases sin
colisión, el lavado sin heredar objetivos ni al insertar ni al
actualizar —ni colándolos a mano, que el informe los ignora—, los costos
sumando el lavado, y las rejas ABAC probadas contra un usuario zonal de
verdad. `t59` sube a 40 con la llave y el enum nuevos.

En el navegador a 390 px: `tcalc` 170 (decimales, químicos por fase, las
cinco secciones y veintitantas del diagnóstico), `tdesinf` 124 (la
sección 4 entera, lo que esconde, la coma que se normaliza, el borde
rojo, el distintivo plegado y el banner), `tinforme` 39 y `tinformepdf`
36 (el hito del lavado y el reparto de la cuadrilla, idénticos en
pantalla y en papel).

Veinte suites SQL y veintidós de navegador, más los bancos de hidratación
y sesión. `tsc`, `eslint` y `build` limpios.

### 2026-10-13 — El aviso de «falta la migración» era un diagnóstico inventado (sin migración)

El informe de desinfección enseñaba el amarillo de «corre las migraciones
59 y 60» con la 71 y la 72 ya instaladas. **No era un falso positivo de
una consulta concreta: era que el módulo entero contestaba eso a
cualquier error.** Las seis pantallas tenían la misma línea:

```ts
if (error) { onSinMigracion(true); setFilas([]); return }
```

Un permiso que falta, una vista sin `grant select`, la caché de esquema
de PostgREST sin recargar, el wifi caído — todos acababan diciendo lo
mismo. Quien ya tenía las migraciones puestas las volvía a correr, no
pasaba nada, y la pantalla seguía amarilla sin una sola pista de la
causa. El comentario del tablero lo decía en voz alta: «un error aquí
casi siempre es falta la migración». «Casi siempre» no es un
diagnóstico.

La causa de raíz estaba más abajo: `leerTodo` se quedaba con
`error.message` y **tiraba el `code`**. Sin código, la pantalla no tenía
con qué distinguir un caso del otro aunque hubiera querido.

Ahora el código viaja (`Tramo`, `Todo`, `Lectura`) y la decisión vive en
un solo sitio, `lib/supabase/instalacion.ts`: sólo falta la migración con
`42P01`, `42703`, `42883`, `PGRST202`, `PGRST204` o `PGRST205`. Todo lo
demás se enseña con el texto de la base **sin tapar el módulo**: que un
informe no cargue no es razón para esconder la captura.

Los tres códigos de PostgREST llevan trampa aparte: también salen cuando
la relación existe y lo que no se ha recargado es su caché. En ese caso
el aviso añade la salida —`notify pgrst, 'reload schema';`— en vez de
mandar a correr SQL que ya está puesto.

`tinstalacion` (26) prueba justamente el caso del encargo: un `42501`
sobre `v_desinfeccion_informe_ejecutivo` ya no dice que falten las 59 y
60, dice «permission denied» y deja el módulo en pie.

### 2026-10-13 — Hotfix post-71: la portada que no se veía y el área de dos ciclos (migración 72)

#### 1. El bucle a `/tickets` no estaba en el código

Reportado como «tras entrar, o al ir a `/`, el sistema sigue forzando
`/tickets`». **El repositorio ya estaba limpio** desde el lote anterior:
el middleware manda a `/`, `FormularioLogin` hace `router.push('/')`, los
catorce porteros de pantalla redirigen a `/`, no existe
`app/auth/callback/route.ts` ni ninguna constante tipo
`DEFAULT_LOGIN_REDIRECT`, y `tportada` llevaba tres lotes verificándolo.
Las tres referencias a `/tickets` que quedan son legítimas: el enlace del
menú, el `push` tras borrar un ticket y una comparación de `pathname`.

Lo que pasaba estaba en el disco de la máquina, no en el repositorio.
`src/app/page.tsx` —la vieja, de cinco líneas, con `redirect('/tickets')`
dentro— **seguía allí**. `(app)` es un *grupo de ruta*: no añade segmento
a la URL, así que `src/app/page.tsx` y `src/app/(app)/page.tsx` resuelven
la MISMA ruta, y mientras la vieja exista gana ella.

Sobrevivió porque **copiar archivos no borra archivos**. La entrega
escribe lo nuevo y lo modificado; lo eliminado se queda. Un borrado
tiene que viajar como una orden aparte.

El guardián nuevo va en `tportada`: cuenta cuántas páginas resuelven
«/» —la raíz suelta y las de los grupos— y exige que sea exactamente
una, y que sea la del armazón. Ningún `grep` de `/tickets` habría
encontrado esto, porque el archivo culpable no estaba donde se miraba.

#### 2. El área de desinfección era de la temporada, no del ciclo

En «0. Lotes y manzanas» se elige el ciclo en la cabecera del turno, pero
el catálogo de lotes no se enteraba: `fn_lotes_desinfeccion` pedía las
manzanas a `fn_area_regable`, que suma **todos** los ciclos. Un lote de
10 mz planificado en el ciclo 1 y de 7 en el 2 se ofrecía como 17.

No es un número feo en una lista. La sugerencia de `mz_restantes` es la
que acaba escrita en el renglón, y las manzanas del turno son el divisor
con el que se reparte el químico: **un área inflada es una dosis mal
calculada**, y eso sale al campo.

Lo mismo con lo ya desinfectado: `mz_ejecutadas` contaba las pasadas de
cualquier ciclo. Lo regado en el ciclo 1 no está hecho para el ciclo 2
—es otra desinfección, con otro producto y otra fecha—, así que
descontarlo dejaba el lote en «no queda nada» cuando quedaba todo.

La función gana `p_ciclo`. Con ciclo, las planeadas salen de
`fn_area_lote_ciclo` —la misma que riego usa desde la 68, con el mismo
criterio: sembrado > planificado > neta— y las ejecutadas se recortan a
las ejecuciones de ese ciclo. Sin ciclo (`null`) se comporta como antes,
y eso es a propósito: la pestaña enseña el catálogo de la temporada
entera y ahí la suma sí es lo que se quiere. `fn_area_regable` se queda
viva para el reporte y el histórico.

En React, `leerLotes` acepta el ciclo y `GridEjecucion` lo pasa siempre
desde la cabecera. El `cicloActual` tuvo que subir por encima del efecto:
va en sus dependencias, y declararlo después lo dejaba en la zona muerta
del `const` —un error de render, no un aviso de consola—. La línea de
ayuda bajo cada lote ahora dice de qué ciclo habla: el mismo lote se
siembra dos veces al año y un número sin ciclo al lado no se puede
revisar.

#### 3. La reja de la 67, intacta

Cambiar la firma de una función `security definer` es el momento exacto
en que se pierde un filtro sin que nadie lo note. La 72 vuelve a exigir
en sus guardianes `fn_ve_zona_estricta`, `fn_permitido_de`, que haya
**una sola** `fn_lotes_desinfeccion` —la trampa de la sobrecarga— y,
nuevo, que el cuerpo nombre `fn_area_lote_ciclo` y recorte por `e.ciclo`.
`t72` (25 verdes) lo prueba contra una base de verdad: el zonal sigue
viendo un lote, sin zonas asignadas no ve ninguno, y con alcance global
vuelve a verlos todos.

Diecinueve suites SQL, veintiuna de navegador, más los bancos de
hidratación (`tportada` sube a 14) y de sesión. `tsc`, `eslint` y `build`
limpios.

### 2026-10-13 — Objetivos de control e informe ejecutivo (migración 71)

#### 1. Contra qué se aplicó

Un químico se aplica contra algo —nematodos, hongos de suelo, malezas— y
eso no se guardaba en ningún sitio. El dato vivía en la cabeza del
agrónomo, así que «¿qué hicimos contra el nematodo esta temporada?» no se
podía contestar con la base.

Va en **dos** sitios y no en uno:

- En `materiales`, el objetivo que el producto trae de fábrica —lo que
  dice su etiqueta—.
- En la aplicación, contra qué se usó **ESE día**. El mismo producto se
  aplica contra cosas distintas según la presión que haya en el lote, y
  guardar sólo el del catálogo sería contestar con el bote en vez de con
  lo que pasó.

Un disparador hereda el de la etiqueta al anotar un químico sin decir
nada, y **no vuelve a tocarlo**: lo que se dice en campo manda.

`text[]` y no una tabla de catálogo, a propósito: nadie mantiene una
lista cerrada de plagas, y obligar a darlas de alta antes de poder
anotarlas es la clase de fricción que acaba con el campo vacío. Se
normaliza el espacio —fuera vacíos, extremos y repetidos— pero **no las
mayúsculas**: «Mal de Panamá» es un nombre propio y bajarlo a minúsculas
lo haría ilegible.

#### 2. `v_desinfeccion_informe_ejecutivo`

Para contar qué pasó en un lote había que abrir cinco pantallas. Esta
vista consolida el flujo entero.

**El grano es LOTE × CICLO**, y los dos motivos importan: no por lote a
secas, porque los dos ciclos de una temporada son dos campañas distintas
y juntarlas sumaría costos de siembras diferentes; y no por ejecución,
porque un turno riega varios lotes y la pregunta gerencial es siempre
«¿cuánto me costó ESTE lote?».

> **Lo que NO hace: inventar un plan donde no lo hay.** Un lote ejecutado
> sin plan trae los campos del plan en **nulo**, y la pantalla dice «Sin
> plan». Un cero diría «se planificó cero», que es una afirmación
> distinta.

Detrás de `desinfeccion_reporte` y no de `desinfeccion_ejecucion`: quien
mira números no es necesariamente quien captura.

#### 3. El tablero: cuatro preguntas, en orden

Va de lo general a lo particular, porque es una pantalla para quien **no**
capturó el turno:

1. **Cuándo** — la línea de tiempo, a escala de días, con el DDT. Los
   hitos van a escala y no repartidos: el dato es cuánto tiempo pasó
   entre uno y otro, y la desinfección se aplica ~70 días antes de
   sembrar. El orden lo da la **fecha**, no el nombre: un preriego que se
   adelantó al plan sale antes que el plan, porque la línea cuenta lo que
   pasó.
2. **¿Se cumplió?** — dosis y costo contra lo planificado.
3. **¿Dónde se fue el dinero?** — las tres piezas y la fase más cara.
4. **¿Contra qué se aplicó?** — los químicos con sus objetivos.

> **La banda del ±5 %, y por qué no un signo.** Pintar de rojo cualquier
> número por encima del plan haría que todo saliera rojo: un turno nunca
> clava la dosis al decimal, y un informe donde todo está en rojo no
> señala nada. Dentro del ±5 % es ruido de campo. Y quedarse **muy**
> corto tampoco es buena noticia automática: puede ser ahorro y puede ser
> que al lote le faltara producto, así que va en ámbar y no en verde.

El tablero de la 67 sigue vivo al lado, con un interruptor: contesta otra
pregunta —cuál se me fue de precio en el periodo— y juntarlas haría que
ninguna de las dos se contestara bien.

#### 4. El PDF, maquetado y no volcado

Un PDF que repite la cuadrícula de la pantalla no sirve para lo que se
usa: llevarlo a una reunión donde nadie va a abrir la aplicación. Se
maqueta como documento —encabezado corporativo, tres bloques con marco, y
el reparto del costo **dibujado** en vez de listado—.

El motor de `lib/pdf/documento` gana color (`rg`/`RG`). Hasta ahora sólo
sabía gris, y tres tonos próximos de gris se confunden al fotocopiarlos.

**Las cuentas no se hacen en el PDF**: salen de `lib/desinfeccion/informe`,
las mismas que usa la pantalla. Un papel que dice algo distinto del
tablero es peor que no tener papel, porque quien lo lleva a una reunión no
sabe cuál de los dos defender. La prueba del PDF comprueba exactamente
eso, y **encontró una**: `conSigno` escribía `+8000.00` mientras la
pantalla decía `+8,000.00`.

#### 5. Y lo que faltaba del enrutamiento

`FormularioLogin` todavía empujaba a `/tickets` después de entrar. Las
pantallas y el middleware ya se arreglaron ayer; éste se escapó porque la
redirección vive en un manejador de evento, no en un `redirect()`.

#### Cómo se comprobó

- `t71.sql` (**29 verdes**, nueva): la limpieza de objetivos, la herencia
  de la etiqueta y que lo de campo mande sobre ella, el flujo entero de
  un lote —tiempos, DDT con su signo, agronomía, reparto del dinero y
  desviaciones—, que un lote sin plan NO traiga ceros, y la reja sobre
  `desinfeccion_reporte` con un jefe de la zona equivocada.
- `tinforme.mjs` (**32 verdes**, nuevo): las cuentas puras. Los químicos
  de dos pasadas se suman pero **sus ppm no** —se queda la del que más
  pesa—, el cronograma se ordena por fecha, y la banda del tono.
- `tinformepdf.mjs` (**32 verdes**, nuevo): se genera el PDF y se le mira
  dentro. Que sea un archivo válido, que lleve el encabezado y los tres
  bloques, que tenga recuadros y color —no un volcado—, y que **cada
  número sea el de la pantalla**.
- `tinformeui.mjs` (**31 verdes**, nuevo) en Chromium a 390 px: las
  cuatro secciones, y el lote sin plan sin un solo cero inventado.
- Las dieciocho suites SQL y las veintiuna de navegador, más los bancos
  de hidratación, sesión y portada. `tsc`, `eslint` y `build` limpios.

### 2026-10-13 — La portada, la hora que se teclea y las ayudas que no estorban (sin migración)

> **Sin SQL, así que no consume número.** Se habló como «la 71», pero no
> crea ningún archivo en `sql/`. La siguiente migración de verdad será la
> 71. Es la misma regla que obligó a renumerar la 68 como 67.

#### 1. La raíz dejó de forzar la entrada a tickets

`/` redirigía a `/tickets` sin preguntar nada. Para quien no tiene
permiso sobre tickets —un capataz de riego, alguien de desinfección— eso
era entrar a la aplicación por una puerta que no es la suya: una lista
vacía, sin un aviso que lo explicara, y la sensación de que el sistema
está roto.

Ahora `/` es una portada que **no consulta ningún módulo**: sólo el
perfil, que el armazón ya tiene cargado para poner el nombre en la barra.
No hay pantalla a la que se pueda entrar sin permiso porque no hay nada
que pedir.

Vive en `(app)/page.tsx` y no en la raíz del proyecto para que traiga el
armazón: una bienvenida sin menú es una pantalla sin salida. Y la marca
de las dos barras pasa a enlazar a `/`, que es donde todo el mundo busca
el inicio.

Los ocho `redirect('/tickets')` de los guardianes de permiso pasan a
`redirect('/')`, y el middleware también: mandar a alguien a una pantalla
que no es la suya es recibirlo con una lista vacía.

#### 2. La hora se teclea: `EntradaReloj`

Capturar un turno son **seis horas distintas** —preriego, presurización,
inyección y lavado, cada una con inicio y fin—. El `type="time"` nativo
abre en el teléfono una rueda a pantalla completa que tapa el formulario,
pide dos gestos por cifra y en Android obliga a pasar por AM/PM aunque el
turno se anote en reloj de 24 horas. Seis ruedas es medio minuto de
gestos para algo que se teclea en diez segundos.

Y la captura se hace **con una mano**, de pie en el lote, a veces con
guantes.

```
0 8 3 0  →  08:30
7 4 5    →  07:45   (una sola cifra de hora se completa sola)
8        →  08:00
```

Lo que **no** hace: recortar. «2500» no se guarda como 23:59 — se
descarta. Un 23:59 inventado es una hora que nadie escribió y que nadie
va a revisar; un hueco al menos se ve.

#### 3. Las ayudas bajan a un icono

La explicación de cada campo se escribía debajo, en gris pequeño. Dicha
una vez aclara; repetida en diecisiete campos **duplica el alto del
formulario**, y en un teléfono con el teclado subido eso son dos campos a
la vista en vez de cinco.

Y la ayuda se lee **una vez**: quien captura turnos todos los días ya
sabe que el fin puede ser del día siguiente. Lo que necesita a diario es
ver más campos.

Ahora va detrás de una «i» junto a la etiqueta (`components/ui/Ayuda`),
en un globo que sale al `body` con `anclarPanel` para que no lo recorte
el acordeón. `ayudaVisible` deja a la vista los pocos avisos que hay que
leer siempre.

> **`<button>` es un elemento ETIQUETABLE.** El icono vive dentro del
> `<label>` del campo, y el navegador le da la etiqueta al primer
> elemento etiquetable que encuentra: con un `<button>` ahí, **el campo
> se quedaba sin nombre accesible** y tocar el texto dejaba de enfocarlo.
> Es un `span` con `role="button"` por eso, no por capricho.

Y Escape cierra **el globo y nada más**: se escucha en fase de captura y
se para la propagación. Sin eso, pedir una ayuda y cerrarla se llevaba
por delante el formulario entero — perder un turno a medio capturar por
pedir una explicación es el peor intercambio posible.

#### 4. Cada fase del riego, con su total al lado

Los seis relojes y los tres totales caían en una rejilla de dos columnas,
y los totales quedaban al final, lejos de la fase a la que pertenecen. En
el teléfono eran nueve filas, y comprobar si el total de la presurización
cuadraba obligaba a desplazar arriba y abajo.

Ahora cada fase es un marco con **inicio, fin y total en la misma fila**:
si sale un número raro, se ve en el acto cuál de los dos relojes está mal
tecleado.

#### 5. Los paneles que se recortaban

- **La campana de escritorio** se dibujaba dentro de la barra lateral,
  que tiene su propio desplazamiento, así que el panel se recortaba
  contra el borde de la barra. La variante del teléfono ya iba por
  portal; ahora van las dos, colocadas con `anclarPanel`.
- **El selector de lotes de la ejecución**, el del plan y los tres
  catálogos largos de logística pasan a `buscable`: su panel sale al
  `body`. Dentro de un modal, la rueda nativa la recortaba el `overflow`
  del acordeón — no es cuestión de `z-index`, el recorte lo hace el
  padre.

#### Cómo se comprobó

- `treloj.mjs` (**22 verdes**, nuevo): las cuatro cifras, las abreviadas,
  y que una hora imposible se descarte en vez de recortarse.
- `tportada.mjs` (**12 verdes**, nuevo): saluda por el primer nombre,
  lleva marca, lema, versión y crédito, **no toca Supabase ni pide
  permisos**, y ya no queda un solo `redirect('/tickets')` en el código.
- `tdesinf` (**102 verdes**): los relojes tecleados, los tres marcos con
  su total dentro, el globo de ayuda saliendo al `body` y cerrándose con
  Escape **sin cerrar el formulario**, y el panel de lotes fuera del
  modal.
- Las diecisiete suites SQL y las dieciocho de navegador, más los bancos
  de hidratación y de sesión. `tsc`, `eslint` y `build` limpios.

### 2026-10-12 — El congelamiento, encontrado: era la hidratación (migraciones 69 y 70)

#### Lo que estaba pasando

El Vigilante de la 68 hizo su trabajo: **no había bucle de React**. Con
eso descartado, el error que quedaba en la consola era el bueno:

    Uncaught Error: Minified React error #418

El 418 es «Hydration failed». Y la respuesta de React a un 418 **no es un
aviso**: tira el HTML que mandó el servidor y **vuelve a pintar el árbol
entero en el cliente**. Con el armazón arriba y una cuadrícula de miles
de filas debajo, eso es medio segundo largo de bloqueo con la pestaña
sin responder. Se ve exactamente como «se guinda».

Los dos culpables leían cosas del navegador **durante el render**:

```ts
// DataGrid: el pie de totales
const [agregaciones, setAgregaciones] = useState(() =>
  typeof window === 'undefined' ? {} : leerAgregaciones(titulo)   // ← 418
)

// SelectorTema: el icono del botón
if (!montado && typeof window !== 'undefined') {                   // ← 418
  const guardado = temaGuardado()
  ...
}
```

**El `typeof window === 'undefined'` no protege de esto, y ésa es la
trampa.** Durante la hidratación `window` YA existe, así que se toma la
rama del cliente: el servidor había pintado el pie en «Ninguno» y la luna
de «Modo oscuro», y el navegador pintaba la suma guardada y el sol. Dos
marcados distintos en el mismo sitio.

Con el sistema operativo en oscuro —que es lo normal en un teléfono— el
tema fallaba **siempre**. Y `SelectorTema` vive en el armazón, así que
«el árbol entero» era la aplicación entera.

#### El arreglo: `lib/ui/hidratado.ts`

```ts
export function useHidratado(): boolean {
  return useSyncExternalStore(sinSuscripcion, enCliente, enServidor)
}
```

React llama a `getServerSnapshot` en el servidor **y también durante la
hidratación**, y sólo después pasa a `getSnapshot`. Es la API hecha para
esto: sin `setState` en un efecto —que además es error de lint en React
19— y sin un cuadro de parpadeo de más.

Se cambió un cuadro de parpadeo por no repintar la pantalla entera.

#### La sesión muerta: el caso que se escapaba

`esSesionMuerta` reconocía los errores que Supabase marca con código
(`refresh_token_not_found` y compañía) y el middleware los trataba bien.
Pero hay un caso **sin código**: la cookie existe y no se puede leer
—truncada, de otro proyecto, escrita con otra codificación—. Ahí
`getUser` contesta `AuthSessionMissingError`, que es el mismo error que
da un visitante que nunca entró, y se trataba como tal: redirigir al
login **dejando la cookie puesta**.

Eso no se cura solo. Cada petición vuelve a leer la misma basura, vuelve
a no encontrar sesión y vuelve a redirigir, para siempre.

> **La regla que queda**: si el navegador mandó cookies de sesión y
> después de preguntar no hay usuario, esas cookies no sirven. Se borran,
> venga el error que venga. Lo peor que puede pasar es que alguien tenga
> que entrar otra vez; lo que había antes era quedarse fuera sin poder
> volver.

#### El perfil de Jornal (69 y 70)

En Catálogos → Personal sólo se podía marcar «Operador» o
«Administrativo». El jornalero —que es casi todo el personal de
desinfección y riego— no tenía casilla: existía `es_jornal`, pero esa
columna no se ve desde el catálogo ni se puede filtrar.

**Son dos archivos por una regla de PostgreSQL**, no por capricho: un
valor de enum no se puede usar en la misma transacción en que se crea, y
el editor SQL de Supabase manda cada archivo como una sola transacción.

    ERROR: unsafe use of new value "JORNAL" of enum type tipo_perfil

La 69 crea el valor y deja puesto el disparador —cuyo cuerpo no se
resuelve hasta que corre—; la 70 rellena lo que ya existía. **En ese
orden.**

Y las dos columnas se mantienen **en paso en las dos direcciones**:
marcar el perfil enciende `es_jornal` y apagar la casilla quita el
perfil. Dos columnas para un mismo hecho se separan solas, y el día que
se separen el catálogo dirá que alguien es jornal y el selector de
cuadrilla no se lo ofrecerá, con las dos pantallas teniendo razón. La
regla vive en la base y no en React porque el importador de Excel
escribe en la misma tabla.

El disparador respeta **lo que cambió en esta escritura**: si sólo se
tocó la casilla manda la casilla, y si sólo se tocó el perfil manda el
perfil. Sin esa distinción, editar el perfil en la cuadrícula se
revertiría solo al guardar y el usuario vería la celda volver atrás.

#### El filtro de Perfil, que ahora filtra de verdad

La columna guarda un array, y el filtro de la cabecera lo comparaba como
texto. Dos consecuencias, las dos malas:

- Quien es operador **y** jornal valía «Operador, Jornal» —un valor
  suelto que no está en ningún catálogo— y no salía al buscar jornales.
- La lista de casillas se armaba con los valores presentes, así que
  **«Jornal» no se podía elegir hasta que alguien ya lo tuviera**, que es
  justo al revés de lo que hace falta para empezar a clasificar.

`ColumnaTabla` gana `multivalor`: la lista sale del catálogo y una fila
pasa si **contiene** alguno de los marcados.

#### Cómo se comprobó

Las dos cosas se reprodujeron antes de arreglarlas, que es la única
forma de saber que lo arreglado era lo roto:

- **`/tmp/hidraverif`** (**8 verdes**, nuevo): renderiza el árbol con
  `react-dom/server`, lo sirve por HTTP y lo hidrata en Chromium con el
  sistema en **oscuro** y con totales ya guardados. Contra el código de
  antes salían **6 rojas** con el texto de React palabra por palabra:
  «Hydration failed because the server rendered HTML didn't match the
  client. As a result this tree will be regenerated on the client.»
- **`/tmp/authverif`** (**16 verdes**, nuevo): levanta un Supabase falso
  que contesta 400 `refresh_token_not_found` y pasa el middleware REAL
  por él. Contra el código de antes, **2 rojas**: la cookie ilegible
  sobrevivía al redirección y al login.
- `t69.sql` (**12 verdes**, nueva): el valor en el tipo, las dos columnas
  en paso en las dos direcciones, que editar el perfil no se revierta
  solo, y el relleno de la 70 —idempotente— sobre una fila vieja.
- `ttabla.mjs` (**12 verdes**, nuevo): el filtro multivalor, con el que
  es las dos cosas saliendo en las dos listas.
- Las diecisiete suites SQL y las diecisiete de navegador, verdes. `tsc`,
  `eslint` y `build` limpios.

### 2026-10-12 — El ppm sin el lavado, el preriego que se borraba, el área por ciclo (migración 68)

#### 1. El ppm se calculaba con agua que no llevaba producto

El denominador era `(inyección + lavado) × caudal`. El lavado es agua
limpia que se echa **después**, para sacar de la tubería el químico que
quedó dentro: no diluye nada. Sumarla repartía el producto en más agua
de la que lo llevó, y el número salía por debajo del que de verdad pasó
por el gotero.

El error iba en la dirección mala: **un ppm bajo no lo revisa nadie.**

```sql
-- agua = horas_inyeccion × caudal, y se acabó
create function public.fn_ppm_desinfeccion(
    p_litros numeric, p_concentracion text,
    p_horas_inyeccion numeric, p_caudal numeric, p_mz numeric
) ...
```

La de seis argumentos **se suelta**, no se deja viva: `create or replace`
con otra lista de argumentos no reemplaza nada, crea una segunda
función, y a partir de ahí media plataforma sigue calculando con la
fórmula vieja sin un solo error que lo delate. Es la trampa que ya costó
una vuelta con `fn_precio_material`.

`horas_lavado` sigue a la vista en la pantalla y en el desglose, marcado
«no entra»: la pregunta «¿y el lavado?» se la hace todo el mundo y el
desglose tiene que contestarla.

#### 2. El preriego perdía su cuadrilla al guardar

`limpiarPersonal` descartaba los renglones «iguales a la plantilla». Y la
plantilla de un renglón de cuadrilla viene **con todo puesto**: una
persona, puesto Jornal, jornada Diurna, cero horas extras y el salario
mínimo vigente.

Eso no es un hueco: **es la cuadrilla del preriego**, que casi siempre es
exactamente un jornal a mínimo en jornada normal. El renglón que el
capataz llenaba sin teclear nada —porque los valores por omisión ya
decían la verdad— era byte a byte idéntico al renglón en blanco, y se
borraba al guardar. Sin un aviso.

Y la limpieza ya no protegía de nada: desde la 62 la cuadrilla arranca en
`[]` y un renglón sólo existe si alguien pulsó «Agregar personal».
**Pulsar el botón es la afirmación.** Un renglón de sobra se quita con su
propio botón, que es un gesto; borrarlo a sus espaldas no lo es.

#### 3. El área del lote, por ciclo y con su procedencia

`fn_area_regable` sumaba **todos** los ciclos del lote en un número, y
sólo devolvía el área sembrada cuando alcanzaba o pasaba a la
planificada. Un lote con 10 mz de plan y 6 sembradas enseñaba 10: cuatro
manzanas que nadie regó, repartiendo el costo entre un área que no
existe.

`fn_area_lote_ciclo(lote, ciclo)` mira el ciclo y aplica la regla
directa: **si ya se sembró manda lo sembrado; si no, el plan; y si no hay
ni plan ni siembra, el área neta.** `fn_origen_area_lote_ciclo` dice
cuál de las tres fue, porque un área sin su procedencia obliga a adivinar
si se mira un plan o un hecho.

`fn_lotes_regables` gana el ciclo (y suelta la de tres argumentos, por lo
mismo de arriba), devuelve la procedencia, la fecha de siembra y la
variedad — y **se sella por zona**, igual que la 67 hizo con los lotes de
desinfección: también es una RPC de campo que el navegador llama
directamente.

#### 4. Un código, una persona

`operadores.codigo` es con lo que se busca a alguien en campo y con lo que
se cruza la planilla. Sin unicidad, dos altas con el mismo código parten
las horas de una persona en dos fichas y ninguna cuadra. Índice único
**parcial**: varios sin código conviven, que es el estado normal de un
alta a medio llenar.

La migración **normaliza primero** (espacios fuera, vacío a nulo) y, si
quedan duplicados, se corta con la lista dentro del error en vez de
dejar un «no se pudo crear el índice» que no dice cuál.

#### 5. Lo demás del encargo

- **Días negativos en el Excel del plan.** Se cuentan contra la fecha de
  siembra y la desinfección va ANTES de sembrar: un preriego setenta días
  antes es −70, y es el caso normal. Rebotarlo obligaba a planificar con
  el signo cambiado.
- **Calibraciones y CE, cada una en su marco.** Los seis números iban en
  una sola rejilla; en el teléfono salían en una columna donde
  «Calibración salida» quedaba pegada a «CE después» y se leían como la
  misma serie. Son `<fieldset>` de verdad, así que el lector de pantalla
  anuncia la leyenda al entrar en cada campo.
- **«Estacionero» entra en los puestos de cuadrilla**, que hasta ahora
  había que anotar como «Otro» escribiendo el puesto a mano.
- **Alta in-situ de Personal y de Plan nutricional.** El formulario de
  alta salió de `CatalogoTable` a `FormularioCatalogo` y lo abren los dos
  sitios. No es una copia reducida: si mañana la ficha gana un campo
  obligatorio, lo gana en los dos. Sin `router.refresh()` desde la
  captura — rehacer el árbol se lleva por delante lo escrito.
- **El selector de lotes de riego sale del modal.** Es `buscable`, así
  que el panel se manda al `body` con un portal y se coloca con
  `anclarPanel`. Un desplegable dibujado DENTRO de un contenedor con
  `overflow` no se puede salir de él por mucho z-index que se le ponga:
  el recorte lo hace el padre.
- **El área se llena sola al elegir el lote** con la que queda LIBRE, no
  la total, y **no pisa lo escrito a mano**. Un botón de información abre
  la siembra, el área y la variedad del lote.
- **Filtro y columna de Zona en Labores**, sobre `zona_id` de
  `v_labores_control`. Estaba en la vista desde la 57 y no se enseñaba.

#### 6. El congelamiento: lo que se hizo y lo que falta

**No se encontró.** Se descartaron, uno por uno y con pruebas: dos
clientes de Supabase peleándose por el candado de refresco (es
*singleton*), `onAuthStateChange` (no existe en el código), bucles de
redirección en el middleware, los `useEffect` del módulo de desinfección
—el banco se deja quieto diez segundos y no sale ni una petición de
más— y los reajustes de estado durante el render, que comparan cadenas y
no objetos.

En su lugar va **`components/ui/Vigilante.tsx`**, que no adivina: cuenta
repintados y peticiones por segundo y, en cuanto una se dispara, escribe
en la consola **qué tabla o función se está pidiendo en bucle** y se
apaga. Se arma con `?diagnostico=1` en la dirección; sin ese parámetro
no monta nada y no cuesta nada.

Con una línea de esa consola se localiza el efecto en minutos.

#### 7. Las suites de navegador llevaban tres migraciones mintiendo

Al rehacer los números del ppm salió que `tcalc` seguía en verde contra
un `calculo.mjs` **construido el 10 de octubre**. Los módulos que las
suites de Node importan (`calculo`, `excelPlan`, `abac`, `agregacion`,
`hojas`) eran bundles sueltos que nadie reconstruía.

El daño concreto: `tabac` afirmaba que un usuario zonal **sin zonas
asignadas** no se recortaba —el fallo ABIERTO que la 66 selló en la base
y la 67 en el navegador—. Llevaba verde desde entonces contra el código
de antes del arreglo.

Ahora existe `buildLibs.mjs` y se corre antes del barrido.

#### Cómo se comprobó

- `t68.sql` (**26 verdes**, nueva): el ppm sin el lavado y la vieja de
  seis argumentos muerta, las dos vistas rehechas sin perder la reja de
  la 66, el código duplicado rechazado y los sin código conviviendo, el
  área sembrada a medias mandando sobre el plan, y el ciclo separando lo
  que antes se sumaba.
- `t64` y `t65` **actualizadas** a la fórmula nueva, con la cuenta a mano
  escrita al lado. Las dos habían quedado truncando en silencio al
  cambiar la firma, que es cómo se detectó.
- `tppm` (paridad base ↔ navegador): **2.160 combinaciones, 0
  diferencias**. El abanico sigue recorriendo el lavado aunque ya no
  entre, para comprobar que ninguno de los dos lados se lo quedó.
- `triego.mjs` (**23 verdes**, nueva) en Chromium a 390 px: el panel de
  lotes vive en el `body` y entra entero en la pantalla, el área se llena
  con la libre, lo escrito a mano no se pisa, y el globo dice si el área
  es un hecho o una previsión.
- `tdesinf` (**94 verdes**): los cuatro puestos, los dos marcos nuevos
  con sus campos dentro y ninguna CE colada entre las calibraciones, y
  el alta completa de Personal abriéndose desde el selector.
- `tcalc` (**134 verdes**) con el renglón de preriego que ahora SÍ se
  guarda; `tabac` (**30**) con la aserción corregida.
- Las dieciséis suites SQL y las dieciséis de navegador, verdes. `tsc`,
  `eslint` y `build` limpios.

### 2026-10-10 — Parches del Excel, el hotfix zonal y el tablero (migración 67)

Tres cosas que no se parecen entre sí, y la del medio es la que no podía
esperar.

#### 1. El selector de lotes se salía de la zona (**el hotfix**)

`fn_lotes_desinfeccion` es `security definer` —se salta la RLS por
diseño, para poder cruzar siembras y planes— y **no miraba la zona por
ningún lado**. Un jefe de zona norte abría la captura de ejecución y el
desplegable le ofrecía los lotes del sur. La 66 selló las vistas; esta
función no es una vista, y por eso quedó fuera.

El arreglo no es un filtro fijo: la función recibe ahora la **pantalla**
como argumento y recorta según el alcance de ESE permiso.

```sql
and (select public.fn_permitido_de(p_pantalla, 'ver'))
and case (select public.fn_mi_alcance(p_pantalla, 'ver'))
    when 'global' then true
    else (select public.fn_ve_zona_estricta(lt.zona_id))
end
```

Así la granularidad de la 66 sigue viva aquí: el mismo usuario puede ver
todos los lotes en ejecución y sólo los suyos en planificación, porque
son dos permisos distintos. Sin zonas asignadas, **cero lotes** — el
fallo cerrado de la 66, no el abierto de antes.

> **La regla que queda**: toda función `security definer` que devuelva
> filas de campo tiene que recortar por zona a mano. La RLS no la va a
> salvar; es justo lo que se está saltando.

#### 2. La dosis entra en la llave del plan

Un lote no es homogéneo: media parte pide 300 L/mz y la otra 350. Con la
llave vieja (`lote + ciclo + producto`) eso era imposible de planificar
sin inventarse un producto que no existe.

```sql
drop index if exists public.desinfeccion_plan_lote_ciclo_producto_uidx;
create unique index desinfeccion_plan_lote_ciclo_prod_dosis_uidx
    on public.desinfeccion_plan (lote_temporada_id, ciclo, producto_id, dosis_mz)
    nulls not distinct;
```

Lo que **sigue** sin admitir es repetir la misma dosis, que es lo que la
llave viene a evitar. `llaveDePlan` en TypeScript normaliza con
`toFixed(4)`: «300» y «300.0» son la misma línea, no dos.

#### 3. La plantilla pierde dos columnas y gana una

- **Fuera la fecha de siembra y la variedad.** Las dos salen del plan de
  trasplante (`fn_siembras_de_lotes`) al resolver el lote. Pedirlas en el
  Excel era pedir que se copiara a mano un dato que el sistema ya tiene,
  y cada copia a mano es una fecha mal tecleada. El importador las
  precarga por `lote|ciclo` antes de escribir, y **rebota la fila que no
  tenga siembra**: sin fecha de siembra no hay fecha de aplicación.
- **Entra la moneda**, con desplegable HNL/USD. La conversión la hace la
  base con la tasa de **su temporada** (migración 65), no el navegador:

```sql
-- trigger fn_desinfeccion_plan_moneda
costo_litro := costo_origen * public.fn_tasa_de_temporada(temporada_id, ...)
```

  Sin tasa vigente el costo queda en **cero y con aviso**: no se inventa
  una tasa. Y `costo_origen` se conserva al lado, que es lo que permite
  auditar la conversión sin abrir la base.

> **El fallo que esto evita**: 2 USD × 300 L × 5 mz guardado tal cual son
> 3.000 en el presupuesto, cuando de verdad son 79.500. Un presupuesto
> equivocado por un factor de veintiséis y en silencio.

#### 4. El tablero analítico (pestaña 4)

Sustituye al reporte de lista. Cuatro tarjetas, dos gráficos en SVG a
mano —sin librerías, como todo el proyecto— y la tabla de auditoría sobre
`v_desinfeccion_costos`, que hereda la reja estricta de la 66.

**Lo que hay que entender para no leerlo mal, y está escrito en la propia
pantalla**: las tarjetas y los gráficos salen de las ejecuciones y la
logística, que tienen fecha, y por eso el rango de fechas las recorta. La
tabla de auditoría sale del prorrateo de `v_desinfeccion_costos`, que es
**de temporada completa**; recortarla por fecha repartiría la bolsa de
acarreo entre una parte de las manzanas y daría un costo por manzana
inflado. Por eso la zona recorta las dos cosas y la fecha sólo las de
arriba.

Los colores (`#0369a1`, `#16a34a`, `#c2410c`) están **validados con el
script de paletas**, no elegidos a ojo: el par que usaba el reporte viejo
(`#047857` con `#0369a1`) quedaba en ΔE 14, por debajo del piso de 15, y
dos series que un lector con visión plena confunde no son dos series.
Como la separación para daltonismo cae en la banda 6–8, cada pieza lleva
**su nombre y su número escritos al lado** y las porciones van separadas
por un hueco: el color nunca es lo único que distingue.

#### Cómo se comprobó

- `t67.sql` (**18 verdes**, nueva): el selector sellado zona a zona —con
  alcance global, con alcance zonal, sin zonas y sin permiso de ver—, las
  dosis diferenciadas conviviendo y la duplicada rechazada, y la
  conversión de moneda con tasa, sin tasa y con los totales generados.
- `texcelxlsx.mjs` (**30 verdes**) en Chromium, ahora contra **dos**
  ficheros: `plan-campo.xlsx` con las dos dosis del mismo químico en el
  mismo lote, y `fechas-campo.xlsx` sólo para el decodificador de
  seriales, que ya no viaja por la hoja del plan pero sigue vivo para las
  demás plantillas.
- `ttablero.mjs` (**28 verdes**, nuevo) en Chromium a 390 px: las cuatro
  tarjetas, las barras ordenadas de mayor a menor con su valor escrito,
  los tres arcos de la dona con los colores validados, y **la prueba que
  importa** — con un rango de fechas puesto, las tarjetas se recortan y
  la tabla de auditoría NO se mueve.
- `texcelplan.mjs` (**49 verdes**) y las quince suites SQL, verdes.

### 2026-10-10 — Importador de Excel del plan de desinfección (sin migración)

Se salda la deuda que arrastraba el módulo desde la 59. **Sin SQL:** la
pantalla `desinfeccion_plan` ya nació con la acción `importar` en la 66 y
la tabla ya tenía su llave natural desde la 60. Todo lo nuevo es
TypeScript.

#### Sólo el plan, y por qué

La ejecución y la logística se capturan **en vivo**: el turno abierto, el
candado por fase, los autocálculos y el guardado incremental. Meterles un
Excel por la puerta de atrás sería saltarse el embudo entero que las
migraciones 60–62 construyeron. El plan es lo contrario: se arma de una
sentada, un lote por renglón, cien renglones. Eso es lo que un importador
resuelve de verdad.

#### Qué se hizo

- **`lib/desinfeccion/excel.ts`** — puro, sin React ni Supabase: las diez
  columnas con sus alias, la interpretación fila a fila, la llave natural
  y el reflejo de la fecha de aplicación generada.
- **`components/desinfeccion/ImportarPlan.tsx`** — monta `ImportarHoja`,
  el mismo importador que usan trasplante, riego, rotación y telecom. Que
  sea el mismo no es ahorro de código: es que quien ya importó turnos de
  riego no tiene que aprender otro gesto.
- **Plantilla con validación nativa**: los lotes, ciclos, variedades y
  productos salen de la BASE como desplegables de Excel. Sin eso vuelve
  una hoja con «Guanacaste» y otra con «guanacaste», y el importador
  rebotando filas por una tilde.
- **El botón, gobernado por `desinfeccion_plan:importar`** — su pantalla
  granular y **su acción**. No cuelga de «crear»: quien puede escribir
  una línea a mano no necesariamente puede meter cien de un archivo que
  nadie ha revisado. Y sin permiso **no se dibuja**, no se pinta en gris.

#### Dos decisiones que no son obvias

- **El costo por litro vacío NO es cero.** Vacío quiere decir «lo toma
  del historial de precios del material», que es lo que hace el
  disparador. Mandar un cero sería decidir que el químico es gratis. Un
  cero escrito a mano sí es un cero, y se respeta.
- **La llave es lote + ciclo + producto** (la de la base desde la 60): si
  la hoja repite una línea, se **actualiza**. Insertarla otra vez la
  rechazaría la base con un error de llave duplicada a mitad del lote, y
  la importación quedaría hecha a medias.

#### Cómo se comprobó

- `texcelplan.mjs` (**36 verdes**, nuevo): las validaciones una a una, el
  costo vacío, la llave natural y el cruce de textos con el catálogo.
- `texcelxlsx.mjs` (**22 verdes**, nuevo) **en Chromium**, que es donde
  esto se puede probar de verdad —`leerXlsx` usa `File`, `DOMParser` y
  `DecompressionStream`—:
  - La plantilla generada es un ZIP válido, con `dataValidation` de tipo
    lista apuntando a nombres definidos, y los lotes de la base dentro.
  - **El viaje de ida y vuelta con un .xlsx como los del campo**, con la
    fecha en serial numérico y en dos formatos: uno de fábrica (14) y uno
    propio del libro (165, `dd/mm/yyyy`). Serial 46357 → `2026-12-01`;
    46402 → `2027-01-15`. Si no se mirara `xl/styles.xml`, esas celdas
    llegarían como el número y la fila rebotaría entera.
- `tplanabac.mjs` (**10 verdes**, nuevo): dos cuadrículas reales, las
  mismas reglas salvo `importar`. El botón aparece en una y **no existe**
  en la otra, y las dos pueden «crear» — que es la prueba de que son
  acciones distintas.
- Las catorce suites SQL y las dieciséis de navegador, verdes.

### 2026-10-10 — ABAC granular y el sellado de la fuga zonal (migración 66)

#### 1 · La fuga zonal era real, y era mía

Había **cuatro** formas distintas de colarse, y la plataforma tenía las
cuatro conviviendo. No fallaba `fn_mi_alcance` ni el `case`: fallaba cómo
estaba escrita la rama zonal.

1. **`else true`** — la rama zonal no filtraba nada.
   `v_desinfeccion_ejecucion` y `v_desinfeccion_personal`: un usuario
   zonal veía todos los turnos de la finca.
2. **`else true or not fn_tiene_zonas() or (…)`** — peor, porque *parece*
   que filtra. El `true or` cortocircuita y el predicado zonal es código
   muerto. Seis vistas, entre ellas las de avance y costos. Viene del
   bucle de la 61: sin columna de dueño el generador escribía `true` en
   su sitio y lo pegaba con `or`.
3. **`not fn_tiene_zonas()`** — un usuario con alcance zonal al que nadie
   le asignó zonas veía todo. El fallo abierto tiene sentido en las
   policies viejas; en una rama que **sólo** se alcanza con alcance zonal
   está exactamente al revés.
4. **La peor, y la última en aparecer: las ESCRITURAS.**
   `fn_verificar_permiso` resuelve el eje zonal con
   `p_dueno = auth.uid() or fn_ve_zona(p_zona)`, y **casi ningún sitio le
   pasaba la zona**. Con `p_zona` nulo `fn_ve_zona` contesta que sí, así
   que el eje zonal de todas las escrituras estaba desactivado: un
   usuario zonal podía editar una fila de otra zona.

**Sellar las vistas no sella nada si las tablas siguen abiertas.** Una
vista es una comodidad; PostgREST deja consultar la tabla y ahí quien
manda es la RLS. Por eso la 66 toca las dos puertas.

El arreglo: `fn_ve_zona_estricta` y `fn_ve_lote_estricto`, que fallan
CERRADAS (sin zonas asignadas, o con zona nula, devuelven falso), y
`fn_verificar_permiso_zonal`, que delega permiso y condición en la de
siempre y le suma la zona estricta. `fn_ve_zona` y `fn_verificar_permiso`
**no se tocan**: las usan las policies de la 41 y la 42 con el fallo
abierto a propósito, y endurecerlas a ciegas dejaría fuera a gente de
módulos que aquí no se pueden probar.

Las rejas de las 24 vistas expuestas se regeneran desde **una tabla de
decisiones** —una fila por vista, con su pantalla y su recorte—. Escribir
24 rejas a mano es lo que dejó cuatro formas de colarse sin que nadie las
viera juntas; en una tabla se ven juntas.

#### 2 · Pantallas granulares

`desinfeccion` → `desinfeccion_plan` · `_ejecucion` · `_logistica` ·
`_reporte`. `trasplante` → `trasplante_plan` · `trasplante_diario`.

Los permisos del padre se **copian** a cada hija con su mismo alcance y
su misma condición antes de borrar el padre: nadie pierde acceso al
correr el script. Quitar lo que sobre es un segundo paso del
Administrador.

La matriz de `/admin/permisos` **no hizo falta tocarla**: se dibuja desde
`public.pantallas`, así que se partió sola. Es la promesa de la 43
cobrándose sola.

#### 3 · Lo que casi se rompe en silencio

`fn_siembras_de_lotes` (la que salva el DDT) comprobaba el permiso
nombrando las dos pantallas padre. Al partirlas se habría quedado muda y
el DDT volvería a «—». **Partir una pantalla obliga a buscar su nombre en
TODO el SQL**, no sólo en la tabla de permisos. Hay dos guardianes nuevos
para eso.

#### Cómo se comprobó

- `t66.sql`: **28 verdes**, y con usuarios de verdad —no mirando el texto
  de la vista, que es lo que engañaba—. Un zonal no ve ni escribe en la
  otra zona; sin zonas asignadas no ve nada; una fila con zona nula no la
  ve nadie; el Administrador no nota el cambio.
  Las pruebas de escritura van con `set role authenticated`: **el
  superusuario se salta la RLS entera** y las habría dado todas por
  buenas.
- `t42_52` y `t53`–`t65`: las catorce suites verdes. Varias se parcharon
  donde la 66 cambió la regla a propósito.
- `tdesinf` (83), `tcalc` (134) y las demás, verdes. El banco de pruebas
  tuvo que pasar a las cuatro llaves nuevas, que es la prueba de que la
  pantalla de verdad las pide.

#### Deuda, escrita y no escondida

La migración IMPRIME por `raise notice` las tablas que siguen resolviendo
el alcance zonal sin pasar la zona. Hoy queda **`tickets`**. Una deuda
que se ve es una tarea; una que no, es un agujero.

#### Qué cambia de comportamiento

- Zonal **sin zonas asignadas** pasa de verlo todo a no ver nada. Si
  alguien se queda con la pantalla en blanco, mirar sus zonas en
  `/admin/usuarios`.
- La rama zonal ya **no** incluye «o lo que yo capturé». Zonal es zonal;
  para «sólo lo mío» está el alcance propietario.
- Una fila con zona nula no la ve ningún usuario zonal. Son datos
  incompletos y hay que completarlos.

### 2026-10-10 — Historial de tasas, y las ppm sobre la dosis (migración 65)

#### 1 · La tasa de cambio, con vigencias

La 64 la puso como columna suelta en `temporadas`: un número por
temporada y sin memoria. Pero el lempira se mueve dentro del año, y un
químico comprado en marzo tiene que cuadrarse con la tasa de marzo
aunque en octubre sea otra — corregir la columna reescribiría en silencio
el costo de todo lo ya capturado.

`historial_tasas_temporada` con RLS, el mismo patrón que las tarifas de
puesto y los precios de material. `fn_tasa_de_temporada` busca, en orden:
la vigencia que cubre el día, la última que empezó antes (una tasa vieja
es peor que una nueva pero mucho mejor que un hueco), el catálogo de la
59, y nulo.

La columna de la 64 se **muda** al historial antes de desaparecer: quien
ya la escribió no puede perderla por un cambio de forma de la tabla. Y se
retira, porque dos sitios donde escribir la misma tasa es la ambigüedad
que un día deja un costo convertido con la equivocada. En la pantalla,
sub-panel `TasasTemporada` igual al de precios: si los dos paneles se
parecen, el gesto se aprende una vez.

#### 2 · La `ppm` manual se retiró

De la tabla, de la vista, de la cuadrícula y del formulario. La cabecera
ahora trae `ppm_principal`: las del producto que **más pesa** del turno,
que no es lo mismo que un promedio — promediar el desinfectante y el
ácido daría un número que no es la concentración de ninguno de los dos.

#### 3 · Las ppm parten de la dosis por manzana

    dosis_mz        = litros / manzanas del turno
    producto_puro_L = dosis_mz × (I.A.% / 100)
    ppm             = producto_puro_L × 1000 / agua_total_m³

**⚠ Esto NO es el mismo número con otro nombre.** Es el de la 64 dividido
entre las manzanas del turno: en uno de 10 mz, diez veces menor. La nota
dimensional está en §4 y en la cabecera de la migración. Se implementó lo
pedido —la fórmula sale de la hoja de los agrónomos, que saben qué mide
su caudal— y queda escrito dónde mirar si el número sale bajo.

`fn_ppm_desinfeccion` gana un sexto argumento y **se suelta la de cinco**:
dejar las dos vivas haría que media plataforma siguiera calculando con la
fórmula vieja sin avisar, que es la trampa que ya costó una vuelta con
`fn_precio_material`.

#### Cómo se comprobó

- `t65.sql`: 23 verdes. Las vigencias de la tasa, que fuera de toda
  vigencia mande la última anterior, que antes de la primera no se
  invente ninguna, y la cuenta de ppm a mano (100 L en 10 mz al 42 % con
  60 m³ = **70 ppm**), más la prueba de que **con una sola manzana vuelve
  a dar los 700 de la 64** — que es la forma exacta de ver qué cambió.
- `t42_52` y `t53`–`t64`: todas verdes. `t64` se parchó donde la 65 cambió
  la regla a propósito.
- **Paridad de ppm con la variable nueva**: 2.160 combinaciones contra
  `fn_ppm_desinfeccion` real, 0 diferencias.
- `ttasas.mjs` (14 verdes, nuevo) para el panel de tasas en Chromium a
  390 px, incluido que una tasa de **cero** no se cuele.
- `tcalc` (134) y `tdesinf` (83), con el desglose derivando de la dosis.

#### Lo que NO se hizo

El importador de Excel del módulo. Sigue pendiente.

### 2026-10-10 — El caudal, la tasa de la temporada y las ppm (migración 64)

#### 1 · El costo del químico «no reaccionaba» — y la causa estaba en la base

El autocompletado SÍ estaba conectado desde la 62 (`elegirProducto` →
`fn_precio_material`), con su prueba en Chromium. Lo que fallaba es que
la función **devolvía nulo** y la pantalla, que no rellena con nulos, se
quedaba quieta.

Por qué devolvía nulo: convertía los dólares con `fn_tasa_cambio`, que
lee `catalogo_tasas_cambio` — una tabla de la 59 que **en la instalación
está vacía**. La tasa que la finca registra a mano es la de la temporada.
Ahora hay `temporadas.tasa_hnl_usd` y `fn_tasa_de_temporada`, con este
orden: la tasa de la temporada (manda), el catálogo de la 59 (por si
alguien lo alimenta, que es más fino: una tasa por fecha), y nulo. **No
se inventa un 25**: una tasa inventada costea en silencio toda una
temporada.

`fn_precio_material` gana un tercer argumento opcional con la temporada
—la fecha sola no desempata dos temporadas solapadas— y el disparador
se lo pasa, porque él sí la conoce.

**Trampa que costó una vuelta:** `create or replace function` con un
argumento de más NO reemplaza, crea una segunda función. Con las dos
vivas, `fn_precio_material(x, y)` deja de resolverse —«function is not
unique»— y se caen el disparador y la pantalla a la vez. Hay que soltar
la vieja, y antes las vistas que la nombran.

#### 2 · Y cuando no hay precio, ahora lo DICE

Ésa era la mitad del problema que ninguna migración arreglaba: la celda
se quedaba en blanco y las tres causas —el material no tiene precios,
los tiene pero ninguno cubre esa fecha, está en dólares y falta la tasa—
tenían el mismo aspecto y tres arreglos distintos.
`fn_precio_material_detalle` devuelve el precio **y el motivo**, y la
pantalla lo escribe. Un hueco explicado es una tarea; un hueco mudo es
una llamada de teléfono.

#### 3 · El caudal y las partes por millón

`desinfeccion_ejecucion.caudal_agua` (m³/h, 20 por omisión, editable).
Es exactamente lo que la 59 dijo que faltaba cuando dejó `ppm` como
captura a mano.

    agua_total_m3   = (horas_inyeccion + horas_lavado) × caudal
    producto_puro_L = litros × (I.A. % / 100)
    ppm             = producto_puro_L × 1000 / agua_total_m3

**Por qué no hay ningún ×1.000.000:** un metro cúbico de agua pesa un
millón de gramos y un cc de producto pesa aproximadamente uno, así que
los cc por m³ YA son partes por millón. El ×1000 es sólo de litros a cc.

Las ppm van **por producto y no por turno**: el ácido y el desinfectante
de la misma aplicación llevan concentraciones distintas, y un solo número
no sería de ninguno de los dos. `concentracion` es texto en el catálogo
(«42 %», «1,3%»), así que hay una función —`fn_numero_de_texto` y su
espejo `numeroDeTexto`— y **no se asume 100** cuando falta: un producto
sin concentración declarada no es producto puro, es un producto del que
no se sabe la concentración.

La vista `v_desinfeccion_productos` guarda las CINCO piezas del cálculo y
no sólo el resultado, y el botón «Ver cálculo PPM» abre la tabla con los
diez renglones. Un número que no se puede auditar no se discute: se cree
o no se cree.

#### Cómo se comprobó

- `t64.sql`: 28 verdes. La conversión USD→HNL con la tasa de la temporada,
  la precedencia frente al catálogo de la 59, los tres motivos del hueco,
  y las ppm con la cuenta hecha a mano (100 L al 42 % en 60 m³ = 700 ppm).
- `t42_52` y `t53`–`t63`: todas verdes sobre la base hasta la 64.
- **Paridad nueva de ppm**: 720 combinaciones contra `fn_ppm_desinfeccion`
  real, 0 diferencias, más el parseo del porcentaje (7/7).
- `tcalc` (132) y `tdesinf` (81), con el caudal, las ppm vivas —cambiar el
  caudal las mueve—, el desglose completo y el aviso del precio sin tasa.
- Paridad de horas y cuadrilla: 1.152 y 192, 0 diferencias.

#### Lo que NO se hizo, a propósito

- La columna `ppm` de la cabecera sigue siendo captura manual. Ahora que
  la calculada por producto existe, queda sin oficio: se retira cuando la
  finca confirme que el número nuevo cuadra con el suyo. Se relabeló como
  «ppm (captura manual)» para que no se confunda con la de abajo.
- El importador de Excel del módulo. Sigue pendiente.

### 2026-10-10 — El DDT que salía «—», los catálogos que faltaban (migración 63)

Auditoría de la 62 en la finca. El SQL había entrado bien; faltaba la
pantalla con la que se usa, y el DDT estaba roto por abajo.

#### 1 · El DDT salía siempre «—» (y la cuenta iba al revés)

**No era un fallo de React.** La pantalla preguntaba bien y la base
contestaba vacío: `fn_siembras_de_lotes` leía sólo `siembras`, que es la
captura DIARIA de trasplante —lo ya sembrado—. Pero **la desinfección se
hace ~70 días ANTES de trasplantar**: cuando se aplica en octubre, la
siembra de diciembre no existe en esa tabla y nunca va a existir. El dato
que hace falta es el del PLAN (`planes_siembra`).

La 63 hace que la función mire las dos fuentes con la precedencia
natural —lo hecho manda sobre lo planeado— y devuelva `origen`
(`'real'` / `'plan'`), para que la pantalla pueda decir «previsto»: un
plan todavía se puede mover y una siembra capturada ya no.

**Y el signo estaba invertido.** `ddt()` restaba `siembra − fase` y
devolvía 69 donde el encargo pide **−69**. Ahora es `fase − siembra`:
negativo quiere decir que todavía falta para trasplantar, que es el caso
normal al desinfectar. El signo es la mitad del dato — «69 días» y «−69
días» son situaciones opuestas, y sin el signo son el mismo texto. La
etiqueta pasa de «días antes del trasplante» a «días desde el
trasplante», que es lo que el número mide.

No hacía falta tocar la reactividad: el efecto ya depende de
`lotesDelTurno`, que es una CADENA derivada de los lotes elegidos. Por
eso no hay bucle — un array nuevo en cada render dispararía el efecto sin
parar; una cadena sólo cambia cuando cambia el conjunto de lotes.

#### 2 · Los catálogos que faltaban

- `puestos_trabajo.es_salario_minimo` no tenía columna en la cuadrícula,
  así que **no había forma de marcarlo** — y sin marcarlo, la cuadrilla no
  proponía salario. Ya está, como casilla.
- `materiales` no enseñaba `ingrediente_activo` ni `concentracion`.
  Añadidas.
- **El historial de precios no tenía pantalla ninguna.** Un material no
  tiene un precio: tiene una sucesión de precios con sus vigencias, y eso
  no cabe en una celda. Se resolvió con un sub-panel maestro-detalle por
  fila (`PreciosMaterial`), con su propia `TablaAvanzada` —filtros,
  orden, edición en celda, borrado en masa— más un alta con moneda,
  precio, desde y hasta. El «precio vigente hoy» que enseña arriba **no
  lo calcula el panel**: se lo pregunta a `fn_precio_material`, la misma
  función que el disparador usa al guardar un costo.

  El enganche es un `detalle?: DetalleCatalogo` en la definición del
  catálogo. Es un NOMBRE y no una función de dibujo porque la definición
  la arma la página en el servidor y cruza serializada: una función no
  cruza.

#### 3 · Marcar el salario mínimo ya no revienta

La 62 puso el índice único parcial pero no dijo qué pasa al marcar el
segundo: saltaba un error de llave duplicada que al de catálogos no le
dice nada. Ahora marcar uno **desmarca al anterior**, con un disparador
en la base y no en React — porque el importador de Excel escribe en la
misma tabla, y una regla que sólo vive en la pantalla se salta sola por
ahí.

#### Cómo se comprobó

- `t63.sql`: 19 verdes. Incluye la cuenta del encargo tal cual —preriego
  2026-10-09 contra siembra prevista 2026-12-17 = **−69 días**—, que lo
  hecho le gane al plan, que las dos fuentes convivan en una respuesta
  sin perder cuál es cuál, que sin permiso de Desinfección ni Trasplante
  no entregue nada, y que marcar un segundo salario mínimo desmarque el
  primero.
- `t42_52`, `t53`–`t62`: todas verdes sobre la base construida hasta la 63.
- `tprecios.mjs` (13 verdes, nuevo) para el panel de precios en Chromium a
  390 px. **Encontró un fallo de verdad:** dejar el precio en blanco
  guardaba un cero, porque `Number('')` es 0 y 0 pasa por «finito y no
  negativo».
- `tcalc` (121) y `tdesinf` (67), con sus asserts del DDT invertidos a
  propósito.
- Paridad contra los disparadores reales: 1.152 horas y 192 cuadrillas,
  0 diferencias.

#### Lo que NO se hizo, a propósito

El importador de Excel del módulo de desinfección y la fórmula de PPM.

### 2026-10-10 — La presurización en reloj y el salario mínimo marcado (migración 62)

**Qué se pidió.** Nueve puntos. **Seis ya se habían entregado el día
anterior en la migración 61** y conviene dejarlo escrito para que nadie
los rehaga: el cruce de medianoche (`fn_horas_entre`), los envases del
químico, el ingrediente activo y la concentración, el historial de
precios con su RLS, `es_jornal` en operadores, la cuadrilla separada por
fase dentro de cada sección y el DDT dinámico en las tres fases. Lo
genuinamente nuevo son tres cosas de base y cuatro de pantalla.

**El hilo que las une: quitar los dos últimos sitios donde un número se
escribía a mano pudiendo calcularse.**

#### Base (`sql/62_desinfeccion_presurizacion_y_salario_minimo.sql`)

1. **La presurización, por reloj.** `inicio_presurizacion` y
   `fin_presurizacion` (time), y `horas_presurizacion` pasa a columna
   generada sobre `fn_horas_entre`. Era la única de las cuatro fases del
   riego que seguía siendo un número escrito a mano, y por eso la única
   que no podía cruzar la medianoche —en un módulo que se trabaja de
   noche—. `total_horas_riego` vuelve a generarse repitiendo las tres
   expresiones: una columna generada no puede leer otra generada.
2. **Fuera `horas_lavado_manual`.** La 61 la había dejado como red para
   no tirar lo ya capturado. Cumplida esa función, dos entradas para una
   sola salida son una ambigüedad que un día cuesta cara. La migración
   **no adivina** horas de reloj a partir del número viejo —«3.5 horas»
   no dice si fue de 22:00 a 01:30 o de 06:00 a 09:30—: cuenta las filas
   que van a perder el dato y lo dice con un `raise notice`.
3. **`puestos_trabajo.es_salario_minimo`.** Reemplaza la búsqueda por
   nombre de `fn_salario_minimo_dia`, que la propia 61 dejó escrita y
   señalada como frágil. Lleva semilla desde el nombre viejo —para que
   quien ya tenía el puesto no se quede sin propuesta— y un índice único
   parcial, porque dos puestos marcados a la vez es una ambigüedad que
   nadie resuelve después. Sin ninguno marcado devuelve **nulo**, no
   cero: el formulario deja el campo vacío y la persona lo escribe.

Sólo se rehace `v_desinfeccion_ejecucion` (cruda y expuesta): es la única
de las siete que nombra las columnas que se van.

#### Pantalla

4. **La cuadrilla arranca VACÍA** (`[]`). El renglón de fábrica
   «1 persona» sugería un dato que nadie había escrito, y en la mitad de
   los turnos —los que se capturan por fases, un día cada una— había que
   borrarlo antes de guardar.
5. **El salario llega ESCRITO, no como texto gris.** Era un
   *placeholder*: parecía un número puesto y lo que se guardaba era un
   vacío. Ahora `lineaPersonalVacia(fase, salario)` lo escribe de verdad
   en el input. Con eso, `limpiarPersonal` necesita saber **con qué valor
   se escribió** para seguir distinguiendo un renglón intacto de uno
   tocado; por eso el salario mínimo se subió de `EjecucionModal` a
   `GridEjecucion`, que es quien guarda.
6. **El selector de químico, siempre con buscador.** `Selector` gana un
   `buscable` que fuerza el panel aunque haya pocas opciones: el catálogo
   de químicos hoy tiene dos productos y mañana treinta, y con el umbral
   el control cambiaba de forma debajo de quien ya se había aprendido el
   gesto.
7. **Elegir el químico trae su precio vigente.** Por `fn_precio_material`
   y con la **fecha de aplicación**, no la de hoy. Es la misma función
   que usa el disparador al guardar, así que el número que se ve mientras
   se teclea y el que queda guardado son el mismo. Sólo rellena si el
   costo está vacío: hay compras puntuales a otro precio.

#### Cómo se comprobó

- `t62.sql`: 17 verdes. Incluye que las **cinco** columnas de horas
  rechacen una escritura, que un puesto llamado «Salario Mínimo» **sin
  marcar** ya no mande, y que no se puedan marcar dos.
- `t61` (41), `t59` (40), `t60` (6) y las suites de la 42 a la 58, todas
  verdes sobre la base construida hasta la 62.
- Paridad contra los disparadores y columnas generadas REALES: **1.152**
  combinaciones de horas y **192** de cuadrilla, 0 diferencias.
- `tcalc` (120) y `tdesinf` (65) en Chromium a 390 px.

#### Lo que NO se hizo, a propósito

El importador de Excel del módulo y la fórmula de PPM, pedidos
expresamente para después. Siguen anotados como deuda.

### 2026-10-10 — La noche, los envases y la cuadrilla por fase (migración 61)

Nueve fricciones de campo auditadas sobre la 60.

**a) Las horas que CRUZAN LA MEDIANOCHE.** Es el arreglo que más pesa.
La 60 calculaba `greatest(fin - inicio, interval '0')`, y eso para un
turno nocturno da **cero**: de 22:00 a 01:00 la resta es negativa y el
`greatest` la aplasta. Era justo el caso que más importa, porque la
desinfección se hace de noche. Peor todavía: un CHECK de la 59 ni
siquiera dejaba GUARDAR un preriego que terminara antes de empezar.

La regla nueva vive en una sola función —`fn_horas_entre`, `immutable`
para que la admitan las columnas generadas— y de ahí la leen las cuatro.
Dos decisiones dentro:

- **La misma hora de inicio y fin son cero horas, no veinticuatro.** Un
  turno de cero horas existe —se anotó y no se trabajó—; uno de
  veinticuatro, no.
- **No adivina turnos de más de un día.** De 22:00 a 21:00 se lee como
  una hora, no como veintitrés. Para eso harían falta fechas, no horas.

El lavado no tenía horas: era un número a mano, así que no podía cruzar
nada. Ahora tiene su par de horas, y **el número viejo no se tira**: se
queda en `horas_lavado_manual` y manda mientras no haya horas. Dos
entradas, una salida y una precedencia explícita es mejor que perder lo
capturado.

**b) Los envases.** `cantidad_envases` y `tipo_envase` en la línea del
químico, no en la cabecera: cada producto llega en lo suyo —el ácido en
canaca y el desinfectante en barril—. El tipo es texto libre y la lista
cerrada vive en la pantalla: con un enum, el día que llegue un envase
nuevo hay que migrar la base y la captura se para.

**c) El catálogo de materiales crece.** `ingrediente_activo` y
`concentracion` —lo que de verdad actúa, para poder comparar dos
productos que se llaman distinto y hacen lo mismo— y una tabla
`historial_precios_materiales` con moneda y vigencia.

**La moneda importa:** el químico se importa, y guardar dólares ya
convertidos a la tasa de hoy es perder el dato original.
`fn_precio_material` convierte con la tasa de **esa** fecha —la de la
59— y devuelve nulo si no hay tasa, en vez de inventar una.

El costo por litro se **copia a la fila** al guardar, como la tarifa del
personal en la 59: si mañana sube el producto, lo ya capturado no cambia
solo. Y **lo escrito a mano manda sobre el catálogo**: hay compras
puntuales a otro precio y el catálogo no puede pisarlas.

**d) El jornal, en el catálogo.** `operadores.es_jornal`. El selector de
cuadrilla sólo ofrece jornales y los enseña como «código - nombre»; el
de maquinaria sigue ofreciendo a todos. Es la misma tabla y hacía falta
distinguirlos.

**e) La cuadrilla, por fase y con salario a mano.** Tres cambios:

- `fase` (`1_Preriego` / `3_Aplicacion`): la cuadrilla del preriego no es
  la de la aplicación —son dos días y dos grupos— y juntarlas obligaba a
  recordar de cuál era cada renglón.
- **Fuera `jornadas`**: una línea es una cuadrilla de un día, y los días
  ya son fases distintas. La fórmula queda
  `personas × (salario + extras × (salario/8) × factor)`.
- **`puesto_id` pasa a `puesto_texto`**: en campo se anota «Supervisor»,
  «Jornal» u «Otro», y obligar a crear un puesto de trabajo para apuntar
  un jornal era pedirle al de campo que administre un catálogo. Lo que
  había se copia al texto antes de soltar la columna.

El salario trae por omisión el mínimo vigente (`fn_salario_minimo_dia`) y
se puede cambiar. **Ese mínimo se busca por NOMBRE** —un puesto que se
llame «salario mínimo»— y conviene saberlo: si alguien lo renombra, el
formulario deja de proponerlo (no calcula mal: deja el campo vacío). El
día que estorbe, lo sólido es una bandera en `puestos_trabajo`, como
`es_jornal`.

**f) Las manzanas que quedan.** `fn_lotes_desinfeccion` da planeadas —del
plan de trasplante— menos lo ya desinfectado. El selector las enseña como
`[planeadas − ejecutadas]` y al elegir el lote **sugiere** lo que queda,
sólo si el renglón está vacío. **No restringe:** el que está en el lote
sabe mejor que el plan cuántas manzanas regó.

**g) El bloqueo prematuro, que era el peor de los nueve.** El acordeón se
cerraba solo **mientras se escribía**: el candado miraba el estado VIVO,
así que terminar de llenar la fecha y la hora cerraba la sección en la
cara de quien estaba capturando. Ahora se decide con una **foto tomada al
cargar** (`seccionesGuardadas`): sólo se bloquea lo que ya venía guardado
de la base. Lo que se está escribiendo ahora no se bloquea nunca.

**h) El selector de «Fase» de la cabecera, fuera.** La fase es una
consecuencia de lo capturado; un selector sólo servía para
contradecirla. Se enseña y no se elige.

**i) El Administrador y las Tarifas.** El encargo dice que no puede.
**Sobre una base construida desde cero no se reproduce**, y está probado:
`fn_permiso_de` devuelve `true` a quien tenga `acceso_total`,
`fn_mis_permisos` le expande las seis acciones de la pantalla, la RLS de
`tarifas_puesto` le deja insertar y editar, y la pantalla lee ese mismo
conjunto (`t61.sql`, sección 6: inserta y edita de verdad).

Así que la 61 **no «arregla» a ciegas** algo que aquí funciona: imprime
el estado real de la instalación con `raise notice` —qué roles tienen
`acceso_total`, qué acciones declara la pantalla, cuántas temporadas hay,
qué roles de la matriz tienen «editar»— para que el aviso diga en cuál de
los cuatro eslabones está. Lo único que repara, porque es objetivo, es
devolverle a la pantalla sus acciones si se hubieran perdido: de esa
lista se expande el permiso del Administrador.

**Sospecha principal, por si el aviso no lo aclara:** la pantalla no
puede guardar **sin una temporada** —`temporada_id` es obligatorio— y sin
ninguna el botón de importar ni siquiera sale.

**Verificado**

| Prueba | Resultado |
| --- | --- |
| **Paridad del costo de cuadrilla**, navegador ↔ disparador, 192 combinaciones | **0 diferencias** |
| **Paridad de las horas**, con los casos NOCTURNOS, 576 combinaciones | **0 diferencias** |
| `t61.sql` — la noche, los precios en dos monedas, la cuadrilla por fase, las manzanas y el administrador | **41 / 0** |
| `t60` · `t59` · `t58` · `t56` · `t55` · `t54` · `t53` · `t42_52` sobre la cadena 61 | **28/0 · 40/0 · 25/0 · 23/0 · 19/0 · 26/0 · 45/0 · 36/0** |
| `tcalc.mjs` | **116 / 0** |
| `tdesinf.mjs` — navegador a 390 px, con el no-bloqueo mientras se escribe | **58 / 0** |
| `tsc --noEmit`, `eslint --max-warnings=0`, `next build` | limpios |

`t59` y `t60` volvieron a tocarse, y es la suite haciendo su trabajo: el
caso «un fin anterior al inicio no resta horas» de la 60 **cambió de
significado** —ahora cruza la medianoche— y los asertos de la cuadrilla
miraban columnas que ya no existen. Los números esperados del costo NO
cambiaron: 2 × 80 siguen siendo 160.


### 2026-10-08 — Guardado incremental, filas fantasma y el DDT en todo el embudo

Sin migración: las dos son de navegador. Salen de una auditoría de la
Fase 2 en campo.

**a) Las filas fantasma bloqueaban el guardado incremental.**

El síntoma: llenar sólo «0 · Lotes y manzanas» y pulsar Guardar
contestaba **«Hay un renglón de personal sin puesto de trabajo»** — un
error sobre una sección que el usuario no había mirado siquiera.

La causa no era la validación, era la plantilla: `LINEA_PERSONAL_VACIA`
traía `jornadas: '1'` de fábrica. La regla «si no hay puesto pero hay
jornadas, avisa» estaba bien escrita; lo que estaba mal es que el renglón
en blanco **ya venía con una jornada puesta**, así que el formulario se
acusaba a sí mismo de haber escrito algo.

Y el fallo de fondo es más grande que ese campo: **el trabajo de campo es
asíncrono.** Se asignan los lotes un día, se riega otro y se aplica un
tercero. Quien guarda con sólo los lotes no está dejando la cuadrilla a
medias: es que todavía no le toca. Un formulario que exige las cuatro
fases de una vez no es estricto, es inservible.

La solución está en `calculo.ts` y son tres funciones de dos líneas:

```
intacta(linea, plantilla)   ¿está tal como nació? (el `id` no cuenta:
                            una fila que ya existe en la base nunca es
                            un hueco)
limpiarLotes / limpiarPersonal / limpiarProductos
```

El renglón en blanco con el que abre cada sub-tabla **no es un dato**: es
dónde escribir. Compararlo campo a campo con su plantilla es la forma
exacta de distinguir «no la tocó» de «la tocó y la dejó a medias».

**Lo que esta limpieza NO hace es tapar un descuido.** Un renglón con
horas extras escritas y sin puesto sí está tocado, y ése sigue avisando.
Lo mismo con litros sin producto. La prueba comprueba las dos caras: que
el hueco pasa y que el descuido no.

La limpieza se aplica **en los dos sitios con la misma función**: antes
de validar y antes de armar el payload. Si una fila bloqueara el guardado
y otra distinta llegara a la base, el error volvería por otro lado.

**b) El DDT, en las tres fases.**

Estaba sólo en las lecturas. La pregunta «¿a cuántos días de la siembra
estoy haciendo esto?» es la misma el día del preriego y el de la
aplicación, y tenerla en una sola fase obliga a calcularla de cabeza en
las otras dos. Ahora va en Preriego, Lecturas y Aplicación, cada una
contra SU fecha, y además en el encabezado plegado de cada sección.

**Con varios lotes sale un RANGO, no un número.** Los lotes de un turno
no se siembran el mismo día, así que un solo número sería mentira la
mitad de las veces: «21 a 25 días» dice de un vistazo que el turno no es
homogéneo, que es justo lo que hay que saber antes de aplicar. Sin
ninguna siembra capturada dice «—» y lo explica; no inventa un número.

Antes se pasaba sólo la siembra más temprana y se perdía esa información
en el camino; ahora viajan todas (`rangoDdt`, `textoDdt`).

**Verificado**

| Prueba | Resultado |
| --- | --- |
| `tcalc.mjs` — incluye el caso exacto reportado: lote puesto, nada más tocado, guarda | **102 / 0** |
| `tdesinf.mjs` — navegador a 390 px, con la prueba de Henry: lote y Guardar | **43 / 0** |
| Paridad del costo del personal · de las horas de riego | **0 · 0 diferencias** |
| `tsc --noEmit`, `eslint --max-warnings=0`, `next build` | limpios |


### 2026-10-08 — Desinfección: multiproducto y reestructura del flujo (migración 60)

La 59 dio por supuestas dos cosas que en campo son falsas: que una
aplicación lleva UN químico y que un lote se planifica UNA vez por ciclo.

**a) Un lote se parte entre productos.** Diez manzanas con Vapam y diez
con Mercenario son dos líneas del MISMO lote y el mismo ciclo. La llave
pasa de `(lote, ciclo)` a `(lote, ciclo, producto)` **con `nulls not
distinct`**, que es lo que impide que esto se vuelva un coladero: sin eso
Postgres considera que dos nulos son distintos y se podrían meter cien
líneas del mismo lote sin producto, que es justo el duplicado que la
llave venía a impedir.

**b) Los químicos salen de la cabecera.** `producto_id`, `litros_acido` y
`costo_litro_acido` eran columnas de `desinfeccion_ejecucion`, así que el
segundo producto no cabía — y añadir `producto_2_id` es cómo empiezan las
tablas con veinte columnas de las que se usan dos. Ahora son
`desinfeccion_ejecucion_productos`, con su RLS heredada de la ejecución
como las otras dos hijas.

Lo que ya estuviera capturado en las columnas viejas **se trae antes de
quitarlas**: perder un costo por un cambio de forma de la tabla es la
clase de pérdida que nadie nota hasta que cuadra el mes.

**La dosis por manzana se DEDUCE, no se captura.** Se anota el total
aplicado y la vista lo divide entre las manzanas del turno. Capturadas
las dos, un día no cuadran y no hay forma de saber cuál es la buena.

**c) La ejecución gana CICLO, y con él el activador.** El formulario
pregunta primero turno y ciclo, y con esos dos o abre el turno que ya
existe o empieza uno. Sin eso, capturar el preriego el lunes y la
aplicación el jueves creaba dos turnos distintos y el costo se partía en
dos sin que nadie lo notara. La llave única `(temporada, turno, ciclo)`
es lo que garantiza que la búsqueda devuelva uno o ninguno — y si al
instalar hubiera duplicados, la migración **dice cuáles** en vez de dejar
que el índice reviente con un mensaje que no indica dónde mirar.

**d) Las horas las calcula la base.** `horas_preriego`, `horas_inyeccion`
y `total_horas_riego` pasan a ser columnas generadas y el campo queda
bloqueado en la pantalla. `greatest(fin - inicio, interval '0')` resuelve
dos cosas a la vez: un fin anterior al inicio no resta horas —un turno de
duración negativa no existe— y, como `greatest` ignora los nulos, una
hora todavía sin capturar cuenta como cero en vez de anular la suma
entera.

`total_horas_riego` no se pudo convertir en sitio: una columna normal no
se vuelve generada con un `alter`, hay que quitarla y volver a ponerla —
y antes hay que tirar las vistas que la nombran.

**e) La fase 2 tiene su propio día.** Se riega un día y se leen los
tensiómetros otro; con una sola fecha, el DAT de la lectura salía del día
del preriego. `fecha_lecturas` es nueva.

**f) La estación de riego gana zona.** El encargo pide recortar por zona
los tres selectores del módulo. Turno y lote ya sabían en qué zona están;
la estación no tenía dónde guardarlo. Nace **nula** a propósito, y una
estación sin zona la sigue viendo todo el mundo: el día que se instala la
migración ninguna tiene zona, y esconderlas todas dejaría el módulo sin
poder capturar hasta que alguien entre a Catálogos.

**g) De dónde sale la siembra.** Al elegir el lote, el plan rellena solo
la fecha de siembra y la variedad. Ese dato vive en `siembras`, que se lee
con el permiso de **Trasplante** — que quien planifica una desinfección
no tiene por qué tener. `fn_siembras_de_lotes` es `security definer` y
**comprueba el permiso ella misma**: sin esa comprobación sería un
agujero por el que cualquiera leería la siembra de toda la finca. Eso
cierra además el reparo que quedó abierto en la entrega anterior, donde
«Sincronizar» leía `siembras` a pelo y se quedaba corto en silencio.

Los días a la aplicación siguen siendo **a mano**: eso lo decide el
agrónomo. Y el autollenado **no pisa lo escrito** — si alguien corrigió
la fecha a propósito, no se la puede deshacer — y **dice** lo que rellenó:
un campo que cambia solo y en silencio es un campo que nadie vuelve a
mirar.

**El embudo, reordenado**

```
ACTIVADOR  turno + ciclo        ← fuera del acordeón; busca o empieza
  0 · Lotes y manzanas          ← bloquea a las demás
  1 · Preriego        fecha propia · duración automática
  2 · Lecturas        fecha propia · DAT automático · dos puntos precargados
  3 · Aplicación      horas automáticas · químicos con dosis deducida
      Cuadrilla                 ← intacta, como pedía el encargo
```

**El paso 0 bloquea y no es una formalidad:** el químico y la cuadrilla
se reparten entre los lotes del turno por manzanas, así que sin manzanas
no hay entre qué repartir y el costo se queda en el aire.

**Lo ya capturado se abre plegado y bloqueado**, con su propio botón de
Editar, y el acordeón abre por la **primera sección vacía**: quien vuelve
al día siguiente no viene a mirar lo que ya hizo, viene a seguir donde lo
dejó. Las dos lecturas de siempre —«Tensiómetro 12» y «Tensiómetro 24»—
vienen precargadas porque lo que se escribe a mano cada vez acaba escrito
de cinco maneras distintas y después no se puede agrupar.

**Verificado**

| Prueba | Resultado |
| --- | --- |
| **Paridad del costo del personal**, navegador ↔ disparador, 288 combinaciones | **0 diferencias** |
| **Paridad de las horas de riego**, navegador ↔ columna generada, 108 combinaciones | **0 diferencias** |
| `t60.sql` — multiproducto, turno+ciclo, horas generadas, químicos, dosis, la siembra y la reja | **28 / 0** |
| `t59` · `t58` · `t56` · `t55` · `t54` · `t53` · `t42_52` sobre la cadena 60 | **40/0 · 25/0 · 23/0 · 19/0 · 26/0 · 45/0 · 36/0** |
| `tcalc.mjs` — cuentas, embudo, recortes, validación | **85 / 0** |
| `tdesinf.mjs` — navegador a 390 px: activador, paso 0, autocálculos, candado por fase | **37 / 0** |
| `tsc --noEmit`, `eslint --max-warnings=0`, `next build` | limpios |

`t59` tuvo que tocarse en dos sitios, y eso es la suite haciendo su
trabajo: sus asertos del químico miraban la columna de la cabecera —el
número esperado no cambia, 100 L a 15 siguen siendo 1500, cambia dónde se
guarda— y contaba seis vistas donde ahora hay siete.

**Sigue pendiente** el importador de Excel del módulo, anotado en la
entrega anterior.


### 2026-10-08 — Desinfección de suelo: las pantallas (Fase 2, sin migración)

El módulo de la 59 ya se usa. Cuatro pestañas en `/controles/desinfeccion`
—Planificación, Ejecución, Logística y Reporte—, todas sobre el `DataGrid`
de siempre y todas decidiendo **por fila** con `canExecuteAction`.

**El embudo de captura es un acordeón, y eso no es decoración.** Un turno
de desinfección son más de treinta campos en cuatro bloques distintos.
Puesto en un formulario plano, en un teléfono es una tira interminable en
la que nadie sabe por dónde va. Partido en cuatro secciones plegables
—datos base y preriego · lecturas · aplicación · lotes y cuadrilla— se ve
el índice completo de un vistazo y se abre sólo lo que toca ahora.

Tres decisiones del acordeón:

- **Una sección abierta a la vez.** Con las cuatro abiertas vuelve a ser
  la tira que se venía a evitar.
- **El contenido se oculta, NO se desmonta.** Plegar una sección por error
  no puede borrar lo que se llevaba escrito, y la validación tiene que
  poder mirar dentro de lo cerrado.
- **El encabezado dice lo suyo estando cerrado** («3 lotes · 12.40 mz»).
  Si no, plegar es esconder información en vez de ordenarla.

Cuál se abre sola la decide la FASE del turno: quien entra a uno que está
en preriego viene a capturar el preriego, no a mirar las calibraciones.

**La vista previa del costo NO es el costo.** El costo del personal lo
pone el disparador de la base; el formulario enseña el mismo cálculo con
la tarifa que devuelve `fn_tarifa_puesto`, para que quien captura vea lo
que va a costar antes de guardar. Dos implementaciones de una fórmula son
dos números, así que **se comprueban una contra otra**: las 288
combinaciones de (personas × jornadas × horas extras × jornada × tarifa)
se generan con el disparador real y se recalculan en el navegador. Cero
diferencias. Es la misma regla de paridad que la 56 fijó para el ABAC,
aplicada al dinero.

La tarifa se pide por `fn_tarifa_puesto` y **no** con un `select` a
`tarifas_puesto`: esa tabla se lee con el permiso de Costos o de Tarifas,
y quien captura en campo no suele tenerlo. La función es `security
definer` y está concedida a `authenticated` justamente para esto.

**El candado de fase es convención de PANTALLA, no seguridad.** Un turno
en «3. Aplicación» no se corrige de pasada: la celda no se edita y el
formulario sale con los campos bloqueados y un interruptor visible para
abrirlos. Pero **la base no bloquea nada por fase** —desinfección no
cuelga de un ticket, así que no tiene el tope de NOTIFICADO— y eso está
escrito en `faseCerrada`. El navegador nunca concede: sólo esconde. El
día que esto tenga que ser una regla de verdad, va en RLS.

**«Sincronizar» es a mano y sobre una selección.** La
`fecha_siembra_congelada` se copia a propósito al planificar (§3, la 59):
si la siembra se mueve, el plan no se mueve solo. Pero a veces se movió de
verdad, y re-planificar es una DECISIÓN. El botón la toma sobre las líneas
marcadas, avisa de que va a mover la fecha de aplicación, y dice cuántas
líneas no pudo resolver —porque no hay siembra registrada, o porque quien
mira no ve Trasplante—. Lo que no hace es decir «listo» sin haber
cambiado nada.

**El reporte: las tres piezas, siempre.** Químico, mano de obra y
logística absorbida se enseñan aunque alguna vaya en cero, porque un total
sin desglose no se audita y nadie firma lo que no puede auditar. El costo
por manzana del total es **ponderado** —total entre manzanas—, no la media
de los promedios: el lote de media manzana no pesa lo mismo que el de
doce. Dos gráficos SVG a mano, sin librerías, por lo de siempre: esto se
imprime.

**Un fallo mío que encontró la prueba, y que conviene recordar.** Al
guardar una ejecución se borran los renglones que ya no están, y la
primera versión los comparaba contra los identificadores del FORMULARIO.
Un renglón recién creado todavía no tiene identificador, así que se
insertaba y, dos líneas más abajo, se borraba por «sobrante». Ahora se
compara contra los identificadores que quedaron VIVOS —los nuevos
incluidos—, y esa cuenta vive suelta y probada en `idsSobrantes`.

El orden de guardado tampoco es casual: cabecera → se añade y se corrige
lo que cuelga → **y al final** se borra lo que sobró. Borrar primero es
más corto de escribir y mucho peor: una desconexión a mitad dejaría el
turno sin los lotes que sí tenía. Así, lo peor que queda es un renglón de
más, que se ve y se corrige. (La 59 no dejó una función que guarde
cabecera y detalle en una sola transacción; el día que se escriba, esto
se simplifica.)

| Archivo | Qué |
| --- | --- |
| `lib/desinfeccion/tipos.ts` | Las formas de las seis vistas y de los tres formularios. Todo en texto: un `number` obliga a decidir qué es un campo vacío, y las dos salidas mienten. |
| `lib/desinfeccion/calculo.ts` | **Puro.** El costo del personal, los totales del plan, las horas sugeridas, el candado de fase, `idsSobrantes` y la validación. |
| `lib/desinfeccion/repositorioCliente.ts` | Lee y escribe. No valida y no decide quién puede. |
| `components/ui/Acordeon.tsx` | **Nuevo**, genérico. |
| `components/ui/Modal.tsx` | Gana `ancho`; en el teléfono no cambia nada. |
| `components/desinfeccion/*` | Las cuatro pestañas, los tres formularios y los dos gráficos. |
| `components/ui/AppShell.tsx` | Entrada en Controles, junto a Riego: se ejecuta sobre el turno de riego. |

**Verificado**

| Prueba | Resultado |
| --- | --- |
| **Paridad del costo del personal**, navegador ↔ disparador, 288 combinaciones | **0 diferencias** |
| `tcalc.mjs` — las cuentas, el candado, los sobrantes, la validación | **56 / 0** |
| `tdesinf.mjs` — navegador a 390 px: acordeón, desbordes, vista previa, candado, reporte | **29 / 0** |
| `t59` · `t58` · `t56` · `t55` · `t54` · `t53` · `t42_52` | **40/0 · 25/0 · 23/0 · 19/0 · 26/0 · 45/0 · 36/0** |
| `tsc --noEmit`, `eslint --max-warnings=0`, `next build` | limpios |

**Lo que NO lleva, y hay que decirlo**

El módulo **no tiene importador de Excel**. Exporta —el `DataGrid` lo trae
de serie, con su casilla de «exportar»— pero la regla de la casa dice
import **y** export para todo módulo de captura, y eso queda pendiente. Se
anota aquí para que no se pierda: tres importadores (plan, ejecución y
logística) con sus desplegables de catálogo, como los de trasplante.

### 2026-10-08 — Desinfección de suelo: el núcleo (migración 59)

Fase 1 del módulo: las tablas, su RLS, los cálculos que no pueden quedar
en el navegador y las vistas con su reja. Sin pantallas todavía.

**La forma: maestro-detalle sobre el TURNO de riego.**

```
PLAN         qué se va a aplicar, lote por lote, con su costo previsto
EJECUCIÓN    lo que pasó, en tres fases sobre un turno de riego
  └ LOTES    qué lotes tocó ese turno y cuántas manzanas de cada uno
PERSONAL     la cuadrilla de esa ejecución
LOGÍSTICA    la bolsa de acarreo de la zona
```

Un turno riega **varios** lotes, así que los lotes regados son una tabla
y no tres columnas — con columnas, el cuarto lote no cabe.

**Tres decisiones que no son obvias**

- **`fecha_siembra_congelada` se copia, no se referencia.** Si la siembra
  se mueve, el plan de desinfección no debe moverse solo: ya se compró el
  producto y ya se cuadró la cuadrilla. Que las dos fechas se separen es
  información, no un error que corregir.
- **Los totales del plan son columnas generadas** (`fecha_aplicacion`,
  `total_litros`, `total_costo`, `costo_mz`). Un total calculado en el
  navegador acaba distinto del del reporte, y nadie sabe cuál es el
  bueno. La prueba comprueba que ni un `update` directo puede falsearlos.
- **La bolsa de logística NO se reparte al guardar, sino al leer.** Si se
  repartiera al guardar, agregar un lote a la zona obligaría a recalcular
  hacia atrás todo lo ya repartido.

**El prorrateo zonal, en `interno.v_desinfeccion_costos_crudo`**

Las tres piezas del costo de un lote no se suman igual:

| Pieza | Se reparte entre |
| --- | --- |
| Químico (ácido del turno) | los lotes de **esa ejecución**, por manzanas |
| Personal (la cuadrilla) | los lotes de **esa ejecución**, por manzanas |
| Bolsa de logística | las manzanas de **esa zona** en la temporada |

La bolsa es la que tiene truco: se captura por zona y **no se filtra a
otra zona**. La prueba lo comprueba con dos lotes en zonas distintas — el
de la Zona Sur no carga ni un lempira de acarreo de la Norte. Todas las
divisiones van con `nullif`: una zona sin manzanas regadas todavía no es
un error, es una zona que aún no ha empezado.

**Dos cosas que el encargo pedía y ya existían**

- `tarifas_puesto` ya estaba desde la migración 11, con su vigencia. **No
  se creó otra**: dos tablas de salarios es garantizar que dentro de un
  año digan cosas distintas y nadie sepa cuál rige. Lo único que había
  que traducir es la unidad — allí el costo es por HORA y el encargo
  razona en jornadas —, y la jornada son ocho horas, que es la misma base
  sobre la que se calcula la hora extra.
- La columna de la tasa se llama **`tasa_hnl_usd`**, no `tasa_hdl_usd`:
  el código ISO del lempira es HNL. Una columna bautizada con una moneda
  que no existe se arrastra para siempre.

**El cálculo del personal**

```
costo = personas × ( tarifa_día × jornadas
                   + horas_extras × (tarifa_día / 8) × factor )
```

Factor 1.25 de día, 1.75 de noche. La tarifa se **copia a la fila**: si
mañana sube el salario, lo ya capturado no puede cambiar de costo solo —
y la prueba lo verifica subiendo la tarifa y comprobando que el costo
viejo no se mueve.

**Las seis vistas** siguen el patrón de la 56/57: cruda en `interno` con
`security_invoker = off` —así resuelve los nombres de los catálogos
aunque quien pregunta no tenga permiso sobre ellos— y expuesta en
`public` con la reja de `desinfeccion`.

### 2026-10-08 — El pie de totales se alcanzaba sólo con filtro

El pie era `sticky` **únicamente cuando ya había un total elegido**, y eso
lo volvía inalcanzable: con cuatrocientas líneas de labores quedaba
debajo de las cuatrocientas, así que para poder ELEGIR un total había que
desplazarse hasta el final de la tabla. Con un filtro puesto la tabla se
acortaba y el pie aparecía — de ahí la impresión de que «los totales sólo
funcionan con filtro». Funcionaban; lo que no se veía era dónde tocar.

Ahora el pie está pegado abajo **siempre**, y lo que cambia según haya o
no un total elegido es sólo el grosor de la fila.

**Verificado**

| Prueba | Resultado |
| --- | --- |
| `t59.sql` — catálogos, columnas generadas, el cálculo del personal, el prorrateo zonal, los nombres, la reja | **40 / 0** |
| `t42_52` · `t53` · `t54` · `t55` · `t56` · `t58` sobre la cadena 59 | **36/0 · 45/0 · 26/0 · 19/0 · 23/0 · 25/0** |
| `tpie.mjs` — ahora con tabla larga y sin filtro | **16 / 0** |
| `tagreg` · `tgrid` · `tlote` · `tabac` | **24/0 · 13/0 · 12/0 · 29/0** |
| `tsc --noEmit`, `eslint --max-warnings=0`, `next build` | limpios |

### 2026-10-08 — Totales al pie de las cuadrículas y acciones en masa de tickets

Sin migración: las dos son de navegador.

**a) El pie de totales.** El `DataGrid` gana un `<tfoot>` con una celda
por columna. Al tocarla se elige **Suma, Promedio, Mínimo, Máximo,
Contar o Ninguno**, y el número se calcula sobre **lo que se ve** — las
filas que pasaron los filtros y la búsqueda, no las que trajo la
consulta. Un total que no reacciona al filtro contesta a una pregunta que
nadie hizo, y es peor que no tener total: parece que sí.

Tres decisiones que no son de adorno:

- **La columna no declara su agregación; la elige quien mira.** El de
  campo quiere la SUMA de manzanas y el de taller el MÁXIMO de horas, así
  que no hay un `agregacion: 'suma'` en la definición de la columna: hay
  un menú. Eso es lo que lo hace genérico — se inyecta en cualquier tabla
  sin nombrar una sola columna.
- **Una columna de texto sólo ofrece Contar.** Sumar texto no quiere
  decir nada; «¿en cuántas filas hay operador anotado?» sí, y es justo lo
  que se pregunta cuando una columna viene a medias.
- **Sin una sola fila con dato devuelve vacío, no cero.** Un «0» ahí sería
  mentira: no es que la suma dé cero, es que no hay nada que sumar.
  (`Contar` sí devuelve 0: esa pregunta tiene respuesta.)

Lo elegido se recuerda por tabla y por columna en `localStorage`, con
try/catch en cada acceso — en una ventana privada `localStorage` LANZA al
tocarlo, y una preferencia de presentación no puede tumbar la tabla. Va
ahí y no en la base porque es de quien mira, no de la empresa: guardarlo
en la base se lo cambiaría a todos.

El menú va por Portal sobre `document.body` con `anclarPanel`, como los
demás paneles: el pie es el peor sitio de la tabla para abrir algo, porque
está pegado al borde de abajo.

**b) Las acciones en masa de /tickets, y un fallo vivo que las escondía.**

`/tickets` **ya tenía** selección múltiple y una acción en masa —están
desde la 45— pero el botón «Varios» lo gobernaba
`puede(permisos, 'tickets', 'ver_todo')`, y **`ver_todo` la borró la
migración 53** al convertirla en el eje «alcance». Al no existir
contestaba que no siempre, así que la selección múltiple no le salía a
nadie y parecía no estar implementada.

Arreglado el gate, se le metió el patrón de la 57: cada ticket marcado
pasa por `canExecuteAction` con sus propios atributos —quién lo capturó,
en qué paso del proceso está, si sigue abierto— **antes** de mandar nada.
Lo que no alcanza se cae de la selección y se dice cuántos y por qué:
mandar los cinco mil y que RLS rechace tres mil deja el cambio a medias,
con unos movidos y otros no, y sin forma de saber cuáles.

Para poder decidirlo, `cargadas` pasó de ser un `Set` de identificadores
a un `Map` con la fila entera: con sólo los ids no se puede preguntar
quién capturó el ticket ni en qué proceso está.

Se añadió además **Eliminar en masa**, con su propio recorte: editar y
eliminar son dos casillas distintas, así que un rol puede poder editar el
ticket ajeno y no borrarlo, y los dos contadores salen distintos.

`/tickets` **no es un DataGrid** sino el árbol mes → proceso de la 45, así
que los checkboxes viven en la fila del acordeón, no en una cuadrícula.

**Verificado**

| Prueba | Resultado |
| --- | --- |
| `tagreg.mjs` — las cinco cuentas, los no-números, el formato, la memoria | **24 / 0** |
| `tpie.mjs` — el pie en navegador, **con el escenario pedido**: elegir Suma en «H. Notificadas» y filtrar por equipo | **14 / 0** |
| `tlote.mjs` — el recorte ABAC de la selección de tickets | **12 / 0** |
| `tgrid` · `tabac` · `texcel` | **13/0 · 29/0 · 19/0** |
| `tsc --noEmit`, `eslint --max-warnings=0`, `next build` | limpios |

### 2026-10-08 — Catálogos por bloque, nombres en las vistas y Excel (migración 58)

**a) Dos pantallas fantasma.** «Plan de siembra» y «Plan de cosecha» son
módulos que ya no existen y seguían ocupando dos filas en la matriz de
Permisos. Una casilla que no gobierna nada es peor que ninguna: alguien
la marca creyendo que concede algo.

**b) «Catálogos» era UNA casilla para todos los datos maestros.** Quien
podía tocar los equipos podía tocar también las tareas SAP y los
proveedores. Se parte en **cinco bloques**, los mismos que la pantalla ya
usaba para agrupar — no se inventa una taxonomía nueva, quien entra a
Catálogos ya los ve así:

| Pantalla | Qué gobierna |
| --- | --- |
| `catalogo_equipos` | Equipos, familias, implementos, puestos de trabajo, contadores |
| `catalogo_labores` | Labores con sus tareas e implementos, categorías, operadores |
| `catalogo_cultivos` | Zonas, productos, variedades, materiales, planes de nutrición, turnos, estaciones |
| `catalogo_sap` | Tareas y procesos SAP |
| `catalogo_organizacion` | Departamentos, proveedores, temporadas |

**Lo que cada rol tenía en «Catálogos» se hereda a los cinco**, con sus
tres ejes intactos: partir un permiso sin heredar es quitárselo a todo el
mundo y obligar al Administrador a volver a marcar cinco casillas por rol
el lunes por la mañana.

Las veintidós tablas de catálogo pasan a regirse por su bloque. **Las
policies no se reescriben a mano:** se lee la expresión que ya tienen y
se le cambia el nombre de la pantalla. Veintidós policies reescritas a
mano son veintidós oportunidades de colar un matiz distinto, y la que
quede mal abre o cierra una tabla sin que nadie lo note. Las funciones
que también nombraban la casilla (`fn_cambiar_contador`) se traducen por
el mismo camino — el guardián de la 44 las encuentra leyendo su fuente.

**Una excepción que conviene recordar:** las **zonas** se leen con
«Lotes», no con el bloque de cultivo. Lo fijó la 55 porque el selector de
lote necesita la zona para recortar. Lo que sí gobierna
`catalogo_cultivos` es **escribirlas**.

En la UI: `/admin/permisos` separa la matriz en dos bloques —Módulos y
Catálogos— con el criterio del prefijo `catalogo_`, no con una lista
escrita a mano, para que un bloque nuevo caiga en su sitio solo. Y
`/admin/catalogos` sólo enseña los bloques en los que la persona tiene
«Ver»: un bloque que no puede abrir no es un candado que explicar, es
ruido.

**c) Las vistas devuelven nombres, no identificadores.** Desde la 56 las
vistas son `definer` y se saltan el RLS de los catálogos, así que pueden
resolver el nombre **ahí**: el navegador ya no tiene que descargarse el
catálogo entero para pintar una columna, ni enseñar «—» cuando no puede.
Se añadieron `zona_nombre` a labores, `temporada_nombre` a las cuatro
vistas de cultivo y a las de avance y costos, `turno_nombre` a riego y
`labor_nombre` a avance ejecutado — con el mismo envoltorio de la 57.

**d) Excel.** Dos cosas:

- **Fechas al importar.** Excel no guarda fechas, guarda números: una
  celda con 15/03/2026 llega como `46096` y un formato aparte que dice
  cómo pintarlo. Quien importaba tenía que acordarse de convertir la
  columna a texto ANTES de guardar, y si se le olvidaba la base recibía
  «46096». Ahora `leerXlsx` lee también `xl/styles.xml`, cruza el
  atributo `s` de cada celda con la tabla de formatos y traduce el serial
  a `YYYY-MM-DD`. Un número que **no** lleva formato de fecha no se toca.
- **Desplegables al exportar.** `construirXlsxPlantilla` ya generaba Data
  Validation nativo; los dos importadores de trasplante eran los únicos
  que no le pasaban listas, así que Lote y Variedad se escribían a mano y
  cualquier variación caía en las filas rechazadas. Ya las llevan.

**Verificado**

| Prueba | Resultado |
| --- | --- |
| `t59.sql` — fantasmas, los cinco bloques, la granularidad aplicada por RLS, los nombres | **25 / 0** |
| `t42_52` · `t53` · `t54` · `t55` · `t56` sobre la cadena 58 | **36/0 · 45/0 · 26/0 · 19/0 · 23/0** |
| Excel — serial, formatos, libro real de ida y vuelta, plantilla | **19 / 0** |
| Paridad navegador ↔ Postgres, 480 combinaciones | **0 diferencias** |
| `canExecuteAction` · estado de carga | **29/0 · 13/0** |
| `tsc --noEmit`, `eslint --max-warnings=0`, `next build` | limpios |

La prueba que de verdad cierra la granularidad no es que la función
conteste bien, sino que **RLS lo aplique**: con el bloque de equipos
abierto y el de SAP cerrado, el `update` sobre `equipos` pasa y el de
`tareas_sap` no.

### 2026-10-08 — Homologación final y limpieza de deuda (migración 57)

Los tres puntos que quedaban en «Pendiente», cerrados.

**a) La zona viaja con la línea de labor.** `v_labores_control` traía
`lote_temporada_id` pero no la ZONA. En la base no se notaba —la reja de
la vista resuelve el eje zonal con `fn_mis_lotes()`— pero el navegador no
tenía con qué evaluar el eje zonal de una ESCRITURA fila por fila, así
que en una celda de alcance zonal la pantalla no recortaba y el rechazo
llegaba al pulsar Guardar. La base nunca concedió nada de más; lo que
fallaba era el aviso.

De paso, `v_telecom_asignaciones` gana `usuario_id` por el mismo camino.

**Cómo se añade una columna a una vista que ya está en producción:**
`create or replace view` no deja insertar una columna a media lista, sólo
al final, y la definición de la cruda son setenta columnas — reescribirlas
a mano para colar una es la forma más segura de perder otra. Así que la
vista **se envuelve en sí misma**: se lee su definición con
`pg_get_viewdef`, se mete entera como subconsulta y se le pega la columna
al final con un `left join` (una tabla hash, no una subconsulta
correlacionada por fila). El texto viejo queda inlineado en el momento
del `replace`, así que no hay recursión. La vista EXPUESTA hay que
recrearla aparte: su lista de columnas se fijó al crearse, y un
`select x.*` viejo no se entera de la columna nueva.

**b) Homologadas las seis pantallas que quedaban.** Trasplante
(siembras y plan), riego y telecom (líneas, equipos, asignaciones)
pasaban booleanos de pantalla a sus cuadrículas. Ahora reciben las
reglas y deciden por fila, igual que labores y tickets: edición en celda,
botón de fila y acciones en masa. Lo que la persona no puede tocar se
cae de la selección **antes** de cualquier acción en masa, para que el
cambio no quede a medias.

Telecom entra además al patrón de la 56 (`interno.v_x_crudo` + reja), que
la 56 le había dejado fuera: ahora que sus pantallas esconden por fila,
sus vistas tienen que traer el dueño y regirse por su propia casilla.

Donde la fila no guarda dueño —plan de siembra, líneas, equipos— la
respuesta por fila coincide con la de pantalla. Se deja escrito con el
helper igual que las demás para que el día que esas filas ganen un dueño
o un estado no haya que acordarse de cambiarlo.

**c) Suites `t42`–`t52` reconstruidas** (`t42_52.sql`, **36 verdes /
0 rojas**). No reproducen lo que cada migración hacía —eso se probó el
día que se entregó— sino **lo que el refactor de RLS podría haber roto
sin que nadie se enterara**: que la pieza siga existiendo con su forma,
que la regla de negocio siga contestando lo mismo, y que los disparadores
sigan enganchados (un trigger desaparece sin ruido y lo que protegía deja
de protegerse).

**Y un fallo que encontró esa suite, ajeno al encargo:**
`fn_audit_horometros`, `fn_mi_rol` y `fn_notificar_ticket` eran
`security definer` **sin `search_path`**. Es el agujero clásico de
PostgreSQL: quien pueda crear un esquema y ponerlo delante consigue que
una tabla o función suya se resuelva antes que la de `public`, y el
cuerpo la ejecuta con los permisos del dueño. `fn_mi_rol` es la más
delicada: de ella cuelga media cadena de permisos. Vienen de migraciones
viejas —el refactor no las tocó— y la 57 las arregla con un bucle que
barre todas las `security definer` sin `search_path`, más un guardián que
revienta si vuelve a aparecer alguna.

**Verificado**

| Prueba | Resultado |
| --- | --- |
| `t42_52.sql` — la lógica de negocio de once migraciones | **36 / 0** |
| `t53` · `t54` · `t55` · `t56` sobre la cadena 57 | **45/0 · 26/0 · 19/0 · 23/0** |
| Paridad navegador ↔ Postgres, 480 combinaciones | **0 diferencias** |
| `canExecuteAction` | **29 / 0** |
| Navegador — estado de carga | **13 / 0** |
| `tsc --noEmit`, `eslint --max-warnings=0`, `next build` | limpios |

**Ideas, que no deuda**

- El eje zonal de escritura se evalúa ya en labores y riego, que son las
  que traen zona. En trasplante y telecom no hay zona de la que agarrarse
  y ese eje no recorta en la pantalla; la base sigue mandando.
- `eslint.config.mjs` acepta ahora parámetros con guion bajo delante
  (`_f`): es «lo recibo y no lo miro», que es justo lo que pasa en las
  pantallas sin dueño, donde la función de permiso conserva la misma
  firma que las demás para que todas las cuadrículas se escriban igual.

### 2026-10-07 — La matriz es ley, y Fase 3 del ABAC (migración 56)

**a) El estrangulamiento en cascada.** Está explicado entero en §2.5: las
vistas de módulo pasan al patrón `interno.v_x_crudo` (definer, sin RLS) +
`public.v_x` (con la reja de SU pantalla). Trece vistas: labores,
horómetros, los tres avances, costos, las dos de rotación, trasplante y
recepción, turnos de riego, lotes y contadores.

Comprobado con el caso exacto del encargo —Labores en **Global** y
Tickets en **Propietario**—: el usuario ve **0 tickets** y **las 12.974
labores**. Y el vecino no se contagia: horómetros en Propietario sigue
recortando lo suyo.

**El fallo que encontró la prueba y que vale la pena recordar:** la
primera versión dejó las crudas en `public` protegidas con un `revoke`.
El banco de pruebas corre después los grants por omisión de Supabase, y
se las devolvió todas. Una vista que se salta el RLS, legible por
cualquier usuario. De ahí el esquema `interno`.

**b) Fase 3 del ABAC, completa.**

| Archivo | Qué |
| --- | --- |
| `lib/permisos/clientABAC.ts` | **Nuevo.** `canExecuteAction`, `zonasParaCrear`, `filtrarPorZona`, `nivelDeProceso`, y el par `aplanarReglas`/`armarReglas` para cruzar al navegador. Puro. |
| `lib/auth.ts` | `getReglas()` carga los tres ejes; `getPermisos()` se deriva de ella, así que los cien sitios que preguntan `puede(...)` siguen igual. `getMisZonas()`. |
| `lib/permisos/captura.ts` | Reescrito sobre `canExecuteAction`. **Arregla un fallo vivo:** seguía preguntando por `tickets:editar_en_revision`, una acción que la 53 borró, así que contestaba que no SIEMPRE y los tickets en revisión quedaban congelados para todos, incluido quien tenía el permiso. |
| `AccionesTicket`, `/tickets/[id]`, `/horometros/[id]` | Editar, Eliminar y Enviar a revisión se deciden con los tres ejes sobre ESE ticket. Cuando no salen, se dice por qué. |
| `ControlLabores`, `ControlHorometros` | Reciben las reglas, no dos booleanos. Edición en celda, botón de fila y acciones en masa, **todo por fila**: lo que la persona no puede tocar se cae de la selección antes de cualquier acción en masa, para que no quede a medias. |
| `/controles/rotacion` | Pasa por el helper de ABAC. Sus filas no tienen proceso ni estado, así que por fila coincide con por pantalla; se deja así escrito para que el día que ganen un dueño no haya que acordarse. |
| `lib/datosRegistro.ts` | El catálogo de lotes trae `zona_id` y se recorta con `zonasParaCrear` cuando el alcance de «crear» es zonal. **Va aquí y no en cada formulario:** alta y edición comparten este cargador justamente para no ofrecer opciones distintas. |

**Verificado**

| Prueba | Resultado |
| --- | --- |
| `t56.sql` — la matriz es ley, cada eje, las crudas, las tablas, el tiempo, universalidad | **23 verdes / 0 rojas** |
| `t53` · `t54` · `t55` sobre la cadena 56 | **45/0 · 26/0 · 19/0** |
| **Paridad navegador ↔ Postgres**, 480 combinaciones | **0 diferencias** |
| `canExecuteAction` — alcance, condición, tope, selectores | **29 verdes / 0 rojas** |
| Navegador — estado de carga y panel de permisos | **13/0 · 20/0** |

### 2026-10-07 — Alcance global, timeouts y estados de carga (migración 55)

**El problema era uno solo con dos caras: las policies preguntaban el
permiso fila por fila.**

**a) «Global» no se respetaba.** Siete policies seguían recortando por
zona con `fn_ve_zona` / `fn_ve_lote` **siempre**, sin mirar el alcance:
`registro_detalle`, `lotes_temporada`, `zonas`, `siembras`,
`planes_siembra`, `turnos_riego`, `turnos_riego_detalle`. Poner Global en
la matriz no cambiaba nada porque el recorte estaba escrito aparte,
debajo. `/labores` era el caso claro: la vista `v_labores_control` une
`registro_detalle` con `lotes_temporada` y **las dos** recortaban por su
cuenta, así que hacían falta dos casillas en Global para ver algo.

Medido con el rol puesto en Global: **4.367 → 12.974 filas visibles.**

**b) `canceling statement due to statement timeout`.** Sobre 13.000
líneas de detalle —una fracción de un año real— la consulta de `/labores`
tardaba **43 segundos**. El plan de ejecución lo explicaba:
`fn_verificar_permiso` corría como SubPlan **una vez por fila** (4.324
vueltas sólo en `registros`), y dentro de cada vuelta la policy hacía un
`select usuario_id from public.tickets where id = ...` escrito en línea,
que vuelve a aplicar el RLS de `tickets` entero. **1.8 millones de
bloques leídos para devolver mil filas.**

| Medición (13.000 detalles, un año) | Antes (54) | Después (55) |
|---|---|---|
| Vista completa de labores | 3.540 ms | **4 ms** |
| El año completo, 1.000 filas | 15.900 ms | **86 ms** |
| Con zonas asignadas, año completo | 43.318 ms | **701 ms** |

**Qué se hizo**

- `sql/55_alcance_global_y_rendimiento.sql`:
  - Índices: `registro_detalle.fecha` **no tenía ninguno** y es por donde
    entra el rango de fechas; más `horometros.fecha`,
    `horometros.ticket_id`, `registros(fecha, ticket_id)`,
    `tickets(usuario_id, fecha)` y los de usuario.
  - `fn_permitido_de`, `fn_dueno_ticket`, `fn_dueno_registro`,
    `fn_dueno_detalle`, `fn_ve_registro`.
  - Las 11 policies de lectura reescritas en la forma canónica de §2.4.
- `components/ui/DataGrid.tsx`: prop `cargando`. Con filas en pantalla las
  deja visibles pero atenuadas con el aviso «Consultando…» encima —lo
  viejo sigue siendo útil mientras llega lo nuevo—; sin filas, dibuja el
  esqueleto. Antes, volver a consultar con otro rango dejaba la tabla
  quieta enseñando lo anterior y parecía colgada.
- `Primitivos.tsx`: `Girador` y `TablaEsqueleto`.
- `ControlLabores`, `ControlHorometros`, `ControlTurnosRiego`: estado
  `cargando`, encendido **antes** de pedir.
- `loading.tsx` para `/labores`, `/horometros`, `/tickets`, `/telecom`,
  `/trasplante`, `/costos`: Next los enseña en cuanto se toca el enlace.
- **No había filtros de propiedad en el frontend.** Se buscó
  `.eq('usuario_id', …)` en todo `src/` y no existe ninguno: las
  consultas ya iban limpias. La causa era íntegramente RLS.

**Verificado:** visibilidad idéntica entre la 54 y la 55 para los cuatro
roles sobre siete tablas (0 diferencias); `t53` 45/0 y `t54` 26/0 sobre la
cadena 55.

### 2026-10-06 — Fase 2 ABAC: la matriz configura los tres ejes (migración 54)

- `roles.acceso_total` y `roles.solo_lectura` sustituyen los literales
  `'ADMIN'` y `'INVITADO'`, con guardia de sentencia para no quedarse sin
  llave maestra.
- `fn_guardar_permiso` se lleva la cascada dentro (antes vivía en el
  navegador y no valía para quien escribiera por otro camino).
- `lib/permisos/abac.ts` y `components/admin/CeldaPermiso.tsx`: el panel
  de tres ejes por celda, con Portal y `anclarPanel`.
- `RolCodigo` deja de ser una unión de siete nombres.
- Eliminado `components/catalogos/PermisosMatrix.tsx` (sin uso, y llevaba
  otro `'ADMIN'` dentro).
- **Verificado:** `t54` 26/0; `t53` 45/0 sobre la cadena 54; barrido
  comparativo 52 vs 54 de los 408 cruces (rol × pantalla × acción) sin una
  sola diferencia; 20 pruebas de navegador sobre el panel.

### 2026-10-06 — Fase 1 ABAC: alcance y condición en la base (migración 53)

- Enums `alcance_permiso` y `condicion_permiso`; columnas `permitido`,
  `alcance`, `condicion` en `permisos`.
- `fn_verificar_permiso` evalúa los tres ejes contra un registro.
- Las acciones viejas `ver_todo` y `editar_en_revision` se **derivan** a
  los ejes nuevos y se borran del catálogo. `ver_todo` marcado pasa a
  `zonal`, no a `global`: hoy la regla era `fn_ve_todo AND fn_ve_ticket`,
  y `zonal` reproduce exactamente los dos casos de antes.
- **Tope duro:** un ticket NOTIFICADO no lo abre ninguna casilla.
- **Verificado:** `t53` 45 verdes / 0 rojas.

### Antes de la 53

El histórico de cada entrega vive en los documentos del proyecto en
claude.ai (`claude/*.md`): migraciones 50 (bloqueo por proceso), 51
(rotación y catálogo de productos), 52 (sublotes), 49 (bitácora de
telecom), 47-48 (telecomunicaciones), 46 (lotes administrativos), 45
(historial de tickets), 44 (matriz de permisos completa), 43 (permisos
sin roles quemados), 42 (visibilidad y prorrateo), 41 (zonas por
usuario).

---

## 4. Trampas conocidas

Cosas que ya costaron una sesión. No volver a tropezar.

- **Nunca `array_agg` sobre una columna que ya es un arreglo.** Un nulo
  —de un LEFT JOIN sin pareja— revienta la consulta ENTERA con «cannot
  accumulate null arrays», y `count(*)` no lo detecta porque no evalúa la
  columna. Se desempaca con `unnest` en origen y se agregan escalares.
- **Y ese desempaque va DESPUÉS de agrupar.** Unir el `unnest` antes
  multiplica las filas y con ellas las manzanas y los costos. Es la forma
  silenciosa de romper lo mismo.
- **Una columna generada no se puede apoyar en otra generada.** Hay que
  repetir la expresión entera: `(siembra + dias_aplicacion) +
  dias_preriego`, no `fecha_aplicacion + dias_preriego`.
- **Vacío no es cero en un numérico opcional.** La edición en celda
  mandaba todos los numéricos a 0 al borrarlos; en `dias_preriego` eso
  inventa una fecha de preriego igual a la de aplicación. Los nulables
  van en su propia lista.
- **Un valor elegido fuera de la lista tiene que enseñarse igual.** Si no,
  lo guardado antes de cerrar el catálogo queda invisible y no se puede
  ni quitar.
- **Un disparador compartido no puede nombrar una columna que sólo tiene
  una de sus tablas.** `fn_objetivos_en_orden` la usan `materiales` y
  `desinfeccion_ejecucion_productos`; meterle `new.fase` reventó el alta
  del catálogo entero con «record "new" has no field fase». Lo que
  depende de la fase vive en su propia función.
- **`Campo` es un `<label>` y `Selector` dibuja un `<button>`.** Envolver
  un selector en un `Campo` le roba el nombre accesible al control. Es la
  misma trampa del icono de ayuda, por otra puerta: el mensaje de error
  de un selector va como HERMANO, no como hijo.
- **Un permiso inerte sigue siendo un permiso.** Doce vistas de `interno`
  llevaban `grant select` a `authenticated`, inofensivo sólo mientras no
  hubiera `usage` sobre el esquema. Un sello que depende de que nadie
  conceda otra cosa no es un sello: se revoca lo que no hace falta.
- **Las posiciones calculadas a mano en el PDF se solapan en silencio.**
  Cinco hitos en `col * n` escritos uno a uno acabaron dibujados
  encima. Se arma la lista de lo que hay y se reparte sola; el marco
  crece con ella.
- **Las personas se cuentan en `numeric`, no en entero.** Un
  `Math.trunc` en el repositorio tira el decimal antes de que la columna
  pueda guardarlo: 0.33 se vuelve 0 y el `|| 1` lo sube a un jornal
  entero. Si la base admite fracciones, el camino entero tiene que
  admitirlas.
- **«Si hay error, falta la migración» es un diagnóstico inventado.** Un
  permiso, una vista sin `grant`, la caché de esquema de PostgREST o la
  red caída no son una tabla ausente. Sólo lo son `42P01`, `42703`,
  `42883` y los `PGRST202/204/205`, y estos tres últimos pueden ser la
  caché sin recargar (`notify pgrst, 'reload schema';`). La decisión vive
  en `lib/supabase/instalacion.ts` y **no se copia a mano** en cada
  pantalla: seis copias de una regla de tres líneas son seis respuestas
  distintas al mismo fallo.
- **Un error que no es de instalación no debe tapar el módulo.** Que un
  informe no cargue no es razón para esconder la captura. Se enseña el
  texto de la base donde falló, y lo demás sigue utilizable.
- **Copiar archivos no borra archivos.** La entrega escribe lo nuevo y lo
  modificado; lo que se eliminó del repositorio **se queda** en la
  máquina y sigue ejecutándose. Un borrado viaja como orden aparte, en
  consola. Así sobrevivió `src/app/page.tsx` con su `redirect('/tickets')`
  a dos entregas, y ningún `grep` del repositorio lo encontraba.
- **`(app)` no añade segmento a la URL.** Un grupo de ruta es sólo una
  carpeta para compartir `layout`: `app/page.tsx` y `app/(app)/page.tsx`
  resuelven LA MISMA ruta, y la suelta en la raíz gana. `tportada` cuenta
  las páginas que resuelven «/» y exige que haya una.
- **El área de un lote es de un CICLO.** El mismo lote se siembra dos
  veces en una temporada, y sumarlas infla el divisor con el que se
  reparte el químico: un área mal contada es una dosis mal calculada.
  `fn_area_lote_ciclo(lote, ciclo)` es la única que se debe llamar desde
  una pantalla de captura; `fn_area_regable` suma la temporada entera y
  es para el reporte y el histórico.
- **La numeración de las migraciones la lleva el asistente, no el
  encargo.** Un lote de trabajo sin SQL **no consume número**: el
  importador de Excel se habló como «la 67» y no creó ningún archivo, así
  que el siguiente SQL es la 67 y no la 68. Si el encargo pide un número
  que deja un hueco en `sql/`, hay que corregirlo antes de escribir una
  línea — un hueco en la secuencia es una migración que alguien buscará y
  no encontrará.
- **Un informe en papel y una pantalla que discrepan en el formato de un
  número es un informe que no se puede defender.** Las cuentas y el
  formato viven en un módulo puro que usan los dos. La prueba del PDF
  compara contra lo que escribe la pantalla, y así encontró que
  `conSigno` no ponía separador de miles.
- **Las ppm no se promedian.** Al juntar dos pasadas del mismo químico se
  suman los litros y el costo, pero se conserva la ppm del que más pesa:
  una media de ppm no significa nada.
- **Un cero donde no hay plan dice «se planificó cero».** No es lo mismo
  que «no se planificó». Los campos del plan van en nulo y la pantalla
  escribe «Sin plan».
- **Una desviación pintada por el signo deja el informe entero en rojo.**
  Un turno nunca clava la dosis al decimal: dentro del ±5 % es ruido de
  campo. Y quedarse muy corto tampoco es buena noticia automática.
- **El grano de un informe gerencial es lote × ciclo.** Por lote a secas
  suma dos campañas de siembras distintas; por ejecución contesta otra
  pregunta, porque un turno riega varios lotes.
- **`<button>` es un elemento ETIQUETABLE.** Dentro de un `<label>`, el
  navegador le da la etiqueta a él y el campo se queda sin nombre
  accesible. Un icono de ayuda dentro de una etiqueta va como `span` con
  `role="button"`.
- **Escape dentro de un globo no puede cerrar el formulario de atrás.**
  Se escucha en fase de captura y se para la propagación; si no, pedir
  una ayuda y cerrarla pierde lo que se llevaba escrito.
- **Una ayuda escrita debajo de cada campo duplica el alto del
  formulario.** Se lee una vez y se paga todos los días. Va detrás de una
  «i», salvo los avisos que hay que leer siempre (`ayudaVisible`).
- **`type="time"` en un teléfono es una rueda a pantalla completa.** Con
  seis horas por turno, se teclea: `EntradaReloj` admite «0830».
- **Una portada no consulta módulos.** Si pide permisos, se cae por el
  permiso que falta, que es justo lo que viene a evitar.
- **`typeof window === 'undefined'` NO protege de un desajuste de
  hidratación.** Durante la hidratación `window` ya existe, así que se
  toma la rama del cliente y el marcado difiere del que mandó el
  servidor. Para leer `localStorage`, `document.cookie` o `matchMedia`
  está `useHidratado()`, que es `useSyncExternalStore` con el valor del
  servidor también durante la hidratación.
- **El error 418 de React no es un aviso**: tira el HTML del servidor y
  repinta el árbol ENTERO en el cliente. En una pantalla con miles de
  filas, eso es el congelamiento que se reporta como «se guinda», y en
  producción sólo deja un número en la consola.
- **Una cookie de sesión que no da usuario es basura, venga el error que
  venga.** Hay un caso sin código —cookie ilegible— que Supabase reporta
  igual que «aquí nunca hubo sesión». Si no se borra, cada petición
  repite el viaje al login para siempre.
- **Un valor de enum no se puede usar en la misma transacción en que se
  crea** (`unsafe use of new value`), y el editor SQL de Supabase manda
  cada archivo como una transacción. El `alter type` va en su propio
  archivo; el cuerpo de una función plpgsql sí puede nombrarlo, porque
  es texto hasta que corre.
- **Dos columnas para un mismo hecho se separan solas.** `es_jornal` y
  el perfil `JORNAL` se mantienen en paso con un disparador, en las dos
  direcciones, y el disparador respeta lo que cambió en esa escritura —si
  no, editar una revierte la otra al guardar.
- **Un bundle de prueba que nadie reconstruye es una suite que miente.**
  `tcalc` y `tabac` estuvieron tres migraciones en verde contra código de
  antes del arreglo, y una de las aserciones afirmaba justo el fallo
  abierto que la 66 y la 67 sellaron. Correr `buildLibs.mjs` antes del
  barrido.
- **«Igual a la plantilla» NO quiere decir «nadie lo tocó».** Si la
  plantilla trae valores por omisión que son la respuesta más común —una
  persona, Jornal, salario mínimo—, el renglón bien llenado es idéntico
  al vacío y se borra al guardar. Cuando una fila sólo existe porque
  alguien pulsó un botón, **el botón es la afirmación** y no hay nada que
  limpiar.
- **El agua del lavado no lleva producto.** Lo que diluye el químico es
  el agua de la INYECCIÓN; el lavado va después y es agua limpia.
  Sumarla bajaba el ppm, y un ppm bajo no lo revisa nadie: el error iba
  en la dirección que no se nota.
- **Un desplegable dentro de un contenedor con `overflow` no se salva con
  z-index**: el recorte lo hace el padre. Hay que sacarlo al `body` con
  un portal y colocarlo con `anclarPanel`, que es lo que hace `Selector`
  cuando es `buscable`.
- **`router.refresh()` en medio de una captura borra lo escrito.** Rehace
  el árbol desde el servidor. En un formulario abierto, lo recién creado
  se añade a la lista en memoria y punto.
- **Un área sin ciclo suma temporadas enteras.** `fn_area_regable`
  juntaba todos los ciclos del lote, así que el segundo salía con el área
  del primero encima.
- **Una función `security definer` que devuelve filas de campo NO la
  protege la RLS**: se la está saltando por diseño. Tiene que recortar
  por zona a mano, igual que una vista. `fn_lotes_desinfeccion` ofreció
  lotes de otras zonas durante seis migraciones porque la 66 selló las
  vistas y nadie miró las funciones.
- **El alcance se consulta por PANTALLA, no por módulo.** Desde la 66 el
  mismo usuario puede ser global en una pestaña y zonal en otra, así que
  una función compartida recibe la pantalla como argumento en vez de
  suponerla.
- **Un costo en otra moneda convertido en el navegador es un costo que se
  guarda mal el día que alguien escribe en la base por otra puerta.** La
  conversión vive en el disparador, con la tasa de SU temporada, y lo
  escrito se conserva en `costo_origen` para poder auditarla.
- **Sin tasa de cambio no se inventa una**: el costo queda en cero y con
  aviso. Un «1 por 1» silencioso es un presupuesto equivocado por un
  factor de veintiséis.
- **No pidas en un Excel un dato que el sistema ya tiene.** La fecha de
  siembra y la variedad salen del plan de trasplante; pedirlas sólo
  añadía dos columnas donde teclear mal una fecha.
- **Una paleta no se elige a ojo, se valida con el script.** El par
  `#047857` / `#0369a1` del reporte viejo queda en ΔE 14, por debajo del
  piso de 15 para visión normal: dos series que cualquiera confunde.
- **Un `svg path` no basta para contar los arcos de una dona en una
  prueba**: la cuadrícula de abajo trae sus propios iconos en SVG y el
  contador sube a veintidós. Hay que buscar dentro de la figura.
- **Un campo numérico vacío en una hoja importada no es un cero.** En el
  plan de desinfección, costo vacío = «tómalo del historial de precios»;
  cero = «es gratis». Convertir con `Number('')` borra esa diferencia, y
  el cero guardado parece un dato.
- **Un importador tiene que resolver los catálogos en la VISTA PREVIA, no
  al guardar.** Un lote que no existe debe verse en la tabla de antes,
  con su renglón marcado, y no aparecer a mitad de la escritura como un
  error de llave foránea cuando ya hay cuarenta filas dentro.
- **Importar es una acción propia, no un sinónimo de crear.** Quien puede
  escribir una línea a mano no necesariamente puede meter cien de un
  archivo que nadie ha revisado. El botón cuelga de `importar`.
- **Un componente que use `useRouter` necesita un doble de
  `next/navigation` en el banco de pruebas**, o revienta con «invariant
  expected app router to be mounted» — que no dice nada sobre lo que
  falta.
- **Una reja de vista no es seguridad: la seguridad es la RLS de la
  tabla.** PostgREST deja consultar la tabla directamente. Sellar la
  vista y dejar la policy abierta es poner una puerta nueva al lado de
  la que sigue sin cerrojo.
- **`else true` en la rama zonal de un `case` de alcance es una fuga
  total**, y `else true or <predicado>` es peor: cortocircuita y deja el
  predicado como código muerto que se lee como si funcionara. Cualquier
  generador de rejas que escriba `true` cuando le falta una columna
  acaba produciendo las dos.
- **`fn_verificar_permiso` resuelve el eje zonal con la zona que le
  pasen, y si no le pasan ninguna contesta que sí.** Toda policy que la
  llame sin zona tiene el eje zonal desactivado para escrituras. Para
  eso está `fn_verificar_permiso_zonal`, y un guardián que lista quién
  sigue con la laxa.
- **Fallar abierto y fallar cerrado dependen de dónde estés.** `sin zonas
  asignadas = sin recorte` es razonable en una policy general y es un
  agujero dentro de una rama que sólo se alcanza con alcance ZONAL. La
  misma función no puede servir para los dos sitios: por eso conviven
  `fn_ve_zona` y `fn_ve_zona_estricta`, y el nombre dice cuál es cuál.
- **Una prueba de RLS que corre como superusuario no prueba nada.** El
  superusuario se salta la RLS entera, así que todas las escrituras
  pasan. Las pruebas de policy van con `set role authenticated` — y la
  primera versión de `t66` daba por sellado el camino de escritura
  justamente por esto.
- **Partir una pantalla en sub-pantallas obliga a buscar su nombre en
  TODO el SQL**: policies, funciones `security definer` que comprueban el
  permiso por dentro, y el frontend. `fn_siembras_de_lotes` se habría
  quedado muda y el DDT habría vuelto a «—» sin un solo error.
- **Al partir una pantalla, los permisos del padre se COPIAN a las hijas
  antes de borrarlo.** Partir es una decisión de granularidad, no de
  permisos: nadie puede perder acceso por correr una migración.
- **⚠ LAS PPM: LA DUDA DIMENSIONAL, SIN RESOLVER.** Desde la 65 la
  fórmula parte de `dosis_mz` y no de los litros totales, por encargo.
  Las dos no miden lo mismo y la diferencia es exactamente las manzanas
  del turno:

      con litros   → cc de producto / m³ de agua  = ppm
      con dosis_mz → (cc/mz) / m³                 = ppm ÷ mz

  Si `horas × caudal` es el agua que recibieron TODAS las manzanas, la
  concentración de esa agua es la primera. Para que la segunda sea una
  concentración, el caudal tendría que ser el de UNA manzana. Se
  implementó la pedida porque sale de la hoja de los agrónomos; si el
  número sale más bajo de lo esperado, **esto es lo que hay que mirar
  primero**, y la prueba `t65` deja el contraste hecho: con una sola
  manzana la fórmula nueva da exactamente lo que daba la vieja.
- **Un valor que se escribe en dos sitios acaba diciendo dos cosas.** La
  tasa de cambio vivió una migración como columna de `temporadas` y como
  historial a la vez; se retiró la columna. Lo mismo pasó con
  `horas_lavado_manual` en la 62. Si hay que migrar un dato a una forma
  nueva: mudarlo, y quitar la vieja en la misma migración.
- **Al cambiar la firma de una función que calcula algo, hay que soltar
  la versión anterior en la misma migración.** Con las dos vivas, la
  llamada se resuelve por el número de argumentos y media plataforma
  sigue calculando con la fórmula vieja sin un solo error en los logs.
- **`create or replace function` con un argumento de más NO reemplaza:
  crea una SEGUNDA función con el mismo nombre.** Y con las dos vivas,
  la llamada vieja deja de resolverse («function is not unique») y se
  caen a la vez el disparador y la pantalla. Una sobrecarga que sólo
  añade un parámetro con valor por omisión es siempre ambigua con la que
  no lo tiene: hay que soltar la vieja, y antes las vistas que la
  nombran.
- **Una función que devuelve NULL deja la pantalla muda, y mudo no es
  igual a roto.** El costo del químico «no reaccionaba» porque
  `fn_precio_material` devolvía nulo —la tasa vivía en una tabla vacía— y
  la pantalla, que no rellena con nulos, se quedaba quieta. Cuando un
  autocompletado puede no tener respuesta, la respuesta vacía tiene que
  traer su MOTIVO: las tres causas posibles tenían tres arreglos
  distintos y la misma celda en blanco.
- **La tasa de cambio que gobierna un costo tiene que vivir donde
  alguien la mantiene.** `catalogo_tasas_cambio` (59) era más fina —una
  tasa por fecha— y por eso mismo nadie la llenaba. La de la temporada se
  escribe una vez al año y manda.
- **No se le pone valor por omisión a una tasa de cambio.** Un 25 de
  fábrica costea en silencio toda una temporada; un hueco se ve.
- **Los cc por metro cúbico YA son partes por millón.** Un m³ de agua
  pesa un millón de gramos y un cc de producto pesa aproximadamente uno:
  la división ya viene en millonésimas. Si aparece un ×1.000.000 en una
  fórmula de ppm, sobra.
- **Un porcentaje escrito a mano («42 %», «1,3%») se convierte a número
  en UN solo sitio.** Sacarlo con una expresión regular en cada pantalla
  que lo necesite garantiza que un día dos sitios lo saquen distinto. Y
  cuando falta, no se asume 100.
- **Un dato que no existe todavía no se busca donde está el dato
  hecho.** El DDT de desinfección salía «—» porque se leía `siembras` —lo
  ya sembrado— cuando lo que hace falta es `planes_siembra`: se
  desinfecta ~70 días ANTES de trasplantar. Y cuando una pantalla lee un
  PLAN donde podría leer un hecho, tiene que decir cuál de los dos está
  enseñando.
- **El signo de una diferencia de fechas es la mitad del dato.** «69
  días» y «−69 días» son situaciones opuestas y sin el signo son el mismo
  texto. El DDT es `fase − siembra`: negativo = falta para trasplantar.
- **`Number('')` es 0, no `NaN`.** Una validación de «finito y no
  negativo» deja pasar el campo vacío como un cero, y un cero guardado
  parece un dato. El vacío se mira ANTES de convertir.
- **Una definición que arma el servidor y consume el navegador no puede
  llevar funciones**: cruza serializada. Un sub-panel por fila se engancha
  con un NOMBRE que el componente de cliente traduce, no con un `render`.
- **Un índice único sin una regla que lo acompañe es un error en la
  cara del usuario.** La bandera de salario mínimo tenía índice parcial
  desde la 62 y marcar el segundo reventaba con «duplicate key». La regla
  —marcar uno desmarca al otro— va en un disparador y no en React, porque
  el importador de Excel escribe en la misma tabla.
- **Un efecto que depende de un ARRAY se dispara en cada render**; uno
  que depende de una cadena derivada de ese array, sólo cuando el
  conjunto cambia. Es lo que evita el bucle al recalcular el DDT con los
  lotes elegidos.
- **Un *placeholder* no es un valor.** El texto gris de un input parece
  un número puesto y no se guarda: quien no lo toca guarda un vacío. Si
  el formulario PROPONE un número, lo escribe. Y entonces la limpieza de
  filas fantasma tiene que conocer ese valor por omisión, o un renglón
  agregado por descuido deja de parecer un hueco.
- **Un umbral que cambia el tipo de control según cuántas opciones haya
  es una trampa de catálogos que crecen.** El selector con cuatro
  opciones era la rueda nativa y con ocho un panel con buscador: el mismo
  campo, dos gestos distintos según el día. Las listas que van a crecer
  se marcan `buscable` desde el principio.
- **Un número de horas no se convierte en un par de horas de reloj.**
  «3.5 h» no dice si fue de 22:00 a 01:30 o de 06:00 a 09:30. Al
  cambiar un campo de número a reloj, la migración no inventa: cuenta lo
  que se pierde y lo dice.
- **Una bandera en el catálogo vale más que una búsqueda por nombre.**
  `fn_salario_minimo_dia` buscaba el puesto que «se llamara salario
  mínimo» y se rompía en silencio el día que alguien lo renombrara —no
  calculaba mal: dejaba de proponer—. La 62 lo cambió por
  `es_salario_minimo`, con índice único parcial para que sólo pueda
  haber uno.
- **PostgREST corta en ~1.000 filas por respuesta.** Quitar el `.limit()`
  no sirve: hay que paginar con `.range()` (`lib/supabase/paginar.ts` →
  `leerTodo`).
- **`create or replace function` no puede cambiar la forma de la tabla
  que devuelve.** Hay que `drop function` primero.
- **`create or replace view` no puede renombrar ni insertar una columna a
  media lista.** Hay que `drop view` + `create view`, y recrear antes las
  vistas que dependan de una columna que se va a borrar.
- **Las columnas generadas tienen que ser expresiones inmutables.**
- **Una vista `security_invoker = off` se salta el RLS de todo lo que
  une.** Eso no es un fallo, es el patrón de §2.5 — pero la vista pasa a
  ser la ÚNICA puerta, así que su `where` tiene que estar bien y la cruda
  tiene que vivir en `interno`. Un `revoke` sobre una vista en `public`
  no protege nada: el próximo grant masivo lo deshace.
- **Una función `security definer` SIN `set search_path` es un agujero
  de escalada de privilegios**, no un detalle de estilo. Toda función
  nueva que lleve `security definer` lleva también
  `set search_path = public, pg_temp`. La suite `t42_52` lo vigila.
- **Para añadir una columna a una vista ya desplegada**, no se reescribe
  su definición: se envuelve en sí misma con `pg_get_viewdef` y se pega
  la columna al final (`create or replace view` sólo admite añadir al
  final). Y hay que recrear la vista EXPUESTA aparte: su lista de
  columnas se fijó al crearse y un `select x.*` viejo no se entera.
- **Las zonas se LEEN con «Lotes» y se ESCRIBEN con
  `catalogo_cultivos`.** No es un descuido: el selector de lote necesita
  la zona para recortar, así que atarla al bloque de cultivo dejaría sin
  selector a quien no lo tenga.
- **Excel no guarda fechas, guarda números.** Toda lectura de `.xlsx`
  tiene que mirar `xl/styles.xml` para saber qué celda numérica es una
  fecha. Y el serial se convierte con `Date.UTC` y `getUTC*`: un serial
  es una fecha de calendario, no un instante, y construirlo en hora local
  es lo que mueve la fecha un día.
- **Una acción borrada en una migración sigue viva en el navegador hasta
  que alguien la busca.** `tickets:ver_todo` murió en la 53 y siguió
  gobernando el botón «Varios» de /tickets hasta octubre: `puede(...)`
  sobre una acción inexistente contesta que no, sin error y sin aviso.
  Al borrar una acción hay que buscarla en `src/` con el mismo cuidado
  que el guardián la busca en el SQL.
- **Una fila `sticky` dentro de una tabla con desplazamiento sólo se
  alcanza si es sticky SIEMPRE.** Hacerla sticky «cuando hay algo que
  enseñar» es un bucle: para que haya algo que enseñar hay que poder
  tocarla primero.
- **`create table if not exists` sobre una tabla que ya existe con otra
  forma no avisa**: la salta en silencio y falla el primer índice que
  nombre una columna que no está. Antes de crear una tabla hay que
  buscarla en las migraciones viejas.
- **`localStorage` LANZA en ventana privada**, no devuelve null. Todo
  acceso va en try/catch y la pantalla tiene que funcionar sin él.
- **Al guardar un maestro-detalle desde el navegador, los renglones que
  sobran se comparan contra los identificadores VIVOS, no contra los del
  formulario.** Un renglón recién insertado todavía no tiene
  identificador: compararlo contra el formulario lo borra justo después
  de crearlo. Y el borrado va SIEMPRE al final, nunca antes de insertar:
  así una desconexión a mitad deja un renglón de más —visible— y no un
  dato capturado que desapareció.
- **Una función `security definer` que sirve a una pantalla tiene que
  comprobar el permiso DENTRO.** `fn_siembras_de_lotes` lee `siembras`
  saltándose el RLS de Trasplante para que Desinfección pueda
  autocompletar; sin la comprobación interna sería un agujero por el que
  cualquiera leería la siembra de toda la finca.
- **Un bloqueo que sólo existe en la pantalla hay que escribir que sólo
  existe en la pantalla.** El candado de fase de desinfección
  (`faseCerrada`) no lo aplica RLS, porque el módulo no cuelga de un
  ticket y no tiene el tope de NOTIFICADO. Evita el error de pasada; no
  es seguridad. El navegador nunca concede: sólo esconde.
- **Un candado de pantalla se decide al CARGAR, no mientras se
  escribe.** Mirar el estado vivo para bloquear una sección «ya
  completa» la cierra en la cara de quien está capturando. La foto se
  toma cuando llegan los datos de la base y no se vuelve a mirar.
- **`greatest(fin - inicio, …)` NO sirve para horas que cruzan la
  medianoche**: aplasta a cero justo el turno nocturno. La forma es
  `case when fin < inicio then (fin - inicio) + interval '24 hours'`.
  Y ojo con el CHECK que prohíba `fin >= inicio`: hay que quitarlo.
- **Un componente declarado DENTRO del render se recrea en cada
  pulsación** y React le reinicia el estado —el buscador de un selector
  se cerraba solo a media palabra—. Va fuera, con sus props.
- **Un renglón en blanco de una sub-tabla NO es un dato: es el hueco
  donde escribir.** Hay que descartarlo antes de validar y antes de
  guardar, comparándolo campo a campo con su plantilla. Y la plantilla no
  puede traer valores que parezcan escritos: `jornadas: '1'` de fábrica
  hizo que el formulario se acusara a sí mismo y bloqueó el guardado
  incremental del módulo entero.
- **Una columna normal no se vuelve GENERADA con un `alter`.** Hay que
  quitarla y volver a ponerla, y antes tirar las vistas que la nombran.
  Lo mismo para quitar columnas de una tabla que una vista lee.
- **En una llave única con una columna que admite nulos, hay que decidir
  si dos nulos son el mismo valor.** Por omisión Postgres dice que no, y
  entonces la llave no impide repetir la fila «sin producto» cien veces.
  `nulls not distinct` (PG 15+) es lo que la cierra.
- **`greatest` IGNORA los nulos.** Eso lo vuelve la forma más corta de
  escribir «esta hora todavía no se capturó, cuenta cero» en una columna
  generada, sin un `coalesce` por cada término.
- **`tarifas_puesto` se lee con el permiso de Costos o de Tarifas.** Quien
  captura en campo no suele tenerlo, así que cualquier pantalla que
  necesite una tarifa para enseñar un número usa `fn_tarifa_puesto`, que
  es `security definer` y está concedida a `authenticated`.
- **`fn_ve_zona` devuelve `true` cuando el usuario NO tiene zonas
  asignadas.** Por eso un recorte zonal no se nota hasta que alguien
  tiene zonas, y por eso las pruebas necesitan un usuario con zonas.
- **No se le manda nunca `package-lock.json` a la máquina de Henry:** un
  lock generado en Linux dispara el fallo de dependencias opcionales de
  npm y el binario de SWC para win32 no se instala.
- **`SUPABASE_SERVICE_ROLE_KEY` nunca lleva el prefijo `NEXT_PUBLIC_`**,
  nunca se sube a GitHub, y va protegida con `import 'server-only'` más
  verificación de permiso en el route handler.
- **Next.js 16:** `params` y `searchParams` son Promesas; el middleware
  es `src/proxy.ts`. Ver `AGENTS.md`.

---

## 5. Cómo se prueba

Cada migración lleva su suite en `/tmp/pgverif` (PostgreSQL 16 real, no
simulado): `construir.sh NN` levanta la base desde `01` hasta `NN` con un
stub de `auth` y los `grant` por defecto de Supabase, y `correr.sh
tNN.sql` la reconstruye y corre la suite contando verdes y rojas.

Para un cambio que toca permisos o RLS, la prueba que de verdad importa
es el **barrido comparativo**: construir la base dos veces —la versión
anterior y la nueva—, preguntarle a las dos por todos los cruces o contar
las filas visibles por persona, y comparar una por una. Si algo se movió
sin que fuera la intención, sale ahí.

La otra prueba que no puede faltar cuando se toca el ABAC es la de
**paridad**: generar las 480 combinaciones de (alcance × condición ×
acción × dueño × proceso × estado) en el navegador y en Postgres y
compararlas una por una. `canExecuteAction` y `fn_verificar_permiso`
tienen que contestar lo mismo en las 480. Si una de las dos se toca sin
la otra, esa prueba lo dice.

`t42_52.sql` es la red de seguridad de las once migraciones anteriores
al ABAC. No reproduce lo que cada una hacía —eso se probó el día que se
entregó— sino lo que un refactor podría romper sin ruido: que la pieza
siga existiendo con su forma, que la regla de negocio siga contestando lo
mismo, y que **los disparadores sigan enganchados**. Un trigger
desaparece sin error y lo que protegía deja de protegerse.

Esa misma suite lleva tres comprobaciones transversales que conviene no
quitar: ninguna función o policy nombra un rol a mano, ninguna tabla de
operación se quedó sin RLS ni con RLS pero sin policies, y **ninguna
función `security definer` se quedó sin `search_path`**. La tercera
encontró tres funciones viejas abiertas.

Para lo de Excel hay una suite aparte (`texcel.mjs`) que construye un
`.xlsx` **de verdad** con openpyxl y lo vuelve a leer. Probar
`serialAFecha` por su cuenta no basta: lo que fallaba era la cadena
entera —abrir el ZIP, encontrar los estilos, cruzarlos con el atributo
`s` de la celda—, y eso sólo sale construyendo un libro real.

Antes de entregar: `npx tsc --noEmit`, `npx eslint src --max-warnings=0`,
`npm run build`.

---

## 6. Completados

La migración a ABAC está **cerrada en toda la plataforma**.

- **Fase 1** (migración 53) — los tres ejes en la base.
- **Fase 2** (migración 54) — la matriz los configura por celda.
- **Fase 3** (migración 56) — `getReglas` carga los tres ejes,
  `canExecuteAction` decide cada botón, los DataGrids esconden por fila y
  los selectores de lote se recortan a las zonas asignadas cuando el
  alcance de «crear» es zonal.
- **Homologación final** (migración 57) — las once pantallas con
  cuadrícula deciden por fila con las mismas reglas, y las suites de
  regresión de la 42 a la 52 están reconstruidas y en verde.
- **Granularidad de catálogos** (migración 58) — «Catálogos» deja de ser
  una casilla y pasa a ser cinco bloques, aplicados por RLS tabla por
  tabla.
- **Desinfección de suelo** — núcleo en la migración 59, pantallas en la
  Fase 2, multiproducto y activador en la **60**, y en la **61** los
  turnos nocturnos, el historial de precios de materiales, los envases y
  la cuadrilla separada por fase.

Lo que queda abierto son ideas, no deuda, salvo UNA cosa que sí lo es y
está anotada arriba: **desinfección no tiene importador de Excel**. El
resto, al final del changelog de la 57.
