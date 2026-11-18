/**
 * Las secciones de Administración y el grupo al que pertenece cada una.
 *
 * Es la ÚNICA lista: el layout filtra por permiso (matriz de la base) y la
 * navegación sólo dibuja lo que llega. Una sección nueva se agrega aquí con
 * su grupo; si el grupo no existe en `GRUPOS_ADMIN`, cae en «Otros».
 */
import { PANTALLAS_CATALOGO } from '@/lib/catalogos/grupos'

export type GrupoAdmin = { key: string; titulo: string }

export const GRUPOS_ADMIN: GrupoAdmin[] = [
  { key: 'datos', titulo: 'Datos maestros' },
  { key: 'costos', titulo: 'Costos' },
  { key: 'seguridad', titulo: 'Personas y seguridad' },
  { key: 'fertirriego', titulo: 'Fertirriego' },
]

export const GRUPO_OTROS: GrupoAdmin = { key: 'otros', titulo: 'Otros' }

export type SeccionAdmin = {
  pantalla: string
  accion?: string
  href: string
  etiqueta: string
  grupo: string
}

export const SECCIONES_ADMIN: SeccionAdmin[] = [
  { pantalla: PANTALLAS_CATALOGO[0], href: '/admin/catalogos', etiqueta: 'Catálogos', grupo: 'datos' },
  { pantalla: 'catalogo_labores', href: '/admin/labores', etiqueta: 'Labores', grupo: 'datos' },
  { pantalla: 'lotes', href: '/admin/lotes', etiqueta: 'Lotes', grupo: 'datos' },
  { pantalla: 'historico', href: '/admin/historico', etiqueta: 'Carga histórica', grupo: 'datos' },
  { pantalla: 'catalogo_equipos', href: '/admin/contadores', etiqueta: 'Contadores', grupo: 'datos' },
  { pantalla: 'tarifas', href: '/admin/tarifas', etiqueta: 'Tarifas', grupo: 'costos' },
  { pantalla: 'usuarios', href: '/admin/usuarios', etiqueta: 'Usuarios', grupo: 'seguridad' },
  { pantalla: 'permisos', href: '/admin/permisos', etiqueta: 'Permisos', grupo: 'seguridad' },
  // La navegación va con Permisos: las dos deciden qué ve cada rol, y
  // sólo el Administrador entra (la propia pantalla lo comprueba).
  { pantalla: 'permisos', href: '/admin/navegacion', etiqueta: 'Navegación', grupo: 'seguridad' },
  // 103: el menú de cada rol (casilla «Diseñar menú» de Permisos)
  { pantalla: 'permisos', accion: 'disenar_menu', href: '/admin/menu', etiqueta: 'Menú por rol', grupo: 'seguridad' },
  // 98: modo de pruebas de Fertirriego (quien configura Fertirriego)
  { pantalla: 'fertirriego', accion: 'configurar', href: '/admin/fertirriego-pruebas', etiqueta: 'Pruebas Fertirriego', grupo: 'fertirriego' },
  // 116: registro histórico (permiso temporal por persona y estación)
  { pantalla: 'fertirriego', accion: 'configurar', href: '/admin/fertirriego-historico', etiqueta: 'Registro histórico', grupo: 'fertirriego' },
  // 99: choferes, vehículos, envases y productos de campo
  { pantalla: 'fertirriego', accion: 'gestionar_choferes', href: '/admin/fertirriego-catalogos', etiqueta: 'Choferes y catálogos de campo', grupo: 'fertirriego' },
]

export type GrupoConSecciones = { key: string; titulo: string; secciones: { href: string; etiqueta: string }[] }

/** Agrupa las secciones YA filtradas por permiso; los grupos vacíos no salen. */
export function agruparSecciones(
  secciones: { href: string; etiqueta: string; grupo: string }[]
): GrupoConSecciones[] {
  const conocidos = new Set(GRUPOS_ADMIN.map((g) => g.key))
  return [...GRUPOS_ADMIN, GRUPO_OTROS]
    .map((g) => ({
      key: g.key,
      titulo: g.titulo,
      secciones: secciones
        .filter((s) => (g.key === GRUPO_OTROS.key ? !conocidos.has(s.grupo) : s.grupo === g.key))
        .map(({ href, etiqueta }) => ({ href, etiqueta })),
    }))
    .filter((g) => g.secciones.length > 0)
}
