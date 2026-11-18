import { redirect } from 'next/navigation'
import { getPermisos, getUsuarioActual, puede } from '@/lib/auth'
import { AdminNav } from '@/components/admin/AdminNav'
import { ContextoAdmin } from '@/components/admin/ContextoAdmin'
import { arbolDeclarado } from '@/lib/catalogos/grupos'
import { SECCIONES_ADMIN } from '@/lib/navegacion/adminSecciones'

/**
 * El grupo de administración ya no se decide por rol.
 *
 * Antes decía `if (!esAdmin && !esTorre) redirect('/')`, así que a
 * un usuario al que se le daba permiso de ver Catálogos o Tarifas la
 * plataforma lo sacaba igual — justo lo que él reportó. Ahora se entra si
 * tiene permiso de al menos una de las pantallas de aquí, y cada pantalla
 * revisa el suyo.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const permisos = await getPermisos()

  const secciones = SECCIONES_ADMIN.filter((s) => puede(permisos, s.pantalla, s.accion || 'ver'))

  if (secciones.length === 0) redirect('/')

  const usuario = await getUsuarioActual()
  // Los catálogos que se ven en el árbol: los mismos bloques que la matriz deja ver en la página.
  const catalogos = arbolDeclarado((pantalla) => puede(permisos, pantalla, 'ver'))

  return (
    <ContextoAdmin>
      <div className="flex flex-col xl:flex-row xl:items-start">
        <AdminNav
          secciones={secciones.map(({ href, etiqueta, grupo }) => ({ href, etiqueta, grupo }))}
          catalogos={catalogos}
          usuarioId={usuario?.id ?? 'anonimo'}
        />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </ContextoAdmin>
  )
}
