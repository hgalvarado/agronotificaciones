/**
 * AgroMétricas › Parámetros de riego: definición de los campos del formulario y revisión de rangos (sin React).
 * Diseño: docs/agrometricas-parametros-riego.md · Base: sql/109 (agm_parametros, agm_clima, agm_rangos).
 *
 * En AppSheet se escribían decimales sin punto (pH 797, ETo 5048). Aquí, si un valor queda fuera del rango que publicó
 * AGL, se SUGIERE el mismo número con el punto corrido (797 → 7.97) cuando ese sí cae en el rango. Solo se avisa: la
 * lectura puede ser real y la persona decide.
 */

export type Seccion = 'tensiometros' | 'riego' | 'agua' | 'suelo' | 'clima'

export interface CampoParametro {
  clave: string          // columna en agm_parametros / agm_clima
  etiqueta: string
  seccion: Seccion
  unidad?: string
  decimales: number
}

/** Orden del formulario: lo diario primero (tensiómetros, 93 % de los registros de AppSheet). */
export const CAMPOS: CampoParametro[] = [
  { clave: 'tensiometro_12_am', etiqueta: 'Tensiómetro 12 cm · AM', seccion: 'tensiometros', unidad: 'cb', decimales: 1 },
  { clave: 'tensiometro_24_am', etiqueta: 'Tensiómetro 24 cm · AM', seccion: 'tensiometros', unidad: 'cb', decimales: 1 },
  { clave: 'tensiometro_12_pm', etiqueta: 'Tensiómetro 12 cm · PM', seccion: 'tensiometros', unidad: 'cb', decimales: 1 },
  { clave: 'tensiometro_24_pm', etiqueta: 'Tensiómetro 24 cm · PM', seccion: 'tensiometros', unidad: 'cb', decimales: 1 },
  { clave: 'horas_riego', etiqueta: 'Horas de riego', seccion: 'riego', unidad: 'h', decimales: 2 },
  { clave: 'ce_agua', etiqueta: 'CE agua', seccion: 'agua', unidad: 'dS/m', decimales: 2 },
  { clave: 'ph_agua', etiqueta: 'pH agua', seccion: 'agua', decimales: 2 },
  { clave: 'ce_gotero', etiqueta: 'CE gotero', seccion: 'agua', unidad: 'dS/m', decimales: 2 },
  { clave: 'ph_gotero', etiqueta: 'pH gotero', seccion: 'agua', decimales: 2 },
  { clave: 'ce_extractor', etiqueta: 'CE extractor', seccion: 'agua', unidad: 'dS/m', decimales: 2 },
  { clave: 'ph_extractor', etiqueta: 'pH extractor', seccion: 'agua', decimales: 2 },
  { clave: 'cloro_cinta', etiqueta: 'Cloro en cinta', seccion: 'agua', unidad: 'ppm', decimales: 2 },
  { clave: 'ce_suelo_antes', etiqueta: 'CE suelo antes del riego', seccion: 'suelo', unidad: 'dS/m', decimales: 2 },
  { clave: 'ce_suelo_despues', etiqueta: 'CE suelo después del riego', seccion: 'suelo', unidad: 'dS/m', decimales: 2 },
  { clave: 'eto', etiqueta: 'ETo', seccion: 'clima', unidad: 'mm', decimales: 2 },
  { clave: 'dpv', etiqueta: 'DPV', seccion: 'clima', unidad: 'kPa', decimales: 2 },
  { clave: 'viento', etiqueta: 'Velocidad del viento', seccion: 'clima', unidad: 'km/h', decimales: 1 },
]

export const SECCIONES: { clave: Seccion; titulo: string; abierta: boolean }[] = [
  { clave: 'tensiometros', titulo: 'Tensiómetros', abierta: true },
  { clave: 'riego', titulo: 'Riego', abierta: false },
  { clave: 'agua', titulo: 'Agua y solución', abierta: false },
  { clave: 'suelo', titulo: 'Suelo y calicata', abierta: false },
  { clave: 'clima', titulo: 'Clima del día (una vez por zona)', abierta: false },
]

export interface Rango { parametro: string; minimo: number | null; maximo: number | null }

/** Número tecleado en el teléfono: acepta coma o punto decimal. null si está vacío o no es número. */
export function leerNumero(texto: string | null | undefined): number | null {
  const t = String(texto ?? '').trim().replace(',', '.')
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

const dentro = (v: number, r: Rango) => (r.minimo == null || v >= r.minimo) && (r.maximo == null || v <= r.maximo)

export interface Revision { fuera: boolean; sugerencia: number | null; mensaje: string | null }

/**
 * ¿El valor está dentro del rango? Si no, propone el mismo número con el punto decimal corrido 1 a 3 lugares
 * (797 → 79.7 → 7.97) y se queda con el primero que cae en el rango. Sin rango publicado: nunca avisa.
 */
export function revisar(valor: number | null, rango: Rango | undefined, campo?: CampoParametro): Revision {
  if (valor == null || !rango || (rango.minimo == null && rango.maximo == null) || dentro(valor, rango)) {
    return { fuera: false, sugerencia: null, mensaje: null }
  }
  let sugerencia: number | null = null
  for (let corrimiento = 1; corrimiento <= 3 && sugerencia == null; corrimiento++) {
    const candidato = Number((valor / 10 ** corrimiento).toFixed((campo?.decimales ?? 2) + corrimiento))
    if (dentro(candidato, rango)) sugerencia = candidato
  }
  const limites = [rango.minimo != null ? `mín. ${rango.minimo}` : '', rango.maximo != null ? `máx. ${rango.maximo}` : '']
    .filter(Boolean).join(' · ')
  const nombre = campo?.etiqueta ?? rango.parametro
  const mensaje = sugerencia != null
    ? `${nombre} ${valor} está fuera de rango (${limites}). ¿Quisiste decir ${sugerencia}?`
    : `${nombre} ${valor} está fuera de rango (${limites}). Revisa la lectura.`
  return { fuera: true, sugerencia, mensaje }
}

/** DDT de una jornada: días desde la siembra (negativo antes de sembrar). null sin fecha de siembra. Fechas AAAA-MM-DD. */
export function ddt(fecha: string, fechaSiembra: string | null | undefined): number | null {
  if (!fechaSiembra || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{4}-\d{2}-\d{2}/.test(fechaSiembra)) return null
  const dia = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((dia(fecha) - dia(fechaSiembra.slice(0, 10))) / 86_400_000)
}
