-- =====================================================================
-- 78 · HORÓMETROS: CUÁNTAS LABORES CUELGAN DE CADA LECTURA
--
-- Ejecutar en el SQL Editor DESPUÉS de la 77.
--
-- `cantidad_labores` = registros (labores) del horómetro. Un horómetro
-- con horas y 0 labores es una jornada que nadie notificó: la pantalla
-- lo filtra con la tarjeta «Horas sin notificar».
--
-- Patrón de la 57: la cruda se ENVUELVE con su propia definición
-- (`pg_get_viewdef`) en vez de reescribirse a mano. Reescribir 60 líneas
-- de ventana y contador para añadir una columna es la forma de perder un
-- desempate sin que nadie lo note.
--
-- La cruda es `definer`: el conteo ve TODAS las labores del horómetro,
-- no sólo las que el usuario podría abrir. Es lo que se quiere: «0» tiene
-- que significar cero, no «cero de las tuyas». Sólo sale un número.
--
-- La expuesta se rearma con la reja de la 66 (horometros · nada · dueño).
--
-- Idempotente.
-- =====================================================================

-- El correlativo cuenta por este índice; existe desde 01, se asegura.
create index if not exists registros_horometro_id_idx on public.registros (horometro_id);

do $$
declare
    v_def text;
begin
    if not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'interno' and c.relname = 'v_horometros_control_crudo'
    ) then
        raise exception '78 · No existe interno.v_horometros_control_crudo: faltan la 56/66.';
    end if;

    -- La expuesta fijó su lista de columnas al crearse: se tira antes.
    drop view if exists public.v_horometros_control;

    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'interno'
          and table_name = 'v_horometros_control_crudo'
          and column_name = 'cantidad_labores'
    ) then
        v_def := rtrim(btrim(pg_get_viewdef('interno.v_horometros_control_crudo'::regclass, true)), ';');
        execute format(
            'create or replace view interno.v_horometros_control_crudo as '
            || 'select c.*, '
            || '(select count(*) from public.registros r where r.horometro_id = c.id)::integer '
            || 'as cantidad_labores from (%s) c', v_def);
    else
        raise notice '78 · La cruda ya trae cantidad_labores; sólo se rearma la expuesta.';
    end if;

    execute 'alter view interno.v_horometros_control_crudo set (security_invoker = off)';
    execute 'revoke all on interno.v_horometros_control_crudo from authenticated, anon';
end $$;

-- Reja canónica (66): horometros · sin dimensión zonal · con dueño.
create view public.v_horometros_control as
select x.* from interno.v_horometros_control_crudo x
where (select public.fn_permitido_de('horometros', 'ver'))
  and case (select public.fn_mi_alcance('horometros', 'ver'))
      when 'global'      then true
      when 'propietario' then x.usuario_id = (select auth.uid())
      else true
  end;

grant select on public.v_horometros_control to authenticated;

comment on view public.v_horometros_control is
    'Control de horómetros (reja 66). `cantidad_labores` (78): labores registradas sobre la lectura; 0 con horas = jornada sin notificar.';

-- =====================================================================
-- GUARDIANES
-- =====================================================================
do $$
declare v text;
begin
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'v_horometros_control'
                     and column_name = 'cantidad_labores') then
        raise exception '78 · v_horometros_control quedó sin cantidad_labores.';
    end if;

    -- Las columnas de antes siguen ahí (la pantalla y el SAP las leen).
    select string_agg(c, ', ') into v
    from unnest(array['id','ticket_id','fecha','turno','equipo_codigo','horometro_inicial',
                      'horometro_final','horas_maquina','comparativo','usuario_id',
                      'contador_sap','inicio_contador']) c
    where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'v_horometros_control'
                        and column_name = c);
    if v is not null then
        raise exception '78 · v_horometros_control perdió: %', v;
    end if;

    v := pg_get_viewdef('public.v_horometros_control'::regclass, true);
    if v not like '%fn_permitido_de%' or v not like '%fn_mi_alcance%' or v not like '%auth.uid()%' then
        raise exception '78 · La expuesta perdió la reja.';
    end if;

    if has_schema_privilege('authenticated', 'interno', 'usage')
       or has_table_privilege('authenticated', 'interno.v_horometros_control_crudo', 'select') then
        raise exception '78 · La cruda quedó alcanzable por authenticated.';
    end if;

    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'interno' and c.relname = 'v_horometros_control_crudo'
                     and coalesce(c.reloptions::text, '') ~ 'security_invoker=(off|false)') then
        raise exception '78 · La cruda dejó de ser definer.';
    end if;
end $$;
