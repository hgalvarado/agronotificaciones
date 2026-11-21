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
- Cómo mostrar el LTP fácil de leer: ver §13 (propuesta basada en el archivo real).
- Permisos por rol (jefe de zona, jefes por categoría, moderador): por la matriz de permisos de la base, sin roles escritos en el código.
- Loop: viabilidad técnica (ver §11). Decisión 2026-11-21: por ahora los acuerdos van **sin integrar**; se decide después si se integran en AgroNotificaciones/AGL.
- «Inyección» aparece en el LTP bajo dos departamentos (§13): confirmar con el usuario quién la ejecuta en cada caso.

## 13. Lo verificado en el LTP real (LTP_Insumos_Temporada_2026-2027.xlsx + Ruta_Siembra.xlsx, solo lectura)
- **Estructura**: 13 311 filas. Columnas: Temporada, Finca, Ciclo, Variedad, Tipo de Fruto, **Departamento**, **Categoría**, Centro, Almacén, **DDT**, Material, Texto Breve, Grupo, Dosis, % Aplicación, % Calculado, Área de Siembra, Total Producto, Control sobre, Observaciones.
- **El plan es por Variedad × Ciclo × DDT × Material, NO por lote.** 31 combinaciones variedad-ciclo, 18 variedades, 2 ciclos, 168 materiales, una sola finca (Santa Rosa). Cada combinación tiene ~600 filas repartidas en ~130 DDT distintos; un mismo DDT llega a tener **hasta 20 productos**.
- **El lote entra por la Ruta de Siembra** (`Ruta_Siembra.xlsx`: Temporada, Ciclo, FechaSiembra, Finca, UbicacionTecnica, **Lote**, Variedad, AreaSembrar, SemSiembra, Zona). `ltp_corrida.py` ya cruza ambos (fecha = FechaSiembra + DDT; necesidad = área × dosis × %) y guarda el resultado en caché Parquet. **El planificador debe reutilizar ese cruce, no rehacerlo.**
- **DDT va de −265 a 78**: los DDT negativos son preparación previa al trasplante (suelo, plástico…).
- **Departamento**: Ferti-Riego 9 502 filas y Fito-Proteccion 3 809. Dentro de Ferti-Riego, **8 579 son «Fertilizantes»** (el 64 % de todo el LTP); el resto: Preparación Suelo 374, Inyección 191, Aseg. Calidad 120, Trasplante 100, Invernadero 53, Cultivo Rotación 46, Drensh 23. Fito-Proteccion: «Fitoproteccion» 2 109, Herbicidas 1 002, Adherentes 268, Muestras de suelo 151, Fungicidas 63, Insecticidas 57, Biológicos 48, Inyección 18, entre otras.
- **Por qué cuesta leerlo**: lo que abruma son los fertilizantes (varios productos en el mismo DDT que se repiten día tras día). Es el plan de nutrición, cuyo «hecho» viene de Fertirriego en campo.
- **Propuesta de lectura (a validar)**: una línea por día, lote y Departamento + Categoría; p. ej. «DDT 36 · Fertilización · 13 productos» con el detalle al abrir; Fitoprotección, Inyección y Drench cada una con su propia línea. Así la reunión ve «qué actividades tocan» y no 13 filas por día.
- **Inyección** existe en el plan (191 filas bajo Ferti-Riego y 18 bajo Fito-Proteccion) y **Drensh** (23): ya hay plan para el módulo Inyección; falta el registro.
- **No hay Labores Culturales en el LTP** (coincide con lo dicho: hay que crear el catálogo).

## 14. Lo visto en las pantallas reales de AGL (Chrome, 2026-11-21, solo lectura)
- **LTP Insumos `/LI01`**: pestañas Plan, Corrida, Cobertura, Simulador, Bitácora. *Plan* = Excel (Generar/Abrir, V0 oficial o simulación, «Registrar en bitácora»). *Corrida* = matriz **Material × Semana ISO** agrupada por «Grupo de Artículo» (p. ej. 1700 · Biológicos), con Stock Almacén, Stock Global, Total Plan y «Déficit / A comprar», semáforo verde (cubierto) / rojo (quiebre). Calcula 103 849 aplicaciones de 168 materiales. Es una vista de **inventario y compras**, no de «qué toca en cada lote cada día».
- **Plan de Siembra `/RS01`**: 206 filas (2026-27), **cada fila es una siembra con su fecha** (un mismo lote, p. ej. 1003-320, aparece en varios días con áreas parciales). Total planificado 1 821 mz, columnas Ciclo, FechaSiembra, UT, Lote, Variedad, AreaSembrar, SemSiembra, Zona. ⇒ el calendario de DDT debe calcularse **por cada siembra (cohorte)**, no por lote entero.
- **Trasplante `/TP01`** ya existe: pestañas Recepción de Plántulas, **Siembra Diaria** (registro real: fecha, tipo Trasplante/Siembra Directa, UT, zona, ciclo, variedad, cultivo, avance mz, plantas, y los productos aplicados con dosis/mz), **Avance por UT** (plan vs real: 1 821 mz plan, 178.72 sembradas, 9.81 %, 108 UT/ciclo, con «Terminado») y Reportería (PDF gerencial). ⇒ **«Avance de siembra o trasplante» ya está resuelto** para la reunión: se enlaza, no se reconstruye. Falta confirmar dónde está el plan de Polinización (no se alcanzó a ver).
- **Turnos de Riego `/TR02`**: turno (T1002-T01), fecha de siembra, **DDT de hoy**, ciclo, área, zona, **Responsable** (el jefe de zona, p. ej. Arlis Castillo) y **Plan Nutricional**. ⇒ el Responsable por turno ya existe y sirve para repartir la reunión «por jefe de zona».
- **Consecuencias**: (1) el planificador es una **vista nueva** (lote/turno × día) que consume lo ya existente; (2) la reunión puede abrir con Avance por UT; (3) Labores Culturales son lo único realmente nuevo en AGL; (4) la unidad de planificación es el **turno** (cohorte de siembra) más que el lote.

## 15. Polinización (Trasplante › Reportería) y pantalla al 125 %
- **Plan de polinización existente** (`/TP01` › Reportería): agenda semanal calculada desde la Siembra Diaria. **Entrada** = Fecha Efectiva del ciclo + DDT Entrada (hoy 23); **Salida** = Entrada + Días de Polinización (10); **Colmenas** = Área sembrada × Colmenas por mz (7); DDT máximo del PDF 40. Se elige qué semanas ver (hoy 47–51) y se exporta a Excel/PDF. ⇒ El módulo de registro de Polinización compara contra esto: fecha real de entrada de colmenas, cantidad real y área cubierta, por lote/siembra, contra Entrada/Salida/Colmenas planificadas.
- **Pantalla al 125 %** (Windows por defecto en los equipos de los usuarios): medido en Chrome con 125 %: `innerWidth` 1536 × `innerHeight` 695 px CSS (a 100 % serían ~1920 × ~870). La zona de trabajo se come lo vertical: antes de que empiece la tabla hay ~470 px de títulos, pestañas, 4 tarjetas de resumen, filtros y barra de herramientas, y la tabla queda con ~170 px (4 filas). Tamaños reales: celdas 13 px, encabezados de tabla 10.88 px, muchos textos 10.4–12 px; el CSS usa ~3 568 valores en `px` y solo 655 en `rem`, así que no se adapta a la escala. Las barras de herramientas se parten en dos líneas por debajo de ~1600 px.
- **Decisión pendiente del usuario**: ver §16 de la conversación (misma letra con mejor reparto, o que al 125 % se vea como al 100 %).
