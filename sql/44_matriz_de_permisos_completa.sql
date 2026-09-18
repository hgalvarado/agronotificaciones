-- =====================================================================
-- 44 · La matriz de Permisos, completa. Ni una llave escondida.
--
-- Ejecutar en el SQL Editor DESPUÉS de la 43.
--
-- El problema: el Digitador no podía agregar un horómetro y el error le
-- decía «tu rol no tiene esa acción en esta pantalla»… pero esa casilla
-- NO EXISTÍA en /admin/permisos, así que no había forma de concedérsela.
-- La matriz era una fachada: enseñaba cinco acciones y la base exigía
-- otras.
--
-- Dos causas, las dos reales:
--
--   1. Faltaban acciones. `horometros` y `labores` no tenían «crear»;
--      nada tenía «exportar» ni «importar»; mover un ticket a Aprobación
--      o a Notificado no tenía casilla propia.
--
--   2. Había recursos de la PRIMERA generación —`catalogo_equipos`,
--      `catalogo_labores`, `ticket`, `horometro`, `registro`— que no son
--      pantallas, así que sus permisos no salían en ninguna fila de la
--      matriz. Veinte policies dependían de ellos.
--
-- Lo que hace esta migración:
--
--   A. Un catálogo de acciones, con su nombre y su explicación. La
--      pantalla lee de ahí: nada de etiquetas escritas en el navegador.
--   B. El juego completo de acciones por pantalla.
--   C. `descargar` pasa a llamarse `exportar` (una sola palabra).
--   D. Los recursos de la primera generación se traducen a pantallas y
--      desaparecen: veinte policies reescritas y los permisos ya
--      concedidos migrados uno a uno, sin que nadie pierda nada.
--   E. Crear deja de ser «editar»: los INSERT piden «crear».
--   F. Aprobar y Notificar son casillas propias.
--   G. Un guardián: `fn_permisos_sin_casilla()` recorre TODAS las
--      policies y funciones, saca cada par (pantalla, acción) que la
--      base exige y avisa del que no tenga casilla. Si mañana alguien
--      agrega una restricción sin su casilla, esto lo canta.
-- =====================================================================

-- =====================================================================
-- A · EL CATÁLOGO DE ACCIONES
-- =====================================================================

create table if not exists public.acciones (
    codigo      text primary key,
    nombre      text not null,
    descripcion text,
    orden       smallint not null default 100,
    /** `false` en las de lectura: es lo único que se le concede al Invitado. */
    escribe     boolean not null default true
);

comment on table public.acciones is
'Las acciones que puede conceder la matriz de Permisos, con su nombre y su explicación. La pantalla lee de aquí.';

alter table public.acciones enable row level security;

drop policy if exists acciones_select on public.acciones;
create policy acciones_select on public.acciones for select
    using ((select auth.uid()) is not null);

drop policy if exists acciones_write on public.acciones;
create policy acciones_write on public.acciones for all
    using ((select public.fn_tiene_permiso('permisos','editar')))
    with check ((select public.fn_tiene_permiso('permisos','editar')));

grant select on public.acciones to authenticated;
grant insert, update, delete on public.acciones to authenticated;

insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('ver',       'Ver',       'La pantalla le aparece en el menú y puede consultarla.', 10, false),
    ('ver_todo',  'Ver todo',  'Ve lo que capturaron los demás, no sólo lo suyo. Sin esta casilla ve únicamente lo que él registró; con ella, toda la empresa, recortada por las zonas que tenga asignadas.', 20, false),
    ('crear',     'Crear',     'Puede agregar registros nuevos.', 30, true),
    ('editar',    'Editar',    'Puede modificar lo que ya existe.', 40, true),
    ('eliminar',  'Eliminar',  'Puede borrar registros, sueltos o en masa.', 50, true),
    ('exportar',  'Exportar',  'Puede bajar la información a Excel.', 60, false),
    ('importar',  'Importar',  'Puede cargar información desde Excel. Es más delicado que crear de uno en uno: entran cientos de filas de golpe.', 70, true),
    ('aprobar',   'Aprobar',   'Puede mover el ticket a «Pendiente Aprobación»: da por buena la revisión.', 80, true),
    ('notificar', 'Notificar', 'Puede marcar el ticket como «Notificado», que es decir que ya se liquidó en SAP. A partir de ahí el ticket queda de sólo lectura para todos.', 90, true)
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    orden = excluded.orden,
    escribe = excluded.escribe;

