-- =====================================================================
-- 66 · ABAC GRANULAR Y SELLADO DE LA FUGA ZONAL
-- =====================================================================
--
--   A · **LA FUGA ZONAL ERA REAL Y ERA MÍA.** Hay tres formas distintas
--       de colarse y la plataforma tenía las tres. No es un fallo de
--       `fn_mi_alcance` ni del `case`: es que la rama `zonal` de las
--       rejas estaba mal escrita.
--
--         1. `else true` — la rama zonal no filtraba NADA. Es lo que
--            tenían `v_desinfeccion_ejecucion` y `v_desinfeccion_personal`:
--            un usuario zonal veía todos los turnos de la finca.
--
--         2. `else true or not fn_tiene_zonas() or (...)` — PEOR, porque
--            parece que filtra. El `true or` de delante cortocircuita
--            todo lo que viene detrás y el predicado zonal es código
--            muerto. Afectaba a seis vistas, entre ellas las de avance y
--            las de costos. Viene del bucle de la 61: cuando una vista no
--            tenía columna de dueño, el generador escribía `true` en su
--            sitio y lo pegaba con `or`.
--
--         3. `not fn_tiene_zonas()` — un usuario con alcance ZONAL al que
--            nadie le asignó zonas veía la finca entera. El fallo abierto
--            tiene sentido en las policies viejas (un usuario sin zonas
--            es «sin recorte»), pero en una rama que se alcanza SÓLO
--            cuando el alcance es zonal es exactamente al revés: zonal
--            sin zonas es «todavía no le toca ver nada».
--
--       Se sella con dos funciones estrictas y con las rejas regeneradas
--       a partir de una TABLA DE DECISIONES —una fila por vista— para que
--       no se pueda volver a colar un `true` suelto sin que se vea.
--
--   B · **PANTALLAS GRANULARES.** `desinfeccion` y `trasplante` eran un
--       solo identificador para cuatro y dos pestañas. Con eso no se
--       puede dar la ejecución sin dar el reporte de costos, que es
--       justo lo que la finca necesita.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · LAS DOS FUNCIONES ESTRICTAS
-- =====================================================================
/**
 * ¿Es MÍA esta zona? Sin fallos abiertos.
 *
 * Se diferencia de `fn_ve_zona` en las dos puertas que aquélla deja
 * entornadas, y la diferencia es deliberada:
 *
 *   · Sin zonas asignadas, `fn_ve_zona` dice que sí —«sin recorte»— y
 *     ésta dice que no. En una rama que sólo se alcanza con alcance
 *     ZONAL, no tener zonas no puede significar verlo todo.
 *   · Una fila con zona NULA la ve todo el mundo con `fn_ve_zona`; aquí
 *     no la ve nadie. Una fila sin zona es un dato incompleto, y un dato
 *     incompleto no puede ser un pase libre.
 *
 * `fn_ve_zona` se queda como está: la usan las policies de la 41 y la 42
 * con el fallo abierto a propósito, y cambiarla ahí dejaría fuera a gente
 * de módulos que hoy funcionan. Las dos conviven y cada una dice en su
 * nombre lo que hace.
 */
create or replace function public.fn_ve_zona_estricta(p_zona_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.perfiles_zonas pz
        where pz.perfil_id = (select auth.uid())
          and pz.zona_id = p_zona_id
    )
$$;

comment on function public.fn_ve_zona_estricta(uuid) is
    'La zona es mía, sin fallos abiertos: sin zonas asignadas o con zona nula devuelve falso.';

grant execute on function public.fn_ve_zona_estricta(uuid) to authenticated;

/**
 * ¿Está este lote en una zona mía? Mismo criterio estricto.
 *
 * Para las vistas que llevan el lote y no la zona. Un lote sin zona no
 * lo ve nadie, por lo mismo de arriba.
 */
create or replace function public.fn_ve_lote_estricto(p_lote_temporada_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1
        from public.lotes_temporada lt
        join public.perfiles_zonas pz on pz.zona_id = lt.zona_id
        where lt.id = p_lote_temporada_id
          and pz.perfil_id = (select auth.uid())
    )
$$;

comment on function public.fn_ve_lote_estricto(uuid) is
    'El lote cae en una zona mía. Estricta: un lote sin zona no lo ve nadie.';

grant execute on function public.fn_ve_lote_estricto(uuid) to authenticated;

