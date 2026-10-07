-- =====================================================================
-- 56 · LA MATRIZ ES LEY: SE ACABA EL ESTRANGULAMIENTO EN CASCADA
-- =====================================================================
--
-- EL PROBLEMA
--
-- Una pantalla casi nunca lee una sola tabla. `/labores` lee la vista
-- `v_labores_control`, que une `registro_detalle` con `registros`, con
-- `horometros`, con `tickets` y con `lotes_temporada`. Hasta aquí la
-- vista corría con `security_invoker = on`, o sea con los permisos de
-- quien pregunta, así que **cada una de esas tablas aplicaba su propio
-- RLS** y el resultado era la INTERSECCIÓN de todos.
--
-- Consecuencia: poner «Labores: Global» en la matriz no bastaba. Si el
-- mismo rol tenía «Tickets: Propietario» —que es lo normal, un digitador
-- no gestiona tickets ajenos— la unión con `tickets` tiraba las filas
-- antes de que nadie mirara el permiso de Labores. La pantalla enseñaba
-- un recorte que el Administrador no había pedido y que no podía quitar
-- desde ninguna casilla, porque la casilla que mandaba era la de OTRO
-- módulo.
--
-- LA REGLA QUE SE ESTABLECE
--
--   Cada pantalla se rige EXCLUSIVAMENTE por su propia fila en la
--   matriz. Si Labores dice Global, Labores enseña todo, aunque los
--   datos cuelguen de un ticket que ese rol no podría abrir.
--
-- EL PATRÓN
--
-- Cada vista de módulo se parte en dos:
--
--   interno.v_x_crudo   `security_invoker = off` → corre como su dueño,
--               así que NO aplica el RLS de las tablas de abajo. Es la
--               unión completa, sin recortar.
--
--   public.v_x  `select * from interno.v_x_crudo where <reja de su
--               pantalla>`, también `definer` —que es lo que le permite
--               leer la cruda— y es la única que se concede.
--
-- LA CRUDA VIVE EN OTRO ESQUEMA, Y ES LO MÁS IMPORTANTE DE AQUÍ
--
-- El primer intento las dejó en `public` con un `revoke`. No sirve: un
-- `grant select on all tables in schema public to authenticated` —que es
-- justo lo que Supabase corre por omisión, y lo que corre cualquiera que
-- repare permisos a mano— se lo devuelve todo, y entonces la vista que
-- se salta el RLS queda a un `select` de distancia de cualquier usuario.
-- La prueba lo encontró.
--
-- Viviendo en `interno`, al que `authenticated` no tiene ni `usage`, un
-- grant masivo sobre `public` no las alcanza. El permiso no se concede y
-- se revoca: directamente no existe.
--
-- O sea: la vista se salta el RLS de abajo y pone EN SU LUGAR la reja de
-- su propia pantalla. No se quita un control, se sustituye por el que
-- corresponde.
--
-- La reja es la misma de la 55, y se lee de arriba abajo:
--
--     (select fn_permitido_de(PANTALLA,'ver'))      ← InitPlan, 1 vez
--     and case (select fn_mi_alcance(PANTALLA,'ver'))  ← InitPlan, 1 vez
--         when 'global'      then true
--         when 'propietario' then DUEÑO = auth.uid()
--         else                    DUEÑO = auth.uid() or EN MIS ZONAS
--     end
--
-- QUÉ NO CAMBIA
--
--   · Las tablas conservan su RLS intacto. Nada de esto afecta a quien
--     consulte una tabla directamente, ni a ninguna escritura: insertar,
--     editar y borrar siguen pasando por las policies de siempre.
--   · `telecom` no entra: sus tablas no cuelgan de ninguna tabla padre
--     con permiso propio, así que ahí nunca hubo estrangulamiento y
--     abrirle un agujero no arreglaría nada.
--   · Al final hay un guardián que REVIENTA la migración si alguna vista
--     cruda quedó legible, o si alguna vista expuesta quedó sin reja.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- A · EL ESQUEMA PRIVADO
-- =====================================================================
-- Fuera de `public`, que es el único esquema que PostgREST publica y el
-- único al que apuntan los grants masivos.

create schema if not exists interno;

comment on schema interno is
    'Vistas crudas que se saltan el RLS. Nadie de fuera entra aquí: la reja de permiso la pone la vista de public que las envuelve.';

revoke all on schema interno from public;
revoke all on schema interno from authenticated, anon;

