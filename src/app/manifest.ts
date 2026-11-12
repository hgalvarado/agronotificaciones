import type { MetadataRoute } from 'next'

/**
 * Manifiesto de la app instalable (los capturadores y estacioneros la usan desde el teléfono).
 * Solo describe la app: nombre, colores e icono. No cambia cómo funciona ninguna pantalla.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AgroNotificaciones',
    short_name: 'AgroNotif',
    description: 'Control operativo de maquinaria agrícola y fertirriego',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#165C27',
    lang: 'es',
    icons: [{ src: '/marca/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }
}
