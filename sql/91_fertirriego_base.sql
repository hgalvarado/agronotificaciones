-- =====================================================================
-- MIGRACIÓN 91 · Fertirriego (Etapa A): la bodega de cada estación de riego
-- =====================================================================
-- Diseño aprobado por el usuario (2026-11-11): docs/fertirriego-diseno.md
--
-- Qué crea:
--   1. Lo que publica AGL (dueño de turnos, estaciones, materiales y plan): turnos_ciclo, fert_plan,
--      materiales.unidad / materiales.fertirriego.
--   2. Personas: perfiles_estaciones (quién atiende qué estación), choferes, vehículos.
--   3. Custodia: un solo responsable por estación (fert_custodia) y la bitácora de relevos (fert_relevos).
--      Los relevos con código y los traslados se construyen en la Etapa C; sus tablas ya quedan aquí.
--   4. Documentos de campo: recepciones, aplicaciones (descuentan la bodega al preparar), bitácora de riego
--      (horas; no toca inventario), conteos y devoluciones.
--   5. El libro (fert_movimientos): solo se agrega. Nada se edita ni se borra; un error se corrige anulando.
--      fert_saldos lleva el saldo vivo por estación y material.
--   6. Una sola puerta de escritura desde el teléfono: fn_fert_sincronizar(lote). Cada registro trae su UUID
--      (hecho en el teléfono): enviarlo dos veces no duplica. Funciona para lo capturado sin señal.
--      Regla de oro: un registro del campo NO se pierde. Lo dudoso se acepta y se marca (observaciones);
--      solo se rechaza lo imposible (estación inexistente, sin permiso, cantidades inválidas) o, si el envío
--      es inmediato (con señal), lo que dejaría el saldo negativo o lo hace alguien sin la estación a cargo.
--   7. Llaves para el código de relevo (tipo autenticador, 30 s), verificable sin internet en el teléfono.
--   8. Permisos: pantallas «fertirriego» y «fertirriego_agl» con sus casillas. Ningún nombre de rol:
--      todo sale de la matriz. El alcance «propietario» = solo sus estaciones asignadas; «zonal» = las
--      estaciones de sus zonas; «global» = todas.
--
-- Nadie escribe directo en las tablas (RLS sin políticas de escritura): solo las funciones de esta
-- migración, que validan permiso, estación, custodia y datos.
-- Idempotente. No toca datos existentes salvo agregar dos columnas a materiales.
-- =====================================================================


-- =====================================================================
-- 0 · CONFIGURACIÓN
-- =====================================================================

create table if not exists public.fert_configuracion (
    clave       text primary key,
    valor       jsonb not null,
    descripcion text,
    updated_at  timestamptz not null default now(),
    updated_by  uuid references public.perfiles(id)
);

insert into public.fert_configuracion (clave, valor, descripcion) values
    ('entrega_declarada_chofer', 'false',
     'Opción administrativa (apagada): el chofer también registra cuánto entregó. La bodega se sigue moviendo solo con lo que recibe y aplica el estacionero.'),
    ('tolerancia_plan_pct', '5',
     'Diferencia aceptada entre plan y aplicado (%) para el semáforo de los comparativos.')
on conflict (clave) do nothing;


-- =====================================================================
-- 1 · LO QUE PUBLICA AGL
-- =====================================================================

alter table public.materiales
    add column if not exists unidad      text,
    add column if not exists fertirriego boolean not null default false;

comment on column public.materiales.unidad is 'Unidad de medida base (UMB de MARA en AGL): L, KG…';
comment on column public.materiales.fertirriego is 'Lo publicó AGL para Fertirriego (fertilizantes, soluciones, ácidos).';

/** Un turno en una temporada y ciclo (registro de /TR02 en AGL). */
create table if not exists public.turnos_ciclo (
    id            uuid primary key default gen_random_uuid(),
    agl_id        text not null unique,                    -- id_transaccion de AGL (TR-…)
    turno_id      uuid not null references public.turnos(id),
    temporada     text not null,
    ciclo         text,
    fecha_siembra date,
    estacion_id   uuid references public.estaciones_riego(id),
    zona_id       uuid references public.zonas(id),
    orden_sap     text,
    plan          text,
    tipo_plan     text,
    area_mz       numeric(12,4),
    estado        text,
    activo        boolean not null default true,
    publicado_at  timestamptz not null default now()
);

create index if not exists idx_turnos_ciclo_estacion on public.turnos_ciclo (estacion_id) where activo;
create index if not exists idx_turnos_ciclo_temporada on public.turnos_ciclo (temporada, ciclo);

/** Plan asignado: cantidad de producto terminado por turno y día (fecha = siembra + DDT). */
create table if not exists public.fert_plan (
    id             bigint generated always as identity primary key,
    turno_ciclo_id uuid not null references public.turnos_ciclo(id) on delete cascade,
    fecha          date not null,
    ddt            integer not null,
    material_id    uuid not null references public.materiales(id),
    cantidad       numeric(14,4) not null,
    unidad         text,
    dosis_mz       numeric(14,4),
    horas_riego    numeric(8,2),
    volumen_m3     numeric(12,2)
);

create index if not exists idx_fert_plan_turno_fecha on public.fert_plan (turno_ciclo_id, fecha);

/** Bitácora de cada publicación de AGL. */
create table if not exists public.fert_publicaciones (
    id          bigint generated always as identity primary key,
    temporada   text,
    publicado_por uuid,
    publicado_at timestamptz not null default now(),
    conteos     jsonb,
    avisos      text[] not null default '{}'
);


-- =====================================================================
-- 2 · PERSONAS
-- =====================================================================

create table if not exists public.perfiles_estaciones (
    perfil_id   uuid not null references public.perfiles(id) on delete cascade,
    estacion_id uuid not null references public.estaciones_riego(id) on delete cascade,
    created_at  timestamptz not null default now(),
    created_by  uuid,
    primary key (perfil_id, estacion_id)
);

create index if not exists idx_perfiles_estaciones_estacion on public.perfiles_estaciones (estacion_id);

create table if not exists public.fert_choferes (
    id         uuid primary key,
    nombre     text not null check (btrim(nombre) <> ''),
    identidad  text,
    telefono   text,
    validado   boolean not null default false,   -- creado en campo: queda «por validar»
    activo     boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid
);

create table if not exists public.fert_vehiculos (
    id         uuid primary key,
    placa      text not null check (btrim(placa) <> ''),
    tipo       text,
    marca      text,
    color      text,
    validado   boolean not null default false,
    activo     boolean not null default true,
    created_at timestamptz not null default now(),
    created_by uuid
);

/** Un chofer puede venir en uno u otro camión: se aprende de cada recepción. */
create table if not exists public.fert_choferes_vehiculos (
    chofer_id   uuid not null references public.fert_choferes(id) on delete cascade,
    vehiculo_id uuid not null references public.fert_vehiculos(id) on delete cascade,
    ultima_vez  timestamptz not null default now(),
    primary key (chofer_id, vehiculo_id)
);


-- =====================================================================
-- 3 · LLAVES DEL CÓDIGO DE RELEVO (tipo autenticador)
-- =====================================================================
-- Una llave secreta por persona. Nadie la lee de la tabla (RLS sin políticas): solo
-- fn_fert_mis_llaves() la entrega a los compañeros de SUS estaciones, para que el teléfono verifique
-- el código sin internet, igual que el servidor de un banco verifica el token.

create table if not exists public.fert_llaves (
    perfil_id uuid primary key references public.perfiles(id) on delete cascade,
    secreto   bytea not null,
    creada_at timestamptz not null default now()
);


-- =====================================================================
-- 4 · OPERACIONES (el sobre de cada registro que manda el teléfono)
-- =====================================================================

create table if not exists public.fert_operaciones (
    id            uuid primary key,                       -- lo genera el teléfono
    tipo          text not null,
    estacion_id   uuid,
    perfil_id     uuid not null,                          -- quien inició sesión y lo grabó
    en_nombre_de  uuid,                                   -- si un jefe registró por otra persona
    dispositivo   text,
    creado_en     timestamptz,                            -- hora del teléfono al guardar
    enviado_en    timestamptz,                            -- hora del teléfono al enviar
    recibido_en   timestamptz not null default now(),     -- hora del servidor
    inmediato     boolean not null default false,         -- se envió en el momento (con señal)
    lat           double precision,
    lon           double precision,
    precision_m   double precision,
    datos         jsonb not null default '{}'::jsonb,
    resultado     text not null check (resultado in ('ACEPTADO', 'ACEPTADO_CON_OBSERVACIONES', 'RECHAZADO')),
    mensaje       text,
    observaciones text[] not null default '{}'
);

create index if not exists idx_fert_operaciones_perfil on public.fert_operaciones (perfil_id, recibido_en desc);
create index if not exists idx_fert_operaciones_estacion on public.fert_operaciones (estacion_id, recibido_en desc);

comment on column public.fert_operaciones.observaciones is
'Marcas para revisar: SIN_UBICACION, RELOJ, FUERA_DE_CUSTODIA, SALDO_NEGATIVO, FUERA_DE_PLAN, OTRA_ESTACION.';


-- =====================================================================
-- 5 · CUSTODIA Y RELEVOS
-- =====================================================================

create table if not exists public.fert_custodia (
    estacion_id uuid primary key references public.estaciones_riego(id),
    custodio_id uuid references public.perfiles(id),
    estado      text not null check (estado in ('ACTIVA', 'EN_ENTREGA')),
    desde       timestamptz not null,
    relevo_id   uuid,
    updated_at  timestamptz not null default now()
);

