'use client'

/**
 * Confirmación de «Eliminar por completo» (sql/119). Es una acción administrativa EN LÍNEA: no pasa por la cola sin
 * señal. Pide el motivo (mínimo 15 letras) y llama a fn_fert_eliminar_documento; la base decide permiso, turno
 * terminado y saldo.
 */

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, AreaTexto, Boton, Campo } from '@/components/ui/Primitivos'
import { createClient } from '@/lib/supabase/client'
import { mensajeDeError } from '@/lib/errores'
import {
  MINIMO_MOTIVO_ELIMINAR,
  NOMBRE_TIPO_ELIMINABLE,
  errorMotivoEliminar,
  esFaltaDeSenal,
  resumenEliminado,
  type ResultadoEliminar,
  type TipoEliminable,
} from '@/lib/fertirriego/eliminar'

export function EliminarPorCompleto({
  tipo,
  documentoId,
  descripcion,
  onCerrar,
  onEliminado,
}: {
  tipo: TipoEliminable
  documentoId: string
  descripcion?: string
  onCerrar: () => void
  onEliminado: (mensaje: string, documentoId: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  async function eliminar() {
    setError(null)
    const e = errorMotivoEliminar(motivo)
    if (e) return setError(e)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setError('Necesitas señal para eliminar.')
    setTrabajando(true)
    const { data, error: err } = await createClient().rpc('fn_fert_eliminar_documento', {
      p_tipo: tipo,
      p_documento: documentoId,
      p_motivo: motivo.trim(),
    })
    setTrabajando(false)
    if (err) return setError(esFaltaDeSenal(err) ? 'Necesitas señal para eliminar.' : mensajeDeError(err, 'No se pudo eliminar.'))
    onEliminado(resumenEliminado(data as ResultadoEliminar), documentoId)
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Eliminar por completo · ${NOMBRE_TIPO_ELIMINABLE[tipo]}`}
      pie={
        <div className="flex flex-wrap justify-end gap-2">
          <Boton variante="secundario" onClick={onCerrar} disabled={trabajando} data-cancelar-eliminar>
            Cancelar
          </Boton>
          <Boton variante="peligro" onClick={() => void eliminar()} disabled={trabajando} data-confirmar-eliminar>
            Eliminar por completo
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-3" data-eliminar-por-completo>
        {error && (
          <div className="sticky top-0 z-10" role="alert" data-error-eliminar>
            <Alerta>{error}</Alerta>
          </div>
        )}
        {descripcion && <p className="break-words text-sm font-semibold text-slate-800">{descripcion}</p>}
        <Alerta tono="ambar">Se borrará por completo y no aparecerá en ningún informe. No se puede deshacer desde la app.</Alerta>
        <Campo etiqueta="Motivo" requerido ayuda={`Mínimo ${MINIMO_MOTIVO_ELIMINAR} letras`} ayudaVisible>
          <AreaTexto value={motivo} onChange={(ev) => setMotivo(ev.target.value)} rows={3} data-motivo-eliminar />
        </Campo>
      </div>
    </Modal>
  )
}
