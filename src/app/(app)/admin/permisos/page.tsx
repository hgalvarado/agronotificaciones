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
  if (!puede(permisos, 'permisos', 'editar')) redirect('/')

  const supabase = await createClient()
  const [
    { data: roles },
    pantallasV2,
    { data: filasPermisos },
    accionesV2,
    { data: sinCasilla },
  ] = await Promise.all([
    supabase.from('roles').select('*').order('id'),
    // Migración 92: módulo, condición y nombres del alcance por pantalla
    supabase
      .from('pantallas')
      .select('codigo, nombre, descripcion, ruta, acciones, modulo, usa_condicion, etiquetas_alcance')
      .order('orden'),
    // `permitido` puede venir en falso y la fila sigue ahí, guardando el alcance y la condición.
    supabase.from('permisos').select('rol_id, recurso, accion, permitido, alcance, condicion'),
    // El catálogo de acciones: nombres, si escribe y (92) su nivel para los niveles rápidos.
    supabase.from('acciones').select('codigo, nombre, descripcion, orden, escribe, nivel').order('orden'),
    // El guardián: lo que la base exige y la matriz no ofrece. Tiene que venir vacío.
    supabase.rpc('fn_permisos_sin_casilla'),
  ])

  // Sin la 92 todavía, las columnas nuevas no existen: se piden las de antes y la pantalla agrupa en «Otros».
  const { data: pantallas, error } = pantallasV2.error
    ? await supabase.from('pantallas').select('codigo, nombre, descripcion, ruta, acciones').order('orden')
    : pantallasV2
  const { data: acciones } = accionesV2.error
    ? await supabase.from('acciones').select('codigo, nombre, descripcion, orden, escribe').order('orden')
    : accionesV2

  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Permisos</h1>
        <p className="text-sm text-slate-400">
          Qué puede ver y hacer cada rol, módulo por módulo. Elige el nivel de un toque y ajusta el
          alcance; se guarda al instante. Las zonas y los roles de cada persona se asignan en Usuarios.
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
