'use client'

/**
 * Orquestación del prorrateo: leer, decidir, aplicar, contarlo.
 *
 * Es la costura entre las tres capas y no hace ninguna de las tres: la
 * matemática está en `servicioDistribucionHoras`, el acceso a datos en
 * `repositorioProrrateo` y el texto en `MENSAJES`. Se llama después de
 * guardar una labor, cuando ya se sabe qué lotes cuelgan del horómetro.
 */

import { aplicarProrrateo, leerHorometroParaProrrateo } from './repositorioProrrateo'
import { distribuirHoras } from './servicioDistribucionHoras'
import type { MotivoProrrateo } from './tipos'

export const MENSAJES: Record<MotivoProrrateo, string | null> = {
  ya_cuadra: null,
  sin_lineas: null,
  sin_horometro: null,
  sin_horas: 'Las horas del horómetro se repartieron entre los lotes según sus manzanas.',
  suma_incorrecta:
    'Las horas de los lotes no sumaban las del horómetro, así que se repartieron según sus manzanas.',
}

export type ResultadoAjuste = {
  ajustado: boolean
  mensaje: string | null
  error: string | null
}

/**
 * Deja el horómetro cuadrado: la suma de las horas de sus lotes es
 * exactamente lo que marcó.
 */
export async function ajustarHorasDelHorometro(horometroId: string): Promise<ResultadoAjuste> {
  const { datos, error } = await leerHorometroParaProrrateo(horometroId)
  if (error) return { ajustado: false, mensaje: null, error }
  if (!datos) return { ajustado: false, mensaje: null, error: null }

  const resultado = distribuirHoras(datos.lineas, datos.horasTotales)
  if (resultado.respetado) {
    return { ajustado: false, mensaje: MENSAJES[resultado.motivo], error: null }
  }

  const { error: errorAplicar } = await aplicarProrrateo(horometroId)
  if (errorAplicar) return { ajustado: false, mensaje: null, error: errorAplicar }

  return { ajustado: true, mensaje: MENSAJES[resultado.motivo], error: null }
}
