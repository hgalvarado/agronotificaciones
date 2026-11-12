# Fertirriego · cambios tras la primera prueba piloto (2026-11-12)

Contrato entre la base (`sql/99_fertirriego_piloto1.sql`), la app de campo y AGL. Las decisiones del usuario
están en «Decisiones»: no volver a preguntarlas.

## Decisiones del usuario

- Relevo de noche: **código de entrega de 12 horas** (8 dígitos). Quien entrega lo deja escrito o lo manda por WhatsApp,
  y quien recibe lo digita sin señal.
- Productos fuera de MARA: **los crea el estacionero en campo** (sin señal), quedan «por validar», nunca van a MARA ni a
  AGL como material. Se agrupan por **clase** (Otros insumos, Otros objetos, o una clase nueva).
- Productos de MARA que no son fertilizantes: AGL publica **todo lo de los grupos de artículos que el usuario elija**.
- Envases: **saldo por estación** (se cuentan al recibir y al entregar; entran al conteo).

## Base · sql/99 (lo que cambia)

### materiales
- `origen text not null default 'MARA'` (`'MARA'` | `'CAMPO'`), `validado boolean not null default true`.
- Los de CAMPO: `codigo = 'CAMPO-' || left(id::text, 8)`, `activo = false` (así Desinfección y Catálogos no los
  ofrecen), `fertirriego = true`, `grupo` = la clase elegida, `unidad` = la que escribió.
- La lista del teléfono = `fertirriego and (activo or origen = 'CAMPO')`. Cada material lleva
  `{id, codigo, descripcion, unidad, grupo, origen, validado, analisis}`.
- `fn_fert_publicar`: cada material puede traer `grupo` (grupo de artículos de SAP; se guarda si el material no
  tiene) y `analisis` (boolean).
- **Clasificación (pedido del usuario, 2026-11-12)**: primero los **fertilizantes**, que son los que entran a los
  análisis (Plan · SAP · Aplicado). Los demás (de MARA o de campo) son solo para control de inventario y **no entran
  al comparativo**. Columna `materiales.fert_analisis boolean not null default false`. La decide AGL: en /FR01 el
  usuario marca, por grupo de artículos, cuáles publica y cuáles son «Fertilizante (entra al análisis)»; AGL manda
  `analisis` en cada material. Los de CAMPO siempre `false`. El teléfono los muestra en ese orden: Fertilizantes
  primero, después cada otra clase.

### Operación nueva `producto` (crear producto de campo, sin señal)
`datos = {material_id (uuid del teléfono), descripcion, unidad, grupo}`. La puede crear quien tiene `recibir`. Con
`gestionar_choferes` también corrige (`descripcion`, `unidad`, `grupo`, `validado`, `activo` = false lo saca de la lista).

### Envases
- `fert_envases_tipos(id uuid, nombre, validado, activo, created_by)`. Semillas: **Barril**, **Caneca**.
- Operación nueva `envase_tipo`: `datos = {envase_id, nombre}` (igual que chofer: crear por validar; con
  `gestionar_choferes` corrige `nombre`, `validado`, `activo`).
- `fert_envases_movimientos(id, estacion_id, envase_id, cantidad int (+ entra / − sale), motivo, documento_tipo,
  documento_id, fecha_hora, registrado_por)`. `motivo` = `RECEPCION` (recibidos, +), `ENTREGA` (entregados al chofer,
  −), `CONTEO` (ajuste), `ANULACION`.
- Recepción: `datos.envases = [{envase_id, recibidos, entregados}]` (enteros ≥ 0; una fila puede tener solo uno).
- Conteo: `datos.envases = [{envase_id, cantidad_real}]` → ajuste = real − saldo.
- Anular la recepción revierte sus envases.
- Estado del teléfono: `envases_tipos: [{id, nombre, validado}]`,
  `envases_saldos: [{estacion_id, envase_id, saldo}]`, y cada recepción trae `envases`.

### Recepción
- `datos.comentario` (ya existía en la tabla; ahora la pantalla lo pide: «Comentarios / problemas»).
- `datos.turnos = [turno_ciclo_id, …]` → `fert_recepciones.turnos uuid[]` (para qué turnos es el pedido).
- Estado del teléfono: cada recepción trae `turnos` y `comentario`.