-- El Invitado sigue viendo toda la empresa sin poder tocar nada: las
-- acciones de lectura salen ahora del catálogo, no de una lista escrita
-- a mano dentro de la función.
create or replace function public.fn_accion_de_lectura(p_accion text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(
        (select not a.escribe from public.acciones a where a.codigo = p_accion),
        -- Los nombres de la primera generación, por si queda alguno
        -- suelto mientras se termina de migrar.
        p_accion in ('read', 'descargar')
    )
$$;

-- =====================================================================
-- B · EL JUEGO COMPLETO DE ACCIONES POR PANTALLA
-- =====================================================================
-- Todo módulo operativo lleva el juego estándar. Que la casilla exista
-- no concede nada: sólo permite concederlo.

update public.pantallas set acciones = array[
    'ver','ver_todo','crear','editar','eliminar','exportar','importar','aprobar','notificar'
] where codigo = 'tickets';

update public.pantallas set acciones = array[
    'ver','ver_todo','crear','editar','eliminar','exportar','importar'
] where codigo in ('horometros','labores','turnos_riego','trasplante');

update public.pantallas set acciones = array[
    'ver','crear','editar','eliminar','exportar','importar'
] where codigo in ('plan','plan_aps','plan_lev','plan_cos','lotes','catalogos','tarifas');

update public.pantallas set acciones = array['ver','crear','editar','eliminar','exportar']
where codigo = 'usuarios';

update public.pantallas set acciones = array['ver','crear','importar']
where codigo = 'historico';

update public.pantallas set acciones = array['ver','exportar']
where codigo in ('costos','avance');

update public.pantallas set acciones = array['ver','editar']
where codigo in ('reporte_publico','permisos');

-- =====================================================================
-- C · «DESCARGAR» SE LLAMA «EXPORTAR»
-- =====================================================================
-- Dos palabras para lo mismo era una de las formas de que la casilla no
-- coincidiera con lo que la base pregunta.

update public.permisos set accion = 'exportar'
where accion = 'descargar'
  and not exists (
      select 1 from public.permisos otro
      where otro.rol_id = permisos.rol_id
        and otro.recurso = permisos.recurso
        and otro.accion = 'exportar'
  );

delete from public.permisos where accion = 'descargar';

-- =====================================================================
-- D · LOS RECURSOS DE LA PRIMERA GENERACIÓN, TRADUCIDOS
-- =====================================================================
-- `catalogo_equipos`, `catalogo_labores`, `ticket`, `horometro`… no son
-- pantallas, así que no tenían fila en la matriz y sus permisos eran
-- invisibles. Se traducen a la pantalla que les corresponde y se
-- retiran. Primero los permisos ya concedidos, para que nadie pierda
-- nada de lo que hoy puede hacer.

insert into public.permisos (rol_id, recurso, accion)
select distinct p.rol_id, t.pantalla, t.accion
from public.permisos p
join (values
    ('ticket',               'create', 'tickets',    'crear'),
    ('ticket',               'read',   'tickets',    'ver'),
    ('ticket',               'update', 'tickets',    'editar'),
    ('ticket',               'delete', 'tickets',    'eliminar'),
    ('horometro',            'create', 'horometros', 'crear'),
    ('horometro',            'read',   'horometros', 'ver'),
    ('horometro',            'update', 'horometros', 'editar'),
    ('horometro',            'delete', 'horometros', 'eliminar'),
    ('registro',             'create', 'labores',    'crear'),
    ('registro',             'read',   'labores',    'ver'),
    ('registro',             'update', 'labores',    'editar'),
    ('registro',             'delete', 'labores',    'eliminar'),
    ('catalogo_equipos',     'create', 'catalogos',  'crear'),
    ('catalogo_equipos',     'update', 'catalogos',  'editar'),
    ('catalogo_implementos', 'create', 'catalogos',  'crear'),
    ('catalogo_implementos', 'update', 'catalogos',  'editar'),
    ('catalogo_labores',     'create', 'catalogos',  'crear'),
    ('catalogo_labores',     'update', 'catalogos',  'editar'),
    ('catalogo_operadores',  'create', 'catalogos',  'crear'),
    ('catalogo_operadores',  'update', 'catalogos',  'editar'),
    ('catalogo_ubicaciones', 'create', 'lotes',      'crear'),
    ('catalogo_ubicaciones', 'update', 'lotes',      'editar')
) as t(viejo_recurso, vieja_accion, pantalla, accion)
  on t.viejo_recurso = p.recurso and t.vieja_accion = p.accion
on conflict do nothing;

-- Y ahora las policies que los consultaban.
drop policy if exists equipos_write on public.equipos;
create policy equipos_write on public.equipos for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));
drop policy if exists equipos_update on public.equipos;
create policy equipos_update on public.equipos for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists familias_insert on public.familias_equipo;
create policy familias_insert on public.familias_equipo for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));
drop policy if exists familias_update on public.familias_equipo;
create policy familias_update on public.familias_equipo for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists implementos_write on public.implementos;
create policy implementos_write on public.implementos for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));
drop policy if exists implementos_update on public.implementos;
create policy implementos_update on public.implementos for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists implementos_fisicos_write on public.implementos_fisicos;
create policy implementos_fisicos_write on public.implementos_fisicos for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));
drop policy if exists implementos_fisicos_update on public.implementos_fisicos;
create policy implementos_fisicos_update on public.implementos_fisicos for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists labores_write on public.labores;
create policy labores_write on public.labores for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));
drop policy if exists labores_update on public.labores;
create policy labores_update on public.labores for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists labores_tareas_write on public.labores_tareas;
create policy labores_tareas_write on public.labores_tareas for all
    using ((select public.fn_tiene_permiso('catalogos','editar')))
    with check ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists labores_implementos_write on public.labores_implementos;
