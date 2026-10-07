-- =====================================================================
-- 55 · QUE «GLOBAL» SIGNIFIQUE GLOBAL, Y QUE LA CONSULTA TERMINE
-- =====================================================================
--
-- Dos fallos que resultaron ser el mismo: las policies preguntaban el
-- permiso FILA POR FILA.
--
--   1 · «Global» no se respetaba. Siete policies seguían recortando por
--       zona con `fn_ve_zona` / `fn_ve_lote` SIEMPRE, sin mirar el
--       alcance. Poner Global en la matriz no cambiaba nada porque el
--       recorte estaba escrito aparte, debajo. `/labores` es el caso
--       claro: la vista `v_labores_control` une `registro_detalle` con
--       `lotes_temporada`, y las dos recortaban por su cuenta.
--
--   2 · `canceling statement due to statement timeout` en rangos
--       largos. Medido sobre 13.000 líneas de detalle —una fracción de
--       un año real— la consulta de `/labores` tardaba **43 segundos**.
--       El plan dice por qué: `fn_verificar_permiso` corría como SubPlan
--       una vez POR FILA (4.324 vueltas sólo en `registros`), y dentro
--       de cada vuelta la policy hacía
--       `select usuario_id from public.tickets where id = ...`
--       escrito EN LÍNEA, que vuelve a aplicar el RLS de `tickets`
--       entero. 1.8 millones de bloques leídos para devolver mil filas.
--
-- El arreglo es uno solo: **resolver el permiso una vez por consulta.**
--
--   · La parte de PANTALLA —¿se permite?, ¿con qué alcance?— sale de
--     funciones que sólo reciben constantes, envueltas en `(select ...)`.
--     Postgres las convierte en InitPlan y las evalúa UNA vez.
--   · La parte de FILA queda como predicados sobre columnas de la fila,
--     y el recorte por zona sólo entra cuando el alcance es `zonal`.
--   · Donde hacía falta mirar el ticket dueño, se hace con una función
--     `security definer`, que no vuelve a pasar por el RLS de `tickets`.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · ÍNDICES
-- =====================================================================
-- `registro_detalle.fecha` no tenía ninguno, y es por donde entra el
-- rango de fechas de /labores. Los demás cubren los caminos que el plan
-- recorría a mano.

create index if not exists registro_detalle_fecha_idx
    on public.registro_detalle (fecha desc);

create index if not exists registro_detalle_fecha_registro_idx
    on public.registro_detalle (fecha desc, registro_id);

create index if not exists registro_detalle_usuario_idx
    on public.registro_detalle (usuario_id);

create index if not exists horometros_fecha_idx
    on public.horometros (fecha desc);

create index if not exists horometros_ticket_idx
    on public.horometros (ticket_id);

create index if not exists registros_fecha_ticket_idx
    on public.registros (fecha desc, ticket_id);

create index if not exists registros_usuario_idx
    on public.registros (usuario_id);

create index if not exists tickets_usuario_fecha_idx
    on public.tickets (usuario_id, fecha desc);

-- =====================================================================
-- B · RESOLVER EL PERMISO UNA VEZ, NO UNA POR FILA
-- =====================================================================

/**
 * ¿Está encendida la casilla? Sin mirar ninguna fila.
 *
 * `fn_verificar_permiso` contesta lo mismo y más, pero recibe atributos
 * del registro, así que el planificador no puede sacarla del bucle.
 * Ésta sólo recibe constantes: envuelta en `(select ...)` se evalúa una
 * vez por consulta y no una vez por fila. Es toda la diferencia entre
 * 43 segundos y medio.
 */
create or replace function public.fn_permitido_de(p_pantalla text, p_accion text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select permitido from public.fn_permiso_de(p_pantalla, p_accion)), false)
$$;

grant execute on function public.fn_permitido_de(text, text) to authenticated;

