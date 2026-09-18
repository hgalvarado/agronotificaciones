-- =====================================================================
-- 43 · Fuera los nombres de rol quemados. Manda la matriz de Permisos.
--
-- Ejecutar en el SQL Editor DESPUÉS de la 42.
--
-- El problema, tal cual se ve en pantalla: al guardar un horómetro salía
-- «la base rechazó el cambio por permisos», y lo que decidía no era la
-- pantalla de Permisos sino un `fn_mi_rol() = 'TORRE_CONTROL'` escrito a
-- mano en la policy. Quedaban diez policies y cuatro funciones así:
-- marcar o desmarcar una casilla en Permisos no cambiaba nada de eso.
--
-- Esta migración deja UNA sola forma de preguntar «¿puede?»:
--
--     fn_tiene_permiso(pantalla, accion)
--
-- que es exactamente lo que la pantalla de Permisos escribe. Ningún
-- `qual` de policy y ninguna función vuelve a comparar el NOMBRE de un
-- rol. El único atajo que queda es `fn_es_admin()`, y a propósito: el
-- Administrador es quien configura la matriz, y si él también dependiera
-- de ella una configuración mala dejaría el sistema cerrado para
-- siempre, sin nadie que pudiera abrirlo.
--
-- Y el segundo cambio: CERRADO deja de ser un candado. Si la matriz dice
-- que el rol edita, edita, esté el ticket abierto o cerrado. El único
-- tope que queda es NOTIFICADO —ya liquidado en SAP— y ése sólo lo
-- levanta el Administrador.
-- =====================================================================

-- =====================================================================
-- A · ESCRIBIR EN UN TICKET: LA MATRIZ, Y NADA MÁS
-- =====================================================================

/**
 * Quién puede escribir en lo que cuelga de un ticket.
 *
 * Cambia respecto a la 42: se cae el `estado = 'ABIERTO'`. Cerrar un
 * ticket es una marca de avance, no un candado; quien tenga la acción en
 * la matriz la tiene también sobre un ticket cerrado. Antes, un rol con
 * «editar» marcado seguía sin poder tocar un ticket cerrado y el mensaje
 * de error hablaba de roles que ya no deciden nada.
 *
 * Quedan dos condiciones y un tope:
 *
 *   1. La matriz concede esa acción en esa pantalla.
 *   2. Alcance: con `ver_todo` de esa pantalla, cualquier ticket; sin
 *      ella, sólo los propios. (También sale de la matriz.)
 *   tope. El ticket no está NOTIFICADO. Ya se liquidó en SAP y corregirlo
 *      aquí deja la base y SAP diciendo cosas distintas; sólo el
 *      Administrador puede, y es su responsabilidad rehacer la carga.
 */
