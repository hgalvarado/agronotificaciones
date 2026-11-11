'use client'

/**
 * «Pasar sus tickets a…»: cambia el PROCESO de los tickets de las filas marcadas en una cuadrícula de revisión
 * (/horometros, /labores). Torre de Control revisa por lotes —cuadra la continuidad de un conjunto de equipos y
 * días— y al terminar mueve todos esos tickets de una vez, sin ir a Tickets uno por uno.
 *
 * Usa la misma acción de la base que Tickets (`actualizar_tickets_masivo`), que valida permisos (editar, aprobar,
 * notificar) y alcance: lo que no corresponda simplemente no se actualiza, y se dice cuántos sí.
 * El proceso es del TICKET: si el ticket tiene más líneas que las marcadas, también cambian; se avisa antes.
 */

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { canExecuteAction, type Reglas } from '@/lib/permisos/clientABAC'
import { PROCESOS } from '@/lib/estados'
import type { ProcesoTicket } from '@/lib/types'

type FilaConTicket = { ticket_id: string; ticket_proceso: ProcesoTicket }

/** Qué acción de la matriz pide cada destino (igual que la base). */
const ACCION_DESTINO: Partial<Record<ProcesoTicket, string>> = {
  PENDIENTE_APROBACION: 'aprobar',
  NOTIFICADO: 'notificar',
}

export function destinosPermitidos(reglas: Reglas) {
  if (!canExecuteAction(reglas, 'tickets', 'editar')) return []
  return PROCESOS.filter((p) => {
    const accion = ACCION_DESTINO[p.valor]
    return !accion || canExecuteAction(reglas, 'tickets', accion)
  })
}

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

  async function aplicar(destino: ProcesoTicket) {
    const info = PROCESOS.find((p) => p.valor === destino)!
    const yaEstan = new Set(filas.filter((f) => f.ticket_proceso === destino).map((f) => f.ticket_id))
    const mover = tickets.filter((t) => !yaEstan.has(t))
    if (mover.length === 0) return onListo(`Los ${tickets.length} tickets ya están en «${info.numero} · ${info.etiqueta}».`)
    const n = mover.length === 1 ? '1 ticket' : `${mover.length} tickets`
    if (
      !confirm(
        `Pasar ${n} a «${info.numero} · ${info.etiqueta}».\n\n` +
          'El proceso es del ticket completo: si un ticket tiene otras líneas que no marcaste, también cambian.'
      )
    )
      return
    setOcupado(true)
    const { data, error } = await createClient().rpc('actualizar_tickets_masivo', {
      p_ticket_ids: mover,
      p_estado: null,
      p_proceso: destino,
    })
    setOcupado(false)
    if (error) return onError(error.message)
    const hechos = Number(data ?? 0)
    const fuera = mover.length - hechos
    onListo(
      `${hechos} ${hechos === 1 ? 'ticket pasó' : 'tickets pasaron'} a «${info.numero} · ${info.etiqueta}».` +
        (fuera > 0 ? ` ${fuera} no se ${fuera === 1 ? 'tocó' : 'tocaron'} (fuera de tu permiso o ya notificados).` : '')
    )
  }

  return (
    <select
      aria-label="Proceso de los tickets"
      data-proceso-lote
      defaultValue=""
      disabled={ocupado}
      onChange={(e) => {
        const v = e.target.value as ProcesoTicket
        e.target.value = ''
        if (v) void aplicar(v)
      }}
      className="h-9 max-w-[230px] rounded-lg border border-brand-300 bg-white px-2 text-sm font-semibold text-brand-800 focus:outline-none"
    >
      <option value="">
        {ocupado ? 'Aplicando…' : `Pasar ${tickets.length === 1 ? 'su ticket' : `sus ${tickets.length} tickets`} a…`}
      </option>
      {destinos.map((p) => (
        <option key={p.valor} value={p.valor}>
          {p.numero} · {p.etiqueta}
        </option>
      ))}
    </select>
  )
}
