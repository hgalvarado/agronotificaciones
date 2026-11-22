/**
 * AgroMétricas › «Registros de la temporada» › Resumen: lógica PURA (sin React, sin red) que arma, sobre los registros que
 * devuelve fn_agm_mis_registros, lo mismo que el Resumen de AGL (/AM01): tarjetas, mapa de calor turnos × días, líneas contra el
 * DDT y comparación de turnos al mismo DDT. SIN «Normal histórico» ni comparativo con la temporada pasada (todavía no hay rangos).
 * Probado en pruebas/unit/agrometricas_resumen.test.mjs. Fechas AAAA-MM-DD (America/Tegucigalpa; `hoy` llega de lib/fechas/zona).
 * Sin imports de valores a propósito (corre con `node --test` sin compilar).
 */

import type { Registro } from './registrosPura'

export interface MedidaResumen { campo: string; etiqueta: string }
export interface ParametroResumen { clave: string; etiqueta: string; unidad: string; decimales: number; medidas: MedidaResumen[] }

/** Los parámetros que se pueden mirar en el Resumen; la primera medida es la predeterminada. */
export const PARAMETROS_RESUMEN: ParametroResumen[] = [
  { clave: 'ce', etiqueta: 'CE', unidad: 'dS/m', decimales: 2,
    medidas: [{ campo: 'ce_agua', etiqueta: 'Agua' }, { campo: 'ce_gotero', etiqueta: 'Gotero' }, { campo: 'ce_extractor', etiqueta: 'Extractor' }] },
  { clave: 'ph', etiqueta: 'pH', unidad: '', decimales: 2,
    medidas: [{ campo: 'ph_agua', etiqueta: 'Agua' }, { campo: 'ph_gotero', etiqueta: 'Gotero' }, { campo: 'ph_extractor', etiqueta: 'Extractor' }] },
  { clave: 'tensiometros', etiqueta: 'Tensiómetros', unidad: 'cb', decimales: 1,
    medidas: [{ campo: 'tensiometro_12_am', etiqueta: '12 cm AM' }, { campo: 'tensiometro_24_am', etiqueta: '24 cm AM' },
      { campo: 'tensiometro_12_pm', etiqueta: '12 cm PM' }, { campo: 'tensiometro_24_pm', etiqueta: '24 cm PM' }] },
  { clave: 'cloro', etiqueta: 'Cloro', unidad: 'ppm', decimales: 2, medidas: [{ campo: 'cloro_cinta', etiqueta: 'Cinta' }] },
  { clave: 'horas', etiqueta: 'Horas de riego', unidad: 'h', decimales: 1, medidas: [{ campo: 'horas_riego', etiqueta: 'Horas' }] },
  { clave: 'pct', etiqueta: '% de fertilización', unidad: '%', decimales: 1, medidas: [{ campo: 'pct_fertilizacion', etiqueta: '%' }] },
]

export const DIAS_ACTIVO = 14
export const DIAS_SEMANA = 7
export const MAX_DIAS_MAPA = 31
export const MAX_LINEAS = 8
export const MAX_FILAS_MAPA = 40
export const DDT_MAXIMO = 200
export const MAX_PAGINAS_RESUMEN = 10   // 10 × 1000 filas: tope para no colgar un teléfono

export interface FiltrosResumen {
  lotes: string[]
  ciclo: string[]
  zona: string[]
  turno: string[]
  desde: string
  hasta: string
  parametro: string
  medida: string
}
export const FILTROS_RESUMEN_VACIOS: FiltrosResumen = { lotes: [], ciclo: [], zona: [], turno: [], desde: '', hasta: '', parametro: 'ce', medida: '' }

// ---------------------------------------------------------------- fechas (sin zona horaria: AAAA-MM-DD puro)
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/
export function sumarDias(iso: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10)
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** Rango por defecto: los últimos 14 días terminando hoy. */
export function rangoPorDefecto(hoy: string): { desde: string; hasta: string } {
  return { desde: sumarDias(hoy, -(DIAS_ACTIVO - 1)), hasta: hoy }
}

