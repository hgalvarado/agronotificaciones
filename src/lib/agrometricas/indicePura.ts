/**
 * AgroMétricas › Índice de crecimiento (IC): lógica PURA (sin React, sin Supabase). Se prueba con `node --test`
 * (pruebas/unit/agrometricas_indice.test.mjs). Base: sql/127.
 *
 *   IC = hojas / (DDT ^ exponente_ddt) / divisor           (inicial: divisor 10, exponente 1  →  hojas / DDT / 10)
 *   Plan IC por DDT (5–20): tabla por versión de fórmula (igual para todas las variedades).
 *
 * El capturador registra solo las HOJAS. El IC se calcula con la versión de fórmula VIGENTE a la fecha del registro
 * (`vigente_desde` ≤ fecha, la más reciente; sin ninguna anterior, la primera). Mismo criterio que la base
 * (`_agm_ic_version`), para que el teléfono muestre sin señal lo mismo que la base guardará.
 */

export const DDT_IC_MIN = 5
export const DDT_IC_MAX = 20
/** Mismo tope que la base (hojas < 100000). */
export const HOJAS_MAX = 100_000

export type PlanIC = { ddt: number; ic_plan: number }
export type VersionFormula = {
  id: string
  /** AAAA-MM-DD */
  vigente_desde: string
  divisor: number
  exponente_ddt: number
  notas?: string | null
  plan: PlanIC[]
}

/** Redondeo a 4 decimales (como `round(x, 4)` de la base). */
export const redondear4 = (x: number) => Math.round((x + Number.EPSILON) * 1e4) / 1e4

/** ¿El DDT está en la ventana preferida de medición (5–20)? Solo se usa para resaltar y avisar: nunca bloquea. */
export const ddtEnRangoIC = (ddt: number | null | undefined) =>
  ddt != null && Number.isFinite(ddt) && ddt >= DDT_IC_MIN && ddt <= DDT_IC_MAX

/** IC = hojas / DDT^exp / divisor. null si falta un dato, el DDT no es positivo o el divisor no es positivo. */
export function calcularIC(hojas: number | null | undefined, ddt: number | null | undefined, divisor: number, exponente: number): number | null {
  if (hojas == null || ddt == null || !Number.isFinite(hojas) || !Number.isFinite(ddt)) return null
  if (ddt <= 0 || !Number.isFinite(divisor) || divisor <= 0) return null
  return redondear4(hojas / Math.pow(ddt, Number.isFinite(exponente) ? exponente : 1) / divisor)
}

/** Versión de fórmula vigente a una fecha (AAAA-MM-DD). Sin versiones: null. */
export function versionVigente(versiones: VersionFormula[] | null | undefined, fecha: string): VersionFormula | null {
  const lista = [...(versiones ?? [])].sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde))
  if (!lista.length) return null
  let elegida: VersionFormula | null = null
  for (const v of lista) if (v.vigente_desde <= fecha) elegida = v
  return elegida ?? lista[0]
}

/** IC del plan para un DDT en una versión. null si el DDT no está en la tabla. */
export function planIC(version: VersionFormula | null | undefined, ddt: number | null | undefined): number | null {
  if (!version || ddt == null) return null
  const fila = version.plan.find((p) => p.ddt === ddt)
  return fila ? fila.ic_plan : null
}

export type ResultadoIC = {
  ic: number | null
  plan: number | null
  version: VersionFormula | null
  /** Diferencia real − plan (null si falta alguno). */
  diferencia: number | null
  /** Avisos (no bloquean): DDT fuera de 5–20, sin siembra, sin fórmula. */
  avisos: string[]
}

/** Lo que se muestra en vivo en el teléfono al escribir las hojas. Funciona sin señal con la fórmula guardada en caché. */
export function resultadoIC(hojas: number | null, ddt: number | null, fecha: string, versiones: VersionFormula[] | null | undefined): ResultadoIC {
  const version = versionVigente(versiones, fecha)
  const avisos: string[] = []
  if (ddt == null) avisos.push('El turno no tiene fecha de siembra: no se puede calcular el IC.')
  else if (ddt <= 0) avisos.push('La jornada es anterior a la siembra: no se puede calcular el IC.')
  else if (!ddtEnRangoIC(ddt)) avisos.push(`DDT ${ddt}: el IC se mide preferiblemente del DDT ${DDT_IC_MIN} al ${DDT_IC_MAX}. Se guarda igual.`)
  if (!version) avisos.push('Aún no se bajó la fórmula del IC al teléfono. Las hojas se guardan y el IC se calcula al enviar.')
  const ic = version ? calcularIC(hojas, ddt, version.divisor, version.exponente_ddt) : null
  const plan = planIC(version, ddt)
  return { ic, plan, version, diferencia: ic != null && plan != null ? redondear4(ic - plan) : null, avisos }
}

