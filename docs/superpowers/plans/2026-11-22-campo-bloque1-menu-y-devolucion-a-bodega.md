# «Campo» · Bloque 1: menú «Campo» y devolución a bodega — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Reglas del proyecto que mandan sobre este plan (`proyecto-seguimiento.md` §2): Sonnet escribe código y SQL y NO ejecuta pruebas; **solo Opus ejecuta pruebas, una vez, al final (Task 5), con tope de 25 min**. Por eso los pasos de «correr la prueba» de cada tarea los ejecuta Opus en la Task 5; Sonnet solo escribe el test.

**Goal:** una entrada «Campo» en el menú que lista las fichas que el usuario puede usar (hoy Fertirriego y AgroMétricas), y una operación nueva «Devolución a bodega» (salida del inventario de la estación hacia suministros, bodega o taller) disponible en Fertirriego.

**Architecture:** el menú «Campo» es una pantalla nueva de la matriz de permisos (`pantallas`, módulo «Campo») que solo abre una página con tarjetas hacia las rutas existentes; cada tarjeta se muestra por el permiso propio de la ficha (el menú nunca da permisos). La devolución a bodega es una operación más del despachador `_fert_procesar`, con su tabla de documento, un tipo de movimiento nuevo en el libro y el mismo camino sin señal, anulación y exportación a AGL que las demás.

**Tech Stack:** Next.js 16 (leer `node_modules/next/dist/docs/` antes de tocar rutas), TypeScript, Supabase/PostgreSQL (migración `sql/128_*.sql`), IndexedDB para la cola sin señal, AGL en Python (`backend/fertirriego_analisis.py`).

**Spec:** `docs/superpowers/specs/2026-11-22-campo-inyeccion-motores-design.md` (§6.1 navegación, §6.2 devolución, §6.5 permisos, §7 paso 1 y 2; llamadas en §9).

## Global Constraints

- Ramas: commits en `desarrollo`; **nunca** push ni merge a `main` sin «pasa a producción».
- SQL: idempotente, todo `UPDATE`/`DELETE` con `WHERE`, parches a funciones con `pg_temp.parchar(p_fn, p_viejo, p_nuevo, p_marca)` como en `sql/116_*.sql` (nunca reescribir una función entera que otra migración parcha); número libre: **128**. Probar en réplica local (puerto 5499) en los órdenes 128>128, 116>128>116, 121>128, 128>121. Claude corre la 128 en **desarrollo**; producción la corre el usuario después de que Vercel publique.
- Permisos por matriz de la base, sin nombres de roles en código; equivalencia antes/después sobre un clon de producción: nadie pierde permisos, y «Campo ver» se concede solo a quien ya ve Fertirriego o AgroMétricas.
- Fechas/horas en UTC-6 (America/Tegucigalpa). Mobile-first (botones ≥44 px), operable con teclado, verbos «Guardar/Editar/Eliminar/Importar/Exportar».
- Pantallas nuevas con los componentes del proyecto (`Tarjeta`, `Acordeon`, `Insignia`, `MarcoRegistro`); nada de estilos inventados.
- Todo código que consulte la red lleva freno (regla de bucles: dependencias estables, intervalo mínimo, backoff, limpieza); correr `node scripts/revisar-bucles.mjs --todo` al final.
- «Eliminar por completo» (119–121) **no** se amplía en este bloque (queda anotado como pendiente en §Pendientes).

## Review Focus

- Devolver más que el saldo de la estación → se rechaza con el saldo disponible en el mensaje (a diferencia de «Aplicar», que permite negativo con casilla).
- Cantidad 0 o línea vacía → se ignora (como `leerLineas`); todas vacías → «Indica al menos un producto».
- Destino fuera de {SUMINISTROS, BODEGA, TALLER} o sin motivo → rechazo con mensaje claro.
- Reenvío del mismo UUID desde el teléfono (sin señal) → no duplica el movimiento (idempotencia del despachador).
- Anular una devolución → el saldo vuelve a lo anterior; anular dos veces → rechazo.
- Usuario sin ninguna ficha de Campo (ni Fertirriego ni AgroMétricas) abre `/campo` → redirige a `/`.
- Devolución hecha por quien no tiene la estación a su cargo → se guarda con observación `FUERA_DE_CUSTODIA` (comportamiento actual de `_fert_autorizar`), no se pierde.

---

### Task 1: Menú «Campo» (lista de fichas)

**Files:**
- Create: `src/lib/campo/fichas.ts`, `src/components/campo/PanelCampo.tsx`, `src/app/(app)/campo/page.tsx`
- Create: `sql/128_campo_menu_y_devolucion_bodega.sql` (parte 1: pantalla `campo`; la parte 2 es la Task 2, mismo archivo)
- Test: `pruebas/unit/campo_fichas.test.mjs`

