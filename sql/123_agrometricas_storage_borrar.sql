-- =====================================================================
-- 123 · AGROMÉTRICAS · AGL PUEDE BORRAR LAS FOTOS YA BAJADAS DEL BUCKET «agrometricas»
-- La 110 solo dio insertar / actualizar / ver. AGL, tras bajar la foto y confirmar (122), la borra de Storage con el
-- token del usuario técnico: política DELETE solo en el bucket 'agrometricas' y solo con «Conexión AGL · publicar»
-- (el mismo permiso que confirma y purga en la 122). Sin nombres de rol. No toca otras políticas.
-- Requiere la 110. Idempotente. Se omite donde no hay Storage (réplica sin Storage).
-- Alternativa: llave de servicio guardada en AGL /SE03.
-- =====================================================================
do $$
begin
    if to_regclass('storage.objects') is null then
        raise notice 'Sin Storage (réplica local): se omite la política de borrado.';
        return;
    end if;
    execute 'drop policy if exists agm_fotos_borrar on storage.objects';
    execute $p$create policy agm_fotos_borrar on storage.objects for delete to authenticated
        using (bucket_id = 'agrometricas' and (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'publicar')))$p$;
end
$$;
