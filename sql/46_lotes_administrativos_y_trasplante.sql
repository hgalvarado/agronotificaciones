-- =====================================================================
-- 46 · Lotes agrícolas contra departamentos administrativos,
--      y el trasplante con productos, fin de siembra y sin recorte.
--
-- Ejecutar en el SQL Editor DESPUÉS de la 45.
--
-- El problema de fondo: para poder notificar a SAP el costo de la
-- maquinaria que trabaja en oficinas, talleres o caminos, esos
-- departamentos se dieron de alta COMO LOTES. Funciona para notificar,
-- pero les falta área y zona, y entonces entran en el plan de siembra,
-- en el cuadre de trasplante y en los turnos de riego como lotes de
-- 0 mz que jamás se van a sembrar: el porcentaje de cumplimiento sale
-- mal y la lista de pendientes se llena de sitios donde no se siembra.
--
-- La solución no es sacarlos —se necesitan para notificar— sino
-- DECIRLO: un lote sabe si es agrícola o administrativo, y la base se
-- encarga de que un departamento administrativo no pueda entrar en
-- ninguna planificación. Así el filtro no depende de que cada pantalla
-- se acuerde de ponerlo.
-- =====================================================================

-- =====================================================================
-- PARTE A · Qué es cada lote
-- =====================================================================

do $$
begin
    if not exists (select 1 from pg_type where typname = 'tipo_lote') then
        create type public.tipo_lote as enum ('AGRICOLA', 'ADMINISTRATIVO');
    end if;
end $$;

alter table public.lotes
    add column if not exists tipo public.tipo_lote not null default 'AGRICOLA';

comment on column public.lotes.tipo is
'AGRICOLA: se siembra, se riega y se planifica. ADMINISTRATIVO: existe sólo para notificar costos de maquinaria a SAP (oficinas, taller, caminos); no tiene área ni zona y no entra en ninguna planificación.';

create index if not exists lotes_tipo_idx on public.lotes (tipo);

/**
 * ¿Este lote de temporada es agrícola?
 *
 * `security definer` a propósito: la usan disparadores y funciones que
 * corren bajo la RLS de quien captura, y un lote que esa persona no ve
 * devolvería NULL —ni sí ni no— dejando pasar lo que tenía que frenar.
 * No filtra nada por sí misma: sólo contesta una pregunta del catálogo.
 */
