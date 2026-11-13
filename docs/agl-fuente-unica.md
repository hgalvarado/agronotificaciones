# AGL como única fuente de los catálogos (análisis 2026-11-12)

> Pedido del usuario (2026-11-12): «los catálogos sí debemos unificarlos todos; tenemos muchas cosas en
> AgroNotificaciones que ya se manejan en AGL; hacer un análisis, borrar lo de AgroNotificaciones y dejar lo de AGL».
> «La temporada 2025-2026 se crea como inactiva porque ya pasó». «Las estaciones las voy a crear en AGL; ahora se
> unificaron a solo 4». Supabase debe guardar **lo mínimo**: es solo el intermediario entre AGL y el teléfono.
>
> **Este documento es un análisis. No se ha borrado ni cambiado nada.** Espera la aprobación del usuario.
>
> Fuentes comparadas (solo lectura): AGL de producción (`Torre Control dv\data\catalogos`, 2026-11-12) y la copia
> local de la base de producción (`prod101`, réplica = producción + 99..101). La base de desarrollo tiene además
> datos de las pruebas piloto de Fertirriego (ver riesgos de estaciones).

## 0. Resumen en 6 líneas

1. **Pasan a AGL (AGL manda, Supabase recibe):** zonas, temporadas, turnos, estaciones de riego, variedades
   (melón/maíz), materiales usados en campo, procesos SAP y tareas SAP (el /OS03 de AGL ya tiene casi todas), lotes
   (al final). Casi todo **ya coincide**: las diferencias son pocas y conocidas (§2).
2. **Se borran de AgroNotificaciones** (con respaldo): planes nutricionales y turnos de riego viejos (el módulo de
   Riego ya se mudó a AGL; el plan viaja dentro de cada turno publicado).
3. **Se quedan en AgroNotificaciones** (AGL no los tiene): equipos, familias, implementos, códigos de implemento,
   labores, categorías de labor, personal/operadores, puestos y tarifas, proveedores, departamentos, objetivos de
   control.
4. **Nada histórico se rompe:** los ids de Supabase no cambian, nada se borra físicamente; lo que AGL ya no tiene
   queda **inactivo** (deja de ofrecerse, pero los tickets viejos lo siguen mostrando).
5. La temporada **2025-2026 ya existe en Supabase como inactiva**; solo falta crearla en AGL (§4.1).
6. **Las zonas 2B, 2C y 3C no tienen datos propios**: los 2 usuarios que las tienen también tienen 2A/3B. Se pueden
   desactivar sin que nadie pierda nada (decisión 1).

## 1. Reglas de la sincronización (producción no puede romperse)

1. Una sola dirección: **AGL → Supabase**, con el usuario técnico «Integración AGL» (nunca la llave maestra), por una
   función `fn_agl_publicar_catalogos` igual en espíritu a `fn_fert_publicar` (sql/91, 99).
2. Cruce por **llave natural normalizada** (`_fert_llave`: sin mayúsculas, espacios ni guiones: «Zona-1» = «Zona 1»)
   y, la primera vez, se guarda el **id de AGL** en la fila de Supabase (`id_legacy`/`agl_id`). Desde ahí se cruza por
   ese id: un cambio de nombre en AGL renombra, no duplica.
3. **Nunca se borra** una fila que algo referencia: lo que sale de AGL queda `activo = false`. (Temporadas y
   lotes-temporada tienen FK con `ON DELETE CASCADE`: un borrado se llevaría planes, desinfección y tarifas.)
4. Los **ids de Supabase no cambian** (tickets, horómetros, labores, desinfección y fertirriego apuntan a ellos).
5. AGL manda solo en las columnas que AGL tiene. Las columnas propias de AgroNoti (ej. ingrediente activo de un
   material, DDT de cosecha de una variedad) no se tocan.
6. Toda publicación tiene **vista previa** (`simular: true`): devuelve qué va a crear, cambiar y desactivar, sin
   escribir. El usuario la mira en AGL y confirma.
