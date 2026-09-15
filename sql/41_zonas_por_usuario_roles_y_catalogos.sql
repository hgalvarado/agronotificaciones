-- =====================================================================
-- MIGRACIÓN 41 · Zonas por usuario, roles dinámicos y catálogos de riego
-- =====================================================================
-- Cuatro cosas:
--
--   A. Catálogos de Estaciones de riego y de Turnos. El turno pertenece a
--      una zona, y elegirlo propone su zona.
--   B. Roles que se crean y se eliminan desde la pantalla, sin tocar
--      código. Eso obliga a sacar los códigos de rol escritos a mano de
--      las policies: un rol nuevo no puede nacer sin permisos de lectura
--      sólo porque su código no estaba en un `or`.
--   C. Zonas asignadas por usuario. Quien tiene zonas ve lo de sus zonas
--      y nada más; quien no tiene ninguna sigue viéndolo todo.
--   D. Edición en línea del detalle de riego, con la misma validación de
--      área que ya tiene el formulario.
-- =====================================================================


-- =====================================================================
-- PARTE A · CATÁLOGOS DE RIEGO
-- =====================================================================

-- ---------------------------------------------------------------------
-- Estaciones de riego
-- ---------------------------------------------------------------------
create table if not exists public.estaciones_riego (
    id          uuid primary key default gen_random_uuid(),
    codigo      text unique,
    nombre      text not null unique,
    descripcion text,
    activo      boolean not null default true,
    created_at  timestamptz not null default now()
);

comment on table public.estaciones_riego is
    'Estaciones de bombeo desde las que se riega (Congolón, etc.).';

-- ---------------------------------------------------------------------
-- Turnos, que pertenecen a una zona
-- ---------------------------------------------------------------------
-- «Al seleccionar un Turno el sistema debe autoseleccionar su Zona
--  asignada (permitiendo cambiarla si el turno se movió temporalmente).»
--
-- Por eso la zona del turno vive en el CATÁLOGO y la del turno de riego
-- se queda donde estaba: el catálogo dice dónde está normalmente ese
-- turno, y el registro dice dónde estuvo ese día. Si el turno se moviera
-- de zona en el catálogo, los turnos de riego ya capturados no cambian
-- de sitio, que es lo correcto —se regó donde se regó—.
-- ---------------------------------------------------------------------
create table if not exists public.turnos (
    id         uuid primary key default gen_random_uuid(),
    codigo     text not null unique,
    nombre     text,
    zona_id    uuid references public.zonas(id),
    activo     boolean not null default true,
    created_at timestamptz not null default now(),
    constraint turno_codigo_no_vacio check (btrim(codigo) <> '')
);

create index if not exists turnos_zona_idx on public.turnos (zona_id);

comment on table public.turnos is
    'Catálogo de turnos de riego. La zona es la habitual: al elegir el turno se '
    'propone, pero el turno de riego puede guardarse en otra si ese día se movió.';

-- Se siembra con lo que ya se capturó, para no empezar de cero: los
-- turnos que existen son los que la gente ya escribió a mano.
insert into public.turnos (codigo, zona_id)
select distinct on (t.turno) btrim(t.turno), t.zona_id
from public.turnos_riego t
where btrim(coalesce(t.turno, '')) <> ''
order by t.turno, t.created_at desc
on conflict (codigo) do nothing;

insert into public.estaciones_riego (nombre)
select distinct btrim(t.estacion_riego)
from public.turnos_riego t
where btrim(coalesce(t.estacion_riego, '')) <> ''
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------
-- El turno de riego apunta al catálogo
-- ---------------------------------------------------------------------
-- Se conservan las columnas de texto (`turno`, `estacion_riego`) y se
-- agregan las llaves. El texto sigue siendo lo que se enseña y lo que
-- entra en la llave única; la llave es lo que permite el desplegable y
-- la relación con la zona. Quitar el texto habría roto la importación,
-- que trae turnos que todavía no están en el catálogo.
-- ---------------------------------------------------------------------
alter table public.turnos_riego
    add column if not exists turno_id uuid references public.turnos(id),
    add column if not exists estacion_riego_id uuid references public.estaciones_riego(id);

