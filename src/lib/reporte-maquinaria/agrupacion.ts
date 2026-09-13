/**
 * Emparejado entre el detalle y el resumen de horómetros.
 *
 * Aritmética pura, sin React: qué número le toca a cada lectura y dónde
 * termina el bloque de un tractor son reglas, no estilo. Aquí se pueden
 * probar sin dibujar una tabla.
 *
 * La llave de una lectura es la misma con la que la base deduplica el
 * resumen —equipo + horómetro inicial + final—; por eso las dos tablas
 * pueden hablar del mismo número sin compartir un id.
 */

import type { FilaDetalle, FilaHorometro } from './tipos'

/** Una lectura de horómetro, como texto comparable. */
export function claveLectura(
  equipo: string,
  inicial: number | null | undefined,
  final: number | null | undefined
): string {
  return `${equipo}|${inicial ?? ''}|${final ?? ''}`
}

/**
 * Numera el resumen de horómetros en el orden en que se muestra: 1, 2,
 * 3… El detalle luego busca su número por la llave.
 */
export function construirIndice(horometros: FilaHorometro[]): Map<string, number> {
  const indice = new Map<string, number>()
  horometros.forEach((h, i) => {
    indice.set(claveLectura(h.equipo_codigo, h.horometro_inicial, h.horometro_final), i + 1)
  })
  return indice
}

/**
 * El número que le toca a una fila del detalle.
 *
 * `null` cuando no se puede saber: sin la migración 24 el detalle no
 * trae las lecturas, y entonces no se inventa un número —un índice que
 * apunte a la fila equivocada es peor que ninguno—. Con un solo registro
 * del equipo en todo el día sí se puede emparejar por el código, que es
 * el caso más común y no tiene ambigüedad.
 */
export function numeroDeFila(
  fila: FilaDetalle,
  indice: Map<string, number>,
  horometros: FilaHorometro[]
): number | null {
  if (fila.horometro_inicial !== undefined && fila.horometro_final !== undefined) {
    const n = indice.get(
      claveLectura(fila.equipo_codigo, fila.horometro_inicial, fila.horometro_final)
    )
    if (n !== undefined) return n
  }

  const delEquipo = horometros.filter((h) => h.equipo_codigo === fila.equipo_codigo)
  if (delEquipo.length !== 1) return null
  return (
    indice.get(
      claveLectura(
        delEquipo[0].equipo_codigo,
        delEquipo[0].horometro_inicial,
        delEquipo[0].horometro_final
      )
    ) ?? null
  )
}

/**
 * Dónde termina el bloque de un tractor.
 *
 * Devuelve, para cada fila, si es la ÚLTIMA de su bloque: es donde va la
 * línea divisoria. Se compara con la fila siguiente y no con la anterior
 * porque el borde se pinta abajo, y así la última fila de la tabla nunca
 * lleva raya suelta.
 */
export function marcarFinDeBloque(filas: FilaDetalle[]): boolean[] {
  return filas.map((f, i) => {
    const siguiente = filas[i + 1]
    if (!siguiente) return false
    return (
      claveLectura(f.equipo_codigo, f.horometro_inicial, f.horometro_final) !==
      claveLectura(siguiente.equipo_codigo, siguiente.horometro_inicial, siguiente.horometro_final)
    )
  })
}
