/**
 * El reparto de las horas máquina entre los lotes de un horómetro.
 *
 * Matemática pura: entran las líneas de lote de un horómetro y sus
 * manzanas, sale cuántas horas le tocan a cada una. No conoce Supabase,
 * ni React, ni de dónde vinieron los datos.
 *
 * El problema que resuelve: el horómetro dice que la máquina anduvo 9
 * horas, pero se usaron en tres lotes. Si cada lote se queda con las 9
 * horas del registro, SAP liquida 27 horas de un tractor que trabajó 9.
 *
 * LA UNIDAD ES EL LOTE, no la labor. El reparto es GLOBAL por horómetro:
 * todos los lotes de todas las labores compiten en el mismo reparto. La
 * versión anterior partía primero las horas entre las labores y sólo
 * después entre los lotes de cada una; con eso, el mismo lote salía con
 * cifras distintas según cuántas labores lo acompañaran esa jornada.
 *
 * ── Las DOS reglas, y no hay una tercera ─────────────────────────────
 *
 *   A · área    Si TODOS los lotes del horómetro traen manzanas:
 *                   horas = horas del horómetro × mz del lote / Σ mz
 *
 *   B · partes  Si alguno NO las trae:
 *                   horas = horas del horómetro / cantidad de lotes
 *
 * La condición de A es «todos», no «alguno»: con un lote sin medir, el
 * que sí midió se llevaría todas las horas y el otro quedaría en cero.
 *
 * ── Dos invariantes ──────────────────────────────────────────────────
 *
 *   Σ horas de las líneas = horas del horómetro
 *   ninguna línea queda en 0
 *
 * ── Y las correcciones a mano ────────────────────────────────────────
 *
 * Una línea marcada `manual` no se recalcula: se descuenta del total y
 * el resto se reparte entre las demás.
 */

import type {
  AsignacionLinea,
  LineaHorometro,
  ReglaProrrateo,
  ResultadoProrrateo,
} from './tipos'

/**
 * Margen al comparar la suma con el total del horómetro.
 *
 * Las horas se guardan con dos decimales, así que repartir 8 h entre tres
 * líneas deja 2.67 + 2.67 + 2.66. Exigir igualdad exacta marcaría como
 * incorrecto un reparto que el propio sistema acaba de hacer bien.
 */
const TOLERANCIA = 0.011

/** Lo mínimo que puede tocarle a un lote: «ninguno puede quedar en 0». */
export const MINIMO = 0.01

const dos = (n: number) => Math.round(n * 100) / 100

/** Las manzanas de la línea, o 0 si no se midieron. */
export function pesoDeLinea(linea: LineaHorometro): number {
  const mz = Number(linea.mz ?? 0)
  return Number.isFinite(mz) && mz > 0 ? mz : 0
}

/**
 * Qué regla toca.
 *
 * `area` sólo cuando TODAS las líneas traen manzanas. Con una sola sin
 * medir se reparte en partes iguales, porque no hay forma honesta de
 * pesar lo que no se midió.
 */
export function reglaDe(lineas: LineaHorometro[]): ReglaProrrateo {
  return lineas.length > 0 && lineas.every((l) => pesoDeLinea(l) > 0) ? 'area' : 'partes'
}

/** ¿Es una línea corregida a mano, con cifra que respetar? */
function esFija(l: LineaHorometro): boolean {
  return Boolean(l.manual) && l.horasActuales !== null && Number.isFinite(l.horasActuales)
}

/**
 * ¿Lo que ya está guardado cuadra con el horómetro?
 *
 * Cuadra sólo si TODAS las líneas traen horas y la suma da el total. Una
 * línea en blanco o en cero significa que el reparto está a medias, y
 * entonces no hay nada que respetar.
 */
export function sumaCuadra(lineas: LineaHorometro[], horasTotales: number): boolean {
  if (lineas.length === 0) return false
  if (lineas.some((l) => l.horasActuales === null || !Number.isFinite(l.horasActuales))) {
    return false
  }
  // Un lote en cero no es un reparto que cuadre: es uno que se comió una
  // línea. Se rehace aunque la suma dé el total.
  if (lineas.some((l) => Number(l.horasActuales) < MINIMO)) return false
  const suma = lineas.reduce((s, l) => s + Number(l.horasActuales), 0)
  return Math.abs(suma - horasTotales) <= TOLERANCIA
}

