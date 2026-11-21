# Planificador de actividades de campo · diseño (borrador en papel)

Fecha: 2026-11-21 · Estado: **análisis acordado con el usuario; nada construido.** Falta su aprobación de este documento.

## 1. Intención y por qué
Que la plataforma sea «el alma de todos los procesos de Agrolíbano»: ver y dar seguimiento completo a cada labor, acción o proceso de la finca.
Sirve a tres usos, en este orden de importancia:
1. **Programador** para la reunión técnica de cada sábado (hoy cada jefe trabaja «por su lado»): programar la semana siguiente y revisar si lo programado se cumplió.
2. **Programación diaria** del jefe de zona y registro de lo hecho, sin captura doble.
3. **Guía técnica / línea de tiempo** por lote y semana para agrónomos, jefes, supervisores y gerentes; demanda de personal (diaria, semanal, mensual, por ciclo y zona, con gráfica).

## 2. Las actividades y de dónde sale su «hecho»
| Actividad | Plan viene de | Lo hecho viene de | Estado hoy |
|---|---|---|---|
| Labores Culturales (puesta de platillo, quitado de manta, trasplante…) | **Catálogo nuevo**: código, labor, DDT, jornal/mz, alcance, vigencia por temporada | Registro nuevo: fecha, personas, área de avance (jornal/mz real) | **No existe en AGL ni AgroNotificaciones** |
| Fertirriego · nutrición | Plan Nutricional / turnos (AGL) | Fertirriego en campo | Existe |
| Fertirriego · inyección y drench | LTP | Módulo **Inyección** (pestaña nueva de Fertirriego) | A construir |
| Fertirriego · checklist (alinear cinta, conectar riego…) | Plantilla fija (sin plan) | Marcado en la plataforma | A construir |
| Fitoprotección | LTP | **Salidas SAP** de las tareas T500–T503 (KOB1, /OS01) | Datos existen; falta el cruce. La salida se contabiliza con retraso: más margen de días al emparejar |
| Mecanización (emplasticado, rotoneado…) | Programación del jefe | `/labores` en AgroNotificaciones (lo que hoy se registra ahí ES mecanización) | Existe |
| Polinización | Plan de polinización (AGL) | Su seguimiento | Existe en parte; detallar |

## 3. Tres niveles de planificación
1. **Plan del ciclo** (automático): siembra/trasplante real + catálogo + LTP + Plan Nutricional + turnos. Se recalcula si cambia la siembra.
2. **Programación semanal** (grupo, sábado): se parte del plan y se ajusta con lo conversado.
3. **Programación diaria** (jefe de zona): toma la semana, acomoda y agrega lo que surja. Lo hecho **llega solo** desde cada módulo.

## 4. Labores Culturales (nuevo)
- **Catálogo**: código, nombre, DDT (día exacto o ventana: **pendiente**), jornal/mz, alcance (todo / cultivo / variedad / zona / lote), vigencia por temporada (una labor puede no hacerse este año y sí otros, o hacerse en el futuro, sin borrarla).
- **Plan**: fecha de trasplante del lote + DDT = fecha; área trasplantada × jornal/mz = jornales. Sumando salen la demanda de personal y su gráfica.
- **Registro**: lo hace el **jefe de Labores Culturales**, desde teléfono **o** computadora: fecha, personas, área de avance → jornal/mz real contra el del catálogo.

## 5. Emparejamiento programado ↔ hecho (decisión del usuario: automático, opción B)
La plataforma empareja sola por **lote o turno + tipo de actividad + fecha cercana** (tolerancia por tipo; Fitoprotección mayor). El jefe solo corrige excepciones. Lo que no empareja queda marcado como **extra** con su razón. Estados: programada, hecha, parcial, no hecha; con días de atraso y si cayó dentro o fuera de rango. Requisito: cada módulo guarda con claridad lote/turno, tipo y fecha.

