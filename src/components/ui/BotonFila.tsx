'use client'

/**
 * El botón de acción de una fila de la cuadrícula.
 *
 * Existe para que «Editar» y «Eliminar» se vean y se lean igual en las
 * cuatro pantallas. Un botón inventado en cada tabla es cómo se acaba con
 * «Quitar» en una y «Eliminar» en otra para la misma acción.
 */

import type { ReactNode } from 'react'

export function BotonFila({
  onClick,
  peligro,
  disabled,
  children,
}: {
  onClick: () => void
  peligro?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
        peligro
          ? 'border-slate-200 text-slate-500 hover:border-red-300 hover:bg-red-50 hover:text-red-700'
          : 'border-slate-200 text-slate-600 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800'
      }`}
    >
      {children}
    </button>
  )
}
