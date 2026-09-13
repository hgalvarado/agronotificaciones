-- =====================================================================
-- AGRONOTIFICACIONES · Migración 11
-- (a) Horas notificadas por labor   (b) Tarifas por puesto de trabajo
-- (c) Costos calculados             (d) Notificaciones
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01–10.
-- =====================================================================


-- =====================================================================
-- PARTE A · HORAS NOTIFICADAS POR LABOR  (decisión importante)
-- =====================================================================
-- Hasta ahora las horas vivían SÓLO en el horómetro. Eso alcanza para
-- controlar el correlativo, pero NO para costear.
--
-- El problema: un horómetro de 8 horas puede tener 3 labores colgando. Si
-- el costo se calculara con las horas del horómetro, cada labor cobraría
-- 8 horas y el gasto saldría triplicado.
--
-- En tu Excel de notificación esto ya está resuelto: la columna H_NOT
-- trae las horas de ESA línea (3.000, 2.000, 4.500…), no las del día
-- completo. Así que se agrega el mismo concepto.
--
-- Queda nullable a propósito: si una labor es la única del horómetro, no
-- hay nada que repartir y se usan las horas del horómetro. El costeo
-- resuelve con coalesce(horas_notificadas, horas_maquina).
-- =====================================================================

alter table public.registros
    add column if not exists horas_notificadas numeric(10,2)
    check (horas_notificadas is null or horas_notificadas >= 0);

comment on column public.registros.horas_notificadas is
'Horas de máquina imputadas a ESTA labor. Si es NULL se usan las del horómetro
(caso de una sola labor). Equivale a la columna H_NOT del Excel de notificación.';


-- =====================================================================
-- PARTE B · TARIFAS POR PUESTO DE TRABAJO
-- =====================================================================
-- La tarifa va por puesto de trabajo y por temporada, y puede cambiar
-- varias veces dentro de la misma temporada. Se modela con vigencias
-- (desde / hasta) en vez de sobreescribir: así un registro de agosto
-- sigue costeado con la tarifa que estaba vigente en agosto, aunque en
-- octubre la tarifa haya cambiado. Sin esto, cualquier ajuste de tarifa
-- reescribiría el histórico de costos.
-- =====================================================================

create table if not exists public.tarifas_puesto (
    id                uuid primary key default gen_random_uuid(),
    temporada_id      uuid not null references public.temporadas(id) on delete cascade,
    puesto_trabajo_id uuid not null references public.puestos_trabajo(id) on delete cascade,
    costo_hora        numeric(12,4) not null check (costo_hora >= 0),
    moneda            text not null default 'HNL',
    vigente_desde     date not null,
    vigente_hasta     date,           -- NULL = vigente hasta nuevo aviso
    comentario        text,           -- motivo del cambio de tarifa
    created_by        uuid references public.perfiles(id) default auth.uid(),
    created_at        timestamptz not null default now(),
    constraint tarifas_puesto_rango check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);

-- Un mismo puesto no puede tener dos tarifas que arranquen el mismo día.
create unique index if not exists tarifas_puesto_uidx
    on public.tarifas_puesto (puesto_trabajo_id, vigente_desde);

create index if not exists tarifas_puesto_busqueda_idx
    on public.tarifas_puesto (temporada_id, puesto_trabajo_id, vigente_desde desc);

alter table public.tarifas_puesto enable row level security;

-- Los costos sólo los ve y los toca Torre de Control y el Administrador:
-- el digitador de campo no tiene por qué ver cuánto cuesta la hora.
create policy tarifas_puesto_select on public.tarifas_puesto for select
    using ((select public.fn_es_admin()) or (select public.fn_mi_rol()) = 'TORRE_CONTROL');
create policy tarifas_puesto_insert on public.tarifas_puesto for insert
    with check ((select public.fn_es_admin()) or (select public.fn_mi_rol()) = 'TORRE_CONTROL');
create policy tarifas_puesto_update on public.tarifas_puesto for update
    using ((select public.fn_es_admin()) or (select public.fn_mi_rol()) = 'TORRE_CONTROL');
create policy tarifas_puesto_delete on public.tarifas_puesto for delete
    using ((select public.fn_es_admin()));

