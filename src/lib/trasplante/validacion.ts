/**
 * Validación del módulo de trasplante. Funciones puras: entra lo que
 * escribió el usuario, sale un valor con forma conocida o un error en
 * castellano. Sin red, sin base y sin React.
 */

import { esFechaIso, hoyIso } from '@/lib/fechas'
import { CICLOS_SIEMBRA } from './tipos'

export function esFecha(v: string | null | undefined): boolean {
  return esFechaIso(v)
}

/* El «hoy» del trasplante es el mismo «hoy» del resto: el de Honduras. */
export { hoyIso }

/**
 * La semana ISO de una fecha, tal como la calcula la base.
 *
 * Se repite aquí —la base la guarda en una columna generada— porque el
 * formulario la enseña ANTES de guardar. Es la misma regla: semana que
 * empieza en lunes, y el jueves decide a qué año pertenece.
 */
export function semanaIso(iso: string): string {
  if (!esFecha(iso)) return ''
  const d = new Date(iso + 'T00:00:00Z')
  const dia = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dia)
  const anio = d.getUTCFullYear()
  const enero1 = new Date(Date.UTC(anio, 0, 1))
  const semana = Math.ceil(((d.getTime() - enero1.getTime()) / 86400000 + 1) / 7)
  return `${anio}-S${String(semana).padStart(2, '0')}`
}

/** Plantas por manzana: lo que el formulario muestra mientras se escribe. */
export function plantasPorMz(plantas: string, mz: string): number | null {
  const p = Number(plantas)
  const a = Number(mz)
  if (!Number.isFinite(p) || !Number.isFinite(a) || a <= 0 || !plantas.trim()) return null
  return Math.round((p / a) * 100) / 100
}

export type EntradaSiembra = {
  fecha_siembra: string
  lote_temporada_id: string
  variedad_id: string
  ciclo: string
  avance_mz: string
  plantas_reportadas: string
  lote_variedad: string
  observaciones: string
}

export function validarSiembra(e: EntradaSiembra): string | null {
  if (!esFecha(e.fecha_siembra)) return 'Escribe la fecha de siembra.'
  if (!e.lote_temporada_id) return 'Elige el lote.'
  if (!e.variedad_id) return 'Elige la variedad.'
  if (!CICLOS_SIEMBRA.includes(Number(e.ciclo) as 1 | 2 | 3)) return 'El ciclo debe ser 1, 2 o 3.'

  const mz = Number(e.avance_mz)
  if (!e.avance_mz.trim() || !Number.isFinite(mz) || mz <= 0) {
    return 'El avance en manzanas tiene que ser mayor que cero.'
  }

  if (e.plantas_reportadas.trim()) {
    const p = Number(e.plantas_reportadas)
    if (!Number.isFinite(p) || p < 0) return 'Las plantas reportadas no son un número válido.'
  }
  return null
}

export type EntradaPlan = {
  lote_temporada_id: string
  variedad_id: string
  ciclo: string
  area_plan: string
  fecha_siembra: string
  distancia_siembra: string
}

export function validarPlan(e: EntradaPlan): string | null {
  if (!e.lote_temporada_id) return 'Elige el lote.'
  if (!e.variedad_id) return 'Elige la variedad.'
  if (!CICLOS_SIEMBRA.includes(Number(e.ciclo) as 1 | 2 | 3)) return 'El ciclo debe ser 1, 2 o 3.'

  const area = Number(e.area_plan)
  if (!e.area_plan.trim() || !Number.isFinite(area) || area < 0) {
    return 'El área a sembrar no es un número válido.'
  }
  if (e.fecha_siembra.trim() && !esFecha(e.fecha_siembra)) {
    return 'La fecha de siembra no es una fecha válida.'
  }
  return null
}

/** Productos aplicados: una línea sin material no se guarda, no falla. */
export function limpiarProductos(
  productos: { material_id: string; cantidad: string; unidad: string }[]
): { material_id: string; cantidad: number | null; unidad: string | null }[] {
  return productos
    .filter((p) => p.material_id)
    .map((p) => ({
      material_id: p.material_id,
      cantidad: p.cantidad.trim() ? Number(p.cantidad) : null,
      unidad: p.unidad.trim() || null,
    }))
    .filter((p) => p.cantidad === null || Number.isFinite(p.cantidad))
}
