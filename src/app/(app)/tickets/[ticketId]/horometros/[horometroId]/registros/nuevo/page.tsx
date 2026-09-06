import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RegistroForm } from '@/components/registro/RegistroForm'

export default async function NuevoRegistroPage({
  params,
}: {
  params: Promise<{ ticketId: string; horometroId: string }>
}) {
  const { ticketId, horometroId } = await params
  const supabase = await createClient()

  const { data: horometro } = await supabase.from('horometros').select('id, fecha').eq('id', horometroId).single()
  if (!horometro) notFound()

  const { data: temporadaActiva } = await supabase.from('temporadas').select('id').eq('activa', true).maybeSingle()

  const [{ data: labores }, { data: tareasSap }, { data: implementos }, { data: lotesTemporada }] = await Promise.all([
    supabase
      .from('labores')
      .select('id, nombre, labores_tareas(tarea_id), labores_implementos(implemento_id)')
      .eq('activo', true)
      .order('nombre'),
    supabase.from('tareas_sap').select('*').eq('activo', true).order('codigo'),
    supabase.from('implementos').select('*').eq('activo', true).order('nombre'),
    temporadaActiva
      ? supabase
          .from('lotes_temporada')
          .select('id, area_neta, lotes(nomenclatura)')
          .eq('temporada_id', temporadaActiva.id)
          .eq('activo', true)
      : Promise.resolve({ data: [] as never[] }),
  ])

  const lotesOpciones = (lotesTemporada ?? []).map((lt: { id: string; area_neta: number; lotes: { nomenclatura: string } | { nomenclatura: string }[] | null }) => ({
    lote_temporada_id: lt.id,
    nomenclatura: Array.isArray(lt.lotes) ? (lt.lotes[0]?.nomenclatura ?? '—') : (lt.lotes?.nomenclatura ?? '—'),
    area_neta: lt.area_neta,
  }))

  return (
    <div>
      <div className="p-4 pb-0">
        <h1 className="text-lg font-bold text-slate-900">Nueva labor</h1>
        {!temporadaActiva && (
          <p className="mt-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
            No hay una temporada activa configurada — no se pueden seleccionar lotes. Actívala en el panel admin.
          </p>
        )}
      </div>
      <RegistroForm
        ticketId={ticketId}
        horometroId={horometroId}
        temporadaId={temporadaActiva?.id ?? null}
        fecha={horometro.fecha}
        labores={labores ?? []}
        tareasSap={tareasSap ?? []}
        implementos={implementos ?? []}
        lotes={lotesOpciones}
      />
    </div>
  )
}
