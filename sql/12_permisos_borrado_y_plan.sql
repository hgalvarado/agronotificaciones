-- =====================================================================
-- AGRONOTIFICACIONES · Migración 12
-- (A) Borrado seguro          (B) Permisos por pantalla y acción
-- (C) Plan de mecanización    (D) Avance contra plan
-- (E) Costo por manzana
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01–11.
-- =====================================================================


-- =====================================================================
-- PARTE A · BORRADO SEGURO
-- =====================================================================
-- El permiso de borrar un lote ya existía desde la migración 06, pero
-- borrar de verdad fallaba igual: un lote está amarrado por su fila de
-- `lotes_temporada`, y esa a su vez por cada línea de labor que lo
-- menciona. Postgres rechazaba el DELETE con un error de llave foránea
-- que en pantalla no dice nada útil.
--
-- Se resuelve con funciones que revisan primero y explican en castellano
-- qué lo está deteniendo, en vez de dejar salir el error crudo.
-- =====================================================================

create or replace function public.fn_eliminar_lote(
    p_lote_id uuid,
    p_forzar  boolean default false
) returns text
language plpgsql security invoker as $$
declare
    v_labores   integer;
    v_temporadas integer;
    v_nombre    text;
begin
    select nomenclatura into v_nombre from public.lotes where id = p_lote_id;
    if v_nombre is null then
        raise exception 'Ese lote ya no existe.';
    end if;

    -- ¿Tiene trabajo registrado? Eso sí no se toca nunca: borrarlo
    -- desaparecería labores ya capturadas y descuadraría los costos.
    select count(*) into v_labores
    from public.registro_detalle rd
    join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
    where lt.lote_id = p_lote_id;

    if v_labores > 0 then
        raise exception
            'No se puede eliminar % porque tiene % línea(s) de labor registradas. Desactívalo en vez de borrarlo para que el histórico no se pierda.',
            v_nombre, v_labores;
    end if;

    select count(*) into v_temporadas
    from public.lotes_temporada where lote_id = p_lote_id;

    -- Está en temporadas pero sin trabajo: se puede, avisando.
    if v_temporadas > 0 and not p_forzar then
        raise exception
            'El lote % está asignado a % temporada(s) pero no tiene labores. Confirma el borrado para quitarlo también de ellas.',
            v_nombre, v_temporadas;
    end if;

    delete from public.planes_mecanizacion pm
    using public.lotes_temporada lt
    where lt.id = pm.lote_temporada_id and lt.lote_id = p_lote_id;

    delete from public.lotes_temporada where lote_id = p_lote_id;
    delete from public.lotes where id = p_lote_id;

    return v_nombre;
end;
$$;

comment on function public.fn_eliminar_lote is
'Borra un lote explicando qué lo impide. Nunca borra un lote con labores registradas.';


-- Quitar un lote de UNA temporada, dejando el lote físico en pie. Es lo
-- que se necesita casi siempre: el lote existe, sólo no va este año.
create or replace function public.fn_quitar_lote_de_temporada(
    p_lote_temporada_id uuid
) returns text
language plpgsql security invoker as $$
declare
    v_labores integer;
    v_nombre  text;
begin
    select lo.nomenclatura into v_nombre
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    where lt.id = p_lote_temporada_id;

    if v_nombre is null then
        raise exception 'Esa asignación de lote ya no existe.';
    end if;

    select count(*) into v_labores
    from public.registro_detalle where lote_temporada_id = p_lote_temporada_id;

    if v_labores > 0 then
        raise exception
            'No se puede quitar % de la temporada: tiene % línea(s) de labor. Desactívalo en vez de borrarlo.',
            v_nombre, v_labores;
    end if;

    delete from public.planes_mecanizacion where lote_temporada_id = p_lote_temporada_id;
    delete from public.lotes_temporada where id = p_lote_temporada_id;
    return v_nombre;
end;
$$;


-- Una labor tampoco se puede borrar si ya se usó; sus vinculaciones sí
-- se llevan por delante, que son configuración y no historia.
create or replace function public.fn_eliminar_labor(p_labor_id uuid)
returns text
language plpgsql security invoker as $$
declare
    v_usos  integer;
    v_nombre text;
