-- =====================================================================
-- 69 · EL PERFIL DE JORNAL EN EL CATÁLOGO DE PERSONAL
-- =====================================================================
--
-- En Catálogos → Personal sólo se podía marcar a alguien como «Operador»
-- o «Administrativo». El jornalero —que es casi todo el personal de
-- desinfección y de riego— no tenía casilla: existía `es_jornal`, pero
-- esa columna no se ve desde el catálogo y no se puede filtrar por ella.
--
-- Resultado: no había forma de contestar «enséñame los jornales» desde
-- la pantalla que existe para eso.
--
-- ── POR QUÉ SON DOS ARCHIVOS ────────────────────────────────────────
--
-- PostgreSQL **no deja usar un valor de enum en la misma transacción en
-- que se crea**:
--
--     ERROR: unsafe use of new value "JORNAL" of enum type tipo_perfil
--
-- Y el editor SQL de Supabase manda el archivo entero como una sola
-- transacción. Así que esta migración sólo CREA el valor y deja dicho el
-- disparador —cuyo cuerpo no se resuelve hasta que corre—, y la 70 hace
-- el relleno de lo que ya existe.
--
-- **Corre primero la 69 entera, y después la 70.** En ese orden.
--
-- Idempotente.
-- =====================================================================


-- =====================================================================
-- A · EL VALOR NUEVO
-- =====================================================================
-- Única sentencia que toca el tipo. Va sola y primero: cualquier cosa
-- que la acompañe y lo use revienta con el error de arriba.

alter type public.tipo_perfil add value if not exists 'JORNAL';


-- =====================================================================
-- B · UN SOLO JORNAL, ESCRITO EN DOS SITIOS
-- =====================================================================
--
-- `operadores` tiene ahora dos maneras de decir lo mismo:
--
--   · `es_jornal` (booleano), que es lo que filtra el selector de
--     cuadrilla de desinfección desde la 61 y lo que mira el costo.
--   · `tipo_perfil` (array), que es lo que se ve y se filtra en el
--     catálogo.
--
-- **Dos columnas para un mismo hecho se separan.** Basta con que alguien
-- marque el perfil en el catálogo y no toque la casilla para que el
-- selector de cuadrilla no le ofrezca a esa persona: el catálogo diría
-- que es jornal y la captura diría que no, y las dos pantallas tendrían
-- razón.
--
-- Por eso la base las mantiene en paso, en las DOS direcciones, y lo
-- hace aquí y no en React: el importador de Excel escribe en la misma
-- tabla y una regla que sólo vive en el navegador se salta sola por ahí.
--
-- El cuerpo de una función plpgsql es texto hasta que corre, así que
-- puede nombrar 'JORNAL' aunque el valor se acabe de crear.

create or replace function public.fn_operador_jornal_en_paso()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tiene boolean;
begin
    new.tipo_perfil := coalesce(new.tipo_perfil, array[]::public.tipo_perfil[]);
    v_tiene := 'JORNAL' = any(new.tipo_perfil::text[]);

    -- Qué manda cuando las dos cambian a la vez: lo que CAMBIÓ en esta
    -- escritura. Si sólo se tocó la casilla, manda la casilla; si sólo
    -- se tocó el perfil, manda el perfil. Sin esta distinción, editar el
    -- perfil en la cuadrícula lo revertiría al guardar.
    if tg_op = 'UPDATE' and new.es_jornal is distinct from old.es_jornal then
        if new.es_jornal and not v_tiene then
            new.tipo_perfil := new.tipo_perfil || 'JORNAL'::public.tipo_perfil;
        elsif not new.es_jornal and v_tiene then
            new.tipo_perfil := array(
                select x from unnest(new.tipo_perfil) as x where x::text <> 'JORNAL'
            )::public.tipo_perfil[];
        end if;
        return new;
    end if;

    -- El resto de los casos —alta, o edición del perfil— los decide el
    -- perfil, que es lo que la persona acaba de escribir.
    new.es_jornal := v_tiene or (tg_op = 'INSERT' and coalesce(new.es_jornal, false));

    if new.es_jornal and not v_tiene then
        new.tipo_perfil := new.tipo_perfil || 'JORNAL'::public.tipo_perfil;
    end if;

    return new;
end $$;

comment on function public.fn_operador_jornal_en_paso() is
    'Mantiene en paso operadores.es_jornal y el perfil JORNAL, en las dos direcciones (migración 69).';

drop trigger if exists trg_operador_jornal_en_paso on public.operadores;
create trigger trg_operador_jornal_en_paso
    before insert or update on public.operadores
    for each row execute function public.fn_operador_jornal_en_paso();
