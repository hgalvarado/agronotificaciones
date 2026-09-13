-- =====================================================================
-- MIGRACIÓN 18 · Registro histórico: tickets a nombre de otro y carga
--                del detalle del ticket desde Excel
-- =====================================================================
-- «Creación de ticket histórico: permitir la creación manual e
--  individual de un ticket especificando una fecha retroactiva (ej. 15
--  de abril 2026, Fernando Lazo).»
--
-- «Carga de detalles por ticket (vía Excel): dentro de la vista de un
--  ticket ya creado, importar masivamente los detalles exclusivos de ese
--  ticket (horómetros y labores ejecutadas).»
-- =====================================================================


-- =====================================================================
-- PARTE A · UN TICKET A NOMBRE DE OTRA PERSONA
-- =====================================================================
-- La policy de inserción exigía `usuario_id = auth.uid()`: nadie podía
-- crear un ticket a nombre de otro, ni el Administrador. Para el
-- histórico eso es justo lo que hace falta —la jornada del 15 de abril
-- fue de Fernando Lazo, no de quien la está capturando hoy— y si el
-- ticket queda a nombre de quien lo digita, el «Registró» de todos los
-- reportes miente y el Digitador ni siquiera vería su propia jornada.
--
-- El candado se mantiene donde importa: el Digitador sigue pudiendo
-- crear SÓLO a nombre propio. Administrador y Torre de Control pueden
-- elegir a quién, que es su trabajo.
-- =====================================================================

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert
    with check (
        (select public.fn_tiene_permiso('ticket','create'))
        and (
            usuario_id = (select auth.uid())
            or (select public.fn_es_admin())
            or (select public.fn_mi_rol()) = 'TORRE_CONTROL'
        )
    );


-- =====================================================================
-- PARTE B · IMPORTAR EL DETALLE DE UN TICKET
-- =====================================================================
-- Una fila del Excel es «este equipo, en este turno, hizo esta labor en
-- este lote». O sea que una sola fila puede tener que crear TRES cosas
-- encadenadas: el horómetro, el registro de la labor y la línea del
-- lote. Y varias filas comparten el horómetro (el mismo tractor hizo
-- tres labores) o el registro (la misma labor tocó cuatro lotes).
--
-- Por eso va en la base y no en el navegador:
--
--   1. Encadenado. El registro necesita el id del horómetro, y la línea
--      el del registro. Desde el navegador serían tres viajes por fila
--      y, si se corta a la mitad, quedan horómetros huérfanos sin labor
--      que nadie va a encontrar después.
--   2. Es una sola transacción. O entra el ticket completo o no entra
--      nada; media jornada importada es peor que ninguna, porque las
--      horas ya no cuadran y no se sabe por dónde seguir.
--   3. Los disparadores de la 14 —fecha desde el ticket, tope de horas
--      contra el horómetro— corren igual. Si el Excel reparte más horas
--      de las que dio el horómetro, la carga se detiene con el mensaje
--      del disparador en vez de meter el error.
--
-- Los nombres ya vienen resueltos a UUID desde la pantalla, que es donde
-- están los catálogos y donde se le puede decir «en la fila 7 no existe
-- el equipo A99» antes de tocar la base.
-- =====================================================================

create or replace function public.fn_importar_detalle_ticket(
    p_ticket_id uuid,
    /**
     * Arreglo de objetos. Obligatorios: equipo_id, turno, labor_id,
     * tarea_id, lote_temporada_id. Opcionales: horometro_inicial,
     * horometro_final, horas_hombre, operador_id, implemento_id,
     * horas_notificadas, avance_mz, ciclo, etapa, con_moto,
     * proveedor_plastico_id, proveedor_manguera_id, comentario.
     */
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
    v_horom    integer := 0;
    v_labores  integer := 0;
    v_lineas   integer := 0;
begin
    select t.fecha, t.usuario_id into v_fecha, v_dueno
    from public.tickets t where t.id = p_ticket_id;

    -- Si el ticket existe pero es de otra persona, la RLS de `tickets`
    -- no lo deja ver y aquí llega en null. Se dicen las dos cosas en el
    -- mismo mensaje en vez de afirmar que no existe: no existe PARA
    -- quien pregunta, y decirle cuál es el caso sería filtrar
    -- información de tickets ajenos.
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

        -- ---------------- Horómetro: uno por equipo y turno ----------------
        -- Si el mismo tractor hizo tres labores en la jornada, las tres
        -- filas del Excel cuelgan del MISMO horómetro. Se reconoce por
        -- (ticket, equipo, turno): un equipo no tiene dos horómetros en
        -- el mismo turno del mismo día.
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
                (v_fila->>'horas_hombre')::numeric,
                (v_fila->>'operador_id')::uuid,
                v_fila->>'comentario',
                v_dueno
            )
            returning id into v_h_id;
            v_horom := v_horom + 1;
        end if;

        -- ---------------- Registro: uno por labor del horómetro ------------
        -- La misma labor sobre cuatro lotes es UN registro con cuatro
        -- líneas, igual que cuando se captura a mano. Si se creara un
        -- registro por fila, las horas notificadas se contarían cuatro
        -- veces y el costo saldría cuadruplicado.
        v_impl := (v_fila->>'implemento_id')::uuid;

        select r.id into v_r_id
        from public.registros r
        where r.horometro_id = v_h_id
          and r.labor_id = (v_fila->>'labor_id')::uuid
          and r.tarea_id = (v_fila->>'tarea_id')::uuid
          and r.implemento_id is not distinct from v_impl;

        if v_r_id is null then
            insert into public.registros (
                ticket_id, horometro_id, fecha, labor_id, tarea_id,
                implemento_id, horas_notificadas, comentarios, usuario_id
            ) values (
                p_ticket_id, v_h_id, v_fecha,
                (v_fila->>'labor_id')::uuid,
                (v_fila->>'tarea_id')::uuid,
                v_impl,
                (v_fila->>'horas_notificadas')::numeric,
                v_fila->>'comentario',
                v_dueno
            )
            returning id into v_r_id;
            v_labores := v_labores + 1;
        end if;

        -- ---------------- La línea del lote --------------------------------
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

comment on function public.fn_importar_detalle_ticket(uuid, jsonb) is
    'Carga el detalle de UN ticket desde Excel: crea los horómetros que falten (uno por equipo y turno), los registros de labor (uno por labor del horómetro) y una línea por lote. Todo en una transacción.';
