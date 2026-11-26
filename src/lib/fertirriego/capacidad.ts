/**
 * Capacidad de almacenaje de las soluciones por estación (sql/152). Puro, sin React ni importaciones.
 * La «solución» es un material del catálogo (Vegetativa, Generativa, Calcio…); la capacidad viene en su misma unidad
 * (la del saldo). Vegetativa y Generativa pueden prestarse el tanque; Calcio nunca (lo decide AGL con `prestable_con`).
 */

export type CapacidadSolucion = {
  estacion_id: string
  material_id: string
  /** Lo de la estación (excepción) o el estándar, sin préstamo. */
  capacidad_base: number
  /** Capacidad efectiva hoy: 0 si cedió su tanque; base + la del que cede si recibe. */
  capacidad: number
  /** Con qué solución se puede prestar (null = nunca). */
  prestable_con: string | null
  /** Hay préstamo vigente: este tanque se usa para esta solución. */
  cede_a: string | null
  /** Hay préstamo vigente: esta solución usa también el tanque de esta otra. */
  recibe_de: string | null
  prestamo_id: string | null
  prestamo_origen: 'ESTACION' | 'AGL' | null
  prestamo_desde: string | null
  prestamo_hasta: string | null
  prestamo_por: string | null
}

export type ZonaCapacidad = 'verde' | 'amarillo' | 'rojo' | 'gris'

/** Lo que aún cabe (nunca negativo). Sin capacidad conocida = null. */
export function espacioDisponible(capacidad: number | null | undefined, saldo: number): number | null {
  if (capacidad === null || capacidad === undefined || !Number.isFinite(capacidad)) return null
  return Math.max(0, redondear(capacidad - saldo))
}

/** Cuánto se pasa de la capacidad si se recibe `recibido` más (0 = cabe). Sin capacidad conocida = 0 (no se avisa). */
export function excesoAlRecibir(capacidad: number | null | undefined, saldo: number, recibido: number): number {
  if (capacidad === null || capacidad === undefined || !Number.isFinite(capacidad)) return 0
  return Math.max(0, redondear(saldo + recibido - capacidad))
}

/** Nivel del tanque (0–100+) y zona: lleno es lo que más importa evitar (≥ 100 % rojo, ≥ 85 % ámbar). */
export function medidorCapacidad(
  saldo: number,
  capacidad: number | null | undefined,
  alertaBajo = false
): { pct: number | null; zona: ZonaCapacidad } {
  if (capacidad === null || capacidad === undefined || !(capacidad > 0)) return { pct: null, zona: 'gris' }
  const real = (Math.max(saldo, 0) * 100) / capacidad
  // alertaBajo (diésel): vacío también preocupa. Sin alertaBajo (soluciones): solo lo lleno.
  const zona: ZonaCapacidad = real >= 100 ? 'rojo' : real >= 85 ? 'amarillo' : alertaBajo ? (real <= 5 ? 'rojo' : real <= 15 ? 'amarillo' : 'verde') : 'verde'
  return { pct: Math.round(Math.min(real, 100)), zona }
}

/** Las capacidades de UNA estación, por material. */
export function capacidadesDeEstacion(lista: CapacidadSolucion[] | undefined, estacionId: string): Map<string, CapacidadSolucion> {
  const m = new Map<string, CapacidadSolucion>()
  for (const c of lista ?? []) if (c.estacion_id === estacionId) m.set(c.material_id, c)
  return m
}

/** Solo se puede prestar entre dos soluciones que se declaran mutuamente (nunca Calcio, que no tiene pareja). */
export function sePuedePrestar(caps: Map<string, CapacidadSolucion>, cedeId: string, recibeId: string): boolean {
  const a = caps.get(cedeId)
  const b = caps.get(recibeId)
  return Boolean(a && b && a.prestable_con === recibeId && b.prestable_con === cedeId)
}

/**
 * Aviso por producto al recibir: lo recibido dejaría la solución por encima de su capacidad efectiva.
 * `lineas` = [{material_id, cantidad}] ya leídas; `saldos` = saldo actual de la estación por material.
 */
export function excedentesDeRecepcion(
  caps: Map<string, CapacidadSolucion>,
  saldos: Map<string, number>,
  lineas: { material_id: string; cantidad: number }[]
): { material_id: string; exceso: number; capacidad: number; saldo: number }[] {
  const salida: { material_id: string; exceso: number; capacidad: number; saldo: number }[] = []
  const porMaterial = new Map<string, number>()
  for (const l of lineas) porMaterial.set(l.material_id, (porMaterial.get(l.material_id) ?? 0) + l.cantidad)
  for (const [material_id, recibido] of porMaterial) {
    const c = caps.get(material_id)
    if (!c) continue
    const saldo = saldos.get(material_id) ?? 0
    const exceso = excesoAlRecibir(c.capacidad, saldo, recibido)
    if (exceso > 0) salida.push({ material_id, exceso, capacidad: c.capacidad, saldo })
  }
  return salida
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

/** Qué tan «crítico» es un nivel (0–100): lo más lleno y, con alertaBajo, lo más vacío. Sirve para ordenar las tarjetas. */
export function criticidad(pct: number | null, alertaBajo = false): number {
  if (pct === null) return -1
  const lleno = pct >= 85 ? pct : 0
  const vacio = alertaBajo && pct <= 15 ? 100 - pct : 0
  return Math.max(lleno, vacio)
}

/** Suma varios tanques/soluciones de una estación: existencia, capacidad, % lleno y espacio para recibir. */
export function resumenDeNiveles(items: { saldo: number; capacidad: number | null | undefined }[], alertaBajo = false) {
  const con = items.filter((i) => i.capacidad !== null && i.capacidad !== undefined && i.capacidad > 0)
  const capacidad = con.reduce((a, i) => a + (i.capacidad as number), 0)
  const saldo = con.reduce((a, i) => a + Math.max(i.saldo, 0), 0)
  const { pct, zona } = medidorCapacidad(saldo, capacidad || null, alertaBajo)
  return { saldo: redondear(saldo), capacidad: redondear(capacidad), pct, zona, espacio: espacioDisponible(capacidad || null, saldo), puntos: criticidad(pct, alertaBajo) }
}