/** Rango efectivo (lo vacío o inválido toma el predeterminado; si vienen al revés se intercambian). */
export function rangoEfectivo(f: Pick<FiltrosResumen, 'desde' | 'hasta'>, hoy: string): { desde: string; hasta: string } {
  const base = rangoPorDefecto(hoy)
  let desde = ES_FECHA.test(f.desde) ? f.desde : base.desde
  let hasta = ES_FECHA.test(f.hasta) ? f.hasta : base.hasta
  if (!f.desde && ES_FECHA.test(f.hasta)) desde = sumarDias(hasta, -(DIAS_ACTIVO - 1))
  if (desde > hasta) [desde, hasta] = [hasta, desde]
  return { desde, hasta }
}

/** «Ciclo-1», «ciclo 1» y «CICLO1» → «Ciclo 1». Si no trae número queda como vino. */
export function etiquetaCiclo(c: string | null | undefined): string {
  const t = String(c ?? '').trim()
  if (!t) return ''
  const n = /(\d+)/.exec(t)
  return n ? `Ciclo ${Number(n[1])}` : t
}

// ---------------------------------------------------------------- consulta
/**
 * Parámetros para fn_agm_mis_registros (una sola consulta por página). Pide desde min(desde, hoy−13) hasta max(hasta, hoy):
 * las tarjetas siempre miran «hoy» y los últimos 14 días; el mapa y las líneas recortan al rango elegido en local.
 * Zona única y lotes los filtra la base; ciclo, varias zonas y turnos se recortan en local (`filtrarResumen`).
 */
export function paramsResumen(f: FiltrosResumen, pagina: number, hoy: string): Record<string, unknown> {
  const r = rangoEfectivo(f, hoy)
  const p: Record<string, unknown> = {
    limite: 1000, pagina, orden: 'asc',
    desde: r.desde < sumarDias(hoy, -(DIAS_ACTIVO - 1)) ? r.desde : sumarDias(hoy, -(DIAS_ACTIVO - 1)),
    hasta: r.hasta > hoy ? r.hasta : hoy,
  }
  if (f.zona.length === 1) p.zona_id = f.zona[0]
  if (f.lotes.length) p.lotes = f.lotes
  return p
}

/** Recorte local de ciclo, zonas y turnos (listas vacías = todos). */
export function filtrarResumen(registros: Registro[], f: Pick<FiltrosResumen, 'ciclo' | 'zona' | 'turno'>): Registro[] {
  return registros.filter((r) =>
    (!f.ciclo.length || f.ciclo.includes(etiquetaCiclo(r.ciclo))) &&
    (!f.zona.length || (r.zona_id !== null && f.zona.includes(r.zona_id))) &&
    (!f.turno.length || f.turno.includes(r.turno)))
}

