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
  /** Horas ESTIMADAS (horómetro dañado o sin lectura, con consumo): no tocan el horómetro; sirven al mantenimiento y al total proyectado. */
  horasEst: number | null
  visorIni: number
  visorFin: number
  gastado: number
  rendimiento: number | null
  rpm: number | null
  suministro: number
  caudalIni: number | null
  caudalFin: number | null
  /** Quien entregó el combustible ese día (firma de la hoja, junto a Suministro); vacío si no hubo suministro. */
  operador: string | null
  /** Peor señal del día: 'rojo' | 'amarillo' | null. */
  senal: 'rojo' | 'amarillo' | null
  /** Día en que solo se recibió combustible (sin registro de horas): la hoja muestra solo el suministro. */
  soloSuministro?: boolean
}

export type EntradaFila = {
  id: string
  fecha: string
  horo_ini: number
  horo_fin: number
  horas: number
  horas_estimadas?: number | null
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
    horasEst: r.horas_estimadas ?? null,
    visorIni: r.visor_ini,
    visorFin: r.visor_fin,
    gastado: r.gastado_gal,
    rendimiento: r.rendimiento_gal_h,
    rpm: r.rpm,
    suministro: r.recibido_gal,
    caudalIni: r.caudal_ini,
    caudalFin: r.caudal_fin,
    operador: null,
    senal,
  }
}

export type SuministroDia = { id: string; dia: string; galones: number; /** Quien entregó el combustible (chofer): es la «firma» de la hoja, junto a Suministro. */ entrego?: string | null }

/**
 * Sin anulados, dentro del rango (inclusive; vacío = sin límite) y en orden de la hoja: del más antiguo al más reciente.
 * `suministros` = lo recibido en el tanque del motor (ya sin anuladas, con su día local): llena la columna «Sum.» del día y,
 * si ese día no hubo registro de horas, agrega una fila solo con el suministro (igual que se anota en la hoja de campo).
 */
export function filasDeHoja(
  registros: (EntradaFila & { equipo_id?: string })[],
  f: { equipoId?: string; desde?: string; hasta?: string },
  senales?: Map<string, { nivel: string }[]>,
  suministros: SuministroDia[] = []
): FilaHoja[] {
  const enRango = (d: string) => (!f.desde || d >= f.desde) && (!f.hasta || d <= f.hasta)
  const porDia = new Map<string, number>()
  const entregoDe = new Map<string, string[]>()
  for (const x of suministros) {
    if (!enRango(x.dia)) continue
    porDia.set(x.dia, (porDia.get(x.dia) ?? 0) + x.galones)
    const n = (x.entrego ?? '').trim()
    if (n) entregoDe.set(x.dia, [...new Set([...(entregoDe.get(x.dia) ?? []), n])])
  }
  const firma = (dia: string) => entregoDe.get(dia)?.join(' / ') ?? null
  const filas = registros
    .filter((r) => !r.anulado_at && (!f.equipoId || r.equipo_id === f.equipoId) && enRango(r.fecha))
    .map((r) => {
      const fila = aFilaHoja(r, senales?.get(r.id) ?? [])
      return { ...fila, suministro: Math.max(fila.suministro, porDia.get(r.fecha) ?? 0), operador: firma(r.fecha) }
    })
  const conRegistro = new Set(filas.map((x) => x.fecha))
  for (const [dia, gal] of porDia) {
    if (conRegistro.has(dia)) continue
    filas.push({ id: `s${dia}`, fecha: dia, horoIni: 0, horoFin: 0, horas: 0, horasEst: null, visorIni: 0, visorFin: 0, gastado: 0, rendimiento: null, rpm: null, suministro: gal, caudalIni: null, caudalFin: null, operador: firma(dia), senal: null, soloSuministro: true })
  }
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha))
}

export type TotalesHoja = { dias: number; horas: number; /** Horas estimadas del periodo. */ horasEst: number; /** Horas del horómetro + estimadas = horas proyectadas. */ horasProy: number; gastado: number; suministro: number; rendimiento: number | null }

const r2 = (n: number) => Math.round(n * 100) / 100

/** Totales al pie. El rendimiento medio = galones ÷ horas de los días que trabajaron (no el promedio de promedios). */
export function totalesHoja(todas: FilaHoja[]): TotalesHoja {
  const filas = todas.filter((x) => !x.soloSuministro)
  const horas = filas.reduce((s, f) => s + f.horas, 0)
  const gastado = filas.reduce((s, f) => s + f.gastado, 0)
  const horasEst = filas.reduce((s, f) => s + (f.horasEst ?? 0), 0)
  const suministro = todas.reduce((s, f) => s + f.suministro, 0)
  const conHoras = filas.filter((f) => f.horas > 0)
  const hTrab = conHoras.reduce((s, f) => s + f.horas, 0)
  const gTrab = conHoras.reduce((s, f) => s + f.gastado, 0)
  return { dias: filas.length, horas: r2(horas), horasEst: r2(horasEst), horasProy: r2(horas + horasEst), gastado: r2(gastado), suministro: r2(suministro), rendimiento: hTrab > 0 ? r2(gTrab / hTrab) : null }
}

/** Número corto para la hoja: sin separador de miles ni ceros de más; vacío = «—». */
export function numHoja(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return String(Math.round(v * 10 ** dec) / 10 ** dec)
}

export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
export const ddmmaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`
