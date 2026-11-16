/**
 * Ubicación PRECISA de la calicata (se instala una vez por ciclo y no se mueve). En AppSheet se tomaba una sola
 * lectura y a veces salía mal. Aquí se escucha el GPS varios segundos y se queda con la lectura MÁS precisa
 * (menor radio en metros). Para antes si llega a la meta. El GPS funciona sin internet.
 */

export type Medicion = { latitud: number; longitud: number; precision_m: number; lecturas: number }

export function medirCalicata(
  { meta = 5, tope = 25000, alAvanzar }: { meta?: number; tope?: number; alAvanzar?: (m: Medicion) => void } = {},
): Promise<Medicion> {
  return new Promise((resolver, rechazar) => {
    if (!('geolocation' in navigator)) { rechazar(new Error('Este teléfono no tiene GPS disponible.')); return }
    let mejor: Medicion | null = null
    let lecturas = 0
    const terminar = () => {
      navigator.geolocation.clearWatch(id)
      clearTimeout(reloj)
      if (mejor) resolver(mejor)
      else rechazar(new Error('El GPS no respondió. Sal a cielo abierto y vuelve a intentar.'))
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        lecturas++
        const m = { latitud: pos.coords.latitude, longitud: pos.coords.longitude, precision_m: Math.round(pos.coords.accuracy * 10) / 10, lecturas }
        if (!mejor || m.precision_m < mejor.precision_m) mejor = m
        else mejor = { ...mejor, lecturas }
        alAvanzar?.(mejor)
        if (mejor.precision_m <= meta) terminar()
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          navigator.geolocation.clearWatch(id)
          clearTimeout(reloj)
          rechazar(new Error('El permiso de ubicación está bloqueado. Actívalo en el navegador para esta página.'))
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: tope },
    )
    const reloj = setTimeout(terminar, tope)
  })
}

/** Etiqueta de calidad para la precisión (metros). */
export function calidad(precision: number): { texto: string; tono: 'verde' | 'ambar' | 'rojo' } {
  if (precision <= 5) return { texto: 'Muy buena', tono: 'verde' }
  if (precision <= 15) return { texto: 'Aceptable', tono: 'ambar' }
  return { texto: 'Baja: mide otra vez a cielo abierto', tono: 'rojo' }
}

/** Foto del teléfono comprimida (lado mayor 1280 px, JPEG 0.7): ~100–200 KB, cabe en la cola sin señal. */
export async function comprimirFoto(archivo: File, lado = 1280, calidadJpeg = 0.7): Promise<string> {
  const imagen = await createImageBitmap(archivo)
  const escala = Math.min(1, lado / Math.max(imagen.width, imagen.height))
  const lienzo = document.createElement('canvas')
  lienzo.width = Math.round(imagen.width * escala)
  lienzo.height = Math.round(imagen.height * escala)
  lienzo.getContext('2d')!.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
  imagen.close()
  return lienzo.toDataURL('image/jpeg', calidadJpeg)
}