update public.turnos_riego t
set turno_id = c.id
from public.turnos c
where t.turno_id is null and btrim(t.turno) = c.codigo;

update public.turnos_riego t
set estacion_riego_id = e.id
from public.estaciones_riego e
where t.estacion_riego_id is null and btrim(t.estacion_riego) = e.nombre;

/* El texto se mantiene al día solo desde el catálogo: así la llave única
   y lo que se lee en pantalla no se separan nunca del id. */
create or replace function public.fn_sincronizar_catalogos_turno()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp as $$
begin
    if new.turno_id is not null then
        select c.codigo into new.turno from public.turnos c where c.id = new.turno_id;
    end if;

    if new.estacion_riego_id is not null then
        select e.nombre into new.estacion_riego
        from public.estaciones_riego e where e.id = new.estacion_riego_id;
    end if;

    return new;
end
$$;

drop trigger if exists trg_sincronizar_catalogos_turno on public.turnos_riego;
create trigger trg_sincronizar_catalogos_turno
    before insert or update on public.turnos_riego
    for each row execute function public.fn_sincronizar_catalogos_turno();

-- ---------------------------------------------------------------------
-- RLS de los dos catálogos
-- ---------------------------------------------------------------------
alter table public.estaciones_riego enable row level security;
alter table public.turnos enable row level security;

do $$
declare t text;
begin
    foreach t in array array['estaciones_riego', 'turnos'] loop
        execute format('drop policy if exists %I_select on public.%I', t, t);
        execute format(
            'create policy %I_select on public.%I for select using ((select auth.uid()) is not null)',
            t, t);

        execute format('drop policy if exists %I_insert on public.%I', t, t);
        execute format(
            'create policy %I_insert on public.%I for insert with check ((select public.fn_tiene_permiso(''catalogos'',''crear'')))',
            t, t);

        execute format('drop policy if exists %I_update on public.%I', t, t);
        execute format(
            'create policy %I_update on public.%I for update using ((select public.fn_tiene_permiso(''catalogos'',''editar'')))',
            t, t);

        execute format('drop policy if exists %I_delete on public.%I', t, t);
        execute format(
            'create policy %I_delete on public.%I for delete using ((select public.fn_tiene_permiso(''catalogos'',''eliminar'')))',
            t, t);

        execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end loop;
end
$$;


-- =====================================================================
-- PARTE B · ROLES DINÁMICOS
-- =====================================================================
-- `roles.id` era un smallint sin secuencia: se insertaban a mano. Para
-- crearlos desde la pantalla hace falta que la base ponga el número, y
-- empezando por encima de los siete que ya existen.
-- =====================================================================

do $$
declare v_max smallint;
begin
    if pg_get_serial_sequence('public.roles', 'id') is null then
        select coalesce(max(id), 0) into v_max from public.roles;
        execute format(
            'alter table public.roles alter column id add generated by default as identity (start with %s)',
            v_max + 1);
    end if;
end
$$;

-- Los siete de fábrica no se pueden eliminar: hay policies y funciones
-- que los nombran (ADMIN, TORRE_CONTROL, INVITADO). Un rol de sistema
-- borrado deja la aplicación sin administrador.
alter table public.roles
    add column if not exists de_sistema boolean not null default false;

update public.roles
set de_sistema = true
where codigo in ('ADMIN', 'TORRE_CONTROL', 'DIGITADOR', 'DIGITADOR_PARAMETRISTA',
                 'JEFE_ZONA', 'DIGITADOR_ANALISIS', 'INVITADO');

comment on column public.roles.de_sistema is
    'Rol de fábrica: la aplicación lo nombra por código, así que no se elimina.';

alter table public.roles enable row level security;

drop policy if exists roles_select_all on public.roles;
create policy roles_select_all on public.roles for select using (true);

drop policy if exists roles_write_admin on public.roles;
create policy roles_write_admin on public.roles for all
    using ((select public.fn_es_admin()) and not (select public.fn_es_invitado()))
    with check ((select public.fn_es_admin()) and not (select public.fn_es_invitado()));

grant select, insert, update, delete on public.roles to authenticated;

