/**
 * Horas de riego de un turno en un día (la «bitácora de riego»): los datos del formulario y su validación.
 * Los comparten el formulario de Horas (FormBitacora) y el de Aplicar (FormAplicacion, sección «Horas de riego»),
 * para que las dos pantallas pidan y validen exactamente lo mismo.
 */

import { aEntradaLocal, deEntradaLocal } from '@/lib/fechas/zona'
import type { BitacoraRiego } from './tipos'

/** Todo en texto, tal como lo escribe la persona. */
export type DatosHoras = {
  hf: string
  hr: string
  inicio: string
  fin: string
  ppmCabezal: string
  ppmCampo: string
  pct: string
}

export const HORAS_VACIAS: DatosHoras = { hf: '', hr: '', inicio: '', fin: '', ppmCabezal: '', ppmCampo: '', pct: '' }

/** Lo ya registrado ese día (si hay), para continuar donde se quedó. */
export function horasDesde(actual: BitacoraRiego | null | undefined): DatosHoras {
  return {
    hf: actual?.horas_fertilizacion?.toString() ?? '',
    hr: actual?.horas_riego?.toString() ?? '',
    inicio: aEntradaLocal(actual?.hora_inicio),
    fin: aEntradaLocal(actual?.hora_fin),
    ppmCabezal: actual?.ppm_cloro_cabezal?.toString() ?? '',
    ppmCampo: actual?.ppm_cloro_campo?.toString() ?? '',
    pct: actual?.pct_fertilizacion?.toString() ?? '',
  }
}

const numero = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

/** ¿Escribió algo? (lo que viene de lo ya registrado no cuenta: se compara con `base`). */
export function horasCambiadas(d: DatosHoras, base: DatosHoras): boolean {
  return (Object.keys(d) as (keyof DatosHoras)[]).some((k) => d[k].trim() !== base[k].trim())
}

export type DatosBase = {
  estacion_id: string
  turno_ciclo_id: string
  fecha: string
  ejecutor_id: string | null
  ejecutor2_id: string | null
}

/**
 * Valida y arma los datos de la operación `bitacora`.
 *   - `{ error }`: algo no es válido (texto para mostrar).
 *   - `{ vacio: true }`: no escribió nada.
 *   - `{ datos }`: listo para `crearOperacion('bitacora', datos, …)`.
 */
export function armarBitacora(d: DatosHoras, base: DatosBase): { error: string } | { vacio: true } | { datos: Record<string, unknown> } {
  const vhf = numero(d.hf)
  const vhr = numero(d.hr)
  for (const [n, v] of [['de fertilización', vhf], ['de riego', vhr]] as const) {
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 24)) return { error: `Las horas ${n} deben estar entre 0 y 24.` }
  }
  const vCab = numero(d.ppmCabezal)
  const vCampo = numero(d.ppmCampo)
  for (const [n, v] of [['del cabezal', vCab], ['del campo', vCampo]] as const) {
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1000)) return { error: `Las ppm de cloro ${n} deben estar entre 0 y 1000.` }
  }
  const vPct = numero(d.pct)
  if (vPct !== null && (!Number.isFinite(vPct) || vPct < 0)) return { error: 'El % de fertilización debe ser un número igual o mayor que 0.' }
  const ini = d.inicio ? deEntradaLocal(d.inicio) : null
  const fi = d.fin ? deEntradaLocal(d.fin) : null
  if (ini && fi && fi < ini) return { error: 'La hora final no puede ser anterior a la inicial.' }
  if (vhf === null && vhr === null && !ini && !fi && vCab === null && vCampo === null && vPct === null) return { vacio: true }
  const datos: Record<string, unknown> = {
    ...base,
    horas_fertilizacion: vhf,
    horas_riego: vhr,
    hora_inicio: ini,
    hora_fin: fi,
  }
  // Solo si se escribieron (lo vacío no borra lo que ya estaba; la base sin la 99 no los conoce)
  if (vCab !== null) datos.ppm_cloro_cabezal = vCab
  if (vCampo !== null) datos.ppm_cloro_campo = vCampo
  if (vPct !== null) datos.pct_fertilizacion = vPct
  return { datos }
}
