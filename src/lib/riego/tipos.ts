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

export type CatalogosRiego = {
  temporadas: { id: string; nombre: string; activa: boolean }[]
  zonas: ZonaOpcion[]
  planes: OpcionCatalogo[]
  variedades: OpcionCatalogo[]
}

export const TURNO_VACIO: EntradaTurno = {
  turnoId: null,
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
