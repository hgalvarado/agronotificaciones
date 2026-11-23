import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { EliminarRegistrosAdmin } from '@/components/fertirriego/EliminarRegistrosAdmin'

/** Administración › Eliminar registros (migraciones 119 y 140: Fertirriego, Inyección y Motores). Solo quien tiene «Eliminar por completo». */
export default async function EliminarRegistrosPage() {
  const permisos = await getPermisos()
  if (!['fertirriego', 'inyeccion', 'motores'].some((p) => puede(permisos, p, 'eliminar_definitivo'))) redirect('/')

  const supabase = await createClient()
  const [estaciones, prueba] = await Promise.all([
    supabase.from('estaciones_riego').select('id, nombre').eq('activo', true).order('nombre'),
    // La tabla es privada: «permission denied» = existe; tabla inexistente = falta la 119
    supabase.from('fert_eliminaciones').select('id').limit(1),
  ])
  const sinMigracion = prueba.error?.code === '42P01' || /does not exist|schema cache/i.test(prueba.error?.message ?? '')

  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Eliminar registros</h1>
        <p className="text-sm text-slate-400">
          Borra por completo registros de Campo (Fertirriego, Inyección y Motores) hechos por error: desaparecen del inventario, de los informes y de AGL. Solo queda una
          copia privada de auditoría.
        </p>
      </div>
      <EliminarRegistrosAdmin sinMigracion={sinMigracion} estaciones={(estaciones.data as { id: string; nombre: string }[] | null) ?? []} />
    </div>
  )
}
