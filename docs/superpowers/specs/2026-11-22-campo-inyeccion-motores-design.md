# «Campo»: entrada única, Inyección por lote y motores de riego (diseño)

Fecha: 2026-11-22. Estado: borrador para aprobar. Parte del Planificador de actividades de campo
(`2026-11-21-planificador-actividades-campo-design.md`, Bloque 3) y lo amplía.

## 1. Intención y por qué

El usuario (Torre de Control) quiere que lo que ocurre en la estación de riego viva en **un solo lugar** y no en un
módulo nuevo por cada tema. Hoy hay Fertirriego y AgroMétricas; vienen Inyección/Drench/Aseguramiento de calidad (por
lote) y el control de combustible y horas de los motores de riego. En todos los casos el material llega a la estación, lo
entrega alguien y lo registra quien tiene la estación a cargo (estacionero, supervisor o jefe). Solo AgroMétricas lo hace
otra persona (el parametrista, por turno).

## 2. Metas / no metas / anti-metas

Metas
- Una entrada «Campo» en el menú, con la **estación** como centro; las actividades son fichas dentro de ella.
- Una sola bodega por estación para cualquier producto (fertilizante, producto de inyección, diésel) con kardex,
  recepción, traslado, relevo de custodia, conteo, devolución y trabajo sin señal: lo que Fertirriego ya hace.
- Inyección / Drench / Aseguramiento de calidad **por lote completo**, contra el plan del LTP, con cumplimiento y tendencia.
- Motores de riego como equipos: ubicación con historial, registro diario de horas y combustible, mantenimiento por horas.
- «Devolución a bodega» al final de temporada (o por daño) también en Fertirriego.

No metas
- No es un motor configurable por el usuario (el administrador no define actividades ni campos libres).
- No se reescribe Fertirriego ni se toca lo que ya funciona en producción; se generaliza por capas.
- La lectura de caudal de la hoja de combustible no se registra (el usuario no la quiere).
- Combustible de vehículos y tractores no entra aquí (ya hay tickets de maquinaria); solo motores de riego.

Anti-metas (sería un fracaso aunque funcione)
- Que el estacionero deba aprender pantallas distintas para cada cosa.
- Que cada tema nuevo exija un módulo nuevo en el menú.
- Que se duplique un catálogo (equipos, materiales, lotes): AGL sigue mandando.

## 3. Restricciones (reglas ya vigentes)

- Supabase es solo intermediario; AGL manda y recibe los datos para análisis. Permisos por matriz de la base, sin roles en el código.
- Mobile-first, sin señal (IndexedDB y cola con UUID), letra grande, tema oscuro, verbos estándar.
- Fechas en UTC-6. Capturadores registran días anteriores: no asumir «hoy».
- SQL idempotente, probado en réplica en varios órdenes; Claude corre en desarrollo, producción la corre el usuario; nada a producción sin «pasa a producción».
- Frenos en todo código que consulta la red (regla de bucles).

## 4. Enfoques considerados

- **A. «Campo» como entrada única con motor común (elegido por el usuario).** Un menú, bodega y mecanismos compartidos, fichas
  por actividad. Cuesta generalizar parte de Fertirriego (hoy asume fertilizante por turno) pero cada tema nuevo es una ficha.
- B. Inyección como pestaña de Fertirriego. Más rápido; el nombre deja de describir el módulo al llegar el combustible.
- C. Motor totalmente configurable. Demasiado grande y difícil para el estacionero. Descartado.

## 5. Decisiones del usuario

1. Opción A.
2. **Inyección**: la registra quien tiene la estación a cargo; se hace por lote completo; el plan viene del LTP; el administrador
   elige en AGL qué **categorías** del LTP alimentan el módulo (inyección, drench, aseguramiento de calidad, otras).
3. Qué se registra por aplicación: producto, lote, fecha y hora, cantidad, área cubierta, dosis/mz (automática), ingrediente
   activo (del producto), objetivo (plaga, maleza, bacteria, enfermedad, hongo), observaciones.
4. Se quiere ver: cumplimiento del plan (de más, de menos, a tiempo) y tendencia (cómo estábamos, cómo estamos, cómo
   estaremos).
5. **MARA en AGL**: campos técnicos **opcionales** por producto (ingrediente activo, plagas que controla, PPU/período de
   carencia, restricciones, notas técnicas).
6. **Motor de riego = equipo** con código SAP y nombre, asignado a una estación (una estación puede tener varios). Puede
   moverse de estación, retirarse o ir al taller. Tiene mantenimiento programado por horas del horómetro según el modelo (p. ej.
   cada 500 h).
