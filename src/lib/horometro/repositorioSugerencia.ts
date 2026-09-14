'use client'

/**
 * Quién manejó por última vez un equipo.
 *
 * Una sola pregunta a la base y nada más: no decide si la sugerencia se
 * aplica ni cómo se enseña, que es cosa del formulario. Va por RPC y no
 * por un `select` sobre `horometros` porque el digitador sólo ve los
 * horómetros de sus propios tickets, y la rotación —el caso que hay que
 * resolver— ocurre justo cuando el equipo lo llevó otra persona.
 */

import { createClient } from '@/lib/supabase/client'

export type OperadorSugerido = {
  id: string
  codigo: string | null
  nombre: string
  /** Cuándo lo manejó. La pantalla la enseña para que se pueda juzgar. */
  fecha: string
}

type Fila = {
  operador_id: string
  operador_codigo: string | null
  operador_nombre: string
  fecha: string
}

/**
 * Devuelve `null` tanto si no hay historial como si la consulta falla.
 *
 * Es a propósito: esto es una comodidad, no un requisito. Si la migración
 * 33 todavía no está corrida —o el equipo es nuevo— la captura tiene que
 * seguir igual de usable, sin un error que no le sirve de nada a quien
 * está en el campo.
 */
export async function ultimoOperadorDeEquipo(equipoId: string): Promise<OperadorSugerido | null> {
  if (!equipoId) return null

  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_ultimo_operador_equipo', {
    p_equipo_id: equipoId,
  })

  if (error) return null

  const fila = (data as Fila[] | null)?.[0]
  if (!fila?.operador_id) return null

  return {
    id: fila.operador_id,
    codigo: fila.operador_codigo,
    nombre: fila.operador_nombre,
    fecha: fila.fecha,
  }
}
