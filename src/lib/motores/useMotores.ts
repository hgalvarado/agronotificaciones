'use client'

/**
 * Baja lo de Motores y combustible (fn_mot_estado_campo, sql/130) y lo guarda en el teléfono para trabajar sin señal.
 * Mismo molde y mismos frenos que useInyeccion (regla de bucles): dependencias estables, intervalo mínimo de 15 s entre
 * bajadas automáticas (`crearFreno`: disyuntor de 6 en 60 s), espera creciente tras un error (nunca reintento inmediato),
 * una sola bajada a la vez y limpieza de los oyentes al desmontar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { crearFreno } from '@/lib/datos/frenos'
import { esperaMs } from '@/lib/errores/cola'
import { AlmacenLocal } from '@/lib/fertirriego/almacenLocal'
import { normalizarEstado, type EstadoMotores } from './estado'

const CLAVE = 'mot_estado'

export function useMotores(usuarioId: string) {
  const supabase = useMemo(() => createClient(), [])
  const almacen = useRef<AlmacenLocal | null>(null)
  const [estado, setEstado] = useState<EstadoMotores | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const freno = useRef(crearFreno())
  const fallos = useRef(0)
  const proximo = useRef(0)
  const enCurso = useRef(false)

  /** `manual` = el botón o el fin de un envío: no se frena, solo se anota para el disyuntor. */
  const bajar = useCallback(
    async (manual: boolean) => {
      if (enCurso.current) return
      const ahora = Date.now()
      if (manual) freno.current.anotar(ahora)
      else {
        if (ahora < proximo.current) return
        if (freno.current.autorizar(ahora).accion !== 'ejecutar') return
      }
      enCurso.current = true
      setCargando(true)
      try {
        const { data, error: e } = await supabase.rpc('fn_mot_estado_campo')
        if (e) throw new Error(e.message)
        const nuevo = normalizarEstado(data as EstadoMotores)
        setEstado(nuevo)
        setError(null)
        fallos.current = 0
        proximo.current = 0
        try {
          await almacen.current?.guardarPreferencia(CLAVE, nuevo)
        } catch {
          // sin espacio: se sigue con lo que hay en pantalla
        }
      } catch (e) {
        fallos.current++
        proximo.current = Date.now() + Math.max(esperaMs(fallos.current), 60_000)
        const mensaje = e instanceof Error ? e.message : ''
        const sinRed = (typeof navigator !== 'undefined' && !navigator.onLine) || /fetch|network|Failed|Load failed/i.test(mensaje)
        setError(sinRed ? 'Sin señal: se muestra lo último que se bajó.' : mensaje || 'No se pudo actualizar Motores y combustible.')
      } finally {
        enCurso.current = false
        setCargando(false)
      }
    },
    [supabase]
  )

  // Abrir el almacén de ESTA persona, mostrar lo guardado y bajar lo nuevo
  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const a = await AlmacenLocal.abrir(usuarioId)
        if (!vivo) return
        almacen.current = a
        const guardado = await a.leerPreferencia<EstadoMotores>(CLAVE)
        if (vivo && guardado) setEstado(normalizarEstado(guardado))
      } catch {
        // sin almacén: funciona con señal
      }
      if (vivo) await bajar(false)
    })()
    return () => {
      vivo = false
    }
  }, [usuarioId, bajar])

  // Volvió la señal / volvió a la pantalla (con el freno de siempre)
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') void bajar(false)
    }
    const enLinea = () => void bajar(false)
    window.addEventListener('online', enLinea)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.removeEventListener('online', enLinea)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [bajar])

  const actualizar = useCallback(() => void bajar(true), [bajar])
  return { estado, cargando, error, actualizar }
}
