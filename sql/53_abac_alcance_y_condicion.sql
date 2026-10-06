-- =====================================================================
-- 53 · De permisos booleanos a ABAC: acción + alcance + condición
--
-- Ejecutar en el SQL Editor DESPUÉS de la 52.
--
-- Hasta hoy un permiso era la EXISTENCIA de una fila en `permisos`:
-- estaba o no estaba. Los otros dos ejes existían, pero repartidos en
-- mecanismos que no se hablaban entre sí:
--
--   · El ALCANCE vivía en la acción `ver_todo` (lo mío contra lo de
--     todos) y, por separado, en `perfiles_zonas` + `fn_ve_zona`.
--   · La CONDICIÓN vivía en la acción `editar_en_revision` de la 50,
--     más el tope de `fn_ticket_notificado`.
--
-- `tickets_update` llegó a necesitar CINCO llamadas para expresar una
-- sola regla. Eso no se puede configurar desde una pantalla, y lo que no
-- se puede configurar se acaba pidiendo por correo.
--
-- Aquí los tres ejes pasan a ser columnas de la misma fila:
--
--     permitido · alcance · condicion
--
-- =====================================================================
-- LO QUE **NO** CAMBIA EL DÍA QUE ESTO CORRA
-- =====================================================================
-- La migración DERIVA los valores nuevos de lo que ya está configurado,
-- así que el acceso efectivo de cada rol queda como estaba:
--
--   `ver_todo` marcado        → alcance = 'zonal'
--   `ver_todo` sin marcar     → alcance = 'propietario'
--   `editar_en_revision`      → condicion = 'sin_restriccion'
--   sin `editar_en_revision`  → condicion = 'solo_abiertos_registrando'
--
-- Por qué `zonal` y no `global` para quien ya tenía `ver_todo`: hoy la
-- regla real es `fn_ve_todo AND fn_ve_ticket`, y `fn_ve_zona` ya degrada
-- a «todo» cuando el usuario no tiene zonas asignadas. Con 'zonal' se
-- reproducen los DOS casos de hoy —con zonas, recortado; sin zonas,
-- completo—. 'global' es la opción nueva: ignora las zonas a propósito,
-- y se concede a mano.
--
-- La ÚNICA diferencia de comportamiento está acotada y es más estricta,
-- nunca más laxa: un ticket CERRADO que siga en «0. Registrado». Hoy se
-- deja editar; con `solo_abiertos_registrando` —que es lo que su nombre
-- promete: abierto Y registrando— ya no. Se devuelve marcando la celda
-- con `sin_restriccion`, que es justo el control que esto viene a dar.
-- =====================================================================


-- =====================================================================
-- A · LOS DOS EJES NUEVOS, COMO TIPOS
-- =====================================================================
-- Enums y no texto libre: son listas cerradas que la base tiene que
-- poder validar. Un `alcance = 'zonaal'` escrito a mano no debe poder
-- guardarse y descubrirse como un hueco de seguridad tres meses después.

do $$
begin
    if not exists (select 1 from pg_type where typname = 'alcance_permiso') then
        create type public.alcance_permiso as enum ('global', 'zonal', 'propietario');
    end if;
    if not exists (select 1 from pg_type where typname = 'condicion_permiso') then
        create type public.condicion_permiso as enum
            ('sin_restriccion', 'solo_abiertos_registrando');
    end if;
end $$;

comment on type public.alcance_permiso is
'Sobre QUÉ registros aplica la acción: todos, los de mis zonas, o sólo los míos.';
comment on type public.condicion_permiso is
'En qué ESTADO del registro aplica la acción. Sólo recorta escrituras.';


-- =====================================================================
-- B · LA MATRIZ DEJA DE SER UNA LISTA DE FILAS SUELTAS
-- =====================================================================

alter table public.permisos
    add column if not exists permitido boolean not null default true,
    add column if not exists alcance   public.alcance_permiso not null default 'global',
    add column if not exists condicion public.condicion_permiso not null default 'sin_restriccion';

/**
 * `permitido` existe para que apagar una acción NO borre su
 * configuración.
 *
 * Sin esta columna, quitar el permiso en la pantalla significa borrar la
 * fila, y con ella el alcance y la condición que alguien ajustó. Al
 * volver a encenderlo todo regresaría a los valores por omisión y nadie
 * se enteraría de que se perdió el ajuste. Con `permitido` la fila
 * sobrevive apagada y recuerda cómo estaba.
 */
