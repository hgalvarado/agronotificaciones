-- =====================================================================
-- AGRONOTIFICACIONES · Migración 14
-- Correcciones de captura: permisos coherentes, la fecha manda el ticket,
-- y las horas de las labores no pueden pasarse del horómetro.
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01–13.
-- =====================================================================


-- =====================================================================
-- PARTE A · LA RAÍZ DE «NO SE PUDO GUARDAR»
-- =====================================================================
-- Todas las policies de UPDATE traían su excepción para Administrador y
-- Torre de Control. Las de INSERT, NO: exigían que el ticket fuera del
-- usuario y estuviera abierto, sin excepción para nadie.
--
-- El resultado, que es exactamente lo que él reportó:
--
--   · El Administrador no podía agregar ni corregir una labor en el
--     ticket de otro usuario: el UPDATE del registro pasaba, pero el
--     INSERT de las líneas de detalle se rechazaba. «No se pudo guardar».
--
--   · Al editar una labor, la pantalla borra el detalle y lo vuelve a
--     insertar. El DELETE de `registro_detalle` era SÓLO de Administrador,
--     así que a un Digitador no le borraba nada — y sin error, porque RLS
--     no falla: simplemente no encuentra filas que borrar. Después el
--     INSERT sí entraba, y el lote quedaba DUPLICADO en vez de quitado.
--
-- Se arregla de una vez la incoherencia entera: quien puede EDITAR una
-- cosa puede también insertarle y quitarle líneas.
-- =====================================================================

-- Un solo lugar para la regla, para que no se vuelvan a desalinear.
create or replace function public.fn_puede_capturar_en_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer as $$
    select
        public.fn_es_admin()
        or public.fn_mi_rol() = 'TORRE_CONTROL'
        or exists (
            select 1 from public.tickets t
            where t.id = p_ticket_id
              and t.usuario_id = auth.uid()
              and t.estado = 'ABIERTO'
        )
$$;

comment on function public.fn_puede_capturar_en_ticket is
'Quién puede agregar, editar o quitar líneas de un ticket: el Administrador
y Torre de Control siempre; el dueño sólo mientras esté abierto.';

-- ------------------------------- HORÓMETROS ---------------------------
drop policy if exists horometros_insert on public.horometros;
create policy horometros_insert on public.horometros for insert
    with check ((select public.fn_puede_capturar_en_ticket(ticket_id)));

drop policy if exists horometros_update on public.horometros;
create policy horometros_update on public.horometros for update
    using ((select public.fn_puede_capturar_en_ticket(ticket_id)))
    with check ((select public.fn_puede_capturar_en_ticket(ticket_id)));

-- ------------------------------- REGISTROS ----------------------------
drop policy if exists registros_insert on public.registros;
create policy registros_insert on public.registros for insert
    with check ((select public.fn_puede_capturar_en_ticket(ticket_id)));

drop policy if exists registros_update on public.registros;
create policy registros_update on public.registros for update
    using ((select public.fn_puede_capturar_en_ticket(ticket_id)))
    with check ((select public.fn_puede_capturar_en_ticket(ticket_id)));

-- --------------------------- REGISTRO_DETALLE -------------------------
drop policy if exists registro_detalle_insert on public.registro_detalle;
create policy registro_detalle_insert on public.registro_detalle for insert
    with check (
        (select public.fn_puede_capturar_en_ticket(
            (select r.ticket_id from public.registros r where r.id = registro_id)
        ))
    );

drop policy if exists registro_detalle_update on public.registro_detalle;
create policy registro_detalle_update on public.registro_detalle for update
    using (
        (select public.fn_puede_capturar_en_ticket(
            (select r.ticket_id from public.registros r where r.id = registro_id)
        ))
    );

-- El borrado de una LÍNEA de detalle no es borrar información: es editar
-- la labor, quitarle un lote que se metió por error. Va con la misma
-- regla que editar. Borrar la labor completa (`registros`) o el ticket
-- sigue siendo sólo del Administrador, como él lo pidió.
drop policy if exists registro_detalle_delete on public.registro_detalle;
create policy registro_detalle_delete on public.registro_detalle for delete
    using (
        (select public.fn_puede_capturar_en_ticket(
            (select r.ticket_id from public.registros r where r.id = registro_id)
        ))
    );

-- Torre de Control también necesita poder quitar una labor entera que
-- quedó mal, no sólo corregirla. Sigue sin poder borrar tickets.
drop policy if exists registros_delete on public.registros;
create policy registros_delete on public.registros for delete
    using (
        (select public.fn_es_admin())
        or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
    );


