/**
 * El árbol de agrupación del tablero. Funciones puras: entran filas,
 * sale un árbol. No sabe de React, ni de Supabase, ni de cómo se dibuja.
 *
 * La regla que da sentido a todo esto: `area_plan` y `gasto_lote` vienen
 * REPETIDOS en cada fila del mismo lote —son del lote, no de la labor—,
 * así que sumarlos fila a fila multiplicaría el plan por el número de
 * labores. Se suman una vez por lote. Las manzanas y los subtotales sí
 * se suman fila a fila: cada uno es de su labor.
 */

import type { Agrupacion, FilaLote, Totales } from './tipos'
import { AGRUPACIONES } from './tipos'

export type Nodo = {
  /** Identifica la rama dentro de su nivel; sirve de `key` y de estado. */
  clave: string
  etiqueta: string
  /** Segunda línea de la cabecera: el nombre del lote, el encargado… */
  detalle: string | null
  dimension: Agrupacion
  totales: Totales
  hijos: Nodo[]
  /** Las filas de esta rama, ya recortadas. La hoja las dibuja. */
  filas: FilaLote[]
}

const ORDEN = AGRUPACIONES.map((a) => a.valor)

/**
 * Pone las agrupaciones elegidas en el orden estricto Encargado > Zona >
 * Lote > Labor, pase el que pase el usuario. Sin repetidos y sin nada
 * que no sea una agrupación conocida.
 */
export function ordenar(elegidas: Agrupacion[]): Agrupacion[] {
  const marcadas = new Set(elegidas)
  return ORDEN.filter((a) => marcadas.has(a))
}

/** Suma un conjunto de filas respetando qué es del lote y qué de la labor. */
export function totalesDe(filas: FilaLote[]): Totales {
  const porLote = new Map<string, number>()
  let mz = 0
  let gasto = 0

  for (const f of filas) {
    mz += Number(f.mz_avance) || 0
    gasto += Number(f.subtotal) || 0
    // El plan es del lote: una sola vez, por muchas labores que tenga.
    porLote.set(f.lote_temporada_id, Number(f.area_plan) || 0)
  }

  const plan = [...porLote.values()].reduce((a, v) => a + v, 0)

  return {
    mz: redondear(mz),
    plan: redondear(plan),
    gasto: redondear(gasto),
    lotes: porLote.size,
    pct: plan > 0 ? redondear((mz * 100) / plan) : null,
  }
}

function redondear(v: number): number {
  return Math.round(v * 100) / 100
}

/** Con qué valor y con qué texto entra una fila en cada dimensión. */
function claveDe(fila: FilaLote, dimension: Agrupacion): {
  clave: string
  etiqueta: string
  detalle: string | null
} {
  switch (dimension) {
    case 'encargado':
      return {
        clave: fila.encargado ?? '__sin__',
        etiqueta: fila.encargado ?? 'Sin encargado',
        detalle: null,
      }
    case 'zona':
      return {
        clave: fila.zona_id ?? '__sin__',
        etiqueta: fila.zona ?? 'Sin zona',
        detalle: fila.encargado,
      }
    case 'lote':
      return {
        clave: fila.lote_temporada_id,
        etiqueta: fila.ut,
        detalle: fila.lote_nombre,
      }
    case 'labor':
      return {
        clave: fila.labor_id,
        etiqueta: fila.labor_nombre,
        detalle: fila.categoria_labor,
      }
  }
}

/**
 * Arma el árbol.
 *
 * Sin agrupaciones devuelve una sola rama con todo dentro, que es lo que
 * la pantalla necesita para enseñar la cuadrícula plana sin tener dos
 * caminos distintos según se haya agrupado o no.
 */
export function agrupar(filas: FilaLote[], por: Agrupacion[]): Nodo[] {
  const niveles = ordenar(por)
  if (niveles.length === 0) {
    return [
      {
        clave: '__todo__',
        etiqueta: 'Todo',
        detalle: null,
        dimension: 'lote',
        totales: totalesDe(filas),
        hijos: [],
        filas,
      },
    ]
  }
  return construir(filas, niveles, '')
}

function construir(filas: FilaLote[], niveles: Agrupacion[], prefijo: string): Nodo[] {
  const [dimension, ...resto] = niveles

  // `Map` y no un objeto: conserva el orden de llegada, y las filas ya
  // vienen ordenadas de la base (zona, lote, labor).
  const grupos = new Map<string, { etiqueta: string; detalle: string | null; filas: FilaLote[] }>()

  for (const fila of filas) {
    const { clave, etiqueta, detalle } = claveDe(fila, dimension)
    const grupo = grupos.get(clave) ?? { etiqueta, detalle, filas: [] }
    grupo.filas.push(fila)
    grupos.set(clave, grupo)
  }

  return [...grupos.entries()].map(([clave, grupo]) => ({
    clave: `${prefijo}${dimension}:${clave}`,
    etiqueta: grupo.etiqueta,
    detalle: grupo.detalle,
    dimension,
    totales: totalesDe(grupo.filas),
    hijos: resto.length > 0 ? construir(grupo.filas, resto, `${prefijo}${dimension}:${clave}|`) : [],
    filas: grupo.filas,
  }))
}

/**
 * El resumen de costos por zona del pie, que es otra pregunta: no «cómo
 * va el avance» sino «en qué se fue el dinero». Por eso se arma aparte y
 * ordenado por gasto, de mayor a menor.
 */
export type ResumenZona = {
  zona: string
  encargado: string | null
  gasto: number
  lotes: { lote_temporada_id: string; ut: string; lote_nombre: string | null; gasto: number }[]
}

export function costosPorZona(filas: FilaLote[]): ResumenZona[] {
  const zonas = new Map<string, ResumenZona>()

  for (const f of filas) {
    const clave = f.zona_id ?? '__sin__'
    const zona = zonas.get(clave) ?? {
      zona: f.zona ?? 'Sin zona',
      encargado: f.encargado,
      gasto: 0,
      lotes: [],
    }
    zona.gasto += Number(f.subtotal) || 0

    const lote = zona.lotes.find((l) => l.lote_temporada_id === f.lote_temporada_id)
    if (lote) lote.gasto += Number(f.subtotal) || 0
    else
      zona.lotes.push({
        lote_temporada_id: f.lote_temporada_id,
        ut: f.ut,
        lote_nombre: f.lote_nombre,
        gasto: Number(f.subtotal) || 0,
      })

    zonas.set(clave, zona)
  }

  return [...zonas.values()]
    .map((z) => ({
      ...z,
      gasto: redondear(z.gasto),
      lotes: z.lotes
        .map((l) => ({ ...l, gasto: redondear(l.gasto) }))
        .sort((a, b) => b.gasto - a.gasto),
    }))
    .sort((a, b) => b.gasto - a.gasto)
}