create or replace function public.fn_lote_es_agricola(p_lote_temporada_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp as $$
    select coalesce(
        (select lo.tipo = 'AGRICOLA'
         from public.lotes_temporada lt
         join public.lotes lo on lo.id = lt.lote_id
         where lt.id = p_lote_temporada_id),
        true)
$$;

grant execute on function public.fn_lote_es_agricola(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Un departamento administrativo no tiene área ni zona. Nunca.
--
-- Va en la BASE y no sólo en la pantalla: el área también entra por el
-- importador de Excel y por el clonado entre temporadas, y tres sitios
-- que se acuerden de limpiarla son tres sitios donde uno se olvida.
-- ---------------------------------------------------------------------
create or replace function public.fn_normalizar_lote_temporada()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
    -- Se mira por `lote_id` y no por `new.id`: en un INSERT la fila
    -- todavía no está en la tabla, así que buscarla por su propio id no
    -- encontraría nada y el departamento entraría con área.
    if exists (select 1 from public.lotes
               where id = new.lote_id and tipo = 'ADMINISTRATIVO') then
        new.zona_id    := null;
        new.area_bruta := null;
        new.area_neta  := 0;
    end if;
    return new;
end $$;

drop trigger if exists trg_lote_temporada_normalizar on public.lotes_temporada;
create trigger trg_lote_temporada_normalizar
    before insert or update on public.lotes_temporada
    for each row execute function public.fn_normalizar_lote_temporada();

-- Y al cambiar el tipo del lote en el catálogo, se limpia lo que ya
-- tuviera asignado en todas sus temporadas.
create or replace function public.fn_limpiar_lote_administrativo()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
    if new.tipo = 'ADMINISTRATIVO' and coalesce(old.tipo, 'AGRICOLA') <> 'ADMINISTRATIVO' then
        update public.lotes_temporada
        set zona_id = null, area_bruta = null, area_neta = 0
        where lote_id = new.id;
    end if;
    return new;
end $$;

drop trigger if exists trg_lote_limpiar_administrativo on public.lotes;
create trigger trg_lote_limpiar_administrativo
    after update of tipo on public.lotes
    for each row execute function public.fn_limpiar_lote_administrativo();

-- ---------------------------------------------------------------------
-- Ningún departamento administrativo entra en una planificación.
--
-- Éste es el «filtro global» de verdad: en vez de recordar el filtro en
-- cada consulta de cada módulo —y olvidarlo en la siguiente pantalla—,
-- la base no deja que el dato llegue a existir. Lo que no está en el
-- plan ni en la siembra ni en el turno no puede salir en ningún cuadre.
-- ---------------------------------------------------------------------
create or replace function public.fn_exigir_lote_agricola()
returns trigger
language plpgsql
set search_path = public, pg_temp as $$
begin
    if not public.fn_lote_es_agricola(new.lote_temporada_id) then
        raise exception
            'Ese lote está marcado como Departamento administrativo: sirve para notificar costos a SAP, pero no se planifica ni se siembra. Cámbialo a Lote agrícola en Lotes de la temporada si de verdad se siembra.'
            using errcode = 'check_violation';
    end if;
    return new;
end $$;

do $$
declare t record;
begin
    for t in
        select unnest(array[
            'planes_siembra', 'siembras', 'planes', 'turnos_riego_detalle'
        ]) as tabla
    loop
        if to_regclass('public.' || t.tabla) is not null then
            execute format('drop trigger if exists trg_%s_lote_agricola on public.%I', t.tabla, t.tabla);
            execute format(
                'create trigger trg_%s_lote_agricola before insert or update of lote_temporada_id'
                || ' on public.%I for each row execute function public.fn_exigir_lote_agricola()',
                t.tabla, t.tabla);
        end if;
    end loop;
end $$;

-- =====================================================================
-- PARTE B · Los lotes que se ofrecen para regar
--
-- El riego elige de una función, no de la tabla, así que el filtro va
-- aquí. Se parcha sobre la definición viva en vez de recopiarla: la
-- firma y el cuerpo pueden haber cambiado en la 40 o en la 41 y
-- recopiar una versión vieja desharía esos arreglos.
-- =====================================================================

do $$
declare v_def text;
begin
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_lotes_regables'
    limit 1;

    if v_def is null then
        raise notice 'fn_lotes_regables no existe todavía (falta la migración 40). Se omite.';
    elsif v_def like '%lo.tipo%' then
        raise notice 'fn_lotes_regables ya excluye los departamentos administrativos.';
    else
        v_def := replace(v_def,
            'where lt.temporada_id = p_temporada_id',
            'where lt.temporada_id = p_temporada_id
      and lo.tipo = ''AGRICOLA''');
        execute v_def;
        raise notice 'fn_lotes_regables ahora sólo ofrece lotes agrícolas.';
    end if;
end $$;

-- =====================================================================
-- PARTE C · Fin de siembra por lote y ciclo
--
-- «Marcar lote como terminado.» Es por LOTE Y CICLO y no por lote a
-- secas: el mismo lote se siembra en ciclo 1 y más tarde en ciclo 2, y
-- darlo por cerrado entero escondería el segundo.
--
-- Tabla aparte y no una columna en `lotes_temporada` porque es un HECHO
-- del trasplante —quién lo cerró y cuándo—, no una propiedad del lote.
-- =====================================================================

create table if not exists public.siembras_terminadas (
    lote_temporada_id uuid not null references public.lotes_temporada(id) on delete cascade,
    ciclo             smallint not null check (ciclo between 1 and 3),
    marcado_por       uuid references public.perfiles(id),
    marcado_en        timestamptz not null default now(),
    primary key (lote_temporada_id, ciclo)
);

comment on table public.siembras_terminadas is
'Lote y ciclo que ya no reciben más siembra. Estar en la tabla ES estar terminado: desmarcar borra la fila y no deja un false que haya que interpretar.';

alter table public.siembras_terminadas enable row level security;

drop policy if exists siembras_terminadas_select on public.siembras_terminadas;
create policy siembras_terminadas_select on public.siembras_terminadas for select
    using ((select public.fn_tiene_permiso('trasplante', 'ver')));

drop policy if exists siembras_terminadas_write on public.siembras_terminadas;
create policy siembras_terminadas_write on public.siembras_terminadas for all
    using ((select public.fn_tiene_permiso('trasplante', 'editar')))
    with check ((select public.fn_tiene_permiso('trasplante', 'editar')));

grant select, insert, update, delete on public.siembras_terminadas to authenticated;

/**
 * Marca o desmarca el fin de siembra de un lote y ciclo.
 *
 * Una sola llamada para los dos sentidos: el interruptor manda el estado
 * al que quiere llegar y la función se encarga. Sin `security definer`:
 * la política de arriba exige `trasplante:editar` y es la matriz de
 * permisos la que decide, no un nombre de rol escrito aquí.
 */
create or replace function public.fn_marcar_siembra_terminada(
    p_lote_temporada_id uuid,
    p_ciclo             smallint,
    p_terminado         boolean
) returns boolean
language plpgsql
set search_path = public, pg_temp as $$
begin
    if p_terminado then
        insert into public.siembras_terminadas (lote_temporada_id, ciclo, marcado_por)
        values (p_lote_temporada_id, p_ciclo, auth.uid())
        on conflict (lote_temporada_id, ciclo) do update
            set marcado_por = auth.uid(), marcado_en = now();
    else
        delete from public.siembras_terminadas
        where lote_temporada_id = p_lote_temporada_id and ciclo = p_ciclo;
    end if;
    return p_terminado;
end $$;

grant execute on function public.fn_marcar_siembra_terminada(uuid, smallint, boolean) to authenticated;

-- =====================================================================
-- PARTE D · Los productos aplicados, dentro de la siembra
--
-- Estaban en la base desde la 26 pero no se veían en la tabla: había que
-- abrir la siembra para saber si se aplicó algo. Viajan en la misma
-- consulta, agregados, para no pedir una lista por fila.
-- =====================================================================

create or replace view public.v_siembras as
select
    s.id,
    s.temporada_id,
    s.lote_temporada_id,
    s.fecha_siembra,
    s.semana,
    s.ciclo,
    s.lote_variedad,
    s.avance_mz,
    s.plantas_reportadas,
    s.plantas_mz,
    s.observaciones,
    lo.nomenclatura   as ut,
    lo.nombre         as lote_nombre,
    z.nombre          as zona,
    z.responsable     as encargado,
    v.id              as variedad_id,
    v.nombre          as variedad,
    v.codigo_sap      as variedad_sap,
    v.producto        as cultivo,
    pe.nombre         as usuario_nombre,
    s.usuario_id,
    s.created_at,
    -- Acumulado y cumplimiento POR LOTE Y CICLO, calculados en la base.
    sum(s.avance_mz) over (
        partition by s.lote_temporada_id, s.ciclo
        order by s.fecha_siembra, s.created_at
        rows between unbounded preceding and current row
    ) as acumulado_lote,
    (
        select coalesce(sum(p.area_plan), 0)
        from public.planes_siembra p
        where p.lote_temporada_id = s.lote_temporada_id
          and p.ciclo = s.ciclo
    ) as plan_lote,
    -- Los productos aplicados, como lista. Agregado y no `join`: con el
    -- `join` una siembra con tres productos saldría tres veces y el
    -- total de manzanas se triplicaría.
    coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id',          sp.id,
                   'material_id', sp.material_id,
                   'codigo',      m.codigo,
                   'descripcion', m.descripcion,
                   'cantidad',    sp.cantidad,
                   'unidad',      sp.unidad
               ) order by m.codigo)
        from public.siembra_productos sp
        join public.materiales m on m.id = sp.material_id
        where sp.siembra_id = s.id
    ), '[]'::jsonb) as productos
from public.siembras s
join public.lotes_temporada lt on lt.id = s.lote_temporada_id
join public.lotes lo           on lo.id = lt.lote_id
left join public.zonas z       on z.id = lt.zona_id
join public.variedades v       on v.id = s.variedad_id
left join public.perfiles pe   on pe.id = s.usuario_id;

alter view public.v_siembras set (security_invoker = on);
grant select on public.v_siembras to authenticated;

/**
 * Deja los productos de una siembra EXACTAMENTE como dice la lista.
 *
 * No es un alta ni una baja: es el estado final. Quitar dos, cambiarle
 * la cantidad a uno y agregar otro es una sola llamada y una sola
 * transacción; con tres llamadas sueltas, una red que se corta deja la
 * siembra diciendo que se aplicó algo que ya no está.
 */
create or replace function public.fn_guardar_productos_siembra(
    p_siembra_id uuid,
    p_productos  jsonb
) returns integer
language plpgsql
set search_path = public, pg_temp as $$
declare v_cuantos integer;
begin
    if not exists (select 1 from public.siembras where id = p_siembra_id) then
        raise exception 'Esa siembra ya no existe.';
    end if;

    delete from public.siembra_productos where siembra_id = p_siembra_id;

    insert into public.siembra_productos (siembra_id, material_id, cantidad, unidad)
    select p_siembra_id,
           (x->>'material_id')::uuid,
           nullif(x->>'cantidad', '')::numeric,
           nullif(btrim(coalesce(x->>'unidad', '')), '')
    from jsonb_array_elements(coalesce(p_productos, '[]'::jsonb)) x
    where nullif(x->>'material_id', '') is not null;

    get diagnostics v_cuantos = row_count;
    return v_cuantos;
end $$;

grant execute on function public.fn_guardar_productos_siembra(uuid, jsonb) to authenticated;

-- =====================================================================
-- PARTE E · El avance por UT, con el fin de siembra
--
-- Se recrea entera porque cambia lo que devuelve, y `create or replace`
-- no admite cambiar el tipo de retorno.
-- =====================================================================

drop function if exists public.fn_trasplante_por_ut(uuid, date);

create or replace function public.fn_trasplante_por_ut(
    p_temporada_id uuid,
    p_hasta        date default null
) returns table (
    lote_temporada_id uuid,
    ut                text,
    lote_nombre       text,
    zona              text,
    encargado         text,
    ciclo             smallint,
    variedad          text,
    area_plan         numeric,
    area_real         numeric,
    pct               numeric,
    plantas           numeric,
    primera_fecha     date,
    ultima_fecha      date,
    terminado         boolean
)
language sql stable security invoker
set search_path = public, pg_temp as $$
    with plan as (
        select p.lote_temporada_id, p.ciclo, p.variedad_id, sum(p.area_plan) as area_plan
        from public.planes_siembra p
        where p.temporada_id = p_temporada_id
        group by p.lote_temporada_id, p.ciclo, p.variedad_id
    ),
    real_ as (
        select s.lote_temporada_id, s.ciclo, s.variedad_id,
               sum(s.avance_mz) as area_real,
               sum(s.plantas_reportadas) as plantas,
               min(s.fecha_siembra) as primera,
               max(s.fecha_siembra) as ultima
        from public.siembras s
        where s.temporada_id = p_temporada_id
          and (p_hasta is null or s.fecha_siembra <= p_hasta)
        group by s.lote_temporada_id, s.ciclo, s.variedad_id
    ),
    llaves as (
        select lote_temporada_id, ciclo, variedad_id from plan
        union
        select lote_temporada_id, ciclo, variedad_id from real_
    )
    select
        k.lote_temporada_id,
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        z.responsable,
        k.ciclo,
        v.nombre,
        coalesce(p.area_plan, 0),
        coalesce(r.area_real, 0),
        case when coalesce(p.area_plan, 0) > 0
             then round(coalesce(r.area_real, 0) / p.area_plan * 100, 1) end,
        coalesce(r.plantas, 0),
        r.primera,
        r.ultima,
        (t.lote_temporada_id is not null) as terminado
    from llaves k
    join public.lotes_temporada lt on lt.id = k.lote_temporada_id
    join public.lotes lo           on lo.id = lt.lote_id
    left join public.zonas z       on z.id = lt.zona_id
    join public.variedades v       on v.id = k.variedad_id
    left join plan p  on p.lote_temporada_id = k.lote_temporada_id
                     and p.ciclo = k.ciclo and p.variedad_id = k.variedad_id
    left join real_ r on r.lote_temporada_id = k.lote_temporada_id
                     and r.ciclo = k.ciclo and r.variedad_id = k.variedad_id
    left join public.siembras_terminadas t on t.lote_temporada_id = k.lote_temporada_id
                                          and t.ciclo = k.ciclo
    -- Los departamentos administrativos no se siembran: aunque alguien
    -- les hubiera cargado plan antes de esta migración, no salen.
    where lo.tipo = 'AGRICOLA'
    order by k.ciclo, z.nombre, lo.nomenclatura, v.nombre
$$;

grant execute on function public.fn_trasplante_por_ut(uuid, date) to authenticated;

-- =====================================================================
-- PARTE F · Índices para el historial completo
--
-- Sin el recorte de fechas, «toda la temporada» es la consulta normal.
-- =====================================================================

create index if not exists siembras_temporada_fecha_idx
    on public.siembras (temporada_id, fecha_siembra desc, id desc);

create index if not exists planes_siembra_temporada_idx
    on public.planes_siembra (temporada_id, lote_temporada_id, ciclo);

-- =====================================================================
-- Comprobación
-- =====================================================================
do $$
declare
    v_admin     integer;
    v_con_plan  integer;
    v_sucios    integer;
begin
    select count(*) into v_admin from public.lotes where tipo = 'ADMINISTRATIVO';

    select count(*) into v_con_plan
    from public.planes_siembra p
    join public.lotes_temporada lt on lt.id = p.lote_temporada_id
    join public.lotes lo           on lo.id = lt.lote_id
    where lo.tipo = 'ADMINISTRATIVO';

    select count(*) into v_sucios
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    where lo.tipo = 'ADMINISTRATIVO'
      and (lt.zona_id is not null or coalesce(lt.area_neta, 0) <> 0 or lt.area_bruta is not null);

    raise notice 'Migración 46 aplicada. Departamentos administrativos: %.', v_admin;
    raise notice 'Todos los lotes quedaron como AGRICOLA por defecto: marca los departamentos en Lotes de la temporada.';

    if v_con_plan > 0 then
        raise warning '% líneas de plan de siembra apuntan a departamentos administrativos. Bórralas o vuelve agrícola ese lote.', v_con_plan;
    end if;
    if v_sucios > 0 then
        raise warning '% asignaciones administrativas todavía tienen área o zona.', v_sucios;
    end if;
end $$;
