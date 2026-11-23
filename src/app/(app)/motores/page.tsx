import { redirect } from 'next/navigation'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { CampoMotores } from '@/components/motores/CampoMotores'
import { LimiteError } from '@/components/errores/LimiteError'

/**
 * Motores y combustible (Campo, bloque 3). El servidor solo comprueba el permiso y entrega quién es: los datos los baja
 * el teléfono (fn_mot_estado_campo y fn_fert_estado_campo) y los guarda para trabajar sin señal.
 */
export default async function MotoresPage() {
  const [permisos, { perfil }] = await Promise.all([getPermisos(), getPerfilActual()])
  if (!puede(permisos, 'motores', 'ver') || !perfil) redirect('/')

  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 lg:p-6">
      <LimiteError modulo="motores">
        <CampoMotores usuarioId={perfil.id} />
      </LimiteError>
    </div>
  )
}
