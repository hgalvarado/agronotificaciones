'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { IconX } from './Icons'

export function Modal({
  abierto,
  onCerrar,
  titulo,
  children,
  pie,
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  children: React.ReactNode
  pie?: React.ReactNode
}) {
  useEffect(() => {
    if (!abierto) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [abierto, onCerrar])

  if (!abierto) return null
  // Durante el render en servidor no existe document; un modal nunca está
  // abierto en ese momento (siempre lo abre una interacción del usuario),
  // así que basta con salir.
  if (typeof document === 'undefined') return null

  const contenido = (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain">
      <div
        className="anim-fundido fixed inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        onClick={onCerrar}
        aria-hidden="true"
      />

      {/* En celular el modal se ANCLA ARRIBA; sólo desde `sm` se centra.
          Centrado verticalmente, al abrirse el teclado el alto visible se
          parte a la mitad y el navegador recalcula el centro en cada
          pulsación: el modal brincaba y el campo de búsqueda se salía de
          la pantalla. Anclado arriba, el punto de partida no se mueve
          aunque el teclado cambie de alto.

          `max-h-[85svh]` tenía el mismo problema: `svh` es el alto de la
          ventana pequeña y no baja al abrir el teclado, así que el modal
          seguía midiendo 85% de la pantalla completa y su mitad inferior
          quedaba debajo del teclado. `dvh` sí sigue al teclado, y con el
          modal anclado arriba lo que queda visible es la parte de arriba,
          que es donde están el buscador y los primeros resultados. */}
      <div className="relative flex min-h-full items-start justify-center p-3 sm:items-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={titulo}
          className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-float)] sm:max-h-[85svh] sm:max-w-lg"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
            <button
              onClick={onCerrar}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Cerrar"
            >
              <IconX />
            </button>
          </div>

          <div className="scroll-suave min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {pie && <div className="shrink-0 border-t border-slate-100 px-5 py-4">{pie}</div>}
        </div>
      </div>
    </div>
  )

  // CLAVE: el modal se renderiza en <body> mediante un portal.
  //
  // `position: fixed` NO se posiciona contra la pantalla si algún ancestro
  // tiene `transform`, `filter`, `backdrop-filter`, `perspective` o
  // `contain` — ese ancestro pasa a ser su marco de referencia. En esta app
  // varias pantallas usan la animación de entrada (transform) y las barras
  // usan backdrop-blur, así que el modal terminaba dimensionándose contra
  // el contenedor de la página y se veía recortado.
  //
  // Sacándolo del árbol con un portal, ningún estilo de la página puede
  // volver a afectarlo. Es la solución definitiva, no un parche de tamaños.
  return createPortal(contenido, document.body)
}
