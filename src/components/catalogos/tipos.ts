/**
 * El contrato de un catálogo: qué tabla es, qué columnas tiene y qué
 * filas trae. Lo arma la página en el servidor y lo consumen el menú y la
 * cuadrícula.
 *
 * Vive aparte de los dos para que ninguno tenga que importar al otro sólo
 * por el tipo.
 */

import type { CampoCatalogo } from './CatalogoTable'
import type { RelacionCatalogo } from './ImportarExcel'

export type PestanaCatalogo = {
  key: string
  label: string
  tabla: string
  campos: CampoCatalogo[]
  filas: Record<string, string | number | boolean | null>[]
  /** Campo natural con el que el importador reconoce filas repetidas. */
  clave?: string
  /** Vinculaciones de muchos a muchos que el importador puede cargar. */
  relaciones?: RelacionCatalogo[]
}