-- Al insertar una tarifa nueva para un puesto, se cierra automáticamente
-- la vigencia de la anterior el día antes. Así nunca hay dos tarifas
-- vigentes a la vez ni huecos entre ellas.
create or replace function public.fn_cerrar_tarifa_anterior() returns trigger
language plpgsql as $$
begin
    update public.tarifas_puesto
    set vigente_hasta = new.vigente_desde - 1
    where puesto_trabajo_id = new.puesto_trabajo_id
      and id <> new.id
      and vigente_desde < new.vigente_desde
      and (vigente_hasta is null or vigente_hasta >= new.vigente_desde);
    return new;
end;
$$;

drop trigger if exists trg_cerrar_tarifa_anterior on public.tarifas_puesto;
create trigger trg_cerrar_tarifa_anterior
after insert on public.tarifas_puesto
for each row execute function public.fn_cerrar_tarifa_anterior();

-- Las tablas tarifas_equipo y tarifas_labor de la migración 01 quedan sin
-- uso: la tarifa real va por puesto de trabajo. No se eliminan por si
-- guardaste algo, pero la app ya no las lee.


-- =====================================================================
-- PARTE C · COSTOS CALCULADOS
-- =====================================================================
-- Una labor genera DOS líneas de costo, igual que en tu notificación SAP:
-- una por el puesto del equipo (el tractor) y otra por el puesto del
-- implemento. Cada una se valoriza con su propia tarifa vigente en la
-- fecha del trabajo.
-- =====================================================================

create or replace function public.fn_tarifa_vigente(
    p_puesto_id uuid,
    p_fecha     date
) returns numeric
language sql stable as $$
    select tp.costo_hora
    from public.tarifas_puesto tp
    where tp.puesto_trabajo_id = p_puesto_id
      and p_fecha >= tp.vigente_desde
      and (tp.vigente_hasta is null or p_fecha <= tp.vigente_hasta)
    order by tp.vigente_desde desc
    limit 1
$$;

drop view if exists public.v_costos_labores;

create view public.v_costos_labores as
with lineas as (
    select
        r.id                                          as registro_id,
        r.ticket_id,
        r.fecha,
        r.temporada_id,
        -- Horas de la labor: las propias si se capturaron, si no las del
        -- horómetro (caso de una sola labor en el equipo).
        coalesce(r.horas_notificadas, h.horas_maquina) as horas,
        e.codigo                                      as equipo_codigo,
        lb.nombre                                     as labor_nombre,
        cl.nombre                                     as categoria_labor,
        ts.codigo                                     as tarea_codigo,
        t.proceso                                     as ticket_proceso,
        t.codigo                                      as ticket_codigo,
        pf.id                                         as puesto_equipo_id,
        pf.codigo                                     as puesto_equipo,
        pi_.id                                        as puesto_implemento_id,
        pi_.codigo                                    as puesto_implemento
    from public.registros r
    join public.horometros h on h.id = r.horometro_id
    join public.equipos e    on e.id = h.equipo_id
    left join public.familias_equipo fe on fe.id = e.familia_id
    left join public.puestos_trabajo pf on pf.id = fe.puesto_trabajo_id
    left join public.implementos im on im.id = r.implemento_id
    left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
    join public.labores lb   on lb.id = r.labor_id
    left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
    join public.tareas_sap ts on ts.id = r.tarea_id
    join public.tickets t    on t.id = r.ticket_id
)
select
    registro_id, ticket_id, ticket_codigo, ticket_proceso, fecha, temporada_id,
    equipo_codigo, labor_nombre, categoria_labor, tarea_codigo, horas,
    'EQUIPO'                                        as concepto,
    puesto_equipo                                   as puesto,
    public.fn_tarifa_vigente(puesto_equipo_id, fecha) as costo_hora,
    round(horas * coalesce(public.fn_tarifa_vigente(puesto_equipo_id, fecha), 0), 2) as costo
from lineas
where puesto_equipo_id is not null

union all

select
    registro_id, ticket_id, ticket_codigo, ticket_proceso, fecha, temporada_id,
    equipo_codigo, labor_nombre, categoria_labor, tarea_codigo, horas,
    'IMPLEMENTO'                                    as concepto,
    puesto_implemento                               as puesto,
    public.fn_tarifa_vigente(puesto_implemento_id, fecha) as costo_hora,
    round(horas * coalesce(public.fn_tarifa_vigente(puesto_implemento_id, fecha), 0), 2) as costo
