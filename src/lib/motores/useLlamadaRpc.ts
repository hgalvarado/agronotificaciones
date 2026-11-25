'use client'

/**
 * Una consulta a la base que se hace al abrir una pantalla (auditoría y administración de tanques: solo con señal) y cuando la
 * persona la pide («Actualizar»). Sin sondeo ni reintento automático (regla de bucles): dependencias estables (la huella de los
 * argumentos, no el objeto), una sola consulta a la vez, el resultado de una consulta vieja se descarta y no se actualiza nada
 * después de cerrar la pantalla.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useLlamadaRpc<T>(funcion: string, argumentos: Record<string, unknown> | undefined, activo = true) {
  const supabase = useMemo(() => createClient(), [])
  const [datos, setDatos] = useState<T | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const huella = JSON.stringify(argumentos ?? {})
  const vuelta = useRef(0)

  // bucle-ok: la consulta corre al abrir o al cambiar la huella de los argumentos o al pedir «Actualizar»; el resultado no cambia ninguna de esas dependencias
  useEffect(() => {
    if (!activo) return
    const esta = ++vuelta.current
    setCargando(true)
    void (async () => {
      try {
        const { data, error: e } = await supabase.rpc(funcion, JSON.parse(huella) as Record<string, unknown>)
        if (esta !== vuelta.current) return
        if (e) throw new Error(e.message)
        setDatos(data as T)
        setError(null)
      } catch (e) {
        if (esta !== vuelta.current) return
        const mensaje = e instanceof Error ? e.message : ''
        const sinRed = (typeof navigator !== 'undefined' && !navigator.onLine) || /fetch|network|Failed|Load failed/i.test(mensaje)
        setError(sinRed ? 'Sin señal: esta pantalla necesita conexión.' : mensaje || 'No se pudo consultar.')
      } finally {
        if (esta === vuelta.current) setCargando(false)
      }
    })()
    return () => {
      vuelta.current++
    }
  }, [supabase, funcion, huella, activo, version])

  const recargar = useCallback(() => setVersion((v) => v + 1), [])
  return { datos, cargando, error, recargar }
}
