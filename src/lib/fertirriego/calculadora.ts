/**
 * Calculadora de cantidades del campo (piloto 2, punto 6). Pura: sin React y sin eval().
 *
 *   - «bultos × kg por bulto» (9, 12.5, 25, 50, 100…)
 *   - operaciones simples: + − × ÷ con prioridad (× ÷ antes que + −), decimales con punto o coma.
 */

/** Pesos por bulto que se ofrecen con un toque (kg). */
export const PESOS_BULTO = [9, 12.5, 25, 50, 100]

/** Lee un número escrito en el teléfono («12,5», «12.5», « 3 »). Vacío o inválido = null. */
export function leerNumero(texto: string): number | null {
  const t = texto.trim().replace(',', '.')
  if (!t || !/^\d*\.?\d*$/.test(t) || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Redondeo a 4 decimales (lo mismo que guarda la base) sin «0.30000000000000004». */
export function redondear(n: number): number {
  return Math.round(n * 10000) / 10000
}

/** bultos × kg por bulto, o null si falta alguno. */
export function multiplicarBultos(bultos: string, kgPorBulto: string): number | null {
  const b = leerNumero(bultos)
  const k = leerNumero(kgPorBulto)
  if (b === null || k === null) return null
  return redondear(b * k)
}

type Token = { tipo: 'num'; valor: number } | { tipo: 'op'; valor: '+' | '-' | '*' | '/' }

const OPERADORES: Record<string, '+' | '-' | '*' | '/'> = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', x: '*', '/': '/', '÷': '/' }

/** Parte la expresión en números y operadores. Un «−» al principio o tras un operador es el signo del número. */
function tokens(expr: string): Token[] | null {
  const salida: Token[] = []
  let i = 0
  const s = expr.replace(/\s+/g, '')
  while (i < s.length) {
    const c = s[i]
    const op = OPERADORES[c]
    const signo = op === '-' && (salida.length === 0 || salida[salida.length - 1].tipo === 'op')
    if (op && !signo) {
      salida.push({ tipo: 'op', valor: op })
      i++
      continue
    }
    let j = signo ? i + 1 : i
    while (j < s.length && /[\d.,]/.test(s[j])) j++
    const texto = s.slice(signo ? i + 1 : i, j)
    const n = leerNumero(texto)
    if (n === null) return null
    salida.push({ tipo: 'num', valor: signo ? -n : n })
    i = j
  }
  return salida
}

/**
 * Evalúa «12.5 × 4 + 3». Devuelve null si la expresión está incompleta o no es válida, o si divide entre cero.
 * Un operador colgando al final («12 +») se ignora para poder mostrar el resultado mientras se escribe.
 */
export function evaluar(expr: string): number | null {
  const t = tokens(expr)
  if (!t || t.length === 0) return null
  if (t[t.length - 1].tipo === 'op') t.pop()
  if (t.length === 0) return null
  // Debe alternar número, operador, número…
  for (let i = 0; i < t.length; i++) if ((i % 2 === 0) !== (t[i].tipo === 'num')) return null

  // Primero × y ÷ (de izquierda a derecha), después + y −
  const sumandos: number[] = []
  let actual = (t[0] as { valor: number }).valor
  for (let i = 1; i < t.length; i += 2) {
    const op = (t[i] as { valor: string }).valor
    const n = (t[i + 1] as { valor: number }).valor
    if (op === '*') actual *= n
    else if (op === '/') {
      if (n === 0) return null
      actual /= n
    } else {
      sumandos.push(actual)
      actual = op === '-' ? -n : n
    }
  }
  sumandos.push(actual)
  const r = sumandos.reduce((a, b) => a + b, 0)
  return Number.isFinite(r) ? redondear(r) : null
}

/** El texto que se pone en el campo: con punto, sin ceros de más. */
export function textoParaCampo(n: number): string {
  return String(redondear(n))
}