begin
    select nombre into v_nombre from public.labores where id = p_labor_id;
    if v_nombre is null then
        raise exception 'Esa labor ya no existe.';
    end if;

    select count(*) into v_usos from public.registros where labor_id = p_labor_id;
    if v_usos > 0 then
        raise exception
            'No se puede eliminar «%» porque está usada en % registro(s). Desactívala para que deje de aparecer en los formularios sin perder el histórico.',
            v_nombre, v_usos;
    end if;

    delete from public.labores_tareas where labor_id = p_labor_id;
    delete from public.labores_implementos where labor_id = p_labor_id;
    delete from public.labores where id = p_labor_id;
    return v_nombre;
end;
$$;

-- Faltaba la policy de borrado de labores (06 sólo cubrió las tablas
-- puente labores_tareas y labores_implementos).
drop policy if exists labores_delete on public.labores;
create policy labores_delete on public.labores for delete
    using ((select public.fn_es_admin()));


-- =====================================================================
-- PARTE B · PERMISOS POR PANTALLA Y ACCIÓN
-- =====================================================================
-- La matriz original mezclaba recursos de tabla ('catalogo_equipos') con
-- recursos de pantalla, y las acciones eran las de SQL (create/read/…).
-- Para el panel que él quiere —«al digitador quiero activarle Costos»—
-- lo natural es razonar por PANTALLA y en castellano.
--
-- Se agregan los recursos de pantalla sin borrar los viejos: las policies
-- de la migración 02 siguen preguntando por 'catalogo_equipos' y demás, y
-- si se borraran, Torre de Control perdería el acceso a los catálogos.
-- =====================================================================

create table if not exists public.pantallas (
    codigo      text primary key,
    nombre      text not null,
    descripcion text,
    ruta        text,
    orden       smallint not null default 0,
    -- Acciones que tienen sentido en esta pantalla. No todas las
    -- pantallas admiten todo: en «Avance» no hay nada que crear.
    acciones    text[] not null default array['ver','crear','editar','eliminar','descargar']
);

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('tickets',    'Tickets',      'Jornadas de maquinaria', '/tickets', 10,
        array['ver','crear','editar','eliminar','descargar']),
    ('horometros', 'Horómetros',   'Control de horómetros y comparativo', '/horometros', 20,
        array['ver','editar','eliminar','descargar']),
    ('labores',    'Labores',      'Control de labores registradas', '/labores', 30,
        array['ver','editar','eliminar','descargar']),
    ('avance',     'Avance',       'Avance por categoría de labor', '/dashboard', 40,
        array['ver','descargar']),
    ('plan',       'Plan',         'Plan de mecanización y avance diario', '/plan', 50,
        array['ver','crear','editar','eliminar','descargar']),
    ('costos',     'Costos',       'Costo de las labores por tarifa', '/costos', 60,
        array['ver','descargar']),
    ('tarifas',    'Tarifas',      'Tarifas por puesto de trabajo', '/admin/tarifas', 70,
        array['ver','crear','editar','eliminar','descargar']),
    ('catalogos',  'Catálogos',    'Datos maestros', '/admin/catalogos', 80,
        array['ver','crear','editar','eliminar','descargar']),
    ('lotes',      'Lotes',        'Lotes de la temporada', '/admin/lotes', 90,
        array['ver','crear','editar','eliminar','descargar']),
    ('usuarios',   'Usuarios',     'Alta y baja de usuarios', '/admin/usuarios', 100,
        array['ver','crear','editar','eliminar']),
    ('permisos',   'Permisos',     'Esta misma pantalla', '/admin/permisos', 110,
        array['ver','editar'])
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta = excluded.ruta,
    orden = excluded.orden,
    acciones = excluded.acciones;

alter table public.pantallas enable row level security;
drop policy if exists pantallas_select on public.pantallas;
create policy pantallas_select on public.pantallas for select
    using ((select auth.uid()) is not null);

