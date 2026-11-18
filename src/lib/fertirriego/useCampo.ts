'use client'

/**
 * El corazón de la app de campo: lo guardado en el teléfono + la sincronización.
 *
 * - Abre el almacén de ESTA persona y muestra lo último que se bajó (funciona sin señal desde el primer cuadro).
 * - Sincroniza al abrir, al volver la señal, al volver a la pantalla y, con pendientes, cada minuto.
 * - `registrar` guarda primero en el teléfono (nunca se pierde) y después intenta enviar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AlmacenLocal } from './almacenLocal'
import { esperaMs } from '@/lib/errores/cola'
import { enviarLatido, registrarError } from '@/lib/errores/registrador'
import { sincronizar } from './sincronizador'
import type { LlavePersona } from './codigo'
import type { EstadoCampo, Operacion } from './tipos'

export type Conexion = 'en_linea' | 'sin_senal'

export function useCampo(usuarioId: string) {
  const supabase = useMemo(() => createClient(), [])
  const almacen = useRef<AlmacenLocal | null>(null)
  const [estado, setEstado] = useState<EstadoCampo | null>(null)
  const [cola, setCola] = useState<Operacion[]>([])
  const [sincronizadoEn, setSincronizadoEn] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [conexion, setConexion] = useState<Conexion>('en_linea')
  const [error, setError] = useState<string | null>(null)
  const [llaves, setLlaves] = useState<LlavePersona[]>([])
  // Reintento con espera creciente (118): tras una falla no se insiste cada minuto, se espera 5 s, 10 s, 20 s… (tope 5 min)
  const fallos = useRef(0)
  const proximo = useRef(0)

  const recargarCola = useCallback(async () => {
    if (almacen.current) setCola(await almacen.current.listarCola())
  }, [])

  const sincronizarAhora = useCallback(async () => {
    if (!almacen.current) return
    setSincronizando(true)
    const r = await sincronizar(almacen.current, supabase)
    setSincronizando(false)
    if (r.estado) {
      setEstado(r.estado)
      setSincronizadoEn(new Date().toISOString())
    }
    setConexion(r.sinRed ? 'sin_senal' : 'en_linea')
    setError(r.error)
    if (r.error || r.sinRed) {
      fallos.current++
      proximo.current = Date.now() + Math.max(esperaMs(fallos.current), 60_000 * Math.min(fallos.current - 1, 4))
    } else {
      fallos.current = 0
      proximo.current = 0
    }
    await recargarCola()
    setLlaves(await almacen.current.leerLlaves())
    void enviarLatido(true) // latido de salud (118): pendientes, edad del más viejo, última sincronización buena
    return r
  }, [supabase, recargarCola])

  // Abrir el almacén y mostrar lo guardado; después, sincronizar
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        // La pantalla guardada para trabajar sin señal es de UNA cuenta: si en este teléfono entró otra persona,
        // no se abre el almacén ajeno (cada quien tiene el suyo).
        const { data: s } = await supabase.auth.getSession()
        if (s.session && s.session.user.id !== usuarioId) {
          setError('Esta pantalla guardada es de otra cuenta. Ábrela con señal para cargar la tuya.')
          return
        }
        const a = await AlmacenLocal.abrir(usuarioId)
        if (!vivo) return
        almacen.current = a
        const guardado = await a.leerEstado()
        if (!vivo) return
        setEstado(guardado.estado)
        setSincronizadoEn(guardado.sincronizadoEn)
        setCola(await a.listarCola())
        setLlaves(await a.leerLlaves())
      } catch (e) {
        registrarError(e, { origen: 'guardado', modulo: 'fertirriego', severidad: 'critico', detalle: { fase: 'abrir_almacen' } })
        setError(e instanceof Error ? `No se pudo abrir el almacén del teléfono: ${e.message}` : 'No se pudo abrir el almacén del teléfono.')
      } finally {
        if (vivo) setCargando(false)
      }
      if (vivo) await sincronizarAhora()
    })()
    return () => {
      vivo = false
    }
  }, [usuarioId, sincronizarAhora, supabase])

  // Volvió la señal / volvió a la pantalla / cada minuto si hay pendientes
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') void sincronizarAhora()
    }
    const enLinea = () => {
      fallos.current = 0
      proximo.current = 0
      void sincronizarAhora()
    }
    const sinLinea = () => setConexion('sin_senal')
    window.addEventListener('online', enLinea)
    window.addEventListener('offline', sinLinea)
    document.addEventListener('visibilitychange', alVolver)
    const reloj = setInterval(() => {
      if (cola.some((o) => o.estado_local === 'PENDIENTE') && Date.now() >= proximo.current) void sincronizarAhora()
    }, 30_000)
    return () => {
      window.removeEventListener('online', enLinea)
      window.removeEventListener('offline', sinLinea)
      document.removeEventListener('visibilitychange', alVolver)
      clearInterval(reloj)
    }
  }, [sincronizarAhora, cola])

  /** Guarda en el teléfono (siempre) y luego intenta enviar. Varios registros van juntos y en orden. */
  const registrar = useCallback(
    async (...ops: Operacion[]) => {
      if (!almacen.current) {
        registrarError('El almacén del teléfono no está listo', { origen: 'guardado', modulo: 'fertirriego', severidad: 'critico', detalle: { fase: 'registrar' } })
        throw new Error('El almacén del teléfono no está listo.')
      }
      try {
        for (const op of ops) await almacen.current.guardarOperacion(op)
      } catch (e) {
        registrarError(e, { origen: 'guardado', modulo: 'fertirriego', severidad: 'critico', detalle: { fase: 'guardar_local', tipos: ops.map((o) => o.tipo) } })
        throw e
      }
      await recargarCola()
      void sincronizarAhora()
    },
    [recargarCola, sincronizarAhora]
  )

  /** Quita un registro de la cola (un rechazado ya revisado, o un pendiente que se registró por error). */
  const descartar = useCallback(
    async (id: string) => {
      await almacen.current?.borrarOperacion(id)
      await recargarCola()
    },
    [recargarCola]
  )

  const preferencia = useCallback(async <T,>(clave: string) => (await almacen.current?.leerPreferencia<T>(clave)) ?? null, [])
  const guardarPreferencia = useCallback(async <T,>(clave: string, valor: T) => {
    await almacen.current?.guardarPreferencia(clave, valor)
  }, [])

  return {
    supabase,
    estado,
    cola,
    llaves,
    sincronizadoEn,
    cargando,
    sincronizando,
    conexion,
    error,
    registrar,
    descartar,
    sincronizarAhora,
    preferencia,
    guardarPreferencia,
  }
}
