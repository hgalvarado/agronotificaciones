-- =====================================================================
-- MIGRACIÓN 20 · Importador histórico completo: crea el ticket y todo
--                lo que cuelga de él, con la agrupación correcta
-- =====================================================================
-- Dos cosas, y la primera es un ERROR que ya le costó datos:
--
-- 1. EL HORÓMETRO NO SE RECONOCE SÓLO POR EL EQUIPO.
--
--    `fn_importar_detalle_ticket` buscaba el horómetro por (ticket,
--    equipo, turno). Con eso, estas seis jornadas del 10 de abril
--    entraron como tres:
--
--      A78  11,109 → 11,118   Francisco Montoya
--      A61  44,304 → 44,313   Jose Santos Aguilar
--      A61  44,313 → 44,320   Denis Navarro Hernandez
--      A65  14,769 → 14,777   Hector Rodriguez
--      A78  11,118 → 11,125   Virgilio Yanez
--      A65  14,762 → 14,769   Jose Edgardo Hernandez
--
--    El A61 salió dos veces el mismo día con dos operadores y dos
--    lecturas distintas del horómetro: son DOS horómetros, no uno. La
--    llave correcta es (ticket, equipo, turno, inicial, final,
--    operador), y es la de esta migración. Antes, la segunda lectura del
--    A61 se pegaba a la primera y sus siete horas desaparecían del
--    costo.
--
--    La otra mitad de la regla sí estaba bien y se conserva: mismas
--    lecturas y mismo operador en lotes distintos ES un solo horómetro
--    con varias líneas.
--
-- 2. YA NO HACE FALTA CREAR EL TICKET A MANO.
--
--    `fn_importar_historico` recibe el archivo completo, agrupa las
--    filas en tickets y crea ticket → horómetros → labores → líneas en
--    una sola transacción.
--
--    La llave del ticket es el código de la plataforma anterior cuando
--    viene (`20260410-flazo-[8a74e02b]`), que es lo que él ya tiene
--    descargado. Cuando no viene, la pantalla arma un código
--    determinista con fecha + equipo + operador + inicial + final, que
--    es la llave que él pidió. Determinista a propósito: volver a
--    importar el mismo archivo reutiliza los tickets en vez de
--    duplicarlos.
-- =====================================================================


-- =====================================================================
-- PARTE A · LA LLAVE DEL HORÓMETRO, CORREGIDA
-- =====================================================================
-- Mismo cuerpo que la 19 salvo la búsqueda del horómetro. Se deja la
-- función porque la pantalla del ticket la sigue usando para cargar el
-- detalle de UN ticket ya creado.
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
    v_oper     uuid;
    v_hi       numeric;
    v_hf       numeric;
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

        v_oper := (v_fila->>'operador_id')::uuid;
        v_hi   := coalesce((v_fila->>'horometro_inicial')::numeric, 0);
        v_hf   := coalesce((v_fila->>'horometro_final')::numeric, v_hi);

        -- La lectura y el operador entran en la llave: el mismo equipo
        -- puede salir dos veces el mismo día, con dos operadores y dos
        -- tramos de horómetro. Son dos horómetros.
        select h.id into v_h_id
        from public.horometros h
        where h.ticket_id = p_ticket_id
          and h.equipo_id = (v_fila->>'equipo_id')::uuid
          and h.turno = (coalesce(v_fila->>'turno', 'DIURNO'))::public.turno_tipo
          and h.horometro_inicial = v_hi
          and h.horometro_final = v_hf
          and h.operador_id is not distinct from v_oper;

        if v_h_id is null then
            insert into public.horometros (
                ticket_id, fecha, turno, equipo_id,
                horometro_inicial, horometro_final, horas_hombre,
                operador_id, comentario, usuario_id
            ) values (
                p_ticket_id, v_fecha,
                (coalesce(v_fila->>'turno', 'DIURNO'))::public.turno_tipo,
                (v_fila->>'equipo_id')::uuid,
                v_hi, v_hf,
                coalesce((v_fila->>'horas_hombre')::numeric, 8),
                v_oper,
                v_fila->>'comentario',
                v_dueno
            )
            returning id into v_h_id;
            v_horom := v_horom + 1;
        end if;

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
                v_impl, v_impl_fis,
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
-- PARTE B · REPARTIR LAS HORAS DEL HORÓMETRO ENTRE SUS LABORES
-- =====================================================================
-- El histórico no trae la columna H_NOT: la plataforma anterior sólo
-- guardaba las horas del horómetro. Si se dejan en null y el horómetro
-- tiene dos labores, `coalesce(horas_notificadas, horas_maquina)` le da
-- las horas COMPLETAS a cada una y el costo del día sale al doble.
--
-- Así que al terminar la carga se reparten las horas del horómetro entre
-- sus labores, a partes iguales. No es adivinar: es la única reparto que
-- no infla el total, y el total es lo que tiene que cuadrar con la
-- notificación de SAP. Sólo se toca cuando NINGUNA labor del horómetro
-- trajo horas propias; si el archivo las trae, manda el archivo.
-- =====================================================================

