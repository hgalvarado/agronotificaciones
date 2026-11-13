# AgroMétricas (AppSheet) → AgroNotificaciones + AGL · propuesta de migración

> 2026-11-13. Análisis de SOLO LECTURA (no se cambió nada en AppSheet ni en la hoja). Fuente: la app en uso, el editor
> y la hoja de Google «DBAgroMetricas-Agrolibano» (32 hojas; se leyeron solo encabezados y cantidad de filas).
> Objetivo del usuario: **una sola integración** de todas sus plataformas; **los datos maestros siempre salen de AGL**.

## 1. Qué es hoy AgroMétricas

App de AppSheet sobre Google Sheets, usada en campo por ~18 usuarios (7 zonas). Menú: 1. Registros (turnos,
parámetros de riego, IC, polinización, resiembra, productos de inyección, análisis, trasplante, cosecha),
2. Gráficas (IC, Dashboard), 3. Planes (plan de inyección).

### Tablas por tipo (filas al 2026-11-13)

| Tipo | Hoja (filas) | Ya existe en… | Destino propuesto |
|---|---|---|---|
| **Catálogo** | Temporadas (2), Ciclos (2), Zonas (7), Turno (126), Estaciones Riego (17), Variedades (12), Tipo Fruto (6), Plan Nutricional (8) | AGL (maestros) | **AGL** (ya está; no se migra) |
| Catálogo | Productos (25: código SAP, precio, grupo) | AGL MARA | **AGL** MARA |
| Catálogo | Productos Plan (36: producto, dosis, DDT) | AGL plan nutricional | **AGL** |
| Catálogo | DDT (138: DDT → fase por tipo de fruto) | — | **AGL**: es lo mismo que los **rangos de fase** del Comparativo v2 (un solo catálogo para los dos) |
| Catálogo | IC_Plan (16: DDT → IC esperado) | — | **AGL** (curva de crecimiento esperada por variedad/plan) |
| Siembra | Registro Turnos (211) + Detalles Registro Turnos (219) + Ubicaciones técnicas + Siembra (54) | AGL `turnos_ciclo` / Trasplante | **AGL** (ya publica `turnos_ciclo` a Supabase) |
| **Captura de campo** | **Registro de parámetros (9 935)**: tensiómetros 12/24 AM-PM, CE suelo antes/después, CE y pH de agua/gotero/extractor, ETo, DPV, viento, cloro cinta, % fertilización, horas de riego, calicata | En parte: Fertirriego (horas de riego, ppm cloro) | **AgroNoti › Fertirriego** (misma estación/turno, sin señal) |
| Captura | **RegistroAnalisis (2 460)**: extractor/savia; Ca, K, Na, NO3, pH, CE, P con mín./máx. | — | **AgroNoti** captura; rangos mín./máx. como catálogo en **AGL** |
| Captura | Indice Crecimiento | — | **AgroNoti** captura; gráfica en AGL |
| Captura | Apicultura / polinización (120) | — | **AgroNoti** |
| Captura | Resiembra (63) + DetalleResiembra (32) | — | **AgroNoti** (jornales y plántulas; costo con precios de AGL) |
| Captura | Cosecha (3) | — | **AgroNoti** (casi sin uso: confirmar) |
| Captura | RegistrosProductos (839: inyección plan vs real) | **Fertirriego** (aplicaciones) | **Se retira**: Fertirriego ya lo hace mejor |
| Captura | PlanDesinfeccionSuelo (14) / RegistroDesinfeccionSuelo (0) | **AgroNoti Desinfección** | **Se retira** |
| Interno AppSheet | Inicio, InicioDashboard, Configuracion, Filtro, ExportData, Usuarios | — | **No se migra** (menú por rol, permisos y usuarios ya existen en AgroNoti) |

**Seguridad:** la hoja «Usuarios» guarda una columna `CONTRASENA`. No se leyó su contenido. **No se migra**: cada persona
entra con su usuario de AgroNotificaciones (Supabase Auth) y la hoja debería dejar de guardar claves cuanto antes.

## 2. Cómo queda (una sola integración)

```
AGL (manda)  ──publica──▶  Supabase (intermediario mínimo)  ──▶  AgroNotificaciones (teléfono, sin señal)
  maestros, planes,            catálogos que el campo usa            captura de campo por módulo
  rangos (fases, IC,           + lo capturado hasta que              (mismo menú por rol, permisos,
  análisis), gráficas  ◀──baja── AGL lo baje y archive              guardado sin señal de Fertirriego)
```

- Lo histórico de AppSheet (≈ 13 700 filas) va **directo a AGL** (archivos por mes, como Fertirriego), **no** a Supabase.
- Las gráficas (IC, dashboard, parámetros vs rangos) van en **AGL**, junto al Comparativo de Fertirriego.

## 3. Fases propuestas

| Fase | Qué | Notas |
|---|---|---|
| 0 | Respaldo de la hoja (copia de solo lectura) y decisiones del §4 | Sin tocar AppSheet |
| 1 | Catálogos nuevos en AGL: DDT→fase (= rangos de fase del Comparativo), IC esperado, rangos de análisis | Junto con la unificación de catálogos (`sql/105`–`108`) |
| 2 | **Parámetros de riego** en AgroNoti › Fertirriego (el más usado: 9 935 filas) | Reusa estación, turno, cola sin señal y bitácora |
| 3 | Análisis de extractor/savia + IC | Con semáforo contra los rangos de AGL |
| 4 | Polinización, resiembra, cosecha | Pantallas pequeñas, mismo patrón |
| 5 | Importar el histórico a AGL + gráficas | Verificar cantidades contra la hoja |
| 6 | Uso en paralelo 2–4 semanas → apagar AppSheet (solo lectura) | Capacitación con los manuales de Fertirriego |

## 4. Decisiones del usuario (pendientes)
1. ¿Siguen en uso Cosecha (3 filas), Trasplante diario y Desinfección de AppSheet, o ya se retiran?
2. ¿Todo el histórico se importa a AGL, o solo la temporada actual?
3. Parámetros de riego: ¿los captura el mismo estacionero de Fertirriego o otra persona?
4. Orden de la Fase 2 en adelante: ¿empezamos por parámetros de riego?
