/**
 * Lectura de la hoja de PLANIFICACIÓN de desinfección. Puro: entra texto
 * de celdas, sale una línea con forma conocida o un error en castellano.
 *
 * **Sólo la planificación, a propósito.** La ejecución y la logística se
 * capturan en vivo, con el turno abierto y el reloj corriendo: importar
 * un Excel ahí sería meter por la puerta de atrás unos datos que la
 * pantalla construye paso a paso, con su candado por fase y sus
 * autocálculos. El plan, en cambio, se arma de una sentada en una hoja
 * —un lote por renglón, cien renglones— y eso es justo lo que un
 * importador resuelve.
 *
 * Reparto de responsabilidades, como en los otros importadores: leer el
 * archivo es de `hojas` —incluida la traducción de los seriales de fecha
 * mirando `xl/styles.xml`—, entender las celdas es de aquí, y enseñar lo
 * entendido es de `ImportarHoja`.
 */

import { aNumero, normalizar, resolver, type ColumnaHoja } from '@/lib/importacion'
import { CICLOS, MONEDAS_PLAN, type MonedaPlan } from './tipos'

/**
 * Las columnas de la hoja, en el orden en que se llenan.
 *
 * Los alias no son un capricho: la misma columna llega escrita de tres
 * maneras según quién arme el archivo, y rebotar la hoja entera por un
 * encabezado con tilde es cambiarle el trabajo al usuario por el de
 * adivinar qué palabra esperábamos.
 */
export const COLUMNAS_PLAN: ColumnaHoja[] = [
  { clave: 'lote', alias: ['Lote', 'Nomenclatura', 'Ubicacion Tecnica', 'Ubicación Técnica', 'UT'] },
  { clave: 'ciclo', alias: ['Ciclo'] },
  // Desde la 104 la siembra sale del TURNO publicado por AGL. Si el turno
  // no viene (o AGL no tiene su fecha), se puede escribir la siembra a mano.
  { clave: 'turno', alias: ['Turno', 'Turno de riego', 'Turno AGL'] },
  { clave: 'fecha_siembra', alias: ['Fecha Siembra', 'Fecha de siembra', 'Siembra'] },
  { clave: 'dias_aplicacion', alias: ['Dias Aplicacion', 'Días Aplicación', 'Dias a la aplicacion', 'Días'] },
  // OPCIONAL desde la 75: una hoja que no la traiga se importa igual, y
  // el preriego se queda sin planificar —que es distinto de planificarlo
  // para el mismo día—.
  {
    clave: 'dias_preriego',
    alias: ['Dias Pre-Riego', 'Días Pre-Riego', 'Dias Preriego', 'Días Preriego', 'Pre-Riego'],
  },
  { clave: 'producto', alias: ['Producto', 'Quimico', 'Químico', 'Material'] },
  { clave: 'dosis_mz', alias: ['Dosis Mz', 'Dosis/mz', 'Dosis por manzana', 'Dosis'] },
  { clave: 'area_mz', alias: ['Area Planificada', 'Área Planificada', 'Area Mz', 'Manzanas', 'Area'] },
  { clave: 'costo_litro', alias: ['Costo Litro', 'Costo/L', 'Costo por litro'] },
  { clave: 'moneda', alias: ['Moneda', 'Divisa'] },
  // Opcional: AGL no publica la variedad por lote.
  { clave: 'variedad', alias: ['Variedad'] },
  { clave: 'comentarios', alias: ['Comentarios', 'Observaciones', 'Nota'] },
]


/**
 * La moneda escrita como venga: «usd», «Dólares», «L», «lempiras».
 *
 * Vacío es HNL, que es la moneda de la casa: obligar a escribirla en
 * cada renglón sería pedir que se repita lo que casi siempre es igual.
 */
