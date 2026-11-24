-- =====================================================================
-- 145 · CAMPO · MODO DE PRUEBAS TAMBIÉN EN INYECCIÓN Y MOTORES
-- =====================================================================
-- Pedido del usuario (2026-11-23): «activar el modo de pruebas en los demás submódulos de Campo (Inyección y Motores/
-- combustible), usando la misma pantalla de administración que ya existe para Fertirriego, sin crear pantallas nuevas.»
-- (El registro histórico ya cubre Inyección y Motores desde la 140: aquí no se toca.)
--
-- Base (98): una ESTACIÓN DE PRUEBA «PRUEBA · <nombre>» por estación real (estaciones_riego.prueba_de). Los participantes,
-- mientras el modo está activo, solo operan en ella; ven los turnos y el plan de la real; AGL no ve nada de prueba; Apagar
-- conserva 30 días y Borrar limpia. Ya aislaba solo: la bodega y el diésel de la bodega (144: el diésel es un producto de la
-- bodega de la estación, en fert_saldos/fert_movimientos).
--
-- Qué agrega esta migración
--  (1) INYECCIÓN. El plan (iny_plan) está publicado para la estación REAL (o sin estación). El participante recibe en su
--      teléfono las líneas del plan de su estación real REMAPEADAS a su estación de prueba (igual que 98 hace con los
--      turnos); sin participante en pruebas nada cambia. Las aplicaciones hechas en la estación de prueba quedan en ella
--      (estacion_id = la de prueba; la bodega que rebajan es la de prueba) y el plan que cubren se busca por lote, no por
--      estación, así que «cumplimiento» funciona como en serio. La bajada a AGL (_iny_filas: fn_iny_exportar,
--      fn_iny_confirmar_bajada, fn_iny_purgar_bajadas) EXCLUYE las estaciones de prueba.
--  (2) MOTORES. Diseño elegido (el más simple y seguro): UN MOTOR DE PRÁCTICA por estación de prueba. Se crea al activar el
--      modo (o al correr esta migración si ya hay estaciones de prueba): una fila en `equipos` (codigo PRUEBA-M-<id>,
--      activo=false y visible_app=false: no sale en Tickets ni en reportes de maquinaria; el mismo patrón que ya usa
--      fn_mot_publicar al crear equipos con visible_app=false) y su fila en mot_motores con `prueba_de` = la estación de
--      prueba (modelo «PRÁCTICA», intervalo 500 h). Así el participante practica el flujo completo (Recibir motor →
--      instalar con tanque, recibir diésel a la bodega de prueba, registro diario con suministro, mantenimiento, mover,
--      retirar) y TODOS los contadores (horo_ultimo, visor_ultimo, horas_desde_mant, tanque, saldos) son del motor de
--      práctica: ningún motor ni tanque ni contador REAL se toca. Se descartó «registros de prueba sobre el motor real con
--      contadores aparte» (mot_motores tiene una sola fila de estado por equipo: habría que duplicar la lógica de 10
--      funciones) y «crear equipos de prueba en el catálogo de AGL» (el catálogo es de AGL; aquí son filas internas
--      ocultas, que se borran al purgar y que AGL nunca recibe).
--      Protección: un disparador impide que un motor real entre a una estación de prueba (y al revés) en asignaciones,
--      registros diarios y mantenimientos. El estado del teléfono, en pruebas, no ofrece motores reales (ni sin asignar ni
--      de otras estaciones); a quien no está en pruebas no le ofrece los motores de práctica.
--      AGL: fn_mot_exportar/confirmar/purgar (_mot_filas) excluyen estaciones y motores de prueba; fn_mot_publicar
--      «completo» no desactiva los motores de práctica.
--  (3) PURGA. «Borrar lo de prueba» y el apagado a los 30 días (_fert_pruebas_borrar_todo) borran también, con WHERE y en
--      orden de claves: movimientos y saldos de tanques (libro inalterable: se permite con la marca local
--      mot.libro_permitir, solo dentro de esta función), registros, recepciones, mantenimientos y asignaciones de motores,
--      aplicaciones de Inyección (con su detalle), tanques, motores de práctica y sus filas en `equipos`, y las
--      operaciones asociadas. Lo demás (bodega, custodia, relevos, estaciones) lo borra la 98.
--  (4) Teléfono y pantalla de administración: solo textos y el aviso «MODO PRUEBA» en Inyección y Motores (componente
--      AvisoModoPruebas, el mismo de Fertirriego). Sin pantallas nuevas.
--
-- Qué NO cambia: Fertirriego; permisos (nada de roles escritos aquí: todo sale de fn_fert_puede / fn_fert_en_pruebas);
-- el registro histórico (140); el catálogo de objetivos de Inyección (es compartido).
--
-- Correr DESPUÉS de la 98, 129–144 (necesita 130, 138 y 144). Idempotente (marcas propias «145:» en cada parche).
-- Todo UPDATE/DELETE lleva WHERE.
-- ORDEN DE CORRIDA: si se vuelve a correr la 98 (redefine fn_fert_pruebas_activar y _fert_pruebas_borrar_todo), 129 o 139
-- (fn_iny_estado_campo, _iny_filas), 130, 135 o 138 (fn_mot_estado_campo, _mot_filas, fn_mot_publicar) o la 144 → CORRER LA
-- 145 OTRA VEZ.
-- =====================================================================

