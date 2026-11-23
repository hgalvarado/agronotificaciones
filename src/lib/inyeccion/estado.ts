/**
 * Lo que el teléfono sabe de Inyección (respuesta de fn_iny_estado_campo, sql/129) y las cuentas puras sobre eso.
 * Ni React, ni IndexedDB, ni red.
 */

import type { Operacion } from '@/lib/fertirriego/tipos'
import { lineasDelPlan, type FilaPlanInyeccion } from './aplicarLote'
import { marcaHecho } from './planGeneral'
import type { LoteCatalogo } from './lotes'
import type { ObjetivoCatalogo } from './objetivos'

export type CategoriaInyeccion = { clave: string; departamento: string | null; categoria: string | null; tipo: string; etiqueta: string | null }

/** Producto de inyección con sus datos técnicos (todos opcionales: MARA no los exige). */
export type ProductoInyeccion = {
  id: string
  codigo: string
  descripcion: string | null
  unidad: string | null
  grupo: string | null
  ingrediente_activo: string | null
  concentracion: string | null
  plagas_controla: string | null
  carencia_dias: number | null
  restricciones: string | null
  notas_tecnicas: string | null
}

export type LineaAplicacionInyeccion = {
  material_id: string
  cantidad: number
  dosis_mz: number | null
  en_plan: boolean
  ddt_plan: number | null
  de_bodega?: boolean | null
  /** sql/141: objetivos de ESTE producto (nombres). Registros anteriores: vacío → se usan los del registro. */
  objetivos?: string[] | null
  objetivo_ids?: string[] | null
}

/** Los objetivos de un producto: los suyos (141) o, si el registro es anterior, los del registro. */
export function objetivosDeLinea(a: Pick<AplicacionInyeccion, 'objetivos'>, l: LineaAplicacionInyeccion): string[] {
  return l.objetivos && l.objetivos.length > 0 ? l.objetivos : a.objetivos
}

export type AplicacionInyeccion = {
  id: string
  estacion_id: string
  lote: string
  temporada: string | null
  ciclo: string | null
  turno_agl_id: string | null
  categoria_clave: string | null
  fecha: string
  fecha_hora: string
  area_mz: number
  /** Nombres de los objetivos (sql/132); las filas de la 129 traen los textos viejos. */
  objetivos: string[]
  objetivo_ids?: string[] | null
  comentario: string | null
  registrado_por: string | null
  anulado_at: string | null
  motivo_anulacion: string | null
  observaciones: string[] | null
  lineas: LineaAplicacionInyeccion[]
}

export type EstadoInyeccion = {
  servidor_en: string
  permisos?: { ver: boolean; registrar: boolean; anular: boolean }
  categorias: CategoriaInyeccion[]
  plan: FilaPlanInyeccion[]
  materiales: ProductoInyeccion[]
  aplicaciones: AplicacionInyeccion[]
  /** sql/132: catálogo de objetivos (activos, inactivos y fusionados: para revisar duplicados sin señal). */
  objetivos?: ObjetivoCatalogo[]
  /** sql/132: lotes del catálogo (lotes + lotes_temporada) de la temporada activa y de las del plan. */
  lotes?: LoteCatalogo[]
}

