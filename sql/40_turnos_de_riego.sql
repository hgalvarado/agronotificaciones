-- =====================================================================
-- MIGRACIÓN 40 · Turnos de riego
-- =====================================================================
-- Un «turno de riego» es una jornada de riego planificada: UNA fecha de
-- siembra, UN plan nutricional, UNA zona, y los lotes que se riegan con
-- ese turno. Cabecera y detalle, como la nota de entrega de la que sale.
--
-- Por qué cabecera y detalle y no una tabla plana: el plan nutricional,
-- la estación y la orden SAP son del turno completo, no de cada lote.
-- En plano habría que repetirlos en cada renglón, y el día que cambie la
-- orden SAP habría que acordarse de cambiarla en los cinco.
--
-- Lo que esta migración NO hace: guardar el DDT. Es «hoy menos la fecha
-- de siembra», o sea que cambia todos los días; guardarlo sería tener un
-- número viejo en cuanto den las doce. Se calcula en la vista, con
-- `fn_hoy()` —hora de Honduras— que trajo la migración 37.
-- =====================================================================


-- =====================================================================
-- PARTE A · CATÁLOGO DE PLANES NUTRICIONALES
-- =====================================================================
-- Las variedades reutilizan su catálogo (migración 26). Esto es lo único
-- que no existía.
-- =====================================================================

create table if not exists public.planes_nutricionales (
    id          uuid primary key default gen_random_uuid(),
    codigo      text unique,
    nombre      text not null unique,
    descripcion text,
    activo      boolean not null default true,
    created_at  timestamptz not null default now()
);

create index if not exists planes_nutricionales_activo_idx
    on public.planes_nutricionales (activo) where activo;

comment on table public.planes_nutricionales is
    'Planes de nutrición que se aplican en un turno de riego (p. ej. «YHD Manchester FL»).';

alter table public.planes_nutricionales enable row level security;

drop policy if exists planes_nutricionales_select on public.planes_nutricionales;
create policy planes_nutricionales_select on public.planes_nutricionales for select
    using ((select auth.uid()) is not null);

drop policy if exists planes_nutricionales_insert on public.planes_nutricionales;
create policy planes_nutricionales_insert on public.planes_nutricionales for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));

drop policy if exists planes_nutricionales_update on public.planes_nutricionales;
create policy planes_nutricionales_update on public.planes_nutricionales for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists planes_nutricionales_delete on public.planes_nutricionales;
create policy planes_nutricionales_delete on public.planes_nutricionales for delete
    using ((select public.fn_tiene_permiso('catalogos','eliminar')));

grant select, insert, update, delete on public.planes_nutricionales to authenticated;


-- =====================================================================
-- PARTE B · LISTAS CERRADAS
-- =====================================================================
-- Enum y no tabla de catálogo: son tres valores que no los cambia nadie
-- desde la interfaz, y como enum la base rechaza un cuarto valor mal
-- escrito en vez de guardarlo en silencio.
-- =====================================================================

do $$ begin
    create type public.fuente_agua as enum ('RIO', 'POZO', 'RIO_Y_POZO');
exception when duplicate_object then null;
end $$;

do $$ begin
    create type public.estado_turno_riego as enum ('PENDIENTE_CREAR', 'CREANDO', 'ORDEN_CREADA');
exception when duplicate_object then null;
end $$;


-- =====================================================================
-- PARTE C · CABECERA
-- =====================================================================
-- «Un turno = 1 fecha, 1 plan, 1 zona.»
--
-- `responsable` se copia de la zona al guardar (disparador más abajo) en
-- vez de leerse siempre con un join: el responsable de una zona cambia, y
-- el turno de marzo tiene que seguir diciendo quién era el responsable en
-- marzo. Es el mismo criterio de las tarifas con vigencia.
-- =====================================================================

create table if not exists public.turnos_riego (
    id                   uuid primary key default gen_random_uuid(),
    temporada_id         uuid not null references public.temporadas(id),
    ciclo                smallint not null default 1 check (ciclo between 1 and 3),
    fecha_siembra        date not null,
    zona_id              uuid not null references public.zonas(id),
    turno                text not null,
    plan_nutricional_id  uuid references public.planes_nutricionales(id),
    responsable          text,
    estacion_riego       text,
    fuente_agua          public.fuente_agua,
    orden_sap            text,
    estado               public.estado_turno_riego not null default 'PENDIENTE_CREAR',
    comentarios          text,
    usuario_id           uuid references public.perfiles(id),
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    constraint turno_no_vacio check (btrim(turno) <> ''),
    -- El mismo turno, la misma fecha y la misma zona son el mismo turno.
    -- Sin esto, dos capturas en paralelo lo duplican y el área sembrada
    -- se cuenta dos veces contra el plan.
    unique (temporada_id, ciclo, fecha_siembra, zona_id, turno)
);

