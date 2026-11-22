/**
 * AgroMétricas › «Registros de la temporada»: lógica PURA (sin React, sin red). La pantalla pide a la base
 * `fn_agm_mis_registros` y aquí se agrupa por día, se arman las series por DDT, se valida la edición y el motivo de
 * eliminar. Probado en pruebas/unit/agrometricas_registros.test.mjs. Fechas AAAA-MM-DD (America/Tegucigalpa).
 * Sin imports a propósito: así corre con `node --test` sin compilar.
 */

export interface LoteRegistro { lote: string; nombre: string | null }

/** Un registro tal como lo devuelve fn_agm_mis_registros (la base ya decidió si lo ve, lo edita o lo elimina). */
export interface Registro {
  id: string
  fecha: string
  ddt: number | null
  turno: string
  temporada: string | null
  ciclo: string | null
  estacion: string | null
  zona_id: string | null
  zona: string | null
  lotes: LoteRegistro[]
  fuera_rango: string[]
  comentario: string | null
  puede_editar: boolean
  puede_eliminar: boolean
  [campo: string]: unknown
}

/** Un parámetro clave = una idea = una gráfica; `campos` son sus series. */
export interface GrupoParametro {
  clave: 'ce' | 'ph' | 'tensiometros' | 'cloro' | 'horas'
  etiqueta: string
  unidad: string
  decimales: number
  campos: { clave: string; etiqueta: string }[]
}

export const GRUPOS: GrupoParametro[] = [
  { clave: 'ce', etiqueta: 'CE', unidad: 'dS/m', decimales: 2,
    campos: [{ clave: 'ce_agua', etiqueta: 'Agua' }, { clave: 'ce_gotero', etiqueta: 'Gotero' }, { clave: 'ce_extractor', etiqueta: 'Extractor' }] },
  { clave: 'ph', etiqueta: 'pH', unidad: '', decimales: 2,
    campos: [{ clave: 'ph_agua', etiqueta: 'Agua' }, { clave: 'ph_gotero', etiqueta: 'Gotero' }, { clave: 'ph_extractor', etiqueta: 'Extractor' }] },
  { clave: 'tensiometros', etiqueta: 'Tensiómetros', unidad: 'cb', decimales: 1,
    campos: [{ clave: 'tensiometro_12_am', etiqueta: '12 cm AM' }, { clave: 'tensiometro_24_am', etiqueta: '24 cm AM' },
      { clave: 'tensiometro_12_pm', etiqueta: '12 cm PM' }, { clave: 'tensiometro_24_pm', etiqueta: '24 cm PM' }] },
  { clave: 'cloro', etiqueta: 'Cloro', unidad: 'ppm', decimales: 2, campos: [{ clave: 'cloro_cinta', etiqueta: 'Cinta' }] },
  // Las horas de riego salen de Fertirriego › Horas; si la fila las trae (`horas_riego`) se muestran, si no queda «—»
  { clave: 'horas', etiqueta: 'Horas de riego', unidad: 'h', decimales: 1, campos: [{ clave: 'horas_riego', etiqueta: 'Horas' }] },
]

/** Columnas de valores que se pueden editar (las mismas que acepta fn_agm_editar_parametro). */
export const CAMPOS_EDITABLES = [
  'tensiometro_12_am', 'tensiometro_24_am', 'tensiometro_12_pm', 'tensiometro_24_pm',
  'ce_agua', 'ph_agua', 'ce_gotero', 'ph_gotero', 'ce_extractor', 'ph_extractor', 'cloro_cinta',
  'ce_suelo_antes', 'ce_suelo_despues',
]

