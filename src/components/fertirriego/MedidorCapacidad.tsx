'use client'

/**
 * Medidor de capacidad (E ··· F): cuánto hay de cuánto cabe y «Puede recibir N». Lo usan la pestaña General de
 * Fertirriego (por solución) y la de Motores (por estación). El color nunca va solo: siempre hay texto.
 */

import { cantidad } from '@/lib/fertirriego/calculos'
import { espacioDisponible, medidorCapacidad, type ZonaCapacidad } from '@/lib/fertirriego/capacidad'

const RELLENO: Record<ZonaCapacidad, string> = { rojo: 'bg-red-600', amarillo: 'bg-amber-500', verde: 'bg-emerald-600', gris: 'bg-slate-300' }

export function MedidorCapacidad({
  etiqueta,
  saldo,
  capacidad,
  unidad,
  alertaBajo = false,
  nota,
}: {
  etiqueta: string
  saldo: number
  capacidad: number | null | undefined
  unidad: string
  /** Diésel: vacío también es alerta. */
  alertaBajo?: boolean
  /** Texto corto bajo el medidor (p. ej. «Usa también el tanque de Generativa»). */
  nota?: string | null
}) {
  const { pct, zona } = medidorCapacidad(saldo, capacidad, alertaBajo)
  const espacio = capacidad && capacidad > 0 ? espacioDisponible(capacidad, saldo) : null
  const texto = capacidad && capacidad > 0 ? `${cantidad(saldo)} de ${cantidad(capacidad)} ${unidad}` : `${cantidad(saldo)} ${unidad} · tanque prestado`
  const etiquetaMeter = `${etiqueta}: ${texto}${pct === null ? '' : `, ${pct} % lleno`}`
  return (
    <span className="block w-full" data-medidor-capacidad={zona}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-slate-500">{etiqueta}</span>
        <span className="shrink-0 text-sm font-medium tabular-nums text-slate-900">{texto}</span>
      </span>
      <span className="mt-0.5 flex items-center gap-1.5">
        <span className="text-[11px] font-semibold leading-none text-slate-500" aria-hidden="true">E</span>
        <span
          className="relative block h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200"
          role="meter"
          aria-label={etiquetaMeter}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? 0}
        >
          {pct !== null && pct > 0 && <span className={`absolute inset-y-0 left-0 ${RELLENO[zona]}`} style={{ width: `${Math.max(pct, 3)}%` }} />}
        </span>
        <span className="text-[11px] font-semibold leading-none text-slate-500" aria-hidden="true">F</span>
      </span>
      <span className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-slate-600">
        <span className="min-w-0 truncate">{nota ?? ''}</span>
        {espacio !== null && (
          <span className={`shrink-0 font-semibold tabular-nums ${espacio === 0 ? 'text-red-700' : 'text-slate-800'}`} data-puede-recibir>
            {espacio === 0 ? 'Lleno' : `Puede recibir ${cantidad(espacio)} ${unidad}`}
          </span>
        )}
      </span>
    </span>
  )
}
