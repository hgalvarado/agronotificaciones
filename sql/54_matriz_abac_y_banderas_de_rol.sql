-- =====================================================================
-- 54 · LA MATRIZ ABAC, Y LOS DOS NOMBRES DE ROL QUE QUEDABAN ESCRITOS
-- =====================================================================
--
-- La 53 metió el alcance y la condición en la tabla `permisos`. Esta
-- deja la pantalla que los configura en condiciones de hacerlo:
--
--   A · `roles.acceso_total` y `roles.solo_lectura`. Hasta aquí,
--       `fn_es_admin()` decía literalmente `= 'ADMIN'` y
--       `fn_es_invitado()` decía `= 'INVITADO'`, y la matriz del
--       navegador escondía la fila con `r.codigo !== 'ADMIN'`. Eran tres
--       sitios distintos repitiendo un nombre escrito a mano: si alguien
--       renombraba el rol, dos de los tres se enteraban. Ahora es una
--       propiedad del rol, igual que `de_sistema`, y nadie vuelve a
--       nombrarlo.
--
--   B · `fn_guardar_permiso` con la cascada dentro. Apagar «Ver» deja al
--       rol con permisos que no puede alcanzar —la pantalla desaparece
--       del menú— y conceder cualquier acción implica poder entrar. Esa
--       regla vivía en el navegador, repartida en dos ramas de un `if`,
--       y por tanto no valía para nadie que escribiera en la tabla por
--       otro camino. Baja a donde se aplica.
--
-- Idempotente: se puede ejecutar dos veces.
-- =====================================================================

-- =====================================================================
-- A · LAS DOS BANDERAS DE ROL
-- =====================================================================

alter table public.roles
    add column if not exists acceso_total boolean not null default false,
    add column if not exists solo_lectura boolean not null default false;

comment on column public.roles.acceso_total is
    'Llave maestra: pasa por encima de la matriz. Sustituye el nombre «ADMIN» que estaba escrito dentro de fn_es_admin().';
comment on column public.roles.solo_lectura is
    'Mira y exporta, nunca escribe, marquen lo que marquen en la matriz. Sustituye el nombre «INVITADO».';

-- La traducción del nombre viejo a la bandera. Se hace UNA vez: si
-- mañana el Administrador mueve las banderas, volver a ejecutar esta
-- migración no debe deshacérselo.
do $$
begin
    if not exists (select 1 from public.roles where acceso_total) then
        update public.roles set acceso_total = true where codigo = 'ADMIN';
    end if;

    if not exists (select 1 from public.roles where solo_lectura) then
        update public.roles set solo_lectura = true where codigo = 'INVITADO';
    end if;
end $$;

/** La llave maestra, leída del rol y no de su nombre. */
create or replace function public.fn_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1
        from public.perfiles p
        join public.roles r on r.id = p.rol_id
        where p.id = (select auth.uid())
          and r.acceso_total
    )
$$;

/** El rol de sólo lectura, leído del rol y no de su nombre. */
create or replace function public.fn_es_invitado() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1
        from public.perfiles p
        join public.roles r on r.id = p.rol_id
        where p.id = (select auth.uid())
          and r.solo_lectura
    )
$$;

grant execute on function public.fn_es_admin()    to authenticated;
grant execute on function public.fn_es_invitado() to authenticated;

/**
 * Que nunca quede la instalación sin llave maestra.
 *
 * Antes lo garantizaba el nombre: ADMIN era de sistema y no se borraba.
 * Ahora que es una bandera, hay que vigilarla igual, o un `update` de
 * una línea deja a todo el mundo fuera de /admin sin forma de volver a
 * entrar.
 *
 * Es a nivel de SENTENCIA, y no de fila, por dos razones: un `update`
 * que mueve la bandera de un rol a otro de una sola pasada no puede
 * saltar a mitad del recorrido, y el aviso tiene que llegar en la
 * sentencia que lo provoca —no diferido al `commit`—, que es donde quien
 * lo escribió todavía puede entenderlo.
 */
create or replace function public.fn_guardia_acceso_total() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not exists (select 1 from public.roles where acceso_total) then
        raise exception
            'Tiene que quedar al menos un rol con acceso total; si no, nadie puede volver a entrar a Permisos.'
            using errcode = '23514';
    end if;
    return null;
