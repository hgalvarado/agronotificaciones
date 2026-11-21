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
  // Cuántos parches locales se han aplicado (para detectar lecturas que quedaron viejas)
  const parches = useRef(0)
  // Lectura silenciosa agendada para después (fin del silencio o repetición de una descartada)
  const temporizador = useRef<number | undefined>(undefined)
  const reprogramar = useRef<(ms: number) => void>(() => {})
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
      const parches0 = parches.current
      const { datos, error: e } = await leerRef.current()
      if (mio !== turno.current) return   // llegó otra consulta más nueva (ej. cambió el rango)
      // Una lectura silenciosa que empezó ANTES de un guardado de esta pantalla puede traer lo viejo y
      // pisar el cambio: se descarta y se repite un momento después
      // SIEMPRE se apaga (también si se descarta): si una consulta con «cargando» fue superada por una
      // silenciosa (aviso de la base), la silenciosa no lo apagaba y la pantalla se quedaba en
      // «Consultando…» para siempre
      setCargando(false)
      if (silencioso && !e && parches.current !== parches0) {
        reprogramar.current(1500)
        return
      }
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
  // Los avisos que la propia pantalla provoca al guardar (eco) se ignoran un momento: ya se parchó lo suyo
  const silencioHasta = useRef(0)
  useEffect(() => {
    reprogramar.current = (ms: number) => {
      window.clearTimeout(temporizador.current)
      temporizador.current = window.setTimeout(() => void consultar(true), ms)
    }
    return () => window.clearTimeout(temporizador.current)
  }, [consultar])
  const refrescar = useCallback(() => {
    const falta = silencioHasta.current - Date.now()
    // Durante el silencio NO se descarta el aviso (podría ser de otra persona): se atiende al terminar
    if (falta > 0) {
      reprogramar.current(falta + 100)
      return
    }
    void consultar(true)
  }, [consultar])
  const ultimaVez = useCallback(() => ultima.current, [])
  useAvisosCambios({ tablas, alCambiar: refrescar, habilitado, ultima: ultimaVez })

  /** Cambia las filas en memoria AL INSTANTE (y en la caché), sin ir a la base. */
  const parchar = useCallback(
    (fn: (previas: T[]) => T[]) => {
      parches.current++
      setFilas((prev) => {
        const nuevas = fn(prev ?? [])
        cache.set(clave, { filas: nuevas, en: Date.now() })
        return nuevas
      })
    },
    [clave]
  )

  /** Ignora los avisos de la base durante `ms` (el eco de lo que esta pantalla acaba de guardar). */
  const silenciarAvisos = useCallback((ms: number) => {
    silencioHasta.current = Date.now() + ms
  }, [])

  return {
    parchar,
    silenciarAvisos,
    filas,
    cargando,
    error,
    actualizado,
    /** Tras guardar algo desde la pantalla: `recargar(true)` actualiza sin atenuar la tabla. */
    recargar: (silencioso = false) => consultar(silencioso, true),
  }
}
