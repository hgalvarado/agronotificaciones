/**
 * Las formas del módulo de desinfección de suelo.
 *
 * Son el reflejo de las seis vistas de la migración 59 y de los
 * formularios que escriben sobre sus tablas. Nada de lógica: aquí sólo
 * viven los nombres, para que la cuadrícula, el formulario y el reporte
 * hablen del mismo campo y no de tres parecidos.
 */

import type { Tono } from '@/components/ui/Primitivos'

/* ------------------------------------------------------------------ */
/* Lo que devuelven las vistas                                         */
/* ------------------------------------------------------------------ */

export type FilaPlan = {
  id: string
  temporada_id: string
  temporada_nombre: string | null
  lote_temporada_id: string
  lote_nomenclatura: string
  lote_nombre: string | null
  zona_id: string | null
  zona_nombre: string | null
  ciclo: number
  /** La fecha de siembra COPIADA al planificar. No sigue a la siembra. */
  fecha_siembra_congelada: string
  dias_aplicacion: number
  /** Generada en la base: congelada + días. */
  fecha_aplicacion: string
  variedad_id: string | null
  variedad_nombre: string | null
  producto_id: string | null
  producto_nombre: string | null
  producto_codigo: string | null
  dosis_mz: number
  area_planificada_mz: number
  costo_litro: number
  total_litros: number
  total_costo: number
  costo_mz: number
  comentarios: string | null
  usuario_id: string
  usuario_nombre: string | null
  created_at: string
}

export type EstadoDesinfeccion = '1_Preriego' | '2_Lecturas' | '3_Aplicacion'

export type FilaEjecucion = {
  id: string
  temporada_id: string
  temporada_nombre: string | null
  turno_id: string
  turno_nombre: string | null
  turno_codigo: string | null
  zona_id: string | null
  zona_nombre: string | null
  /** Con el turno, es la llave con la que la pantalla la busca. */
  ciclo: number
  estado: EstadoDesinfeccion

  fecha_preriego: string | null
  hora_inicio_preriego: string | null
  hora_fin_preriego: string | null
  /** Generada: fin − inicio, sin negativos. */
  horas_preriego: number | null
  obs_preriego: string | null

  /** La fase 2 tiene su propio día: se riega un día y se lee otro. */
  fecha_lecturas: string | null
  lecturas_tensiometro: LecturaTensiometro[] | null

  fecha_aplicacion: string | null
  estacion_riego_id: string | null
  estacion_riego_nombre: string | null
  horas_presurizacion: number | null
  hora_inicio_iny: string | null
  hora_fin_iny: string | null
  /** Generada. */
  horas_inyeccion: number | null
  horas_lavado: number | null
  /** Generada: presurización + inyección + lavado. No se escribe. */
  total_horas_riego: number | null
  ppm: number | null
  ce_antes: number | null
  ce_durante: number | null
  ce_despues: number | null
  calibracion_entrada: number | null
  calibracion_salida: number | null
  calibracion_campo: number | null

  /** Resumen de lo que cuelga, que la vista ya trae sumado. */
  mz_regadas: number
  lotes_regados: number
  costo_personal: number
  /**
   * La suma de TODOS los productos de la aplicación.
   *
   * Desde la 60 el químico no es una columna de la cabecera: una
   * aplicación lleva varios productos y con columnas el segundo no cabe.
   */
  costo_quimico: number
  productos: number
  productos_nombres: string | null

  usuario_id: string
  usuario_nombre: string | null
  created_at: string
}

export type FilaLoteRegado = {
  id: string
  ejecucion_id: string
  temporada_id: string
  fecha_aplicacion: string | null
  turno_id: string
  turno_nombre: string | null
  lote_temporada_id: string
  lote_nomenclatura: string
  lote_nombre: string | null
  zona_id: string | null
  zona_nombre: string | null
  mz_cubiertas: number
  usuario_id: string
  created_at: string
}