-- =====================================================================
-- B · LAS PANTALLAS GRANULARES
-- =====================================================================

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('desinfeccion_plan', 'Desinfección · Planificación',
     'Qué lote se desinfecta, cuándo y con qué producto.',
     '/controles/desinfeccion', 57,
     array['ver','crear','editar','eliminar','exportar','importar']),
    ('desinfeccion_ejecucion', 'Desinfección · Ejecución',
     'La captura del turno: preriego, lecturas, aplicación, químicos y cuadrilla.',
     '/controles/desinfeccion', 58,
     array['ver','crear','editar','eliminar','exportar','importar']),
    ('desinfeccion_logistica', 'Desinfección · Logística',
     'El acarreo: equipo, implemento y horas que se reparten por zona.',
     '/controles/desinfeccion', 59,
     array['ver','crear','editar','eliminar','exportar','importar']),
    ('desinfeccion_reporte', 'Desinfección · Reporte de costos',
     'El costo por lote ya prorrateado. Sólo se mira.',
     '/controles/desinfeccion', 60,
     array['ver','exportar']),
    ('trasplante_plan', 'Trasplante · Plan de siembra',
     'Cuántas manzanas de cada variedad en cada lote y ciclo.',
     '/trasplante', 54,
     array['ver','crear','editar','eliminar','exportar','importar']),
    ('trasplante_diario', 'Trasplante · Siembra diaria',
     'La captura del día: avance, plántulas y variedad.',
     '/trasplante', 55,
     array['ver','crear','editar','eliminar','exportar','importar'])
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta = excluded.ruta,
    orden = excluded.orden,
    acciones = excluded.acciones;

/**
 * Lo que los roles YA tenían se copia a las sub-pantallas.
 *
 * Nadie puede perder acceso por correr esto: quien tenía «editar» en
 * Desinfección lo tiene en las cuatro pestañas, **con su mismo alcance y
 * su misma condición**. Partir la pantalla es una decisión de
 * granularidad, no una de permisos; quitar lo que sobre es un segundo
 * paso que toma el Administrador cuando quiera, desde la matriz.
 *
 * La acción tiene que existir en la sub-pantalla: el reporte de costos
 * sólo tiene «ver» y «exportar», así que un «eliminar» del padre no
 * viaja —no habría dónde ponerlo—.
 */
do $$
declare
    v record;
begin
    for v in
        select * from (values
            ('desinfeccion', 'desinfeccion_plan'),
            ('desinfeccion', 'desinfeccion_ejecucion'),
            ('desinfeccion', 'desinfeccion_logistica'),
            ('desinfeccion', 'desinfeccion_reporte'),
            ('trasplante',   'trasplante_plan'),
            ('trasplante',   'trasplante_diario')
        ) as t(padre, hijo)
    loop
        insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
        select p.rol_id, v.hijo, p.accion, p.permitido, p.alcance, p.condicion
        from public.permisos p
        join public.pantallas pa on pa.codigo = v.hijo
        where p.recurso = v.padre
          and p.accion = any(pa.acciones)
        on conflict (rol_id, recurso, accion) do nothing;
    end loop;
end $$;

-- Y ahora sí, el padre se va. Primero los permisos —que es lo que la
-- matriz dibuja— y después la pantalla.
delete from public.permisos where recurso in ('desinfeccion', 'trasplante');
delete from public.pantallas where codigo in ('desinfeccion', 'trasplante');

-- =====================================================================
-- C · EL PERSONAL, CON SU ZONA
-- =====================================================================
-- `v_desinfeccion_personal` no tenía por dónde recortar: ni zona ni
-- lote. Por eso su reja decía `true` — no era un descuido del generador,
-- era que no había columna. La zona está a un join de distancia: la
-- cuadrilla cuelga de una ejecución, que cuelga de un turno, que tiene
-- zona. Se añade al final, que es lo único que admite una vista.

drop view if exists public.v_desinfeccion_personal;
drop view if exists interno.v_desinfeccion_personal_crudo;

create view interno.v_desinfeccion_personal_crudo as
select
    dp.id, dp.ejecucion_id, e.temporada_id,
    e.turno_id, tn.nombre as turno_nombre, e.ciclo,
    dp.fase,
    -- La fecha de SU fase, que no es la misma para las dos cuadrillas.
    case dp.fase
        when '1_Preriego' then e.fecha_preriego
        else e.fecha_aplicacion
    end                                        as fecha,
    dp.puesto_texto,
    dp.operador_id, op.codigo as operador_codigo, op.nombre as operador_nombre,
    dp.cantidad_personas, dp.horas_extras, dp.jornada_tipo,
    dp.salario_base_manual, dp.tarifa_dia, dp.costo_total,
    e.usuario_id, dp.created_at,
    -- La zona del turno: es por donde recorta la reja zonal.
    tn.zona_id
from public.desinfeccion_personal dp
join public.desinfeccion_ejecucion e on e.id = dp.ejecucion_id
join public.turnos tn                on tn.id = e.turno_id
left join public.operadores op       on op.id = dp.operador_id;

alter view interno.v_desinfeccion_personal_crudo set (security_invoker = off);

