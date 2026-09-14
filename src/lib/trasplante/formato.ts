/**
 * Formato del trasplante. Presentación pura, con los mismos decimales en
 * todas las pantallas del módulo.
 */

import { instanteDeFecha, ZONA } from '@/lib/fechas'

const NUM = new Intl.NumberFormat('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ENTERO = new Intl.NumberFormat('es-HN', { maximumFractionDigits: 0 })

export function n2(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : NUM.format(Number(v))
}

export function n0(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : ENTERO.format(Number(v))
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`
}

export function fechaLarga(iso: string): string {
  return instanteDeFecha(iso).toLocaleDateString('es-HN', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function fechaCorta(iso: string): string {
  return instanteDeFecha(iso).toLocaleDateString('es-HN', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'short',
  })
}

/** Azul de los encabezados de Excel que ya usa gerencia. */
export const AZUL = '#1f3864'

export const ETIQUETA_CICLO = (c: number) => (c === 0 ? 'Total general' : `Ciclo ${c}`)
