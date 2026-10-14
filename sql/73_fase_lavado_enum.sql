-- =====================================================================
-- 73 · LA FASE 4 ENTRA EN LOS DOS ENUMS, Y NADA MÁS
-- =====================================================================
--
-- ── Por qué este archivo está solo ──────────────────────────────────
--
-- Es la trampa #14 de la bitácora, y ya costó una vuelta en la 69/70:
--
--     ALTER TYPE … ADD VALUE no se puede USAR en la misma transacción
--     en que se añade. Postgres contesta «unsafe use of new value».
--
-- El editor SQL de Supabase manda **cada archivo como una transacción**.
-- Si esto fuera con el resto de la 74 —que sí usa '4_Lavado' en un
-- CHECK, en un DEFAULT y en un FILTER—, el archivo entero reventaría.
--
-- Así que este archivo no hace NADA más. Se corre, se cierra, y la 74 ya
-- encuentra el valor puesto.
--
-- `IF NOT EXISTS` lo hace repetible: volver a correrlo no es un error,
-- que es lo que hace falta cuando alguien no está seguro de si lo corrió.
-- =====================================================================

-- El estado del TURNO: dónde va el flujo.
--   1_Preriego → 2_Lecturas → 3_Aplicacion → 4_Lavado
alter type public.estado_desinfeccion add value if not exists '4_Lavado';

-- La fase de una línea de CUADRILLA y, desde la 74, también de un
-- químico. El lavado de cinta lo cierra gente distinta de la que inyectó
-- y con químico distinto: si las dos cosas cayeran en '3_Aplicacion', el
-- costo del lavado quedaría escondido dentro del de la aplicación y
-- nadie podría contestar cuánto cuesta cerrar un turno.
alter type public.fase_personal_desinfeccion add value if not exists '4_Lavado';