7. En AgroNoti el catálogo publicado queda de **solo lectura** con el aviso «Se administra en AGL (/ER01…)».
8. Supabase guarda **lo mínimo**: de los 835 materiales de AGL solo viajan los que usa el campo; de las variedades,
   las que tienen lotes/planes.

## 2. Catálogo por catálogo

Leyenda de propuesta: **AGL** = AGL lo administra y lo publica · **Local** = se queda en AgroNoti · **Borrar** = se
retira (con respaldo en el esquema `respaldo`).

### 2.1 Zonas — propuesta **AGL**

| | AGL (/ZN01) | AgroNoti (`zonas`) |
|---|---|---|
| Filas | 4: Zona-1, Zona-2A, Zona-3A, Zona-3B | 7: las mismas 4 («Zona 1»…) + **Zona 2B, Zona 2C, Zona 3C** |
| Llave | nombre | nombre (único) |
| Diferencias | responsables «Marco Reyes», «Osman Galindo» | «Marcos Reyes», «Osman Galindos»; 2C con Marcos Reyes |

| Zona solo en AgroNoti | Turnos | Estaciones | Lotes | Usuarios con esa zona | Otros |
|---|---|---|---|---|---|
| Zona 2B | 0 | 0 | 0 | 0 | — |
| Zona 2C | 0 | 0 | 0 | 1 (David Vasquez, que **también** tiene 2A) | — |
| Zona 3C | 9 (T1003-T50…T58; **AGL los tiene en Zona-3B**) | 0 | 0 | 1 (Gustavo Betancourth, que **también** tiene 3B) | 2 turnos de riego viejos |

- **Usan zonas:** permisos por zona (`perfiles_zonas`, RLS «zonal» de lotes, tickets, horómetros, labores,
  desinfección), turnos, estaciones, lotes-temporada, desinfección (logística), Fertirriego, Usuarios.
- **Reconciliación:** pasar los 9 turnos de 3C a 3B (lo hace la publicación: AGL los tiene en 3B), quitar 2C/3C a
  los dos usuarios (no pierden nada: ya tienen 2A/3B), desactivar 2B/2C/3C. Nombres y responsables: los de AGL.
- **Riesgo:** **alto en concepto, bajo en datos.** Si se borrara una zona, `perfiles_zonas` cae en cascada y un usuario
  podría dejar de ver datos. Por eso: solo desactivar, y la publicación avisa si una zona que se desactiva aún tiene
  usuarios. Ninguna FK de tickets/horómetros apunta a zonas.

### 2.2 Temporadas — propuesta **AGL**

| | AGL (/TM01) | AgroNoti (`temporadas`) |
|---|---|---|
| 2025-2026 | **No existe** | Existe, **inactiva** (75 lotes-temporada con área 0, 38 tarifas de puesto; 0 tickets) |
| 2026-2027 | Activa, tasa 27.35, período SAP 16 | Activa (215 tickets, 1.525 líneas) |
| 2027-2028 | Inactiva, período 17 | Inactiva |
| Columnas | id_temporada, fechas, estado, **tasa_cambio_usd**, **periodo_sap** | nombre, fechas, activa, codigo_pep (vacío) |

- **Usan temporadas:** 15 tablas (tickets, registros, lotes-temporada, planes, desinfección, rotación, tarifas,
  tasas…). 5 de ellas con borrado en cascada.
- **Reconciliación:** crear 2025-2026 **Inactiva** en AGL (§4.1); la publicación la encuentra por nombre y guarda el
  id de AGL. La tasa de AGL entra al historial de tasas de AgroNoti (`historial_tasas_temporada`) como una vigencia
  más, no reemplaza lo anterior. Supabase exige **una sola activa** (disparador): si AGL trae dos «Activa», la
  publicación se detiene y avisa.
- **Riesgo:** **muy alto si se borra; nulo si solo se inserta/actualiza.** La publicación nunca borra temporadas.

### 2.3 Turnos (maestro) — propuesta **AGL**