/** El dueño de un ticket, SIN volver a pasar por el RLS de `tickets`. */
create or replace function public.fn_dueno_ticket(p_ticket_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select t.usuario_id from public.tickets t where t.id = p_ticket_id
$$;

/** El dueño de una labor: el de su ticket. */
create or replace function public.fn_dueno_registro(p_registro_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select t.usuario_id
    from public.registros r
    join public.tickets t on t.id = r.ticket_id
    where r.id = p_registro_id
$$;

/** El dueño de una línea de detalle: el de su labor. */
create or replace function public.fn_dueno_detalle(p_detalle_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select t.usuario_id
    from public.registro_detalle rd
    join public.registros r on r.id = rd.registro_id
    join public.tickets t on t.id = r.ticket_id
    where rd.id = p_detalle_id
$$;

/** ¿Cae esta labor en una zona que el usuario mira? */
create or replace function public.fn_ve_registro(p_registro_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select not public.fn_tiene_zonas()
        or exists (
            select 1
            from public.registro_detalle rd
            join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
            join public.perfiles_zonas pz on pz.zona_id = lt.zona_id
            where rd.registro_id = p_registro_id
              and pz.perfil_id = (select auth.uid())
        )
$$;

grant execute on function public.fn_dueno_ticket(uuid)    to authenticated;
grant execute on function public.fn_dueno_registro(uuid)  to authenticated;
grant execute on function public.fn_dueno_detalle(uuid)   to authenticated;
grant execute on function public.fn_ve_registro(uuid)     to authenticated;

-- =====================================================================
-- C · LAS POLICIES DE LECTURA, CON EL ALCANCE AL MANDO
-- =====================================================================
-- La forma es siempre la misma, y por eso se puede leer de un vistazo:
--
--     (select fn_permitido_de(PANTALLA, 'ver'))     ← una vez
--     and case (select fn_mi_alcance(PANTALLA,'ver'))  ← una vez
--         when 'global'      then true
--         when 'propietario' then DUEÑO = auth.uid()
--         when 'zonal'       then DUEÑO = auth.uid() or VE_LA_ZONA
--     end
--
-- `global` ya no recorta por zona. Ése era el fallo.

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select
    using (
        (select public.fn_permitido_de('tickets', 'ver'))
        and case (select public.fn_mi_alcance('tickets', 'ver'))
            when 'global'      then true
            when 'propietario' then tickets.usuario_id = (select auth.uid())
            else tickets.usuario_id = (select auth.uid())
                 or (select public.fn_ve_ticket(tickets.id))
        end
    );

drop policy if exists horometros_select on public.horometros;
create policy horometros_select on public.horometros for select
    using (
        (select public.fn_permitido_de('horometros', 'ver'))
        and case (select public.fn_mi_alcance('horometros', 'ver'))
            when 'global'      then true
            when 'propietario' then
                (select public.fn_dueno_ticket(horometros.ticket_id)) = (select auth.uid())
            else (select public.fn_dueno_ticket(horometros.ticket_id)) = (select auth.uid())
                 or (select public.fn_ve_horometro(horometros.id))
        end
    );

drop policy if exists registros_select on public.registros;
create policy registros_select on public.registros for select
    using (
        (select public.fn_permitido_de('labores', 'ver'))
        and case (select public.fn_mi_alcance('labores', 'ver'))
            when 'global'      then true
            when 'propietario' then
                (select public.fn_dueno_ticket(registros.ticket_id)) = (select auth.uid())
            else (select public.fn_dueno_ticket(registros.ticket_id)) = (select auth.uid())
                 or (select public.fn_ve_registro(registros.id))
        end
    );

-- El detalle es la tabla del recorte zonal de verdad: la zona vive en
-- su lote. Antes `fn_ve_lote` iba suelta y recortaba siempre.
drop policy if exists registro_detalle_select on public.registro_detalle;
create policy registro_detalle_select on public.registro_detalle for select
    using (
        (select public.fn_permitido_de('labores', 'ver'))
        and case (select public.fn_mi_alcance('labores', 'ver'))
            when 'global'      then true
            when 'propietario' then
                (select public.fn_dueno_detalle(registro_detalle.id)) = (select auth.uid())
            else (select public.fn_dueno_detalle(registro_detalle.id)) = (select auth.uid())
                 or (select public.fn_ve_lote(registro_detalle.lote_temporada_id))
        end
    );

-- ------------------------- Campo y catálogos -------------------------
-- `lotes_temporada` entra en la vista de /labores por un JOIN interno,
-- así que su recorte propio bastaba para que «Global» no funcionara
-- aunque `labores` ya estuviera en global.

drop policy if exists lotes_temporada_select on public.lotes_temporada;
create policy lotes_temporada_select on public.lotes_temporada for select
    using (
        (select public.fn_permitido_de('lotes', 'ver'))
        and (
            (select public.fn_mi_alcance('lotes', 'ver')) <> 'zonal'
            or (select public.fn_ve_zona(lotes_temporada.zona_id))
        )
    );

drop policy if exists zonas_select on public.zonas;
create policy zonas_select on public.zonas for select
    using (
        (select auth.uid()) is not null
        and (
            (select public.fn_mi_alcance('lotes', 'ver')) <> 'zonal'
            or (select public.fn_ve_zona(zonas.id))
        )
    );

drop policy if exists siembras_select on public.siembras;
create policy siembras_select on public.siembras for select
    using (
        (select public.fn_permitido_de('trasplante', 'ver'))
        and (
            (select public.fn_mi_alcance('trasplante', 'ver')) <> 'zonal'
            or (select public.fn_ve_lote(siembras.lote_temporada_id))
        )
    );

drop policy if exists plan_siembra_select on public.planes_siembra;
create policy plan_siembra_select on public.planes_siembra for select
    using (
        (select public.fn_permitido_de('trasplante', 'ver'))
        and (
            (select public.fn_mi_alcance('trasplante', 'ver')) <> 'zonal'
            or (select public.fn_ve_lote(planes_siembra.lote_temporada_id))
        )
    );

drop policy if exists turnos_riego_select on public.turnos_riego;
create policy turnos_riego_select on public.turnos_riego for select
    using (
        (select public.fn_permitido_de('turnos_riego', 'ver'))
        and (
            (select public.fn_mi_alcance('turnos_riego', 'ver')) <> 'zonal'
            or (select public.fn_ve_zona(turnos_riego.zona_id))
        )
    );

drop policy if exists turnos_riego_detalle_select on public.turnos_riego_detalle;
create policy turnos_riego_detalle_select on public.turnos_riego_detalle for select
    using (
        (select public.fn_permitido_de('turnos_riego', 'ver'))
        and (
            (select public.fn_mi_alcance('turnos_riego', 'ver')) <> 'zonal'
            or exists (
                select 1 from public.turnos_riego t
                where t.id = turnos_riego_detalle.turno_id
                  and (select public.fn_ve_zona(t.zona_id))
            )
        )
    );

-- =====================================================================
-- D · EL GUARDIÁN
-- =====================================================================

do $$
declare
    v_faltan integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    if v_faltan > 0 then
        raise exception 'Quedaron % llaves sin casilla en la matriz.', v_faltan;
    end if;
end $$;

analyze public.registro_detalle;
analyze public.registros;
analyze public.horometros;
analyze public.tickets;
