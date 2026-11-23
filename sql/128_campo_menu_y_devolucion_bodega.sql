-- =====================================================================
-- 128 · CAMPO · menú «Campo» y DEVOLUCIÓN A BODEGA
-- =====================================================================
-- Bloque 1 de «Campo» (plan docs/superpowers/plans/2026-11-22-campo-bloque1-menu-y-devolucion-a-bodega.md,
-- spec docs/superpowers/specs/2026-11-22-campo-inyeccion-motores-design.md §6.1, §6.2, §6.5).
--
--   PARTE 1 · Pantalla «campo» (módulo «Campo», ruta /campo, en el menú, ícono «plan») con la acción «ver».
--             «Campo · ver» se concede SOLO a los roles que ya ven Fertirriego o AgroMétricas (el menú nunca da
--             permisos; la página lista cada ficha según el permiso propio de la ficha). Si un administrador la
--             quita a un rol, NO se vuelve a conceder al repetir la migración solo si la fila ya existe
--             (permitido = false); una fila borrada sí se vuelve a crear.
--   PARTE 2 · Operación «devolucion_bodega» (teléfono, cola sin señal): salida del inventario de la estación hacia
--             SUMINISTROS, BODEGA o TALLER, con motivo (sugerido «Fin de temporada»).
--             · Tipo de movimiento nuevo DEVOLUCION_BODEGA (cantidad negativa) en el libro.
--             · Tablas fert_devoluciones_bodega y fert_devoluciones_bodega_detalle (RLS como fert_devoluciones;
--               ON DELETE CASCADE desde fert_operaciones para que «Borrar modo de pruebas» (98) no se trabe).
--             · Solo con saldo: devolver más que el disponible se RECHAZA con el saldo en el mensaje (también
--               cuando llega tarde de la cola sin señal; a diferencia de «Aplicar»). Líneas con cantidad 0 o vacía
--               se ignoran; sin ninguna línea → «Indica al menos un producto.».
--             · Se anula con el mismo permiso «Anular» (o el propio registro en su jornada, como las demás);
--               la anulación va por su PROPIA función (_fert_op_anulacion_devolucion_bodega) enrutada desde el
--               despachador, para no depender de un parche sobre _fert_op_anulacion (que la 115 y la 116
--               redefinen completa).
--             · AGL: fn_fert_exportar agrega la lista «devoluciones_bodega» (parche por texto con marca); los
--               movimientos DEVOLUCION_BODEGA ya salen en los movimientos del libro.
--
-- Correr DESPUÉS de la 127 (y de la 116/119/102: parchan las mismas funciones). Idempotente. Todo UPDATE/DELETE
-- lleva WHERE. Si se vuelve a correr la 99 (redefine _fert_procesar), la 100 (redefine fn_fert_exportar), la 102,
-- la 116 o la 119 (parchan _fert_procesar), correr la 128 otra vez. La 115/116 ya NO deshacen nada de la 128.
-- =====================================================================


-- ---------------------------------------------------------------- PARTE 1 · pantalla «Campo»

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones, en_menu, icono, modulo) values
    ('campo', 'Campo',
     'Entrada a las fichas de campo (Fertirriego, AgroMétricas y las que vengan): lista solo las que la persona puede usar. '
     'El menú no da permisos: cada ficha se abre con su propio permiso.',
     '/campo', 120, array['ver'], true, 'plan', 'Campo')
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, ruta = excluded.ruta,
    orden = excluded.orden, acciones = excluded.acciones;

-- Respeta lo que alguien haya cambiado a mano (módulo, ícono); solo llena lo vacío.
update public.pantallas
   set modulo = coalesce(modulo, 'Campo'),
       icono  = coalesce(icono, 'plan'),
       etiquetas_alcance = coalesce(etiquetas_alcance,
           '{"global": "Todas las estaciones", "zonal": "Estaciones de sus zonas", "propietario": "Sus estaciones"}'::jsonb)
 where codigo = 'campo';

-- «Campo · ver» a todo rol que ya vea Fertirriego o AgroMétricas (nadie pierde nada; nadie sin ficha lo recibe)
insert into public.permisos (rol_id, recurso, accion, permitido, alcance)
select distinct pm.rol_id, 'campo', 'ver', true, 'global'::public.alcance_permiso
  from public.permisos pm
 where pm.accion = 'ver' and pm.permitido
   and pm.recurso in ('fertirriego', 'agrometricas')
