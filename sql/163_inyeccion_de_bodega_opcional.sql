-- =====================================================================
-- 163 · Inyección: cada producto dice si SALIÓ de la bodega de la estación (pedido del usuario 2026-11-27)
--
--   La 143 obligaba a descontar todo de la bodega de la estación, pero muchos productos llegan directo al lote y nunca
--   pasan por la estación. Ahora cada línea trae «de_bodega»: por defecto (sin dato, o envío viejo de la cola) SÍ
--   descuenta, como la 143; con false explícito no descuenta (no pide saldo). El histórico sigue sin descontar.
--   Se guarda en iny_aplicaciones_detalle.de_bodega (la 139 ya lo hace con esta misma función).
--   Idempotente. Correr DESPUÉS de la 143. Si se vuelve a correr la 139 o la 143 → correr la 163 otra vez.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

do $$
begin
    if to_regprocedure('public._iny_linea_de_bodega(jsonb,jsonb,uuid)') is null then
        raise exception '163: falta correr antes la 139 y la 143.';
    end if;
end $$;

create or replace function public._iny_linea_de_bodega(d jsonb, p_lineas jsonb, p_material uuid)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v text;
begin
    if lower(btrim(coalesce(d->>'historica', ''))) in ('true', 't', '1') then
        return false;   -- histórico: no mueve inventario
    end if;
    select x.value->>'de_bodega' into v
      from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) x
     where public._fert_uuid(x.value->>'material_id') = p_material
     limit 1;
    -- 163: solo un «false» explícito de la línea evita el descuento (llegó directo al lote)
    return not (lower(btrim(coalesce(v, ''))) in ('false', 'f', '0'));
end;
$$;
revoke execute on function public._iny_linea_de_bodega(jsonb, jsonb, uuid) from public, anon, authenticated;

comment on column public.iny_aplicaciones_detalle.de_bodega is
    '139/163: true = salió de la bodega de la estación (descontó); false = llegó directo al lote o registro histórico (no descontó); null = registro anterior a la 139.';