create or replace function public.fn_puede_escribir_en_ticket(
    p_ticket_id uuid,
    p_pantalla  text,
    p_accion    text
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin()
        or (
            public.fn_tiene_permiso(p_pantalla, p_accion)
            and not public.fn_ticket_notificado(p_ticket_id)
            and (
                public.fn_ve_todo(p_pantalla)
                or exists (
                    select 1 from public.tickets t
                    where t.id = p_ticket_id and t.usuario_id = auth.uid()
                )
            )
        )
$$;

comment on function public.fn_puede_escribir_en_ticket(uuid, text, text) is
'La matriz de Permisos + alcance + el tope de NOTIFICADO. Ni un nombre de rol.';

-- La de siempre, con la misma regla. La usan otras funciones.
create or replace function public.fn_puede_capturar_en_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin()
        or (
            not public.fn_ticket_notificado(p_ticket_id)
            and (
                public.fn_puede_escribir_en_ticket(p_ticket_id, 'labores', 'editar')
                or public.fn_puede_escribir_en_ticket(p_ticket_id, 'horometros', 'editar')
            )
        )
$$;

-- El ticket en sí: editar y eliminar salen de la matriz, sin mirar el
-- estado.
drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update
    using (
        (select public.fn_es_admin())
        or ((select public.fn_tiene_permiso('tickets','editar'))
            and not (select public.fn_ticket_notificado(tickets.id))
            and ((select public.fn_ve_todo('tickets')) or usuario_id = (select auth.uid())))
    );

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets for delete
    using (
        (select public.fn_es_admin())
        or ((select public.fn_tiene_permiso('tickets','eliminar'))
            and not (select public.fn_ticket_notificado(tickets.id))
            and ((select public.fn_ve_todo('tickets')) or usuario_id = (select auth.uid())))
    );

-- =====================================================================
-- B · LOS RPC QUE PREGUNTABAN POR EL ROL
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mover el ticket por el flujo (Registrado → Revisando → … → Notificado)
-- ---------------------------------------------------------------------
-- Antes: «si tu rol no es ADMIN ni TORRE_CONTROL, sólo puedes mandar TU
-- ticket a REVISANDO». Ahora lo mismo, pero preguntado a la matriz:
--
--   `tickets:editar`   → puede mover el ticket.
--   `tickets:ver_todo` → puede mover los de los demás y por todo el
--                        flujo; sin ella, sólo el suyo y sólo el paso de
--                        «ya terminé en campo».
create or replace function public.cambiar_proceso_ticket(
    p_ticket_id uuid,
    p_proceso   public.proceso_ticket
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_ticket   public.tickets%rowtype;
    v_todo     boolean;
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

    update public.tickets set proceso = p_proceso where id = p_ticket_id;
end;
$$;

grant execute on function public.cambiar_proceso_ticket(uuid, public.proceso_ticket) to authenticated;

-- ---------------------------------------------------------------------
-- Reabrir
-- ---------------------------------------------------------------------
create or replace function public.reabrir_ticket(p_ticket_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not public.fn_puede_escribir_en_ticket(p_ticket_id, 'tickets', 'editar') then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    update public.tickets
    set estado = 'ABIERTO', cerrado_at = null, cerrado_by = null
    where id = p_ticket_id;
end;
$$;

grant execute on function public.reabrir_ticket(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Cambio en bloque
-- ---------------------------------------------------------------------
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

    -- Antes esto comparaba el nombre del rol contra una lista escrita a
    -- mano. El cambio en bloque es la acción «editar» de la pantalla de
    -- Tickets, igual que el cambio de uno en uno: lo que lo hace masivo
    -- es la lista de ids, no un privilegio aparte.
    if not (public.fn_es_admin() or public.fn_tiene_permiso('tickets', 'editar')) then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Tickets. Se configura en Permisos.'
            using errcode = '42501';
    end if;

    -- Y un ticket ya notificado no entra en el bloque, aunque venga en la
    -- lista: se salta en silencio en vez de tumbar el lote entero.
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

-- ---------------------------------------------------------------------
-- Carga histórica
-- ---------------------------------------------------------------------
-- La función es larga y lo único que hay que cambiarle son las dos
-- líneas del portero, así que se reescribe sobre su propia definición en
-- vez de repetir aquí trescientas líneas que no cambian. Si la cadena ya
-- no está —porque esto se corrió antes— el `replace` no encuentra nada y
-- se vuelve a crear idéntica.
do $$
declare v_def text;
begin
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_importar_historico'
    limit 1;

    if v_def is null then
        raise notice 'fn_importar_historico no existe todavía; nada que ajustar.';
        return;
    end if;

    v_def := replace(
        v_def,
        'public.fn_es_admin() or public.fn_mi_rol() = ''TORRE_CONTROL''',
        'public.fn_es_admin() or public.fn_tiene_permiso(''historico'', ''crear'')'
    );
    v_def := replace(
        v_def,
        'Sólo el Administrador o Torre de Control pueden cargar el histórico, porque los tickets quedan a nombre de otras personas.',
        'Tu rol no tiene «Crear» en la pantalla de Carga histórica. Se configura en Permisos.'
    );
    execute v_def;
end $$;

-- =====================================================================
-- C · LAS POLICIES DE CATÁLOGOS Y DE PERFILES
-- =====================================================================
-- Todas decían `fn_es_admin() or fn_mi_rol() = 'TORRE_CONTROL'`. Pasan a
-- la pantalla que les corresponde en la matriz.

drop policy if exists departamentos_insert on public.departamentos;
create policy departamentos_insert on public.departamentos for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));

drop policy if exists departamentos_update on public.departamentos;
create policy departamentos_update on public.departamentos for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

drop policy if exists puestos_insert on public.puestos_trabajo;
create policy puestos_insert on public.puestos_trabajo for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));

