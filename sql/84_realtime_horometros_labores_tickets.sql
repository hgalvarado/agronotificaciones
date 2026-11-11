-- =====================================================================
-- 84 · AVISOS EN TIEMPO REAL (Supabase Realtime) PARA HORÓMETROS, LABORES Y TICKETS
--
-- Ejecutar en el SQL Editor DESPUÉS de la 83. Primero en DESARROLLO, luego en PRODUCCIÓN.
--
-- Las pantallas Horómetros, Labores y Tickets se actualizan solas cuando alguien registra o corrige algo
-- (lib/datos/useAvisosCambios). Para que la base AVISE, cada tabla debe estar en la publicación
-- `supabase_realtime`. Sin esto la plataforma funciona igual: se pone al día al volver a la ventana.
--
-- Seguridad: Realtime respeta las políticas RLS de cada tabla. Cada usuario solo recibe avisos de las filas que
-- ya puede ver; el aviso solo dispara una nueva consulta, que también pasa por RLS.
--
-- Idempotente: si la tabla ya está publicada, no hace nada.
-- =====================================================================

do $$
declare
    t text;
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
    end if;
    foreach t in array array['horometros', 'registros', 'registro_detalle', 'tickets']
    loop
        if to_regclass('public.' || t) is null then
            raise notice 'public.% no existe: se omite', t;
        elsif not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
            raise notice 'public.% publicada en Realtime', t;
        else
            raise notice 'public.% ya estaba publicada', t;
        end if;
    end loop;
end $$;
