-- =====================================================================
-- 76 · EL ACARREO POR CICLO Y POR LOTE, Y EL INFORME QUE REPARTE BIEN
-- =====================================================================
--
-- ── A · El fallo gordo: la dosis de un turno con varios lotes ───────
--
-- Un turno riega varios lotes. Hasta ahora el informe hacía esto:
--
--     sum(qu.litros_aplicados) / nullif(sum(r.mz_cubiertas), 0)
--
-- `qu` está unido por EJECUCIÓN, así que cada lote del turno se llevaba
-- los litros ENTEROS del turno y los dividía entre SUS manzanas.
--
-- Medido: un turno de 2.000 L sobre dos lotes de 10 mz cada uno daba
-- **200 L/mz en cada lote** cuando la dosis real es 100. El doble. Con
-- tres lotes, el triple.
--
-- Y eso no es un número feo en una pantalla: `dosis_mz_real` es lo que
-- se compara contra el plan, así que **todo turno de más de un lote
-- enseñaba una sobredosis que no existió**. El costo sí se prorrateaba
-- —`costo_quimico` iba multiplicado por `mz/mz_total`—, con lo cual el
-- informe se contradecía a sí mismo: dosis doble y costo correcto.
--
-- La corrección es un factor por lote, calculado una vez:
--
--     factor = dl.mz_cubiertas / sum(dl.mz_cubiertas) over (ejecución)
--
-- y TODO lo que viene del turno —litros, costo del químico, cuadrilla—
-- se multiplica por él.
--
-- ── B · El acarreo se cobraba a toda la temporada ───────────────────
--
-- `desinfeccion_logistica` no tenía ciclo: la bolsa de una zona se
-- repartía entre las manzanas regadas de la temporada ENTERA, así que un
-- acarreo del ciclo 1 ensuciaba el costo del ciclo 2. Ahora lleva ciclo,
-- y el reparto lo respeta.
--
-- Y gana `tipo_cargo`: hay acarreos que son de la zona —el viaje que
-- sirvió a todos— y acarreos que son de UN lote concreto. Repartir los
-- segundos entre toda la zona es diluir un costo que tiene dueño.
--
-- ── C · El costo del acarreo son tres cosas, no una ─────────────────
--
-- Era `horas × costo_hora` y nada más. Un acarreo es el equipo, el
-- implemento que arrastra y el jornal del operador: con una sola tarifa,
-- el implemento y la persona salían gratis.
--
-- ── D · Lo que el plan presupuesta ──────────────────────────────────
--
-- `delta_costo` comparaba el costo TOTAL del lote —químico de
-- aplicación, químico de lavado, cuadrilla y acarreo— contra
-- `costo_plan`. Pero el plan sólo presupuesta los químicos de la fase 3:
-- no tiene línea de cuadrilla, ni de lavado, ni de acarreo. Comparar
-- todo contra eso da una desviación siempre positiva y siempre inútil.
-- Ahora se compara químico de aplicación contra plan, y el costo total
-- sigue entero en la cabecera.
-- =====================================================================

-- =====================================================================
-- A · LA LOGÍSTICA: CICLO, TIPO DE CARGO Y COSTO TRIPARTITO
-- =====================================================================

alter table public.desinfeccion_logistica
    add column if not exists ciclo smallint not null default 1,
    add column if not exists tipo_cargo varchar(10) not null default 'zona',
    add column if not exists costo_hora_equipo numeric(12,4) not null default 0,
    add column if not exists costo_hora_implemento numeric(12,4) not null default 0,
    add column if not exists salario_operador numeric(12,4) not null default 0;

alter table public.desinfeccion_logistica
    drop constraint if exists desinfeccion_logistica_ciclo_check,
    drop constraint if exists desinfeccion_logistica_tipo_cargo_check,
    drop constraint if exists desinfeccion_logistica_costo_equipo_check,
    drop constraint if exists desinfeccion_logistica_costo_implemento_check,
    drop constraint if exists desinfeccion_logistica_salario_check;

alter table public.desinfeccion_logistica
    add constraint desinfeccion_logistica_ciclo_check check (ciclo > 0),
    add constraint desinfeccion_logistica_tipo_cargo_check
        check (tipo_cargo in ('zona', 'lote')),
    add constraint desinfeccion_logistica_costo_equipo_check
        check (costo_hora_equipo >= 0),
    add constraint desinfeccion_logistica_costo_implemento_check
        check (costo_hora_implemento >= 0),
    add constraint desinfeccion_logistica_salario_check
        check (salario_operador >= 0);

comment on column public.desinfeccion_logistica.tipo_cargo is
    'zona = el viaje sirvió a toda la zona y se reparte. lote = tiene dueño y sólo se reparte entre los lotes elegidos.';

-- Lo ya guardado llevaba su tarifa en `costo_hora`: se copia al campo
-- nuevo para que nada cambie de precio al correr esta migración.
update public.desinfeccion_logistica
   set costo_hora_equipo = coalesce(costo_hora, 0)
 where costo_hora_equipo = 0 and coalesce(costo_hora, 0) <> 0;

/* ------------------- Los lotes de un acarreo ---------------------- */

create table if not exists public.desinfeccion_logistica_lotes (
    id            uuid primary key default gen_random_uuid(),
    logistica_id  uuid not null references public.desinfeccion_logistica(id) on delete cascade,
    lote_temporada_id uuid not null references public.lotes_temporada(id) on delete cascade,
    created_at    timestamptz not null default now(),
    unique (logistica_id, lote_temporada_id)
);

create index if not exists desinfeccion_logistica_lotes_idx
    on public.desinfeccion_logistica_lotes (logistica_id);
create index if not exists desinfeccion_logistica_lotes_lote_idx
    on public.desinfeccion_logistica_lotes (lote_temporada_id);

alter table public.desinfeccion_logistica_lotes enable row level security;

