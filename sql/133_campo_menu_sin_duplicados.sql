-- 133 · Menú sin duplicados: Fertirriego y AgroMétricas viven dentro de «Campo» (/campo).
-- Siguen existiendo como pantallas (permisos, rutas y fichas del hub); solo dejan de ser entradas sueltas del menú.
-- Idempotente. Todo UPDATE lleva WHERE.

update public.pantallas
   set en_menu = false
 where codigo in ('fertirriego', 'agrometricas')
   and en_menu is distinct from false;

-- Campo agrupa lo de campo en el menú
update public.pantallas
   set en_menu = true
 where codigo = 'campo'
   and en_menu is distinct from true;
