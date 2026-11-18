import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'
import { VERSION } from '@/lib/version'
import { BitacoraErrores } from '@/components/errores/BitacoraErrores'

/** Administración › Bitácora de errores (migración 118). Ver = leer; Atender = marcar como visto/atendido. */
export default async function BitacoraErroresPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'errores', 'ver')) redirect('/')

  return (
    <div className="anim-aparecer mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="break-words text-xl font-bold tracking-tight text-slate-900">Bitácora de errores</h1>
        <p className="text-sm text-slate-500">
          Todo lo que les sale mal a los usuarios: lo que no se sincronizó, lo que no se guardó bien y los errores de
          pantalla, con la causa y cómo solucionarlo.
        </p>
      </div>
      <BitacoraErrores
        versionActual={VERSION}
        puedeAtender={puede(permisos, 'errores', 'atender')}
        puedeExportar={puede(permisos, 'errores', 'exportar')}
      />
    </div>
  )
}
