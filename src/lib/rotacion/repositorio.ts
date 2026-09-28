/**
 * Lectura de la rotación (lado servidor).
 *
 * El único archivo del módulo que habla con Supabase para LEER. Trae
 * datos crudos o un error; no decide ni formatea.
 */

import { createClient } from '@/lib/supabase/server'
import { leerTodo } from '@/lib/supabase/paginar'
import type {
  Estadisticas,
  FilaAvance,
  FilaPlan,
  FilaPorLote,
  FilaPorTipoSiembra,
  FilaPorVariedad,
  FilaPorZona,
  LoteRotacion,
  Producto,
  VariedadRotacion,
} from './tipos'

export type Respuesta<T> = { datos: T; error: string | null }

function uno<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

type LoteFila = {
  id: string
  area_neta: number
  lotes: { nomenclatura: string; nombre: string | null } | { nomenclatura: string; nombre: string | null }[] | null
  zonas: { nombre: string } | { nombre: string }[] | null
}

type VariedadFila = {
  id: string
  nombre: string
  producto_id: string | null
  catalogo_productos: { nombre: string } | { nombre: string }[] | null
}

/**
 * Los tres catálogos que alimenta la pantalla.
 *
 * Los lotes se recortan a `tipo = 'AGRICOLA'`: un departamento
 * administrativo existe para notificar costos de maquinaria a SAP, no
 * para sembrarse. La base también lo impide —el disparador de
 * coherencia—, pero ofrecerlo en el selector sólo consigue que alguien
 * lo intente y reciba un error en la cara.
 */
export async function leerCatalogos(temporadaId: string) {
  const supabase = await createClient()
  const [{ data: variedades }, { data: lotes }, { data: productos }] = await Promise.all([
    supabase
      .from('variedades')
      .select('id, nombre, producto_id, catalogo_productos(nombre)')
      .eq('activo', true)
      .order('nombre'),
    supabase
      .from('lotes_temporada')
      .select('id, area_neta, lotes!inner(nomenclatura, nombre, tipo), zonas(nombre)')
      .eq('activo', true)
      .eq('lotes.tipo', 'AGRICOLA')
      .eq('temporada_id', temporadaId),
    supabase.from('catalogo_productos').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  return {
    variedades: ((variedades as unknown as VariedadFila[] | null) ?? []).map((v) => ({
      id: v.id,
      nombre: v.nombre,
      producto_id: v.producto_id,
      producto: uno(v.catalogo_productos)?.nombre ?? null,
    })) as VariedadRotacion[],
    productos: (productos as Producto[] | null) ?? [],
    lotes: ((lotes as unknown as LoteFila[] | null) ?? [])
      .map((l) => ({
        lote_temporada_id: l.id,
        nomenclatura: uno(l.lotes)?.nomenclatura ?? '—',
        nombre: uno(l.lotes)?.nombre ?? null,
        zona: uno(l.zonas)?.nombre ?? null,
        area_neta: Number(l.area_neta ?? 0),
      }))
      .sort((a, b) =>
        a.nomenclatura.localeCompare(b.nomenclatura, 'es', { numeric: true })
      ) as LoteRotacion[],
  }
}

/**
 * El plan de la temporada, entero.
 *
 * Por tramos y sin `.limit()`: quitar el tope no basta, PostgREST corta
 * igual en mil filas por respuesta y se calla.
 */
export async function leerPlan(temporadaId: string): Promise<Respuesta<FilaPlan[]>> {
  const supabase = await createClient()
  const { datos, error } = await leerTodo<FilaPlan>((desde, hasta) =>
    supabase
      .from('v_rotacion_plan')
      .select('*')
      .eq('temporada_id', temporadaId)
      .order('ut', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)
  )
  return { datos, error }
}

/**
 * El avance diario.
 *
 * `hasta` es la FECHA DE CORTE del tablero: recorta lo real, igual que
 * en el trasplante. El plan de rotación no lleva fecha prevista —se
 * siembra cuando el lote queda libre—, así que el corte sólo mueve lo
 * real y la pantalla lo dice.
 */
export async function leerAvance(
  temporadaId: string,
  hasta: string | null
): Promise<Respuesta<FilaAvance[]>> {
  const supabase = await createClient()
  const { datos, error } = await leerTodo<FilaAvance>((desde, hastaFila) => {
    let q = supabase
      .from('v_rotacion_avance')
      .select('*')
      .eq('temporada_id', temporadaId)
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
      .range(desde, hastaFila)
    if (hasta) q = q.lte('fecha', hasta)
    return q
  })
  return { datos, error }
}

async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<Respuesta<T[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(nombre, args)
  return { datos: (data as T[] | null) ?? [], error: error?.message ?? null }
}

const args = (temporadaId: string, hasta: string | null) => ({
  p_temporada_id: temporadaId,
  p_hasta: hasta,
})

export async function leerEstadisticas(
  temporadaId: string,
  hasta: string | null
): Promise<Respuesta<Estadisticas | null>> {
  const { datos, error } = await rpc<Estadisticas>('fn_rotacion_estadisticas', args(temporadaId, hasta))
  return { datos: datos[0] ?? null, error }
}

export const leerPorVariedad = (temporadaId: string, hasta: string | null) =>
  rpc<FilaPorVariedad>('fn_rotacion_por_variedad', args(temporadaId, hasta))

export const leerPorZona = (temporadaId: string, hasta: string | null) =>
  rpc<FilaPorZona>('fn_rotacion_por_zona', args(temporadaId, hasta))

export const leerPorLote = (temporadaId: string, hasta: string | null) =>
  rpc<FilaPorLote>('fn_rotacion_por_lote', args(temporadaId, hasta))

export const leerPorTipoSiembra = (temporadaId: string, hasta: string | null) =>
  rpc<FilaPorTipoSiembra>('fn_rotacion_por_tipo_siembra', args(temporadaId, hasta))
