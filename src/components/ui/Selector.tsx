'use client'

/**
 * El desplegable estándar de la aplicación, con buscador.
 *
 * «Todo campo de tipo lista desplegable debe incluir obligatoriamente la
 *  funcionalidad de búsqueda interna.»
 *
 * En vez de cambiar cincuenta pantallas una por una, la búsqueda se pone
 * AQUÍ: todas usan este componente, así que todas la heredan el mismo
 * día. Se sigue escribiendo igual —`<Selector>` con sus `<option>`
 * dentro— y quien lo usa no se entera.
 *
 * Con pocas opciones se deja el `<select>` del sistema a propósito. En el
 * celular ese control abre la rueda nativa, que se maneja con el pulgar y
 * sin teclado; ponerle un buscador a tres opciones fijas —Ciclo 1, 2, 3—
 * sería más pasos para lo mismo. El buscador entra cuando la lista es
 * larga, que es cuando de verdad estorba.
 */

import { Children, isValidElement, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconChevronDown, IconSearch, IconX } from './Icons'

/** A partir de cuántas opciones aparece el buscador. */
export const UMBRAL_BUSQUEDA = 7

export const ANCHO_MINIMO = 240

const baseCampo =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900 ' +
  'shadow-[var(--shadow-card)] transition-colors placeholder:text-slate-300 ' +
  'focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10 ' +
  'disabled:bg-slate-50 disabled:text-slate-400'

const FLECHA =
  "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" fill=\"none\" stroke=\"%2394a3b8\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m6 9 6 6 6-6\"/></svg>')] bg-[length:20px_20px] bg-[right_0.75rem_center] bg-no-repeat pr-10"

export type Opcion = { valor: string; texto: string; deshabilitada: boolean }

/**
 * Saca las opciones de los hijos JSX.
 *
 * Se recorre en vez de pedir un arreglo para no tocar las pantallas que
 * ya existen: todas escriben `<option>` dentro, y así siguen valiendo.
 */
function leerOpciones(hijos: ReactNode): Opcion[] {
  const salida: Opcion[] = []

  Children.forEach(hijos, (hijo) => {
    if (!isValidElement(hijo)) return

    if (hijo.type === 'option') {
      const props = hijo.props as { value?: string | number; children?: ReactNode; disabled?: boolean }
      salida.push({
        valor: String(props.value ?? ''),
        texto: textoDe(props.children),
        deshabilitada: Boolean(props.disabled),
      })
      return
    }

    // Fragmentos y `optgroup`: se baja un nivel en vez de perderlos.
    const props = hijo.props as { children?: ReactNode }
    if (props?.children) salida.push(...leerOpciones(props.children))
  })

  return salida
}

/** El texto plano de una opción, para poder buscarlo y enseñarlo. */
function textoDe(nodo: ReactNode): string {
  if (nodo === null || nodo === undefined || typeof nodo === 'boolean') return ''
  if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo)
  if (Array.isArray(nodo)) return nodo.map(textoDe).join('')
  if (isValidElement(nodo)) return textoDe((nodo.props as { children?: ReactNode }).children)
  return ''
}

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function Selector({ className = '', children, ...props }: ComponentProps<'select'>) {
  const opciones = useMemo(() => leerOpciones(children), [children])

  if (opciones.length <= UMBRAL_BUSQUEDA || props.multiple) {
    return (
      <select className={`${baseCampo} ${FLECHA} ${className}`} {...props}>
        {children}
      </select>
    )
  }

  return <SelectorBuscado className={className} opciones={opciones} {...props} />
}

function SelectorBuscado({
  className,
  opciones,
  value,
  onChange,
  disabled,
  ...props
}: ComponentProps<'select'> & { opciones: Opcion[] }) {
  // La posición se calcula en el CLIC: leer `ref.current` durante el
  // render es lo que prohíbe `react-hooks/refs`.
  const [caja, setCaja] = useState<CajaPanel | null>(null)
  const buscador = useRef<HTMLInputElement>(null)

  const actual = String(value ?? '')
  const elegida = opciones.find((o) => o.valor === actual)

  function abrir(e: React.MouseEvent<HTMLButtonElement>) {
    if (caja) return cerrar()
    const r = e.currentTarget.getBoundingClientRect()
    const ancho = Math.max(r.width, ANCHO_MINIMO)
    setCaja({
      left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)),
      top: r.bottom + 6,
      ancho,
    })
    // El foco va después de pintar el panel; en el celular es lo que
    // levanta el teclado sin desplazar la página.
    setTimeout(() => buscador.current?.focus({ preventScroll: true }), 60)
  }

  function cerrar() {
    setCaja(null)
  }

  function elegir(elegido: string) {
    // Las pantallas leen `e.target.value` y nada más, así que basta con
    // eso. Es el precio de no reescribir cincuenta formularios.
    onChange?.({ target: { value: elegido } } as React.ChangeEvent<HTMLSelectElement>)
    cerrar()
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={abrir}
        aria-haspopup="listbox"
        aria-expanded={caja !== null}
        aria-label={props['aria-label']}
        id={props.id}
        className={`${baseCampo} flex items-center justify-between gap-2 text-left ${className ?? ''}`}
      >
        <span className={`min-w-0 flex-1 truncate ${elegida ? '' : 'text-slate-300'}`}>
          {elegida?.texto || opciones[0]?.texto || 'Selecciona…'}
        </span>
        <IconChevronDown className="h-5 w-5 shrink-0 text-slate-300" />
      </button>

      {caja && (
        <PanelOpciones
          caja={caja}
          opciones={opciones}
          actual={actual}
          onElegir={elegir}
          onCerrar={cerrar}
          refBuscador={buscador}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* El panel: la lista con su buscador, anclada al control              */
/* ------------------------------------------------------------------ */
/* Vive aparte porque lo usan dos controles distintos —el campo de      */
/* formulario y la celda editable de la cuadrícula— y la búsqueda tiene */
/* que comportarse igual en los dos.                                    */

export type CajaPanel = { left: number; top: number; ancho: number }

export function PanelOpciones({
  caja,
  opciones,
  actual,
  onElegir,
  onCerrar,
  refBuscador,
}: {
  caja: CajaPanel
  opciones: Opcion[]
  actual: string
  onElegir: (valor: string) => void
  onCerrar: () => void
  refBuscador?: React.RefObject<HTMLInputElement | null>
}) {
  const [busqueda, setBusqueda] = useState('')

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim())
    if (!q) return opciones
    return opciones.filter((o) => normalizar(o.texto).includes(q))
  }, [opciones, busqueda])

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onCerrar} />
      <div
        role="listbox"
        className="scroll-suave fixed z-50 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-[var(--shadow-float)]"
        style={{ left: caja.left, top: caja.top, width: caja.ancho }}
      >
        <div className="sticky top-0 z-10 bg-white pb-1.5">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input
              ref={refBuscador}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar…"
              inputMode="search"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-8 pr-8 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:bg-white focus:outline-none"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda('')}
                aria-label="Limpiar"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {visibles.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-400">
            Ningún resultado para «{busqueda}».
          </p>
        ) : (
          visibles.map((o) => (
            <button
              key={o.valor}
              type="button"
              role="option"
              aria-selected={o.valor === actual}
              disabled={o.deshabilitada}
              onClick={() => onElegir(o.valor)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
                o.valor === actual
                  ? 'bg-brand-50 font-semibold text-brand-800'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  o.valor === actual ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300'
                }`}
              >
                {o.valor === actual && <IconCheck className="h-2.5 w-2.5" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.texto}</span>
            </button>
          ))
        )}
      </div>
    </>,
    document.body
  )
}
