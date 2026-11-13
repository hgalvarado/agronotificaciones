import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPantallasMenu, getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import { DisenadorMenu, type MenuGuardado, type RolDelMenu } from '@/components/admin/DisenadorMenu'

/**
 * Administración › Menú por rol (migración 103). Entra quien tenga «Diseñar menú» en la pantalla Permisos (de
 * fábrica, los roles de acceso total); la base vuelve a preguntar lo mismo en cada función.
 */
export default async function MenuPorRolPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'permisos', 'disenar_menu')) redirect('/')

  const supabase = await createClient()
  const [{ data: roles }, { data: menus, error }, pantallasMenu] = await Promise.all([
    supabase.from('roles').select('id, codigo, nombre').order('nombre'),
    supabase.rpc('fn_menus_roles'),
    getPantallasMenu(),
  ])

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        <Alerta tono="ambar">
          El menú por rol todavía no está instalado. Corre la migración 103 en el SQL Editor de Supabase.
        </Alerta>
      </div>
    )
  }

  const guardados: Record<number, MenuGuardado> = {}
  for (const m of (menus as (MenuGuardado & { rol_id: number })[] | null) ?? []) guardados[m.rol_id] = m

  return (
    <div className="anim-aparecer mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Menú por rol</h1>
        <p className="text-sm text-slate-400">
          Arma el menú de cada rol: grupos, orden, nombres, íconos y la pantalla con la que entra. El menú{' '}
          <strong>no da acceso</strong>: cada persona solo ve lo que sus permisos le dejan abrir. Un rol sin menú
          diseñado sigue con el menú de siempre.
        </p>
      </div>
      <DisenadorMenu roles={(roles ?? []) as RolDelMenu[]} guardados={guardados} pantallasMenu={pantallasMenu} />
    </div>
  )
}
