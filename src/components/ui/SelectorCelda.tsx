'use client'

/**
 * El desplegable de una CELDA editable.
 *
 * Es el mismo panel con buscador del campo de formulario, pero con la
 * cara de una celda: sin borde hasta que se pasa por encima, del alto de
 * la fila y sin desplazar la tabla al abrirse. Por eso comparte el panel
 * con `Selector` en vez de tener una lista propia: si la búsqueda se
 * comportara distinto dentro de la cuadrícula, la misma labor se
 * encontraría de dos maneras según dónde se esté editando.
 *
 * Con pocas opciones se queda el `<select>` nativo, por lo mismo que
 * allí: en el celular abre la rueda del sistema.
 */

import { useMemo, useRef, useState } from 'react'
import { IconChevronDown } from './Icons'
import { ANCHO_MINIMO, PanelOpciones, UMBRAL_BUSQUEDA, type CajaPanel } from './Selector'

export type OpcionCelda = { value: string; label: string }

export function SelectorCelda({
  valor,
  opciones,
  onElegir,
  className = '',
  textoVacio = '—',
}: {
  valor: string
  opciones: OpcionCelda[]
  /** Cadena vacía quiere decir «déjalo sin asignar». */
  onElegir: (valor: string) => void
  className?: string
  textoVacio?: string
}) {
  const [caja, setCaja] = useState<CajaPanel | null>(null)
  const buscador = useRef<HTMLInputElement>(null)

  const lista = useMemo(
    () => [
      { valor: '', texto: textoVacio, deshabilitada: false },
      ...opciones.map((o) => ({ valor: o.value, texto: o.label, deshabilitada: false })),
    ],
    [opciones, textoVacio]
  )

  if (opciones.length <= UMBRAL_BUSQUEDA) {
    return (
      <select
        value={valor}
        onChange={(e) => onElegir(e.target.value)}
        className={`${className} bg-transparent`}
      >
        <option value="">{textoVacio}</option>
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  // La posición se calcula en el CLIC: leer `ref.current` durante el
  // render es lo que prohíbe `react-hooks/refs`.
  function abrir(e: React.MouseEvent<HTMLButtonElement>) {
    if (caja) return setCaja(null)
    const r = e.currentTarget.getBoundingClientRect()
    const ancho = Math.max(r.width, ANCHO_MINIMO)
    setCaja({
      left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)),
      top: r.bottom + 4,
      ancho,
    })
    setTimeout(() => buscador.current?.focus({ preventScroll: true }), 60)
  }

  const elegida = lista.find((o) => o.valor === valor)

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        aria-haspopup="listbox"
        aria-expanded={caja !== null}
        className={`${className} flex items-center justify-between gap-1 bg-transparent text-left`}
      >
        <span className="min-w-0 flex-1 truncate">{elegida?.texto ?? textoVacio}</span>
        <IconChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-300" />
      </button>

      {caja && (
        <PanelOpciones
          caja={caja}
          opciones={lista}
          actual={valor}
          onElegir={(v) => {
            setCaja(null)
            onElegir(v)
          }}
          onCerrar={() => setCaja(null)}
          refBuscador={buscador}
        />
      )}
    </>
  )
}