create policy labores_implementos_write on public.labores_implementos for all
    using ((select public.fn_tiene_permiso('catalogos','editar')))
    with check ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists lab_impl_fis_write on public.labores_implementos_fisicos;
create policy lab_impl_fis_write on public.labores_implementos_fisicos for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));
drop policy if exists lab_impl_fis_delete on public.labores_implementos_fisicos;
create policy lab_impl_fis_delete on public.labores_implementos_fisicos for delete
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists operadores_write on public.operadores;
create policy operadores_write on public.operadores for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));
drop policy if exists operadores_update on public.operadores;
create policy operadores_update on public.operadores for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists lotes_write on public.lotes;
create policy lotes_write on public.lotes for insert
    with check ((select public.fn_tiene_permiso('lotes','crear')));
drop policy if exists lotes_update on public.lotes;
create policy lotes_update on public.lotes for update
    using ((select public.fn_tiene_permiso('lotes','editar')));

drop policy if exists lotes_temporada_write on public.lotes_temporada;
create policy lotes_temporada_write on public.lotes_temporada for insert
    with check ((select public.fn_tiene_permiso('lotes','crear')));
drop policy if exists lotes_temporada_update on public.lotes_temporada;
create policy lotes_temporada_update on public.lotes_temporada for update
    using ((select public.fn_tiene_permiso('lotes','editar')));

