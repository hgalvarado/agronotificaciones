/**
 * Cifras de la temporada de un motor calculadas en el teléfono (sin señal) a partir de los registros ya bajados. Mismas reglas que
 * fn_mot_resumen_temporada (sql/149): sin anulados; días trabajados = días con horas; rendimiento = gastado ÷ horas de los días con
 * horas; RPM = promedio ponderado por horas de los registros con RPM. Puro: ni React ni red.
 */

import type { CifrasTemporada } from './auditoria'

export type RegistroParaResumen = {
  horas: number
  horas_estimadas?: number | null
  gastado_gal: number
  recibido_gal?: number | null
  rpm?: number | null
  anulado_at?: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function resumirRegistros(registros: RegistroParaResumen[], recibidosEnTanque = 0, mantenimientos?: number): CifrasTemporada {
  let dias = 0
  let horas = 0
  let hest = 0
  let gast = 0
  let sumin = 0
  let hConHoras = 0
  let gConHoras = 0
  let hRpm = 0
  let rpmPorHoras = 0
  for (const r of registros) {
    if (r.anulado_at) continue
    horas += r.horas
    hest += r.horas_estimadas ?? 0
    gast += r.gastado_gal
    sumin += r.recibido_gal ?? 0
    if (r.horas > 0) {
      dias++
      hConHoras += r.horas
      gConHoras += r.gastado_gal
      if (r.rpm !== null && r.rpm !== undefined) {
        hRpm += r.horas
        rpmPorHoras += r.rpm * r.horas
      }
    }
  }
  return {
    dias,
    horas: r2(horas),
    horas_estimadas: r2(hest),
    gal_gastados: r2(gast),
    gal_recibidos: r2(sumin + recibidosEnTanque),
    rendimiento_gal_h: hConHoras > 0 ? r2(gConHoras / hConHoras) : null,
    rpm_prom: hRpm > 0 ? Math.round(rpmPorHoras / hRpm) : null,
    ...(mantenimientos === undefined ? {} : { mantenimientos }),
  }
}
