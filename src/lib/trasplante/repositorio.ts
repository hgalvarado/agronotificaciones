/**
 * Persistencia del trasplante (lado servidor).
 *
 * El único archivo del módulo que habla con Supabase para LEER. Trae
 * datos crudos o un error; no decide ni formatea.
 */

import { createClient } from '@/lib/supabase/server'
import { leerTodo } from '@/lib/supabase/paginar'
import type {
  FilaAvanceUt,
  FilaEstadistica,
  FilaLiquidacion,
  FilaRecepcion,
  FilaSemana,
  FilaSiembra,
  FilaVariedad,
  FilaZona,
  LoteOpcion,
  Material,
  Variedad,
} from './tipos'

export type Respuesta<T> = { datos: T; error: string | null }

type LoteFila = {
  id: string
  temporada_id: string
  area_neta: number
  lotes: { nomenclatura: string; nombre: string | null } | { nomenclatura: string; nombre: string | null }[] | null
  zonas: { nombre: string } | { nombre: string }[] | null
}

function uno<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function leerCatalogos(temporadaId: string | null) {
  const supabase = await createClient()
  const [{ data: variedades }, { data: materiales }, { data: lotes }] = await Promise.all([
    supabase.from('variedades').select('id, nombre, codigo_sap, producto').eq('activo', true).order('nombre'),
    supabase.from('materiales').select('id, codigo, descripcion, grupo').eq('activo', true).order('codigo'),
    // `lotes!inner` con `tipo = AGRICOLA`: los departamentos
    // administrativos existen para notificar costos de maquinaria a SAP,
    // no para sembrarse. Ofrecerlos en el selector de siembra es lo que
    // llenaba el plan de lotes de 0 mz que nunca se iban a cumplir.
    supabase
      .from('lotes_temporada')
      .select('id, temporada_id, area_neta, lotes!inner(nomenclatura, nombre, tipo), zonas(nombre)')
      .eq('activo', true)
      .eq('lotes.tipo', 'AGRICOLA')
      .eq('temporada_id', temporadaId ?? ''),
  ])

  return {
    variedades: (variedades as Variedad[] | null) ?? [],
    materiales: (materiales as Material[] | null) ?? [],
    lotes: ((lotes as unknown as LoteFila[] | null) ?? [])
      .map((l) => ({
        lote_temporada_id: l.id,
        temporada_id: l.temporada_id,
        nomenclatura: uno(l.lotes)?.nomenclatura ?? '—',
        nombre: uno(l.lotes)?.nombre ?? null,
        zona: uno(l.zonas)?.nombre ?? null,
        area_neta: Number(l.area_neta ?? 0),
      }))
      .sort((a, b) => a.nomenclatura.localeCompare(b.nomenclatura, 'es', { numeric: true })) as LoteOpcion[],
  }
}

type PlanFila = {
  id: string
  lote_temporada_id: string
  ciclo: number
  variedad_id: string
  fecha_siembra: string | null
  area_plan: number
  distancia_siembra: string | null
  lotes_temporada: {
    lotes: { nomenclatura: string; nombre: string | null } | { nomenclatura: string; nombre: string | null }[] | null
    zonas: { nombre: string } | { nombre: string }[] | null
  } | null
  variedades: { nombre: string } | { nombre: string }[] | null
}

export async function leerPlan(temporadaId: string) {
  const supabase = await createClient()
  const { datos, error } = await leerTodo<PlanFila>((desde, hasta) =>
    supabase
      .from('planes_siembra')
      .select(
        'id, lote_temporada_id, ciclo, variedad_id, fecha_siembra, area_plan, distancia_siembra,' +
          ' lotes_temporada(lotes(nomenclatura, nombre), zonas(nombre)), variedades(nombre)'
      )
      .eq('temporada_id', temporadaId)
      .order('id', { ascending: true })
      .range(desde, hasta)
  )

  const filas = (datos as unknown as PlanFila[]).map((p) => ({
    id: p.id,
    lote_temporada_id: p.lote_temporada_id,
    ut: uno(p.lotes_temporada?.lotes ?? null)?.nomenclatura ?? '—',
    lote_nombre: uno(p.lotes_temporada?.lotes ?? null)?.nombre ?? null,
    zona: uno(p.lotes_temporada?.zonas ?? null)?.nombre ?? null,
    ciclo: p.ciclo,
    variedad_id: p.variedad_id,
    variedad: uno(p.variedades)?.nombre ?? '—',
    fecha_siembra: p.fecha_siembra,
    area_plan: Number(p.area_plan),
    distancia_siembra: p.distancia_siembra,
  }))

  filas.sort(
    (a, b) =>
      a.ut.localeCompare(b.ut, 'es', { numeric: true }) ||
      a.ciclo - b.ciclo ||
      a.variedad.localeCompare(b.variedad, 'es')
  )
  return { datos: filas, error }
}

