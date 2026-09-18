'use client'

/**
 * Lo que hace falta leer desde el navegador para crear una labor sin
 * salirse de la pantalla en la que se está.
 *
 * Existe por el caso real: el digitador está capturando la jornada, la
 * labor que hizo el tractor no está en el catálogo, y hasta ahora tenía
 * que irse a Catálogos, crearla, volver y empezar la captura otra vez.
 * Ahora la crea ahí mismo; para eso hay que traer las categorías —que la
 * pantalla de captura no carga, porque no las usa— y volver a leer la
 * labor recién creada con sus tareas y sus códigos físicos, que es lo
 * que la deja utilizable de inmediato.
 *
 * Sólo lee. No decide nada y no toca pantalla.
 */

import { createClient } from '@/lib/supabase/client'
import type { CategoriaLabor } from '@/lib/types'
import type { LaborVinculada } from './tipos'

/** El catálogo de categorías, para el desplegable del alta. */
export async function leerCategoriasLabor(): Promise<CategoriaLabor[]> {
  const { data } = await createClient()
    .from('categorias_labor')
    .select('*')
    .eq('activo', true)
    .order('nombre')
  return (data as CategoriaLabor[] | null) ?? []
}

export type LaborLeida = {
  labor: LaborVinculada
  /** Los vínculos con códigos físicos, en la forma que usa la captura. */
  vinculos: { labor_id: string; implemento_fisico_id: string }[]
}

/**
 * Relee UNA labor con todo lo que la captura necesita de ella.
 *
 * Se relee en vez de armarla con lo que se escribió en el formulario
 * porque la base puede haberle puesto cosas —disparadores, valores por
 * omisión— y porque así la labor nueva y las que ya estaban tienen
 * exactamente la misma forma.
 */
export async function leerLaborCompleta(laborId: string): Promise<LaborLeida | null> {
  const supabase = createClient()

  const [{ data: labor }, { data: vinculos }] = await Promise.all([
    supabase.from('labores').select('*, labores_tareas(tarea_id)').eq('id', laborId).maybeSingle(),
    // Aparte y no incrustado: si la migración 19 no está corrida falla
    // sólo esta consulta y la labor se usa igual, sin códigos físicos.
    supabase
      .from('labores_implementos_fisicos')
      .select('labor_id, implemento_fisico_id')
      .eq('labor_id', laborId),
  ])

  if (!labor) return null

  return {
    labor: labor as LaborVinculada,
    vinculos:
      (vinculos as { labor_id: string; implemento_fisico_id: string }[] | null) ?? [],
  }
}