on conflict (rol_id, recurso, accion) do nothing;


-- ---------------------------------------------------------------- PARTE 2 · devolución a bodega

-- (a) Tipo de movimiento nuevo (se localiza la restricción por su contenido; sirve con cualquier nombre)
do $$
declare
    v_nombre text;
    v_def    text;
begin
    select c.conname, pg_get_constraintdef(c.oid) into v_nombre, v_def
      from pg_constraint c
     where c.conrelid = 'public.fert_movimientos'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%TRASLADO_SALIDA%'
     limit 1;
    if v_nombre is null or v_def not like '%DEVOLUCION_BODEGA%' then
        if v_nombre is not null then
            execute format('alter table public.fert_movimientos drop constraint %I', v_nombre);
        end if;
        alter table public.fert_movimientos add constraint fert_movimientos_tipo_check check (tipo in (
            'SALDO_INICIAL', 'RECEPCION', 'APLICACION', 'DEVOLUCION', 'AJUSTE_CONTEO',
            'DIFERENCIA_RELEVO', 'TRASLADO_SALIDA', 'TRASLADO_ENTRADA', 'TRASLADO_DEVUELTO',
            'ANULACION', 'DEVOLUCION_BODEGA'));
    end if;
end $$;

-- (b) Tablas
/** Salida del inventario de la estación hacia suministros, bodega o taller. */
create table if not exists public.fert_devoluciones_bodega (
    id               uuid primary key references public.fert_operaciones(id) on delete cascade,
    estacion_id      uuid not null references public.estaciones_riego(id),
    fecha_hora       timestamptz not null,
    destino          text not null check (destino in ('SUMINISTROS', 'BODEGA', 'TALLER')),
    motivo           text not null check (btrim(motivo) <> ''),
    registrado_por   uuid not null,
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text
);
comment on table public.fert_devoluciones_bodega is
'128: devolución a bodega (salida de inventario hacia SUMINISTROS, BODEGA o TALLER), con motivo. Movimiento DEVOLUCION_BODEGA (−).';
create index if not exists idx_fert_dev_bodega_estacion on public.fert_devoluciones_bodega (estacion_id, fecha_hora);

create table if not exists public.fert_devoluciones_bodega_detalle (
    devolucion_id uuid not null references public.fert_devoluciones_bodega(id) on delete cascade,
    material_id   uuid not null references public.materiales(id),
    cantidad      numeric(14,4) not null check (cantidad > 0),
    primary key (devolucion_id, material_id)
);

do $$
declare
    t text;
