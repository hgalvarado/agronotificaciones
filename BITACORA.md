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
