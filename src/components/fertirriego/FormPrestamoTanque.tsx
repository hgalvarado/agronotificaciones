'use client'

/**
 * Prestar el tanque entre Vegetativa y Generativa (Calcio nunca): «esta estación no usa X estos días, su tanque llena Y».
 * Necesita señal (lo ve AGL). Solo ofrece las soluciones que AGL marcó como prestables entre sí.
 */

import { useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada } from '@/components/ui/Primitivos'
import { mensajeDeError } from '@/lib/errores'
import { hoyIso } from '@/lib/fechas/zona'
import { sePuedePrestar, type CapacidadSolucion } from '@/lib/fertirriego/capacidad'
import type { Estacion, Material } from '@/lib/fertirriego/tipos'

export function FormPrestamoTanque({
  supabase,
  estacion,
  caps,
  materiales,
  onCerrar,
  onHecho,
}: {
  supabase: SupabaseClient
  estacion: Estacion
  caps: Map<string, CapacidadSolucion>
  materiales: Material[]
  onCerrar: () => void
  onHecho: (m: string) => void
}) {
  const nombre = (id: string) => materiales.find((m) => m.id === id)?.descripcion ?? 'Solución'
  // Soluciones de esta estación que se pueden prestar (la pareja también está en la estación)
  const prestables = useMemo(() => [...caps.values()].filter((c) => c.prestable_con && sePuedePrestar(caps, c.material_id, c.prestable_con)), [caps])
  const vigente = prestables.find((c) => c.cede_a)
  const [cede, setCede] = useState(vigente?.material_id ?? prestables[0]?.material_id ?? '')
  const [hasta, setHasta] = useState(vigente?.prestamo_hasta ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recibe = caps.get(cede)?.prestable_con ?? ''

  async function enviar(activo: boolean, cedeId: string, recibeId: string) {
    setGuardando(true)
    setError(null)
    const { error: e } = await supabase.rpc('fn_fert_capacidad_prestamo', {
      p_estacion: estacion.id,
      p_cede: cedeId,
      p_recibe: activo ? recibeId : null,
      p_activo: activo,
      p_hasta: activo && hasta ? hasta : null,
      p_motivo: null,
    })
    setGuardando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar.'))
    onHecho(activo ? `El tanque de ${nombre(cedeId)} llena ${nombre(recibeId)}.` : 'Se quitó el préstamo de tanque.')
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Prestar tanque · ${estacion.nombre}`}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          {vigente && (
            <Boton variante="secundario" className="flex-1" onClick={() => void enviar(false, vigente.material_id, '')} disabled={guardando} data-quitar-prestamo>
              Quitar
            </Boton>
          )}
          <Boton className="flex-1" onClick={() => void enviar(true, cede, recibe)} disabled={guardando || !cede || !recibe} data-guardar-prestamo>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {prestables.length === 0 ? (
          <Alerta tono="ambar">Esta estación no tiene dos soluciones que se puedan prestar. Calcio nunca se presta.</Alerta>
        ) : (
          <>
            <Campo etiqueta="¿Cuál tanque se presta?" requerido>
              <div className="flex flex-wrap gap-2" role="group">
                {prestables.map((c) => (
                  <button
                    key={c.material_id}
                    type="button"
                    aria-pressed={cede === c.material_id}
                    onClick={() => setCede(c.material_id)}
                    className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset ${cede === c.material_id ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'}`}
                  >
                    {nombre(c.material_id)}
                  </button>
                ))}
              </div>
            </Campo>
            <p className="text-sm text-slate-700" data-resumen-prestamo>
              El tanque de <strong>{nombre(cede)}</strong> llenará <strong>{recibe ? nombre(recibe) : '—'}</strong>.
            </p>
            <Campo etiqueta="Hasta (opcional)">
              <Entrada type="date" min={hoyIso()} value={hasta} onChange={(e) => setHasta(e.target.value)} data-prestamo-hasta />
            </Campo>
          </>
        )}
        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
