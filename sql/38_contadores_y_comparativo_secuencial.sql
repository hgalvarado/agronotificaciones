-- =====================================================================
-- MIGRACIÓN 38 · Comparativo secuencial y contadores de horómetro
-- =====================================================================
-- Dos cosas que son la misma cosa.
--
-- A. El comparativo estaba mal ordenado. La ventana ordenaba por
--    `fecha, created_at`, y `created_at` es el orden en que se CAPTURÓ,
--    no en que se TRABAJÓ. Cuando un equipo tiene diurno y nocturno el
--    mismo día y alguien capturó primero el nocturno, la secuencia se
--    invierte y el desfase sale disparatado. En la pantalla de Henry:
--
--      07/08 Diurno    11367 → 11375   salía -14
--      07/08 Nocturno  11375 → 11381   salía  +8
--      09/08 Diurno    11381 → 11385   salía  +6
--
--    Con el orden correcto —diurno antes que nocturno— los tres dan 0,
--    que es la verdad: la cadena calza. El desfase de esas filas era un
--    fantasma del orden de captura.
--
-- B. Cuando se avería un horómetro se cambia el tablero y el contador
--    arranca de cero. Sin contingencia, ese salto aparece como un
--    desfase de miles de horas y el mes entero se vuelve ilegible. Se
--    registra el cambio con su rango de vigencia, y la cadena se ROMPE
--    ahí de forma controlada: la fila que estrena contador no se compara
--    contra nada.
--
-- Nada de esto toca una sola lectura de horómetro. El contador de cada
-- fila se DEDUCE de su fecha contra el historial, no se copia a la fila;
-- así, corregir la fecha de un cambio recoloca solo todos los registros
-- afectados en vez de obligar a reescribirlos.
-- =====================================================================


-- =====================================================================
-- PARTE A · EL MOMENTO DE UNA JORNADA
-- =====================================================================
-- Un horómetro tiene `fecha` (un día) y `turno` (diurno o nocturno).
-- Para ordenar y para ubicarlo en el historial hace falta un instante.
--
-- El diurno arranca a las 6 y el nocturno a las 18, hora de Honduras.
-- No es una hora real de entrada —eso no se captura— sino un ancla
-- estable: lo único que tiene que cumplir es que el diurno caiga antes
-- que el nocturno del mismo día y después que el nocturno del anterior.
-- =====================================================================

create or replace function public.fn_orden_turno(p_turno public.turno_tipo)
returns smallint
language sql
immutable
as $$
    select case p_turno when 'DIURNO' then 0::smallint else 1::smallint end;
$$;

comment on function public.fn_orden_turno(public.turno_tipo) is
    'Orden de la jornada dentro del día: el diurno va antes que el nocturno.';

create or replace function public.fn_momento_jornada(
    p_fecha date,
    p_turno public.turno_tipo
) returns timestamptz
language sql
immutable
as $$
    select (p_fecha + case p_turno when 'DIURNO' then time '06:00' else time '18:00' end)
           at time zone 'America/Tegucigalpa';
$$;

comment on function public.fn_momento_jornada(date, public.turno_tipo) is
    'El instante con el que se ubica una jornada en la línea de tiempo: '
    '6 de la mañana el diurno, 6 de la tarde el nocturno, hora de Honduras.';


-- =====================================================================
-- PARTE B · EL NÚMERO DE CONTADOR EN EL CATÁLOGO DE EQUIPOS
-- =====================================================================
-- Es el contador que SAP conoce hoy. El historial guarda los anteriores;
-- esta columna es sólo el atajo para verlo y editarlo desde Catálogos.
-- =====================================================================

alter table public.equipos
    add column if not exists contador_sap text;

comment on column public.equipos.contador_sap is
    'Número de contador (horómetro físico) con el que SAP conoce al equipo hoy. '
    'Al registrar un cambio de tablero se actualiza solo desde el historial.';


-- =====================================================================
-- PARTE C · HISTORIAL DE CONTADORES
-- =====================================================================
-- Un renglón por periodo de vida de un contador. `vigente_hasta` nulo
-- significa «el que está puesto ahora».
--
-- Se guarda `contador_anterior` aunque se pueda deducir del renglón de
-- antes: cuando alguien abre el historial a los ocho meses, quiere leer
-- «se cambió el 4500 por el 11200 porque se quemó el tablero» en una
-- línea, no reconstruirlo comparando filas.
-- =====================================================================