/**
 * Un químico de una aplicación.
 *
 * `dosis_mz` la DEDUCE la vista dividiendo los litros entre las manzanas
 * del turno. No se captura: capturadas las dos, un día no cuadran y no
 * hay forma de saber cuál es la buena.
 */
export type FilaProducto = {
  id: string
  ejecucion_id: string
  temporada_id: string
  turno_id: string
  turno_nombre: string | null
  zona_id: string | null
  ciclo: number
  fecha_aplicacion: string | null
  producto_id: string
  producto_codigo: string | null
  producto_nombre: string | null
  total_litros: number
  costo_litro: number
  costo_total: number
  mz_regadas: number
  dosis_mz: number | null
  usuario_id: string
  created_at: string
}

export type JornadaTipo = 'Diurna' | 'Nocturna'

export type FilaPersonal = {
  id: string
  ejecucion_id: string
  temporada_id: string
  fecha_aplicacion: string | null
  turno_id: string
  turno_nombre: string | null
  puesto_id: string
  puesto_codigo: string | null
  puesto_nombre: string | null
  operador_id: string | null
  operador_nombre: string | null
  cantidad_personas: number
  jornadas: number
  horas_extras: number
  jornada_tipo: JornadaTipo
  /** La tarifa con la que se calculó, copiada a la fila. */
  tarifa_dia: number | null
  costo_total: number
  usuario_id: string
  created_at: string
}

export type FilaLogistica = {
  id: string
  temporada_id: string
  temporada_nombre: string | null
  zona_id: string
  zona_nombre: string | null
  fecha: string
  equipo_id: string
  equipo_codigo: string | null
  equipo_nombre: string | null
  implemento_id: string | null
  implemento_nombre: string | null
  operador_id: string | null
  operador_nombre: string | null
  horas_trabajo: number
  costo_hora: number | null
  costo_total: number
  comentarios: string | null
  usuario_id: string
  usuario_nombre: string | null
  created_at: string
}

/**
 * El costo por lote, ya prorrateado por la vista analítica.
 *
 * No trae `id`: su llave es el lote. La cuadrícula lo necesita, así que
 * `leerCostos` le pega `id = lote_temporada_id` — es la única fila por
 * lote, así que no hay forma de que choque.
 */
export type FilaCosto = {
  lote_temporada_id: string
  lote_nomenclatura: string
  lote_nombre: string | null
  temporada_id: string
  temporada_nombre: string | null
  zona_id: string | null
  zona_nombre: string | null
  mz_regadas: number
  costo_quimico: number | null
  costo_personal: number | null
  costo_logistica: number | null
  costo_total: number | null
  costo_mz: number | null
}

/* ------------------------------------------------------------------ */
/* Las lecturas de la fase 2                                           */
/* ------------------------------------------------------------------ */

/**
 * Una lectura de tensiómetro.
 *
 * La base la guarda en JSONB libre a propósito (ver la migración 59), así
 * que esta forma es un acuerdo del navegador, no un esquema. Por eso todo
 * llega como texto: lo que se teclea se guarda tal cual, y convertirlo a
 * número aquí sólo serviría para perder un «—» o un «s/d».
 */
export type LecturaTensiometro = {
  /** Dónde está puesto el aparato: «Lote 1001-040, cabezal». */
  punto: string
  /** En centímetros. Texto, porque se teclea. */
  profundidad: string
  /** En centibares. */
  lectura: string
  /** HH:MM, hora de Honduras. */
  hora: string
  nota: string
}

/**
 * Las dos lecturas que se toman siempre.
 *
 * Se precargan porque son las de todos los turnos: dejar la lista vacía
 * obliga a escribir «Tensiómetro 12» a mano cada vez, y lo que se
 * escribe a mano cada vez acaba escrito de cinco maneras distintas y no
 * se puede agrupar después.
 */
export const PUNTOS_POR_OMISION = ['Tensiómetro 12', 'Tensiómetro 24']

export const LECTURA_VACIA: LecturaTensiometro = {
  punto: '',
  profundidad: '',
  lectura: '',
  hora: '',
  nota: '',
}