7. **Hoja FTR_F-MA-103** (una fila por día y por motor): horómetro inicial y final, horas, galones iniciales y finales del visor,
   galones gastados, rendimiento (gal/h), revoluciones del motor, suministro de combustible, firma del operador.
   Sin caudal.
8. **Combustible = un producto más de la bodega**, igual que el fertilizante: lo entrega un chofer (normalmente en un tractor,
   sin placa), se suma al inventario de la estación y ya. Cada motor tiene su tanque conectado y su visor.
9. **Devoluciones**: si el usuario devuelve un producto debe registrarse a dónde (suministros, bodega o taller). Aplica a
   combustible y también a Fertirriego (sobrantes al final de la temporada).
10. Al trasladar un motor: si terminó la temporada, su tanque y su combustible se van con él; si se daña y lo reemplazan, el
    tanque y el combustible se quedan en la estación.

## 6. Diseño

### 6.1 Entrada y navegación
- Menú «Campo» → elegir estación (la que el usuario tiene a cargo) → fichas según el permiso: **Fertirriego**, **Inyección**,
  **Motores y combustible**, **AgroMétricas** (esta última sin estación, por turno).
- Las rutas actuales (`/fertirriego`, `/agrometricas`) siguen funcionando; el menú nuevo apunta a ellas y a las nuevas.
- Misma barra de acciones y mismos componentes en todas las fichas (Tarjeta, Acordeón, Insignia, MarcoRegistro).

### 6.2 Bodega y movimientos comunes
- El libro inalterable de Fertirriego (`fert_*`) se generaliza a «producto de la estación» (fertilizante, inyección, combustible);
  `materiales` ya identifica el producto y AGL clasifica por grupo (análisis, publicar a estaciones).
- Recepción (chofer y vehículo opcionales, como hoy) y traslado entre estaciones: sin cambios.
- **Devolución a bodega** (nueva operación): salida del inventario hacia un destino externo (suministros, bodega o taller) con
  motivo y quién; solo con saldo; anulable con el mismo permiso «Anular». Motivo sugerido «Fin de temporada».
- Conteo, relevo de custodia y modo histórico: igual que hoy.

### 6.3 Inyección / Drench / Calidad (por lote)
- Plan: línea del LTP por lote (UT), categoría y DDT; la lista de categorías activas la fija el administrador en AGL
  (pantalla nueva en /FR01 o /CF, ver §8) y AGL la publica a las estaciones.
- Registro «Aplicar por lote»: lote(s), productos con cantidad, área cubierta (propuesta = área del lote, editable cuando se
  cubre solo una parte), objetivo (lista), observaciones. Dosis/mz y total por lote se calculan.
- Descuenta de la bodega de la estación. Una aplicación puede abarcar varios productos (bloque «hecho junto» como hoy).
- Sin turno: se liga a lote + ciclo + temporada.
- Cumplimiento (AGL, vista nueva): por lote y producto, plan contra real (cantidad, dosis, fecha del DDT planificado),
  estados «a tiempo / tarde / de más / de menos / sin plan». Tendencia: avance acumulado contra el esperado y proyección.
  Alimenta el Planificador (Plan vs. hecho).

### 6.4 Motores y combustible
- Motor = fila del catálogo de equipos (código SAP, nombre, modelo). Nueva asignación **motor ↔ estación con historial**
  (fecha, estación, tipo de movimiento: instalado / trasladado / retirado / al taller / de vuelta; motivo; quién).
- Cada motor tiene un **tanque** (nivel por visor, capacidad opcional). El combustible del tanque cuenta como saldo del producto
  «diésel» de la estación (lo que está en el tanque + lo que hay en bodega).
- Registro diario del motor (reemplaza la hoja): fecha, horómetro inicial (propuesto desde el final anterior, aviso si no
  continúa, como en tickets) y final, horas, visor inicial y final, gastado (= inicial − final + suministro), rendimiento gal/h,
  revoluciones, suministro (entrada desde la bodega de la estación al tanque del motor), firma/quien registró.
- Reglas de movimiento: si el motor se retira por **fin de temporada**, su combustible se traslada con él (o se devuelve a
  suministros); si se **reemplaza por daño**, el tanque y el combustible quedan en la estación. Siempre con registro y motivo.