**Interfaces:**
- Produces: `type FichaCampo = { codigo: string; nombre: string; descripcion: string; ruta: string; icono: string }` y `fichasCampo(ve: (pantalla: string, accion: string) => boolean): FichaCampo[]` (puro; devuelve en orden Fertirriego, AgroMétricas, solo las que `ve(...,'ver')`). Más tarde se agregan Inyección y Motores sin cambiar la firma.

- [ ] **Step 1: Write the failing test** `pruebas/unit/campo_fichas.test.mjs` (formato de `pruebas/unit/menu_por_rol.test.mjs`): `fichasCampo(() => false)` → `[]`; `fichasCampo((p) => p === 'fertirriego')` → una ficha con `ruta '/fertirriego'`; con ambas → `['/fertirriego', '/agrometricas']` en ese orden.
- [ ] **Step 2: Run** (lo ejecuta Opus en Task 5): `node --test pruebas/unit/campo_fichas.test.mjs` → FALLA (módulo no existe).
- [ ] **Step 3: Implement** `fichasCampo` en `src/lib/campo/fichas.ts` (lista constante de fichas con su pantalla de permiso; filtra por `ve(pantalla,'ver')`).
- [ ] **Step 4: Implement la página** `src/app/(app)/campo/page.tsx` siguiendo `src/app/(app)/fertirriego/page.tsx` (`getPermisos`, `puede`, `redirect('/')` si no hay ninguna ficha) y `PanelCampo.tsx` con una `Tarjeta` por ficha (enlace `next/link`, botón ≥44 px, descripción corta). Para el rótulo de estación y fichas futuras, solo la lista de fichas por ahora (la elección de estación sigue dentro de cada ficha).
- [ ] **Step 5: SQL parte 1** en `sql/128_*.sql`: insertar la pantalla `campo` en `pantallas` (nombre «Campo», módulo «Campo», ruta `/campo`, `en_menu = true`, ícono «plan» si no hay uno mejor) con sus acciones («ver») siguiendo cómo `sql/109`/`sql/111` crean y encienden `agrometricas`; conceder `campo · ver` a todo rol (y usuario con permiso directo, si el modelo lo permite) que ya tenga `fertirriego · ver` o `agrometricas · ver`. Idempotente; termina con `notify pgrst, 'reload schema';`. Leer antes `sql/92`, `sql/103`, `sql/109` y `sql/111` para el esquema exacto de `pantallas`/permisos.
- [ ] **Step 6: Verificar** (Opus, Task 5): prueba unitaria pasa; en desarrollo con el usuario Administrador, «Campo» aparece en el menú y muestra Fertirriego y AgroMétricas; un rol sin permisos de ninguna ficha no ve el menú y `/campo` redirige.
- [ ] **Step 7: Commit** `feat(campo): menu Campo con las fichas que el usuario puede usar`.

---

### Task 2: Devolución a bodega · base de datos (`sql/128`, parte 2)

**Files:**
- Modify: `sql/128_campo_menu_y_devolucion_bodega.sql`
- Test: `pruebas/sql/128_devolucion_bodega.sql`

**Interfaces:**
- Consumes: `_fert_autorizar(estacion, 'aplicar', fecha, inmediato, en_nombre) → text[]`, `_fert_lineas(jsonb) → (material_id, cantidad)`, `_fert_mover(op_id, estacion, material, tipo, cantidad, fecha, turno, doc_tipo, doc_id, inmediato) → obs`, `_fert_obs`, el patrón de `_fert_op_devolucion` (`sql/95`) y el parche de `sql/116`.
- Produces: operación de despachador `'devolucion_bodega'` con `datos = { estacion_id, fecha_hora, destino: 'SUMINISTROS'|'BODEGA'|'TALLER', motivo, lineas: [{material_id, cantidad}] }`; tipo de movimiento `'DEVOLUCION_BODEGA'` (cantidad negativa); tablas `fert_devoluciones_bodega(id, estacion_id, fecha_hora, destino, motivo, registrado_por, anulado_at …)` y `fert_devoluciones_bodega_detalle(devolucion_id, material_id, cantidad)`; las anulaciones aceptan `documento_tipo = 'devolucion_bodega'`.