-- Las dos funciones con las que la hija hereda del padre. Son `definer`
-- a propósito: la hija no puede mirar al padre por RLS —se bloquearían
-- la una a la otra— y sin esto la política no podría resolverse.
create or replace function public.fn_zona_de_logistica(p_logistica_id uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp as $$
    select zona_id from public.desinfeccion_logistica where id = p_logistica_id
$$;

create or replace function public.fn_dueno_logistica(p_logistica_id uuid)
returns uuid language sql stable security definer
set search_path = public, pg_temp as $$
    select usuario_id from public.desinfeccion_logistica where id = p_logistica_id
$$;

grant execute on function public.fn_zona_de_logistica(uuid) to authenticated;
grant execute on function public.fn_dueno_logistica(uuid) to authenticated;

-- La forma canónica de una hija, calcada de `desinfeccion_ejecucion_lotes`.
drop policy if exists desinfeccion_logistica_lotes_select on public.desinfeccion_logistica_lotes;
create policy desinfeccion_logistica_lotes_select on public.desinfeccion_logistica_lotes
    for select using (
        (select public.fn_permitido_de('desinfeccion_logistica', 'ver'))
        and (select public.fn_verificar_permiso_zonal(
                'desinfeccion_logistica', 'ver',
                (select public.fn_dueno_logistica(logistica_id)),
                (select public.fn_zona_de_logistica(logistica_id))))
    );

drop policy if exists desinfeccion_logistica_lotes_write on public.desinfeccion_logistica_lotes;
create policy desinfeccion_logistica_lotes_write on public.desinfeccion_logistica_lotes
    for all
    using (
        (select public.fn_verificar_permiso_zonal(
            'desinfeccion_logistica', 'editar',
            (select public.fn_dueno_logistica(logistica_id)),
            (select public.fn_zona_de_logistica(logistica_id))))
    )
    with check (
        (select public.fn_verificar_permiso_zonal(
            'desinfeccion_logistica', 'crear', null,
            (select public.fn_zona_de_logistica(logistica_id))))
    );

grant select, insert, update, delete on public.desinfeccion_logistica_lotes to authenticated;

/* --------------------- El costo del acarreo ----------------------- */
--
-- Tres piezas, no una: el equipo, el implemento que arrastra y el jornal
-- del operador. Antes era `horas × costo_hora` y el implemento y la
-- persona salían gratis.
/**
 * La tarifa por hora de un equipo en una fecha.
 *
 * Existe para que la PANTALLA pueda adelantar el número mientras se
 * captura. `tarifas_equipo` está detrás del permiso `tarifas`, que el
 * que captura acarreos no tiene por qué tener: sin esta función, el
 * campo se quedaría vacío hasta guardar y el usuario no vería el costo
 * hasta después. Devuelve UN número y nada más — no abre la tabla.
 */
create or replace function public.fn_tarifa_equipo_dia(p_equipo_id uuid, p_fecha date)
returns numeric language sql stable security definer
set search_path = public, pg_temp as $$
    select t.costo_hora
      from public.tarifas_equipo t
     where t.equipo_id = p_equipo_id
       and t.vigente_desde <= coalesce(p_fecha, current_date)
       and (t.vigente_hasta is null or t.vigente_hasta >= coalesce(p_fecha, current_date))
     order by t.vigente_desde desc
     limit 1
$$;

revoke all on function public.fn_tarifa_equipo_dia(uuid, date) from public;
grant execute on function public.fn_tarifa_equipo_dia(uuid, date) to authenticated;

create or replace function public.fn_desinfeccion_costo_logistica()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
    v_equipo     numeric;
    v_implemento numeric;
begin
    -- **LO QUE YA ESTABA ESCRITO MANDA.** Hasta la 75 el costo por hora
    -- se guardaba en `costo_hora` a secas. Un cliente viejo —o una
    -- importación— sigue escribiendo ahí: si no se recogiera, el acarreo
    -- se guardaría en cero sin que nadie lo note.
    if coalesce(new.costo_hora_equipo, 0) = 0 and coalesce(new.costo_hora, 0) > 0 then
        new.costo_hora_equipo := new.costo_hora;
    end if;

    -- La tarifa del equipo, si no viene escrita. `tarifas_equipo` lleva
    -- su vigencia, así que se busca la del DÍA del acarreo y no la de hoy.
    if coalesce(new.costo_hora_equipo, 0) = 0 and new.equipo_id is not null then
        select t.costo_hora into v_equipo
          from public.tarifas_equipo t
         where t.equipo_id = new.equipo_id
           and t.vigente_desde <= new.fecha
           and (t.vigente_hasta is null or t.vigente_hasta >= new.fecha)
         order by t.vigente_desde desc
         limit 1;
        new.costo_hora_equipo := coalesce(v_equipo, 0);
    end if;

    -- El implemento se busca en la MISMA tabla de tarifas: hoy no hay
    -- una suya, así que lo normal es que salga nulo y se escriba a mano.
    -- El día que se le dé de alta una tarifa, esto la encuentra sin
    -- tocar nada.
    if coalesce(new.costo_hora_implemento, 0) = 0 and new.implemento_id is not null then
        select t.costo_hora into v_implemento
          from public.tarifas_equipo t
         where t.equipo_id = new.implemento_id
           and t.vigente_desde <= new.fecha
           and (t.vigente_hasta is null or t.vigente_hasta >= new.fecha)
         order by t.vigente_desde desc
         limit 1;
        new.costo_hora_implemento := coalesce(v_implemento, 0);
    end if;

    -- Sin operador no hay jornal que pagar. Dejar el salario escrito con
    -- el operador en nulo cobraría a nadie.
    if new.operador_id is null then
        new.salario_operador := 0;
    end if;

    -- `costo_hora` se mantiene en pie por compatibilidad: lo leen el
    -- histórico y las pantallas anteriores a la 76.
    new.costo_hora := new.costo_hora_equipo;

    new.costo_total := round(
        (coalesce(new.horas_trabajo, 0) * coalesce(new.costo_hora_equipo, 0))
        + (coalesce(new.horas_trabajo, 0) * coalesce(new.costo_hora_implemento, 0))
        + (case when new.operador_id is not null then coalesce(new.salario_operador, 0) else 0 end),
        2
    );
    return new;
end $$;

drop trigger if exists trg_desinfeccion_costo_logistica on public.desinfeccion_logistica;
create trigger trg_desinfeccion_costo_logistica
    before insert or update of equipo_id, implemento_id, operador_id, fecha, horas_trabajo,
                               costo_hora, costo_hora_equipo, costo_hora_implemento,
                               salario_operador
    on public.desinfeccion_logistica
    for each row execute function public.fn_desinfeccion_costo_logistica();

-- =====================================================================
-- B · LAS VISTAS
-- =====================================================================

drop view if exists public.v_desinfeccion_informe_ejecutivo;
drop view if exists public.v_desinfeccion_costos;
drop view if exists public.v_desinfeccion_logistica;

drop view if exists interno.v_desinfeccion_informe_crudo;
drop view if exists interno.v_desinfeccion_costos_crudo;
drop view if exists interno.v_desinfeccion_logistica_crudo;

/* ---------------------------- Logística ---------------------------- */

create view interno.v_desinfeccion_logistica_crudo as
select
    dg.id,
    dg.temporada_id,
    tm.nombre       as temporada_nombre,
    dg.zona_id,
    z.nombre        as zona_nombre,
    dg.ciclo,
    dg.tipo_cargo,
    dg.fecha,
    dg.equipo_id,
    eq.codigo       as equipo_codigo,
    eq.nombre       as equipo_nombre,
    dg.implemento_id,
    im.nombre       as implemento_nombre,
    dg.operador_id,
    op.nombre       as operador_nombre,
    dg.horas_trabajo,
    dg.costo_hora,
    dg.costo_hora_equipo,
    dg.costo_hora_implemento,
    dg.salario_operador,
    dg.costo_total,
    -- Los lotes a los que se cargó, cuando el cargo es directo. Van como
    -- arreglo y como texto: el arreglo para cruzar, el texto para leer
    -- en la cuadrícula sin abrir nada.
    coalesce(ll.lotes_ids, array[]::uuid[])  as lotes_ids,
    ll.lotes_nombres,
    dg.comentarios,
    dg.usuario_id,
    pf.nombre       as usuario_nombre,
    dg.created_at
from public.desinfeccion_logistica dg
join public.temporadas tm      on tm.id = dg.temporada_id
left join public.zonas z       on z.id = dg.zona_id
left join public.equipos eq    on eq.id = dg.equipo_id
left join public.implementos im on im.id = dg.implemento_id
left join public.operadores op on op.id = dg.operador_id
left join public.perfiles pf   on pf.id = dg.usuario_id
left join lateral (
    select array_agg(x.lote_temporada_id order by lo.nomenclatura) as lotes_ids,
           string_agg(lo.nomenclatura, ', ' order by lo.nomenclatura) as lotes_nombres
    from public.desinfeccion_logistica_lotes x
    join public.lotes_temporada lt on lt.id = x.lote_temporada_id
    join public.lotes lo on lo.id = lt.lote_id
    where x.logistica_id = dg.id
) ll on true;

alter view interno.v_desinfeccion_logistica_crudo set (security_invoker = off);

create view public.v_desinfeccion_logistica as
select x.*
from interno.v_desinfeccion_logistica_crudo x
where (select public.fn_permitido_de('desinfeccion_logistica', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_logistica', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_logistica to authenticated;

/* ================================================================== */
/* EL REPARTO DEL ACARREO, EN UN SOLO SITIO                            */
/* ================================================================== */
--
-- Lo usan la vista de costos y la del informe, y tiene que dar lo mismo
-- en las dos: dos copias de este reparto son dos respuestas distintas a
-- «cuánto acarreo absorbió este lote».
--
-- Devuelve una fila por (lote, ciclo) con lo que le toca, y el detalle
-- en `jsonb` para el expediente del informe.
create or replace function public.fn_logistica_de_lote()
returns table (
    lote_temporada_id uuid,
    ciclo             smallint,
    costo_logistica   numeric,
    detalle           jsonb
)
language sql stable
set search_path = public, pg_temp as $$
    with regado as (
        select dl.lote_temporada_id, e.ciclo, e.temporada_id, lt.zona_id,
               sum(dl.mz_cubiertas) as mz
        from public.desinfeccion_ejecucion_lotes dl
        join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
        join public.lotes_temporada lt on lt.id = dl.lote_temporada_id
        group by 1, 2, 3, 4
    ),
    -- (a) EL CARGO A LA ZONA. La bolsa de la zona EN ESE CICLO, repartida
    --     entre las manzanas regadas de la zona en ese mismo ciclo. Antes
    --     no había ciclo y un acarreo de enero ensuciaba el de agosto.
    zona_mz as (
        select temporada_id, zona_id, ciclo, sum(mz) as mz_zona
        from regado group by 1, 2, 3
    ),
    bolsa_zona as (
        select dg.temporada_id, dg.zona_id, dg.ciclo, sum(dg.costo_total) as bolsa
        from public.desinfeccion_logistica dg
        where dg.tipo_cargo = 'zona'
        group by 1, 2, 3
    ),
    por_zona as (
        select r.lote_temporada_id, r.ciclo,
               coalesce(b.bolsa, 0) * r.mz / nullif(zm.mz_zona, 0) as costo
        from regado r
        left join zona_mz zm on zm.temporada_id = r.temporada_id
                            and zm.zona_id is not distinct from r.zona_id
                            and zm.ciclo = r.ciclo
        left join bolsa_zona b on b.temporada_id = r.temporada_id
                              and b.zona_id is not distinct from r.zona_id
                              and b.ciclo = r.ciclo
    ),
    -- (b) EL CARGO AL LOTE. Cada acarreo se reparte SÓLO entre los lotes
    --     que lleva marcados, en proporción a su área del ciclo. Si no
    --     hay área por ninguna parte, a partes iguales: un cargo que
    --     desaparece porque nadie capturó manzanas es peor que un
    --     reparto aproximado y visible.
    directo as (
        select
            dg.id as logistica_id,
            dgl.lote_temporada_id,
            dg.ciclo,
            dg.costo_total,
            coalesce(public.fn_area_lote_ciclo(dgl.lote_temporada_id, dg.ciclo), 0) as area,
            sum(coalesce(public.fn_area_lote_ciclo(dgl.lote_temporada_id, dg.ciclo), 0))
                over (partition by dg.id) as area_total,
            count(*) over (partition by dg.id) as cuantos
        from public.desinfeccion_logistica dg
        join public.desinfeccion_logistica_lotes dgl on dgl.logistica_id = dg.id
        where dg.tipo_cargo = 'lote'
    ),
    por_lote as (
        select lote_temporada_id, ciclo,
               sum(costo_total * case when area_total > 0 then area / area_total
                                      else 1.0 / nullif(cuantos, 0) end) as costo
        from directo group by 1, 2
    ),
    -- El detalle, para el expediente del informe: los dos tipos juntos,
    -- cada uno con la fracción que de verdad absorbió este lote.
    detalle_zona as (
        select r.lote_temporada_id, r.ciclo,
               jsonb_agg(jsonb_build_object(
                   'id', dg.id, 'fecha', dg.fecha, 'tipo_cargo', dg.tipo_cargo,
                   'equipo_nombre', eq.nombre, 'implemento_nombre', im.nombre,
                   'operador_nombre', op.nombre, 'horas_trabajo', dg.horas_trabajo,
                   'costo_total', dg.costo_total,
                   'costo_lote', round(dg.costo_total * r.mz / nullif(zm.mz_zona, 0), 2)
               ) order by dg.fecha) as detalle
        from regado r
        join zona_mz zm on zm.temporada_id = r.temporada_id
                       and zm.zona_id is not distinct from r.zona_id
                       and zm.ciclo = r.ciclo
        join public.desinfeccion_logistica dg
             on dg.temporada_id = r.temporada_id
            and dg.zona_id is not distinct from r.zona_id
            and dg.ciclo = r.ciclo
            and dg.tipo_cargo = 'zona'
        left join public.equipos eq on eq.id = dg.equipo_id
        left join public.implementos im on im.id = dg.implemento_id
        left join public.operadores op on op.id = dg.operador_id
        group by 1, 2
    ),
    detalle_lote as (
        select d.lote_temporada_id, d.ciclo,
               jsonb_agg(jsonb_build_object(
                   'id', dg.id, 'fecha', dg.fecha, 'tipo_cargo', dg.tipo_cargo,
                   'equipo_nombre', eq.nombre, 'implemento_nombre', im.nombre,
                   'operador_nombre', op.nombre, 'horas_trabajo', dg.horas_trabajo,
                   'costo_total', dg.costo_total,
                   'costo_lote', round(
                       dg.costo_total * case when d.area_total > 0 then d.area / d.area_total
                                             else 1.0 / nullif(d.cuantos, 0) end, 2)
               ) order by dg.fecha) as detalle
        from directo d
        join public.desinfeccion_logistica dg on dg.id = d.logistica_id
        left join public.equipos eq on eq.id = dg.equipo_id
        left join public.implementos im on im.id = dg.implemento_id
        left join public.operadores op on op.id = dg.operador_id
        group by 1, 2
    ),
    llaves as (
        select lote_temporada_id, ciclo from por_zona
        union
        select lote_temporada_id, ciclo from por_lote
    )
    select k.lote_temporada_id, k.ciclo::smallint,
           coalesce(z.costo, 0) + coalesce(l.costo, 0),
           coalesce(dz.detalle, '[]'::jsonb) || coalesce(dl.detalle, '[]'::jsonb)
    from llaves k
    left join por_zona z on z.lote_temporada_id = k.lote_temporada_id and z.ciclo = k.ciclo
    left join por_lote l on l.lote_temporada_id = k.lote_temporada_id and l.ciclo = k.ciclo
    left join detalle_zona dz on dz.lote_temporada_id = k.lote_temporada_id and dz.ciclo = k.ciclo
    left join detalle_lote dl on dl.lote_temporada_id = k.lote_temporada_id and dl.ciclo = k.ciclo
$$;

comment on function public.fn_logistica_de_lote() is
    'Cuánto acarreo absorbe cada lote en cada ciclo, por zona y por cargo directo. Un solo sitio para las dos vistas.';

/* ------------------------------ Costos ----------------------------- */

create view interno.v_desinfeccion_costos_crudo as
with regado as (
    select dl.lote_temporada_id, dl.ejecucion_id, e.temporada_id, e.ciclo,
           lt.zona_id, dl.mz_cubiertas,
           -- **EL FACTOR.** Lo que de este turno le toca a este lote.
           dl.mz_cubiertas / nullif(sum(dl.mz_cubiertas) over (partition by dl.ejecucion_id), 0)
               as factor
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.lotes_temporada lt on lt.id = dl.lote_temporada_id
),
quimico as (
    select r.lote_temporada_id,
           sum(dp.costo_total * r.factor) as costo_quimico
    from regado r
    join public.desinfeccion_ejecucion_productos dp on dp.ejecucion_id = r.ejecucion_id
    group by 1
),
personal as (
    select r.lote_temporada_id,
           sum(pe.costo_total * r.factor) as costo_personal,
           sum(pe.costo_total * r.factor) filter (where pe.fase = '1_Preriego')   as costo_preriego,
           sum(pe.costo_total * r.factor) filter (where pe.fase = '3_Aplicacion') as costo_aplicacion,
           sum(pe.costo_total * r.factor) filter (where pe.fase = '4_Lavado')     as costo_lavado
    from regado r
    join public.desinfeccion_personal pe on pe.ejecucion_id = r.ejecucion_id
    group by 1
),
acarreo as (
    select lote_temporada_id, sum(costo_logistica) as costo_logistica
    from public.fn_logistica_de_lote() group by 1
),
base as (
    select r.lote_temporada_id, r.temporada_id, r.zona_id,
           sum(r.mz_cubiertas) as mz_regadas
    from regado r group by 1, 2, 3
)
select
    b.lote_temporada_id,
    lo.nomenclatura as lote_nomenclatura,
    lo.nombre       as lote_nombre,
    b.temporada_id,
    tm.nombre       as temporada_nombre,
    b.zona_id,
    z.nombre        as zona_nombre,
    b.mz_regadas,
    coalesce(qu.costo_quimico, 0)      as costo_quimico,
    coalesce(pe.costo_personal, 0)     as costo_personal,
    coalesce(pe.costo_preriego, 0)     as costo_personal_preriego,
    coalesce(pe.costo_aplicacion, 0)   as costo_personal_aplicacion,
    coalesce(pe.costo_lavado, 0)       as costo_personal_lavado,
    coalesce(ac.costo_logistica, 0)    as costo_logistica,
    coalesce(qu.costo_quimico, 0) + coalesce(pe.costo_personal, 0)
        + coalesce(ac.costo_logistica, 0) as costo_total,
    (coalesce(qu.costo_quimico, 0) + coalesce(pe.costo_personal, 0)
        + coalesce(ac.costo_logistica, 0)) / nullif(b.mz_regadas, 0) as costo_mz
from base b
join public.lotes_temporada lt on lt.id = b.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
join public.temporadas tm      on tm.id = b.temporada_id
left join public.zonas z       on z.id = b.zona_id
left join quimico qu on qu.lote_temporada_id = b.lote_temporada_id
left join personal pe on pe.lote_temporada_id = b.lote_temporada_id
left join acarreo ac on ac.lote_temporada_id = b.lote_temporada_id;

alter view interno.v_desinfeccion_costos_crudo set (security_invoker = off);

create view public.v_desinfeccion_costos as
select x.*
from interno.v_desinfeccion_costos_crudo x
where (select public.fn_permitido_de('desinfeccion_reporte', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_reporte', 'ver'))
      when 'global'      then true
      when 'propietario' then false
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_costos to authenticated;

/* ------------------------- Informe ejecutivo ------------------------ */

create view interno.v_desinfeccion_informe_crudo as
with regado as (
    select dl.lote_temporada_id, e.ciclo, e.temporada_id, lt.zona_id, dl.ejecucion_id,
           dl.mz_cubiertas, e.fecha_preriego, e.fecha_lecturas, e.fecha_aplicacion,
           e.fecha_lavado,
           e.caudal_agua, e.horas_preriego, e.horas_inyeccion, e.horas_lavado,
           e.total_horas_riego, e.estado, e.usuario_id,
           case when e.equipo_aplicacion = 'Otros' then e.equipo_aplicacion_otro
                else e.equipo_aplicacion end as equipo_aplicacion_mostrado,
           -- **EL FACTOR DE PARTICIPACIÓN.** Lo que de este turno le toca
           -- a este lote. Sin él, cada lote se llevaba los litros enteros
           -- del turno y la dosis salía multiplicada por el número de
           -- lotes: medido, un turno de 2.000 L sobre dos lotes de 10 mz
           -- daba 200 L/mz en cada uno cuando la dosis real es 100.
           dl.mz_cubiertas / nullif(sum(dl.mz_cubiertas) over (partition by dl.ejecucion_id), 0)
               as factor
    from public.desinfeccion_ejecucion_lotes dl
    join public.desinfeccion_ejecucion e on e.id = dl.ejecucion_id
    join public.lotes_temporada lt on lt.id = dl.lote_temporada_id
),
plan as (
    select p.lote_temporada_id, p.ciclo,
           min(p.fecha_siembra_congelada) as fecha_siembra_plan,
           min(p.fecha_aplicacion)        as fecha_aplicacion_plan,
           min(p.fecha_preriego)          as fecha_preriego_plan,
           min(case when v.ddt_cosecha is not null
                    then p.fecha_siembra_congelada + v.ddt_cosecha end) as fecha_cosecha_plan,
           max(p.area_planificada_mz)     as mz_planificadas,
           sum(p.dosis_mz)                as dosis_mz_plan,
           sum(p.total_litros)            as litros_plan,
           sum(p.total_costo)             as costo_plan,
           count(*)                       as lineas_plan,
           jsonb_agg(jsonb_build_object(
               'producto_id', p.producto_id, 'producto_nombre', m.descripcion,
               'producto_codigo', m.codigo,
               'dosis_mz', p.dosis_mz, 'area_planificada_mz', p.area_planificada_mz,
               'total_litros', p.total_litros, 'costo_litro', p.costo_litro,
               'total_costo', p.total_costo,
               'dias_preriego', p.dias_preriego, 'fecha_preriego', p.fecha_preriego,
               'dias_aplicacion', p.dias_aplicacion, 'fecha_aplicacion', p.fecha_aplicacion
           ) order by m.codigo) as planes_detalle
    from public.desinfeccion_plan p
    left join public.variedades v on v.id = p.variedad_id
    left join public.materiales m on m.id = p.producto_id
    group by p.lote_temporada_id, p.ciclo
),
siembra as (
    select lt.id as lote_temporada_id,
           coalesce(r.ciclo, p.ciclo) as ciclo,
           coalesce(r.fecha_siembra, p.fecha_siembra) as fecha_siembra,
           case when r.fecha_siembra is not null then 'real' else 'plan' end as origen_siembra,
           coalesce(r.variedad, p.variedad) as variedad
    from public.lotes_temporada lt
    left join lateral (
        select distinct on (s.ciclo) s.ciclo, s.fecha_siembra, v.nombre as variedad
        from public.siembras s left join public.variedades v on v.id = s.variedad_id
        where s.lote_temporada_id = lt.id order by s.ciclo, s.fecha_siembra
    ) r on true
    left join lateral (
        select distinct on (ps.ciclo) ps.ciclo, ps.fecha_siembra, v.nombre as variedad
        from public.planes_siembra ps left join public.variedades v on v.id = ps.variedad_id
        where ps.lote_temporada_id = lt.id and ps.fecha_siembra is not null
        order by ps.ciclo, ps.fecha_siembra
    ) p on true
),
/*
 * **Los químicos, YA prorrateados al lote.**
 *
 * Antes esto se agrupaba por EJECUCIÓN y se unía a `regado`, con lo que
 * cada lote del turno se llevaba los litros enteros. Ahora se agrupa por
 * (lote, ciclo) y todo va multiplicado por el factor.
 */
quimicos as (
    select
        r.lote_temporada_id, r.ciclo,
        sum(dp.costo_total * r.factor) as costo_quimico,
        sum(dp.costo_total * r.factor) filter (where dp.fase = '3_Aplicacion')
            as costo_quimico_aplicacion,
        sum(dp.costo_total * r.factor) filter (where dp.fase = '4_Lavado')
            as costo_quimico_lavado,
        -- Los litros que se comparan contra el plan: sólo aplicación, y
        -- sólo la parte de este lote.
        sum(dp.total_litros * r.factor) filter (where dp.fase = '3_Aplicacion')
            as litros_aplicados,
        (array_agg(dp.ppm_calculada order by dp.total_litros desc nulls last)
            filter (where dp.fase = '3_Aplicacion'))[1] as ppm_principal,
        jsonb_agg(jsonb_build_object(
            'codigo', dp.producto_codigo, 'nombre', dp.producto_nombre,
            'concentracion', dp.concentracion, 'fase', dp.fase,
            'objetivos', to_jsonb(coalesce(dp.objetivos_control, array[]::text[])),
            'objetivos_control', to_jsonb(coalesce(dp.objetivos_control, array[]::text[])),
            'litros_lote', round(dp.total_litros * r.factor, 4),
            'litros_turno', dp.total_litros,
            'dosis_mz', round(dp.total_litros * r.factor / nullif(r.mz_cubiertas, 0), 4),
            'costo_litro', dp.costo_litro,
            'costo_lote', round(dp.costo_total * r.factor, 2),
            'ppm_calculada', dp.ppm_calculada,
            'cantidad_envases', dp.cantidad_envases,
            'tipo_envase', dp.tipo_envase,
            -- Se conservan los nombres de antes para no romper lo que ya
            -- los lee: ahora dicen lo del LOTE, que es lo que el informe
            -- siempre quiso decir.
            'litros', round(dp.total_litros * r.factor, 4),
            'costo', round(dp.costo_total * r.factor, 2),
            'ppm', dp.ppm_calculada
        ) order by dp.total_litros desc nulls last) as detalle
    from regado r
    join interno.v_desinfeccion_productos_crudo dp on dp.ejecucion_id = r.ejecucion_id
    group by 1, 2
),
objetivos as (
    select r.lote_temporada_id, r.ciclo,
           coalesce(array_agg(distinct btrim(o.obj) order by btrim(o.obj)),
                    array[]::text[]) as objetivos_control
    from regado r
    join public.desinfeccion_ejecucion_productos dp
         on dp.ejecucion_id = r.ejecucion_id and dp.fase = '3_Aplicacion'
    cross join lateral unnest(coalesce(dp.objetivos_control, array[]::text[])) o(obj)
    where nullif(btrim(o.obj), '') is not null
    group by 1, 2
),
personal as (
    select r.lote_temporada_id, r.ciclo,
           sum(pe.costo_total * r.factor) as costo_personal,
           sum(pe.costo_total * r.factor) filter (where pe.fase = '1_Preriego')   as costo_preriego,
           sum(pe.costo_total * r.factor) filter (where pe.fase = '3_Aplicacion') as costo_aplicacion,
           sum(pe.costo_total * r.factor) filter (where pe.fase = '4_Lavado')     as costo_lavado,
           jsonb_agg(jsonb_build_object(
               'fase', pe.fase, 'puesto_texto', pe.puesto_texto,
               'operador_nombre', op.nombre,
               'cantidad_personas', pe.cantidad_personas,
               'salario_base_manual', pe.salario_base_manual,
               'horas_extras', pe.horas_extras, 'jornada_tipo', pe.jornada_tipo,
               'costo_turno', pe.costo_total,
               'costo_lote', round(pe.costo_total * r.factor, 2)
           ) order by pe.fase, pe.puesto_texto) as cuadrilla_detalle
    from regado r
    join public.desinfeccion_personal pe on pe.ejecucion_id = r.ejecucion_id
    left join public.operadores op on op.id = pe.operador_id
    group by 1, 2
),
acarreo as (
    select lote_temporada_id, ciclo, costo_logistica, detalle as logistica_detalle
    from public.fn_logistica_de_lote()
),
-- El expediente de cada turno que regó este lote, con su factor a la
-- vista: sin él, nadie puede rehacer la cuenta del reparto.
ejecuciones as (
    select r.lote_temporada_id, r.ciclo,
           jsonb_agg(jsonb_build_object(
               'turno_nombre', tn.nombre, 'turno_codigo', tn.codigo,
               'mz_cubiertas', r.mz_cubiertas,
               'mz_total_turno', round(r.mz_cubiertas / nullif(r.factor, 0), 4),
               'factor_lote', round(r.factor, 6),
               'fecha_preriego', e.fecha_preriego,
               'hora_inicio_preriego', e.hora_inicio_preriego,
               'hora_fin_preriego', e.hora_fin_preriego,
               'horas_preriego', e.horas_preriego,
               'obs_preriego', e.obs_preriego,
               'fecha_lecturas', e.fecha_lecturas,
               'lecturas_tensiometro', e.lecturas_tensiometro,
               'fecha_aplicacion', e.fecha_aplicacion,
               'estacion_nombre', er.nombre,
               'equipo_aplicacion_mostrado', r.equipo_aplicacion_mostrado,
               'caudal_agua', e.caudal_agua,
               'inicio_presurizacion', e.inicio_presurizacion,
               'fin_presurizacion', e.fin_presurizacion,
               'horas_presurizacion', e.horas_presurizacion,
               'hora_inicio_iny', e.hora_inicio_iny,
               'hora_fin_iny', e.hora_fin_iny,
               'horas_inyeccion', e.horas_inyeccion,
               'hora_inicio_lavado', e.hora_inicio_lavado,
               'hora_fin_lavado', e.hora_fin_lavado,
               'horas_lavado', e.horas_lavado,
               'total_horas_riego', e.total_horas_riego,
               'agua_total_m3', coalesce(e.horas_inyeccion, 0) * e.caudal_agua,
               'ce_antes', e.ce_antes, 'ce_durante', e.ce_durante, 'ce_despues', e.ce_despues,
               'calibracion_entrada', e.calibracion_entrada,
               'calibracion_salida', e.calibracion_salida,
               'calibracion_campo', e.calibracion_campo,
               'fecha_lavado', e.fecha_lavado
           ) order by e.fecha_aplicacion nulls last, tn.codigo) as ejecuciones_detalle
    from regado r
    join public.desinfeccion_ejecucion e on e.id = r.ejecucion_id
    join public.turnos tn on tn.id = e.turno_id
    left join public.estaciones_riego er on er.id = e.estacion_riego_id
    group by 1, 2
),
base as (
    select
        r.lote_temporada_id,
        r.ciclo,
        lo.nomenclatura as lote_nomenclatura,
        lo.nombre       as lote_nombre,
        r.zona_id,
        z.nombre        as zona_nombre,
        r.temporada_id,
        tm.nombre       as temporada_nombre,
        min(r.usuario_id::text)::uuid as usuario_id,
        max(pl.fecha_siembra_plan)    as fecha_siembra_plan,
        max(pl.fecha_aplicacion_plan) as fecha_aplicacion_plan,
        max(pl.fecha_preriego_plan)   as fecha_preriego_plan,
        max(pl.fecha_cosecha_plan)    as fecha_cosecha_plan,
        min(r.fecha_preriego)         as fecha_preriego,
        -- Las lecturas de tensiómetro son una etapa propia del cronograma
        -- desde la 76: hasta ahora sólo vivían dentro del expediente.
        min(r.fecha_lecturas)         as fecha_lecturas,
        min(r.fecha_aplicacion)       as fecha_aplicacion,
        max(r.fecha_lavado)           as fecha_lavado,
        max(sb.fecha_siembra)         as fecha_siembra,
        max(sb.origen_siembra)        as origen_siembra,
        max(sb.variedad)              as variedad,
        max(r.equipo_aplicacion_mostrado) as equipo_aplicacion,
        min(r.fecha_preriego)   - max(sb.fecha_siembra) as ddt_preriego,
        min(r.fecha_aplicacion) - max(sb.fecha_siembra) as ddt_aplicacion,
        max(r.fecha_lavado)     - max(sb.fecha_siembra) as ddt_lavado,
        max(pl.fecha_aplicacion_plan) - max(sb.fecha_siembra) as ddt_plan,
        max(pl.fecha_preriego_plan)   - max(sb.fecha_siembra) as ddt_preriego_plan,
        sum(r.mz_cubiertas)        as mz_regadas,
        max(pl.mz_planificadas)    as mz_planificadas,
        max(pl.dosis_mz_plan)      as dosis_mz_plan,
        max(r.caudal_agua)         as caudal_agua,
        sum(r.total_horas_riego)   as horas_riego,
        max(r.estado::text)        as estado,
        max(pl.costo_plan)         as costo_plan,
        (array_agg(pl.planes_detalle))[1] as planes_detalle
    from regado r
    join public.lotes_temporada lt on lt.id = r.lote_temporada_id
    join public.lotes lo           on lo.id = lt.lote_id
    join public.temporadas tm      on tm.id = r.temporada_id
    left join public.zonas z       on z.id = r.zona_id
    left join plan pl    on pl.lote_temporada_id = r.lote_temporada_id and pl.ciclo = r.ciclo
    left join siembra sb on sb.lote_temporada_id = r.lote_temporada_id and sb.ciclo = r.ciclo
    group by r.lote_temporada_id, r.ciclo, lo.nomenclatura, lo.nombre, r.zona_id, z.nombre,
             r.temporada_id, tm.nombre
)
select
    b.*,
    coalesce(ob.objetivos_control, array[]::text[]) as objetivos_control,
    qu.ppm_principal,
    qu.litros_aplicados / nullif(b.mz_regadas, 0) as dosis_mz_real,
    coalesce(qu.costo_quimico, 0)             as costo_quimico,
    coalesce(qu.costo_quimico_aplicacion, 0)  as costo_quimico_aplicacion,
    coalesce(qu.costo_quimico_lavado, 0)      as costo_quimico_lavado,
    coalesce(pe.costo_personal, 0)            as costo_personal,
    coalesce(pe.costo_preriego, 0)            as costo_personal_preriego,
    coalesce(pe.costo_aplicacion, 0)          as costo_personal_aplicacion,
    coalesce(pe.costo_lavado, 0)              as costo_personal_lavado,
    coalesce(ac.costo_logistica, 0)           as costo_logistica,
    coalesce(qu.detalle, '[]'::jsonb)         as productos,
    coalesce(pe.cuadrilla_detalle, '[]'::jsonb)  as cuadrilla_detalle,
    coalesce(ac.logistica_detalle, '[]'::jsonb)  as logistica_detalle,
    coalesce(ej.ejecuciones_detalle, '[]'::jsonb) as ejecuciones_detalle,
    coalesce(b.planes_detalle, '[]'::jsonb)      as planes_detalle_json
from base b
left join objetivos ob on ob.lote_temporada_id = b.lote_temporada_id and ob.ciclo = b.ciclo
left join quimicos qu  on qu.lote_temporada_id = b.lote_temporada_id and qu.ciclo = b.ciclo
left join personal pe  on pe.lote_temporada_id = b.lote_temporada_id and pe.ciclo = b.ciclo
left join acarreo ac   on ac.lote_temporada_id = b.lote_temporada_id and ac.ciclo = b.ciclo
left join ejecuciones ej on ej.lote_temporada_id = b.lote_temporada_id and ej.ciclo = b.ciclo;

alter view interno.v_desinfeccion_informe_crudo set (security_invoker = off);

create view public.v_desinfeccion_informe_ejecutivo as
select
    x.*,
    x.costo_quimico + x.costo_personal + x.costo_logistica as costo_total,
    (x.costo_quimico + x.costo_personal + x.costo_logistica)
        / nullif(x.mz_regadas, 0) as costo_mz,
    /*
     * **La desviación compara lo COMPARABLE** (migración 76).
     *
     * El plan de desinfección presupuesta los químicos de la fase 3 y
     * nada más: no tiene línea de cuadrilla, ni de lavado de cinta, ni
     * de acarreo. Medir el costo total contra él daba una desviación
     * siempre positiva y siempre inútil —el turno «se pasaba» por tener
     * jornales, que es lo normal—.
     *
     * El costo total sigue entero arriba, para la cabecera del lote.
     */
    case when x.costo_plan is null then null
         else x.costo_quimico_aplicacion - x.costo_plan
    end as delta_costo,
    case when coalesce(x.costo_plan, 0) = 0 then null
         else (x.costo_quimico_aplicacion - x.costo_plan) * 100.0 / x.costo_plan
    end as delta_costo_pct,
    case when x.dosis_mz_plan is null then null
         else x.dosis_mz_real - x.dosis_mz_plan end as delta_dosis,
    case when coalesce(x.dosis_mz_plan, 0) = 0 then null
         else (x.dosis_mz_real - x.dosis_mz_plan) * 100.0 / x.dosis_mz_plan
    end as delta_dosis_pct,
    case
        when coalesce(x.costo_personal_preriego, 0) = 0
         and coalesce(x.costo_personal_aplicacion, 0) = 0
         and coalesce(x.costo_personal_lavado, 0) = 0 then null
        when coalesce(x.costo_personal_preriego, 0) >= coalesce(x.costo_personal_aplicacion, 0)
         and coalesce(x.costo_personal_preriego, 0) >= coalesce(x.costo_personal_lavado, 0)
            then 'Preriego'
        when coalesce(x.costo_personal_aplicacion, 0) >= coalesce(x.costo_personal_lavado, 0)
            then 'Aplicación'
        else 'Lavado de cinta'
    end as fase_mas_cara
from interno.v_desinfeccion_informe_crudo x
where (select public.fn_permitido_de('desinfeccion_reporte', 'ver'))
  and case (select public.fn_mi_alcance('desinfeccion_reporte', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else (select public.fn_ve_zona_estricta(x.zona_id))
  end;

grant select on public.v_desinfeccion_informe_ejecutivo to authenticated;

-- =====================================================================
-- C · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_falta text;
    v_vista text;
    v_def   text;
begin
    /* ---- 1 · El prorrateo, que es lo gordo de esta migración ---- */
    v_def := pg_get_viewdef('interno.v_desinfeccion_informe_crudo'::regclass, true);

    if v_def !~* 'partition by dl\.ejecucion_id' then
        raise exception 'El informe volvió a repartir sin el factor por lote: la dosis saldría multiplicada.';
    end if;

    -- El fallo de la 75 no puede volver por la puerta de atrás.
    if v_def ~* 'array_agg\(qu\.objetivos' then
        raise exception 'Volvió el array_agg sobre una columna que ya es un arreglo.';
    end if;

    begin
        perform objetivos_control, productos, cuadrilla_detalle, logistica_detalle,
                ejecuciones_detalle, planes_detalle_json
          from interno.v_desinfeccion_informe_crudo;
    exception when others then
        raise exception 'El informe revienta al pedir sus columnas: %', sqlerrm;
    end;

    /* ---- 2 · La desviación compara lo comparable ---- */
    if pg_get_viewdef('public.v_desinfeccion_informe_ejecutivo'::regclass, true)
       !~* 'costo_quimico_aplicacion - (x\.)?costo_plan' then
        raise exception 'delta_costo volvió a medir el costo total contra un plan que sólo presupuesta químico.';
    end if;

    /* ---- 3 · El acarreo ---- */
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'desinfeccion_logistica'
                      and column_name = 'ciclo') then
        raise exception 'Falta desinfeccion_logistica.ciclo: el acarreo volvería a cruzarse de ciclo.';
    end if;

    if pg_get_functiondef('public.fn_logistica_de_lote()'::regprocedure) !~* 'dg\.ciclo = r\.ciclo' then
        raise exception 'El reparto del acarreo dejó de respetar el ciclo.';
    end if;

    if pg_get_functiondef('public.fn_desinfeccion_costo_logistica()'::regprocedure)
       !~* 'costo_hora_implemento' then
        raise exception 'El costo del acarreo volvió a olvidarse del implemento y del operador.';
    end if;

    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'desinfeccion_logistica_lotes'
                      and policyname = 'desinfeccion_logistica_lotes_select') then
        raise exception 'desinfeccion_logistica_lotes se quedó sin reja de lectura.';
    end if;

    if not (select relrowsecurity from pg_class
             where oid = 'public.desinfeccion_logistica_lotes'::regclass) then
        raise exception 'desinfeccion_logistica_lotes se quedó sin RLS.';
    end if;

    /* ---- 4 · Las rejas, después de recrear tres parejas ---- */
    if has_schema_privilege('authenticated', 'interno', 'usage') then
        raise exception 'authenticated ganó USAGE sobre interno.';
    end if;

    select string_agg(c.relname, ', ') into v_falta
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'interno' and c.relkind = 'v'
       and has_table_privilege('authenticated', c.oid, 'select');
    if v_falta is not null then
        raise exception 'authenticated puede leer vistas crudas de interno: %', v_falta;
    end if;

    for v_vista in
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'v'
           and c.relname in ('v_desinfeccion_logistica', 'v_desinfeccion_costos',
                             'v_desinfeccion_informe_ejecutivo')
    loop
        if pg_get_viewdef(('public.' || v_vista)::regclass, true) !~* 'fn_permitido_de'
        or pg_get_viewdef(('public.' || v_vista)::regclass, true) !~* 'fn_mi_alcance'
        or pg_get_viewdef(('public.' || v_vista)::regclass, true) !~* 'fn_ve_zona_estricta' then
            raise exception 'La vista %: se quedó sin reja.', v_vista;
        end if;
        if not has_table_privilege('authenticated', ('public.' || v_vista)::regclass, 'select') then
            raise exception 'La vista %: el navegador no la puede leer.', v_vista;
        end if;
    end loop;

    select string_agg(c.relname, ', ') into v_falta
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'interno' and c.relkind = 'v'
       and c.relname in ('v_desinfeccion_logistica_crudo', 'v_desinfeccion_costos_crudo',
                         'v_desinfeccion_informe_crudo')
       and coalesce(array_to_string(c.reloptions, ','), '') !~ 'security_invoker=off';
    if v_falta is not null then
        raise exception 'Vistas crudas sin security_invoker=off: %', v_falta;
    end if;
end $$;
