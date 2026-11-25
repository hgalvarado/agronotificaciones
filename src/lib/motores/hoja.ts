/**
 * Historial de un motor en el FORMATO DE CAMPO (hoja FTR_F-MA-103): una fila por día con las columnas de la hoja, los totales
 * y el filtro por fechas. Puro (sin React, red ni importaciones de valores) para que las pruebas con Node lo carguen suelto.
 */

export type FilaHoja = {
  id: string
  fecha: string
  horoIni: number
  horoFin: number
  horas: number
  visorIni: number
  visorFin: number
  gastado: number
  rendimiento: number | null
  rpm: number | null
  suministro: number
  caudalIni: number | null
  caudalFin: number | null
  operador: string | null
  /** Peor señal del día: 'rojo' | 'amarillo' | null. */
  senal: 'rojo' | 'amarillo' | null
}

export type EntradaFila = {
  id: string
  fecha: string
  horo_ini: number
  horo_fin: number
  horas: number
  visor_ini: number
  visor_fin: number
  gastado_gal: number
  rendimiento_gal_h: number | null
  rpm: number | null
  recibido_gal: number
  caudal_ini: number | null
  caudal_fin: number | null
  operador: string | null
  anulado_at: string | null
}

/** Una fila de la hoja a partir de un registro y sus señales (la «info» no cuenta). */
export function aFilaHoja(r: EntradaFila, senales: { nivel: string }[] = []): FilaHoja {
  const senal = senales.some((s) => s.nivel === 'rojo') ? 'rojo' : senales.some((s) => s.nivel === 'amarillo') ? 'amarillo' : null
  return {
    id: r.id,
    fecha: r.fecha,
    horoIni: r.horo_ini,
    horoFin: r.horo_fin,
    horas: r.horas,
    visorIni: r.visor_ini,
    visorFin: r.visor_fin,
    gastado: r.gastado_gal,
    rendimiento: r.rendimiento_gal_h,
    rpm: r.rpm,
    suministro: r.recibido_gal,
    caudalIni: r.caudal_ini,
    caudalFin: r.caudal_fin,
    operador: r.operador,
    senal,
  }
}

/** Sin anulados, dentro del rango (inclusive; vacío = sin límite) y en orden de la hoja: del más antiguo al más reciente. */
export function filasDeHoja(
  registros: (EntradaFila & { equipo_id?: string })[],
  f: { equipoId?: string; desde?: string; hasta?: string },
  senales?: Map<string, { nivel: string }[]>
): FilaHoja[] {
  return registros
    .filter((r) => !r.anulado_at && (!f.equipoId || r.equipo_id === f.equipoId) && (!f.desde || r.fecha >= f.desde) && (!f.hasta || r.fecha <= f.hasta))
    .map((r) => aFilaHoja(r, senales?.get(r.id) ?? []))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
}

export type TotalesHoja = { dias: number; horas: number; gastado: number; suministro: number; rendimiento: number | null }

const r2 = (n: number) => Math.round(n * 100) / 100

/** Totales al pie. El rendimiento medio = galones ÷ horas de los días que trabajaron (no el promedio de promedios). */
export function totalesHoja(filas: FilaHoja[]): TotalesHoja {
  const horas = filas.reduce((s, f) => s + f.horas, 0)
  const gastado = filas.reduce((s, f) => s + f.gastado, 0)
  const suministro = filas.reduce((s, f) => s + f.suministro, 0)
  const conHoras = filas.filter((f) => f.horas > 0)
  const hTrab = conHoras.reduce((s, f) => s + f.horas, 0)
  const gTrab = conHoras.reduce((s, f) => s + f.gastado, 0)
  return { dias: filas.length, horas: r2(horas), gastado: r2(gastado), suministro: r2(suministro), rendimiento: hTrab > 0 ? r2(gTrab / hTrab) : null }
}

/** Número corto para la hoja: sin separador de miles ni ceros de más; vacío = «—». */
export function numHoja(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return String(Math.round(v * 10 ** dec) / 10 ** dec)
}

export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
export const ddmmaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`
