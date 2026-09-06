'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const RECURSOS = [
  'ticket',
  'horometro',
  'registro',
  'catalogo_ubicaciones',
  'catalogo_equipos',
  'catalogo_implementos',
  'catalogo_operadores',
  'catalogo_labores',
] as const

const ACCIONES = ['create', 'read', 'update', 'delete'] as const

type Permiso = { rol_id: number; recurso: string; accion: string }
type RolSelect = { id: number; codigo: string; nombre: string }

export function PermisosMatrix({ roles, permisos }: { roles: RolSelect[]; permisos: Permiso[] }) {
  const supabase = createClient()
  const router = useRouter()

  function tienePermiso(rolId: number, recurso: string, accion: string) {
    return permisos.some((p) => p.rol_id === rolId && p.recurso === recurso && p.accion === accion)
  }

  async function toggle(rolId: number, recurso: string, accion: string, activo: boolean) {
    if (activo) {
      await supabase.from('permisos').delete().match({ rol_id: rolId, recurso, accion })
    } else {
      await supabase.from('permisos').insert({ rol_id: rolId, recurso, accion })
    }
    router.refresh()
  }

  const rolesEditables = roles.filter((r) => r.codigo !== 'ADMIN') // Admin siempre tiene acceso total (bypass en RLS)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-slate-400">
        El Administrador siempre tiene acceso total (no depende de esta tabla). Aquí sólo se configura Torre de Control y Digitador.
      </p>
      {rolesEditables.map((rol) => (
        <div key={rol.id} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">{rol.nombre}</p>
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-slate-400">
                <th className="px-3 py-2">Recurso</th>
                {ACCIONES.map((a) => (
                  <th key={a} className="px-3 py-2 text-center">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RECURSOS.map((recurso) => (
                <tr key={recurso} className="border-t border-slate-50">
                  <td className="px-3 py-2 text-slate-700">{recurso}</td>
                  {ACCIONES.map((accion) => {
                    const activo = tienePermiso(rol.id, recurso, accion)
                    return (
                      <td key={accion} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={activo}
                          onChange={() => toggle(rol.id, recurso, accion, activo)}
                          className="h-5 w-5 accent-emerald-700"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
