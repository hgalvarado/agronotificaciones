/**
 * Las pantallas a las que puede llevar el menú («destinos») y el menú de siempre.
 *
 * Antes todo esto vivía escrito dentro de AppShell. Se sacó aquí (puro: ni React ni Supabase) por dos razones:
 *   1. El Diseñador de menú por rol (migración 103) necesita la lista de destinos para ofrecerlos.
 *   2. `menuDeSiempre` es el menú EXACTO de antes, movido sin cambios: un rol sin menú diseñado lo sigue viendo
 *      igual (pruebas/unit/menu_por_rol.test.mjs lo compara con una copia del código anterior).
 *
 * Un destino NUNCA da acceso: `requiere` dice qué permiso hace falta para que aparezca (basta uno), y cada pantalla
 * sigue revisando el suyo.
 */

import { entradasDeLaBase, type PantallaDeMenu } from './menuBase'

/** Una entrada ya resuelta del menú (lo que dibuja AppShell). `icono` es un nombre de `ICONOS_MENU`. */
export type EntradaMenu = {
  href: string
  /** La llave de la entrada: el código de pantalla o del destino. Con esto se configura la barra del teléfono. */
  pantalla: string
  etiqueta: string
  icono: string
  hijos?: EntradaMenu[]
}

export type Destino = {
  /** Llave única; es el código de pantalla cuando el destino es una sola pantalla. */
  clave: string
  href: string
  etiqueta: string
  icono: string
  /** Permisos que lo hacen visible (basta uno): `pantalla` = «Ver», o `pantalla:accion`. */
  requiere: string[]
  /** Dónde se ofrece en el diseñador. */
  seccion: string
}

/** ¿Tiene la persona este permiso? `pantalla` a secas pregunta por «Ver». */
export type Tiene = (clave: string) => boolean

const DESINFECCION = ['desinfeccion_plan', 'desinfeccion_ejecucion', 'desinfeccion_logistica', 'desinfeccion_reporte']

/**
 * El menú de siempre, idéntico al que estaba escrito en AppShell hasta la 103 (incluidos sus detalles: el grupo
 * «Controles» se enseña si ve «Planes», Rotación o algo de Desinfección y le queda al menos un hijo visible).
 */
export function menuDeSiempre(
  ve: (pantalla: string) => boolean,
  pantallasMenu: PantallaDeMenu[],
  pantallasCatalogo: string[]
): EntradaMenu[] {
  type Item = Omit<EntradaMenu, 'hijos'> & { visible: boolean; hijos?: Item[] }
  const veAlgunCatalogo = pantallasCatalogo.some(ve)
  const items: Item[] = [
    { href: '/tickets', pantalla: 'tickets', etiqueta: 'Tickets', icono: 'ticket', visible: ve('tickets') },
    { href: '/horometros', pantalla: 'horometros', etiqueta: 'Horómetros', icono: 'gauge', visible: ve('horometros') },
    { href: '/labores', pantalla: 'labores', etiqueta: 'Labores', icono: 'mappin', visible: ve('labores') },
    { href: '/dashboard', pantalla: 'avance', etiqueta: 'Avance', icono: 'chart', visible: ve('avance') },
    {
      href: '/plan',
      pantalla: 'plan',
      etiqueta: 'Controles',
      icono: 'plan',
      visible: ve('plan') || ve('rotacion') || DESINFECCION.some(ve),
      hijos: [
        { href: '/plan/APS', pantalla: 'plan_aps', etiqueta: 'Emplasticado', icono: 'plan', visible: ve('plan_aps') },
        { href: '/controles/rotacion', pantalla: 'rotacion', etiqueta: 'Cultivos de Rotación', icono: 'chart', visible: ve('rotacion') },
        {
          href: '/controles/desinfeccion',
          pantalla: 'desinfeccion_ejecucion',
          etiqueta: 'Desinfección de suelo',
          icono: 'gota',
          visible: DESINFECCION.some(ve),
        },
      ],
    },
    { href: '/costos', pantalla: 'costos', etiqueta: 'Costos', icono: 'dinero', visible: ve('costos') },
    { href: '/admin/catalogos', pantalla: pantallasCatalogo[0], etiqueta: 'Catálogos', icono: 'ajustes', visible: veAlgunCatalogo },
    { href: '/admin/reporte-publico', pantalla: 'reporte_publico', etiqueta: 'Reporte público', icono: 'ajustes', visible: ve('reporte_publico') },
    { href: '/admin/usuarios', pantalla: 'usuarios', etiqueta: 'Usuarios', icono: 'usuario', visible: ve('usuarios') },
  ]

  // Módulos nuevos que la base pone en el menú (93): se agregan al final, sin tocar lo de arriba
  const yaEnMenu = {
    codigos: new Set([...items.flatMap((i) => [i.pantalla, ...(i.hijos ?? []).map((h) => h.pantalla)]), ...pantallasCatalogo]),
    hrefs: new Set(items.flatMap((i) => [i.href, ...(i.hijos ?? []).map((h) => h.href)])),
  }
  for (const e of entradasDeLaBase(pantallasMenu, ve, yaEnMenu)) {
    items.push({
      href: e.href,
      pantalla: e.pantalla,
      etiqueta: e.etiqueta,
      icono: e.icono,
      visible: true,
      hijos: e.hijos?.map((h) => ({ href: h.href, pantalla: h.pantalla, etiqueta: h.etiqueta, icono: h.icono, visible: true })),
    })
  }

  // Un grupo se muestra si él es visible y tiene al menos un hijo visible.
  const sinVisible = (i: Item): EntradaMenu => {
    const e: EntradaMenu = { href: i.href, pantalla: i.pantalla, etiqueta: i.etiqueta, icono: i.icono }
    return i.hijos ? { ...e, hijos: i.hijos.map(sinVisible) } : e
  }
  return items
    .map((i) => (i.hijos ? { ...i, hijos: i.hijos.filter((h) => h.visible) } : i))
    .filter((i) => i.visible && (!i.hijos || i.hijos.length > 0))
    .map(sinVisible)
}