comment on column public.permisos.permitido is
'La acción está concedida. `false` es un NO explícito que conserva el alcance y la condición configurados.';
comment on column public.permisos.alcance is
'Sobre qué registros: global (todos), zonal (los de las zonas del usuario), propietario (los que él capturó).';
comment on column public.permisos.condicion is
'En qué estado del registro: sin_restriccion, o sólo mientras esté Activo y en «0. Registrando».';


-- =====================================================================
-- C · LA DERIVACIÓN: LO QUE YA ESTABA CONFIGURADO, TRADUCIDO
-- =====================================================================
-- Va antes de tocar ninguna función: si algo saliera mal, las acciones
-- viejas todavía están ahí para volver a intentarlo.

do $$
begin
    -- Sólo la primera vez: correr la migración dos veces no puede
    -- reescribir ajustes que el Administrador ya haya hecho a mano.
    if exists (select 1 from public.permisos where accion = 'ver_todo') then

        -- 1 · ALCANCE. `ver_todo` concedía «lo de todos»; la zona ya lo
        --     recortaba por su cuenta. 'zonal' dice las dos cosas a la
        --     vez y reproduce el comportamiento exacto de hoy.
        update public.permisos p
        set alcance = 'zonal'
        where exists (
            select 1 from public.permisos v
            where v.rol_id = p.rol_id and v.recurso = p.recurso and v.accion = 'ver_todo'
        );

        -- 2 · Y quien no la tenía, sólo veía lo suyo.
        update public.permisos p
        set alcance = 'propietario'
        where not exists (
            select 1 from public.permisos v
            where v.rol_id = p.rol_id and v.recurso = p.recurso and v.accion = 'ver_todo'
        )
        -- Las pantallas que nunca tuvieron la casilla `ver_todo` no
        -- tienen dueño por registro: un catálogo, una tarifa o un plan
        -- son de la empresa. Ésas se quedan globales.
        and p.recurso in (
            select codigo from public.pantallas where acciones @> array['ver_todo']
        );

        -- 3 · CONDICIÓN. Quien podía editar en revisión no tenía tope;
        --     quien no, sólo trabajaba el ticket mientras estaba en el
        --     paso 0.
        update public.permisos p
        set condicion = case
            when exists (
                select 1 from public.permisos e
                where e.rol_id = p.rol_id
                  and e.recurso = 'tickets'
                  and e.accion = 'editar_en_revision'
            ) then 'sin_restriccion'::public.condicion_permiso
            else 'solo_abiertos_registrando'::public.condicion_permiso
        end
        where p.recurso in ('tickets', 'horometros', 'labores')
          and not public.fn_accion_de_lectura(p.accion);

        -- 4 · Las dos acciones viejas ya están dichas en las columnas.
        --     Dejarlas sería tener la misma regla escrita dos veces y en
        --     dos sitios que pueden discrepar.
        delete from public.permisos where accion in ('ver_todo', 'editar_en_revision');

        update public.pantallas
        set acciones = array_remove(array_remove(acciones, 'ver_todo'), 'editar_en_revision');

        delete from public.acciones where codigo in ('ver_todo', 'editar_en_revision');

        raise notice 'ok  alcance y condicion derivados de la configuracion existente';
    end if;
end $$;


-- =====================================================================
-- D · LA FUNCIÓN QUE LO EVALÚA TODO
-- =====================================================================

/**
 * La fila de la matriz que aplica a quien pregunta.
 *
 * Resuelve aquí —y en un solo sitio— los dos roles que no salen de la
 * tabla: el Invitado, que sólo mira, y el Administrador.
 *
 * Sobre el Administrador: sigue siendo un nombre de rol escrito en el
 * código, y es deliberado. Es el FRENO DE MANO. Si la matriz se
 * configura mal —y esta migración existe precisamente para que se pueda
 * configurar— tiene que quedar alguien capaz de entrar a arreglarla.
 * Sin esta salida, un error en una celda deja la empresa fuera de su
 * propio sistema y sin forma de volver a entrar. Es el único nombre de
 * rol que queda, y no se amplía.
 */
