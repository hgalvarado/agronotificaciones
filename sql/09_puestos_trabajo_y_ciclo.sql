-- =====================================================================
-- AGRONOTIFICACIONES · Migración 09
-- (a) Catálogo de Puestos de Trabajo SAP   (b) Ciclo por lote
-- =====================================================================
-- Ejecutar en el SQL Editor DESPUÉS de 01–08.
-- =====================================================================


-- =====================================================================
-- PARTE A · PUESTOS DE TRABAJO
-- =====================================================================
-- Tu tabla de Puesto de Trabajo / Descripción / Oper NO son sólo
-- implementos. Al cruzarla con tus catálogos aparecen TRES familias de
-- códigos:
--
--   DVIM-*, DVDR-*        → implementos (DVIM-SB1 = Subsoladores DV-SB1,
--                            idénticos a tu hoja IMPLEMENTOS)
--   DVJD-*, DCJD-*, DVCA-*,
--   DVBO-*                → familias de equipo (DVJD-F01, DVJD-F02… son
--                            las mismas familias de tu hoja FAMILIAS)
--   DVMO-*                → mano de obra (Labor Cultural, Operadores,
--                            Ayudantes). No son ni implemento ni familia.
--
-- Por eso el puesto de trabajo va en su propio catálogo, y tanto los
-- implementos como las familias de equipo apuntan a él. Meter la
-- operación sólo dentro de implementos habría dejado fuera las familias
-- y la mano de obra.
--
-- Esto además explica lo que se ve en tu Excel de notificación: una misma
-- labor genera VARIAS líneas SAP — una con el puesto del tractor
-- (DVJD-F02) y otra con el del implemento (DVIM-TR1). Con este catálogo
-- la plataforma ya tiene los datos para armar ambas.
-- =====================================================================

create table if not exists public.puestos_trabajo (
    id            uuid primary key default gen_random_uuid(),
    codigo        text not null unique,   -- 'DVIM-SB1'
    descripcion   text,                   -- 'Subsoladores DV-SB1'
    operacion_sap integer,                -- 10, 20, 30… (columna Oper)
    tipo          text not null default 'OTRO'
                  check (tipo in ('IMPLEMENTO', 'FAMILIA', 'MANO_OBRA', 'OTRO')),
    activo        boolean not null default true,
    id_legacy     text,
    created_at    timestamptz not null default now()
);

alter table public.puestos_trabajo enable row level security;

create policy puestos_select on public.puestos_trabajo for select
    using ((select auth.uid()) is not null);
create policy puestos_insert on public.puestos_trabajo for insert
    with check ((select public.fn_es_admin()) or (select public.fn_mi_rol()) = 'TORRE_CONTROL');
create policy puestos_update on public.puestos_trabajo for update
    using ((select public.fn_es_admin()) or (select public.fn_mi_rol()) = 'TORRE_CONTROL');
create policy puestos_delete on public.puestos_trabajo for delete
    using ((select public.fn_es_admin()));

