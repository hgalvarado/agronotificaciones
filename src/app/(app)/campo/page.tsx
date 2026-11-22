import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'
import { fichasCampo } from '@/lib/campo/fichas'
import { PanelCampo } from '@/components/campo/PanelCampo'
import { LimiteError } from '@/components/errores/LimiteError'

/** Campo · lista de fichas. Solo comprueba permisos: cada ficha se muestra por el permiso de su propia pantalla. */
export default async function CampoPage() {
  const permisos = await getPermisos()
  const fichas = fichasCampo((pantalla, accion) => puede(permisos, pantalla, accion))
  if (fichas.length === 0) redirect('/')

  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 lg:p-6">
      <LimiteError modulo="campo">
        <PanelCampo fichas={fichas} />
      </LimiteError>
    </div>
  )
}