### Aplicación (puntos 3, 4, 7)
- `datos.fecha` = **día de aplicación** (como antes).
- `datos.ddt_plan` (entero) + `datos.fecha_plan` (fecha del plan elegido) **o** `datos.extra = true`.
- La base guarda `ddt_plan`, `fecha_plan`, `extra`, y calcula `ddt_real = fecha − turnos_ciclo.fecha_siembra`.
- `en_plan` de cada producto: si eligió un DDT, ¿está ese producto en el plan de ESE día (turno + fecha_plan)?; si es
  extra, `false` sin la marca FUERA_DE_PLAN (ya se declaró extra). Teléfonos viejos (sin ddt ni extra): como antes.
- Estado del teléfono: cada aplicación trae `ddt_plan, fecha_plan, extra, ddt_real`.

### Bitácora de horas (punto 8)
- `datos.ppm_cloro_cabezal`, `datos.ppm_cloro_campo` (0–1000, opcionales) → columnas en `fert_bitacora_riego`.

### Relevo con código de 12 horas (punto 6)
- `metodo` admite `CODIGO_LARGO`.
- Código largo: HMAC-SHA1(llave de quien entrega, contador de 8 bytes = 2^40 + floor(epoch_seg / 600)), truncado
  como TOTP pero `% 100000000` → 8 dígitos. Lo genera el teléfono de quien entrega con el paso de la hora de entrega.
  Vale 12 horas: quien recibe prueba los pasos `paso_ahora − 72 … paso_ahora + 1`.
- `relevo_recibir` con `metodo = 'CODIGO_LARGO'`, `codigo` (8 dígitos) y `momento_codigo` = hora del teléfono que
  recibe. La base vuelve a verificar con `fn_fert_codigo_largo_valido(perfil, codigo, momento)`.

### Choferes y vehículos (punto 9)
- `fn_fert_catalogos_campo()` (con `gestionar_choferes` o admin): choferes (con nº de recepciones y última vez),
  vehículos, envases, productos de campo.
- `fn_fert_unir_chofer(p_quitar uuid, p_dejar uuid)` y `fn_fert_unir_vehiculo(...)`: pasa sus recepciones al que se
  deja y desactiva el otro.
- Editar, validar, desactivar: con las operaciones `chofer`, `vehiculo`, `producto` y `envase_tipo` por
  `fn_fert_sincronizar` (la pantalla de administración tiene señal).

### Exportación a AGL (`fn_fert_exportar`)
- Cada movimiento trae `origen` del material (`MARA`/`CAMPO`), `grupo`, y de su aplicación `ddt_plan, fecha_plan,
  extra, ddt_real`; de su recepción `turnos` (códigos) y `comentario`.
- `bitacora_riego` trae `ppm_cloro_cabezal`, `ppm_cloro_campo`.
- Nuevo `envases_saldos: [{estacion, zona, envase, saldo}]`.
- Cada movimiento trae también `analisis` (fert_analisis del material).
- AGL: solo los materiales clasificados como **Fertilizante** (por su grupo, según la clasificación de /FR01) entran al
  comparativo Plan · SAP · Aplicado y a la consignación valorizada. Lo demás (otros grupos de MARA y todo lo de CAMPO)
  se muestra aparte como «Otros productos de la estación» (solo inventario). Los de CAMPO nunca se cruzan con MARA.

## App de campo (puntos 1, 2, 3, 4, 5, 7, 8)

1. Recibir: botones (chips) con los turnos de la estación para marcar varios; «Comentarios / problemas»; bloque
   Envases (recibidos / entregados por tipo, con «Agregar otro envase» sin señal).
2. Guardado rápido: la ubicación se empieza a pedir al ABRIR el formulario; al tocar Guardar se valida, se cierra y
   se guarda en segundo plano. Si falla, queda el borrador y sale un aviso con «Reintentar» (abre el borrador) y
   «Avisar» (comparte el error por WhatsApp u otra app).
3. Aplicar: turno con botones; chips de los DDT del plan de ese turno (los cercanos al día de aplicación, sin aplicar
   primero) + chip «Extra». Con DDT: carga los productos de ese DDT (editable, agregar más). Con Extra: vacío.
4. «Día de aplicación» (antes «Día del turno»); se muestra «DDT real N» calculado (y la diferencia con el plan).
5. Pestaña Turno: por turno, tarjetas por DDT: DDT plan / DDT real, fecha plan / fecha real, y por producto
   Plan · Real · Variación. Las extra como tarjeta «Extra». 100% celular.
8. Horas: ppm de cloro en cabezal y en campo (cinta).
10. Productos: el selector agrupa por clase y permite «Agregar producto que no está en la lista» (descripción,
    unidad, clase).