create index if not exists turnos_riego_temporada_idx
    on public.turnos_riego (temporada_id, fecha_siembra);
create index if not exists turnos_riego_zona_idx on public.turnos_riego (zona_id);

comment on table public.turnos_riego is
    'Cabecera del turno de riego: una fecha de siembra, un plan nutricional y una zona.';


-- =====================================================================
-- PARTE D · DETALLE (LOTES)
-- =====================================================================

create table if not exists public.turnos_riego_detalle (
    id                 uuid primary key default gen_random_uuid(),
    turno_id           uuid not null references public.turnos_riego(id) on delete cascade,
    lote_temporada_id  uuid not null references public.lotes_temporada(id),
    area_turno         numeric(10,2) not null check (area_turno > 0),
    variedad_id        uuid references public.variedades(id),
    comentarios        text,
    created_at         timestamptz not null default now(),
    -- Un lote no se riega dos veces en el mismo turno: sería sumar su
    -- área dos veces contra el plan de siembra.
    unique (turno_id, lote_temporada_id)
);

create index if not exists turnos_riego_detalle_turno_idx
    on public.turnos_riego_detalle (turno_id);
create index if not exists turnos_riego_detalle_lote_idx
    on public.turnos_riego_detalle (lote_temporada_id);

comment on table public.turnos_riego_detalle is
    'Lotes de un turno de riego, con el área que se riega y su variedad.';


-- =====================================================================
-- PARTE E · EL RESPONSABLE SALE DE LA ZONA
-- =====================================================================
-- «Responsable (Auto-asignado basado en la Zona).» Se copia al insertar
-- y cuando cambia la zona, pero se puede corregir a mano: un turno lo
-- puede atender un suplente sin que eso cambie el catálogo de zonas.
-- =====================================================================

create or replace function public.fn_responsable_del_turno()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp as $$
begin
    if new.responsable is null or btrim(new.responsable) = ''
       or (tg_op = 'UPDATE' and new.zona_id is distinct from old.zona_id
           and new.responsable is not distinct from old.responsable) then
        select z.responsable into new.responsable
        from public.zonas z where z.id = new.zona_id;
    end if;

    new.updated_at := now();
    return new;
end
$$;

drop trigger if exists trg_responsable_del_turno on public.turnos_riego;
create trigger trg_responsable_del_turno
    before insert or update on public.turnos_riego
    for each row execute function public.fn_responsable_del_turno();


-- =====================================================================
-- PARTE F · EL ÁREA NO PUEDE PASARSE DEL LOTE
-- =====================================================================
-- «La sumatoria del Área Turno ingresada para un lote no debe exceder su
--  área en el Plan de Siembra (si no se ha sembrado totalmente) o su área
--  de Siembra Real (si está completado).»
--
-- O sea: el tope es lo sembrado DE VERDAD cuando ya se terminó de
-- sembrar, y lo PLANIFICADO mientras tanto. La diferencia importa: regar
-- contra un plan que no se cumplió sería regar tierra vacía.
--
-- «Completado» se define como lo real alcanzando el plan. Si no hay plan
-- —un lote que se sembró sin planificarse— manda lo real; si no hay ni
-- plan ni siembra, manda el área neta del lote, que es el último dato
-- duro que queda antes de no tener ninguno.
-- =====================================================================

create or replace function public.fn_area_regable(p_lote_temporada_id uuid)
returns numeric
language sql
stable
set search_path = public, pg_temp as $$
    with p as (
        select coalesce(sum(ps.area_plan), 0) as plan
        from public.planes_siembra ps
        where ps.lote_temporada_id = p_lote_temporada_id
    ),
    s as (
        select coalesce(sum(si.avance_mz), 0) as real_
        from public.siembras si
        where si.lote_temporada_id = p_lote_temporada_id
    ),
    n as (
        select coalesce(lt.area_neta, 0) as neta
        from public.lotes_temporada lt
        where lt.id = p_lote_temporada_id
    )
    select case
        when s.real_ > 0 and s.real_ >= p.plan then s.real_   -- sembrado completo
        when p.plan > 0                        then p.plan    -- todavía en plan
        when s.real_ > 0                       then s.real_   -- sembrado sin plan
        else n.neta
    end
    from p, s, n;
$$;

comment on function public.fn_area_regable(uuid) is
    'Cuántas manzanas de un lote se pueden repartir entre turnos de riego: lo sembrado '
    'si ya se terminó de sembrar, lo planificado mientras tanto.';

