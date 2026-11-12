import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { ModoPruebasFertirriego } from '@/components/fertirriego/ModoPruebasFertirriego'

/** Administración › Pruebas Fertirriego (migración 98). Solo quien configura Fertirriego. */
export default async function PruebasFertirriegoPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'fertirriego', 'configurar')) redirect('/')

  const supabase = await createClient()
  const [estaciones, personas] = await Promise.all([
    // Solo las estaciones REALES (las de prueba las crea el modo). Sin la 98 la columna no existe.
    supabase.from('estaciones_riego').select('id, nombre, zona_id').eq('activo', true).is('prueba_de', null).order('nombre'),
    supabase.from('perfiles').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Pruebas de Fertirriego</h1>
        <p className="text-sm text-slate-400">
          Practicar con algunos usuarios sin ensuciar lo real: trabajan en estaciones «PRUEBA», AGL no lo ve y al final
          se borra.
        </p>
      </div>
      <ModoPruebasFertirriego
        sinMigracion={Boolean(estaciones.error)}
        estaciones={(estaciones.data as { id: string; nombre: string }[] | null) ?? []}
        personas={(personas.data as { id: string; nombre: string }[] | null) ?? []}
      />
    </div>
  )
}
