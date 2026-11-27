/**
 * Auditoría de Motores (sql/147, solo con «Auditar»): lo que devuelven fn_mot_motores_resumen y fn_mot_ficha_completa, y el filtrado
 * puro de la lista. Ni React ni red.
 */

import type { NivelSemaforo } from './estado'

export type AyudaServidor = {
  nivel: NivelSemaforo
  mantenimiento?: { nivel: NivelSemaforo; texto: string; horas_estimadas?: number | null } | null
  registro?: { nivel: NivelSemaforo; texto: string } | null
  tanque?: { nivel: NivelSemaforo; texto: string } | null
  ahora?: { nivel: NivelSemaforo; codigo: string; texto: string }[] | null
}

export type ResumenMotorAuditor = {
  equipo_id: string
  codigo: string
  nombre: string
  modelo: string | null
  estado: 'SIN_ASIGNAR' | 'EN_ESTACION' | 'TALLER' | 'RETIRADO'
  estacion_id: string | null
  estacion: string | null
  zona: string | null
  tanque_id: string | null
  tanque: string | null
  /** sql/149: para el medidor de combustible y la barra de mantenimiento (opcionales con datos viejos). */
  capacidad_gal?: number | null
  saldo_gal?: number | null
  intervalo_horas?: number | null
  aviso_horas?: number | null
  horas_desde_mant?: number | null
  horas_est_desde_mant?: number | null
  /** sql/157: lo de los últimos 14 días (pronóstico de días de diésel y de mantenimiento). */
  reciente?: { dias: number; desde: string; horas: number; gal: number } | null
  horo_ultimo: number | null
  fecha_ultimo: string | null
  tramos: number
  ayuda: AyudaServidor | null
}

export type TramoFicha = {
  id: string
  ubicacion: 'ESTACION' | 'TALLER' | 'RETIRADO'
  estacion_id: string | null
  estacion: string | null
  zona: string | null
  tanque_id: string | null
  tanque: string | null
  desde: string
  hasta: string | null
  horo_entrada: number | null
  horo_salida: number | null
  horas_horometro: number | null
  registros: number
  horas: number
  horas_estimadas: number
  gal_gastados: number
  gal_suministrados: number
  rendimiento_prom: number | null
  dias_sin_registro: number | null
}

export type MovimientoFicha = {
  id: string
  tipo: string
  fecha_hora: string
  estacion_origen: string | null
  estacion_destino: string | null
  tanque_id: string | null
  motivo: string | null
  horometro: number | null
  diesel_gal: number | null
  saldo_gal: number | null
  observacion: string | null
  anulado_at: string | null
  registrado_por: string | null
}

export type RegistroFicha = {
  id: string
  fecha: string
  estacion_id: string | null
  tanque_id: string | null
  horo_ini: number
  horo_fin: number
  horas: number
  visor_ini: number
  visor_fin: number
  gastado_gal: number
  recibido_gal: number
  rendimiento_gal_h: number | null
  rpm: number | null
  caudal_ini: number | null
  caudal_fin: number | null
  operador: string | null
  dif_visor_gal: number | null
  comentario: string | null
  horas_estimadas: number | null
  rend_ref_gal_h: number | null
  horo_cambiado: boolean
  visor_cambiado: boolean
  registrado_por: string | null
  fecha_hora: string
  anulado_at: string | null
  motivo_anulacion: string | null
  observaciones: string[] | null
}

export type FichaMotor = {
  servidor_en: string
  motor: {
    equipo_id: string
    codigo: string
    nombre: string
    modelo: string | null
    estado: string
    estacion: string | null
    horo_ultimo: number | null
    visor_ultimo: number | null
    fecha_ultimo: string | null
    horas_desde_mant: number
    horas_estimadas_mant: number
    intervalo_horas: number | null
    /** sql/149 */
    aviso_horas?: number | null
    tanque?: string | null
    capacidad_gal?: number | null
    saldo_gal?: number | null
    zona?: string | null
  }
  ayuda: AyudaServidor | null
  tramos: TramoFicha[]
  movimientos: MovimientoFicha[]
  registros: RegistroFicha[]
  recepciones: { id: string; tanque_id: string | null; galones: number; fecha_hora: string; chofer: string | null; vehiculo: string | null; registrado_por: string | null; anulado_at: string | null }[]
  senales: { registro_id: string; fecha: string; nivel: 'rojo' | 'amarillo' | 'info'; codigo: string; texto: string }[]
}

/** Filtros de la lista de motores del auditor. Una lista vacía = no recorta. */
export type FiltroAuditor = { texto: string; estados: string[]; estaciones: string[]; niveles: string[]; zonas?: string[] }

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ORDEN: Record<string, number> = { rojo: 0, amarillo: 1, gris: 2, verde: 3 }

/** Aplica los filtros y ordena de lo más urgente a lo menos (y por código). */
export function filtrarResumen(lista: ResumenMotorAuditor[], f: FiltroAuditor): ResumenMotorAuditor[] {
  const q = sinTildes(f.texto.trim())
  return lista
    .filter((m) => {
      if (f.estados.length > 0 && !f.estados.includes(m.estado)) return false
      if (f.estaciones.length > 0 && !(m.estacion && f.estaciones.includes(m.estacion))) return false
      if (f.zonas && f.zonas.length > 0 && !(m.zona && f.zonas.includes(m.zona))) return false
      if (f.niveles.length > 0 && !f.niveles.includes(m.ayuda?.nivel ?? 'gris')) return false
      if (q && !sinTildes([m.codigo, m.nombre, m.modelo, m.estacion, m.zona, m.tanque].filter(Boolean).join(' ')).includes(q)) return false
      return true
    })
    .sort((a, b) => (ORDEN[a.ayuda?.nivel ?? 'gris'] ?? 2) - (ORDEN[b.ayuda?.nivel ?? 'gris'] ?? 2) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
}

/** sql/149: una temporada (para pedir las anteriores). */
export type TemporadaInfo = { id: string; nombre: string; fecha_inicio: string; fecha_fin: string; activa: boolean }

/** sql/149: las cifras de la temporada de un motor, una estación, un tramo o el total. */
export type CifrasTemporada = {
  dias: number
  horas: number
  horas_estimadas: number
  gal_gastados: number
  gal_recibidos: number
  rendimiento_gal_h: number | null
  rpm_prom: number | null
  mantenimientos?: number
}

export type TramoResumen = CifrasTemporada & { id: string; estacion_id: string | null; estacion: string | null; zona: string | null; desde: string; hasta: string | null }

/** Lo que devuelve fn_mot_resumen_temporada. */
export type ResumenTemporadaServidor = {
  temporada: { id: string | null; nombre: string | null; desde: string; hasta: string; activa: boolean }
  total: CifrasTemporada
  motores: (CifrasTemporada & { equipo_id: string; codigo: string; nombre: string; tramos: TramoResumen[] })[]
  estaciones: (CifrasTemporada & { estacion_id: string; estacion: string; zona: string | null })[]
}