-- El alta de tickets: se cae la rama del recurso viejo.
drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert
    with check (
        (select public.fn_tiene_permiso('tickets','crear'))
        and (usuario_id = (select auth.uid()) or (select public.fn_ve_todo('tickets')))
    );

-- Y se retiran los permisos de la primera generación, que ya no los
-- consulta nadie. Quedarse con ellos sería dejar filas en la tabla que
-- no significan nada y que nadie puede ver en la matriz.
delete from public.permisos
where recurso not in (select codigo from public.pantallas);

-- =====================================================================
-- E · CREAR ES «CREAR», NO «EDITAR»
-- =====================================================================
-- Los INSERT pedían `editar`. Es lo que dejaba al Digitador sin poder
-- agregar un horómetro: se le concedía «crear» —que ni siquiera existía
-- como casilla— y la base pedía otra cosa.

drop policy if exists horometros_insert on public.horometros;
create policy horometros_insert on public.horometros for insert
    with check ((select public.fn_puede_escribir_en_ticket(horometros.ticket_id, 'horometros', 'crear')));

drop policy if exists registros_insert on public.registros;
create policy registros_insert on public.registros for insert
    with check ((select public.fn_puede_escribir_en_ticket(registros.ticket_id, 'labores', 'crear')));

drop policy if exists registro_detalle_insert on public.registro_detalle;
create policy registro_detalle_insert on public.registro_detalle for insert
    with check ((select public.fn_puede_escribir_en_ticket(
        (select r.ticket_id from public.registros r where r.id = registro_detalle.registro_id),
        'labores', 'crear')));

-- Quien podía editar hasta ayer sigue pudiendo crear hoy: si no, esta
-- migración le quitaría a media empresa la captura del día.
insert into public.permisos (rol_id, recurso, accion)
select p.rol_id, p.recurso, 'crear'
from public.permisos p
where p.recurso in ('horometros','labores','turnos_riego','trasplante')
  and p.accion = 'editar'
on conflict do nothing;

-- Y el Digitador de campo, que es quien reportó el bloqueo, queda con lo
-- que le corresponde: capturar lo suyo de punta a punta.
insert into public.permisos (rol_id, recurso, accion)
select r.id, x.recurso, x.accion
from public.roles r
cross join (values
    ('tickets','ver'), ('tickets','crear'), ('tickets','editar'),
    ('horometros','ver'), ('horometros','crear'), ('horometros','editar'),
    ('labores','ver'), ('labores','crear'), ('labores','editar')
) as x(recurso, accion)
where r.codigo in ('DIGITADOR', 'DIGITADOR_PARAMETRISTA')
on conflict do nothing;

-- =====================================================================
-- F · APROBAR Y NOTIFICAR, CON CASILLA PROPIA
-- =====================================================================
-- Mover un ticket a «Pendiente Aprobación» o a «Notificado» son las dos
-- decisiones que cierran el ciclo hacia SAP, y no tenían casilla: las
-- hacía cualquiera con «Ver todo». Ahora se conceden aparte.

