'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Equipo, Operador, TurnoTipo } from '@/lib/types'

type Props = {
  ticketId: string
  equipos: Equipo[]
  operadores: Operador[]
  horometroBase?: {
    id: string
    equipo_id?: string
    operador_id?: string | null
    turno?: TurnoTipo
    fecha?: string
    horometro_inicial?: number
    horometro_final?: number
    horas_hombre?: number | null
    comentario?: string | null
  }
}

export function HorometroForm({ ticketId, equipos, operadores, horometroBase }: Props) {
  const supabase = createClient()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    fecha: horometroBase?.fecha ?? new Date().toISOString().slice(0, 10),
    turno: (horometroBase?.turno ?? 'DIURNO') as TurnoTipo,
    equipo_id: horometroBase?.equipo_id ?? '',
    horometro_inicial: horometroBase?.horometro_inicial?.toString() ?? '',
    horometro_final: horometroBase?.horometro_final?.toString() ?? '',
    horas_hombre: horometroBase?.horas_hombre?.toString() ?? '',
    operador_id: horometroBase?.operador_id ?? '',
    comentario: horometroBase?.comentario ?? '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const inicial = Number(form.horometro_inicial)
    const final = Number(form.horometro_final)
    if (Number.isNaN(inicial) || Number.isNaN(final)) {
      setError('Ingresa lecturas de horómetro válidas.')
      return
    }
    if (final < inicial) {
      setError('El horómetro final no puede ser menor al inicial.')
      return
    }
    if (!form.equipo_id) {
      setError('Selecciona un equipo.')
      return
    }

    setSaving(true)

    if (horometroBase?.id) {
      // Estamos completando un horómetro duplicado: se actualiza en vez de insertar.
      const { error: dbError } = await supabase
        .from('horometros')
        .update({
          fecha: form.fecha,
          turno: form.turno,
          equipo_id: form.equipo_id,
          horometro_inicial: inicial,
          horometro_final: final,
          horas_hombre: form.horas_hombre ? Number(form.horas_hombre) : null,
          operador_id: form.operador_id || null,
          comentario: form.comentario || null,
        })
        .eq('id', horometroBase.id)

      setSaving(false)
      if (dbError) {
        setError(dbError.message)
        return
      }
      router.push(`/tickets/${ticketId}/horometros/${horometroBase.id}`)
      router.refresh()
      return
    }

    const { data, error: dbError } = await supabase
      .from('horometros')
      .insert({
        ticket_id: ticketId,
        fecha: form.fecha,
        turno: form.turno,
        equipo_id: form.equipo_id,
        horometro_inicial: inicial,
        horometro_final: final,
        horas_hombre: form.horas_hombre ? Number(form.horas_hombre) : null,
        operador_id: form.operador_id || null,
        comentario: form.comentario || null,
      })
      .select('id')
      .single()

    setSaving(false)
    if (dbError) {
      setError(dbError.message)
      return
    }
    router.push(`/tickets/${ticketId}/horometros/${data.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Fecha
          <input
            type="date"
            value={form.fecha}
            onChange={(e) => setForm({ ...form, fecha: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-3 text-base"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Turno
          <select
            value={form.turno}
            onChange={(e) => setForm({ ...form, turno: e.target.value as TurnoTipo })}
            className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          >
            <option value="DIURNO">Diurno</option>
            <option value="NOCTURNO">Nocturno</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Equipo
        <select
          value={form.equipo_id}
          onChange={(e) => setForm({ ...form, equipo_id: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          required
        >
          <option value="">Selecciona un equipo…</option>
          {equipos.map((eq) => (
            <option key={eq.id} value={eq.id}>
              {eq.codigo} — {eq.nombre}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Horómetro inicial
          <input
            type="text"
            inputMode="decimal"
            value={form.horometro_inicial}
            onChange={(e) => setForm({ ...form, horometro_inicial: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-3 text-base"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Horómetro final
          <input
            type="text"
            inputMode="decimal"
            value={form.horometro_final}
            onChange={(e) => setForm({ ...form, horometro_final: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-3 text-base"
            required
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Horas hombre (si difiere de las horas máquina)
        <input
          type="text"
          inputMode="decimal"
          value={form.horas_hombre}
          onChange={(e) => setForm({ ...form, horas_hombre: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          placeholder="Ej. 8"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Operador
        <select
          value={form.operador_id}
          onChange={(e) => setForm({ ...form, operador_id: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
        >
          <option value="">Selecciona un operador…</option>
          {operadores.map((op) => (
            <option key={op.id} value={op.id}>
              {op.nombre}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Comentarios (fallas, novedades)
        <textarea
          value={form.comentario}
          onChange={(e) => setForm({ ...form, comentario: e.target.value })}
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
        {saving ? 'Guardando…' : 'Guardar horómetro'}
      </button>
    </form>
  )
}