create or replace function public.fn_repartir_horas_horometros(p_ticket_ids uuid[])
returns integer
language plpgsql volatile security invoker as $$
declare
    v_tocados integer := 0;
begin
    with candidatos as (
        select r.horometro_id,
               h.horas_maquina,
               count(*) as labores
        from public.registros r
        join public.horometros h on h.id = r.horometro_id
        where h.ticket_id = any(p_ticket_ids)
        group by r.horometro_id, h.horas_maquina
        having count(*) filter (where r.horas_notificadas is not null) = 0
           and coalesce(h.horas_maquina, 0) > 0
    ),
    aplicado as (
        update public.registros r
        set horas_notificadas = round(c.horas_maquina / c.labores, 2)
        from candidatos c
        where r.horometro_id = c.horometro_id
        returning r.id
    )
    select count(*) into v_tocados from aplicado;

    return v_tocados;
end;
$$;

comment on function public.fn_repartir_horas_horometros(uuid[]) is
    'Reparte las horas del horómetro entre sus labores a partes iguales, sólo en los horómetros donde ninguna labor trajo horas propias. Evita que el costo se multiplique por el número de labores.';


-- =====================================================================
-- PARTE C · EL IMPORTADOR HISTÓRICO
-- =====================================================================
-- Recibe el archivo entero y crea lo que falte, en una transacción.
--
-- Cada fila trae su `ticket_codigo`, que es la llave de agrupación: el
-- código de la plataforma anterior, o el determinista que arma la
-- pantalla con fecha + equipo + operador + inicial + final. Las filas
-- con el mismo código caen en el mismo ticket; las que difieren en
-- horómetro u operador caen en tickets distintos, que es exactamente lo
-- que él pidió.
--
-- Idempotente: un ticket que ya existe se reutiliza —no se duplica ni se
-- reescribe—, un horómetro que ya está se reconoce por su llave
-- completa, y una línea de lote repetida no se vuelve a insertar. Así,
-- si la carga se interrumpe o el archivo se sube dos veces, no quedan
-- datos dobles.
-- =====================================================================

create or replace function public.fn_importar_historico(p_filas jsonb)
returns table (
    tickets_nuevos    integer,
    tickets_reusados  integer,
    horometros_nuevos integer,
    labores_nuevas    integer,
    lineas_nuevas     integer,
    lineas_repetidas  integer,
    horas_repartidas  integer
)
language plpgsql volatile security invoker as $$
declare
    v_fila     jsonb;
    v_n        integer := 0;
    v_codigo   text;
    v_t_id     uuid;
    v_t_fecha  date;
    v_t_dueno  uuid;
    v_h_id     uuid;
    v_r_id     uuid;
    v_d_id     uuid;
    v_impl     uuid;
    v_impl_fis uuid;
    v_oper     uuid;
    v_hi       numeric;
    v_hf       numeric;
    v_mz       numeric;
    v_tickets  uuid[] := '{}';
    v_nuevos   integer := 0;
    v_reusados integer := 0;
    v_horom    integer := 0;
    v_labores  integer := 0;
    v_lin_new  integer := 0;
    v_lin_rep  integer := 0;
