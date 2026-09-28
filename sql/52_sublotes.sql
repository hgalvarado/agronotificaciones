-- =====================================================================
-- 52 · Sublotes: un lote que pertenece a otro
--
-- Ejecutar en el SQL Editor DESPUÉS de la 51.
--
-- El 1003-025 no es un lote independiente: es un pedazo del 1003-020 que
-- se trabaja aparte porque se siembra en otra fecha o con otra variedad.
-- Hasta ahora eso sólo estaba en la nomenclatura, que es una convención
-- que sólo entiende quien la escribió: cualquier suma por lote contaba
-- las manzanas del padre y las del hijo como si fueran terreno distinto.
--
-- Una FK RECURSIVA sobre la misma tabla y no una tabla de jerarquías
-- aparte: el padre de un lote es un lote, y una tabla puente para una
-- relación de uno a muchos son dos sitios donde vive el mismo dato.
-- =====================================================================

alter table public.lotes
    add column if not exists lote_padre_id uuid references public.lotes(id) on delete set null;

comment on column public.lotes.lote_padre_id is
'El lote del que este es un pedazo. Nulo en los lotes de primer nivel. `on delete set null`: borrar el padre no puede llevarse por delante el histórico del hijo.';

create index if not exists idx_lotes_padre on public.lotes (lote_padre_id);


-- =====================================================================
-- A · NI SU PROPIO PADRE, NI SU PROPIO ABUELO
-- =====================================================================
/**
 * Impide los ciclos en la jerarquía.
 *
 * Sin esto, A padre de B y B padre de A es una fila perfectamente válida
 * para Postgres, y cualquier consulta recursiva que la toque se cuelga.
 * No es un error que la pantalla pueda evitar: basta con que dos personas
 * editen a la vez.
 *
 * Se recorre hacia arriba con un tope por si la base YA tuviera un ciclo
 * —no debería, pero un `while` sin tope en un disparador es una forma de
 * colgar la aplicación entera—.
 */
create or replace function public.fn_lote_sin_ciclos()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_actual uuid := new.lote_padre_id;
    v_saltos integer := 0;
begin
    if new.lote_padre_id is null then
        return new;
    end if;

    if new.lote_padre_id = new.id then
        raise exception 'Un lote no puede ser su propio lote padre.'
            using errcode = '23514';
    end if;

    while v_actual is not null and v_saltos < 50 loop
        if v_actual = new.id then
            raise exception 'Ese lote padre cuelga de este mismo lote: la jerarquía daría vueltas.'
                using errcode = '23514';
        end if;
        select lote_padre_id into v_actual from public.lotes where id = v_actual;
        v_saltos := v_saltos + 1;
    end loop;

    return new;
end;
$$;

drop trigger if exists trg_lotes_sin_ciclos on public.lotes;
create trigger trg_lotes_sin_ciclos
    before insert or update of lote_padre_id on public.lotes
    for each row execute function public.fn_lote_sin_ciclos();


-- =====================================================================
-- B · EL PADRE, RESUELTO
-- =====================================================================
-- La nomenclatura del padre la piden todas las listas. Se resuelve en la
-- base y no en cada pantalla: con el `join` hecho en JavaScript, una
-- tabla de doscientos lotes son doscientas búsquedas y cada pantalla se
-- inventa la suya.

create or replace view public.v_lotes as
select
    l.id,
    l.nomenclatura,
    l.nombre,
    l.tipo,
    l.activo,
    l.lote_padre_id,
    p.nomenclatura as lote_padre,
    p.nombre       as lote_padre_nombre,
    -- Cuántos pedazos cuelgan de él. Es lo que permite avisar antes de
    -- borrar un lote que tiene sublotes.
    (select count(*) from public.lotes h where h.lote_padre_id = l.id) as sublotes
from public.lotes l
left join public.lotes p on p.id = l.lote_padre_id;

alter view public.v_lotes set (security_invoker = on);
grant select on public.v_lotes to authenticated;
