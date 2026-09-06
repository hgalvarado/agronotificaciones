'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function CerrarTicketButton({ ticketId }: { ticketId: string }) {
  const supabase = createClient()
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  async function handleCerrar() {
    if (!confirm('¿Cerrar este ticket? Ya no podrás editar sus horómetros ni labores.')) return
    setSaving(true)
    const { error } = await supabase.rpc('cerrar_ticket', { p_ticket_id: ticketId })
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    router.refresh()
  }

  return (
    <button
      onClick={handleCerrar}
      disabled={saving}
      className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 disabled:opacity-50"
    >
      {saving ? 'Cerrando…' : 'Cerrar ticket'}
    </button>
  )
}
