# AgroMétricas › Parámetros de riego · diseño (parte 1 de la migración)

> 2026-11-13. Base: `docs/agrometricas-migracion.md`. Construcción: después de la renovación del límite (domingo
> 2026-11-15, tras el Comparativo de Fertirriego). Nada de esto toca AppSheet (sigue en producción hasta apagarlo).

## 1. Lo que dicen los datos de AppSheet (hoja «Registro de parametros», 9 935 filas, solo lectura)

| Grupo | Columnas (qué tan llenas) | Lectura |
|---|---|---|
| Identidad | Temporada, Ciclo, Fecha registro, DDT (100 %), turno | DDT y temporada se escribían a mano → **DDT con 20 546** (error). Ahora salen de AGL. |
| Tensiómetros | 12 y 24 cm, AM y PM (93 %) | El dato diario principal. Rango visto 0–218. |
| Riego | Horas de riego (52 %), % fertilización (32 %), extra fertilización (0 %), «No fertilización» (94 %, apunta a otro registro) y su fecha de ejecución (35 %) | % con valores como 1002 % (error). «No fertilización» = número de la fertilización del programa: revisar a qué tabla apunta antes de migrar. |
| Agua y solución | CE/pH de agua (52 %), gotero (36 %), extractor (36 %), cloro en cinta (26 %) | **pH 797, CE 934** = decimales sin punto. |
| Suelo | CE antes/después del riego (27 % / 16 %), **foto de calicata** (37 %, ~3 600 fotos en Drive) | Las fotos NO van a Supabase. |
| Clima | ETo, DPV, viento (51 %) | **ETo 5 048** (error). Es dato del día por zona o estación, no por turno: hoy se repite en cada turno. |
| GPS | Ubicación (30 %, varias en 0,0) | |

## 2. Cómo se mejora (diseño nuevo)

- **Módulo «AgroMétricas»** con menú de botones grandes; botón «Parámetros de riego».
- **Se elige solo el turno** (lista de AGL vía `turnos_ciclo`, filtrada por la zona o estación de la persona). Temporada,
  ciclo, variedad y **DDT se calculan** (fecha − siembra). La fecha es la de la jornada: puede ser ayer o antes.
- **Formulario por secciones plegables**, con lo diario arriba:
  1. Tensiómetros (12/24 · AM/PM): siempre abierta.
  2. Riego: horas, % de fertilización, extra, número de fertilización del plan.
  3. Agua y solución: CE/pH de agua, gotero y extractor, cloro en cinta.
  4. Suelo: CE antes/después y foto de la calicata.
- **Clima una sola vez por día y estación** (ETo, DPV, viento), no por turno. Si después hay estación meteorológica, se
  carga sola.
- **Rangos por parámetro** (catálogo en AGL: mínimo, máximo y «crítico»), con aviso en el momento:
  «pH 797 está fuera de rango, ¿quisiste decir 7.97?». Se avisa, no se bloquea (puede ser una lectura real).
- **Sin señal**: igual que Fertirriego (cola local con UUID e idempotente); se guarda en segundo plano.
- **Fotos de calicata**: se comprimen en el teléfono. Supabase las guarda solo hasta que AGL las baja a OneDrive; después
  se borran (Supabase solo como intermediario).
- **Un registro por turno y día**: si ya existe, se abre para completarlo (no se duplica).

## 3. Datos

- Supabase: `agm_parametros` (turno_ciclo, fecha, lecturas en columnas numéricas, uuid del teléfono, quién, cuándo) y
  `agm_clima` (estación, fecha, ETo, DPV, viento). Permisos por la matriz (`fn_tiene_permiso`), sin roles en el código.
  Próximo número de SQL libre: **109** (105–108 reservados a la unificación de catálogos).
- AGL: catálogo «Rangos de parámetros», baja periódica a archivos por mes, gráficas (tensiómetros vs DDT, CE/pH contra
  rangos, por turno, estación, zona y semana ISO).
- **Histórico**: las 9 935 filas a AGL (no a Supabase). Los valores fuera de rango se importan **marcados** (no se
  corrigen solos); el usuario decide en una pantalla de revisión. Las fotos de Drive se enlazan o se copian a OneDrive.
  Se verifican los conteos contra la hoja.

## 4. Respuestas del usuario (2026-11-13, no volver a preguntar)
1. **Quién registra**: los **parametristas** (dependen del jefe de zona, igual que el estacionero). Se les asignan sus
   estaciones (`perfiles_estaciones`) y el alcance sale de la matriz de permisos.
2. **Clima**: lo manda por correo el encargado de zona o lo registra el parametrista → **una vez por ZONA y día**
   (`agm_clima.zona_id`).
3. **Rangos**: no hay referencia escrita. Propuesta: AGL los **calcula del histórico** (percentiles 5–95 por parámetro,
   y por fase/DDT donde haya datos), el usuario los revisa con los de campo y los publica.
4. **«No fertilización» y % de fertilización NO se registran en Parámetros**: el número de fertilización es el DDT del
   plan del turno (ya está en Fertirriego) y el **% de fertilización se agrega a Fertirriego › Horas** del turno
   (pendiente: SQL + formulario en Fertirriego).
5. **Fotos de calicata**: las viejas quedan con **enlace a Drive**; las nuevas se guardan en OneDrive (el teléfono las
   sube a Supabase Storage de paso y AGL las baja a OneDrive y las borra de Supabase).

