/**
 * Dónde cae un panel flotante anclado a un botón.
 *
 * Los tres paneles del sistema —el filtro de columna, el selector de una
 * celda y el selector múltiple— ya se dibujan con `createPortal` sobre
 * `document.body` y `position: fixed`, así que el `overflow` de la tabla
 * no los recorta. Pero los tres calculaban su sitio igual:
 *
 *     top = caja.bottom + 6
 *
 * y eso no mira hacia abajo. Un encabezado en la mitad inferior de la
 * pantalla —o el selector de la única fila de una tabla corta, que queda
 * pegado al pie— abría su panel POR DEBAJO del borde de la ventana:
 * visible en el DOM, inalcanzable con el dedo. En un teléfono de 844 px
 * pasa con casi cualquier tabla.
 *
 * Aquí está la cuenta, una sola vez:
 *
 *   · Se intenta abajo. Si no cabe, se voltea ARRIBA del botón, que es
 *     lo que hace cualquier menú del sistema operativo.
 *   · Si tampoco cabe arriba, se queda en el lado con más espacio y el
 *     panel se encoge —`maxAlto`— con su propio desplazamiento dentro.
 *     Encogerse es feo; quedar fuera de la pantalla es inservible.
 *   · A lo ancho se recorta igual que antes, contra los dos bordes.
 *
 * Puro: recibe medidas y devuelve medidas. No toca el DOM ni React, así
 * que se prueba sin navegador.
 */

export type Caja = { left: number; top: number; right: number; bottom: number; width: number }

export type Ventana = { ancho: number; alto: number }

export type Anclaje = {
  left: number
  top: number
  ancho: number
  /** Tope de altura del panel. Siempre cabe en la ventana. */
  maxAlto: number
  /** `true` cuando se volteó por encima del botón. Para la animación. */
  arriba: boolean
}

/** Aire entre el panel y el borde de la ventana, y entre panel y botón. */
const MARGEN = 8
const SEPARACION = 6

/** Por debajo de esto un panel no sirve de nada aunque quepa. */
const ALTO_MINIMO = 140

export function anclarPanel(
  caja: Caja,
  ventana: Ventana,
  opciones: { ancho: number; altoDeseado?: number } = { ancho: 260 }
): Anclaje {
  const ancho = Math.min(opciones.ancho, ventana.ancho - MARGEN * 2)
  const left = Math.max(MARGEN, Math.min(caja.left, ventana.ancho - ancho - MARGEN))

  const espacioAbajo = ventana.alto - caja.bottom - SEPARACION - MARGEN
  const espacioArriba = caja.top - SEPARACION - MARGEN
  const deseado = opciones.altoDeseado ?? 320

  // Abajo por omisión: es donde la gente espera que se abra un
  // desplegable, y voltear sin necesidad desorienta.
  if (espacioAbajo >= Math.min(deseado, ALTO_MINIMO)) {
    return {
      left,
      top: caja.bottom + SEPARACION,
      ancho,
      maxAlto: Math.max(ALTO_MINIMO, espacioAbajo),
      arriba: false,
    }
  }

  // No cabe abajo: se voltea arriba si allí hay sitio.
  if (espacioArriba >= Math.min(deseado, ALTO_MINIMO)) {
    const alto = Math.min(deseado, espacioArriba)
    return {
      left,
      top: Math.max(MARGEN, caja.top - SEPARACION - alto),
      ancho,
      maxAlto: alto,
      arriba: true,
    }
  }

  // No cabe en ninguno de los dos lados —ventana muy baja, teclado del
  // teléfono abierto—: se elige el lado con más aire y el panel se
  // encoge con su propio desplazamiento.
  if (espacioArriba > espacioAbajo) {
    const alto = Math.max(ALTO_MINIMO, espacioArriba)
    return {
      left,
      top: Math.max(MARGEN, caja.top - SEPARACION - alto),
      ancho,
      maxAlto: alto,
      arriba: true,
    }
  }

  return {
    left,
    top: caja.bottom + SEPARACION,
    ancho,
    maxAlto: Math.max(ALTO_MINIMO, espacioAbajo),
    arriba: false,
  }
}

/** La misma cuenta, partiendo de un elemento real del navegador. */
export function anclarA(
  elemento: Element,
  opciones: { ancho: number; altoDeseado?: number }
): Anclaje {
  const r = elemento.getBoundingClientRect()
  return anclarPanel(
    { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
    { ancho: window.innerWidth, alto: window.innerHeight },
    opciones
  )
}
