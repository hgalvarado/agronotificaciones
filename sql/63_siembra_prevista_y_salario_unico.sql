-- =====================================================================
-- 63 · LA SIEMBRA PREVISTA Y EL SALARIO MÍNIMO ÚNICO
-- =====================================================================
--
-- Dos arreglos que salen de la auditoría de la 62 en la finca.
--
--   A · **EL DDT SALÍA SIEMPRE «—».** No era un fallo de la pantalla: la
--       pantalla preguntaba bien y la base contestaba vacío.
--       `fn_siembras_de_lotes` leía sólo `siembras`, que es la captura
--       DIARIA de trasplante —lo que ya se sembró—. Pero la desinfección
--       se hace **dos meses antes** de trasplantar: cuando se desinfecta
--       en octubre, la siembra de diciembre todavía no existe en esa
--       tabla y nunca va a existir. El dato que hace falta es el del
--       PLAN (`planes_siembra`), y sólo cuando ya se sembró manda la
--       siembra real sobre el plan.
--
--       La función devuelve además de DÓNDE salió la fecha, para que la
--       pantalla pueda decir «previsto» y nadie confunda un plan con un
--       hecho.
--
--   B · **El salario mínimo no se podía marcar sin pelearse con el
--       índice.** La 62 puso un índice único parcial para que sólo
--       hubiera uno, pero no dijo qué pasa al marcar el segundo: salta
--       un error de llave duplicada que al de catálogos no le dice nada.
--       Marcar uno nuevo DESMARCA al anterior, que es lo que quiere
--       decir «éste es el salario mínimo».
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · LA SIEMBRA: LA REAL SI LA HAY, LA PREVISTA SI NO
-- =====================================================================
-- Cambia la forma de lo que devuelve, así que hay que soltarla antes:
-- `create or replace function` no puede cambiar su tabla de salida.
drop function if exists public.fn_siembras_de_lotes(uuid[], integer);

/**
 * La siembra de cada lote: la capturada si existe, la planificada si no.
 *
 * **Por qué dos fuentes y no una.** `siembras` es el trabajo hecho y
 * `planes_siembra` es el que se va a hacer. La desinfección vive en el
 * hueco entre los dos: se aplica el producto ~70 días antes de
 * trasplantar, así que en el momento de capturarla la siembra real NO
 * existe. Leer sólo `siembras` dejaba el DDT en blanco justo en el único
 * momento en que hace falta.
 *
 * La precedencia es la natural: el hecho manda sobre el plan. Si el lote
 * ya se sembró, el DDT se cuenta contra el día en que se sembró de
 * verdad; mientras no, contra el día en que está previsto.
 *
 * `origen` viaja con la fecha a propósito. Un número solo es ambiguo
 * —¿faltan 69 días o faltaban?— y la pantalla tiene que poder decir
 * «previsto». Devolver la fecha sin su procedencia obligaría a la
 * pantalla a adivinarla, y adivinaría mal el día que las dos coincidan.
 *
 * Sigue siendo `security definer` con la comprobación de permiso DENTRO:
 * `siembras` y `planes_siembra` se leen con el permiso de Trasplante, que
 * quien captura una desinfección no tiene por qué tener. Sin esa
 * comprobación interna sería un agujero por el que cualquiera leería el
 * plan de siembra de toda la finca.
 */
