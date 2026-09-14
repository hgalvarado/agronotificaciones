'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada } from '@/components/ui/Primitivos'
import { IconLock, IconPencil, IconSend, IconTrash, IconUnlock } from '@/components/ui/Icons'
import { PROCESOS } from '@/lib/estados'
import { mensajeDeError } from '@/lib/errores'
import { ahoraIso } from '@/lib/fechas'
import type { ProcesoTicket, RolCodigo, Ticket } from '@/lib/types'

export function AccionesTicket({
  ticket,
  rol,
  nombreUsuario,
}: {
  ticket: Ticket
  rol: RolCodigo | null
  nombreUsuario: string
}) {
  const supabase = createClient()
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [cargando, setCargando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abierto = ticket.estado === 'ABIERTO'
  const esAdmin = rol === 'ADMIN'
  const esTorreOAdmin = esAdmin || rol === 'TORRE_CONTROL'
  const puedeEditar = esTorreOAdmin || abierto

  async function cerrarTicket() {
    if (!confirm('¿Cerrar este ticket? Ya no podrás editar sus horómetros ni labores.')) return
    setCargando('cerrar')
    const { error } = await supabase.rpc('cerrar_ticket', { p_ticket_id: ticket.id })
    setCargando(null)
    if (error) return setError(mensajeDeError(error, 'No se pudo cerrar el ticket.'))
    router.refresh()
  }

  async function reabrirTicket() {
    setCargando('reabrir')
    const { error } = await supabase.rpc('reabrir_ticket', { p_ticket_id: ticket.id })
    setCargando(null)
    if (error) return setError(mensajeDeError(error, 'No se pudo reabrir el ticket.'))
    router.refresh()
  }

  async function enviarARevision() {
    setCargando('revision')
    setError(null)
    const { error } = await supabase.rpc('cambiar_proceso_ticket', {
      p_ticket_id: ticket.id,
      p_proceso: 'REVISANDO' as ProcesoTicket,
    })
    setCargando(null)
    if (error) {
      return setError(
        mensajeDeError(
          error,
          'No se pudo enviar a revisión. Si el ticket está cerrado y el error persiste, falta correr la migración 32.'
        )
      )
    }
    router.refresh()
  }

  async function eliminarTicket() {
    if (
      !confirm(
        'Se eliminará el ticket junto con TODOS sus horómetros y labores. Esta acción no se puede deshacer. ¿Continuar?'
      )
    )
      return

    setCargando('eliminar')
    const { error } = await supabase.from('tickets').delete().eq('id', ticket.id)
    setCargando(null)
    if (error) return setError(mensajeDeError(error, 'No se pudo eliminar el ticket.'))
    // La lista vive en el layout, así que hay que refrescarla al volver.
    router.push('/tickets')
    router.refresh()
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {puedeEditar && (
          <Boton variante="secundario" tamano="sm" onClick={() => setEditando(true)}>
            <IconPencil className="h-4 w-4" />
            Editar
          </Boton>
        )}

        {abierto ? (
          <Boton variante="secundario" tamano="sm" onClick={cerrarTicket} disabled={cargando === 'cerrar'}>
            <IconLock className="h-4 w-4" />
            {cargando === 'cerrar' ? 'Cerrando…' : 'Cerrar ticket'}
          </Boton>
        ) : (
          esTorreOAdmin && (
            <Boton variante="secundario" tamano="sm" onClick={reabrirTicket} disabled={cargando === 'reabrir'}>
              <IconUnlock className="h-4 w-4" />
              {cargando === 'reabrir' ? 'Reabriendo…' : 'Reabrir'}
            </Boton>
          )
        )}

        {ticket.proceso === 'REGISTRADO' && (
          <Boton variante="suave" tamano="sm" onClick={enviarARevision} disabled={cargando === 'revision'}>
            <IconSend className="h-4 w-4" />
            {cargando === 'revision' ? 'Enviando…' : 'Enviar a revisión'}
          </Boton>
        )}

        {esAdmin && (
          <Boton
            variante="peligro"
            tamano="sm"
            onClick={eliminarTicket}
            disabled={cargando === 'eliminar'}
          >
            <IconTrash className="h-4 w-4" />
            {cargando === 'eliminar' ? 'Eliminando…' : 'Eliminar'}
          </Boton>
        )}
      </div>

      {error && (
        <div className="mt-2">
          <Alerta>{error}</Alerta>
        </div>
      )}

      <EditarTicketModal
        abierto={editando}
        onCerrar={() => setEditando(false)}
        ticket={ticket}
        rol={rol}
        nombreUsuario={nombreUsuario}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Modal de edición — equivale al formulario "REGISTRO TICKET"         */
/* ------------------------------------------------------------------ */

function EditarTicketModal({
  abierto,
  onCerrar,
  ticket,
  rol,
  nombreUsuario,
}: {
  abierto: boolean
  onCerrar: () => void
  ticket: Ticket
  rol: RolCodigo | null
  nombreUsuario: string
}) {
  const supabase = createClient()
  const router = useRouter()
  const [fecha, setFecha] = useState(ticket.fecha)
  const [estado, setEstado] = useState(ticket.estado)
  const [proceso, setProceso] = useState<ProcesoTicket>(ticket.proceso ?? 'REGISTRADO')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const esTorreOAdmin = rol === 'ADMIN' || rol === 'TORRE_CONTROL'

  async function guardar() {
    setGuardando(true)
    setError(null)

    // El proceso se mueve por RPC porque tiene reglas por rol; el resto
    // va por UPDATE normal y lo filtra RLS.
    if (proceso !== ticket.proceso) {
      const { error: errProceso } = await supabase.rpc('cambiar_proceso_ticket', {
        p_ticket_id: ticket.id,
        p_proceso: proceso,
      })
      if (errProceso) {
        setGuardando(false)
        return setError(mensajeDeError(errProceso, 'No se pudo cambiar el proceso.'))
      }
    }

    const cambios: Record<string, unknown> = { fecha }
    if (estado !== ticket.estado) {
      cambios.estado = estado
      if (estado === 'CERRADO') cambios.cerrado_at = ahoraIso()
      else {
        cambios.cerrado_at = null
        cambios.cerrado_by = null
      }
    }

    const { error: dbError } = await supabase.from('tickets').update(cambios).eq('id', ticket.id)

    setGuardando(false)
    if (dbError) return setError(mensajeDeError(dbError, 'No se pudo guardar el ticket.'))
    onCerrar()
    router.refresh()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Registro ticket"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Campo etiqueta="Fecha" requerido>
          <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>

        <Campo etiqueta="Ticket">
          <Entrada value={ticket.codigo} disabled />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Usuario">
            <Entrada value={nombreUsuario} disabled />
          </Campo>
          <Campo etiqueta="Departamento">
            <Entrada value={ticket.departamento ?? '—'} disabled />
          </Campo>
        </div>

        {/* Estado: Activo / Inactivo, igual que la app actual */}
        <Campo etiqueta="Estado" requerido>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { valor: 'ABIERTO' as const, etiqueta: 'Activo', color: 'bg-brand-500' },
                { valor: 'CERRADO' as const, etiqueta: 'Inactivo', color: 'bg-red-500' },
              ]
            ).map((op) => (
              <button
                key={op.valor}
                type="button"
                onClick={() => setEstado(op.valor)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition-all ${
                  estado === op.valor
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${op.color}`} />
                {op.etiqueta}
              </button>
            ))}
          </div>
        </Campo>

        {/* Proceso: los 4 pasos hacia SAP */}
        <Campo
          etiqueta="Proceso"
          ayuda={
            esTorreOAdmin
              ? undefined
              : 'Tu rol sólo puede enviar el ticket a revisión; el resto lo mueve Torre de Control.'
          }
        >
          <div className="grid grid-cols-2 gap-2">
            {PROCESOS.map((p) => {
              const bloqueado = !esTorreOAdmin && p.valor !== 'REGISTRADO' && p.valor !== 'REVISANDO'
              return (
                <button
                  key={p.valor}
                  type="button"
                  disabled={bloqueado}
                  onClick={() => setProceso(p.valor)}
                  className={`rounded-xl border px-3 py-3 text-left text-sm font-semibold transition-all disabled:opacity-40 ${
                    proceso === p.valor
                      ? 'border-brand-700 bg-brand-700 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="block text-[11px] font-bold opacity-60">{p.numero}</span>
                  {p.etiqueta}
                </button>
              )
            })}
          </div>
        </Campo>

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
