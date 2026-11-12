# AGL como única fuente de los catálogos (análisis 2026-11-11)

> Pedido del usuario: «lo que ya está en AGL solo se sincroniza; no llenar tablas en dos lados». AGL manda; Supabase
> (AgroNotificaciones) recibe. Este documento es el inventario y la propuesta. **Nada implementado todavía.**

## Reglas para cualquier sincronización (producción no puede romperse)

1. Una sola dirección: AGL → Supabase, por la misma vía que ya existe (`fn_fert_publicar`, sql/91), con el usuario
   técnico «Integración AGL». Nunca la llave maestra.
2. Se cruza por **llave natural** (código/nombre normalizado) y se guarda el id de AGL (`id_legacy`/`agl_id`) en la fila
   de Supabase para que un cambio de nombre no rompa el cruce.
3. **Nunca se borra** en Supabase: lo que sale de AGL queda `activo = false`. (Temporadas y lotes tienen FKs en cascada.)
4. Los ids de Supabase **no cambian** (tickets, horómetros, labores y desinfección apuntan a ellos).
5. Lo que solo existe en AgroNotificaciones no se toca (columnas propias y filas que AGL no conoce).
6. Antes de sincronizar un catálogo: reconciliar diferencias con el usuario y probar con la «equivalencia» antes/después.
7. En AgroNotificaciones el catálogo sincronizado queda de **solo lectura** («Se administra en AGL»).

## Inventario

| Catálogo | AGL | AgroNoti | Estado | Riesgo | Propuesta |
|---|---|---|---|---|---|
| Estaciones de riego | 17 (con zona) | 17 (sin zona) | Mismos nombres | Bajo | **AGL manda ya** (la publicación de Fertirriego las actualiza) |
| Materiales (MARA) | 826 | 6 | Los 6 están en MARA | Bajo-medio | **AGL manda**; no tocar ingrediente activo / concentración / objetivos de control (propios de Desinfección); limpiar el código «␠100019» |
| Turnos | 124 | 132 | 8 sub-turnos solo en AgroNoti (T1003-T29-A/B/C, T38-A/C, T44-b/C, T46-B); 9 turnos en Zona 3C | Medio | Agregar en AGL los sub-turnos y la zona 3C; luego AGL manda |
| Zonas | 4 (1, 2A, 3A, 3B) | 7 (+2B, 2C, 3C) | Faltan 3 en AGL; responsables escritos distinto | **Alto** (permisos por zona) | Completar AGL primero; sincronizar solo nombre/responsable, nunca borrar |
| Planes nutricionales | 5 (por temporada) | 3 (sin temporada) | Nombres distintos | Bajo | AGL manda; agregar temporada en AgroNoti |
| Ciclos | 2 | (número 1-3 en lotes) | — | Bajo | Mapear a número |
| Temporadas | 2 | 3 (+2025-2026) | Falta 2025-26 en AGL; tasa de cambio en lugares distintos | **Muy alto** (20 FKs, cascadas) | Agregar 2025-26 en AGL; solo insertar/actualizar fechas |
| Variedades | 18 | 73 | Las 18 de AGL están; AgroNoti tiene cultivos de cobertura, ensayos, viejas | Alto | Cruzar solo por código SAP; nunca desactivar las propias |
| Lotes | 79 (por temporada) | 94 lotes + 169 lote-temporada | Columnas cruzadas (ubicación técnica ↔ nomenclatura), 12 lotes administrativos solo en AgroNoti, fila basura «Nomenclatura», ciclo solo en AgroNoti | **Muy alto** (notificaciones y costos) | Al final, con un plan propio |
| Tareas / procesos SAP | 0 (vacío) | 24 / 3 | AgroNoti tiene los datos reales | Muy alto | **AgroNoti manda** (o cargarlos primero en AGL) |
| Equipos / familias / implementos | 1 (taller) | 36 / 4 / 25+94 | No equivalentes | Muy alto | **AgroNoti manda** |
| Departamentos | 2 (SINAGRO) | 15 (organización) | Mismo nombre, otro significado | — | **No sincronizar** |

Solo en AgroNoti pero son de AGL por naturaleza: tipos de producto (≈ tipo_fruto), objetivos de control, historial de
precios (≈ precios de MARA), tasas de cambio (≈ tasa de la temporada), proveedores, puestos de trabajo/tarifas.

## Orden propuesto

1. **Ya**: estaciones, materiales (fertilizantes), turnos de la temporada (lo hace «Publicar a campo»).
2. Completar en AGL: zonas 2B/2C/3C, sub-turnos, temporada 2025-2026 → sincronizar zonas, turnos, temporadas, ciclos,
   planes. Catálogos en AgroNoti a solo lectura.
3. Variedades (por código SAP).
4. Lotes (plan propio).
5. Dejar en AgroNoti: tareas/procesos SAP, equipos, departamentos.
