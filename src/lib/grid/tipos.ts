/**
 * Contratos de la cuadrícula estándar.
 *
 * Una sola definición de «columna» y de «filtro» para todo el sistema:
 * trasplante, horómetros, labores y el plan de emplasticado dibujan la
 * misma tabla y se comportan igual. Cuando cada pantalla traía su propia
 * caja de texto por columna, filtrar «10» en Avance también encontraba
 * 110 en una pantalla y no en otra, y nadie sabía qué esperar.
 */

import type { ReactNode } from 'react'

export type Direccion = 'asc' | 'desc'

/**
 * Cómo se filtra una columna. Lo decide lo que la columna ES:
 *
 *   seleccion → catálogo cerrado (lote, variedad, zona, turno…): casillas
 *   fecha     → rango Desde / Hasta
 *   numero    → rango Mínimo / Máximo
 *   texto     → contiene (para descripciones y códigos libres)
 *   ninguno   → columna de adorno o de acciones; no se filtra ni se ordena
 */
export type TipoFiltro = 'seleccion' | 'texto' | 'fecha' | 'numero' | 'ninguno'

export type Filtro =
  /** Lista de casillas. Vacía significa «todos», no «ninguno». */
  | { tipo: 'seleccion'; valores: string[] }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'fecha'; desde: string; hasta: string }
  | { tipo: 'numero'; min: string; max: string }

export type Filtros = Record<string, Filtro>

export type Orden = { campo: string; direccion: Direccion }

/** Etiqueta de las celdas sin dato dentro de la lista de casillas. */
export const VACIO = '(vacío)'

export type ColumnaGrid<T> = {
  /** Identificador de la columna. No tiene que ser un campo de la fila. */
  campo: string
  label: string
  tipo: TipoFiltro
  /**
   * El valor con el que se ordena y se filtra. Devolver un número cuando
   * la columna sea numérica: si no, 9 quedaría después de 10.
   */
  valor: (fila: T) => string | number | null
  /**
   * Lo que se lee en la casilla del filtro y en el Excel. Por omisión, el
   * valor. Hace falta cuando la celda enseña una etiqueta distinta del
   * dato (un proceso, un turno, un booleano).
   */
  etiqueta?: (fila: T) => string
  /** Cómo se dibuja la celda. Si falta, se dibuja la etiqueta. */
  render?: (fila: T) => ReactNode
  /** Alinea a la derecha y usa cifras tabulares. */
  numero?: boolean
  ancho?: string
  /** Se queda fuera del Excel (columnas de adorno). */
  sinExportar?: boolean

  /* --------------------- Edición en línea --------------------- */

  /**
   * La celda se escribe sobre la tabla, estilo hoja de cálculo. Una
   * columna sin esto es de sólo lectura aunque la pantalla permita
   * editar: es lo que protege la fecha, que la manda el ticket.
   */
  editable?: boolean
  /** Qué control se dibuja al editar. Por omisión, texto. */
  editor?: 'texto' | 'numero' | 'fecha' | 'seleccion'
  /** Sólo para el editor 'seleccion'. */
  opciones?: { value: string; label: string }[]
  /**
   * El valor CRUDO que se edita, cuando no es el mismo que se enseña: la
   * celda dice «Arado» y lo que se guarda es el id de la tarea.
   */
  valorEdicion?: (fila: T) => string
}
