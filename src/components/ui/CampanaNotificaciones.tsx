'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { IconCampana, IconTicket, IconX } from './Icons'
import { formatearFechaHora } from '@/lib/estados'

type Aviso = {
  id: number
  tipo: 'TICKET_CERRADO' | 'TICKET_REVISION' | 'TICKET_REABIERTO'
  mensaje: string
  ticket_id: string | null
  created_at: string
}

const TONOS: Record<Aviso['tipo'], { etiqueta: string; clase: string }> = {
  TICKET_CERRADO: { etiqueta: 'Cerrado', clase: 'bg-slate-100 text-slate-600' },
  TICKET_REVISION: { etiqueta: 'A revisión', clase: 'bg-blue-50 text-blue-700' },
  TICKET_REABIERTO: { etiqueta: 'Reabierto', clase: 'bg-amber-50 text-amber-700' },
}

/** Cada cuánto se vuelve a preguntar por el contador, en milisegundos. */
const INTERVALO = 60_000

/**
 * Campana de avisos.
 *
 * `compacta` es la del encabezado del celular: el panel se manda al body con
 * un portal porque el encabezado tiene `backdrop-blur`, y cualquier ancestro
 * con filtro o transform se convierte en el marco de referencia de los
 * elementos `fixed` — el mismo problema que nos recortaba los modales.
 * Sin `compacta` es la de la barra lateral de escritorio, donde el panel se
 * ancla al botón y se abre hacia arriba.
 */
export function CampanaNotificaciones({ compacta = false }: { compacta?: boolean }) {
  const supabase = createClient()
  const [pendientes, setPendientes] = useState(0)
  const [abierto, setAbierto] = useState(false)
  const [avisos, setAvisos] = useState<Aviso[] | null>(null)
  const contenedor = useRef<HTMLDivElement>(null)
  // El panel del celular vive en el body por el portal, así que no está
  // dentro de `contenedor`: sin su propia referencia, tocar el panel para
  // desplazarlo contaría como un clic de afuera y lo cerraría.
  const refPanel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // La función va DENTRO del efecto a propósito. La regla
    // `react-hooks/set-state-in-effect` de Next 16 marca cualquier llamada
    // que actualice estado de forma sincrónica en el cuerpo del efecto;
    // declarada aquí, el setState ocurre después del await y la regla queda
    // conforme. De paso se evita depender de la identidad del cliente.
    let vivo = true

    // Sólo se pide el número, no la lista: es una sola función en la base y
    // se puede consultar cada minuto sin que pese.
    async function contar() {
      const { data } = await supabase.rpc('fn_notificaciones_pendientes')
      if (vivo && typeof data === 'number') setPendientes(data)
    }

    contar()
    const id = setInterval(contar, INTERVALO)

    // Al volver a la pestaña se refresca de una vez, sin esperar el minuto:
    // es justo el momento en que uno mira la campana.
    const alVolver = () => {
      if (document.visibilityState === 'visible') contar()
    }
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      vivo = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [supabase])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      const destino = e.target as Node
      if (contenedor.current?.contains(destino)) return
      if (refPanel.current?.contains(destino)) return
      setAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  async function alternar() {
    if (abierto) {
      setAbierto(false)
      return
    }
    setAbierto(true)
    setAvisos(null)

    const { data } = await supabase
      .from('notificaciones')
      .select('id, tipo, mensaje, ticket_id, created_at')
      .order('created_at', { ascending: false })
      .limit(30)
    setAvisos((data as Aviso[] | null) ?? [])

    // Abrir el panel cuenta como haberlas visto. La marca se guarda por
    // usuario en la base, así que si las ves en la computadora el puntito
    // tampoco vuelve a salir en el teléfono.
    if (pendientes > 0) {
      setPendientes(0)
      await supabase.rpc('fn_marcar_notificaciones_leidas')
    }
  }

  const clasesPanel = compacta
    ? 'fixed inset-x-3 top-16 z-50 max-h-[70svh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-raised)]'
    : 'absolute bottom-full left-0 z-50 mb-2 max-h-[70svh] w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-raised)]'

  const panel = !abierto ? null : (
    <>
      {compacta && <div className="fixed inset-0 z-40 bg-slate-900/20" aria-hidden="true" />}
      <div ref={refPanel} className={clasesPanel}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-bold text-slate-900">Avisos</p>
          <button
            onClick={() => setAbierto(false)}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100"
            aria-label="Cerrar avisos"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(70svh-3.25rem)] overflow-y-auto overscroll-contain">
          {avisos === null ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">Cargando…</p>
          ) : avisos.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              Nada nuevo. Aquí van a caer los tickets que se cierren o se manden a revisión.
            </p>
          ) : (
            avisos.map((a) => {
              const tono = TONOS[a.tipo] ?? TONOS.TICKET_CERRADO
              const cuerpo = (
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0 text-slate-300">
                    <IconTicket className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-slate-700">{a.mensaje}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                      <span className={`rounded px-1.5 py-0.5 font-semibold ${tono.clase}`}>
                        {tono.etiqueta}
                      </span>
                      {formatearFechaHora(a.created_at)}
                    </p>
                  </div>
                </div>
              )
              return a.ticket_id ? (
                <Link
                  key={a.id}
                  href={`/tickets/${a.ticket_id}`}
                  onClick={() => setAbierto(false)}
                  className="block border-b border-slate-50 px-4 py-3 transition-colors last:border-0 hover:bg-slate-50"
                >
                  {cuerpo}
                </Link>
              ) : (
                <div key={a.id} className="border-b border-slate-50 px-4 py-3 last:border-0">
                  {cuerpo}
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )

  return (
    <div ref={contenedor} className="relative">
      <button
        onClick={alternar}
        className="relative rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        aria-label={pendientes > 0 ? `${pendientes} avisos sin leer` : 'Avisos'}
        title="Avisos"
      >
        <IconCampana />
        {pendientes > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-white">
            {pendientes > 99 ? '99+' : pendientes}
          </span>
        )}
      </button>

      {compacta && panel && typeof document !== 'undefined'
        ? createPortal(panel, document.body)
        : panel}
    </div>
  )
}