-- Semilla: lo que cada rol puede hacer hoy, tal cual funciona la app.
-- El Administrador no se siembra porque `fn_tiene_permiso` le da todo.
insert into public.permisos (rol_id, recurso, accion)
select r.id, x.recurso, x.accion
from public.roles r
cross join (values
    -- Torre de Control: ve y corrige todo, no borra.
    ('TORRE_CONTROL','tickets','ver'),      ('TORRE_CONTROL','tickets','editar'),
    ('TORRE_CONTROL','tickets','descargar'),
    ('TORRE_CONTROL','horometros','ver'),   ('TORRE_CONTROL','horometros','editar'),
    ('TORRE_CONTROL','horometros','descargar'),
    ('TORRE_CONTROL','labores','ver'),      ('TORRE_CONTROL','labores','editar'),
    ('TORRE_CONTROL','labores','descargar'),
    ('TORRE_CONTROL','avance','ver'),       ('TORRE_CONTROL','avance','descargar'),
    ('TORRE_CONTROL','plan','ver'),         ('TORRE_CONTROL','plan','crear'),
    ('TORRE_CONTROL','plan','editar'),      ('TORRE_CONTROL','plan','descargar'),
    ('TORRE_CONTROL','costos','ver'),       ('TORRE_CONTROL','costos','descargar'),
    ('TORRE_CONTROL','tarifas','ver'),      ('TORRE_CONTROL','tarifas','crear'),
    ('TORRE_CONTROL','tarifas','editar'),   ('TORRE_CONTROL','tarifas','descargar'),
    ('TORRE_CONTROL','catalogos','ver'),    ('TORRE_CONTROL','catalogos','crear'),
    ('TORRE_CONTROL','catalogos','editar'), ('TORRE_CONTROL','catalogos','descargar'),
    ('TORRE_CONTROL','lotes','ver'),        ('TORRE_CONTROL','lotes','crear'),
    ('TORRE_CONTROL','lotes','editar'),     ('TORRE_CONTROL','lotes','descargar'),
    -- Digitador: captura lo suyo y ve su avance. Sin costos ni tarifas
    -- (se los puede activar desde el panel cuando él quiera).
    ('DIGITADOR','tickets','ver'),          ('DIGITADOR','tickets','crear'),
    ('DIGITADOR','tickets','editar'),
    ('DIGITADOR','avance','ver')
) as x(rol_codigo, recurso, accion)
where r.codigo = x.rol_codigo
on conflict (rol_id, recurso, accion) do nothing;


-- Lo que la app necesita para dibujar el menú y esconder botones.
-- El Administrador recibe TODAS las combinaciones aunque no estén en la
-- tabla, que es exactamente como se comporta `fn_tiene_permiso`.
create or replace function public.fn_mis_permisos()
returns table (recurso text, accion text)
language sql stable security definer as $$
    select p.codigo, a.accion
    from public.pantallas p
    cross join lateral unnest(p.acciones) as a(accion)
    where public.fn_es_admin()

    union

    select pm.recurso, pm.accion
    from public.perfiles pe
    join public.permisos pm on pm.rol_id = pe.rol_id
    -- Sólo los recursos que son PANTALLAS. La tabla `permisos` sigue
    -- guardando también los recursos viejos por tabla ('catalogo_equipos',
    -- 'ticket'…) que usan las policies de la migración 02; si se colaran
    -- aquí, el menú intentaría dibujar pantallas que no existen.
    join public.pantallas pa on pa.codigo = pm.recurso
    where pe.id = (select auth.uid())
$$;

comment on function public.fn_mis_permisos is
'Permisos efectivos del usuario actual. El Administrador los recibe todos.';


-- Los costos dejan de estar amarrados al rol y pasan a depender del
-- permiso, que es lo que hace posible activárselos al Digitador desde el
-- panel sin tocar código.
drop policy if exists tarifas_puesto_select on public.tarifas_puesto;
create policy tarifas_puesto_select on public.tarifas_puesto for select
    using ((select public.fn_tiene_permiso('costos','ver'))
        or (select public.fn_tiene_permiso('tarifas','ver')));

drop policy if exists tarifas_puesto_insert on public.tarifas_puesto;
create policy tarifas_puesto_insert on public.tarifas_puesto for insert
    with check ((select public.fn_tiene_permiso('tarifas','crear')));

drop policy if exists tarifas_puesto_update on public.tarifas_puesto;
create policy tarifas_puesto_update on public.tarifas_puesto for update
    using ((select public.fn_tiene_permiso('tarifas','editar')));

drop policy if exists tarifas_puesto_delete on public.tarifas_puesto;
create policy tarifas_puesto_delete on public.tarifas_puesto for delete
    using ((select public.fn_tiene_permiso('tarifas','eliminar')));

