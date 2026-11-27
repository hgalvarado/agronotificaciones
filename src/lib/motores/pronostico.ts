/**
 * Pronóstico de un motor (vista General): para cuántos días le alcanza el diésel del tanque y cuántos días faltan para el
 * mantenimiento, con lo que gastó y trabajó en los últimos 14 días (sql/157 `reciente`). Puro: ni React ni red.
 * Con menos de MIN_DIAS días con registro no se inventa: devuelve null («Sin datos suficientes»).
 */

export const MIN_DIAS = 3

export type Reciente = { dias: number; horas: number; gal: number } | null | undefined

export type EntradaPronostico = {
  reciente?: Reciente
  saldo_gal?: number | null
  tanque_id?: string | null
  intervalo_horas?: number | null
  horas_desde_mant?: number | null
  horas_est_desde_mant?: number | null
}

export type Pronostico = {
  /** Galones por día trabajado (promedio de los últimos 14 días). */
  galDia: number | null
  /** Horas por día trabajado. */
  horasDia: number | null
  /** Días que alcanza el diésel del tanque; null sin tanque o sin datos suficientes. */
  diasCombustible: number | null
  /** Días para el mantenimiento; 0 si ya le toca; null sin intervalo o sin datos suficientes. */
  diasMantenimiento: number | null
  /** Horas que faltan para el mantenimiento (negativo = pasado); null sin intervalo. */
  horasRestantes: number | null
  suficiente: boolean
}

const num = (x: unknown) => (typeof x === 'number' ? x : Number(x ?? NaN))

export function pronosticar(m: EntradaPronostico): Pronostico {
  const r = m.reciente
  const dias = r ? num(r.dias) : 0
  const suficiente = dias >= MIN_DIAS
  const galDia = suficiente && num(r!.gal) > 0 ? num(r!.gal) / dias : null
  const horasDia = suficiente && num(r!.horas) > 0 ? num(r!.horas) / dias : null

  const saldo = m.tanque_id ? num(m.saldo_gal ?? 0) : NaN
  const diasCombustible = galDia && Number.isFinite(saldo) ? Math.max(saldo, 0) / galDia : null

  const intervalo = num(m.intervalo_horas)
  const usadas = num(m.horas_desde_mant ?? 0) + num(m.horas_est_desde_mant ?? 0)
  const horasRestantes = Number.isFinite(intervalo) && intervalo > 0 ? intervalo - usadas : null
  const diasMantenimiento = horasRestantes === null ? null : horasRestantes <= 0 ? 0 : horasDia ? horasRestantes / horasDia : null

  return { galDia, horasDia, diasCombustible, diasMantenimiento, horasRestantes, suficiente }
}

export type OrdenGeneral = 'normal' | 'combustible' | 'mantenimiento'

/** Orden de la lista: los de MENOS días primero; los que no tienen dato van al final. */
export function compararPor(orden: OrdenGeneral, a: Pronostico, b: Pronostico): number {
  if (orden === 'normal') return 0
  const k = orden === 'combustible' ? 'diasCombustible' : 'diasMantenimiento'
  const x = a[k]
  const y = b[k]
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return x - y
}

/** Texto corto: «12 días», «Hoy», «Le toca ya». */
export function textoDias(d: number | null, vencido = 'Le toca ya'): string {
  if (d === null) return 'Sin datos suficientes'
  if (d <= 0) return vencido
  if (d < 1) return 'Menos de 1 día'
  const n = Math.floor(d)
  return `${n} día${n === 1 ? '' : 's'}`
}
