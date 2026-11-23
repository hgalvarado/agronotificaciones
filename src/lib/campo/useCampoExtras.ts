'use client'

/**
 * Lo que el teléfono de Inyección/Motores necesita saber de quien llama (sql/140, fn_campo_mis_permisos): su permiso
 * temporal de «Registro histórico» por estación y si tiene «Eliminar por completo». Se guarda en el teléfono para
 * seguir mostrando el botón del histórico sin señal (la base lo vuelve a validar al enviar).
 *
 * Frenos (regla de bucles): una sola consulta a la vez, al abrir y al volver la señal o la pantalla, con un mínimo de
 * 60 s entre consultas y espera creciente tras un error; sin temporizador propio; limpieza de oyentes al desmontar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { esperaMs } from '@/lib/errores/cola'
import { AlmacenLocal } from '@/lib/fertirriego/almacenLocal'
import { hoyIso } from '@/lib/fechas/zona'
import type { PermisoHistorico } from '@/lib/fertirriego/tipos'

export type ExtrasCampo = { eliminar_definitivo: boolean; historico: PermisoHistorico[] }

const VACIO: ExtrasCampo = { eliminar_definitivo: false, historico: [] }
const MINIMO_MS = 60_000

/** El permiso histórico vigente en una estación (se recalcula con el día del teléfono: vencido = sin botón aunque no haya señal). */
export function permisoHistoricoDe(extras: ExtrasCampo, estacionId: string | null | undefined): PermisoHistorico | null {
  if (!estacionId) return null
  const hoy = hoyIso()
  const p = extras.historico.find((x) => x.estacion_id === estacionId && x.hasta >= hoy)
  if (!p) return null
  return { ...p, dias_restantes: Math.round((Date.parse(`${p.hasta}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86400000) }
}

export function useCampoExtras(usuarioId: string, pantalla: 'inyeccion' | 'motores'): ExtrasCampo {
  const supabase = useMemo(() => createClient(), [])
  const clave = `${pantalla}_extras`
  const almacen = useRef<AlmacenLocal | null>(null)
  const [extras, setExtras] = useState<ExtrasCampo>(VACIO)
  const proximo = useRef(0)
  const fallos = useRef(0)
  const enCurso = useRef(false)

  const bajar = useCallback(async () => {
    const ahora = Date.now()
    if (enCurso.current || ahora < proximo.current) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    enCurso.current = true
    proximo.current = ahora + MINIMO_MS
    try {
      const { data, error } = await supabase.rpc('fn_campo_mis_permisos', { p_pantalla: pantalla })
      if (error) throw new Error(error.message)
      const nuevo = { ...VACIO, ...(data as Partial<ExtrasCampo> | null) }
      fallos.current = 0
      setExtras(nuevo)
      try {
        await almacen.current?.guardarPreferencia(clave, nuevo)
      } catch {
        // sin espacio: se sigue con lo que hay en pantalla
      }
    } catch {
      // falta la migración 140 o sin señal: no se reintenta de inmediato
      fallos.current++
      proximo.current = Date.now() + Math.max(esperaMs(fallos.current), MINIMO_MS)
    } finally {
      enCurso.current = false
    }
  }, [supabase, pantalla, clave])

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const a = await AlmacenLocal.abrir(usuarioId)
        if (!vivo) return
        almacen.current = a
        const guardado = await a.leerPreferencia<ExtrasCampo>(clave)
        if (vivo && guardado) setExtras({ ...VACIO, ...guardado })
      } catch {
        // sin almacén: funciona con señal
      }
      if (vivo) await bajar()
    })()
    return () => {
      vivo = false
    }
  }, [usuarioId, clave, bajar])

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') void bajar()
    }
    const enLinea = () => void bajar()
    window.addEventListener('online', enLinea)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      window.removeEventListener('online', enLinea)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [bajar])

  return extras
}
