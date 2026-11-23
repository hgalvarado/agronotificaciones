/**
 * Inyección / Drench / Calidad por lote (Campo, bloque 2): cálculos puros del teléfono. Ni React, ni IndexedDB, ni red.
 * La base (`_iny_op_aplicacion_lote`, sql/129) vuelve a validar todo.
 */

import type { ObjetivoElegido } from './objetivos'

export type { ObjetivoElegido } from './objetivos'

/** Una línea del plan por lote publicada por AGL (fn_iny_estado_campo). */
export type FilaPlanInyeccion = {
  id: string
  estacion_id: string | null
  temporada: string
  ciclo: string | null
  turno_agl_id: string
  turno: string | null
  lote: string
  categoria_clave: string
  ddt: number | null
  fecha_plan: string | null
  material_id: string
  dosis_mz: number | null
  area_mz: number | null
  cantidad_plan: number | null
  /** sql/141: para decidir en campo. Todos opcionales (planes publicados antes de la 141 no los traen). */
  variedad?: string | null
  observaciones?: string | null
  controla?: string | null
  pct_aplicacion?: number | null
  /** sql/142: lote sin turno; la fecha es la siembra de la Ruta + DDT (estimada) hasta que tenga turno. */
  fecha_estimada?: boolean | null
}

export type LineaDelPlan = {
  material_id: string
  ddt: number | null
  fecha_plan: string | null
  /** true = fecha estimada (lote sin turno). */
  fecha_estimada?: boolean
  turno_agl_id: string
  ciclo: string | null
  temporada: string
  area_mz: number | null
  dosis_mz: number
  cantidad_plan: number
  observaciones: string | null
  controla: string | null
}

const DIA_MS = 86_400_000
const num = (v: unknown) => Number(v ?? 0) || 0
/** Lote normalizado (sin espacios, minúsculas): igual a `_iny_norm_lote` de la base. */
const llave = (s: string) => s.replace(/\s+/g, '').toLowerCase()

/** Días de diferencia entre dos fechas AAAA-MM-DD (al mediodía UTC: ninguna zona mueve el día). */
function dias(a: string, b: string): number {
  return Math.round((Date.parse(`${a.slice(0, 10)}T12:00:00Z`) - Date.parse(`${b.slice(0, 10)}T12:00:00Z`)) / DIA_MS)
}

/** cantidad ÷ área, a 4 decimales; null si el área no es mayor que cero. */
export function dosisPorMz(cantidad: number, areaMz: number): number | null {
  if (!Number.isFinite(areaMz) || areaMz <= 0 || !Number.isFinite(cantidad)) return null
  return Math.round((cantidad / areaMz) * 10000) / 10000
}

/** Área propuesta: la del plan primero; el área del lote como respaldo; null si no hay ninguna. */
export function areaPropuesta(args: { areaPlan: number | null; areaLote: number | null }): number | null {
  if (args.areaPlan !== null && num(args.areaPlan) > 0) return num(args.areaPlan)
  if (args.areaLote !== null && num(args.areaLote) > 0) return num(args.areaLote)
  return null
}

/**
 * Los productos del plan de un lote para UN DDT: el pedido, o el más cercano a `fecha` (con varias cohortes del
 * mismo lote gana la fecha de plan más próxima; a igual distancia, la más antigua). Vacío si el lote no tiene plan.
 */
export function lineasDelPlan(
  plan: FilaPlanInyeccion[],
  args: { lote: string; categoriaClave?: string | null; ddt?: number; fecha?: string }
): LineaDelPlan[] {
  const delLote = plan.filter(
    (p) => llave(p.lote) === llave(args.lote) && (!args.categoriaClave || p.categoria_clave === args.categoriaClave)
  )
  if (delLote.length === 0) return []
  const grupos = new Map<string, FilaPlanInyeccion[]>()
  for (const p of delLote) {
    if (args.ddt !== undefined && p.ddt !== args.ddt) continue
    const k = `${p.turno_agl_id}|${p.ddt}|${p.fecha_plan ?? ''}`
    grupos.set(k, [...(grupos.get(k) ?? []), p])
  }
  let mejor: FilaPlanInyeccion[] | null = null
  let mejorD = Number.POSITIVE_INFINITY
  let mejorF = ''
  for (const g of grupos.values()) {
    const f = g[0].fecha_plan ?? ''
    const d = args.fecha && f ? Math.abs(dias(args.fecha, f)) : 0
    if (d < mejorD || (d === mejorD && f < mejorF)) {
      mejor = g
      mejorD = d
      mejorF = f
    }
  }
  return (mejor ?? []).map((p) => ({
    material_id: p.material_id,
    ddt: p.ddt,
    fecha_plan: p.fecha_plan,
    ...(p.fecha_estimada ? { fecha_estimada: true } : {}),
    turno_agl_id: p.turno_agl_id,
    ciclo: p.ciclo,
    temporada: p.temporada,
    area_mz: p.area_mz,
    dosis_mz: num(p.dosis_mz),
    cantidad_plan: num(p.cantidad_plan),
    observaciones: p.observaciones ?? null,
    controla: p.controla ?? null,
  }))
}

