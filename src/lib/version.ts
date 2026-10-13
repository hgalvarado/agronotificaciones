/**
 * La versión de la plataforma, en un solo sitio.
 *
 * Sale de `package.json` y no de una constante escrita a mano: una
 * constante aparte se queda vieja el primer día que alguien sube la
 * versión del paquete y se olvida de bajar aquí, y entonces el pie de la
 * portada miente sobre lo que está corriendo.
 *
 * Se lee en tiempo de compilación, así que no cuesta nada en ejecución.
 */

import paquete from '../../package.json'

export const VERSION: string = paquete.version

/** Quien hizo esto. Va en el pie de la portada. */
export const CREADOR = 'Henry Geovanny Alvarado Hernandez'

/** Lo que el sistema hace, en una línea. */
export const LEMA = 'Control operativo de maquinaria agrícola'
