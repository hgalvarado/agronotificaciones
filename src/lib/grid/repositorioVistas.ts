'use client'

/**
 * Persistencia de las vistas de tabla.
 *
 * Lo único que habla con `vistas_tabla`. No decide qué columnas se ven
 * —eso es de `vistas`— ni las dibuja: trae, guarda y elimina.
 *
 * Guardar pasa por `fn_guardar_vista_tabla` y no por un `upsert` desde
 * aquí: el estándar de cada pantalla es único, y decidir «¿existe ya?» en
 * el navegador significa que dos pestañas abiertas acaban creando dos.
 */

import { createClient } from '@/lib/supabase/client'
import type { ColumnaVista, VistaTabla } from './vistas'

export async function leerVistas(
  pantalla: string
): Promise<{ vistas: VistaTabla[]; error: string | null }> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('vistas_tabla')
    .select('id, pantalla, nombre, es_estandar, usuario_id, columnas')
    // RLS ya filtra: el estándar lo ve todo el mundo y las personales
    // sólo su dueño. Aquí no hace falta repetir la condición.
    .eq('pantalla', pantalla)
    .order('es_estandar', { ascending: false })
    .order('nombre')

  return {
    vistas: (data as VistaTabla[] | null) ?? [],
    error: error?.message ?? null,
  }
}

export async function guardarVista(
  pantalla: string,
  nombre: string,
  columnas: ColumnaVista[],
  esEstandar: boolean
): Promise<{ id: string | null; error: string | null }> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_guardar_vista_tabla', {
    p_pantalla: pantalla,
    p_nombre: nombre,
    p_columnas: columnas,
    p_es_estandar: esEstandar,
  })
  return { id: (data as string | null) ?? null, error: error?.message ?? null }
}

export async function eliminarVista(id: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  const { error } = await supabase.from('vistas_tabla').delete().eq('id', id)
  return { error: error?.message ?? null }
}
