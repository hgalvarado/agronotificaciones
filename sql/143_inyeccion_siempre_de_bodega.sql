-- =====================================================================
-- 143 · Inyección SIEMPRE se consume de la bodega de la estación (pedido del usuario 2026-11-23)
--
--   Revierte la regla de la 139: ya no se pregunta «¿lo tomaste de la bodega?». Toda línea de una aplicación de
--   Inyección descuenta del libro de la estación (misma bodega de Fertirriego). Si no alcanza: igual que Aplicar en
--   Fertirriego (en línea se rechaza; con la casilla de confirmación se acepta y queda SALDO_NEGATIVO).
--   El registro HISTÓRICO (`historica: true`, sql/140) sigue sin descontar: la 140 ya lo excluye en el llamado
--   (`and not v_hist`); aquí `de_bodega` se guarda en false solo para ese caso.
--   No se toca _iny_op_aplicacion_lote: basta redefinir _iny_linea_de_bodega (la usan la 139 y la 140).
--   `iny_aplicaciones_detalle.de_bodega` se conserva (se guarda true, salvo histórico).
--
--   Idempotente. Correr DESPUÉS de la 139 y la 140. Si se vuelve a correr 129, 132 o 139 → 141, 142 y 143.
-- =====================================================================

do $$
begin
    if to_regprocedure('public._iny_linea_de_bodega(jsonb,jsonb,uuid)') is null then
        raise exception '143: falta correr antes la 139.';
    end if;
end $$;

/** 143: siempre descuenta, salvo el registro histórico. Ignora cualquier «de_bodega» que traiga un envío viejo. */
create or replace function public._iny_linea_de_bodega(d jsonb, p_lineas jsonb, p_material uuid)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    return not (lower(btrim(coalesce(d->>'historica', ''))) in ('true', 't', '1'));
end;
$$;
revoke execute on function public._iny_linea_de_bodega(jsonb, jsonb, uuid) from public, anon, authenticated;
