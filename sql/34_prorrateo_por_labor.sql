-- =====================================================================
-- MIGRACIÓN 34 · El prorrateo respeta las horas de CADA labor, y se
--                recalcula solo cuando cambia el horómetro
-- =====================================================================
-- «Al editar un horómetro y modificar sus horas totales (ej. de 4 a 6),
--  las horas notificadas en las labores asociadas no se están
--  actualizando, generando descuadres financieros para SAP.»
--
-- Eran dos fallos encadenados.
--
-- El primero: nadie llamaba al reparto. `fn_prorratear_horas_horometro`
-- existía desde la migración 25, pero la ejecutaba la pantalla de
-- captura. Editar el horómetro desde /horometros, desde el modal de
-- labores o desde el SQL Editor cambiaba las horas máquina y dejaba el
-- reparto viejo intacto. Ahora lo dispara la BASE, así que da igual por
-- dónde entre el cambio.
--
-- El segundo, más caro: el reparto ignoraba a qué labor pertenecía cada
-- línea. Tomaba las horas del horómetro y las repartía entre TODAS las
-- líneas por manzanas, mezclando lotes de labores distintas. Con un
-- horómetro de 8 h y dos labores —arado 6 h en un lote grande, rastreo
-- 2 h en uno chico— el arado se llevaba lo que le tocaba al rastreo
-- porque su lote medía más. Las horas que el usuario asignó a cada labor
-- no significaban nada.
--
-- Las tres reglas, ahora sí:
--
--   A · Una labor en varios lotes CON manzanas:
--       horas del lote = horas de la labor × mz del lote ÷ Σ mz
--
--   B · Una labor en varios lotes SIN manzanas:
--       horas del lote = horas de la labor ÷ número de lotes
--
--   C · Varias labores en el mismo horómetro: cada una conserva las
--       horas que el usuario le asignó, y A o B se aplican DENTRO de
--       esa labor y sólo entre sus lotes.
--
-- Y la regla que sostiene a las tres: la suma de todas las líneas es
-- exactamente lo que marcó el horómetro. Ni una centésima más.
-- =====================================================================


-- =====================================================================
-- PARTE A · CUÁNTAS HORAS LE TOCAN A CADA LABOR
-- =====================================================================
-- Separada del reparto por lotes a propósito: son dos preguntas
-- distintas y mezclarlas fue justo el error anterior.
--
-- Con una sola labor no hay nada que decidir: se lleva el horómetro
-- entero. Con varias manda lo que el usuario asignó, pero REESCALADO
-- para que vuelva a sumar el total.
--
-- El reescalado es el corazón del pedido. Si un horómetro de 4 h tenía
-- 3 h de arado y 1 h de rastreo, y alguien corrige la lectura a 6 h, las
-- proporciones que el usuario decidió —tres cuartos y un cuarto— siguen
-- siendo suyas: pasan a 4.5 h y 1.5 h. Conservar los números viejos
-- dejaría 2 h sin notificar, y eso es el descuadre.
--
-- Si ninguna labor tiene horas asignadas, se reparte parejo entre ellas:
-- inventar un peso sería peor.
-- =====================================================================

create or replace function public.fn_horas_por_labor(p_horometro_id uuid)
returns table (registro_id uuid, horas numeric)
language sql stable security invoker as $$
    with total as (
        select coalesce(h.horas_maquina, 0) as horas
        from public.horometros h where h.id = p_horometro_id
    ),
    labores as (
        select r.id,
               -- Negativas o cero no son una asignación: se tratan como
               -- «sin asignar» para que no envenenen el reescalado.
               case when r.horas_notificadas > 0 then r.horas_notificadas else null end as asignadas,
               r.created_at
        from public.registros r
        where r.horometro_id = p_horometro_id
    ),
    resumen as (
        select count(*) as n,
               count(asignadas) as n_asignadas,
               coalesce(sum(asignadas), 0) as suma
        from labores
    )
    select l.id,
           case
               -- Una sola labor: el horómetro entero es suyo.
               when rs.n = 1 then t.horas
               -- Nadie asignó nada: partes iguales.
               when rs.n_asignadas = 0 or rs.suma <= 0 then t.horas / rs.n
               -- Alguna sin asignar conviviendo con otras que sí: a la
               -- que falta se le da la parte que sobra, repartida entre
               -- las que estén en su caso.
               when l.asignadas is null
                   then greatest(t.horas - rs.suma, 0) / (rs.n - rs.n_asignadas)
               -- El caso normal: su proporción sobre el nuevo total.
               else t.horas * l.asignadas / rs.suma
           end
    from labores l
    cross join resumen rs
    cross join total t
    order by l.created_at, l.id