/**
 * Reparte `horasTotales` entre las líneas.
 *
 * Tres pasos, en este orden:
 *
 *   1. Las corregidas a mano se apartan con su cifra intacta.
 *   2. Lo que queda se reparte entre las demás con la regla que toque.
 *   3. Se sube al mínimo lo que el redondeo dejó en cero y los céntimos
 *      sueltos se cargan a la línea más grande, para que la suma dé
 *      exactamente lo que marcó el horómetro.
 */
export function repartirPorPeso(
  lineas: LineaHorometro[],
  horasTotales: number
): AsignacionLinea[] {
  const fijas = lineas.filter(esFija)
  const libres = lineas.filter((l) => !esFija(l))

  const deMano: AsignacionLinea[] = fijas.map((l) => ({
    detalleId: l.detalleId,
    peso: pesoDeLinea(l),
    horas: dos(Number(l.horasActuales)),
    manual: true,
  }))

  if (libres.length === 0) return deMano

  const reservado = deMano.reduce((a, x) => a + x.horas, 0)
  const disponible = dos(Math.max(0, horasTotales - reservado))

  // La regla se decide con TODAS las líneas del horómetro, corregidas
  // incluidas: es una propiedad de la jornada —«se midió el área o no»—
  // y no de qué líneas quedaron libres.
  const regla = reglaDe(lineas)
  const pesos = libres.map((l) => (regla === 'area' ? pesoDeLinea(l) : 1))
  const sumaPesos = pesos.reduce((a, p) => a + p, 0)

  const repartidas: AsignacionLinea[] = libres.map((linea, i) => ({
    detalleId: linea.detalleId,
    peso: pesos[i],
    horas: sumaPesos > 0 ? dos((pesos[i] / sumaPesos) * disponible) : 0,
  }))

  // Ningún lote en cero. Si lo disponible no alcanza ni para el mínimo de
  // cada uno —las correcciones a mano se comieron el horómetro— se reparte
  // lo que hay: inventar horas sería descuadrar el total.
  const piso = Math.min(MINIMO, dos(disponible / libres.length))
  for (const a of repartidas) {
    if (a.horas < piso) a.horas = piso
  }

  // Los céntimos del redondeo van a la línea de mayor peso, y a igualdad
  // a la primera, para que el resultado sea siempre el mismo. Nunca se
  // le quitan a una línea si eso la dejaría por debajo del piso.
  const resto = dos(disponible - repartidas.reduce((a, x) => a + x.horas, 0))
  if (resto !== 0) {
    const orden = [...repartidas].sort((a, b) => b.peso - a.peso || b.horas - a.horas)
    const destino = orden.find((a) => dos(a.horas + resto) >= piso)
    if (destino) destino.horas = dos(destino.horas + resto)
  }

  // En el orden en que entraron, que es el que la pantalla enseña.
  const porId = new Map([...deMano, ...repartidas].map((a) => [a.detalleId, a]))
  return lineas.map((l) => porId.get(l.detalleId)!).filter(Boolean)
}

/**
 * La decisión completa: dejar como está o repartir.
 *
 * Devuelve además POR QUÉ y con qué regla, para que la pantalla pueda
 * decirlo en una línea en vez de cambiar los números del usuario en
 * silencio.
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

  const regla = reglaDe(lineas)
  const fijas = lineas.filter(esFija)
  const reservado = fijas.reduce((a, l) => a + Number(l.horasActuales), 0)
  const nadieTiene = lineas.every((l) => l.horasActuales === null)

  let motivo: ResultadoProrrateo['motivo'] = nadieTiene ? 'sin_horas' : 'suma_incorrecta'
  if (fijas.length < lineas.length && horasTotales - reservado < MINIMO) {
    motivo = 'manual_copa_el_total'
  }

  return {
    respetado: false,
    motivo,
    regla,
    asignaciones: repartirPorPeso(lineas, horasTotales),
  }
}
