# Planificador v2 · rediseño completo (AGL /PL01)

Fecha: 2026-11-26 (trabajo nocturno autónomo, a pedido del usuario: «ese planificador no me gusta, no le encontré sentido;
quiero un trabajo nivel mundial que no necesite intervención mía»). Base: spec 2026-11-21 (§1–§16), deck
`docs/presentaciones/Planificador_Propuesta_Gerencia.pptx` y el Bloque 1 ya construido (emparejamiento plan↔hecho).

## 1. Por qué el v1 no se entendía (diagnóstico)
1. Era una **tabla de 50+ filas** (turno × actividad × DDT) sin jerarquía visual: no se ve «qué toca esta semana».
2. Casi todo salía **«Parcial»**: el LTP pide 9–10 productos por DDT y en campo se registran 2–3. El estado mezclaba
   «¿se hizo?» con «¿se aplicó cada producto?».
3. **«Sin registro (aún no hay módulo)»** llenaba la pantalla con un juicio sobre actividades que no tienen fuente.
4. No se podía **hacer nada**: ni reprogramar, ni explicar un atraso, ni agregar lo que surge. Solo leer.
5. No respondía las preguntas de gerencia: ¿cumplimos?, ¿quién se atrasa?, ¿cuánto costó?, ¿cuánta gente necesito?

## 2. Principios del v2 (de las herramientas de planificación de referencia: tableros semanales tipo Monday/Asana,
## planificadores agrícolas tipo Agworld/Granular/FarmERP)
- **Lo importante primero**: una frase-titular y 4 indicadores; el detalle a un clic.
- **Tablero semanal** (turno × día) como vista principal, agrupado por jefe de zona: se lee como una agenda.
- **Un estado = una pregunta**: ¿se hizo? (Hecha / Atrasada / Programada / Extra / Cancelada). La cobertura de productos
  («3 de 10 productos») es un dato aparte dentro de la actividad, no un estado.
- **Sin juicio donde no hay fuente**: lo que no tiene módulo de registro se muestra como «Programada» (gris, sin
  contar en el cumplimiento) y se dice «sin registro en la plataforma».
- **Acción en el mismo lugar**: reprogramar (con causa), explicar atraso, cancelar, agregar actividad que surgió.
- **Cero captura doble**: lo hecho llega solo (Fertirriego, SAP T500–T503, Inyección, Labores Culturales).
- Catálogos únicos: turnos de /TR02, zonas y encargados de /ZN01, materiales de MARA, temporadas.

## 3. Pantalla /PL01 (pestañas)
| Pestaña | Pregunta que responde |
|---|---|
| **Semana** (inicio) | ¿Qué toca esta semana en cada turno y qué ya se hizo? Tablero turno × día + vista «Día» (lista por jefe). |
| **Cumplimiento** | ¿Cumplimos? % por jefe y por actividad, atraso promedio, tendencia de 8 semanas, atrasos sin causa. |
| **Labores Culturales** | Catálogo (código, labor, DDT, jornal/mz, alcance, vigencia), registro (fecha, turno, personas, área) y **demanda de personal** (jornales por semana y zona). |
| **Costos** | Plan contra real en Lps por semana y por actividad (cantidades × precio MARA; jornales × tarifa). |
| **Reunión** | La reunión del sábado: asistencia, notas y acuerdos (responsable, fecha límite, estado); los abiertos vuelven cada semana. |
| **Detalle** | La tabla completa (para filtrar, agrupar y exportar a Excel). |

## 4. Reglas
- **Estado** (servicio, sobre el emparejamiento del Bloque 1): `hecha` si hay cualquier registro real emparejado
  (antes «hecho» o «parcial»); `atrasada` si no hay registro y su fecha objetivo ya pasó; `programada` si es hoy o
  futura, o si su tipo no tiene fuente de registro; `extra` si se registró algo sin plan cercano; `cancelada` si el jefe
  la canceló. **Fecha objetivo** = fecha reprogramada si existe; si no, siembra + DDT.
- **Cumplimiento** = hechas ÷ (hechas + atrasadas), solo tipos con fuente. **En su día** = hechas con diferencia 0 ÷ hechas.
  **Atraso promedio** = promedio de días de diferencia de las hechas tarde.
- **Reprogramar** pide causa (catálogo fijo de causas, abajo) y nota opcional; queda la fecha original visible.
- **Causas** (lista única en `backend/planificador_datos.py`): Lluvia o clima · Falta de personal · Falta de producto ·
  Falta de equipo o maquinaria · Falla de riego o bomba · Decisión técnica · Cambio de prioridad · Otra (con nota).
- **Labores Culturales**: fecha plan = siembra del turno + DDT de la labor; jornales plan = área del turno × jornal/mz;
  hecha si hay registro de esa labor en el turno (cerca de su fecha; mismo emparejamiento). Jornal/mz real =
  personas ÷ área avanzada. Alcance por ciclo, variedad y zona (vacío = todas); vigencia por temporada (vacía = todas).
- **Costos**: plan = Σ cantidad plan × precio MARA (presupuesto, si no inventario) + jornales plan × tarifa;
  real = Σ cantidad real × precio + personas registradas × tarifa. Sin precio: «sin precio» (no se inventa).
  Tarifa del jornal: configurable en la pestaña (vacía = no se costea mano de obra).

## 5. Dónde se guarda (AGL, carpeta `data/planificador/`, un archivo por registro con `coleccion.Coleccion`)
- `programacion/`: ajustes por actividad (reprogramar, causa, cancelar) y actividades agregadas a mano.
- `labores_catalogo/`, `labores_registro/`: Labores Culturales.
- `reuniones/`: una por fecha (asistencia, notas, acuerdos).
- `config.json`: tarifa del jornal.
Nada va a Supabase en este bloque. Registro desde el teléfono (AgroNotificaciones) = bloque siguiente (sql nuevo).

## 6. Fuera de este bloque (siguiente)
Registro de Labores y programación diaria en el teléfono (AgroNotificaciones + Supabase intermediario), registro de
Polinización, alertas push del planificador (atraso/sobrecosto), integración con Microsoft Loop.
