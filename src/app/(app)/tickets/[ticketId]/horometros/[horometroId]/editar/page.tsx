import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HorometroForm } from '@/components/horometro/HorometroForm'

export default async function EditarHorometroPage({
  params,
}: {
  params: Promise<{ ticketId: string; horometroId: string }>
}) {
  const { ticketId, horometroId } = await params
  const supabase = await createClient()

  const [{ data: horometro }, { data: equipos }, { data: operadores }] = await Promise.all([
    supabase.from('horometros').select('*').eq('id', horometroId).single(),
    supabase.from('equipos').select('*').eq('activo', true).eq('visible_app', true).order('codigo'),
    supabase.from('operadores').select('*').eq('activo', true).order('nombre'),
  ])

  if (!horometro) notFound()

  return (
    <div>
      <div className="p-4 pb-0">
        <h1 className="text-lg font-bold text-slate-900">Completar horómetro duplicado</h1>
        <p className="text-sm text-slate-500">Confirma equipo, operador y captura las lecturas reales.</p>
      </div>
      <HorometroForm
        ticketId={ticketId}
        equipos={equipos ?? []}
        operadores={operadores ?? []}
        horometroBase={{
          id: horometro.id,
          equipo_id: horometro.equipo_id,
          operador_id: horometro.operador_id,
          turno: horometro.turno,
          fecha: horometro.fecha,
          horometro_inicial: horometro.horometro_inicial,
          horometro_final: horometro.horometro_final,
          horas_hombre: horometro.horas_hombre,
          comentario: horometro.comentario,
        }}
      />
    </div>
  )
}
