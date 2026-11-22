import { redirect } from 'next/navigation'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { CampoInyeccion } from '@/components/inyeccion/CampoInyeccion'
import { LimiteError } from '@/components/errores/LimiteError'

/**
 * Inyección · aplicar por lote (Campo, bloque 2). El servidor solo comprueba el permiso y entrega quién es: los datos
 * los baja el teléfono (fn_iny_estado_campo y fn_fert_estado_campo) y los guarda para trabajar sin señal.
 */
export default async function InyeccionPage() {
  const [permisos, { perfil }] = await Promise.all([getPermisos(), getPerfilActual()])
  if (!puede(permisos, 'inyeccion', 'ver') || !perfil) redirect('/')

  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 lg:p-6">
      <LimiteError modulo="inyeccion">
        <CampoInyeccion usuarioId={perfil.id} />
      </LimiteError>
    </div>
  )
}
