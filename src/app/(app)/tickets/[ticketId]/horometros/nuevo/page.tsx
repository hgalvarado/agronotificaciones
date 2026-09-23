import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HorometroForm } from '@/components/horometro/HorometroForm'
import { IconChevronLeft } from '@/components/ui/Icons'

export default async function NuevoHorometroPage({
  params,
}: {
  params: Promise<{ ticketId: string }>
}) {
  const { ticketId } = await params
  const supabase = await createClient()

  const [{ data: equipos }, { data: operadores }, { data: ultimo }, { data: ticket }] =
    await Promise.all([
      supabase
        .from('equipos')
        .select('*')
        .eq('activo', true)
        .eq('visible_app', true)
        .order('codigo'),
      // Sólo quien MANEJA. `tipo_perfil` es un array y se pregunta
      // «contiene OPERADOR», así que quien lleva los dos perfiles sigue
      // saliendo; el puramente administrativo —que recibe un teléfono
      // pero no se sube a un tractor— se queda fuera.
      supabase
        .from('operadores')
        .select('*')
        .eq('activo', true)
        .contains('tipo_perfil', ['OPERADOR'])
        .order('nombre'),
      // El turno se repite en casi todos los equipos de una jornada, así
      // que se hereda del último capturado. La fecha ya no: la manda el
      // ticket.
      supabase
        .from('horometros')
        .select('turno')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('tickets').select('fecha').eq('id', ticketId).single(),
    ])

  if (!ticket) notFound()

  return (
    <div className="anim-aparecer flex flex-col gap-4 p-4 lg:p-6">
      <Link
        href={`/tickets/${ticketId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <IconChevronLeft className="h-4 w-4" />
        Volver al ticket
      </Link>

      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Nuevo horómetro</h1>
        <p className="text-sm text-slate-400">
          Registra el equipo, las lecturas y el operador. Al guardar pasas directo a sus labores.
        </p>
      </div>

      <HorometroForm
        ticketId={ticketId}
        equipos={equipos ?? []}
        operadores={operadores ?? []}
        fechaTicket={ticket.fecha}
        valoresIniciales={{ turno: ultimo?.turno }}
      />
    </div>
  )
}
