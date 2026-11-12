/**
 * Cuentas de la bodega en el teléfono (puras: ni React, ni IndexedDB, ni red).
 *
 * El saldo que se enseña = el del servidor (última descarga) + lo registrado en el teléfono que todavía no se
 * envió. Así el estacionero ve su inventario correcto aunque lleve horas sin señal.
 */

import { isoDe } from '@/lib/fechas/zona'
import type { EstadoCampo, FilaPlan, Linea, Movimiento, Operacion, TipoMovimiento } from './tipos'

export type Efecto = { estacion_id: string; material_id: string; cantidad: number; tipo: TipoMovimiento }

const num = (v: unknown) => Number(v ?? 0) || 0
const lineasDe = (d: Record<string, unknown>) => ((d.lineas as Linea[] | undefined) ?? []).filter((l) => num(l.cantidad) > 0)

/** Saldos del servidor para una estación: {material → cantidad}. */
function saldosServidor(estado: EstadoCampo, estacionId: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of estado.saldos) if (s.estacion_id === estacionId) m.set(s.material_id, num(s.disponible))
  return m
}

/**
 * Lo que un registro pendiente le hace a la bodega. `saldo` es el saldo al momento de aplicarlo (para el conteo,
 * que no suma una cantidad sino que FIJA lo contado).
 */
export function efectosDe(op: Operacion, estado: EstadoCampo, saldo: (est: string, mat: string) => number): Efecto[] {
  const d = op.datos
  const est = String(d.estacion_id ?? '')
  switch (op.tipo) {
    case 'recepcion':
      return lineasDe(d).map((l) => ({ estacion_id: est, material_id: l.material_id, cantidad: num(l.cantidad), tipo: 'RECEPCION' }))
    case 'aplicacion':
      return lineasDe(d).map((l) => ({ estacion_id: est, material_id: l.material_id, cantidad: -num(l.cantidad), tipo: 'APLICACION' }))
    case 'devolucion': {
      const apl = estado.aplicaciones.find((a) => a.id === d.aplicacion_id)
      const e = apl?.estacion_id ?? est
      return lineasDe(d).map((l) => ({ estacion_id: e, material_id: l.material_id, cantidad: num(l.cantidad), tipo: 'DEVOLUCION' }))
    }
    case 'conteo':
      return ((d.lineas as { material_id: string; cantidad_real: number }[] | undefined) ?? [])
        .filter((l) => l.cantidad_real !== null && l.cantidad_real !== undefined && String(l.cantidad_real) !== '')
        .map((l) => ({
          estacion_id: est,
          material_id: l.material_id,
          cantidad: num(l.cantidad_real) - saldo(est, l.material_id),
          tipo: 'AJUSTE_CONTEO' as TipoMovimiento,
        }))
        .filter((e) => e.cantidad !== 0)
    case 'anulacion': {
      const doc = String(d.documento_id ?? '')
      const ya = new Set(estado.movimientos.filter((m) => m.anula_id).map((m) => m.anula_id))
      return estado.movimientos
        .filter((m) => m.documento_id === doc && !m.anula_id && m.tipo !== 'ANULACION' && !ya.has(m.id))
        .map((m) => ({ estacion_id: m.estacion_id, material_id: m.material_id, cantidad: -num(m.cantidad), tipo: 'ANULACION' }))
    }
    default:
      return []
  }
}

/** Saldo por material de una estación, contando lo pendiente de enviar. */
export function saldosLocales(estado: EstadoCampo, cola: Operacion[], estacionId: string): Map<string, number> {
  const saldos = saldosServidor(estado, estacionId)
  const todos = new Map<string, Map<string, number>>([[estacionId, saldos]])
  const leer = (est: string, mat: string) => {
    if (!todos.has(est)) todos.set(est, saldosServidor(estado, est))
    return todos.get(est)!.get(mat) ?? 0
  }
  for (const op of cola) {
    if (op.estado_local !== 'PENDIENTE') continue
    for (const e of efectosDe(op, estado, leer)) {
      if (!todos.has(e.estacion_id)) todos.set(e.estacion_id, saldosServidor(estado, e.estacion_id))
      const m = todos.get(e.estacion_id)!
      m.set(e.material_id, (m.get(e.material_id) ?? 0) + e.cantidad)
    }
  }
  return saldos
}

/* ------------------------------ Kardex ------------------------------ */

export type FilaKardex = {
  clave: string
  fecha_hora: string
  dia: string
  tipo: TipoMovimiento
  material_id: string
  entrada: number
  salida: number
  saldo: number
  turno_ciclo_id: string | null
  documento_tipo: string
  documento_id: string
  pendiente: boolean
  anulado: boolean
}

export const NOMBRE_MOVIMIENTO: Record<TipoMovimiento, string> = {
  SALDO_INICIAL: 'Saldo inicial',
  RECEPCION: 'Entrega recibida',
  APLICACION: 'Aplicación',
  DEVOLUCION: 'Devolución a bodega',
  AJUSTE_CONTEO: 'Ajuste por conteo',
  DIFERENCIA_RELEVO: 'Diferencia en relevo',
  TRASLADO_SALIDA: 'Traslado enviado',
  TRASLADO_ENTRADA: 'Traslado recibido',
  TRASLADO_DEVUELTO: 'Traslado devuelto',
  ANULACION: 'Anulación',
}

