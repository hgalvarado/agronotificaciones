-- =====================================================================
-- MIGRACIÓN 19 · Costos por lote y encargado, código físico de
--                implemento y horas hombre por omisión
-- =====================================================================
-- Tres pedidos suyos:
--
--   1. «Implementar agrupación y filtros por lote y por encargado en la
--      vista de costos… mostrar por labor: manzanas ejecutadas, costo
--      subtotal, costo total de la categoría y el % que representa cada
--      labor.»
--      → PARTE A: la vista de costos baja al grano del LOTE.
--
--   2. «Asignar automáticamente horas hombre = 8 por defecto al procesar
--      las filas del Excel.»
--      → PARTE D.
--
--   3. «Añadir el código físico de implemento… elegir ROMSR-01 o
--      ROMSR-08 en lugar de sólo Romplow… cada código se asignará por
--      las labores, en la pestaña vinculación de labores.»
--      → PARTES B y C.
-- =====================================================================


-- =====================================================================
-- PARTE B · CATÁLOGO DE IMPLEMENTOS FÍSICOS
-- =====================================================================
-- «en lugar de solo "Romplow", elegir "ROMSR-01" o "ROMSR-08"»
--
-- Hay dos cosas distintas y hasta ahora sólo existía una:
--
--   * `implementos` es el TIPO, y lo que cuelga de él es el puesto de
--     trabajo SAP —o sea la tarifa—. Romplow cuesta lo mismo por hora
--     sea el 01 o el 08, así que el costeo se queda aquí y no cambia.
--   * `implementos_fisicos` es la MÁQUINA concreta: ROMSR-01, ROMSR-08.
--     Sirve para saber qué fierro salió a trabajar —mantenimiento,
--     disponibilidad, a quién reclamarle— no para costear.
--
-- Se separan a propósito. Si el código físico viviera en `implementos`,
-- habría que darle tarifa a cada uno de los 94 y mantener 94 puestos de
-- trabajo donde SAP sólo reconoce uno.
-- =====================================================================

create table if not exists public.implementos_fisicos (
    id             uuid primary key default gen_random_uuid(),
    codigo         text not null unique,          -- 'ROMSR-01'
    descripcion    text not null,                 -- 'Romplow 01 Amco 34 Discos'
    tipo_equipo    text not null default 'Implementos',
    -- Tipo genérico al que pertenece, que es de donde sale la tarifa.
    -- Nullable: el código físico sirve igual sin vincularlo, y así se
    -- puede cargar el catálogo completo antes de emparejarlo.
    implemento_id  uuid references public.implementos(id),
    activo         boolean not null default true
);

comment on table public.implementos_fisicos is
    'La máquina concreta (ROMSR-01, ROMSR-08). El tipo y su tarifa SAP viven en `implementos`.';

alter table public.implementos_fisicos enable row level security;

drop policy if exists implementos_fisicos_select on public.implementos_fisicos;
create policy implementos_fisicos_select on public.implementos_fisicos for select
    using ((select auth.uid()) is not null);

drop policy if exists implementos_fisicos_write on public.implementos_fisicos;
create policy implementos_fisicos_write on public.implementos_fisicos for insert
    with check ((select public.fn_tiene_permiso('catalogo_implementos','create')));

drop policy if exists implementos_fisicos_update on public.implementos_fisicos;
create policy implementos_fisicos_update on public.implementos_fisicos for update
    using ((select public.fn_tiene_permiso('catalogo_implementos','update')));

drop policy if exists implementos_fisicos_delete on public.implementos_fisicos;
create policy implementos_fisicos_delete on public.implementos_fisicos for delete
    using ((select public.fn_es_admin()));