export type EntradaAplicacionLote = {
  estacionId: string
  lote: string
  categoriaClave: string | null
  temporada: string
  ciclo: string | null
  turnoAglId: string | null
  areaMz: number
  areaLote: number | null
  /**
   * Objetivos del REGISTRO (envíos anteriores a la 141). Con objetivos por producto (`lineas[].objetivos`) se calcula
   * solo como la unión de los de sus productos; el de un producto sin objetivo propio es este.
   */
  objetivos?: ObjetivoElegido[]
  comentario: string
  sinInventario: boolean
  /**
   * `de_bodega`: true = «lo tomé de la bodega de la estación» (descuenta); false = «vino aparte» (no descuenta).
   * `objetivos` (sql/141): el objetivo de ESTE producto.
   */
  lineas: { material_id: string; cantidad: number; de_bodega?: boolean; objetivos?: ObjetivoElegido[] }[]
  fechaHora: string
}

export const ERR_SIN_LOTE = 'Elige el lote'
export const ERR_SIN_AREA = 'Indica el área cubierta'
export const ERR_SIN_OBJETIVO = 'Elige al menos un objetivo'
export const ERR_SIN_PRODUCTOS = 'Indica al menos un producto'

/**
 * Arma los `datos` de la operación `aplicacion_lote`. Las líneas con cantidad 0 (o no numérica) se descartan; si no
 * queda ninguna, error. Un área mayor que la del lote es solo AVISO (la base decide: en línea la rechaza).
 */
export function armarAplicacionLote(a: EntradaAplicacionLote): { datos: Record<string, unknown>; avisos: string[] } | { error: string } {
  if (!a.lote.trim()) return { error: ERR_SIN_LOTE }
  if (!Number.isFinite(a.areaMz) || a.areaMz <= 0) return { error: ERR_SIN_AREA }
  const limpiar = (xs: ObjetivoElegido[] | undefined) => [...new Map((xs ?? []).filter((o) => o.id && o.nombre.trim()).map((o) => [o.id, { id: o.id, nombre: o.nombre.trim(), ...(o.tipo ? { tipo: o.tipo } : {}) }])).values()]
  const delRegistro = limpiar(a.objetivos)
  const lineas = a.lineas.filter((l) => l.material_id && Number.isFinite(Number(l.cantidad)) && Number(l.cantidad) > 0)
  if (lineas.length === 0) return { error: ERR_SIN_PRODUCTOS }
  // Objetivo por producto: el suyo; si no trae, el del registro; si ninguno, error
  const porLinea = lineas.map((l) => {
    const propios = limpiar(l.objetivos)
    return propios.length > 0 ? propios : delRegistro
  })
  if (porLinea.some((o) => o.length === 0)) return { error: ERR_SIN_OBJETIVO }
  // Unión (compatibilidad con la base y con AGL): sin repetir, en el orden en que se eligieron
  const objetivos = delRegistro.length > 0 && lineas.every((l) => limpiar(l.objetivos).length === 0) ? delRegistro : limpiar(porLinea.flat())
  const avisos: string[] = []
  if (a.areaLote !== null && a.areaLote > 0 && a.areaMz > a.areaLote + 0.0001) {
    avisos.push(`El área cubierta (${a.areaMz}) es mayor que el área del lote (${a.areaLote}).`)
  }
  const datos: Record<string, unknown> = {
    estacion_id: a.estacionId,
    fecha_hora: a.fechaHora,
    lote: a.lote.trim(),
    categoria_clave: a.categoriaClave,
    temporada: a.temporada,
    ciclo: a.ciclo,
    turno_agl_id: a.turnoAglId,
    area_mz: a.areaMz,
    objetivos,
    comentario: a.comentario.trim() || null,
    lineas: lineas.map((l, i) => ({
      material_id: l.material_id,
      cantidad: Number(l.cantidad),
      de_bodega: l.de_bodega === true,
      // solo cuando el producto tiene objetivo propio (el envío viejo, con uno solo para todo, no lo trae)
      ...(limpiar(l.objetivos).length > 0 ? { objetivos: porLinea[i] } : {}),
    })),
  }
  // Solo cuenta lo que se tomó de la bodega. La base no rechaza por saldo cuando la persona confirmó la casilla (el sincronizador manda inmediato = false)
  if (a.sinInventario) datos.acepta_negativo = true
  return { datos, avisos }
}
