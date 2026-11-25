'use client'

/**
 * Medidor de combustible tipo tablero de carro: arco de E (vacío) a F (lleno), relleno y aguja del color de la zona, y al lado
 * solo el número («39 gal»). Accesible: role=img con el texto completo; el color nunca va solo (siempre hay número y E/F).
 */

import { cantidad } from '@/lib/fertirriego/calculos'
import { medidorTanque, puntoArco, trazoArco, type ZonaIndicador } from '@/lib/motores/indicadores'

const COLOR: Record<ZonaIndicador, string> = { rojo: 'text-red-600', amarillo: 'text-amber-500', verde: 'text-emerald-600', gris: 'text-slate-400' }

export function MedidorTanque({ saldo, capacidad, grande = false }: { saldo: number | null; capacidad: number | null; grande?: boolean }) {
  const { pct, zona } = medidorTanque(saldo, capacidad)
  const punta = puntoArco(pct ?? 0, 34)
  const texto = saldo === null ? 'Sin tanque' : `${cantidad(saldo)} gal`
  const etiqueta = saldo === null ? 'Sin tanque conectado' : pct === null ? `Tanque con ${cantidad(saldo)} galones` : `Tanque con ${cantidad(saldo)} galones, ${pct} % lleno`
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={etiqueta} data-medidor-tanque={zona}>
      <svg viewBox="0 0 100 64" className={grande ? 'h-14 w-24' : 'h-9 w-16'} aria-hidden="true" focusable="false">
        <path d={trazoArco(100, 40)} fill="none" strokeWidth="9" strokeLinecap="round" className="stroke-current text-slate-200" />
        {pct !== null && pct > 0 && <path d={trazoArco(pct, 40)} fill="none" strokeWidth="9" strokeLinecap="round" className={`stroke-current ${COLOR[zona]}`} />}
        {pct !== null && <line x1="50" y1="50" x2={punta.x} y2={punta.y} strokeWidth="3" strokeLinecap="round" className="stroke-current text-slate-700" />}
        <circle cx="50" cy="50" r="4" className="fill-current text-slate-700" />
        <text x="6" y="62" fontSize="14" fontWeight="500" className="fill-current text-slate-500">E</text>
        <text x="86" y="62" fontSize="14" fontWeight="500" className="fill-current text-slate-500">F</text>
      </svg>
      <span className={`${grande ? 'text-base' : 'text-sm'} font-medium tabular-nums text-slate-900`}>{texto}</span>
    </span>
  )
}