do $$
begin
    if to_regprocedure('public._fert_pruebas_borrar_todo()') is null
       or to_regprocedure('public.fn_fert_pruebas_activar(uuid[],uuid[])') is null then
        raise exception '145: falta correr antes la 98 (modo de pruebas).';
    end if;
    if to_regprocedure('public.fn_iny_estado_campo(date)') is null or to_regprocedure('public._iny_filas()') is null then
        raise exception '145: falta correr antes la 129 (Inyección).';
    end if;
    if to_regprocedure('public.fn_mot_estado_campo(date)') is null or to_regprocedure('public._mot_filas(uuid[])') is null then
        raise exception '145: falta correr antes la 130 y la 135 (Motores).';
    end if;
    if position('motor_recibir' in pg_get_functiondef('public.fn_mot_estado_campo(date)'::regprocedure)) = 0 then
        raise exception '145: falta correr antes la 138 (permisos finos de Motores).';
    end if;
    if to_regprocedure('public._fert_es_prueba(uuid)') is null then
        raise exception '145: falta _fert_es_prueba (sql/98).';
    end if;
end $$;


-- ---------------------------------------------------------------- 1 · estructura
alter table public.mot_motores add column if not exists prueba_de uuid references public.estaciones_riego(id) on delete cascade;
comment on column public.mot_motores.prueba_de is
'145: si no es nula, este es el MOTOR DE PRÁCTICA de esa estación de prueba (modo de pruebas de Campo). Nunca se publica a AGL.';
create unique index if not exists mot_motores_prueba_de_key on public.mot_motores (prueba_de) where prueba_de is not null;