create table if not exists public.fert_relevos (
    id                 uuid primary key,
    estacion_id        uuid not null references public.estaciones_riego(id),
    metodo             text not null check (metodo in ('CODIGO', 'SESION', 'ASIGNACION')),
    estado             text not null check (estado in ('EN_ENTREGA', 'RECIBIDO', 'RECHAZADO', 'CANCELADO', 'ASIGNADO')),
    entrega_id         uuid references public.perfiles(id),
    recibe_id          uuid references public.perfiles(id),
    entregado_at       timestamptz,
    recibido_at        timestamptz,
    codigo_verificado  boolean,
    novedades          jsonb not null default '[]'::jsonb,   -- [{turno_ciclo_id, estado, nota}]
    nota_entrega       text,
    nota_recibe        text,
    motivo             text,
    revisar            boolean not null default false,
    registrado_por     uuid not null,
    created_at         timestamptz not null default now()
);

create index if not exists idx_fert_relevos_estacion on public.fert_relevos (estacion_id, recibido_at desc);

create table if not exists public.fert_relevos_diferencias (
    relevo_id      uuid not null references public.fert_relevos(id) on delete cascade,
    material_id    uuid not null references public.materiales(id),
    saldo_sistema  numeric(14,4) not null,
    cantidad_real  numeric(14,4) not null,
    diferencia     numeric(14,4) not null,
    primary key (relevo_id, material_id)
);


-- =====================================================================
-- 6 · DOCUMENTOS DE CAMPO (el id de cada documento = el id de su operación)
-- =====================================================================

create table if not exists public.fert_recepciones (
    id               uuid primary key references public.fert_operaciones(id),
    estacion_id      uuid not null references public.estaciones_riego(id),
    fecha_hora       timestamptz not null,
    chofer_id        uuid not null references public.fert_choferes(id),
    vehiculo_id      uuid references public.fert_vehiculos(id),
    lugar            text,
    documento        text,
    comentario       text,
    registrado_por   uuid not null,
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text
);

create table if not exists public.fert_recepciones_detalle (
    recepcion_id uuid not null references public.fert_recepciones(id),
    material_id  uuid not null references public.materiales(id),
    cantidad     numeric(14,4) not null check (cantidad > 0),
    primary key (recepcion_id, material_id)
);

/** Preparación/aplicación de un turno: descuenta la bodega cuando el producto sale al tanque. */
create table if not exists public.fert_aplicaciones (
    id               uuid primary key references public.fert_operaciones(id),
    estacion_id      uuid not null references public.estaciones_riego(id),
    turno_ciclo_id   uuid not null references public.turnos_ciclo(id),
    fecha            date not null,
    fecha_hora       timestamptz not null,
    ejecutor_id      uuid references public.perfiles(id),
    ejecutor2_id     uuid references public.perfiles(id),
    comentario       text,
    registrado_por   uuid not null,
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text
);

create index if not exists idx_fert_aplicaciones_turno on public.fert_aplicaciones (turno_ciclo_id, fecha);
create index if not exists idx_fert_aplicaciones_estacion on public.fert_aplicaciones (estacion_id, fecha desc);

create table if not exists public.fert_aplicaciones_detalle (
    aplicacion_id uuid not null references public.fert_aplicaciones(id),
    material_id   uuid not null references public.materiales(id),
    cantidad      numeric(14,4) not null check (cantidad > 0),
    en_plan       boolean not null,
    primary key (aplicacion_id, material_id)
);

/** Bitácora de riego por turno y día: horas. NO toca el inventario; se completa después. */
create table if not exists public.fert_bitacora_riego (
    turno_ciclo_id       uuid not null references public.turnos_ciclo(id),
    fecha                date not null,
    estacion_id          uuid not null references public.estaciones_riego(id),
    horas_fertilizacion  numeric(5,2),
    horas_riego          numeric(5,2),
    hora_inicio          timestamptz,
    hora_fin             timestamptz,
    ejecutor_id          uuid references public.perfiles(id),
    ejecutor2_id         uuid references public.perfiles(id),
    comentario           text,
    operacion_id         uuid not null references public.fert_operaciones(id),   -- la última que la cambió
    updated_at           timestamptz not null default now(),
    updated_by           uuid not null,
    primary key (turno_ciclo_id, fecha)
);

create table if not exists public.fert_conteos (
    id               uuid primary key references public.fert_operaciones(id),
    estacion_id      uuid not null references public.estaciones_riego(id),
    fecha_hora       timestamptz not null,
    comentario       text,
    registrado_por   uuid not null,
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text
);

create table if not exists public.fert_conteos_detalle (
    conteo_id      uuid not null references public.fert_conteos(id),
    material_id    uuid not null references public.materiales(id),
    saldo_sistema  numeric(14,4) not null,
    cantidad_real  numeric(14,4) not null check (cantidad_real >= 0),
    diferencia     numeric(14,4) not null,
    primary key (conteo_id, material_id)
);

/** Sobrante de una aplicación que vuelve a la bodega (excepción, con motivo). */
create table if not exists public.fert_devoluciones (
    id               uuid primary key references public.fert_operaciones(id),
    aplicacion_id    uuid not null references public.fert_aplicaciones(id),
    estacion_id      uuid not null references public.estaciones_riego(id),
    fecha_hora       timestamptz not null,
    motivo           text not null check (btrim(motivo) <> ''),
    registrado_por   uuid not null,
    anulado_at       timestamptz,
    anulado_por      uuid,
    motivo_anulacion text
);

create table if not exists public.fert_devoluciones_detalle (
    devolucion_id uuid not null references public.fert_devoluciones(id),
    material_id   uuid not null references public.materiales(id),
    cantidad      numeric(14,4) not null check (cantidad > 0),
    primary key (devolucion_id, material_id)
);

/** Traslados entre estaciones (las funciones llegan en la Etapa C). */
create table if not exists public.fert_traslados (
    id              uuid primary key,
    origen_id       uuid not null references public.estaciones_riego(id),
    destino_id      uuid not null references public.estaciones_riego(id),
    estado          text not null check (estado in ('POR_AUTORIZAR', 'EN_TRANSITO', 'ACEPTADO', 'RECHAZADO', 'ANULADO')),
    motivo          text not null check (btrim(motivo) <> ''),
    autorizador_id  uuid references public.perfiles(id),
    autorizado_at   timestamptz,
    creado_por      uuid not null,
    creado_at       timestamptz not null,
    resuelto_por    uuid,
    resuelto_at     timestamptz,
    nota_resolucion text,
    check (origen_id <> destino_id)
);

create table if not exists public.fert_traslados_detalle (
    traslado_id       uuid not null references public.fert_traslados(id),
    material_id       uuid not null references public.materiales(id),
    cantidad_enviada  numeric(14,4) not null check (cantidad_enviada > 0),
    cantidad_recibida numeric(14,4),
    primary key (traslado_id, material_id)
);


-- =====================================================================
-- 7 · EL LIBRO Y LOS SALDOS
-- =====================================================================

create table if not exists public.fert_movimientos (
    id             uuid primary key default gen_random_uuid(),
    cursor         bigint generated always as identity unique,   -- AGL baja «lo posterior a mi cursor»
    operacion_id   uuid not null references public.fert_operaciones(id),
    estacion_id    uuid not null references public.estaciones_riego(id),
    material_id    uuid not null references public.materiales(id),
    tipo           text not null check (tipo in (
                       'SALDO_INICIAL', 'RECEPCION', 'APLICACION', 'DEVOLUCION', 'AJUSTE_CONTEO',
                       'DIFERENCIA_RELEVO', 'TRASLADO_SALIDA', 'TRASLADO_ENTRADA', 'TRASLADO_DEVUELTO',
                       'ANULACION')),
    cantidad       numeric(14,4) not null check (cantidad <> 0),  -- con signo: + entra, − sale
    fecha_hora     timestamptz not null,                          -- cuándo pasó (hora del teléfono)
    turno_ciclo_id uuid references public.turnos_ciclo(id),
    documento_tipo text not null,
    documento_id   uuid not null,
    anula_id       uuid references public.fert_movimientos(id),
    registrado_por uuid not null,
    created_at     timestamptz not null default now()
);

create index if not exists idx_fert_mov_estacion_material on public.fert_movimientos (estacion_id, material_id, fecha_hora);
create index if not exists idx_fert_mov_documento on public.fert_movimientos (documento_id);
create index if not exists idx_fert_mov_turno on public.fert_movimientos (turno_ciclo_id) where turno_ciclo_id is not null;
create unique index if not exists uq_fert_mov_anulado_una_vez on public.fert_movimientos (anula_id) where anula_id is not null;

create table if not exists public.fert_saldos (
    estacion_id uuid not null references public.estaciones_riego(id),
    material_id uuid not null references public.materiales(id),
    disponible  numeric(14,4) not null default 0,
    en_transito numeric(14,4) not null default 0,   -- enviado en traslado, aún no aceptado (Etapa C)
    updated_at  timestamptz not null default now(),
    primary key (estacion_id, material_id)
);

/** Kardex con saldo acumulado. Filtrar por estación (y material) antes de mirar fechas. */
create or replace view public.v_fert_kardex with (security_invoker = true) as
select
    m.id, m.cursor, m.estacion_id, m.material_id, m.tipo, m.cantidad, m.fecha_hora, m.turno_ciclo_id,
    m.documento_tipo, m.documento_id, m.anula_id, m.registrado_por, m.created_at,
    sum(m.cantidad) over (partition by m.estacion_id, m.material_id
                          order by m.fecha_hora, m.cursor
                          rows unbounded preceding) as saldo
from public.fert_movimientos m;


-- =====================================================================
-- 8 · PERMISOS: CASILLAS Y PANTALLAS
-- =====================================================================

