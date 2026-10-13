'use client'

/**
 * Una lista de etiquetas que se escriben a mano.
 *
 * ── Por qué no un desplegable ───────────────────────────────────────
 *
 * Porque no hay catálogo. Los objetivos de control —nematodos, hongos de
 * suelo, malezas— no están dados de alta en ningún sitio, y obligar a
 * crearlos antes de poder anotarlos es la clase de fricción que acaba
 * con el campo vacío: quien está registrando un químico a las seis de la
 * mañana no va a abrir otra pantalla para dar de alta «Mal de Panamá».
 *
 * ── Por qué no un texto separado por comas ──────────────────────────
 *
 * Porque entonces la coma es parte de la gramática y nadie lo sabe: se
 * escribe «nematodos y hongos» y queda una sola etiqueta con la que no
 * se puede buscar. Con fichas visibles, lo que hay guardado se ve, y
 * quitar una es tocar su aspa en vez de editar una cadena a ciegas.
 *
 * Enter y la coma confirman la etiqueta en curso; la tecla de borrar con
 * el campo vacío quita la última, que es el gesto que todo el mundo
 * espera de un campo de fichas.
 */

import { useState, type KeyboardEvent } from 'react'
import { IconX } from './Icons'

const baseCampo =
  'w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-[var(--shadow-card)] ' +
  'transition-colors focus-within:border-brand-600 focus-within:ring-4 focus-within:ring-brand-600/10 ' +
  'aria-disabled:bg-slate-50'

export function EntradaEtiquetas({
  valores,
  onCambiar,
  disabled,
  placeholder = 'Escribe y pulsa Enter',
  className = '',
  'aria-label': ariaLabel,
}: {
  valores: string[]
  onCambiar: (valores: string[]) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
}) {
  const [borrador, setBorrador] = useState('')

  function agregar(texto: string) {
    const limpio = texto.trim()
    if (!limpio) return
    // No se repite lo que ya está, ignorando mayúsculas para comparar
    // pero guardando lo que se escribió: «Mal de Panamá» es un nombre
    // propio y bajarlo a minúsculas lo haría ilegible.
    if (valores.some((v) => v.toLowerCase() === limpio.toLowerCase())) {
      setBorrador('')
      return
    }
    onCambiar([...valores, limpio])
    setBorrador('')
  }

  function teclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      // Enter dentro de un formulario lo ENVÍA. Aquí confirma la
      // etiqueta y nada más: sin esto, escribir la primera etiqueta
      // guardaría el formulario a medias.
      e.preventDefault()
      agregar(borrador)
      return
    }
    if (e.key === 'Backspace' && borrador === '' && valores.length > 0) {
      onCambiar(valores.slice(0, -1))
    }
  }

  return (
    <div className={`${baseCampo} ${className}`} aria-disabled={disabled}>
      <div className="flex flex-wrap items-center gap-1">
        {valores.map((v) => (
          <span
            key={v}
            className="flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-slate-600"
          >
            {v}
            {!disabled && (
              <button
                type="button"
                onClick={() => onCambiar(valores.filter((x) => x !== v))}
                aria-label={`Quitar ${v}`}
                className="rounded-full p-0.5 text-slate-400 transition-colors hover:bg-white hover:text-red-600"
              >
                <IconX className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}

        <input
          type="text"
          value={borrador}
          disabled={disabled}
          aria-label={ariaLabel}
          placeholder={valores.length === 0 ? placeholder : ''}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={teclear}
          // Al salir del campo se confirma lo que quedara escrito: quien
          // teclea la última etiqueta y pulsa Guardar no pierde su texto
          // por no haber pulsado Enter antes.
          onBlur={() => agregar(borrador)}
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1.5 py-1 text-base outline-none placeholder:text-slate-300 disabled:text-slate-400"
        />
      </div>
    </div>
  )
}