from lineas
where puesto_implemento_id is not null;

alter view public.v_costos_labores set (security_invoker = on);

comment on view public.v_costos_labores is
'Costo por línea: horas de la labor x tarifa vigente del puesto de trabajo.
Cada labor produce una línea por el equipo y otra por el implemento.';


-- =====================================================================
-- PARTE D · NOTIFICACIONES
-- =====================================================================
-- Avisos para Torre de Control y Administrador cuando un digitador cierra
-- un ticket o lo manda a revisión. Se generan con triggers en la base, no
-- desde la app: así se registran incluso si el cambio viene de un cambio
-- masivo o del SQL Editor.
-- =====================================================================

create table if not exists public.notificaciones (
    id         bigint generated always as identity primary key,
    tipo       text not null check (tipo in ('TICKET_CERRADO', 'TICKET_REVISION', 'TICKET_REABIERTO')),
    ticket_id  uuid references public.tickets(id) on delete cascade,
    mensaje    text not null,
    actor_id   uuid references public.perfiles(id),
    created_at timestamptz not null default now()
);

create index if not exists notificaciones_fecha_idx on public.notificaciones (created_at desc);

-- Marcas de lectura por usuario: cada uno tiene su propio contador.
create table if not exists public.notificaciones_leidas (
    notificacion_id bigint not null references public.notificaciones(id) on delete cascade,
    usuario_id      uuid not null references public.perfiles(id) on delete cascade,
    leida_at        timestamptz not null default now(),
    primary key (notificacion_id, usuario_id)
);

alter table public.notificaciones enable row level security;
alter table public.notificaciones_leidas enable row level security;

-- Sólo los revisores ven las notificaciones.
create policy notificaciones_select on public.notificaciones for select
    using ((select public.fn_es_admin()) or (select public.fn_mi_rol()) = 'TORRE_CONTROL');

create policy notificaciones_leidas_select on public.notificaciones_leidas for select
    using (usuario_id = (select auth.uid()));
