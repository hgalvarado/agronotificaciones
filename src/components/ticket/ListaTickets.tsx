'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Alerta, Boton, Campo, Insignia, EstadoVacio, Selector } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { IconCheck, IconInbox, IconPlus, IconSearch, IconX } from '@/components/ui/Icons'
import { PROCESOS, estadoInfo, formatearFecha, procesoInfo } from '@/lib/estados'
import { NuevoTicketModal, type UsuarioTicket } from './NuevoTicketModal'
import type { EstadoTicket, ProcesoTicket, Ticket } from '@/lib/types'

export function ListaTickets({
  tickets,
  usuarioId,
  nombreUsuario,
  departamento,
  temporadaActivaId,
  usuarios = [],
  temporadas = [],
  puedeLotes = false,
}: {
  tickets: Ticket[]
  usuarioId: string
  nombreUsuario: string
  departamento: string | null
  temporadaActivaId: string | null
  /** Para el ticket histórico: a nombre de quién se puede crear. */
  usuarios?: UsuarioTicket[]
  temporadas?: { id: string; nombre: string; activa: boolean }[]
  /** Admin y Torre de Control pueden trabajar varios tickets a la vez. */
  puedeLotes?: boolean
}) {
  const params = useParams<{ ticketId?: string }>()
  const [busqueda, setBusqueda] = useState('')
  const [abrirNuevo, setAbrirNuevo] = useState(false)
  const [modoSeleccion, setModoSeleccion] = useState(false)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [abrirLote, setAbrirLote] = useState(false)

  function alternarMarcado(id: string) {
    setMarcados((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  function salirDeSeleccion() {
    setModoSeleccion(false)
    setMarcados(new Set())
  }

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return tickets
    return tickets.filter(
      (t) => t.codigo.toLowerCase().includes(q) || (t.departamento ?? '').toLowerCase().includes(q)
    )
  }, [tickets, busqueda])

  // Agrupado por proceso, igual que en la app actual de AppSheet
  const grupos = useMemo(
    () =>
      PROCESOS.map((p) => ({
        ...p,
        tickets: filtrados.filter((t) => (t.proceso ?? 'REGISTRADO') === p.valor),
      })).filter((g) => g.tickets.length > 0),
    [filtrados]
  )

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-md lg:px-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold text-slate-900">
            {modoSeleccion ? `${marcados.size} seleccionados` : 'Tickets'}
          </h1>
          <div className="flex items-center gap-1.5">
            {puedeLotes &&
              (modoSeleccion ? (
                <button
                  onClick={salirDeSeleccion}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100"
                >
                  <IconX className="h-4 w-4" />
                  Salir
                </button>
              ) : (
                <button
                  onClick={() => setModoSeleccion(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100"
                  title="Seleccionar varios"
                >
                  <IconCheck className="h-4 w-4" />
                  Varios
                </button>
              ))}

            {!modoSeleccion && (
              <button
                onClick={() => setAbrirNuevo(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white shadow-[var(--shadow-raised)] transition-all hover:bg-brand-800 active:scale-[0.98]"
              >
                <IconPlus className="h-4 w-4" />
                Generar
              </button>
            )}
          </div>
        </div>

        {modoSeleccion && (
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => setMarcados(new Set(filtrados.map((t) => t.id)))}
              className="rounded-md px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
            >
              Seleccionar los {filtrados.length} visibles
            </button>
            {marcados.size > 0 && (
              <button
                onClick={() => setMarcados(new Set())}
                className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Limpiar
              </button>
            )}
          </div>
        )}

        <div className="relative mt-3">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar ticket…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm transition-colors placeholder:text-slate-300 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>
      </div>

      <div className="scroll-suave flex-1 overflow-y-auto px-3 py-3 lg:px-3">
        {grupos.length === 0 ? (
          <EstadoVacio
            icono={<IconInbox />}
            titulo={busqueda ? 'Sin resultados' : 'Todavía no hay tickets'}
            descripcion={
              busqueda
                ? 'Prueba con otro código o departamento.'
                : 'Genera el primer ticket de la jornada con el botón de arriba.'
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {grupos.map((grupo) => (
              <section key={grupo.valor}>
                <div className="flex items-center gap-2 px-1 pb-1.5">
                  <Insignia tono={grupo.tono} punto>
                    {grupo.numero} · {grupo.etiqueta}
                  </Insignia>
                  <span className="text-xs font-semibold text-slate-400">{grupo.tickets.length}</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  {grupo.tickets.map((ticket) => (
                    <FilaTicket
                      key={ticket.id}
                      ticket={ticket}
                      seleccionado={params?.ticketId === ticket.id}
                      modoSeleccion={modoSeleccion}
                      marcado={marcados.has(ticket.id)}
                      onMarcar={() => alternarMarcado(ticket.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {modoSeleccion && marcados.size > 0 && (
        <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/95 p-3 backdrop-blur-md">
          <Boton className="w-full" onClick={() => setAbrirLote(true)}>
            Cambiar estado o proceso ({marcados.size})
          </Boton>
        </div>
      )}

      <AccionesLoteModal
        abierto={abrirLote}
        cantidad={marcados.size}
        ticketIds={[...marcados]}
        onCerrar={() => setAbrirLote(false)}
        onListo={salirDeSeleccion}
      />

      <NuevoTicketModal
        abierto={abrirNuevo}
        onCerrar={() => setAbrirNuevo(false)}
        usuarioId={usuarioId}
        nombreUsuario={nombreUsuario}
        departamento={departamento}
        temporadaActivaId={temporadaActivaId}
        usuarios={usuarios}
        temporadas={temporadas}
        puedeOtroUsuario={puedeLotes}
      />
    </>
  )
}

function FilaTicket({
  ticket,
  seleccionado,
  modoSeleccion,
  marcado,
  onMarcar,
}: {
  ticket: Ticket
  seleccionado: boolean
  modoSeleccion: boolean
  marcado: boolean
  onMarcar: () => void
}) {
  const estado = estadoInfo(ticket.estado)
  const proceso = procesoInfo(ticket.proceso)

  const clases = `group block rounded-xl border px-3.5 py-3 transition-all ${
    marcado
      ? 'border-brand-600 bg-brand-50 shadow-[var(--shadow-card)]'
      : seleccionado
        ? 'border-brand-600/30 bg-brand-50 shadow-[var(--shadow-card)]'
        : 'border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-[var(--shadow-card)]'
  }`

  // En modo selección la fila deja de navegar y sólo marca/desmarca.
  const contenido = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p
          className={`truncate text-sm font-semibold ${
            seleccionado ? 'text-brand-900' : 'text-slate-900'
          }`}
        >
          {ticket.codigo}
        </p>
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
            ticket.estado === 'ABIERTO' ? 'bg-brand-500' : 'bg-slate-300'
          }`}
          title={estado.etiqueta}
        />
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
        <span>{formatearFecha(ticket.fecha)}</span>
        {ticket.departamento && (
          <>
            <span className="text-slate-200">·</span>
            <span className="truncate">{ticket.departamento}</span>
          </>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
        <Insignia tono={proceso.tono}>{proceso.etiqueta}</Insignia>
      </div>
    </>
  )

  if (modoSeleccion) {
    return (
      <button type="button" onClick={onMarcar} className={`${clases} w-full text-left`}>
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
              marcado ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
            }`}
          >
            {marcado && <IconCheck className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0 flex-1">{contenido}</span>
        </div>
      </button>
    )
  }

  return (
    <Link href={`/tickets/${ticket.id}`} className={clases}>
      {contenido}
    </Link>
  )
}

/* ------------------------------------------------------------------ */
/* Cambio de estado y proceso en bloque                                */
/* ------------------------------------------------------------------ */

function AccionesLoteModal({
  abierto,
  cantidad,
  ticketIds,
  onCerrar,
  onListo,
}: {
  abierto: boolean
  cantidad: number
  ticketIds: string[]
  onCerrar: () => void
  onListo: () => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const [estado, setEstado] = useState('')
  const [proceso, setProceso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function aplicar() {
    if (!estado && !proceso) return setError('Elige al menos un cambio.')

    setError(null)
    setGuardando(true)
    const { data, error: e } = await supabase.rpc('actualizar_tickets_masivo', {
      p_ticket_ids: ticketIds,
      p_estado: estado ? (estado as EstadoTicket) : null,
      p_proceso: proceso ? (proceso as ProcesoTicket) : null,
    })
    setGuardando(false)
    if (e) return setError(e.message)

    alert(`Se actualizaron ${data ?? 0} tickets.`)
    setEstado('')
    setProceso('')
    onCerrar()
    onListo()
    router.refresh()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={`Actualizar ${cantidad} tickets`}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={aplicar} disabled={guardando}>
            {guardando ? 'Aplicando…' : 'Aplicar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          Los campos que dejes en «Sin cambio» se quedan como están en cada ticket.
        </p>

        <Campo etiqueta="Estado">
          <Selector value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Sin cambio</option>
            <option value="ABIERTO">Activo</option>
            <option value="CERRADO">Cerrado</option>
          </Selector>
        </Campo>

        <Campo etiqueta="Proceso">
          <Selector value={proceso} onChange={(e) => setProceso(e.target.value)}>
            <option value="">Sin cambio</option>
            {PROCESOS.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.numero} · {p.etiqueta}
              </option>
            ))}
          </Selector>
        </Campo>

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
