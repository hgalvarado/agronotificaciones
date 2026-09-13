/**
 * Traduce cualquier cosa que reviente en un mensaje que se pueda leer.
 *
 * El motivo de existir de este archivo: los errores de Supabase NO son
 * instancias de `Error`, son objetos planos `{ message, code, details,
 * hint }`. Todo el código hacía
 *
 *     catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') }
 *
 * y como `e instanceof Error` daba false, la pantalla mostraba siempre el
 * genérico «No se pudo guardar» y se tragaba la causa real. Henry pasó por
 * eso: el mensaje decía sólo eso y el problema de fondo era una regla de
 * seguridad rechazando el INSERT.
 */

type ErrorPostgrest = {
  message?: string
  code?: string
  details?: string | null
  hint?: string | null
}

/** Códigos de Postgres que conviene explicar en castellano. */
const EXPLICACIONES: Record<string, string> = {
  '23505': 'Ese registro ya existe.',
  '23503': 'Hay movimientos que dependen de este registro, así que no se puede quitar.',
  '23502': 'Falta un dato obligatorio.',
  '23514': 'Un valor no está dentro de lo permitido.',
  '42501': 'No tienes permiso para hacer este cambio.',
  // Lo que devuelve PostgREST cuando RLS deja la operación sin filas.
  '42P01': 'Falta una tabla o vista en la base: seguramente hay una migración sin ejecutar.',
  PGRST116: 'No se encontró el registro, o no tienes permiso para verlo.',
  PGRST204: 'La base no reconoce una de las columnas: seguramente hay una migración sin ejecutar.',
}

export function mensajeDeError(e: unknown, respaldo = 'No se pudo guardar.'): string {
  if (!e) return respaldo

  if (typeof e === 'string') return e

  if (e instanceof Error && e.message) return e.message

  if (typeof e === 'object') {
    const p = e as ErrorPostgrest

    // Un `new row violates row-level security policy` no le dice nada a
    // nadie en campo. Se traduce a lo que realmente pasó.
    if (p.message && /row-level security/i.test(p.message)) {
      return 'La base rechazó el cambio por permisos. Si el ticket ya está cerrado, sólo el Administrador o Torre de Control pueden modificarlo.'
    }

    const piezas: string[] = []
    if (p.code && EXPLICACIONES[p.code]) piezas.push(EXPLICACIONES[p.code])
    if (p.message) piezas.push(p.message)
    if (p.details) piezas.push(p.details)
    if (p.hint) piezas.push(`Sugerencia: ${p.hint}`)

    if (piezas.length > 0) {
      // Se quitan repetidos: a veces `message` y `details` dicen lo mismo.
      return [...new Set(piezas)].join(' ')
    }
  }

  return respaldo
}
