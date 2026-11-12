/*
 * Service worker de AgroNotificaciones · Fertirriego (Etapa B).
 *
 * Alcance mínimo, a propósito (la plataforma está en producción):
 *   - Se instala SOLO cuando alguien abre /fertirriego.
 *   - Guarda la pantalla /fertirriego y los archivos estáticos de Next (/_next/static, con huella en el nombre:
 *     nunca cambian, guardarlos es seguro) para que la app de campo abra SIN SEÑAL.
 *   - Cualquier otra página va a la red exactamente como siempre. Solo si NO hay red y se intenta abrir otra
 *     página, lleva a /fertirriego (si está guardada), que es la que funciona sin señal.
 *   - No toca peticiones a Supabase (otro dominio) ni nada que no sea GET.
 * Los datos de campo NO viven aquí: viven en IndexedDB (lib/fertirriego/almacenLocal.ts).
 */

const VERSION = 'v1'
const PAGINAS = `agn-fert-paginas-${VERSION}`
const ESTATICOS = `agn-fert-estaticos-${VERSION}`
const CAMPO = '/fertirriego'
const ESPERA_RED_MS = 4000

/** La pantalla de campo y los archivos que ella pide (scripts y estilos). */
async function guardarCampo(respuesta) {
  const cache = await caches.open(PAGINAS)
  await cache.put(CAMPO, respuesta.clone())
  const html = await respuesta.text()
  const archivos = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]))]
  const estaticos = await caches.open(ESTATICOS)
  await Promise.all(
    archivos.map(async (url) => {
      if (await estaticos.match(url)) return
      try {
        const r = await fetch(url)
        if (r.ok) await estaticos.put(url, r)
      } catch {
        /* sin red: se guardará la próxima vez */
      }
    })
  )
}

/** Respuesta buena de la pantalla de campo (no una redirección al login, no un error). */
function esCampoValido(r) {
  return r && r.ok && !r.redirected && new URL(r.url).pathname === CAMPO
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      try {
        const r = await fetch(CAMPO, { credentials: 'include' })
        if (esCampoValido(r)) await guardarCampo(r)
      } catch {
        /* sin red al instalar: se guarda en la próxima visita */
      }
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(nombres.filter((n) => n.startsWith('agn-fert-') && n !== PAGINAS && n !== ESTATICOS).map((n) => caches.delete(n)))
      await self.clients.claim()
    })()
  )
})

function conLimite(promesa, ms) {
  return Promise.race([promesa, new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('lento')), ms))])
}

self.addEventListener('fetch', (evento) => {
  const req = evento.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Estáticos de Next y la marca: primero lo guardado (llevan huella en el nombre, no cambian)
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/marca/')) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(ESTATICOS)
        const guardado = await cache.match(req, { ignoreVary: true })
        if (guardado) return guardado
        const r = await fetch(req)
        if (r.ok) cache.put(req, r.clone())
        return r
      })()
    )
    return
  }

  if (req.mode !== 'navigate') return

  // La pantalla de campo: primero la red (con límite de espera); si no hay, la guardada
  if (url.pathname === CAMPO) {
    evento.respondWith(
      (async () => {
        const red = fetch(req)
        try {
          const r = await conLimite(red, ESPERA_RED_MS)
          if (esCampoValido(r)) evento.waitUntil(guardarCampo(r.clone()))
          return r
        } catch {
          const guardada = await caches.match(CAMPO, { cacheName: PAGINAS, ignoreVary: true, ignoreSearch: true })
          if (guardada) {
            // Si la red respondía tarde, se aprovecha para actualizar lo guardado
            evento.waitUntil(red.then((r) => (esCampoValido(r) ? guardarCampo(r) : null)).catch(() => null))
            return guardada
          }
          return red
        }
      })()
    )
    return
  }

  // Cualquier otra página: la red, igual que siempre. Solo si NO hay red, a la pantalla de campo guardada.
  evento.respondWith(
    fetch(req).catch(async () => {
      const guardada = await caches.match(CAMPO, { cacheName: PAGINAS, ignoreVary: true, ignoreSearch: true })
      if (guardada) return Response.redirect(CAMPO, 302)
      throw new Error('sin red')
    })
  )
})