-- =====================================================================
-- B · DE QUÉ SE AGARRA LA REJA
-- =====================================================================

/**
 * Los lotes-temporada de MIS zonas.
 *
 * Devuelve un conjunto y no un booleano por fila a propósito: dentro de
 * la vista se usa como `lote_temporada_id in (select ...)`, que Postgres
 * resuelve con una tabla hash UNA vez. Preguntar `fn_ve_lote(...)` por
 * cada fila es lo que costaba 43 segundos en la 55.
 *
 * `security definer` porque tiene que leer `perfiles_zonas` y
 * `lotes_temporada` sin que les aplique su propio RLS; si no, la reja
 * dependería del permiso de otro módulo y estaríamos otra vez en el
 * problema que esta migración arregla.
 */
create or replace function public.fn_mis_lotes()
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select lt.id
    from public.lotes_temporada lt
    join public.perfiles_zonas pz on pz.zona_id = lt.zona_id
    where pz.perfil_id = (select auth.uid())
$$;

/** Los tickets que tocaron alguna de MIS zonas. */
create or replace function public.fn_mis_tickets()
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select distinct r.ticket_id
    from public.registro_detalle rd
    join public.registros r on r.id = rd.registro_id
    join public.lotes_temporada lt on lt.id = rd.lote_temporada_id
    join public.perfiles_zonas pz on pz.zona_id = lt.zona_id
    where pz.perfil_id = (select auth.uid())
$$;

grant execute on function public.fn_mis_lotes()   to authenticated;
grant execute on function public.fn_mis_tickets() to authenticated;

-- =====================================================================
-- C · EL PATRÓN, APLICADO A TODAS LAS VISTAS DE MÓDULO
-- =====================================================================
-- La lista va en un solo sitio y el bucle la aplica igual a todas. Es
-- deliberado: trece bloques escritos a mano acaban siendo trece rejas
-- ligeramente distintas, y la que se escriba mal no la ve nadie.
--
--   vista        · la que lee la pantalla
--   pantalla     · su fila en la matriz, y la ÚNICA que la gobierna
--   col_dueno    · la columna con el autor, o NULL si no tiene autor
--   col_lote     · lote-temporada, para el recorte zonal
--   col_ticket   · alternativa al anterior cuando la vista no trae lote
--
-- Una vista sin `col_dueno` no tiene concepto de autor, así que
-- «propietario» no recorta nada en ella. Es la misma regla que ya aplica
-- `fn_verificar_permiso` cuando el dueño llega nulo, y la alternativa
-- —esconderlo todo— dejaría la pantalla en blanco sin que ninguna
-- casilla lo explique.

do $$
declare
    v record;
    v_reja text;
    v_fila text;
