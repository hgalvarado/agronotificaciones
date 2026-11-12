/**
 * DDT (días después del trasplante/siembra) del plan contra lo aplicado (piloto 1, puntos 3, 4 y 7).
 * Puro: ni React, ni IndexedDB, ni red. Solo importa tipos (lo prueba `pruebas/unit` con node --test).
 *
 * - Una aplicación con `ddt_plan`/`fecha_plan` va con ese DDT del plan; con `extra` es una aplicación extra.
 * - Las viejas (sin ddt ni extra) van con el DDT cuya fecha del plan es la misma que su día de aplicación; si no hay
 *   ninguno, se muestran aparte (como extra, «sin DDT del plan»).
 */

import type { Aplicacion, FilaPlan, Linea, Operacion } from './tipos'

const DIA_MS = 86_400_000
const num = (v: unknown) => Number(v ?? 0) || 0

/** Días de `desde` a `hasta` (fechas AAAA-MM-DD; al mediodía UTC para que ninguna zona mueva el día). */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${String(desde).slice(0, 10)}T12:00:00Z`)
  const b = Date.parse(`${String(hasta).slice(0, 10)}T12:00:00Z`)
  return Math.round((b - a) / DIA_MS)
}

/** DDT real = día de aplicación − fecha de siembra del turno (null si el turno no tiene fecha de siembra). */
export function ddtReal(fechaSiembra: string | null | undefined, dia: string): number | null {
  if (!fechaSiembra || !dia) return null
  const n = diasEntre(fechaSiembra, dia)
  return Number.isFinite(n) ? n : null
}

export type DdtPlan = { fecha: string; ddt: number; productos: Map<string, number> }

/** Los DDT del plan de un turno (una entrada por fecha del plan), del primero al último. */
export function ddtsDelTurno(plan: FilaPlan[], turnoId: string): DdtPlan[] {
  const porFecha = new Map<string, DdtPlan>()
  for (const p of plan) {
    if (p.turno_ciclo_id !== turnoId) continue
    const fecha = String(p.fecha).slice(0, 10)
    if (!porFecha.has(fecha)) porFecha.set(fecha, { fecha, ddt: num(p.ddt), productos: new Map() })
    const d = porFecha.get(fecha)!
    d.productos.set(p.material_id, (d.productos.get(p.material_id) ?? 0) + num(p.cantidad))
  }
  return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** Una aplicación como la ve el teléfono: del servidor o pendiente de enviar. */
export type AplicacionVista = {
  id: string
  fecha: string
  ddt_plan: number | null
  fecha_plan: string | null
  extra: boolean
  ddt_real: number | null
  lineas: Map<string, number>
  pendiente: boolean
}

/** Aplicaciones de un turno: las del servidor (sin anular) y las pendientes de enviar. */
export function aplicacionesDelTurno(
  aplicaciones: Aplicacion[],
  cola: Operacion[],
  turnoId: string,
  fechaSiembra: string | null | undefined
): AplicacionVista[] {
  const sumarLineas = (lineas: Linea[] | null | undefined) => {
    const m = new Map<string, number>()
    for (const l of lineas ?? []) if (num(l.cantidad) > 0) m.set(l.material_id, (m.get(l.material_id) ?? 0) + num(l.cantidad))
    return m
  }
  const lista: AplicacionVista[] = []
  for (const a of aplicaciones) {
    if (a.turno_ciclo_id !== turnoId || a.anulado_at) continue
    const fecha = String(a.fecha).slice(0, 10)
    lista.push({
      id: a.id,
      fecha,
      ddt_plan: a.ddt_plan ?? null,
      fecha_plan: a.fecha_plan ? String(a.fecha_plan).slice(0, 10) : null,
      extra: Boolean(a.extra),
      ddt_real: a.ddt_real ?? ddtReal(fechaSiembra, fecha),
      lineas: sumarLineas(a.lineas),
      pendiente: false,
    })
  }
  for (const op of cola) {
    if (op.estado_local !== 'PENDIENTE' || op.tipo !== 'aplicacion' || op.datos.turno_ciclo_id !== turnoId) continue
    const d = op.datos
    const fecha = String(d.fecha ?? op.creado_en).slice(0, 10)
    lista.push({
      id: op.id,
      fecha,
      ddt_plan: d.ddt_plan === undefined || d.ddt_plan === null ? null : num(d.ddt_plan),
      fecha_plan: d.fecha_plan ? String(d.fecha_plan).slice(0, 10) : null,
      extra: Boolean(d.extra),
      ddt_real: ddtReal(fechaSiembra, fecha),
      lineas: sumarLineas(d.lineas as Linea[] | undefined),
      pendiente: true,
    })
  }
  return lista
}

/** La fecha del plan a la que pertenece una aplicación (null = extra o fuera de plan). */
export function fechaPlanDe(a: Pick<AplicacionVista, 'extra' | 'fecha_plan' | 'fecha'>, fechasPlan: Set<string>): string | null {
  if (a.extra) return null
  if (a.fecha_plan) return a.fecha_plan
  return fechasPlan.has(a.fecha) ? a.fecha : null
}

/** Fechas del plan que ya tienen aplicación (para los chips: «sin aplicar» primero). */
export function fechasPlanAplicadas(ddts: DdtPlan[], aplicaciones: AplicacionVista[]): Set<string> {
  const fechas = new Set(ddts.map((d) => d.fecha))
  const hechas = new Set<string>()
  for (const a of aplicaciones) {
    const f = fechaPlanDe(a, fechas)
    if (f) hechas.add(f)
  }
  return hechas
}

/**
 * Orden de los chips de DDT al aplicar: primero los que no se han aplicado; dentro, los más cercanos al día de
 * aplicación (a igual distancia, el anterior primero).
 */
export function ordenarDdtsParaElegir(ddts: DdtPlan[], aplicadas: Set<string>, dia: string): (DdtPlan & { aplicado: boolean })[] {
  return ddts
    .map((d) => ({ ...d, aplicado: aplicadas.has(d.fecha) }))
    .sort(
      (a, b) =>
        Number(a.aplicado) - Number(b.aplicado) ||
        Math.abs(diasEntre(a.fecha, dia)) - Math.abs(diasEntre(b.fecha, dia)) ||
        a.fecha.localeCompare(b.fecha)
    )
}

export type ProductoTarjeta = { material_id: string; plan: number; real: number; pendiente: number; variacion: number }

export type TarjetaDdt = {
  clave: string
  tipo: 'plan' | 'extra'
  /** Extra declarada (true) o aplicación vieja sin DDT del plan (false). Solo en tipo «extra». */
  declarada: boolean
  fechaPlan: string | null
  ddtPlan: number | null
  fechasReales: string[]
  ddtsReales: number[]
  productos: ProductoTarjeta[]
  aplicaciones: AplicacionVista[]
  /** Fecha para ordenar y para los botones (la del plan, o la real si es extra). */
  fecha: string
}

/** Pestaña Turno: una tarjeta por DDT del plan (plan · real · variación) y una por aplicación extra. */
export function tarjetasDelTurno(ddts: DdtPlan[], aplicaciones: AplicacionVista[]): TarjetaDdt[] {
  const fechas = new Set(ddts.map((d) => d.fecha))
  const porFecha = new Map<string, AplicacionVista[]>()
  const sueltas: AplicacionVista[] = []
  for (const a of aplicaciones) {
    const f = fechaPlanDe(a, fechas)
    if (f && fechas.has(f)) porFecha.set(f, [...(porFecha.get(f) ?? []), a])
    else sueltas.push(a)
  }
  const armar = (plan: Map<string, number>, apls: AplicacionVista[]): ProductoTarjeta[] => {
    const real = new Map<string, number>()
    const pend = new Map<string, number>()
    for (const a of apls) for (const [m, c] of a.lineas) (a.pendiente ? pend : real).set(m, ((a.pendiente ? pend : real).get(m) ?? 0) + c)
    const ids = [...new Set([...plan.keys(), ...real.keys(), ...pend.keys()])]
    return ids.map((material_id) => {
      const p = plan.get(material_id) ?? 0
      const r = real.get(material_id) ?? 0
      const pe = pend.get(material_id) ?? 0
      return { material_id, plan: p, real: r, pendiente: pe, variacion: Math.round((r + pe - p) * 10000) / 10000 }
    })
  }
  const unicos = (xs: (number | null)[]) => [...new Set(xs.filter((x): x is number => x !== null))].sort((a, b) => a - b)

  const tarjetas: TarjetaDdt[] = ddts.map((d) => {
    const apls = porFecha.get(d.fecha) ?? []
    return {
      clave: `plan-${d.fecha}`,
      tipo: 'plan',
      declarada: false,
      fechaPlan: d.fecha,
      ddtPlan: d.ddt,
      fechasReales: [...new Set(apls.map((a) => a.fecha))].sort(),
      ddtsReales: unicos(apls.map((a) => a.ddt_real)),
      productos: armar(d.productos, apls),
      aplicaciones: apls,
      fecha: d.fecha,
    }
  })
  for (const a of sueltas) {
    tarjetas.push({
      clave: `extra-${a.id}`,
      tipo: 'extra',
      declarada: a.extra,
      fechaPlan: null,
      ddtPlan: null,
      fechasReales: [a.fecha],
      ddtsReales: unicos([a.ddt_real]),
      productos: armar(new Map(), [a]),
      aplicaciones: [a],
      fecha: a.fecha,
    })
  }
  // Lo más reciente arriba; a igual fecha, la del plan antes que la extra
  return tarjetas.sort((a, b) => b.fecha.localeCompare(a.fecha) || (a.tipo === b.tipo ? 0 : a.tipo === 'plan' ? -1 : 1))
}
