'use client'

/**
 * Instala el service worker de Fertirriego (public/sw.js) SOLO cuando alguien abre esta pantalla: quien nunca
 * entra a Fertirriego no recibe nada nuevo. El service worker únicamente guarda esta pantalla y los archivos
 * estáticos para abrirla sin señal; el resto de la plataforma pasa por la red como siempre.
 */

import { useEffect } from 'react'

/** `rutas`: pantallas que el service worker debe guardar para abrir sin señal (AgroMétricas); Fertirriego no manda ninguna. */
export function RegistroServiceWorker({ rutas }: { rutas?: string[] } = {}) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // En desarrollo y en localhost NO se instala: guardaba pantallas y archivos viejos y se veía una versión anterior del código.
    // Si ya había uno registrado, se desregistra y se borran sus cachés.
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]'
    // NEXT_PUBLIC_PUSH_DEV=1 permite registrarlo en localhost para probar los avisos push.
    const pushDev = process.env.NEXT_PUBLIC_PUSH_DEV === '1'
    if ((process.env.NODE_ENV !== 'production' || local) && !pushDev) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {})
      if ('caches' in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {})
      return
    }
    const seguro = location.protocol === 'https:' || (pushDev && local)
    if (!seguro) return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Sin service worker la pantalla funciona igual con señal; solo no abre sin ella
    })
    if (rutas?.length) {
      navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ tipo: 'guardar-rutas', rutas }), () => {})
    }
  }, [rutas])
  return null
}
