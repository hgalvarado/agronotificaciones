'use client'

/** Anular un registro del motor (día, recepción de diésel o movimiento). El motivo es obligatorio; la base vuelve a comprobar el permiso. */

import { useState } from 'react'
import { AreaTexto, Campo } from '@/components/ui/Primitivos'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'

export type AnulableMotor = { tipo: 'motor_registro' | 'diesel_recepcion' | 'motor_asignacion'; id: string; texto: string }

export function FormAnularMotor({
  doc,
  estacion,
  yo,
  registrar,
  puedeAceptarNegativo = false,
  onCerrar,
  onGuardado,
}: {
  doc: AnulableMotor
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  /** Solo administrador: permite anular una recepción ya gastada aunque el tanque quede en negativo (la base lo vuelve a comprobar). */
  puedeAceptarNegativo?: boolean
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [aceptaNegativo, setAceptaNegativo] = useState(false)
  return (
    <MarcoRegistro
      titulo="Anular registro del motor"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      permiso="anular"
      sinCustodia
      textoGuardar="Anular"
      construir={({ ubicacion, enNombreDe }) => {
        if (!motivo.trim()) return 'Escribe por qué se anula.'
        return [
          crearOperacion('anulacion', { estacion_id: estacion.id, documento_tipo: doc.tipo, documento_id: doc.id, motivo: motivo.trim(), ...(aceptaNegativo ? { acepta_saldo_negativo: true } : {}) }, { ubicacion, enNombreDe, resumen: `Anulación · ${doc.texto}` }),
        ]
      }}
    >
      <p className="text-sm text-slate-700">{doc.texto}. El tanque vuelve a como estaba antes de este registro.</p>
      <Campo etiqueta="Motivo" requerido>
        <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} data-motivo-anulacion />
      </Campo>
      {puedeAceptarNegativo && doc.tipo === 'diesel_recepcion' && (
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={aceptaNegativo} onChange={(e) => setAceptaNegativo(e.target.checked)} data-acepta-saldo-negativo />
          Aceptar si el tanque queda en negativo
        </label>
      )}
    </MarcoRegistro>
  )
}