/** Lo que llega de la base (`fn_agm_ic_config`) puede traer números como texto: se normaliza y se ordena. Descarta lo inservible. */
export function normalizarVersiones(crudo: unknown): VersionFormula[] {
  const lista = Array.isArray((crudo as { versiones?: unknown })?.versiones) ? (crudo as { versiones: unknown[] }).versiones : []
  const out: VersionFormula[] = []
  for (const v of lista) {
    const o = v as Record<string, unknown> | null
    const divisor = Number(o?.divisor)
    const exponente = Number(o?.exponente_ddt ?? 1)
    const desde = String(o?.vigente_desde ?? '').slice(0, 10)
    if (!o || typeof o.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !(divisor > 0) || !Number.isFinite(exponente)) continue
    const plan = (Array.isArray(o.plan) ? o.plan : [])
      .map((x) => ({ ddt: Number((x as PlanIC).ddt), ic_plan: Number((x as PlanIC).ic_plan) }))
      .filter((x) => Number.isInteger(x.ddt) && Number.isFinite(x.ic_plan))
      .sort((a, b) => a.ddt - b.ddt)
    out.push({ id: o.id, vigente_desde: desde, divisor, exponente_ddt: exponente, notas: (o.notas as string | null) ?? null, plan })
  }
  return out.sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde))
}

/** Datos que viajan en la cola para `fn_agm_ic_registrar` (el IC NO se manda: lo calcula la base con la fórmula vigente). */
export function armarDatosIC(a: { id: string; turnoId: string; fecha: string; hojas: number; comentario?: string | null; correccion?: boolean }): Record<string, unknown> {
  const d: Record<string, unknown> = { id: a.id, turno_ciclo_id: a.turnoId, fecha: a.fecha, hojas: a.hojas }
  if (a.comentario?.trim()) d.comentario = a.comentario.trim()
  if (a.correccion) d.correccion = true
  return d
}

/** Valida las hojas tecleadas. -> {valor} o {error} en español. */
export function validarHojas(texto: string | null | undefined): { valor: number } | { error: string } | { vacio: true } {
  const t = String(texto ?? '').trim().replace(',', '.')
  if (!t) return { vacio: true }
  if (!/^\d+(\.\d+)?$/.test(t)) return { error: 'El número de hojas no es un número.' }
  const n = Number(t)
  if (n >= HOJAS_MAX) return { error: 'El número de hojas es demasiado grande. Revisa la lectura.' }
  return { valor: n }
}

export type ProblemaFormula = { campo: string; mensaje: string }

/**
 * Validación de la pantalla «Fórmula del IC» antes de enviar (la base vuelve a validar).
 * `plan` llega como texto tecleado por fila.
 */
export function validarFormula(f: { vigente_desde: string; divisor: string; exponente_ddt: string; plan: { ddt: string; ic_plan: string }[] }): ProblemaFormula[] {
  const p: ProblemaFormula[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.vigente_desde)) p.push({ campo: 'vigente_desde', mensaje: 'Indica desde qué fecha rige.' })
  const div = Number(String(f.divisor).replace(',', '.'))
  if (!String(f.divisor).trim() || !(div > 0)) p.push({ campo: 'divisor', mensaje: 'El divisor debe ser mayor que 0.' })
  const exp = Number(String(f.exponente_ddt).replace(',', '.'))
  if (!String(f.exponente_ddt).trim() || !Number.isFinite(exp) || exp < 0 || exp > 3) p.push({ campo: 'exponente_ddt', mensaje: 'El exponente del DDT va de 0 a 3.' })
  const vistos = new Set<number>()
  f.plan.forEach((r, i) => {
    if (!r.ddt.trim() && !r.ic_plan.trim()) return   // fila vacía: se ignora
    const ddt = Number(r.ddt)
    const ic = Number(String(r.ic_plan).replace(',', '.'))
    if (!Number.isInteger(ddt) || ddt < 1 || ddt > 60) p.push({ campo: `plan.${i}.ddt`, mensaje: 'El DDT debe ser un entero entre 1 y 60.' })
    else if (vistos.has(ddt)) p.push({ campo: `plan.${i}.ddt`, mensaje: `El DDT ${ddt} está repetido.` })
    else vistos.add(ddt)
    if (!r.ic_plan.trim() || !Number.isFinite(ic) || ic < 0) p.push({ campo: `plan.${i}.ic_plan`, mensaje: 'El IC del plan debe ser un número, 0 o más.' })
  })
  return p
}

/** Plan tecleado → lista para la base (ignora filas vacías, ordena por DDT). Llamar solo si `validarFormula` no devolvió problemas. */
export function planParaGuardar(plan: { ddt: string; ic_plan: string }[]): PlanIC[] {
  return plan
    .filter((r) => r.ddt.trim() && r.ic_plan.trim())
    .map((r) => ({ ddt: Number(r.ddt), ic_plan: Number(String(r.ic_plan).replace(',', '.')) }))
    .sort((a, b) => a.ddt - b.ddt)
}
