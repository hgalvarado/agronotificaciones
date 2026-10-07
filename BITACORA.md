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
por las policies de siempre. `telecom` no entra en el patrón: sus tablas
no cuelgan de ninguna tabla padre con permiso propio, así que ahí nunca
hubo estrangulamiento.

**Reglas para quien añada una vista de módulo:**

1. La cruda va en `interno`, nunca en `public`.
2. La expuesta SIEMPRE lleva `fn_permitido_de('<su pantalla>','ver')`.
3. Se añade a la lista del bucle de la migración 56, no se escribe la
   reja a mano: trece rejas escritas a mano acaban siendo trece rejas
   ligeramente distintas, y la que esté mal no la ve nadie.
4. El guardián de la 56 revienta la migración si alguna cruda se queda en
   `public`, si alguien puede entrar a `interno`, o si una expuesta queda
   sin reja.

### 2.6 La misma regla en el navegador

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

Antes de entregar: `npx tsc --noEmit`, `npx eslint src --max-warnings=0`,
`npm run build`.

---

## 6. Completados

- **Fase 1 del ABAC** (migración 53) — los tres ejes en la base.
- **Fase 2 del ABAC** (migración 54) — la matriz los configura por celda.
- **Fase 3 del ABAC** (migración 56) — `getReglas` carga los tres ejes,
  `canExecuteAction` decide cada botón, los DataGrids esconden por fila y
  los selectores de lote se recortan a las zonas asignadas cuando el
  alcance de «crear» es zonal.

## 7. Pendiente

- Reconstruir las suites `t42`–`t52`, perdidas cuando se recicló el
  contenedor de trabajo. El barrido comparativo cubre la regresión de
  permisos, pero no la lógica propia de cada una de esas migraciones.
- `v_labores_control` no expone `zona_id`, así que el navegador no puede
  comprobar el eje ZONAL de una escritura fila por fila; la base sí lo
  hace. Añadir la columna a la vista cerraría ese hueco cosmético.
- Las pantallas de trasplante, riego y telecom siguen pasando booleanos
  de pantalla a sus DataGrids. Funciona —la base manda— pero no esconden
  por fila como labores y horómetros.
