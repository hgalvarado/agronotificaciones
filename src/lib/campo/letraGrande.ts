'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * «Ver mejor» de los módulos de Campo (letra grande + alto contraste): preferencia por teléfono. Mientras la pantalla está abierta pone la clase
 * `ver-mejor` en <html> (agranda lo medido en rem y sube el contraste de textos, casillas y foco) y la quita al salir.
 */
const CLAVE = 'campo:ver-mejor'

export function useLetraGrande() {
  const [activa, setActiva] = useState(false)

  useEffect(() => {
    try {
      setActiva(window.localStorage.getItem(CLAVE) === '1')
    } catch {
      /* sin almacenamiento */
    }
  }, [])

  useEffect(() => {
    const html = document.documentElement
    html.classList.toggle('ver-mejor', activa)
    return () => html.classList.remove('ver-mejor')
  }, [activa])

  const alternar = useCallback(() => {
    setActiva((v) => {
      try {
        window.localStorage.setItem(CLAVE, v ? '0' : '1')
      } catch {
        /* sin almacenamiento */
      }
      return !v
    })
  }, [])

  return { activa, alternar }
}
