/**
 * Horas para el próximo mantenimiento (puro). El contador vivo lo mantiene la base (sql/130); aquí solo se cuenta lo
 * que el teléfono todavía no envió, para que el aviso baje aun sin señal. Sin intervalo definido nunca es un error:
 * el motor aparece «sin intervalo».
 */

import type { OperacionPendienteMotor } from './estado'

export type EstadoMant = 'sin_intervalo' | 'al_dia' | 'proximo' | 'vencido'

export function horasParaMantenimiento(m: { intervaloHoras: number | null; horasDesdeMant: number }): number | null {
  if (m.intervaloHoras === null || m.intervaloHoras === undefined || m.intervaloHoras <= 0) return null
  return Math.round((m.intervaloHoras - m.horasDesdeMant) * 100) / 100
}

/** Aviso por defecto: 10 % del intervalo antes del límite. */
export function estadoMantenimiento(m: { intervaloHoras: number | null; avisoHoras: number | null; horasDesdeMant: number }): EstadoMant {
  const faltan = horasParaMantenimiento(m)
  if (faltan === null) return 'sin_intervalo'
  if (faltan <= 0) return 'vencido'
  const aviso = m.avisoHoras !== null && m.avisoHoras !== undefined ? m.avisoHoras : (m.intervaloHoras as number) * 0.1
  return faltan <= aviso ? 'proximo' : 'al_dia'
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Horas desde el último mantenimiento contando lo pendiente de enviar: las horas de los registros diarios en cola
 * suman; un mantenimiento en cola reinicia el contador (solo cuentan los registros posteriores a su día).
 */
export function horasDesdeMantLocal(
  motor: { equipo_id: string; horas_desde_mant: number },
  pendientes: OperacionPendienteMotor[]
): number {
  const propios = pendientes.filter((o) => o.estado_local === 'PENDIENTE' && o.datos.equipo_id === motor.equipo_id)
  const mant = propios
    .filter((o) => o.tipo === 'motor_mantenimiento')
    .map((o) => String(o.datos.fecha_hora ?? '').slice(0, 10))
    .sort()
    .pop()
  let horas = mant ? 0 : motor.horas_desde_mant
  for (const o of propios) {
    if (o.tipo !== 'motor_registro_diario') continue
    if (mant && String(o.datos.fecha ?? '') <= mant) continue
    horas += Math.max(num(o.datos.horo_fin) - num(o.datos.horo_ini), 0)
  }
  return Math.round(horas * 100) / 100
}
