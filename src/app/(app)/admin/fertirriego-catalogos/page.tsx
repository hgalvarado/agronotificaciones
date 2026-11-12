import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'
import { CatalogosCampo } from '@/components/fertirriego/CatalogosCampo'

/** Administración › Choferes y catálogos de campo (migración 99). Quien tiene «Gestionar choferes» en Fertirriego. */
export default async function CatalogosCampoPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'fertirriego', 'gestionar_choferes')) redirect('/')

  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Choferes y catálogos de campo</h1>
        <p className="text-sm text-slate-400">
          Lo que los estacioneros agregan sin señal queda «por validar»: aquí se corrige, se valida, se quita o se une con su
          repetido.
        </p>
      </div>
      <CatalogosCampo />
    </div>
  )
}
