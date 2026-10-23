'use client'

/**
 * El interruptor HNL / USD de telecom y la tasa con la que convierte.
 *
 * Sólo cambia cómo se LEE el costo: lo que se guarda y se suma sigue
 * siendo `costo_mensual`, en lempiras (migración 77). La tasa es la de
 * `fn_tasa_de_temporada` de hoy, la misma que usa el disparador de la base
 * al convertir un plan escrito en dólares.
 */

import { useEffect, useState } from 'react'
import { hoyIso } from '@/lib/fechas'
import { leerTasaHoy } from '@/lib/telecom/repositorioCliente'
import type { Moneda } from '@/lib/telecom/tipos'

export function useTasaHoy(): number | null {
  const [tasa, setTasa] = useState<number | null>(null)
  useEffect(() => {
    let vivo = true
    leerTasaHoy(hoyIso()).then((t) => {
      if (vivo) setTasa(t)
    })
    return () => {
      vivo = false
    }
  }, [])
  return tasa
}

export function ToggleMoneda({
  valor,
  onCambiar,
  tasa,
}: {
  valor: Moneda
  onCambiar: (m: Moneda) => void
  tasa: number | null
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Moneda"
        className="inline-flex rounded-full bg-slate-100 p-0.5 ring-1 ring-inset ring-slate-200"
      >
        {(['HNL', 'USD'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={valor === m}
            onClick={() => onCambiar(m)}
            disabled={m === 'USD' && !tasa}
            className={`min-h-9 min-w-14 rounded-full px-3 text-xs font-bold transition-all disabled:opacity-40 ${
              valor === m
                ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <span className="text-[11px] tabular-nums text-slate-400">
        {tasa ? `Tasa L ${tasa.toFixed(4)}` : 'Sin tasa vigente'}
      </span>
    </div>
  )
}