| | AGL (/TR01) | AgroNoti (`turnos`) |
|---|---|---|
| Filas | 124, todos «Activo» | 132, todos activos |
| Solo en AgroNoti | — | 8 sub-turnos de Zona 3B: T1003-T29-A/B/C, T1003-T38-A/C, T1003-T44-C, T1003-T44-b, T1003-T46-B (**0 usos**) |
| Zona distinta | T1003-T50…T58 en Zona-3B | en Zona 3C |

- **Usan turnos:** Fertirriego (`turnos_ciclo`, lo publica ya «Publicar a campo»), Desinfección (selector; 0 filas lo
  usan), turnos de riego viejos (5 filas).
- **Reconciliación:** los 8 sub-turnos no tienen ningún uso → quedan **inactivos** (o, si existen de verdad en el
  campo, se crean en AGL; decisión 2). Los 9 de 3C pasan a 3B.
- **Riesgo:** bajo. La columna `nombre` (descripción) está vacía en todos: se puede retirar en la fase C.

### 2.4 Estaciones de riego — propuesta **AGL** (ya lo es a medias)

| | AGL (/ER01) | AgroNoti (`estaciones_riego`) |
|---|---|---|
| Filas | 17, con zona | 17, mismos nombres, **sin zona** en producción |
| Campos | estación, zona (sin «activo») | código y descripción (vacíos), zona, activo, prueba_de |
| Usos en producción | 18 turnos de riego de AGL usan 6: Papalon-1, Papalon-2, Sierra, Vega, Carretales, Congolon | 0 movimientos de Fertirriego, 0 custodios, 5 turnos de riego viejos |

- **Usan estaciones:** Fertirriego (bodega, saldos, custodia, relevos, traslados, permisos por estación
  `perfiles_estaciones`), Desinfección (selector), Usuarios (estaciones de cada persona).
- **Reconciliación (las 4 estaciones):** en producción **no hay movimientos de Fertirriego todavía**, así que hoy es
  el momento barato. Pasos en §4.2: crear las 4 en AGL, mover a ellas los turnos de riego de AGL (/TR02) y quitar
  las 13 que sobran. La publicación desactiva en Supabase las que AGL ya no trae (cambio a `fn_fert_publicar`: hoy
  solo agrega). En **desarrollo** sí hay datos de las pruebas piloto: ahí las viejas quedan inactivas con su
  historia; las «PRUEBA · X» siguen funcionando (apuntan a su estación real por `prueba_de`).
- **Riesgo:** medio. Si una estación con saldo o custodio se desactiva, su saldo queda colgado. La publicación
  **no desactiva** una estación con saldo ≠ 0 o con custodio: avisa y la deja activa hasta que se traslade el saldo.

### 2.5 Materiales — propuesta **AGL** (solo los que usa el campo)

| | AGL (/MT01, MARA) | AgroNoti (`materiales`) |
|---|---|---|
| Filas | 835 | 6 en producción (4 fertilizantes, VAPAM, manta térmica) + los que publica Fertirriego |
| Diferencias | código «100019» | «␠100019» (con espacio delante): **se duplicaría** al publicar |
| Columnas solo AgroNoti | — | ingrediente activo, concentración, objetivos de control, etiquetas (Desinfección), `origen` CAMPO, `fert_analisis` |

- **Usan materiales:** Fertirriego (todo), Desinfección (plan y ejecución), precios (`historial_precios_materiales`,
  3 filas), siembras viejas.
- **Reconciliación:** corregir el espacio de «100019» antes de la primera publicación (en la sql de la fase A, una
  línea con `where codigo = ' 100019'`). AGL publica código, descripción, unidad y grupo; AgroNoti conserva sus
  columnas de Desinfección. Los productos «de CAMPO» (creados por el estacionero, sql/99) siguen siendo locales.
- **Precios:** AGL tiene `precio_inventario`; propuesta: que AGL publique el precio y el historial de AgroNoti quede
  de solo lectura (decisión 4).
- **Riesgo:** bajo-medio (13 FKs, todas sin cascada salvo precios). Nunca se borra un material; solo se desactiva.

### 2.6 Variedades y productos (cultivos) — propuesta **AGL** para melón/maíz; las de cobertura, decisión

