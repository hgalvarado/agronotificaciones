'use client'

/**
 * sql/162 · Cambiar la capacidad de almacenaje de una estación, por solución (pedido 2026-11-27: «que lo puedan modificar
 * los usuarios»). Vacío o «Estándar» = vuelve al valor estándar. Necesita señal (lo lee AGL). Permiso: «Capacidad de almacenaje».
 */

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo } from '@/components/ui/Primitivos'
import { mensajeDeError } from '@/lib/errores'
import type { CapacidadSolucion } from '@/lib/fertirriego/capacidad'
import type { Estacion, Material } from '@/lib/fertirriego/tipos'

const numero = (t: string): number | null => (t.trim() ? Number(t.replace(/,/g, '')) : null)

export function FormCapacidadEstacion({
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
  const mat = (id: string) => materiales.find((m) => m.id === id)
  const filas = [...caps.values()].sort((a, b) => (mat(a.material_id)?.descripcion ?? '').localeCompare(mat(b.material_id)?.descripcion ?? '', 'es'))
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(filas.map((c) => [c.material_id, String(c.capacidad_base)])))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    setError(null)
    const cambios = filas.filter((c) => numero(valores[c.material_id] ?? '') !== c.capacidad_base)
    for (const c of cambios) {
      const n = numero(valores[c.material_id] ?? '')
      if (n !== null && (!Number.isFinite(n) || n < 0)) return setError(`${mat(c.material_id)?.descripcion ?? 'Solución'}: número igual o mayor que 0.`)
    }
    if (cambios.length === 0) return onCerrar()
    setGuardando(true)
    for (const c of cambios) {
      const { error: e } = await supabase.rpc('fn_fert_capacidad_guardar', {
        p_estacion: estacion.id,
        p_material: c.material_id,
        p_capacidad: numero(valores[c.material_id] ?? ''),
      })
      if (e) {
        setGuardando(false)
        return setError(mensajeDeError(e, 'No se pudo guardar.'))
      }
    }
    setGuardando(false)
    onHecho(cambios.length === 1 ? 'Capacidad guardada.' : `${cambios.length} capacidades guardadas.`)
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Capacidad · ${estacion.nombre}`}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={() => void guardar()} disabled={guardando} data-guardar-capacidad>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-form-capacidad>
        <p className="text-sm text-slate-700">Cuánto cabe en el tanque. Vacío = estándar.</p>
        {filas.map((c) => ( // ui-ok: a lo sumo 3 soluciones (Calcio, Vegetativa, Generativa)
          <Campo key={c.material_id} etiqueta={`${mat(c.material_id)?.descripcion ?? 'Solución'} (${mat(c.material_id)?.unidad ?? 'L'})`}>
            <div className="flex items-center gap-2">
              <input
                inputMode="decimal"
                value={valores[c.material_id] ?? ''}
                onChange={(e) => setValores((v) => ({ ...v, [c.material_id]: e.target.value.replace(/[^\d.,]/g, '') }))}
                aria-label={`Capacidad de ${mat(c.material_id)?.descripcion ?? 'la solución'}`}
                data-capacidad-material={mat(c.material_id)?.codigo ?? c.material_id}
                className="min-h-11 w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none"
              />
              <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => setValores((v) => ({ ...v, [c.material_id]: '' }))} disabled={guardando}>
                Estándar
              </Boton>
            </div>
          </Campo>
        ))}
        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
