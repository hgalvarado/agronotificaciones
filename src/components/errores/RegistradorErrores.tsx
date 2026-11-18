'use client'

/**
 * Arranca la bitácora de errores del lado del teléfono (sql/118): engancha los errores de JavaScript, anota todo
 * error que la app le muestra a alguien y manda el latido de salud al abrir, al volver a la pantalla, al volver la
 * señal y cada 5 minutos. No dibuja nada. Si algo aquí falla, la app sigue igual.
 */

import { useEffect } from 'react'
import { alMostrarError } from '@/lib/errores'
import { enviarLatido, enviarPendientes, fijarUsuario, instalarCapturaGlobal, registrarError } from '@/lib/errores/registrador'

function severidadDe(e: unknown): 'info' | 'aviso' | 'error' {
  const o = e as { code?: string; message?: string }
  if (/failed to fetch|network|load failed/i.test(o?.message ?? '')) return 'info'
  if (o?.code === '23505' || o?.code === '23514' || o?.code === '23502') return 'aviso'
  return 'error'
}

export function RegistradorErrores({ usuarioId }: { usuarioId: string }) {
  useEffect(() => {
    try {
      fijarUsuario(usuarioId)
      const quitar = instalarCapturaGlobal()
      alMostrarError((e) => registrarError(e, { origen: 'guardado', severidad: severidadDe(e) }))
      void enviarPendientes(true)
      void enviarLatido(true)
      const alVolver = () => {
        if (document.visibilityState === 'visible') {
          void enviarPendientes()
          void enviarLatido()
        }
      }
      document.addEventListener('visibilitychange', alVolver)
      const reloj = setInterval(() => {
        void enviarPendientes()
        void enviarLatido()
      }, 5 * 60_000)
      return () => {
        quitar()
        alMostrarError(null)
        document.removeEventListener('visibilitychange', alVolver)
        clearInterval(reloj)
      }
    } catch {
      return undefined
    }
  }, [usuarioId])
  return null
}