export function aMoneda(bruto: string): MonedaPlan | null {
  const t = normalizar(bruto ?? '')
  if (!t) return 'HNL'
  if (t === 'hnl' || t === 'l' || t.startsWith('lempira')) return 'HNL'
  if (t === 'usd' || t === 'us' || t === 'dolar' || t.startsWith('dolar')) return 'USD'
  return null
}

/**
 * Una fila de la hoja, ya entendida y con los textos sin resolver.
 *
 * **La siembra sale del turno** publicado por AGL (migración 104): basta
 * escribir el turno. La fecha a mano es la salida para un turno que AGL
 * todavía no publicó; si vienen las dos, manda la de AGL.
 */
export type LineaPlan = {
  lote: string
  ciclo: number
  /** Código del turno (AGL). Vacío = sin turno. */
  turno: string
  /** AAAA-MM-DD escrita a mano, o vacío. */
  fechaSiembra: string
  /** Nombre de la variedad, o vacío. */
  variedad: string
  diasAplicacion: number
  /**
   * Días del preriego CONTRA la aplicación (migración 75).
   *
   * `null` quiere decir que la hoja no lo traía o lo traía vacío: el
   * preriego se queda sin planificar. Un cero es un dato distinto —se
   * preriega el mismo día que se aplica—.
   */
  diasPreriego: number | null
  producto: string
  dosisMz: number
  areaMz: number
  /** Vacío quiere decir «el que diga el historial de precios». */
  costoLitro: number | null
  moneda: MonedaPlan
  comentarios: string
}

/**
 * Interpreta una fila.
 *
 * Devuelve el error de la PRIMERA cosa que está mal, en el orden en que
 * se llena la hoja: así quien la corrige va de izquierda a derecha en vez
 * de dar saltos. Y dice qué falta, no «revisa la fila»: con diez columnas
 * ese aviso obliga a buscarlo a ojo.
 */
export function interpretarFilaPlan(
  celdas: Record<string, string>
): { ok: true; valor: LineaPlan } | { ok: false; error: string } {
  const texto = (k: string) => (celdas[k] ?? '').trim()

  if (!texto('lote')) return { ok: false, error: 'Falta el lote.' }

  const ciclo = aNumero(texto('ciclo')) ?? 1
  if (!CICLOS.includes(ciclo as 1 | 2 | 3)) {
    return { ok: false, error: 'El ciclo tiene que ser 1, 2 o 3.' }
  }

  // **Los días a la aplicación SÍ pueden ser negativos.** Se cuentan
  // contra la fecha de siembra, y la desinfección se hace ANTES de
  // sembrar: un preriego setenta días antes del trasplante es −70, y es
  // el caso normal, no el raro. Rebotarlo obligaba a planificar con el
  // signo cambiado y luego acordarse de invertirlo al leer el DDT.
  const dias = aNumero(texto('dias_aplicacion'))
  if (dias === null) return { ok: false, error: 'Faltan los días a la aplicación.' }

  // Los días de preriego son OPCIONALES y también admiten negativos: se
  // cuentan contra la aplicación y el suelo se prepara ANTES. Vacío no
  // es cero, es «todavía no se planificó».
  const preriegoTexto = texto('dias_preriego')
  const preriego = preriegoTexto === '' ? null : aNumero(preriegoTexto)
  if (preriegoTexto !== '' && preriego === null) {
    return {
      ok: false,
      error: 'Los días de pre-riego no se entienden. Déjalos vacíos si todavía no se planifica.',
    }
  }

  const dosis = aNumero(texto('dosis_mz'))
  if (dosis === null) return { ok: false, error: 'Falta la dosis por manzana.' }
  if (dosis < 0) return { ok: false, error: 'La dosis por manzana no puede ser negativa.' }

  const area = aNumero(texto('area_mz'))
  if (area === null) return { ok: false, error: 'Falta el área planificada.' }
  if (area <= 0) return { ok: false, error: 'El área planificada tiene que ser mayor que cero.' }

  // El costo es OPCIONAL y vacío no es cero: vacío quiere decir «lo toma
  // del historial de precios», que es lo que hace el disparador al
  // guardar. Un cero escrito a mano sí es un cero.
  const costoTexto = texto('costo_litro')
  const costo = costoTexto === '' ? null : aNumero(costoTexto)
  if (costoTexto !== '' && costo === null) {
    return { ok: false, error: 'El costo por litro no se entiende. Déjalo vacío para tomarlo del catálogo.' }
  }
  if (costo !== null && costo < 0) {
    return { ok: false, error: 'El costo por litro no puede ser negativo.' }
  }

  const moneda = aMoneda(texto('moneda'))
  if (moneda === null) {
    return { ok: false, error: `La moneda «${texto('moneda')}» no se entiende. Escribe HNL o USD.` }
  }

  const fechaSiembra = texto('fecha_siembra')
  if (fechaSiembra && !/^\d{4}-\d{2}-\d{2}$/.test(fechaSiembra)) {
    return { ok: false, error: 'La fecha de siembra va como AAAA-MM-DD, o vacía si la trae el turno de AGL.' }
  }
  if (!texto('turno') && !fechaSiembra) {
    return { ok: false, error: 'Falta el turno (la siembra sale de AGL) o la fecha de siembra.' }
  }

  return {
    ok: true,
    valor: {
      // El lote llega a veces como «1001-040 · Guanacaste»: se queda con
      // el código, que es con lo que `resolver` cruza el catálogo.
      lote: texto('lote').split(/\s*[·|—–]\s*/)[0].trim(),
      ciclo: ciclo as 1 | 2 | 3,
      // El turno puede venir como «T1002-T36 — siembra …» desde la lista.
      turno: texto('turno').split(/\s+[·|—–]\s*/)[0].trim(),
      fechaSiembra,
      variedad: texto('variedad'),
      diasAplicacion: Math.trunc(dias),
      diasPreriego: preriego === null ? null : Math.trunc(preriego),
      producto: texto('producto'),
      dosisMz: dosis,
      areaMz: area,
      costoLitro: costo,
      moneda,
      comentarios: texto('comentarios'),
    },
  }
}

