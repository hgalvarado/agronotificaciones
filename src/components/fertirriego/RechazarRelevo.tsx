'use client'

/** «No la recibo»: quien iba a recibir la estación la rechaza con motivo; vuelve a quien la entregó. */

import { useState } from 'react'
import { AreaTexto, Campo } from '@/components/ui/Primitivos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona, Relevo } from '@/lib/fertirriego/tipos'
import { MarcoRegistro } from './MarcoRegistro'

export function RechazarRelevo({
  estacion,
  yo,
  relevo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estacion: Estacion
  yo: Persona
  relevo: Relevo
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  return (
    <MarcoRegistro
      titulo="No recibir la estación"
      estacion={estacion}
      yo={yo}
      sinCustodia
      permiso="relevo"
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      textoGuardar="No la recibo"
      construir={({ ubicacion }) =>
        motivo.trim()
          ? [crearOperacion('relevo_rechazar', { estacion_id: estacion.id, relevo_id: relevo.id, motivo: motivo.trim() }, { ubicacion, resumen: `No recibió la estación · ${estacion.nombre}` })]
          : 'Escribe por qué no recibes la estación (queda para que el jefe lo revise).'
      }
    >
      <p className="text-sm text-slate-600">
        La estación vuelve a {relevo.entrega ?? 'quien la entregó'}. El jefe verá el motivo.
      </p>
      <Campo etiqueta="Motivo" requerido>
        <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="Ej. faltan productos, el tanque está vacío…" data-motivo-rechazo />
      </Campo>
    </MarcoRegistro>
  )
}
