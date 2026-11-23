/**
 * Catálogo de OBJETIVOS de Inyección (sql/132): normalización, detección de duplicados y armado de lo que se envía.
 * Ni React, ni IndexedDB, ni red. La regla de normalización es IDÉNTICA a `fn_iny_normalizar_texto` (SQL) y a
 * `normalizar_objetivo` (AGL, Python): minúsculas, sin tildes, sin signos, espacios colapsados, singular/plural simple por
 * palabra (-es con más de 4 letras; -s con más de 3).
 */

export type ObjetivoCatalogo = {
  id: string
  nombre: string
  tipo: string
  origen: 'AGL' | 'CAMPO'
  activo: boolean
  revisado: boolean
  fusionado_en: string | null
}

/** Lo que viaja en la aplicación: id (existente o generado en el teléfono), nombre y tipo. */
export type ObjetivoElegido = { id: string; nombre: string; tipo?: string }

/** Tipos sugeridos al agregar (lista abierta: «Otro» siempre disponible). */
export const TIPOS_SUGERIDOS = ['Plaga', 'Maleza', 'Bacteria', 'Enfermedad', 'Hongo', 'Otro']

export const MAX_NOMBRE_OBJETIVO = 80

export function normalizarObjetivo(texto: string): string {
  const base = (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return base
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ')
}

/** Sigue las fusiones hasta el objetivo vigente (tope de 10 saltos). */
export function destinoVigente(catalogo: ObjetivoCatalogo[], id: string): ObjetivoCatalogo | null {
  let actual = catalogo.find((o) => o.id === id) ?? null
  for (let i = 0; actual?.fusionado_en && i < 10; i++) {
    const sig = catalogo.find((o) => o.id === actual!.fusionado_en)
    if (!sig) break
    actual = sig
  }
  return actual
}

/** Los que se pueden elegir: activos y no fusionados. */
export function objetivosElegibles(catalogo: ObjetivoCatalogo[]): ObjetivoCatalogo[] {
  return catalogo.filter((o) => o.activo && !o.fusionado_en).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export type ResultadoDuplicado = { duplicado: true; existente: ObjetivoCatalogo } | { duplicado: false }

/**
 * ¿Ya existe? Compara el nombre normalizado contra TODOS (activos, inactivos y fusionados) más los creados sin señal
 * que aún no suben. Devuelve el objetivo vigente (si el existente está fusionado, su destino).
 */
export function buscarDuplicado(nombre: string, catalogo: ObjetivoCatalogo[], locales: ObjetivoCatalogo[] = []): ResultadoDuplicado {
  const n = normalizarObjetivo(nombre)
  if (!n) return { duplicado: false }
  const todos = [...catalogo, ...locales]
  const hit = todos.find((o) => normalizarObjetivo(o.nombre) === n)
  if (!hit) return { duplicado: false }
  return { duplicado: true, existente: destinoVigente(todos, hit.id) ?? hit }
}

export const ERR_NOMBRE_OBJETIVO_VACIO = 'Escribe el nombre del objetivo'
export const ERR_NOMBRE_OBJETIVO_LARGO = `El nombre del objetivo es muy largo (máximo ${MAX_NOMBRE_OBJETIVO} caracteres)`

export function validarNombreObjetivo(nombre: string): string | null {
  const t = nombre.trim()
  if (!t || !normalizarObjetivo(t)) return ERR_NOMBRE_OBJETIVO_VACIO
  if (t.length > MAX_NOMBRE_OBJETIVO) return ERR_NOMBRE_OBJETIVO_LARGO
  return null
}

/** Objetivo creado en el teléfono (sin señal o con ella): id propio para que la aplicación lo referencie desde ya. */
export function crearObjetivoLocal(nombre: string, tipo: string, id: string): ObjetivoCatalogo {
  return { id, nombre: nombre.trim().replace(/\s+/g, ' '), tipo: tipo.trim() || 'Otro', origen: 'CAMPO', activo: true, revisado: false, fusionado_en: null }
}

/** Ids elegidos → lo que se manda a la base (sin repetir; los fusionados van a su destino; el nombre viaja para que la base pueda crearlo). */
export function objetivosParaEnviar(ids: string[], catalogo: ObjetivoCatalogo[]): ObjetivoElegido[] {
  const salida = new Map<string, ObjetivoElegido>()
  for (const id of ids) {
    const o = destinoVigente(catalogo, id)
    if (o) salida.set(o.id, { id: o.id, nombre: o.nombre, tipo: o.tipo })
  }
  return [...salida.values()]
}