insert into public.acciones (codigo, nombre, descripcion, orden, escribe) values
    ('recibir', 'Recibir', 'Fertirriego: registra el producto que entra a la bodega de la estación.', 110, true),
    ('aplicar', 'Aplicar', 'Fertirriego: registra lo que se prepara/aplica a cada turno (descuenta la bodega) y la bitácora de riego.', 111, true),
    ('contar', 'Contar', 'Fertirriego: conteo físico de la bodega (saldo inicial y ajustes).', 112, true),
    ('relevo', 'Relevo', 'Fertirriego: entregar y recibir la estación (cambio de jornada).', 113, true),
    ('trasladar', 'Trasladar', 'Fertirriego: enviar producto a otra estación y aceptar o rechazar lo que llega.', 114, true),
    ('autorizar_traslado', 'Autorizar traslado', 'Fertirriego: aprueba los traslados entre estaciones.', 115, true),
    ('anular', 'Anular', 'Fertirriego: anula registros de otros o ya fuera de su jornada (siempre con motivo; el original queda visible).', 116, true),
    ('en_nombre_de', 'Registrar por otro', 'Fertirriego: registra en nombre de un estacionero (quien no tiene teléfono). Queda anotado quién lo hizo.', 117, true),
    ('administrar_estaciones', 'Administrar estaciones', 'Fertirriego: asigna personas a las estaciones y la custodia cuando nadie la recibe.', 118, true),
    ('gestionar_choferes', 'Gestionar choferes', 'Fertirriego: corrige y valida choferes y vehículos.', 119, true),
    ('configurar', 'Configurar', 'Fertirriego: opciones administrativas (por ejemplo, entrega declarada por el chofer).', 120, true),
    ('publicar', 'Publicar', 'Conexión AGL: publica turnos, estaciones, materiales y plan desde AGL.', 121, true)
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden, escribe = excluded.escribe;

insert into public.pantallas (codigo, nombre, descripcion, ruta, orden, acciones) values
    ('fertirriego', 'Fertirriego · Estaciones',
     'Bodega de cada estación de riego: recepciones, aplicaciones por turno, conteos, relevos y traslados. Alcance «propietario» = sus estaciones asignadas; «zonal» = las de sus zonas.',
     '/fertirriego', 120,
     array['ver','exportar','recibir','aplicar','contar','relevo','trasladar','autorizar_traslado','anular',
           'en_nombre_de','administrar_estaciones','gestionar_choferes','configurar']),
    ('fertirriego_agl', 'Fertirriego · Conexión AGL',
     'Para el usuario técnico de AGL: publica turnos, estaciones, materiales y plan, y baja los movimientos.',
     null, 121,
     array['ver','publicar'])
on conflict (codigo) do update
set nombre = excluded.nombre, descripcion = excluded.descripcion, ruta = excluded.ruta,
    orden = excluded.orden, acciones = excluded.acciones;


-- =====================================================================
-- 9 · FUNCIONES DE APOYO
-- =====================================================================

/** ¿Puede hacer ESTA acción en ESTA estación? Alcance: global, zonal (sus zonas o asignada) o solo asignadas. */
create or replace function public.fn_fert_puede(p_estacion uuid, p_accion text default 'ver')
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
    select case
        when public.fn_es_admin() then true
        when not public.fn_tiene_permiso('fertirriego', p_accion) then false
        else case public.fn_mi_alcance('fertirriego', p_accion)
            when 'global' then true
            when 'zonal' then
                exists (select 1 from public.estaciones_riego e
                        where e.id = p_estacion and e.zona_id is not null and public.fn_ve_zona_estricta(e.zona_id))
                or exists (select 1 from public.perfiles_estaciones pe
                           where pe.estacion_id = p_estacion and pe.perfil_id = (select auth.uid()))
            else
                exists (select 1 from public.perfiles_estaciones pe
                        where pe.estacion_id = p_estacion and pe.perfil_id = (select auth.uid()))
        end
    end
$$;

grant execute on function public.fn_fert_puede(uuid, text) to authenticated;

/** Texto a UUID sin romper (null si no es válido). */
create or replace function public._fert_uuid(p text)
returns uuid
language plpgsql immutable as $$
begin
    return nullif(btrim(p), '')::uuid;
exception when others then
    return null;
end;
$$;

/** Cantidad válida (> 0 y razonable) o error claro. */
create or replace function public._fert_cantidad(p text, p_etiqueta text default 'Cantidad')
returns numeric
language plpgsql immutable as $$
declare
    v numeric;
begin
    begin
        v := replace(btrim(p), ',', '')::numeric;
    exception when others then
        raise exception '«%» no es un número válido: %', p_etiqueta, coalesce(p, '(vacío)');
    end;
    if v is null or v <= 0 then
        raise exception '«%» debe ser mayor que cero.', p_etiqueta;
    end if;
    if v > 1000000 then
        raise exception '«%» es demasiado grande (%). Revisa la unidad.', p_etiqueta, v;
    end if;
    return round(v, 4);
end;
$$;

/** Quién tenía la estación a cargo en un momento (según la bitácora de relevos y asignaciones). */
create or replace function public._fert_custodio_en(p_estacion uuid, p_momento timestamptz)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
    with g as (
        select r.recibe_id, r.recibido_at
        from public.fert_relevos r
        where r.estacion_id = p_estacion
          and r.estado in ('RECIBIDO', 'ASIGNADO')
          and r.recibido_at <= p_momento
        order by r.recibido_at desc
        limit 1
    )
    select case
        when exists (
            -- la entregó después de recibirla y antes de ese momento: ya no la tenía
            select 1 from public.fert_relevos r
            where r.estacion_id = p_estacion
              and r.entrega_id = g.recibe_id
              and r.estado in ('EN_ENTREGA', 'RECIBIDO', 'ASIGNADO')
              and r.entregado_at > g.recibido_at
              and r.entregado_at <= p_momento
        ) then null
        else g.recibe_id
    end
    from g
$$;

/** Saldo de un material en una estación hasta un momento (para conteos hechos sin señal). */
create or replace function public._fert_saldo_en(p_estacion uuid, p_material uuid, p_momento timestamptz)
returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
    select coalesce(sum(m.cantidad), 0)
    from public.fert_movimientos m
    where m.estacion_id = p_estacion and m.material_id = p_material and m.fecha_hora <= p_momento
$$;

/**
 * Permiso + estación + custodia para registrar. Devuelve las observaciones (o rechaza).
 * Con «en nombre de» (jefe/parametrista) no se exige la custodia: queda anotado quién lo hizo.
 */
