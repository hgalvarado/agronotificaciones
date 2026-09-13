/**
 * Distribución en columnas. Aritmética pura, sin React y sin CSS.
 *
 * Existe porque repartir 36 equipos en columnas es una decisión —cuántas
 * columnas, cuántos por columna— y no un detalle de estilo. Metida dentro
 * del componente, esa decisión no se podría probar sin dibujar la
 * pantalla; aquí es una función que recibe una lista y devuelve listas.
 */

/**
 * Máximo de filas por columna antes de abrir otra.
 *
 * Diez y no veinte: el bloque tiene que caber en el hueco que deja el
 * detalle al final de la hoja. Una columna alta cabe en menos sitios que
 * dos bajas, y el salto de página que se quería evitar vuelve.
 */
export const FILAS_POR_COLUMNA = 10

/**
 * Cuatro. Es lo que cabe en el ancho del pie apaisado sin que el código
 * del equipo salga cortado —cada columna queda en unos 225 px— y es lo
 * que hace que 36 equipos entren en la misma hoja que el detalle. Con
 * tres, el bloque crece a doce filas de alto y se va a la segunda.
 */
export const MAXIMO_COLUMNAS = 4

/**
 * Reparte en columnas equilibradas: con 20 filas salen dos de 10, no una
 * de 12 y otra de 8. Una columna casi vacía al lado de una llena se lee
 * como un error de maquetación.
 */
export function repartirEnColumnas<T>(
  items: T[],
  filasPorColumna: number = FILAS_POR_COLUMNA,
  maximoColumnas: number = MAXIMO_COLUMNAS
): T[][] {
  if (items.length === 0) return []

  const columnas = Math.min(maximoColumnas, Math.max(1, Math.ceil(items.length / filasPorColumna)))
  const porColumna = Math.ceil(items.length / columnas)

  const grupos: T[][] = []
  for (let i = 0; i < items.length; i += porColumna) {
    grupos.push(items.slice(i, i + porColumna))
  }
  return grupos
}
