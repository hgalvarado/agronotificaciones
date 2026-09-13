-- =====================================================================
-- MIGRACIÓN 30 · Edición en línea, independencia de fila y vistas de tabla
-- =====================================================================
-- Tres cosas:
--
--   A. El control de horómetros necesita saber QUIÉN capturó cada uno,
--      para poder filtrar por usuario.
--   B. Editar la tarea de UN lote no puede cambiársela a los demás lotes
--      del mismo ticket. Hoy la tarea vive en `registros` y los lotes en
--      `registro_detalle`, así que tocarla se los lleva a todos por
--      delante. La función de abajo separa la línea cuando hace falta.
--   C. Las columnas que cada quien quiere ver, guardadas: un estándar de
--      la empresa que pone el Administrador y las vistas personales de
--      cada usuario.
-- =====================================================================


-- =====================================================================
-- PARTE A · QUIÉN CAPTURÓ EL HORÓMETRO
-- =====================================================================
-- `create or replace view` sólo puede AÑADIR columnas, y sólo al final.
-- `usuario_nombre` va después de `comparativo`, que es la última.
-- =====================================================================

create or replace view public.v_horometros_control as
select
    h.id,
    h.ticket_id,
    h.fecha,
    h.turno,
    h.equipo_id,
    e.codigo                as equipo_codigo,
    e.nombre                as equipo_nombre,
    fe.nombre               as familia,
    h.horometro_inicial,
    h.horometro_final,
    h.horas_maquina,
    h.horas_hombre,
    h.operador_id,
    o.codigo                as operador_codigo,
    o.nombre                as operador_nombre,
    t.codigo                as ticket_codigo,
    t.estado                as ticket_estado,
    t.proceso               as ticket_proceso,
    t.departamento,
    h.comentario,
    h.usuario_id,
    h.created_at,
    lag(h.horometro_final) over w as horometro_final_anterior,
    -- NULL en el primer registro de cada equipo: no hay contra qué comparar.
    h.horometro_inicial - lag(h.horometro_final) over w as comparativo,
    pe.nombre               as usuario_nombre
from public.horometros h
join public.equipos e         on e.id = h.equipo_id
left join public.familias_equipo fe on fe.id = e.familia_id
left join public.operadores o on o.id = h.operador_id
join public.tickets t         on t.id = h.ticket_id
left join public.perfiles pe  on pe.id = h.usuario_id
window w as (partition by h.equipo_id order by h.fecha, h.created_at);

alter view public.v_horometros_control set (security_invoker = on);


-- =====================================================================
-- PARTE B · UNA LÍNEA SE EDITA SOLA
-- =====================================================================
-- «Si un lote hereda la tarea T103 y el usuario la cambia a T300, sólo
--  esa fila cambia.»
--
-- La tarea, la labor y el implemento viven en `registros`; el lote vive
-- en `registro_detalle`. Cuando el registro tiene UN solo lote, se cambia
-- en su sitio. Cuando tiene varios, la línea se SEPARA: nace un registro
-- nuevo con los mismos datos del ticket y del horómetro pero con la tarea
-- nueva, y el detalle se muda ahí. Los demás lotes se quedan donde
-- estaban, con la tarea que tenían.
--
-- Después del reparto se vuelve a prorratear el horómetro: al separar la
-- línea, las horas notificadas del registro viejo cubrían lotes que ya no
-- le pertenecen, y dejarlas así descuadra la liquidación.
-- =====================================================================

create or replace function public.fn_editar_linea_labor(
    p_detalle_id        uuid,
    p_labor_id          uuid    default null,
    p_tarea_id          uuid    default null,
    p_implemento_id     uuid    default null,
    p_quitar_implemento boolean default false,
    p_avance_mz         numeric default null,
    p_lote_temporada_id uuid    default null
) returns uuid
language plpgsql security invoker as $$
declare
    v_registro   public.registros%rowtype;
    v_lineas     integer;
    v_nuevo_id   uuid;
    v_horometro  uuid;
    v_cambia_reg boolean;