create or replace function public.fn_permiso_de(p_pantalla text, p_accion text)
returns table (
    permitido boolean,
    alcance   public.alcance_permiso,
    condicion public.condicion_permiso
)
language sql stable security definer set search_path = public, pg_temp as $$
    select
        case
            when public.fn_es_invitado() then public.fn_accion_de_lectura(p_accion)
            when public.fn_es_admin()    then true
            else coalesce(pm.permitido, false)
        end,
        case
            when public.fn_es_invitado() or public.fn_es_admin() then 'global'::public.alcance_permiso
            else coalesce(pm.alcance, 'propietario'::public.alcance_permiso)
        end,
        case
            when public.fn_es_invitado() or public.fn_es_admin()
                then 'sin_restriccion'::public.condicion_permiso
            else coalesce(pm.condicion, 'sin_restriccion'::public.condicion_permiso)
        end
    from (select 1) as _
    left join public.perfiles pe on pe.id = (select auth.uid())
    left join public.permisos pm
           on pm.rol_id  = pe.rol_id
          and pm.recurso = p_pantalla
          and pm.accion  = p_accion
$$;

grant execute on function public.fn_permiso_de(text, text) to authenticated;

/**
 * ¿Puede ESTA persona hacer ESTA acción sobre ESTE registro?
 *
 * Los cuatro últimos parámetros describen el registro. Van sueltos y no
 * como una fila entera a propósito: la misma pregunta la hacen tablas
 * con formas distintas —un ticket, un horómetro, una labor— y pasarles
 * un tipo común obligaría a inventar una vista por tabla.
 *
 * Un parámetro NULO quiere decir «este registro no tiene ese atributo»,
 * y entonces ese eje no recorta nada. Preguntar sin registro —los cuatro
 * nulos— contesta la pregunta de pantalla: «¿podría llegar a hacerlo?».
 * Es lo que necesita un menú para decidir si enseña un botón.
 */