/* Crear un rol. El código se normaliza —mayúsculas y guion bajo— porque
   es lo que después se compara en las funciones, y «Jefe de zona» y
   «JEFE_DE_ZONA» no pueden ser dos roles distintos. */
create or replace function public.fn_crear_rol(
    p_nombre      text,
    p_codigo      text default null,
    p_descripcion text default null
) returns smallint
language plpgsql
security definer
set search_path = public, pg_temp as $$
declare
    v_codigo text;
    v_id     smallint;
begin
    if not public.fn_es_admin() or public.fn_es_invitado() then
        raise exception 'Sólo el Administrador puede crear roles.' using errcode = '42501';
    end if;
    if p_nombre is null or btrim(p_nombre) = '' then
        raise exception 'Escribe el nombre del rol.' using errcode = '22023';
    end if;

    v_codigo := upper(regexp_replace(
        translate(btrim(coalesce(nullif(btrim(p_codigo), ''), p_nombre)),
                  'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'),
        '[^A-Za-z0-9]+', '_', 'g'));
    v_codigo := btrim(v_codigo, '_');

    if v_codigo = '' then
        raise exception 'El nombre del rol no deja un código utilizable.' using errcode = '22023';
    end if;

    insert into public.roles (codigo, nombre, descripcion, de_sistema)
    values (v_codigo, btrim(p_nombre), nullif(btrim(p_descripcion), ''), false)
    returning id into v_id;

    return v_id;
end
$$;

/* Eliminar un rol. Se niega si es de fábrica o si alguien lo tiene
   puesto: dejar usuarios apuntando a un rol que ya no existe es dejarlos
   sin poder entrar, y eso se descubre por teléfono un lunes. */
create or replace function public.fn_eliminar_rol(p_rol_id smallint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp as $$
declare
    v_rol     public.roles%rowtype;
    v_cuantos integer;
begin
    if not public.fn_es_admin() or public.fn_es_invitado() then
        raise exception 'Sólo el Administrador puede eliminar roles.' using errcode = '42501';
    end if;

    select * into v_rol from public.roles where id = p_rol_id;
    if not found then
        raise exception 'Ese rol ya no existe.' using errcode = 'P0002';
    end if;
    if v_rol.de_sistema then
        raise exception 'El rol «%» es de fábrica y no se puede eliminar.', v_rol.nombre
            using errcode = '2BP01';
    end if;

    select count(*) into v_cuantos from public.perfiles where rol_id = p_rol_id;
    if v_cuantos > 0 then
        raise exception
            'El rol «%» lo tienen % usuario(s). Cámbiaselo antes de eliminarlo.',
            v_rol.nombre, v_cuantos
            using errcode = '2BP01';
    end if;

    delete from public.permisos where rol_id = p_rol_id;
    delete from public.navegacion_rol where rol_id = p_rol_id;
    delete from public.roles where id = p_rol_id;
end
$$;

grant execute on function public.fn_crear_rol(text, text, text) to authenticated;
grant execute on function public.fn_eliminar_rol(smallint) to authenticated;


-- ---------------------------------------------------------------------
-- Las policies dejan de nombrar roles a mano
-- ---------------------------------------------------------------------
-- Con roles dinámicos, `fn_mi_rol() = 'TORRE_CONTROL'` escrito dentro de
-- una policy es una trampa: un rol nuevo nace sin poder leer nada aunque
-- el Administrador le marque todas las casillas, y nadie entiende por
-- qué. Lo que decide pasa a ser el permiso de la pantalla, que es lo que
-- la pantalla de Permisos configura.
--
-- Esto además arregla un error que ya estaba: los roles 4 a 7 de la
-- migración 39 no entraban en ninguna de las ramas viejas, así que un
-- Jefe de Zona no veía labores por más permisos que tuviera.
-- ---------------------------------------------------------------------

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select
    using (
        (select public.fn_tiene_permiso('tickets', 'ver'))
        -- Su propio ticket lo ve siempre, aunque no tenga la pantalla:
        -- es el que acaba de crear para capturar.
        or usuario_id = (select auth.uid())
    );

drop policy if exists horometros_select on public.horometros;
create policy horometros_select on public.horometros for select
    using (
        (select public.fn_tiene_permiso('horometros', 'ver'))
        or exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = (select auth.uid())
        )
    );

