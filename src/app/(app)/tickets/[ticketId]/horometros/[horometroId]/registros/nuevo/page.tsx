import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RegistroForm } from '@/components/registro/RegistroForm'
import { cargarCatalogosRegistro } from '@/lib/datosRegistro'
import { IconChevronLeft } from '@/components/ui/Icons'
import { Alerta } from '@/components/ui/Primitivos'

export default async function NuevoRegistroPage({
  params,
}: {
  params: Promise<{ ticketId: string; horometroId: string }>
}) {
  const { ticketId, horometroId } = await params
  const supabase = await createClient()

  const [{ data: horometro }, { data: hermanos }, catalogos] = await Promise.all([
    supabase
      .from('horometros')
      .select('id, fecha, horas_maquina, equipos(codigo)')
      .eq('id', horometroId)
      .single(),
    // Horas ya repartidas en las labores que este horometro ya tiene: el
    // formulario propone el saldo, no el dia completo.
    supabase.from('registros').select('horas_notificadas').eq('horometro_id', horometroId),
    cargarCatalogosRegistro(),
  ])

  if (!horometro) notFound()

  const horasMaquina = horometro.horas_maquina ?? 0
  const horasRepartidas =
    (hermanos as { horas_notificadas: number | null }[] | null)?.reduce(
      (acc, r) => acc + (r.horas_notificadas ?? 0),
      0
    ) ?? 0

  const equipoCodigo = Array.isArray(horometro.equipos)
    ? horometro.equipos[0]?.codigo
    : (horometro.equipos as { codigo: string } | null)?.codigo

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
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          ¿Qué hizo {equipoCodigo ?? 'el equipo'}?
        </h1>
        <p className="text-sm text-slate-400">
          Registra la labor y los lotes donde trabajó. Puedes agregar varias seguidas.
        </p>
      </div>

      {!catalogos.temporadaId && (
        <Alerta tono="ambar">
          No hay una temporada activa configurada, así que no hay lotes para seleccionar. Actívala
          desde Catálogos.
        </Alerta>
      )}

      <RegistroForm
        ticketId={ticketId}
        horometroId={horometroId}
        temporadaId={catalogos.temporadaId}
        fecha={horometro.fecha}
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
      />
    </div>
  )
}
