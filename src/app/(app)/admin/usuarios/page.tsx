import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { GestionUsuarios } from '@/components/admin/GestionUsuarios'

export default async function UsuariosPage() {
  const { perfil } = await getPerfilActual()
  const permisos = await getPermisos()
  if (!puede(permisos, 'usuarios', 'ver')) redirect('/tickets')

  const supabase = await createClient()
  const [{ data: roles }, { data: departamentos }] = await Promise.all([
    supabase.from('roles').select('*').order('id'),
    supabase.from('departamentos').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Usuarios</h1>
        <p className="text-sm text-slate-400">
          Alta de personal, rol, departamento y activación de cuentas
        </p>
      </div>

      <GestionUsuarios
        roles={roles ?? []}
        departamentos={departamentos ?? []}
        miId={perfil?.id ?? ''}
      />
    </div>
  )
}
