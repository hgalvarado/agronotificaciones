'use client'

/**
 * Estado de la conexión del teléfono, sin sondeos: solo `navigator.onLine` y los eventos online/offline.
 * - `useNavegadorEnLinea()`: true/false del navegador.
 * - `useEstadoConexion(usuarioId)`: además cuenta lo pendiente y lo rechazado de la cola local (se lee al abrir, al
 *   volver la señal y al volver a la pantalla; nada de reloj, para no crear bucles).
 */

import { useEffect, useState } from 'react'
import { EVENTO_COLA_CAMBIO } from '@/lib/campo/eventos'
import { AlmacenLocal } from './almacenLocal'

export function useNavegadorEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(true)
  useEffect(() => {
    const poner = () => setEnLinea(navigator.onLine)
    poner()
    window.addEventListener('online', poner)
    window.addEventListener('offline', poner)
    return () => {
      window.removeEventListener('online', poner)
      window.removeEventListener('offline', poner)
    }
  }, [])
  return enLinea
}

/** `usuarioId` null = sin cola local (la persona no usa Campo): solo se sabe si hay señal. */
export function useEstadoConexion(usuarioId: string | null) {
  const enLinea = useNavegadorEnLinea()
  const [cuentas, setCuentas] = useState({ pendientes: 0, rechazados: 0 })

  useEffect(() => {
    if (!usuarioId) return
    let vivo = true
    const leer = async () => {
      try {
        const a = await AlmacenLocal.abrir(usuarioId)
        const cola = await a.listarCola()
        if (vivo) {
          setCuentas({
            pendientes: cola.filter((o) => o.estado_local === 'PENDIENTE').length,
            rechazados: cola.filter((o) => o.estado_local === 'RECHAZADO').length,
          })
        }
      } catch {
        /* sin almacén (primera vez): no hay nada pendiente */
      }
    }
    const alVolver = () => {
      if (document.visibilityState === 'visible') void leer()
    }
    void leer()
    window.addEventListener('online', leer)
    // «campo:cola»: lo emite useCampo cada vez que cambia la cola (registrar, enviar, descartar): el número se mantiene al día
    window.addEventListener(EVENTO_COLA_CAMBIO, leer)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      vivo = false
      window.removeEventListener('online', leer)
      window.removeEventListener(EVENTO_COLA_CAMBIO, leer)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [usuarioId, enLinea])

  return { enLinea, ...cuentas }
}
