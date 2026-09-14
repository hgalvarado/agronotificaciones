-- =====================================================================
-- MIGRACIÓN 33 · Operador sugerido por equipo y horas hombre obligatorias
-- =====================================================================
-- Dos pedidos del módulo de Horómetros:
--
--   A · «Los operadores suelen usar el mismo equipo consecutivamente o
--        por semanas… al seleccionar un Equipo, el sistema debe
--        consultar el último ticket registrado para ese equipo y
--        preseleccionar automáticamente al Operador asociado.»
--
--   B · «Hacer que el campo Horas Hombre sea estrictamente obligatorio.»
-- =====================================================================


-- =====================================================================
-- PARTE A · QUIÉN MANEJÓ ESTE EQUIPO LA ÚLTIMA VEZ
-- =====================================================================
-- La consulta parece trivial y no lo es: `horometros_select` sólo deja
-- al digitador ver los horómetros de SUS tickets. Preguntando desde el
-- navegador, un digitador que hoy toma el tractor que ayer llevó otro
-- compañero no vería nada —justo el caso de rotación que hay que
-- resolver— y la sugerencia fallaría precisamente cuando más sirve.
--
-- Por eso es `security definer`: mira el histórico completo del equipo.
-- Lo que devuelve es deliberadamente mínimo —el operador y la fecha en
-- que lo manejó—, nada del ticket, del lote ni de las horas, así que no
-- abre ninguna puerta a datos de otros.
--
-- No se filtra por temporada ni por rango de fechas a propósito: si un
-- equipo estuvo parado dos meses, la última persona que lo manejó sigue
-- siendo la mejor apuesta, y la pantalla enseña la fecha para que quien
-- captura juzgue si todavía vale.
-- =====================================================================

create or replace function public.fn_ultimo_operador_equipo(p_equipo_id uuid)
returns table (
    operador_id     uuid,
    operador_codigo text,
    operador_nombre text,
    fecha           date
)
language sql stable security definer set search_path = public, pg_temp as $$
    select o.id, o.codigo, o.nombre, h.fecha
    from public.horometros h
    join public.operadores o on o.id = h.operador_id
    where h.equipo_id = p_equipo_id
      and h.operador_id is not null
      and o.activo
    -- `created_at` desempata: en un mismo día puede haber turno diurno y
    -- nocturno, y el bueno es el último que se capturó.
    order by h.fecha desc, h.created_at desc
    limit 1
$$;

comment on function public.fn_ultimo_operador_equipo(uuid) is
    'El operador del último horómetro capturado para ese equipo, con la fecha. Alimenta la sugerencia del formulario; es security definer porque el digitador no ve los horómetros de otros y ahí es justo donde está la rotación.';

grant execute on function public.fn_ultimo_operador_equipo(uuid) to authenticated;

create index if not exists idx_horometros_equipo_fecha
    on public.horometros (equipo_id, fecha desc, created_at desc)
    where operador_id is not null;


-- =====================================================================
-- PARTE B · HORAS HOMBRE, OBLIGATORIAS DE VERDAD
-- =====================================================================
-- Hasta ahora la columna admitía nulo y la pantalla lo trataba como
-- «igual que las horas máquina». El problema es que el costo de mano de
-- obra sale de esta columna: un nulo no vale cero, vale «no se sabe», y
-- en el reporte de costos se suma como cero sin que nadie lo note.
--
-- El orden importa. Primero se rellena lo que ya está cargado —si no, el
-- `set not null` no pasa—, y sólo después se cierra la puerta.
--
-- El relleno usa 8 porque es lo que ya decidieron los importadores del
-- histórico (migraciones 19 y 20: `coalesce(..., 8)`), que es la jornada
-- estándar. Usar aquí otro número dejaría dos verdades distintas para el
-- mismo dato según por dónde hubiera entrado.
-- =====================================================================

update public.horometros
   set horas_hombre = 8
 where horas_hombre is null;

alter table public.horometros
    alter column horas_hombre set not null;

-- Ni negativas ni jornadas imposibles. El tope de 24 no es celo: un dedo
-- de más («80» en vez de «8») multiplica por diez el costo de mano de
-- obra de esa jornada, y eso nadie lo revisa fila por fila.
alter table public.horometros
    drop constraint if exists horometros_horas_hombre_rango;
alter table public.horometros
    add constraint horometros_horas_hombre_rango
    check (horas_hombre > 0 and horas_hombre <= 24);

comment on column public.horometros.horas_hombre is
    'Horas de mano de obra de la jornada. Obligatoria: de aquí sale el costo de personal, y un nulo se sumaría como cero sin que nadie lo note. Entre 0 y 24.';