create or replace function public._fert_autorizar(
    p_estacion uuid, p_accion text, p_momento timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
    if p_estacion is null or not exists (select 1 from public.estaciones_riego where id = p_estacion) then
        raise exception 'La estación no existe. Actualiza la aplicación.';
    end if;

    if not public.fn_fert_puede(p_estacion, p_accion) then
        raise exception 'Tu rol no tiene «%» en Fertirriego para esta estación. Se configura en Permisos.',
            (select nombre from public.acciones where codigo = p_accion)
            using errcode = '42501';
    end if;

    if p_en_nombre is not null then
        if not public.fn_fert_puede(p_estacion, 'en_nombre_de') then
            raise exception 'Tu rol no tiene «Registrar por otro» en esta estación.' using errcode = '42501';
        end if;
        if not exists (select 1 from public.perfiles where id = p_en_nombre) then
            raise exception 'La persona por la que registras no existe.';
        end if;
        return '{}';
    end if;

    if public._fert_custodio_en(p_estacion, p_momento) is distinct from (select auth.uid()) then
        if p_inmediato then
            raise exception 'La estación no está a tu cargo. Recíbela primero (relevo) o pide al jefe que te la asigne.'
                using errcode = '42501';
        end if;
        return array['FUERA_DE_CUSTODIA'];
    end if;
    return '{}';
end;
$$;

/**
 * Asienta un movimiento y actualiza el saldo vivo (con bloqueo por estación y material).
 * Saldo negativo: rechaza si el envío es inmediato; si llegó tarde (sin señal), lo marca.
 */
create or replace function public._fert_mover(
    p_operacion uuid, p_estacion uuid, p_material uuid, p_tipo text, p_cantidad numeric,
    p_fecha_hora timestamptz, p_turno uuid, p_doc_tipo text, p_doc_id uuid, p_inmediato boolean,
    p_anula uuid default null
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_saldo numeric;
begin
    if p_cantidad = 0 then
        return '{}';
    end if;

    insert into public.fert_movimientos
        (operacion_id, estacion_id, material_id, tipo, cantidad, fecha_hora, turno_ciclo_id,
         documento_tipo, documento_id, anula_id, registrado_por)
    values
        (p_operacion, p_estacion, p_material, p_tipo, p_cantidad, p_fecha_hora, p_turno,
         p_doc_tipo, p_doc_id, p_anula, (select auth.uid()));

    insert into public.fert_saldos as s (estacion_id, material_id, disponible)
    values (p_estacion, p_material, p_cantidad)
    on conflict (estacion_id, material_id)
    do update set disponible = s.disponible + excluded.disponible, updated_at = now()
    returning s.disponible into v_saldo;

    if v_saldo < 0 then
        if p_inmediato then
            raise exception 'No alcanza el saldo de % en la bodega: quedaría en %.',
                (select coalesce(descripcion, codigo) from public.materiales where id = p_material),
                round(v_saldo, 2);
        end if;
        return array['SALDO_NEGATIVO'];
    end if;
    return '{}';
end;
$$;

/** Líneas [{material_id, cantidad}] validadas: material existente, sin repetir, cantidad > 0. */
create or replace function public._fert_lineas(p_lineas jsonb, p_campo text default 'cantidad')
returns table (material_id uuid, cantidad numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
    v_linea jsonb;
    v_mat   uuid;
    v_vistos uuid[] := '{}';
begin
    if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
        raise exception 'Agrega al menos un producto.';
    end if;
    for v_linea in select value from jsonb_array_elements(p_lineas) loop
        v_mat := public._fert_uuid(v_linea->>'material_id');
        if v_mat is null or not exists (select 1 from public.materiales m where m.id = v_mat) then
            raise exception 'Un producto no existe en el catálogo. Actualiza la aplicación.';
        end if;
        if v_mat = any(v_vistos) then
            raise exception 'El producto % está repetido: súmalo en una sola línea.',
                (select coalesce(m.descripcion, m.codigo) from public.materiales m where m.id = v_mat);
        end if;
        v_vistos := v_vistos || v_mat;
        material_id := v_mat;
        cantidad := public._fert_cantidad(v_linea->>p_campo,
                        (select coalesce(m.descripcion, m.codigo) from public.materiales m where m.id = v_mat));
        return next;
    end loop;
end;
$$;

/** Llave tolerante para cruzar nombres entre AGL y aquí: «Zona-1» = «Zona 1» = «zona_1». */
create or replace function public._fert_llave(p text)
returns text
language sql immutable as $$
    select nullif(regexp_replace(lower(btrim(coalesce(p, ''))), '[\s\-_]+', '', 'g'), '')
$$;

/** Junta observaciones sin repetir. */
create or replace function public._fert_obs(a text[], b text[])
returns text[]
language sql immutable as $$
    select coalesce(array_agg(distinct x order by x), '{}') from unnest(coalesce(a, '{}') || coalesce(b, '{}')) x
$$;


-- =====================================================================
-- 10 · CÓDIGO DE RELEVO (TOTP, RFC 6238: SHA-1, 30 s, 6 dígitos)
-- =====================================================================

create or replace function public.fn_fert_totp(p_secreto bytea, p_paso bigint)
returns text
language plpgsql immutable set search_path = public, extensions, pg_temp as $$
declare
    h bytea;
    o integer;
    v bigint;
begin
    h := extensions.hmac(int8send(p_paso), p_secreto, 'sha1');
    o := get_byte(h, 19) & 15;
    v := ((get_byte(h, o) & 127)::bigint << 24)
       | (get_byte(h, o + 1)::bigint << 16)
       | (get_byte(h, o + 2)::bigint << 8)
       |  get_byte(h, o + 3)::bigint;
    return lpad((v % 1000000)::text, 6, '0');
end;
$$;

/** Verificación en la base (segunda revisión al sincronizar el relevo; Etapa C). No se expone. */
create or replace function public.fn_fert_totp_valido(
    p_perfil uuid, p_codigo text, p_momento timestamptz, p_ventanas integer default 1
) returns boolean
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
    v_secreto bytea;
    v_paso    bigint := floor(extract(epoch from p_momento) / 30)::bigint;
    i         integer;
begin
    select secreto into v_secreto from public.fert_llaves where perfil_id = p_perfil;
    if v_secreto is null or p_codigo !~ '^\d{6}$' then
        return false;
    end if;
    for i in -p_ventanas .. p_ventanas loop
        if public.fn_fert_totp(v_secreto, v_paso + i) = p_codigo then
            return true;
        end if;
    end loop;
    return false;
end;
$$;

revoke all on function public.fn_fert_totp_valido(uuid, text, timestamptz, integer) from public;

/** Toda persona asignada a una estación tiene su llave. */
create or replace function public.fn_fert_crear_llave()
returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
    insert into public.fert_llaves (perfil_id, secreto)
    values (new.perfil_id, extensions.gen_random_bytes(20))
    on conflict (perfil_id) do nothing;
    return new;
end;
$$;

drop trigger if exists trg_fert_crear_llave on public.perfiles_estaciones;
create trigger trg_fert_crear_llave
    after insert on public.perfiles_estaciones
    for each row execute function public.fn_fert_crear_llave();

/**
 * Las llaves que el teléfono necesita sin internet: la propia (para mostrar su código al entregar) y la
 * de los compañeros de sus estaciones (para verificar el código de quien le entrega).
 */
create or replace function public.fn_fert_mis_llaves()
returns table (perfil_id uuid, nombre text, secreto text)
language sql stable security definer set search_path = public, pg_temp as $$
    select p.id, p.nombre, encode(l.secreto, 'base64')
    from public.fert_llaves l
    join public.perfiles p on p.id = l.perfil_id
    where (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'relevo'))
      and (
          l.perfil_id = (select auth.uid())
          or exists (
              select 1
              from public.perfiles_estaciones a
              join public.perfiles_estaciones b on b.estacion_id = a.estacion_id
              where a.perfil_id = (select auth.uid()) and b.perfil_id = l.perfil_id
          )
      )
$$;

grant execute on function public.fn_fert_mis_llaves() to authenticated;


-- =====================================================================
-- 11 · LOS REGISTROS DEL CAMPO (uno por tipo)
-- =====================================================================

-- ---------- Recepción ----------
create or replace function public._fert_op_recepcion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_chofer   uuid := public._fert_uuid(d->>'chofer_id');
    v_vehiculo uuid := public._fert_uuid(d->>'vehiculo_id');
    v_fecha    timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_obs      text[];
    l          record;
begin
    v_obs := public._fert_autorizar(v_estacion, 'recibir', v_fecha, p_inmediato, p_en_nombre);

    if v_chofer is null or not exists (select 1 from public.fert_choferes where id = v_chofer) then
        raise exception 'Indica quién entregó (chofer).';
    end if;
    if v_vehiculo is not null and not exists (select 1 from public.fert_vehiculos where id = v_vehiculo) then
        raise exception 'El vehículo no existe. Actualiza la aplicación.';
    end if;
    if v_fecha > p_creado + interval '5 minutes' then
        raise exception 'La fecha y hora de la recepción no puede ser posterior al momento en que se registra.';
    end if;

    insert into public.fert_recepciones
        (id, estacion_id, fecha_hora, chofer_id, vehiculo_id, lugar, documento, comentario, registrado_por)
    values
        (p_id, v_estacion, v_fecha, v_chofer, v_vehiculo, nullif(btrim(d->>'lugar'), ''),
         nullif(btrim(d->>'documento'), ''), nullif(btrim(d->>'comentario'), ''), (select auth.uid()));

    for l in select * from public._fert_lineas(d->'lineas') loop
        insert into public.fert_recepciones_detalle (recepcion_id, material_id, cantidad)
        values (p_id, l.material_id, l.cantidad);
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'RECEPCION',
                     l.cantidad, v_fecha, null, 'recepcion', p_id, p_inmediato));
    end loop;

    if v_vehiculo is not null then
        insert into public.fert_choferes_vehiculos (chofer_id, vehiculo_id, ultima_vez)
        values (v_chofer, v_vehiculo, v_fecha)
        on conflict (chofer_id, vehiculo_id) do update set ultima_vez = greatest(fert_choferes_vehiculos.ultima_vez, excluded.ultima_vez);
    end if;
    return v_obs;
end;
$$;

-- ---------- Aplicación (preparación del turno: descuenta la bodega) ----------
create or replace function public._fert_op_aplicacion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_turno    uuid := public._fert_uuid(d->>'turno_ciclo_id');
    v_fecha_h  timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_fecha    date := coalesce((d->>'fecha')::date, (v_fecha_h at time zone 'America/Tegucigalpa')::date);
    v_ejec     uuid := coalesce(public._fert_uuid(d->>'ejecutor_id'), p_en_nombre, (select auth.uid()));
    v_ejec2    uuid := public._fert_uuid(d->>'ejecutor2_id');
    v_tc       public.turnos_ciclo%rowtype;
    v_obs      text[];
    v_en_plan  boolean;
    l          record;
begin
    v_obs := public._fert_autorizar(v_estacion, 'aplicar', v_fecha_h, p_inmediato, p_en_nombre);

    select * into v_tc from public.turnos_ciclo where id = v_turno;
    if not found then
        raise exception 'El turno no existe. Actualiza la aplicación.';
    end if;
    if v_tc.estacion_id is distinct from v_estacion then
        v_obs := public._fert_obs(v_obs, array['OTRA_ESTACION']);
    end if;
    if v_fecha > (p_creado at time zone 'America/Tegucigalpa')::date + 1 then
        raise exception 'La fecha de la aplicación no puede ser futura.';
    end if;
    if not exists (select 1 from public.perfiles where id = v_ejec)
       or (v_ejec2 is not null and not exists (select 1 from public.perfiles where id = v_ejec2)) then
        raise exception 'El estacionero que ejecutó no existe.';
    end if;

    insert into public.fert_aplicaciones
        (id, estacion_id, turno_ciclo_id, fecha, fecha_hora, ejecutor_id, ejecutor2_id, comentario, registrado_por)
    values
        (p_id, v_estacion, v_turno, v_fecha, v_fecha_h, v_ejec, v_ejec2,
         nullif(btrim(d->>'comentario'), ''), (select auth.uid()));

    for l in select * from public._fert_lineas(d->'lineas') loop
        v_en_plan := exists (select 1 from public.fert_plan p where p.turno_ciclo_id = v_turno and p.material_id = l.material_id);
        if not v_en_plan then
            v_obs := public._fert_obs(v_obs, array['FUERA_DE_PLAN']);
        end if;
        insert into public.fert_aplicaciones_detalle (aplicacion_id, material_id, cantidad, en_plan)
        values (p_id, l.material_id, l.cantidad, v_en_plan);
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, l.material_id, 'APLICACION',
                     -l.cantidad, v_fecha_h, v_turno, 'aplicacion', p_id, p_inmediato));
    end loop;
    return v_obs;
end;
$$;