| | AGL (/VA01 + /TF01) | AgroNoti (`variedades` + `catalogo_productos`) |
|---|---|---|
| Filas | 18 variedades, 9 tipos de fruto | 73 variedades, 19 productos |
| Cruce | código SAP | las 18 de AGL están, **mismo código y nombre** |
| Solo en AgroNoti | — | 31 con código SAP viejo (FLORIDA, ZENTURION, ensayos…): **0 usos**; 24 sin código: cultivos de cobertura **con uso** (Sorgo 30, Crotalaria 8, Mucuna 2 en Rotación) y ensayos sin uso |

- **Usan variedades:** Rotación, Desinfección (plan), Trasplante viejo (planes de siembra, recepción).
- **Reconciliación:** AGL publica sus 18 por código SAP (guarda id de AGL). Las 31 viejas sin uso → inactivas. Los
  cultivos de cobertura: o se crean en AGL (necesitan un «cultivo» nuevo: Sorgo/Crotalaria/Mucuna) o quedan como
  propios de AgroNoti (decisión 3). `ddt_cosecha` se queda en AgroNoti. `catalogo_productos` se alimenta del tipo
  de fruto de AGL; los 10 productos sin equivalente (Calabaza, Okra, Sorgo…) quedan locales/inactivos.
- **Riesgo:** medio (7 FKs, sin cascada). Nunca se desactiva una variedad que tiene planes de la temporada activa.

### 2.7 Lotes y lotes-temporada — propuesta **AGL**, en la última fase

| | AGL (/LT01) | AgroNoti (`lotes` + `lotes_temporada`) |
|---|---|---|
| Filas | 87 de 2026-2027 (79 lotes + **8 sub-lotes**; 3 inactivos: Sierra-2y3, -6, -8) | 94 lotes; 94 lotes-temporada en 2026-27 y 75 en 2025-26 (área 0) |
| Llave | ubicación técnica (1002-060) + nomenclatura (Camaron-2) | `nomenclatura` = **ubicación técnica** de AGL; `nombre` = nomenclatura de AGL |
| Coinciden | 79 de 79: mismos nombres; **1 zona distinta** (1003-285: AGL Zona-1, AgroNoti Zona 3B); áreas iguales salvo los 3 inactivos | |
| Solo en AgroNoti | — | 12 lotes **administrativos** (Inocuidad 57 usos, Fito, Meca, Taller, Fertirriego Zona-X…), BOMBA-6 (I&D, 17 usos), 1003-025 Santa Teresa-2B (0 usos), fila basura «Nomenclatura/Nombre» |
| Solo en AGL | 8 sub-lotes (Arenales-4 SubLote-1…) | — |

- **Usan lotes:** cada línea de labor (`registro_detalle`, 1.837), planes de mecanización, desinfección, rotación,
  costos por lote. **Es el catálogo más delicado.**
- **Reconciliación:** decidir la zona de 1003-285; los administrativos y BOMBA-6 siguen siendo de AgroNoti (AGL no
  los maneja; marcados `tipo = ADMINISTRATIVO`) o se crean en AGL (decisión 5); borrar la fila basura (0 usos);
  los 8 sub-lotes entran con `lote_padre_id`. La 2025-2026 de AgroNoti (75 filas en 0) no se toca.
- **Riesgo:** **muy alto.** La publicación de lotes solo inserta/actualiza área, zona y nombre, y nunca desactiva
  un lote con líneas en la temporada activa. Va sola, después de que todo lo demás funcione.

### 2.8 Procesos SAP y Tareas SAP — propuesta **AGL** (cambio respecto al análisis del 11-nov)

| | AGL (/PR01 + /OS03) | AgroNoti (`procesos_sap` + `tareas_sap`) |
|---|---|---|
| Procesos | AP, LEV, CAT (+ SERV pendiente) | **APS**, LEV, CAT |
| Tareas | 23 órdenes en /OS03: T100…T901 + plantillas A{UT}, L{UT}, {TURNO} | 24: las mismas T + **SERVICIO, T910, T911, T912** |

