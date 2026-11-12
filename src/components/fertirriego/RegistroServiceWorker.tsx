'use client'

/**
 * Instala el service worker de Fertirriego (public/sw.js) SOLO cuando alguien abre esta pantalla: quien nunca
 * entra a Fertirriego no recibe nada nuevo. El service worker únicamente guarda esta pantalla y los archivos
 * estáticos para abrirla sin señal; el resto de la plataforma pasa por la red como siempre.
 */

import { useEffect } from 'react'

export function RegistroServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const seguro = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    if (!seguro) return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Sin service worker la pantalla funciona igual con señal; solo no abre sin ella
    })
  }, [])
  return null
}
