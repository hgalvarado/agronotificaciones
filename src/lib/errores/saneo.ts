/**
 * Saneamiento de lo que se manda a la bitácora (puro, sin dependencias). La base vuelve a sanear (sql/118), pero
 * aquí se hace ANTES de guardar en el teléfono: contraseñas, tokens, cookies y llaves nunca salen del navegador.
 */

const CLAVE_SECRETA = /(pass|contrase|secret|secreto|token|cookie|authorization|apikey|api_key|llave|jwt|session|sesion)/i

export function sanearTexto(valor: unknown, max = 1000): string {
  let s = typeof valor === 'string' ? valor : valor == null ? '' : String(valor)
  s = s
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[token]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [oculto]')
    .replace(/((password|contrase[nñ]a|passwd|secret|secreto|apikey|api_key|access_token|refresh_token|authorization|cookie)\s*[=:]\s*)[^\s,;&"']+/gi, '$1[oculto]')
  return s.length > max ? s.slice(0, max) : s
}

/** Copia profunda sin claves sensibles, con profundidad, anchura y tamaño acotados. */
export function sanear(valor: unknown, nivel = 0): unknown {
  if (valor == null) return null
  if (nivel > 4) return '[…]'
  if (typeof valor === 'string') return sanearTexto(valor, 1500)
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor
  if (valor instanceof Error) return { nombre: valor.name, mensaje: sanearTexto(valor.message, 600), pila: acortarPila(valor.stack) }
  if (Array.isArray(valor)) return valor.slice(0, 30).map((x) => sanear(x, nivel + 1))
  if (typeof valor === 'object') {
    const out: Record<string, unknown> = {}
    let n = 0
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (++n > 40) break
      out[k.slice(0, 60)] = CLAVE_SECRETA.test(k) ? '[oculto]' : sanear(v, nivel + 1)
    }
    return out
  }
  return null
}

/** Las primeras líneas de la pila, sin direcciones con parámetros. */
export function acortarPila(pila: string | undefined | null, lineas = 8): string {
  if (!pila) return ''
  return sanearTexto(pila.split('\n').slice(0, lineas).join('\n').replace(/\?[^\s):]*/g, ''), 1500)
}

/** Mensaje sin números ni UUID: el mismo error con otros datos cae en la misma huella. */
export function normalizarMensaje(m: string): string {
  return m
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#')
    .replace(/[0-9]+/g, '#')
    .trim()
}

/** Huella corta (FNV-1a) del tipo de error, para agrupar repeticiones en la cola local. */
export function huellaLocal(origen: string, modulo: string | null | undefined, ruta: string | null | undefined, codigo: string | null | undefined, mensaje: string): string {
  const base = [origen, modulo ?? '', normalizarMensaje(ruta ?? ''), codigo ?? '', normalizarMensaje(mensaje)].join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Ruido del navegador que no es un defecto de la aplicación. */
export function esRuido(mensaje: string): boolean {
  return /ResizeObserver loop|Script error\.?$|Non-Error promise rejection captured|chrome-extension|moz-extension|safari-extension/i.test(mensaje)
}
