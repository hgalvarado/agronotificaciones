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

---

## 3. Registro de cambios

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

Antes de entregar: `npx tsc --noEmit`, `npx eslint src --max-warnings=0`,
`npm run build`.

---

## 6. Pendiente

- **Fase 3 del ABAC:** `getPermisos`/`auth.ts` cargando alcance y
  condición, no sólo la llave; `canExecuteAction(record, permission)`
  para esconder Editar y Eliminar en el DataGrid y en los formularios
  cuando el ticket está en «1. Revisando» y la condición es
  `solo_abiertos_registrando`; selectores de Lote y Zona recortados a las
  zonas asignadas cuando el alcance de creación es `zonal`.
- Reconstruir las suites `t42`–`t52`, perdidas cuando se recicló el
  contenedor de trabajo. El barrido comparativo cubre la regresión de
  permisos, pero no la lógica propia de cada una de esas migraciones.