grant execute on function public.fn_area_regable(uuid) to authenticated;


create or replace function public.fn_validar_area_turno()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp as $$
declare
    v_tope      numeric;
    v_asignada  numeric;
    v_lote      text;
begin
    v_tope := public.fn_area_regable(new.lote_temporada_id);

    -- Lo ya repartido en OTROS turnos, más lo que entra ahora. Se excluye
    -- la propia fila para que corregir 8.99 a 9.00 no choque consigo misma.
    select coalesce(sum(d.area_turno), 0) into v_asignada
    from public.turnos_riego_detalle d
    where d.lote_temporada_id = new.lote_temporada_id
      and d.id <> new.id;

    if v_tope > 0 and (v_asignada + new.area_turno) > v_tope + 0.005 then
        select lo.nomenclatura into v_lote
        from public.lotes_temporada lt
        join public.lotes lo on lo.id = lt.lote_id
        where lt.id = new.lote_temporada_id;

        raise exception
            'El lote % sólo tiene % mz disponibles y ya hay % mz en otros turnos: no caben % mz más.',
            coalesce(v_lote, '?'), round(v_tope, 2), round(v_asignada, 2), round(new.area_turno, 2)
            using errcode = '23514';
    end if;

    return new;
end
$$;

drop trigger if exists trg_validar_area_turno on public.turnos_riego_detalle;
create trigger trg_validar_area_turno
    before insert or update of area_turno, lote_temporada_id
    on public.turnos_riego_detalle
    for each row execute function public.fn_validar_area_turno();


-- =====================================================================
-- PARTE G · RLS
-- =====================================================================

alter table public.turnos_riego enable row level security;
alter table public.turnos_riego_detalle enable row level security;

drop policy if exists turnos_riego_select on public.turnos_riego;
create policy turnos_riego_select on public.turnos_riego for select
    using ((select public.fn_tiene_permiso('turnos_riego','ver')));

drop policy if exists turnos_riego_insert on public.turnos_riego;
create policy turnos_riego_insert on public.turnos_riego for insert
    with check ((select public.fn_tiene_permiso('turnos_riego','crear')));

drop policy if exists turnos_riego_update on public.turnos_riego;
create policy turnos_riego_update on public.turnos_riego for update
    using ((select public.fn_tiene_permiso('turnos_riego','editar')));

drop policy if exists turnos_riego_delete on public.turnos_riego;
create policy turnos_riego_delete on public.turnos_riego for delete
    using ((select public.fn_tiene_permiso('turnos_riego','eliminar')));

-- El detalle hereda el permiso de su cabecera: quien puede editar el
-- turno puede añadirle y quitarle lotes. Lo contrario —permisos propios
-- para el detalle— dejaría turnos que se pueden editar pero cuyos lotes
-- no, que no es una situación que nadie quiera explicar.
drop policy if exists turnos_riego_detalle_select on public.turnos_riego_detalle;
create policy turnos_riego_detalle_select on public.turnos_riego_detalle for select
    using ((select public.fn_tiene_permiso('turnos_riego','ver')));

drop policy if exists turnos_riego_detalle_insert on public.turnos_riego_detalle;
create policy turnos_riego_detalle_insert on public.turnos_riego_detalle for insert
    with check ((select public.fn_tiene_permiso('turnos_riego','crear'))
             or (select public.fn_tiene_permiso('turnos_riego','editar')));

drop policy if exists turnos_riego_detalle_update on public.turnos_riego_detalle;
create policy turnos_riego_detalle_update on public.turnos_riego_detalle for update
    using ((select public.fn_tiene_permiso('turnos_riego','editar')));

drop policy if exists turnos_riego_detalle_delete on public.turnos_riego_detalle;
create policy turnos_riego_detalle_delete on public.turnos_riego_detalle for delete
    using ((select public.fn_tiene_permiso('turnos_riego','editar'))
        or (select public.fn_tiene_permiso('turnos_riego','eliminar')));

grant select, insert, update, delete on public.turnos_riego to authenticated;
grant select, insert, update, delete on public.turnos_riego_detalle to authenticated;


-- =====================================================================
-- PARTE H · LA VISTA QUE LEE LA PANTALLA
-- =====================================================================
-- Una fila por LOTE, que es como se captura y como se exporta: la
-- cabecera se repite. El DDT se calcula aquí, contra el día de Honduras.
-- =====================================================================