-- ---------- Bitácora de riego (horas; no toca inventario; la completa cualquiera con «Aplicar») ----------
create or replace function public._fert_op_bitacora(
    p_id uuid, d jsonb, p_creado timestamptz, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_turno  uuid := public._fert_uuid(d->>'turno_ciclo_id');
    v_fecha  date := (d->>'fecha')::date;
    v_hf     numeric := nullif(btrim(d->>'horas_fertilizacion'), '')::numeric;
    v_hr     numeric := nullif(btrim(d->>'horas_riego'), '')::numeric;
    v_ini    timestamptz := nullif(btrim(d->>'hora_inicio'), '')::timestamptz;
    v_fin    timestamptz := nullif(btrim(d->>'hora_fin'), '')::timestamptz;
    v_ejec   uuid := public._fert_uuid(d->>'ejecutor_id');
    v_ejec2  uuid := public._fert_uuid(d->>'ejecutor2_id');
    v_tc     public.turnos_ciclo%rowtype;
begin
    select * into v_tc from public.turnos_ciclo where id = v_turno;
    if not found then
        raise exception 'El turno no existe. Actualiza la aplicación.';
    end if;
    if v_fecha is null then
        raise exception 'Indica la fecha del riego.';
    end if;
    if v_tc.estacion_id is null or not public.fn_fert_puede(v_tc.estacion_id, 'aplicar') then
        raise exception 'Tu rol no tiene «Aplicar» en la estación de este turno.' using errcode = '42501';
    end if;
    if v_hf is not null and (v_hf < 0 or v_hf > 24) or v_hr is not null and (v_hr < 0 or v_hr > 24) then
        raise exception 'Las horas deben estar entre 0 y 24.';
    end if;
    if v_ini is not null and v_fin is not null and v_fin < v_ini then
        raise exception 'La hora final no puede ser anterior a la inicial.';
    end if;
    if v_ejec is not null and not exists (select 1 from public.perfiles where id = v_ejec)
       or v_ejec2 is not null and not exists (select 1 from public.perfiles where id = v_ejec2) then
        raise exception 'El estacionero que ejecutó no existe.';
    end if;

    insert into public.fert_bitacora_riego as b
        (turno_ciclo_id, fecha, estacion_id, horas_fertilizacion, horas_riego, hora_inicio, hora_fin,
         ejecutor_id, ejecutor2_id, comentario, operacion_id, updated_at, updated_by)
    values
        (v_turno, v_fecha, v_tc.estacion_id, v_hf, v_hr, v_ini, v_fin, v_ejec, v_ejec2,
         nullif(btrim(d->>'comentario'), ''), p_id, now(), (select auth.uid()))
    on conflict (turno_ciclo_id, fecha) do update set
        horas_fertilizacion = coalesce(excluded.horas_fertilizacion, b.horas_fertilizacion),
        horas_riego         = coalesce(excluded.horas_riego, b.horas_riego),
        hora_inicio         = coalesce(excluded.hora_inicio, b.hora_inicio),
        hora_fin            = coalesce(excluded.hora_fin, b.hora_fin),
        ejecutor_id         = coalesce(excluded.ejecutor_id, b.ejecutor_id),
        ejecutor2_id        = coalesce(excluded.ejecutor2_id, b.ejecutor2_id),
        comentario          = coalesce(excluded.comentario, b.comentario),
        operacion_id        = excluded.operacion_id,
        updated_at          = now(),
        updated_by          = excluded.updated_by;
    return '{}';
end;
$$;

-- ---------- Conteo físico (saldo inicial o ajuste) ----------
create or replace function public._fert_op_conteo(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_estacion uuid := public._fert_uuid(d->>'estacion_id');
    v_fecha    timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_obs      text[];
    v_linea    jsonb;
    v_mat      uuid;
    v_real     numeric;
    v_sistema  numeric;
    v_hay      boolean;
    v_vistos   uuid[] := '{}';
begin
    v_obs := public._fert_autorizar(v_estacion, 'contar', v_fecha, p_inmediato, p_en_nombre);

    if d->'lineas' is null or jsonb_typeof(d->'lineas') <> 'array' or jsonb_array_length(d->'lineas') = 0 then
        raise exception 'Agrega al menos un producto contado.';
    end if;

    insert into public.fert_conteos (id, estacion_id, fecha_hora, comentario, registrado_por)
    values (p_id, v_estacion, v_fecha, nullif(btrim(d->>'comentario'), ''), (select auth.uid()));

    for v_linea in select value from jsonb_array_elements(d->'lineas') loop
        v_mat := public._fert_uuid(v_linea->>'material_id');
        if v_mat is null or not exists (select 1 from public.materiales where id = v_mat) then
            raise exception 'Un producto no existe en el catálogo. Actualiza la aplicación.';
        end if;
        if v_mat = any(v_vistos) then
            raise exception 'Un producto está repetido en el conteo.';
        end if;
        v_vistos := v_vistos || v_mat;
        begin
            v_real := round(replace(btrim(v_linea->>'cantidad_real'), ',', '')::numeric, 4);
        exception when others then
            raise exception 'La cantidad contada no es un número válido.';
        end;
        if v_real is null or v_real < 0 or v_real > 1000000 then
            raise exception 'La cantidad contada debe estar entre 0 y 1,000,000.';
        end if;

        v_hay := exists (select 1 from public.fert_movimientos m
                         where m.estacion_id = v_estacion and m.material_id = v_mat and m.fecha_hora <= v_fecha);
        v_sistema := public._fert_saldo_en(v_estacion, v_mat, v_fecha);

        insert into public.fert_conteos_detalle (conteo_id, material_id, saldo_sistema, cantidad_real, diferencia)
        values (p_id, v_mat, v_sistema, v_real, v_real - v_sistema);

        -- Primer conteo de ese producto en la estación = saldo inicial. Si no, el ajuste por la diferencia.
        -- No se rechaza por saldo: el conteo ES la realidad física.
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_estacion, v_mat,
                     case when v_hay then 'AJUSTE_CONTEO' else 'SALDO_INICIAL' end,
                     v_real - v_sistema, v_fecha, null, 'conteo', p_id, false));
    end loop;
    return v_obs;
end;
$$;

-- ---------- Devolución (sobrante de una aplicación vuelve a la bodega) ----------
create or replace function public._fert_op_devolucion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean, p_en_nombre uuid
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_aplic   public.fert_aplicaciones%rowtype;
    v_fecha   timestamptz := coalesce((d->>'fecha_hora')::timestamptz, p_creado);
    v_motivo  text := nullif(btrim(d->>'motivo'), '');
    v_obs     text[];
    v_aplicado numeric;
    v_devuelto numeric;
    l         record;
begin
    select * into v_aplic from public.fert_aplicaciones where id = public._fert_uuid(d->>'aplicacion_id');
    if not found then
        raise exception 'La aplicación no existe. Actualiza la aplicación.';
    end if;
    if v_aplic.anulado_at is not null then
        raise exception 'Esa aplicación está anulada: no tiene nada que devolver.';
    end if;
    if v_motivo is null then
        raise exception 'Indica el motivo de la devolución.';
    end if;

    v_obs := public._fert_autorizar(v_aplic.estacion_id, 'aplicar', v_fecha, p_inmediato, p_en_nombre);

    insert into public.fert_devoluciones (id, aplicacion_id, estacion_id, fecha_hora, motivo, registrado_por)
    values (p_id, v_aplic.id, v_aplic.estacion_id, v_fecha, v_motivo, (select auth.uid()));

    for l in select * from public._fert_lineas(d->'lineas') loop
        select coalesce(sum(cantidad), 0) into v_aplicado
        from public.fert_aplicaciones_detalle where aplicacion_id = v_aplic.id and material_id = l.material_id;
        select coalesce(sum(dd.cantidad), 0) into v_devuelto
        from public.fert_devoluciones_detalle dd
        join public.fert_devoluciones dv on dv.id = dd.devolucion_id
        where dv.aplicacion_id = v_aplic.id and dv.anulado_at is null and dd.material_id = l.material_id
          and dv.id <> p_id;
        if l.cantidad > v_aplicado - v_devuelto then
            raise exception 'No se puede devolver % de %: en esa aplicación quedan %.',
                l.cantidad, (select coalesce(descripcion, codigo) from public.materiales where id = l.material_id),
                v_aplicado - v_devuelto;
        end if;
        insert into public.fert_devoluciones_detalle (devolucion_id, material_id, cantidad)
        values (p_id, l.material_id, l.cantidad);
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, v_aplic.estacion_id, l.material_id, 'DEVOLUCION',
                     l.cantidad, v_fecha, v_aplic.turno_ciclo_id, 'devolucion', p_id, p_inmediato));
    end loop;
    return v_obs;
end;
$$;

-- ---------- Anulación (el original queda visible; se asienta el movimiento contrario) ----------
create or replace function public._fert_op_anulacion(
    p_id uuid, d jsonb, p_creado timestamptz, p_inmediato boolean
) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_tipo     text := d->>'documento_tipo';
    v_doc      uuid := public._fert_uuid(d->>'documento_id');
    v_motivo   text := nullif(btrim(d->>'motivo'), '');
    v_estacion uuid;
    v_autor    uuid;
    v_anulado  timestamptz;
    v_creado   timestamptz;
    v_custodia public.fert_custodia%rowtype;
    v_obs      text[] := '{}';
    m          record;
begin
    if v_motivo is null then
        raise exception 'Indica el motivo de la anulación.';
    end if;

    case v_tipo
        when 'recepcion' then
            select estacion_id, registrado_por, anulado_at, fecha_hora into v_estacion, v_autor, v_anulado, v_creado
            from public.fert_recepciones where id = v_doc;
        when 'aplicacion' then
            select estacion_id, registrado_por, anulado_at, fecha_hora into v_estacion, v_autor, v_anulado, v_creado
            from public.fert_aplicaciones where id = v_doc;
            if exists (select 1 from public.fert_devoluciones where aplicacion_id = v_doc and anulado_at is null) then
                raise exception 'Esa aplicación tiene devoluciones: anúlalas primero.';
            end if;
        when 'conteo' then
            select estacion_id, registrado_por, anulado_at, fecha_hora into v_estacion, v_autor, v_anulado, v_creado
            from public.fert_conteos where id = v_doc;
        when 'devolucion' then
            select estacion_id, registrado_por, anulado_at, fecha_hora into v_estacion, v_autor, v_anulado, v_creado
            from public.fert_devoluciones where id = v_doc;
        else
            raise exception 'No se puede anular ese tipo de registro.';
    end case;

    if v_estacion is null then
        raise exception 'El registro a anular no existe.';
    end if;
    if v_anulado is not null then
        raise exception 'Ese registro ya estaba anulado.';
    end if;

    -- Quien tiene «Anular» en la estación, siempre. El autor, solo mientras siga con la estación a cargo
    -- desde antes de ese registro (su misma jornada).
    if not public.fn_fert_puede(v_estacion, 'anular') then
        select * into v_custodia from public.fert_custodia where estacion_id = v_estacion;
        if not (v_autor = (select auth.uid())
                and v_custodia.custodio_id = (select auth.uid())
                and v_custodia.estado = 'ACTIVA'
                and v_custodia.desde <= v_creado) then
            raise exception 'Solo puedes anular tus registros de tu jornada actual. Para otros, pide a quien tenga «Anular».'
                using errcode = '42501';
        end if;
    end if;

    for m in select * from public.fert_movimientos mv
             where mv.documento_id = v_doc and mv.anula_id is null and mv.tipo <> 'ANULACION'
             order by mv.cursor loop
        v_obs := public._fert_obs(v_obs, public._fert_mover(p_id, m.estacion_id, m.material_id, 'ANULACION',
                     -m.cantidad, p_creado, m.turno_ciclo_id, v_tipo, v_doc, p_inmediato, m.id));
    end loop;

    execute format('update public.%I set anulado_at = now(), anulado_por = $1, motivo_anulacion = $2 where id = $3',
                   case v_tipo when 'recepcion' then 'fert_recepciones' when 'aplicacion' then 'fert_aplicaciones'
                               when 'conteo' then 'fert_conteos' else 'fert_devoluciones' end)
        using (select auth.uid()), v_motivo, v_doc;
    return v_obs;
