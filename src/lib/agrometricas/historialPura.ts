/**
 * AgroMétricas · «Mis registros»: lógica PURA del historial local (sin IndexedDB, sin React). Solo un resumen en texto
 * (~1 KB, sin fotos) de lo que ESTE usuario guardó desde ESTE teléfono. Se poda solo: máximo 14 días y 200 registros.
 * Probado en pruebas/unit/agrometricas_historial.test.mjs. Fechas siempre en UTC-6 (America/Tegucigalpa).
 */

export const HISTORIAL_DIAS = 14
export const HISTORIAL_MAX = 200
export const VISTA_INICIAL = 15
const DESFASE_MS = 6 * 3600_000   // UTC-6, sin horario de verano
const MAX_DATOS = 3

/** Resumen corto y legible de un registro (lo único que se guarda en el historial). */
export type Vista = {
  /** Jornada del registro (AAAA-MM-DD). */
  fecha: string
  /** Turno (o «Clima»/«Calicata»). */
  turno: string
  /** Estación o zona. */
  lugar: string
  ddt: number | null
  /** Hasta 3 datos clave en texto, p. ej. «CE gotero 1.8 dS/m». */
  datos: string[]
}

export type EntradaHistorial = { id: string; tipo: 'parametros' | 'clima' | 'calicata'; vista: Vista; creado_en: string; enviado_en: string }

export type Estado = 'sin_enviar' | 'enviado' | 'rechazado'
export type ItemVista = { id: string; estado: Estado; cuando: string; vista: Vista; mensaje?: string }

export type CampoResumen = { clave: string; etiqueta: string; unidad?: string }

/** Prioridad de los datos clave: CE, pH y luego tensiómetros; el resto va después en el orden del formulario. */
const PRIORIDAD = ['ce_gotero', 'ph_gotero', 'ce_agua', 'ph_agua', 'ce_extractor', 'ph_extractor',
  'tensiometro_12_am', 'tensiometro_24_am', 'tensiometro_12_pm', 'tensiometro_24_pm']

/** Hasta 3 datos clave con valor numérico, como texto «Etiqueta valor unidad». */
export function resumirDatos(datos: Record<string, unknown>, campos: CampoResumen[]): string[] {
  const con = campos.filter((c) => datos[c.clave] != null && datos[c.clave] !== '' && Number.isFinite(Number(datos[c.clave])))
  const rango = (c: CampoResumen) => { const i = PRIORIDAD.indexOf(c.clave); return i < 0 ? PRIORIDAD.length : i }
  return con
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rango(a.c) - rango(b.c) || a.i - b.i)
    .slice(0, MAX_DATOS)
    .map(({ c }) => `${c.etiqueta} ${Number(datos[c.clave])}${c.unidad ? ` ${c.unidad}` : ''}`)
}

/** Arma la vista de un registro al guardarlo. */
export function resumirRegistro(
  tipo: 'parametros' | 'clima' | 'calicata',
  datos: Record<string, unknown>,
  ctx: { turno: string; lugar: string; ddt: number | null; fecha: string },
  campos: CampoResumen[],
): Vista {
  let lista: string[]
  if (tipo === 'calicata') {
    const p = Number(datos.precision_m)
    lista = Number.isFinite(p) ? [`Calicata ±${p} m`] : ['Calicata']
  } else {
    lista = resumirDatos(datos, campos)
    if (tipo === 'parametros' && lista.length < MAX_DATOS && datos.comentario) lista.push('con comentario')
  }
  return { fecha: ctx.fecha, turno: ctx.turno, lugar: ctx.lugar, ddt: ctx.ddt, datos: lista }
}

/** Vista de respaldo para registros viejos de la cola que no traen resumen: usa el texto que ya tenían. */
export const vistaDeResumen = (resumen: string): Vista => ({ fecha: '', turno: resumen, lugar: '', ddt: null, datos: [] })

/** Día (AAAA-MM-DD) en UTC-6 de un instante ISO. '' si no es una fecha válida. */
export function diaLocal(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t - DESFASE_MS).toISOString().slice(0, 10) : ''
}

/** Hora HH:MM en UTC-6 de un instante ISO. */
export function horaLocal(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t - DESFASE_MS).toISOString().slice(11, 16) : ''
}

/**
 * Poda: quita lo de más de `dias` días y, de lo que queda, deja solo los `max` más recientes.
 * -> ids a conservar y ids a borrar. Entradas con fecha ilegible se borran.
 */
export function podar(lista: EntradaHistorial[], ahoraMs: number, dias = HISTORIAL_DIAS, max = HISTORIAL_MAX): { conservar: EntradaHistorial[]; quitar: string[] } {
  const limite = ahoraMs - dias * 86_400_000
  const vigentes = lista
    .filter((e) => { const t = Date.parse(e.enviado_en); return Number.isFinite(t) && t >= limite })
    .sort((a, b) => Date.parse(b.enviado_en) - Date.parse(a.enviado_en))
    .slice(0, max)
  const quedan = new Set(vigentes.map((e) => e.id))
  return { conservar: vigentes, quitar: lista.filter((e) => !quedan.has(e.id)).map((e) => e.id) }
}

/**
 * Une cola (sin enviar), rechazados y enviados en una sola lista, lo más reciente primero. Si un mismo id está en
 * varios lados gana: rechazado > sin enviar > enviado.
 */
export function unirItems(
  cola: { id: string; creado_en?: string; resumen: string; vista?: Vista }[],
  rechazados: { id: string; creado_en?: string; resumen: string; vista?: Vista; mensaje: string }[],
  historial: EntradaHistorial[],
  ahoraIso: string,
): ItemVista[] {
  const mapa = new Map<string, ItemVista>()
  for (const h of historial) mapa.set(h.id, { id: h.id, estado: 'enviado', cuando: h.creado_en || h.enviado_en, vista: h.vista })
  for (const p of cola) mapa.set(p.id, { id: p.id, estado: 'sin_enviar', cuando: p.creado_en || ahoraIso, vista: p.vista ?? vistaDeResumen(p.resumen) })
  for (const r of rechazados) mapa.set(r.id, { id: r.id, estado: 'rechazado', cuando: r.creado_en || ahoraIso, vista: r.vista ?? vistaDeResumen(r.resumen), mensaje: r.mensaje })
  return [...mapa.values()].sort((a, b) => Date.parse(b.cuando) - Date.parse(a.cuando))
}

export type GrupoDia = { dia: string; etiqueta: string; items: ItemVista[] }

/** Agrupa por día de registro (UTC-6): «Hoy», «Ayer» o la fecha. Respeta el orden recibido; `limite` corta el total de items. */
export function agruparPorDia(items: ItemVista[], hoy: string, ayer: string, limite = Infinity): GrupoDia[] {
  const grupos: GrupoDia[] = []
  for (const it of items.slice(0, limite)) {
    const dia = diaLocal(it.cuando) || 'sin fecha'
    let g = grupos.find((x) => x.dia === dia)
    if (!g) {
      g = { dia, etiqueta: dia === hoy ? 'Hoy' : dia === ayer ? 'Ayer' : dia, items: [] }
      grupos.push(g)
    }
    g.items.push(it)
  }
  return grupos
}
