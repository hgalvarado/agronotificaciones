import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // El manifiesto y el service worker SON públicos (no llevan datos): el navegador los pide sin sesión, y si el
    // La ruta de despacho de avisos push tampoco lleva sesión: la protege su secreto (x-despacho-secreto).
    // proxy los mandaba a /login el teléfono recibía una página en vez del manifiesto y no ofrecía «Instalar».
    '/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|api/push/despachar|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|txt|xml)$).*)',
  ],
}
