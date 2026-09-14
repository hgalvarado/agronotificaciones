/**
 * La zona horaria de la empresa, en un solo sitio.
 *
 * El problema que resuelve: Vercel corre en UTC. `new Date().toISOString()`
 * a las 6 de la tarde de Honduras ya devuelve el día siguiente, así que un
 * ticket capturado el lunes por la tarde nacía con fecha de martes, el
 * rango «mes en curso» empezaba un día antes de tiempo y el reporte
 * público del día salía vacío. No es un error de una pantalla: es la misma
 * cuenta hecha mal en cincuenta sitios.
 *
 * La regla es una: la jornada agrícola se mide en `America/Tegucigalpa`
 * (UTC−6, sin horario de verano), tanto si el navegador está en Honduras
 * como si el servidor está en Ámsterdam. Todo lo que signifique «hoy»,
 * «ayer» o «este mes» sale de aquí.
 *
 * Lo que este módulo NO hace: cambiar cómo se guarda. Una fecha de jornada
 * sigue siendo `date` en Postgres —un día del calendario, sin hora— y un
 * sello de auditoría sigue siendo `timestamptz` —un instante—. Lo único
 * que se corrige es en qué reloj se lee cada uno.
 *
 * Funciones puras. Sin React, sin red, sin base.
 */

export const ZONA = 'America/Tegucigalpa'

/** El desfase fijo de Honduras. No hay horario de verano que lo mueva. */
export const DESFASE = '-06:00'

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/* `en-CA` es el truco: su formato corto ya es YYYY-MM-DD, así que sale la
   fecha ISO del calendario hondureño sin tener que pegar partes a mano. */
const CALENDARIO = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const RELOJ = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function esFechaIso(v: string | null | undefined): boolean {
  return typeof v === 'string' && ES_FECHA.test(v)
}

/** Qué día del calendario hondureño es un instante dado. */
export function isoDe(momento: Date = new Date()): string {
  return CALENDARIO.format(momento)
}

/** Hoy en Honduras. El reemplazo de `new Date().toISOString().slice(0, 10)`. */
export function hoyIso(): string {
  return isoDe()
}

/**
 * Suma (o resta) días a una fecha de calendario.
 *
 * Trabaja sobre el mediodía UTC a propósito: es el punto del día que
 * ninguna zona horaria del mundo puede empujar al día anterior o al
 * siguiente, así que sumar un día siempre da el día de al lado.
 */
export function sumarDias(iso: string, dias: number): string {
  if (!esFechaIso(iso)) return iso
  const t = Date.parse(`${iso}T12:00:00Z`)
  if (Number.isNaN(t)) return iso
  return new Date(t + dias * 86_400_000).toISOString().slice(0, 10)
}

/** Ayer en Honduras: la jornada que se captura al día siguiente. */
export function ayerIso(): string {
  return sumarDias(hoyIso(), -1)
}

/** El primer día del mes en curso, en Honduras. */
export function primerDiaDelMes(): string {
  return `${hoyIso().slice(0, 8)}01`
}

/**
 * Un instante seguro para enseñar una fecha de calendario.
 *
 * `new Date('2026-09-14')` a secas se interpreta en UTC y, enseñado en
 * Honduras, sale como 13. Anclarla al mediodía UTC la deja en el día 14
 * en cualquier reloj entre UTC−11 y UTC+11.
 */
export function instanteDeFecha(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`)
}

/**
 * El momento actual, escrito en hora de Honduras.
 *
 * Es el MISMO instante que `toISOString()` —Postgres guarda igual los
 * dos—, pero con el desfase explícito se lee en el reloj de la finca
 * cuando alguien mira la columna a mano.
 */
export function ahoraIso(momento: Date = new Date()): string {
  return `${isoDe(momento)}T${RELOJ.format(momento)}${DESFASE}`
}

/* ------------------------------------------------------------------ */
/* Campos `datetime-local`                                             */
/* ------------------------------------------------------------------ */
/* El navegador entrega y espera «2026-09-05T14:30» SIN zona, y lo
 * interpreta con el reloj del aparato. Si el jefe de taller abre la
 * pantalla desde un teléfono con la zona mal puesta, la hora del cambio
 * de tablero se guardaría corrida. Estas dos funciones fijan el puente:
 * lo que se escribe es hora de Honduras, siempre. */

const RELOJ_CORTO = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** De un instante guardado al valor que espera `<input type="datetime-local">`. */
export function aEntradaLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${isoDe(d)}T${RELOJ_CORTO.format(d)}`
}

/** Del valor del campo al instante que se guarda, leído en hora de Honduras. */
export function deEntradaLocal(valor: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor)) return null
  return `${valor.slice(0, 16)}:00${DESFASE}`
}