create table if not exists public.contadores_equipo (
    id                uuid primary key default gen_random_uuid(),
    equipo_id         uuid not null references public.equipos(id) on delete cascade,
    contador          text not null,
    contador_anterior text,
    motivo            text,
    vigente_desde     timestamptz not null,
    vigente_hasta     timestamptz,
    usuario_id        uuid references public.perfiles(id),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint contador_no_vacio check (btrim(contador) <> ''),
    constraint rango_contador_valido check (vigente_hasta is null or vigente_hasta > vigente_desde)
);

create index if not exists contadores_equipo_equipo_desde_idx
    on public.contadores_equipo (equipo_id, vigente_desde);

-- Un solo contador abierto por equipo. Sin esto, dos altas seguidas
-- dejarían dos periodos vivos y la fila no sabría a cuál pertenece.
create unique index if not exists contadores_equipo_uno_abierto_idx
    on public.contadores_equipo (equipo_id)
    where vigente_hasta is null;

comment on table public.contadores_equipo is
    'Historial de contadores (horómetros físicos) de cada equipo. Un renglón por '
    'periodo de vigencia; `vigente_hasta` nulo es el contador actual.';


-- ---------------------------------------------------------------------
-- Sin traslapes
-- ---------------------------------------------------------------------
-- Se valida con disparador y no con una restricción de exclusión para no
-- depender de la extensión `btree_gist`, que no está garantizada en todos
-- los proyectos de Supabase. El efecto es el mismo.
-- ---------------------------------------------------------------------

create or replace function public.fn_contador_sin_traslape()
returns trigger
language plpgsql
as $$
declare
    v_choque text;
begin
    select c.contador into v_choque
    from public.contadores_equipo c
    where c.equipo_id = new.equipo_id
      and c.id <> new.id
      and tstzrange(c.vigente_desde, c.vigente_hasta, '[)')
          && tstzrange(new.vigente_desde, new.vigente_hasta, '[)')
    limit 1;

    if v_choque is not null then
        raise exception
            'El periodo se traslapa con el contador % del mismo equipo. Ajusta las fechas.',
            v_choque
            using errcode = '23505';
    end if;

    new.updated_at := now();
    return new;
end
$$;

drop trigger if exists trg_contador_sin_traslape on public.contadores_equipo;
create trigger trg_contador_sin_traslape
    before insert or update on public.contadores_equipo
    for each row execute function public.fn_contador_sin_traslape();


-- ---------------------------------------------------------------------
-- El catálogo de equipos refleja el contador vigente
-- ---------------------------------------------------------------------
-- Después de cualquier cambio en el historial, `equipos.contador_sap`
-- vuelve a ser el del periodo abierto. Así no hay dos verdades: la
-- columna es una proyección, no un dato que se edite por su cuenta.
-- ---------------------------------------------------------------------

create or replace function public.fn_sincronizar_contador_equipo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_equipo uuid := coalesce(new.equipo_id, old.equipo_id);
begin
    update public.equipos e
    set contador_sap = (
        select c.contador
        from public.contadores_equipo c
        where c.equipo_id = v_equipo and c.vigente_hasta is null
        order by c.vigente_desde desc
        limit 1
    )
    where e.id = v_equipo;

    return null;
end
$$;

drop trigger if exists trg_sincronizar_contador_equipo on public.contadores_equipo;
create trigger trg_sincronizar_contador_equipo
    after insert or update or delete on public.contadores_equipo
    for each row execute function public.fn_sincronizar_contador_equipo();


-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.contadores_equipo enable row level security;

drop policy if exists contadores_equipo_select on public.contadores_equipo;
create policy contadores_equipo_select on public.contadores_equipo for select
    using ((select auth.uid()) is not null);

drop policy if exists contadores_equipo_insert on public.contadores_equipo;
create policy contadores_equipo_insert on public.contadores_equipo for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));

drop policy if exists contadores_equipo_update on public.contadores_equipo;
create policy contadores_equipo_update on public.contadores_equipo for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists contadores_equipo_delete on public.contadores_equipo;
create policy contadores_equipo_delete on public.contadores_equipo for delete
    using ((select public.fn_tiene_permiso('catalogos','eliminar')));

grant select, insert, update, delete on public.contadores_equipo to authenticated;