/* ------------------------------------------------------------------ */
/* Catálogos                                                           */
/* ------------------------------------------------------------------ */

export type OpcionCatalogo = { id: string; nombre: string }

export type LoteDesinfeccion = {
  /** El id de `lotes_temporada`, que es con el que se guarda. */
  lote_temporada_id: string
  nomenclatura: string
  nombre: string | null
  zona_id: string | null
  area_neta: number
}

export type CatalogosDesinfeccion = {
  temporadas: { id: string; nombre: string; activa: boolean }[]
  zonas: OpcionCatalogo[]
  turnos: { id: string; codigo: string; zona_id: string | null }[]
  /** Con su zona desde la 60: nula quiere decir «todavía sin asignar». */
  estaciones: { id: string; nombre: string; zona_id: string | null }[]
  variedades: OpcionCatalogo[]
  /** Insumos. El producto de desinfección sale de aquí, no de cultivos. */
  materiales: { id: string; codigo: string; descripcion: string | null }[]
  puestos: { id: string; codigo: string; descripcion: string | null }[]
  operadores: OpcionCatalogo[]
  equipos: { id: string; codigo: string; nombre: string }[]
  implementos: { id: string; codigo: string; nombre: string }[]
  lotes: LoteDesinfeccion[]
}

export const CATALOGOS_VACIOS: CatalogosDesinfeccion = {
  temporadas: [],
  zonas: [],
  turnos: [],
  estaciones: [],
  variedades: [],
  materiales: [],
  puestos: [],
  operadores: [],
  equipos: [],
  implementos: [],
  lotes: [],
}

/* ------------------------------------------------------------------ */
/* Listas cerradas                                                     */
/* ------------------------------------------------------------------ */

/**
 * Las tres fases, en orden.
 *
 * El valor lleva el número delante porque así está el enum en la base
 * (`1_Preriego`…): ordenar por el valor y ordenar por la fase son la
 * misma cosa, y no hace falta una tabla de orden aparte.
 */
export const FASES: { valor: EstadoDesinfeccion; etiqueta: string; tono: Tono }[] = [
  { valor: '1_Preriego', etiqueta: 'Preriego', tono: 'azul' },
  { valor: '2_Lecturas', etiqueta: 'Lecturas', tono: 'ambar' },
  { valor: '3_Aplicacion', etiqueta: 'Aplicación', tono: 'verde' },
]

export const FASE_FINAL: EstadoDesinfeccion = '3_Aplicacion'

/**
 * Los ciclos de cultivo.
 *
 * Son los mismos tres de riego y trasplante, repetidos aquí a propósito
 * en vez de importados del módulo de riego: desinfección no depende de
 * riego para nada más, y cruzar un módulo entero por una lista de tres
 * números es la clase de atadura que después nadie se atreve a cortar.
 */
export const CICLOS = [1, 2, 3] as const

export function etiquetaFase(e: EstadoDesinfeccion) {
  return FASES.find((f) => f.valor === e) ?? FASES[0]
}

/** Las lecturas con las que arranca un turno nuevo. */
export function lecturasPorOmision(): LecturaTensiometro[] {
  return PUNTOS_POR_OMISION.map((punto) => ({ ...LECTURA_VACIA, punto }))
}

export const JORNADAS: { valor: JornadaTipo; etiqueta: string; factor: number }[] = [
  { valor: 'Diurna', etiqueta: 'Diurna (×1.25)', factor: 1.25 },
  { valor: 'Nocturna', etiqueta: 'Nocturna (×1.75)', factor: 1.75 },
]

/* ------------------------------------------------------------------ */
/* Lo que escriben los formularios                                     */
/* ------------------------------------------------------------------ */

/**
 * Todo en texto, no en números.
 *
 * Un `number` obliga a decidir qué es un campo vacío, y las dos salidas
 * son malas: `0` miente —no es que la dosis sea cero, es que no se ha
 * escrito— y `NaN` rompe el `value` del input. Se convierte una sola vez,
 * al guardar, en `calculo.ts`.
 */