-- El catálogo que él entregó. `do nothing` para que la migración se
-- pueda volver a correr y para no pisar lo que él haya corregido.
insert into public.implementos_fisicos (codigo, descripcion) values
    ('ARDSR-02', 'ARDSR-02 Arado de 28 Discos'),
    ('BCJA-A01', 'Boon Convencional Jacto A01'),
    ('BCJA-A02', 'Boon Inyector Jacto A02'),
    ('BCJA-A03', 'Boon Convencional Jacto A03'),
    ('BCJA-A04', 'Boon Inyector Jacto A04'),
    ('BCJA-A05', 'Boon Convencional Jacto A05'),
    ('BCJA-A06', 'Boon Inyector Jacto A06'),
    ('BCJA-A07', 'Boon Inyector Jacto A07'),
    ('BCJA-A08', 'Boon Inyector Jacto A08'),
    ('BCJA-A09', 'Boon Inyector Jacto A09'),
    ('BCJA-A11', 'Boon Convencional Jacto A11'),
    ('BCJA-A12', 'Boon Convencional Jacto A12'),
    ('BCJA-A13', 'Boon Convencional Jacto A13'),
    ('BCJA-A14', 'Boon Inyector Jacto A14'),
    ('BCJA-A15', 'Boon Convencional Jacto A15'),
    ('BCJA-A34', 'Boon Inyector Jacto A34'),
    ('BCJA-A35', 'Boon Inyector Jacto A35'),
    ('BCJA-A36', 'Boon Inyector Jacto A36'),
    ('BCJA-A37', 'Boon Inyector Jacto A37'),
    ('BCJA-A38', 'Boon Inyector Jacto A38'),
    ('BCJA-A41', 'Boon Inyector Jacto A41'),
    ('BCJA-A42', 'Boon Inyector Jacto A42'),
    ('BCJA-A60', 'Boon Jacto Falcon Aire A60'),
    ('BCJA-A61', 'Boon Jacto Falcon Aire A61'),
    ('BCJA-A62', 'Boon Jacto Hidraulico A62'),
    ('BCJA-A63', 'Boon Jacto Hidraulico A63'),
    ('BCJA-A64', 'Boon Jacto Falcon Aire A64'),
    ('BCJA-A65', 'Boon Jacto Falcon Aire A65'),
    ('BCJA-A69', 'BOOM CONVENCIONAL CHINO'),
    ('BEES-A01', 'Boon Electroestatico A01'),
    ('BEES-A02', 'Boon Electroestatico A02'),
    ('BEES-A06', 'Boon Electroestatico A06'),
    ('BEES-A08', 'Boon Electroestatico A08'),
    ('BESS-A09', 'Boon Electroestatico A09'),
    ('BEES-A10', 'Boon Electroestatico A10'),
    ('BFAP-A02', 'Boom Fumigador de Alta Propulsión 01 HAGIE'),
    ('BFRA-A01', 'Boon Frances VERTHOUD A01'),
    ('BFRA-A02', 'Boon Frances VERTHOUD A02'),
    ('BFRA-A03', 'Boon Frances VERTHOUD A03'),
    ('BFRA-A24', 'Boon Frances Vortex Jacto A24'),
    ('BRDSR-01', 'Bordeadora de Disco A01'),
    ('BRDSR-02', 'Bordeadora de Disco A02'),
    ('BRDSR-03', 'Bordeadora de Disco A03'),
    ('BRDSR-04', 'Bordeadora de Disco A04'),
    ('CHASR-01', 'CHASR-01 Chapiadora Hiniker CHIRLAQUE ESPAÑOLA'),
    ('CHASR-02', 'CHASR-02 Chapiadora Hiniker CHIRLAQUE ESPAÑOLA'),
    ('CHASR-06', 'PICADORA DE FORRAJE MAIZ'),
    ('CHASSR-08', 'CHASR-08 Chapiadora BYG-180 CHINA'),
    ('CLTSR-01', 'Cultivadora Pata Piche 01'),
    ('CLTSR-02', 'Cultivadora de Disco 02'),
    ('COSSR-01', 'Cosechadora de Melon'),
    ('CRGSR-01', 'Corta Guia 01'),
    ('CRGSR-02', 'Corta Guia 02'),
    ('EMPSR-03', 'Emplasticadora Sencilla de 1 cama 03'),
    ('EMPSR-09', 'Emplasticadora Sencilla de 1 cama 09'),
    ('EMPSR-10', 'Emplasticadora'),
    ('EMPSR-12', 'Emplasticadora Triple 12'),
    ('EMPSR-14', 'Emplasticadora Triple 14'),
    ('FERSR-03', 'Encaladora Triple 03'),
    ('NIVSR-01', 'Niveladora 16 Pies'),
    ('PRTSR-01', 'Paratil 01'),
    ('PRTSR-02', 'Paratil 02'),
    ('RASR-01', 'Rastra Roma 01'),
    ('RASSR-05', 'RASSR-05 RASTRA INTEGRAL MX660 S/N 10006'),
    ('RASSR-06', 'RASSR-06 RASTRA ROMA TATU de 12x36, CIVE'),
    ('RFPSR-01', 'Reforzadora de Plastico 01'),
    ('RFPSR-02', 'Reforzadora de Plastico 02'),
    ('ROMSR-01', 'Romplow 01 Amco 34 Discos'),
    ('ROMSR-08', 'Romplow 08 Amco 34 Discos'),
    ('ROMSR-09', 'Romplow 09 Amco'),
    ('ROMSR-12', 'Romplow 12 SIVEMASA'),
    ('ROMSR-13', 'Romplow 13 SIVEMASA'),
    ('RTVSR-25', 'Rotavators HOWARD 25'),
    ('RTVSR-26', 'Rotavators HOWARD 26'),
    ('RTVSR-27', 'Rotavators MASCHIO 27'),
    ('RTVSR-28', 'Rotavators MASCHIO 28'),
    ('RTVSR-29', 'Rotavators MASCHIO 29'),
    ('RTVSR-30', 'Rotavators MASCHIO 30'),
    ('RTVSR-31', 'Rotavators MASCHIO 31'),
    ('RTVSR-32', 'Rotavators MASCHIO 32'),
    ('RTVSR', 'Rotavators MASCHIO 33'),
    ('RTVSR-34', 'Rotavators MASCHIO 34'),
    ('RTVSR-35', 'Rotavators MASCHIO 35'),
    ('RTVSR-36', 'Rotavators MASCHIO 36'),
    ('SBSSR-01', 'Subsolador Integral John deere 01'),
    ('SBSSR-02', 'Subsolador Integral John deere 01'),
    ('SMAIZ-10', 'Sembradora de Maiz 10'),
    ('SPLSR-01', 'SacaPlastico 01'),
    ('SRCSR-01', 'Sucadora de 4 Marcadores 01'),
    ('SRCSR-02', 'Sucardor Bordeador Triple 02'),
    ('TAGSR-09', 'Tanque Repartir Combustible'),
    ('TRSR-001', 'Troco Acarreo'),
    ('TRSR-055', 'Tren Aseo Inocidad'),
    ('TSASR-05', 'Sanitarios Moviles')
