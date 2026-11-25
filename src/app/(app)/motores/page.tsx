import { redirect } from 'next/navigation'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { CampoMotores } from '@/components/motores/CampoMotores'
import { MotoresSoloGeneral } from '@/components/motores/MotoresSoloGeneral'
import { LimiteError } from '@/components/errores/LimiteError'

/**
 * Motores y combustible (Campo, bloque 3). El servidor solo comprueba el permiso y entrega quién es: los datos los baja
 * el teléfono (fn_mot_estado_campo y fn_fert_estado_campo) y los guarda para trabajar sin señal.
 */
export default async function MotoresPage() {
  const [permisos, { perfil }] = await Promise.all([getPermisos(), getPerfilActual()])
  const trabaja = puede(permisos, 'motores', 'ver')
  // sql/149: «Vista general» (o «Auditar») sin «Ver» = solo la vista General de solo lectura
  const soloGeneral = !trabaja && (puede(permisos, 'motores', 'ver_general') || puede(permisos, 'motores', 'auditar'))
  if ((!trabaja && !soloGeneral) || !perfil) redirect('/')

  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 lg:p-6">
      <LimiteError modulo="motores">
        {soloGeneral ? <MotoresSoloGeneral generadoPor={perfil.nombre} /> : <CampoMotores usuarioId={perfil.id} />}
      </LimiteError>
    </div>
  )
}