export type EntradaPlan = {
  id: string
  temporadaId: string
  loteTemporadaId: string
  ciclo: string
  fechaSiembraCongelada: string
  diasAplicacion: string
  variedadId: string
  productoId: string
  dosisMz: string
  areaPlanificadaMz: string
  costoLitro: string
  comentarios: string
}

export const PLAN_VACIO: EntradaPlan = {
  id: '',
  temporadaId: '',
  loteTemporadaId: '',
  ciclo: '1',
  fechaSiembraCongelada: '',
  diasAplicacion: '0',
  variedadId: '',
  productoId: '',
  dosisMz: '',
  areaPlanificadaMz: '',
  costoLitro: '',
  comentarios: '',
}

export type EntradaEjecucion = {
  id: string
  temporadaId: string
  /** Turno y ciclo son el ACTIVADOR: con ellos se busca o se empieza. */
  turnoId: string
  ciclo: string
  estado: EstadoDesinfeccion

  fechaPreriego: string
  horaInicioPreriego: string
  horaFinPreriego: string
  obsPreriego: string

  fechaLecturas: string

  fechaAplicacion: string
  estacionRiegoId: string
  horasPresurizacion: string
  horaInicioIny: string
  horaFinIny: string
  horasLavado: string
  ppm: string
  ceAntes: string
  ceDurante: string
  ceDespues: string
  calibracionEntrada: string
  calibracionSalida: string
  calibracionCampo: string

}

export const EJECUCION_VACIA: EntradaEjecucion = {
  id: '',
  temporadaId: '',
  turnoId: '',
  ciclo: '1',
  estado: '1_Preriego',
  fechaPreriego: '',
  horaInicioPreriego: '',
  horaFinPreriego: '',
  obsPreriego: '',
  fechaLecturas: '',
  fechaAplicacion: '',
  estacionRiegoId: '',
  horasPresurizacion: '',
  horaInicioIny: '',
  horaFinIny: '',
  horasLavado: '',
  ppm: '',
  ceAntes: '',
  ceDurante: '',
  ceDespues: '',
  calibracionEntrada: '',
  calibracionSalida: '',
  calibracionCampo: '',
}

/** Un lote regado por el turno. `id` vacío quiere decir «todavía no existe». */
export type LineaLote = {
  id: string
  loteTemporadaId: string
  mzCubiertas: string
}

export const LINEA_LOTE_VACIA: LineaLote = { id: '', loteTemporadaId: '', mzCubiertas: '' }

export type LineaPersonal = {
  id: string
  puestoId: string
  operadorId: string
  cantidadPersonas: string
  jornadas: string
  horasExtras: string
  jornadaTipo: JornadaTipo
}

export const LINEA_PERSONAL_VACIA: LineaPersonal = {
  id: '',
  puestoId: '',
  operadorId: '',
  cantidadPersonas: '1',
  jornadas: '1',
  horasExtras: '0',
  jornadaTipo: 'Diurna',
}

/** Un químico en el formulario. `id` vacío = todavía no existe. */
export type LineaProducto = {
  id: string
  productoId: string
  /** El TOTAL aplicado. La dosis por manzana se deduce de las manzanas. */
  totalLitros: string
  costoLitro: string
}

export const LINEA_PRODUCTO_VACIA: LineaProducto = {
  id: '',
  productoId: '',
  totalLitros: '',
  costoLitro: '',
}

export type EntradaLogistica = {
  id: string
  temporadaId: string
  zonaId: string
  fecha: string
  equipoId: string
  implementoId: string
  operadorId: string
  horasTrabajo: string
  /** Vacío = la toma de `tarifas_equipo`, que es lo normal. */
  costoHora: string
  comentarios: string
}

export const LOGISTICA_VACIA: EntradaLogistica = {
  id: '',
  temporadaId: '',
  zonaId: '',
  fecha: '',
  equipoId: '',
  implementoId: '',
  operadorId: '',
  horasTrabajo: '',
  costoHora: '',
  comentarios: '',
}
