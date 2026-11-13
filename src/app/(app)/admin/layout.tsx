import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'
import { AdminNav } from '@/components/admin/AdminNav'
import { PANTALLAS_CATALOGO } from '@/lib/catalogos/grupos'

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

  const secciones = [
    { pantalla: PANTALLAS_CATALOGO[0], href: '/admin/catalogos', etiqueta: 'Catálogos' },
    { pantalla: 'catalogo_labores', href: '/admin/labores', etiqueta: 'Labores' },
    { pantalla: 'lotes', href: '/admin/lotes', etiqueta: 'Lotes' },
    { pantalla: 'historico', href: '/admin/historico', etiqueta: 'Carga histórica' },
    { pantalla: 'tarifas', href: '/admin/tarifas', etiqueta: 'Tarifas' },
    { pantalla: 'usuarios', href: '/admin/usuarios', etiqueta: 'Usuarios' },
    { pantalla: 'catalogo_equipos', href: '/admin/contadores', etiqueta: 'Contadores' },
    { pantalla: 'permisos', href: '/admin/permisos', etiqueta: 'Permisos' },
    // La navegación va con Permisos: las dos deciden qué ve cada rol, y
    // sólo el Administrador entra (la propia pantalla lo comprueba).
    { pantalla: 'permisos', href: '/admin/navegacion', etiqueta: 'Navegación' },
    // 103: el menú de cada rol (casilla «Diseñar menú» de Permisos; de fábrica solo los roles de acceso total)
    { pantalla: 'permisos', accion: 'disenar_menu', href: '/admin/menu', etiqueta: 'Menú por rol' },
    // 98: modo de pruebas de Fertirriego (quien configura Fertirriego)
    { pantalla: 'fertirriego', accion: 'configurar', href: '/admin/fertirriego-pruebas', etiqueta: 'Pruebas Fertirriego' },
    // 99: choferes, vehículos, envases y productos de campo (quien gestiona choferes)
    { pantalla: 'fertirriego', accion: 'gestionar_choferes', href: '/admin/fertirriego-catalogos', etiqueta: 'Choferes y catálogos de campo' },
  ].filter((s) => puede(permisos, s.pantalla, ('accion' in s && s.accion) || 'ver'))

  if (secciones.length === 0) redirect('/')

  return (
    <div className="flex flex-col">
      <AdminNav secciones={secciones.map(({ href, etiqueta }) => ({ href, etiqueta }))} />
      {children}
    </div>
  )
}