end;
$$;

drop trigger if exists trg_guardia_acceso_total on public.roles;
create trigger trg_guardia_acceso_total
    after update or delete on public.roles
    for each statement execute function public.fn_guardia_acceso_total();

-- =====================================================================
-- B · GUARDAR UNA CELDA, CON SU CASCADA
-- =====================================================================

/**
 * Guardar una celda de la matriz (Rol × Pantalla × Acción).
 *
 * `upsert` y no borrado: apagar una acción conserva su alcance y su
 * condición, que es la razón de ser de la columna `permitido`. Quien
 * apaga «Editar» un martes y lo vuelve a encender el jueves recupera el
 * «zonal, sólo abiertos» que había configurado, en vez de empezar otra
 * vez en «global».
 *
 * Las dos reglas de arrastre van aquí dentro y no en el navegador:
 *
 *   · Apagar «Ver» apaga lo demás de esa pantalla. Un rol que no ve la
 *     pantalla tampoco llega a sus botones; dejarle «Eliminar» encendido
 *     es una casilla que miente.
 *   · Encender cualquier otra acción enciende «Ver». Conceder «Crear»
 *     sin «Ver» es conceder nada.
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
declare
    v_alcance   public.alcance_permiso   := p_alcance::public.alcance_permiso;
    v_condicion public.condicion_permiso := p_condicion::public.condicion_permiso;
begin
    if not public.fn_tiene_permiso('permisos', 'editar') then
        raise exception 'Tu rol no tiene «Editar» en la pantalla de Permisos.'
            using errcode = '42501';
    end if;

    -- Los roles de bandera no se configuran por casillas: su regla está
    -- por encima de la matriz y marcarles algo aquí haría creer que se
    -- les puede quitar o dar.
    if exists (
        select 1 from public.roles
        where id = p_rol_id and (acceso_total or solo_lectura)
    ) then
        raise exception
            'Ese rol se rige por su bandera (acceso total o sólo lectura), no por la matriz.'
            using errcode = '42501';
    end if;

    -- Que la acción exista en esa pantalla. Guardar un par que la
    -- pantalla no ofrece es crear un permiso que nadie podrá volver a
    -- ver ni quitar desde aquí.
    if not exists (
        select 1 from public.pantallas
        where codigo = p_recurso and acciones @> array[p_accion]
    ) then
        raise exception 'La pantalla «%» no ofrece la acción «%».', p_recurso, p_accion;
    end if;

    insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
    values (p_rol_id, p_recurso, p_accion, p_permitido, v_alcance, v_condicion)
    on conflict (rol_id, recurso, accion) do update
    set permitido = excluded.permitido,
        alcance   = excluded.alcance,
        condicion = excluded.condicion;

    -- ------------------------------ Cascada ------------------------------
    if p_accion = 'ver' and not p_permitido then
        update public.permisos
        set permitido = false
        where rol_id = p_rol_id and recurso = p_recurso and accion <> 'ver';

    elsif p_accion <> 'ver' and p_permitido and exists (
        select 1 from public.pantallas
        where codigo = p_recurso and acciones @> array['ver']
    ) then
        -- «Ver» se crea con el mismo alcance que la acción concedida:
        -- conceder «Editar zonal» y que la pantalla se vea entera sería
        -- lo contrario de lo que el Administrador acaba de pedir. Si ya
        -- estaba encendido no se le toca nada.
        insert into public.permisos (rol_id, recurso, accion, permitido, alcance, condicion)
        values (p_rol_id, p_recurso, 'ver', true, v_alcance, 'sin_restriccion')
        on conflict (rol_id, recurso, accion) do update
        set permitido = true
        where public.permisos.permitido is distinct from true;
    end if;
end;
$$;

grant execute on function
    public.fn_guardar_permiso(smallint, text, text, boolean, text, text) to authenticated;

-- =====================================================================
-- C · EL GUARDIÁN, OTRA VEZ
-- =====================================================================
-- Lo mismo que cierra la 53: si alguna función o policy exige una llave
-- que la matriz no ofrece, se dice aquí y no en mitad de una captura.

do $$
declare
    v_faltan integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    if v_faltan > 0 then
        raise exception 'Quedaron % llaves sin casilla en la matriz.', v_faltan;
    end if;
end $$;
