/**
 * Filtros del historial de Inyección (cuentas puras): rango de fechas de aplicación, DDT, producto, lote, estado del
 * cumplimiento y quién aplicó. Los mismos filtros sirven para la lista de aplicaciones y para el Plan contra real.
 */

import type { AplicacionInyeccion, LineaAplicacionInyeccion } from './estado'
import type { EtiquetaCumplimiento, FilaCumplimiento } from './cumplimiento'
import { normLote } from './lotes'

export type FiltrosInyeccion = {
  /** AAAA-MM-DD en hora de Honduras (fecha de aplicación). */
  desde: string
  hasta: string
  ddtDesde: string
  ddtHasta: string
  productos: string[]
  /** Nomenclaturas de lote. */
  lotes: string[]
  estados: EtiquetaCumplimiento[]
  /** ids de perfil de quien aplicó. */
  personas: string[]
}

export const SIN_FILTROS_INY: FiltrosInyeccion = { desde: '', hasta: '', ddtDesde: '', ddtHasta: '', productos: [], lotes: [], estados: [], personas: [] }

const entero = (t: string): number | null => {
  const n = Number(t.trim())
  return t.trim() && Number.isFinite(n) ? n : null
}

/** Cuántos filtros están puestos (el rango de fechas y el de DDT cuentan uno cada uno). */
export function filtrosActivosIny(f: FiltrosInyeccion): number {
  return (
    (f.desde || f.hasta ? 1 : 0) +
    (entero(f.ddtDesde) !== null || entero(f.ddtHasta) !== null ? 1 : 0) +
    (f.productos.length ? 1 : 0) +
    (f.lotes.length ? 1 : 0) +
    (f.estados.length ? 1 : 0) +
    (f.personas.length ? 1 : 0)
  )
}

const dentroDdt = (ddt: number | null, f: FiltrosInyeccion) => {
  const d = entero(f.ddtDesde)
  const h = entero(f.ddtHasta)
  if (d === null && h === null) return true
  if (ddt === null) return false
  return (d === null || ddt >= d) && (h === null || ddt <= h)
}
const dentroFechas = (fecha: string | null, f: FiltrosInyeccion) => {
  if (!f.desde && !f.hasta) return true
  if (!fecha) return false
  return (!f.desde || fecha >= f.desde) && (!f.hasta || fecha <= f.hasta)
}
const loteEn = (lote: string, f: FiltrosInyeccion) => f.lotes.length === 0 || f.lotes.some((l) => normLote(l) === normLote(lote))

/** ¿Esta fila del Plan contra real pasa los filtros? (la fecha es la de la aplicación; sin aplicar: la del plan). */
export function filaCumple(fila: FilaCumplimiento, f: FiltrosInyeccion): boolean {
  if (!dentroFechas(fila.fecha_real ?? fila.fecha_plan, f)) return false
  if (!dentroDdt(fila.ddt, f)) return false
  if (f.productos.length && !f.productos.includes(fila.material_id)) return false
  if (!loteEn(fila.lote, f)) return false
  if (f.estados.length && !f.estados.some((e) => fila.tags.includes(e))) return false
  if (f.personas.length && !fila.aplicaciones.some((a) => a.registrado_por && f.personas.includes(a.registrado_por))) return false
  return true
}

/** ¿Esta línea de una aplicación pasa los filtros? `fila` = su fila de cumplimiento (si la hay). */
export function lineaCumple(a: AplicacionInyeccion, l: LineaAplicacionInyeccion, fila: FilaCumplimiento | undefined, f: FiltrosInyeccion): boolean {
  if (!dentroFechas(a.fecha ?? a.fecha_hora.slice(0, 10), f)) return false
  if (!dentroDdt(l.ddt_plan ?? null, f)) return false
  if (f.productos.length && !f.productos.includes(l.material_id)) return false
  if (!loteEn(a.lote, f)) return false
  if (f.personas.length && !(a.registrado_por && f.personas.includes(a.registrado_por))) return false
  if (f.estados.length) {
    const tags = fila?.tags ?? (l.en_plan ? [] : (['sin_plan'] as EtiquetaCumplimiento[]))
    if (!f.estados.some((e) => tags.includes(e))) return false
  }
  return true
}
