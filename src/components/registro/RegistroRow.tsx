'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Registro, RegistroDetalle } from '@/lib/types'

export function RegistroRow({
  registro,
  detalle,
  ticketAbierto,
}: {
  registro: Registro
  detalle: RegistroDetalle[]
  ticketAbierto: boolean
}) {
  const supabase = createClient()
  const router = useRouter()
  const [duplicando, setDuplicando] = useState(false)

  async function handleDuplicar() {
    setDuplicando(true)
    const { error } = await supabase.rpc('duplicar_registro', {
      p_registro_id: registro.id,
      p_copiar_detalle: true,
    })
    setDuplicando(false)
    if (error) {
      alert(error.message)
      return
    }
    router.refresh()
  }

  const totalMz = detalle.reduce((acc, d) => acc + (d.avance_mz ?? 0), 0)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-slate-900">{registro.labores?.nombre}</p>
          <p className="text-sm text-slate-500">{registro.tareas_sap?.nombre}</p>
          {registro.implementos?.nombre && (
            <p className="text-xs text-slate-400">Implemento: {registro.implementos.nombre}</p>
          )}
        </div>
        {ticketAbierto && (
          <button
            onClick={handleDuplicar}
            disabled={duplicando}
            className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 active:bg-slate-200"
            aria-label="Duplicar labor"
          >
            {duplicando ? '…' : '⧉ Duplicar'}
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {detalle.map((d) => (
          <span key={d.id} className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
            {d.lotes_temporada?.lotes?.nomenclatura ?? '—'}
            {d.avance_mz != null ? ` · ${d.avance_mz} mz` : ''}
          </span>
        ))}
      </div>
      {totalMz > 0 && <p className="mt-1 text-xs text-slate-400">Total: {totalMz} mz</p>}
    </div>
  )
}
