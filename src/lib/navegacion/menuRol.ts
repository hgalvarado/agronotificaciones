/**
 * Menú por rol (migración 103): cómo se combina lo que diseñó el administrador con lo que la persona puede abrir.
 *
 * Reglas (las prueba pruebas/unit/menu_por_rol.test.mjs):
 *   1. Ningún rol de la persona tiene menú diseñado → `menuDeSiempre`, exactamente el de antes.
 *   2. El menú NUNCA da acceso: una entrada se ve solo si la persona tiene alguno de los permisos que pide su
 *      destino. Un grupo sin entradas visibles no se ve.
 *   3. Varios roles: se unen en orden (el principal primero). Grupos con el mismo nombre se juntan; una pantalla
 *      sale una sola vez, donde la puso el primer rol. Un rol sin diseño aporta el menú de siempre.
 *   4. «Incluir lo demás» (por omisión, sí): lo que el menú de siempre le enseñaría y el diseño no puso va al final,
 *      en «Otros». Así una pantalla de trabajo (p. ej. Fertirriego en campo) no se pierde por olvido.
 *   5. Inicio: el del primer rol diseñado cuyo inicio la persona puede abrir.
 *
 * Puro: ni React ni Supabase.
 */

import { catalogoDestinos, menuDeSiempre, type Destino, type EntradaMenu, type Tiene } from './destinos'
import type { PantallaDeMenu } from './menuBase'

export type NodoPantalla = { tipo: 'pantalla'; destino: string; etiqueta?: string | null; icono?: string | null }
export type NodoGrupo = { tipo: 'grupo'; etiqueta: string; icono?: string | null; hijos: NodoPantalla[] }
export type NodoMenu = NodoGrupo | NodoPantalla

/** Una fila de `fn_mi_menu()`: un rol de la persona y su diseño (si lo tiene). */
export type MenuDeRol = {
  rol_id: number
  principal: boolean
  disenado: boolean
  nodos: NodoMenu[] | null
  inicio: string | null
  incluir_resto: boolean
}

export const ETIQUETA_OTROS = 'Otros'

/**
 * `tiene` a partir de las claves «pantalla:accion» concedidas. `__sin_migracion__` (sin fn_mis_permisos) = todo,
 * igual que `puede()`.
 */
export function tieneDesde(permisos: Iterable<string>): Tiene {
  const set = new Set(permisos)
  const todo = set.has('__sin_migracion__')
  return (clave) => todo || set.has(clave.includes(':') ? clave : `${clave}:ver`)
}

/** El menú de siempre escrito como nodos del diseñador (punto de partida y «Restablecer»). */
export function nodosDeSiempre(pantallasMenu: PantallaDeMenu[], pantallasCatalogo: string[]): NodoMenu[] {
  const destinos = new Map(catalogoDestinos(pantallasMenu, pantallasCatalogo).map((d) => [d.clave, d]))
  const pantalla = (e: EntradaMenu): NodoPantalla => {
    const d = destinos.get(e.pantalla)
    return {
      tipo: 'pantalla',
      destino: e.pantalla,
      ...(d && d.etiqueta !== e.etiqueta ? { etiqueta: e.etiqueta } : {}),
      ...(d && d.icono !== e.icono ? { icono: e.icono } : {}),
    }
  }
  return menuDeSiempre(() => true, pantallasMenu, pantallasCatalogo).map((e) =>
    e.hijos ? { tipo: 'grupo', etiqueta: e.etiqueta, icono: e.icono, hijos: e.hijos.map(pantalla) } : pantalla(e)
  )
}

/** Las llaves de destino que usa un menú. */
export function destinosDe(nodos: NodoMenu[]): string[] {
  return nodos.flatMap((n) => (n.tipo === 'grupo' ? n.hijos.map((h) => h.destino) : [n.destino]))
}

export function construirMenu({
  menus,
  tiene,
  pantallasMenu,
  pantallasCatalogo,
}: {
  menus: MenuDeRol[]
  tiene: Tiene
  pantallasMenu: PantallaDeMenu[]
  pantallasCatalogo: string[]
}): { entradas: EntradaMenu[]; inicio: string | null; disenado: boolean } {
  const ve = (pantalla: string) => tiene(pantalla)
  if (!menus.some((m) => m.disenado && Array.isArray(m.nodos))) {
    return { entradas: menuDeSiempre(ve, pantallasMenu, pantallasCatalogo), inicio: null, disenado: false }
  }

  const destinos = new Map(catalogoDestinos(pantallasMenu, pantallasCatalogo).map((d) => [d.clave, d]))
  const deSiempre = nodosDeSiempre(pantallasMenu, pantallasCatalogo)
  const visible = (clave: string): Destino | null => {
    const d = destinos.get(clave)
    return d && d.requiere.some(tiene) ? d : null
  }

  // 1 · Unir los menús en orden (principal primero)
  const unidos: NodoMenu[] = []
  const grupos = new Map<string, NodoGrupo>()
  const usados = new Set<string>()
  const grupo = (etiqueta: string, icono?: string | null): NodoGrupo => {
    const llave = etiqueta.trim().toLowerCase()
    let g = grupos.get(llave)
    if (!g) {
      g = { tipo: 'grupo', etiqueta: etiqueta.trim(), icono: icono ?? null, hijos: [] }
      grupos.set(llave, g)
      unidos.push(g)
    }
    return g
  }
  const ordenados = [...menus].sort((a, b) => Number(b.principal) - Number(a.principal))
  for (const m of ordenados) {
    const nodos = m.disenado && Array.isArray(m.nodos) ? m.nodos : deSiempre
    for (const n of nodos) {
      if (n.tipo === 'grupo') {
        const g = grupo(n.etiqueta, n.icono)
        for (const h of n.hijos ?? []) {
          if (usados.has(h.destino)) continue
          usados.add(h.destino)
          g.hijos.push(h)
        }
      } else if (!usados.has(n.destino)) {
        usados.add(n.destino)
        unidos.push(n)
      }
    }
  }

  // 2 · Lo demás, al final en «Otros»
  if (menus.some((m) => !m.disenado || m.incluir_resto !== false)) {
    const faltan = destinosDe(deSiempre).filter((c) => !usados.has(c) && visible(c))
    if (faltan.length > 0) {
      const otros = grupo(ETIQUETA_OTROS)
      for (const c of faltan) {
        usados.add(c)
        otros.hijos.push({ tipo: 'pantalla', destino: c })
      }
    }
  }

  // 3 · Resolver contra los permisos
  const entrada = (n: NodoPantalla): EntradaMenu | null => {
    const d = visible(n.destino)
    return d ? { href: d.href, pantalla: d.clave, etiqueta: n.etiqueta?.trim() || d.etiqueta, icono: n.icono || d.icono } : null
  }
  const entradas: EntradaMenu[] = []
  for (const n of unidos) {
    if (n.tipo === 'pantalla') {
      const e = entrada(n)
      if (e) entradas.push(e)
      continue
    }
    const hijos = n.hijos.map(entrada).filter((e): e is EntradaMenu => e !== null)
    if (hijos.length === 0) continue
    entradas.push({ href: hijos[0].href, pantalla: hijos[0].pantalla, etiqueta: n.etiqueta, icono: n.icono || hijos[0].icono, hijos })
  }

  // 4 · Inicio
  let inicio: string | null = null
  for (const m of ordenados) {
    if (!m.disenado || !m.inicio) continue
    const d = visible(m.inicio)
    if (d) {
      inicio = d.href
      break
    }
  }
  return { entradas, inicio, disenado: true }
}