// ---------------------------------------------------------------- utilidades
const num = (r: Record<string, unknown>, campo: string): number | null => {
  const v = r[campo]
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const redondear = (v: number, d: number) => { const f = 10 ** d; return Math.round(v * f) / f }
const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

export function parametroDe(clave: string): ParametroResumen {
  return PARAMETROS_RESUMEN.find((p) => p.clave === clave) ?? PARAMETROS_RESUMEN[0]
}
/** Campo de la medida elegida (o el predeterminado del parámetro si no es de ese parámetro). */
export function campoDe(parametro: string, medida: string): string {
  const p = parametroDe(parametro)
  return p.medidas.some((m) => m.campo === medida) ? medida : p.medidas[0].campo
}

/** «Marcas bonitas» del eje: ~n valores con paso 1/2/5 × 10^k que cubren [min, max]. */
export function marcasEje(min: number, max: number, n = 5): number[] {
  if (!(max > min)) max = min + 1
  const bruto = (max - min) / Math.max(1, n)
  const pot = 10 ** Math.floor(Math.log10(bruto))
  const paso = [1, 2, 5, 10].map((f) => f * pot).find((p) => p >= bruto) ?? 10 * pot
  const ini = Math.floor(min / paso) * paso
  const marcas: number[] = []
  for (let k = 0; k < 1000; k++) {
    const v = Math.round((ini / paso + k) * 1e6) / 1e6 * paso
    marcas.push(redondear(v, 6))
    if (v >= max - paso * 0.001) break
  }
  return marcas
}

// ---------------------------------------------------------------- resumen
export interface TurnoCatalogo { turno: string; zona: string; ciclo: string; ultimo: string; ddt_actual: number | null }
export interface Tarjetas {
  turnos_activos: number
  con_registro_hoy: number
  sin_registro_hoy: { turno: string; zona: string; ultimo: string }[]
  registros_semana: number
}
export interface CeldaMapa { v: number | null; ddt: number | null; fuera: boolean; estado: 'valor' | 'sin_medida' | 'sin_registro' }
export interface FilaMapa { turno: string; zona: string; celdas: CeldaMapa[] }
export interface SerieLinea { turno: string; zona: string; puntos: [number, number][] }
export interface BarraDdt { turno: string; zona: string; valor: number }
export interface Resumen {
  hoy: string
  campo: string
  tarjetas: Tarjetas
  mapa: { dias: string[]; filas: FilaMapa[]; recortadas: number }
  lineas: SerieLinea[]
  comparacion: { ddt: number | null; barras: BarraDdt[] }
  catalogo: TurnoCatalogo[]
}

const esParametro = (r: Registro) => !r.solo_horas

/**
 * Todo lo del Resumen en una pasada. `registros` ya viene recortado por `filtrarResumen`. `turnos` (selector) restringe el mapa,
 * las líneas y la comparación; las tarjetas miran siempre todos los turnos filtrados. «Registro» = fila de parámetros (un día con solo
 * horas de riego no cuenta como registro del parametrista, pero sí aparece en el mapa/líneas de Horas y % de fertilización).
 */
export function armarResumen(
  registros: Registro[],
  o: { hoy: string; desde: string; hasta: string; parametro: string; medida: string; turnos?: string[]; ddtComparar?: number | null },
): Resumen {
  const campo = campoDe(o.parametro, o.medida)
  const par = parametroDe(o.parametro)
  const dec = par.decimales
  const elegidos = (o.turnos ?? []).slice()

  // Catálogo (para selectores): por turno, zona, ciclo, último registro y DDT actual
  const porTurno = new Map<string, Registro[]>()
  for (const r of registros) { const l = porTurno.get(r.turno); if (l) l.push(r); else porTurno.set(r.turno, [r]) }
  const zonaDe = (t: string) => String(porTurno.get(t)?.[0]?.zona ?? '')
  const catalogo: TurnoCatalogo[] = [...porTurno.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([turno, rs]) => {
    const ord = rs.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
    const ultimo = ord[ord.length - 1]
    const conParam = ord.filter(esParametro)
    return {
      turno, zona: String(ord[0].zona ?? ''), ciclo: etiquetaCiclo(ord[0].ciclo),
      ultimo: (conParam.length ? conParam[conParam.length - 1] : ultimo).fecha,
      ddt_actual: ultimo.ddt === null || ultimo.ddt === undefined ? null : Math.round(Number(ultimo.ddt)),
    }
  })

  // Tarjetas
  const inicioActivo = sumarDias(o.hoy, -(DIAS_ACTIVO - 1))
  const inicioSemana = sumarDias(o.hoy, -(DIAS_SEMANA - 1))
  const params = registros.filter(esParametro)
  const activos = new Set(params.filter((r) => r.fecha >= inicioActivo && r.fecha <= o.hoy).map((r) => r.turno))
  const conHoy = new Set(params.filter((r) => r.fecha === o.hoy).map((r) => r.turno))
  const sinHoy = [...activos].filter((t) => !conHoy.has(t)).sort().map((turno) => ({
    turno, zona: zonaDe(turno), ultimo: catalogo.find((c) => c.turno === turno)?.ultimo ?? '' }))
  const tarjetas: Tarjetas = {
    turnos_activos: activos.size, con_registro_hoy: conHoy.size, sin_registro_hoy: sinHoy,
    registros_semana: params.filter((r) => r.fecha >= inicioSemana && r.fecha <= o.hoy).length,
  }

  // Mapa de calor: días del rango (máximo 31, los últimos) × turnos
  const largo = Math.min(MAX_DIAS_MAPA, Math.max(1, diasEntre(o.desde, o.hasta) + 1))
  const dias = Array.from({ length: largo }, (_, i) => sumarDias(o.hasta, i - (largo - 1)))
  const enVentana = registros.filter((r) => r.fecha >= dias[0] && r.fecha <= dias[dias.length - 1])
  const candidatos = (elegidos.length ? elegidos : [...new Set(enVentana.map((r) => r.turno))]).sort()
  const filas: FilaMapa[] = candidatos.slice(0, MAX_FILAS_MAPA).map((turno) => ({
    turno, zona: zonaDe(turno),
    celdas: dias.map((d): CeldaMapa => {
      const del = enVentana.filter((r) => r.turno === turno && r.fecha === d)
      if (!del.length) return { v: null, ddt: null, fuera: false, estado: 'sin_registro' }
      const vals = del.map((r) => num(r, campo)).filter((x): x is number => x !== null)
      if (!vals.length) return { v: null, ddt: null, fuera: false, estado: 'sin_medida' }
      const ddts = del.map((r) => num(r, 'ddt')).filter((x): x is number => x !== null)
      return { v: redondear(media(vals), dec), ddt: ddts.length ? Math.round(media(ddts)) : null,
        fuera: del.some((r) => (r.fuera_rango ?? []).includes(campo)), estado: 'valor' }
    }),
  }))

  // Líneas contra el DDT (dentro del rango elegido)
  const validas = registros.filter((r) => r.fecha >= o.desde && r.fecha <= o.hasta && num(r, campo) !== null
    && num(r, 'ddt') !== null && (num(r, 'ddt') as number) >= 0 && (num(r, 'ddt') as number) <= DDT_MAXIMO)
  let turnosLinea: string[]
  if (elegidos.length) turnosLinea = elegidos.slice().sort()
  else {
    const ultimo = new Map<string, string>()
    for (const r of validas) if ((ultimo.get(r.turno) ?? '') < r.fecha) ultimo.set(r.turno, r.fecha)
    turnosLinea = [...ultimo.entries()].sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : a[0].localeCompare(b[0]))).slice(0, MAX_LINEAS).map((x) => x[0]).sort()
  }
  const lineas: SerieLinea[] = []
  for (const turno of turnosLinea.slice(0, MAX_LINEAS * 2)) {
    const porDdt = new Map<number, number[]>()
    for (const r of validas) if (r.turno === turno) {
      const d = Math.round(num(r, 'ddt') as number)
      const l = porDdt.get(d); const v = num(r, campo) as number
      if (l) l.push(v); else porDdt.set(d, [v])
    }
    if (!porDdt.size) continue
    lineas.push({ turno, zona: zonaDe(turno), puntos: [...porDdt.entries()].sort((a, b) => a[0] - b[0]).map(([d, vs]) => [d, redondear(media(vs), dec)] as [number, number]) })
  }

  // Comparación de turnos al mismo DDT (el valor más cercano a ±1 día de DDT; mayor a menor)
  let ddtComparar = o.ddtComparar ?? null
  const candComp = validas.filter((r) => !elegidos.length || elegidos.includes(r.turno))
    .map((r) => ({ turno: r.turno, d: Math.round(num(r, 'ddt') as number), v: num(r, campo) as number, fecha: r.fecha }))
  if (ddtComparar === null && candComp.length) {
    const turnosPorDdt = new Map<number, Set<string>>()
    for (const c of candComp) { const s = turnosPorDdt.get(c.d); if (s) s.add(c.turno); else turnosPorDdt.set(c.d, new Set([c.turno])) }
    const conDos = [...turnosPorDdt.entries()].filter(([, s]) => s.size >= 2).map(([d]) => d)
    ddtComparar = conDos.length ? Math.max(...conDos) : Math.max(...turnosPorDdt.keys())
  }
  const barras: BarraDdt[] = []
  if (ddtComparar !== null) {
    const objetivo = ddtComparar
    for (const turno of new Set(candComp.map((c) => c.turno))) {
      const cerca = candComp.filter((c) => c.turno === turno && Math.abs(c.d - objetivo) <= 1)
      if (!cerca.length) continue
      const dist = Math.min(...cerca.map((c) => Math.abs(c.d - objetivo)))
      barras.push({ turno, zona: zonaDe(turno), valor: redondear(media(cerca.filter((c) => Math.abs(c.d - objetivo) === dist).map((c) => c.v)), dec) })
    }
    barras.sort((a, b) => b.valor - a.valor || a.turno.localeCompare(b.turno))
  }

  return {
    hoy: o.hoy, campo, tarjetas,
    mapa: { dias, filas, recortadas: Math.max(0, candidatos.length - MAX_FILAS_MAPA) },
    lineas, comparacion: { ddt: ddtComparar, barras }, catalogo,
  }
}