## 6. Dónde vive cada cosa (decisión: mixto, AGL guarda, Supabase solo intermediario)
- **AGL (escritorio)**: catálogos, planes, programación semanal, reunión del sábado, análisis e historial único. AGL guarda todo.
- **AgroNotificaciones (teléfono y computadora)**: programación diaria y registros de campo.
- **Registrar desde cualquiera de los dos sin abrir dos plataformas**: un solo formato de registro con UUID. Desde AGL se guarda directo; desde el teléfono pasa por Supabase y AGL lo baja, verifica (sha256) y borra, como Fertirriego. AGL publica a Supabase un resumen mínimo y reciente de «programado / ya hecho» (solo lectura) para que el teléfono no duplique.
- **Concurrencia en AGL**: ya resuelta por `backend/coleccion.py` (un archivo JSON por registro, versión, 409 si otro guardó antes, copias de conflicto de OneDrive) y `storage.py` (escritura atómica). Reutilizar `Coleccion`.

## 7. La reunión del sábado (la pantalla sigue su orden)
1. Revisión de lo hecho por responsable: Fertirriego (por jefe de zona: aplicado vs plan, rango, atraso, extras con razón), Labores Culturales, avance de siembra/trasplante, emplasticado, Fitoprotección, Polinización.
2. Reunión técnica: problemas, observaciones, **acuerdos y acciones**, **asistencia**, costos, procesos, inventarios. Hoy usan Microsoft Loop.
3. Programación de la semana siguiente.
Roles: moderador (da la palabra), jefes de zona, jefe de Labores Culturales, de Fitoprotección y de Mecanización.

## 8. Metas, no metas
- Metas: una pantalla «programado vs hecho»; cero captura doble; demanda de personal; reunión ordenada.
- No metas (por ahora): captura diaria obligatoria en campo de todo; reemplazar los módulos existentes; usar AGL en teléfono.
- Anti-meta: que sea otro lugar más donde capturar, o que el LTP se vea más difícil de leer.

## 9. Enfoques considerados
- A. Todo en AGL: descartado (nadie programa ni registra desde teléfono).
- B. Todo en AgroNotificaciones: descartado (subiría el plan a Supabase, contra «solo intermediario»).
- **C. Mixto (elegido)**, mismo patrón que Fertirriego.
- Registro de Labores Culturales: se eligió registrar fecha, personas y área (no solo «hecho / no hecho»).

## 10. Orden de construcción propuesto (cada paso termina completo)
1. Corazón: programación semanal y diaria + emparejamiento, con lo existente (Fertirriego, `/labores`, SAP).
2. Labores Culturales (catálogo, plan, registro en AGL y AgroNotificaciones, demanda de personal).
3. Módulo Inyección.
4. Checklist de Fertirriego, Polinización, acuerdos/asistencia de la reunión.

## 11. Decisiones del usuario (2026-11-21, segunda ronda)
- **DDT = día exacto.** Se compara con el día real: la plataforma muestra los días de diferencia y el jefe explica el porqué. No hay tolerancia ni ventana. (Esto vale también para el emparejamiento de las demás actividades: se empareja por lote/turno + tipo y se mide la diferencia contra el día del plan.)
- **Fitoprotección**: sin tolerancia; si no se hizo el día del plan se revisa la causa y se compara con lo registrado en SAP (salidas T500–T503).
- **Polinización**: hace falta un **módulo nuevo de registro**: lotes donde ya entraron colmenas, cantidad de colmenas, fecha y área de avance. El plan ya existe en el módulo de Trasplante; falta registrar lo ejecutado. Se agrega al orden de construcción (paso 4) y se empareja igual que el resto.
- **Costos e inventarios**: fuera de este alcance. Se cubrirán mejorando el módulo del LTP.
- **Loop de Microsoft**: el usuario prefiere **integrarlo** y, si no se puede, otra solución. Estado de la investigación: no hay API pública confirmada para crear/leer páginas de Loop (en desarrollo según la comunidad; las primeras serían de administración de espacios, no de contenido). Los componentes Loop son archivos `.loop` en OneDrive/SharePoint. Pendiente: revisar con TI de la empresa qué permisos hay y probar si se pueden leer los acuerdos como archivos. Plan B: acuerdos y asistencia propios dentro del programa con exportación.

## 12. Preguntas abiertas
- Cómo hacer más fácil de leer el LTP (muchos productos): propuesta de agrupar por tipo y semana, con detalle al abrir.
- Permisos por rol (jefe de zona, jefes por categoría, moderador): por la matriz de permisos de la base, sin roles escritos en el código.
- Loop: viabilidad técnica (ver §11).