/**
 * Todos los destinos que el diseñador puede poner en un menú: los del menú de siempre, las pantallas de
 * Administración y los módulos que la base marca «en menú». Sin repetir llave.
 */
export function catalogoDestinos(pantallasMenu: PantallaDeMenu[], pantallasCatalogo: string[]): Destino[] {
  const op = 'Operación'
  const ctl = 'Controles'
  const adm = 'Administración'
  const fijos: Destino[] = [
    { clave: 'tickets', href: '/tickets', etiqueta: 'Tickets', icono: 'ticket', requiere: ['tickets'], seccion: op },
    { clave: 'horometros', href: '/horometros', etiqueta: 'Horómetros', icono: 'gauge', requiere: ['horometros'], seccion: op },
    { clave: 'labores', href: '/labores', etiqueta: 'Labores', icono: 'mappin', requiere: ['labores'], seccion: op },
    { clave: 'avance', href: '/dashboard', etiqueta: 'Avance', icono: 'chart', requiere: ['avance'], seccion: op },
    { clave: 'plan', href: '/plan', etiqueta: 'Controles (portada)', icono: 'plan', requiere: ['plan'], seccion: ctl },
    { clave: 'plan_aps', href: '/plan/APS', etiqueta: 'Emplasticado', icono: 'plan', requiere: ['plan_aps'], seccion: ctl },
    { clave: 'rotacion', href: '/controles/rotacion', etiqueta: 'Cultivos de Rotación', icono: 'chart', requiere: ['rotacion'], seccion: ctl },
    {
      clave: 'desinfeccion_ejecucion',
      href: '/controles/desinfeccion',
      etiqueta: 'Desinfección de suelo',
      icono: 'gota',
      requiere: DESINFECCION,
      seccion: ctl,
    },
    { clave: 'costos', href: '/costos', etiqueta: 'Costos', icono: 'dinero', requiere: ['costos'], seccion: 'Costos' },
    { clave: pantallasCatalogo[0], href: '/admin/catalogos', etiqueta: 'Catálogos', icono: 'ajustes', requiere: pantallasCatalogo, seccion: adm },
    { clave: 'reporte_publico', href: '/admin/reporte-publico', etiqueta: 'Reporte público', icono: 'ajustes', requiere: ['reporte_publico'], seccion: adm },
    { clave: 'usuarios', href: '/admin/usuarios', etiqueta: 'Usuarios', icono: 'usuario', requiere: ['usuarios'], seccion: adm },
    // Pantallas de Administración que el menú de siempre no tenía (se entraba por la barra de Administración)
    { clave: 'catalogo_labores', href: '/admin/labores', etiqueta: 'Catálogo de labores', icono: 'ajustes', requiere: ['catalogo_labores'], seccion: adm },
    { clave: 'lotes', href: '/admin/lotes', etiqueta: 'Lotes', icono: 'mappin', requiere: ['lotes'], seccion: adm },
    { clave: 'historico', href: '/admin/historico', etiqueta: 'Carga histórica', icono: 'reloj', requiere: ['historico'], seccion: adm },
    { clave: 'tarifas', href: '/admin/tarifas', etiqueta: 'Tarifas', icono: 'dinero', requiere: ['tarifas'], seccion: adm },
    { clave: 'admin_contadores', href: '/admin/contadores', etiqueta: 'Contadores', icono: 'gauge', requiere: ['catalogo_equipos'], seccion: adm },
    { clave: 'permisos', href: '/admin/permisos', etiqueta: 'Permisos', icono: 'candado', requiere: ['permisos'], seccion: adm },
    { clave: 'admin_navegacion', href: '/admin/navegacion', etiqueta: 'Navegación móvil', icono: 'ajustes', requiere: ['permisos:editar'], seccion: adm },
    { clave: 'admin_menu', href: '/admin/menu', etiqueta: 'Menú por rol', icono: 'ajustes', requiere: ['permisos:disenar_menu'], seccion: adm },
    {
      clave: 'admin_fert_pruebas',
      href: '/admin/fertirriego-pruebas',
      etiqueta: 'Pruebas Fertirriego',
      icono: 'gota',
      requiere: ['fertirriego:configurar'],
      seccion: adm,
    },
    {
      clave: 'admin_fert_catalogos',
      href: '/admin/fertirriego-catalogos',
      etiqueta: 'Choferes y catálogos de campo',
      icono: 'tractor',
      requiere: ['fertirriego:gestionar_choferes'],
      seccion: adm,
    },
  ]

  const claves = new Set([...fijos.map((d) => d.clave), ...pantallasCatalogo])
  const hrefs = new Set(fijos.map((d) => d.href))
  const deLaBase: Destino[] = pantallasMenu
    .filter((p) => p.ruta && !claves.has(p.codigo) && !hrefs.has(p.ruta))
    .map((p) => ({
      clave: p.codigo,
      href: p.ruta,
      etiqueta: p.nombre,
      icono: p.icono || 'plan',
      requiere: [p.codigo],
      seccion: p.modulo || 'Otros',
    }))
  return [...fijos, ...deLaBase]
}
