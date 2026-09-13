/**
 * Contratos del prorrateo de horas máquina.
 *
 * Sólo nombres de formas. Viven aparte para que la matemática, la
 * persistencia y la pantalla hablen el mismo idioma sin depender unas de
 * otras.
 *
 * La unidad es la LÍNEA de lote (`registro_detalle`) y no la labor: una
 * labor cubre varios lotes, y repartir por labor es lo que hacía que 9
 * horas de un tractor se liquidaran como 27.
 */

/** Una línea de lote colgando del horómetro. */
export type LineaHorometro = {
  detalleId: string
  /** Manzanas ejecutadas en ese lote. Es el peso del reparto. */
  mz: number | null
  /** Horas que ya tiene asignadas; `null` si todavía ninguna. */
  horasActuales: number | null
}

export type AsignacionLinea = {
  detalleId: string
  horas: number
  /** El peso con el que salió esa cifra. Sirve para explicarla. */
  peso: number
}

/** Por qué el algoritmo hizo lo que hizo. Se muestra al usuario. */
export type MotivoProrrateo =
  | 'ya_cuadra' // la suma ya daba el horómetro: no se toca nada
  | 'sin_horas' // ninguna línea tenía horas
  | 'suma_incorrecta' // la suma no daba el total del horómetro
  | 'sin_horometro' // el horómetro no dio horas: no hay nada que repartir
  | 'sin_lineas'

export type ResultadoProrrateo = {
  /** `true` cuando no hace falta tocar nada. */
  respetado: boolean
  motivo: MotivoProrrateo
  /** Vacío cuando no hay nada que cambiar. */
  asignaciones: AsignacionLinea[]
}