$$;

comment on function public.fn_horas_por_labor(uuid) is
    'Cuántas horas del horómetro le corresponden a cada labor. Con una sola, todas; con varias, las que el usuario asignó reescaladas para que vuelvan a sumar el total del horómetro.';


-- =====================================================================
-- PARTE B · EL REPARTO, AHORA DENTRO DE CADA LABOR
-- =====================================================================

create or replace function public.fn_prorratear_horas_horometro(p_horometro_id uuid)
returns numeric
language plpgsql volatile security invoker as $$
declare
    v_total     numeric;
    v_repartido numeric;
    v_id        uuid;
begin
    select coalesce(h.horas_maquina, 0) into v_total
    from public.horometros h where h.id = p_horometro_id;

    if v_total is null or v_total <= 0 then
        -- Sin horas no hay nada que repartir, pero sí que limpiar: dejar
        -- el reparto anterior escrito sería cobrar horas que ya no hay.
        update public.registro_detalle rd
        set horas_maquina = 0
        from public.registros r
        where r.id = rd.registro_id and r.horometro_id = p_horometro_id;
        return 0;
    end if;

    -- Reparto por lotes, una labor a la vez. `partition by registro_id`
    -- es lo que encierra las reglas A y B dentro de la labor: el lote de
    -- una nunca compite con el de otra.
    with horas_labor as (
        select * from public.fn_horas_por_labor(p_horometro_id)
    ),
    lineas as (
        select rd.id,
               rd.registro_id,
               coalesce(rd.avance_mz, 0) as mz
        from public.registro_detalle rd
        join public.registros r on r.id = rd.registro_id
        where r.horometro_id = p_horometro_id
    ),
    pesos as (
        select l.id,
               l.registro_id,
               -- Regla A si la labor midió área en alguno de sus lotes;
               -- regla B —todas pesan 1— si no midió en ninguno.
               case when sum(l.mz) over (partition by l.registro_id) > 0
                    then l.mz else 1 end as peso
        from lineas l
    ),
    calculado as (
        select p.id,
               round(
                   hl.horas * p.peso
                   / nullif(sum(p.peso) over (partition by p.registro_id), 0),
                   2
               ) as horas
        from pesos p
        join horas_labor hl on hl.registro_id = p.registro_id
    )
    update public.registro_detalle rd
    set horas_maquina = coalesce(c.horas, 0)
    from calculado c
    where rd.id = c.id;

    -- Los céntimos del redondeo van a la línea de mayor peso (y, a
    -- igualdad, a la más antigua, para que el resultado sea siempre el
    -- mismo). Sin este ajuste el reparto tendría el mismo defecto que se
    -- está corrigiendo, más pequeño pero igual de real.
    select sum(rd.horas_maquina) into v_repartido
    from public.registro_detalle rd
    join public.registros r on r.id = rd.registro_id
    where r.horometro_id = p_horometro_id;

    if v_repartido is not null and v_repartido <> v_total then
        select rd.id into v_id
        from public.registro_detalle rd
        join public.registros r on r.id = rd.registro_id
        where r.horometro_id = p_horometro_id
        order by coalesce(rd.avance_mz, 0) desc, rd.created_at, rd.id
        limit 1;

        if v_id is not null then
            update public.registro_detalle
            set horas_maquina = round(horas_maquina + (v_total - v_repartido), 2)
            where id = v_id;
        end if;
    end if;

    -- `registros.horas_notificadas` queda como la SUMA de sus líneas: es
    -- el mismo reparto visto por labor, y lo que lee SAP.
    --
    -- Se vacían todas primero: si no, al escribir la primera el
    -- disparador de validación la suma con las viejas de las otras, el
    -- total pasa del horómetro y rechaza un reparto que sí cuadra. Con
    -- `null` el disparador se aparta —no hay nada que validar— y al
    -- terminar el bucle todas tienen su cifra nueva.
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

    return v_total;