-- Las notificaciones también: quien revisa es quien las necesita.
drop policy if exists notificaciones_select on public.notificaciones;
create policy notificaciones_select on public.notificaciones for select
    using ((select public.fn_tiene_permiso('tickets','editar')));

-- La matriz de permisos ya quedó bien cubierta en la migración 02
-- (`permisos_select_all` de lectura y `permisos_write_admin` para toda
-- escritura, sólo Administrador). No se agrega nada aquí: una policy de
-- más sólo suma condiciones con OR y confunde a quien la lea después.


-- =====================================================================
-- PARTE C · PLAN DE MECANIZACIÓN
-- =====================================================================
-- Hasta ahora el avance se medía contra `lotes_temporada.area_neta`, que
-- es el área FÍSICA del lote. Henry lo dijo claro: el área de trabajo es
-- otra cosa. Un lote de 10.72 mz brutas puede tener 11.84 mz planificadas
-- para emplasticar, y otro de 22.20 brutas sólo 19.03.
--
-- El plan va por lote, por CATEGORÍA DE LABOR y por etapa:
--   · por categoría, porque el plan de emplasticado no es el de
--     preparación de tierra, y cada uno se mide contra lo suyo;
--   · por etapa, porque el reporte que él manda a gerencia resume
--     justamente «Etapa 1 / 2 / 3» por zona.
-- =====================================================================

create table if not exists public.planes_mecanizacion (
    id                 uuid primary key default gen_random_uuid(),
    temporada_id       uuid not null references public.temporadas(id) on delete cascade,
    lote_temporada_id  uuid not null references public.lotes_temporada(id) on delete cascade,
    categoria_labor_id uuid not null references public.categorias_labor(id) on delete cascade,
    etapa              smallint not null check (etapa in (1, 2, 3)),
    area_plan          numeric(10,2) not null check (area_plan >= 0),
    con_moto           boolean,          -- null = no aplica / no definido
    comentario         text,
    created_by         uuid references public.perfiles(id) default auth.uid(),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    -- Un lote puede estar planificado en más de una etapa, pero no dos
    -- veces en la misma para la misma categoría.
    unique (lote_temporada_id, categoria_labor_id, etapa)
);

create index if not exists planes_mecanizacion_busqueda_idx
    on public.planes_mecanizacion (temporada_id, categoria_labor_id, etapa);

alter table public.planes_mecanizacion enable row level security;

drop policy if exists planes_select on public.planes_mecanizacion;
create policy planes_select on public.planes_mecanizacion for select
    using ((select public.fn_tiene_permiso('plan','ver')));
drop policy if exists planes_insert on public.planes_mecanizacion;
create policy planes_insert on public.planes_mecanizacion for insert
    with check ((select public.fn_tiene_permiso('plan','crear')));
drop policy if exists planes_update on public.planes_mecanizacion;
create policy planes_update on public.planes_mecanizacion for update
    using ((select public.fn_tiene_permiso('plan','editar')));
drop policy if exists planes_delete on public.planes_mecanizacion;
create policy planes_delete on public.planes_mecanizacion for delete
    using ((select public.fn_tiene_permiso('plan','eliminar')));

-- La etapa y la moto también se capturan en la línea diaria, para poder
-- comparar lo planificado contra lo realmente ejecutado.
alter table public.registro_detalle
    add column if not exists etapa smallint;
alter table public.registro_detalle drop constraint if exists registro_detalle_etapa_check;
alter table public.registro_detalle
    add constraint registro_detalle_etapa_check check (etapa is null or etapa in (1, 2, 3));

alter table public.registro_detalle
    add column if not exists con_moto boolean;

-- Proveedores de insumo, que el reporte diario muestra por lote.
create table if not exists public.proveedores (
    id     uuid primary key default gen_random_uuid(),
    nombre text not null,
    tipo   text not null check (tipo in ('PLASTICO', 'MANGUERA', 'OTRO')),
    activo boolean not null default true,
    unique (nombre, tipo)
);

alter table public.proveedores enable row level security;
drop policy if exists proveedores_select on public.proveedores;
create policy proveedores_select on public.proveedores for select
    using ((select auth.uid()) is not null);
