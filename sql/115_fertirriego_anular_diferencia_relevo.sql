-- =====================================================================
-- 115 · FERTIRRIEGO · ANULAR LA DIFERENCIA DE UN PRODUCTO EN UN RELEVO
-- =====================================================================
-- Pedido del usuario (2026-11-18): quien recibe la estación en un relevo cuenta de menos un producto que en realidad
-- sí se aplicó (se olvidaron de registrar la aplicación). La diferencia (movimiento DIFERENCIA_RELEVO) no se podía
-- anular. Ahora SOLO quien tiene «Anular» en la estación puede anular LA DIFERENCIA DE UN PRODUCTO de un relevo, con
-- un motivo detallado (mínimo 25 letras). El producto vuelve al inventario (movimiento ANULACION que revierte esa
-- diferencia) y queda registrado quién, cuándo y por qué; después se registra la aplicación olvidada.
--   - No toca la custodia ni lo demás del relevo. Si todas sus diferencias quedan anuladas, el relevo deja de pedir revisión.
--   - El autor del relevo NO anula por ser autor: hace falta el permiso «Anular» (a diferencia de recepción/aplicación/conteo).
--   - fert_relevos_diferencias no está en el archivo de turnos de la 102 (el relevo no es de un turno): la huella no cambia.
--   - El estado del teléfono y la exportación a AGL traen anulado_at, motivo_anulacion y anulado_por_nombre.
-- Parte de la _fert_op_anulacion VIGENTE (sql/95; ninguna migración posterior la redefinió). Correr DESPUÉS de la 102.
-- Idempotente. Si se vuelve a correr la 95, correr la 115 otra vez.
-- =====================================================================

alter table public.fert_relevos_diferencias
    add column if not exists anulado_at timestamptz,
    add column if not exists anulado_por uuid,
    add column if not exists motivo_anulacion text;

create or replace function public._fert_op_anulacion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tipo     text := d->>'documento_tipo';
    v_doc      uuid := public._fert_uuid(d->>'documento_id');
    v_motivo   text := nullif(btrim(d->>'motivo'), '');
    v_estacion uuid;
    v_autor    uuid;
    v_anulado  timestamptz;
    v_registro timestamptz;
    v_custodia public.fert_custodia%rowtype;
    v_obs      text[] := '{}';
    v_mat      uuid;
    m          record;
begin
    if v_motivo is null then
        raise exception 'Indica el motivo de la anulación.';
    end if;

    -- Diferencia de un producto en un relevo: permiso propio y motivo detallado
    if v_tipo = 'relevo' then
        v_mat := public._fert_uuid(d->>'material_id');
        if v_mat is null then
            raise exception 'Indica el producto cuya diferencia se anula.';
        end if;
        select r.estacion_id into v_estacion from public.fert_relevos r where r.id = v_doc;
        if v_estacion is null then
            raise exception 'El relevo no existe.';
        end if;
        select x.anulado_at into v_anulado from public.fert_relevos_diferencias x
         where x.relevo_id = v_doc and x.material_id = v_mat for update;
        if not found then
            raise exception 'Ese relevo no tiene diferencia de ese producto.';
        end if;
        if v_anulado is not null then
            raise exception 'Esa diferencia ya estaba anulada.';
        end if;
        if not public.fn_fert_puede(v_estacion, 'anular') then
            raise exception 'Solo quien tenga «Anular» en esta estación puede anular la diferencia de un relevo.'
                using errcode = '42501';
        end if;
        if char_length(v_motivo) < 25 then
            raise exception 'Explica con detalle por qué se anula (mínimo 25 letras): qué producto se aplicó, cuándo y quién no lo registró.';
        end if;

        for m in select * from public.fert_movimientos mv
                 where mv.documento_tipo = 'relevo' and mv.documento_id = v_doc and mv.material_id = v_mat
                   and mv.tipo = 'DIFERENCIA_RELEVO' and mv.anula_id is null
                   and not exists (select 1 from public.fert_movimientos a where a.anula_id = mv.id)
                 order by mv.cursor loop
            v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, m.estacion_id, m.material_id, 'ANULACION',
                         -m.cantidad, p_creado, m.turno_ciclo_id, 'relevo', v_doc, p_inmediato, m.id));
        end loop;

        update public.fert_relevos_diferencias
           set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo
         where relevo_id = v_doc and material_id = v_mat;
        if not exists (select 1 from public.fert_relevos_diferencias where relevo_id = v_doc and anulado_at is null) then
            update public.fert_relevos set revisar = false where id = v_doc;
        end if;
        return v_obs;
    end if;

    case v_tipo
        when 'recepcion' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_recepciones where id = v_doc;
        when 'aplicacion' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_aplicaciones where id = v_doc;
            if exists (select 1 from public.fert_devoluciones where aplicacion_id = v_doc and anulado_at is null) then
                raise exception 'Esa aplicación tiene devoluciones: anúlalas primero.';
            end if;
        when 'conteo' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_conteos where id = v_doc;
        when 'devolucion' then
            select estacion_id, registrado_por, anulado_at into v_estacion, v_autor, v_anulado from public.fert_devoluciones where id = v_doc;
        else
            raise exception 'No se puede anular ese tipo de registro.';
    end case;

    if v_estacion is null then
        raise exception 'El registro a anular no existe.';
    end if;
    if v_anulado is not null then
        raise exception 'Ese registro ya estaba anulado.';
    end if;

    -- Cuándo se REGISTRÓ (el id del documento es el de su operación)
    select coalesce(o.creado_en, o.recibido_en) into v_registro from public.fert_operaciones o where o.id = v_doc;

    if not public.fn_fert_puede(v_estacion, 'anular') then
        select * into v_custodia from public.fert_custodia where estacion_id = v_estacion;
        if not (v_autor = (select auth.uid())
                and v_custodia.custodio_id = (select auth.uid())
                and v_custodia.estado = 'ACTIVA'
                and v_custodia.desde <= coalesce(v_registro, now())) then
            raise exception 'Solo puedes anular tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'
                using errcode = '42501';
        end if;
    end if;

    for m in select * from public.fert_movimientos mv
             where mv.documento_id = v_doc and mv.anula_id is null and mv.tipo <> 'ANULACION'
             order by mv.cursor loop
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, m.estacion_id, m.material_id, 'ANULACION',
                     -m.cantidad, p_creado, m.turno_ciclo_id, v_tipo, v_doc, p_inmediato, m.id));
    end loop;

    execute format('update public.%I set anulado_at = now(), anulado_por = $1, motivo_anulacion = $2 where id = $3',
                   case v_tipo when 'recepcion' then 'fert_recepciones' when 'aplicacion' then 'fert_aplicaciones'
                               when 'conteo' then 'fert_conteos' else 'fert_devoluciones' end)
        using (select auth.uid()), v_motivo, v_doc;
    return v_obs;
