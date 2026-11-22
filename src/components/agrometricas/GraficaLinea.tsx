'use client'

/**
 * Gráfica de líneas por DDT en SVG puro (el proyecto no trae librería de gráficas). Dos tamaños: `compacta` (sparkline
 * de una tarjeta) y completa (ejes, puntos y banda opcional del intervalo de confianza que vendrá después).
 * Colores con significado: AM azul, PM ámbar; 24 cm punteado; punto rojo = fuera de rango al guardar.
 */

import { useMemo } from 'react'
import { escalar, type IntervaloPunto, type Serie } from '@/lib/agrometricas/registrosPura'

const COLOR: Record<string, string> = {
  tensiometro_12_am: 'stroke-sky-600', tensiometro_24_am: 'stroke-sky-600',
  tensiometro_12_pm: 'stroke-amber-600', tensiometro_24_pm: 'stroke-amber-600',
  ce_agua: 'stroke-sky-600', ce_gotero: 'stroke-emerald-600', ce_extractor: 'stroke-violet-600',
  ph_agua: 'stroke-sky-600', ph_gotero: 'stroke-emerald-600', ph_extractor: 'stroke-violet-600',
  cloro_cinta: 'stroke-teal-600', horas_riego: 'stroke-slate-600', pct_fertilizacion: 'stroke-lime-600',
  ic_real: 'stroke-emerald-600', ic_plan: 'stroke-slate-500', hojas: 'stroke-sky-600',
}
const RELLENO: Record<string, string> = {
  'stroke-sky-600': 'fill-sky-600', 'stroke-amber-600': 'fill-amber-600', 'stroke-emerald-600': 'fill-emerald-600',
  'stroke-violet-600': 'fill-violet-600', 'stroke-teal-600': 'fill-teal-600', 'stroke-slate-600': 'fill-slate-600', 'stroke-lime-600': 'fill-lime-600',
  'stroke-slate-500': 'fill-slate-500',
}
const colorDe = (campo: string) => COLOR[campo] ?? 'stroke-slate-600'
export const colorLeyenda = (campo: string) => RELLENO[colorDe(campo)] ?? 'fill-slate-600'
const punteado = (campo: string) => campo.includes('_24_') || campo === 'ic_plan'   // el plan del IC va punteado

export function GraficaLinea({
  series, compacta = false, intervalo = [], unidad = '', etiqueta,
}: {
  series: Serie[]
  compacta?: boolean
  /** Espacio reservado para el intervalo de confianza (IC): franja por DDT. Vacío = no se dibuja. */
  intervalo?: IntervaloPunto[]
  unidad?: string
  etiqueta: string
}) {
  const caja = compacta ? { ancho: 96, alto: 32, margen: 3 } : { ancho: 320, alto: 160, margen: 24 }
  const e = useMemo(() => escalar(series, caja, intervalo), [series, caja.ancho, caja.alto, caja.margen, intervalo])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!e.series.length) return null
  const { ancho, alto, margen } = caja
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={etiqueta}
      className={compacta ? 'h-8 w-24 shrink-0' : 'h-auto w-full'}>
      {!compacta && e.ticksY.map((t, i) => {
        const y = margen + (1 - (t - e.yMin) / (e.yMax - e.yMin)) * (alto - 2 * margen)
        return (
          <g key={i}>
            <line x1={margen} x2={ancho - margen} y1={y} y2={y} className="stroke-slate-200" strokeWidth={0.5} />
            <text x={margen - 3} y={y + 2.5} textAnchor="end" className="fill-slate-400" fontSize={7}>{Math.round(t * 10) / 10}</text>
          </g>
        )
      })}
      {!compacta && e.ticksX.map((t, i) => {
        const x = margen + ((t - e.xMin) / (e.xMax - e.xMin)) * (ancho - 2 * margen)
        return <text key={i} x={x} y={alto - 8} textAnchor="middle" className="fill-slate-400" fontSize={7}>{i === 1 ? `DDT ${t}` : t}</text>
      })}
      {e.banda && <path d={e.banda} className="fill-slate-400/20 stroke-none" data-intervalo />}
      {e.series.map((s) => (
        <g key={s.campo}>
          <path d={s.d} fill="none" className={colorDe(s.campo)} strokeWidth={compacta ? 1.5 : 1.6}
            strokeLinejoin="round" strokeLinecap="round" strokeDasharray={punteado(s.campo) ? '3 2' : undefined} />
          {(!compacta || s.puntos.length === 1) && s.puntos.map((p, i) => (
            <circle key={i} cx={p.cx} cy={p.cy} r={compacta ? 1.8 : p.fuera ? 3 : 2}
              className={p.fuera ? 'fill-red-600 stroke-red-600' : `${colorLeyenda(s.campo)} stroke-transparent`}>
              <title>{`${s.etiqueta}: ${p.y}${unidad ? ` ${unidad}` : ''} · DDT ${p.x} · ${p.fecha}${p.fuera ? ' · fuera de rango' : ''}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  )
}