drop policy if exists proveedores_write on public.proveedores;
create policy proveedores_write on public.proveedores for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));
drop policy if exists proveedores_update on public.proveedores;
create policy proveedores_update on public.proveedores for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));
drop policy if exists proveedores_delete on public.proveedores;
create policy proveedores_delete on public.proveedores for delete
    using ((select public.fn_tiene_permiso('catalogos','eliminar')));

alter table public.registro_detalle
    add column if not exists proveedor_plastico_id uuid references public.proveedores(id);
alter table public.registro_detalle
    add column if not exists proveedor_manguera_id uuid references public.proveedores(id);

-- El Elemento PEP del reporte es la nomenclatura del lote + el código de
-- la temporada (1001-010-0015).
alter table public.temporadas add column if not exists codigo_pep text;


-- =====================================================================
-- PARTE D · AVANCE CONTRA PLAN
-- =====================================================================

-- Avance ejecutado por lote y categoría: la suma de manzanas de las
-- líneas de labor cuya labor pertenece a esa categoría.
create or replace view public.v_avance_ejecutado as
select
    rd.lote_temporada_id,
    lb.categoria_labor_id,
    rd.etapa,
    sum(rd.avance_mz)                        as mz_avance,
    min(rd.fecha)                            as fecha_inicio,
    max(rd.fecha)                            as fecha_ultima,
    count(*)                                 as lineas,
    bool_or(coalesce(rd.con_moto, false))    as uso_moto
from public.registro_detalle rd
join public.registros r on r.id = rd.registro_id
join public.labores lb   on lb.id = r.labor_id
where rd.avance_mz is not null
group by rd.lote_temporada_id, lb.categoria_labor_id, rd.etapa;

alter view public.v_avance_ejecutado set (security_invoker = on);


-- El «Resumen por lote» del reporte, lote por lote.
create or replace function public.fn_plan_avance_lote(
    p_temporada_id       uuid,
    p_categoria_labor_id uuid
) returns table (
    lote_temporada_id uuid,
    ut                text,
    nomenclatura      text,
    zona              text,
    encargado         text,
    elemento_pep      text,
    area_bruta        numeric,
    area_neta         numeric,
    etapa_plan        smallint,
    area_plan         numeric,
    con_moto_plan     boolean,
    mz_avance         numeric,
    mz_pendiente      numeric,
    pct_avance        numeric,
    uso_moto          boolean,
    fecha_inicio      date,
    fecha_ultima      date,
    proveedor_plastico text,
    proveedor_manguera text
)
language sql stable security invoker as $$
    with plan as (
        select pm.lote_temporada_id,
               min(pm.etapa)                     as etapa_plan,
               sum(pm.area_plan)                 as area_plan,
               bool_or(coalesce(pm.con_moto, false)) as con_moto_plan
        from public.planes_mecanizacion pm
        where pm.temporada_id = p_temporada_id
          and pm.categoria_labor_id = p_categoria_labor_id
        group by pm.lote_temporada_id
    ),
    hecho as (
        select ae.lote_temporada_id,
               sum(ae.mz_avance)   as mz_avance,
               min(ae.fecha_inicio) as fecha_inicio,
               max(ae.fecha_ultima) as fecha_ultima,
               bool_or(ae.uso_moto) as uso_moto
        from public.v_avance_ejecutado ae
        where ae.categoria_labor_id = p_categoria_labor_id
        group by ae.lote_temporada_id
    ),
    -- Los proveedores del lote se juntan en una sola celda, como en el
    -- Excel donde aparecen separados por «|».
    provs as (
        select rd.lote_temporada_id,
               string_agg(distinct pp.nombre, ' | ') as plastico,
               string_agg(distinct pmg.nombre, ' | ') as manguera
        from public.registro_detalle rd
        join public.registros r on r.id = rd.registro_id
        join public.labores lb on lb.id = r.labor_id
        left join public.proveedores pp  on pp.id = rd.proveedor_plastico_id
        left join public.proveedores pmg on pmg.id = rd.proveedor_manguera_id
        where lb.categoria_labor_id = p_categoria_labor_id
        group by rd.lote_temporada_id
    )
    select
        lt.id,
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        z.responsable,
        lo.nomenclatura || coalesce('-' || t.codigo_pep, ''),
        lt.area_bruta,
        lt.area_neta,
        pl.etapa_plan,
        pl.area_plan,
        pl.con_moto_plan,
        coalesce(h.mz_avance, 0),
        -- Nunca negativo: si se ejecutó de más, el pendiente es cero y el
        -- exceso se ve en el porcentaje.
        greatest(coalesce(pl.area_plan, 0) - coalesce(h.mz_avance, 0), 0),
        case when coalesce(pl.area_plan, 0) > 0
             then round(coalesce(h.mz_avance, 0) * 100.0 / pl.area_plan, 2)
             else null end,
        h.uso_moto,
        h.fecha_inicio,
        h.fecha_ultima,
        pr.plastico,
        pr.manguera
    from public.lotes_temporada lt
    join public.lotes lo      on lo.id = lt.lote_id
    join public.temporadas t  on t.id = lt.temporada_id
    left join public.zonas z  on z.id = lt.zona_id
    left join plan pl  on pl.lote_temporada_id = lt.id
    left join hecho h  on h.lote_temporada_id = lt.id
    left join provs pr on pr.lote_temporada_id = lt.id
    where lt.temporada_id = p_temporada_id
      and lt.activo
      -- Sale el lote si está planificado o si ya tiene trabajo: los que
      -- no van este año en esta categoría no ensucian el reporte.
      and (pl.lote_temporada_id is not null or h.lote_temporada_id is not null)
    order by lo.nomenclatura
