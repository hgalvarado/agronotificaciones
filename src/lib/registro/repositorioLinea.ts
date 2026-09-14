'use client'

/**
 * Escritura de UNA línea de labor desde el navegador.
 *
 * Una «línea» es un lote dentro de una labor. La tarea, la labor y el
 * implemento viven en `registros` —que puede tener varios lotes colgando—,
 * así que cambiarlos desde aquí con un `update` normal se los cambiaría a
 * TODOS los lotes del mismo ticket.
 *
 * Por eso no hay `update` aquí: se llama a `fn_editar_linea_labor`, que
 * separa la línea a un registro propio cuando hace falta y vuelve a
 * prorratear el horómetro, todo en una transacción. Hacerlo por partes
 * desde el navegador dejaría la línea mudada y las horas sin repartir.
 */

import { createClient } from '@/lib/supabase/client'

export type CampoLinea =
  | 'labor_id'
  | 'tarea_id'
  | 'implemento_fisico_id'
  | 'avance_mz'
  | 'lote_temporada_id'

export async function editarLinea(
  detalleId: string,
  campo: CampoLinea,
  valor: unknown
): Promise<{ error: string | null }> {
  const supabase = createClient()

  const args: Record<string, unknown> = { p_detalle_id: detalleId }
  switch (campo) {
    case 'labor_id':
      args.p_labor_id = valor
      break
    case 'tarea_id':
      args.p_tarea_id = valor
      break
    case 'implemento_fisico_id':
      // Vaciar el implemento no es «no lo toques»: es quitarlo, y en una
      // llamada con parámetros opcionales eso hay que decirlo aparte.
      // Con un código puesto, la función deduce el tipo SAP ella sola.
      if (valor === null || valor === '') args.p_quitar_implemento = true
      else args.p_implemento_fisico_id = valor
      break
    case 'avance_mz':
      args.p_avance_mz = valor
      break
    case 'lote_temporada_id':
      args.p_lote_temporada_id = valor
      break
  }

  const { error } = await supabase.rpc('fn_editar_linea_labor', args)
  return { error: error?.message ?? null }
}

/** Eliminar líneas sueltas, y las labores que se quedan sin lotes. */
export async function eliminarLineas(
  detalleIds: string[],
  registrosCompletos: string[]
): Promise<{ error: string | null }> {
  const supabase = createClient()

  // Primero las labores completas, que arrastran sus líneas en cascada.
  if (registrosCompletos.length > 0) {
    const { error } = await supabase.from('registros').delete().in('id', registrosCompletos)
    if (error) return { error: error.message }
  }
  if (detalleIds.length > 0) {
    const { error } = await supabase.from('registro_detalle').delete().in('id', detalleIds)
    if (error) return { error: error.message }
  }
  return { error: null }
}
