import { createClient } from '@/lib/supabase/server'
import { getPerfilActual } from '@/lib/auth'
import { TicketCard } from '@/components/ticket/TicketCard'
import { NuevoTicketForm } from '@/components/ticket/NuevoTicketForm'
import type { Ticket } from '@/lib/types'

export default async function TicketsPage() {
  const supabase = await createClient()
  const { perfil } = await getPerfilActual()

  // RLS ya filtra: un Digitador sólo recibe los suyos; Admin/Torre de
  // Control reciben todos. No hace falta filtrar manualmente aquí.
  const { data: tickets } = await supabase
    .from('tickets')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(50)

  const { data: temporadaActiva } = await supabase
    .from('temporadas')
    .select('id')
    .eq('activa', true)
    .maybeSingle()

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-slate-900">Tickets</h1>

      {perfil && (
        <NuevoTicketForm
          usuarioId={perfil.id}
          nombreUsuario={perfil.nombre}
          departamento={perfil.departamento}
          temporadaActivaId={temporadaActiva?.id ?? null}
        />
      )}

      <div className="flex flex-col gap-2">
        {(tickets as Ticket[] | null)?.map((t) => (
          <TicketCard key={t.id} ticket={t} />
        ))}
        {tickets?.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            Todavía no tienes tickets. Genera el primero arriba.
          </p>
        )}
      </div>
    </div>
  )
}
