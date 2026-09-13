/**
 * Reglas de la cuadrícula de recepción de plántulas.
 *
 * Puro: ni React ni Supabase. Aquí vive lo que la pantalla NO debe saber
 * hacer —cuánto suma una línea, qué cambió respecto a lo guardado, qué
 * falta por llenar— para que la cuadrícula sólo dibuje celdas.
 *
 * La edición es en línea, estilo Excel: el usuario escribe sobre la tabla
 * y guarda una vez. Eso obliga a llevar un borrador en memoria y a poder
 * compararlo con lo que trajo la base, que es justo lo que hace `diferir`.
 */

import type { FilaRecepcion } from './tipos'

/** Una línea del borrador. Todo texto: es lo que hay en las celdas. */
export type Borrador = {
  /** `null` mientras la fila no exista en la base. */
  id: string | null
  fecha: string
  variedad_id: string
  plantulas_enviadas: string
  plantulas_facturadas: string
  costo_unitario: string
  numero_factura: string
  lote_semilla: string
  bandejas_enviadas: string
  documento_sap: string
  observaciones: string
}

export type CampoBorrador = keyof Omit<Borrador, 'id'>

/** Lee una celda numérica: vacío es vacío, no cero. */
export function aNumeroCelda(bruto: string): number | null {
  const t = (bruto ?? '').trim()
  if (!t) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * El total de una línea.
 *
 * Se calcula igual que la columna generada de la base —facturadas por
 * costo unitario, a dos decimales— para que lo que el usuario ve mientras
 * escribe sea exactamente lo que se va a guardar.
 */
export function totalLinea(b: Borrador): number {
  const facturadas = aNumeroCelda(b.plantulas_facturadas) ?? 0
  const costo = aNumeroCelda(b.costo_unitario) ?? 0
  return Math.round(facturadas * costo * 100) / 100
}

export function filaVacia(fecha: string): Borrador {
  return {
    id: null,
    fecha,
    variedad_id: '',
    plantulas_enviadas: '',
    plantulas_facturadas: '',
    costo_unitario: '',
    numero_factura: '',
    lote_semilla: '',
    bandejas_enviadas: '',
    documento_sap: '',
    observaciones: '',
  }
}

export function aBorrador(f: FilaRecepcion): Borrador {
  const texto = (v: number | null) => (v === null || v === undefined ? '' : String(v))
  return {
    id: f.id,
    fecha: f.fecha,
    variedad_id: f.variedad_id,
    plantulas_enviadas: texto(f.plantulas_enviadas),
    plantulas_facturadas: texto(f.plantulas_facturadas),
    costo_unitario: texto(f.costo_unitario),
    numero_factura: f.numero_factura ?? '',
    lote_semilla: f.lote_semilla ?? '',
    bandejas_enviadas: texto(f.bandejas_enviadas),
    documento_sap: f.documento_sap ?? '',
    observaciones: f.observaciones ?? '',
  }
}

/**
 * Una fila que el usuario todavía no empezó.
 *
 * La fecha NO cuenta: la fila nueva ya nace con la de hoy puesta, y si
 * contara, agregar una fila marcaría un error antes de escribir nada.
 */
export function estaVacia(b: Borrador): boolean {
  return (
    !b.variedad_id &&
    !b.plantulas_facturadas.trim() &&
    !b.plantulas_enviadas.trim() &&
    !b.costo_unitario.trim() &&
    !b.numero_factura.trim() &&
    !b.lote_semilla.trim() &&
    !b.bandejas_enviadas.trim() &&
    !b.documento_sap.trim() &&
    !b.observaciones.trim()
  )
}

/** Devuelve el problema de la fila, o `null` si está lista para guardar. */
export function validar(b: Borrador): string | null {
  if (!b.fecha) return 'Falta la fecha'
  if (!b.variedad_id) return 'Falta la variedad'

  const facturadas = aNumeroCelda(b.plantulas_facturadas)
  if (facturadas === null) return 'Faltan las plántulas facturadas'
  if (facturadas < 0) return 'Las facturadas no pueden ser negativas'

  const costo = aNumeroCelda(b.costo_unitario)
  if (costo !== null && costo < 0) return 'El costo no puede ser negativo'

  for (const [campo, etiqueta] of [
    ['plantulas_enviadas', 'Las enviadas'],
    ['bandejas_enviadas', 'Las bandejas'],
  ] as const) {
    const v = b[campo]
    if (v.trim() && aNumeroCelda(v) === null) return `${etiqueta} no son un número`
  }
  return null
}

export type CamposRecepcion = {
  variedad_id: string
  fecha: string
  plantulas_enviadas: number | null
  plantulas_facturadas: number
  costo_unitario: number
  numero_factura: string | null
  lote_semilla: string | null
  bandejas_enviadas: number | null
  documento_sap: string | null
  observaciones: string | null
}

export function aCampos(b: Borrador): CamposRecepcion {
  const texto = (v: string) => (v.trim() ? v.trim() : null)
  return {
    variedad_id: b.variedad_id,
    fecha: b.fecha,
    plantulas_enviadas: aNumeroCelda(b.plantulas_enviadas),
    plantulas_facturadas: aNumeroCelda(b.plantulas_facturadas) ?? 0,
    costo_unitario: aNumeroCelda(b.costo_unitario) ?? 0,
    numero_factura: texto(b.numero_factura),
    lote_semilla: texto(b.lote_semilla),
    bandejas_enviadas: aNumeroCelda(b.bandejas_enviadas),
    documento_sap: texto(b.documento_sap),
    observaciones: texto(b.observaciones),
  }
}

export type Diferencia = {
  nuevas: CamposRecepcion[]
  cambiadas: { id: string; campos: CamposRecepcion }[]
  borradas: string[]
  errores: { indice: number; error: string }[]
}

/**
 * Qué hay que escribir para que la base se parezca al borrador.
 *
 * Sólo viajan las filas que de verdad cambiaron: mandar las 300 líneas
 * cada vez que se corrige un costo es pedir un conflicto con quien esté
 * capturando en la otra pantalla.
 */
export function diferir(originales: FilaRecepcion[], borrador: Borrador[]): Diferencia {
  const previas = new Map(originales.map((f) => [f.id, aBorrador(f)]))
  const vivas = new Set(borrador.map((b) => b.id).filter((id): id is string => id !== null))

  const d: Diferencia = { nuevas: [], cambiadas: [], borradas: [], errores: [] }

  borrador.forEach((b, indice) => {
    if (estaVacia(b)) return
    const problema = validar(b)
    if (problema) return d.errores.push({ indice, error: problema })

    if (b.id === null) return d.nuevas.push(aCampos(b))

    const antes = previas.get(b.id)
    if (antes && JSON.stringify(antes) === JSON.stringify(b)) return
    d.cambiadas.push({ id: b.id, campos: aCampos(b) })
  })

  for (const f of originales) if (!vivas.has(f.id)) d.borradas.push(f.id)

  return d
}

export function hayCambios(d: Diferencia): boolean {
  return d.nuevas.length > 0 || d.cambiadas.length > 0 || d.borradas.length > 0
}

/** Totales del pie de la cuadrícula. */
export function totalesRecepcion(borrador: Borrador[]) {
  const llenas = borrador.filter((b) => !estaVacia(b))
  return {
    lineas: llenas.length,
    enviadas: llenas.reduce((a, b) => a + (aNumeroCelda(b.plantulas_enviadas) ?? 0), 0),
    facturadas: llenas.reduce((a, b) => a + (aNumeroCelda(b.plantulas_facturadas) ?? 0), 0),
    bandejas: llenas.reduce((a, b) => a + (aNumeroCelda(b.bandejas_enviadas) ?? 0), 0),
    costo: Math.round(llenas.reduce((a, b) => a + totalLinea(b), 0) * 100) / 100,
  }
}