begin
    select r.* into v_registro
    from public.registro_detalle d
    join public.registros r on r.id = d.registro_id
    where d.id = p_detalle_id;

    if not found then
        raise exception 'La línea ya no existe. Vuelve a consultar la tabla.';
    end if;

    v_horometro := v_registro.horometro_id;

    -- Lo que es del detalle se cambia siempre, sin separar nada.
    if p_avance_mz is not null then
        update public.registro_detalle set avance_mz = p_avance_mz where id = p_detalle_id;
    end if;
    if p_lote_temporada_id is not null then
        update public.registro_detalle
           set lote_temporada_id = p_lote_temporada_id
         where id = p_detalle_id;
    end if;

    v_cambia_reg :=
        (p_labor_id is not null and p_labor_id is distinct from v_registro.labor_id)
     or (p_tarea_id is not null and p_tarea_id is distinct from v_registro.tarea_id)
     or (p_implemento_id is not null and p_implemento_id is distinct from v_registro.implemento_id)
     or (p_quitar_implemento and v_registro.implemento_id is not null);

    if not v_cambia_reg then
        return v_registro.id;
    end if;

    select count(*) into v_lineas
    from public.registro_detalle where registro_id = v_registro.id;

    if v_lineas <= 1 then
        -- Único lote: la labor entera ES esta línea.
        update public.registros
           set labor_id      = coalesce(p_labor_id, labor_id),
               tarea_id      = coalesce(p_tarea_id, tarea_id),
               implemento_id = case
                                   when p_quitar_implemento then null
                                   else coalesce(p_implemento_id, implemento_id)
                               end
         where id = v_registro.id;
        perform public.fn_prorratear_horas_horometro(v_horometro);
        return v_registro.id;
    end if;

    -- Varios lotes: se separa. `horas_notificadas` nace en null a
    -- propósito; el prorrateo de abajo reparte las del horómetro entre
    -- todas las líneas, incluida la que se acaba de mudar.
    insert into public.registros (
        ticket_id, horometro_id, temporada_id, fecha,
        labor_id, tarea_id, implemento_id, comentarios, usuario_id
    )
    values (
        v_registro.ticket_id,
        v_registro.horometro_id,
        v_registro.temporada_id,
        v_registro.fecha,
        coalesce(p_labor_id, v_registro.labor_id),
        coalesce(p_tarea_id, v_registro.tarea_id),
        case when p_quitar_implemento then null
             else coalesce(p_implemento_id, v_registro.implemento_id) end,
        v_registro.comentarios,
        v_registro.usuario_id
    )
    returning id into v_nuevo_id;

    update public.registro_detalle
       set registro_id = v_nuevo_id
     where id = p_detalle_id;

    perform public.fn_prorratear_horas_horometro(v_horometro);
    return v_nuevo_id;
end;
$$;

comment on function public.fn_editar_linea_labor(uuid, uuid, uuid, uuid, boolean, numeric, uuid) is
    'Edita UNA línea de labor sin tocar los demás lotes del mismo ticket. Si el registro tiene varios lotes y cambia algo que vive en el registro (labor, tarea, implemento), la línea se separa a un registro nuevo y el horómetro se vuelve a prorratear.';

grant execute on function public.fn_editar_linea_labor(uuid, uuid, uuid, uuid, boolean, numeric, uuid) to authenticated;


-- =====================================================================
-- PARTE C · VISTAS DE TABLA (columnas guardadas)
-- =====================================================================
-- Como los layouts de SAP: el Administrador define el «Estándar de la
-- empresa» y cada usuario puede guardarse las suyas.
--
-- `columnas` es un jsonb con la lista ORDENADA de columnas visibles:
-- [{"campo":"fecha","visible":true}, …]. Se guarda la lista completa y no
-- sólo las escondidas porque el orden también es parte de la vista, y
-- porque una columna nueva en el código no debe aparecer de golpe en una
-- vista que alguien ya dio por buena.
-- =====================================================================

create table if not exists public.vistas_tabla (
    id          uuid primary key default gen_random_uuid(),
    pantalla    text not null,
    nombre      text not null,
    es_estandar boolean not null default false,
    usuario_id  uuid references public.perfiles(id) on delete cascade,
    columnas    jsonb not null default '[]'::jsonb,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    -- O es el estándar de la empresa (sin dueño) o es de alguien.
    constraint vistas_tabla_dueno check (
        (es_estandar and usuario_id is null) or (not es_estandar and usuario_id is not null)
    )
);

