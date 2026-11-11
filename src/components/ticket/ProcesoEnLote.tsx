'use client'

/**
 * Cambia el PROCESO de los tickets de las filas marcadas en una cuadrícula de revisión (/horometros, /labores).
 * Torre de Control revisa por lotes —cuadra la continuidad de un conjunto de equipos y días— y al terminar mueve
 * esos tickets de un toque, sin ir a Tickets uno por uno.
 *
 * El proceso es del TICKET: si el ticket tiene más líneas que las marcadas, también cambian (se dice en el botón).
 * La base valida permisos y alcance; lo que no corresponda no se toca y se dice cuántos sí.
 */

import { useState } from 'react'
import type { Reglas } from '@/lib/permisos/clientABAC'
import type { ProcesoTicket } from '@/lib/types'
import {
  confirmarDestino,
  destinosPermitidos,
  mensajeMovidos,
  moverTickets,
  type InfoProceso,
} from '@/lib/tickets/proceso'
import { BotonesProceso } from './BotonesProceso'

type FilaConTicket = { ticket_id: string; ticket_proceso: ProcesoTicket }

export function ProcesoEnLote({
  filas,
  reglas,
  onListo,
  onError,
}: {
  /** Las filas marcadas (cada una sabe su ticket). */
  filas: FilaConTicket[]
  reglas: Reglas
  onListo: (mensaje: string) => void
  onError: (mensaje: string) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const destinos = destinosPermitidos(reglas)
  const tickets = [...new Set(filas.map((f) => f.ticket_id))]
  if (destinos.length === 0 || tickets.length === 0) return null

  // Si todos están en el mismo paso, ese se omite y se destaca el siguiente
  const pasos = [...new Set(filas.map((f) => f.ticket_proceso))]
  const actual = pasos.length === 1 ? pasos[0] : null
  const iActual = actual ? destinos.findIndex((d) => d.valor === actual) : -1
  const siguiente = iActual >= 0 ? (destinos[iActual + 1]?.valor ?? null) : null

  async function aplicar(destino: InfoProceso) {
    const mover = [...new Set(filas.filter((f) => f.ticket_proceso !== destino.valor).map((f) => f.ticket_id))]
    if (mover.length === 0) return onListo(`Los ${tickets.length} tickets ya están en «${destino.numero} · ${destino.etiqueta}».`)
    if (!confirmarDestino(destino.valor, mover.length)) return
    setOcupado(true)
    const { hechos, error } = await moverTickets(mover, destino.valor)
    setOcupado(false)
    if (error) return onError(error)
    onListo(mensajeMovidos(mover.length, hechos, destino))
  }

  return (
    <div data-proceso-lote className="flex items-center gap-1.5">
      <BotonesProceso
        destinos={destinos}
        actual={actual}
        resaltar={siguiente ?? (actual ? null : 'REVISANDO')}
        ocupado={ocupado}
        onElegir={(d) => void aplicar(d)}
        prefijo={`Sus ${tickets.length === 1 ? 'ticket' : `${tickets.length} tickets`} a`}
      />
    </div>
  )
}
