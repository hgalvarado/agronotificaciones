/**
 * Contratos del tablero de avance.
 *
 * Esta capa no hace nada: sólo nombra las formas que se pasan entre las
 * demás, para que filtros, consultas, agrupación y pantalla dependan de
 * los mismos tipos y no unas de otras.
 */

export type OpcionSimple = { id: string; nombre: string }
export type OpcionTemporada = { id: string; nombre: string; activa: boolean }
export type OpcionLabor = { id: string; nombre: string; categoria_labor_id: string | null }
export type OpcionLote = {
  id: string
  temporada_id: string
  zona_id: string | null
  ciclo: number | null
  etiqueta: string
}

/** Ciclos posibles de un lote. Son tres y no crecen. */
export const CICLOS_TABLERO = [1, 2, 3] as const

/* ------------------------------ Filtros ------------------------------ */

export type Filtros = {
  /** El prioritario: sin temporada no hay nada que pedir. */
  temporada: string
  /** Selección múltiple: vacío quiere decir «todas». */
  zonas: string[]
  lote: string
  /** Selección múltiple: vacío quiere decir «todos». */
  ciclos: number[]
  categoria: string
  labor: string
  desde: string
  hasta: string
}

export const FILTROS_VACIOS: Omit<Filtros, 'temporada'> = {
  zonas: [],
  lote: '',
  ciclos: [],
  categoria: '',
  labor: '',
  desde: '',
  hasta: '',
}

/* ---------------------------- Agrupación ----------------------------- */

/**
 * Por qué se puede agrupar.
 *
 * «Si el usuario selecciona múltiples agrupaciones, el árbol visual debe
 *  renderizarse en el orden estricto: Encargado > Zona > Lote.»
 *
 * Ese orden es el de esta lista y no el orden en que se marcan las
 * casillas: un árbol Lote > Encargado repetiría al mismo encargado
 * debajo de cada lote y no se podría leer. La labor va al final porque
 * es la hoja: es lo que la cuadrícula enseña fila a fila.
 */
export const AGRUPACIONES = [
  { valor: 'encargado', etiqueta: 'Encargado' },
  { valor: 'zona', etiqueta: 'Zona' },
  { valor: 'lote', etiqueta: 'Lote' },
  { valor: 'labor', etiqueta: 'Labor' },
] as const

export type Agrupacion = (typeof AGRUPACIONES)[number]['valor']

/** La que se usa si el usuario no toca nada. */
export const AGRUPACION_POR_OMISION: Agrupacion[] = ['lote']

/* ------------------------------- Datos ------------------------------- */

/** Una fila de `fn_tablero_avance`: una labor contra el plan. */
export type FilaLabor = {
  labor_id: string
  labor_nombre: string
  categoria_id: string | null
  categoria_labor: string | null
  area_plan: number
  mz_avance: number
  mz_pendiente: number
  pct_avance: number | null
  lotes_con_plan: number
  lotes_tocados: number
  lineas: number
  primera_fecha: string | null
  ultima_fecha: string | null
}

/** Una fila de `fn_tablero_por_zona`. */
export type FilaZona = {
  zona_id: string | null
  zona: string | null
  encargado: string | null
  area_plan: number
  mz_avance: number
  mz_pendiente: number
  pct_avance: number | null
  lotes_tocados: number
  ultima_fecha: string | null
}

/**
 * Una fila de `fn_tablero_por_lote`: un lote y una labor.
 *
 * Las tres cifras de dinero contestan tres preguntas distintas:
 * `subtotal` es lo que costó esta labor en este lote, `costo_actividad`
 * lo que costó esa labor en todo lo filtrado, y `gasto_lote` lo que
 * lleva gastado el lote entero.
 */
export type FilaLote = {
  lote_temporada_id: string
  ut: string
  lote_nombre: string | null
  zona_id: string | null
  zona: string | null
  encargado: string | null
  labor_id: string
  labor_nombre: string
  categoria_labor: string | null
  mz_avance: number
  area_plan: number
  subtotal: number
  costo_actividad: number
  gasto_lote: number
}

/** Lo que se enseña en la cabecera de cada rama del árbol. */
export type Totales = {
  mz: number
  plan: number
  gasto: number
  lotes: number
  pct: number | null
}