/** Número de una celda de la fila; null si está vacío o no es número. */
export function valorNumero(reg: Record<string, unknown>, campo: string): number | null {
  const v = reg[campo]
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Valor único de un grupo (promedio de los campos con dato) para tarjetas y sparklines. null si no hay ninguno. */
export function valorGrupo(reg: Record<string, unknown>, grupo: GrupoParametro): number | null {
  const v = grupo.campos.map((c) => valorNumero(reg, c.clave)).filter((x): x is number => x !== null)
  if (!v.length) return null
  const m = v.reduce((a, b) => a + b, 0) / v.length
  const f = 10 ** grupo.decimales
  return Math.round(m * f) / f
}

/** ¿Algún campo del grupo quedó fuera de rango al guardar? */
export function grupoFuera(reg: Pick<Registro, 'fuera_rango'>, grupo: GrupoParametro): boolean {
  const fuera = reg.fuera_rango ?? []
  return grupo.campos.some((c) => fuera.includes(c.clave))
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** «Hoy», «Ayer» o «sáb 15/11/2026». `hoy` y `ayer` llegan de lib/fechas/zona (UTC-6). */
export function etiquetaDia(dia: string, hoy: string, ayer: string): string {
  if (dia === hoy) return 'Hoy'
  if (dia === ayer) return 'Ayer'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia)
  if (!m) return dia
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return `${DIAS[d.getUTCDay()]} ${m[3]}/${m[2]}/${m[1]}`
}

export interface GrupoDia { dia: string; etiqueta: string; registros: Registro[] }

/** Agrupa por día (más reciente primero); dentro del día, por turno y luego por id (orden estable). */
export function agruparPorDia(registros: Registro[], hoy = '', ayer = ''): GrupoDia[] {
  const mapa = new Map<string, Registro[]>()
  for (const r of registros) {
    const lista = mapa.get(r.fecha)
    if (lista) lista.push(r)
    else mapa.set(r.fecha, [r])
  }
  return [...mapa.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).map((dia) => ({
    dia,
    etiqueta: etiquetaDia(dia, hoy, ayer),
    registros: (mapa.get(dia) as Registro[]).slice().sort((a, b) => a.turno.localeCompare(b.turno) || (a.id < b.id ? -1 : 1)),
  }))
}

export interface Punto { x: number; y: number; fecha: string; fuera: boolean }
export interface Serie { campo: string; etiqueta: string; puntos: Punto[] }

/** Series por DDT de UN turno para un grupo: una por campo con datos, puntos ordenados por DDT. Sin DDT no hay eje: se omite. */
export function seriesPorDdt(registros: Registro[], grupo: GrupoParametro): { series: Serie[]; sinDdt: number } {
  const orden = registros.filter((r) => r.ddt !== null && r.ddt !== undefined).slice().sort((a, b) => (a.ddt as number) - (b.ddt as number))
  const sinDdt = registros.length - orden.length
  const series: Serie[] = []
  for (const c of grupo.campos) {
    const puntos: Punto[] = []
    for (const r of orden) {
      const y = valorNumero(r, c.clave)
      if (y !== null) puntos.push({ x: r.ddt as number, y, fecha: r.fecha, fuera: (r.fuera_rango ?? []).includes(c.clave) })
    }
    if (puntos.length) series.push({ campo: c.clave, etiqueta: c.etiqueta, puntos })
  }
  return { series, sinDdt }
}

/** Para las tarjetas: turno → grupo → puntos {x: DDT, y: valor del grupo}. Una sola pasada. */
export function indexarSparks(registros: Registro[]): Map<string, Record<string, { x: number; y: number }[]>> {
  const mapa = new Map<string, Record<string, { x: number; y: number }[]>>()
  for (const r of registros) {
    if (r.ddt === null || r.ddt === undefined) continue
    let porGrupo = mapa.get(r.turno)
    if (!porGrupo) { porGrupo = {}; mapa.set(r.turno, porGrupo) }
    for (const g of GRUPOS) {
      const y = valorGrupo(r, g)
      if (y === null) continue
      ;(porGrupo[g.clave] ??= []).push({ x: r.ddt as number, y })
    }
  }
  for (const porGrupo of mapa.values()) for (const k of Object.keys(porGrupo)) porGrupo[k].sort((a, b) => a.x - b.x)
  return mapa
}

/** Turnos presentes en la lista, con cuántos registros tiene cada uno (orden alfabético). */
export function turnosDe(registros: Registro[]): { turno: string; n: number }[] {
  const m = new Map<string, number>()
  for (const r of registros) m.set(r.turno, (m.get(r.turno) ?? 0) + 1)
  return [...m.entries()].map(([turno, n]) => ({ turno, n })).sort((a, b) => a.turno.localeCompare(b.turno))
}

export interface Caja { ancho: number; alto: number; margen: number }
export interface PuntoDibujo { cx: number; cy: number; x: number; y: number; fecha: string; fuera: boolean }
export interface SerieDibujo { campo: string; etiqueta: string; d: string; puntos: PuntoDibujo[] }
export interface IntervaloPunto { x: number; min: number; max: number }
export interface Escala {
  series: SerieDibujo[]
  /** Franja del intervalo de confianza (cuando exista); '' si no se pasó. */
  banda: string
  xMin: number; xMax: number; yMin: number; yMax: number
  ticksY: number[]
  ticksX: number[]
}

const redondear = (n: number) => Math.round(n * 10) / 10

/** Convierte series a coordenadas SVG dentro de la caja. `intervalo` (IC futuro) entra al rango vertical y se dibuja como franja. */
export function escalar(series: Serie[], caja: Caja, intervalo: IntervaloPunto[] = []): Escala {
  const xs = [...series.flatMap((s) => s.puntos.map((p) => p.x)), ...intervalo.map((i) => i.x)]
  const ys = [...series.flatMap((s) => s.puntos.map((p) => p.y)), ...intervalo.flatMap((i) => [i.min, i.max])]
  if (!xs.length) return { series: [], banda: '', xMin: 0, xMax: 1, yMin: 0, yMax: 1, ticksY: [], ticksX: [] }
  let xMin = Math.min(...xs), xMax = Math.max(...xs)
  let yMin = Math.min(...ys), yMax = Math.max(...ys)
  if (xMin === xMax) { xMin -= 1; xMax += 1 }
  if (yMin === yMax) { yMin -= 1; yMax += 1 }
  const colchon = (yMax - yMin) * 0.08
  yMin -= colchon; yMax += colchon
  const w = caja.ancho - 2 * caja.margen, h = caja.alto - 2 * caja.margen
  const cx = (x: number) => redondear(caja.margen + ((x - xMin) / (xMax - xMin)) * w)
  const cy = (y: number) => redondear(caja.margen + (1 - (y - yMin) / (yMax - yMin)) * h)
  const dibujadas = series.map((s) => {
    const puntos = s.puntos.map((p) => ({ cx: cx(p.x), cy: cy(p.y), x: p.x, y: p.y, fecha: p.fecha, fuera: p.fuera }))
    return { campo: s.campo, etiqueta: s.etiqueta, d: puntos.map((p, i) => `${i ? 'L' : 'M'}${p.cx} ${p.cy}`).join(' '), puntos }
  })
  const orden = intervalo.slice().sort((a, b) => a.x - b.x)
  const banda = orden.length
    ? `${orden.map((p, i) => `${i ? 'L' : 'M'}${cx(p.x)} ${cy(p.max)}`).join(' ')} ${orden.slice().reverse().map((p) => `L${cx(p.x)} ${cy(p.min)}`).join(' ')} Z`
    : ''
  const tres = (a: number, b: number) => [a, (a + b) / 2, b]
  return { series: dibujadas, banda, xMin, xMax, yMin, yMax, ticksY: tres(yMin, yMax), ticksX: tres(xMin, xMax).map((x) => Math.round(x)) }
}

/** Motivo para eliminar: la base exige ≥ 15 letras ya sin espacios en los extremos. */
export const MOTIVO_MINIMO = 15
export function validarMotivo(texto: string | null | undefined): { ok: boolean; largo: number; faltan: number; motivo: string } {
  const motivo = String(texto ?? '').trim()
  const largo = [...motivo].length
  return { ok: largo >= MOTIVO_MINIMO, largo, faltan: Math.max(0, MOTIVO_MINIMO - largo), motivo }
}

/** Número tecleado (coma o punto). null si está vacío o no es número. */
export function leerNumeroTexto(texto: string | null | undefined): number | null {
  const t = String(texto ?? '').trim().replace(',', '.')
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

const MAX_VALOR = 10_000_000   // la base rechaza ≥ 10 millones (22003)

/**
 * Valida lo tecleado al editar (mismas reglas que la captura y la base): número válido y no enorme.
 * Devuelve los números por campo (null = limpiar) y un error en español por campo.
 */
export function validarEdicion(valores: Record<string, string>): { ok: boolean; numeros: Record<string, number | null>; errores: Record<string, string> } {
  const numeros: Record<string, number | null> = {}
  const errores: Record<string, string> = {}
  for (const [campo, crudo] of Object.entries(valores)) {
    if (String(crudo ?? '').trim() === '') { numeros[campo] = null; continue }
    const n = leerNumeroTexto(crudo)
    if (n === null) errores[campo] = 'Escribe un número (ejemplo 12.5).'
    else if (Math.abs(n) >= MAX_VALOR) errores[campo] = 'El número es demasiado grande.'
    else numeros[campo] = n
  }
  return { ok: Object.keys(errores).length === 0, numeros, errores }
}

/** Solo lo que cambió respecto al registro original: {columna: número|null}. Vacío = nada que guardar. */
export function cambiosDeEdicion(original: Record<string, unknown>, numeros: Record<string, number | null>): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const [campo, nuevo] of Object.entries(numeros)) {
    if (!CAMPOS_EDITABLES.includes(campo)) continue
    if (nuevo !== valorNumero(original, campo)) out[campo] = nuevo
  }
  return out
}