on conflict (codigo) do nothing;


-- =====================================================================
-- PARTE C · QUÉ CÓDIGOS APLICAN A CADA LABOR
-- =====================================================================
-- «cada codigo de implemento se asignara por las labores, en la pestaña
--  vinculacion de labores»
--
-- Misma idea que `labores_implementos`, un nivel más abajo: al capturar
-- el emplasticado sólo se ofrecen las emplasticadoras, no los 94
-- fierros. Sin esto el selector sería una lista de 94 y el digitador
-- elegiría el equivocado.
-- =====================================================================

create table if not exists public.labores_implementos_fisicos (
    labor_id              uuid not null references public.labores(id) on delete cascade,
    implemento_fisico_id  uuid not null references public.implementos_fisicos(id) on delete cascade,
    primary key (labor_id, implemento_fisico_id)
);

alter table public.labores_implementos_fisicos enable row level security;

drop policy if exists lab_impl_fis_select on public.labores_implementos_fisicos;
create policy lab_impl_fis_select on public.labores_implementos_fisicos for select
    using ((select auth.uid()) is not null);

drop policy if exists lab_impl_fis_write on public.labores_implementos_fisicos;
create policy lab_impl_fis_write on public.labores_implementos_fisicos for insert
    with check ((select public.fn_tiene_permiso('catalogo_implementos','create')));

drop policy if exists lab_impl_fis_delete on public.labores_implementos_fisicos;
create policy lab_impl_fis_delete on public.labores_implementos_fisicos for delete
    using ((select public.fn_tiene_permiso('catalogo_implementos','update')));

create index if not exists idx_lab_impl_fis_labor
    on public.labores_implementos_fisicos (labor_id);


-- La labor capturada guarda QUÉ fierro salió. Nullable: la mayoría de
-- las labores no llevan implemento, y las que sí lo llevan pueden
-- capturarse sin el código si todavía no está vinculado.
alter table public.registros
    add column if not exists implemento_fisico_id uuid
    references public.implementos_fisicos(id);

