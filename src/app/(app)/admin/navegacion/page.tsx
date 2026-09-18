import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import {
  ConfigurarNavegacion,
  type PantallaOpcion,
  type RolOpcion,
} from '@/components/admin/ConfigurarNavegacion'

export default async function NavegacionPage() {
  // Configurar la barra de otro rol es lo mismo que configurarle los
  // permisos, así que se pregunta por esa casilla de la matriz. Antes era
  // `rol?.codigo !== 'ADMIN'`, que es justo lo que se está quitando de
  // todo el sistema. La base aplica su propia regla en
  // `fn_guardar_navegacion`.
  const permisos = await getPermisos()
  if (!puede(permisos, 'permisos', 'editar')) redirect('/tickets')

  const supabase = await createClient()

  const [{ data: roles }, { data: pantallas }, { data: guardadas, error }] = await Promise.all([
    supabase.from('roles').select('id, codigo, nombre').order('id'),
    supabase.from('pantallas').select('codigo, nombre').order('orden'),
    supabase.from('navegacion_rol').select('rol_id, pantalla, orden').order('orden'),
  ])

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        <Alerta tono="ambar">
          La navegación por rol todavía no está instalada. Corre la migración 39 en el SQL Editor
          de Supabase.
        </Alerta>
      </div>
    )
  }

  const inicial: Record<number, string[]> = {}
  for (const f of guardadas ?? []) {
    const rolId = f.rol_id as number
    inicial[rolId] = [...(inicial[rolId] ?? []), f.pantalla as string]
  }

  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Navegación móvil</h1>
        <p className="text-sm text-slate-400">
          Qué accesos directos ve cada rol en la barra inferior del teléfono, y en qué orden. Es
          sólo la barra: los permisos siguen decidiendo a qué puede entrar cada quien, y lo que no
          quepa abajo sigue estando dentro de <strong>«Más»</strong>.
        </p>
      </div>

      <ConfigurarNavegacion
        roles={(roles ?? []) as RolOpcion[]}
        pantallas={(pantallas ?? []) as PantallaOpcion[]}
        inicial={inicial}
      />
    </div>
  )
}
