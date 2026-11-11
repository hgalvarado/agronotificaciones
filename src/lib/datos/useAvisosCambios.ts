'use client'

/**
 * `useAvisosCambios`: llama a `alCambiar` cuando hay que ponerse al día.
 *
 *   - al volver a la ventana o a la pestaña (se hizo un cambio en otra y se regresa);
 *   - cuando la base avisa que cambió alguna de `tablas` (Supabase Realtime; requiere sql/84). Los avisos seguidos
 *     se agrupan: diez cambios en un segundo son UNA actualización.
 *
 * Nunca interrumpe a quien está escribiendo en un campo: espera a que termine y entonces avisa.
 * Lo usan `useConsultaViva` (tablas de datos) y la lista de Tickets (sus conteos).
 */

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

const ESPERA_AVISOS = 1200         // ms para agrupar avisos seguidos de la base
const MINIMO_AL_VOLVER = 4000      // al volver a la ventana, no repetir lo que se acaba de traer
const REINTENTO_EDICION = 2500     // si se está escribiendo, se espera y se vuelve a intentar

/** ¿Hay un campo de texto con el foco? (una actualización ahora pisaría lo que se está escribiendo) */
export function escribiendo(): boolean {
  const activo = document.activeElement as HTMLElement | null
  if (!activo) return false
  if (activo.isContentEditable) return true
  if (activo.tagName === 'TEXTAREA' || activo.tagName === 'SELECT') return true
  if (activo.tagName !== 'INPUT') return false
  const tipo = (activo as HTMLInputElement).type
  return !['search', 'checkbox', 'radio', 'button', 'submit'].includes(tipo)
}

type Opciones = {
  /** Tablas de `public` cuyos cambios cuentan. */
  tablas: string[]
  alCambiar: () => void
  habilitado?: boolean
  /** Para no repetir al volver a la ventana: cuándo fue la última actualización (ms). */
  ultima?: () => number
}

export function useAvisosCambios({ tablas, alCambiar, habilitado = true, ultima }: Opciones) {
  const alCambiarRef = useRef(alCambiar)
  const ultimaRef = useRef(ultima)
  useEffect(() => {
    alCambiarRef.current = alCambiar
    ultimaRef.current = ultima
  }, [alCambiar, ultima])

  // Avisar respetando a quien escribe
  const avisarRef = useRef<() => void>(() => {})
  useEffect(() => {
    let pendiente: number | undefined
    avisarRef.current = () => {
      window.clearTimeout(pendiente)
      if (escribiendo()) {
        pendiente = window.setTimeout(() => avisarRef.current(), REINTENTO_EDICION)
        return
      }
      alCambiarRef.current()
    }
    return () => window.clearTimeout(pendiente)
  }, [])

  // Al volver a la ventana / pestaña
  useEffect(() => {
    if (!habilitado) return
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      const hace = Date.now() - (ultimaRef.current?.() ?? 0)
      if (hace > MINIMO_AL_VOLVER) avisarRef.current()
    }
    window.addEventListener('focus', alVolver)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.removeEventListener('focus', alVolver)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [habilitado])

  // Avisos de la base: otro usuario, otra pestaña, otro teléfono
  const tablasClave = tablas.join(',')
  useEffect(() => {
    if (!habilitado || !tablasClave) return
    const supabase = createClient()
    let espera: number | undefined
    const recibir = () => {
      window.clearTimeout(espera)
      espera = window.setTimeout(() => avisarRef.current(), ESPERA_AVISOS)
    }
    let canal = supabase.channel(`avisos:${tablasClave}:${Math.random().toString(36).slice(2)}`)
    for (const tabla of tablasClave.split(',')) {
      canal = canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, recibir)
    }
    canal.subscribe()
    return () => {
      window.clearTimeout(espera)
      void supabase.removeChannel(canal)
    }
  }, [habilitado, tablasClave])
}
