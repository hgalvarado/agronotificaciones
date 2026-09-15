/**
 * Contratos del módulo de turnos de riego.
 *
 * Un turno es una jornada de riego planificada: UNA fecha de siembra, UN
 * plan nutricional y UNA zona, con los lotes que se riegan en ella. La
 * cabecera y el detalle viajan juntos porque se guardan juntos.
 *
 * Sólo formas de datos. Sin React, sin Supabase, sin reglas.
 */

export const FUENTES_AGUA = [
  { valor: 'RIO', etiqueta: 'Río' },
  { valor: 'POZO', etiqueta: 'Pozo' },
  { valor: 'RIO_Y_POZO', etiqueta: 'Río y pozo' },
] as const

export type FuenteAgua = (typeof FUENTES_AGUA)[number]['valor']

export const ESTADOS_TURNO = [
  { valor: 'PENDIENTE_CREAR', etiqueta: 'Pendiente crear', tono: 'ambar' },
  { valor: 'CREANDO', etiqueta: 'Creando', tono: 'azul' },
  { valor: 'ORDEN_CREADA', etiqueta: 'Orden creada', tono: 'verde' },
] as const

export type EstadoTurno = (typeof ESTADOS_TURNO)[number]['valor']

export const CICLOS_RIEGO = [1, 2, 3] as const

/** Una fila de la cuadrícula: un LOTE de un turno, con su cabecera repetida. */
export type FilaTurnoRiego = {
  detalle_id: string
  turno_id: string
  temporada_id: string
  temporada_nombre: string
  ciclo: number
  fecha_siembra: string
  zona_id: string
  zona: string
  turno: string
  plan_nutricional_id: string | null
  plan_nutricional: string | null
  responsable: string | null
  estacion_riego: string | null
  fuente_agua: FuenteAgua | null
  orden_sap: string | null
  estado: EstadoTurno
  turno_comentarios: string | null
  lote_temporada_id: string
  ut: string
  nomenclatura: string | null
  area_turno: number
  variedad_id: string | null
  variedad: string | null
  detalle_comentarios: string | null
  /** Llegan con la migración 41: las llaves de los catálogos nuevos. */
  turno_catalogo_id?: string | null
  estacion_riego_id?: string | null
  /** Días desde la siembra. Lo calcula la base contra el día de Honduras. */
  ddt_actual: number | null
  area_disponible_total: number | null
  usuario_id: string | null
  usuario_nombre: string | null
  created_at: string
}

/** Lo que el formulario escribe en la cabecera. Todo texto: viene de campos. */
export type EntradaTurno = {
  turnoId: string | null
  /** El turno del catálogo. El texto `turno` sale de él. */
  turnoCatalogoId: string
  estacionRiegoId: string
  temporadaId: string
  ciclo: string
  fechaSiembra: string
  zonaId: string
  turno: string
  planNutricionalId: string
  responsable: string
  estacionRiego: string
  fuenteAgua: string
  ordenSap: string
  estado: EstadoTurno
  comentarios: string
}

/** Un lote dentro del turno, tal como se escribe. */
export type LineaTurno = {
  loteTemporadaId: string
  areaTurno: string
  variedadId: string
}

export type LoteRegable = {
  lote_temporada_id: string
  ut: string
  lote_nombre: string | null
  zona: string | null
  area_total: number
  area_asignada: number
  area_disponible: number
}

export type OpcionCatalogo = { id: string; nombre: string }

export type ZonaOpcion = OpcionCatalogo & { responsable: string | null }

/**
 * Un turno del catálogo. Lleva su zona habitual: elegirlo la propone,
 * pero el turno de riego puede guardarse en otra si ese día se movió.
 */
export type TurnoOpcion = { id: string; codigo: string; zona_id: string | null }

export type CatalogosRiego = {
  temporadas: { id: string; nombre: string; activa: boolean }[]
  zonas: ZonaOpcion[]
  planes: OpcionCatalogo[]
  variedades: OpcionCatalogo[]
  turnos: TurnoOpcion[]
  estaciones: OpcionCatalogo[]
}

export const TURNO_VACIO: EntradaTurno = {
  turnoId: null,
  turnoCatalogoId: '',
  estacionRiegoId: '',
  temporadaId: '',
  ciclo: '1',
  fechaSiembra: '',
  zonaId: '',
  turno: '',
  planNutricionalId: '',
  responsable: '',
  estacionRiego: '',
  fuenteAgua: '',
  ordenSap: '',
  estado: 'PENDIENTE_CREAR',
  comentarios: '',
}

export const LINEA_VACIA: LineaTurno = { loteTemporadaId: '', areaTurno: '', variedadId: '' }

/**
 * Qué campo de la base toca cada columna de la cuadrícula.
 *
 * La columna se llama como lo que se LEE —«Zona», «Turno», «Variedad»,
 * que en la vista son texto— pero lo que se GUARDA es el id del
 * catálogo. Sin esta traducción `fn_editar_turno_riego` recibía «zona» y
 * respondía «campo no editable»: la celda se dejaba escribir y el cambio
 * se perdía en silencio.
 *
 * Las columnas que no aparecen aquí ya se llaman igual en los dos lados
 * (`area_turno`, `ciclo`, `fecha_siembra`, `responsable`, `fuente_agua`,
 * `orden_sap`, `estado`).
 */
export const CAMPO_GUARDADO: Record<string, string> = {
  ut: 'lote_temporada_id',
  zona: 'zona_id',
  turno: 'turno_id',
  variedad: 'variedad_id',
  plan_nutricional: 'plan_nutricional_id',
  estacion_riego: 'estacion_riego_id',
}

/** El nombre con el que la base conoce esa columna. */
export function campoGuardado(columna: string): string {
  return CAMPO_GUARDADO[columna] ?? columna
}