begin
    for v in
        select * from (values
            ('v_labores_control',    'labores',      'usuario_id', 'lote_temporada_id', null),
            ('v_horometros_control', 'horometros',   'usuario_id', null,                'ticket_id'),
            ('v_avance_diario',      'avance',       null,         'lote_temporada_id', null),
            ('v_avance_ejecutado',   'avance',       null,         'lote_temporada_id', null),
            ('v_avance_lote_labor',  'avance',       null,         'lote_temporada_id', null),
            ('v_costos_labores',     'costos',       null,         'lote_temporada_id', null),
            ('v_rotacion_avance',    'rotacion',     'usuario_id', 'lote_temporada_id', null),
            ('v_rotacion_plan',      'rotacion',     null,         'lote_temporada_id', null),
            ('v_siembras',           'trasplante',   'usuario_id', 'lote_temporada_id', null),
            ('v_recepcion_plantulas','trasplante',   null,         null,                null),
            ('v_turnos_riego',       'turnos_riego', 'usuario_id', 'lote_temporada_id', null),
            ('v_lotes',              'lotes',        null,         null,                null),
            ('v_contadores_equipo',  'catalogos',    'usuario_id', null,                null)
        ) as t(vista, pantalla, col_dueno, col_lote, col_ticket)
    loop
        -- Si la pantalla no existe en el catálogo, la vista se queda
        -- como está: vale más una vista sin tocar que una reja que
        -- pregunta por una casilla inexistente y esconde todo.
        if not exists (select 1 from public.pantallas where codigo = v.pantalla) then
            raise notice 'La pantalla «%» no existe; % se deja como estaba.', v.pantalla, v.vista;
            continue;
        end if;

        if not exists (
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'interno' and c.relname = v.vista || '_crudo'
        ) then
            -- Si quedó una cruda en `public` de un intento anterior, se
            -- recoge; si no, la vista original pasa a ser la cruda.
            if exists (
                select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = v.vista || '_crudo'
            ) then
                execute format('drop view if exists public.%I', v.vista);
            else
                execute format('alter view public.%I rename to %I', v.vista, v.vista || '_crudo');
            end if;
            execute format('alter view public.%I set schema interno', v.vista || '_crudo');
        else
            -- Repetición: se tira la de fuera y se vuelve a armar.
            execute format('drop view if exists public.%I', v.vista);
        end if;

        -- La cruda deja de aplicar el RLS de abajo. Ya no hace falta
        -- revocarle nada: en `interno` no hay nada que revocar.
        execute format('alter view interno.%I set (security_invoker = off)', v.vista || '_crudo');

        /* ---------------------------- La reja --------------------- */

        -- Quién es el dueño de la fila, si la vista lo sabe.
        v_fila := case
            when v.col_dueno is not null
                then format('x.%I = (select auth.uid())', v.col_dueno)
            else 'true'
        end;

        -- Y el recorte zonal, por lote o por ticket.
        v_reja := case
            when v.col_lote is not null then
                format('%s or not (select public.fn_tiene_zonas()) '
                    || 'or x.%I in (select public.fn_mis_lotes())', v_fila, v.col_lote)
            when v.col_ticket is not null then
                format('%s or not (select public.fn_tiene_zonas()) '
                    || 'or x.%I in (select public.fn_mis_tickets())', v_fila, v.col_ticket)
            -- Sin lote ni ticket no hay zona de la que agarrarse: el eje
            -- zonal no recorta, igual que el de propietario sin dueño.
            else 'true'
        end;

        execute format($sql$
            create view public.%I as
            select x.* from interno.%I x
            where (select public.fn_permitido_de(%L, 'ver'))
              and case (select public.fn_mi_alcance(%L, 'ver'))
                  when 'global'      then true
                  when 'propietario' then %s
                  else %s
              end
        $sql$, v.vista, v.vista || '_crudo', v.pantalla, v.pantalla, v_fila, v_reja);

        execute format('grant select on public.%I to authenticated', v.vista);
    end loop;
end $$;

-- =====================================================================
-- D · EL GUARDIÁN
-- =====================================================================
-- Una vista `definer` sin reja no es una vista lenta: es la tabla
-- entera abierta a cualquiera que entre. Por eso esto no avisa, revienta.

do $$
declare
    v_suelta  text;
    v_abierta text;
    v_sin_reja text;
begin
    -- 1 · Ninguna cruda puede haberse quedado en `public`, donde el
    --     próximo grant masivo se la encontraría.
    select string_agg(c.relname, ', ') into v_suelta
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.relname like '%\_crudo';

    if v_suelta is not null then
        raise exception
            'Estas vistas crudas se quedaron en public, al alcance de un grant masivo: %',
            v_suelta;
    end if;

    -- 2 · Y a `interno` no entra nadie de fuera.
    select string_agg(r.rolname, ', ') into v_abierta
    from unnest(array['authenticated','anon','public']) as r(rolname)
    where has_schema_privilege(r.rolname, 'interno', 'usage');

    if v_abierta is not null then
        raise exception 'Estos roles pueden entrar al esquema interno: %', v_abierta;
    end if;

    -- 3 · Ninguna vista expuesta sobre una cruda puede quedarse sin reja.
    select string_agg(c.relname, ', ') into v_sin_reja
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and exists (
          select 1 from pg_class cr join pg_namespace nr on nr.oid = cr.relnamespace
          where nr.nspname = 'interno' and cr.relname = c.relname || '_crudo'
      )
      and pg_get_viewdef(c.oid, true) !~ 'fn_permitido_de';

    if v_sin_reja is not null then
        raise exception 'Estas vistas quedaron sin reja de permiso: %', v_sin_reja;
    end if;
end $$;

-- 3 · Y lo de siempre: que la matriz ofrezca toda llave que la base exija.
do $$
declare
    v_faltan integer;
begin
    select count(*) into v_faltan from public.fn_permisos_sin_casilla();
    if v_faltan > 0 then
        raise exception 'Quedaron % llaves sin casilla en la matriz.', v_faltan;
    end if;
end $$;