-- =====================================================================
-- D · LAS REJAS, REGENERADAS DESDE UNA TABLA DE DECISIONES
-- =====================================================================
-- Una fila por vista expuesta, y en ella TODO lo que decide quién la ve.
-- Escribir las rejas a mano, veinticuatro veces, es lo que dejó tres
-- formas distintas de colarse conviviendo sin que nadie las viera juntas.
-- Aquí se ven juntas.
--
-- `recorte`:
--   'zona'  → la fila lleva `zona_id`; recorta `fn_ve_zona_estricta`.
--   'lote'  → lleva `lote_temporada_id`; recorta `fn_ve_lote_estricto`.
--   'nada'  → la vista NO tiene dimensión zonal y el recorte no aplica.
--             Se escribe aquí, con su razón, en vez de dejar un `true`
--             suelto que mañana nadie sabe si es decisión o descuido.

do $$
declare
    v        record;
    v_dueno  text;
    v_zonal  text;
begin
    for v in
        select * from (values
            /* ---------------------- Desinfección --------------------- */
            ('v_desinfeccion_plan',       'desinfeccion_plan',      'lote', true),
            ('v_desinfeccion_ejecucion',  'desinfeccion_ejecucion', 'zona', true),
            ('v_desinfeccion_lotes',      'desinfeccion_ejecucion', 'lote', true),
            ('v_desinfeccion_personal',   'desinfeccion_ejecucion', 'zona', true),
            ('v_desinfeccion_productos',  'desinfeccion_ejecucion', 'zona', true),
            ('v_desinfeccion_logistica',  'desinfeccion_logistica', 'zona', true),
            ('v_desinfeccion_costos',     'desinfeccion_reporte',   'zona', false),

            /* ----------------------- Trasplante ---------------------- */
            ('v_siembras',                'trasplante_diario',      'lote', true),

            /* ------------------------ Rotación ----------------------- */
            ('v_rotacion_plan',           'rotacion',               'lote', false),
            ('v_rotacion_avance',         'rotacion',               'lote', true),

            /* ------------------------- Riego ------------------------- */
            ('v_turnos_riego',            'turnos_riego',           'lote', true),

            /* ------------------------ Labores ------------------------ */
            ('v_labores_control',         'labores',                'zona', true),
            ('v_costos_labores',          'costos',                 'zona', false),

            /* ------------------------- Avance ------------------------ */
            ('v_avance_diario',           'avance',                 'lote', false),
            ('v_avance_ejecutado',        'avance',                 'lote', false),
            ('v_avance_lote_labor',       'avance',                 'lote', false),

            /* ------------- Sin dimensión zonal, a propósito ----------- */
            -- El equipo y el teléfono no son de una zona: un tractor
            -- trabaja donde haga falta y una línea telefónica no está en
            -- ningún lote. Recortarlos por zona escondería la mitad de
            -- la flota a quien tiene que controlarla.
            ('v_horometros_control',      'horometros',             'nada', true),
            ('v_contadores_equipo',       'catalogo_equipos',       'nada', true),
            ('v_telecom_equipos',         'telecom',                'nada', false),
            ('v_telecom_lineas',          'telecom',                'nada', false),
            ('v_telecom_asignaciones',    'telecom',                'nada', true),
            ('v_telecom_alertas',         'telecom',                'nada', false),
            -- El catálogo de lotes NO lleva zona: la zona vive en
            -- `lotes_temporada`, que es otra tabla. Y el catálogo tiene
            -- que verse entero para poder administrarlo.
            ('v_lotes',                   'lotes',                  'nada', false),
            -- Las plántulas llegan a la finca, no a una zona.
            ('v_recepcion_plantulas',     'trasplante_diario',      'nada', false)
        ) as t(vista, pantalla, recorte, con_dueno)
    loop
        -- Si la vista no existe en esta instalación se salta: no todas
        -- las migraciones de módulo tienen por qué estar aplicadas.
        if not exists (
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'interno' and c.relname = v.vista || '_crudo')
        then
            continue;
        end if;

        v_dueno := case when v.con_dueno
                        then 'x.usuario_id = (select auth.uid())'
                        else 'false' end;

        -- **La rama zonal, por fin estricta.** Ni un `true` suelto, ni un
        -- `not fn_tiene_zonas()` que la abra de par en par. Sin zonas
        -- asignadas no se ve nada, que es lo que significa un alcance
        -- zonal todavía sin configurar.
        v_zonal := case v.recorte
            when 'zona' then 'public.fn_ve_zona_estricta(x.zona_id)'
            when 'lote' then 'public.fn_ve_lote_estricto(x.lote_temporada_id)'
            -- Sin dimensión zonal el recorte no aplica y se dice aquí.
            else 'true'
        end;

        execute format('drop view if exists public.%I', v.vista);
        execute format($sql$
            create view public.%I as
            select x.* from interno.%I x
            where (select public.fn_permitido_de(%L, 'ver'))
              and case (select public.fn_mi_alcance(%L, 'ver'))
                  when 'global'      then true
                  when 'propietario' then %s
                  else %s
              end
        $sql$, v.vista, v.vista || '_crudo', v.pantalla, v.pantalla, v_dueno, v_zonal);

        execute format('grant select on public.%I to authenticated', v.vista);
    end loop;
end $$;


