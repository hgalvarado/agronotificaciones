-- =====================================================================
-- AGRONOTIFICACIONES · Funciones RPC de negocio
-- =====================================================================
-- Todas se exponen vía supabase.rpc(...) desde Next.js. Corren con los
-- privilegios del usuario que llama (RLS sigue aplicando dentro de ellas
-- salvo que se declaren SECURITY DEFINER explícitamente, como en la de
-- auditoría). Las de escritura transaccional son SECURITY INVOKER a
-- propósito: si el usuario no tiene permiso RLS para insertar, la función
-- falla igual que un insert directo.

-- ---------------------------------------------------------------------
-- 1. DUPLICAR HORÓMETRO
-- ---------------------------------------------------------------------
-- Caso de uso: 3 tractores hacen la misma labor en el mismo lote el mismo
-- día. El usuario registra el primer horómetro completo y "clona" los
-- siguientes, cambiando sólo equipo/operador/lecturas.
create or replace function public.duplicar_horometro(
    p_horometro_id uuid,
    p_equipo_id    uuid default null,   -- si null, se copia el mismo equipo
    p_operador_id  uuid default null
) returns uuid
language plpgsql security invoker as $$
declare
    v_origen public.horometros%rowtype;
    v_nuevo_id uuid;
begin
    select * into v_origen from public.horometros where id = p_horometro_id;
    if not found then
        raise exception 'Horómetro % no existe', p_horometro_id;
    end if;

    insert into public.horometros (
        ticket_id, fecha, turno, equipo_id,
        horometro_inicial, horometro_final, horas_hombre,
        operador_id, comentario, usuario_id
    ) values (
        v_origen.ticket_id, v_origen.fecha, v_origen.turno,
        coalesce(p_equipo_id, v_origen.equipo_id),
        0, 0,                          -- el usuario debe capturar las lecturas reales del nuevo equipo
        v_origen.horas_hombre,
        coalesce(p_operador_id, v_origen.operador_id),
        v_origen.comentario,
        auth.uid()
    )
    returning id into v_nuevo_id;

    return v_nuevo_id;
end;
$$;

comment on function public.duplicar_horometro is
'Clona un horómetro dentro del mismo ticket. horometro_inicial/final se resetean a 0
para forzar la captura real; equipo/operador pueden sobreescribirse en la misma llamada.';

-- ---------------------------------------------------------------------
-- 2. DUPLICAR REGISTRO DE LABOR (con sus lotes/avance)
-- ---------------------------------------------------------------------
-- Clona un registro completo (labor + tarea SAP + implemento) y todas sus
-- filas de registro_detalle (lotes trabajados), permitiendo re-vincularlo
-- a otro horómetro (por ejemplo, el horómetro recién duplicado arriba).
create or replace function public.duplicar_registro(
    p_registro_id  uuid,
    p_horometro_id uuid default null,  -- si null, se mantiene el mismo horómetro
    p_copiar_detalle boolean default true
) returns uuid
language plpgsql security invoker as $$
declare
    v_origen public.registros%rowtype;
    v_nuevo_id uuid;
begin
    select * into v_origen from public.registros where id = p_registro_id;
    if not found then
        raise exception 'Registro % no existe', p_registro_id;
    end if;

    insert into public.registros (
        ticket_id, horometro_id, temporada_id, fecha,
        labor_id, tarea_id, implemento_id, comentarios, usuario_id
    ) values (
        v_origen.ticket_id,
        coalesce(p_horometro_id, v_origen.horometro_id),
        v_origen.temporada_id, v_origen.fecha,
        v_origen.labor_id, v_origen.tarea_id, v_origen.implemento_id,
        v_origen.comentarios, auth.uid()
    )
    returning id into v_nuevo_id;

    if p_copiar_detalle then
        insert into public.registro_detalle (registro_id, lote_temporada_id, avance_mz, comentarios, fecha, usuario_id)
        select v_nuevo_id, lote_temporada_id, avance_mz, comentarios, fecha, auth.uid()
        from public.registro_detalle
        where registro_id = p_registro_id;
    end if;

    return v_nuevo_id;
end;
$$;

comment on function public.duplicar_registro is
'Clona un registro de labor y (opcionalmente) todas sus filas de lotes/avance.
Útil cuando varios equipos hacen la misma labor en los mismos lotes el mismo día.';

-- ---------------------------------------------------------------------
-- 3. CIERRE DE TICKET
-- ---------------------------------------------------------------------
create or replace function public.cerrar_ticket(p_ticket_id uuid)
returns void
language plpgsql security invoker as $$
begin
    update public.tickets
    set estado = 'CERRADO', cerrado_at = now(), cerrado_by = auth.uid()
    where id = p_ticket_id;
    -- RLS de tickets_update decide si este usuario puede hacerlo.
    -- A partir de aquí, horometros/registros de este ticket quedan
    -- bloqueados para el digitador (ver 02_rls_policies.sql).
end;
$$;

-- ---------------------------------------------------------------------
-- 4. DASHBOARD · AVANCE POR UBICACIÓN TÉCNICA (lote) Y CATEGORÍA DE LABOR
-- ---------------------------------------------------------------------
-- Vista base: mz trabajadas por lote+labor+temporada
create or replace view public.v_avance_lote_labor as
select
    lt.id                    as lote_temporada_id,
    l.id                     as lote_id,
    l.nomenclatura,
    lt.temporada_id,
    lt.area_neta,
    lb.id                    as labor_id,
    lb.nombre                as labor_nombre,
    cl.id                    as categoria_labor_id,
    cl.nombre                as categoria_labor_nombre,
    coalesce(sum(rd.avance_mz), 0) as mz_trabajadas
