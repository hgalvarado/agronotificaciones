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
  const d = instanteDeFecha(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-HN', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function fechaCorta(iso: string): string {
  const d = instanteDeFecha(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-HN', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'short',
  })
}

/**
 * Paleta corporativa de Agrolíbano (80). Los reportes que se imprimen la
 * usan en estilos en línea —el PDF del navegador no siempre respeta las
 * clases—, por eso vive aquí además de en `globals.css`.
 */
export const CORP = {
  /** Verde Agrícola: primario, cabeceras, títulos. */
  verde: '#165C27',
  /** Verde Vibrante: secundario, gráficos, avance sano. */
  lima: '#8CC63F',
  /** Naranja Atardecer: advertencias, atrasos, desfases. */
  naranja: '#F37021',
  /** Azul Marino Corporativo: texto y fondos de alto contraste. */
  marino: '#1A2530',
  /** Azul Turquesa (82): agua, clima, datos secundarios. */
  turquesa: '#00A99D',
  /** Amarillo Sol (82): highlights y «en progreso». */
  sol: '#FFD100',
  /** Fondo principal y bordes de la guía. */
  fondo: '#F4F6F8',
  borde: '#E2E8F0',
} as const

/**
 * Semáforo de cumplimiento de la guía corporativa (82):
 * ≥ 100 % excelente (Verde Vibrante), 80–99 % en progreso (Amarillo Sol),
 * < 80 % atraso (Naranja Atardecer).
 */
export function semaforo(pct: number | null | undefined): 'excelente' | 'progreso' | 'atraso' | null {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return null
  const v = Number(pct)
  if (v >= 99.95) return 'excelente'
  if (v >= 80) return 'progreso'
  return 'atraso'
}

export const COLOR_SEMAFORO = {
  excelente: CORP.lima,
  progreso: CORP.sol,
  atraso: CORP.naranja,
} as const

/** Orden de series de la guía para gráficos con varias líneas o barras. */
export const SERIES_GRAFICO = [CORP.lima, CORP.naranja, CORP.turquesa, CORP.verde, CORP.sol] as const

/**
 * El color de cabecera de los reportes. Conserva el nombre por los sitios
 * que ya lo importan; desde la 80 es el Verde Agrícola corporativo.
 */
export const AZUL = CORP.verde

export const ETIQUETA_CICLO = (c: number) => (c === 0 ? 'Total general' : `Ciclo ${c}`)
