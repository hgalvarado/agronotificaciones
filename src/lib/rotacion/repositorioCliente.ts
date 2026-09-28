'use client'

/**
 * Escrituras de la rotación desde el navegador.
 *
 * El único sitio del módulo que escribe. No valida ni decide: recibe
 * valores ya limpios y los manda. Está separado de `repositorio.ts`
 * —que lee en el servidor— porque usan clientes distintos y en Next un
 * archivo no puede ser las dos cosas.
 *
 * Aquí NO se manda `temporada_id` ni `usuario_id`: los pone la base a
 * partir del lote y de la sesión. Mandarlos desde el navegador permitiría
 * guardar una línea en una temporada y apuntando a un lote de otra, y esa
 * línea no aparecería en ningún resumen sin que nadie supiera por qué.
 */

import { createClient } from '@/lib/supabase/client'

type Resultado = { error: string | null }

const err = (e: { message: string } | null): Resultado => ({ error: e?.message ?? null })

/* -------------------------------- Plan ------------------------------- */

export type CamposPlan = {
  lote_temporada_id?: string
  variedad_id?: string
  area_planificada_mz?: number | null
  dosis_mz?: number | null
  umb?: string | null
  observaciones?: string | null
}

export async function crearPlan(fila: CamposPlan & { temporada_id: string }): Promise<Resultado> {
  const { error } = await createClient().from('rotacion_plan').insert(fila)
  return err(error)
}

export async function guardarPlan(id: string, campos: CamposPlan): Promise<Resultado> {
  const { error } = await createClient().from('rotacion_plan').update(campos).eq('id', id)
  return err(error)
}

export async function borrarPlan(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return { error: null }
  const { error } = await createClient().from('rotacion_plan').delete().in('id', ids)
  return err(error)
}

/* ------------------------------- Avance ------------------------------ */

export type CamposAvance = {
  fecha?: string
  lote_temporada_id?: string
  variedad_id?: string
  avance_mz?: number | null
  gasto_semilla?: number | null
  umb?: string | null
  tipo_siembra?: string
  costo_tipo_siembra_mz?: number | null
  observaciones?: string | null
}

export async function crearAvance(
  fila: CamposAvance & { temporada_id: string }
): Promise<Resultado> {
  const { error } = await createClient().from('rotacion_avance').insert(fila)
  return err(error)
}

export async function guardarAvance(id: string, campos: CamposAvance): Promise<Resultado> {
  const { error } = await createClient().from('rotacion_avance').update(campos).eq('id', id)
  return err(error)
}

export async function borrarAvance(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return { error: null }
  const { error } = await createClient().from('rotacion_avance').delete().in('id', ids)
  return err(error)
}

/* ----------------------------- Catálogos ----------------------------- */

/**
 * Crear un cultivo o una variedad sin salir de la celda.
 *
 * Devuelve el id para que el selector lo deje elegido. A media captura,
 * ir a Catálogos y volver es perder lo que ya se llevaba escrito.
 */
export async function crearProducto(nombre: string): Promise<string> {
  const { data, error } = await createClient()
    .from('catalogo_productos')
    .insert({ nombre: nombre.trim() })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return String((data as { id: string }).id)
}

export async function crearVariedad(nombre: string, productoId?: string | null): Promise<string> {
  const { data, error } = await createClient()
    .from('variedades')
    .insert({ nombre: nombre.trim(), producto_id: productoId ?? null })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return String((data as { id: string }).id)
}