$$;


-- «Avance por zona» del reporte: zona x etapa, con su encargado.
create or replace function public.fn_avance_por_zona_etapa(
    p_temporada_id       uuid,
    p_categoria_labor_id uuid
) returns table (
    zona       text,
    encargado  text,
    etapa      smallint,
    area_plan  numeric,
    mz_avance  numeric,
    pct_avance numeric
)
language sql stable security invoker as $$
    with plan as (
        select lt.zona_id, pm.etapa, sum(pm.area_plan) as area_plan
        from public.planes_mecanizacion pm
        join public.lotes_temporada lt on lt.id = pm.lote_temporada_id
        where pm.temporada_id = p_temporada_id
          and pm.categoria_labor_id = p_categoria_labor_id
        group by lt.zona_id, pm.etapa
    ),
    -- El avance se atribuye a la etapa que trae la línea diaria; si no
    -- la trae, a la etapa en que el lote está planificado.
    hecho as (
        select lt.zona_id,
               coalesce(rd.etapa, pm.etapa) as etapa,
               sum(rd.avance_mz) as mz_avance
        from public.registro_detalle rd
        join public.registros r  on r.id = rd.registro_id
        join public.labores lb   on lb.id = r.labor_id
        join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
        left join public.planes_mecanizacion pm
               on pm.lote_temporada_id = rd.lote_temporada_id
              and pm.categoria_labor_id = lb.categoria_labor_id
        where lt.temporada_id = p_temporada_id
          and lb.categoria_labor_id = p_categoria_labor_id
          and rd.avance_mz is not null
        group by lt.zona_id, coalesce(rd.etapa, pm.etapa)
    )
    select
        z.nombre,
        z.responsable,
        coalesce(p.etapa, h.etapa),
        coalesce(p.area_plan, 0),
        coalesce(h.mz_avance, 0),
        case when coalesce(p.area_plan, 0) > 0
             then round(coalesce(h.mz_avance, 0) * 100.0 / p.area_plan, 2)
             else null end
    from plan p
    full outer join hecho h on h.zona_id = p.zona_id and h.etapa = p.etapa
    left join public.zonas z on z.id = coalesce(p.zona_id, h.zona_id)
    order by z.nombre, coalesce(p.etapa, h.etapa)
$$;


-- El detalle diario: una fila por línea de labor con manzanas.
create or replace view public.v_avance_diario as
select
    rd.id                as detalle_id,
    rd.fecha,
    lo.nomenclatura      as ut,
    lo.nombre            as nomenclatura,
    z.nombre             as zona,
    z.responsable        as encargado,
    rd.etapa,
    rd.ciclo,
    rd.con_moto,
    rd.avance_mz,
    lb.id                as labor_id,
    lb.nombre            as labor_nombre,
    lb.categoria_labor_id,
    cl.nombre            as categoria_labor,
    e.codigo             as equipo_codigo,
    o.nombre             as operador_nombre,
    pp.nombre            as proveedor_plastico,
    pmg.nombre           as proveedor_manguera,
    t.id                 as temporada_id,
    tk.codigo            as ticket_codigo,
    tk.proceso           as ticket_proceso,
    pe.nombre            as usuario_nombre,
    rd.lote_temporada_id
