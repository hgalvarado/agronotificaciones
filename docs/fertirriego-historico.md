# Fertirriego · Registro histórico (sql/116)

## Qué es
Permiso **temporal** para que una persona registre **aplicaciones que ya ocurrieron antes de usar el sistema**, en estaciones
que ya operaban, **sin mover el inventario** y sin inventar entregas. Pedido del usuario el 2026-11-18.

## Reglas
- **Quién lo da:** solo el administrador (`fn_es_admin()` o «Configurar» en Fertirriego, como el modo de pruebas; nada de roles escritos en el código).
- **A quién y dónde:** una **persona** y una **estación** por permiso (se pueden dar varias estaciones de una vez), con **fecha límite** inclusive en UTC-6 (máximo 90 días). Se puede **revocar** antes. Tabla `public.fert_historico_permisos` (RLS: solo lectura; se escribe con `fn_fert_historico_otorgar/revocar`).
- **Vigente** = sin revocar y `hasta >=` día de captura. Lo capturado sin señal se juzga por el día de captura (teléfono) y la base da 7 días de gracia para sincronizar.
- **Qué se registra:** SOLO aplicaciones (operación `aplicacion_historica`): turno, día, DDT del plan o Extra, productos y ejecutor.
  - Día **pasado** (< hoy UTC-6). Puede ser **anterior a la siembra** del turno (aplicaciones del plan con DDT negativo; `ddt_real` = día − siembra, negativo; sql/117 quitó la restricción de la 116). La aplicación normal nunca tuvo esa restricción.
  - Exige el permiso vigente en ESA estación (+ «Ver» en ella). **No exige custodia.**
  - **No crea movimientos** (ni saldos, ni libro, ni envases). Se guarda en `fert_aplicaciones` con `historica = true` y el texto «Registro inicial del proceso».
  - Idempotente por UUID. Si ya hay una aplicación (normal o histórica) del mismo turno + DDT/fecha + mismos productos: observación `POSIBLE_DUPLICADO` (no rechaza).
- **Anular:** con motivo, solo quien tiene «Anular» (la excepción de «mis registros de mi jornada» no aplica). No genera movimientos. **No admite devoluciones** (las rechaza un disparador).
- **Terminar ciclo / Reactivar (sql/102):** `historica` es nullable y su valor `false/null` NO entra a la huella (misma lección de la 112); se verificó que un turno archivado antes de la 116 sigue reactivándose.

## Pantallas
- **Administración › Registro histórico** (`/admin/fertirriego-historico`): persona, estaciones, fecha límite, nota; lista de permisos con estado (Vigente / Vencido / Revocado) y **Revocar**.
- **Campo:** en la pestaña Estación, «Registrar histórico» solo con permiso vigente (se recalcula con la fecha del teléfono: vencido = sin botón aunque no haya señal). Es `FormAplicacion` con la prop `historico`: alerta azul fija arriba «NO mueve el inventario» con los días que quedan, día máximo = ayer, sin alerta ni casilla de inventario. Funciona sin señal (cola local; el saldo local no cambia).
- **Bitácora:** fila por producto con insignia **Histórico** y «sin mover inventario»; el detalle dice «No movió el inventario».

## AGL (después)
`fn_fert_exportar` trae las históricas en **`aplicaciones_historicas`** (y NO en `aplicaciones`, que usa el Comparativo). Como no tienen movimientos, no cuentan como «Real». El paquete de «Terminar ciclo» las trae igual en `agl.aplicaciones_historicas` y en `filas` (con la marca para Reactivar). AGL no se tocó: cuando el usuario quiera, se agrega un tratamiento aparte (p. ej. mostrarlas como «histórico informativo» en el Comparativo).

## Límites y ampliación posible
- **Recepciones históricas: NO se construyeron** (decisión del usuario: si no las recuerdan, no se registran). Posible ampliación: operación `recepcion_historica` con las mismas reglas (permiso, día pasado, sin movimientos), que dejaría el dato para análisis sin cambiar saldos.
- Sin conteos, traslados ni envases históricos.
- El permiso es por estación real (no de prueba).

## Orden de corrida
`sql/116` va **después de la 115** y `sql/117` **después de la 116** (la 117 parcha la función de la 116: si se vuelve a correr la 116, correr la 117 otra vez). Si luego se vuelve a correr la 95, 99, 100, 102 o 115, correr la 116 otra vez (parches por texto con marca; son idempotentes). Probado: 116>116, 115>116, 100>101>116>116, 102>116 y un turno archivado antes de la 116 que se reactiva después.
