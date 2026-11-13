'use client'

/**
 * Borradores de los formularios del campo (pedido del usuario 2026-11-12: «si el usuario se sale por error no pierde
 * el registro que ya llevaba»).
 *
 * - Se guardan SOLOS en el teléfono (localStorage) mientras se escribe, por persona · estación · tipo de registro.
 *   Funcionan sin señal y sobreviven a cerrar la ventana, recargar o que se apague la pantalla.
 * - Al volver a abrir el mismo formulario, sigue donde iba y lo avisa («Continuando tu borrador de las 10:32»), con
 *   «Descartar» para empezar de cero.
 * - Se borran al guardar el registro. Vencen a los 7 días.
 * - Nunca se envían al servidor: un borrador no es un registro (no mueve la bodega).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const PREFIJO = 'fert:borrador:'
const VIGENCIA_MS = 7 * 24 * 3600_000

export type TipoBorrador = 'recepcion' | 'envases' | 'aplicacion' | 'conteo' | 'bitacora' | 'relevo' | 'traslado'

export const NOMBRE_BORRADOR: Record<TipoBorrador, string> = {
  recepcion: 'Recibir producto',
  envases: 'Envases',
  aplicacion: 'Aplicar',
  conteo: 'Conteo',
  bitacora: 'Horas de riego',
  relevo: 'Entregar estación',
  traslado: 'Traslado',
}

type Guardado<T> = { guardado: string; datos: T }

export function claveBorrador(tipo: TipoBorrador, usuario: string, estacion: string, extra = ''): string {
  return `${PREFIJO}${usuario}:${estacion}:${tipo}${extra ? `:${extra}` : ''}`
}

export function leerBorrador<T>(clave: string): Guardado<T> | null {
  try {
    const texto = localStorage.getItem(clave)
    if (!texto) return null
    const b = JSON.parse(texto) as Guardado<T>
    if (!b?.guardado || Date.now() - Date.parse(b.guardado) > VIGENCIA_MS) {
      localStorage.removeItem(clave)
      return null
    }
    return b
  } catch {
    return null
  }
}

export function borrarBorrador(clave: string) {
  try {
    localStorage.removeItem(clave)
  } catch {
    /* sin almacenamiento: no hay nada que borrar */
  }
}

/** Tipos de registro con borrador para esta persona y estación (para marcar los botones del panel). */
export function borradoresDe(usuario: string, estacion: string): Set<TipoBorrador> {
  const tipos = new Set<TipoBorrador>()
  try {
    const inicio = `${PREFIJO}${usuario}:${estacion}:`
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(inicio) && leerBorrador(k)) tipos.add(k.slice(inicio.length).split(':')[0] as TipoBorrador)
    }
  } catch {
    /* sin almacenamiento */
  }
  return tipos
}

export type Borrador<T> = {
  /** Dónde se guarda (localStorage). */
  clave: string
  /** Lo que se recuperó al abrir (null = formulario nuevo). Úsese solo para los valores iniciales. */
  inicial: T | null
  /** Hora (ISO) del borrador recuperado. */
  recuperado: string | null
  /** El formulario llama esto con sus datos en cada cambio; guarda solo si cambió respecto de lo que abrió. */
  guardar: (datos: T) => void
  /** Registro guardado: el borrador ya no sirve. */
  terminar: () => void
  /** La persona decide empezar de cero. */
  descartar: () => void
}

/** Hook de cada formulario. Avisa a la pantalla (evento) para que el panel marque el botón con «Borrador». */
export function useBorrador<T>(clave: string): Borrador<T> {
  const [abierto] = useState(() => leerBorrador<T>(clave))
  const terminado = useRef(false)

  const guardar = useCallback(
    (datos: T) => {
      if (terminado.current) return
      try {
        localStorage.setItem(clave, JSON.stringify({ guardado: new Date().toISOString(), datos }))
        window.dispatchEvent(new Event('fert:borradores'))
      } catch {
        /* sin espacio o almacenamiento bloqueado: el formulario sigue funcionando sin borrador */
      }
    },
    [clave]
  )
  const terminar = useCallback(() => {
    terminado.current = true
    borrarBorrador(clave)
    window.dispatchEvent(new Event('fert:borradores'))
  }, [clave])

  return { clave, inicial: abierto?.datos ?? null, recuperado: abierto?.guardado ?? null, guardar, terminar, descartar: terminar }
}

/** El borrador tal como está guardado (texto), para devolverlo si el guardado en segundo plano falla. */
export function copiaBorrador(clave: string): string | null {
  try {
    return localStorage.getItem(clave)
  } catch {
    return null
  }
}

/** Devuelve un borrador copiado con copiaBorrador (el guardado falló: que no se pierda lo escrito). */
export function restaurarBorrador(clave: string, texto: string | null) {
  if (!texto) return
  try {
    const b = JSON.parse(texto) as Guardado<unknown>
    // Con la hora de ahora, para que no venza y se vea como el más reciente
    localStorage.setItem(clave, JSON.stringify({ ...b, guardado: new Date().toISOString() }))
    window.dispatchEvent(new Event('fert:borradores'))
  } catch {
    /* sin almacenamiento: no hay cómo devolverlo */
  }
}

/** Guarda `datos` como borrador cada vez que cambian. */
export function useAutoguardado<T>(borrador: Borrador<T>, datos: T) {
  const texto = JSON.stringify(datos)
  // Como abrió el formulario (vacío o el borrador recuperado): mientras siga igual, no hay nada que guardar
  const [alAbrir] = useState(texto)
  const { guardar } = borrador
  // Sin pausa: si se cierra la ventana justo después de escribir, eso también queda (el texto es pequeño)
  useEffect(() => {
    if (texto !== alAbrir) guardar(JSON.parse(texto) as T)
  }, [texto, alAbrir, guardar])
}

/** Para el panel: tipos con borrador de esta persona en esta estación; se actualiza al escribir o descartar. */
export function useBorradoresEstacion(usuario: string, estacion: string): Set<TipoBorrador> {
  const [tipos, setTipos] = useState<Set<TipoBorrador>>(new Set())
  useEffect(() => {
    const leer = () => setTipos(borradoresDe(usuario, estacion))
    leer()
    window.addEventListener('fert:borradores', leer)
    window.addEventListener('storage', leer)
    return () => {
      window.removeEventListener('fert:borradores', leer)
      window.removeEventListener('storage', leer)
    }
  }, [usuario, estacion])
  return tipos
}
