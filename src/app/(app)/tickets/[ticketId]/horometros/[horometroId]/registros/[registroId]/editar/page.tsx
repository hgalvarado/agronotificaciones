import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RegistroForm } from '@/components/registro/RegistroForm'
import { cargarCatalogosRegistro } from '@/lib/datosRegistro'
import { IconChevronLeft } from '@/components/ui/Icons'

export default async function EditarRegistroPage({
  params,
}: {
  params: Promise<{ ticketId: string; horometroId: string; registroId: string }>
}) {
  const { ticketId, horometroId, registroId } = await params
  const supabase = await createClient()

  const [{ data: registro }, { data: detalle }, { data: horometro }, { data: hermanos }, catalogos] =
    await Promise.all([
      supabase.from('registros').select('*').eq('id', registroId).single(),
      supabase
        .from('registro_detalle')
        .select(
          'lote_temporada_id, avance_mz, ciclo, etapa, proveedor_plastico_id, proveedor_manguera_id'
        )
        .order('created_at')
        .eq('registro_id', registroId),
      supabase.from('horometros').select('horas_maquina').eq('id', horometroId).single(),
      // Las horas de las OTRAS labores del mismo horometro: esta se excluye
      // para que el saldo no se reste dos veces.
      supabase
        .from('registros')
        .select('horas_notificadas')
        .eq('horometro_id', horometroId)
        .neq('id', registroId),
      cargarCatalogosRegistro(),
    ])

  if (!registro) notFound()

  const horasMaquina = horometro?.horas_maquina ?? 0
  const horasRepartidas =
    (hermanos as { horas_notificadas: number | null }[] | null)?.reduce(
      (acc, r) => acc + (r.horas_notificadas ?? 0),
      0
    ) ?? 0

  return (
    <div className="anim-aparecer flex flex-col gap-4 p-4 lg:p-6">
      <Link
        href={`/tickets/${ticketId}/horometros/${horometroId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <IconChevronLeft className="h-4 w-4" />
        Volver al horómetro
      </Link>

      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Editar labor</h1>
        <p className="text-sm text-slate-400">Corrige la labor, la tarea SAP o el avance por lote.</p>
      </div>

      <RegistroForm
        ticketId={ticketId}
        horometroId={horometroId}
        temporadaId={catalogos.temporadaId}
        fecha={registro.fecha}
        labores={catalogos.labores}
        tareasSap={catalogos.tareasSap}
        implementos={catalogos.implementos}
        lotes={catalogos.lotes}
        temporadas={catalogos.temporadas}
        proveedores={catalogos.proveedores}
        implementosFisicos={catalogos.implementosFisicos}
        vinculosFisicos={catalogos.vinculosFisicos}
        horasMaquina={horasMaquina}
        horasRepartidas={horasRepartidas}
        registroBase={{
          id: registro.id,
          labor_id: registro.labor_id,
          tarea_id: registro.tarea_id,
          implemento_id: registro.implemento_id,
          implemento_fisico_id: registro.implemento_fisico_id ?? null,
          comentarios: registro.comentarios,
          horas_notificadas: registro.horas_notificadas ?? null,
          etapa: (detalle?.[0] as { etapa?: number | null } | undefined)?.etapa ?? null,
          detalle: detalle ?? [],
        }}
      />
    </div>
  )
}
