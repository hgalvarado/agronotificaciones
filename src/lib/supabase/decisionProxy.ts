/**
 * Decisión PURA del proxy: ¿cómo se verifica la sesión de esta petición?
 *
 * Sin importaciones: se prueba con `node --test` (pruebas/unit/decision_proxy.test.mjs).
 *
 * Por qué existe: cada precarga (prefetch RSC) de un enlace del menú pasa por el proxy, y cada paso hacía
 * `auth.getUser()` (un viaje a Supabase Auth) → ~30 viajes por carga de página. Una precarga no entrega datos
 * propios de seguridad (los datos los protege RLS y `getUsuarioActual` verifica de nuevo en la página), así que
 * puede confiar en la lectura local del JWT de la cookie, sin red.
 *
 *   · 'validar-local'  → precarga con un access_token que aún no vence: se deja pasar SIN llamar a Supabase.
 *   · 'validar-en-red' → navegación real, o precarga con token vencido: `getClaims()` (verifica local si la
 *                        llave es asimétrica; si hace falta refresca UNA vez y escribe las cookies nuevas).
 *   · 'redirigir'      → precarga sin ninguna sesión: a /login sin tocar Supabase.
 */

export type DecisionProxy = 'validar-local' | 'validar-en-red' | 'redirigir'

type Cabeceras = { get(nombre: string): string | null }
type CookieSimple = { name: string; value: string }

/** Segundos de holgura: un token que vence en menos que esto se trata como vencido (que lo refresque la ruta real). */
export const MARGEN_SEGUNDOS = 15

/** ¿Es una precarga (prefetch) del enrutador y no una navegación real? */
export function esPrefetch(cabeceras: Cabeceras): boolean {
  if (cabeceras.get('next-router-prefetch')) return true
  const purpose = (cabeceras.get('purpose') ?? '').toLowerCase()
  const secPurpose = (cabeceras.get('sec-purpose') ?? '').toLowerCase()
  return purpose.includes('prefetch') || secPurpose.includes('prefetch')
}

function base64UrlATexto(b64url: string): string | null {
  try {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
    const relleno = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const bin = atob(relleno)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * El access_token que va dentro de la cookie de sesión de Supabase (`sb-<ref>-auth-token`, posiblemente partida
 * en `.0`, `.1`…; valor `base64-<json en base64url>` o JSON a secas). null si no hay o no se puede leer.
 */
export function leerTokenDeCookies(cookies: CookieSimple[]): string | null {
  const partes = cookies
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => {
      const na = Number(a.name.split('.')[1] ?? -1)
      const nb = Number(b.name.split('.')[1] ?? -1)
      return na - nb
    })
  if (partes.length === 0) return null
  let valor = partes.map((c) => c.value).join('')
  try {
    if (valor.startsWith('base64-')) {
      const texto = base64UrlATexto(valor.slice('base64-'.length))
      if (texto === null) return null
      valor = texto
    }
    const sesion = JSON.parse(valor) as { access_token?: unknown }
    return typeof sesion.access_token === 'string' ? sesion.access_token : null
  } catch {
    return null
  }
}

/** El `exp` (segundos Unix) del payload de un JWT, sin verificar la firma. null si no se puede leer. */
export function expDelToken(token: string): number | null {
  const trozos = token.split('.')
  if (trozos.length !== 3) return null
  const texto = base64UrlATexto(trozos[1])
  if (texto === null) return null
  try {
    const exp = (JSON.parse(texto) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null
  } catch {
    return null
  }
}

export function decidirProxy(entrada: {
  cabeceras: Cabeceras
  cookies: CookieSimple[]
  /** Segundos Unix actuales (inyectado para poder probar). */
  ahoraSeg: number
}): DecisionProxy {
  if (!esPrefetch(entrada.cabeceras)) return 'validar-en-red'

  const token = leerTokenDeCookies(entrada.cookies)
  if (!token) {
    // Sin ninguna cookie de sesión: a /login sin red. (Si hay cookie pero ilegible, que decida la ruta real.)
    const hayCookie = entrada.cookies.some((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    return hayCookie ? 'validar-en-red' : 'redirigir'
  }

  const exp = expDelToken(token)
  if (exp !== null && exp - entrada.ahoraSeg > MARGEN_SEGUNDOS) return 'validar-local'
  // Vencido o por vencer: NO se entrega nada por confianza; se valida/refresca como una navegación real.
  return 'validar-en-red'
}
