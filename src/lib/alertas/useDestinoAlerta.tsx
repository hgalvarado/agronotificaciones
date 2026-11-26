'use client'

/**
 * Enlace profundo de las alertas, del lado de cada módulo de Campo (Motores, Fertirriego, Inyección).
 *
 *   const alerta = useDestinoAlerta()                 // lee ?pestana=&estacion=&tanque=&motor=&registro=&fecha= una sola vez
 *   alerta.destino                                    // lo leído (o {})
 *   alerta.activo                                     // hay enlace profundo por aplicar
 *   useResaltarDestino(alerta, { listo, ids })        // desplaza y resalta el elemento [data-destino~="<id>"]
 *   <AvisoDestinoPerdido alerta={alerta} />           // «Ese registro ya no existe» + botón al listado
 *
 * Con freno: reintenta hasta 12 veces cada 300 ms (esperando a que pinte la lista) y termina. Al aplicarse limpia
 * los parámetros de la barra de direcciones para que recargar no repita el salto.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { hayDestino, leerDestino, type DestinoLeido } from './destinos'

export type EstadoDestino = {
  destino: DestinoLeido
  activo: boolean
  perdido: boolean
  /** Marca el enlace como atendido (limpia la URL). */
  terminar: (perdido?: boolean) => void
  descartar: () => void
}

export function useDestinoAlerta(): EstadoDestino {
  const [destino] = useState<DestinoLeido>(() => (typeof window === 'undefined' ? {} : leerDestino(window.location.search)))
  const [activo, setActivo] = useState(() => hayDestino(destino))
  const [perdido, setPerdido] = useState(false)

  const terminar = useCallback((noEncontrado = false) => {
    setActivo(false)
    if (noEncontrado) setPerdido(true)
    try {
      window.history.replaceState(null, '', window.location.pathname)
    } catch {
      /* sin historial: no pasa nada */
    }
  }, [])
  const descartar = useCallback(() => setPerdido(false), [])
  return { destino, activo, perdido, terminar, descartar }
}

const INTENTOS = 12
const ESPERA_MS = 300

/**
 * Cuando `listo` (los datos ya están en pantalla), busca el primer elemento cuyo `data-destino` contenga alguno de
 * `ids` (en orden de prioridad), lo desplaza al centro y lo resalta ~3 s. Si no aparece, marca «perdido».
 */
export function useResaltarDestino(alerta: EstadoDestino, opciones: { listo: boolean; ids: (string | undefined)[]; permitirPerdido?: boolean }) {
  const { activo, terminar } = alerta
  const { listo, ids, permitirPerdido = true } = opciones
  const clave = ids.filter(Boolean).join('|')
  const hecho = useRef(false)

  useEffect(() => {
    if (!activo || !listo || hecho.current) return
    const lista = clave ? clave.split('|') : []
    if (lista.length === 0) {
      hecho.current = true
      const t = setTimeout(() => terminar(false), 0) // solo era abrir la pestaña/estación: ya está
      return () => clearTimeout(t)
    }
    let intento = 0
    let id: ReturnType<typeof setTimeout>
    const probar = () => {
      for (const valor of lista) {
        const el = document.querySelector<HTMLElement>(`[data-destino~="${CSS.escape(valor)}"]`)
        if (el) {
          hecho.current = true
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          el.classList.add('destino-resaltado')
          setTimeout(() => el.classList.remove('destino-resaltado'), 3500)
          terminar(false)
          return
        }
      }
      if (++intento >= INTENTOS) {
        hecho.current = true
        terminar(permitirPerdido)
        return
      }
      id = setTimeout(probar, ESPERA_MS)
    }
    id = setTimeout(probar, 50)
    return () => clearTimeout(id)
  }, [activo, listo, clave, terminar, permitirPerdido])
}

/** Aviso corto cuando el registro de la alerta ya no está (se eliminó, se archivó o es de otra estación). */
export function AvisoDestinoPerdido({ alerta, onListado }: { alerta: EstadoDestino; onListado?: () => void }) {
  if (!alerta.perdido) return null
  return (
    <div role="status" data-destino-perdido className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
      <span>Ese registro ya no existe.</span>
      <button
        type="button"
        onClick={() => {
          onListado?.()
          alerta.descartar()
        }}
        className="min-h-11 rounded-lg px-3 font-bold underline"
      >
        Ver el listado
      </button>
    </div>
  )
}

/**
 * Aplica el enlace profundo UNA vez cuando ya hay datos: elige la estación y la pestaña, y avisa (`alListo`) para que
 * `useResaltarDestino` busque el elemento. Si la estación del enlace no es de la persona: «Ese registro ya no existe».
 * `pestanaPorDefecto`: qué pestaña abrir cuando el enlace trae registro/fecha/tanque/motor pero no pestana.
 * Las funciones que se pasan deben ser estables (setters de useState o useCallback).
 */
export function useAplicarDestino(o: {
  alerta: EstadoDestino
  hayEstado: boolean
  estaciones: { id: string }[]
  pestanasValidas: string[]
  pestanaPorDefecto: (d: DestinoLeido) => string | null
  setEstacionId: (id: string) => void
  setPestana: (p: string) => void
  alListo: () => void
}) {
  const { alerta, hayEstado, estaciones, pestanasValidas, pestanaPorDefecto, setEstacionId, setPestana, alListo } = o
  const { activo, terminar, destino } = alerta
  const aplicada = useRef(false)
  const hayEstacion = Boolean(destino.estacion && estaciones.some((e) => e.id === destino.estacion))
  const validas = pestanasValidas.join('|')
  // bucle-ok: corre una sola vez (aplicada); los setters son de useState
  useEffect(() => {
    if (!activo || aplicada.current || !hayEstado) return
    aplicada.current = true
    setTimeout(() => {
      if (destino.estacion && !hayEstacion) return terminar(true)
      if (destino.estacion) setEstacionId(destino.estacion)
      const p = validas.split('|').find((v) => v === destino.pestana) ?? pestanaPorDefecto(destino)
      if (p) setPestana(p)
      alListo()
    }, 0)
  }, [activo, hayEstado, hayEstacion, destino, validas, terminar, pestanaPorDefecto, setEstacionId, setPestana, alListo])
}
