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
  Fase 2 y, en la **60**, multiproducto (en el plan y en la aplicación),
  el activador por turno y ciclo, las horas calculadas por la base y el
  autollenado desde Trasplante.

Lo que queda abierto son ideas, no deuda, salvo UNA cosa que sí lo es y
está anotada arriba: **desinfección no tiene importador de Excel**. El
resto, al final del changelog de la 57.
