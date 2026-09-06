'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Horometro } from '@/lib/types'

export function HorometroRow({ horometro, ticketAbierto }: { horometro: Horometro; ticketAbierto: boolean }) {
  const supabase = createClient()
  const router = useRouter()
  const [duplicando, setDuplicando] = useState(false)

  async function handleDuplicar(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDuplicando(true)
    const { data, error } = await supabase.rpc('duplicar_horometro', {
      p_horometro_id: horometro.id,
    })
    setDuplicando(false)
    if (error) {
      alert(error.message)
      return
    }
    router.push(`/tickets/${horometro.ticket_id}/horometros/${data}/editar`)
  }

  return (
    <Link
      href={`/tickets/${horometro.ticket_id}/horometros/${horometro.id}`}
      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50"
    >
      <div>
        <p className="font-semibold text-slate-900">{horometro.equipos?.codigo ?? horometro.equipo_id}</p>
        <p className="text-sm text-slate-500">
          {horometro.turno === 'DIURNO' ? 'Diurno' : 'Nocturno'} · {horometro.horas_maquina} hrs máquina
          {horometro.operadores?.nombre ? ` · ${horometro.operadores.nombre}` : ''}
        </p>
      </div>
      {ticketAbierto && (
        <button
          onClick={handleDuplicar}
          disabled={duplicando}
          className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 active:bg-slate-200"
          aria-label="Duplicar horómetro"
        >
          {duplicando ? '…' : '⧉'}
        </button>
      )}
    </Link>
  )
}
