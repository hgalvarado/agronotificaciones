/**
 * Contratos del historial de contadores.
 *
 * Un «contador» es el horómetro físico del tablero, el número con el que
 * SAP conoce al equipo. Cuando se avería se cambia el tablero y el nuevo
 * arranca de cero; cada periodo de vida de un contador es un renglón.
 *
 * Sólo formas de datos. Sin React, sin Supabase, sin reglas.
 */

export type FilaContador = {
  id: string
  equipo_id: string
  equipo_codigo: string
  equipo_nombre: string
  contador: string
  contador_anterior: string | null
  motivo: string | null
  /** Instante desde el que aplica. Lo elige quien registra el cambio. */
  vigente_desde: string
  /** Nulo mientras sea el contador puesto hoy. */
  vigente_hasta: string | null
  vigente: boolean
  usuario_id: string | null
  usuario_nombre: string | null
  created_at: string
  /** Cuántas jornadas quedan bajo este periodo. */
  jornadas: number
}

/** Lo que se escribe en el formulario de cambio de tablero. */
export type EntradaCambio = {
  equipoId: string
  contadorNuevo: string
  contadorViejo: string
  /** Valor crudo de un `<input type="datetime-local">`. */
  desde: string
  motivo: string
}

/** Lo que se edita de un periodo ya registrado. */
export type EntradaPeriodo = {
  contador: string
  contadorAnterior: string
  motivo: string
  desde: string
  hasta: string
}

export const CAMBIO_VACIO: EntradaCambio = {
  equipoId: '',
  contadorNuevo: '',
  contadorViejo: '',
  desde: '',
  motivo: '',
}