-- =====================================================================
-- F · LA OTRA PUERTA: LAS POLICIES DE LAS TABLAS
-- =====================================================================
-- **Sellar las vistas no sella nada si las tablas siguen abiertas.** Una
-- vista es una comodidad; PostgREST deja consultar la tabla directamente
-- y ahí quien manda es la RLS. Las policies tenían las mismas tres
-- fugas y una cuarta, peor:
--
--   `fn_verificar_permiso` resuelve el alcance zonal con
--   `p_dueno = auth.uid() or fn_ve_zona(p_zona)` — y **casi ningún sitio
--   le pasa la zona**. Con `p_zona` nulo, `fn_ve_zona` contesta que sí,
--   así que el eje zonal de TODAS las escrituras estaba desactivado: un
--   usuario zonal podía editar una fila de otra zona.
--
-- No se toca `fn_verificar_permiso`: la usan todos los módulos y
-- endurecerla a ciegas dejaría fuera a gente de pantallas que hoy
-- funcionan y que aquí no se pueden probar. Se añade una hermana
-- estricta y se usa donde hay con qué: en los módulos que este encargo
-- cubre. El guardián de abajo lista los que siguen con la laxa, para que
-- la deuda esté escrita y no escondida.

/**
 * Como `fn_verificar_permiso`, pero con el eje zonal de verdad.
 *
 * Delega el permiso y la condición en la de siempre —no se duplica esa
 * lógica, que es donde vive el Invitado y el tope de NOTIFICADO— y le
 * suma la zona estricta cuando el alcance es zonal.
 */
create or replace function public.fn_verificar_permiso_zonal(
    p_pantalla       text,
    p_accion         text,
    p_dueno          uuid    default null,
    p_zona           uuid    default null,
    p_estado_abierto boolean default null,
    p_nivel_proceso  smallint default null
)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_verificar_permiso(p_pantalla, p_accion, p_dueno, p_zona,
                                       p_estado_abierto, p_nivel_proceso)
       and case (select alcance::text from public.fn_permiso_de(p_pantalla, p_accion))
           when 'zonal' then public.fn_ve_zona_estricta(p_zona)
           else true
       end
$$;

grant execute on function
    public.fn_verificar_permiso_zonal(text, text, uuid, uuid, boolean, smallint)
    to authenticated;