from public.lotes_temporada lt
join public.lotes l on l.id = lt.lote_id
cross join public.labores lb
join public.categorias_labor cl on cl.id = lb.categoria_labor_id
left join public.registro_detalle rd
       on rd.lote_temporada_id = lt.id
left join public.registros r
       on r.id = rd.registro_id and r.labor_id = lb.id
group by lt.id, l.id, l.nomenclatura, lt.temporada_id, lt.area_neta,
         lb.id, lb.nombre, cl.id, cl.nombre;

comment on view public.v_avance_lote_labor is
'Base para el dashboard: mz trabajadas por cada combinación lote x labor x temporada.
Una labor se considera "completada" en un lote cuando mz_trabajadas >= area_neta.';

-- RPC parametrizada que consume el dashboard (filtro por categoría + temporada,
-- opcionalmente por lote específico)
create or replace function public.fn_avance_por_categoria(
    p_categoria_labor_id uuid,
    p_temporada_id       uuid,
    p_lote_id            uuid default null
) returns table (
    lote_id            uuid,
    nomenclatura       text,
    area_neta          numeric,
    labor_id           uuid,
    labor_nombre       text,
    mz_trabajadas      numeric,
    mz_pendientes      numeric,
    labor_completada   boolean
)
language sql stable security invoker as $$
    select
        v.lote_id,
        v.nomenclatura,
        v.area_neta,
        v.labor_id,
        v.labor_nombre,
        v.mz_trabajadas,
        greatest(v.area_neta - v.mz_trabajadas, 0) as mz_pendientes,
        (v.mz_trabajadas >= v.area_neta) as labor_completada
    from public.v_avance_lote_labor v
    where v.categoria_labor_id = p_categoria_labor_id
      and v.temporada_id = p_temporada_id
      and (p_lote_id is null or v.lote_id = p_lote_id)
    order by v.nomenclatura, v.labor_nombre;
$$;

-- Resumen agregado por lote (para las tarjetas del dashboard: % avance global
-- de la categoría en ese lote, no por labor individual)
create or replace function public.fn_resumen_avance_categoria_por_lote(
    p_categoria_labor_id uuid,
    p_temporada_id       uuid
) returns table (
    lote_id           uuid,
    nomenclatura      text,
    area_neta         numeric,
    labores_totales   bigint,
    labores_completas bigint,
    pct_avance        numeric
)
language sql stable security invoker as $$
    select
        lote_id,
        nomenclatura,
        max(area_neta) as area_neta,
        count(*) as labores_totales,
        count(*) filter (where labor_completada) as labores_completas,
        round(100.0 * count(*) filter (where labor_completada) / nullif(count(*), 0), 1) as pct_avance
    from public.fn_avance_por_categoria(p_categoria_labor_id, p_temporada_id)
    group by lote_id, nomenclatura
    order by nomenclatura;
$$;

-- ---------------------------------------------------------------------
-- 5. MÓDULO FINANCIERO · costo estimado por ticket (ejemplo de consumo)
-- ---------------------------------------------------------------------
create or replace function public.fn_costo_ticket(p_ticket_id uuid)
returns table (
    concepto text,
    horas_o_mz numeric,
    costo_unitario numeric,
    costo_total numeric
)
language sql stable security invoker as $$
    -- Costo por horas máquina (tarifa de equipo vigente en la fecha del horómetro)
    select
        'Equipo: ' || e.codigo as concepto,
        h.horas_maquina,
        te.costo_hora,
        h.horas_maquina * te.costo_hora as costo_total
    from public.horometros h
    join public.equipos e on e.id = h.equipo_id
    join lateral (
        select costo_hora from public.tarifas_equipo te
        where te.equipo_id = h.equipo_id
          and h.fecha >= te.vigente_desde
          and (te.vigente_hasta is null or h.fecha <= te.vigente_hasta)
        order by te.vigente_desde desc limit 1
    ) te on true
    where h.ticket_id = p_ticket_id

    union all

    -- Costo por labor (tarifa por mz o por hora, según catálogo)
    select
        'Labor: ' || lb.nombre,
        coalesce(sum(rd.avance_mz), sum(h.horas_maquina)) ,
        tl.costo_unidad,
        coalesce(sum(rd.avance_mz), sum(h.horas_maquina)) * tl.costo_unidad
    from public.registros r
    join public.labores lb on lb.id = r.labor_id
    join public.horometros h on h.id = r.horometro_id
    left join public.registro_detalle rd on rd.registro_id = r.id
    join lateral (
        select costo_unidad, unidad from public.tarifas_labor tl
        where tl.labor_id = r.labor_id
          and r.fecha >= tl.vigente_desde
          and (tl.vigente_hasta is null or r.fecha <= tl.vigente_hasta)
        order by tl.vigente_desde desc limit 1
    ) tl on true
    where r.ticket_id = p_ticket_id
    group by lb.nombre, tl.costo_unidad;
$$;

comment on function public.fn_costo_ticket is
'Ejemplo de cómo el módulo financiero cruza horas/mz reales contra la tarifa vigente
en la fecha del movimiento (no la tarifa actual), para no distorsionar costos históricos.';