end;
$$;

revoke all on function public._fert_op_anulacion(uuid, jsonb, timestamptz, boolean) from public, anon, authenticated;

-- ---------- Estado del teléfono y exportación a AGL: campos nuevos en cada diferencia (parche por texto) ----------
do $$
declare
    f        record;
    v_def    text;
    v_viejo  text;
    v_nuevo  text;
    v_n      integer;
    v_patron text;
    v_hechas integer := 0;
begin
    for f in select p.oid, p.oid::regprocedure::text as firma
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc like '%fert_relevos_diferencias%'
               and (p.prosrc like '%''diferencia'', x.diferencia))%' or p.prosrc like '%''diferencia'', d.diferencia,%')
    loop
        v_def := replace(pg_get_functiondef(f.oid), E'\r\n', E'\n');
        if position('anulado_por_nombre' in v_def) > 0 then
            raise notice '115: % ya trae los campos (nada que hacer)', f.firma;
            continue;
        end if;
        if position('''diferencia'', x.diferencia))' in v_def) > 0 then
            v_viejo := '''diferencia'', x.diferencia))';
            v_nuevo := '''diferencia'', x.diferencia, ''anulado_at'', x.anulado_at, ''motivo_anulacion'', x.motivo_anulacion, '
                       || '''anulado_por_nombre'', (select pa.nombre from public.perfiles pa where pa.id = x.anulado_por)))';
            v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
            if v_n <> 1 then
                raise exception '115: en % se esperaba 1 aparición de «%» y hay %', f.firma, v_viejo, v_n;
            end if;
            execute replace(v_def, v_viejo, v_nuevo);
        else
            -- exportación a AGL: solo el bloque del relevo (el de conteos también dice d.diferencia)
            v_patron := '(''diferencia'', d\.diferencia,)(\s*''analisis'', m\.fert_analisis\)\)\s*from public\.fert_relevos_diferencias)';
            v_n := (select count(*) from regexp_matches(v_def, v_patron, 'g'));
            if v_n <> 1 then
                raise exception '115: en % se esperaba 1 bloque de diferencias de relevo y hay %', f.firma, v_n;
            end if;
            execute regexp_replace(v_def, v_patron,
                '\1 ''anulado_at'', d.anulado_at, ''motivo_anulacion'', d.motivo_anulacion, '
                || '''anulado_por_nombre'', (select pa.nombre from public.perfiles pa where pa.id = d.anulado_por),\2');
        end if;
        v_hechas := v_hechas + 1;
        raise notice '115: parchada %', f.firma;
    end loop;
    if v_hechas = 0 and not exists (select 1 from pg_proc p where p.prosrc like '%fert_relevos_diferencias%' and p.prosrc like '%anulado_por_nombre%') then
        raise exception '115: no se encontró ninguna función que muestre las diferencias del relevo';
    end if;
end $$;
