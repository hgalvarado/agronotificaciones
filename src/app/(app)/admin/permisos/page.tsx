import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  PermisosPantallas,
  type AccionCatalogo,
  type LlaveSinCasilla,
  type Pantalla,
  type PermisoFila,
  type RolFila,
} from '@/components/admin/PermisosPantallas'
import { Alerta } from '@/components/ui/Primitivos'
import { getPermisos, puede } from '@/lib/auth'

export default async function PermisosPage() {
  const permisos = await getPermisos()
  // Desde la 43, quien tenga «Permisos: editar» entra y puede guardar: la
  // policy de la tabla `permisos` acepta exactamente eso.
  if (!puede(permisos, 'permisos', 'editar')) redirect('/tickets')

  const supabase = await createClient()
  const [
    { data: roles },
    { data: pantallas, error },
    { data: filasPermisos },
    { data: acciones },
    { data: sinCasilla },
  ] = await Promise.all([
    supabase.from('roles').select('*').order('id'),
    supabase
      .from('pantallas')
      .select('codigo, nombre, descripcion, ruta, acciones')
      .order('orden'),
    supabase.from('permisos').select('rol_id, recurso, accion'),
    // El catálogo de acciones manda las columnas. Llega con la migración
    // 44; sin ella la pantalla se dibuja igual, sacando las columnas de
    // lo que declare cada pantalla.
    supabase.from('acciones').select('codigo, nombre, descripcion, orden').order('orden'),
    // Y el guardián: lo que la base exige y la matriz no ofrece. Tiene que
    // venir vacío.
    supabase.rpc('fn_permisos_sin_casilla'),
  ])

  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Permisos</h1>
        <p className="text-sm text-slate-400">
          Qué puede ver y hacer cada rol, pantalla por pantalla. Las columnas salen del catálogo de
          la base: todo lo que la aplicación restrinja tiene aquí su casilla.
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
          acciones={(acciones as AccionCatalogo[] | null) ?? []}
          sinCasilla={(sinCasilla as LlaveSinCasilla[] | null) ?? []}
        />
      )}
    </div>
  )
}
