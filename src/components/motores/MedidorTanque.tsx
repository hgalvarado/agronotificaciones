'use client'

/**
 * Medidor de combustible: barra horizontal de E (vacío) a F (lleno) con el relleno del color de la zona. Arriba dice «Combustible»
 * y cuántos galones hay de cuántos de capacidad. Accesible: role=meter con el texto completo; el color nunca va solo.
 */

import { cantidad } from '@/lib/fertirriego/calculos'
import { medidorTanque, type ZonaIndicador } from '@/lib/motores/indicadores'

const RELLENO: Record<ZonaIndicador, string> = { rojo: 'bg-red-600', amarillo: 'bg-amber-500', verde: 'bg-emerald-600', gris: 'bg-slate-300' }

export function MedidorTanque({ saldo, capacidad }: { saldo: number | null; capacidad: number | null; grande?: boolean }) {
  const { pct, zona } = medidorTanque(saldo, capacidad)
  const texto = saldo === null ? 'Sin tanque' : capacidad ? `${cantidad(saldo)} de ${cantidad(capacidad)} gal` : `${cantidad(saldo)} gal`
  const etiqueta = saldo === null ? 'Combustible: sin tanque conectado' : `Combustible: ${texto}${pct === null ? '' : `, ${pct} % lleno`}`
  return (
    <span className="block w-full" data-medidor-tanque={zona}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Combustible</span>
        <span className="text-sm font-medium tabular-nums text-slate-900">{texto}</span>
      </span>
      <span
        className="mt-0.5 flex items-center gap-1.5"
      >
        <span className="text-[11px] font-semibold leading-none text-slate-500" aria-hidden="true">E</span>
        <span
          className="relative block h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200"
          role="meter"
          aria-label={etiqueta}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? 0}
        >
          {pct !== null && pct > 0 && <span className={`absolute inset-y-0 left-0 ${RELLENO[zona]}`} style={{ width: `${Math.max(pct, 3)}%` }} />}
        </span>
        <span className="text-[11px] font-semibold leading-none text-slate-500" aria-hidden="true">F</span>
      </span>
    </span>
  )
}
