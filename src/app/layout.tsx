import type { Metadata, Viewport } from 'next'
import './globals.css'

// Nota: se usa la pila de fuentes del sistema en vez de next/font/google
// a propósito. Descargar Inter desde Google Fonts hace que el `build`
// falle en cualquier red que bloquee fonts.googleapis.com (típico en red
// corporativa), y las fuentes nativas de Windows 11 / macOS / Android se
// ven igual de bien y cargan al instante. La pila está en globals.css.

export const metadata: Metadata = {
  title: 'AgroNotificaciones',
  description: 'Control operativo de maquinaria agrícola',
  // La misma ruta que usa el componente `Logo`: un solo archivo para la
  // pestaña del navegador, el icono de la pantalla de inicio y la
  // cabecera. Si todavía no está, el navegador cae a /favicon.ico.
  icons: {
    icon: '/marca/logo.svg',
    shortcut: '/marca/logo.svg',
    apple: '/marca/logo.svg',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#15803d',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  )
}
