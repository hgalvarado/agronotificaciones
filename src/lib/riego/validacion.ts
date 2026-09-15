/**
 * Validación de los turnos de riego. Funciones puras: entra lo que se
 * escribió, sale `null` o un error en castellano.
 *
 * Repite las reglas que la base ya impone —el área contra el plan, el
 * turno sin lotes— y eso es deliberado: el mensaje de Postgres llega
 * cuando el formulario ya se envió, y con doce lotes en pantalla decir
 * CUÁL se pasó antes de ir a la red es la diferencia entre corregir y
 * adivinar. La base sigue siendo la que manda.
 */

import { esFechaIso } from '@/lib/fechas'
import { CICLOS_RIEGO, type EntradaTurno, type LineaTurno, type LoteRegable } from './tipos'

/** Acepta coma decimal: en el teclado del teléfono es lo que sale. */
export function aNumero(bruto: string): number | null {
  const limpio = bruto.trim().replace(',', '.')
  if (limpio === '') return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

export function validarCabecera(e: EntradaTurno): string | null {
  if (!e.temporadaId) return 'Elige la temporada.'
  if (!CICLOS_RIEGO.includes(Number(e.ciclo) as 1 | 2 | 3)) return 'El ciclo debe ser 1, 2 o 3.'
  if (!esFechaIso(e.fechaSiembra)) return 'Escribe la fecha de siembra.'
  if (!e.zonaId) return 'Elige la zona.'
  if (!e.turno.trim()) return 'Escribe el turno.'
  return null
}

/**
 * Las líneas, contra el saldo real de cada lote.
 *
 * `saldos` viene de `fn_lotes_regables`, que ya descuenta lo repartido en
 * OTROS turnos y —al editar— no cuenta el turno que se está tocando. Aquí
 * sólo falta sumar lo que se está escribiendo AHORA: dos renglones del
 * mismo lote en el mismo formulario se suman entre sí, que es el caso que
 * ninguna validación fila a fila atrapa.
 */
export function validarLineas(
  lineas: LineaTurno[],
  saldos: LoteRegable[]
): string | null {
  const conDato = lineas.filter((l) => l.loteTemporadaId || l.areaTurno.trim())
  if (conDato.length === 0) return 'Agrega al menos un lote.'

  const porLote = new Map<string, number>()

  for (const [i, l] of conDato.entries()) {
    const renglon = `Renglón ${i + 1}`
    if (!l.loteTemporadaId) return `${renglon}: elige el lote.`

    const area = aNumero(l.areaTurno)
    if (area === null) return `${renglon}: escribe el área del turno.`
    if (area <= 0) return `${renglon}: el área tiene que ser mayor que cero.`

    if (porLote.has(l.loteTemporadaId)) {
      const saldo = saldos.find((s) => s.lote_temporada_id === l.loteTemporadaId)
      return `El lote ${saldo?.ut ?? ''} está dos veces. Súmalo en un solo renglón.`.replace(
        '  ',
        ' '
      )
    }
    porLote.set(l.loteTemporadaId, area)
  }

  for (const [loteId, area] of porLote) {
    const saldo = saldos.find((s) => s.lote_temporada_id === loteId)
    if (!saldo) continue
    // Medio centavo de manzana de tolerancia: lo mismo que acepta el
    // disparador de la base, para que las dos reglas digan lo mismo.
    if (area > saldo.area_disponible + 0.005) {
      return (
        `El lote ${saldo.ut} sólo tiene ${saldo.area_disponible.toFixed(2)} mz libres ` +
        `(de ${saldo.area_total.toFixed(2)} sembradas o planificadas) y le estás poniendo ` +
        `${area.toFixed(2)}.`
      )
    }
  }

  return null
}

/** Las líneas listas para la base: sin renglones en blanco y con números. */
export function lineasParaGuardar(lineas: LineaTurno[]) {
  return lineas
    .filter((l) => l.loteTemporadaId && aNumero(l.areaTurno) !== null)
    .map((l) => ({
      lote_temporada_id: l.loteTemporadaId,
      area_turno: aNumero(l.areaTurno),
      variedad_id: l.variedadId || null,
    }))
}
