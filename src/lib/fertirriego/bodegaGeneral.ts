/**
 * Bodega general de la estación (sql/139): UNA lista con todo lo que hay en la estación (fertilizantes, productos de
 * inyección/drench/calidad, envases y el diésel). Puro: ni React, ni IndexedDB, ni red.
 *
 * Los saldos de productos y envases se calculan en el teléfono (servidor + lo pendiente de enviar); de la base solo
 * vienen la clasificación, la última recepción y de dónde vino. Desde la sql/144 el diésel es un producto más de la bodega
 * (tipo DIESEL, mismo libro que los demás); el diésel dentro de los tanques de los motores se ve en la ficha del motor.
 */

import type { Material } from './tipos'

export type TipoBodega = 'FERTILIZANTE' | 'INYECCION' | 'OTRO' | 'ENVASE' | 'DIESEL'

/** Fila de `fn_fert_bodega_general` (lo bajado). */
export type FilaBodegaServidor = {
  estacion_id: string
  tipo: TipoBodega
  clave: string
  material_id: string | null
  codigo: string | null
  nombre: string
  unidad: string | null
  grupo: string | null
  saldo: number
  ultima_recepcion: string | null
  procedencia: string | null
  detalle?: string | null
}

export type BodegaGeneral = { servidor_en: string; filas: FilaBodegaServidor[]; /** sql/144: el producto diésel que publica AGL. */ material_diesel_id?: string | null }

/** Clave con la que se guarda en el teléfono (preferencias del almacén de la persona). */
export const CLAVE_BODEGA_GENERAL = 'bodega_general'

export type FilaBodega = {
  tipo: TipoBodega
  clave: string
  /** Solo productos: para abrir su bitácora. */
  materialId: string | null
  codigo: string | null
  nombre: string
  unidad: string | null
  saldo: number
  ultimaRecepcion: string | null
  procedencia: string | null
  detalle: string | null
}

export const ORDEN_TIPOS: TipoBodega[] = ['FERTILIZANTE', 'INYECCION', 'OTRO', 'ENVASE', 'DIESEL']

export const NOMBRE_TIPO: Record<TipoBodega, string> = {
  FERTILIZANTE: 'Fertilizantes',
  INYECCION: 'Inyección, drench y calidad',
  OTRO: 'Otros productos',
  ENVASE: 'Envases en consignación',
  DIESEL: 'Diésel',
}

const redondear = (n: number) => Math.round(n * 10000) / 10000

/**
 * Arma la lista de la estación. Productos y envases salen del saldo local (con lo pendiente); la base aporta tipo,
 * última recepción y procedencia (sin ella, un producto se clasifica por su marca de análisis y no tiene procedencia).
 * El diésel es un producto como los demás: su saldo local (con lo pendiente) y su clasificación DIESEL vienen del mismo mapa.
 */
export function armarBodega(args: {
  estacionId: string
  saldos: Map<string, number>
  saldosEnvases: Map<string, number>
  material: (id: string) => Material | undefined
  nombreEnvase: (id: string) => string
  servidor: BodegaGeneral | null
}): FilaBodega[] {
  const { estacionId, saldos, saldosEnvases, material, nombreEnvase, servidor } = args
  const delServidor = (servidor?.filas ?? []).filter((f) => f.estacion_id === estacionId)
  const porClave = new Map(delServidor.map((f) => [`${f.tipo === 'ENVASE' ? 'E' : 'P'}|${f.clave}`, f]))
  const filas: FilaBodega[] = []

  for (const [id, v] of saldos) {
    if (redondear(v) === 0) continue
    const m = material(id)
    const s = porClave.get(`P|${id}`)
    filas.push({
      tipo: s && s.tipo !== 'ENVASE' ? s.tipo : id === servidor?.material_diesel_id ? 'DIESEL' : m?.analisis ? 'FERTILIZANTE' : 'OTRO',
      clave: id,
      materialId: id,
      codigo: m?.codigo ?? s?.codigo ?? null,
      nombre: m?.descripcion ?? s?.nombre ?? '—',
      unidad: m?.unidad ?? s?.unidad ?? null,
      saldo: redondear(v),
      ultimaRecepcion: s?.ultima_recepcion ?? null,
      procedencia: s?.procedencia ?? null,
      detalle: null,
    })
  }
  for (const [id, v] of saldosEnvases) {
    if (redondear(v) === 0) continue
    const s = porClave.get(`E|${id}`)
    filas.push({
      tipo: 'ENVASE',
      clave: id,
      materialId: null,
      codigo: null,
      nombre: nombreEnvase(id) || s?.nombre || 'Envase',
      unidad: 'envases',
      saldo: v,
      ultimaRecepcion: s?.ultima_recepcion ?? null,
      procedencia: s?.procedencia ?? null,
      detalle: null,
    })
  }
  const orden = (t: TipoBodega) => ORDEN_TIPOS.indexOf(t)
  return filas.sort((a, b) => orden(a.tipo) - orden(b.tipo) || a.nombre.localeCompare(b.nombre, 'es') || (a.detalle ?? '').localeCompare(b.detalle ?? '', 'es'))
}

/** Cuántas filas hay de cada tipo (para los botones de filtro: solo se ofrecen los que tienen algo). */
export function conteoPorTipo(filas: FilaBodega[]): Map<TipoBodega, number> {
  const m = new Map<TipoBodega, number>()
  for (const f of filas) m.set(f.tipo, (m.get(f.tipo) ?? 0) + 1)
  return m
}
