# Manual del jefe de zona, parametrista y gerente · Fertirriego

> Para: quienes **supervisan** estaciones (jefe de zona, parametrista, gerente de fertirriego, Torre de Control).
> Lee antes el **Manual del estacionero** (`01-estacionero-fertirriego.md`): todo lo que hace el estacionero también
> lo puedes hacer tú, si tu rol lo permite.
> Versión: noviembre 2026.

---

## 1. Qué ves según tu rol

Lo que ves en **Fertirriego** depende de dos cosas que el administrador configura en **Permisos**:

**a) El nivel** (qué puedes hacer):

| Nivel | Qué incluye en Fertirriego |
|---|---|
| **Ver** | Consultar estaciones, bodegas, bitácora, turnos. Exportar. |
| **Operar** | Además: Recibir, Aplicar, Contar, Relevo (entregar/recibir), Trasladar. |
| **Supervisar** | Además: Anular registros de otros, Registrar por otro, Autorizar traslados, Gestionar choferes. |
| **Todo** | Además: Administrar estaciones (asignar personas y custodia) y Configurar. |

**b) El alcance** (sobre qué estaciones):

| Alcance | Quién lo usa normalmente |
|---|---|
| **Sus estaciones** | Estacionero: solo las estaciones donde está asignado. |
| **Estaciones de sus zonas** | Jefe de zona / parametrista: todas las estaciones de sus zonas. |
| **Todas las estaciones** | Gerente de fertirriego, Torre de Control. |

Si tienes **varios roles**, se suman: vale el alcance más amplio que te dé cualquiera de ellos.

Cuando tienes más de una estación, arriba aparece un **selector de estación** con búsqueda: escribe parte del
nombre para encontrarla.

---

## 2. Asignar personas a las estaciones

Para que un estacionero vea su estación, tiene que estar **asignado**:

1. Menú **Usuarios** › abre la ficha de la persona.
2. Sección **Estaciones de riego** › marca sus estaciones (con búsqueda).
3. **Guardar**.

Al asignarlo, el sistema le crea su **llave de relevo** (la que genera el código de 6 números). Pídele que abra la
aplicación una vez **con señal** después de asignarlo, para que su teléfono baje las llaves de sus compañeros.

> Si eres jefe de zona con delegación, puedes hacerlo tú para las personas de tus zonas (ver Manual del
> administrador, «Delegación»).

---

## 3. Asignar la estación a una persona (custodia)

Una estación siempre está a cargo de **una sola persona**. Normalmente cambia sola con el **relevo** (entregar /
recibir con código). Tú intervienes cuando:

- Es la **primera vez** que se usa la estación.
- El compañero **no llegó** y alguien más se queda.
- Quien entregaba **no tiene teléfono** o se perdió el código.
- Un relevo quedó **rechazado** y hay que decidir.

Cómo: en la estación › **«Asignar la estación a una persona»** (necesita señal) › elige la persona › escribe el
**motivo** › Guardar. Queda registrado quién asignó, a quién y por qué.

> Si un estacionero registró algo **sin señal** antes de que tú reasignaras la estación, ese registro llega después
> con la marca **«el jefe asignó la estación después»** para que lo revises.

---

## 4. Autorizar traslados

Cuando un estacionero pide trasladar producto a otra estación, **elige quién lo autoriza**. Si eres tú:

1. Abre **Fertirriego** › pestaña **Traslados** › **«Te toca autorizar»**. (Si no tienes estaciones propias, te
   aparece directamente en la pantalla principal.)
2. Revisa origen → destino, motivo y cantidades.
3. **Autorizar** (nota opcional) o **No autorizar** (el motivo es obligatorio).

- Al autorizar, el producto **sale** de la estación de origen y queda **«en camino»** hasta que el destino lo
  reciba (con lo que de verdad llegó) o lo rechace (vuelve al origen).
- **Nadie puede autorizar su propio traslado.**
- Puedes autorizar sin tener la estación a cargo y **sin señal** (se envía cuando vuelva).

---

## 5. Anular y registrar por otro

- **Anular:** con el permiso **Anular** puedes anular registros de otros o de días anteriores. Siempre con motivo; el
  original queda visible y se agrega el movimiento contrario. Úsalo para corregir errores, no para «cuadrar».
- **Registrar por otro:** si un estacionero no tiene teléfono, en cada formulario aparece **«a nombre de»**: eliges al
  estacionero de la estación y registras por él. Queda anotado que lo hiciste tú.

---

## 6. Qué revisar cada día

| Dónde | Qué buscar |
|---|---|
| **Estación › En bodega** | Productos en **rojo (negativo)**: falta registrar una entrega o un conteo. |
| **Por turno** | Turnos con **aplicado** muy distinto del **plan**. |
| **Relevos** | Relevos **para revisar** (con diferencias) o **rechazados**. |
| **Traslados** | Traslados **en camino** que nadie ha recibido; **llegó menos** de lo enviado. |
| **Envíos** de cada estacionero | Registros **no aceptados** que no han corregido. |
| **AGL › /FR01 · Fertirriego** | El comparativo **Plan · Salidas SAP · Aplicado** y la **consignación** por estación (ver manual de AGL). |

### Las marcas para revisar

| Marca | Qué hacer |
|---|---|
| **sin ubicación** | Normal si no había GPS; revisar si se repite mucho en la misma persona. |
| **hora del teléfono distinta** | Pedir al estacionero que active la fecha/hora automática. |
| **la estación no estaba a su cargo** | Ver si el relevo se hizo bien. |
| **dejó el saldo en negativo** | Buscar la entrega que no se registró; si no aparece, hacer un **conteo**. |
| **producto fuera del plan** | Confirmar si fue un cambio autorizado. |
| **diferencia en el relevo** | Hablar con quien entregó y quien recibió. |
| **llegó menos de lo enviado** | Revisar el traslado con origen y destino. |

---

## 7. Conteos de control

Pide **conteos** periódicos (por ejemplo, cada semana o al cierre de mes). El estacionero toca **Contar** y escribe lo
que hay; la diferencia con el sistema queda como **«Ajuste por conteo»** en la bitácora, a la vista de todos.

---

## 8. Seguridad: por qué es difícil hacer trampa

- **Libro inalterable:** nada se borra ni se edita; las correcciones son movimientos nuevos con motivo y nombre.
- **Una persona a cargo** de cada estación a la vez; el relevo exige el **código del teléfono de quien entrega**,
  verificado dos veces (teléfono y servidor). Un código inventado no pasa.
- **Ubicación y hora** en cada registro, comparadas con la hora del servidor.
- **Traslados con autorización** de otra persona y aceptación del destino.
- La oficina compara **lo aplicado** contra **lo planificado** y contra **lo que salió de SAP**.
