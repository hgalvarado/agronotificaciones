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
import { anclarA } from '@/lib/ui/anclaje'

export type OpcionCelda = { value: string; label: string }

export function SelectorCelda({
  valor,
  opciones,
  onElegir,
  className = '',
  textoVacio = '—',
  onCrear,
}: {
  valor: string
  opciones: OpcionCelda[]
  /** Cadena vacía quiere decir «déjalo sin asignar». */
  onElegir: (valor: string) => void
  className?: string
  textoVacio?: string
  /**
   * Crear en el catálogo lo que falta, desde la celda, y dejarlo
   * elegido. Devuelve el identificador de lo recién creado.
   */
  onCrear?: (texto: string) => Promise<string>
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

  // Con creación en línea siempre va el panel: la rueda nativa del
  // teléfono no tiene dónde poner un «Crear», y quedarse sin poder crear
  // porque el catálogo todavía es corto es justo el caso del primer día.
  if (!onCrear && opciones.length <= UMBRAL_BUSQUEDA) {
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

  // La posición se calcula en el CLIC —leer `ref.current` durante el
  // render es lo que prohíbe `react-hooks/refs`— y dónde CABE lo decide
  // `anclarPanel`. Es el caso que más se notaba: la celda de la última
  // fila de una tabla corta queda al pie de la pantalla, y su panel se
  // abría por debajo del borde de la ventana.
  function abrir(e: React.MouseEvent<HTMLButtonElement>) {
    if (caja) return setCaja(null)
    setCaja(
      anclarA(e.currentTarget, {
        ancho: Math.max(e.currentTarget.getBoundingClientRect().width, ANCHO_MINIMO),
        altoDeseado: 360,
      })
    )
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
          onCrear={
            onCrear
              ? async (texto) => {
                  const nuevo = await onCrear(texto)
                  setCaja(null)
                  onElegir(nuevo)
                }
              : undefined
          }
        />
      )}
    </>
  )
}
