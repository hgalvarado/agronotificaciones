/**
 * Reglas de la cuadrícula de siembra que son del NEGOCIO, no de la tabla.
 *
 * Ordenar, filtrar y buscar viven en `lib/grid` y sirven a todas las
 * pantallas. Aquí sólo queda lo que significa algo únicamente en el
 * trasplante.
 */

import type { FilaSiembra } from './tipos'

/**
 * El porcentaje de cumplimiento del lote y ciclo a esa fecha.
 *
 * Es una columna calculada y no un dato: acumulado contra plan. Se calcula
 * aquí y no en la tabla para que ordenar, filtrar y enseñar usen
 * exactamente el mismo número.
 */
export function cumplimiento(f: FilaSiembra): number | null {
  const plan = Number(f.plan_lote ?? 0)
  if (plan <= 0) return null
  return Math.round((Number(f.acumulado_lote ?? 0) / plan) * 1000) / 10
}