comment on table public.vistas_tabla is
    'Qué columnas se ven y en qué orden, por pantalla. Una vista estándar por pantalla (la de la empresa, sin dueño) y las que cada usuario se guarde.';

-- Un solo estándar por pantalla. Índice parcial porque las personales sí
-- pueden repetirse entre usuarios.
create unique index if not exists idx_vista_estandar
    on public.vistas_tabla (pantalla) where es_estandar;

create unique index if not exists idx_vista_personal
    on public.vistas_tabla (pantalla, usuario_id, nombre) where not es_estandar;

create index if not exists idx_vistas_usuario on public.vistas_tabla (usuario_id);

drop trigger if exists trg_vistas_updated on public.vistas_tabla;
create trigger trg_vistas_updated
    before update on public.vistas_tabla
    for each row execute function public.fn_touch_updated_at();

alter table public.vistas_tabla enable row level security;

-- Ver: el estándar lo ve todo el mundo; las personales, sólo su dueño.
drop policy if exists vistas_select on public.vistas_tabla;
create policy vistas_select on public.vistas_tabla for select
    using (es_estandar or usuario_id = (select auth.uid()));

-- Escribir el estándar es cosa del Administrador. Lo personal es de cada
-- quien, y `usuario_id = auth.uid()` impide guardarle una vista a otro.
drop policy if exists vistas_insert on public.vistas_tabla;
create policy vistas_insert on public.vistas_tabla for insert
    with check (
        (es_estandar and (select public.fn_es_admin()))
        or (not es_estandar and usuario_id = (select auth.uid()))
    );

drop policy if exists vistas_update on public.vistas_tabla;
create policy vistas_update on public.vistas_tabla for update
    using (
        (es_estandar and (select public.fn_es_admin()))
        or (not es_estandar and usuario_id = (select auth.uid()))
    );

drop policy if exists vistas_delete on public.vistas_tabla;
create policy vistas_delete on public.vistas_tabla for delete
    using (
        (es_estandar and (select public.fn_es_admin()))
        or (not es_estandar and usuario_id = (select auth.uid()))
    );


/**
 * Guarda una vista sin que el cliente tenga que saber si existe.
 *
 * El estándar de una pantalla es único, así que guardarlo es «pisa el que
 * haya»; una personal se identifica por su nombre dentro del usuario. Sin
 * esto, el navegador tendría que consultar primero y decidir después, y
 * dos pestañas abiertas acabarían creando dos estándares.
 */
create or replace function public.fn_guardar_vista_tabla(
    p_pantalla    text,
    p_nombre      text,
    p_columnas    jsonb,
    p_es_estandar boolean default false
) returns uuid
language plpgsql security invoker as $$
declare
    v_id uuid;
begin
    if p_es_estandar then
        select id into v_id from public.vistas_tabla
         where pantalla = p_pantalla and es_estandar;
        if found then
            update public.vistas_tabla
               set nombre = p_nombre, columnas = p_columnas
             where id = v_id;
            return v_id;
        end if;
        insert into public.vistas_tabla (pantalla, nombre, columnas, es_estandar, usuario_id)
        values (p_pantalla, p_nombre, p_columnas, true, null)
        returning id into v_id;
        return v_id;
    end if;

    select id into v_id from public.vistas_tabla
     where pantalla = p_pantalla
       and usuario_id = (select auth.uid())
       and nombre = p_nombre
       and not es_estandar;
    if found then
        update public.vistas_tabla set columnas = p_columnas where id = v_id;
        return v_id;
    end if;

    insert into public.vistas_tabla (pantalla, nombre, columnas, es_estandar, usuario_id)
    values (p_pantalla, p_nombre, p_columnas, false, (select auth.uid()))
    returning id into v_id;
    return v_id;
end;
$$;

comment on function public.fn_guardar_vista_tabla(text, text, jsonb, boolean) is
    'Crea o actualiza una vista de tabla. El estándar de cada pantalla es único y sólo lo toca el Administrador; las personales se identifican por nombre dentro de cada usuario.';

grant execute on function public.fn_guardar_vista_tabla(text, text, jsonb, boolean) to authenticated;
