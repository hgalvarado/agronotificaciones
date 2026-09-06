import Link from 'next/link'
import type { Ticket } from '@/lib/types'

export function TicketCard({ ticket }: { ticket: Ticket }) {
  const cerrado = ticket.estado === 'CERRADO'

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50"
    >
      <div>
        <p className="font-semibold text-slate-900">{ticket.codigo}</p>
        <p className="text-sm text-slate-500">
          {new Date(ticket.fecha + 'T00:00:00').toLocaleDateString('es-HN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
          {ticket.departamento ? ` · ${ticket.departamento}` : ''}
        </p>
      </div>
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold ${
          cerrado ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'
        }`}
      >
        {cerrado ? 'Cerrado' : 'Abierto'}
      </span>
    </Link>
  )
}