/** ¿Este equipo es un motor de práctica? (null = no) */
create or replace function public._mot_es_prueba(p_equipo uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce((select m.prueba_de is not null from public.mot_motores m where m.equipo_id = p_equipo), false)
$$;
revoke execute on function public._mot_es_prueba(uuid) from public, anon, authenticated;

/** Un motor real nunca entra a una estación de prueba, ni uno de práctica a una real. */
create or replace function public._mot_guardia_pruebas()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_p   boolean := public._mot_es_prueba(new.equipo_id);
    v_est uuid[];
begin
    if tg_table_name = 'mot_asignaciones' then
        v_est := array[new.estacion_origen, new.estacion_destino];
    else
        v_est := array[new.estacion_id];
    end if;
    if exists (select 1 from unnest(v_est) s where s is not null and public._fert_es_prueba(s) is distinct from v_p) then
        raise exception 'Un motor real no puede usarse en una estación de prueba (ni uno de práctica en una real).';
    end if;
    return new;
end;
$$;
revoke execute on function public._mot_guardia_pruebas() from public, anon, authenticated;

drop trigger if exists mot_asignaciones_guardia_pruebas on public.mot_asignaciones;
create trigger mot_asignaciones_guardia_pruebas before insert on public.mot_asignaciones
for each row execute function public._mot_guardia_pruebas();
drop trigger if exists mot_registros_guardia_pruebas on public.mot_registros;
create trigger mot_registros_guardia_pruebas before insert on public.mot_registros
for each row execute function public._mot_guardia_pruebas();
drop trigger if exists mot_mantenimientos_guardia_pruebas on public.mot_mantenimientos;
create trigger mot_mantenimientos_guardia_pruebas before insert on public.mot_mantenimientos
for each row execute function public._mot_guardia_pruebas();

/** Crea el motor de práctica de cada estación de prueba que no lo tenga (idempotente). */
create or replace function public._campo_pruebas_preparar()
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    r    record;
    v_eq uuid;
begin
    for r in select e.id, e.nombre from public.estaciones_riego e
              where e.prueba_de is not null
                and not exists (select 1 from public.mot_motores m where m.prueba_de = e.id) loop
        insert into public.equipos (codigo, nombre, visible_app, activo)
        values ('PRUEBA-M-' || substr(r.id::text, 1, 8), 'Motor de práctica · ' || r.nombre, false, false)
        on conflict (codigo) do update set nombre = excluded.nombre
        returning id into v_eq;
        insert into public.mot_motores (equipo_id, modelo, intervalo_horas, aviso_horas, capacidad_tanque_gal, activo, publicado_at, prueba_de)
        values (v_eq, 'PRÁCTICA', 500, 50, 100, true, now(), r.id)
        on conflict (equipo_id) do update set prueba_de = excluded.prueba_de, activo = true;
    end loop;
end;
$$;
revoke execute on function public._campo_pruebas_preparar() from public, anon, authenticated;


-- ---------------------------------------------------------------- 2 · Inyección: el plan de la real, en la de prueba
/** ¿Esta línea del plan es de la estación REAL de la estación de prueba de quien pregunta? (solo en pruebas) */
create or replace function public._iny_plan_de_prueba(p_est uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select p_est is not null and public.fn_fert_en_pruebas()
       and exists (select 1 from public.estaciones_riego e where e.prueba_de = p_est and public.fn_fert_puede(e.id, 'ver'))
$$;
revoke execute on function public._iny_plan_de_prueba(uuid) from public, anon;
grant  execute on function public._iny_plan_de_prueba(uuid) to authenticated;

/** La estación con la que el teléfono ve esa línea del plan: la de prueba de quien está en pruebas; si no, la misma. */
create or replace function public._iny_estacion_para_mi(p_est uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(
        case when p_est is not null and public.fn_fert_en_pruebas()
             then (select e.id from public.estaciones_riego e where e.prueba_de = p_est and public.fn_fert_puede(e.id, 'ver') limit 1) end,
        p_est)
$$;
revoke execute on function public._iny_estacion_para_mi(uuid) from public, anon;
grant  execute on function public._iny_estacion_para_mi(uuid) to authenticated;


-- ---------------------------------------------------------------- 3 · parches (marca propia 145)
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_viejo text := replace(p_viejo, E'\r\n', E'\n');
    v_nuevo text := replace(p_nuevo, E'\r\n', E'\n');
    v_def   text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n     integer;
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_n <> 1 then
        raise exception '145: en % se esperaba 1 aparición de «%» y hay % (¿faltan 98/129/130/135/138/144?)', p_fn, left(v_viejo, 90), v_n;
    end if;
    begin
        execute replace(v_def, v_viejo, v_nuevo);
    exception when others then
        raise exception '145: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- 3a · Inyección en el teléfono: el plan de la real, remapeado a la estación de prueba
select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$where (p.estacion_id is null or public.fn_fert_puede(p.estacion_id, 'ver'))$p$,
    $p$where (p.estacion_id is null or public.fn_fert_puede(p.estacion_id, 'ver') or public._iny_plan_de_prueba(p.estacion_id))$p$,
    $p$public._iny_plan_de_prueba(p.estacion_id)$p$);
select pg_temp.parchar('public.fn_iny_estado_campo(date)',
    $p$'id', p.id, 'estacion_id', p.estacion_id, 'temporada'$p$,
    $p$'id', p.id, 'estacion_id', public._iny_estacion_para_mi(p.estacion_id), 'temporada'$p$,
    $p$public._iny_estacion_para_mi(p.estacion_id)$p$);

-- 3b · bajada a AGL: nada de las estaciones de prueba (la usan exportar, confirmar y purgar)
select pg_temp.parchar('public._iny_filas()',
    $p$cross join lateral (select public._iny_fila(a) as j) f$p$,
    $p$cross join lateral (select public._iny_fila(a) as j) f
     where not public._fert_es_prueba(a.estacion_id)$p$,
    $p$not public._fert_es_prueba(a.estacion_id)$p$);

select pg_temp.parchar('public._mot_filas(uuid[])',
    $p$u.hg, u.b
      from u$p$,
    $p$u.hg, u.b
      from u
     where not public._fert_es_prueba(u.estacion_id) and not public._mot_es_prueba(u.equipo_id)$p$,
    $p$not public._mot_es_prueba(u.equipo_id)$p$);

-- 3c · AGL: la publicación «completa» no desactiva los motores de práctica
select pg_temp.parchar('public.fn_mot_publicar(jsonb)',
    $p$where activo and equipo_id not in (select e.id from public.equipos e where e.codigo = any(v_codigos))$p$,
    $p$where activo and prueba_de is null and equipo_id not in (select e.id from public.equipos e where e.codigo = any(v_codigos))$p$,
    $p$activo and prueba_de is null and equipo_id not in$p$);

-- 3d · Motores en el teléfono: en pruebas solo motores de práctica; fuera de pruebas ninguno
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$or (mo.estacion_id is null and (v_conf or public.fn_tiene_permiso('motores', 'motor_recibir')))$p$,
    $p$or (mo.estacion_id is null and mo.prueba_de is null and not public.fn_fert_en_pruebas()
                                and (v_conf or public.fn_tiene_permiso('motores', 'motor_recibir')))
                            or (mo.estacion_id is null and mo.prueba_de is not null and public.fn_fert_en_pruebas()
                                and public.fn_fert_puede(mo.prueba_de, 'ver'))$p$,
    $p$mo.prueba_de is not null and public.fn_fert_en_pruebas()$p$);
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$and mo.estacion_id is not null and not public.fn_fert_puede(mo.estacion_id, 'ver')$p$,
    $p$and mo.estacion_id is not null and not public.fn_fert_puede(mo.estacion_id, 'ver')
               and mo.prueba_de is null and not public.fn_fert_en_pruebas() /* 145:otras */$p$,
    $p$/* 145:otras */$p$);