end;
$$;

-- ---------- Chofer y vehículo (alta rápida desde campo, quedan «por validar») ----------
create or replace function public._fert_op_chofer(p_id uuid, d jsonb) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_gestiona boolean := public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'gestionar_choferes');
    v_nombre   text := nullif(btrim(d->>'nombre'), '');
    v_id       uuid := coalesce(public._fert_uuid(d->>'chofer_id'), p_id);
begin
    if not (v_gestiona or public.fn_tiene_permiso('fertirriego', 'recibir')) then
        raise exception 'Tu rol no puede agregar choferes.' using errcode = '42501';
    end if;
    if v_nombre is null then
        raise exception 'Escribe el nombre del chofer.';
    end if;
    if exists (select 1 from public.fert_choferes where id = v_id) then
        if not v_gestiona then
            return '{}';   -- ya existe (otro envío lo creó): nada que hacer
        end if;
        update public.fert_choferes set
            nombre = v_nombre,
            identidad = coalesce(nullif(btrim(d->>'identidad'), ''), identidad),
            telefono = coalesce(nullif(btrim(d->>'telefono'), ''), telefono),
            validado = coalesce((d->>'validado')::boolean, validado),
            activo = coalesce((d->>'activo')::boolean, activo)
        where id = v_id;
        return '{}';
    end if;
    insert into public.fert_choferes (id, nombre, identidad, telefono, validado, created_by)
    values (v_id, v_nombre, nullif(btrim(d->>'identidad'), ''), nullif(btrim(d->>'telefono'), ''),
            v_gestiona and coalesce((d->>'validado')::boolean, true), (select auth.uid()));
    return '{}';
end;
$$;

create or replace function public._fert_op_vehiculo(p_id uuid, d jsonb) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_gestiona boolean := public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'gestionar_choferes');
    v_placa    text := nullif(upper(regexp_replace(coalesce(d->>'placa', ''), '\s+', '', 'g')), '');
    v_id       uuid := coalesce(public._fert_uuid(d->>'vehiculo_id'), p_id);
begin
    if not (v_gestiona or public.fn_tiene_permiso('fertirriego', 'recibir')) then
        raise exception 'Tu rol no puede agregar vehículos.' using errcode = '42501';
    end if;
    if v_placa is null then
        raise exception 'Escribe la placa del vehículo.';
    end if;
    if exists (select 1 from public.fert_vehiculos where id = v_id) then
        if not v_gestiona then
            return '{}';
        end if;
        update public.fert_vehiculos set
            placa = v_placa,
            tipo = coalesce(nullif(btrim(d->>'tipo'), ''), tipo),
            marca = coalesce(nullif(btrim(d->>'marca'), ''), marca),
            color = coalesce(nullif(btrim(d->>'color'), ''), color),
            validado = coalesce((d->>'validado')::boolean, validado),
            activo = coalesce((d->>'activo')::boolean, activo)
        where id = v_id;
        return '{}';
    end if;
    insert into public.fert_vehiculos (id, placa, tipo, marca, color, validado, created_by)
    values (v_id, v_placa, nullif(btrim(d->>'tipo'), ''), nullif(btrim(d->>'marca'), ''),
            nullif(btrim(d->>'color'), ''), v_gestiona and coalesce((d->>'validado')::boolean, true),
            (select auth.uid()));
    return '{}';
end;
$$;


-- =====================================================================
-- 12 · LA PUERTA: fn_fert_sincronizar(lote)
-- =====================================================================
-- Cada elemento del lote:
--   { id (uuid del teléfono), tipo, creado_en, enviado_en, inmediato, dispositivo,
--     ubicacion: {lat, lon, precision} | null, en_nombre_de (uuid | null), datos: {...} }
-- Respuesta: [{ id, estado: ACEPTADO | ACEPTADO_CON_OBSERVACIONES | YA_EXISTIA | RECHAZADO,
--               mensaje, observaciones }]
-- Cada registro se procesa por separado: uno rechazado no tumba a los demás.

create or replace function public._fert_procesar(p_op jsonb)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_id        uuid := public._fert_uuid(p_op->>'id');
    v_tipo      text := p_op->>'tipo';
    v_datos     jsonb := coalesce(p_op->'datos', '{}'::jsonb);
    v_creado    timestamptz := coalesce(nullif(p_op->>'creado_en', '')::timestamptz, now());
    v_enviado   timestamptz := nullif(p_op->>'enviado_en', '')::timestamptz;
    v_inmediato boolean := coalesce((p_op->>'inmediato')::boolean, false);
    v_en_nombre uuid := public._fert_uuid(p_op->>'en_nombre_de');
    v_lat       double precision := nullif(p_op->'ubicacion'->>'lat', '')::double precision;
    v_lon       double precision := nullif(p_op->'ubicacion'->>'lon', '')::double precision;
    v_obs       text[] := '{}';
