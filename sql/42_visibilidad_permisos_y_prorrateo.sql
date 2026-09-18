-- =====================================================================
-- 42 · Qué ve cada quien, qué puede tocar, y el reparto de horas
--
-- Ejecutar en el SQL Editor DESPUÉS de la 41.
--
-- Cuatro arreglos, todos de cosas que estaban mal de verdad:
--
--   A. «Ver la pantalla» dejó de significar «ver lo de todo el mundo».
--      La 41 puso `fn_tiene_permiso('tickets','ver')` en la policy de
--      SELECT, y como el Digitador necesita ese permiso para abrir la
--      pantalla, empezó a ver los tickets de toda la empresa. Ver más
--      allá de lo propio es ahora un permiso aparte —`ver_todo`— que se
--      marca en la matriz de Permisos.
--
--   B. El filtro por zonas no filtraba `registro_detalle`. La policy
--      preguntaba la zona con un subselect a `lotes_temporada`, que es
--      una tabla CON RLS: para un lote de otra zona el subselect no
--      devolvía nada, `fn_ve_zona(null)` daba «sí» y la línea se veía.
--      Ahora la zona la lee una función `security definer`.
--
--   C. Los permisos no se aplicaban al escribir. `fn_puede_capturar_en_ticket`
--      preguntaba por el ROL —«¿eres Torre de Control?»— y nunca por la
--      matriz, así que quitarle «eliminar» a un rol no le quitaba nada.
--      Y un ticket ya NOTIFICADO se seguía editando.
--
--   D. El prorrateo repartía primero entre labores y después entre lotes.
--      Eso hacía que el mismo lote saliera con cifras distintas según
--      cuántas labores lo acompañaran. Ahora el reparto es GLOBAL por
--      horómetro, con dos reglas y ninguna línea en cero, y respeta las
--      horas que alguien corrigió a mano.
-- =====================================================================

-- =====================================================================
-- A · VER LO PROPIO vs. VER TODO
-- =====================================================================

-- `ver_todo` aparece en la matriz de Permisos como una casilla más, así
-- que se configura desde la pantalla y no hace falta volver aquí.
update public.pantallas
set acciones = array(select distinct e from unnest(acciones || array['ver_todo']) e)
where codigo in ('tickets', 'horometros', 'labores', 'turnos_riego', 'trasplante');

-- El Invitado ve toda la empresa, pero sólo de lectura. `ver_todo` es una
-- acción de lectura: sin esto el Invitado se quedaría viendo únicamente
-- lo que él mismo hubiera capturado, que es nada.
create or replace function public.fn_accion_de_lectura(p_accion text)
returns boolean language sql immutable as $$
    select p_accion in ('ver', 'descargar', 'read', 'ver_todo')
$$;

comment on function public.fn_accion_de_lectura(text) is
'Acciones que no escriben nada. Es lo único que se le concede al Invitado.';

/**
 * ¿Esta persona ve lo que capturaron los demás en esta pantalla?
 *
 * El Administrador siempre. Los demás, sólo con la casilla `ver_todo`
 * marcada en Permisos. Quien no la tenga ve únicamente los tickets que
 * abrió él, que es lo que hacía el Digitador antes de la 41.
 */
