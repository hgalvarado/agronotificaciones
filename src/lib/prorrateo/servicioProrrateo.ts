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
  sin_horas: 'Las horas del horómetro se repartieron entre los lotes del día.',
  suma_incorrecta:
    'Las horas de los lotes no sumaban las del horómetro, así que se repartieron de nuevo.',
  manual_copa_el_total:
    'Las horas que corregiste a mano ya cubren todo el horómetro: a los demás lotes les quedó el mínimo. Sube las horas del horómetro o baja las que pusiste a mano.',
}

/** Cómo se explica la regla con la que se repartió. */
export const REGLAS: Record<'area' | 'partes', string> = {
  area: 'por manzanas de cada lote',
  partes: 'en partes iguales, porque algún lote no trae manzanas',
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

  const base = MENSAJES[resultado.motivo]
  const mensaje =
    base && resultado.regla && resultado.motivo !== 'manual_copa_el_total'
      ? `${base.replace(/\.$/, '')} ${REGLAS[resultado.regla]}.`
      : base

  return { ajustado: true, mensaje, error: null }
}
