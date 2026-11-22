/**
 * AgroMétricas › Registros de la temporada › Índice de crecimiento (IC): lógica PURA (sin React, sin red).
 * Los registros llegan de fn_agm_ic_mis_registros con las mismas columnas base que los parámetros (id, fecha, ddt, turno, zona…)
 * más `hojas`, `ic_real` e `ic_plan`. Sin imports de React a propósito: corre con `node --test`.
 */

import { valorNumero, type Punto, type Registro, type Serie } from './registrosPura'

export const DECIMALES_IC = 3

/** Texto de un IC o de la diferencia: 3 decimales, «—» si no hay dato. */
export function textoIC(v: number | null, decimales = DECIMALES_IC): string {
  return v === null ? '—' : String(Math.round(v * 10 ** decimales) / 10 ** decimales)
}

/** Diferencia IC real − IC plan (null si falta alguno de los dos). */
export function diferenciaIC(reg: Record<string, unknown>): number | null {
  const real = valorNumero(reg, 'ic_real'), plan = valorNumero(reg, 'ic_plan')
  return real === null || plan === null ? null : Math.round((real - plan) * 10 ** DECIMALES_IC) / 10 ** DECIMALES_IC
}

/** 'sobre' (real ≥ plan), 'bajo' (real < plan) o null si no hay con qué comparar. */
export function estadoContraPlan(reg: Record<string, unknown>): 'sobre' | 'bajo' | null {
  const d = diferenciaIC(reg)
  return d === null ? null : d >= 0 ? 'sobre' : 'bajo'
}

function puntos(registros: Registro[], campo: string): Punto[] {
  const salida: Punto[] = []
  for (const r of registros) {
    if (r.ddt === null || r.ddt === undefined) continue
    const y = valorNumero(r, campo)
    if (y !== null) salida.push({ x: r.ddt as number, y, fecha: r.fecha, fuera: false })
  }
  return salida.sort((a, b) => a.x - b.x)
}

/** El plan es igual para todos los registros del mismo DDT: un punto por DDT. */
function puntosPlan(registros: Registro[]): Punto[] {
  const porDdt = new Map<number, Punto>()
  for (const p of puntos(registros, 'ic_plan')) if (!porDdt.has(p.x)) porDdt.set(p.x, p)
  return [...porDdt.values()].sort((a, b) => a.x - b.x)
}

/** Series de UN turno: IC real contra IC plan por DDT. Sin DDT no hay eje: se cuenta aparte. */
export function seriesIC(registros: Registro[]): { series: Serie[]; sinDdt: number } {
  const sinDdt = registros.filter((r) => r.ddt === null || r.ddt === undefined).length
  const series: Serie[] = []
  const real = puntos(registros, 'ic_real')
  const plan = puntosPlan(registros)
  if (real.length) series.push({ campo: 'ic_real', etiqueta: 'IC real', puntos: real })
  if (plan.length) series.push({ campo: 'ic_plan', etiqueta: 'IC plan', puntos: plan })
  return { series, sinDdt }
}

/** Hojas contadas por DDT de UN turno. */
export function seriesHojas(registros: Registro[]): Serie[] {
  const p = puntos(registros, 'hojas')
  return p.length ? [{ campo: 'hojas', etiqueta: 'Hojas', puntos: p }] : []
}

/** Para las tarjetas: turno → puntos {x: DDT, y: IC real} ordenados por DDT. */
export function sparksIC(registros: Registro[]): Map<string, { x: number; y: number }[]> {
  const mapa = new Map<string, { x: number; y: number }[]>()
  for (const r of registros) {
    const y = valorNumero(r, 'ic_real')
    if (r.ddt === null || r.ddt === undefined || y === null) continue
    const lista = mapa.get(r.turno)
    if (lista) lista.push({ x: r.ddt as number, y })
    else mapa.set(r.turno, [{ x: r.ddt as number, y }])
  }
  for (const lista of mapa.values()) lista.sort((a, b) => a.x - b.x)
  return mapa
}

/** Las hojas se editan con las mismas reglas de número que la captura. null = error; devuelve el número o un mensaje. */
export function validarHojas(texto: string | null | undefined): { ok: true; hojas: number } | { ok: false; error: string } {
  const t = String(texto ?? '').trim().replace(',', '.')
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: 'Escribe el número de hojas (ejemplo 27).' }
  const n = Number(t)
  if (n >= 100000) return { ok: false, error: 'El número de hojas es demasiado grande.' }
  return { ok: true, hojas: n }
}