/** La zona de un lote de temporada. Para pasarla donde hace falta. */
create or replace function public.fn_zona_de_lote(p_lote_temporada_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select lt.zona_id from public.lotes_temporada lt where lt.id = p_lote_temporada_id
$$;

grant execute on function public.fn_zona_de_lote(uuid) to authenticated;

/** La zona de una ejecución de desinfección: la de su turno. */
create or replace function public.fn_zona_de_ejecucion(p_ejecucion_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select tn.zona_id
    from public.desinfeccion_ejecucion e
    join public.turnos tn on tn.id = e.turno_id
    where e.id = p_ejecucion_id
$$;

grant execute on function public.fn_zona_de_ejecucion(uuid) to authenticated;

/* ------------------------ Desinfección · plan ---------------------- */

drop policy if exists desinfeccion_plan_select on public.desinfeccion_plan;
create policy desinfeccion_plan_select on public.desinfeccion_plan for select
    using ((select public.fn_permitido_de('desinfeccion_plan', 'ver'))
       and case (select public.fn_mi_alcance('desinfeccion_plan', 'ver'))
           when 'global'      then true
           when 'propietario' then usuario_id = (select auth.uid())
           else (select public.fn_ve_lote_estricto(lote_temporada_id))
       end);

drop policy if exists desinfeccion_plan_insert on public.desinfeccion_plan;
create policy desinfeccion_plan_insert on public.desinfeccion_plan for insert
    with check ((select public.fn_verificar_permiso_zonal(
        'desinfeccion_plan', 'crear', null,
        (select public.fn_zona_de_lote(lote_temporada_id)))));

drop policy if exists desinfeccion_plan_update on public.desinfeccion_plan;
create policy desinfeccion_plan_update on public.desinfeccion_plan for update
    using ((select public.fn_verificar_permiso_zonal(
        'desinfeccion_plan', 'editar', usuario_id,
        (select public.fn_zona_de_lote(lote_temporada_id)))));

drop policy if exists desinfeccion_plan_delete on public.desinfeccion_plan;
create policy desinfeccion_plan_delete on public.desinfeccion_plan for delete
    using ((select public.fn_verificar_permiso_zonal(
        'desinfeccion_plan', 'eliminar', usuario_id,
        (select public.fn_zona_de_lote(lote_temporada_id)))));

/* --------------------- Desinfección · ejecución -------------------- */

drop policy if exists desinfeccion_ejec_select on public.desinfeccion_ejecucion;
create policy desinfeccion_ejec_select on public.desinfeccion_ejecucion for select
    using ((select public.fn_permitido_de('desinfeccion_ejecucion', 'ver'))
       and case (select public.fn_mi_alcance('desinfeccion_ejecucion', 'ver'))
           when 'global'      then true
           when 'propietario' then usuario_id = (select auth.uid())
           else (select public.fn_ve_zona_estricta(
                    (select tn.zona_id from public.turnos tn where tn.id = turno_id)))
       end);

drop policy if exists desinfeccion_ejec_insert on public.desinfeccion_ejecucion;
create policy desinfeccion_ejec_insert on public.desinfeccion_ejecucion for insert
    with check ((select public.fn_verificar_permiso_zonal(
        'desinfeccion_ejecucion', 'crear', null,
        (select tn.zona_id from public.turnos tn where tn.id = turno_id))));

drop policy if exists desinfeccion_ejec_update on public.desinfeccion_ejecucion;
create policy desinfeccion_ejec_update on public.desinfeccion_ejecucion for update
    using ((select public.fn_verificar_permiso_zonal(
        'desinfeccion_ejecucion', 'editar', usuario_id,
        (select tn.zona_id from public.turnos tn where tn.id = turno_id))));

drop policy if exists desinfeccion_ejec_delete on public.desinfeccion_ejecucion;
create policy desinfeccion_ejec_delete on public.desinfeccion_ejecucion for delete
    using ((select public.fn_verificar_permiso_zonal(
        'desinfeccion_ejecucion', 'eliminar', usuario_id,
        (select tn.zona_id from public.turnos tn where tn.id = turno_id))));

/* ------- Lo que cuelga de la ejecución: lotes, cuadrilla, químicos --- */
-- Las tres heredan el dueño Y LA ZONA de su ejecución. Antes heredaban
-- sólo el dueño, y por eso el eje zonal no las tocaba.

do $$
declare
    v_tabla text;
begin
    foreach v_tabla in array array['desinfeccion_ejecucion_lotes',
                                   'desinfeccion_personal',
                                   'desinfeccion_ejecucion_productos']
    loop
        execute format('drop policy if exists %I on public.%I', v_tabla || '_select', v_tabla);
        execute format('drop policy if exists %I on public.%I', v_tabla || '_write', v_tabla);
        -- Los nombres viejos no eran uniformes: se sueltan por si acaso.
        execute format('drop policy if exists desinfeccion_ejec_productos_select on public.%I', v_tabla);
        execute format('drop policy if exists desinfeccion_ejec_productos_write on public.%I', v_tabla);

        execute format($sql$
            create policy %I on public.%I for select
            using ((select public.fn_permitido_de('desinfeccion_ejecucion', 'ver'))
               and (select public.fn_verificar_permiso_zonal(
                       'desinfeccion_ejecucion', 'ver',
                       (select public.fn_dueno_desinfeccion(ejecucion_id)),
                       (select public.fn_zona_de_ejecucion(ejecucion_id)))))
        $sql$, v_tabla || '_select', v_tabla);

        execute format($sql$
            create policy %I on public.%I for all
            using ((select public.fn_verificar_permiso_zonal(
                       'desinfeccion_ejecucion', 'editar',
                       (select public.fn_dueno_desinfeccion(ejecucion_id)),
                       (select public.fn_zona_de_ejecucion(ejecucion_id)))))
            with check ((select public.fn_verificar_permiso_zonal(
                       'desinfeccion_ejecucion', 'crear', null,
                       (select public.fn_zona_de_ejecucion(ejecucion_id)))))
        $sql$, v_tabla || '_write', v_tabla);
    end loop;
end $$;

/* --------------------- Desinfección · logística -------------------- */
-- Ésta sí lleva la zona en la propia fila: la bolsa de acarreo se
-- reparte por zona y por eso la zona es un campo del formulario.

drop policy if exists desinfeccion_logistica_select on public.desinfeccion_logistica;
create policy desinfeccion_logistica_select on public.desinfeccion_logistica for select
    using ((select public.fn_permitido_de('desinfeccion_logistica', 'ver'))
       and case (select public.fn_mi_alcance('desinfeccion_logistica', 'ver'))
           when 'global'      then true
           when 'propietario' then usuario_id = (select auth.uid())
           else (select public.fn_ve_zona_estricta(zona_id))
       end);

drop policy if exists desinfeccion_logistica_insert on public.desinfeccion_logistica;
create policy desinfeccion_logistica_insert on public.desinfeccion_logistica for insert
    with check ((select public.fn_verificar_permiso_zonal(
        'desinfeccion_logistica', 'crear', null, zona_id)));

drop policy if exists desinfeccion_logistica_update on public.desinfeccion_logistica;
create policy desinfeccion_logistica_update on public.desinfeccion_logistica for update
    using ((select public.fn_verificar_permiso_zonal(
        'desinfeccion_logistica', 'editar', usuario_id, zona_id)));

drop policy if exists desinfeccion_logistica_delete on public.desinfeccion_logistica;
create policy desinfeccion_logistica_delete on public.desinfeccion_logistica for delete
    using ((select public.fn_verificar_permiso_zonal(
        'desinfeccion_logistica', 'eliminar', usuario_id, zona_id)));

/* ------------------------ Trasplante · plan ------------------------ */

drop policy if exists plan_siembra_select on public.planes_siembra;
create policy plan_siembra_select on public.planes_siembra for select
    using ((select public.fn_permitido_de('trasplante_plan', 'ver'))
       and case (select public.fn_mi_alcance('trasplante_plan', 'ver'))
           when 'global'      then true
           when 'propietario' then true   -- el plan no lleva dueño
           else (select public.fn_ve_lote_estricto(lote_temporada_id))
       end);

drop policy if exists plan_siembra_insert on public.planes_siembra;
create policy plan_siembra_insert on public.planes_siembra for insert
    with check ((select public.fn_verificar_permiso_zonal(
        'trasplante_plan', 'crear', null,
        (select public.fn_zona_de_lote(lote_temporada_id)))));

drop policy if exists plan_siembra_update on public.planes_siembra;
create policy plan_siembra_update on public.planes_siembra for update
    using ((select public.fn_verificar_permiso_zonal(
        'trasplante_plan', 'editar', null,
        (select public.fn_zona_de_lote(lote_temporada_id)))));

drop policy if exists plan_siembra_delete on public.planes_siembra;
create policy plan_siembra_delete on public.planes_siembra for delete
    using ((select public.fn_verificar_permiso_zonal(
        'trasplante_plan', 'eliminar', null,
        (select public.fn_zona_de_lote(lote_temporada_id)))));

/* --------------------- Trasplante · siembra diaria ----------------- */

drop policy if exists siembras_select on public.siembras;
create policy siembras_select on public.siembras for select
    using ((select public.fn_permitido_de('trasplante_diario', 'ver'))
       and case (select public.fn_mi_alcance('trasplante_diario', 'ver'))
           when 'global'      then true
           when 'propietario' then usuario_id = (select auth.uid())
           else (select public.fn_ve_lote_estricto(lote_temporada_id))
       end);

drop policy if exists siembras_insert on public.siembras;
create policy siembras_insert on public.siembras for insert
    with check ((select public.fn_verificar_permiso_zonal(
        'trasplante_diario', 'crear', null,
        (select public.fn_zona_de_lote(lote_temporada_id)))));

drop policy if exists siembras_update on public.siembras;
create policy siembras_update on public.siembras for update
    using ((select public.fn_verificar_permiso_zonal(
        'trasplante_diario', 'editar', usuario_id,
        (select public.fn_zona_de_lote(lote_temporada_id)))));

drop policy if exists siembras_delete on public.siembras;
create policy siembras_delete on public.siembras for delete
    using ((select public.fn_verificar_permiso_zonal(
        'trasplante_diario', 'eliminar', usuario_id,
        (select public.fn_zona_de_lote(lote_temporada_id)))));

-- Las tres que cuelgan de trasplante y NO tienen lote por donde
-- recortar: los productos de una siembra lo heredan de ella, y la
-- recepción de plántulas y las siembras terminadas son de la finca
-- entera. Sólo cambian de pantalla.

drop policy if exists siembra_productos_select on public.siembra_productos;
create policy siembra_productos_select on public.siembra_productos for select
    using ((select public.fn_tiene_permiso('trasplante_diario', 'ver')));

drop policy if exists siembra_productos_write on public.siembra_productos;
create policy siembra_productos_write on public.siembra_productos for all
    using ((select public.fn_tiene_permiso('trasplante_diario', 'editar'))
        or (select public.fn_tiene_permiso('trasplante_diario', 'crear')))
    with check ((select public.fn_tiene_permiso('trasplante_diario', 'editar'))
             or (select public.fn_tiene_permiso('trasplante_diario', 'crear')));

drop policy if exists recepcion_select on public.recepcion_plantulas;
create policy recepcion_select on public.recepcion_plantulas for select
    using ((select public.fn_tiene_permiso('trasplante_diario', 'ver')));
drop policy if exists recepcion_insert on public.recepcion_plantulas;
create policy recepcion_insert on public.recepcion_plantulas for insert
    with check ((select public.fn_tiene_permiso('trasplante_diario', 'crear')));
drop policy if exists recepcion_update on public.recepcion_plantulas;
create policy recepcion_update on public.recepcion_plantulas for update
    using ((select public.fn_tiene_permiso('trasplante_diario', 'editar')));
drop policy if exists recepcion_delete on public.recepcion_plantulas;
create policy recepcion_delete on public.recepcion_plantulas for delete
    using ((select public.fn_tiene_permiso('trasplante_diario', 'eliminar')));

drop policy if exists siembras_terminadas_select on public.siembras_terminadas;
create policy siembras_terminadas_select on public.siembras_terminadas for select
    using ((select public.fn_tiene_permiso('trasplante_diario', 'ver')));
drop policy if exists siembras_terminadas_write on public.siembras_terminadas;
create policy siembras_terminadas_write on public.siembras_terminadas for all
    using ((select public.fn_tiene_permiso('trasplante_diario', 'editar')))
    with check ((select public.fn_tiene_permiso('trasplante_diario', 'editar')));

-- =====================================================================
-- G · LA FUNCIÓN QUE TAMBIÉN NOMBRABA LAS PANTALLAS MUERTAS
-- =====================================================================
-- `fn_siembras_de_lotes` (63) es la que salva el DDT, y comprueba el
-- permiso DENTRO —es `security definer` y lee el plan de siembra—. Esa
-- comprobación nombraba las dos pantallas padre: al partirlas se
-- quedaba sin contestar nada y el DDT volvería a salir «—».
--
-- Es el mismo fallo que las policies, en una función: partir una
-- pantalla obliga a buscar su nombre en TODO el SQL, no sólo en la
-- tabla de permisos. El guardián de abajo lo vigila a partir de ahora.

create or replace function public.fn_siembras_de_lotes(
    p_lotes uuid[],
    p_ciclo integer default null
)
returns table (
    lote_temporada_id uuid,
    fecha_siembra     date,
    variedad_id       uuid,
    variedad_nombre   text,
    origen            text
)
language sql stable security definer set search_path = public, pg_temp as $$
    with permitido as (
        select (public.fn_tiene_permiso('desinfeccion_plan', 'ver')
             or public.fn_tiene_permiso('desinfeccion_ejecucion', 'ver')
             or public.fn_tiene_permiso('trasplante_plan', 'ver')
             or public.fn_tiene_permiso('trasplante_diario', 'ver')) as si
    ),
    -- Lo ya sembrado. La PRIMERA siembra del lote en el ciclo: un lote se
    -- siembra en varios días y la que abre el ciclo es la que cuenta.
    real_ as (
        select distinct on (s.lote_temporada_id)
               s.lote_temporada_id,
               s.fecha_siembra,
               s.variedad_id,
               v.nombre as variedad_nombre
        from public.siembras s
        left join public.variedades v on v.id = s.variedad_id
        where s.lote_temporada_id = any(p_lotes)
          and (p_ciclo is null or s.ciclo = p_ciclo)
        order by s.lote_temporada_id, s.fecha_siembra
    ),
    -- Lo planificado. Mismo criterio —la más temprana—, y se descartan
    -- los planes sin fecha: un plan sin día no sirve para contar días.
    plan as (
        select distinct on (p.lote_temporada_id)
               p.lote_temporada_id,
               p.fecha_siembra,
               p.variedad_id,
               v.nombre as variedad_nombre
        from public.planes_siembra p
        left join public.variedades v on v.id = p.variedad_id
        where p.lote_temporada_id = any(p_lotes)
          and p.fecha_siembra is not null
          and (p_ciclo is null or p.ciclo = p_ciclo)
        order by p.lote_temporada_id, p.fecha_siembra
    )
    select
        coalesce(r.lote_temporada_id, pl.lote_temporada_id),
        coalesce(r.fecha_siembra,     pl.fecha_siembra),
        coalesce(r.variedad_id,       pl.variedad_id),
        coalesce(r.variedad_nombre,   pl.variedad_nombre),
        case when r.lote_temporada_id is not null then 'real' else 'plan' end
    from real_ r
    full join plan pl on pl.lote_temporada_id = r.lote_temporada_id
    cross join permitido
    where permitido.si
$$;

grant execute on function public.fn_siembras_de_lotes(uuid[], integer) to authenticated;

-- =====================================================================
-- H · LOS GUARDIANES
-- =====================================================================
-- Los dos primeros son los que habrían cazado esta fuga el día que se
-- introdujo. Se quedan para que no vuelva.

do $$
declare
    v_falta text;
begin
    -- Ninguna reja puede llevar un `true or`: cortocircuita lo que venga
    -- detrás y deja el predicado zonal como código muerto que PARECE
    -- vivo. Es la forma más cara de las tres, porque se lee bien.
    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, true) ~ 'fn_mi_alcance'
      and pg_get_viewdef(c.oid, true) ~* 'ELSE\s+true\s+OR';
    if v_falta is not null then
        raise exception 'Rejas con un «true or» que anula el recorte zonal: %', v_falta;
    end if;

    -- Y ninguna puede usar el fallo abierto dentro de la rama zonal.
    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, true) ~ 'fn_mi_alcance'
      and pg_get_viewdef(c.oid, true) ~ 'fn_tiene_zonas';
    if v_falta is not null then
        raise exception 'Rejas que se abren cuando el usuario no tiene zonas: %', v_falta;
    end if;

    -- Las vistas que SÍ tienen zona o lote no pueden quedarse sin
    -- recorte. Las que no lo tienen están declaradas arriba con su razón.
    select string_agg(c.relname, ', ') into v_falta
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and pg_get_viewdef(c.oid, true) ~ 'fn_mi_alcance'
      and exists (
          select 1 from information_schema.columns ic
          where ic.table_schema = 'interno'
            and ic.table_name = c.relname || '_crudo'
            and ic.column_name in ('zona_id', 'lote_temporada_id'))
      and pg_get_viewdef(c.oid, true) !~ 'fn_ve_zona_estricta|fn_ve_lote_estricto';
    if v_falta is not null then
        raise exception 'Vistas con zona o lote y sin recorte estricto: %', v_falta;
    end if;

    -- Las pantallas padre no pueden seguir vivas: una regla que se puede
    -- escribir en dos sitios acaba diciendo dos cosas.
    if exists (select 1 from public.pantallas where codigo in ('desinfeccion', 'trasplante'))
       or exists (select 1 from public.permisos where recurso in ('desinfeccion', 'trasplante'))
    then
        raise exception 'Las pantallas padre de desinfección o trasplante siguen vivas.';
    end if;

    -- Y las hijas tienen que existir todas, o media pantalla se quedaría
    -- sin forma de concederse.
    select string_agg(p, ', ') into v_falta
    from unnest(array['desinfeccion_plan','desinfeccion_ejecucion','desinfeccion_logistica',
                      'desinfeccion_reporte','trasplante_plan','trasplante_diario']) as p
    where not exists (select 1 from public.pantallas where codigo = p);
    if v_falta is not null then
        raise exception 'Faltan sub-pantallas: %', v_falta;
    end if;

    select string_agg(c.relname, ', ') into v_falta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and exists (select 1 from pg_class cr join pg_namespace nr on nr.oid = cr.relnamespace
                  where nr.nspname = 'interno' and cr.relname = c.relname || '_crudo')
      and pg_get_viewdef(c.oid, true) !~ 'fn_permitido_de';
    if v_falta is not null then
        raise exception 'Vistas sin reja de permiso: %', v_falta;
    end if;

    if has_schema_privilege('authenticated', 'interno', 'usage') then
        raise exception 'authenticated puede entrar al esquema interno.';
    end if;

    -- Ninguna policy de los dos módulos de este encargo puede seguir
    -- nombrando la pantalla padre: ya no existe, así que la comprobación
    -- diría que no a todo el mundo y nadie podría escribir.
    select string_agg(distinct tablename || '.' || policyname, ', ') into v_falta
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ '''(desinfeccion|trasplante)''';
    if v_falta is not null then
        raise exception 'Policies que siguen nombrando una pantalla padre muerta: %', v_falta;
    end if;

    -- Ni una funcion puede seguir nombrandolas: `fn_siembras_de_lotes`
    -- lo hacia y se habria quedado muda, con el DDT en «—» otra vez.
    select string_agg(p.proname, ', ') into v_falta
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace::oid
      and p.prosrc ~ '''(desinfeccion|trasplante)''';
    if v_falta is not null then
        raise exception 'Funciones que siguen nombrando una pantalla padre muerta: %', v_falta;
    end if;

    -- **La deuda, escrita.** Estas policies resuelven el alcance zonal
    -- con `fn_verificar_permiso` y sin pasarle la zona, así que su eje
    -- zonal no recorta: `fn_ve_zona(null)` contesta que sí. No se tocan
    -- en esta migración —son de módulos que aquí no se pueden probar— y
    -- por eso se IMPRIMEN: una deuda que se ve es una tarea; una que no,
    -- es un agujero.
    select string_agg(distinct tablename, ', ') into v_falta
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'fn_verificar_permiso\('
      and (coalesce(qual, '') || coalesce(with_check, '')) !~ 'fn_verificar_permiso_zonal\(';
    if v_falta is not null then
        raise notice '66 · DEUDA: estas tablas resuelven el alcance zonal sin pasar la zona, así que su eje zonal no recorta las ESCRITURAS: %', v_falta;
    end if;
end $$;

-- =====================================================================
-- Qué cambia de COMPORTAMIENTO, y conviene saberlo antes de instalarlo:
--
--   · Un usuario con alcance ZONAL y SIN zonas asignadas pasa de verlo
--     todo a no ver nada. Es el arreglo, no un efecto secundario — pero
--     si alguien se queda con la pantalla en blanco, lo primero que hay
--     que mirar son sus zonas en /admin/usuarios.
--   · La rama zonal ya NO incluye «o lo que yo capturé». Zonal quiere
--     decir zonal; para «sólo lo mío» está el alcance propietario. Un
--     digitador zonal que capturó algo en otra zona deja de verlo.
--   · Una fila con zona nula no la ve ningún usuario zonal. Son datos
--     incompletos —un turno sin zona, un lote sin asignar— y hay que
--     completarlos, no dejarlos pasar.
--
-- Qué NO hace esta migración:
--
--   · No toca `fn_ve_zona` ni las policies de la 41 y la 42: ahí el
--     fallo abierto es intencionado y cambiarlo dejaría a gente fuera de
--     módulos que hoy funcionan.
--   · No toca el importador de Excel del módulo de desinfección.
-- =====================================================================
