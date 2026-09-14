'use client'

/**
 * Grupo de casillas con «Seleccionar todos».
 *
 * Un desplegable obliga a elegir UNA cosa; estas casillas dejan marcar
 * las que sean, que es justo la diferencia entre «hasta qué proceso» y
 * «cuáles procesos».
 *
 * Cada fila es UN botón entero, no una casilla dentro de una etiqueta.
 * Un `<label>` que envuelve a un `<button>` reenvía el clic al botón: se
 * marca y se desmarca en el mismo toque y parece que no responde. Además,
 * con toda la fila pulsable el blanco es del tamaño del dedo.
 *
 * No sabe qué se está marcando ni lo guarda: recibe opciones, devuelve
 * lo marcado. Quien lo usa decide qué significa.
 */

import { IconCheck } from './Icons'

export type OpcionCasilla = { valor: string; etiqueta: string; ayuda?: string }

export function GrupoCasillas({
  opciones,
  marcados,
  onCambiar,
  disabled = false,
  etiquetaTodos = 'Seleccionar todos',
  columnas = 2,
}: {
  opciones: OpcionCasilla[]
  marcados: string[]
  onCambiar: (valores: string[]) => void
  disabled?: boolean
  etiquetaTodos?: string
  /** Cuántas columnas en pantalla ancha. En celular siempre es una. */
  columnas?: 1 | 2 | 3
}) {
  const marcadosSet = new Set(marcados)
  const todos = opciones.length > 0 && opciones.every((o) => marcadosSet.has(o.valor))

  function alternar(valor: string) {
    onCambiar(marcadosSet.has(valor) ? marcados.filter((v) => v !== valor) : [...marcados, valor])
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        role="checkbox"
        // Ni todo ni nada: se dibuja a medias para que se vea de un
        // vistazo que hay algo marcado sin tener que contar.
        aria-checked={todos ? 'true' : marcados.length > 0 ? 'mixed' : 'false'}
        aria-label={etiquetaTodos}
        disabled={disabled}
        onClick={() => onCambiar(todos ? [] : opciones.map((o) => o.valor))}
        className="flex items-center gap-2 border-b border-slate-100 pb-2 text-left disabled:opacity-40"
      >
        <Casilla marcada={todos} parcial={!todos && marcados.length > 0} />
        <span className="text-sm font-semibold text-slate-700">{etiquetaTodos}</span>
        <span className="ml-auto text-xs tabular-nums text-slate-400">
          {marcados.length} de {opciones.length}
        </span>
      </button>

      <div
        className={`grid grid-cols-1 gap-2 ${
          columnas === 1 ? '' : columnas === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'
        }`}
      >
        {opciones.map((o) => {
          const marcada = marcadosSet.has(o.valor)
          return (
            <button
              key={o.valor}
              type="button"
              role="checkbox"
              aria-checked={marcada}
              aria-label={o.etiqueta}
              disabled={disabled}
              onClick={() => alternar(o.valor)}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40 ${
                marcada
                  ? 'border-brand-600/40 bg-brand-50/50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <Casilla marcada={marcada} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-700">{o.etiqueta}</span>
                {o.ayuda && <span className="block text-xs text-slate-400">{o.ayuda}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Sólo el cuadradito. No es pulsable: lo es la fila entera. */
function Casilla({ marcada, parcial = false }: { marcada: boolean; parcial?: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-all ${
        marcada || parcial ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
      }`}
    >
      {marcada ? (
        <IconCheck className="h-3 w-3" />
      ) : parcial ? (
        <span className="h-0.5 w-2 rounded-full bg-white" />
      ) : null}
    </span>
  )
}
