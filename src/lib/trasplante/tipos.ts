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

/**
 * Un producto aplicado en una siembra, tal como lo devuelve la vista.
 *
 * Viaja DENTRO de la siembra y no en una consulta aparte: pedir la lista
 * de cada fila serían doscientas consultas para pintar una tabla.
 */
export type ProductoDeSiembra = {
  id: string
  material_id: string
  codigo: string
  descripcion: string | null
  cantidad: number | string | null
  unidad: string | null
}

/** Cómo se lee un producto en una línea: «UREA 2.5 kg». */
export function textoProducto(p: ProductoDeSiembra): string {
  const cantidad = p.cantidad === null || p.cantidad === undefined ? '' : String(p.cantidad)
  return [p.codigo, cantidad, p.unidad ?? ''].filter(Boolean).join(' ')
}

/** Toda la lista en una línea, que es lo que se exporta a Excel. */
export function textoProductos(productos: ProductoDeSiembra[] | null | undefined): string {
  return (productos ?? []).map(textoProducto).join('; ')
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
  /** Llega con la migración 46. Sin ella la columna sale vacía. */
  productos?: ProductoDeSiembra[] | null
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
  /**
   * Este lote ya no recibe más siembra en este ciclo.
   *
   * Llega con la migración 46. Es por lote Y CICLO: el mismo lote se
   * siembra en ciclo 1 y más tarde en ciclo 2, y darlo por cerrado
   * entero escondería el segundo.
   */
  terminado?: boolean | null
}

/** Lo que acota el cuadre por UT en la pantalla. */
export type FiltrosAvance = {
  lotes: string[]
  ciclos: string[]
}

export const SIN_FILTROS_AVANCE: FiltrosAvance = { lotes: [], ciclos: [] }

/**
 * El cuadre por UT agrupado como se lee: ciclo 1 entero, luego ciclo 2.
 *
 * La base ya lo devuelve ordenado por ciclo; aquí sólo se parte en
 * grupos, que es acomodo de pantalla y no merece otra consulta.
 */
export type CicloConLotes = {
  ciclo: number
  lotes: { lote_temporada_id: string; ut: string; nombre: string | null; zona: string | null; terminado: boolean; filas: FilaAvanceUt[] }[]
}

export function porCiclo(filas: FilaAvanceUt[]): CicloConLotes[] {
  const ciclos = new Map<number, Map<string, FilaAvanceUt[]>>()
  for (const f of filas) {
    const c = Number(f.ciclo)
    const lotes = ciclos.get(c) ?? new Map<string, FilaAvanceUt[]>()
    lotes.set(f.lote_temporada_id, [...(lotes.get(f.lote_temporada_id) ?? []), f])
    ciclos.set(c, lotes)
  }

  return [...ciclos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ciclo, lotes]) => ({
      ciclo,
      lotes: [...lotes.values()]
        .map((deEsteLote) => ({
          lote_temporada_id: deEsteLote[0].lote_temporada_id,
          ut: deEsteLote[0].ut,
          nombre: deEsteLote[0].lote_nombre,
          zona: deEsteLote[0].zona,
          // Es del lote y el ciclo, así que todas sus filas dicen lo
          // mismo; se toma la primera en vez de exigir que coincidan.
          terminado: Boolean(deEsteLote[0].terminado),
          filas: deEsteLote,
        }))
        .sort((a, b) => a.ut.localeCompare(b.ut, 'es', { numeric: true })),
    }))
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