create function public.fn_siembras_de_lotes(
    p_lotes uuid[],
    p_ciclo integer default null
)
returns table (
    lote_temporada_id uuid,
    fecha_siembra     date,
    variedad_id       uuid,
    variedad_nombre   text,
    origen            text
)
language sql stable security definer set search_path = public, pg_temp as $$
    with permitido as (
        select (public.fn_tiene_permiso('desinfeccion', 'ver')
             or public.fn_tiene_permiso('trasplante', 'ver')) as si
    ),
    -- Lo ya sembrado. La PRIMERA siembra del lote en el ciclo: un lote se
    -- siembra en varios días y la que abre el ciclo es la que cuenta.
    real_ as (
        select distinct on (s.lote_temporada_id)
               s.lote_temporada_id,
               s.fecha_siembra,
               s.variedad_id,
               v.nombre as variedad_nombre
        from public.siembras s
        left join public.variedades v on v.id = s.variedad_id
        where s.lote_temporada_id = any(p_lotes)
          and (p_ciclo is null or s.ciclo = p_ciclo)
        order by s.lote_temporada_id, s.fecha_siembra
    ),
    -- Lo planificado. Mismo criterio —la más temprana—, y se descartan
    -- los planes sin fecha: un plan sin día no sirve para contar días.
    plan as (
        select distinct on (p.lote_temporada_id)
               p.lote_temporada_id,
               p.fecha_siembra,
               p.variedad_id,
               v.nombre as variedad_nombre
        from public.planes_siembra p
        left join public.variedades v on v.id = p.variedad_id
        where p.lote_temporada_id = any(p_lotes)
          and p.fecha_siembra is not null
          and (p_ciclo is null or p.ciclo = p_ciclo)
        order by p.lote_temporada_id, p.fecha_siembra
    )
    select
        coalesce(r.lote_temporada_id, pl.lote_temporada_id),
        coalesce(r.fecha_siembra,     pl.fecha_siembra),
        coalesce(r.variedad_id,       pl.variedad_id),
        coalesce(r.variedad_nombre,   pl.variedad_nombre),
        case when r.lote_temporada_id is not null then 'real' else 'plan' end
    from real_ r
    full join plan pl on pl.lote_temporada_id = r.lote_temporada_id
    cross join permitido
    where permitido.si
$$;

comment on function public.fn_siembras_de_lotes(uuid[], integer) is
    'La siembra de cada lote: la capturada si existe, la prevista del plan si no. Definer, pero comprueba el permiso dentro.';

grant execute on function public.fn_siembras_de_lotes(uuid[], integer) to authenticated;

-- =====================================================================
-- B · MARCAR UN SALARIO MÍNIMO DESMARCA AL ANTERIOR
-- =====================================================================
-- El índice de la 62 impide que haya dos. Esto hace que marcar el nuevo
-- sea posible sin tener que acordarse de desmarcar el viejo primero: en
-- una casilla de una cuadrícula, pedir dos pasos en el orden correcto es
-- pedir un error.
--
-- Va en la BASE y no en la pantalla porque la pantalla no es la única
-- puerta: el importador de Excel escribe en la misma tabla, y una regla
-- que sólo vive en React se salta sola por ahí.

create or replace function public.fn_salario_minimo_unico()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    -- El `where es_salario_minimo` es lo que corta la recursión: el
    -- update sólo toca filas marcadas, y al dejarlas en falso el
    -- disparador no se vuelve a disparar porque su `when` ya no se
    -- cumple.
    update public.puestos_trabajo
       set es_salario_minimo = false
     where id <> new.id
       and es_salario_minimo;
    return new;
end;
$$;

drop trigger if exists trg_salario_minimo_unico on public.puestos_trabajo;
create trigger trg_salario_minimo_unico
    before insert or update of es_salario_minimo
    on public.puestos_trabajo
    for each row
    when (new.es_salario_minimo)
    execute function public.fn_salario_minimo_unico();

-- =====================================================================
-- C · LOS GUARDIANES
-- =====================================================================

do $$
declare
    v_cols text;
begin
    select string_agg(column_name, ', ' order by ordinal_position) into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'planes_siembra'
      and column_name in ('lote_temporada_id', 'ciclo', 'fecha_siembra', 'variedad_id');
    if v_cols is null or v_cols !~ 'fecha_siembra' then
        raise exception 'planes_siembra no tiene la forma que la 63 espera: %', coalesce(v_cols, 'ninguna columna');
    end if;

    if not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'fn_siembras_de_lotes'
          and p.prosecdef
          and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%')
    then
        raise exception 'fn_siembras_de_lotes perdió su security definer o su search_path.';
    end if;

    if not exists (
        select 1 from pg_trigger
        where tgrelid = 'public.puestos_trabajo'::regclass
          and tgname = 'trg_salario_minimo_unico')
    then
        raise exception 'El disparador del salario mínimo único no se creó.';
    end if;
end $$;

-- =====================================================================
-- Qué NO hace esta migración, a propósito:
--
--   · No toca `siembras` ni `planes_siembra`: sólo las lee. El módulo de
--     trasplante queda exactamente como estaba.
--   · No inventa una fecha cuando no hay ni siembra ni plan con día.
--     Ahí el DDT sigue siendo «—», que es la verdad.
--   · No toca el importador de Excel del módulo de desinfección ni la
--     fórmula de PPM: siguen pedidos para después.
-- =====================================================================
