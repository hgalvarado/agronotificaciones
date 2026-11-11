'use client'

/**
 * El proceso del ticket como una línea de 4 pasos (0 → 3) y, para quien tenga «Mover proceso», botones de un toque
 * para moverlo (el siguiente paso resaltado). Antes había que abrir «Editar», elegir el proceso y guardar; y el
 * capturador tenía «Enviar a revisión», que ya no: el proceso lo mueve quien revisa (sql/86).
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alerta } from '@/components/ui/Primitivos'
import { PROCESOS } from '@/lib/estados'
import { mensajeDeError } from '@/lib/errores'
import { armarReglas, type ReglasPlanas } from '@/lib/permisos/clientABAC'
import {
  confirmarDestino,
  destinosPermitidos,
  puedeMoverTicket,
  siguientePaso,
  type InfoProceso,
} from '@/lib/tickets/proceso'
import type { ProcesoTicket } from '@/lib/types'
import { BotonesProceso } from './BotonesProceso'

export function ProcesoTicketBarra({
  ticketId,
  proceso,
  duenoId,
  usuarioId,
  reglas: reglasPlanas,
}: {
  ticketId: string
  proceso: ProcesoTicket
  duenoId: string | null
  usuarioId: string | null
  reglas: ReglasPlanas
}) {
  const router = useRouter()
  const reglas = useMemo(() => armarReglas(reglasPlanas), [reglasPlanas])
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const actual = PROCESOS.findIndex((p) => p.valor === proceso)
  const puede = puedeMoverTicket(reglas, { usuario_id: duenoId, proceso }, usuarioId)
  const destinos = puede ? destinosPermitidos(reglas) : []

  async function mover(d: InfoProceso) {
    if (!confirmarDestino(d.valor, 1)) return
    setOcupado(true)
    setError(null)
    const { error: e } = await createClient().rpc('cambiar_proceso_ticket', { p_ticket_id: ticketId, p_proceso: d.valor })
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo cambiar el proceso.'))
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3" data-proceso-ticket>
      {/* Los 4 pasos: dónde está el ticket de un vistazo */}
      <ol className="grid grid-cols-4 gap-1" aria-label="Proceso del ticket">
        {PROCESOS.map((p, i) => (
          <li key={p.valor} className="flex flex-col items-center gap-1 text-center" aria-current={i === actual ? 'step' : undefined}>
            <span
              className={`h-1.5 w-full rounded-full ${i <= actual ? 'bg-brand-600' : 'bg-slate-200'}`}
              aria-hidden
            />
            <span
              className={`text-[11px] leading-tight ${
                i === actual ? 'font-bold text-slate-900' : i < actual ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              {p.numero} · {p.etiqueta}
            </span>
          </li>
        ))}
      </ol>

      {destinos.length > 0 && (
        <BotonesProceso
          destinos={destinos}
          actual={proceso}
          resaltar={siguientePaso(reglas, proceso)?.valor ?? null}
          ocupado={ocupado}
          onElegir={(d) => void mover(d)}
          grande
        />
      )}
      {error && <Alerta>{error}</Alerta>}
    </div>
  )
}