drop policy if exists puestos_update on public.puestos_trabajo;
create policy puestos_update on public.puestos_trabajo for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

-- `zonas` conserva su recorte por zona asignada al LEER (migración 41);
-- lo que cambia es quién puede crearlas y corregirlas.
drop policy if exists zonas_write on public.zonas;
create policy zonas_write on public.zonas for insert
    with check ((select public.fn_tiene_permiso('catalogos','crear')));

drop policy if exists zonas_update on public.zonas;
create policy zonas_update on public.zonas for update
    using ((select public.fn_tiene_permiso('catalogos','editar')));

-- El directorio de personas es de la pantalla de Usuarios. Cada quien se
-- ve siempre a sí mismo: sin eso, nadie podría leer su propio perfil y la
-- aplicación no arrancaría.
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select
    using (
        id = (select auth.uid())
        or (select public.fn_tiene_permiso('usuarios','ver'))
        -- Quien revisa tickets de otros necesita el nombre de quien los
        -- capturó; si no, la cuadrícula enseñaría un hueco.
        or (select public.fn_ve_todo('tickets'))
    );

drop policy if exists log_auditoria_select on public.log_auditoria;
create policy log_auditoria_select on public.log_auditoria for select
    using (
        (select public.fn_tiene_permiso('usuarios','ver'))
        or (select public.fn_ve_todo('horometros'))
    );

-- Las dos tablas de tarifas de la migración 01 quedaron sin uso, pero
-- mientras existan su policy tampoco va a nombrar un rol.
do $$
begin
    if to_regclass('public.tarifas_equipo') is not null then
        execute 'drop policy if exists tarifas_equipo_select on public.tarifas_equipo';
        execute 'create policy tarifas_equipo_select on public.tarifas_equipo for select
                 using ((select public.fn_tiene_permiso(''tarifas'',''ver'')))';
    end if;
    if to_regclass('public.tarifas_labor') is not null then
        execute 'drop policy if exists tarifas_labor_select on public.tarifas_labor';
        execute 'create policy tarifas_labor_select on public.tarifas_labor for select
                 using ((select public.fn_tiene_permiso(''tarifas'',''ver'')))';
    end if;
end $$;

-- =====================================================================
-- D · QUE LO CONFIGURABLE SEA CONFIGURABLE DE VERDAD
-- =====================================================================
-- `historico` no tenía la acción «crear» en la matriz aunque su portero
-- la exigiera: la casilla no existía y por tanto no se podía conceder.
update public.pantallas
set acciones = array(select distinct e from unnest(acciones || array['crear']) e)
where codigo = 'historico';

-- Y la semilla de lo que Torre de Control hacía antes por su nombre, para
-- que después de esta migración siga haciendo exactamente lo mismo —pero
-- ahora porque la matriz lo dice, y desmarcarlo se lo quita—.
insert into public.permisos (rol_id, recurso, accion)
select r.id, x.recurso, x.accion
from public.roles r
cross join (values
    ('tickets',    'editar'),
    ('tickets',    'eliminar'),
    ('tickets',    'crear'),
    ('horometros', 'editar'),
    ('horometros', 'eliminar'),
    ('labores',    'editar'),
    ('labores',    'eliminar'),
    ('catalogos',  'crear'),
    ('catalogos',  'editar'),
    ('historico',  'crear'),
    ('usuarios',   'ver')
) as x(recurso, accion)
where r.codigo = 'TORRE_CONTROL'
on conflict do nothing;