begin
    foreach t in array array['fert_devoluciones_bodega', 'fert_devoluciones_bodega_detalle'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('grant select on public.%I to authenticated', t);
        execute format('drop policy if exists fert_leer on public.%I', t);
    end loop;
end $$;

create policy fert_leer on public.fert_devoluciones_bodega for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.fert_devoluciones_bodega_detalle for select to authenticated
    using (exists (select 1 from public.fert_devoluciones_bodega dv
                   where dv.id = devolucion_id and public.fn_fert_puede(dv.estacion_id, 'ver')));

-- (c) La operación
create or replace function public._fert_op_devolucion_bodega(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_fecha    timestamptz := coalesce(nullif(btrim(coalesce(d->>'fecha_hora', '')), '')::timestamptz, p_creado);
    v_destino  text := upper(nullif(btrim(d->>'destino'), ''));
    v_motivo   text := nullif(btrim(d->>'motivo'), '');
    v_lineas   jsonb;
    v_obs      text[];
    v_saldo    numeric;
    l          record;
begin
    if v_estacion is null or not exists (select 1 from public.estaciones_riego where id = v_estacion) then
        raise exception 'La estación no existe. Actualiza la aplicación.';
    end if;
    if v_destino is null or v_destino not in ('SUMINISTROS', 'BODEGA', 'TALLER') then
        raise exception 'Elige el destino de la devolución: suministros, bodega o taller.';
    end if;
    if v_motivo is null then
        raise exception 'Indica el motivo de la devolución.';
    end if;

    -- Las líneas con cantidad 0 o vacía se ignoran (igual que en el teléfono)
    if d->'lineas' is null or jsonb_typeof(d->'lineas') <> 'array' then
        raise exception 'Indica al menos un producto.';
    end if;
    select coalesce(jsonb_agg(x.value), '[]'::jsonb) into v_lineas
      from jsonb_array_elements(d->'lineas') x
     where not (coalesce(nullif(btrim(x.value->>'cantidad'), ''), '0') ~ '^0*([.,]0*)?$');
    if jsonb_array_length(v_lineas) = 0 then
        raise exception 'Indica al menos un producto.';
    end if;

    v_obs := public._fert_autorizar(v_estacion, 'aplicar', p_creado, p_inmediato, p_en_nombre);

    insert into public.fert_devoluciones_bodega (id, estacion_id, fecha_hora, destino, motivo, registrado_por)
    values (p_id, v_estacion, v_fecha, v_destino, v_motivo, (select auth.uid()));

    for l in select * from public._fert_lineas(v_lineas) loop
        -- Solo con saldo (bloquea la fila para que dos envíos a la vez no pasen los dos)
        select s.disponible into v_saldo from public.fert_saldos s
         where s.estacion_id = v_estacion and s.material_id = l.material_id for update;
        v_saldo := coalesce(v_saldo, 0);
        if l.cantidad > v_saldo then
            raise exception 'No se puede devolver % de %: en la estación solo hay % disponible.',
                l.cantidad, (select coalesce(descripcion, codigo) from public.materiales where id = l.material_id),
                round(v_saldo, 4);
        end if;
        insert into public.fert_devoluciones_bodega_detalle (devolucion_id, material_id, cantidad)
        values (p_id, l.material_id, l.cantidad);
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'DEVOLUCION_BODEGA',
                     -l.cantidad, v_fecha, null, 'devolucion_bodega', p_id, p_inmediato));
    end loop;
    return v_obs;
end;
$$;
revoke execute on function public._fert_op_devolucion_bodega(uuid, jsonb, timestamptz, boolean, uuid) from public, anon, authenticated;

-- Anulación propia (mismas reglas que _fert_op_anulacion: «Anular», o su propio registro en su jornada)
create or replace function public._fert_op_anulacion_devolucion_bodega(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_doc      uuid := public._fert_uuid(d->>'documento_id');
    v_motivo   text := nullif(btrim(d->>'motivo'), '');
    v_estacion uuid;
    v_autor    uuid;
    v_anulado  timestamptz;
    v_registro timestamptz;
    v_custodia public.fert_custodia%rowtype;
    v_obs      text[] := '{}';
    m          record;
begin
    if v_motivo is null then
        raise exception 'Indica el motivo de la anulación.';
    end if;
    select x.estacion_id, x.registrado_por, x.anulado_at into v_estacion, v_autor, v_anulado
      from public.fert_devoluciones_bodega x where x.id = v_doc for update;
    if v_estacion is null then
        raise exception 'El registro a anular no existe.';
    end if;
    if v_anulado is not null then
        raise exception 'Ese registro ya estaba anulado.';
    end if;

    select coalesce(o.creado_en, o.recibido_en) into v_registro from public.fert_operaciones o where o.id = v_doc;

    if not public.fn_fert_puede(v_estacion, 'anular') then
        select * into v_custodia from public.fert_custodia where estacion_id = v_estacion;
        if not (v_autor = (select auth.uid())
                and v_custodia.custodio_id = (select auth.uid())
                and v_custodia.estado = 'ACTIVA'
                and v_custodia.desde <= coalesce(v_registro, now())) then
            raise exception 'Solo puedes anular tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'
                using errcode = '42501';
        end if;
    end if;

    for m in select * from public.fert_movimientos mv
             where mv.documento_id = v_doc and mv.anula_id is null and mv.tipo <> 'ANULACION'
             order by mv.cursor loop
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, m.estacion_id, m.material_id, 'ANULACION',
                     -m.cantidad, p_creado, m.turno_ciclo_id, 'devolucion_bodega', v_doc, p_inmediato, m.id));
    end loop;

    update public.fert_devoluciones_bodega
       set anulado_at = now(), anulado_por = (select auth.uid()), motivo_anulacion = v_motivo
     where id = v_doc;
    return v_obs;