-- ---------------------------------------------------------------------
-- Semilla con tu tabla
-- ---------------------------------------------------------------------
-- Se cargan los valores del PRIMER bloque de tu lista. El segundo bloque
-- repite códigos con otra operación (DVJD-F01 con 10 en vez de 40, etc.)
-- porque la operación depende también de la ORDEN/tarea SAP. Eso se
-- modela aparte cuando armemos la exportación; ver nota al final.
insert into public.puestos_trabajo (codigo, descripcion, operacion_sap, tipo) values
    ('DVMO-LC', 'MO Labor Cultural DV',                     10,  'MANO_OBRA'),
    ('DVMO-OP', 'MO Operadores DV',                         20,  'MANO_OBRA'),
    ('DVMO-AY', 'MO Ayudantes DV',                          30,  'MANO_OBRA'),
    ('DVJD-F01', 'Tractores de 60 a 90 HP 17,24,28,57',     40,  'FAMILIA'),
    ('DVJD-F02', 'Tractores de 91 a 130 HP 29,33,64',       50,  'FAMILIA'),
    ('DVJD-F04', 'Tractores de 152 HP 7720',                60,  'FAMILIA'),
    ('DVJD-R01', 'Tractores de 60 a 90 HP 17,24,28,57',     70,  'FAMILIA'),
    ('DVJD-R02', 'Tractores de 91 a 130 HP 29,33,64',       80,  'FAMILIA'),
    ('DVJD-R03', 'Tractores de 135 a 160 HP 4455, 7720',    90,  'FAMILIA'),
    ('DVCA-R04', 'Rta camion plataforma DV',                100, 'FAMILIA'),
    ('DVIM-SB1', 'Subsoladores DV-SB1',                     110, 'IMPLEMENTO'),
    ('DVIM-CN1', 'Cuchilla NivelDV-CN1',                    120, 'IMPLEMENTO'),
    ('DVIM-CR1', 'Cuchilla Rino DV-CR1',                    130, 'IMPLEMENTO'),
    ('DVIM-RP1', 'Romplow DV-RP1',                          140, 'IMPLEMENTO'),
    ('DVIM-PR1', 'Paratiles DV-PR1',                        150, 'IMPLEMENTO'),
    ('DVIM-SM1', 'Surcadores DV-SM1',                       160, 'IMPLEMENTO'),
    ('DVIM-BO1', 'Bordeadoras DV-BO1',                      170, 'IMPLEMENTO'),
    ('DVIM-RT1', 'Rotatiles DV-RT1',                        180, 'IMPLEMENTO'),
    ('DVIM-MP1', 'EmplasticadoraDV-MP1',                    190, 'IMPLEMENTO'),
    ('DVIM-RF1', 'Refor.PlasticoDV-RF1',                    200, 'IMPLEMENTO'),
    ('DVIM-TR1', 'Trocos DV-TR1',                           210, 'IMPLEMENTO'),
    ('DVDR-R06', 'Renta de Dron',                           220, 'IMPLEMENTO'),
    ('DVDR-D01', 'Dron Fumigacion DV',                      230, 'IMPLEMENTO'),
    ('DVIM-J01', 'B-ConvencionalDV-J01',                    240, 'IMPLEMENTO'),
    ('DVIM-F01', 'B-Frances DV-F01',                        250, 'IMPLEMENTO'),
    ('DVIM-BE1', 'B-ElectroesttcDV-BE1',                    260, 'IMPLEMENTO'),
    ('DVIM-FE3', 'Fertilizadora DV-FE3',                    270, 'IMPLEMENTO'),
    ('DVIM-CP1', 'Cultivadora DV-CP1',                      280, 'IMPLEMENTO'),
    ('DVIM-CG1', 'Corta Guias DV-CG1',                      290, 'IMPLEMENTO'),
    ('DVIM-DC1', 'Chapiadoras DV-DC1',                      300, 'IMPLEMENTO'),
    ('DVIM-AR1', 'Arados DV-AR1',                           310, 'IMPLEMENTO'),
    ('DVIM-SP1', 'Saca Plastico DV-SP1',                    320, 'IMPLEMENTO'),
    ('DVIM-TP1', 'Trasplantadora 3C DV',                    330, 'IMPLEMENTO'),
    ('DVIM-EN1', 'Enmantadora 3C DV-EN',                    340, 'IMPLEMENTO'),
    ('DVBO-R05', 'TRACTOR BOLDUZER DV',                     350, 'FAMILIA'),
    ('DCJD-F02', 'Tractores de 91 a 130 HP 29,33,64',       360, 'FAMILIA'),
    ('DCJD-F03', 'Tractores de 135 HP 4455',                370, 'FAMILIA'),
    ('DCJD-F04', 'Tractores de 152 HP 7720',                380, 'FAMILIA')
on conflict (codigo) do update
    set descripcion   = excluded.descripcion,
        operacion_sap = excluded.operacion_sap,
        tipo          = excluded.tipo;

-- ---------------------------------------------------------------------
-- Enlaces desde implementos y familias
-- ---------------------------------------------------------------------
alter table public.implementos
    add column if not exists puesto_trabajo_id uuid references public.puestos_trabajo(id);

alter table public.familias_equipo
    add column if not exists puesto_trabajo_id uuid references public.puestos_trabajo(id);

-- Vinculación automática por código: los implementos ya usan el mismo
-- código que el puesto de trabajo, y las familias también.
update public.implementos i
set puesto_trabajo_id = p.id
from public.puestos_trabajo p
where upper(btrim(i.codigo)) = upper(btrim(p.codigo))
  and i.puesto_trabajo_id is null;