-- =====================================================================
-- PARTE B · LA FECHA LA MANDA EL TICKET
-- =====================================================================
-- «esas fechas de los horometros y de las labores debemos de quitarla
--  porque no tienen sentido ya que la fecha que se debe de tomar es la
--  del ticket»
--
-- Las columnas NO se borran: las usan la vista del comparativo (que
-- ordena por fecha), los rangos de las pantallas de control, los índices
-- y el avance diario. Lo que se hace es quitarlas de los formularios y
-- forzarlas desde la base, para que nunca puedan diferir de la del
-- ticket ni por descuido ni por una carga vieja.
-- =====================================================================

create or replace function public.fn_fecha_desde_ticket()
returns trigger
language plpgsql as $$
declare
    v_fecha date;
begin
    if TG_TABLE_NAME = 'registro_detalle' then
        select t.fecha into v_fecha
        from public.registros r
        join public.tickets t on t.id = r.ticket_id
        where r.id = new.registro_id;
    else
        select t.fecha into v_fecha from public.tickets t where t.id = new.ticket_id;
    end if;

    if v_fecha is not null then
        new.fecha := v_fecha;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_horometros_fecha on public.horometros;
create trigger trg_horometros_fecha
    before insert or update on public.horometros
    for each row execute function public.fn_fecha_desde_ticket();

drop trigger if exists trg_registros_fecha on public.registros;
create trigger trg_registros_fecha
    before insert or update on public.registros
    for each row execute function public.fn_fecha_desde_ticket();

drop trigger if exists trg_registro_detalle_fecha on public.registro_detalle;
create trigger trg_registro_detalle_fecha
    before insert or update on public.registro_detalle
    for each row execute function public.fn_fecha_desde_ticket();


-- Si se corrige la fecha del ticket, todo lo que cuelga de él la sigue.
-- Antes había que corregir a mano horómetro por horómetro.
create or replace function public.fn_propagar_fecha_ticket()
returns trigger
language plpgsql as $$
begin
    if new.fecha is distinct from old.fecha then
        update public.horometros set fecha = new.fecha where ticket_id = new.id;
        update public.registros  set fecha = new.fecha where ticket_id = new.id;
        update public.registro_detalle rd set fecha = new.fecha
        from public.registros r
        where r.id = rd.registro_id and r.ticket_id = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_tickets_propagar_fecha on public.tickets;
create trigger trg_tickets_propagar_fecha
    after update of fecha on public.tickets
    for each row execute function public.fn_propagar_fecha_ticket();

-- Cuadrar lo que ya está capturado con fechas distintas a la del ticket.
update public.horometros h set fecha = t.fecha
from public.tickets t where t.id = h.ticket_id and h.fecha is distinct from t.fecha;

update public.registros r set fecha = t.fecha
from public.tickets t where t.id = r.ticket_id and r.fecha is distinct from t.fecha;

update public.registro_detalle rd set fecha = t.fecha
from public.registros r
join public.tickets t on t.id = r.ticket_id
where r.id = rd.registro_id and rd.fecha is distinct from t.fecha;


-- =====================================================================
-- PARTE C · LAS HORAS DE LAS LABORES NO SE PASAN DEL HORÓMETRO
-- =====================================================================
-- «ahorita vi que el A66 tenia 6 horas maquina y por error notifique
--  2008 horas para esa labor y eso no puede ser posible»
--
-- La validación va en la base y no sólo en la pantalla: un error de
-- dedo así descuadra el costo de toda la temporada, y la pantalla se
-- puede brincar.
-- =====================================================================

create or replace function public.fn_validar_horas_notificadas()
returns trigger
language plpgsql as $$
declare
    v_maquina numeric;
    v_otras   numeric;
    v_equipo  text;
begin
    if new.horas_notificadas is null then
        return new;
    end if;

    if new.horas_notificadas < 0 then
        raise exception 'Las horas de la labor no pueden ser negativas.';
    end if;

    select h.horas_maquina, e.codigo into v_maquina, v_equipo
    from public.horometros h
    join public.equipos e on e.id = h.equipo_id
    where h.id = new.horometro_id;

    -- Si el horómetro todavía no da horas (inicial = final), no hay contra
    -- qué comparar: se deja pasar y la pantalla lo advierte.
    if coalesce(v_maquina, 0) <= 0 then
        return new;
    end if;

    select coalesce(sum(r.horas_notificadas), 0) into v_otras
    from public.registros r
    where r.horometro_id = new.horometro_id
      and r.id <> new.id;

    if v_otras + new.horas_notificadas > v_maquina then
        raise exception
            'Las horas no cuadran: el horómetro de % dio % h y las labores ya llevan % h. Esta labor no puede llevar más de % h.',
            v_equipo,
            v_maquina,
            v_otras,
            greatest(v_maquina - v_otras, 0);
    end if;

    return new;
end;
$$;

drop trigger if exists trg_registros_validar_horas on public.registros;
create trigger trg_registros_validar_horas
    before insert or update of horas_notificadas on public.registros
    for each row execute function public.fn_validar_horas_notificadas();