- [ ] **Step 1: Write the failing test** `pruebas/sql/128_devolucion_bodega.sql` (formato de `pruebas/sql/116_*.sql`): con estación y producto de prueba y saldo inicial 100 → devolver 30 a `SUMINISTROS` deja saldo 70 con un movimiento `DEVOLUCION_BODEGA −30`; devolver 80 (saldo 70) falla con el saldo en el mensaje; destino `'OTRO'` falla; motivo vacío falla; mismo UUID dos veces no duplica; línea con cantidad 0 se ignora; anular la devolución devuelve el saldo a 100 y una segunda anulación falla; un usuario sin custodia queda con observación `FUERA_DE_CUSTODIA`.
- [ ] **Step 2: Run** (Opus): la prueba sobre la réplica con la 127 corrida → FALLA (operación desconocida).
- [ ] **Step 3: Implement** en la migración: (a) ampliar el `check` de `fert_movimientos.tipo` con `'DEVOLUCION_BODEGA'` (recrear la restricción por nombre, idempotente); (b) tablas nuevas con RLS y políticas iguales a `fert_devoluciones`; (c) `_fert_op_devolucion_bodega(p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid) returns text[]` (security definer, `search_path = public, pg_temp`): valida motivo, destino y al menos una línea; `_fert_autorizar(..., 'aplicar', ...)`; por línea exige `saldo >= cantidad` (usar la función de saldo que ya usa `_fert_mover`) y llama `_fert_mover(..., 'DEVOLUCION_BODEGA', -cantidad, ..., null, 'devolucion_bodega', p_id, p_inmediato)`; (d) parchar `_fert_procesar(jsonb)` (lista de tipos válidos y rama `when 'devolucion_bodega'`) y `_fert_op_anulacion` (aceptar el tipo nuevo, mismo permiso «Anular») con `pg_temp.parchar` y marca propia, sin reescribir las funciones; (e) incluir `devoluciones_bodega` en la exportación a AGL (parchar `fn_fert_exportar` como hizo la 116 con `aplicaciones_historicas`); (f) `notify pgrst, 'reload schema'`.
- [ ] **Step 4: Run** (Opus): la prueba pasa; luego los órdenes de la Global Constraints (128>128, 116>128>116, 121>128, 128>121) y la prueba de equivalencia de permisos sobre el clon de producción (`pruebas/sql/92_equivalencia.sql` como modelo).
- [ ] **Step 5: Commit** `feat(campo): sql/128 devolucion a bodega y pantalla Campo`.

---

### Task 3: Devolución a bodega · teléfono

**Files:**
- Create: `src/components/fertirriego/FormDevolucionBodega.tsx`, `src/lib/fertirriego/devolucionBodega.ts`
- Modify: `src/lib/fertirriego/tipos.ts` (agregar `'devolucion_bodega'` a `TipoOperacion` y `'DEVOLUCION_BODEGA'` al tipo de movimiento), `src/lib/fertirriego/calculos.ts` (rama en el cálculo de saldo + rótulo `DEVOLUCION_BODEGA: 'Devolución a bodega'` junto a la línea 153), `src/components/fertirriego/PanelEstacion.tsx` (botón «Devolver a bodega»), `DetalleDocumento.tsx`, `VistaEnvios.tsx`, `VistaBitacora.tsx` (rótulos y detalle), `src/lib/fertirriego/sincronizador.ts` solo si el despachador del teléfono lista los tipos
- Test: `pruebas/unit/campo_devolucion_bodega.test.mjs`

**Interfaces:**
- Consumes: `crearOperacion(tipo, datos, {ubicacion, enNombreDe, resumen})` (`operaciones.ts`), `MarcoRegistro`, `leerLineas` (cantidad 0 = vacía), el molde de `FormTraslado.tsx`/`FormRecepcion.tsx`.
- Produces: `armarDevolucionBodega(args: { estacionId: string; destino: DestinoDevolucion; motivo: string; lineas: {material_id: string; cantidad: number}[]; fechaHora: string }): { datos: Record<string, unknown> } | { error: string }` y `type DestinoDevolucion = 'SUMINISTROS' | 'BODEGA' | 'TALLER'`; el saldo local (`calculos.ts`) resta `DEVOLUCION_BODEGA`.

- [ ] **Step 1: Write the failing test** `pruebas/unit/campo_devolucion_bodega.test.mjs` (modelo `fertirriego_piloto1.test.mjs`): `armarDevolucionBodega` sin motivo → `{error}`; todas las cantidades 0 → `{error: 'Indica al menos un producto'}`; con 2 líneas válidas descarta la de 0 y devuelve `datos.destino`, `datos.lineas`; el cálculo de saldo local con un movimiento `DEVOLUCION_BODEGA` de `-30` baja el saldo de 100 a 70.
- [ ] **Step 2: Run** (Opus): FALLA (función no existe).
- [ ] **Step 3: Implement** `armarDevolucionBodega` (puro) y el cálculo de saldo; el formulario con selector de destino (3 botones grandes), `SelectorInteligente`/lista de productos con saldo visible, motivo obligatorio (sugerido «Fin de temporada»), cantidad por línea y guardado en segundo plano como los demás formularios (`MarcoRegistro` con `rapido`). Mostrar el saldo disponible por producto y avisar antes de enviar si la cantidad lo supera (la base igual lo rechaza).
- [ ] **Step 4: Run** (Opus): prueba unitaria pasa y `node scripts/revisar-bucles.mjs --todo` sin hallazgos nuevos.
- [ ] **Step 5: Commit** `feat(campo): devolucion a bodega en el telefono`.