update public.familias_equipo f
set puesto_trabajo_id = p.id
from public.puestos_trabajo p
where upper(btrim(f.nombre)) = upper(btrim(p.codigo))
  and f.puesto_trabajo_id is null;


-- =====================================================================
-- PARTE B · CICLO POR LOTE
-- =====================================================================
-- En tu hoja de notificación cada línea lleva su Ciclo (1, 2, …): es el
-- ciclo de cultivo del lote en esa temporada. Va en el detalle porque un
-- mismo lote puede trabajarse en ciclos distintos dentro de la temporada.

alter table public.registro_detalle
    add column if not exists ciclo integer not null default 1 check (ciclo > 0);

-- Ciclo sugerido a nivel de lote-temporada: sirve de valor por defecto
-- al capturar, para no teclearlo en cada línea.
alter table public.lotes_temporada
    add column if not exists ciclo integer not null default 1 check (ciclo > 0);

comment on column public.registro_detalle.ciclo is
'Ciclo de cultivo del lote en esa labor. Se arrastra a la notificación SAP.';


-- =====================================================================
-- PARTE C · VISTA DE LABORES PARA TORRE DE CONTROL
-- =====================================================================
-- Equivale a tu hoja "NOTIFICACION MAQUINARIA AGRICOLA": una línea por
-- lote trabajado, con la tarea SAP, el equipo, el implemento y el puesto
-- de trabajo con su operación.

create or replace view public.v_labores_control as
select
    rd.id                       as detalle_id,
    r.id                        as registro_id,
    r.ticket_id,
    r.horometro_id,
    r.fecha,
    lo.nomenclatura             as ut,
    lo.nombre                   as lote_nombre,
    ts.codigo                   as tarea_codigo,
    ts.nombre                   as tarea_nombre,
    rd.ciclo,
    rd.avance_mz,
    lb.nombre                   as labor_nombre,
    cl.nombre                   as categoria_labor,
    e.codigo                    as equipo_codigo,
    h.turno,
    h.horas_maquina,
    h.horas_hombre,
    o.codigo                    as operador_codigo,
    o.nombre                    as operador_nombre,
    im.codigo                   as implemento_codigo,
    im.nombre                   as implemento_nombre,
    -- Puesto de trabajo del IMPLEMENTO
    pi_.codigo                  as puesto_implemento,
    pi_.operacion_sap           as operacion_implemento,
    -- Puesto de trabajo de la FAMILIA del equipo (la línea del tractor)
    pf.codigo                   as puesto_equipo,
    pf.operacion_sap            as operacion_equipo,
    pf.descripcion              as descripcion_equipo,
    t.codigo                    as ticket_codigo,
    t.estado                    as ticket_estado,
    t.proceso                   as ticket_proceso,
    t.departamento,
    r.comentarios,
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
join public.tickets t            on t.id = r.ticket_id;

alter view public.v_labores_control set (security_invoker = on);

comment on view public.v_labores_control is
'Una línea por lote trabajado, con tarea SAP, puesto de trabajo y operación.
Equivale a la hoja NOTIFICACION MAQUINARIA AGRICOLA.';


-- =====================================================================
-- NOTA PENDIENTE · el segundo bloque de operaciones
-- =====================================================================
-- Tu lista trae códigos repetidos con otra operación:
--   DVJD-F01 → 40 en el primer bloque, 10 en el segundo
--   DVIM-TR1 → 210 en el primero, 30 en el segundo
-- y algunos con la nota "(Excepto para APICULTURA QUE SERIA 0040)".
--
-- Eso significa que la operación no depende sólo del puesto de trabajo,
-- sino de la combinación ORDEN/TAREA + PUESTO. Se cargó el primer bloque
-- porque es el que corresponde a las órdenes que aparecen en tu Excel de
-- agosto (Oper 0050 = DVJD-F02, 0210 = DVIM-TR1, 0240 = DVIM-J01).
--
-- Cuando definamos la exportación a SAP hay que crear una tabla de
-- excepciones (tarea + puesto → operación) para cubrir el segundo bloque.
-- No se inventó ahora para no meter datos incorrectos.
