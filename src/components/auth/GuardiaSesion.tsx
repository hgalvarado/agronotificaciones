'use client'

/**
 * Si el cliente del navegador pierde la sesión —su refresco recibió
 * `refresh_token_not_found` y Supabase la cerró—, se sale con una carga
 * COMPLETA al login.
 *
 * Una navegación de cliente (`router.push`) dejaría vivo el mismo cliente
 * con la sesión muerta en memoria; la recarga completa lo destruye y el
 * middleware, en `/login?sesion=expirada`, borra las cookies sin volver a
 * preguntar. Es el otro extremo del cortafuegos del middleware.
 *
 * No dibuja nada.
 */

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/** «Salir» la pone antes de cerrar: una salida voluntaria no «expiró». */
const VOLUNTARIA = 'agn.salida-voluntaria'

export function marcarSalidaVoluntaria() {
  try {
    sessionStorage.setItem(VOLUNTARIA, '1')
  } catch {
    // Sin almacenamiento: el login dirá «expiró», que es inofensivo.
  }
}

function fueVoluntaria(): boolean {
  try {
    const si = sessionStorage.getItem(VOLUNTARIA) === '1'
    sessionStorage.removeItem(VOLUNTARIA)
    return si
  } catch {
    return false
  }
}

export function GuardiaSesion() {
  useEffect(() => {
    const supabase = createClient()
    // Sólo se actúa si ESTA página llegó a tener sesión. Un SIGNED_OUT
    // sin sesión previa (arranque del cliente, cookies recién borradas) no
    // es una sesión que se perdió y no debe sacar a nadie.
    let tuvoSesion = false
    let vivo = true
    let pendiente: ReturnType<typeof setTimeout> | null = null

    const { data } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (sesion) tuvoSesion = true
      if (evento !== 'SIGNED_OUT' || sesion || !tuvoSesion) return
      if (window.location.pathname.startsWith('/login')) return

      // **Confirmar antes de expulsar.** Un SIGNED_OUT puede ser un
      // fantasma: otra pestaña que entra, una escritura de cookies a medio
      // camino. Se espera un momento y se PREGUNTA otra vez (fuera del
      // callback: llamar a Supabase dentro de él puede bloquearlo). Sólo
      // si de verdad no hay sesión, se sale.
      if (pendiente) clearTimeout(pendiente)
      pendiente = setTimeout(async () => {
        if (!vivo) return
        const { data: d } = await supabase.auth.getSession()
        if (!vivo || d.session) return
        window.location.replace(fueVoluntaria() ? '/login' : '/login?sesion=expirada')
      }, 800)
    })
    return () => {
      vivo = false
      if (pendiente) clearTimeout(pendiente)
      data.subscription.unsubscribe()
    }
  }, [])
  return null
}
