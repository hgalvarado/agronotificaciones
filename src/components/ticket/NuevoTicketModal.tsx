'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { mensajeDeError } from '@/lib/errores'

export type UsuarioTicket = { id: string; nombre: string; departamento?: string | null }

/** Quita acentos y espacios para el código del ticket. */
function slugNombre(nombre: string) {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
}

// Código legible: aaaammdd-nombrecompleto-[hash]
// Ej. 20260907-henryalvarado-[ca4bee00]
function generarCodigoTicket(nombreUsuario: string, fecha: string) {
  const slug = slugNombre(nombreUsuario)
  const compacta = fecha.replaceAll('-', '')
  const sufijo = Math.random().toString(16).slice(2, 10).padEnd(8, '0')
  return `${compacta}-${slug}-[${sufijo}]`
}

export function NuevoTicketModal({
  abierto,
  onCerrar,
  usuarioId,
  nombreUsuario,
  departamento,
  temporadaActivaId,
  usuarios = [],
  temporadas = [],
  puedeOtroUsuario = false,
}: {
  abierto: boolean
  onCerrar: () => void
  usuarioId: string
  nombreUsuario: string
  departamento: string | null
  temporadaActivaId: string | null
  /** Para el ticket histórico: a nombre de quién se crea. */
  usuarios?: UsuarioTicket[]
  temporadas?: { id: string; nombre: string; activa: boolean }[]
  /** Sólo Administrador y Torre de Control pueden crear a nombre de otro. */
  puedeOtroUsuario?: boolean
}) {
  const supabase = createClient()
  const router = useRouter()
  const hoy = new Date().toISOString().slice(0, 10)
  const [fecha, setFecha] = useState(hoy)
  const [duenoId, setDuenoId] = useState(usuarioId)
  const [temporadaId, setTemporadaId] = useState(temporadaActivaId ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Una jornada de hace tres meses es un ticket histórico: se crea igual,
  // pero conviene entrar a su detalle para cargarle el Excel en vez de
  // capturar horómetro por horómetro.
  const esHistorico = fecha < hoy

  const dueno = usuarios.find((u) => u.id === duenoId)
  const nombreDueno = dueno?.nombre ?? nombreUsuario
  const departamentoDueno =
    duenoId === usuarioId ? departamento : (dueno?.departamento ?? null)

  async function crear() {
    if (!fecha) return setError('Escribe la fecha de la jornada.')
    setGuardando(true)
    setError(null)

    const { data, error: dbError } = await supabase
      .from('tickets')
      .insert({
        codigo: generarCodigoTicket(nombreDueno, fecha),
        fecha,
        usuario_id: duenoId,
        departamento: departamentoDueno,
        // La temporada del histórico es la que corría ESE día, no la
        // activa de hoy: si no, el avance del 15 de abril entraría al
        // plan de la temporada nueva.
        temporada_id: temporadaId || null,
      })
      .select('id')
      .single()

    setGuardando(false)
    if (dbError) {
      setError(mensajeDeError(dbError, 'No se pudo crear el ticket.'))
      return
    }
    onCerrar()
    // En un ticket del día se entra directo a capturar el primer
    // horómetro; en uno histórico, al detalle, que es donde está la
    // carga por Excel.
    router.push(esHistorico ? `/tickets/${data.id}` : `/tickets/${data.id}/horometros/nuevo`)
    router.refresh()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={esHistorico ? 'Generar ticket histórico' : 'Generar ticket'}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={crear} disabled={guardando}>
            {guardando ? 'Creando…' : esHistorico ? 'Crear histórico' : 'Crear ticket'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          El ticket agrupa toda la maquinaria que tuvo a cargo una persona en una jornada. Para
          cargar una jornada vieja, escribe su fecha y elige de quién fue.
        </p>

        <Campo etiqueta="Fecha de la jornada" requerido>
          <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
        </Campo>

        {/* A nombre de quién. Sólo Administrador y Torre de Control lo
            eligen; el resto crea a nombre propio, que es lo que la base
            permite de todos modos. */}
        {puedeOtroUsuario && usuarios.length > 0 ? (
          <Campo
            etiqueta="A nombre de"
            ayuda="La jornada queda registrada a nombre de esta persona, no del que la está capturando."
          >
            <Selector value={duenoId} onChange={(e) => setDuenoId(e.target.value)}>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                  {u.id === usuarioId ? ' (yo)' : ''}
                </option>
              ))}
            </Selector>
          </Campo>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Usuario">
              <Entrada value={nombreUsuario} disabled />
            </Campo>
            <Campo etiqueta="Departamento">
              <Entrada value={departamento ?? '—'} disabled />
            </Campo>
          </div>
        )}

        {temporadas.length > 1 && (
          <Campo
            etiqueta="Temporada"
            ayuda="La que corría ese día. En una jornada vieja no suele ser la activa de hoy."
          >
            <Selector value={temporadaId} onChange={(e) => setTemporadaId(e.target.value)}>
              <option value="">Sin temporada</option>
              {temporadas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activa ? ' (activa)' : ''}
                </option>
              ))}
            </Selector>
          </Campo>
        )}

        {esHistorico && (
          <Alerta tono="ambar">
            Es una jornada de una fecha pasada. Al crearlo se abre su detalle, donde puedes cargar
            los horómetros y las labores de golpe desde Excel.
          </Alerta>
        )}

        <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-inset ring-slate-200/70">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Código del ticket
          </p>
          <p className="mt-0.5 font-mono text-sm text-slate-700">
            {fecha.replaceAll('-', '')}-{slugNombre(nombreDueno)}-[…]
          </p>
        </div>

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
