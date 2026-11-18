/**
 * Lógica pura del árbol de Administración: favoritos, recientes y búsqueda.
 * Sin React ni almacenamiento: eso vive en `prefsAdmin`.
 */

export type EntradaNav = {
  /** Ruta con su query, p. ej. `/admin/catalogos?catalogo=equipos`. */
  href: string
  etiqueta: string
  /** Dónde está («Datos maestros», «Equipos e implementos»…); sirve en la búsqueda. */
  contexto?: string
}

export type PrefsNav = {
  /** Qué grupos del árbol dejó la persona abiertos (true) o cerrados (false). */
  abiertos: Record<string, boolean>
  favoritos: EntradaNav[]
  recientes: EntradaNav[]
}

export const PREFS_VACIAS: PrefsNav = { abiertos: {}, favoritos: [], recientes: [] }
export const MAX_RECIENTES = 5
export const MAX_FAVORITOS = 20

function entradaValida(x: unknown): x is EntradaNav {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return typeof e.href === 'string' && e.href.startsWith('/') && typeof e.etiqueta === 'string'
}

/** Lee lo guardado sin fiarse de él: datos viejos o manoseados no rompen la pantalla. */
export function normalizarPrefs(crudo: unknown): PrefsNav {
  if (!crudo || typeof crudo !== 'object') return PREFS_VACIAS
  const c = crudo as Record<string, unknown>
  const abiertos: Record<string, boolean> = {}
  if (c.abiertos && typeof c.abiertos === 'object') {
    for (const [k, v] of Object.entries(c.abiertos as Record<string, unknown>)) {
      if (typeof v === 'boolean') abiertos[k] = v
    }
  }
  const lista = (v: unknown, max: number) =>
    (Array.isArray(v) ? v.filter(entradaValida) : [])
      .map((e) => ({ href: e.href, etiqueta: e.etiqueta, contexto: e.contexto }))
      .slice(0, max)
  return {
    abiertos,
    favoritos: lista(c.favoritos, MAX_FAVORITOS),
    recientes: lista(c.recientes, MAX_RECIENTES),
  }
}

export function esFavorito(p: PrefsNav, href: string): boolean {
  return p.favoritos.some((f) => f.href === href)
}

export function alternarFavorito(p: PrefsNav, e: EntradaNav): PrefsNav {
  if (esFavorito(p, e.href)) return { ...p, favoritos: p.favoritos.filter((f) => f.href !== e.href) }
  return { ...p, favoritos: [e, ...p.favoritos].slice(0, MAX_FAVORITOS) }
}

/** La última abierta va primero; sin repetidos; máximo 5. Devuelve el mismo objeto si no cambia. */
export function registrarReciente(p: PrefsNav, e: EntradaNav): PrefsNav {
  if (p.recientes[0]?.href === e.href) return p
  return { ...p, recientes: [e, ...p.recientes.filter((r) => r.href !== e.href)].slice(0, MAX_RECIENTES) }
}

export function cambiarAbierto(p: PrefsNav, clave: string, abierto: boolean): PrefsNav {
  return { ...p, abiertos: { ...p.abiertos, [clave]: abierto } }
}

/** Sin acentos y en minúsculas: «catalogos» encuentra «Catálogos». */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Filtra por lo escrito (todas las palabras deben aparecer en el nombre o en
 * dónde está). Primero los que EMPIEZAN con lo escrito.
 */
export function filtrarEntradas(entradas: EntradaNav[], texto: string): EntradaNav[] {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return []
  const vistos = new Set<string>()
  const hallados: { e: EntradaNav; peso: number }[] = []
  for (const e of entradas) {
    if (vistos.has(e.href)) continue
    const nombre = normalizar(e.etiqueta)
    const todo = `${nombre} ${normalizar(e.contexto ?? '')}`
    if (!palabras.every((p) => todo.includes(p))) continue
    vistos.add(e.href)
    hallados.push({ e, peso: nombre.startsWith(palabras[0]) ? 0 : nombre.includes(palabras[0]) ? 1 : 2 })
  }
  return hallados.sort((a, b) => a.peso - b.peso).map((h) => h.e)
}