- El /OS03 de AGL ya es el catálogo de tareas. Faltan T910-T912 y T-SERVICIO INTERNO, que **ya están en la lista
  de pendientes del usuario** en AGL (proyecto-seguimiento §2.3).
- **Usan:** cada línea de labor (`registros.tarea_id`, 1.534), labores↔tareas, planes.
- **Reconciliación:** AP (AGL) = APS (AgroNoti): se cruza por una tabla de equivalencias, **no se renombra** el código
  (lo ve el capturador). Las plantillas `A{UT}`, `L{UT}`, `{TURNO}` no se publican (no son tareas). El vínculo
  labor↔tarea sigue en AgroNoti.
- **Riesgo:** alto (las líneas notificadas a SAP llevan la tarea). Solo insertar/actualizar descripción y proceso.

### 2.9 Planes nutricionales y turnos de riego viejos — propuesta **Borrar**

| | AGL | AgroNoti |
|---|---|---|
| Planes nutricionales | 7 (por temporada) | 3, solo los usa `turnos_riego` |
| Turnos de riego | /TR02 (18) | `turnos_riego` 5 + detalle: módulo **retirado** de la UI el 2026-11-10 |

- El plan ya viaja como texto en cada turno publicado (`turnos_ciclo.plan`) y el detalle en `fert_plan`.
- **Riesgo:** nulo para tickets. Respaldo en `respaldo` y borrado sin CASCADE (fase C).

### 2.10 Se quedan en AgroNotificaciones (AGL no los tiene o no son lo mismo)

| Catálogo | AgroNoti | AGL | Por qué se queda |
|---|---|---|---|
| Equipos (36), familias (4), implementos (25), códigos de implemento (94), contadores | sí | solo «tipos de equipo» del taller (7) | AGL no tiene la flota |
| Labores (38), categorías de labor (3) | sí | «Categorías» (27) de SINAGRO: otra cosa | Lo usa solo la captura |
| Personal / operadores (118) | sí | no | Lo usa horómetros, desinfección |
| Puestos de trabajo (39), tarifas | sí | no | Costos de AgroNoti |
| Proveedores (6), objetivos de control (4) | sí | no | Captura / Desinfección |
| Departamentos (15) | organización | 2 de SINAGRO (Ferti-Riego, Fito-Protección) | Mismo nombre, otro significado: **no sincronizar** |
| Tasas de cambio (`historial_tasas_temporada`) | 1 | tasa en la temporada | AGL agrega vigencias (§2.2); tabla se queda |

Tablas vacías sin uso en la app: `catalogo_tasas_cambio` (0), `categorias_equipo` (0). Candidatas a borrar en la fase
C tras revisar las funciones SQL que las nombran (sql/59, 64, 65, 76).

## 3. Plan por fases (cada una segura y reversible)

Numeración: **105 en adelante** (102–104 los usan otros agentes). Todas se prueban primero en la réplica local
(clon de producción) con la «equivalencia» antes/después y QA con clics; el usuario las corre en desarrollo y luego
en producción **después** de publicar el código que las necesita.

### Fase A · AGL publica los catálogos (nada se apaga en AgroNoti)

- **`sql/105_agl_catalogos_publicar.sql`**
  - Columnas `agl_id` (texto, único cuando no es nulo) en `zonas`, `temporadas`, `turnos`, `estaciones_riego`,
    `variedades`, `catalogo_productos`, `materiales`, `procesos_sap`, `tareas_sap`, `lotes_temporada` (las que ya
    tienen `id_legacy` lo reutilizan). Nulas: no cambian nada existente.
  - Tabla `seguridad.catalogos_origen (tabla, origen 'AGL'|'LOCAL', desde)` — arranca todo en `LOCAL`.
  - Tabla de equivalencias `seguridad.agl_equivalencias (catalogo, valor_agl, valor_local)` (AP→APS).
  - `fn_agl_publicar_catalogos(p jsonb)` *security definer*, permiso `catalogos_agl · publicar`: por catálogo,
    cruce por `agl_id` y si no, por llave; inserta/actualiza solo columnas de AGL; desactiva lo que falta **solo si
    el paquete dice `completo` y nada lo protege** (saldo de Fertirriego, custodio, usuarios en la zona, líneas en la
    temporada activa); `simular: true` devuelve el informe sin escribir. Bitácora en `agl_publicaciones` (o se
    generaliza `fert_publicaciones`).
  - Ajuste a `fn_fert_publicar`: las estaciones se cruzan por `agl_id` y las que no vienen se desactivan con las
    mismas protecciones.
  - Corrección puntual: `materiales.codigo ' 100019'` → `'100019'` (con `where`).
  - **Reversa:** `drop function`, `drop table` de las 3 tablas nuevas y de las columnas `agl_id`. No toca datos.
