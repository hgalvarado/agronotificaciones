import { redirect } from 'next/navigation'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { FormParametros } from '@/components/agrometricas/FormParametros'

/** AgroMétricas › Parámetros de riego. El servidor solo comprueba el permiso; los datos los baja el teléfono. */
export default async function ParametrosPage() {
  const [permisos, { perfil }] = await Promise.all([getPermisos(), getPerfilActual()])
  if (!puede(permisos, 'agrometricas', 'ver') || !perfil) redirect('/')
  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 pb-28 lg:p-6">
      <FormParametros usuarioId={perfil.id} puedeRegistrar={puede(permisos, 'agrometricas', 'registrar_parametros')} />
    </div>
  )
}