/** Filtros de la pantalla (lo que se recuerda por usuario). Listas vacías = «todos». */
export interface FiltrosRegistros {
  temporada: string[]
  zona: string[]
  turno: string[]
  lotes: string[]
  desde: string
  hasta: string
  texto: string
}
export const FILTROS_VACIOS: FiltrosRegistros = { temporada: [], zona: [], turno: [], lotes: [], desde: '', hasta: '', texto: '' }
export const POR_PAGINA = 50

/**
 * Parámetros para fn_agm_mis_registros. La base filtra por UNA temporada/zona/turno: con una sola elegida se manda;
 * con varias se pide sin ese filtro y `filtrarLocal` recorta. Los lotes sí van en lista (turno_lotes).
 */
export function paramsConsulta(f: FiltrosRegistros, pagina: number): Record<string, unknown> {
  const p: Record<string, unknown> = { limite: POR_PAGINA, pagina, orden: 'desc' }
  if (f.temporada.length === 1) p.temporada = f.temporada[0]
  if (f.zona.length === 1) p.zona_id = f.zona[0]
  if (f.turno.length === 1) p.turno = f.turno[0]
  if (f.lotes.length) p.lotes = f.lotes
  if (f.desde) p.desde = f.desde
  if (f.hasta) p.hasta = f.hasta
  if (f.texto.trim()) p.texto = f.texto.trim()
  return p
}

/** Recorte local de las selecciones múltiples (la base ya compara el turno exacto; la búsqueda parcial va por `texto`). */
export function filtrarLocal(registros: Registro[], f: FiltrosRegistros): Registro[] {
  return registros.filter((r) =>
    (!f.turno.length || f.turno.includes(r.turno)) &&
    (!f.temporada.length || (r.temporada !== null && f.temporada.includes(r.temporada))) &&
    (!f.zona.length || (r.zona_id !== null && f.zona.includes(r.zona_id))))
}

/** Une una página nueva a lo ya cargado sin repetir ids (si el registro ya estaba, gana el nuevo). */
export function unirPagina(actuales: Registro[], nuevos: Registro[]): Registro[] {
  const ids = new Set(nuevos.map((r) => r.id))
  return [...actuales.filter((r) => !ids.has(r.id)), ...nuevos]
}
