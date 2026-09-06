import { createClient } from '@/lib/supabase/server'
import { DashboardAvance } from '@/components/dashboard/DashboardAvance'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: categorias } = await supabase.from('categorias_labor').select('*').eq('activo', true).order('nombre')
  const { data: temporadaActiva } = await supabase.from('temporadas').select('id').eq('activa', true).maybeSingle()

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-slate-900">Avance por lote</h1>
      <DashboardAvance categorias={categorias ?? []} temporadaActivaId={temporadaActiva?.id ?? null} />
    </div>
  )
}
