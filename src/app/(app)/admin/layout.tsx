import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'
import { AdminNav } from '@/components/admin/AdminNav'

/**
 * El grupo de administración ya no se decide por rol.
 *
 * Antes decía `if (!esAdmin && !esTorre) redirect('/tickets')`, así que a
 * un usuario al que se le daba permiso de ver Catálogos o Tarifas la
 * plataforma lo sacaba igual — justo lo que él reportó. Ahora se entra si
 * tiene permiso de al menos una de las pantallas de aquí, y cada pantalla
 * revisa el suyo.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const permisos = await getPermisos()

  const secciones = [
    { pantalla: 'catalogos', href: '/admin/catalogos', etiqueta: 'Catálogos' },
    { pantalla: 'catalogos', href: '/admin/labores', etiqueta: 'Labores' },
    { pantalla: 'lotes', href: '/admin/lotes', etiqueta: 'Lotes' },
    { pantalla: 'historico', href: '/admin/historico', etiqueta: 'Carga histórica' },
    { pantalla: 'tarifas', href: '/admin/tarifas', etiqueta: 'Tarifas' },
    { pantalla: 'usuarios', href: '/admin/usuarios', etiqueta: 'Usuarios' },
    { pantalla: 'permisos', href: '/admin/permisos', etiqueta: 'Permisos' },
  ].filter((s) => puede(permisos, s.pantalla, 'ver'))

  if (secciones.length === 0) redirect('/tickets')

  return (
    <div className="flex flex-col">
      <AdminNav secciones={secciones.map(({ href, etiqueta }) => ({ href, etiqueta }))} />
      {children}
    </div>
  )
}