comment on column public.registros.implemento_fisico_id is
    'Máquina concreta que hizo la labor (ROMSR-01). El costo sigue saliendo del puesto SAP de `implemento_id`.';


-- =====================================================================
-- PARTE A · COSTOS AL GRANO DEL LOTE
-- =====================================================================
-- El costo nace en el REGISTRO: horas notificadas × tarifa del puesto.
-- Pero una labor puede cubrir tres lotes, y él quiere el costo POR LOTE
-- y por encargado. La única forma honesta de bajarlo es repartirlo:
--
--   * Si la labor midió manzanas, el costo se reparte en proporción a
--     las manzanas de cada lote. Es lo correcto: el lote donde se
--     trabajaron 30 mz consumió más máquina que el de 5.
--   * Si no midió manzanas —no todas las labores se miden en área—, se
--     reparte en partes iguales entre sus lotes. Inventar un peso sería
--     peor que repartir parejo.
--
-- El reparto no cambia ningún total: la suma de las partes es el costo
-- del registro. Por eso las pantallas que ya sumaban `costo` siguen
-- dando lo mismo; lo único que cambia es que ahora se puede abrir por
-- lote, zona y encargado.
--
-- Es DROP + CREATE porque las columnas nuevas no van todas al final y un
-- REPLACE sólo permite agregar al final.
-- =====================================================================

drop view if exists public.v_costos_labores;

create view public.v_costos_labores as
with reparto as (
    -- Peso de cada línea dentro de su registro. `count(*) over` y
    -- `sum() over` hacen el reparto sin una segunda pasada.
    select
        rd.id                as detalle_id,
        rd.registro_id,
        rd.lote_temporada_id,
        rd.avance_mz,
        rd.ciclo,
        rd.etapa,
        case
            when coalesce(sum(rd.avance_mz) over (partition by rd.registro_id), 0) > 0
                then coalesce(rd.avance_mz, 0)
                     / sum(rd.avance_mz) over (partition by rd.registro_id)
            else 1.0 / count(*) over (partition by rd.registro_id)
        end                  as peso
    from public.registro_detalle rd
),
lineas as (
    select
        rp.detalle_id,
        r.id                                          as registro_id,
        r.ticket_id,
        r.fecha,
        r.temporada_id,
        rp.lote_temporada_id,
        lo.nomenclatura                               as ut,
        lo.nombre                                     as lote_nombre,
        z.id                                          as zona_id,
        z.nombre                                      as zona,
        z.responsable                                 as encargado,
        rp.avance_mz                                  as mz,
        rp.ciclo,
        rp.etapa,
        rp.peso,
        coalesce(r.horas_notificadas, h.horas_maquina) as horas_registro,
        e.codigo                                      as equipo_codigo,
        lb.id                                         as labor_id,
        lb.nombre                                     as labor_nombre,
        cl.id                                         as categoria_labor_id,
        cl.nombre                                     as categoria_labor,
        ts.codigo                                     as tarea_codigo,
        ps.codigo                                     as proceso_codigo,
        im.codigo                                     as implemento_codigo,
        imf.codigo                                    as codigo_implemento,
        t.proceso                                     as ticket_proceso,
        t.codigo                                      as ticket_codigo,
        pf.id                                         as puesto_equipo_id,
        pf.codigo                                     as puesto_equipo,
        pi_.id                                        as puesto_implemento_id,
        pi_.codigo                                    as puesto_implemento
    from reparto rp
    join public.registros r  on r.id = rp.registro_id
    join public.lotes_temporada l_t on l_t.id = rp.lote_temporada_id
    join public.lotes lo     on lo.id = l_t.lote_id
    left join public.zonas z on z.id = l_t.zona_id
    join public.horometros h on h.id = r.horometro_id
    join public.equipos e    on e.id = h.equipo_id
    left join public.familias_equipo fe on fe.id = e.familia_id
    left join public.puestos_trabajo pf on pf.id = fe.puesto_trabajo_id
    left join public.implementos im on im.id = r.implemento_id
    left join public.implementos_fisicos imf on imf.id = r.implemento_fisico_id
    left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
    join public.labores lb   on lb.id = r.labor_id
    left join public.categorias_labor cl on cl.id = lb.categoria_labor_id
    join public.tareas_sap ts on ts.id = r.tarea_id
    left join public.procesos_sap ps on ps.id = ts.proceso_id
    join public.tickets t    on t.id = r.ticket_id
),
ambas as (
    select l.*, 'EQUIPO'::text as concepto,
           l.puesto_equipo as puesto,
           public.fn_tarifa_vigente(l.puesto_equipo_id, l.fecha) as costo_hora
    from lineas l
    where l.puesto_equipo_id is not null

    union all

    select l.*, 'IMPLEMENTO'::text,
           l.puesto_implemento,
           public.fn_tarifa_vigente(l.puesto_implemento_id, l.fecha)
    from lineas l
    where l.puesto_implemento_id is not null
)
select
    detalle_id, registro_id, ticket_id, ticket_codigo, ticket_proceso,
    fecha, temporada_id,
    lote_temporada_id, ut, lote_nombre, zona_id, zona, encargado,
    equipo_codigo, labor_id, labor_nombre, categoria_labor_id, categoria_labor,
    tarea_codigo, proceso_codigo, implemento_codigo, codigo_implemento,
    ciclo, etapa, mz,
    concepto, puesto, costo_hora,
    -- Horas y costo ya repartidos entre los lotes de la labor.
    round(horas_registro * peso, 2) as horas,
    round(horas_registro * peso * coalesce(costo_hora, 0), 2) as costo,
    case when coalesce(mz, 0) > 0
         then round(horas_registro * peso * coalesce(costo_hora, 0) / mz, 2)
         else null end as costo_mz
