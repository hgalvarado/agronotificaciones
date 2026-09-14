import type { Metadata, Viewport } from 'next'
import './globals.css'
import { cookies } from 'next/headers'
import { CLAVE_TEMA, GUION_TEMA, temaDeCookies } from '@/lib/tema/tema'

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // La cookie llega con la petición, así que el servidor ya puede pintar
  // el tema. El guion del `<head>` sigue ahí para el caso «Automático»,
  // que depende del sistema operativo y eso el servidor no lo sabe.
  const guardado = temaDeCookies((await cookies()).get(CLAVE_TEMA)?.value)
  const temaInicial = guardado === 'oscuro' ? 'oscuro' : guardado === 'claro' ? 'claro' : undefined

  return (
    // `suppressHydrationWarning` porque el guion de abajo escribe
    // `data-tema` antes de que React llegue: el servidor no puede saber
    // qué tema tiene guardado este navegador, y sin esto React avisaría
    // de una diferencia que es justamente la que queremos.
    <html
      lang="es"
      data-tema={temaInicial}
      style={temaInicial ? { colorScheme: temaInicial === 'oscuro' ? 'dark' : 'light' } : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* Corre ANTES de pintar: sin él, el primer cuadro sale en blanco
            y después salta a oscuro. Un fogonazo blanco a las cinco de la
            mañana en el campo deslumbra de verdad. */}
        <script dangerouslySetInnerHTML={{ __html: GUION_TEMA }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  )
}
