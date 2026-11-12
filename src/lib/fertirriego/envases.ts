/**
 * Envases (barriles, canecas…) por estación (piloto 1, sql/99). Puro: solo importa tipos.
 *
 * Saldo que ve el teléfono = el del servidor + lo pendiente de enviar:
 *   recepción  + recibidos − entregados
 *   conteo     fija lo contado
 *   anulación  de una recepción del servidor: revierte sus envases
 */

import type { EnvaseTipo, LineaEnvase, Operacion, Recepcion, SaldoEnvase } from './tipos'

const entero = (v: unknown) => Math.trunc(Number(v ?? 0) || 0)

export function saldosEnvasesLocales(
  estado: { envases_saldos?: SaldoEnvase[]; recepciones?: Recepcion[] },
  cola: Operacion[],
  estacionId: string
): Map<string, number> {
  const saldos = new Map<string, number>()
  for (const s of estado.envases_saldos ?? []) if (s.estacion_id === estacionId) saldos.set(s.envase_id, entero(s.saldo))
  const sumar = (id: string, c: number) => saldos.set(id, (saldos.get(id) ?? 0) + c)
  for (const op of cola) {
    if (op.estado_local !== 'PENDIENTE' || op.datos.estacion_id !== estacionId) continue
    if (op.tipo === 'recepcion') {
      for (const e of (op.datos.envases as LineaEnvase[] | undefined) ?? []) sumar(e.envase_id, entero(e.recibidos) - entero(e.entregados))
    } else if (op.tipo === 'conteo') {
      for (const e of (op.datos.envases as { envase_id: string; cantidad_real: number }[] | undefined) ?? []) {
        if (e.cantidad_real === null || e.cantidad_real === undefined) continue
        saldos.set(e.envase_id, entero(e.cantidad_real))
      }
    } else if (op.tipo === 'anulacion') {
      const rec = (estado.recepciones ?? []).find((r) => r.id === op.datos.documento_id && !r.anulado_at)
      for (const e of rec?.envases ?? []) sumar(e.envase_id, -(entero(e.recibidos) - entero(e.entregados)))
    }
  }
  return saldos
}

export type FilaEnvase = { envase_id: string; recibidos: string; entregados: string }

/** Lee las filas de envases de la recepción: enteros ≥ 0, vacío = 0; las filas con ambos en 0 no van. */
export function leerEnvases(filas: FilaEnvase[]): { error: string } | { envases: LineaEnvase[] } {
  const envases: LineaEnvase[] = []
  for (const f of filas) {
    const leer = (v: string) => (v.trim() === '' ? 0 : Number(v.trim()))
    const recibidos = leer(f.recibidos)
    const entregados = leer(f.entregados)
    for (const n of [recibidos, entregados]) {
      if (!Number.isInteger(n) || n < 0) return { error: 'Los envases se cuentan en números enteros (0, 1, 2…).' }
      if (n > 100_000) return { error: 'Un número de envases es demasiado grande. Revísalo.' }
    }
    if (recibidos === 0 && entregados === 0) continue
    envases.push({ envase_id: f.envase_id, recibidos, entregados })
  }
  return { envases }
}

/** Tipos de envase creados en el teléfono que aún no llegan al servidor. */
export function envasesPendientes(cola: Operacion[]): EnvaseTipo[] {
  return cola
    .filter((o) => o.tipo === 'envase_tipo' && o.estado_local === 'PENDIENTE')
    .map((o) => ({ id: String(o.datos.envase_id ?? o.id), nombre: String(o.datos.nombre ?? ''), validado: false, pendiente: true }))
}
