import { createClient } from '@/lib/supabase/server'
import { HorometroForm } from '@/components/horometro/HorometroForm'

export default async function NuevoHorometroPage({
  params,
}: {
  params: Promise<{ ticketId: string }>
}) {
  const { ticketId } = await params
  const supabase = await createClient()

  const [{ data: equipos }, { data: operadores }] = await Promise.all([
    supabase.from('equipos').select('*').eq('activo', true).eq('visible_app', true).order('codigo'),
    supabase.from('operadores').select('*').eq('activo', true).order('nombre'),
  ])

  return (
    <div>
      <div className="p-4 pb-0">
        <h1 className="text-lg font-bold text-slate-900">Nuevo horómetro</h1>
      </div>
      <HorometroForm ticketId={ticketId} equipos={equipos ?? []} operadores={operadores ?? []} />
    </div>
  )
}