create or replace view public.v_turnos_riego as
select
    d.id                        as detalle_id,
    t.id                        as turno_id,
    t.temporada_id,
    tm.nombre                   as temporada_nombre,
    t.ciclo,
    t.fecha_siembra,
    t.zona_id,
    z.nombre                    as zona,
    t.turno,
    t.plan_nutricional_id,
    pn.nombre                   as plan_nutricional,
    t.responsable,
    t.estacion_riego,
    t.fuente_agua,
    t.orden_sap,
    t.estado,
    t.comentarios               as turno_comentarios,
    d.lote_temporada_id,
    lo.nomenclatura             as ut,
    lo.nombre                   as nomenclatura,
    d.area_turno,
    d.variedad_id,
    v.nombre                    as variedad,
    d.comentarios               as detalle_comentarios,
    -- Días desde la siembra, en hora de Honduras. Negativo mientras la
    -- siembra esté por delante: eso es lo que se ve en el Excel de campo.
    (public.fn_hoy() - t.fecha_siembra)::integer as ddt_actual,
    -- Cuánto le queda al lote sin repartir. Es la respuesta a «¿puedo
    -- meterle otro turno?» sin tener que ir a mirar el plan de siembra.
    public.fn_area_regable(d.lote_temporada_id) as area_disponible_total,
    t.usuario_id,
    pe.nombre                   as usuario_nombre,
    t.created_at
from public.turnos_riego_detalle d
join public.turnos_riego t      on t.id = d.turno_id
join public.temporadas tm       on tm.id = t.temporada_id
join public.zonas z             on z.id = t.zona_id
left join public.planes_nutricionales pn on pn.id = t.plan_nutricional_id
join public.lotes_temporada lt  on lt.id = d.lote_temporada_id
join public.lotes lo            on lo.id = lt.lote_id
left join public.variedades v   on v.id = d.variedad_id
left join public.perfiles pe    on pe.id = t.usuario_id;

alter view public.v_turnos_riego set (security_invoker = on);

comment on view public.v_turnos_riego is
    'Turnos de riego, una fila por lote. El DDT se calcula al vuelo contra el día de Honduras: '
    'guardarlo sería tener un número viejo en cuanto den las doce.';


-- =====================================================================
-- PARTE I · GUARDAR CABECERA Y DETALLE DE UNA VEZ
-- =====================================================================
-- Un turno sin lotes no es un turno, y un turno con la mitad de sus
-- lotes es peor que ninguno: el área contra el plan sale mal. Por eso se
-- guarda entero o no se guarda.
--
-- `p_lotes` llega como JSON —[{lote_temporada_id, area_turno, variedad_id}]—
-- en vez de como tres arreglos paralelos: con arreglos, una lista más
-- corta que otra desplaza las áreas un renglón y nadie se entera.
-- =====================================================================

