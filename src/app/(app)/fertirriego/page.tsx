import { redirect } from 'next/navigation'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { CampoFertirriego } from '@/components/fertirriego/CampoFertirriego'

/**
 * Fertirriego · app de campo (Etapa B). El servidor solo comprueba el permiso y entrega quién es: los datos los
 * baja el teléfono (fn_fert_estado_campo) y los guarda para trabajar sin señal.
 */
export default async function FertirriegoPage() {
  const [permisos, { perfil }] = await Promise.all([getPermisos(), getPerfilActual()])
  if (!puede(permisos, 'fertirriego', 'ver') || !perfil) redirect('/')

  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 lg:p-6">
      <CampoFertirriego usuarioId={perfil.id} />
    </div>
  )
}
