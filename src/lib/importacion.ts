/**
 * Lectura de hojas de Excel: de celdas de texto a valores.
 *
 * Puro: entra una matriz de celdas de texto y sale una lista de filas con
 * sus errores. No toca la base ni React, así que las reglas de «qué
 * columna es cuál» y «esto no es un número» se prueban solas.
 *
 * Los encabezados se reconocen por alias y sin acentos ni mayúsculas: los
 * archivos que él manda vienen de sistemas distintos y nunca escriben la
 * cabecera igual dos veces.
 */

/** Quita acentos, signos y mayúsculas para comparar encabezados. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

/**
 * Lee 1,234.56 y 1.234,56: el decimal es el separador que esté más a la
 * derecha. Sus archivos vienen con los dos formatos.
 */
export function aNumero(bruto: string): number | null {
  const limpio = (bruto ?? '').replace(/[^\d.,-]/g, '')
  if (!limpio) return null
  const normalizado =
    limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '')
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

const MESES: Record<string, string> = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
}

/**
 * Fechas como vienen: ISO, dd/mm/aaaa, «15-ago-2026» o el número de serie
 * de Excel. Devuelve siempre ISO, o `null` si no se entiende.
 */
export function aFecha(bruto: string): string | null {
  const t = (bruto ?? '').trim()
  if (!t) return null

  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)

  const barras = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (barras) {
    const [, d, m, a] = barras
    const anio = a.length === 2 ? `20${a}` : a
    return `${anio}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const conMes = t.match(/^(\d{1,2})[\s/-]*([a-zA-Záéíóú]{3,})[\s/-]*(\d{2,4})$/)
  if (conMes) {
    const [, d, mes, a] = conMes
    const mm = MESES[normalizar(mes).slice(0, 3)]
    if (mm) {
      const anio = a.length === 2 ? `20${a}` : a
      return `${anio}-${mm}-${d.padStart(2, '0')}`
    }
  }

  // Número de serie de Excel: días desde el 30/12/1899.
  const serie = Number(t)
  if (Number.isFinite(serie) && serie > 20000 && serie < 80000) {
    const base = Date.UTC(1899, 11, 30)
    return new Date(base + serie * 86400000).toISOString().slice(0, 10)
  }
  return null
}

/** Una columna esperada en la hoja, con los nombres que puede traer. */
export type ColumnaHoja = { clave: string; alias: string[] }

/**
 * Empareja los encabezados del archivo con las columnas esperadas.
 *
 * Devuelve, para cada columna, en qué posición está —o `-1`— y qué
 * encabezados no reconoció, para poder decírselo al usuario en vez de
 * ignorarlos en silencio.
 */
export function mapearColumnas(
  encabezados: string[],
  columnas: ColumnaHoja[]
): { posiciones: Record<string, number>; ignoradas: string[] } {
  const posiciones: Record<string, number> = {}
  const usadas = new Set<number>()

  for (const col of columnas) {
    const alias = col.alias.map(normalizar)
    const i = encabezados.findIndex(
      (h, idx) => !usadas.has(idx) && alias.includes(normalizar(h))
    )
    posiciones[col.clave] = i
    if (i >= 0) usadas.add(i)
  }

  const ignoradas = encabezados
    .map((h, i) => (usadas.has(i) || !h.trim() ? null : h.trim()))
    .filter((h): h is string => h !== null)

  return { posiciones, ignoradas }
}

/**
 * Busca un catálogo por nombre o código.
 *
 * Acepta «1002-110 · SANTA ROSA» además de «1002-110»: es como sale de la
 * plantilla, y obligar a recortarlo a mano es pedirle al usuario que haga
 * de intérprete.
 */
export function resolver<T>(
  bruto: string,
  opciones: T[],
  etiquetas: (o: T) => string[]
): T | null {
  const buscado = normalizar(bruto)
  if (!buscado) return null

  const exacto = opciones.find((o) => etiquetas(o).some((e) => normalizar(e) === buscado))
  if (exacto) return exacto

  // «1002-110 · SANTA ROSA 110» → se prueba con la primera parte.
  const primeraParte = normalizar(bruto.split(/[·|]/)[0] ?? '')
  if (primeraParte) {
    const porParte = opciones.find((o) => etiquetas(o).some((e) => normalizar(e) === primeraParte))
    if (porParte) return porParte
  }

  // Último recurso: que el texto contenga inequívocamente una etiqueta.
  const candidatos = opciones.filter((o) =>
    etiquetas(o).some((e) => normalizar(e) !== '' && buscado.includes(normalizar(e)))
  )
  return candidatos.length === 1 ? candidatos[0] : null
}
