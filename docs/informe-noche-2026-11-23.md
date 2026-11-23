# Informe de la noche · 2026-11-22 → 2026-11-23

Producción de AgroNotificaciones NO se tocó. Todo está en la rama `desarrollo`; los SQL 136, 138, 139 y 140 están corridos solo en la base de desarrollo.

## AGL (`main` = b342af1, falta publicar con `Publicar_Produccion.bat /SI`: el intento automático se cortó por memoria)
- Fertirriego /FR01 rediseñado: 7 pestañas, botón «Sincronizar» arriba junto a la temporada.
- Comparativo: filtros Zona/Responsable/Ciclo/Estación, un solo scroll (se quitó el «scroll infinito»), encabezado compacto.
- «Horas de riego y cloro»: responde al turno y a los filtros, un gráfico y tabla diaria con acumulado.
- Informes más pequeños y densos.
- Inyección › «Plan general» (guía técnica por producto, DDT, variedades con %, área, ficha técnica).
- Motores: un equipo de tipo «Bomba» en /EQ01 es motor (se quitó la casilla «Motor de riego»).
- QA Opus: pasó, con defectos corregidos (Objetivos de Inyección, números del Comparativo, detección de Bomba).

## AgroNotificaciones — tus 12 puntos
1. Envíos con error: opciones (Reintentar, Corregir, Pedir ayuda, Descartar); «motor no asignado en esa fecha» ya no bloquea; pantalla de admin `/admin/fertirriego-problemas` (sql 136).
2. Permisos finos de motores (recibir, mover, retirar, mantenimiento) y «Recibir motor» sin «Motivo» (sql 138).
3. «Asignar nuevo motor» con buscador, sin lista infinita.
4. Indicador «En línea / Sin señal» arriba y fijo, con «Regresar».
5. Bodega general (incluye diésel y envases) (sql 139).
6. Eliminar por completo ahora cubre Inyección y Motores (sql 140).
7. Botones «Regresar» en las pantallas de Campo.
8. Registro histórico por pantalla (sql 140).
9. Hub Campo: Parámetros de riego directo, sin botón de registros.
10. Sin Polinización ni Registros de productos; extractor y savia «Próximamente».
11. Plan general de Inyección (en AGL).
12. Inyección sin bodega, con la pregunta «¿lo tomaste de la estación?» (sql 139).

## Pruebas
Réplica SQL 61/61; regresión 128–132 OK; unitarias 261/261; QA con clics OK. SIN PROBAR con datos: Recibir/Mover/Retirar motor, diésel en bodega, Inyección con y sin saldo, eliminar e histórico (desarrollo no tiene un motor Bomba, diésel publicado ni lote con plan).

## Pendientes
- AGL no quita de su lado lo que borres de Inyección/Motores.
- Al aceptar un rechazo se pierde la hora y ubicación original.
- El menú de Admin muestra los enlaces nuevos solo a quien tiene permiso de Fertirriego.
- La exportación a AGL no trae `de_bodega`.
- Incidente de QA ya revertido: se limpió el estado de un envío existente (`4971ce47-…`) en desarrollo; si estaba en «Ayuda», se perdió.

## Para pasar a producción (cuando lo digas)
Publicar el código, y luego correr en producción en este orden: 136 → 138 → 139 → 140.
