/**
 * Tipos que comparten la pantalla del plan, su reporte y el importador.
 *
 * Viven aquí y no en una página porque ahora hay tres rutas que los usan
 * (`/plan/[proceso]`, su reporte, y el importador), y tenerlos en una
 * página obligaría a que unas se importen a otras.
 */

export type Proceso = {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  momento: string | null
}

export type Temporada = {
  id: string
  nombre: string
  activa: boolean
  fecha_inicio?: string
  fecha_fin?: string
}

/** Labor que ha trabajado dentro del proceso, con lo que lleva hecho. */
export type LaborDelProceso = {
  labor_id: string
  labor_nombre: string
  mz_total: number
  lotes: number
  ultima_fecha: string | null
  /** `true` en la labor marcada como seguimiento de emplasticado: es la
   *  que el plan mide. Opcional porque antes de la migración 21 la
   *  función no devuelve la columna. */
  seguimiento?: boolean | null
}

/** Fila del editor del plan: un lote de la temporada con su plan al lado. */
export type FilaPlan = {
  id: string
  plan_id: string | null
  ut: string
  nombre: string | null
  zona: string | null
  encargado: string | null
  area_bruta: number | null
  area_neta: number
  etapa: number | null
  area_plan: number | null
  con_moto: boolean | null
}

/** Fila del «Resumen por lote»: plan contra ejecutado. */
export type AvanceRow = {
  lote_temporada_id: string
  ut: string
  nomenclatura: string | null
  zona: string | null
  encargado: string | null
  elemento_pep: string
  area_bruta: number | null
  area_neta: number | null
  etapa_plan: number | null
  area_plan: number | null
  con_moto_plan: boolean | null
  mz_avance: number
  mz_pendiente: number
  pct_avance: number | null
  uso_moto: boolean | null
  fecha_inicio: string | null
  fecha_ultima: string | null
  proveedor_plastico: string | null
  proveedor_manguera: string | null
}

export type ZonaRow = {
  zona: string | null
  encargado: string | null
  etapa: number | null
  area_plan: number
  mz_avance: number
  pct_avance: number | null
}

export type LineaDiaria = {
  detalle_id: string
  fecha: string
  ut: string
  nomenclatura: string | null
  zona: string | null
  encargado: string | null
  etapa: number | null
  avance_mz: number
  labor_nombre: string
  tarea_codigo: string | null
  proceso_codigo: string | null
  equipo_codigo: string
  operador_nombre: string | null
  proveedor_plastico: string | null
  proveedor_manguera: string | null
  ticket_codigo: string
  usuario_nombre: string | null
}

export type FilaProveedor = {
  proveedor_plastico: string
  proveedor_manguera: string
  mz: number
  lotes: number
  lineas: number
  primera_fecha: string | null
  ultima_fecha: string | null
}

export type FilaProveedorLote = {
  ut: string
  nomenclatura: string | null
  zona: string | null
  proveedor_plastico: string
  proveedor_manguera: string
  mz: number
  fecha: string | null
}
