/**
 * Código de relevo tipo autenticador (TOTP, RFC 6238: HMAC-SHA1, 30 s, 6 dígitos), igual al de la base
 * (fn_fert_totp, sql/91). Funciona SIN internet:
 *   - quien entrega MUESTRA su código, calculado con SU llave;
 *   - quien recibe lo escribe y su teléfono lo VERIFICA con la llave del compañero (como el servidor de un banco).
 * Las llaves se guardan como CryptoKey NO exportable: la app las usa, pero nadie puede leerlas ni copiarlas.
 */

export const PASO_SEGUNDOS = 30

function deBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Llave HMAC-SHA1 no exportable a partir del secreto que entrega la base (base64). */
export async function importarLlave(secretoBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', deBase64(secretoBase64) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
}

/** Llave desde bytes crudos (pruebas). */
export async function importarLlaveBytes(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
}

export function pasoDe(ms: number): number {
  return Math.floor(ms / 1000 / PASO_SEGUNDOS)
}

export async function codigoEn(llave: CryptoKey, paso: number): Promise<string> {
  const contador = new ArrayBuffer(8)
  const vista = new DataView(contador)
  vista.setUint32(0, Math.floor(paso / 2 ** 32))
  vista.setUint32(4, paso >>> 0)
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', llave, contador))
  const o = h[19] & 15
  const v = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(v % 1_000_000).padStart(6, '0')
}

/** Segundos que le quedan al código actual. */
export function segundosRestantes(ms = Date.now()): number {
  return PASO_SEGUNDOS - (Math.floor(ms / 1000) % PASO_SEGUNDOS)
}

export type LlavePersona = { perfil_id: string; nombre: string; llave: CryptoKey }

/*
 * Código de ENTREGA de 12 horas (relevo de noche, sql/99): quien entrega se va antes de que llegue el compañero.
 * Igual que el de 30 s pero con pasos de 10 minutos, contador 2^40 + paso (nunca coincide con un código de 30 s) y
 * 8 dígitos. Se calcula con el paso de la hora de entrega; vale 72 pasos (12 horas). Lo verifica la base con
 * fn_fert_codigo_largo_valido.
 */
export const PASO_LARGO_SEGUNDOS = 600
export const PASOS_VALIDEZ_LARGO = 72

export function pasoLargoDe(ms: number): number {
  return Math.floor(ms / 1000 / PASO_LARGO_SEGUNDOS)
}

export async function codigoLargoEn(llave: CryptoKey, paso: number): Promise<string> {
  const contador = new ArrayBuffer(8)
  const vista = new DataView(contador)
  vista.setUint32(0, 256 + Math.floor(paso / 2 ** 32)) // 2^40 = 256 · 2^32
  vista.setUint32(4, paso >>> 0)
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', llave, contador))
  const o = h[19] & 15
  const v = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(v % 100_000_000).padStart(8, '0')
}

/** Hasta cuándo vale un código de entrega generado en `ms` (inicio de su paso + 12 h). */
export function venceCodigoLargo(ms: number): number {
  return (pasoLargoDe(ms) + PASOS_VALIDEZ_LARGO + 1) * PASO_LARGO_SEGUNDOS * 1000
}

/** ¿De quién es este código de entrega? (generado en las últimas 12 horas). Un código inválido NUNCA pasa. */
export async function verificarCodigoLargo(
  codigo: string,
  llaves: LlavePersona[],
  yoId: string,
  ms = Date.now()
): Promise<LlavePersona | null> {
  if (!/^\d{8}$/.test(codigo)) return null
  const paso = pasoLargoDe(ms)
  for (const l of llaves) {
    if (l.perfil_id === yoId) continue
    for (let d = 1; d >= -PASOS_VALIDEZ_LARGO; d--) {
      if ((await codigoLargoEn(l.llave, paso + d)) === codigo) return l
    }
  }
  return null
}

/**
 * ¿De quién es este código ahora? Busca entre las llaves de los compañeros (no la propia), con ±1 paso de
 * tolerancia (relojes un poco distintos). Devuelve la persona o null. Un código inválido NUNCA pasa.
 */
export async function verificarCodigo(
  codigo: string,
  llaves: LlavePersona[],
  yoId: string,
  ms = Date.now()
): Promise<LlavePersona | null> {
  if (!/^\d{6}$/.test(codigo)) return null
  const paso = pasoDe(ms)
  for (const l of llaves) {
    if (l.perfil_id === yoId) continue
    for (const d of [0, -1, 1]) {
      if ((await codigoEn(l.llave, paso + d)) === codigo) return l
    }
  }
  return null
}