- **AGL** (`backend/catalogos_campo.py`, botón «Publicar catálogos» en /FR01 o /SE03): arma el paquete desde sus
  catálogos, muestra la vista previa y publica. Orden: zonas → temporadas → estaciones → turnos → materiales →
  variedades → procesos/tareas. **Lotes no** en esta fase.

### Fase B · AgroNoti de solo lectura para lo que publica AGL

- **`sql/106_agl_catalogos_solo_lectura.sql`**
  - Disparador `fn_bloquear_si_agl()` (BEFORE INSERT/UPDATE/DELETE) en cada tabla publicada: si
    `catalogos_origen.origen = 'AGL'`, rechaza el cambio salvo dentro de la publicación (variable de sesión que solo
    fija `fn_agl_publicar_catalogos`). Permite las columnas propias (ingrediente activo, DDT de cosecha…).
  - Se pasa a `AGL` catálogo por catálogo con un `update seguridad.catalogos_origen … where tabla = 'zonas'` (lo
    corre el usuario cuando ya publicó y revisó). **Reversa:** volver la fila a `LOCAL`.
- **Código AgroNoti:** `MenuCatalogos`/`CatalogoTabla` leen `catalogos_origen`; las pestañas de AGL quedan sin
  Crear/Editar/Eliminar/Importar, con el aviso «Se administra en AGL (/ZN01, /TM01, /TR01, /ER01, /MT01, /VA01,
  /PR01, /OS03)». Exportar sigue. `admin/lotes` igual cuando lotes pase (fase B2). Sin roles escritos en código: lo
  decide la tabla.
- **Fase B2 (lotes):** `sql/107_agl_lotes_publicar.sql` agrega lotes/lotes-temporada al publicador (solo
  insertar/actualizar; protege lotes con líneas) y lo pasa a `AGL` cuando el usuario lo apruebe.

### Fase C · Retirar lo duplicado y lo que sobra

- **`sql/108_retiro_catalogos_duplicados.sql`** (respaldo previo en `respaldo`, sin CASCADE, con `where`):
  - Borrar `turnos_riego_detalle`, `turnos_riego`, `planes_nutricionales` (y su permiso/pantalla).
  - Desactivar (no borrar): zonas 2B/2C/3C (tras quitar `perfiles_zonas` de 2C/3C), 8 sub-turnos, 13 estaciones,
    31 variedades viejas, fila basura «Nomenclatura» (esta sí se puede borrar: 0 usos).
  - Quitar columnas vacías: `turnos.nombre`, `estaciones_riego.codigo/descripcion`, `temporadas.codigo_pep`
    (verificar antes que ninguna función las lea).
  - Tablas vacías `catalogo_tasas_cambio`, `categorias_equipo` si nada las usa.
  - **Reversa:** restaurar desde `respaldo.*` (script inverso incluido en el mismo archivo, comentado).
- **Código AgroNoti:** quitar las pestañas de edición duplicadas y los importadores de esos catálogos.
- **Aparte (ya pendiente):** tablas de Trasplante (`planes_siembra`, `siembras`, `recepcion_plantulas`…) cuando se
  decida la fuente del DDT de Desinfección: `sql/109`.

## 4. Pasos del usuario en AGL

### 4.1 Crear la temporada 2025-2026 inactiva

