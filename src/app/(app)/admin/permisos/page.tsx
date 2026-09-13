import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  PermisosPantallas,
  type Pantalla,
  type PermisoFila,
  type RolFila,
} from '@/components/admin/PermisosPantallas'
import { Alerta } from '@/components/ui/Primitivos'
import { getPermisos, puede } from '@/lib/auth'

export default async function PermisosPage() {
  const permisos = await getPermisos()
  // La matriz de permisos sigue siendo del Administrador: la policy de la
  // tabla `permisos` sólo lo deja escribir a él, así que dársela a otro
  // rol mostraría una pantalla que no puede guardar nada.
  if (!puede(permisos, 'permisos', 'editar')) redirect('/tickets')

  const supabase = await createClient()
  const [{ data: roles }, { data: pantallas, error }, { data: filasPermisos }] =
    await Promise.all([
      supabase.from('roles').select('id, codigo, nombre').order('id'),
      supabase
        .from('pantallas')
        .select('codigo, nombre, descripcion, ruta, acciones')
        .order('orden'),
      supabase.from('permisos').select('rol_id, recurso, accion'),
    ])

  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Permisos</h1>
        <p className="text-sm text-slate-400">
          Qué puede ver y hacer cada rol, pantalla por pantalla.
        </p>
      </div>

      {error ? (
        <Alerta>
          No se pudo leer el catálogo de pantallas: {error.message}. Si dice que no existe
          «pantallas», falta ejecutar la migración 12 en el SQL Editor de Supabase.
        </Alerta>
      ) : (
        <PermisosPantallas
          roles={(roles as RolFila[] | null) ?? []}
          pantallas={(pantallas as Pantalla[] | null) ?? []}
          permisos={(filasPermisos as PermisoFila[] | null) ?? []}
        />
      )}
    </div>
  )
}