const llave = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const DIA_MS = 86_400_000
const dia = (iso: string) => iso.slice(0, 10)
const entre = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${dia(a)}T12:00:00Z`) - Date.parse(`${dia(b)}T12:00:00Z`)) / DIA_MS))

/** Sin dato: lo que se muestra cuando MARA no trae el dato técnico (nunca un error por nulo). */
export function textoDato(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return 'Sin dato'
  const t = String(v).trim()
  return t ? t : 'Sin dato'
}

/** Carencia: vacío = «Sin dato»; 0 = «Sin carencia». */
export function textoCarencia(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'Sin dato'
  return v === 0 ? 'Sin carencia' : `${v} día(s)`
}

export type LoteConPlan = {
  lote: string
  estacion_id: string | null
  categoria_clave: string
  /** DDT y fecha de plan más próximos a hoy. */
  ddt: number | null
  fecha_plan: string | null
  area_mz: number | null
  turno: string | null
  hecho: boolean
}

/** Marcas «lote|ddt|producto» (marcaHecho) de lo ya aplicado (servidor + lo pendiente de enviar) para saber si un plan está «hecho». */
export function planesAplicados(plan: FilaPlanInyeccion[], aplicaciones: AplicacionInyeccion[], cola: Operacion[]): Set<string> {
  const hechos = new Set<string>()
  for (const a of aplicaciones) {
    if (a.anulado_at) continue
    for (const l of a.lineas) if (l.ddt_plan !== null) hechos.add(marcaHecho(a.lote, l.ddt_plan, l.material_id))
  }
  for (const op of cola) {
    if (op.estado_local !== 'PENDIENTE' || op.tipo !== 'aplicacion_lote') continue
    const d = op.datos
    const g = lineasDelPlan(plan, {
      lote: String(d.lote ?? ''),
      categoriaClave: (d.categoria_clave as string | null) ?? null,
      fecha: dia(String(d.fecha_hora ?? op.creado_en)),
    })
    const enviados = new Set(((d.lineas as { material_id?: string }[] | undefined) ?? []).map((x) => String(x.material_id)))
    for (const x of g) if (enviados.has(x.material_id)) hechos.add(marcaHecho(String(d.lote ?? ''), x.ddt, x.material_id))
  }
  return hechos
}

/**
 * Lotes con plan de una estación (solo categorías activas), uno por (lote, categoría): el DDT más cercano a `hoy`,
 * «hecho» si ya se aplicó. Ordenados: pendientes primero, por cercanía de la fecha de plan.
 */
export function lotesConPlan(estado: EstadoInyeccion, cola: Operacion[], estacionId: string, hoy: string): LoteConPlan[] {
  const activas = new Set(estado.categorias.map((c) => c.clave))
  const plan = estado.plan.filter((p) => (p.estacion_id === null || p.estacion_id === estacionId) && activas.has(p.categoria_clave))
  const hechos = planesAplicados(plan, estado.aplicaciones, cola)
  const pares = new Map<string, { lote: string; cat: string }>()
  for (const p of plan) pares.set(`${llave(p.lote)}|${p.categoria_clave}`, { lote: p.lote, cat: p.categoria_clave })
  const salida: LoteConPlan[] = []
  for (const { lote, cat } of pares.values()) {
    const g = lineasDelPlan(plan, { lote, categoriaClave: cat, fecha: hoy })
    if (!g[0]) continue
    const fila = plan.find((p) => llave(p.lote) === llave(lote) && p.categoria_clave === cat && p.turno_agl_id === g[0].turno_agl_id && p.ddt === g[0].ddt)
    salida.push({
      lote,
      estacion_id: fila?.estacion_id ?? null,
      categoria_clave: cat,
      ddt: g[0].ddt,
      fecha_plan: g[0].fecha_plan,
      area_mz: g[0].area_mz,
      turno: fila?.turno ?? null,
      hecho: g.every((x) => hechos.has(marcaHecho(lote, x.ddt, x.material_id))),
    })
  }
  return salida.sort(
    (a, b) =>
      Number(a.hecho) - Number(b.hecho) ||
      entre(a.fecha_plan ?? hoy, hoy) - entre(b.fecha_plan ?? hoy, hoy) ||
      a.lote.localeCompare(b.lote, 'es', { numeric: true })
  )
}

/** Las aplicaciones de una estación, la más reciente primero (las anuladas incluidas, marcadas). */
export function historialDeEstacion(estado: EstadoInyeccion, estacionId: string): AplicacionInyeccion[] {
  return estado.aplicaciones.filter((a) => a.estacion_id === estacionId).sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora))
}
