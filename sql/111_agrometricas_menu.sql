-- =====================================================================
-- 111 · AgroMétricas en el menú
-- =====================================================================
-- La 109 dejó la pantalla «agrometricas» fuera del menú (en_menu = false) hasta tener las pantallas del teléfono.
-- En desarrollo se encendió a mano (update del usuario, 2026-11-13); esta migración lo deja escrito para producción.
--
--   - en_menu = true + ícono «chart» (migración 93: aparece solo a quien tenga «Ver» en la pantalla; el menú escrito
--     de AppShell no se toca). Si el rol tiene menú diseñado (103), la pantalla queda en el catálogo de destinos y,
--     si el diseño no la puso, sale en «Otros» (incluir_resto): nada se pierde. El menú NUNCA da permisos.
--   - modulo = 'AgroMétricas' (92): agrupa la pantalla en Permisos y le da al menú la etiqueta «AgroMétricas».
--   - Nombres de los alcances según fn_agm_puede_zona (109): por ZONA del turno.
--   - Descripción alineada con las decisiones del usuario (clima por zona, no por estación).
--
-- Requiere la 109 (si la pantalla no existe, no hace nada). Idempotente; se puede correr antes o después de volver a
-- correr la 109/110 (la 109 no toca en_menu, icono, modulo ni etiquetas). Todo UPDATE lleva WHERE.
-- Respeta lo que alguien haya cambiado a mano en ícono, módulo o etiquetas: solo los llena si están vacíos.
-- =====================================================================

update public.pantallas
   set en_menu = true,
       icono   = coalesce(icono, 'chart'),
       modulo  = coalesce(modulo, 'AgroMétricas'),
       etiquetas_alcance = coalesce(etiquetas_alcance,
           '{"global": "Todas las zonas", "zonal": "Sus zonas", "propietario": "Zonas de sus estaciones"}'::jsonb),
       descripcion = 'Parámetros de riego por turno y día (tensiómetros, agua y solución, suelo, calicata) y clima por zona. '
                  || 'Alcance «zonal» = los turnos de sus zonas; «propietario» = los de las zonas de sus estaciones asignadas.'
 where codigo = 'agrometricas';

notify pgrst, 'reload schema';