- Mantenimiento: intervalo por modelo (horas), contador de horas desde el último mantenimiento, aviso antes del límite,
  registro del mantenimiento hecho (fecha, horómetro, nota) y vista en AGL / Planificador.
- Alertas por motor contra su propio comportamiento (rendimiento fuera de lo normal, horas sin registro, nivel bajo), sin
  umbrales fijos globales.
- Cuadre: suministros entregados contra gastado + variación de visores, por estación y temporada.

### 6.5 Permisos y roles
Nuevos permisos por ficha en la matriz (ver, registrar, anular, configurar, administrar categorías). Quien tiene la estación a
cargo registra; la delegación fina sigue el esquema de Permisos v2. Sin nombres de roles en el código.

### 6.6 AGL
- MARA: campos técnicos opcionales por producto.
- Categorías del LTP activas para Inyección (administrador).
- Cumplimiento y tendencia de Inyección; consumo, rendimiento y mantenimiento de motores; cuadre de combustible.
- Bajada con huella (sha256) y borrado de Supabase, como Fertirriego; archivar por temporada.

## 7. Orden de construcción propuesto (cada paso con QA, sin tocar producción hasta «pasa a producción»)
1. Menú «Campo» (estación → fichas) apuntando a lo existente; permisos por ficha.
2. Devolución a bodega (también Fertirriego) y generalización de la bodega a productos de inyección y diésel.
3. Inyección por lote: registro, MARA opcional en AGL, categorías, cumplimiento y tendencia.
4. Motores: asignación con historial, tanque, registro diario, mantenimiento.
5. Cuadre y alertas de combustible; integración con el Planificador.

## 8. Queda al constructor
Nombres de tablas y funciones; si el libro se generaliza con una columna de tipo o con una tabla paralela (sin romper la huella
de la migración 102 ni los archivos de Terminar ciclo); dónde en AGL va la pantalla de categorías; formato exacto de las
listas de objetivo; cómo se cuenta el combustible en el tanque frente a la bodega en el cuadre; modelo/intervalos de
mantenimiento iniciales (los da el usuario por modelo).

## 9. Llamadas del diseñador (a confirmar al leer; resultado de la revisión del constructor)
- **Libro**: tabla paralela para Inyección y diésel (sin tocar la huella de la 102 ni los archivos de «Terminar ciclo»). «Terminar ciclo» ignora Inyección y diésel (no son de un turno); se archivan por temporada.
- **Devolución a bodega/taller/suministros**: solo una salida con destino y motivo, sin recepción en el destino. Se devuelve combustible de la bodega de la estación; el del tanque de un motor sale con el «retiro del motor» (§6.4).
- **«Estación a cargo»**: la misma custodia y el mismo relevo (código) de Fertirriego. Un motor sigue a su estación por el historial de asignación.
- **Área del lote** (Inyección): `fn_area_lote_ciclo`; se puede registrar sin plan (queda «sin plan»); el DDT planificado se calcula con la siembra de `turnos_ciclo` cuando existe.
- **AGL publica a las estaciones** el plan completo de las categorías activas (lote, categoría, DDT, producto, dosis), como el plan de Fertirriego, para trabajar sin señal.
- **Motores**: la continuidad del horómetro es por motor, no por estación; el registro diario funciona sin señal como el resto de Campo; el catálogo de equipos aporta código SAP y nombre, y el modelo/intervalo de mantenimiento se agrega a ese catálogo.
- **Permisos**: una pantalla de la matriz por ficha (Inyección, Motores y combustible), agrupadas en el módulo «Campo» (`pantallas.modulo`); equivalencia antes/después sobre un clon de producción.

## 10. Aclaración del usuario (2026-11-22) sobre el tanque — reemplaza lo ambiguo de §6.4
El **tanque de la estación es el tanque del motor**: no hay un tanque grande del que baje combustible a otro. El chofer entrega el
diésel directo a ese tanque. Por tanto:
- Una estación tiene un **tanque por motor conectado**; cada tanque es su propio saldo de diésel (cuenta de la estación, subcuenta del tanque).
- **Recepción** = entrada al tanque indicado. **Consumo diario** (visor inicial − visor final + lo recibido ese día) = salida. El visor es el
  conteo que valida el saldo; diferencias grandes se alertan y se ajustan con conteo.
- El «suministro» de la hoja es esa recepción; no existe paso «bodega → tanque».
- Traslado/retiro del motor: fin de temporada → su saldo se va con él (o se devuelve); daño y reemplazo → el tanque y su saldo quedan
  en la estación y el motor de reemplazo se conecta a ese tanque.
