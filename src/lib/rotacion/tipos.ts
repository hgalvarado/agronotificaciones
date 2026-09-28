/**
 * Contratos del módulo de cultivos de rotación.
 *
 * La rotación es lo que se siembra entre dos ciclos de melón para
 * descansar y limpiar el suelo: maíz, sorgo, frijol abono. No tiene
 * plántula, ni bandeja, ni ciclo; comparte con el trasplante los lotes,
 * las zonas, las temporadas y las variedades, y nada más. Por eso tiene
 * sus propios tipos y no reutiliza los de allá: parecerse no es ser lo
 * mismo, y compartir un tipo obligaría a llenar de opcionales lo que en
 * cada módulo es obligatorio.
 */

/* ================================================================== */
/* Listas cerradas                                                     */
/* ================================================================== */

/**
 * Las unidades de medida. Salen del enum `umb_rotacion` de la base, que
 * es la que de verdad valida: si aquí se agregara una y allá no, la
 * celda fallaría al guardarla.
 */
export const UNIDADES = [
  { valor: 'KG', etiqueta: 'Kg' },
  { valor: 'LB', etiqueta: 'Lb' },
  { valor: 'G', etiqueta: 'g' },
  { valor: 'OZ', etiqueta: 'Oz' },
  { valor: 'TON', etiqueta: 'Ton' },
  { valor: 'L', etiqueta: 'L' },
  { valor: 'ML', etiqueta: 'ml' },
  { valor: 'UNIDAD', etiqueta: 'Unidad' },
] as const

export const TIPOS_SIEMBRA = [
  { valor: 'DIRECTA', etiqueta: 'Directa' },
  { valor: 'DRON_RENTADO', etiqueta: 'Dron rentado' },
  { valor: 'CON_SEMBRADORA', etiqueta: 'Con sembradora' },
  { valor: 'PLANTULA', etiqueta: 'Plántula' },
] as const

const mapa = (lista: readonly { valor: string; etiqueta: string }[]) =>
  new Map(lista.map((x) => [x.valor, x.etiqueta]))

const UMB = mapa(UNIDADES)
const TIPOS = mapa(TIPOS_SIEMBRA)

export const etiquetaUmb = (v: string | null | undefined) => (v ? (UMB.get(v) ?? v) : '—')
export const etiquetaTipoSiembra = (v: string | null | undefined) =>
  v ? (TIPOS.get(v) ?? v) : '—'

/** Para los editores de celda, que piden `{value,label}`. */
export const opciones = (lista: readonly { valor: string; etiqueta: string }[]) =>
  lista.map((x) => ({ value: x.valor, label: x.etiqueta }))

/* ================================================================== */
/* Catálogos                                                           */
/* ================================================================== */

export type Producto = { id: string; nombre: string }

export type VariedadRotacion = {
  id: string
  nombre: string
  producto_id: string | null
  producto: string | null
}

export type LoteRotacion = {
  lote_temporada_id: string
  nomenclatura: string
  nombre: string | null
  zona: string | null
  area_neta: number
}

/* ================================================================== */
/* Filas                                                               */
/* ================================================================== */

/** Una línea del plan: este lote, esta variedad, esta dosis. */
export type FilaPlan = {
  id: string
  temporada_id: string
  lote_temporada_id: string
  ut: string
  lote_nombre: string | null
  zona: string | null
  variedad_id: string
  variedad: string
  producto_id: string | null
  producto: string | null
  area_neta: number | null
  area_planificada_mz: number
  dosis_mz: number | null
  umb: string | null
  /** Área × dosis. La calcula la base; aquí sólo se enseña. */
  dosis_total_area: number | null
  observaciones: string | null
}

/** Una siembra de rotación capturada en campo. */
export type FilaAvance = {
  id: string
  temporada_id: string
  fecha: string
  lote_temporada_id: string
  ut: string
  lote_nombre: string | null
  zona: string | null
  variedad_id: string
  variedad: string
  producto_id: string | null
  producto: string | null
  avance_mz: number
  gasto_semilla: number | null
  umb: string | null
  /** Gasto ÷ avance. La calcula la base. */
  semilla_mz: number | null
  tipo_siembra: string
  costo_tipo_siembra_mz: number | null
  /** Costo/mz × avance. La calcula la base. */
  costo_total: number | null
  observaciones: string | null
  usuario_nombre: string | null
}

/* ================================================================== */
/* Resúmenes                                                           */
/* ================================================================== */

export type Estadisticas = {
  area_plan: number
  area_real: number
  pendiente: number
  pct: number | null
  lotes_plan: number
  lotes_real: number
  gasto_semilla: number
  costo_total: number
}

export type FilaPorVariedad = {
  variedad: string
  producto: string | null
  area_plan: number
  area_real: number
  pct: number | null
  gasto_semilla: number
  semilla_mz: number | null
  costo_total: number
}

export type FilaPorZona = {
  zona: string
  encargado: string | null
  area_plan: number
  area_real: number
  pct: number | null
  lotes: number
  costo_total: number
}

export type FilaPorLote = {
  lote_temporada_id: string
  ut: string
  lote_nombre: string | null
  zona: string | null
  variedad_plan: string | null
  variedad_real: string | null
  area_plan: number
  area_real: number
  pct: number | null
  /** `null` mientras no haya avance: todavía no se sabe. */
  coincide: boolean | null
  costo_total: number
}

export type FilaPorTipoSiembra = {
  tipo_siembra: string
  lineas: number
  area_real: number
  costo_mz: number | null
  costo_total: number
  pct_area: number | null
}

/* ================================================================== */
/* Formato                                                             */
/* ================================================================== */

export const n2 = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === ''
    ? '—'
    : Number(v).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const n0 = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === ''
    ? '—'
    : Number(v).toLocaleString('es-HN', { maximumFractionDigits: 0 })

export const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`
