'use client'

/**
 * `useConsultaViva`: una consulta que se mantiene al día sola.
 *
 *   const { filas, cargando, error, recargar } = useConsultaViva({
 *     clave: `horometros:${desde}:${hasta}`, leer, tablas: ['horometros', 'tickets'], habilitado: memoriaLista })
 *
 * 1 · AL INSTANTE: lo último que se trajo con esa clave se guarda en memoria (mientras la aplicación está abierta).
 *     Al volver a la pantalla se ve de inmediato y se actualiza por detrás, en vez de esperar con la tabla vacía.
 * 2 · SOLA: se vuelve a consultar en silencio
 *     - al volver a la ventana o a la pestaña (se hizo un cambio en otra y se regresa),
 *     - cuando la base avisa que cambió una de `tablas` (Supabase Realtime; ver sql/84). Los avisos se agrupan:
 *       diez cambios seguidos son UNA consulta.
 *     Nunca mientras se está escribiendo en un campo: espera a que se termine (si no, la edición se perdería).
 * 3 · SIN PARPADEO: la actualización silenciosa reemplaza las filas sin encender «cargando» ni desmontar la tabla,
 *     así que filtros, orden, desplazamiento y selección se conservan.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAvisosCambios } from './useAvisosCambios'

type Resultado<T> = { datos: T[]; error: string | null }

type Opciones<T> = {
  /** Identifica la consulta (incluye sus filtros de servidor, ej. el rango de fechas). */
  clave: string
  leer: () => Promise<Resultado<T>>
  /** Tablas cuyos cambios obligan a volver a consultar. */
  tablas?: string[]
  /** false = todavía no (ej. falta leer los filtros recordados). */
  habilitado?: boolean
}

const cache = new Map<string, { filas: unknown[]; en: number }>()

export function useConsultaViva<T>({ clave, leer, tablas = [], habilitado = true }: Opciones<T>) {
  const previa = cache.get(clave)
  const [filas, setFilas] = useState<T[] | null>((previa?.filas as T[]) ?? null)
  const [cargando, setCargando] = useState(!previa)
  const [error, setError] = useState<string | null>(null)
  const [actualizado, setActualizado] = useState<number | null>(previa?.en ?? null)

  // Cambió la clave (otro rango): lo que haya guardado de ESA clave se ve al instante. Va en el render y no en un
  // efecto, igual que el reinicio del DataGrid: es el patrón de React para ajustar estado cuando cambia una prop
  const [claveVista, setClaveVista] = useState(clave)
  if (clave !== claveVista) {
    setClaveVista(clave)
    const guardado = cache.get(clave)
    setFilas((guardado?.filas as T[]) ?? null)
    setCargando(!guardado)
    setActualizado(guardado?.en ?? null)
  }

  const ultima = useRef(0)
  const turno = useRef(0)
  const leerRef = useRef(leer)
  useEffect(() => {
    leerRef.current = leer
  }, [leer])

  // `encender`: prende «cargando» ANTES de pedir (botones). Desde el efecto no hace falta: si no había nada que
  // mostrar, «cargando» ya quedó encendido al cambiar la clave (y React 19 no permite setState directo en efectos)
  const consultar = useCallback(
    async (silencioso: boolean, encender = false) => {
      const mio = ++turno.current
      ultima.current = Date.now()
      if (encender && !silencioso) setCargando(true)
      const { datos, error: e } = await leerRef.current()
      if (mio !== turno.current) return   // llegó otra consulta más nueva (ej. cambió el rango)
      if (!silencioso) setCargando(false)
      if (e) {
        setError(e)
        if (!silencioso) setFilas([])
        return
      }
      setError(null)
      setFilas(datos)
      const en = Date.now()
      cache.set(clave, { filas: datos, en })
      setActualizado(en)
    },
    [clave]
  )

  // Al cambiar la clave (o al habilitarse): la consulta real, en silencio si ya se está viendo lo guardado
  useEffect(() => {
    if (!habilitado) return
    // En un callback (no en el cuerpo del efecto); cancelar el temporizador además evita la consulta doble
    // del montaje de prueba de React en desarrollo
    const t = window.setTimeout(() => void consultar(cache.has(clave)), 0)
    return () => window.clearTimeout(t)
  }, [clave, habilitado, consultar])

  // Ponerse al día solo: al volver a la ventana y cuando la base avisa cambios (lib/datos/useAvisosCambios).
  // Nunca mientras se escribe en un campo; siempre en silencio (sin atenuar ni desmontar la tabla)
  const refrescar = useCallback(() => void consultar(true), [consultar])
  const ultimaVez = useCallback(() => ultima.current, [])
  useAvisosCambios({ tablas, alCambiar: refrescar, habilitado, ultima: ultimaVez })
  return {
    filas,
    cargando,
    error,
    actualizado,
    /** Tras guardar algo desde la pantalla: `recargar(true)` actualiza sin atenuar la tabla. */
    recargar: (silencioso = false) => consultar(silencioso, true),
  }
}