drop policy if exists registros_select on public.registros;
create policy registros_select on public.registros for select
    using (
        (select public.fn_tiene_permiso('labores', 'ver'))
        or exists (
            select 1 from public.tickets t
            where t.id = ticket_id and t.usuario_id = (select auth.uid())
        )
    );


-- =====================================================================
-- PARTE C · ZONAS POR USUARIO
-- =====================================================================
-- «Si un usuario tiene asignada sólo la Zona 1 y la Zona 2, la
--  aplicación entera debe mostrarle únicamente los datos de esas zonas.»
--
-- La regla de oro, y es la que hace que esto se pueda instalar sin dejar
-- a nadie fuera: SIN ZONAS ASIGNADAS SE VE TODO. Asignar zonas es
-- restringir; no asignarlas es no restringir. Lo contrario —que nadie
-- vea nada hasta que le asignen— habría dejado la finca entera a oscuras
-- el día que se corre esta migración.
--
-- El Administrador nunca se restringe: es quien reparte las zonas, y si
-- se pudiera encerrar a sí mismo no habría forma de salir.
-- =====================================================================

create table if not exists public.perfiles_zonas (
    perfil_id  uuid not null references public.perfiles(id) on delete cascade,
    zona_id    uuid not null references public.zonas(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (perfil_id, zona_id)
);

create index if not exists perfiles_zonas_zona_idx on public.perfiles_zonas (zona_id);

comment on table public.perfiles_zonas is
    'Zonas que puede ver cada usuario. SIN filas = sin restricción: ve todas.';

alter table public.perfiles_zonas enable row level security;

drop policy if exists perfiles_zonas_select on public.perfiles_zonas;
create policy perfiles_zonas_select on public.perfiles_zonas for select
    using (perfil_id = (select auth.uid()) or (select public.fn_es_admin()));

drop policy if exists perfiles_zonas_write on public.perfiles_zonas;
create policy perfiles_zonas_write on public.perfiles_zonas for all
    using ((select public.fn_es_admin()) and not (select public.fn_es_invitado()))
    with check ((select public.fn_es_admin()) and not (select public.fn_es_invitado()));

grant select, insert, update, delete on public.perfiles_zonas to authenticated;

/* ¿Este usuario está restringido a zonas? */
create or replace function public.fn_tiene_zonas() returns boolean
language sql stable security definer
set search_path = public, pg_temp as $$
    select not public.fn_es_admin()
       and exists (select 1 from public.perfiles_zonas pz where pz.perfil_id = (select auth.uid()))
$$;

/**
 * La pregunta que hacen todas las policies: ¿puede ver esta zona?
 *
 * Una zona NULA —un lote al que nadie le puso zona— la ve todo el mundo.
 * Esconderla sería hacer desaparecer datos por un campo vacío, y nadie se
 * enteraría de que le falta la mitad de un reporte: se enteraría el
 * contador a fin de mes. Que aparezca es lo que hace que alguien la
 * asigne.
 */
create or replace function public.fn_ve_zona(p_zona_id uuid) returns boolean
language sql stable security definer
set search_path = public, pg_temp as $$
    select
        not public.fn_tiene_zonas()
        or p_zona_id is null
        or exists (
            select 1 from public.perfiles_zonas pz
            where pz.perfil_id = (select auth.uid()) and pz.zona_id = p_zona_id
        )
$$;

/** Las zonas del usuario, para que las RPC filtren sin repetir la regla. */
create or replace function public.fn_mis_zonas() returns setof uuid
language sql stable security definer
set search_path = public, pg_temp as $$
    select pz.zona_id from public.perfiles_zonas pz where pz.perfil_id = (select auth.uid())
$$;

grant execute on function public.fn_tiene_zonas() to authenticated;
grant execute on function public.fn_ve_zona(uuid) to authenticated;
grant execute on function public.fn_mis_zonas() to authenticated;

-- ---------------------------------------------------------------------
-- Dónde se aplica
-- ---------------------------------------------------------------------
-- En `lotes_temporada` y en `zonas`, que es de donde cuelga TODO lo
-- demás: los lotes de un selector, los de un reporte, los del plan de
-- siembra. Filtrando ahí, cualquier consulta que pase por un lote queda
-- filtrada sola, sin tener que acordarse en cada pantalla.
--
-- Y en las tablas que llevan la zona o el lote encima: riego, siembra,
-- plan de siembra y el detalle de labores.
--
-- Lo que NO se filtra por zona: `tickets` y `horometros`. Un ticket
-- recién creado no tiene labores todavía, así que no tiene zona; un
-- filtro estricto escondería el ticket que la persona acaba de abrir.
-- Su regla sigue siendo la de siempre —el dueño y el permiso de
-- pantalla—, y el detalle de labores, que sí tiene lote, es el que
-- recorta lo que se ve dentro.
-- ---------------------------------------------------------------------

drop policy if exists zonas_select on public.zonas;
create policy zonas_select on public.zonas for select
    using ((select auth.uid()) is not null and (select public.fn_ve_zona(id)));

drop policy if exists lotes_temporada_select on public.lotes_temporada;
create policy lotes_temporada_select on public.lotes_temporada for select
    using ((select auth.uid()) is not null and (select public.fn_ve_zona(zona_id)));

drop policy if exists registro_detalle_select on public.registro_detalle;
create policy registro_detalle_select on public.registro_detalle for select
    using (
        (select public.fn_ve_zona(
            (select lt.zona_id from public.lotes_temporada lt
             where lt.id = registro_detalle.lote_temporada_id)))
        and (
            (select public.fn_tiene_permiso('labores', 'ver'))
            or exists (
                select 1 from public.registros r
                join public.tickets t on t.id = r.ticket_id
                where r.id = registro_detalle.registro_id and t.usuario_id = (select auth.uid())
            )
        )
    );

drop policy if exists turnos_riego_select on public.turnos_riego;
create policy turnos_riego_select on public.turnos_riego for select
    using ((select public.fn_tiene_permiso('turnos_riego','ver'))
       and (select public.fn_ve_zona(zona_id)));

-- Ojo con el nombre de la columna dentro del `exists`: `turnos_riego`
-- también tiene ahora un `turno_id` (el del catálogo, que agrega esta
-- misma migración), así que un `turno_id` a secas se resolvería contra la
-- tabla de dentro —`t.id = t.turno_id`, que casi nunca es cierto— y la
-- policy escondería TODO el detalle. Por eso va calificado con el nombre
-- de la tabla de la policy.
drop policy if exists turnos_riego_detalle_select on public.turnos_riego_detalle;
create policy turnos_riego_detalle_select on public.turnos_riego_detalle for select
    using (
        (select public.fn_tiene_permiso('turnos_riego','ver'))
        and exists (
            select 1 from public.turnos_riego t
            where t.id = turnos_riego_detalle.turno_id
              and (select public.fn_ve_zona(t.zona_id))
        )
    );

drop policy if exists siembras_select on public.siembras;
create policy siembras_select on public.siembras for select
    using (
        (select public.fn_tiene_permiso('trasplante','ver'))
        and (select public.fn_ve_zona(
            (select lt.zona_id from public.lotes_temporada lt
             where lt.id = siembras.lote_temporada_id)))
    );

drop policy if exists plan_siembra_select on public.planes_siembra;
create policy plan_siembra_select on public.planes_siembra for select
    using (
        (select public.fn_tiene_permiso('trasplante','ver'))
        and (select public.fn_ve_zona(
            (select lt.zona_id from public.lotes_temporada lt
             where lt.id = planes_siembra.lote_temporada_id)))
    );

-- Las funciones del tablero son `security definer`, así que se saltan
-- RLS: hay que filtrarlas a mano o enseñarían todas las zonas justo
-- donde más se nota.
create or replace function public.fn_lotes_regables(
    p_temporada_id uuid,
    p_zona_id      uuid default null,
    p_turno_id     uuid default null
) returns table (
    lote_temporada_id uuid,
    ut                text,
    lote_nombre       text,
    zona              text,
    area_total        numeric,
    area_asignada     numeric,
    area_disponible   numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp as $$
    select
        lt.id,
        lo.nomenclatura,
        lo.nombre,
        z.nombre,
        public.fn_area_regable(lt.id) as area_total,
        coalesce(a.asignada, 0)       as area_asignada,
        greatest(public.fn_area_regable(lt.id) - coalesce(a.asignada, 0), 0) as area_disponible
    from public.lotes_temporada lt
    join public.lotes lo on lo.id = lt.lote_id
    left join public.zonas z on z.id = lt.zona_id
    left join lateral (
        select sum(d.area_turno) as asignada
        from public.turnos_riego_detalle d
        where d.lote_temporada_id = lt.id
          and (p_turno_id is null or d.turno_id <> p_turno_id)
    ) a on true
    where lt.temporada_id = p_temporada_id
      and lt.activo
      and (p_zona_id is null or lt.zona_id = p_zona_id)
    order by lo.nomenclatura;
$$;


-- =====================================================================
-- PARTE D · EDICIÓN EN LÍNEA DEL DETALLE DE RIEGO
-- =====================================================================
-- Corregir un área de dos cifras no puede costar abrir un formulario de
-- catorce campos. Se escribe sobre la tabla, como en horómetros y
-- labores, y con las MISMAS reglas: el disparador de área sigue siendo
-- el que manda, así que aquí no se repite la cuenta.
-- =====================================================================

create or replace function public.fn_editar_turno_riego(
    p_detalle_id  uuid,
    p_campo       text,
    p_valor       text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp as $$
declare
    v_turno uuid;
    v_zona  uuid;
begin
    select d.turno_id into v_turno
    from public.turnos_riego_detalle d where d.id = p_detalle_id;

    if v_turno is null then
        raise exception 'La línea no existe o no tienes permiso para verla.'
            using errcode = 'P0002';
    end if;

    case p_campo
        -- --------------------- Del DETALLE ---------------------------
        when 'area_turno' then
            update public.turnos_riego_detalle
            set area_turno = nullif(btrim(p_valor), '')::numeric
            where id = p_detalle_id;

        when 'variedad_id' then
            update public.turnos_riego_detalle
            set variedad_id = nullif(btrim(p_valor), '')::uuid
            where id = p_detalle_id;

        when 'lote_temporada_id' then
            update public.turnos_riego_detalle
            set lote_temporada_id = nullif(btrim(p_valor), '')::uuid
            where id = p_detalle_id;

        when 'detalle_comentarios' then
            update public.turnos_riego_detalle
            set comentarios = nullif(btrim(p_valor), '')
            where id = p_detalle_id;

        -- -------------------- De la CABECERA -------------------------
        -- Tocan a todos los lotes del turno, y eso es lo correcto: la
        -- orden SAP y el estado son del turno, no de cada lote.
        when 'orden_sap' then
            update public.turnos_riego set orden_sap = nullif(btrim(p_valor), '')
            where id = v_turno;

        when 'estado' then
            update public.turnos_riego
            set estado = nullif(btrim(p_valor), '')::public.estado_turno_riego
            where id = v_turno;

        when 'fecha_siembra' then
            update public.turnos_riego set fecha_siembra = p_valor::date where id = v_turno;

        when 'ciclo' then
            update public.turnos_riego set ciclo = p_valor::smallint where id = v_turno;

        when 'responsable' then
            update public.turnos_riego set responsable = nullif(btrim(p_valor), '')
            where id = v_turno;

        when 'plan_nutricional_id' then
            update public.turnos_riego
            set plan_nutricional_id = nullif(btrim(p_valor), '')::uuid
            where id = v_turno;

        when 'estacion_riego_id' then
            update public.turnos_riego
            set estacion_riego_id = nullif(btrim(p_valor), '')::uuid
            where id = v_turno;

        when 'fuente_agua' then
            update public.turnos_riego
            set fuente_agua = nullif(btrim(p_valor), '')::public.fuente_agua
            where id = v_turno;

        when 'turno_id' then
            -- Cambiar el turno arrastra su zona, igual que en el
            -- formulario: es la misma regla, escrita una sola vez.
            select c.zona_id into v_zona from public.turnos c
            where c.id = nullif(btrim(p_valor), '')::uuid;

            update public.turnos_riego
            set turno_id = nullif(btrim(p_valor), '')::uuid,
                zona_id  = coalesce(v_zona, zona_id)
            where id = v_turno;

        when 'zona_id' then
            update public.turnos_riego
            set zona_id = nullif(btrim(p_valor), '')::uuid
            where id = v_turno;

        else
            raise exception 'El campo «%» no se puede corregir sobre la tabla.', p_campo
                using errcode = '22023';
    end case;
end
$$;

comment on function public.fn_editar_turno_riego(uuid, text, text) is
    'Corrige UN campo de una línea de riego. Los del detalle tocan el lote; los de la '
    'cabecera, el turno entero. El área la sigue validando el disparador de siempre.';

grant execute on function public.fn_editar_turno_riego(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- La vista enseña las llaves nuevas
-- ---------------------------------------------------------------------
create or replace view public.v_turnos_riego as
select
    d.id                        as detalle_id,
    t.id                        as turno_id,
    t.temporada_id,
    tm.nombre                   as temporada_nombre,
    t.ciclo,
    t.fecha_siembra,
    t.zona_id,
    z.nombre                    as zona,
    t.turno,
    t.plan_nutricional_id,
    pn.nombre                   as plan_nutricional,
    t.responsable,
    t.estacion_riego,
    t.fuente_agua,
    t.orden_sap,
    t.estado,
    t.comentarios               as turno_comentarios,
    d.lote_temporada_id,
    lo.nomenclatura             as ut,
    lo.nombre                   as nomenclatura,
    d.area_turno,
    d.variedad_id,
    v.nombre                    as variedad,
    d.comentarios               as detalle_comentarios,
    (public.fn_hoy() - t.fecha_siembra)::integer as ddt_actual,
    public.fn_area_regable(d.lote_temporada_id) as area_disponible_total,
    t.usuario_id,
    pe.nombre                   as usuario_nombre,
    t.created_at,
    -- Columnas nuevas de la 41: las llaves de catálogo, para el
    -- desplegable de la edición en línea.
    t.turno_id                  as turno_catalogo_id,
    t.estacion_riego_id
from public.turnos_riego_detalle d
join public.turnos_riego t      on t.id = d.turno_id
join public.temporadas tm       on tm.id = t.temporada_id
join public.zonas z             on z.id = t.zona_id
left join public.planes_nutricionales pn on pn.id = t.plan_nutricional_id
join public.lotes_temporada lt  on lt.id = d.lote_temporada_id
join public.lotes lo            on lo.id = lt.lote_id
left join public.variedades v   on v.id = d.variedad_id
left join public.perfiles pe    on pe.id = t.usuario_id;

alter view public.v_turnos_riego set (security_invoker = on);


-- ---------------------------------------------------------------------
-- Grants que faltaban en dos vistas
-- ---------------------------------------------------------------------
-- `v_contadores_equipo` (38) y `v_turnos_riego` (40) nacieron sin
-- `grant select ... to authenticated`, a diferencia de las otras ocho
-- vistas del proyecto. En Supabase suelen salvarse por los privilegios
-- por omisión del esquema `public`, pero eso es una red que puede no
-- estar: PostgREST consulta como `authenticated`, y sin el grant las dos
-- pantallas nuevas contestan 403 sin decir por qué.
--
-- Se conceden aquí en vez de en sus migraciones para no obligar a
-- reejecutarlas. RLS sigue mandando: la vista es `security_invoker`.
-- ---------------------------------------------------------------------
grant select on public.v_turnos_riego to authenticated;

do $$ begin
    if exists (select 1 from information_schema.views
               where table_schema = 'public' and table_name = 'v_contadores_equipo') then
        grant select on public.v_contadores_equipo to authenticated;
    end if;
end $$;


-- ---------------------------------------------------------------------
-- Guardar el turno acepta las llaves de catálogo
-- ---------------------------------------------------------------------
-- Agregar parámetros con valor por omisión CREA UNA SOBRECARGA, y las
-- llamadas de antes quedan ambiguas («function is not unique»). Hay que
-- soltar la firma vieja primero; el `create` de la nueva va como `or
-- replace` para que la migración se pueda reejecutar.
drop function if exists public.fn_guardar_turno_riego(
    uuid, uuid, smallint, date, uuid, text, uuid, text,
    public.fuente_agua, text, public.estado_turno_riego, text, text, jsonb);

create or replace function public.fn_guardar_turno_riego(
    p_turno_id            uuid,
    p_temporada_id        uuid,
    p_ciclo               smallint,
    p_fecha_siembra       date,
    p_zona_id             uuid,
    p_turno               text,
    p_plan_nutricional_id uuid,
    p_estacion_riego      text,
    p_fuente_agua         public.fuente_agua,
    p_orden_sap           text,
    p_estado              public.estado_turno_riego,
    p_responsable         text,
    p_comentarios         text,
    p_lotes               jsonb,
    p_turno_catalogo_id   uuid default null,
    p_estacion_riego_id   uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp as $$
declare
    v_id uuid;
    v_n  integer;
begin
    if p_lotes is null or jsonb_array_length(p_lotes) = 0 then
        raise exception 'Un turno tiene que llevar al menos un lote.' using errcode = '22023';
    end if;

    if p_turno_id is null then
        insert into public.turnos_riego
            (temporada_id, ciclo, fecha_siembra, zona_id, turno, turno_id, plan_nutricional_id,
             responsable, estacion_riego, estacion_riego_id, fuente_agua, orden_sap, estado,
             comentarios, usuario_id)
        values
            (p_temporada_id, coalesce(p_ciclo, 1), p_fecha_siembra, p_zona_id, btrim(p_turno),
             p_turno_catalogo_id, p_plan_nutricional_id, nullif(btrim(p_responsable), ''),
             nullif(btrim(p_estacion_riego), ''), p_estacion_riego_id, p_fuente_agua,
             nullif(btrim(p_orden_sap), ''), coalesce(p_estado, 'PENDIENTE_CREAR'),
             nullif(btrim(p_comentarios), ''), (select auth.uid()))
        returning id into v_id;
    else
        update public.turnos_riego
        set temporada_id        = p_temporada_id,
            ciclo               = coalesce(p_ciclo, 1),
            fecha_siembra       = p_fecha_siembra,
            zona_id             = p_zona_id,
            turno               = btrim(p_turno),
            turno_id            = p_turno_catalogo_id,
            plan_nutricional_id = p_plan_nutricional_id,
            responsable         = nullif(btrim(p_responsable), ''),
            estacion_riego      = nullif(btrim(p_estacion_riego), ''),
            estacion_riego_id   = p_estacion_riego_id,
            fuente_agua         = p_fuente_agua,
            orden_sap           = nullif(btrim(p_orden_sap), ''),
            estado              = coalesce(p_estado, estado),
            comentarios         = nullif(btrim(p_comentarios), '')
        where id = p_turno_id
        returning id into v_id;

        if v_id is null then
            raise exception 'El turno no existe o no tienes permiso para cambiarlo.'
                using errcode = '42501';
        end if;

        delete from public.turnos_riego_detalle where turno_id = v_id;
    end if;

    insert into public.turnos_riego_detalle (turno_id, lote_temporada_id, area_turno, variedad_id, comentarios)
    select
        v_id,
        (x->>'lote_temporada_id')::uuid,
        (x->>'area_turno')::numeric,
        nullif(x->>'variedad_id', '')::uuid,
        nullif(btrim(coalesce(x->>'comentarios', '')), '')
    from jsonb_array_elements(p_lotes) as x;

    get diagnostics v_n = row_count;
    if v_n = 0 then
        raise exception 'Un turno tiene que llevar al menos un lote.' using errcode = '22023';
    end if;

    return v_id;
end
$$;

grant execute on function public.fn_guardar_turno_riego(
    uuid, uuid, smallint, date, uuid, text, uuid, text,
    public.fuente_agua, text, public.estado_turno_riego, text, text, jsonb, uuid, uuid
) to authenticated;