from ambas;

alter view public.v_costos_labores set (security_invoker = on);

comment on view public.v_costos_labores is
    'Costo de cada labor repartido por lote (en proporción a las manzanas, o parejo si la labor no mide área), con zona y encargado para poder agrupar por ellos. Dos filas por lote y labor: el puesto del equipo y el del implemento, igual que la notificación de SAP.';


-- =====================================================================
-- PARTE E · ÍNDICES
-- =====================================================================

create index if not exists idx_registros_implemento_fisico
    on public.registros (implemento_fisico_id)
    where implemento_fisico_id is not null;


-- =====================================================================
-- PARTE F · EL CONTROL DE LABORES MUESTRA EL CÓDIGO FÍSICO
-- =====================================================================
-- Dos columnas al final, así que basta `create or replace`.
-- =====================================================================

create or replace view public.v_labores_control as
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
    r.created_at,
    l_t.temporada_id,
    tm.nombre                   as temporada_nombre,
    l_t.lote_id,
    -- Columnas nuevas de la 19
    r.implemento_fisico_id,
    imf.codigo                  as codigo_implemento
from public.registro_detalle rd
join public.registros r          on r.id = rd.registro_id
join public.lotes_temporada l_t  on l_t.id = rd.lote_temporada_id
join public.temporadas tm        on tm.id = l_t.temporada_id
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
left join public.implementos_fisicos imf on imf.id = r.implemento_fisico_id
left join public.puestos_trabajo pi_ on pi_.id = im.puesto_trabajo_id
left join public.perfiles pe     on pe.id = r.usuario_id
join public.tickets t            on t.id = r.ticket_id;

alter view public.v_labores_control set (security_invoker = on);


-- =====================================================================
-- PARTE G · LA IMPORTACIÓN: HORAS HOMBRE = 8 Y CÓDIGO FÍSICO
-- =====================================================================
-- «asigne automáticamente el valor de "horas hombre" = 8 por defecto al
--  procesar las filas del Excel»
--
-- Ocho horas es la jornada, y en el histórico casi nunca viene el dato.
-- Dejarlo en null obligaba a rellenar 300 celdas a mano para que las
-- horas hombre del mes cuadraran. Si el Excel trae el dato, gana el
-- Excel: el valor por omisión es un relleno, no una imposición.
-- =====================================================================

create or replace function public.fn_importar_detalle_ticket(
    p_ticket_id uuid,
    p_filas jsonb
) returns table (
    horometros_nuevos integer,
    labores_nuevas    integer,
    lineas            integer
)
language plpgsql volatile security invoker as $$
declare
    v_fecha    date;
    v_dueno    uuid;
    v_fila     jsonb;
    v_n        integer := 0;
    v_h_id     uuid;
    v_r_id     uuid;
    v_impl     uuid;
    v_impl_fis uuid;
    v_horom    integer := 0;
    v_labores  integer := 0;
    v_lineas   integer := 0;
