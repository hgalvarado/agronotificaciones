import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RegistroRow } from '@/components/registro/RegistroRow'
import type { Horometro, Registro, RegistroDetalle, Ticket } from '@/lib/types'

export default async function HorometroDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string; horometroId: string }>
}) {
  const { ticketId, horometroId } = await params
  const supabase = await createClient()

  const { data: ticket } = await supabase.from('tickets').select('*').eq('id', ticketId).single()
  const { data: horometro } = await supabase
    .from('horometros')
    .select('*, equipos(*), operadores(*)')
    .eq('id', horometroId)
    .single()

  if (!ticket || !horometro) notFound()

  const { data: registros } = await supabase
    .from('registros')
    .select('*, labores(*), tareas_sap(*), implementos(*)')
    .eq('horometro_id', horometroId)
    .order('created_at', { ascending: true })

  const registroIds = (registros ?? []).map((r) => r.id)
  const { data: detalles } =
    registroIds.length > 0
      ? await supabase
          .from('registro_detalle')
          .select('*, lotes_temporada(*, lotes(*))')
          .in('registro_id', registroIds)
      : { data: [] as RegistroDetalle[] }

  const abierto = (ticket as Ticket).estado === 'ABIERTO'
  const h = horometro as Horometro

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Link href={`/tickets/${ticketId}`} className="text-sm text-emerald-700">
          ← Volver al ticket
        </Link>
        <h1 className="mt-1 text-lg font-bold text-slate-900">{h.equipos?.codigo}</h1>
        <p className="text-sm text-slate-500">
          {h.turno === 'DIURNO' ? 'Diurno' : 'Nocturno'} · {h.fecha} · {h.horometro_inicial} → {h.horometro_final} (
          {h.horas_maquina} hrs máquina{h.horas_hombre != null ? `, ${h.horas_hombre} hrs hombre` : ''})
        </p>
        {h.operadores?.nombre && <p className="text-sm text-slate-500">Operador: {h.operadores.nombre}</p>}
        {h.comentario && <p className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{h.comentario}</p>}
      </div>

      {abierto && (
        <Link
          href={`/tickets/${ticketId}/horometros/${horometroId}/registros/nuevo`}
          className="w-full rounded-xl bg-emerald-700 px-4 py-4 text-center text-base font-semibold text-white shadow active:scale-[0.98]"
        >
          + Agregar labor
        </Link>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-500">Labores registradas</h2>
        {(registros as Registro[] | null)?.map((r) => (
          <RegistroRow
            key={r.id}
            registro={r}
            detalle={(detalles as RegistroDetalle[] | null)?.filter((d) => d.registro_id === r.id) ?? []}
            ticketAbierto={abierto}
          />
        ))}
        {registros?.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">
            Sin labores registradas todavía. Agrega la primera arriba.
          </p>
        )}
      </div>
    </div>
  )
}
