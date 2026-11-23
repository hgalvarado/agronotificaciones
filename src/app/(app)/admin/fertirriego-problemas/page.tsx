import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { EnviosConProblemasAdmin } from '@/components/fertirriego/EnviosConProblemasAdmin'

/** Administración › Envíos con problemas (migración 136). Mismo permiso que «Eliminar por completo» (matriz, sin nombres de rol). */
export default async function EnviosConProblemasPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'fertirriego', 'eliminar_definitivo')) redirect('/')

  const supabase = await createClient()
  const [estaciones, prueba] = await Promise.all([
    supabase.from('estaciones_riego').select('id, nombre').eq('activo', true).order('nombre'),
    // Si la 136 no corrió, la columna no existe
    supabase.from('fert_operaciones').select('revision_estado').limit(1),
  ])
  const sinMigracion = prueba.error?.code === '42703' || /revision_estado|does not exist|schema cache/i.test(prueba.error?.message ?? '')

  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <Link href="/admin" className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-brand-700" data-regresar>
        <span aria-hidden="true">←</span> Regresar a Administración
      </Link>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Envíos con problemas</h1>
        <p className="text-sm text-slate-400">
          Registros que la base rechazó en cualquier estación. Resuélvelos desde aquí: acéptalos de todos modos, márcalos como resueltos o
          descártalos, sin ir donde está la persona.
        </p>
      </div>
      <EnviosConProblemasAdmin sinMigracion={sinMigracion} estaciones={(estaciones.data as { id: string; nombre: string }[] | null) ?? []} />
    </div>
  )
}
