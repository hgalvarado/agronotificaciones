'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Genera un código legible similar al de la app actual: usuario-fecha-[n]
function generarCodigoTicket(nombreUsuario: string, fecha: string) {
  const slug = nombreUsuario.trim().split(' ')[0].toLowerCase()
  const [y, m, d] = fecha.split('-')
  const sufijo = Math.floor(Math.random() * 900 + 100) // evita colisión simple
  return `${slug}-${d}-${m}-${y}-[${sufijo}]`
}

export function NuevoTicketForm({
  usuarioId,
  nombreUsuario,
  departamento,
  temporadaActivaId,
}: {
  usuarioId: string
  nombreUsuario: string
  departamento: string | null
  temporadaActivaId: string | null
}) {
  const supabase = createClient()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const { data, error: dbError } = await supabase
      .from('tickets')
      .insert({
        codigo: generarCodigoTicket(nombreUsuario, fecha),
        fecha,
        usuario_id: usuarioId,
        departamento,
        temporada_id: temporadaActivaId,
      })
      .select('id')
      .single()

    setSaving(false)
    if (dbError) {
      setError(dbError.message)
      return
    }
    router.push(`/tickets/${data.id}`)
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl bg-emerald-700 px-4 py-4 text-base font-semibold text-white shadow active:scale-[0.98]"
      >
        + Generar ticket
      </button>
    )
  }

  return (
    <form onSubmit={handleCrear} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Fecha de la jornada
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          required
        />
      </label>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-600"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Creando…' : 'Crear ticket'}
        </button>
      </div>
    </form>
  )
}
