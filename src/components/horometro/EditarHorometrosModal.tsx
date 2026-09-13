'use client'

/**
 * Cambio en masa de horómetros.
 *
 * Sólo los campos que tiene sentido repetir en varias filas: el turno, el
 * operador y el equipo. Las lecturas del horómetro son de cada registro y
 * ponerlas aquí sería invitar a pisar veinte lecturas con una sola.
 *
 * Un campo en blanco significa «no lo toques». Es la única forma de que
 * un cambio masivo no destruya lo que no se mencionó.
 */

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Selector } from '@/components/ui/Primitivos'
import { mensajeDeError } from '@/lib/errores'
import type { Equipo, Operador } from '@/lib/types'

export function EditarHorometrosModal({
  ids,
  operadores,
  equipos,
  onCerrar,
  onGuardado,
}: {
  ids: string[] | null
  operadores: Operador[]
  equipos: Equipo[]
  onCerrar: () => void
  onGuardado: () => void | Promise<void>
}) {
  return (
    <Modal abierto={ids !== null} onCerrar={onCerrar} titulo="Editar horómetros">
      {ids !== null && (
        // `key` remonta el formulario en cada apertura: así los campos
        // arrancan vacíos sin copiar props a estado en un efecto, que es
        // lo que React 19 prohíbe.
        <Formulario
          key={ids.join(',')}
          ids={ids}
          operadores={operadores}
          equipos={equipos}
          onCerrar={onCerrar}
          onGuardado={onGuardado}
        />
      )}
    </Modal>
  )
}

function Formulario({
  ids,
  operadores,
  equipos,
  onCerrar,
  onGuardado,
}: {
  ids: string[]
  operadores: Operador[]
  equipos: Equipo[]
  onCerrar: () => void
  onGuardado: () => void | Promise<void>
}) {
  const supabase = createClient()
  const [turno, setTurno] = useState('')
  const [operadorId, setOperadorId] = useState('')
  const [equipoId, setEquipoId] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    const campos: Record<string, unknown> = {}
    if (turno) campos.turno = turno
    if (operadorId) campos.operador_id = operadorId === '__ninguno__' ? null : operadorId
    if (equipoId) campos.equipo_id = equipoId

    if (Object.keys(campos).length === 0) {
      return setError('Elige al menos un campo que cambiar.')
    }

    setError(null)
    setGuardando(true)
    const { error: e } = await supabase.from('horometros').update(campos).in('id', ids)
    setGuardando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron guardar los cambios.'))
    await onGuardado()
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alerta>{error}</Alerta>}

      <p className="text-sm text-slate-500">
        El cambio se aplica a {ids.length} {ids.length === 1 ? 'horómetro' : 'horómetros'}. Lo que
        dejes en blanco no se toca.
      </p>

      <Campo etiqueta="Turno">
        <Selector value={turno} onChange={(e) => setTurno(e.target.value)}>
          <option value="">No cambiar</option>
          <option value="DIURNO">Diurno</option>
          <option value="NOCTURNO">Nocturno</option>
        </Selector>
      </Campo>

      <Campo etiqueta="Operador">
        <Selector value={operadorId} onChange={(e) => setOperadorId(e.target.value)}>
          <option value="">No cambiar</option>
          <option value="__ninguno__">— Sin operador —</option>
          {operadores.map((op) => (
            <option key={op.id} value={op.id}>
              {[op.codigo, op.nombre].filter(Boolean).join(' ')}
            </option>
          ))}
        </Selector>
      </Campo>

      <Campo
        etiqueta="Equipo"
        ayuda="Cambiar el equipo recalcula el comparativo de los dos equipos implicados."
      >
        <Selector value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
          <option value="">No cambiar</option>
          {equipos.map((eq) => (
            <option key={eq.id} value={eq.id}>
              {eq.codigo}
            </option>
          ))}
        </Selector>
      </Campo>

      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </Boton>
        <Boton className="flex-1" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Boton>
      </div>
    </div>
  )
}
