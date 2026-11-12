'use client'

/**
 * «¿Cómo se usa?»: el Manual del estacionero (docs/manuales/01-estacionero-fertirriego.md) dentro de la app. El texto
 * llega con la página, así que también se puede leer SIN SEÑAL (la pantalla de campo queda guardada en el teléfono).
 */

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { renderizar, secciones } from '@/lib/manual/markdown'

export function AyudaFertirriego({ manual }: { manual: string }) {
  const [abierto, setAbierto] = useState(false)
  const contenido = useMemo(() => (abierto ? renderizar(manual) : null), [abierto, manual])
  const indice = useMemo(() => secciones(manual), [manual])

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} data-ayuda className="self-end text-xs font-bold text-brand-700 underline">
        ¿Cómo se usa?
      </button>
      {abierto && (
        <Modal abierto onCerrar={() => setAbierto(false)} titulo="Manual del estacionero" ancho="ancho">
          <div className="flex flex-col gap-3" data-manual>
            <nav aria-label="Temas del manual" className="flex flex-wrap gap-1.5">
              {indice.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
                >
                  {s.titulo.replace(/^\d+\.\s*/, '')}
                </button>
              ))}
            </nav>
            {contenido}
          </div>
        </Modal>
      )}
    </>
  )
}