select pg_temp.parchar('public.fn_mot_estado_campo(date)',
    $p$and (m.estacion_id is null or public.fn_fert_puede(m.estacion_id, 'ver'))$p$,
    $p$and ((m.estacion_id is null and not public._mot_es_prueba(m.equipo_id))
                            or (m.estacion_id is not null and public.fn_fert_puede(m.estacion_id, 'ver'))
                            or (m.estacion_id is null and public._mot_es_prueba(m.equipo_id) and public.fn_fert_en_pruebas()))$p$,
    $p$public._mot_es_prueba(m.equipo_id) and public.fn_fert_en_pruebas()$p$);

-- 3e · activar el modo crea los motores de práctica; borrar lo de prueba borra también lo de Inyección y Motores
select pg_temp.parchar('public.fn_fert_pruebas_activar(uuid[],uuid[])',
    $p$    insert into public.perfiles_estaciones (perfil_id, estacion_id)$p$,
    $p$    perform public._campo_pruebas_preparar();   -- 145:campo
    insert into public.perfiles_estaciones (perfil_id, estacion_id)$p$,
    '145:campo');
select pg_temp.parchar('public._fert_pruebas_borrar_todo()',
    $p$    v_tras := array(select id from public.fert_traslados$p$,
    $p$    perform public._campo_pruebas_borrar(v_est);   -- 145:campo
    v_tras := array(select id from public.fert_traslados$p$,
    '145:campo');


-- ---------------------------------------------------------------- 4 · purga de lo de Inyección y Motores
/** Borra lo de Inyección y Motores de las estaciones de prueba dadas (la 98 borra después bodega, custodia y estaciones). */
create or replace function public._campo_pruebas_borrar(p_est uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_eq  uuid[] := array(select m.equipo_id from public.mot_motores m where m.prueba_de = any(p_est));
    v_tq  uuid[];
    v_ops uuid[];
begin
    if coalesce(cardinality(p_est), 0) = 0 then
        return;
    end if;
    v_tq := array(select t.id from public.mot_tanques t where t.estacion_id = any(p_est) or t.motor_equipo_id = any(v_eq));
    v_ops := array(
        select r.id from public.mot_registros r where r.estacion_id = any(p_est) or r.equipo_id = any(v_eq)
        union select r.id from public.mot_recepciones r where r.estacion_id = any(p_est)
        union select r.id from public.mot_mantenimientos r where r.estacion_id = any(p_est) or r.equipo_id = any(v_eq)
        union select r.id from public.mot_asignaciones r
               where r.equipo_id = any(v_eq) or r.estacion_origen = any(p_est) or r.estacion_destino = any(p_est)
        union select r.id from public.iny_aplicaciones r where r.estacion_id = any(p_est));

    perform set_config('mot.libro_permitir', 'on', true);   -- el libro de tanques es inalterable; solo aquí se permite
    delete from public.mot_movimientos where tanque_id = any(v_tq);
    delete from public.mot_saldos where tanque_id = any(v_tq);
    delete from public.mot_registros where estacion_id = any(p_est) or equipo_id = any(v_eq);
    delete from public.mot_recepciones where estacion_id = any(p_est);
    delete from public.mot_mantenimientos where estacion_id = any(p_est) or equipo_id = any(v_eq);
    delete from public.mot_asignaciones
     where equipo_id = any(v_eq) or estacion_origen = any(p_est) or estacion_destino = any(p_est);
    delete from public.iny_aplicaciones_detalle
     where aplicacion_id in (select a.id from public.iny_aplicaciones a where a.estacion_id = any(p_est));
    delete from public.iny_aplicaciones where estacion_id = any(p_est);
    delete from public.mot_tanques where id = any(v_tq);
    delete from public.mot_motores where equipo_id = any(v_eq) and prueba_de = any(p_est);
    delete from public.fert_movimientos where operacion_id = any(v_ops) and estacion_id = any(p_est);
    delete from public.fert_operaciones where id = any(v_ops) and (estacion_id is null or estacion_id = any(p_est));
    delete from public.equipos where id = any(v_eq) and codigo like 'PRUEBA-M-%';
    perform set_config('mot.libro_permitir', 'off', true);
end;
$$;
revoke execute on function public._campo_pruebas_borrar(uuid[]) from public, anon, authenticated;


-- ---------------------------------------------------------------- 5 · si el modo ya tiene estaciones de prueba, preparar sus motores
select public._campo_pruebas_preparar();

notify pgrst, 'reload schema';
