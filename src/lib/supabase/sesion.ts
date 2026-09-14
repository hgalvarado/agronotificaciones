/**
 * Qué hacer cuando la sesión del servidor ya no sirve.
 *
 * El síntoma es este, repetido en cada petición:
 *
 *     AuthApiError: Invalid Refresh Token: Refresh Token Not Found
 *     status: 400  code: 'refresh_token_not_found'
 *
 * Pasa cuando el navegador conserva la cookie de sesión pero el token de
 * refresco que lleva dentro ya no existe en Supabase: la sesión se cerró
 * en otro dispositivo, el proyecto rotó sus llaves, o la cookie viene de
 * otro entorno (la de local abierta contra producción, o al revés).
 *
 * Lo que lo convierte en un problema y no en un tropiezo es que NADIE
 * borra esa cookie: cada petición vuelve a intentar el refresco, vuelve
 * a fallar y vuelve a escribir el error en la terminal, y mientras tanto
 * el servidor cree que no hay usuario y las lecturas salen vacías «sin
 * dar error». Por eso aquí se hacen dos cosas: reconocer el caso y
 * BORRAR las cookies, para que el siguiente intento sea un login limpio
 * en vez del mismo fallo otra vez.
 *
 * Funciones puras salvo la última, que sólo escribe en la respuesta. No
 * consultan nada: eso es del middleware.
 */

import type { NextRequest, NextResponse } from 'next/server'

/** Cómo llama Supabase a sus cookies de sesión. */
const PREFIJO_COOKIE = 'sb-'

/**
 * Los códigos con los que Supabase dice «esta sesión ya no existe».
 *
 * Se comprueban por código y no por el texto del mensaje: el texto
 * cambia entre versiones y está en inglés, el código no.
 */
const CODIGOS_SESION_MUERTA = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'invalid_refresh_token',
  'session_not_found',
  'session_expired',
  'bad_jwt',
])

type ErrorAuth = {
  name?: string
  code?: string
  status?: number
  message?: string
  __isAuthError?: boolean
}

/**
 * Cuando NO hay sesión ninguna —nadie ha entrado todavía— Supabase
 * también contesta con un error de auth y estado 400:
 *
 *     AuthSessionMissingError  { __isAuthError: true, status: 400 }
 *
 * Visto de lejos es idéntico a una sesión caducada, y confundirlos le
 * diría «tu sesión expiró» a quien nunca había entrado. Se separa por el
 * nombre, que es lo único que los distingue.
 */
const SIN_SESION = 'AuthSessionMissingError'

/**
 * ¿Este error significa que hay que volver a entrar?
 *
 * Se distingue de otras dos cosas que se le parecen:
 *
 *   · «No se pudo hablar con Supabase». Un corte de red también deja al
 *     usuario sin sesión en esa petición, pero borrarle las cookies por
 *     eso lo echaría de la aplicación cada vez que el wifi parpadea.
 *   · «Aquí nunca hubo sesión», que es el caso normal de un visitante.
 *
 * Por eso manda el CÓDIGO, que es explícito y no cambia entre versiones;
 * el estado 400 sin código sólo cuenta cuando el navegador traía cookies
 * de sesión, porque entonces sí había algo que se echó a perder.
 */
export function esSesionMuerta(error: unknown, habiaCookies = false): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as ErrorAuth

  if (e.code && CODIGOS_SESION_MUERTA.has(e.code)) return true
  if (e.name === SIN_SESION) return false

  // Sin código: sólo si el navegador traía una sesión que ya no sirve.
  if (habiaCookies && e.__isAuthError && (e.status === 400 || e.status === 401)) return true

  return false
}

/** Las cookies de sesión que trae la petición, por nombre. */
export function cookiesDeSesion(request: NextRequest): string[] {
  return request.cookies
    .getAll()
    .map((c) => c.name)
    .filter((n) => n.startsWith(PREFIJO_COOKIE))
}

/**
 * Borra las cookies de sesión de la respuesta.
 *
 * Se borran TODAS las `sb-*` y no sólo la del token: Supabase parte las
 * sesiones grandes en varias cookies numeradas, y dejar media sesión
 * escrita es exactamente el estado que provoca el error.
 */
export function limpiarSesion(request: NextRequest, response: NextResponse): NextResponse {
  for (const nombre of cookiesDeSesion(request)) {
    response.cookies.set(nombre, '', { path: '/', maxAge: 0 })
    request.cookies.delete(nombre)
  }
  return response
}
