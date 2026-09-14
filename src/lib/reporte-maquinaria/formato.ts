/**
 * Formato. Presentación pura: números y fechas tal como se leen en
 * Honduras. Ninguna regla de negocio vive aquí, y ninguna pantalla
 * formatea por su cuenta, para que las dos tablas y el encabezado usen
 * exactamente los mismos decimales.
 */

import { instanteDeFecha, ZONA } from '@/lib/fechas'

const NUMERO = new Intl.NumberFormat('es-HN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function n2(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—'
  return NUMERO.format(Number(valor))
}

/**
 * Igual que `n2` pero sin separador de miles.
 *
 * Un horómetro es un contador, no una cantidad de dinero: «11109.00» se
 * lee igual de bien que «11,109.00» y ahorra el ancho justo que hace
 * falta para que cuatro columnas quepan en el pie apaisado.
 */
const SIN_GRUPO = new Intl.NumberFormat('es-HN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
})

export function n2Compacto(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—'
  return SIN_GRUPO.format(Number(valor))
}

export function fechaLarga(iso: string): string {
  return instanteDeFecha(iso).toLocaleDateString('es-HN', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function turnoLegible(turno: string): string {
  return turno === 'NOCTURNO' ? 'Nocturno' : 'Diurno'
}

/** «OP-01 · Juan Pérez», y sólo lo que exista. */
export function operadorLegible(codigo: string | null, nombre: string | null): string {
  return [codigo, nombre].filter(Boolean).join(' · ') || '—'
}

/** Azul de los encabezados de Excel que ya usa gerencia. */
export const AZUL = '#1f3864'
