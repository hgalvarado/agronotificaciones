'use client'

/**
 * Lectura del historial de tickets desde el navegador.
 *
 * Tres llamadas y ninguna decisión: el árbol, una página de un bloque y
 * los nombres para el filtro. Las tres son funciones de la base sin
 * `security definer`, así que la RLS de `tickets` sigue mandando y aquí
 * no hay una sola regla de permisos que se pueda quedar desfasada.
 *
 * La paginación es por LLAVE: se manda la última fila entregada como
 * cursor. Con `offset` grande Postgres recorre y descarta todo lo
 * anterior en cada página, y un ticket nuevo desplazaría la lista
 * haciendo que uno se repita o se salte.
 */

import { createClient } from '@/lib/supabase/client'
import type { BloqueTickets, Capturador, FilaTicket, FiltrosTickets } from './tipos'

/** El cursor de una página: la última fila que se entregó. */
export type Cursor = { fecha: string; id: string } | null

const lista = (v: string[]) => (v.length > 0 ? v : null)
const texto = (v: string) => (v.trim() === '' ? null : v.trim())

export async function leerResumen(
  f: FiltrosTickets
): Promise<{ bloques: BloqueTickets[]; error: string | null }> {
  const { data, error } = await createClient().rpc('fn_tickets_resumen', {
    p_meses: lista(f.meses),
    p_usuarios: lista(f.usuarios),
    p_procesos: lista(f.procesos),
    p_estados: lista(f.estados),
    p_busqueda: texto(f.busqueda),
  })

  if (error) return { bloques: [], error: error.message }
  return { bloques: (data as BloqueTickets[] | null) ?? [], error: null }
}

export async function leerPagina(
  mes: string,
  proceso: string,
  f: FiltrosTickets,
  cursor: Cursor,
  limite = 40
): Promise<{ filas: FilaTicket[]; error: string | null }> {
  const { data, error } = await createClient().rpc('fn_tickets_pagina', {
    p_mes: mes,
    p_proceso: proceso,
    p_usuarios: lista(f.usuarios),
    p_estados: lista(f.estados),
    p_busqueda: texto(f.busqueda),
    p_limite: limite,
    p_cursor_fecha: cursor?.fecha ?? null,
    p_cursor_id: cursor?.id ?? null,
  })

  if (error) return { filas: [], error: error.message }
  return { filas: (data as FilaTicket[] | null) ?? [], error: null }
}

export async function leerCapturadores(): Promise<Capturador[]> {
  const { data } = await createClient().rpc('fn_tickets_capturadores')
  return (data as Capturador[] | null) ?? []
}

/** El cursor que corresponde a lo último que se trajo. */
export function cursorDe(filas: FilaTicket[]): Cursor {
  const ultima = filas[filas.length - 1]
  return ultima ? { fecha: ultima.fecha, id: ultima.id } : null
}