end;
$$;
revoke execute on function public._fert_op_anulacion_devolucion_bodega(uuid, jsonb, timestamptz, boolean) from public, anon, authenticated;

-- (d) Parches por texto (con marca; se pueden repetir). Nunca se reescribe una función entera que otra migración parcha.
create or replace function pg_temp.parchar(p_fn text, p_viejo text, p_nuevo text, p_marca text)
returns void language plpgsql as $$
declare
    v_def text := replace(pg_get_functiondef(p_fn::regprocedure), E'\r\n', E'\n');
    v_n   integer := (length(v_def) - length(replace(v_def, p_viejo, ''))) / length(p_viejo);
begin
    if position(p_marca in v_def) > 0 then
        return;   -- ya estaba parchada (la migración se puede correr otra vez)
    end if;
    if v_n <> 1 then
        raise exception '128: en % se esperaba 1 aparición de «%» y hay %', p_fn, p_viejo, v_n;
    end if;
    begin
        execute replace(v_def, p_viejo, p_nuevo);
    exception when others then
        raise exception '128: falló el parche de % -> % (%)', p_fn, sqlerrm, sqlstate;
    end;
end $$;

-- Despachador: tipo válido (la lista de la 99, con o sin lo que agregó la 116)
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$'conteo', 'devolucion', 'anulacion',$p$,
    $p$'conteo', 'devolucion', 'devolucion_bodega', 'anulacion',$p$,
    $p$'devolucion', 'devolucion_bodega', 'anulacion',$p$);

-- Despachador: a qué función va (la anulación del tipo nuevo tiene la suya)
select pg_temp.parchar('public._fert_procesar(jsonb)',
    $p$        when 'anulacion'          then public._fert_op_anulacion(v_id, v_datos, v_creado, v_inmediato)$p$,
    $p$        when 'devolucion_bodega'  then public._fert_op_devolucion_bodega(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'anulacion'          then case when v_datos->>'documento_tipo' = 'devolucion_bodega'
                                            then public._fert_op_anulacion_devolucion_bodega(v_id, v_datos, v_creado, v_inmediato)
                                            else public._fert_op_anulacion(v_id, v_datos, v_creado, v_inmediato) end$p$,
    $p$_fert_op_devolucion_bodega($p$);

-- AGL: las devoluciones a bodega van en su propia lista (no son aplicaciones ni consumo)
select pg_temp.parchar('public.fn_fert_exportar(bigint, integer)',
    $p$        'rechazados', coalesce(($p$,
    $p$        'devoluciones_bodega', coalesce((   -- 128: salida de inventario hacia suministros, bodega o taller (no es consumo)
            select jsonb_agg(jsonb_build_object(
                'id', d.id, 'estacion', e.nombre, 'zona', z.nombre, 'fecha_hora', d.fecha_hora, 'destino', d.destino,
                'motivo', d.motivo, 'registrado_por', p.nombre,
                'creado_en', o.creado_en, 'recibido_en', o.recibido_en, 'observaciones', to_jsonb(o.observaciones),
                'anulado_at', d.anulado_at, 'motivo_anulacion', d.motivo_anulacion,
                'lineas', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo, 'texto', m.descripcion, 'unidad', m.unidad,
                                        'cantidad', x.cantidad, 'origen', m.origen, 'grupo', m.grupo, 'analisis', m.fert_analisis))
                                    from public.fert_devoluciones_bodega_detalle x join public.materiales m on m.id = x.material_id
                                    where x.devolucion_id = d.id), '[]'::jsonb))
                order by d.fecha_hora)
            from public.fert_devoluciones_bodega d
            join public.estaciones_riego e on e.id = d.estacion_id
            left join public.zonas z on z.id = e.zona_id
            left join public.perfiles p on p.id = d.registrado_por
            left join public.fert_operaciones o on o.id = d.id
            where d.estacion_id = any(v_reales)), '[]'::jsonb),

        'rechazados', coalesce(($p$,
    $p$-- 128: salida de inventario hacia suministros$p$);

notify pgrst, 'reload schema';
