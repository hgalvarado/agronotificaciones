'use client'

/**
 * La explicación de un campo, detrás de una «i».
 *
 * ── Por qué dejó de ir debajo del input (migración 71) ──────────────
 *
 * La ayuda se escribía bajo cada campo, en gris pequeño. Dicha una vez
 * aclara; repetida en diecisiete campos **duplica el alto del
 * formulario**. En un teléfono con el teclado subido quedaban dos campos
 * a la vista, y capturar un turno era desplazar, escribir, desplazar.
 *
 * Y la ayuda se lee **una vez**: quien captura turnos todos los días ya
 * sabe que el fin puede ser del día siguiente. Lo que necesita a diario
 * es ver más campos, no leer otra vez lo que ya aprendió.
 *
 * Así que baja a un icono junto a la etiqueta. Quien no sabe, toca; quien
 * ya sabe, no paga el espacio.
 *
 * ── Por qué es un `span` con rol y no un `<button>` ─────────────────
 *
 * Porque vive DENTRO del `<label>` del campo, y `<button>` es un
 * elemento *etiquetable*: el navegador le da la etiqueta del `label` al
 * primero que encuentre, así que un botón ahí dentro **le roba la
 * etiqueta al input**. El campo se queda sin nombre accesible —el lector
 * de pantalla diría «cuadro de edición» y nada más— y tocar el texto
 * deja de enfocarlo.
 *
 * Un `span` no es etiquetable, así que la etiqueta sigue siendo del
 * campo. El rol y el manejo del teclado se ponen a mano, que es el
 * precio de no romper lo otro.
 *
 * ── Por qué va en un portal ─────────────────────────────────────────
 *
 * El globo se dibuja en `document.body` con `anclarPanel`, igual que los
 * demás paneles del sistema. Un globo dibujado dentro del campo lo
 * recorta el `overflow` del modal o del acordeón, que es el mismo fallo
 * que ya se arregló en los selectores: no es cuestión de `z-index`, el
 * recorte lo hace el padre.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { anclarA, type Anclaje } from '@/lib/ui/anclaje'

const ANCHO = 260

export function Ayuda({ texto, etiqueta }: { texto: string; etiqueta?: string }) {
  const [caja, setCaja] = useState<Anclaje | null>(null)
  const boton = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!caja) return
    // Se cierra al tocar fuera y con Escape, como cualquier otro globo.
    // Y también al desplazar: un globo anclado a un sitio que ya no está
    // debajo señala al campo equivocado.
    // Los tipos del DOM, no los de React: estos manejadores se cuelgan
    // de `document`, no de un elemento del árbol.
    const fuera = (e: globalThis.MouseEvent) => {
      if (!boton.current?.contains(e.target as Node)) setCaja(null)
    }
    /*
     * Escape cierra EL GLOBO y nada más.
     *
     * Se escucha en fase de captura y se para la propagación: el modal
     * que hay detrás también escucha Escape, y sin esto una explicación
     * se cerraba llevándose por delante el formulario entero. Perder un
     * turno a medio capturar por pedir una ayuda es el peor intercambio
     * posible.
     */
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setCaja(null)
    }
    const mover = () => setCaja(null)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla, true)
    window.addEventListener('scroll', mover, true)
    window.addEventListener('resize', mover)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla, true)
      window.removeEventListener('scroll', mover, true)
      window.removeEventListener('resize', mover)
    }
  }, [caja])

  function alternar(e: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) {
    // Un clic dentro de un `<label>` enfoca el campo que envuelve, y en
    // el teléfono eso levanta el teclado justo al pedir una explicación.
    // `preventDefault` cancela ese gesto y deja sólo el del globo.
    e.preventDefault()
    if (caja) return setCaja(null)
    setCaja(anclarA(e.currentTarget, { ancho: ANCHO, altoDeseado: 160 }))
  }

  return (
    <>
      <span
        ref={boton}
        role="button"
        tabIndex={0}
        onClick={alternar}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') alternar(e)
        }}
        // No es un `title`: en un teléfono no hay ratón que se pose
        // encima, así que un `title` es una ayuda que no existe.
        aria-label={etiqueta ? `Qué es ${etiqueta}` : 'Qué es este campo'}
        aria-expanded={caja !== null}
        className="inline-flex h-4 w-4 shrink-0 cursor-pointer select-none items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold leading-none text-slate-400 transition-colors hover:border-brand-600 hover:text-brand-700"
      >
        i
      </span>

      {caja &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            className="fixed z-[60] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 shadow-[var(--shadow-float)]"
            style={{ left: caja.left, top: caja.top, width: caja.ancho, maxHeight: caja.maxAlto }}
          >
            {texto}
          </div>,
          document.body
        )}
    </>
  )
}