-- =====================================================================
-- E · LA MATRIZ SE CONFIGURA CON «PERMISOS: EDITAR»
-- =====================================================================
-- La pantalla de Permisos y la de Navegación se ofrecían a quien tuviera
-- `permisos:editar`, pero la base sólo las dejaba escribir al
-- Administrador: la casilla se marcaba, la pantalla se abría y al guardar
-- reventaba. Es el mismo desfase que esta migración viene a cerrar, así
-- que la base pasa a aceptar exactamente lo que la pantalla ofrece.
--
-- El Administrador sigue pasando siempre, y eso NO se toca: es quien
-- puede recomponer la matriz si alguien la deja mal.

drop policy if exists permisos_write_admin on public.permisos;
create policy permisos_write_admin on public.permisos for all
    using ((select public.fn_tiene_permiso('permisos','editar')))
    with check ((select public.fn_tiene_permiso('permisos','editar')));

drop policy if exists roles_write_admin on public.roles;
create policy roles_write_admin on public.roles for all
    using ((select public.fn_tiene_permiso('permisos','editar')))
    with check ((select public.fn_tiene_permiso('permisos','editar')));

drop policy if exists navegacion_rol_insert on public.navegacion_rol;
create policy navegacion_rol_insert on public.navegacion_rol for insert
    with check ((select public.fn_tiene_permiso('permisos','editar')));

drop policy if exists navegacion_rol_update on public.navegacion_rol;
create policy navegacion_rol_update on public.navegacion_rol for update
    using ((select public.fn_tiene_permiso('permisos','editar')));

drop policy if exists navegacion_rol_delete on public.navegacion_rol;
create policy navegacion_rol_delete on public.navegacion_rol for delete
    using ((select public.fn_tiene_permiso('permisos','editar')));


-- Y las funciones que preguntaban «¿eres el Administrador?» para algo que
-- la matriz ya sabe contestar. Se les cambia SÓLO el portero, sobre su
-- propia definición: reescribirlas enteras aquí sería copiar código que
-- no cambia y arriesgarse a perderle un detalle por el camino. Si la
-- cadena ya no está —porque esto se corrió antes— no encuentra nada y la
-- función se vuelve a crear idéntica.
do $$
declare
    v_nombre text;
    v_def    text;
begin
    foreach v_nombre in array array['fn_crear_rol', 'fn_eliminar_rol', 'fn_guardar_navegacion']
    loop
        select pg_get_functiondef(p.oid) into v_def
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = v_nombre
        limit 1;

        if v_def is null then
            raise notice '% no existe todavía; nada que ajustar.', v_nombre;
            continue;
        end if;

        v_def := replace(v_def,
            'not public.fn_es_admin() or public.fn_es_invitado()',
            'not public.fn_tiene_permiso(''permisos'', ''editar'')');
        v_def := replace(v_def,
            'Sólo el Administrador puede crear roles.',
            'Tu rol no tiene «Editar» en la pantalla de Permisos.');
        v_def := replace(v_def,
            'Sólo el Administrador puede eliminar roles.',
            'Tu rol no tiene «Editar» en la pantalla de Permisos.');
        v_def := replace(v_def,
            'Sólo el Administrador puede configurar la navegación.',
            'Tu rol no tiene «Editar» en la pantalla de Permisos.');
        execute v_def;
    end loop;
end $$;

-- =====================================================================
-- Comprobación: que no quede ni un nombre de rol decidiendo nada
-- =====================================================================
do $$
declare
    v_policies integer;
    v_funcs    integer;
begin
    select count(*) into v_policies from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') || coalesce(with_check,'')) like '%fn_mi_rol%';

    select count(*) into v_funcs from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname not in ('fn_mi_rol', 'fn_es_admin', 'fn_es_invitado')
      and (prosrc like '%fn_mi_rol%' or prosrc like '%TORRE_CONTROL%');

    raise notice 'Migración 43 aplicada. Policies que comparan el rol: %. Funciones: %.',
        v_policies, v_funcs;

    if v_policies > 0 or v_funcs > 0 then
        raise warning 'Todavía queda algo comparando el nombre del rol. Revísalo.';
    else
        raise notice 'Manda la matriz de Permisos en todas partes.';
    end if;

    raise notice 'CERRADO ya no bloquea: si el rol tiene «Editar», edita. El único tope es NOTIFICADO.';
end $$;