begin
    select t.fecha, t.usuario_id into v_fecha, v_dueno
    from public.tickets t where t.id = p_ticket_id;

    if v_fecha is null then
        raise exception 'El ticket no existe o no tienes acceso a él.';
    end if;

    if not public.fn_puede_capturar_en_ticket(p_ticket_id) then
        raise exception 'No puedes capturar en este ticket. Si ya está cerrado, sólo el Administrador o Torre de Control pueden agregarle labores.';
    end if;

    if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
        raise exception 'No se recibió ninguna fila que importar.';
    end if;

    for v_fila in select * from jsonb_array_elements(p_filas)
    loop
        v_n := v_n + 1;

        if v_fila->>'equipo_id' is null or v_fila->>'labor_id' is null
           or v_fila->>'tarea_id' is null or v_fila->>'lote_temporada_id' is null then
            raise exception 'La fila % viene incompleta: hace falta equipo, labor, tarea y lote.', v_n;
        end if;

        -- Horómetro: uno por equipo y turno dentro del ticket.
        select h.id into v_h_id
        from public.horometros h
        where h.ticket_id = p_ticket_id
          and h.equipo_id = (v_fila->>'equipo_id')::uuid
          and h.turno = (coalesce(v_fila->>'turno', 'DIURNO'))::public.turno_tipo;

        if v_h_id is null then
            insert into public.horometros (
                ticket_id, fecha, turno, equipo_id,
                horometro_inicial, horometro_final, horas_hombre,
                operador_id, comentario, usuario_id
            ) values (
                p_ticket_id,
                v_fecha,
                (coalesce(v_fila->>'turno', 'DIURNO'))::public.turno_tipo,
                (v_fila->>'equipo_id')::uuid,
                coalesce((v_fila->>'horometro_inicial')::numeric, 0),
                coalesce((v_fila->>'horometro_final')::numeric,
                         (v_fila->>'horometro_inicial')::numeric, 0),
                -- La jornada completa por omisión.
                coalesce((v_fila->>'horas_hombre')::numeric, 8),
                (v_fila->>'operador_id')::uuid,
                v_fila->>'comentario',
                v_dueno
            )
            returning id into v_h_id;
            v_horom := v_horom + 1;
        end if;

        -- Registro: uno por labor del horómetro. El código físico entra
        -- en la llave de búsqueda porque dos pasadas con dos fierros
        -- distintos son dos labores distintas, aunque el tipo sea el mismo.
        v_impl     := (v_fila->>'implemento_id')::uuid;
        v_impl_fis := (v_fila->>'implemento_fisico_id')::uuid;

        select r.id into v_r_id
        from public.registros r
        where r.horometro_id = v_h_id
          and r.labor_id = (v_fila->>'labor_id')::uuid
          and r.tarea_id = (v_fila->>'tarea_id')::uuid
          and r.implemento_id is not distinct from v_impl
          and r.implemento_fisico_id is not distinct from v_impl_fis;

        if v_r_id is null then
            insert into public.registros (
                ticket_id, horometro_id, fecha, labor_id, tarea_id,
                implemento_id, implemento_fisico_id, horas_notificadas,
                comentarios, usuario_id
            ) values (
                p_ticket_id, v_h_id, v_fecha,
                (v_fila->>'labor_id')::uuid,
                (v_fila->>'tarea_id')::uuid,
                v_impl,
                v_impl_fis,
                (v_fila->>'horas_notificadas')::numeric,
                v_fila->>'comentario',
                v_dueno
            )
            returning id into v_r_id;
            v_labores := v_labores + 1;
        end if;

        insert into public.registro_detalle (
            registro_id, lote_temporada_id, fecha, avance_mz, ciclo, etapa,
            con_moto, proveedor_plastico_id, proveedor_manguera_id, usuario_id
        ) values (
            v_r_id,
            (v_fila->>'lote_temporada_id')::uuid,
            v_fecha,
            (v_fila->>'avance_mz')::numeric,
            coalesce((v_fila->>'ciclo')::integer, 1),
            (v_fila->>'etapa')::smallint,
            coalesce((v_fila->>'con_moto')::boolean, false),
            (v_fila->>'proveedor_plastico_id')::uuid,
            (v_fila->>'proveedor_manguera_id')::uuid,
            v_dueno
        );
        v_lineas := v_lineas + 1;
    end loop;

    return query select v_horom, v_labores, v_lineas;
