import Link from 'next/link'
import { estaNotificado, puedeEnTicket } from '@/lib/permisos/captura'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos } from '@/lib/auth'
import { AccionesTicket } from '@/components/ticket/AccionesTicket'
import { TablaHorometros } from '@/components/horometro/TablaHorometros'
import { TablaRegistros } from '@/components/registro/TablaRegistros'
import { BotonImportarDetalle } from '@/components/ticket/BotonImportarDetalle'
import type { CatalogosTicket } from '@/components/ticket/ImportarDetalleTicket'
import {
  BotonLink,
  EstadoVacio,
  Insignia,
  Tarjeta,
  TarjetaEncabezado,
} from '@/components/ui/Primitivos'
import {
  IconChevronLeft,
  IconClock,
  IconGauge,
  IconMapPin,
  IconPlus,
  IconTractor,
} from '@/components/ui/Icons'
import { estadoInfo, formatearFecha, formatearFechaHora, procesoInfo } from '@/lib/estados'
import type { Horometro, Registro, RegistroDetalle, Ticket } from '@/lib/types'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>
}) {
  const { ticketId } = await params
  const supabase = await createClient()

  // El nombre del creador viene en el mismo viaje nombrando la llave
  // foránea explícitamente: `tickets` tiene DOS hacia `perfiles`
  // (usuario_id y cerrado_by), así que un `perfiles(nombre)` a secas es
  // ambiguo y PostgREST lo rechaza. Nombrando la constraint no lo es, y
  // se ahorra una consulta por carga de pantalla.
  const { data: ticketData } = await supabase
    .from('tickets')
    .select('*, creador:perfiles!tickets_usuario_id_fkey(nombre)')
    .eq('id', ticketId)
    .single()

  if (!ticketData) notFound()
  const ticket = ticketData as Ticket & { creador?: { nombre: string } | null }
  const nombreCreador = ticket.creador?.nombre ?? '—'

  const [{ data: horometrosData }, { data: registrosData }] = await Promise.all([
    supabase
      .from('horometros')
      .select('*, equipos(*), operadores(*)')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true }),
    supabase
      .from('registros')
      .select('*, labores(*), tareas_sap(*), implementos(*), horometros(equipo_id, equipos(codigo))')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true }),
  ])

  const horometros = (horometrosData as Horometro[] | null) ?? []
  const registros = (registrosData as (Registro & {
    horometros?: { equipos?: { codigo: string } | null } | null
  })[] | null) ?? []

  // Catálogos para la carga por Excel. Los lotes se recortan a la
  // temporada DEL TICKET, no a la activa: en un ticket histórico la
  // plantilla tiene que ofrecer los lotes de esa temporada.
  const [
    { data: equipos },
    { data: operadores },
    { data: laboresCat },
    { data: tareasCat },
    { data: implementosCat },
    { data: lotesCat },
    { data: proveedoresCat },
    { data: implementosFisicosCat },
    { data: vinculosFisicosCat },
  ] = await Promise.all([
    supabase.from('equipos').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase.from('operadores').select('id, codigo, nombre').eq('activo', true).order('nombre'),
    supabase
      .from('labores')
      .select('id, nombre, labores_tareas(tarea_id)')
      .eq('activo', true)
      .order('nombre'),
    supabase.from('tareas_sap').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase.from('implementos').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    ticket.temporada_id
      ? supabase
          .from('lotes_temporada')
          .select('id, lotes(nomenclatura, nombre)')
          .eq('temporada_id', ticket.temporada_id)
          .eq('activo', true)
      : Promise.resolve({ data: [] }),
    supabase.from('proveedores').select('id, nombre, tipo').eq('activo', true).order('nombre'),
    // Llegan con la migración 19. En consultas propias para que, si no
    // está corrida, falle sólo esto y la pantalla siga funcionando.
    supabase
      .from('implementos_fisicos')
      .select('id, codigo, descripcion')
      .eq('activo', true)
      .order('codigo'),
    supabase.from('labores_implementos_fisicos').select('labor_id, implemento_fisico_id'),
  ])

  type LoteFila = {
    id: string
    lotes:
      | { nomenclatura: string; nombre: string | null }
      | { nomenclatura: string; nombre: string | null }[]
      | null
  }

  const fisicosPorLabor = new Map<string, { implemento_fisico_id: string }[]>()
  for (const v of (vinculosFisicosCat as
    | { labor_id: string; implemento_fisico_id: string }[]
    | null) ?? []) {
    fisicosPorLabor.set(v.labor_id, [
      ...(fisicosPorLabor.get(v.labor_id) ?? []),
      { implemento_fisico_id: v.implemento_fisico_id },
    ])
  }

  const catalogos: CatalogosTicket = {
    equipos: (equipos as CatalogosTicket['equipos'] | null) ?? [],
    operadores: (operadores as CatalogosTicket['operadores'] | null) ?? [],
    labores: ((laboresCat as CatalogosTicket['labores'] | null) ?? []).map((l) => ({
      ...l,
      labores_implementos_fisicos: fisicosPorLabor.get(l.id) ?? [],
    })),
    tareasSap: (tareasCat as CatalogosTicket['tareasSap'] | null) ?? [],
    implementos: (implementosCat as CatalogosTicket['implementos'] | null) ?? [],
    lotes: ((lotesCat as LoteFila[] | null) ?? [])
      .map((lt) => {
        const lote = Array.isArray(lt.lotes) ? lt.lotes[0] : lt.lotes
        return {
          id: lt.id,
          nomenclatura: lote?.nomenclatura ?? '—',
          nombre: lote?.nombre ?? null,
        }
      })
      .sort((a, b) => a.nomenclatura.localeCompare(b.nomenclatura, 'es', { numeric: true })),
    proveedores: (proveedoresCat as CatalogosTicket['proveedores'] | null) ?? [],
    implementosFisicos:
      (implementosFisicosCat as CatalogosTicket['implementosFisicos'] | null) ?? [],
  }

  const registroIds = registros.map((r) => r.id)
  const { data: detallesData } =
    registroIds.length > 0
      ? await supabase
          .from('registro_detalle')
          .select('*, lotes_temporada(*, lotes(*))')
          .in('registro_id', registroIds)
      : { data: [] }
  const detalles = (detallesData as RegistroDetalle[] | null) ?? []

  // Decide la MATRIZ de permisos, y sólo ella. Esta pantalla decidía por
  // el rol —`rol === 'ADMIN' || rol === 'TORRE_CONTROL'`— así que a un rol
  // al que se le había quitado «editar» o «eliminar» en Permisos le
  // seguían saliendo los botones y sólo la base lo paraba, con un error
  // de permisos en la cara. Y el estado del ticket ya no bloquea: cerrado
  // es una marca de avance, no un candado.
  const permisos = await getPermisos()
  const puedeEditarHorometros = puedeEnTicket(permisos, 'horometros', 'editar', ticket.proceso)
  const puedeEditarLabores = puedeEnTicket(permisos, 'labores', 'editar', ticket.proceso)
  const puedeBorrarHorometros = puedeEnTicket(permisos, 'horometros', 'eliminar', ticket.proceso)
  const puedeBorrarLabores = puedeEnTicket(permisos, 'labores', 'eliminar', ticket.proceso)
  const puedeCrear = puedeEnTicket(permisos, 'tickets', 'crear', ticket.proceso)
  const estado = estadoInfo(ticket.estado)
  const proceso = procesoInfo(ticket.proceso)

  const totalHoras = horometros.reduce((acc, h) => acc + (h.horas_maquina ?? 0), 0)
  const totalMz = detalles.reduce((acc, d) => acc + (d.avance_mz ?? 0), 0)
  const lotesUnicos = new Set(detalles.map((d) => d.lote_temporada_id)).size

  return (
    <div className="anim-aparecer flex flex-col gap-4 p-4 lg:p-6">
      {/* Volver (sólo celular: en escritorio la lista está al lado) */}
      <Link
        href="/tickets"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 lg:hidden"
      >
        <IconChevronLeft className="h-4 w-4" />
        Tickets
      </Link>

      {/* ---------------- Encabezado ---------------- */}
      <Tarjeta className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{ticket.codigo}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {nombreCreador}
              {ticket.departamento ? ` · ${ticket.departamento}` : ''}
            </p>
            <p className="text-sm text-slate-400">{formatearFecha(ticket.fecha)}</p>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <Insignia tono={estado.tono} punto>
              {estado.etiqueta}
            </Insignia>
            <Insignia tono={proceso.tono}>
              {proceso.numero} · {proceso.etiqueta}
            </Insignia>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-400">{proceso.descripcion}</p>

        {/* Un ticket notificado se queda de sólo lectura y hay que decirlo:
            si no, el usuario busca el botón de editar y cree que se
            perdió. */}
        {estaNotificado(ticket.proceso) && (
          <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">
            Ya liquidado en SAP: horómetros y labores quedan de{' '}
            <strong>sólo lectura</strong>. Para corregir algo hay que devolver el ticket a un
            proceso anterior; quien tenga «Ver todo» en Tickets puede hacerlo.
          </p>
        )}

        <div className="mt-4 border-t border-slate-100 pt-4">
          <AccionesTicket
            ticket={ticket}
            permisos={[...permisos]}
            nombreUsuario={nombreCreador}
          />
        </div>
      </Tarjeta>

      {/* ---------------- Resumen de la jornada ---------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metrica icono={<IconTractor />} valor={horometros.length} etiqueta="Equipos" />
        <Metrica icono={<IconClock />} valor={`${totalHoras}`} etiqueta="Horas máquina" />
        <Metrica icono={<IconGauge />} valor={registros.length} etiqueta="Labores" />
        <Metrica
          icono={<IconMapPin />}
          valor={totalMz > 0 ? `${totalMz}` : lotesUnicos}
          etiqueta={totalMz > 0 ? 'Manzanas' : 'Lotes'}
        />
      </div>

      {/* ---------------- Horómetros ---------------- */}
      <Tarjeta>
        <TarjetaEncabezado
          titulo="Horómetros"
          contador={horometros.length}
          accion={
            puedeEditarHorometros || puedeCrear ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {/* La carga por Excel es para el registro histórico: una
                    jornada vieja completa de golpe, en vez de horómetro
                    por horómetro. */}
                <BotonImportarDetalle
                  ticketId={ticketId}
                  ticketCodigo={ticket.codigo}
                  fechaTicket={formatearFecha(ticket.fecha)}
                  catalogos={catalogos}
                />
                <BotonLink
                  href={`/tickets/${ticketId}/horometros/nuevo`}
                  variante="suave"
                  tamano="sm"
                >
                  <IconPlus className="h-4 w-4" />
                  Agregar
                </BotonLink>
              </div>
            ) : undefined
          }
        />

        <div className="p-3">
          {horometros.length === 0 ? (
            <EstadoVacio
              icono={<IconTractor />}
              titulo="Sin horómetros"
              descripcion="Registra el primer equipo de la jornada."
              accion={
                puedeEditarHorometros || puedeCrear ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <BotonLink href={`/tickets/${ticketId}/horometros/nuevo`} tamano="sm">
                      <IconPlus className="h-4 w-4" />
                      Agregar horómetro
                    </BotonLink>
                    <BotonImportarDetalle
                      ticketId={ticketId}
                      ticketCodigo={ticket.codigo}
                      fechaTicket={formatearFecha(ticket.fecha)}
                      catalogos={catalogos}
                    />
                  </div>
                ) : undefined
              }
            />
          ) : (
            <TablaHorometros
              ticketId={ticketId}
              ticketAbierto={puedeEditarHorometros}
              puedeEliminar={puedeBorrarHorometros}
              horometros={horometros.map((h) => ({
                ...h,
                cantidadLabores: registros.filter((r) => r.horometro_id === h.id).length,
              }))}
            />
          )}
        </div>
      </Tarjeta>

      {/* ---------------- Registros (labores) ---------------- */}
      <Tarjeta>
        <TarjetaEncabezado titulo="Labores registradas" contador={registros.length} />

        <div className="p-3">
          {registros.length === 0 ? (
            <EstadoVacio
              icono={<IconGauge />}
              titulo="Sin labores"
              descripcion="Las labores se agregan desde cada horómetro, para quedar ligadas al equipo que las realizó. Para una jornada vieja completa, usa «Cargar Excel» arriba."
            />
          ) : (
            <TablaRegistros
              ticketId={ticketId}
              ticketAbierto={puedeEditarLabores}
              puedeEliminar={puedeBorrarLabores}
              mostrarEquipo
              registros={registros.map((r) => ({
                ...r,
                detalle: detalles.filter((d) => d.registro_id === r.id),
                equipoCodigo: r.horometros?.equipos?.codigo,
              }))}
            />
          )}
        </div>
      </Tarjeta>

      {/* ---------------- Pie de auditoría ---------------- */}
      <p className="px-1 pb-2 text-xs text-slate-400">
        Creado el {formatearFechaHora(ticket.created_at)}
        {ticket.cerrado_at ? ` · Cerrado el ${formatearFechaHora(ticket.cerrado_at)}` : ''}
      </p>
    </div>
  )
}

function Metrica({
  icono,
  valor,
  etiqueta,
}: {
  icono: React.ReactNode
  valor: string | number
  etiqueta: string
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white px-3.5 py-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-1.5 text-slate-300">{icono}</div>
      <p className="mt-1 text-xl font-bold tracking-tight text-slate-900">{valor}</p>
      <p className="text-[11px] font-medium text-slate-400">{etiqueta}</p>
    </div>
  )
}