end;
$$;

comment on function public.fn_prorratear_horas_horometro(uuid) is
    'Reparte las horas de un horómetro: primero entre sus labores (las que el usuario asignó, reescaladas al nuevo total) y después, dentro de cada labor, entre sus lotes por manzanas o en partes iguales. La suma queda exactamente igual al horómetro.';


-- =====================================================================
-- PARTE C · QUE NADIE TENGA QUE ACORDARSE DE LLAMARLO
-- =====================================================================
-- El disparador cierra el agujero: cambie el horómetro desde la pantalla
-- de edición, desde la cuadrícula de /horometros, desde el modal de
-- labores o desde el SQL Editor, el reparto se rehace.
--
-- Va DESPUÉS (`after`) y sólo cuando cambian las lecturas: `horas_maquina`
-- es una columna generada a partir de ellas, así que vigilar las lecturas
-- es vigilar las horas. Con `when` se evita rehacer el reparto cuando lo
-- que cambió fue el comentario o el operador.
--
-- No hay recursión posible: la función escribe en `registro_detalle` y en
-- `registros`, nunca en `horometros`.
-- =====================================================================

create or replace function public.fn_reprorratear_al_cambiar_horometro()
returns trigger
language plpgsql security invoker as $$
begin
    perform public.fn_prorratear_horas_horometro(new.id);
    return null;
end;
$$;

comment on function public.fn_reprorratear_al_cambiar_horometro() is
    'Rehace el reparto de horas en cuanto cambian las lecturas del horómetro. Sin esto, corregir un horómetro de 4 a 6 horas dejaba las labores notificando 4.';

drop trigger if exists trg_reprorratear_horometro on public.horometros;
create trigger trg_reprorratear_horometro
    after update of horometro_inicial, horometro_final on public.horometros
    for each row
    when (old.horometro_inicial is distinct from new.horometro_inicial
       or old.horometro_final   is distinct from new.horometro_final)
    execute function public.fn_reprorratear_al_cambiar_horometro();

-- Borrar un lote de una labor también descuadra: sus horas se quedaban
-- fuera del reparto y el horómetro dejaba de sumar.
--
-- Sólo al BORRAR, nunca al insertar. Al dar de alta, la pantalla mete
-- primero la labor con sus horas asignadas y después sus lotes uno a
-- uno; si el reparto corriera en cada línea, vería a esa labor sola en
-- el horómetro —las otras aún no existen— le daría el total entero y
-- borraría de paso las horas que el usuario ya había asignado a las
-- demás. La captura llama al reparto UNA vez, cuando ya están todas.
create or replace function public.fn_reprorratear_al_borrar_linea()
returns trigger
language plpgsql security invoker as $$
declare
    v_horometro uuid;
begin
    select r.horometro_id into v_horometro
    from public.registros r where r.id = old.registro_id;

    if v_horometro is not null then
        perform public.fn_prorratear_horas_horometro(v_horometro);
    end if;
    return null;
end;
$$;

drop trigger if exists trg_reprorratear_linea on public.registro_detalle;
create trigger trg_reprorratear_linea
    after delete on public.registro_detalle
    for each row execute function public.fn_reprorratear_al_borrar_linea();

comment on function public.fn_reprorratear_al_borrar_linea() is
    'Rehace el reparto cuando una labor pierde un lote: las mismas horas repartidas entre las líneas que quedan.';


-- =====================================================================
-- PARTE D · CUADRAR LO QUE YA ESTÁ CARGADO
-- =====================================================================
-- Lo de antes se repartió con la regla vieja —mezclando labores—, así que
-- hay horas mal puestas en la base ahora mismo. Se vuelven a repartir
-- todas con la regla nueva.
-- =====================================================================

select public.fn_prorratear_horas_masivo(null);
