'use client'

/** Confirmación de «Eliminar» (uno o varios registros): motivo ≥ 15 letras + casilla de confirmación. La base decide el permiso. */

import { useState } from 'react'
import { Alerta, AreaTexto, Boton, Campo } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { MOTIVO_MINIMO, validarMotivo, type Registro } from '@/lib/agrometricas/registrosPura'

export function ModalEliminar({ registros, onCerrar, onConfirmar }: {
  registros: Registro[]
  onCerrar: () => void
  /** Elimina con el motivo. Debe lanzar Error con mensaje en español si falla. */
  onConfirmar: (motivo: string) => Promise<void>
}) {
  const [texto, setTexto] = useState('')
  const [seguro, setSeguro] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const m = validarMotivo(texto)
  const n = registros.length

  async function eliminar() {
    setTrabajando(true); setError(null)
    try { await onConfirmar(m.motivo) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar. Intenta de nuevo.'); setTrabajando(false) }
  }

  return (
    <Modal abierto onCerrar={trabajando ? () => {} : onCerrar} titulo={n === 1 ? 'Eliminar registro' : `Eliminar ${n} registros`}
      pie={
        <div className="flex flex-wrap justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={onCerrar} disabled={trabajando}>Cancelar</Boton>
          <Boton type="button" variante="peligro" onClick={eliminar} disabled={!m.ok || !seguro || trabajando} data-confirmar-eliminar>
            {trabajando ? 'Eliminando…' : 'Eliminar'}
          </Boton>
        </div>
      }>
      <div className="flex flex-col gap-3" data-modal-eliminar>
        {error && <Alerta tono="rojo">{error}</Alerta>}
        <Alerta tono="ambar">
          {n === 1
            ? `Se eliminará el registro de ${registros[0].turno} del ${registros[0].fecha}.`
            : `Se eliminarán ${n} registros.`} Deja de verse en la app y AGL conserva la copia.
        </Alerta>
        <Campo etiqueta="Motivo" requerido error={texto && !m.ok ? `Faltan ${m.faltan} letras (mínimo ${MOTIVO_MINIMO}).` : null}>
          <AreaTexto rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Explica por qué se elimina" data-motivo />
        </Campo>
        <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700">
          <input type="checkbox" className="h-5 w-5" checked={seguro} onChange={(e) => setSeguro(e.target.checked)} data-seguro />
          Entiendo que esta acción no se deshace desde la app.
        </label>
      </div>
    </Modal>
  )
}