1. En AGL escribir **/TM01** (Temporadas) en la barra de comandos.
2. **Crear**. Llenar exactamente:
   - ID Temporada: `Temporada 2025-2026` (igual que en AgroNoti, con «Temporada» delante).
   - Fecha Inicio: 1 de agosto de 2025 · Fecha Fin: 31 de julio de 2026 (las mismas que tiene en AgroNoti).
   - Estado: **Inactiva**.
   - Tasa Cambio USD: dejar vacío (o la tasa con que cerró, si la tiene).
   - Período SAP: `15` (2026-2027 es 16).
3. **Guardar**. Revisar que en la lista solo 2026-2027 diga «Activa».

### 4.2 Dejar solo las 4 estaciones

Hacerlo **antes** de que Fertirriego tenga movimientos en producción (hoy tiene 0).

1. **/ER01** (Estaciones de Riego) → **Crear** cada una de las 4 con su nombre definitivo y su **Zona**. Si una de las
   4 conserva el nombre de una actual (ej. «Papalon-1»), no crearla: se deja la que existe y se le corrige la zona.
2. **/TR02** (Turnos de Riego operativo): en los 18 turnos, cambiar «Estación de riego» a una de las 4. Hoy usan
   Papalon-1 (3), Papalon-2 (4), Sierra (5), Vega (4), Carretales (1), Congolon (1).
3. **/ER01**: eliminar las estaciones que ya no se usan (las 13 restantes). Si AGL no deja eliminar alguna, avisar.
4. **/FR01** → «Publicar a campo» (con la fase A instalada, primero la vista previa): las 4 quedan activas en el
   teléfono y las demás inactivas. Si la vista previa dice que alguna tiene saldo o custodio, primero trasladar.
5. En AgroNotificaciones › Usuarios: asignar a cada estacionero su estación nueva.

### 4.3 Antes de la primera publicación de catálogos

- **/OS03**: agregar T910, T911, T912 y T-SERVICIO INTERNO (ya estaba en la lista de pendientes).
- **/TR01**: si los sub-turnos T1003-T29-A… existen en el campo, crearlos (zona 3B); si no, nada.
- **/LT01** (para la fase B2): decidir la zona de 1003-285 (AGL dice Zona-1; AgroNoti, Zona 3B).

## 5. Decisiones que debe tomar el usuario

| # | Decisión | Opciones | Recomendada |
|---|---|---|---|
| 1 | Zonas 2B, 2C, 3C | a) crearlas en AGL · b) desactivarlas en AgroNoti | **b**: no tienen datos; los 9 turnos de 3C ya están en 3B en AGL y los 2 usuarios ya tienen 2A/3B |
| 2 | 8 sub-turnos (T1003-T29-A…) | a) crearlos en AGL · b) desactivarlos | **b**: 0 usos; si se riegan aparte, crearlos en AGL |
| 3 | Cultivos de cobertura (Sorgo, Crotalaria, Mucuna) y ensayos | a) crearlos en AGL · b) dejarlos como propios de AgroNoti | **a** para los 3 con uso (Rotación); los demás sin uso, inactivos |
| 4 | Precio de materiales | a) AGL publica el precio MARA · b) AgroNoti sigue con su historial | **a** (una sola fuente; el historial viejo queda de consulta) |
| 5 | Lotes administrativos (Inocuidad, Taller…) y BOMBA-6 | a) crearlos en AGL · b) quedan propios de AgroNoti | **b**: AGL no los usa; se marcan como locales |
| 6 | Nombres de zona | a) los de AGL («Zona-1», «Marco Reyes») · b) los de AgroNoti | **a** (AGL manda) |
| 7 | Procesos: AP (AGL) vs APS (AgroNoti) | a) equivalencia sin renombrar · b) renombrar en uno de los dos | **a** |
| 8 | Nombres de las 4 estaciones y su zona | — | Que el usuario los dé; si se reutiliza un nombre actual, mejor (conserva el id) |
| 9 | Orden de arranque | — | Fase A en desarrollo con zonas+temporadas+estaciones+turnos primero; materiales/variedades/tareas después; lotes al final |