comment on function public.fn_validar_horas_notificadas is
'Impide que la suma de horas de las labores de un horómetro pase de sus
horas máquina. Sin esto, un error de dedo (2008 h en un horómetro de 6)
multiplica el costo de la temporada.';


-- Saldo de horas de un horómetro, para que la pantalla proponga y avise
-- con el mismo número que la base va a exigir.
create or replace function public.fn_horas_disponibles(
    p_horometro_id uuid,
    p_excluir_registro_id uuid default null
) returns numeric
language sql stable security invoker as $$
    select greatest(
        coalesce((select h.horas_maquina from public.horometros h where h.id = p_horometro_id), 0)
        - coalesce((
            select sum(r.horas_notificadas)
            from public.registros r
            where r.horometro_id = p_horometro_id
              and (p_excluir_registro_id is null or r.id <> p_excluir_registro_id)
          ), 0),
        0
    )
$$;


-- =====================================================================
-- PARTE D · LA TEMPORADA DEL REGISTRO SIGUE A SUS LOTES
-- =====================================================================
-- «hay equipos que pueden trabajar en 2 temporadas diferentes esto se
--  debe que hay lotes en los que se inicia temporada cuando hay otros
--  lotes que estan todavia con la temporada anterior»
--
-- La temporada de verdad vive en el lote (`lotes_temporada`), así que la
-- del registro se deduce de ahí en vez de quedar clavada a la activa.
-- Así un equipo puede trabajar el mismo día en lotes de dos temporadas y
-- cada línea queda contada donde corresponde.
-- =====================================================================

create or replace function public.fn_temporada_desde_lotes()
returns trigger
language plpgsql as $$
declare
    v_temporada uuid;
begin
    select lt.temporada_id into v_temporada
    from public.lotes_temporada lt
    where lt.id = new.lote_temporada_id;

    if v_temporada is not null then
        update public.registros
        set temporada_id = v_temporada
        where id = new.registro_id
          and (temporada_id is null or temporada_id is distinct from v_temporada);
    end if;
    return new;
end;
$$;

drop trigger if exists trg_detalle_temporada on public.registro_detalle;
create trigger trg_detalle_temporada
    after insert on public.registro_detalle
    for each row execute function public.fn_temporada_desde_lotes();


-- =====================================================================
-- PARTE E · EL AVANCE DEL TABLERO SE MIDE CONTRA EL PLAN
-- =====================================================================
-- «cuando veo los avances todos me aparecen al 100%, cuando esto debe
--  aparecer de acuerdo a lo que se va haciendo segun el plan»
--
-- El tablero medía contra `lotes_temporada.area_neta`. Con área neta en
-- 0 —como está en varios lotes— la condición «trabajadas >= neta» se
-- cumple siempre y TODO sale al 100%. Ahora se mide contra el área del
-- plan del proceso, y si un lote no tiene plan se dice, en vez de
-- inventarle un 100%.
-- =====================================================================

create or replace function public.fn_avance_plan_por_labor(
    p_temporada_id uuid,
    p_proceso_id   uuid
) returns table (
    labor_id      uuid,
    labor_nombre  text,
    area_plan     numeric,
    mz_avance     numeric,
    mz_pendiente  numeric,
    pct_avance    numeric,
    lotes_con_plan bigint,
    lotes_tocados  bigint,
    ultima_fecha  date
)
language sql stable security invoker as $$
    with plan as (
        select sum(pl.area_plan) as area_plan, count(*) as lotes
        from public.planes pl
        where pl.temporada_id = p_temporada_id
          and pl.proceso_id = p_proceso_id
    ),
    -- Cada labor del proceso, medida contra el MISMO plan. No se suman
    -- entre ellas: cada una recorre la misma área.
    hecho as (
        select lb.id as labor_id,
               lb.nombre as labor_nombre,
               sum(rd.avance_mz) as mz,
               count(distinct rd.lote_temporada_id) as lotes,
               max(rd.fecha) as ultima
        from public.registro_detalle rd
        join public.registros r  on r.id = rd.registro_id
        join public.labores lb   on lb.id = r.labor_id
        join public.tareas_sap ts on ts.id = r.tarea_id
        join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
        where lt.temporada_id = p_temporada_id
          and ts.proceso_id = p_proceso_id
          and rd.avance_mz is not null
        group by lb.id, lb.nombre
    )
    select
        h.labor_id,
        h.labor_nombre,
        coalesce(p.area_plan, 0),
        coalesce(h.mz, 0),
        greatest(coalesce(p.area_plan, 0) - coalesce(h.mz, 0), 0),
        case when coalesce(p.area_plan, 0) > 0
             then round(coalesce(h.mz, 0) * 100.0 / p.area_plan, 2)
             else null end,
        coalesce(p.lotes, 0),
        h.lotes,
        h.ultima
    from hecho h
    cross join plan p
    order by coalesce(h.mz, 0) desc
$$;
