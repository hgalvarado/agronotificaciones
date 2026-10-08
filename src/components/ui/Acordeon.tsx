'use client'

/**
 * Una sección que se abre y se cierra.
 *
 * Existe por el teléfono. Un formulario de treinta campos en una pantalla
 * de cinco pulgadas es una tira interminable en la que nadie sabe por
 * dónde va ni cuánto falta; partido en secciones que se pliegan, se ve el
 * índice completo de un vistazo y se abre sólo lo que toca ahora.
 *
 * Tres decisiones:
 *
 * - **El encabezado es un `<button>` de ancho completo.** En el celular
 *   se toca con el pulgar sin apuntar, y el teclado llega a él con Tab.
 * - **El contenido se queda montado al cerrarse.** Si se desmontara, un
 *   campo a medio escribir se perdería al plegar la sección por error —y
 *   peor: la validación no podría mirar lo que hay dentro.
 * - **El resumen va en el encabezado.** Cerrada, la sección tiene que
 *   seguir diciendo lo suyo («3 lotes · 12.40 mz»), o plegarla sería
 *   esconder información en vez de ordenarla.
 */

import { useId, type ReactNode } from 'react'
import { IconChevronDown } from './Icons'

export function Acordeon({
  titulo,
  descripcion,
  resumen,
  abierto,
  onAlternar,
  children,
}: {
  titulo: string
  descripcion?: string
  /** Lo que la sección dice de sí misma estando cerrada. */
  resumen?: ReactNode
  abierto: boolean
  onAlternar: () => void
  children: ReactNode
}) {
  const id = useId()

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierto}
        aria-controls={id}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            abierto ? '' : '-rotate-90'
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{titulo}</span>
          {descripcion && (
            <span className="mt-0.5 block text-xs text-slate-400">{descripcion}</span>
          )}
        </span>
        {resumen !== undefined && resumen !== null && (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
            {resumen}
          </span>
        )}
      </button>

      {/* `hidden` y no desmontar: lo escrito sigue ahí al plegar. */}
      <div id={id} hidden={!abierto} className="border-t border-slate-100 px-3.5 py-3.5">
        {children}
      </div>
    </section>
  )
}
