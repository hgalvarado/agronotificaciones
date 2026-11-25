/**
 * Indicadores visuales de Motores (puro, sin React ni importaciones): el medidor del tanque («E ··· F») y la barra del
 * mantenimiento (horas desde el último / intervalo). Aquí solo se calculan porcentajes, zonas y el texto corto; el dibujo
 * está en MedidorTanque.tsx y BarraMantenimiento.tsx.
 */

export type ZonaIndicador = 'rojo' | 'amarillo' | 'verde' | 'gris'

const r1 = (n: number) => Math.round(n * 10) / 10
const sinCeros = (n: number) => String(r1(n))
const acotar = (n: number) => Math.max(0, Math.min(100, n))

// ---------------------------------------------------------------- medidor del tanque

/** Porcentaje lleno (0–100) y zona: vacío = rojo, ≤15 % = ámbar (igual que el semáforo del tanque). Sin capacidad no hay porcentaje. */
export function medidorTanque(saldo: number | null, capacidad: number | null): { pct: number | null; zona: ZonaIndicador } {
  if (saldo === null || saldo === undefined) return { pct: null, zona: 'gris' }
  if (!capacidad || capacidad <= 0) return { pct: null, zona: saldo <= 0 ? 'rojo' : 'gris' }
  const pct = Math.round(acotar((saldo * 100) / capacidad))
  const zona: ZonaIndicador = saldo <= 0 ? 'rojo' : pct <= 15 ? 'amarillo' : 'verde'
  return { pct, zona }
}

/** Punto del arco (centro 50,50; radio r; E a la izquierda, F a la derecha) para un porcentaje. */
export function puntoArco(pct: number, r: number): { x: number; y: number } {
  const ang = Math.PI * (1 - acotar(pct) / 100)
  return { x: Math.round((50 + r * Math.cos(ang)) * 100) / 100, y: Math.round((50 - r * Math.sin(ang)) * 100) / 100 }
}

/** Trazo SVG del arco relleno de E hasta `pct`. */
export function trazoArco(pct: number, r: number): string {
  const a = puntoArco(0, r)
  const b = puntoArco(pct, r)
  return `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`
}

// ---------------------------------------------------------------- barra del mantenimiento

export type BarraMant = {
  sinIntervalo: boolean
  /** Lo trabajado (real + estimado) sobre el intervalo, 0–100. */
  pct: number
  /** Dónde empieza lo estimado dentro de la barra, 0–100 (= pct si no hay estimadas). */
  pctReal: number
  /** Dónde empieza la zona ámbar (intervalo − aviso), 0–100. */
  pctAviso: number
  zona: ZonaIndicador
  faltan: number | null
  /** «faltan 16 h» · «vencido 19 h» · «sin intervalo». */
  texto: string
}

export function barraMantenimiento(m: { horas: number; estimadas?: number; intervalo: number | null; aviso?: number | null }): BarraMant {
  const intervalo = m.intervalo
  if (intervalo === null || intervalo === undefined || intervalo <= 0) {
    return { sinIntervalo: true, pct: 0, pctReal: 0, pctAviso: 100, zona: 'gris', faltan: null, texto: 'sin intervalo' }
  }
  const est = Math.max(m.estimadas ?? 0, 0)
  const aviso = m.aviso === null || m.aviso === undefined ? Math.round(intervalo * 0.1) : m.aviso
  const faltan = Math.round((intervalo - m.horas) * 100) / 100
  const pct = acotar((m.horas * 100) / intervalo)
  const pctReal = acotar((Math.max(m.horas - est, 0) * 100) / intervalo)
  const pctAviso = acotar(((intervalo - aviso) * 100) / intervalo)
  const zona: ZonaIndicador = faltan <= 0 ? 'rojo' : faltan <= aviso ? 'amarillo' : 'verde'
  return { sinIntervalo: false, pct, pctReal, pctAviso, zona, faltan, texto: faltan <= 0 ? `vencido ${sinCeros(-faltan)} h` : `faltan ${sinCeros(faltan)} h` }
}
