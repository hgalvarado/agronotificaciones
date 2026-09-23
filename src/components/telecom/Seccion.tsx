'use client'

/**
 * Un acordeón para partir una lista en «lo que se usa» y «lo que no».
 *
 * Existe porque las dos cuadrículas del módulo tienen el mismo problema:
 * las líneas suspendidas y las entregas finalizadas son la mayor parte de
 * las filas y casi nunca son lo que se viene a mirar. Esconderlas del
 * todo sería peor —hay que poder revivir una suspendida— así que se
 * guardan detrás de un título que dice cuántas hay.
 *
 * Lo cerrado no se MONTA: con dos años de historial, pintar la tabla de
 * finalizadas cada vez que se abre la pantalla cuesta lo mismo que
 * pintarla cuando alguien la pide, y nadie la pide casi nunca.
 */

import { useState, type ReactNode } from 'react'
import { IconChevronDown } from '@/components/ui/Icons'

export function Seccion({
  titulo,
  descripcion,
  cuantos,
  abiertoInicial = true,
  tono = 'normal',
  children,
}: {
  titulo: string
  descripcion?: string
  cuantos: number
  abiertoInicial?: boolean
  /** `apagado` para lo archivado: mismo sitio, menos peso visual. */
  tono?: 'normal' | 'apagado'
  children: ReactNode
}) {
  const [abierto, setAbierto] = useState(abiertoInicial)

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className={`flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
          tono === 'apagado' ? 'bg-slate-50/60' : ''
        }`}
      >
        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            abierto ? '' : '-rotate-90'
          }`}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm font-bold ${
              tono === 'apagado' ? 'text-slate-500' : 'text-slate-900'
            }`}
          >
            {titulo}
          </span>
          {descripcion && (
            <span className="block truncate text-xs text-slate-400">{descripcion}</span>
          )}
        </span>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
          {cuantos}
        </span>
      </button>

      {abierto && <div className="anim-aparecer border-t border-slate-100 p-3">{children}</div>}
    </section>
  )
}