create or replace function public.fn_guardar_turno_riego(
    p_turno_id            uuid,
    p_temporada_id        uuid,
    p_ciclo               smallint,
    p_fecha_siembra       date,
    p_zona_id             uuid,
    p_turno               text,
    p_plan_nutricional_id uuid,
    p_estacion_riego      text,
    p_fuente_agua         public.fuente_agua,
    p_orden_sap           text,
    p_estado              public.estado_turno_riego,
    p_responsable         text,
    p_comentarios         text,
    p_lotes               jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp as $$
declare
    v_id uuid;
    v_n  integer;
begin
    if p_lotes is null or jsonb_array_length(p_lotes) = 0 then
        raise exception 'Un turno tiene que llevar al menos un lote.' using errcode = '22023';
    end if;

    if p_turno_id is null then
        insert into public.turnos_riego
            (temporada_id, ciclo, fecha_siembra, zona_id, turno, plan_nutricional_id,
             responsable, estacion_riego, fuente_agua, orden_sap, estado, comentarios, usuario_id)
        values
            (p_temporada_id, coalesce(p_ciclo, 1), p_fecha_siembra, p_zona_id, btrim(p_turno),
             p_plan_nutricional_id, nullif(btrim(p_responsable), ''), nullif(btrim(p_estacion_riego), ''),
             p_fuente_agua, nullif(btrim(p_orden_sap), ''), coalesce(p_estado, 'PENDIENTE_CREAR'),
             nullif(btrim(p_comentarios), ''), (select auth.uid()))
        returning id into v_id;
    else
        update public.turnos_riego
        set temporada_id        = p_temporada_id,
            ciclo               = coalesce(p_ciclo, 1),
            fecha_siembra       = p_fecha_siembra,
            zona_id             = p_zona_id,
            turno               = btrim(p_turno),
            plan_nutricional_id = p_plan_nutricional_id,
            responsable         = nullif(btrim(p_responsable), ''),
            estacion_riego      = nullif(btrim(p_estacion_riego), ''),
            fuente_agua         = p_fuente_agua,
            orden_sap           = nullif(btrim(p_orden_sap), ''),
            estado              = coalesce(p_estado, estado),
            comentarios         = nullif(btrim(p_comentarios), '')
        where id = p_turno_id
        returning id into v_id;

        if v_id is null then
            raise exception 'El turno no existe o no tienes permiso para cambiarlo.'
                using errcode = '42501';
        end if;

        -- Se reemplaza el detalle completo. Diferenciar altas, bajas y
        -- cambios desde el navegador es la clase de código que un día
        -- deja un lote huérfano y descuadra el área.
        delete from public.turnos_riego_detalle where turno_id = v_id;
    end if;

    insert into public.turnos_riego_detalle (turno_id, lote_temporada_id, area_turno, variedad_id, comentarios)
    select
        v_id,
        (x->>'lote_temporada_id')::uuid,
        (x->>'area_turno')::numeric,
        nullif(x->>'variedad_id', '')::uuid,
        nullif(btrim(coalesce(x->>'comentarios', '')), '')
    from jsonb_array_elements(p_lotes) as x;

    get diagnostics v_n = row_count;
    if v_n = 0 then
        raise exception 'Un turno tiene que llevar al menos un lote.' using errcode = '22023';
    end if;

    return v_id;
end
$$;

comment on function public.fn_guardar_turno_riego is
    'Guarda cabecera y lotes de un turno de riego en una sola transacción. El detalle se '
    'reemplaza entero: medio turno descuadra el área contra el plan de siembra.';

grant execute on function public.fn_guardar_turno_riego(
    uuid, uuid, smallint, date, uuid, text, uuid, text,
    public.fuente_agua, text, public.estado_turno_riego, text, text, jsonb
) to authenticated;


-- =====================================================================
-- PARTE J · LOS LOTES QUE SE PUEDEN REGAR, CON SU SALDO
-- =====================================================================
-- Lo que necesita el formulario para no dejar pasarse: por lote, cuánto
-- se puede repartir y cuánto queda libre.
-- =====================================================================

create or replace function public.fn_lotes_regables(
    p_temporada_id uuid,
    p_zona_id      uuid default null,
    p_turno_id     uuid default null
) returns table (
    lote_temporada_id uuid,
    ut                text,
    lote_nombre       text,
    zona              text,
    area_total        numeric,
    area_asignada     numeric,
    area_disponible   numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp as $$
    select
        lt.id,
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        public.fn_area_regable(lt.id) as area_total,
        coalesce(a.asignada, 0)       as area_asignada,
        greatest(public.fn_area_regable(lt.id) - coalesce(a.asignada, 0), 0) as area_disponible
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    left join public.zonas z on z.id = lt.zona_id
    left join lateral (
        -- Lo repartido en OTROS turnos. Al editar un turno, lo suyo no
        -- cuenta: si no, corregir 8.99 a 9.00 parecería un exceso.
        select sum(d.area_turno) as asignada
        from public.turnos_riego_detalle d
        where d.lote_temporada_id = lt.id
          and (p_turno_id is null or d.turno_id <> p_turno_id)
    ) a on true
    where lt.temporada_id = p_temporada_id
      and lt.activo
      and (p_zona_id is null or lt.zona_id = p_zona_id)
    order by lo.nomenclatura;
$$;

grant execute on function public.fn_lotes_regables(uuid, uuid, uuid) to authenticated;


-- =====================================================================
-- PARTE K · LA PANTALLA EN EL CATÁLOGO DE PERMISOS
-- =====================================================================

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('turnos_riego', 'Turnos de riego', 'Turnos de riego por zona y plan nutricional',
     '/avances/turnos-riego', 56,
     array['ver','crear','editar','eliminar','descargar'])
on conflict (codigo) do update
set nombre      = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta        = excluded.ruta,
    orden       = excluded.orden,
    acciones    = excluded.acciones;

-- Torre de Control y Digitador ven y capturan riego, igual que el resto
-- de la operación. El Administrador no se siembra: `fn_tiene_permiso` ya
-- le da todo.
insert into public.permisos (rol_id, recurso, accion)
select r.id, 'turnos_riego', a.accion
from public.roles r
cross join unnest(array['ver','crear','editar','descargar']) as a(accion)
where r.codigo in ('TORRE_CONTROL', 'DIGITADOR')
on conflict (rol_id, recurso, accion) do nothing;

insert into public.permisos (rol_id, recurso, accion)
select r.id, 'turnos_riego', 'eliminar'
from public.roles r
where r.codigo = 'TORRE_CONTROL'
on conflict (rol_id, recurso, accion) do nothing;
