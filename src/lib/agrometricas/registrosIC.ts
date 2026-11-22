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

// ---------------------------------------------------------------- resumen que «dice algo» (gráficas del IC)

export const VENTANA_IC = { min: 5, max: 20 }
export interface PlanPunto { ddt: number; ic_plan: number }

/** IC del plan en un DDT: el de la tabla si existe; si no, interpola entre los dos DDT vecinos. null si no hay con qué. */
export function planEnDdt(plan: PlanPunto[], ddt: number): number | null {
  if (!plan.length) return null
  const orden = plan.slice().sort((a, b) => a.ddt - b.ddt)
  const exacto = orden.find((p) => p.ddt === ddt)
  if (exacto) return exacto.ic_plan
  const antes = orden.filter((p) => p.ddt < ddt).pop(), despues = orden.find((p) => p.ddt > ddt)
  if (!antes || !despues) return null
  const f = (ddt - antes.ddt) / (despues.ddt - antes.ddt)
  return Math.round((antes.ic_plan + f * (despues.ic_plan - antes.ic_plan)) * 10 ** 4) / 10 ** 4
}

export type Tendencia = 'sube' | 'baja' | 'igual'
export interface ResumenTurnoIC {
  turno: string
  n: number
  /** Último registro con IC real y DDT (el de mayor DDT). */
  ddt: number | null
  fecha: string | null
  real: number | null
  plan: number | null
  /** IC real como % del plan (100 = va justo en el plan). */
  pct: number | null
  dif: number | null
  tendencia: Tendencia | null
  fueraVentana: number
  frase: string
}

/** Resumen de UN turno: dónde va el IC hoy contra el plan y hacia dónde se mueve. */
export function resumenTurnoIC(registros: Registro[], plan: PlanPunto[] = []): ResumenTurnoIC {
  const turno = registros[0]?.turno ?? ''
  const conIC = registros.filter((r) => r.ddt !== null && r.ddt !== undefined && valorNumero(r, 'ic_real') !== null)
    .slice().sort((a, b) => (a.ddt as number) - (b.ddt as number))
  const fueraVentana = registros.filter((r) => r.ddt != null && ((r.ddt as number) < VENTANA_IC.min || (r.ddt as number) > VENTANA_IC.max)).length
  const base = { turno, n: registros.length, fueraVentana }
  const ult = conIC[conIC.length - 1]
  if (!ult) return { ...base, ddt: null, fecha: null, real: null, plan: null, pct: null, dif: null, tendencia: null, frase: `${turno}: todavía no hay IC con DDT para comparar.` }
  const real = valorNumero(ult, 'ic_real') as number
  const planUlt = valorNumero(ult, 'ic_plan') ?? planEnDdt(plan, ult.ddt as number)
  const pct = planUlt && planUlt > 0 ? Math.round((real / planUlt) * 100) : null
  const dif = planUlt === null ? null : Math.round((real - planUlt) * 10 ** DECIMALES_IC) / 10 ** DECIMALES_IC
  let tendencia: Tendencia | null = null
  if (conIC.length > 1) {
    const d = real - (valorNumero(conIC[conIC.length - 2], 'ic_real') as number)
    tendencia = Math.abs(d) < 0.005 ? 'igual' : d > 0 ? 'sube' : 'baja'
  }
  let frase: string
  if (pct === null) frase = `${turno}: IC real ${textoIC(real)} en el DDT ${ult.ddt}; no hay plan para ese DDT.`
  else if (pct >= 100) frase = `${turno} va al ${pct} % del plan en el DDT ${ult.ddt}: ${pct === 100 ? 'justo en el plan' : `por encima del plan (+${textoIC(dif)})`}.`
  else frase = `${turno} va al ${pct} % del plan en el DDT ${ult.ddt}: por debajo del plan (${textoIC(dif)}).`
  if (tendencia === 'sube') frase += ' Está subiendo.'
  else if (tendencia === 'baja') frase += ' Bajó desde la lectura anterior.'
  return { ...base, ddt: ult.ddt as number, fecha: ult.fecha, real, plan: planUlt, pct, dif, tendencia, frase }
}

/** Resumen de varios turnos, del más atrasado (menor % del plan) al más adelantado; sin dato al final. */
export function resumenPorTurno(registros: Registro[], turnos: string[], plan: PlanPunto[] = []): ResumenTurnoIC[] {
  return turnos.map((t) => resumenTurnoIC(registros.filter((r) => r.turno === t), plan))
    .sort((a, b) => (a.pct ?? Infinity) - (b.pct ?? Infinity) || a.turno.localeCompare(b.turno))
}