create or replace function public.cambiar_proceso_ticket(
    p_ticket_id uuid,
    p_proceso   public.proceso_ticket
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ticket public.tickets%rowtype;
    v_todo   boolean;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;

    if not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'editar')) then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    -- Se lee con la función —que es `definer`— para poder distinguir «el
    -- ticket no existe» de «el ticket no es tuyo». Con un `select` sujeto
    -- a RLS las dos cosas se ven igual: cero filas.
    select * into v_ticket from public.tickets t where t.id = p_ticket_id;

    if not found then
        raise exception 'El ticket ya no existe. Actualiza la lista.';
    end if;

    if v_ticket.proceso = p_proceso then
        -- No es un error: alguien ya lo movió. Se sale sin tocar nada
        -- para que pulsar dos veces no cuente como fallo.
        return;
    end if;

    v_todo := public.fn_es_admin() or public.fn_ve_todo('tickets');

    if not v_todo then
        if v_ticket.usuario_id is distinct from auth.uid() then
            raise exception 'Este ticket es de otra persona. Hace falta «Ver todo» en Tickets para moverlo.'
                using errcode = '42501';
        end if;
        if p_proceso <> 'REVISANDO' then
            raise exception 'Sin «Ver todo» en Tickets sólo puedes enviarlo a revisión; el resto del flujo lo mueve quien revisa.'
                using errcode = '42501';
        end if;
        if v_ticket.proceso <> 'REGISTRADO' then
            raise exception 'Este ticket ya salió de «Registrado»: desde aquí lo mueve quien tenga «Ver todo» en Tickets.'
                using errcode = '42501';
        end if;
    end if;

    -- Los dos pasos que cierran el ciclo llevan su propia llave.
    if p_proceso = 'PENDIENTE_APROBACION'
       and not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'aprobar')) then
        raise exception 'Tu rol no tiene «Aprobar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    if p_proceso = 'NOTIFICADO'
       and not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'notificar')) then
        raise exception 'Tu rol no tiene «Notificar» en la pantalla de Tickets. Marcar un ticket como notificado lo deja de sólo lectura, así que se concede aparte.'
            using errcode = '42501';
    end if;

    update public.tickets set proceso = p_proceso where id = p_ticket_id;
end;
$$;

grant execute on function public.cambiar_proceso_ticket(uuid, public.proceso_ticket) to authenticated;

-- El cambio en bloque, con las mismas dos llaves.
create or replace function public.actualizar_tickets_masivo(
    p_ticket_ids uuid[],
    p_estado     public.estado_ticket default null,
    p_proceso    public.proceso_ticket default null
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_afectados integer := 0;
begin
    if p_ticket_ids is null or array_length(p_ticket_ids, 1) is null then
        raise exception 'No se recibió ningún ticket.';
    end if;

    if p_estado is null and p_proceso is null then
        raise exception 'Indica al menos un cambio: estado o proceso.';
    end if;

    if not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'editar')) then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    if p_proceso = 'PENDIENTE_APROBACION'
       and not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'aprobar')) then
        raise exception 'Tu rol no tiene «Aprobar» en la pantalla de Tickets.' using errcode = '42501';
    end if;

    if p_proceso = 'NOTIFICADO'
       and not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'notificar')) then
        raise exception 'Tu rol no tiene «Notificar» en la pantalla de Tickets.' using errcode = '42501';
    end if;

    update public.tickets t
    set
        estado     = coalesce(p_estado, t.estado),
        proceso    = coalesce(p_proceso, t.proceso),
        cerrado_at = case
                        when p_estado = 'CERRADO' and t.estado <> 'CERRADO' then now()
                        when p_estado = 'ABIERTO' then null
                        else t.cerrado_at
                     end,
        cerrado_by = case
                        when p_estado = 'CERRADO' and t.estado <> 'CERRADO' then auth.uid()
                        when p_estado = 'ABIERTO' then null
                        else t.cerrado_by
                     end
    where t.id = any(p_ticket_ids)
      and (public.fn_es_admin() or t.proceso <> 'NOTIFICADO')
      and (public.fn_es_admin()
           or public.fn_ve_todo('tickets')
           or t.usuario_id = auth.uid());

    get diagnostics v_afectados = row_count;
    return v_afectados;
end;
$$;

grant execute on function public.actualizar_tickets_masivo(uuid[], public.estado_ticket, public.proceso_ticket) to authenticated;

-- Quien movía el flujo hasta ayer sigue moviéndolo: las dos llaves nuevas
-- se le conceden a quien ya tenía «Ver todo» en Tickets.
insert into public.permisos (rol_id, recurso, accion)
select p.rol_id, 'tickets', x.accion
from public.permisos p
cross join (values ('aprobar'), ('notificar')) as x(accion)
where p.recurso = 'tickets' and p.accion = 'ver_todo'
on conflict do nothing;

