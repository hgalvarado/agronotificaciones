import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HorometroRow } from '@/components/horometro/HorometroRow'
import { CerrarTicketButton } from '@/components/ticket/CerrarTicketButton'
import type { Horometro, Ticket } from '@/lib/types'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>
}) {
  const { ticketId } = await params
  const supabase = await createClient()

  const { data: ticket } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single()

  if (!ticket) notFound()

  const { data: horometros } = await supabase
    .from('horometros')
    .select('*, equipos(*), operadores(*)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })

  const abierto = (ticket as Ticket).estado === 'ABIERTO'

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-xs text-slate-400">Ticket</p>
        <h1 className="text-lg font-bold text-slate-900">{(ticket as Ticket).codigo}</h1>
        <span
          className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
            abierto ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {abierto ? 'Abierto' : 'Cerrado'}
        </span>
      </div>

      {abierto && (
        <Link
          href={`/tickets/${ticketId}/horometros/nuevo`}
          className="w-full rounded-xl bg-emerald-700 px-4 py-4 text-center text-base font-semibold text-white shadow active:scale-[0.98]"
        >
          + Agregar horómetro
        </Link>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-500">Horómetros registrados</h2>
        {(horometros as Horometro[] | null)?.map((h) => (
          <HorometroRow key={h.id} horometro={h} ticketAbierto={abierto} />
        ))}
        {horometros?.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">
            Sin horómetros todavía. Agrega el primero arriba.
          </p>
        )}
      </div>

      {abierto && horometros && horometros.length > 0 && (
        <div className="mt-4">
          <CerrarTicketButton ticketId={ticketId} />
        </div>
      )}
    </div>
  )
}
