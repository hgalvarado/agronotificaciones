'use client'

/**
 * Barra de progreso del mantenimiento: horas desde el último mantenimiento sobre el intervalo. El fondo tiene la zona verde y la
 * ámbar (el aviso); el relleno es del color de la zona (rojo al vencer) y la parte ESTIMADA se dibuja más clara. Al lado solo
 * «faltan 16 h» o «vencido 19 h». Accesible: role=meter con el texto completo; nunca solo color.
 */

import { barraMantenimiento, type ZonaIndicador } from '@/lib/motores/indicadores'

const RELLENO: Record<ZonaIndicador, string> = { rojo: 'bg-red-600', amarillo: 'bg-amber-500', verde: 'bg-emerald-600', gris: 'bg-slate-300' }
const TEXTO: Record<ZonaIndicador, string> = { rojo: 'text-red-700', amarillo: 'text-amber-700', verde: 'text-slate-700', gris: 'text-slate-500' }

export function BarraMantenimiento({ horas, estimadas = 0, intervalo, aviso }: { horas: number; estimadas?: number; intervalo: number | null; aviso?: number | null }) {
  const b = barraMantenimiento({ horas, estimadas, intervalo, aviso })
  const etiqueta = b.sinIntervalo ? 'Mantenimiento: sin intervalo' : `Mantenimiento: ${b.texto}${estimadas > 0 ? `, incluye ${Math.round(estimadas * 10) / 10} horas estimadas` : ''}`
  return (
    <span className="block w-full" data-barra-mant={b.zona}>
      <span className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Mantenimiento</span>
        <span className={`text-sm font-medium tabular-nums ${TEXTO[b.zona]}`}>{b.texto}</span>
      </span>
      <span
        className="relative mt-0.5 block h-2.5 w-full overflow-hidden rounded-full bg-emerald-100"
        role="meter"
        aria-label={etiqueta}
        aria-valuemin={0}
        aria-valuemax={intervalo ?? 0}
        aria-valuenow={Math.round(horas * 10) / 10}
      >
        {!b.sinIntervalo && (
          <>
            <span className="absolute inset-y-0 right-0 bg-amber-100" style={{ width: `${100 - b.pctAviso}%` }} />
            <span className={`absolute inset-y-0 left-0 ${RELLENO[b.zona]} opacity-50`} style={{ width: `${b.pct}%` }} />
            <span className={`absolute inset-y-0 left-0 ${RELLENO[b.zona]}`} style={{ width: `${b.pctReal}%` }} />
          </>
        )}
      </span>
    </span>
  )
}