-- =====================================================================
-- G · EL GUARDIÁN: NINGUNA LLAVE SIN CASILLA
-- =====================================================================

/**
 * Cada par (pantalla, acción) que la base EXIGE de verdad.
 *
 * Sale de leer todas las policies y todas las funciones buscando las
 * llamadas a `fn_tiene_permiso`, `fn_ve_todo` y
 * `fn_puede_escribir_en_ticket`. Es la lista de llaves que el sistema usa
 * realmente, no la que alguien recuerda haber puesto.
 */
create or replace view public.v_permisos_exigidos as
with fuentes as (
    select coalesce(qual, '') || ' ' || coalesce(with_check, '') as txt
    from pg_policies where schemaname = 'public'
    union all
    select prosrc from pg_proc where pronamespace = 'public'::regnamespace
),
directos as (
    select (regexp_matches(txt, 'fn_tiene_permiso\(''([a-z_]+)''[^,]*, *''([a-z_]+)''', 'g')) as m
    from fuentes
),
en_ticket as (
    select (regexp_matches(txt, 'fn_puede_escribir_en_ticket\([^,]+, *''([a-z_]+)''[^,]*, *''([a-z_]+)''', 'g')) as m
    from fuentes
),
alcance as (
    select array[(regexp_matches(txt, 'fn_ve_todo\(''([a-z_]+)''', 'g'))[1], 'ver_todo'] as m
    from fuentes
),
todos as (
    select m[1] as pantalla, m[2] as accion from directos
    union select m[1], m[2] from en_ticket
    union select m[1], m[2] from alcance
)
select distinct pantalla, accion from todos
where pantalla is not null and accion is not null;

comment on view public.v_permisos_exigidos is
'Cada par (pantalla, acción) que alguna policy o función exige de verdad. Es la lista contra la que se comprueba la matriz.';

alter view public.v_permisos_exigidos set (security_invoker = on);
grant select on public.v_permisos_exigidos to authenticated;

/**
 * Las llaves que la base exige y la matriz NO ofrece.
 *
 * Tiene que devolver cero filas. Si devuelve algo, hay una restricción
 * que nadie puede encender ni apagar desde la pantalla, que es
 * exactamente el problema que esta migración viene a cerrar.
 */
create or replace function public.fn_permisos_sin_casilla()
returns table (pantalla text, accion text, motivo text)
language sql stable security definer set search_path = public, pg_temp as $$
    select e.pantalla,
           e.accion,
           case
               when p.codigo is null then 'No hay una pantalla con ese código en la matriz.'
               else 'La pantalla existe pero no ofrece esa casilla.'
           end
    from public.v_permisos_exigidos e
    left join public.pantallas p on p.codigo = e.pantalla
    where p.codigo is null or not (p.acciones @> array[e.accion])
    order by 1, 2
$$;

comment on function public.fn_permisos_sin_casilla() is
'Llaves que la base exige y la matriz no ofrece. Tiene que devolver cero filas.';

grant execute on function public.fn_permisos_sin_casilla() to authenticated;

-- =====================================================================
-- Comprobación
-- =====================================================================
do $$
declare
    v_faltan  integer;
    v_fila    record;
    v_legacy  integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    select count(*) into v_legacy from public.permisos
    where recurso not in (select codigo from public.pantallas);

    raise notice 'Migración 44 aplicada. Llaves sin casilla: %. Permisos huérfanos: %.',
        v_faltan, v_legacy;

    if v_faltan > 0 then
        for v_fila in select * from public.fn_permisos_sin_casilla() loop
            raise warning 'SIN CASILLA → %:% · %', v_fila.pantalla, v_fila.accion, v_fila.motivo;
        end loop;
    else
        raise notice 'Toda restricción de la base tiene su casilla en /admin/permisos.';
    end if;

    raise notice 'El Digitador ya puede agregar horómetros y labores en sus tickets.';
end $$;
