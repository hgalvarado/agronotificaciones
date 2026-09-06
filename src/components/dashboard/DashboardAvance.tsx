'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AvancePorCategoria, CategoriaLabor, ResumenAvancePorLote } from '@/lib/types'

export function DashboardAvance({
  categorias,
  temporadaActivaId,
}: {
  categorias: CategoriaLabor[]
  temporadaActivaId: string | null
}) {
  const supabase = createClient()
  const [categoriaId, setCategoriaId] = useState(categorias[0]?.id ?? '')
  const [resumen, setResumen] = useState<ResumenAvancePorLote[]>([])
  const [detallePorLote, setDetallePorLote] = useState<Record<string, AvancePorCategoria[]>>({})
  const [loteExpandido, setLoteExpandido] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!categoriaId || !temporadaActivaId) return
    let cancelado = false
    async function cargar() {
      setCargando(true)
      setLoteExpandido(null)
      setDetallePorLote({})
      const { data } = await supabase.rpc('fn_resumen_avance_categoria_por_lote', {
        p_categoria_labor_id: categoriaId,
        p_temporada_id: temporadaActivaId,
      })
      if (cancelado) return
      setResumen((data as ResumenAvancePorLote[]) ?? [])
      setCargando(false)
    }
    cargar()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriaId, temporadaActivaId])

  async function toggleLote(loteId: string) {
    if (loteExpandido === loteId) {
      setLoteExpandido(null)
      return
    }
    setLoteExpandido(loteId)
    if (!detallePorLote[loteId] && temporadaActivaId) {
      const { data } = await supabase.rpc('fn_avance_por_categoria', {
        p_categoria_labor_id: categoriaId,
        p_temporada_id: temporadaActivaId,
        p_lote_id: loteId,
      })
      setDetallePorLote((prev) => ({ ...prev, [loteId]: (data as AvancePorCategoria[]) ?? [] }))
    }
  }

  if (!temporadaActivaId) {
    return (
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        No hay una temporada marcada como activa. Actívala desde el panel admin para ver el avance.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Categoría de labor
        <select
          value={categoriaId}
          onChange={(e) => setCategoriaId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
        >
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>

      {cargando && <p className="text-sm text-slate-400">Cargando…</p>}

      <div className="flex flex-col gap-2">
        {resumen.map((r) => (
          <div key={r.lote_id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              onClick={() => toggleLote(r.lote_id)}
              className="flex w-full flex-col gap-2 p-4 text-left"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">{r.nomenclatura}</span>
                <span className="text-sm font-medium text-emerald-700">{r.pct_avance}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-600"
                  style={{ width: `${r.pct_avance}%` }}
                />
              </div>
              <span className="text-xs text-slate-400">
                {r.labores_completas} de {r.labores_totales} labores completadas · {r.area_neta} mz neta
              </span>
            </button>

            {loteExpandido === r.lote_id && (
              <div className="flex flex-col gap-2 border-t border-slate-100 p-4">
                {detallePorLote[r.lote_id]?.map((d) => (
                  <div key={d.labor_id} className="flex items-center justify-between text-sm">
                    <span className={d.labor_completada ? 'text-slate-500 line-through' : 'text-slate-800'}>
                      {d.labor_nombre}
                    </span>
                    <span className="text-slate-500">
                      {d.mz_trabajadas} / {d.area_neta} mz
                      {d.labor_completada ? ' ✅' : ` · faltan ${d.mz_pendientes}`}
                    </span>
                  </div>
                )) ?? <p className="text-sm text-slate-400">Cargando detalle…</p>}
              </div>
            )}
          </div>
        ))}
        {!cargando && resumen.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            No hay lotes con área configurada para esta categoría y temporada.
          </p>
        )}
      </div>
    </div>
  )
}