-- =====================================================================
-- PARTE D · REGISTRAR UN CAMBIO DE TABLERO
-- =====================================================================
-- Un cambio de tablero son dos hechos —se cerró un contador y empezó
-- otro— y dejarlos en manos de dos inserts sueltos es como se llega a un
-- historial con huecos. Esta función los hace juntos:
--
--   1. Si el equipo nunca tuvo historial, se le abre uno retroactivo
--      para el contador viejo que empieza en su PRIMERA jornada. Sin
--      esto, todo lo capturado antes del cambio se quedaría sin contador
--      y la cadena del comparativo se partiría en el sitio equivocado.
--   2. Se cierra el periodo abierto justo en el instante del cambio.
--   3. Se abre el periodo del contador nuevo.
--
-- El instante del cambio lo elige el usuario: es «desde cuándo aplica».
-- =====================================================================

create or replace function public.fn_cambiar_contador(
    p_equipo_id       uuid,
    p_contador_nuevo  text,
    p_desde           timestamptz,
    p_motivo          text default null,
    p_contador_viejo  text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_abierto   public.contadores_equipo;
    v_viejo     text;
    v_primera   timestamptz;
    v_nuevo_id  uuid;
begin
    if not (public.fn_tiene_permiso('catalogos','crear')
            or public.fn_tiene_permiso('catalogos','editar')) then
        raise exception 'No tienes permiso para registrar cambios de contador.'
            using errcode = '42501';
    end if;

    if p_equipo_id is null then
        raise exception 'Elige el equipo.' using errcode = '22023';
    end if;
    if p_contador_nuevo is null or btrim(p_contador_nuevo) = '' then
        raise exception 'Escribe el número del contador nuevo.' using errcode = '22023';
    end if;
    if p_desde is null then
        raise exception 'Elige desde cuándo aplica el contador nuevo.' using errcode = '22023';
    end if;

    select * into v_abierto
    from public.contadores_equipo
    where equipo_id = p_equipo_id and vigente_hasta is null
    order by vigente_desde desc
    limit 1;

    -- 1 · Historial retroactivo del contador viejo.
    if v_abierto.id is null then
        v_viejo := coalesce(
            nullif(btrim(p_contador_viejo), ''),
            (select nullif(btrim(contador_sap), '') from public.equipos where id = p_equipo_id)
        );

        if v_viejo is not null then
            select min(public.fn_momento_jornada(h.fecha, h.turno)) into v_primera
            from public.horometros h
            where h.equipo_id = p_equipo_id;

            insert into public.contadores_equipo
                (equipo_id, contador, vigente_desde, vigente_hasta, motivo, usuario_id)
            values
                (p_equipo_id, v_viejo,
                 least(coalesce(v_primera, p_desde), p_desde), p_desde,
                 'Contador original, registrado al documentar el primer cambio.',
                 (select auth.uid()))
            returning * into v_abierto;
        end if;
    else
        -- 2 · Se cierra el que estaba puesto.
        if p_desde <= v_abierto.vigente_desde then
            raise exception
                'El contador % empezó el %. El cambio tiene que ser posterior.',
                v_abierto.contador, v_abierto.vigente_desde
                using errcode = '22023';
        end if;

        update public.contadores_equipo
        set vigente_hasta = p_desde
        where id = v_abierto.id;
    end if;

    -- 3 · Se abre el nuevo.
    insert into public.contadores_equipo
        (equipo_id, contador, contador_anterior, motivo, vigente_desde, usuario_id)
    values
        (p_equipo_id, btrim(p_contador_nuevo),
         coalesce(nullif(btrim(p_contador_viejo), ''), v_abierto.contador),
         nullif(btrim(p_motivo), ''), p_desde, (select auth.uid()))
    returning id into v_nuevo_id;

    return v_nuevo_id;
end
$$;

comment on function public.fn_cambiar_contador(uuid, text, timestamptz, text, text) is
    'Registra un cambio de tablero: cierra el contador vigente en el instante indicado '
    'y abre el nuevo. Si el equipo no tenía historial, crea el del contador viejo hacia atrás.';

grant execute on function public.fn_cambiar_contador(uuid, text, timestamptz, text, text)
    to authenticated;


-- =====================================================================
-- PARTE E · LA VISTA DEL HISTORIAL, CON NOMBRES
-- =====================================================================

create or replace view public.v_contadores_equipo as
select
    c.id,
    c.equipo_id,
    e.codigo                as equipo_codigo,
    e.nombre                as equipo_nombre,
    c.contador,
    c.contador_anterior,
    c.motivo,
    c.vigente_desde,
    c.vigente_hasta,
    (c.vigente_hasta is null) as vigente,
    c.usuario_id,
    pe.nombre               as usuario_nombre,
    c.created_at,
    -- Cuántas jornadas quedan bajo este contador. Es lo que contesta
    -- «¿de verdad puedo mover esta fecha?» antes de moverla.
    (select count(*)
     from public.horometros h
     where h.equipo_id = c.equipo_id
       and public.fn_momento_jornada(h.fecha, h.turno) >= c.vigente_desde
       and (c.vigente_hasta is null
            or public.fn_momento_jornada(h.fecha, h.turno) < c.vigente_hasta)
    ) as jornadas
from public.contadores_equipo c
join public.equipos e        on e.id = c.equipo_id
left join public.perfiles pe on pe.id = c.usuario_id;

alter view public.v_contadores_equipo set (security_invoker = on);


-- =====================================================================
-- PARTE F · EL COMPARATIVO, AHORA SÍ SECUENCIAL
-- =====================================================================
-- Tres cambios sobre la versión anterior:
--
--   1. El orden dentro del día lo pone el TURNO, no `created_at`. Ése
--      era el error de fondo.
--   2. La partición incluye el contador: al estrenar tablero la cadena
--      empieza de cero en vez de arrastrar un salto de miles de horas.
--   3. Se exponen `contador_sap` e `inicio_contador` para que la pantalla
--      pueda explicar POR QUÉ una fila no tiene comparativo — que es
--      distinto de que la cadena calce.
--
-- `create or replace view` sólo admite añadir columnas al final, y eso
-- es justo lo que se hace: las expresiones de las columnas que ya
-- existían sí se pueden cambiar.
-- =====================================================================

create or replace view public.v_horometros_control as
with base as (
    select
        h.*,
        public.fn_momento_jornada(h.fecha, h.turno) as momento,
        c.id       as contador_id,
        c.contador as contador_sap
    from public.horometros h
    left join public.contadores_equipo c
           on c.equipo_id = h.equipo_id
          and public.fn_momento_jornada(h.fecha, h.turno) >= c.vigente_desde
          and (c.vigente_hasta is null
               or public.fn_momento_jornada(h.fecha, h.turno) < c.vigente_hasta)
)
select
    b.id,
    b.ticket_id,
    b.fecha,
    b.turno,
    b.equipo_id,
    e.codigo                as equipo_codigo,
    e.nombre                as equipo_nombre,
    fe.nombre               as familia,
    b.horometro_inicial,
    b.horometro_final,
    b.horas_maquina,
    b.horas_hombre,
    b.operador_id,
    o.codigo                as operador_codigo,
    o.nombre                as operador_nombre,
    t.codigo                as ticket_codigo,
    t.estado                as ticket_estado,
    t.proceso               as ticket_proceso,
    t.departamento,
    b.comentario,
    b.usuario_id,
    b.created_at,
    lag(b.horometro_final) over w as horometro_final_anterior,
    -- NULL cuando no hay contra qué comparar: o es la primera jornada del
    -- equipo, o es la primera con este contador.
    b.horometro_inicial - lag(b.horometro_final) over w as comparativo,
    pe.nombre               as usuario_nombre,
    b.contador_sap,
    -- Distingue «no hay anterior porque estrena tablero» de «no hay
    -- anterior porque es su primera jornada». La pantalla lo dice con
    -- palabras distintas, y no es lo mismo para quien cuadra el mes.
    (b.contador_id is not null
     and lag(b.id) over w is null
     and exists (select 1
                 from public.horometros h2
                 where h2.equipo_id = b.equipo_id
                   and public.fn_momento_jornada(h2.fecha, h2.turno) < b.momento)
    ) as inicio_contador
from base b
join public.equipos e         on e.id = b.equipo_id
left join public.familias_equipo fe on fe.id = e.familia_id
left join public.operadores o on o.id = b.operador_id
join public.tickets t         on t.id = b.ticket_id
left join public.perfiles pe  on pe.id = b.usuario_id
window w as (
    partition by b.equipo_id, b.contador_id
    order by b.fecha, public.fn_orden_turno(b.turno), b.created_at
);

alter view public.v_horometros_control set (security_invoker = on);

comment on view public.v_horometros_control is
    'Control de horómetros. El comparativo compara el horómetro inicial de cada jornada '
    'contra el final de la jornada ANTERIOR del mismo equipo Y del mismo contador, en orden '
    'de trabajo (fecha, luego diurno, luego nocturno). Positivo = horas sin notificar; '
    'negativo = traslape. Nulo = primera jornada del equipo o estreno de contador.';
