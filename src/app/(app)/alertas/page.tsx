import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { PanelAlertas } from '@/components/alertas/PanelAlertas'
import { LimiteError } from '@/components/errores/LimiteError'

/** Centro de alertas. El servidor solo comprueba el permiso y el alcance; los datos los pide el navegador. */
export default async function AlertasPage() {
  const [permisos, { perfil }] = await Promise.all([getPermisos(), getPerfilActual()])
  if (!perfil || !puede(permisos, 'alertas', 'ver')) redirect('/')
  const supabase = await createClient()
  const { data: alcance } = await supabase.rpc('fn_alertas_mi_alcance')

  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 lg:p-6">
      <LimiteError modulo="alertas">
        <PanelAlertas esControl={alcance === 'global'} />
      </LimiteError>
    </div>
  )
}
