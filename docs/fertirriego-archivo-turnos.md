# Fertirriego · terminar el ciclo de un turno (Supabase solo intermediario)

> 2026-11-13 · `sql/102_fertirriego_archivo_turnos.sql` · AGL `backend/fertirriego_archivo.py` + /TR02.
> Pedido del usuario: «quiero que Supabase sea un intermediario… al momento de que un lote se dé por cerrado el ciclo
> esa información bajarla (botón de terminado en AGL turnos), pero si lo vuelvo a activar entonces se vuelva a subir…
> tratar de llenar lo mínimo».

## 1. Qué hace

En AGL › Turnos de Riego (/TR02) se marcan uno o varios turnos y se pulsa **Terminar ciclo**. AGL baja todo lo del
turno, lo guarda en `data/fertirriego_archivo/<id_transaccion>.json` y la base lo **borra**. El turno queda
inactivo: los teléfonos dejan de verlo. **Reactivar** (en la misma tabla o en «Turnos archivados») vuelve a subir la
copia y el turno reaparece en campo con exactamente los mismos registros. La columna **Campo** dice «En campo» o
«Ciclo terminado».

## 2. Qué es «del turno» (se archiva) y qué no

| Se archiva (solo estaciones reales) | Se queda (es de la estación, no de un turno) |
|---|---|
| `fert_aplicaciones` + detalle | recepciones, conteos, relevos, traslados, envases |
| `fert_devoluciones` + detalle de esas aplicaciones | saldos (`fert_saldos`) |
| sus movimientos del libro (aplicación, devolución, anulación) | rechazados (90 días; AGL los ve) |
| `fert_bitacora_riego` del turno | todo lo del modo de pruebas |
| `fert_plan` del turno | la fila de `turnos_ciclo` (queda con `archivado_at`) |
| `fert_operaciones` de todo lo anterior (incluidas las ediciones de bitácora) | |

**Más adelante (no construido):** lo de la estación se podría archivar por mes con el mismo patrón (paquete + huella +
consolidado `SALDO_INICIAL` del mes siguiente), que es el «cierre mensual» de la Etapa E del diseño.

## 3. El inventario no cambia

El saldo es por **estación**. Al borrar los movimientos del turno se asienta **un** movimiento `ARCHIVO_TURNO` por
estación × producto con la suma de lo borrado (normalmente negativo: lo que el turno consumió), con la fecha del
último movimiento borrado y `documento_tipo = 'archivo_turno'`. Las funciones comprueban que la suma del libro por
estación × producto sea la misma antes y después (si no, nada se hace). `fert_saldos` no se toca. Al reactivar se
quita el consolidado y vuelven los originales. En el teléfono y en AGL se ve como «Turno terminado (archivado en AGL)».

## 4. Pasos seguros

1. `fn_fert_exportar_turno(p_agl_id)` (solo lectura): `filas` (cada fila con `to_jsonb`, orden fijo, horas en UTC),
   `conteos`, `huella` = sha256 del texto jsonb de `filas`, `consolidado` (lo que quedará), `agl` (aplicaciones,
   movimientos y bitácora con la forma de `fn_fert_exportar`, para seguir mostrándolos en AGL).
2. AGL guarda el texto **tal cual llegó** (sin reescribir números), lo relee del disco (sha256 de los bytes),
   **recalcula la huella** con la misma regla de Postgres (`huella_jsonb`: claves por largo y bytes, «, » y «: »,
   números exactos con Decimal) y compara los conteos. Agrega los movimientos a lo bajado por si faltaban.
3. `fn_fert_archivar_turno(p_agl_id, p_huella)`: recalcula la huella; si no es la misma (llegó algo nuevo del campo o
   se republicó el plan) **no borra nada** y pide repetir. Verifica que nada que queda apunte a lo que se va. Borra,
   asienta el consolidado, comprueba el saldo y marca el turno: `activo = false`, `archivado_at`, `archivo_huella`,
   `archivo_conteos`, `archivo_documentos` (aplicaciones y devoluciones, para los mensajes). Reintento con la misma
   huella = «ya estaba».
4. `fn_fert_restaurar_turno(p)`: exige que `p.huella` sea la del último cierre de ese turno en esa base. Quita el
   consolidado, borra los rechazos que tengan el mismo id que una operación del paquete (reenvíos del teléfono
   mientras estaba archivado), vuelve a insertar con los **ids y cursores originales** (`overriding system value`) y
   comprueba que la huella de lo restaurado = la del cierre (si no, deshace todo). Reactiva el turno
   (`restaurado_at`). Reintento con el turno ya activo = «ya estaba activo».

Permiso: «Fertirriego · Conexión AGL › Publicar» (el usuario técnico de AGL) o administrador. Nada con nombres de rol.

## 5. Protecciones

- **Libro inalterable de verdad**: disparador `fert_movimientos_inalterable` (UPDATE/DELETE rechazados aun al dueño de
  la base). Pasan solo: filas de estaciones de prueba (el modo de pruebas las borra, sql/98) y estas funciones, que
  abren el paso con `set_config('fert.libro_permitir', 'on', true)` dentro de su transacción y lo cierran al terminar.
- **Teléfono**: `fn_fert_estado_campo` ya filtra `turnos_ciclo.activo` → el turno archivado desaparece. Lo capturado
  sin señal (aplicación, bitácora, devolución o anulación de algo del turno) se **rechaza** antes de tocar nada
  (`_fert_exigir_turno_vivo`, parche en `_fert_procesar`) con el mensaje «El turno X ya terminó su ciclo: se cerró en
  AGL el …; queda en Envíos…». Queda guardado como RECHAZADO (AGL lo ve en Rechazados) y en «Envíos» del teléfono.
  Respaldo en las tablas: disparador `fert_turno_archivado` en aplicaciones, bitácora y movimientos.
- **AGL publica**: `fn_fert_publicar` no reactiva un turno archivado ni le cambia el plan (aviso «ciclo terminado»).
  AGL además no lo manda (`fertirriego_archivo.archivados()`).
- **Copias**: `data/fertirriego_archivo` es la ÚNICA copia de lo borrado: nunca se limpia sola (ni al cambiar de base,
  a diferencia de `data/fertirriego`). Una copia solo se restaura en la base de la que salió (`registro.json › origen`)
  y solo si sus bytes siguen siendo los guardados (sha256).
- AGL sigue mostrando lo archivado en /FR01: `fertirriego_detalle.lista('aplicaciones')` y
  `fertirriego_analisis.bitacora_riego()` juntan lo de las copias con lo bajado (sin repetir: manda lo bajado).

## 6. Límites conocidos

- Si una migración futura agrega una columna NOT NULL sin valor por defecto a una tabla archivada, restaurar un
  paquete viejo fallaría (la columna vendría vacía). Agregar columnas con default.
- El kardex intermedio (saldo a una fecha dentro del ciclo del turno) cambia: el consumo del turno queda en la fecha
  de su último movimiento. El saldo final es el mismo.
- `_fert_procesar` y `fn_fert_publicar` se parchan por texto (como la 98/101): si otra migración los reescribe, debe
  conservar la línea de `_fert_exigir_turno_vivo` y la regla de `archivado_at`.

## 7. Pruebas

- Réplica: `pruebas/sql/102_fertirriego_archivo_turnos.sql` 55/55 (órdenes 100→101→102→102 y 100→101→102→101→102).
- AGL: unitaria `fertirriego_archivo` contra la réplica 31/31 (huella igual a Postgres, copia, saldo, publicar, copia
  alterada, otra base, reactivar, segundo ciclo); QA con clics en /TR02.