/** El kardex de una estación (y un material, si se da): del servidor + lo pendiente, con saldo acumulado. */
export function kardex(estado: EstadoCampo, cola: Operacion[], estacionId: string, materialId?: string): FilaKardex[] {
  const anulados = new Set(estado.movimientos.filter((m) => m.anula_id).map((m) => m.anula_id))
  const filas: Omit<FilaKardex, 'saldo'>[] = estado.movimientos
    .filter((m) => m.estacion_id === estacionId && (!materialId || m.material_id === materialId))
    .map((m: Movimiento) => ({
      clave: m.id,
      fecha_hora: m.fecha_hora,
      dia: isoDe(new Date(m.fecha_hora)),
      tipo: m.tipo,
      material_id: m.material_id,
      entrada: m.cantidad > 0 ? num(m.cantidad) : 0,
      salida: m.cantidad < 0 ? -num(m.cantidad) : 0,
      turno_ciclo_id: m.turno_ciclo_id,
      documento_tipo: m.documento_tipo,
      documento_id: m.documento_id,
      pendiente: false,
      anulado: anulados.has(m.id),
    }))

  // Lo pendiente, en el orden en que se registró
  const saldosTmp = new Map<string, number>()
  const leer = (est: string, mat: string) => {
    const k = `${est}|${mat}`
    if (!saldosTmp.has(k)) saldosTmp.set(k, num(estado.saldos.find((s) => s.estacion_id === est && s.material_id === mat)?.disponible))
    return saldosTmp.get(k)!
  }
  for (const op of cola) {
    if (op.estado_local !== 'PENDIENTE') continue
    const efectos = efectosDe(op, estado, leer)
    efectos.forEach((e, i) => {
      const k = `${e.estacion_id}|${e.material_id}`
      saldosTmp.set(k, leer(e.estacion_id, e.material_id) + e.cantidad)
      if (e.estacion_id !== estacionId || (materialId && e.material_id !== materialId)) return
      filas.push({
        clave: `${op.id}-${i}`,
        fecha_hora: String(op.datos.fecha_hora ?? op.creado_en),
        dia: isoDe(new Date(String(op.datos.fecha_hora ?? op.creado_en))),
        tipo: e.tipo,
        material_id: e.material_id,
        entrada: e.cantidad > 0 ? e.cantidad : 0,
        salida: e.cantidad < 0 ? -e.cantidad : 0,
        turno_ciclo_id: (op.datos.turno_ciclo_id as string | undefined) ?? null,
        documento_tipo: op.tipo,
        documento_id: op.id,
        pendiente: true,
        anulado: false,
      })
    })
  }

  filas.sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora) || Number(a.pendiente) - Number(b.pendiente))
  const acumulado = new Map<string, number>()
  for (const p of estado.saldos_previos) if (p.estacion_id === estacionId) acumulado.set(p.material_id, num(p.saldo))
  return filas.map((f) => {
    const s = (acumulado.get(f.material_id) ?? 0) + f.entrada - f.salida
    acumulado.set(f.material_id, s)
    return { ...f, saldo: Math.round(s * 10000) / 10000 }
  })
}

/* ----------------------------- Plan y turnos ----------------------------- */

/** Lo planificado para un turno en un día: {material → cantidad}. */
export function planDelDia(plan: FilaPlan[], turnoId: string, fecha: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of plan) {
    if (p.turno_ciclo_id === turnoId && p.fecha === fecha) m.set(p.material_id, (m.get(p.material_id) ?? 0) + num(p.cantidad))
  }
  return m
}

export type DiaTurno = {
  fecha: string
  ddt: number | null
  plan: Map<string, number>
  aplicado: Map<string, number>
  pendiente: Map<string, number>
  horasRiego: number | null
  horasFertilizacion: number | null
}

/** Por turno: cada día con plan o con aplicaciones, plan contra aplicado (lo pendiente aparte). */
export function diasDelTurno(estado: EstadoCampo, cola: Operacion[], turnoId: string): DiaTurno[] {
  const dias = new Map<string, DiaTurno>()
  const dia = (fecha: string) => {
    if (!dias.has(fecha)) {
      dias.set(fecha, { fecha, ddt: null, plan: new Map(), aplicado: new Map(), pendiente: new Map(), horasRiego: null, horasFertilizacion: null })
    }
    return dias.get(fecha)!
  }
  const sumar = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)

  for (const p of estado.plan) {
    if (p.turno_ciclo_id !== turnoId) continue
    const d = dia(p.fecha)
    d.ddt = p.ddt
    sumar(d.plan, p.material_id, num(p.cantidad))
  }
  for (const a of estado.aplicaciones) {
    if (a.turno_ciclo_id !== turnoId || a.anulado_at) continue
    for (const l of a.lineas ?? []) sumar(dia(a.fecha).aplicado, l.material_id, num(l.cantidad))
  }
  for (const op of cola) {
    if (op.estado_local !== 'PENDIENTE' || op.tipo !== 'aplicacion' || op.datos.turno_ciclo_id !== turnoId) continue
    const fecha = String(op.datos.fecha ?? isoDe(new Date(op.creado_en)))
    for (const l of lineasDe(op.datos)) sumar(dia(fecha).pendiente, l.material_id, num(l.cantidad))
  }
  for (const b of estado.bitacora_riego) {
    if (b.turno_ciclo_id !== turnoId) continue
    const d = dia(b.fecha)
    d.horasRiego = b.horas_riego
    d.horasFertilizacion = b.horas_fertilizacion
  }
  return [...dias.values()].sort((a, b) => b.fecha.localeCompare(a.fecha))
}

/** Redondeo para mostrar cantidades: hasta 2 decimales, sin ceros de más. */
export function cantidad(v: number): string {
  return new Intl.NumberFormat('es-HN', { maximumFractionDigits: 2 }).format(Math.round(v * 100) / 100)
}
