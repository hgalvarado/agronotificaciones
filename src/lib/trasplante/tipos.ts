/**
 * Contratos del módulo de trasplante.
 *
 * El trasplante no comparte tablas con la maquinaria: no tiene horómetro
 * ni equipo. Comparte lotes, zonas y temporadas, y nada más. Estos tipos
 * son la frontera entre la base y las pantallas del módulo.
 */

export const CICLOS_SIEMBRA = [1, 2, 3] as const
export type CicloSiembra = (typeof CICLOS_SIEMBRA)[number]

export type Variedad = {
  id: string
  nombre: string
  codigo_sap: string | null
  producto: string | null
}

export type Material = {
  id: string
  codigo: string
  descripcion: string | null
  grupo: string | null
}

export type LoteOpcion = {
  lote_temporada_id: string
  temporada_id: string
  nomenclatura: string
  nombre: string | null
  zona: string | null
  area_neta: number
}

/** Una fila del plan: este lote, este ciclo, esta variedad. */
export type FilaPlanSiembra = {
  id: string
  lote_temporada_id: string
  ut: string
  lote_nombre: string | null
  zona: string | null
  ciclo: number
  variedad_id: string
  variedad: string
  fecha_siembra: string | null
  area_plan: number
  distancia_siembra: string | null
}

/** Una siembra capturada en campo. */
export type FilaSiembra = {
  id: string
  fecha_siembra: string
  semana: string
  ciclo: number
  ut: string
  lote_nombre: string | null
  zona: string | null
  encargado: string | null
  lote_temporada_id: string
  variedad: string
  variedad_id: string
  cultivo: string | null
  lote_variedad: string | null
  avance_mz: number
  plantas_reportadas: number | null
  plantas_mz: number | null
  observaciones: string | null
  usuario_nombre: string | null
  /** Calculados en la vista: acumulado del lote y ciclo contra su plan. */
  acumulado_lote: number | null
  plan_lote: number | null
}

export type FilaAvanceUt = {
  lote_temporada_id: string
  ut: string
  lote_nombre: string | null
  zona: string | null
  encargado: string | null
  ciclo: number
  variedad: string
  area_plan: number
  area_real: number
  pct: number | null
  plantas: number
  primera_fecha: string | null
  ultima_fecha: string | null
}

export type FilaEstadistica = {
  ciclo: number
  area_plan: number
  area_real: number
  pendiente: number
  pct: number | null
  plantas: number
  plantas_mz: number | null
  lotes: number
}

export type FilaVariedad = {
  ciclo: number
  variedad: string
  cultivo: string | null
  /** Lo que tocaba sembrar hasta la fecha de corte del reporte. */
  area_plan: number
  area_real: number
  pct: number | null
  plantas: number
  /** Manzanas del plan sin fecha prevista: no entran en `area_plan`. */
  plan_sin_fecha?: number
}

export type FilaZona = {
  zona: string
  encargado: string | null
  ciclo: number
  area_plan: number
  area_real: number
  pct: number | null
}

export type FilaSemana = {
  semana: string
  desde: string
  hasta: string
  ciclo: number
  area_plan: number
  area_real: number
  plantas: number
  acumulado: number
}

/** Una línea de recepción de plántulas. */
export type FilaRecepcion = {
  id: string
  fecha: string
  variedad_id: string
  variedad: string
  cultivo: string | null
  plantulas_enviadas: number | null
  plantulas_facturadas: number
  costo_unitario: number
  total: number
  numero_factura: string | null
  lote_semilla: string | null
  bandejas_enviadas: number | null
  documento_sap: string | null
  observaciones: string | null
}

/** Una variedad en el panel de liquidación. */
export type FilaLiquidacion = {
  variedad: string
  cultivo: string | null
  facturadas: number
  enviadas: number
  consumidas: number
  pendientes: number
  pct: number | null
  costo_total: number
}

/** Un producto aplicado en una siembra. */
export type ProductoAplicado = {
  material_id: string
  cantidad: string
  unidad: string
}
