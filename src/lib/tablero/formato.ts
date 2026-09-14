/**
 * Presentación: cómo se escribe un número en pantalla. Nada más.
 *
 * Vive aparte para que el mismo importe se vea igual en la cuadrícula,
 * en las tarjetas y en el resumen de costos, y para que cambiar de
 * moneda o de decimales sea un archivo y no una búsqueda.
 */

import { instanteDeFecha, ZONA } from '@/lib/fechas'

const NUM = new Intl.NumberFormat('es-HN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const DINERO = new Intl.NumberFormat('es-HN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Manzanas, horas: dos decimales y separador de miles. */
export function numero(v: number | null | undefined): string {
  return NUM.format(Number(v ?? 0))
}

/** Lempiras. El símbolo va delante y separado, como en el resto de la app. */
export function dinero(v: number | null | undefined): string {
  return `L ${DINERO.format(Number(v ?? 0))}`
}

/** Un porcentaje entero, o una raya cuando no hay plan contra el que medir. */
export function porcentaje(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Number(v).toFixed(0)}%`
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—'
  return instanteDeFecha(iso).toLocaleDateString('es-HN', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'short',
  })
}

/** Color de la barra de avance. Verde terminado, ámbar rezagado. */
export function colorAvance(pct: number): string {
  if (pct >= 99) return 'bg-emerald-500'
  if (pct >= 50) return 'bg-brand-600'
  return 'bg-amber-500'
}
