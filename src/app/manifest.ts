import type { MetadataRoute } from 'next'

/**
 * Manifiesto de la app instalable (los capturadores y estacioneros la usan desde el teléfono).
 * Solo describe la app: nombre, colores e icono. No cambia cómo funciona ninguna pantalla.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AgroNotificaciones',
    short_name: 'AgroNotif',
    description: 'Monitoreo agrícola integral',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#165C27',
    lang: 'es',
    id: '/',
    // PNG 192 y 512 son lo que exigen Chrome/Android para ofrecer «Instalar» y para el icono de la pantalla de inicio;
    // el SVG solo no basta en muchos teléfonos. El «maskable» evita que Android recorte el logo.
    icons: [
      { src: '/marca/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/marca/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/marca/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/marca/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
}
