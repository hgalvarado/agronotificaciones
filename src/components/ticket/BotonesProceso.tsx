'use client'

/**
 * Botones de un toque para mover tickets de proceso: uno por destino permitido, cada uno del color de su paso
 * («1 · Revisando» azul, «2 · Pend. aprobación» violeta, «3 · Notificado» verde). El siguiente paso del flujo
 * va resaltado. Sustituye al «elegir de una lista y aplicar». Lo usan Tickets (detalle y selección),
 * Horómetros y Labores.
 */

import { CLASES_TONO } from '@/components/ui/Primitivos'
import type { InfoProceso } from '@/lib/tickets/proceso'
import type { ProcesoTicket } from '@/lib/types'

const CORTO: Record<ProcesoTicket, string> = {
  REGISTRADO: 'Registrado',
  REVISANDO: 'Revisando',
  PENDIENTE_APROBACION: 'Pend. aprobación',
  NOTIFICADO: 'Notificado',
}

export function BotonesProceso({
  destinos,
  actual,
  resaltar,
  ocupado = false,
  onElegir,
  grande = false,
  prefijo = 'Pasar a',
}: {
  destinos: InfoProceso[]
  /** El proceso en que ya están (se omite). */
  actual?: ProcesoTicket | null
  /** El paso que conviene destacar (normalmente el siguiente). */
  resaltar?: ProcesoTicket | null
  ocupado?: boolean
  onElegir: (destino: InfoProceso) => void
  /** Botones de 44 px (teléfono, barra flotante). */
  grande?: boolean
  prefijo?: string
}) {
  const visibles = destinos.filter((d) => d.valor !== actual)
  if (visibles.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-botones-proceso>
      {prefijo && <span className="text-xs font-semibold text-slate-500">{prefijo}</span>}
      {visibles.map((d) => {
        const destacado = d.valor === resaltar
        return (
          <button
            key={d.valor}
            type="button"
            disabled={ocupado}
            onClick={() => onElegir(d)}
            data-destino={d.valor}
            title={d.descripcion}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 font-semibold ring-1 ring-inset transition-all active:scale-[0.97] disabled:opacity-50 ${
              grande ? 'min-h-11 text-sm' : 'h-9 text-sm'
            } ${destacado ? 'bg-brand-700 text-white ring-brand-700 shadow-[var(--shadow-raised)]' : CLASES_TONO[d.tono]}`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                destacado ? 'bg-white/20' : 'bg-white/70'
              }`}
            >
              {d.numero}
            </span>
            {CORTO[d.valor]}
          </button>
        )
      })}
    </div>
  )
}