---

### Task 4: AGL entiende la devolución a bodega

**Files:**
- Modify: `C:\HENRYALVARADO2022\AGLGestion_App\backend\fertirriego_analisis.py` (donde se interpretan los tipos de movimiento, junto a `TRASLADO_SALIDA`), y el bajado de datos de Fertirriego que reciba el campo nuevo `devoluciones_bodega` del export (buscar el módulo que ya recibe `aplicaciones_historicas`)
- Test: la prueba unitaria de Fertirriego existente de AGL (`prueba_fertirriego_*.py`; agregar un caso)

**Interfaces:**
- Consumes: export de `fn_fert_exportar` con `devoluciones_bodega` (Task 2) y movimientos con tipo `DEVOLUCION_BODEGA`.
- Produces: `DEVOLUCION_BODEGA` cuenta como **salida de inventario que no es consumo** (no entra al Real del Comparativo ni al análisis de aplicación) y aparece en el kardex de la estación.

- [ ] **Step 1: Write the failing test**: un movimiento `DEVOLUCION_BODEGA −30` baja el saldo de la estación en 30 y no suma al Real del comparativo.
- [ ] **Step 2: Run** (Opus): FALLA.
- [ ] **Step 3: Implement** en `fertirriego_analisis.py`, y que el sincronizador de AGL guarde `devoluciones_bodega` con la huella como el resto (sin romper `Terminar ciclo`: las devoluciones a bodega no son de un turno y no entran al paquete de archivo).
- [ ] **Step 4: Run** (Opus): la prueba pasa. Commit en AGL `feat(fertirriego): devolucion a bodega no cuenta como consumo`.

---

### Task 5: QA única (Opus), documentación y cierre

**Files:**
- Create: `pruebas/qa/campo_devolucion_bodega.ps1` (modelo `pruebas/qa/fertirriego_relevo_traslado.ps1`)
- Modify: `docs/manuales/01-estacionero-fertirriego.md` (sección «Devolver a bodega»), `proyecto-seguimiento.md` y `MEMORIA_CLAUDE.md` (ambas copias del seguimiento), `docs/agl-fuente-unica.md` no

- [ ] **Step 1:** Opus, **una sola vez, tope 25 min** (copiar la regla en el brief; abortar y limpiar lo que se trabe más de ~3 min; informe PASA/FALLA/SIN PROBAR): corre las pruebas unitarias nuevas, `pruebas/sql/128_*.sql` en la réplica con los órdenes de la Global Constraints, la equivalencia de permisos, y la QA con clics (usuario QA temporal, estación y producto de prueba que se borran al final): menú «Campo» y tarjetas; devolver con saldo suficiente e insuficiente; sin señal (Supabase bloqueado) y reenvío al volver; anular; bitácora y Envíos muestran «Devolución a bodega»; 412 px y tema oscuro. Lo puramente visual lo revisa el orquestador en Chrome contra el servidor de desarrollo (puerto 3000), sin scripts.
- [ ] **Step 2:** Si algo falla, Opus devuelve error y línea; Sonnet corrige; Opus repite solo esa prueba.
- [ ] **Step 3:** Claude corre `sql/128` en **desarrollo** (cadena `SUPABASE_DB_URL_DESARROLLO`, nunca impresa), verifica y reporta. Producción: el usuario corre la 128 después de que Vercel publique el código (con «pasa a producción»).
- [ ] **Step 4:** Actualizar manual, `proyecto-seguimiento.md` (ambas copias: «128 = menú Campo y devolución a bodega»; próximo número libre 129; pendiente: ampliar «Eliminar por completo» a devoluciones a bodega; siguiente bloque = Inyección por lote) y `MEMORIA_CLAUDE.md`. Commit `docs: bloque 1 de Campo`.

## Pendientes que este bloque deja anotados
- «Eliminar por completo» (119–121) no incluye todavía las devoluciones a bodega.
- Siguiente bloque (otro plan): Inyección por lote (spec §6.3), luego Motores y combustible (§6.4), luego cuadre y alertas.