create or replace function public.fn_ve_todo(p_pantalla text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_tiene_permiso(p_pantalla, 'ver_todo')
$$;

comment on function public.fn_ve_todo(text) is
'Si ve lo capturado por otros en esa pantalla. Sin el permiso ve sólo lo suyo.';

grant execute on function public.fn_ve_todo(text) to authenticated;

-- Semilla: los roles de supervisión. El Digitador y el Digitador
-- Parametrista NO la llevan a propósito: capturan y ven lo suyo.
insert into public.permisos (rol_id, recurso, accion)
select r.id, x.recurso, 'ver_todo'
from public.roles r
cross join (values ('tickets'), ('horometros'), ('labores')) as x(recurso)
where r.codigo in ('TORRE_CONTROL', 'JEFE_ZONA', 'DIGITADOR_ANALISIS')
on conflict do nothing;

-- =====================================================================
-- B · LA ZONA DEL LOTE, SIN QUE RLS SE INTERPONGA
-- =====================================================================

/**
 * ¿Ve el lote de esta línea?
 *
 * `security definer` a propósito: lee `lotes_temporada` SIN su RLS. Con
 * RLS de por medio, un lote de otra zona no devolvía fila, la zona salía
 * nula y `fn_ve_zona(null)` —que es «sí», porque una zona nula la ve
 * todo el mundo— acababa enseñando la línea. Era el bug por el que las
 * zonas no filtraban nada en /labores ni en el ticket.
 *
 * Una línea sin lote se ve: es un dato sin zona, no de otra zona.
 */
create or replace function public.fn_ve_lote(p_lote_temporada_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when not public.fn_tiene_zonas() then true
        when p_lote_temporada_id is null then true
        else public.fn_ve_zona((
            select lt.zona_id from public.lotes_temporada lt
            where lt.id = p_lote_temporada_id
        ))
    end
$$;

comment on function public.fn_ve_lote(uuid) is
'Si la zona del lote está entre las asignadas. Lee sin RLS, si no la zona saldría nula.';

grant execute on function public.fn_ve_lote(uuid) to authenticated;

/**
 * ¿Ve este ticket, por las zonas de lo que se trabajó en él?
 *
 * Un ticket NO tiene zona: la tienen los lotes de sus labores. Y un
 * ticket recién abierto todavía no tiene ninguna. De ahí las tres ramas:
 * sin zonas asignadas se ve todo, un ticket sin líneas se ve siempre
 * —esconder el que la persona acaba de abrir sería absurdo— y con líneas
 * basta que UNA caiga en una zona asignada.
 */
create or replace function public.fn_ve_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when not public.fn_tiene_zonas() then true
        when not exists (
            select 1 from public.registros r
            join public.registro_detalle rd on rd.registro_id = r.id
            where r.ticket_id = p_ticket_id
        ) then true
        else exists (
            select 1 from public.registros r
            join public.registro_detalle rd on rd.registro_id = r.id
            join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
            where r.ticket_id = p_ticket_id
              and public.fn_ve_zona(lt.zona_id)
        )
    end
$$;

comment on function public.fn_ve_ticket(uuid) is
'Si alguna línea del ticket cae en una zona asignada. Un ticket sin líneas se ve siempre.';

grant execute on function public.fn_ve_ticket(uuid) to authenticated;

/** Lo mismo para el horómetro, que tampoco tiene zona propia. */
create or replace function public.fn_ve_horometro(p_horometro_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when not public.fn_tiene_zonas() then true
        when not exists (
            select 1 from public.registros r
            join public.registro_detalle rd on rd.registro_id = r.id
            where r.horometro_id = p_horometro_id
        ) then true
        else exists (
            select 1 from public.registros r
            join public.registro_detalle rd on rd.registro_id = r.id
            join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
            where r.horometro_id = p_horometro_id
              and public.fn_ve_zona(lt.zona_id)
        )
    end
$$;

grant execute on function public.fn_ve_horometro(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Las policies de lectura, con las dos cosas a la vez: qué alcance tiene
-- (lo propio o todo) y qué zonas.
-- ---------------------------------------------------------------------

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select
    using (
        usuario_id = (select auth.uid())
        or ((select public.fn_ve_todo('tickets')) and (select public.fn_ve_ticket(tickets.id)))
    );

drop policy if exists horometros_select on public.horometros;
create policy horometros_select on public.horometros for select
    using (
        exists (
            select 1 from public.tickets t
            where t.id = horometros.ticket_id and t.usuario_id = (select auth.uid())
        )
        or ((select public.fn_ve_todo('horometros'))
            and (select public.fn_ve_horometro(horometros.id)))
    );

drop policy if exists registros_select on public.registros;
create policy registros_select on public.registros for select
    using (
        exists (
            select 1 from public.tickets t
            where t.id = registros.ticket_id and t.usuario_id = (select auth.uid())
        )
        or ((select public.fn_ve_todo('labores')) and (select public.fn_ve_horometro(registros.horometro_id)))
    );

-- La línea sí tiene lote, así que aquí la zona se aplica SIEMPRE, también
-- a lo que uno mismo capturó: un Jefe de Zona con la Zona 1 asignada no
-- tiene por qué ver el renglón de la Zona 3 ni en su propio ticket.
drop policy if exists registro_detalle_select on public.registro_detalle;
create policy registro_detalle_select on public.registro_detalle for select
    using (
        (select public.fn_ve_lote(registro_detalle.lote_temporada_id))
        and (
            (select public.fn_ve_todo('labores'))
            or exists (
                select 1 from public.registros r
                join public.tickets t on t.id = r.ticket_id
                where r.id = registro_detalle.registro_id and t.usuario_id = (select auth.uid())
            )
        )
    );

-- Las de la 41 que preguntaban la zona con un subselect a una tabla con
-- RLS tenían el mismo agujero. Se pasan a `fn_ve_lote`.
drop policy if exists siembras_select on public.siembras;
create policy siembras_select on public.siembras for select
    using (
        (select public.fn_tiene_permiso('trasplante','ver'))
        and (select public.fn_ve_lote(siembras.lote_temporada_id))
    );

drop policy if exists plan_siembra_select on public.planes_siembra;
create policy plan_siembra_select on public.planes_siembra for select
    using (
        (select public.fn_tiene_permiso('trasplante','ver'))
        and (select public.fn_ve_lote(planes_siembra.lote_temporada_id))
    );

-- =====================================================================
-- C · PERMISOS AL ESCRIBIR, Y EL CANDADO DE «NOTIFICADO»
-- =====================================================================

/** ¿El ticket ya se liquidó en SAP? A partir de ahí no se toca. */
create or replace function public.fn_ticket_notificado(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1 from public.tickets t
        where t.id = p_ticket_id and t.proceso = 'NOTIFICADO'
    )
$$;

grant execute on function public.fn_ticket_notificado(uuid) to authenticated;

/**
 * Quién puede escribir en lo que cuelga de un ticket.
 *
 * Tres condiciones, y las tres tienen que cumplirse:
 *
 *   1. La MATRIZ de permisos concede esa acción en esa pantalla. Es lo
 *      que faltaba: antes se preguntaba por el rol, así que desmarcar
 *      «eliminar» en Permisos no impedía eliminar.
 *   2. El ticket NO está NOTIFICADO. Ya se liquidó en SAP; corregirlo
 *      aquí deja la base y SAP diciendo cosas distintas. Sólo el
 *      Administrador puede, y es su responsabilidad rehacer la carga.
 *   3. Alcance: con `ver_todo` de esa pantalla, cualquier ticket; sin
 *      ella, sólo los propios y abiertos.
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
                    where t.id = p_ticket_id
                      and t.usuario_id = auth.uid()
                      and t.estado = 'ABIERTO'
                )
            )
        )
$$;

comment on function public.fn_puede_escribir_en_ticket(uuid, text, text) is
'Permiso de la matriz + ticket no NOTIFICADO + alcance. La regla única al escribir.';

grant execute on function public.fn_puede_escribir_en_ticket(uuid, text, text) to authenticated;

-- La de siempre queda, porque la usan otras funciones, pero ahora
-- también se detiene en NOTIFICADO: si no, cualquier RPC que la
-- consultara seguiría dejando corregir lo ya liquidado.
create or replace function public.fn_puede_capturar_en_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select public.fn_es_admin()
        or (
            not public.fn_ticket_notificado(p_ticket_id)
            and (
                public.fn_ve_todo('labores')
                or public.fn_ve_todo('horometros')
                or exists (
                    select 1 from public.tickets t
                    where t.id = p_ticket_id
                      and t.usuario_id = auth.uid()
                      and t.estado = 'ABIERTO'
                )
            )
        )
$$;

-- ---------------------------------------------------------------------
-- Las policies de escritura, una por acción de la matriz.
-- ---------------------------------------------------------------------

-- El alta de tickets preguntaba por el recurso de la PRIMERA generación
-- —`('ticket','create')`— y no por la pantalla, así que la casilla
-- «Crear» de la matriz no decidía nada: Torre de Control no podía abrir
-- un ticket aunque se le marcara, y el Digitador podía aunque se le
-- desmarcara. Ahora manda la matriz; el recurso viejo se deja como
-- alternativa para no quitarle el alta a nadie que hoy la tenga.
insert into public.permisos (rol_id, recurso, accion)
select r.id, 'tickets', 'crear' from public.roles r
where r.codigo in ('TORRE_CONTROL')
on conflict do nothing;

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert
    with check (
        ((select public.fn_tiene_permiso('tickets','crear'))
         or (select public.fn_tiene_permiso('ticket','create')))
        and (usuario_id = (select auth.uid()) or (select public.fn_ve_todo('tickets')))
    );

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update
    using (
        (select public.fn_es_admin())
        or ((select public.fn_tiene_permiso('tickets','editar'))
            and not (select public.fn_ticket_notificado(tickets.id))
            and ((select public.fn_ve_todo('tickets'))
                 or (usuario_id = (select auth.uid()) and estado = 'ABIERTO')))
    );

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets for delete
    using (
        (select public.fn_es_admin())
        or ((select public.fn_tiene_permiso('tickets','eliminar'))
            and not (select public.fn_ticket_notificado(tickets.id))
            and ((select public.fn_ve_todo('tickets')) or usuario_id = (select auth.uid())))
    );

drop policy if exists horometros_insert on public.horometros;
create policy horometros_insert on public.horometros for insert
    with check ((select public.fn_puede_escribir_en_ticket(horometros.ticket_id, 'horometros', 'editar')));

drop policy if exists horometros_update on public.horometros;
create policy horometros_update on public.horometros for update
    using ((select public.fn_puede_escribir_en_ticket(horometros.ticket_id, 'horometros', 'editar')));

drop policy if exists horometros_delete on public.horometros;
create policy horometros_delete on public.horometros for delete
    using ((select public.fn_puede_escribir_en_ticket(horometros.ticket_id, 'horometros', 'eliminar')));

drop policy if exists registros_insert on public.registros;
create policy registros_insert on public.registros for insert
    with check ((select public.fn_puede_escribir_en_ticket(registros.ticket_id, 'labores', 'editar')));

drop policy if exists registros_update on public.registros;
create policy registros_update on public.registros for update
    using ((select public.fn_puede_escribir_en_ticket(registros.ticket_id, 'labores', 'editar')));

drop policy if exists registros_delete on public.registros;
create policy registros_delete on public.registros for delete
    using ((select public.fn_puede_escribir_en_ticket(registros.ticket_id, 'labores', 'eliminar')));

drop policy if exists registro_detalle_insert on public.registro_detalle;
create policy registro_detalle_insert on public.registro_detalle for insert
    with check ((select public.fn_puede_escribir_en_ticket(
        (select r.ticket_id from public.registros r where r.id = registro_detalle.registro_id),
        'labores', 'editar')));

drop policy if exists registro_detalle_update on public.registro_detalle;
create policy registro_detalle_update on public.registro_detalle for update
    using ((select public.fn_puede_escribir_en_ticket(
        (select r.ticket_id from public.registros r where r.id = registro_detalle.registro_id),
        'labores', 'editar')));

drop policy if exists registro_detalle_delete on public.registro_detalle;
create policy registro_detalle_delete on public.registro_detalle for delete
    using ((select public.fn_puede_escribir_en_ticket(
        (select r.ticket_id from public.registros r where r.id = registro_detalle.registro_id),
        'labores', 'eliminar')));

-- =====================================================================
-- D · EL REPARTO DE HORAS, GLOBAL Y CON DOS REGLAS
-- =====================================================================

-- La marca de «esto lo puso una persona». Lo que lleve esta marca no se
-- recalcula nunca: se descuenta del total y el resto se reparte entre las
-- demás líneas. Sin esta columna, corregir a mano las horas de un lote
-- duraba hasta que alguien guardara la siguiente labor del mismo
-- horómetro.
alter table public.registro_detalle
    add column if not exists horas_manual boolean not null default false;

comment on column public.registro_detalle.horas_manual is
'Las horas las escribió una persona. El prorrateo las respeta y reparte el resto.';

/**
 * `registros.horas_notificadas` = la suma de las líneas de esa labor.
 *
 * Va aparte porque se necesita en dos caminos —el reparto normal y el
 * caso de todo puesto a mano— y porque el orden importa: se vacían todas
 * primero. Si no, al escribir la primera el disparador de validación la
 * suma con las viejas de las otras, el total pasa del horómetro y
 * rechaza un reparto que sí cuadra. Con `null` el disparador se aparta.
 */
create or replace function public.fn_sincronizar_horas_notificadas(p_horometro_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id uuid;
begin
    update public.registros set horas_notificadas = null
    where horometro_id = p_horometro_id;

    for v_id in
        select r.id from public.registros r where r.horometro_id = p_horometro_id
        order by r.created_at, r.id
    loop
        update public.registros r
        set horas_notificadas = (
            select coalesce(sum(rd.horas_maquina), 0)
            from public.registro_detalle rd where rd.registro_id = r.id
        )
        where r.id = v_id;
    end loop;
end;
$$;

grant execute on function public.fn_sincronizar_horas_notificadas(uuid) to authenticated;

/**
 * Reparte las horas del horómetro entre TODOS sus lotes.
 *
 * Global por horómetro: los lotes de todas las labores compiten en el
 * mismo reparto. La versión anterior partía primero entre labores y
 * después entre lotes, y por eso el mismo lote salía con cifras
 * distintas según cuántas labores lo acompañaran esa jornada.
 *
 * Las DOS reglas, y no hay una tercera:
 *
 *   A · área    TODOS los lotes traen manzanas:
 *                   horas × mz del lote / Σ mz
 *   B · partes  alguno NO las trae:
 *                   horas / cantidad de lotes
 *
 * «Todos» y no «alguno»: con un lote sin medir, el que sí midió se
 * llevaría todo y el otro quedaría en cero.
 *
 * Y dos invariantes: la suma da exactamente las horas del horómetro, y
 * ninguna línea queda en cero (piso de 0.01).
 */
create or replace function public.fn_prorratear_horas_horometro(p_horometro_id uuid)
returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_total       numeric;
    v_manual      numeric;
    v_disponible  numeric;
    v_libres      integer;
    v_por_area    boolean;
    v_piso        numeric;
    v_repartido   numeric;
    v_ticket      uuid;
    v_id          uuid;
begin
    -- `security definer` para poder escribir el reparto completo sin que
    -- la RLS de cada línea lo corte a la mitad; por eso mismo el permiso
    -- se comprueba aquí a mano, que si no sería una puerta abierta.
    select h.ticket_id, coalesce(h.horas_maquina, 0) into v_ticket, v_total
    from public.horometros h where h.id = p_horometro_id;

    if v_ticket is null then
        raise exception 'El horómetro no existe.' using errcode = 'P0002';
    end if;

    if not public.fn_puede_escribir_en_ticket(v_ticket, 'labores', 'editar') then
        raise exception 'No tienes permiso para repartir las horas de este horómetro.'
            using errcode = '42501';
    end if;

    if v_total is null or v_total <= 0 then
        -- Sin horas no hay nada que repartir, pero sí que limpiar: dejar
        -- el reparto anterior escrito sería cobrar horas que ya no hay.
        -- Lo puesto a mano se respeta igual: es un dato, no un cálculo.
        update public.registro_detalle rd
        set horas_maquina = 0
        from public.registros r
        where r.id = rd.registro_id
          and r.horometro_id = p_horometro_id
          and not rd.horas_manual;
        return 0;
    end if;

    -- Cuántas horas están comprometidas a mano y cuántas líneas quedan
    -- libres. Las dos cifras salen de la misma pasada.
    select coalesce(sum(rd.horas_maquina) filter (where rd.horas_manual), 0),
           count(*) filter (where not rd.horas_manual)
      into v_manual, v_libres
    from public.registro_detalle rd
    join public.registros r on r.id = rd.registro_id
    where r.horometro_id = p_horometro_id;

    v_disponible := greatest(0, round(v_total - coalesce(v_manual, 0), 2));

    if v_libres = 0 then
        -- Todo está puesto a mano: no hay nada que calcular.
        perform public.fn_sincronizar_horas_notificadas(p_horometro_id);
        return v_total;
    end if;

    -- La regla se decide con TODAS las líneas del horómetro, corregidas
    -- incluidas: «se midió el área o no» es una propiedad de la jornada,
    -- no de qué líneas quedaron libres.
    select bool_and(coalesce(rd.avance_mz, 0) > 0) into v_por_area
    from public.registro_detalle rd
    join public.registros r on r.id = rd.registro_id
    where r.horometro_id = p_horometro_id;

    -- Ninguna línea en cero. Si lo disponible no alcanza ni para el
    -- mínimo de cada una, se reparte lo que hay: inventar horas
    -- descuadraría el total contra el horómetro.
    v_piso := least(0.01, round(v_disponible / v_libres, 2));

    with lineas as (
        select rd.id,
               case when coalesce(v_por_area, false)
                    then coalesce(rd.avance_mz, 0)
                    else 1
               end as peso
        from public.registro_detalle rd
        join public.registros r on r.id = rd.registro_id
        where r.horometro_id = p_horometro_id and not rd.horas_manual
    ),
    calculado as (
        select l.id,
               greatest(
                   v_piso,
                   round(v_disponible * l.peso / nullif(sum(l.peso) over (), 0), 2)
               ) as horas
        from lineas l
    )
    update public.registro_detalle rd
    set horas_maquina = coalesce(c.horas, v_piso)
    from calculado c
    where rd.id = c.id;

    -- Los céntimos del redondeo (y lo que el piso haya subido) se cargan
    -- a la línea libre más grande, para que la suma dé exactamente lo que
    -- marcó el horómetro. Nunca se le quitan a una que quedaría bajo el
    -- piso.
    select coalesce(sum(rd.horas_maquina), 0) into v_repartido
    from public.registro_detalle rd
    join public.registros r on r.id = rd.registro_id
    where r.horometro_id = p_horometro_id;

    if round(v_repartido, 2) <> round(v_total, 2) then
        select rd.id into v_id
        from public.registro_detalle rd
        join public.registros r on r.id = rd.registro_id
        where r.horometro_id = p_horometro_id
          and not rd.horas_manual
          and round(rd.horas_maquina + (v_total - v_repartido), 2) >= v_piso
        order by coalesce(rd.avance_mz, 0) desc, rd.horas_maquina desc, rd.created_at, rd.id
        limit 1;

        if v_id is not null then
            update public.registro_detalle
            set horas_maquina = round(horas_maquina + (v_total - v_repartido), 2)
            where id = v_id;
        end if;
    end if;

    perform public.fn_sincronizar_horas_notificadas(p_horometro_id);
    return v_total;
end;
$$;


/**
 * Escribe a mano las horas de UNA línea y vuelve a cuadrar el resto.
 *
 * `p_horas` null quita la marca y devuelve la línea al reparto
 * automático, que es la única forma de deshacer una corrección.
 */
create or replace function public.fn_horas_de_linea(
    p_detalle_id uuid,
    p_horas      numeric
) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_horometro uuid;
    v_ticket    uuid;
begin
    select r.horometro_id, r.ticket_id into v_horometro, v_ticket
    from public.registros r
    join public.registro_detalle rd on rd.registro_id = r.id
    where rd.id = p_detalle_id;

    if v_horometro is null then
        raise exception 'La línea no existe o no tienes permiso para verla.'
            using errcode = 'P0002';
    end if;

    if not public.fn_puede_escribir_en_ticket(v_ticket, 'labores', 'editar') then
        raise exception 'No tienes permiso para cambiar las horas de esta línea.'
            using errcode = '42501';
    end if;

    if p_horas is null then
        update public.registro_detalle
        set horas_manual = false
        where id = p_detalle_id;
    else
        if p_horas < 0 then
            raise exception 'Las horas no pueden ser negativas.' using errcode = '22023';
        end if;
        update public.registro_detalle
        set horas_maquina = round(p_horas, 2), horas_manual = true
        where id = p_detalle_id;
    end if;

    return public.fn_prorratear_horas_horometro(v_horometro);
end;
$$;

grant execute on function public.fn_horas_de_linea(uuid, numeric) to authenticated;

-- Cambiar el área de una línea cambia el reparto de todo el horómetro:
-- con la regla A el peso es el área, así que corregir 3 mz a 5 mueve las
-- horas de los demás lotes. Antes había que acordarse de volver a pedir
-- el prorrateo desde la pantalla.
create or replace function public.fn_reprorratear_al_cambiar_area()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_horometro uuid;
begin
    select r.horometro_id into v_horometro
    from public.registros r where r.id = new.registro_id;

    if v_horometro is not null then
        perform public.fn_prorratear_horas_horometro(v_horometro);
    end if;
    return null;
end;
$$;

drop trigger if exists trg_reprorratear_area on public.registro_detalle;
create trigger trg_reprorratear_area
    after update of avance_mz on public.registro_detalle
    for each row
    when (old.avance_mz is distinct from new.avance_mz)
    execute function public.fn_reprorratear_al_cambiar_area();

-- `horas_manual` en la vista, para que la pantalla pueda marcar la celda
-- y no volver a pisarla. Va al final: `create or replace view` sólo puede
-- AGREGAR columnas, nunca cambiar las que ya están.
create or replace view public.v_labores_control as
 SELECT rd.id AS detalle_id,
    r.id AS registro_id,
    r.ticket_id,
    r.horometro_id,
    r.fecha,
    rd.lote_temporada_id,
    lo.nomenclatura AS ut,
    lo.nombre AS lote_nombre,
    r.tarea_id,
    ts.codigo AS tarea_codigo,
    ts.nombre AS tarea_nombre,
    rd.ciclo,
    rd.avance_mz,
    r.labor_id,
    lb.nombre AS labor_nombre,
    cl.nombre AS categoria_labor,
    e.codigo AS equipo_codigo,
    h.turno,
    h.horas_maquina,
    h.horas_hombre,
    r.horas_notificadas,
    COALESCE(r.horas_notificadas, h.horas_maquina) AS horas_costeadas,
    o.codigo AS operador_codigo,
    o.nombre AS operador_nombre,
    r.implemento_id,
    im.codigo AS implemento_codigo,
    im.nombre AS implemento_nombre,
    pi_.codigo AS puesto_implemento,
    pi_.operacion_sap AS operacion_implemento,
    pf.codigo AS puesto_equipo,
    pf.operacion_sap AS operacion_equipo,
    pf.descripcion AS descripcion_equipo,
    t.codigo AS ticket_codigo,
    t.estado AS ticket_estado,
    t.proceso AS ticket_proceso,
    t.departamento,
    r.comentarios,
    r.usuario_id,
    pe.nombre AS usuario_nombre,
    ( SELECT count(*) AS count
           FROM registro_detalle x
          WHERE x.registro_id = r.id) AS lotes_del_registro,
    r.created_at,
    l_t.temporada_id,
    tm.nombre AS temporada_nombre,
    l_t.lote_id,
    r.implemento_fisico_id,
    imf.codigo AS codigo_implemento,
    rd.etapa,
    rd.con_moto,
    rd.proveedor_plastico_id,
    pp.nombre AS proveedor_plastico,
    rd.proveedor_manguera_id,
    pmg.nombre AS proveedor_manguera,
    rd.comentarios AS detalle_comentarios,
    rd.fecha AS detalle_fecha,
    h.equipo_id,
    h.operador_id,
    h.horometro_inicial,
    h.horometro_final,
    ( SELECT count(*) AS count
           FROM registros y
          WHERE y.horometro_id = h.id) AS registros_del_horometro,
    rd.horas_maquina AS horas_linea,
    COALESCE(lb.seguimiento_emplasticado, false) AS requiere_etapa,
    rd.horas_manual
   FROM registro_detalle rd
     JOIN registros r ON r.id = rd.registro_id
     JOIN lotes_temporada l_t ON l_t.id = rd.lote_temporada_id
     JOIN temporadas tm ON tm.id = l_t.temporada_id
     JOIN lotes lo ON lo.id = l_t.lote_id
     JOIN horometros h ON h.id = r.horometro_id
     JOIN equipos e ON e.id = h.equipo_id
     LEFT JOIN familias_equipo fe ON fe.id = e.familia_id
     LEFT JOIN puestos_trabajo pf ON pf.id = fe.puesto_trabajo_id
     LEFT JOIN operadores o ON o.id = h.operador_id
     JOIN labores lb ON lb.id = r.labor_id
     LEFT JOIN categorias_labor cl ON cl.id = lb.categoria_labor_id
     JOIN tareas_sap ts ON ts.id = r.tarea_id
     LEFT JOIN implementos im ON im.id = r.implemento_id
     LEFT JOIN implementos_fisicos imf ON imf.id = r.implemento_fisico_id
     LEFT JOIN puestos_trabajo pi_ ON pi_.id = im.puesto_trabajo_id
     LEFT JOIN proveedores pp ON pp.id = rd.proveedor_plastico_id
     LEFT JOIN proveedores pmg ON pmg.id = rd.proveedor_manguera_id
     LEFT JOIN perfiles pe ON pe.id = r.usuario_id
     JOIN tickets t ON t.id = r.ticket_id;

alter view public.v_labores_control set (security_invoker = on);
grant select on public.v_labores_control to authenticated;

-- =====================================================================
-- Aviso final
-- =====================================================================
do $$
declare v_n integer;
begin
    select count(*) into v_n from public.permisos where accion = 'ver_todo';
    raise notice 'Migración 42 aplicada. % permisos «ver_todo» sembrados.', v_n;
    raise notice 'Revisa Permisos: el rol SIN «ver todo» ahora sólo ve lo que capturó él.';
end $$;
