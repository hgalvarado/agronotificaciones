import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { redirect } from 'next/navigation'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { CampoFertirriego } from '@/components/fertirriego/CampoFertirriego'

/** El Manual del estacionero (docs/manuales). next.config lo incluye en el despliegue; si faltara, no hay botón. */
async function leerManual(): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), 'docs', 'manuales', '01-estacionero-fertirriego.md'), 'utf8')
  } catch {
    return null
  }
}

/**
 * Fertirriego · app de campo (Etapa B). El servidor solo comprueba el permiso y entrega quién es: los datos los
 * baja el teléfono (fn_fert_estado_campo) y los guarda para trabajar sin señal.
 */
export default async function FertirriegoPage() {
  const [permisos, { perfil }, manual] = await Promise.all([getPermisos(), getPerfilActual(), leerManual()])
  if (!puede(permisos, 'fertirriego', 'ver') || !perfil) redirect('/')

  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 lg:p-6">
      <CampoFertirriego usuarioId={perfil.id} manual={manual} />
    </div>
  )
}
