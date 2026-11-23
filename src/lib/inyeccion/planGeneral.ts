/**
 * Vistas del PLAN de Inyección para decidir en campo (cuentas puras; ni React, ni red):
 *  - `planGeneralPorDdt`: el plan de la estación agrupado por DDT → producto, como en AGL › Plan general
 *    (dosis/mz, qué controla, observaciones del LTP, variedades con su % del área, lotes y avance).
 *  - `planDeLote`: lo que le toca a UN lote, DDT por DDT, con su estado (hecho / atrasado / hoy / próximo).
 * El plan que llega al teléfono ya viene recortado a las zonas de la persona (sql/141); aquí solo se filtra por estación
 * y categorías activas.
 */

import type { FilaPlanInyeccion } from './aplicarLote'

const llave = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const DIA_MS = 86_400_000
export const SIN_VARIEDAD = 'Sin variedad'

const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${a.slice(0, 10)}T12:00:00Z`) - Date.parse(`${b.slice(0, 10)}T12:00:00Z`)) / DIA_MS)
const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const clave = (turno: string, ddt: number | null) => `${turno}|${ddt}`
const claveLote = (f: FilaPlanInyeccion) => `${f.turno_agl_id}|${llave(f.lote)}`

/** Las líneas del plan de la estación (plan sin estación = de todas) de categorías activas. */
export function planDeEstacion(plan: FilaPlanInyeccion[], estacionId: string, activas: Set<string>): FilaPlanInyeccion[] {
  return plan.filter((p) => (p.estacion_id === null || p.estacion_id === estacionId) && activas.has(p.categoria_clave))
}

export type VariedadPlan = { variedad: string; pct: number; area_mz: number }

export type ProductoDeDdt = {
  material_id: string
  dosis_mz: number | null
  area_mz: number
  cantidad: number
  controla: string | null
  observaciones: string[]
  variedades: VariedadPlan[]
  lotes: string[]
  /** Lotes de este DDT cuyo plan ya se aplicó. */
  lotes_hechos: number
}

export type GrupoDdt = {
  ddt: number | null
  fecha_desde: string | null
  fecha_hasta: string | null
  productos: ProductoDeDdt[]
  n_lotes: number
  n_lotes_hechos: number
  area_mz: number
  /** Todos los lotes del DDT ya aplicados. */
  completo: boolean
}

/** `hechos`: marcas «turno|ddt» ya aplicadas (estado.planesAplicados). */
export function planGeneralPorDdt(lineas: FilaPlanInyeccion[], hechos: Set<string>): GrupoDdt[] {
  const porDdt = new Map<string, FilaPlanInyeccion[]>()
  for (const l of lineas) porDdt.set(String(l.ddt), [...(porDdt.get(String(l.ddt)) ?? []), l])
  const grupos: GrupoDdt[] = []
  for (const filas of porDdt.values()) {
    const ddt = filas[0].ddt
    const porProducto = new Map<string, FilaPlanInyeccion[]>()
    for (const f of filas) porProducto.set(f.material_id, [...(porProducto.get(f.material_id) ?? []), f])
    const productos: ProductoDeDdt[] = [...porProducto.entries()].map(([material_id, fs]) => {
      const area = fs.reduce((s, f) => s + Number(f.area_mz ?? 0), 0)
      const porVariedad = new Map<string, number>()
      for (const f of fs) {
        const v = f.variedad?.trim() || SIN_VARIEDAD
        porVariedad.set(v, (porVariedad.get(v) ?? 0) + Number(f.area_mz ?? 0))
      }
      const dosis = fs.map((f) => f.dosis_mz).filter((d): d is number => d !== null && d !== undefined)
      return {
        material_id,
        dosis_mz: dosis.length ? dosis[0] : null,
        area_mz: redondear(area),
        cantidad: redondear(fs.reduce((s, f) => s + Number(f.cantidad_plan ?? 0), 0)),
        controla: fs.map((f) => f.controla?.trim()).find(Boolean) ?? null,
        observaciones: [...new Set(fs.map((f) => f.observaciones?.trim()).filter((x): x is string => Boolean(x)))],
        variedades: [...porVariedad.entries()]
          .map(([variedad, a]) => ({ variedad, area_mz: redondear(a), pct: area > 0 ? redondear((a / area) * 100, 1) : 0 }))
          .sort((x, y) => y.area_mz - x.area_mz || x.variedad.localeCompare(y.variedad, 'es')),
        lotes: [...new Set(fs.map((f) => f.lote))].sort((x, y) => x.localeCompare(y, 'es', { numeric: true })),
        lotes_hechos: new Set(fs.filter((f) => hechos.has(clave(f.turno_agl_id, f.ddt))).map(claveLote)).size,
      }
    })
    productos.sort((a, b) => a.material_id.localeCompare(b.material_id))
    const lotes = new Set(filas.map(claveLote))
    const lotesHechos = new Set(filas.filter((f) => hechos.has(clave(f.turno_agl_id, f.ddt))).map(claveLote))
    const fechas = filas.map((f) => f.fecha_plan).filter((x): x is string => Boolean(x)).sort()
    // el área de un grupo = la de cada lote una sola vez (un lote repite su área en cada producto)
    const areaPorLote = new Map<string, number>()
    for (const f of filas) areaPorLote.set(claveLote(f), Number(f.area_mz ?? 0))
    grupos.push({
      ddt,
      fecha_desde: fechas[0] ?? null,
      fecha_hasta: fechas[fechas.length - 1] ?? null,
      productos,
      n_lotes: lotes.size,
      n_lotes_hechos: lotesHechos.size,
      area_mz: redondear([...areaPorLote.values()].reduce((s, x) => s + x, 0)),
      completo: lotes.size > 0 && lotesHechos.size === lotes.size,
    })
  }
  return grupos.sort((a, b) => (a.ddt === null ? 1 : b.ddt === null ? -1 : a.ddt - b.ddt))
}

export type EstadoPlanLote = 'hecho' | 'atrasado' | 'hoy' | 'proximo' | 'sin_fecha'

export type ProductoDeLote = {
  material_id: string
  dosis_mz: number | null
  cantidad_plan: number
  area_mz: number | null
  controla: string | null
  observaciones: string | null
}

export type PlanDeLote = {
  turno_agl_id: string
  turno: string | null
  ciclo: string | null
  variedad: string | null
  ddt: number | null
  fecha_plan: string | null
  estado: EstadoPlanLote
  /** Días hasta la fecha del plan (negativo = pasó). */
  dias: number | null
  productos: ProductoDeLote[]
}

/** Lotes (únicos) que tienen plan en la estación, ordenados. */
export function lotesDelPlan(lineas: FilaPlanInyeccion[]): string[] {
  const m = new Map<string, string>()
  for (const l of lineas) if (!m.has(llave(l.lote))) m.set(llave(l.lote), l.lote)
  return [...m.values()].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
}

/** Lo que le toca a un lote: un renglón por (turno, DDT), por fecha de plan. */
export function planDeLote(lineas: FilaPlanInyeccion[], lote: string, hechos: Set<string>, hoy: string): PlanDeLote[] {
  const propias = lineas.filter((l) => llave(l.lote) === llave(lote))
  const grupos = new Map<string, FilaPlanInyeccion[]>()
  for (const l of propias) grupos.set(clave(l.turno_agl_id, l.ddt), [...(grupos.get(clave(l.turno_agl_id, l.ddt)) ?? []), l])
  const salida: PlanDeLote[] = [...grupos.values()].map((fs) => {
    const f0 = fs[0]
    const dias = f0.fecha_plan ? diasEntre(f0.fecha_plan, hoy) : null
    const hecho = hechos.has(clave(f0.turno_agl_id, f0.ddt))
    const estado: EstadoPlanLote = hecho ? 'hecho' : dias === null ? 'sin_fecha' : dias < 0 ? 'atrasado' : dias === 0 ? 'hoy' : 'proximo'
    return {
      turno_agl_id: f0.turno_agl_id,
      turno: f0.turno,
      ciclo: f0.ciclo,
      variedad: f0.variedad?.trim() || null,
      ddt: f0.ddt,
      fecha_plan: f0.fecha_plan,
      estado,
      dias,
      productos: fs
        .map((f) => ({
          material_id: f.material_id,
          dosis_mz: f.dosis_mz ?? null,
          cantidad_plan: Number(f.cantidad_plan ?? 0),
          area_mz: f.area_mz ?? null,
          controla: f.controla?.trim() || null,
          observaciones: f.observaciones?.trim() || null,
        }))
        .sort((a, b) => a.material_id.localeCompare(b.material_id)),
    }
  })
  return salida.sort((a, b) => (a.fecha_plan ?? '9999').localeCompare(b.fecha_plan ?? '9999') || (a.ddt ?? 0) - (b.ddt ?? 0))
}

/** Lo que toca ahora a un lote: lo atrasado o de hoy más antiguo sin hacer; si no hay, lo próximo. */
export function siguientePlanDeLote(planes: PlanDeLote[]): PlanDeLote | null {
  return planes.find((p) => p.estado === 'atrasado' || p.estado === 'hoy') ?? planes.find((p) => p.estado === 'proximo' || p.estado === 'sin_fecha') ?? null
}
