/**
 * HorometerDistributionService — el reparto de las horas máquina.
 *
 * Matemática pura: entran las líneas de lote de un horómetro y sus
 * manzanas, sale cuántas horas le tocan a cada una. No conoce Supabase,
 * ni React, ni de dónde vinieron los datos.
 *
 * El problema que resuelve: el horómetro dice que la máquina anduvo 9
 * horas, pero se usaron en tres lotes. Si cada lote se queda con las 9
 * horas del registro, SAP liquida 27 horas de un tractor que trabajó 9.
 *
 * LA UNIDAD ES EL LOTE, no la labor. Ese era el error: las horas vivían
 * en la labor, y una labor cubre varios lotes, así que cada pantalla que
 * la abría por lote volvía a contarlas.
 *
 * La regla, intocable:
 *
 *     Σ horas de las líneas de un horómetro = horas del horómetro
 *
 * y el reparto:
 *
 *   1. Peso de la línea = manzanas ejecutadas.
 *   2. Si NINGUNA línea del horómetro tiene manzanas, peso 1 para todas.
 *   3. Horas = horas del horómetro × (peso / peso total).
 */

import type { AsignacionLinea, LineaHorometro, ResultadoProrrateo } from './tipos'

/**
 * Margen al comparar la suma con el total del horómetro.
 *
 * Las horas se guardan con dos decimales, así que repartir 8 h entre tres
 * líneas deja 2.67 + 2.67 + 2.66. Exigir igualdad exacta marcaría como
 * incorrecto un reparto que el propio sistema acaba de hacer bien.
 */
const TOLERANCIA = 0.011

const dos = (n: number) => Math.round(n * 100) / 100

/** «Si el usuario ingresó avance en manzanas, W = mz.» */
export function pesoDeLinea(linea: LineaHorometro): number {
  const mz = Number(linea.mz ?? 0)
  return Number.isFinite(mz) && mz > 0 ? mz : 0
}

/**
 * ¿Lo que ya está guardado cuadra con el horómetro?
 *
 * Cuadra sólo si TODAS las líneas traen horas y la suma da el total. Una
 * línea en blanco significa que el reparto está a medias, y entonces no
 * hay nada que respetar.
 */
export function sumaCuadra(lineas: LineaHorometro[], horasTotales: number): boolean {
  if (lineas.length === 0) return false
  if (lineas.some((l) => l.horasActuales === null || !Number.isFinite(l.horasActuales))) {
    return false
  }
  const suma = lineas.reduce((s, l) => s + Number(l.horasActuales), 0)
  return Math.abs(suma - horasTotales) <= TOLERANCIA
}

/**
 * Reparte `horasTotales` entre las líneas.
 *
 * El redondeo a dos decimales deja siempre unos céntimos de hora sueltos;
 * se le cargan a la línea de mayor peso. Sin ese ajuste la suma de lo
 * repartido no daría exactamente lo que marcó el horómetro, que es justo
 * el error que este servicio existe para evitar.
 */
export function repartirPorPeso(
  lineas: LineaHorometro[],
  horasTotales: number
): AsignacionLinea[] {
  const pesos = lineas.map(pesoDeLinea)
  const hayArea = pesos.some((p) => p > 0)

  // «Si ninguna labor tiene manzanas (todas en 0), asignar un peso
  // igualitario.» Inventar un peso sería peor que repartir parejo.
  const efectivos = hayArea ? pesos : lineas.map(() => 1)
  const sumaEfectiva = efectivos.reduce((a, p) => a + p, 0)

  const asignaciones: AsignacionLinea[] = lineas.map((linea, i) => ({
    detalleId: linea.detalleId,
    peso: efectivos[i],
    horas: dos((efectivos[i] / sumaEfectiva) * horasTotales),
  }))

  const repartido = asignaciones.reduce((a, x) => a + x.horas, 0)
  const resto = dos(horasTotales - repartido)
  if (resto !== 0) {
    let mayor = 0
    for (let i = 1; i < efectivos.length; i++) {
      if (efectivos[i] > efectivos[mayor]) mayor = i
    }
    asignaciones[mayor].horas = dos(asignaciones[mayor].horas + resto)
  }

  return asignaciones
}

/**
 * La decisión completa: dejar como está o repartir.
 *
 * Devuelve además POR QUÉ, para que la pantalla pueda decirlo en una
 * línea en vez de cambiar los números del usuario en silencio.
 */
export function distribuirHoras(
  lineas: LineaHorometro[],
  horasTotales: number
): ResultadoProrrateo {
  if (lineas.length === 0) {
    return { respetado: true, motivo: 'sin_lineas', asignaciones: [] }
  }
  if (!Number.isFinite(horasTotales) || horasTotales <= 0) {
    return { respetado: true, motivo: 'sin_horometro', asignaciones: [] }
  }
  if (sumaCuadra(lineas, horasTotales)) {
    return { respetado: true, motivo: 'ya_cuadra', asignaciones: [] }
  }

  const nadieTiene = lineas.every((l) => l.horasActuales === null)

  return {
    respetado: false,
    motivo: nadieTiene ? 'sin_horas' : 'suma_incorrecta',
    asignaciones: repartirPorPeso(lineas, horasTotales),
  }
}