create or replace function public.fn_verificar_permiso(
    p_pantalla         text,
    p_accion           text,
    p_dueno            uuid     default null,
    p_zona             uuid     default null,
    p_estado_abierto   boolean  default null,
    p_nivel_proceso    smallint default null
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    with r as (select * from public.fn_permiso_de(p_pantalla, p_accion))
    select
        r.permitido

        -- ---------------------------- ALCANCE ----------------------------
        and case r.alcance
            when 'global' then true
            -- Sin dueño conocido no hay nada que comparar: el eje no
            -- recorta. Es el caso de preguntar por la pantalla.
            when 'propietario' then p_dueno is null or p_dueno = (select auth.uid())
            -- `fn_ve_zona` ya contesta «sí» cuando el usuario no tiene
            -- zonas asignadas, que es como se comporta hoy.
            when 'zonal' then
                p_dueno = (select auth.uid()) or public.fn_ve_zona(p_zona)
        end

        -- --------------------------- CONDICIÓN ---------------------------
        -- Sólo recorta ESCRITURAS. Una condición que escondiera lecturas
        -- haría desaparecer el histórico de la pantalla, que es
        -- exactamente lo que nadie quiere de un sistema de control.
        and (
            r.condicion = 'sin_restriccion'
            or public.fn_accion_de_lectura(p_accion)
            or (
                coalesce(p_estado_abierto, true)
                and coalesce(p_nivel_proceso, 0) = 0
            )
        )
    from r
$$;

comment on function public.fn_verificar_permiso(text, text, uuid, uuid, boolean, smallint) is
'La única puerta: acción + alcance + condición, evaluados contra un registro concreto. Un atributo nulo es un eje que no recorta.';

grant execute on function public.fn_verificar_permiso(text, text, uuid, uuid, boolean, smallint) to authenticated;


-- =====================================================================
-- E · LAS FUNCIONES DE SIEMPRE, AHORA DERIVADAS
-- =====================================================================
-- `fn_tiene_permiso` y `fn_ve_todo` las llaman más de cien sitios entre
-- policies, RPC y pantallas. No se tocan por fuera: cambian por dentro y
-- pasan a ser atajos sobre la función nueva. Así la migración no obliga
-- a reescribir media base en el mismo paso.

create or replace function public.fn_tiene_permiso(p_recurso text, p_accion text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    -- Sin registro: «¿podría?». El alcance y la condición los aplica
    -- quien SÍ tiene el registro delante.
    select public.fn_verificar_permiso(p_recurso, p_accion)
$$;

comment on function public.fn_tiene_permiso(text, text) is
'¿Tiene concedida la acción en esa pantalla? Sin registro delante, así que no mira alcance ni condición.';

/**
 * ¿Ve lo que capturaron los demás?
 *
 * Ya no es una casilla propia: es el ALCANCE de «ver». Global y zonal
 * ven lo de otros —el segundo recortado por zona—; propietario, no.
 */
create or replace function public.fn_ve_todo(p_pantalla text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(
        (select alcance <> 'propietario' from public.fn_permiso_de(p_pantalla, 'ver')),
        false
    )
$$;

/** El alcance de una acción, para que la pantalla filtre antes de pedir. */
create or replace function public.fn_mi_alcance(p_pantalla text, p_accion text default 'ver')
returns text
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select alcance::text from public.fn_permiso_de(p_pantalla, p_accion)), 'propietario')
$$;

grant execute on function public.fn_mi_alcance(text, text) to authenticated;

/**
 * Los permisos efectivos, ahora con sus tres ejes.
 *
 * La pantalla los necesita enteros: con sólo «puede/no puede» no podría
 * ni recortar la consulta por propietario ni esconder un botón por la
 * condición, y tendría que preguntar a la base fila por fila.
 *
 * DROP + CREATE: cambia la forma de la tabla que devuelve, y
 * `create or replace` no puede con eso.
 */
drop function if exists public.fn_mis_permisos();

create function public.fn_mis_permisos()
returns table (
    recurso   text,
    accion    text,
    alcance   text,
    condicion text
)
language sql stable security definer set search_path = public, pg_temp as $$
    -- Administrador e Invitado no tienen filas en la matriz: sus reglas
    -- están en `fn_permiso_de`, y aquí se expanden sobre el catálogo de
    -- pantallas para que el menú las vea igual que las demás.
    select p.codigo, a.accion, 'global', 'sin_restriccion'
    from public.pantallas p
    cross join lateral unnest(p.acciones) as a(accion)
    where public.fn_es_admin() and not public.fn_es_invitado()

    union

    select p.codigo, a.accion, 'global', 'sin_restriccion'
    from public.pantallas p
    cross join lateral unnest(p.acciones) as a(accion)
    where public.fn_es_invitado()
      and public.fn_accion_de_lectura(a.accion)

    union

    select pm.recurso, pm.accion, pm.alcance::text, pm.condicion::text
    from public.perfiles pe
    join public.permisos pm on pm.rol_id = pe.rol_id
    join public.pantallas pa on pa.codigo = pm.recurso
    where pe.id = (select auth.uid())
      and pm.permitido
      and not public.fn_es_invitado()
$$;

grant execute on function public.fn_mis_permisos() to authenticated;


-- =====================================================================
-- F · EL TICKET, Y TODO LO QUE CUELGA DE ÉL
-- =====================================================================

/** Los atributos del ticket que los tres ejes necesitan, de una pasada. */
create or replace function public.fn_atributos_ticket(p_ticket_id uuid)
returns table (
    dueno          uuid,
    estado_abierto boolean,
    nivel          smallint,
    notificado     boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
    select t.usuario_id,
           t.estado = 'ABIERTO',
           public.fn_nivel_proceso(t.proceso),
           t.proceso = 'NOTIFICADO'
    from public.tickets t
    where t.id = p_ticket_id
$$;

grant execute on function public.fn_atributos_ticket(uuid) to authenticated;

/**
 * Quién puede escribir en lo que cuelga de un ticket.
 *
 * La misma firma de siempre —la usan las policies de horómetros y
 * labores, y media docena de RPC—, pero ahora delega los tres ejes en
 * `fn_verificar_permiso`.
 *
 * La ZONA de un ticket no es una columna: sale de los lotes de sus
 * labores, y por eso la contesta `fn_ve_ticket`. Se evalúa aparte, con
 * el alcance leído de la matriz, en vez de pasarla como atributo.
 *
 * El tope de NOTIFICADO sigue estando y sigue siendo independiente de la
 * condición: ya se liquidó en SAP, y ninguna casilla lo abre.
 */
create or replace function public.fn_puede_escribir_en_ticket(
    p_ticket_id uuid,
    p_pantalla  text,
    p_accion    text
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin()
        or (
            not coalesce((select notificado from public.fn_atributos_ticket(p_ticket_id)), false)
            and public.fn_verificar_permiso(
                    p_pantalla,
                    p_accion,
                    (select dueno          from public.fn_atributos_ticket(p_ticket_id)),
                    null,
                    (select estado_abierto from public.fn_atributos_ticket(p_ticket_id)),
                    (select nivel          from public.fn_atributos_ticket(p_ticket_id))
                )
            -- El recorte por zona del ticket, que no es un atributo suyo
            -- sino de los lotes de sus labores.
            and (
                public.fn_mi_alcance(p_pantalla, p_accion) <> 'zonal'
                or public.fn_ve_ticket(p_ticket_id)
            )
        )
$$;

comment on function public.fn_puede_escribir_en_ticket(uuid, text, text) is
'Acción + alcance + condición sobre el ticket, con NOTIFICADO como tope que ninguna casilla abre.';

create or replace function public.fn_puede_capturar_en_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_puede_escribir_en_ticket(p_ticket_id, 'labores', 'editar')
        or public.fn_puede_escribir_en_ticket(p_ticket_id, 'horometros', 'editar')
$$;

-- `fn_ticket_en_revision` ya no decide nada por su cuenta: la condición
-- la evalúa `fn_verificar_permiso` con el nivel del proceso. Se deja
-- porque la 50 la dejó documentada y alguna consulta puede leerla.
comment on function public.fn_ticket_en_revision(uuid) is
'El ticket salió de «0. Registrado». Informativa: la regla la aplica fn_verificar_permiso con condicion.';


-- =====================================================================
-- G · LAS POLICIES: UN MURO, UNA FUNCIÓN
-- =====================================================================
-- Antes cada policy repetía la regla con sus propios matices —y por eso
-- `tickets_update` y `tickets_delete` acabaron con cinco llamadas cada
-- una—. Ahora todas dicen lo mismo y lo dicen una vez.

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select
    using (
        (select public.fn_verificar_permiso('tickets', 'ver', tickets.usuario_id))
        and (
            (select public.fn_mi_alcance('tickets', 'ver')) <> 'zonal'
            or usuario_id = (select auth.uid())
            or (select public.fn_ve_ticket(tickets.id))
        )
    );

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert
    with check (
        (select public.fn_verificar_permiso('tickets', 'crear', tickets.usuario_id))
    );

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update
    using (
        (select public.fn_es_admin())
        or (
            not (select public.fn_ticket_notificado(tickets.id))
            and (select public.fn_verificar_permiso(
                    'tickets', 'editar',
                    tickets.usuario_id,
                    null,
                    tickets.estado = 'ABIERTO',
                    public.fn_nivel_proceso(tickets.proceso)))
            and ((select public.fn_mi_alcance('tickets', 'editar')) <> 'zonal'
                 or usuario_id = (select auth.uid())
                 or (select public.fn_ve_ticket(tickets.id)))
        )
    );

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets for delete
    using (
        (select public.fn_es_admin())
        or (
            not (select public.fn_ticket_notificado(tickets.id))
            and (select public.fn_verificar_permiso(
                    'tickets', 'eliminar',
                    tickets.usuario_id,
                    null,
                    tickets.estado = 'ABIERTO',
                    public.fn_nivel_proceso(tickets.proceso)))
            and ((select public.fn_mi_alcance('tickets', 'eliminar')) <> 'zonal'
                 or usuario_id = (select auth.uid())
                 or (select public.fn_ve_ticket(tickets.id)))
        )
    );

-- ------------------------------ Horómetros ---------------------------
-- El dueño de un horómetro es el dueño de SU TICKET: el horómetro no
-- tiene columna de usuario. Por eso el alcance se evalúa contra el
-- ticket, igual que la condición.

drop policy if exists horometros_select on public.horometros;
create policy horometros_select on public.horometros for select
    using (
        (select public.fn_verificar_permiso(
            'horometros', 'ver',
            (select t.usuario_id from public.tickets t where t.id = horometros.ticket_id)))
        and (
            (select public.fn_mi_alcance('horometros', 'ver')) <> 'zonal'
            or (select public.fn_ve_horometro(horometros.id))
        )
    );

drop policy if exists horometros_insert on public.horometros;
create policy horometros_insert on public.horometros for insert
    with check ((select public.fn_puede_escribir_en_ticket(horometros.ticket_id, 'horometros', 'crear')));

drop policy if exists horometros_update on public.horometros;
create policy horometros_update on public.horometros for update
    using ((select public.fn_puede_escribir_en_ticket(horometros.ticket_id, 'horometros', 'editar')));

drop policy if exists horometros_delete on public.horometros;
create policy horometros_delete on public.horometros for delete
    using ((select public.fn_puede_escribir_en_ticket(horometros.ticket_id, 'horometros', 'eliminar')));

-- -------------------------------- Labores ----------------------------

drop policy if exists registros_select on public.registros;
create policy registros_select on public.registros for select
    using (
        (select public.fn_verificar_permiso(
            'labores', 'ver',
            (select t.usuario_id from public.tickets t where t.id = registros.ticket_id)))
        and (
            (select public.fn_mi_alcance('labores', 'ver')) <> 'zonal'
            or (select public.fn_ve_horometro(registros.horometro_id))
        )
    );

drop policy if exists registros_insert on public.registros;
create policy registros_insert on public.registros for insert
    with check ((select public.fn_puede_escribir_en_ticket(registros.ticket_id, 'labores', 'crear')));

drop policy if exists registros_update on public.registros;
create policy registros_update on public.registros for update
    using ((select public.fn_puede_escribir_en_ticket(registros.ticket_id, 'labores', 'editar')));

drop policy if exists registros_delete on public.registros;
create policy registros_delete on public.registros for delete
    using ((select public.fn_puede_escribir_en_ticket(registros.ticket_id, 'labores', 'eliminar')));


-- =====================================================================
-- H · LA MATRIZ SE EDITA DESDE LA PANTALLA
-- =====================================================================
-- La fila ahora lleva configuración, no sólo existencia, así que el
-- `delete + insert` de antes perdería el alcance al apagar una casilla.

drop policy if exists permisos_write on public.permisos;
create policy permisos_write on public.permisos for all
    using ((select public.fn_tiene_permiso('permisos', 'editar')))
    with check ((select public.fn_tiene_permiso('permisos', 'editar')));

drop policy if exists permisos_select on public.permisos;
create policy permisos_select on public.permisos for select
    using ((select auth.uid()) is not null);

/**
 * Guardar una celda de la matriz.
 *
 * Un `upsert` y no un borrado: apagar una acción conserva su alcance y
 * su condición, que es la razón de ser de `permitido`.
 */
create or replace function public.fn_guardar_permiso(
    p_rol_id    smallint,
    p_recurso   text,
    p_accion    text,
    p_permitido boolean,
    p_alcance   text default 'global',
    p_condicion text default 'sin_restriccion'
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not public.fn_tiene_permiso('permisos', 'editar') then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Permisos.'
            using errcode = '42501';
    end if;

    -- Que la acción exista en esa pantalla. Guardar un par que la
    -- pantalla no ofrece es crear un permiso que nadie podrá volver a
    -- ver ni quitar.
    if not exists (
        select 1 from public.pantallas
        where codigo = p_recurso and acciones @> array[p_accion]
    ) then
        raise exception 'La pantalla «%» no ofrece la acción «%».', p_recurso, p_accion;
    end if;

    insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
    values (p_rol_id, p_recurso, p_accion, p_permitido,
            p_alcance::public.alcance_permiso, p_condicion::public.condicion_permiso)
    on conflict (rol_id, recurso, accion) do update
    set permitido = excluded.permitido,
        alcance   = excluded.alcance,
        condicion = excluded.condicion;
end;
$$;

grant execute on function public.fn_guardar_permiso(smallint, text, text, boolean, text, text) to authenticated;

/** La matriz entera, como la dibuja /admin/permisos. */
create or replace function public.fn_matriz_permisos()
returns table (
    rol_id    smallint,
    rol       text,
    recurso   text,
    accion    text,
    permitido boolean,
    alcance   text,
    condicion text
)
language sql stable security definer set search_path = public, pg_temp as $$
    select r.id, r.nombre, pa.codigo, a.accion,
           coalesce(pm.permitido, false),
           coalesce(pm.alcance, 'global'::public.alcance_permiso)::text,
           coalesce(pm.condicion, 'sin_restriccion'::public.condicion_permiso)::text
    from public.roles r
    cross join public.pantallas pa
    cross join lateral unnest(pa.acciones) as a(accion)
    left join public.permisos pm
           on pm.rol_id = r.id and pm.recurso = pa.codigo and pm.accion = a.accion
    where public.fn_tiene_permiso('permisos', 'ver')
    order by r.nombre, pa.orden, a.accion
$$;

grant execute on function public.fn_matriz_permisos() to authenticated;


-- =====================================================================
-- I · LO QUE TODAVÍA PREGUNTABA POR LA ACCIÓN VIEJA
-- =====================================================================
-- Dos funciones de la 50 seguían consultando `editar_en_revision`. Con
-- la casilla ya borrada preguntarían por algo que no existe —es decir,
-- dirían que no siempre— y el cambio en masa dejaría de funcionar para
-- quien sí tiene el permiso. El guardián las encuentra; aquí se traducen.

/**
 * ¿Se le levanta a esta persona el candado del proceso?
 *
 * Ya no es una casilla: es la CONDICIÓN de su permiso de editar tickets.
 */
create or replace function public.fn_puede_editar_en_revision()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(
        (select condicion = 'sin_restriccion' from public.fn_permiso_de('tickets', 'editar')),
        false
    )
$$;

/**
 * El cambio en masa.
 *
 * Mover el PROCESO de varios tickets es el trabajo de quien revisa, así
 * que la condición no puede aplicarse al proceso —sería un candado que
 * se cierra sobre su propia llave—. Se aplica al ESTADO, igual que en la
 * 50, pero leyendo la condición en vez de una casilla aparte.
 */
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

    if not public.fn_tiene_permiso('tickets', 'editar') then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    if p_proceso = 'PENDIENTE_APROBACION'
       and not public.fn_tiene_permiso('tickets', 'aprobar') then
        raise exception 'Tu rol no tiene «Aprobar» en la pantalla de Tickets.' using errcode = '42501';
    end if;

    if p_proceso = 'NOTIFICADO'
       and not public.fn_tiene_permiso('tickets', 'notificar') then
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
      -- El ESTADO de algo que ya salió del paso 0 pide la condición
      -- levantada; mover sólo el PROCESO, no: eso es revisar.
      and (p_estado is null
           or public.fn_es_admin()
           or public.fn_nivel_proceso(t.proceso) = 0
           or public.fn_puede_editar_en_revision())
      and (public.fn_es_admin()
           or public.fn_ve_todo('tickets')
           or t.usuario_id = auth.uid());

    get diagnostics v_afectados = row_count;
    return v_afectados;
end;
$$;

grant execute on function public.actualizar_tickets_masivo(uuid[], public.estado_ticket, public.proceso_ticket) to authenticated;


-- =====================================================================
-- J · EL GUARDIÁN
-- =====================================================================
-- `v_permisos_exigidos` leía las llamadas a `fn_tiene_permiso`,
-- `fn_ve_todo` y `fn_puede_escribir_en_ticket`. Ahora también hay que
-- mirar `fn_verificar_permiso` y `fn_mi_alcance`, o las llaves nuevas
-- quedarían fuera del recuento y el guardián daría un cero falso.

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
verificados as (
    select (regexp_matches(txt, 'fn_verificar_permiso\(''([a-z_]+)'', *''([a-z_]+)''', 'g')) as m
    from fuentes
),
alcances as (
    select (regexp_matches(txt, 'fn_mi_alcance\(''([a-z_]+)'', *''([a-z_]+)''', 'g')) as m
    from fuentes
),
solo_ver as (
    select array[(regexp_matches(txt, 'fn_ve_todo\(''([a-z_]+)''', 'g'))[1], 'ver'] as m
    from fuentes
),
todos as (
    select m[1] as pantalla, m[2] as accion from directos
    union select m[1], m[2] from en_ticket
    union select m[1], m[2] from verificados
    union select m[1], m[2] from alcances
    union select m[1], m[2] from solo_ver
)
select distinct pantalla, accion from todos
where pantalla is not null and accion is not null;

alter view public.v_permisos_exigidos set (security_invoker = on);
grant select on public.v_permisos_exigidos to authenticated;

do $$
declare v_faltan integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    if v_faltan > 0 then
        raise exception 'Quedaron % llaves sin casilla en la matriz.', v_faltan;
    end if;
    raise notice 'ok  la matriz ofrece todas las llaves que la base exige';
end $$;
