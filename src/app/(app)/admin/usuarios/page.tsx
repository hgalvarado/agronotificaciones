import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { GestionUsuarios } from '@/components/admin/GestionUsuarios'

export default async function UsuariosPage() {
  const { perfil } = await getPerfilActual()
  const permisos = await getPermisos()
  if (!puede(permisos, 'usuarios', 'ver')) redirect('/')

  const supabase = await createClient()
  const [{ data: roles }, { data: departamentos }, { data: zonas }, { data: estaciones }, pantallasV2, { data: acciones }] =
    await Promise.all([
      supabase.from('roles').select('*').order('id'),
      supabase.from('departamentos').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('zonas').select('id, nombre').eq('activo', true).order('nombre'),
      // Fertirriego (91): las estaciones que se le pueden asignar a la persona
      supabase.from('estaciones_riego').select('id, nombre, zona_id').eq('activo', true).order('nombre'),
      // Para leer «qué puede hacer» agrupado por módulo (92)
      supabase.from('pantallas').select('codigo, nombre, modulo, etiquetas_alcance').order('orden'),
      supabase.from('acciones').select('codigo, nombre'),
    ])
  const { data: pantallas } = pantallasV2.error
    ? await supabase.from('pantallas').select('codigo, nombre').order('orden')
    : pantallasV2

  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Usuarios</h1>
        <p className="text-sm text-slate-400">
          Alta de personal, sus roles, zonas y estaciones, y qué puede hacer cada persona
        </p>
      </div>

      <GestionUsuarios
        roles={roles ?? []}
        departamentos={departamentos ?? []}
        zonas={zonas ?? []}
        estaciones={estaciones ?? []}
        pantallas={pantallas ?? []}
        acciones={acciones ?? []}
        puedeAsignarEstaciones={puede(permisos, 'fertirriego', 'administrar_estaciones')}
        miId={perfil?.id ?? ''}
      />
    </div>
  )
}
