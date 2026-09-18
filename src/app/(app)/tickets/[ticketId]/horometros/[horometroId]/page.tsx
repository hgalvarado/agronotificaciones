import Link from 'next/link'
import { puedeEnTicket } from '@/lib/permisos/captura'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos } from '@/lib/auth'
import { TablaRegistros } from '@/components/registro/TablaRegistros'
import {
  BotonLink,
  EstadoVacio,
  Insignia,
  Tarjeta,
  TarjetaEncabezado,
} from '@/components/ui/Primitivos'
import {
  IconChevronLeft,
  IconGauge,
  IconMoon,
  IconPencil,
  IconPlus,
  IconSun,
  IconTractor,
  IconUser,
} from '@/components/ui/Icons'
import { formatearFecha } from '@/lib/estados'
import type { Horometro, Registro, RegistroDetalle, Ticket } from '@/lib/types'

export default async function HorometroDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string; horometroId: string }>
}) {
  const { ticketId, horometroId } = await params
  const supabase = await createClient()
  const [{ data: ticketData }, { data: horometroData }] = await Promise.all([
    supabase.from('tickets').select('*').eq('id', ticketId).single(),
    supabase
      .from('horometros')
      .select('*, equipos(*), operadores(*)')
      .eq('id', horometroId)
      .single(),
  ])

  if (!ticketData || !horometroData) notFound()
  const ticket = ticketData as Ticket
  const h = horometroData as Horometro

  const { data: registrosData } = await supabase
    .from('registros')
    .select('*, labores(*), tareas_sap(*), implementos(*)')
    .eq('horometro_id', horometroId)
    .order('created_at', { ascending: true })

  const registros = (registrosData as Registro[] | null) ?? []
  const registroIds = registros.map((r) => r.id)

  const { data: detallesData } =
    registroIds.length > 0
      ? await supabase
          .from('registro_detalle')
          .select('*, lotes_temporada(*, lotes(*))')
          .in('registro_id', registroIds)
      : { data: [] }
  const detalles = (detallesData as RegistroDetalle[] | null) ?? []

  // Decide la MATRIZ de permisos y nada más: ni el rol ni el estado del
  // ticket. Cerrado es una marca de avance, no un candado; el único tope
  // es NOTIFICADO.
  const permisos = await getPermisos()
  const puedeEditarLabores = puedeEnTicket(permisos, 'labores', 'editar', ticket.proceso)
  const puedeBorrarLabores = puedeEnTicket(permisos, 'labores', 'eliminar', ticket.proceso)
  const puedeEditarHorometro = puedeEnTicket(permisos, 'horometros', 'editar', ticket.proceso)
  const esDiurno = h.turno === 'DIURNO'

  return (
    <div className="anim-aparecer flex flex-col gap-4 p-4 lg:p-6">
      <Link
        href={`/tickets/${ticketId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <IconChevronLeft className="h-4 w-4" />
        {ticket.codigo}
      </Link>

      {/* Encabezado del horómetro */}
      <Tarjeta className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <IconTractor className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                {h.equipos?.codigo ?? '—'}
              </h1>
              <p className="text-sm text-slate-400">{h.equipos?.nombre}</p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <Insignia tono={esDiurno ? 'ambar' : 'azul'}>
              <span className="flex items-center gap-1">
                {esDiurno ? <IconSun className="h-3.5 w-3.5" /> : <IconMoon className="h-3.5 w-3.5" />}
                {esDiurno ? 'Diurno' : 'Nocturno'}
              </span>
            </Insignia>
            <span className="text-xs text-slate-400">{formatearFecha(h.fecha)}</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <Dato etiqueta="Inicial" valor={h.horometro_inicial} />
          <Dato etiqueta="Final" valor={h.horometro_final} />
          <Dato etiqueta="Horas máquina" valor={h.horas_maquina} destacado />
          <Dato etiqueta="Horas hombre" valor={h.horas_hombre ?? '—'} />
        </div>

        {h.operadores?.nombre && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-500">
            <IconUser className="h-4 w-4 text-slate-300" />
            {h.operadores.nombre}
          </p>
        )}

        {h.comentario && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/10">
            {h.comentario}
          </p>
        )}

        {puedeEditarHorometro && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <BotonLink
              href={`/tickets/${ticketId}/horometros/${horometroId}/editar`}
              variante="secundario"
              tamano="sm"
            >
              <IconPencil className="h-4 w-4" />
              Editar horómetro
            </BotonLink>
            {/* Cierra el ciclo equipo → labores → siguiente equipo sin
                tener que devolverse a la pantalla del ticket. */}
            <BotonLink href={`/tickets/${ticketId}/horometros/nuevo`} tamano="sm">
              <IconPlus className="h-4 w-4" />
              Siguiente equipo
            </BotonLink>
          </div>
        )}
      </Tarjeta>

      {/* Labores de este horómetro */}
      <Tarjeta>
        <TarjetaEncabezado
          titulo="Labores de este equipo"
          contador={registros.length}
          accion={
            puedeEditarLabores ? (
              <BotonLink
                href={`/tickets/${ticketId}/horometros/${horometroId}/registros/nuevo`}
                variante="suave"
                tamano="sm"
              >
                <IconPlus className="h-4 w-4" />
                Agregar
              </BotonLink>
            ) : undefined
          }
        />

        <div className="p-3">
          {registros.length === 0 ? (
            <EstadoVacio
              icono={<IconGauge />}
              titulo="Sin labores registradas"
              descripcion="Desglosa qué hizo este equipo durante las horas trabajadas."
              accion={
                puedeEditarLabores ? (
                  <BotonLink
                    href={`/tickets/${ticketId}/horometros/${horometroId}/registros/nuevo`}
                    tamano="sm"
                  >
                    <IconPlus className="h-4 w-4" />
                    Agregar labor
                  </BotonLink>
                ) : undefined
              }
            />
          ) : (
            <TablaRegistros
              ticketId={ticketId}
              ticketAbierto={puedeEditarLabores}
              puedeEliminar={puedeBorrarLabores}
              registros={registros.map((r) => ({
                ...r,
                detalle: detalles.filter((d) => d.registro_id === r.id),
              }))}
            />
          )}
        </div>
      </Tarjeta>
    </div>
  )
}

function Dato({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string
  valor: string | number
  destacado?: boolean
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p
        className={`mt-0.5 text-lg font-bold tracking-tight ${
          destacado ? 'text-brand-700' : 'text-slate-900'
        }`}
      >
        {valor}
      </p>
    </div>
  )
}