/**
 * Las siembras de la temporada.
 *
 * Sin tope y, en la pantalla, sin recorte de fechas: el filtro «Siembras
 * desde–hasta» se quitó porque la TEMPORADA es el recorte, y esconder el
 * arranque de febrero hacía que el acumulado de la tabla no cuadrara con
 * el del cuadre, que siempre fue de la temporada entera.
 *
 * El `rango` sigue existiendo para el reporte de gerencia, que sí
 * compara un detalle diario acotado contra el acumulado. Pedirlo o no es
 * de quien llama; el tope no vuelve en ninguno de los dos casos: se pide
 * por tramos, porque quitar el `.limit()` no basta —Supabase corta igual
 * en mil filas por respuesta—.
 */
export async function leerSiembras(
  temporadaId: string,
  rango?: { desde: string; hasta: string }
): Promise<Respuesta<FilaSiembra[]>> {
  const supabase = await createClient()
  const { datos, error } = await leerTodo<FilaSiembra>((desde, hasta) => {
    let q = supabase
      .from('v_siembras')
      .select('*')
      .eq('temporada_id', temporadaId)
      .order('fecha_siembra', { ascending: false })
      .order('id', { ascending: false })
      .range(desde, hasta)
    if (rango) q = q.gte('fecha_siembra', rango.desde).lte('fecha_siembra', rango.hasta)
    return q
  })
  return { datos, error }
}

/** Las cuatro consultas de cuadre. Todas comparten forma: plan contra real. */
async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<Respuesta<T[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(nombre, args)
  return { datos: (data as T[] | null) ?? [], error: error?.message ?? null }
}

export const leerAvanceUt = (temporadaId: string, hasta: string | null) =>
  rpc<FilaAvanceUt>('fn_trasplante_por_ut', { p_temporada_id: temporadaId, p_hasta: hasta })

export const leerEstadisticas = (temporadaId: string, hasta: string | null) =>
  rpc<FilaEstadistica>('fn_trasplante_estadisticas', { p_temporada_id: temporadaId, p_hasta: hasta })

export const leerPorVariedad = (temporadaId: string, hasta: string | null) =>
  rpc<FilaVariedad>('fn_trasplante_por_variedad', { p_temporada_id: temporadaId, p_hasta: hasta })

export const leerPorZona = (temporadaId: string, hasta: string | null) =>
  rpc<FilaZona>('fn_trasplante_por_zona', { p_temporada_id: temporadaId, p_hasta: hasta })

export const leerPorSemana = (temporadaId: string, hasta: string | null) =>
  rpc<FilaSemana>('fn_trasplante_por_semana', { p_temporada_id: temporadaId, p_hasta: hasta })

export const leerLiquidacion = (temporadaId: string, hasta: string | null) =>
  rpc<FilaLiquidacion>('fn_trasplante_liquidacion_plantulas', {
    p_temporada_id: temporadaId,
    p_hasta: hasta,
  })

/**
 * Recepción de plántulas de toda la temporada.
 *
 * Sin recorte de fechas: la liquidación compara contra la siembra
 * acumulada, y esconder facturas viejas descuadraría el pendiente.
 */
export async function leerRecepciones(temporadaId: string): Promise<Respuesta<FilaRecepcion[]>> {
  const supabase = await createClient()
  const { datos, error } = await leerTodo<FilaRecepcion>((desde, hasta) =>
    supabase
      .from('v_recepcion_plantulas')
      .select('*')
      .eq('temporada_id', temporadaId)
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
      .range(desde, hasta)
  )
  return { datos, error }
}