create policy notificaciones_leidas_insert on public.notificaciones_leidas for insert
    with check (usuario_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Trigger que las genera
-- ---------------------------------------------------------------------
create or replace function public.fn_notificar_ticket() returns trigger
language plpgsql security definer as $$
declare
    v_autor text;
begin
    select nombre into v_autor from public.perfiles where id = auth.uid();
    v_autor := coalesce(v_autor, 'Alguien');

    if new.estado = 'CERRADO' and old.estado <> 'CERRADO' then
        insert into public.notificaciones (tipo, ticket_id, mensaje, actor_id)
        values (
            'TICKET_CERRADO',
            new.id,
            v_autor || ' cerró el ticket ' || new.codigo,
            auth.uid()
        );
    end if;

    if new.estado = 'ABIERTO' and old.estado = 'CERRADO' then
        insert into public.notificaciones (tipo, ticket_id, mensaje, actor_id)
        values (
            'TICKET_REABIERTO',
            new.id,
            v_autor || ' reabrió el ticket ' || new.codigo,
            auth.uid()
        );
    end if;

    if new.proceso = 'REVISANDO' and old.proceso <> 'REVISANDO' then
        insert into public.notificaciones (tipo, ticket_id, mensaje, actor_id)
        values (
            'TICKET_REVISION',
            new.id,
            v_autor || ' envió a revisión el ticket ' || new.codigo,
            auth.uid()
        );
    end if;

    return new;
end;
$$;

drop trigger if exists trg_notificar_ticket on public.tickets;
create trigger trg_notificar_ticket
after update on public.tickets
for each row execute function public.fn_notificar_ticket();

-- ---------------------------------------------------------------------
-- Consulta y marcado
-- ---------------------------------------------------------------------
create or replace function public.fn_notificaciones_pendientes()
returns integer
language sql stable security invoker as $$
    select count(*)::integer
    from public.notificaciones n
    where not exists (
        select 1 from public.notificaciones_leidas l
        where l.notificacion_id = n.id and l.usuario_id = auth.uid()
    )
    -- Lo que uno mismo hizo no se cuenta como aviso para uno mismo.
    and coalesce(n.actor_id, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid()
$$;

create or replace function public.fn_marcar_notificaciones_leidas()
returns void
language sql security invoker as $$
    insert into public.notificaciones_leidas (notificacion_id, usuario_id)
    select n.id, auth.uid()
    from public.notificaciones n
    where not exists (
        select 1 from public.notificaciones_leidas l
        where l.notificacion_id = n.id and l.usuario_id = auth.uid()
    )
    on conflict do nothing
$$;


-- =====================================================================
-- PARTE E · LA VISTA DE LABORES MUESTRA LAS HORAS NOTIFICADAS
-- =====================================================================
-- Ahora que las horas de la labor son las que mandan el costo, Torre de
-- Control tiene que poder verlas y corregirlas desde la pantalla de
-- control de labores, sin entrar ticket por ticket.
--
-- Otra vez DROP + CREATE y no CREATE OR REPLACE: la columna nueva va
-- junto a las otras horas, no al final, y un REPLACE sólo permite
-- agregar columnas al final.
-- =====================================================================

drop view if exists public.v_labores_control;

create view public.v_labores_control as
select
    rd.id                       as detalle_id,
    r.id                        as registro_id,
    r.ticket_id,
    r.horometro_id,
    r.fecha,
    rd.lote_temporada_id,
    lo.nomenclatura             as ut,
    lo.nombre                   as lote_nombre,
    r.tarea_id,
    ts.codigo                   as tarea_codigo,
    ts.nombre                   as tarea_nombre,
    rd.ciclo,
    rd.avance_mz,
    r.labor_id,
    lb.nombre                   as labor_nombre,
    cl.nombre                   as categoria_labor,
    e.codigo                    as equipo_codigo,
    h.turno,
    h.horas_maquina,
    h.horas_hombre,
    -- Horas imputadas a ESTA labor. Si está en null se asumen las del
    -- horómetro, que es el caso de una sola labor por equipo.
    r.horas_notificadas,
    coalesce(r.horas_notificadas, h.horas_maquina) as horas_costeadas,
    o.codigo                    as operador_codigo,
    o.nombre                    as operador_nombre,
    r.implemento_id,
    im.codigo                   as implemento_codigo,
    im.nombre                   as implemento_nombre,
    pi_.codigo                  as puesto_implemento,
    pi_.operacion_sap           as operacion_implemento,
    pf.codigo                   as puesto_equipo,
    pf.operacion_sap            as operacion_equipo,
    pf.descripcion              as descripcion_equipo,
    t.codigo                    as ticket_codigo,
    t.estado                    as ticket_estado,
    t.proceso                   as ticket_proceso,
    t.departamento,
    r.comentarios,
    r.usuario_id,
    pe.nombre                   as usuario_nombre,
    (select count(*) from public.registro_detalle x where x.registro_id = r.id) as lotes_del_registro,
    r.created_at
from public.registro_detalle rd
join public.registros r          on r.id = rd.registro_id
join public.lotes_temporada l_t  on l_t.id = rd.lote_temporada_id
join public.lotes lo             on lo.id = l_t.lote_id
join public.horometros h         on h.id = r.horometro_id
join public.equipos e            on e.id = h.equipo_id
left join public.familias_equipo fe on fe.id = e.familia_id
left join public.puestos_trabajo pf on pf.id = fe.puesto_trabajo_id
left join public.operadores o    on o.id = h.operador_id
join public.labores lb           on lb.id = r.labor_id
left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
join public.tareas_sap ts        on ts.id = r.tarea_id
left join public.implementos im  on im.id = r.implemento_id
left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
left join public.perfiles pe     on pe.id = r.usuario_id
join public.tickets t            on t.id = r.ticket_id;

alter view public.v_labores_control set (security_invoker = on);


-- =====================================================================
-- PARTE F · ÍNDICES PARA LAS PANTALLAS NUEVAS
-- =====================================================================
-- La pantalla de costos filtra por rango de fechas y la campana consulta
-- las notificaciones sin leer cada minuto.
-- =====================================================================

create index if not exists registros_fecha_idx on public.registros (fecha desc);
create index if not exists notificaciones_leidas_usuario_idx
    on public.notificaciones_leidas (usuario_id);
