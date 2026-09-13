/**
 * Persistencia del trasplante (lado servidor).
 *
 * El único archivo del módulo que habla con Supabase para LEER. Trae
 * datos crudos o un error; no decide ni formatea.
 */

import { createClient } from '@/lib/supabase/server'
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
    supabase
      .from('lotes_temporada')
      .select('id, temporada_id, area_neta, lotes(nomenclatura, nombre), zonas(nombre)')
      .eq('activo', true)
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
  const { data, error } = await supabase
    .from('planes_siembra')
    .select(
      'id, lote_temporada_id, ciclo, variedad_id, fecha_siembra, area_plan, distancia_siembra,' +
        ' lotes_temporada(lotes(nomenclatura, nombre), zonas(nombre)), variedades(nombre)'
    )
    .eq('temporada_id', temporadaId)

  const filas = ((data as unknown as PlanFila[] | null) ?? []).map((p) => ({
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
  return { datos: filas, error: error?.message ?? null }
}

export async function leerSiembras(
  temporadaId: string,
  desde: string,
  hasta: string
): Promise<Respuesta<FilaSiembra[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_siembras')
    .select('*')
    .eq('temporada_id', temporadaId)
    .gte('fecha_siembra', desde)
    .lte('fecha_siembra', hasta)
    .order('fecha_siembra', { ascending: false })
    .limit(5000)
  return { datos: (data as FilaSiembra[] | null) ?? [], error: error?.message ?? null }
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
  const { data, error } = await supabase
    .from('v_recepcion_plantulas')
    .select('*')
    .eq('temporada_id', temporadaId)
    .order('fecha', { ascending: false })
    .limit(5000)
  return { datos: (data as FilaRecepcion[] | null) ?? [], error: error?.message ?? null }
}