/**
 * Qué hace que dos renglones sean la MISMA línea de plan.
 *
 * Es la llave natural de la tabla —lote, ciclo, producto y **dosis**
 * desde la 67—, repetida aquí a propósito: si la hoja trae dos veces lo
 * mismo, el importador tiene que decir «actualiza» y no crear un
 * duplicado que la base rechazaría a mitad del lote.
 *
 * El producto entra porque una aplicación lleva varios: el mismo lote
 * con el desinfectante y con el ácido son dos líneas. **Y la dosis entra
 * desde la 67** porque un lote no es homogéneo: media parte pide 300
 * L/mz y la otra 350, y con la llave vieja eso era imposible de
 * planificar sin inventarse un producto distinto.
 *
 * La dosis se normaliza a cuatro decimales —los de la columna— para que
 * «300» y «300.0» sean la misma línea y no dos.
 */
export function llaveDePlan(
  loteId: string,
  ciclo: number,
  productoId: string | null,
  dosisMz: number
): string {
  return [loteId, ciclo, productoId ?? '', Number(dosisMz).toFixed(4)].join('|')
}

/**
 * La fecha de aplicación que va a quedar: siembra congelada + días.
 *
 * La calcula la base como columna generada; esto es su reflejo, para que
 * la vista previa enseñe el día antes de guardar. Quien importa cien
 * líneas quiere ver en qué fechas caen ANTES de escribirlas.
 */
export function fechaAplicacionDe(fechaSiembra: string, dias: number): string {
  const base = Date.parse(`${fechaSiembra}T12:00:00Z`)
  if (Number.isNaN(base)) return ''
  return new Date(base + dias * 86400000).toISOString().slice(0, 10)
}

export { resolver, normalizar, MONEDAS_PLAN }
export type { MonedaPlan }
