'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Estación y zona elegidas en Campo, por persona y teléfono, COMPARTIDAS por Fertirriego, Inyección y Motores.
 * Se guardan en localStorage (lectura inmediata): antes se leían de IndexedDB al montar, cuando el almacén aún no estaba
 * abierto, y la pantalla volvía siempre a la primera estación al entrar o tras guardar.
 */
const clave = (usuarioId: string, que: 'estacion' | 'zona') => `campo:${que}:${usuarioId}`

function leer(k: string): string {
  try {
    return window.localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}

function escribir(k: string, v: string) {
  try {
    if (v) window.localStorage.setItem(k, v)
    else window.localStorage.removeItem(k)
  } catch {
    /* sin almacenamiento (ventana privada): se queda solo en memoria */
  }
}

/** [estacionId, elegirEstacion, zona, elegirZona]. La estación solo cambia cuando la persona (o un enlace de alerta) la elige. */
export function useEstacionElegida(usuarioId: string) {
  const [estacionId, setEstacionId] = useState('')
  const [zona, setZona] = useState('')

  useEffect(() => {
    setEstacionId(leer(clave(usuarioId, 'estacion')))
    setZona(leer(clave(usuarioId, 'zona')))
  }, [usuarioId])

  const elegirEstacion = useCallback(
    (id: string) => {
      setEstacionId(id)
      escribir(clave(usuarioId, 'estacion'), id)
    },
    [usuarioId]
  )

  const elegirZona = useCallback(
    (z: string) => {
      setZona(z)
      escribir(clave(usuarioId, 'zona'), z)
    },
    [usuarioId]
  )

  return { estacionId, elegirEstacion, zona, elegirZona }
}