from public.registro_detalle rd
join public.registros r          on r.id = rd.registro_id
join public.labores lb           on lb.id = r.labor_id
left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
join public.lotes_temporada lt   on lt.id = rd.lote_temporada_id
join public.lotes lo             on lo.id = lt.lote_id
join public.temporadas t         on t.id = lt.temporada_id
left join public.zonas z         on z.id = lt.zona_id
join public.horometros h         on h.id = r.horometro_id
join public.equipos e            on e.id = h.equipo_id
left join public.operadores o    on o.id = h.operador_id
left join public.proveedores pp  on pp.id = rd.proveedor_plastico_id
left join public.proveedores pmg on pmg.id = rd.proveedor_manguera_id
join public.tickets tk           on tk.id = r.ticket_id
left join public.perfiles pe     on pe.id = r.usuario_id
where rd.avance_mz is not null;

alter view public.v_avance_diario set (security_invoker = on);


-- =====================================================================
-- PARTE E · COSTO POR MANZANA
-- =====================================================================
-- «cuánto dinero se gastó entre las mz que hizo». Las manzanas viven en
-- el detalle (una labor puede cubrir varios lotes), así que se suman por
-- registro antes de cruzarlas con el costo.
-- =====================================================================

drop view if exists public.v_costos_labores;

create view public.v_costos_labores as
with mz as (
    select registro_id, sum(avance_mz) as mz
    from public.registro_detalle
    where avance_mz is not null
    group by registro_id
),
lineas as (
    select
        r.id                                          as registro_id,
        r.ticket_id,
        r.fecha,
        r.temporada_id,
        coalesce(r.horas_notificadas, h.horas_maquina) as horas,
        mz.mz                                         as mz,
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
    left join mz on mz.registro_id = r.id
    left join public.familias_equipo fe on fe.id = e.familia_id
    left join public.puestos_trabajo pf on pf.id = fe.puesto_trabajo_id
    left join public.implementos im on im.id = r.implemento_id
    left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
    join public.labores lb   on lb.id = r.labor_id
    left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
    join public.tareas_sap ts on ts.id = r.tarea_id
    join public.tickets t    on t.id = r.ticket_id
),
ambas as (
    select registro_id, ticket_id, ticket_codigo, ticket_proceso, fecha, temporada_id,
           equipo_codigo, labor_nombre, categoria_labor, tarea_codigo, horas, mz,
           'EQUIPO'::text as concepto,
           puesto_equipo  as puesto,
           public.fn_tarifa_vigente(puesto_equipo_id, fecha) as costo_hora
    from lineas
    where puesto_equipo_id is not null

    union all

    select registro_id, ticket_id, ticket_codigo, ticket_proceso, fecha, temporada_id,
           equipo_codigo, labor_nombre, categoria_labor, tarea_codigo, horas, mz,
           'IMPLEMENTO'::text,
           puesto_implemento,
           public.fn_tarifa_vigente(puesto_implemento_id, fecha)
    from lineas
    where puesto_implemento_id is not null
)
select
    registro_id, ticket_id, ticket_codigo, ticket_proceso, fecha, temporada_id,
    equipo_codigo, labor_nombre, categoria_labor, tarea_codigo, horas, mz,
    concepto, puesto, costo_hora,
    round(horas * coalesce(costo_hora, 0), 2) as costo,
    -- Costo por manzana de esta línea. Null cuando la labor no midió
    -- manzanas (no todas se miden en área) para no dividir entre cero ni
    -- inventar un indicador que no aplica.
    case when coalesce(mz, 0) > 0
         then round(horas * coalesce(costo_hora, 0) / mz, 2)
         else null end as costo_mz
from ambas;

alter view public.v_costos_labores set (security_invoker = on);

comment on view public.v_costos_labores is
'Costo por línea: horas de la labor x tarifa vigente del puesto. Cada labor
produce una línea por el equipo y otra por el implemento. `mz` son las
manzanas de la labor completa (suma de todos sus lotes) y `costo_mz` el
costo por manzana de esa línea.';
