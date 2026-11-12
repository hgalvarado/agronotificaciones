# Reporte de la noche · 11 → 12 de noviembre de 2026

> Trabajo hecho solo, mientras usted descansaba. Todo en **desarrollo** (AgroNotificaciones, rama `desarrollo`) y en
> `main` local de AGL. **Nada se pasó a producción** y **no corrí SQL en Supabase** (como acordamos).
> La misma bitácora está en `AGLGestion_App\reporte7am.md`.

---

## Lo que tiene que hacer usted (en orden)

1. **Correr `sql/96_fertirriego_relevo_traslados.sql` en DESARROLLO** (SQL Editor del proyecto de desarrollo).
   Es la única migración nueva. Agrega el relevo con código, los traslados y la exportación a AGL. No cambia nada de
   lo que ya funciona (la app nueva funciona con y sin ella: lo probé).
2. Avíseme cuando la corra: lanzo la prueba con clics de relevo y traslados
   (`pruebas/qa/fertirriego_relevo_traslado.ps1`), que necesita la 96.
3. Para que AGL publique y baje de campo desde su PC: crear el archivo de conexión
   `%LOCALAPPDATA%\AGLGestion\fertirriego_DEV.json` (instrucciones en el manual de AGL, sección 2). Los datos del
   usuario técnico póngalos usted; no los mande por el chat.
4. Leer los manuales (abajo) y decirme qué cambiar antes de la charla con la gente de campo.

---

## 1. Fertirriego · Etapa C: relevo con código y traslados (AgroNotificaciones)

**Relevo (cambio de jornada):**

- Quien entrega toca **Entregar estación**, marca cómo deja cada turno (en aplicación / preparado en tanques /
  pendiente / terminado) y escribe novedades (obligatorio). Queda **bloqueado** en la estación.
- Su teléfono muestra un **código de 6 números que cambia cada 30 segundos**, calculado sin internet.
- Quien recibe lo escribe en **su** teléfono, que lo revisa **sin internet**. Un código equivocado no pasa; 5 errores
  bloquean 5 minutos. La base lo vuelve a revisar cuando llega.
- Al recibir revisa la bodega producto por producto: «Conforme» o «No cuadra» con lo que hay. Las diferencias ajustan
  la bodega y dejan el relevo **para revisar**.
- Con señal también se puede recibir sin código, iniciando sesión en el teléfono de quien entrega.
- Se puede **no recibir** (con motivo) o **cancelar** la entrega antes de que la reciban.

**Traslados entre estaciones:** crear (destino, quién autoriza, motivo, productos) → **autorizar** (otra persona; el
producto sale y queda «en camino») → el destino **recibe** con lo que llegó (si llegó menos, queda marcado) o
**rechaza** (vuelve al origen). Nadie autoriza su propio traslado.

**Pruebas:** SQL en la réplica 34/34; la app sin la 96 sigue funcionando (regresión de la Etapa B 27/27 con clics).
La prueba con clics de relevo/traslado está escrita y espera la 96.

## 2. Fertirriego · Etapa D: AGL baja lo de campo (AGL)

En **/CF07** hay dos cosas nuevas:

- Botón **«Bajar de campo»**: trae solo lo nuevo, sin duplicar nunca.
- Pestaña **«Campo»** con tres vistas:
  - **Comparativo** por turno y producto: **Plan · Cargado SAP · Aplicado**, diferencias, % del plan y un estado
    (en tolerancia ±5 %, menos, más, fuera de plan).
  - **Consignación**: lo que hay en cada estación, lo que viene en camino y su valor con el precio de MARA.
  - **Relevos a revisar**.

**Pruebas:** cálculo 14/14 y clics 13/13 contra una copia de la base con la 96. En la prueba encontré y corregí un
detalle: el aviso «Bajados N movimientos» se borraba al instante por otro aviso.

## 3. Manuales de usuario (los dos proyectos)

AgroNotificaciones › `docs/manuales/`:

| Archivo | Para quién |
|---|---|
| `00-guion-charla-fertirriego.md` | Usted o quien dé la charla: checklist previo, agenda de 90 min, práctica en parejas (con modo avión), preguntas que suelen salir. |
| `01-estacionero-fertirriego.md` | Estacioneros. Paso a paso de todo. **Para imprimir uno por persona.** |
| `02-jefe-de-zona-fertirriego.md` | Jefes de zona, parametristas, gerente: asignar, custodia, autorizar, qué revisar cada día. |
| `03-administrador-permisos-y-usuarios.md` | Administrador: roles, niveles, alcance, ficha de usuario, delegación, configuración sugerida. |

AGL › `docs/manual_fertirriego_AGL.md`: conexión, publicar a campo, bajar de campo, cómo leer el comparativo y la
consignación, problemas frecuentes.

**Extra:** el manual del estacionero se abre **dentro de la app** con el botón **«¿Cómo se usa?»**, también **sin
señal**. Probado con clics 12/12.

## 4. Pendiente que ya estaba aprobado: filtro «Horómetro malo» (/horometros)

Nueva tarjeta **«Horómetro malo»**: cuenta las lecturas que los capturadores reportaron como horómetro malo, dice
cuántos equipos, y al tocarla filtra la tabla. Probado con clics 9/9.

## 5. Regresión (lo que ya funcionaba sigue funcionando)

Tickets en el celular 15/15 · Revisión por lotes 9/9 · Permisos 33/33 · Delegación 18/18 · Fertirriego campo 27/27.
(La primera corrida después de recompilar falla por arranque lento; al repetir pasan todas. Es conocido.)

## 6. Commits

- AgroNotificaciones (`desarrollo`): `496e911` Etapa C · pruebas QA relevo/traslado · `5bdb736` manuales ·
  `a475944` ayuda en la app · `e3910ab` horómetro malo · documentación.
- AGL (`main` local): `6c74e71` Etapa D · `03b55ea` semáforo «fuera de plan» + manual.

## 7. Lo que sigue (propuesta)

1. Correr la 96 → prueba de relevo y traslados.
2. **Etapa E**: alertas (saldo negativo, relevos con diferencia, traslados sin recibir, turnos sin aplicar),
   sugerencia de envío por estación según el plan de los próximos días y el saldo, cierre mensual. Necesito que me
   diga los umbrales (por ejemplo, ¿cuántos días de plan debe cubrir una estación?).
3. Decisiones de catálogos para que AGL sea la única fuente (`docs/agl-fuente-unica.md`: zonas 2B/2C/3C,
   sub-turnos, temporada 2025-26).
4. Cuando todo esté probado y usted lo diga: pasar a producción (código primero, luego SQL 91 a 96, con la prueba de
   equivalencia sobre una copia de producción).

## 8. Notas

- Archivo `reporte_7AM.md` en AGL: aparece **borrado** en su carpeta (no lo borré yo); no lo toqué.
- `CLAUDE.md` de AgroNotificaciones tiene cambios suyos sin guardar; no los toqué.
