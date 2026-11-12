'use client'

/**
 * El jefe pone la estación a cargo de una persona (arranque, o nadie llegó a recibirla). Necesita señal: es una
 * decisión que no puede quedar en un solo teléfono. Queda en la bitácora de relevos con su motivo.
 */

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Modal } from '@/components/ui/Modal'
import { Alerta, AreaTexto, Boton, Campo } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import type { Estacion } from '@/lib/fertirriego/tipos'

export function AsignarCustodia({
  supabase,
  estacion,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient
  estacion: Estacion
  onCerrar: () => void
  onHecho: (m: string) => void
}) {
  const [persona, setPersona] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    if (!persona) return setError('Elige a la persona.')
    if (!motivo.trim()) return setError('Escribe el motivo.')
    setGuardando(true)
    setError(null)
    const { error: e } = await supabase.rpc('fn_fert_asignar_custodia', { p_estacion: estacion.id, p_perfil: persona, p_motivo: motivo.trim() })
    setGuardando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo asignar.'))
    onHecho(`La estación quedó a cargo de ${estacion.personas.find((p) => p.id === persona)?.nombre ?? 'la persona elegida'}.`)
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Asignar ${estacion.nombre}`}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={() => void guardar()} disabled={guardando} data-guardar-custodia>
            {guardando ? 'Asignando…' : 'Asignar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {estacion.personas.length === 0 ? (
          <Alerta tono="ambar">Nadie está asignado a esta estación. Asígnalo primero en Usuarios (estaciones de riego).</Alerta>
        ) : (
          <Campo etiqueta="¿Quién queda a cargo?" requerido>
            <div data-selector-custodio>
              <SelectorBuscable
                valor={persona}
                opciones={estacion.personas.map((p) => ({ id: p.id, titulo: p.nombre, subtitulo: p.id === estacion.custodio_id ? 'la tiene ahora' : undefined }))}
                onCambiar={setPersona}
                placeholder="Elegir persona…"
                etiquetaBusqueda="Buscar persona"
              />
            </div>
          </Campo>
        )}
        <Campo etiqueta="Motivo" requerido>
          <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Arranque de Fertirriego, nadie recibió el relevo…" data-motivo-custodia />
        </Campo>
        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
