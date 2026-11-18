import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { RegistroHistoricoAdmin } from '@/components/fertirriego/RegistroHistoricoAdmin'

/** Administración › Registro histórico de Fertirriego (migración 116). Solo quien configura Fertirriego. */
export default async function RegistroHistoricoPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'fertirriego', 'configurar')) redirect('/')

  const supabase = await createClient()
  const [estaciones, personas, tabla] = await Promise.all([
    supabase.from('estaciones_riego').select('id, nombre').eq('activo', true).is('prueba_de', null).order('nombre'),
    supabase.from('perfiles').select('id, nombre').eq('activo', true).order('nombre'),
    // Sin la 116 la tabla no existe
    supabase.from('fert_historico_permisos').select('id').limit(1),
  ])

  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Registro histórico de Fertirriego</h1>
        <p className="text-sm text-slate-400">
          Para estaciones que ya operaban antes del sistema: una persona registra lo que ya se aplicó, sin mover el
          inventario, durante un tiempo limitado.
        </p>
      </div>
      <RegistroHistoricoAdmin
        sinMigracion={Boolean(tabla.error)}
        estaciones={(estaciones.data as { id: string; nombre: string }[] | null) ?? []}
        personas={(personas.data as { id: string; nombre: string }[] | null) ?? []}
      />
    </div>
  )
}
