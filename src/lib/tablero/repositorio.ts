'use client'

/**
 * Persistencia del tablero. La ÚNICA capa que habla con Supabase aquí.
 *
 * Devuelve datos crudos o un error; no decide nada, no formatea nada y
 * no agrupa nada. Las tres consultas comparten argumentos a propósito:
 * si el avance, el corte por zona y la cuadrícula no se pidieran con los
 * mismos filtros, los totales de las tres tarjetas no cuadrarían entre
 * sí y nadie sabría cuál creer.
 */

import { createClient } from '@/lib/supabase/client'
import type { FilaLabor, FilaLote, FilaZona, Filtros } from './tipos'

/** Los argumentos que esperan las tres funciones del tablero. */
export function argumentos(f: Filtros) {
  return {
    p_temporada_id: f.temporada,
    // Vacío significa «todas», y eso se dice con null: mandar la lista
    // completa obligaría a la pantalla a conocer el catálogo entero.
    p_zona_ids: f.zonas.length > 0 ? f.zonas : null,
    p_lote_temporada_id: f.lote || null,
    p_ciclos: f.ciclos.length > 0 ? f.ciclos : null,
    p_labor_id: f.labor || null,
    p_categoria_labor_id: f.categoria || null,
    p_desde: f.desde || null,
    p_hasta: f.hasta || null,
  }
}

export type Tablero = {
  porLabor: FilaLabor[]
  porZona: FilaZona[]
  porLote: FilaLote[]
  error: string | null
}

export async function leerTablero(filtros: Filtros): Promise<Tablero> {
  const supabase = createClient()
  const args = argumentos(filtros)

  const [avance, zona, lote] = await Promise.all([
    supabase.rpc('fn_tablero_avance', args),
    supabase.rpc('fn_tablero_por_zona', args),
    supabase.rpc('fn_tablero_por_lote', args),
  ])

  const error = avance.error ?? zona.error ?? lote.error
  if (error) return { porLabor: [], porZona: [], porLote: [], error: error.message }

  return {
    porLabor: (avance.data as FilaLabor[] | null) ?? [],
    porZona: (zona.data as FilaZona[] | null) ?? [],
    porLote: (lote.data as FilaLote[] | null) ?? [],
    error: null,
  }
}
