'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { TareaSap, Implemento } from '@/lib/types'

type LaborConReglas = {
  id: string
  nombre: string
  labores_tareas: { tarea_id: string }[]
  labores_implementos: { implemento_id: string }[]
}

type LoteOpcion = {
  lote_temporada_id: string
  nomenclatura: string
  area_neta: number
}

type Props = {
  ticketId: string
  horometroId: string
  temporadaId: string | null
  fecha: string
  labores: LaborConReglas[]
  tareasSap: TareaSap[]
  implementos: Implemento[]
  lotes: LoteOpcion[]
}

export function RegistroForm({ ticketId, horometroId, temporadaId, fecha, labores, tareasSap, implementos, lotes }: Props) {
  const supabase = createClient()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [laborId, setLaborId] = useState('')
  const [tareaId, setTareaId] = useState('')
  const [implementoId, setImplementoId] = useState('')
  const [comentarios, setComentarios] = useState('')
  const [seleccion, setSeleccion] = useState<Record<string, string>>({}) // lote_temporada_id -> avance_mz (texto)

  const laborActual = labores.find((l) => l.id === laborId)

  const tareasPermitidas = useMemo(() => {
    if (!laborActual) return []
    const ids = new Set(laborActual.labores_tareas.map((t) => t.tarea_id))
    return tareasSap.filter((t) => ids.has(t.id))
  }, [laborActual, tareasSap])

  const implementosPermitidos = useMemo(() => {
    if (!laborActual) return []
    const ids = new Set(laborActual.labores_implementos.map((i) => i.implemento_id))
    return implementos.filter((i) => ids.has(i.id))
  }, [laborActual, implementos])

  function toggleLote(loteTemporadaId: string) {
    setSeleccion((prev) => {
      const copia = { ...prev }
      if (loteTemporadaId in copia) {
        delete copia[loteTemporadaId]
      } else {
        copia[loteTemporadaId] = ''
      }
      return copia
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!laborId || !tareaId) {
      setError('Selecciona labor y tarea SAP.')
      return
    }
    if (Object.keys(seleccion).length === 0) {
      setError('Selecciona al menos una ubicación técnica (lote).')
      return
    }

    setSaving(true)

    const { data: registro, error: dbError } = await supabase
      .from('registros')
      .insert({
        ticket_id: ticketId,
        horometro_id: horometroId,
        temporada_id: temporadaId,
        fecha,
        labor_id: laborId,
        tarea_id: tareaId,
        implemento_id: implementoId || null,
        comentarios: comentarios || null,
      })
      .select('id')
      .single()

    if (dbError || !registro) {
      setSaving(false)
      setError(dbError?.message ?? 'No se pudo crear el registro.')
      return
    }

    const detalle = Object.entries(seleccion).map(([lote_temporada_id, avance]) => ({
      registro_id: registro.id,
      lote_temporada_id,
      avance_mz: avance ? Number(avance) : null,
      fecha,
    }))

    const { error: detalleError } = await supabase.from('registro_detalle').insert(detalle)

    setSaving(false)
    if (detalleError) {
      setError(detalleError.message)
      return
    }

    router.push(`/tickets/${ticketId}/horometros/${horometroId}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Labor
        <select
          value={laborId}
          onChange={(e) => {
            setLaborId(e.target.value)
            setTareaId('')
            setImplementoId('')
          }}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          required
        >
          <option value="">Selecciona una labor…</option>
          {labores.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nombre}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Tarea SAP a liquidar
        <select
          value={tareaId}
          onChange={(e) => setTareaId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base disabled:bg-slate-100"
          disabled={!laborId}
          required
        >
          <option value="">Selecciona una tarea…</option>
          {tareasPermitidas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.codigo} — {t.nombre}
            </option>
          ))}
        </select>
        {laborId && tareasPermitidas.length === 0 && (
          <span className="text-xs text-amber-600">
            Esta labor no tiene tareas SAP configuradas. Pide a Torre de Control que las asocie en el catálogo.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Implemento utilizado
        <select
          value={implementoId}
          onChange={(e) => setImplementoId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base disabled:bg-slate-100"
          disabled={!laborId}
        >
          <option value="">Sin implemento / no aplica</option>
          {implementosPermitidos.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nombre}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-slate-700">
          Ubicación(es) técnica(s) — marca todas las trabajadas y captura el avance en mz (opcional)
        </p>
        <div className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-300 bg-white">
          {lotes.map((lote) => {
            const marcado = lote.lote_temporada_id in seleccion
            return (
              <div key={lote.lote_temporada_id} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => toggleLote(lote.lote_temporada_id)}
                  className="h-5 w-5 shrink-0 accent-emerald-700"
                />
                <span className="flex-1 text-sm text-slate-800">
                  {lote.nomenclatura}{' '}
                  <span className="text-xs text-slate-400">({lote.area_neta} mz neta)</span>
                </span>
                {marcado && (
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="mz"
                    value={seleccion[lote.lote_temporada_id]}
                    onChange={(e) =>
                      setSeleccion((prev) => ({ ...prev, [lote.lote_temporada_id]: e.target.value }))
                    }
                    className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-right text-sm"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Comentarios
        <textarea
          value={comentarios}
          onChange={(e) => setComentarios(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          rows={3}
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="sticky bottom-4 rounded-xl bg-emerald-700 px-4 py-4 text-base font-semibold text-white shadow-lg active:scale-[0.98] disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Guardar labor'}
      </button>
    </form>
  )
}
