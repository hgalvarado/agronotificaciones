/**
 * Validación del historial de contadores. Funciones puras: entra lo que
 * se escribió, sale `null` o un error en castellano.
 *
 * Repite las reglas que la base ya impone. No es duplicación ociosa: el
 * mensaje de Postgres llega cuando el formulario ya se envió, y decir
 * «elige el equipo» antes de ir a la red es la diferencia entre corregir
 * y adivinar. La base sigue siendo la que manda.
 */

import { deEntradaLocal } from '@/lib/fechas'
import type { EntradaCambio, EntradaPeriodo } from './tipos'

export function validarCambio(e: EntradaCambio): string | null {
  if (!e.equipoId) return 'Elige el equipo al que se le cambió el tablero.'
  if (!e.contadorNuevo.trim()) return 'Escribe el número del contador nuevo.'
  if (!e.desde) return 'Elige desde cuándo aplica el contador nuevo.'
  if (!deEntradaLocal(e.desde)) return 'La fecha y hora del cambio no es válida.'
  if (
    e.contadorViejo.trim() &&
    e.contadorViejo.trim().toLowerCase() === e.contadorNuevo.trim().toLowerCase()
  ) {
    return 'El contador nuevo y el anterior no pueden ser el mismo.'
  }
  return null
}

export function validarPeriodo(e: EntradaPeriodo): string | null {
  if (!e.contador.trim()) return 'Escribe el número del contador.'
  if (!e.desde) return 'Elige desde cuándo aplica.'

  const desde = deEntradaLocal(e.desde)
  if (!desde) return 'La fecha y hora de inicio no es válida.'

  // «Hasta» vacío es válido y significa algo concreto: es el contador
  // que está puesto hoy.
  if (e.hasta) {
    const hasta = deEntradaLocal(e.hasta)
    if (!hasta) return 'La fecha y hora de término no es válida.'
    if (hasta <= desde) return 'El término tiene que ser posterior al inicio.'
  }
  return null
}