end;
$$;


-- =====================================================================
-- PARTE H · COSTOS POR CATEGORÍA Y LABOR DE UN LOTE
-- =====================================================================
-- «Al visualizar una categoría (ej. Preparación de Suelo) para un lote
--  específico, mostrar el desglose por labor: manzanas ejecutadas, costo
--  subtotal de la labor, costo total de la categoría y el % que
--  representa el costo de cada labor respecto al total de la categoría.»
--
-- El % se calcula en la base con `sum() over (partition by categoría)`:
-- en el navegador habría que traer todas las líneas del rango sólo para
-- poder dividir, y con 4000 líneas el tope de la pantalla ya estorbaba.
-- =====================================================================

create or replace function public.fn_costos_por_categoria(
    p_desde       date,
    p_hasta       date,
    p_lote_temporada_id uuid default null,
    p_zona_id     uuid default null,
    /** Encargado, por nombre: es lo que se ve en la pantalla. */
    p_encargado   text default null,
    p_temporada_id uuid default null
) returns table (
    categoria_labor_id uuid,
    categoria_labor    text,
    labor_id           uuid,
    labor_nombre       text,
    mz                 numeric,
    horas              numeric,
    costo              numeric,
    costo_categoria    numeric,
    pct_categoria      numeric,
    costo_mz           numeric,
    lotes              bigint
)
language sql stable security invoker as $$
    with base as (
        select
            v.categoria_labor_id,
            coalesce(v.categoria_labor, 'Sin categoría') as categoria_labor,
            v.labor_id,
            v.labor_nombre,
            -- Las manzanas se cuentan UNA vez por línea de lote, no por
            -- concepto: cada labor genera dos filas (equipo e
            -- implemento) sobre las mismas manzanas y sumarlas las
            -- duplicaría.
            sum(v.mz) filter (where v.concepto = 'EQUIPO')            as mz_equipo,
            sum(v.mz) filter (where v.concepto = 'IMPLEMENTO')        as mz_impl,
            count(distinct v.lote_temporada_id)                       as lotes,
            sum(v.horas) filter (where v.concepto = 'EQUIPO')         as horas,
            sum(v.costo)                                              as costo
        from public.v_costos_labores v
        where v.fecha between p_desde and p_hasta
          and (p_lote_temporada_id is null or v.lote_temporada_id = p_lote_temporada_id)
          and (p_zona_id is null or v.zona_id = p_zona_id)
          and (p_encargado is null or v.encargado = p_encargado)
          and (p_temporada_id is null or v.temporada_id = p_temporada_id)
        group by v.categoria_labor_id, coalesce(v.categoria_labor, 'Sin categoría'),
                 v.labor_id, v.labor_nombre
    ),
    conteo as (
        select b.*,
               -- Si la labor no tuvo puesto de equipo (no debería, pero
               -- pasa cuando falta la familia) se cae a las del
               -- implemento para no perder las manzanas.
               coalesce(b.mz_equipo, b.mz_impl, 0) as mz_reales,
               sum(b.costo) over (partition by b.categoria_labor) as costo_categoria
        from base b
    )
    select
        c.categoria_labor_id,
        c.categoria_labor,
        c.labor_id,
        c.labor_nombre,
        round(c.mz_reales, 2),
        round(coalesce(c.horas, 0), 2),
        round(c.costo, 2),
        round(c.costo_categoria, 2),
        case when c.costo_categoria > 0
             then round(c.costo * 100.0 / c.costo_categoria, 2)
             else null end,
        case when c.mz_reales > 0 then round(c.costo / c.mz_reales, 2) else null end,
        c.lotes
    from conteo c
    order by c.costo_categoria desc, c.costo desc
$$;

comment on function public.fn_costos_por_categoria(date, date, uuid, uuid, text, uuid) is
    'Desglose de costo por categoría de labor y labor, con manzanas, subtotal, total de la categoría y el % que cada labor representa dentro de ella. Filtrable por lote, zona, encargado y temporada.';
