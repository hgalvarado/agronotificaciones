import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'
import { RegistrosTemporada } from '@/components/agrometricas/RegistrosTemporada'

/** AgroMétricas › Registros de la temporada. El servidor solo comprueba «ver»; qué ve/edita/elimina cada quien lo decide la base. */
export default async function RegistrosPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'agrometricas', 'ver')) redirect('/')
  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-3 p-4 pb-24 lg:p-6">
      <RegistrosTemporada />
    </div>
  )
}