begin
    if v_id is null then
        raise exception 'El registro no trae identificador.';
    end if;
    if v_tipo is null or v_tipo not in ('recepcion', 'aplicacion', 'bitacora', 'conteo', 'devolucion',
                                        'anulacion', 'chofer', 'vehiculo') then
        raise exception 'Tipo de registro desconocido: %. Actualiza la aplicación.', coalesce(v_tipo, '(vacío)');
    end if;

    -- Reloj del teléfono: comparar su hora al enviar con la del servidor
    if v_enviado is not null and abs(extract(epoch from (v_enviado - now()))) > 300
       or v_creado > now() + interval '5 minutes' then
        v_obs := array['RELOJ'];
    end if;
    if v_lat is null or v_lon is null then
        v_obs := public._fert_obs(v_obs, array['SIN_UBICACION']);
    end if;

    insert into public.fert_operaciones
        (id, tipo, estacion_id, perfil_id, en_nombre_de, dispositivo, creado_en, enviado_en, inmediato,
         lat, lon, precision_m, datos, resultado)
    values
        (v_id, coalesce(v_tipo, '?'), public._fert_uuid(v_datos->>'estacion_id'), (select auth.uid()), v_en_nombre,
         left(p_op->>'dispositivo', 200), v_creado, v_enviado, v_inmediato,
         v_lat, v_lon, nullif(p_op->'ubicacion'->>'precision', '')::double precision, v_datos, 'ACEPTADO');

    v_obs := public._fert_obs(v_obs, case v_tipo
        when 'recepcion'  then public._fert_op_recepcion(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'aplicacion' then public._fert_op_aplicacion(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'bitacora'   then public._fert_op_bitacora(v_id, v_datos, v_creado, v_en_nombre)
        when 'conteo'     then public._fert_op_conteo(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'devolucion' then public._fert_op_devolucion(v_id, v_datos, v_creado, v_inmediato, v_en_nombre)
        when 'anulacion'  then public._fert_op_anulacion(v_id, v_datos, v_creado, v_inmediato)
        when 'chofer'     then public._fert_op_chofer(v_id, v_datos)
        when 'vehiculo'   then public._fert_op_vehiculo(v_id, v_datos)
    end);

    update public.fert_operaciones
       set observaciones = v_obs,
           resultado = case when cardinality(v_obs) > 0 then 'ACEPTADO_CON_OBSERVACIONES' else 'ACEPTADO' end
     where id = v_id;
    return v_obs;
end;
$$;

create or replace function public.fn_fert_sincronizar(p_ops jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_op    jsonb;
    v_id    uuid;
    v_prev  public.fert_operaciones%rowtype;
    v_obs   text[];
    v_msg   text;
    v_out   jsonb := '[]'::jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
        raise exception 'Se esperaba una lista de registros.';
    end if;
    if jsonb_array_length(p_ops) > 200 then
        raise exception 'Máximo 200 registros por envío.';
    end if;

    for v_op in select value from jsonb_array_elements(p_ops) with ordinality as x(value, n) order by n loop
        v_id := public._fert_uuid(v_op->>'id');

        select * into v_prev from public.fert_operaciones where id = v_id;
        if found then
            -- Ya llegó antes (reintento del teléfono): se responde lo mismo, sin repetir nada
            v_out := v_out || jsonb_build_array(jsonb_build_object(
                'id', v_id, 'estado', 'YA_EXISTIA', 'resultado', v_prev.resultado,
                'mensaje', v_prev.mensaje, 'observaciones', to_jsonb(v_prev.observaciones)));
            continue;
        end if;

        begin
            v_obs := public._fert_procesar(v_op);
            v_out := v_out || jsonb_build_array(jsonb_build_object(
                'id', v_id,
                'estado', case when cardinality(v_obs) > 0 then 'ACEPTADO_CON_OBSERVACIONES' else 'ACEPTADO' end,
                'mensaje', null, 'observaciones', to_jsonb(v_obs)));
        exception when others then
            get stacked diagnostics v_msg = message_text;
            -- El rechazo también queda guardado: nada de lo que llega del campo se pierde
            if v_id is not null then
                insert into public.fert_operaciones
                    (id, tipo, estacion_id, perfil_id, en_nombre_de, dispositivo, creado_en, enviado_en, inmediato,
                     datos, resultado, mensaje)
                values
                    (v_id, coalesce(v_op->>'tipo', '?'), public._fert_uuid(v_op->'datos'->>'estacion_id'),
                     (select auth.uid()), public._fert_uuid(v_op->>'en_nombre_de'), left(v_op->>'dispositivo', 200),
                     null, null, coalesce((v_op->>'inmediato')::boolean, false),
                     coalesce(v_op->'datos', '{}'::jsonb), 'RECHAZADO', v_msg)
                on conflict (id) do nothing;
            end if;
            v_out := v_out || jsonb_build_array(jsonb_build_object(
                'id', v_id, 'estado', 'RECHAZADO', 'mensaje', v_msg, 'observaciones', '[]'::jsonb));
        end;
    end loop;
    return v_out;
end;
$$;

grant execute on function public.fn_fert_sincronizar(jsonb) to authenticated;


-- =====================================================================
-- 13 · ADMINISTRAR ESTACIONES (con señal)
-- =====================================================================

/** Asignar o quitar a una persona de una estación. */
create or replace function public.fn_fert_asignar_persona(p_estacion uuid, p_perfil uuid, p_asignar boolean default true)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not public.fn_fert_puede(p_estacion, 'administrar_estaciones') then
        raise exception 'Tu rol no tiene «Administrar estaciones» para esta estación.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.perfiles where id = p_perfil and activo) then
        raise exception 'La persona no existe o está inactiva.';
    end if;

    if p_asignar then
        insert into public.perfiles_estaciones (perfil_id, estacion_id, created_by)
        values (p_perfil, p_estacion, (select auth.uid()))
        on conflict do nothing;
    else
        if exists (select 1 from public.fert_custodia where estacion_id = p_estacion and custodio_id = p_perfil) then
            raise exception 'Esa persona tiene la estación a cargo. Asigna la custodia a otra persona primero.';
        end if;
        delete from public.perfiles_estaciones where perfil_id = p_perfil and estacion_id = p_estacion;
    end if;
end;
$$;

grant execute on function public.fn_fert_asignar_persona(uuid, uuid, boolean) to authenticated;

/**
 * El jefe pone la estación a cargo de alguien (arranque, o nadie llegó a recibirla). Queda en la bitácora de
 * relevos con su motivo. Una entrega pendiente se cancela.
 */
create or replace function public.fn_fert_asignar_custodia(p_estacion uuid, p_perfil uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_actual public.fert_custodia%rowtype;
    v_id     uuid := gen_random_uuid();
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not public.fn_fert_puede(p_estacion, 'administrar_estaciones') then
        raise exception 'Tu rol no tiene «Administrar estaciones» para esta estación.' using errcode = '42501';
    end if;
    if nullif(btrim(p_motivo), '') is null then
        raise exception 'Indica el motivo de la asignación.';
    end if;
    if not exists (select 1 from public.perfiles_estaciones where estacion_id = p_estacion and perfil_id = p_perfil) then
        raise exception 'Esa persona no está asignada a la estación. Asígnala primero.';
    end if;

    select * into v_actual from public.fert_custodia where estacion_id = p_estacion for update;

    update public.fert_relevos
       set estado = 'CANCELADO', motivo = coalesce(motivo || ' · ', '') || 'Cancelado por asignación del jefe'
     where estacion_id = p_estacion and estado = 'EN_ENTREGA';

    insert into public.fert_relevos
        (id, estacion_id, metodo, estado, entrega_id, recibe_id, entregado_at, recibido_at, motivo, registrado_por)
    values
        (v_id, p_estacion, 'ASIGNACION', 'ASIGNADO', v_actual.custodio_id, p_perfil, now(), now(),
         btrim(p_motivo), (select auth.uid()));

    insert into public.fert_custodia (estacion_id, custodio_id, estado, desde, relevo_id, updated_at)
    values (p_estacion, p_perfil, 'ACTIVA', now(), v_id, now())
    on conflict (estacion_id) do update set
        custodio_id = excluded.custodio_id, estado = 'ACTIVA', desde = excluded.desde,
        relevo_id = excluded.relevo_id, updated_at = now();
    return v_id;
end;
$$;

grant execute on function public.fn_fert_asignar_custodia(uuid, uuid, text) to authenticated;

/** Opciones administrativas. */
create or replace function public.fn_fert_configurar(p_clave text, p_valor jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego', 'configurar')) then
        raise exception 'Tu rol no tiene «Configurar» en Fertirriego.' using errcode = '42501';
    end if;
    update public.fert_configuracion
       set valor = p_valor, updated_at = now(), updated_by = (select auth.uid())
     where clave = p_clave;
    if not found then
        raise exception 'Opción desconocida: %', p_clave;
    end if;
end;
$$;

grant execute on function public.fn_fert_configurar(text, jsonb) to authenticated;


-- =====================================================================
-- 14 · PUBLICACIÓN DESDE AGL
-- =====================================================================
-- p = { temporada, completo (bool: desactiva los turnos de la temporada que no vengan),
--       estaciones: [{nombre, zona}],
--       materiales: [{codigo, descripcion, unidad, grupo}],
--       turnos: [{agl_id, turno, temporada, ciclo, fecha_siembra, estacion, zona, orden_sap, plan, tipo_plan,
--                 area_mz, estado}],
--       plan: [{agl_id, filas: [{fecha, ddt, material, cantidad, unidad, dosis_mz, horas_riego, volumen_m3}]}] }
-- El plan de cada turno que viene se REEMPLAZA completo. Las zonas se cruzan por nombre (no se crean).

create or replace function public.fn_fert_publicar(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_avisos  text[] := '{}';
    v_n_est   integer := 0;
    v_n_mat   integer := 0;
    v_n_tur   integer := 0;
    v_n_plan  integer := 0;
    v_n_inact integer := 0;
    v_zona    uuid;
    v_est     uuid;
    v_turno   uuid;
    v_tc      uuid;
    v_faltan  integer;
    e record;
    m record;
    t record;
    g jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'Tu sesión ya no es válida. Vuelve a entrar.';
    end if;
    if not (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'publicar')) then
        raise exception 'Este usuario no tiene «Publicar» en «Fertirriego · Conexión AGL».' using errcode = '42501';
    end if;

    -- ---- Estaciones (por nombre) ----
    for e in select * from jsonb_to_recordset(coalesce(p->'estaciones', '[]')) as x(nombre text, zona text) loop
        continue when nullif(btrim(e.nombre), '') is null;
        v_zona := (select z.id from public.zonas z where public._fert_llave(z.nombre) = public._fert_llave(e.zona) limit 1);
        if nullif(btrim(e.zona), '') is not null and v_zona is null then
            v_avisos := v_avisos || format('Zona «%s» (estación %s) no existe en AgroNotificaciones.', e.zona, e.nombre);
        end if;
        update public.estaciones_riego
           set zona_id = coalesce(v_zona, zona_id), activo = true
         where public._fert_llave(nombre) = public._fert_llave(e.nombre);
        if not found then
            insert into public.estaciones_riego (nombre, zona_id) values (btrim(e.nombre), v_zona);
        end if;
        v_n_est := v_n_est + 1;
    end loop;

    -- ---- Materiales (por código; AGL manda en unidad, la descripción solo si falta) ----
    for m in select * from jsonb_to_recordset(coalesce(p->'materiales', '[]'))
             as x(codigo text, descripcion text, unidad text, grupo text) loop
        continue when nullif(btrim(m.codigo), '') is null;
        insert into public.materiales (codigo, descripcion, grupo, unidad, fertirriego)
        values (btrim(m.codigo), m.descripcion, m.grupo, m.unidad, true)
        on conflict (codigo) do update set
            unidad = coalesce(excluded.unidad, materiales.unidad),
            fertirriego = true,
            descripcion = coalesce(materiales.descripcion, excluded.descripcion),
            activo = true;
        v_n_mat := v_n_mat + 1;
    end loop;

    -- ---- Turnos por temporada y ciclo ----
    for t in select * from jsonb_to_recordset(coalesce(p->'turnos', '[]')) as x(
                 agl_id text, turno text, temporada text, ciclo text, fecha_siembra date, estacion text, zona text,
                 orden_sap text, plan text, tipo_plan text, area_mz numeric, estado text) loop
        continue when nullif(btrim(t.agl_id), '') is null or nullif(btrim(t.turno), '') is null;
        v_zona := (select z.id from public.zonas z where public._fert_llave(z.nombre) = public._fert_llave(t.zona) limit 1);
        v_est := (select s.id from public.estaciones_riego s where public._fert_llave(s.nombre) = public._fert_llave(t.estacion) limit 1);
        if v_est is null then
            v_avisos := v_avisos || format('Turno %s: la estación «%s» no existe.', t.turno, coalesce(t.estacion, '(vacía)'));
        end if;

        insert into public.turnos (codigo, zona_id) values (btrim(t.turno), v_zona)
        on conflict (codigo) do update set zona_id = coalesce(excluded.zona_id, turnos.zona_id)
        returning id into v_turno;

        insert into public.turnos_ciclo
            (agl_id, turno_id, temporada, ciclo, fecha_siembra, estacion_id, zona_id, orden_sap, plan, tipo_plan,
             area_mz, estado, activo, publicado_at)
        values
            (btrim(t.agl_id), v_turno, coalesce(t.temporada, p->>'temporada'), t.ciclo, t.fecha_siembra, v_est, v_zona,
             nullif(btrim(t.orden_sap), ''), t.plan, t.tipo_plan, t.area_mz, t.estado, true, now())
        on conflict (agl_id) do update set
            turno_id = excluded.turno_id, temporada = excluded.temporada, ciclo = excluded.ciclo,
            fecha_siembra = excluded.fecha_siembra, estacion_id = excluded.estacion_id, zona_id = excluded.zona_id,
            orden_sap = excluded.orden_sap, plan = excluded.plan, tipo_plan = excluded.tipo_plan,
            area_mz = excluded.area_mz, estado = excluded.estado, activo = true, publicado_at = now();
        v_n_tur := v_n_tur + 1;
    end loop;

    if coalesce((p->>'completo')::boolean, false) and p->>'temporada' is not null then
        update public.turnos_ciclo tc
           set activo = false
         where tc.temporada = p->>'temporada'
           and tc.activo
           and tc.agl_id not in (select x->>'agl_id' from jsonb_array_elements(coalesce(p->'turnos', '[]')) x);
        get diagnostics v_n_inact = row_count;
    end if;

    -- ---- Plan: se reemplaza el de cada turno que viene ----
    for g in select value from jsonb_array_elements(coalesce(p->'plan', '[]')) loop
        v_tc := (select id from public.turnos_ciclo where agl_id = g->>'agl_id');
        if v_tc is null then
            v_avisos := v_avisos || format('Plan del turno %s: el turno no se publicó.', g->>'agl_id');
            continue;
        end if;
        delete from public.fert_plan where turno_ciclo_id = v_tc;

        insert into public.fert_plan
            (turno_ciclo_id, fecha, ddt, material_id, cantidad, unidad, dosis_mz, horas_riego, volumen_m3)
        select v_tc, x.fecha, x.ddt, mt.id, x.cantidad, coalesce(x.unidad, mt.unidad), x.dosis_mz, x.horas_riego, x.volumen_m3
        from jsonb_to_recordset(coalesce(g->'filas', '[]')) as x(
                 fecha date, ddt integer, material text, cantidad numeric, unidad text, dosis_mz numeric,
                 horas_riego numeric, volumen_m3 numeric)
        join public.materiales mt on mt.codigo = btrim(x.material)
        where x.fecha is not null and x.cantidad is not null;
        v_n_plan := v_n_plan + (select count(*) from public.fert_plan where turno_ciclo_id = v_tc);

        select count(*) into v_faltan
        from jsonb_to_recordset(coalesce(g->'filas', '[]')) as x(material text)
        where not exists (select 1 from public.materiales mt where mt.codigo = btrim(x.material));
        if v_faltan > 0 then
            v_avisos := v_avisos || format('Plan del turno %s: %s fila(s) con material que no se publicó.', g->>'agl_id', v_faltan);
        end if;
    end loop;

    insert into public.fert_publicaciones (temporada, publicado_por, conteos, avisos)
    values (p->>'temporada', (select auth.uid()),
            jsonb_build_object('estaciones', v_n_est, 'materiales', v_n_mat, 'turnos', v_n_tur,
                               'turnos_desactivados', v_n_inact, 'filas_plan', v_n_plan),
            v_avisos);

    return jsonb_build_object('estaciones', v_n_est, 'materiales', v_n_mat, 'turnos', v_n_tur,
                              'turnos_desactivados', v_n_inact, 'filas_plan', v_n_plan, 'avisos', to_jsonb(v_avisos));
end;
$$;

grant execute on function public.fn_fert_publicar(jsonb) to authenticated;


-- =====================================================================
-- 15 · SEGURIDAD DE LAS TABLAS: leer según la estación; escribir solo por las funciones
-- =====================================================================

do $$
declare
    t text;
begin
    foreach t in array array[
        'fert_configuracion', 'turnos_ciclo', 'fert_plan', 'fert_publicaciones', 'perfiles_estaciones',
        'fert_choferes', 'fert_vehiculos', 'fert_choferes_vehiculos', 'fert_llaves', 'fert_operaciones',
        'fert_custodia', 'fert_relevos', 'fert_relevos_diferencias', 'fert_recepciones', 'fert_recepciones_detalle',
        'fert_aplicaciones', 'fert_aplicaciones_detalle', 'fert_bitacora_riego', 'fert_conteos',
        'fert_conteos_detalle', 'fert_devoluciones', 'fert_devoluciones_detalle', 'fert_traslados',
        'fert_traslados_detalle', 'fert_movimientos', 'fert_saldos']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
        execute format('revoke all on public.%I from anon', t);
        execute format('grant select on public.%I to authenticated', t);
        execute format('drop policy if exists fert_leer on public.%I', t);
    end loop;
end $$;

-- fert_llaves: sin política = nadie la lee directo.

create policy fert_leer on public.fert_configuracion for select to authenticated using (true);

create policy fert_leer on public.turnos_ciclo for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver') or public.fn_tiene_permiso('fertirriego_agl', 'ver'));

create policy fert_leer on public.fert_plan for select to authenticated
    using (exists (select 1 from public.turnos_ciclo tc where tc.id = turno_ciclo_id
                   and (public.fn_fert_puede(tc.estacion_id, 'ver') or public.fn_tiene_permiso('fertirriego_agl', 'ver'))));

create policy fert_leer on public.fert_publicaciones for select to authenticated
    using (public.fn_es_admin() or public.fn_tiene_permiso('fertirriego_agl', 'ver'));

create policy fert_leer on public.perfiles_estaciones for select to authenticated
    using (perfil_id = (select auth.uid()) or public.fn_fert_puede(estacion_id, 'ver'));

create policy fert_leer on public.fert_choferes for select to authenticated
    using (public.fn_tiene_permiso('fertirriego', 'ver'));
create policy fert_leer on public.fert_vehiculos for select to authenticated
    using (public.fn_tiene_permiso('fertirriego', 'ver'));
create policy fert_leer on public.fert_choferes_vehiculos for select to authenticated
    using (public.fn_tiene_permiso('fertirriego', 'ver'));

create policy fert_leer on public.fert_operaciones for select to authenticated
    using (perfil_id = (select auth.uid()) or (estacion_id is not null and public.fn_fert_puede(estacion_id, 'ver')));

create policy fert_leer on public.fert_custodia for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.fert_relevos for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.fert_relevos_diferencias for select to authenticated
    using (exists (select 1 from public.fert_relevos r where r.id = relevo_id and public.fn_fert_puede(r.estacion_id, 'ver')));

create policy fert_leer on public.fert_recepciones for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.fert_recepciones_detalle for select to authenticated
    using (exists (select 1 from public.fert_recepciones r where r.id = recepcion_id and public.fn_fert_puede(r.estacion_id, 'ver')));

create policy fert_leer on public.fert_aplicaciones for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.fert_aplicaciones_detalle for select to authenticated
    using (exists (select 1 from public.fert_aplicaciones a where a.id = aplicacion_id and public.fn_fert_puede(a.estacion_id, 'ver')));

create policy fert_leer on public.fert_bitacora_riego for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));

create policy fert_leer on public.fert_conteos for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.fert_conteos_detalle for select to authenticated
    using (exists (select 1 from public.fert_conteos c where c.id = conteo_id and public.fn_fert_puede(c.estacion_id, 'ver')));

create policy fert_leer on public.fert_devoluciones for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));
create policy fert_leer on public.fert_devoluciones_detalle for select to authenticated
    using (exists (select 1 from public.fert_devoluciones dv where dv.id = devolucion_id and public.fn_fert_puede(dv.estacion_id, 'ver')));

create policy fert_leer on public.fert_traslados for select to authenticated
    using (public.fn_fert_puede(origen_id, 'ver') or public.fn_fert_puede(destino_id, 'ver'));
create policy fert_leer on public.fert_traslados_detalle for select to authenticated
    using (exists (select 1 from public.fert_traslados tr where tr.id = traslado_id
                   and (public.fn_fert_puede(tr.origen_id, 'ver') or public.fn_fert_puede(tr.destino_id, 'ver'))));

create policy fert_leer on public.fert_movimientos for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver') or public.fn_tiene_permiso('fertirriego_agl', 'ver'));

create policy fert_leer on public.fert_saldos for select to authenticated
    using (public.fn_fert_puede(estacion_id, 'ver'));

grant select on public.v_fert_kardex to authenticated;

-- Funciones internas: no se llaman desde fuera
do $$
declare
    f text;
begin
    foreach f in array array[
        'public._fert_custodio_en(uuid, timestamptz)',
        'public._fert_saldo_en(uuid, uuid, timestamptz)',
        'public._fert_autorizar(uuid, text, timestamptz, boolean, uuid)',
        'public._fert_mover(uuid, uuid, uuid, text, numeric, timestamptz, uuid, text, uuid, boolean, uuid)',
        'public._fert_lineas(jsonb, text)',
        'public._fert_op_recepcion(uuid, jsonb, timestamptz, boolean, uuid)',
        'public._fert_op_aplicacion(uuid, jsonb, timestamptz, boolean, uuid)',
        'public._fert_op_bitacora(uuid, jsonb, timestamptz, uuid)',
        'public._fert_op_conteo(uuid, jsonb, timestamptz, boolean, uuid)',
        'public._fert_op_devolucion(uuid, jsonb, timestamptz, boolean, uuid)',
        'public._fert_op_anulacion(uuid, jsonb, timestamptz, boolean)',
        'public._fert_op_chofer(uuid, jsonb)',
        'public._fert_op_vehiculo(uuid, jsonb)',
        'public._fert_procesar(jsonb)',
        'public.fn_fert_crear_llave()']
    loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
    end loop;
end $$;


-- =====================================================================
-- 16 · TIEMPO REAL (saldos, custodia y movimientos se ven al instante en el teléfono y en AGL)
-- =====================================================================

do $$
declare
    t text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach t in array array['fert_saldos', 'fert_custodia', 'fert_movimientos', 'fert_relevos'] loop
            if not exists (select 1 from pg_publication_tables
                           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
                execute format('alter publication supabase_realtime add table public.%I', t);
            end if;
        end loop;
    end if;
end $$;
