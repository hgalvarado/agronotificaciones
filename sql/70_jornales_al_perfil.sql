-- =====================================================================
-- 70 · LOS JORNALES QUE YA ESTABAN, AL PERFIL
-- =====================================================================
--
-- Separada de la 69 por una regla de PostgreSQL y no por capricho: un
-- valor de enum **no se puede usar en la misma transacción en que se
-- crea**, y el editor SQL de Supabase manda cada archivo como una sola
-- transacción.
--
--     ERROR: unsafe use of new value "JORNAL" of enum type tipo_perfil
--
-- **Corre la 69 primero.** Si esto falla diciendo que «JORNAL» no
-- existe, es que falta.
--
-- Idempotente: se puede correr las veces que haga falta.
-- =====================================================================

-- Las personas que ya estaban marcadas como jornal con la casilla pasan
-- a tener también el perfil. Sin esto, el catálogo enseñaría cero
-- jornales el día de la instalación aunque el selector de cuadrilla
-- llevara meses ofreciéndolos, y quien mirase la pantalla concluiría que
-- no hay ninguno.
update public.operadores
   set tipo_perfil = coalesce(tipo_perfil, array[]::public.tipo_perfil[])
                     || 'JORNAL'::public.tipo_perfil
 where es_jornal
   and not ('JORNAL' = any(coalesce(tipo_perfil, array[]::public.tipo_perfil[])::text[]));

-- Y al revés: si alguien ya traía el perfil puesto a mano —por el
-- importador de Excel, por ejemplo— se le enciende la casilla, que es la
-- que mira el selector de cuadrilla de desinfección.
update public.operadores
   set es_jornal = true
 where 'JORNAL' = any(coalesce(tipo_perfil, array[]::public.tipo_perfil[])::text[])
   and not es_jornal;

do $$
declare v_n integer;
begin
    select count(*) into v_n from public.operadores where es_jornal;
    raise notice 'Personal marcado como jornal: %', v_n;
end $$;
