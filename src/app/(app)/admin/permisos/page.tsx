import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPerfilActual } from '@/lib/auth'
import { PermisosMatrix } from '@/components/catalogos/PermisosMatrix'

export default async function PermisosPage() {
  const { rol } = await getPerfilActual()
  if (rol?.codigo !== 'ADMIN') redirect('/tickets') // sólo Administrador gestiona permisos

  const supabase = await createClient()
  const { data: roles } = await supabase.from('roles').select('*').order('id')
  const { data: permisos } = await supabase.from('permisos').select('*')

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-slate-900">Permisos por rol</h1>
      <PermisosMatrix roles={roles ?? []} permisos={permisos ?? []} />
    </div>
  )
}
