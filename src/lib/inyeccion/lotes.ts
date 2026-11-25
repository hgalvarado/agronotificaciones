/**
 * Lotes de Inyección: SOLO los del catálogo de lotes (public.lotes + lotes_temporada), que la base entrega en
 * fn_iny_estado_campo (`lotes`, con caché sin señal). Nunca se escribe ni se crea un lote en el teléfono.
 * Ni React, ni IndexedDB, ni red. La base vuelve a validar (sql/132).
 */

export type LoteCatalogo = {
  lote_temporada_id: string
  nomenclatura: string
  nombre: string | null
  temporada: string
  activa: boolean
  /** sql/141: zona del lote en esa temporada (la base ya entrega solo los de las zonas de la persona). */
  zona_id?: string | null
  zona?: string | null
}

/** Nomenclatura normalizada: sin espacios y en minúsculas («1002-010 » = «1002-010»). Igual a `_iny_norm_lote` (SQL). */
export const normLote = (s: string): string => (s ?? '').replace(/\s+/g, '').toLowerCase()

const llaveTemporada = (s: string): string => (s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '')

/** La nomenclatura canónica del catálogo para un texto, o null si ese lote no está en el catálogo. */
export function loteCanonico(catalogo: LoteCatalogo[], texto: string): string | null {
  const n = normLote(texto)
  if (!n) return null
  return catalogo.find((l) => normLote(l.nomenclatura) === n)?.nomenclatura ?? null
}

/**
 * La temporada con la que se registra el lote: la del plan si la hay y el lote está asignado a ella; si no, la activa;
 * si no, la primera. null si el lote no está en el catálogo.
 */
export function temporadaDeLote(catalogo: LoteCatalogo[], nomenclatura: string, temporadaPlan?: string | null): string | null {
  const n = normLote(nomenclatura)
  const filas = catalogo.filter((l) => normLote(l.nomenclatura) === n)
  if (filas.length === 0) return null
  if (temporadaPlan) {
    const k = llaveTemporada(temporadaPlan)
    const hit = filas.find((l) => llaveTemporada(l.temporada) === k)
    if (hit) return hit.temporada
  }
  return (filas.find((l) => l.activa) ?? filas[0]).temporada
}

/** «Nombre · código» de un lote (solo el código si el catálogo no trae nombre). Es el rótulo de TODAS las pantallas de Inyección. */
export function rotuloLote(catalogo: LoteCatalogo[] | undefined, nomenclatura: string): string {
  const n = normLote(nomenclatura)
  const nombre = (catalogo ?? []).find((l) => normLote(l.nomenclatura) === n && l.nombre?.trim())?.nombre?.trim()
  return nombre && normLote(nombre) !== n ? `${nombre} · ${nomenclatura}` : nomenclatura
}

export type OpcionLote = { id: string; titulo: string; subtitulo?: string; grupo: string; destacado?: boolean }

export const GRUPO_CON_PLAN = 'Con plan en esta estación'
export const GRUPO_CATALOGO = 'Otros lotes del catálogo'

/** Opciones del selector: los lotes con plan de la estación primero (marcados), después el resto del catálogo; sin repetir. */
export function opcionesDeLotes(catalogo: LoteCatalogo[], lotesConPlan: string[]): OpcionLote[] {
  const conPlan = new Set(lotesConPlan.map(normLote))
  const vistos = new Map<string, OpcionLote>()
  for (const l of catalogo) {
    const k = normLote(l.nomenclatura)
    if (vistos.has(k)) continue
    const plan = conPlan.has(k)
    vistos.set(k, { id: l.nomenclatura, titulo: rotuloLote(catalogo, l.nomenclatura), subtitulo: l.zona || undefined, grupo: plan ? GRUPO_CON_PLAN : GRUPO_CATALOGO, destacado: plan })
  }
  return [...vistos.values()].sort(
    (a, b) => Number(b.destacado ?? false) - Number(a.destacado ?? false) || a.titulo.localeCompare(b.titulo, 'es', { numeric: true })
  )
}