begin
    if p_filas is null or jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
        raise exception 'No se recibió ninguna fila que importar.';
    end if;

    -- Crear tickets a nombre de otra persona es de Administrador y Torre
    -- de Control. Se comprueba una vez, no por fila.
    if not (public.fn_es_admin() or public.fn_mi_rol() = 'TORRE_CONTROL') then
        raise exception 'Sólo el Administrador o Torre de Control pueden cargar el histórico, porque los tickets quedan a nombre de otras personas.';
    end if;

    for v_fila in select * from jsonb_array_elements(p_filas)
    loop
        v_n := v_n + 1;

        if v_fila->>'ticket_codigo' is null or v_fila->>'fecha' is null
           or v_fila->>'usuario_id' is null or v_fila->>'equipo_id' is null
           or v_fila->>'labor_id' is null or v_fila->>'tarea_id' is null
           or v_fila->>'lote_temporada_id' is null then
            raise exception 'La fila % viene incompleta: hacen falta ticket, fecha, usuario, equipo, labor, tarea y lote.', v_n;
        end if;

        v_codigo  := v_fila->>'ticket_codigo';
        v_t_fecha := (v_fila->>'fecha')::date;
        v_t_dueno := (v_fila->>'usuario_id')::uuid;

        /* ------------------------- El ticket -------------------------- */
        select t.id into v_t_id from public.tickets t where t.codigo = v_codigo;

        if v_t_id is null then
            insert into public.tickets (
                codigo, fecha, usuario_id, departamento, temporada_id, proceso
            ) values (
                v_codigo, v_t_fecha, v_t_dueno,
                v_fila->>'departamento',
                (v_fila->>'temporada_id')::uuid,
                coalesce((v_fila->>'proceso')::public.proceso_ticket, 'REGISTRADO')
            )
            returning id into v_t_id;
            v_nuevos := v_nuevos + 1;
            v_tickets := v_tickets || v_t_id;
        elsif not (v_t_id = any(v_tickets)) then
            v_reusados := v_reusados + 1;
            v_tickets := v_tickets || v_t_id;
        end if;

        /* ------------------------ El horómetro ------------------------ */
        v_oper := (v_fila->>'operador_id')::uuid;
        v_hi   := coalesce((v_fila->>'horometro_inicial')::numeric, 0);
        v_hf   := coalesce((v_fila->>'horometro_final')::numeric, v_hi);

        select h.id into v_h_id
        from public.horometros h
        where h.ticket_id = v_t_id
          and h.equipo_id = (v_fila->>'equipo_id')::uuid
          and h.turno = (coalesce(v_fila->>'turno', 'DIURNO'))::public.turno_tipo
          and h.horometro_inicial = v_hi
          and h.horometro_final = v_hf
          and h.operador_id is not distinct from v_oper;

        if v_h_id is null then
            insert into public.horometros (
                ticket_id, fecha, turno, equipo_id,
                horometro_inicial, horometro_final, horas_hombre,
                operador_id, comentario, usuario_id
            ) values (
                v_t_id, v_t_fecha,
                (coalesce(v_fila->>'turno', 'DIURNO'))::public.turno_tipo,
                (v_fila->>'equipo_id')::uuid,
                v_hi, v_hf,
                coalesce((v_fila->>'horas_hombre')::numeric, 8),
                v_oper,
                v_fila->>'comentario',
                v_t_dueno
            )
            returning id into v_h_id;
            v_horom := v_horom + 1;
        end if;

        /* -------------------------- La labor -------------------------- */
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
                v_t_id, v_h_id, v_t_fecha,
                (v_fila->>'labor_id')::uuid,
                (v_fila->>'tarea_id')::uuid,
                v_impl, v_impl_fis,
                (v_fila->>'horas_notificadas')::numeric,
                v_fila->>'comentario',
                v_t_dueno
            )
            returning id into v_r_id;
            v_labores := v_labores + 1;
        end if;

        /* ----------------------- La línea del lote -------------------- */
        v_mz := (v_fila->>'avance_mz')::numeric;

        -- Una línea idéntica ya cargada no se repite: es lo que hace que
        -- subir el archivo dos veces no duplique las manzanas.
        select rd.id into v_d_id
        from public.registro_detalle rd
        where rd.registro_id = v_r_id
          and rd.lote_temporada_id = (v_fila->>'lote_temporada_id')::uuid
          and rd.avance_mz is not distinct from v_mz;

        if v_d_id is null then
            insert into public.registro_detalle (
                registro_id, lote_temporada_id, fecha, avance_mz, ciclo, etapa,
                con_moto, proveedor_plastico_id, proveedor_manguera_id, usuario_id
            ) values (
                v_r_id,
                (v_fila->>'lote_temporada_id')::uuid,
                v_t_fecha,
                v_mz,
                coalesce((v_fila->>'ciclo')::integer, 1),
                (v_fila->>'etapa')::smallint,
                coalesce((v_fila->>'con_moto')::boolean, false),
                (v_fila->>'proveedor_plastico_id')::uuid,
                (v_fila->>'proveedor_manguera_id')::uuid,
                v_t_dueno
            );
            v_lin_new := v_lin_new + 1;
        else
            v_lin_rep := v_lin_rep + 1;
        end if;
    end loop;

    return query
    select v_nuevos, v_reusados, v_horom, v_labores, v_lin_new, v_lin_rep,
           public.fn_repartir_horas_horometros(v_tickets);
end;
$$;

comment on function public.fn_importar_historico(jsonb) is
    'Carga histórica completa: agrupa las filas por `ticket_codigo` y crea ticket, horómetros, labores y líneas de lote en una transacción. El horómetro se reconoce por equipo + turno + lectura inicial + lectura final + operador, así que el mismo equipo puede tener varios horómetros el mismo día.';


-- =====================================================================
-- PARTE D · LA PANTALLA Y SU PERMISO
-- =====================================================================

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('historico', 'Carga histórica', 'Importar jornadas completas de la plataforma anterior',
     '/admin/historico', 95, array['ver','crear'])
on conflict (codigo) do update
set nombre = excluded.nombre,
    descripcion = excluded.descripcion,
    ruta = excluded.ruta,
    orden = excluded.orden,
    acciones = excluded.acciones;
