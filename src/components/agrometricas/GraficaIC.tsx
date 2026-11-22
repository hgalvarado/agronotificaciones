'use client'

/**
 * Gráficas del Índice de crecimiento (IC), en SVG puro. Pensadas para que se LEAN, no solo se vean:
 *  · GraficaICPlan: ejes con título, ventana de medición DDT 5–20, curva completa del plan, IC real con su valor y un
 *    «tallo» de cada punto hasta el plan (verde = sobre el plan, ámbar = bajo el plan) con el % del plan.
 *  · BarrasHojas: hojas contadas por DDT, con el valor sobre cada barra.
 */

import { useMemo } from 'react'
import { valorNumero, type Registro } from '@/lib/agrometricas/registrosPura'
import { VENTANA_IC, planEnDdt, textoIC, type PlanPunto } from '@/lib/agrometricas/registrosIC'

const W = 560, H = 300, M = { l: 46, r: 16, t: 20, b: 46 }

function ticksY(max: number): number[] {
  const paso = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10].find((p) => max / p <= 6) ?? 10
  const salida: number[] = []
  for (let v = 0; v <= max + paso * 0.01; v += paso) salida.push(Math.round(v * 1000) / 1000)
  return salida
}

export function GraficaICPlan({ registros, plan, etiqueta }: { registros: Registro[]; plan: PlanPunto[]; etiqueta: string }) {
  const g = useMemo(() => {
    const reales = registros
      .filter((r) => r.ddt != null && valorNumero(r, 'ic_real') !== null)
      .map((r) => {
        const ddt = r.ddt as number, real = valorNumero(r, 'ic_real') as number
        const p = valorNumero(r, 'ic_plan') ?? planEnDdt(plan, ddt)
        return { ddt, real, plan: p, fecha: r.fecha, hojas: valorNumero(r, 'hojas') }
      })
      .sort((a, b) => a.ddt - b.ddt)
    const ddts = [VENTANA_IC.min, VENTANA_IC.max, ...reales.map((r) => r.ddt), ...plan.map((p) => p.ddt)]
    const xMin = Math.min(...ddts), xMax = Math.max(...ddts)
    const yMaxDato = Math.max(0.1, ...reales.map((r) => r.real), ...reales.map((r) => r.plan ?? 0), ...plan.filter((p) => p.ddt >= xMin && p.ddt <= xMax).map((p) => p.ic_plan))
    const ys = ticksY(yMaxDato * 1.1)
    const yMax = ys[ys.length - 1]
    const cx = (x: number) => M.l + ((x - xMin) / (xMax - xMin || 1)) * (W - M.l - M.r)
    const cy = (y: number) => M.t + (1 - y / (yMax || 1)) * (H - M.t - M.b)
    const curvaPlan = plan.slice().sort((a, b) => a.ddt - b.ddt)
    return { reales, xMin, xMax, ys, cx, cy, curvaPlan }
  }, [registros, plan])

  if (!g.reales.length) return <p className="text-sm text-slate-400">Sin lecturas de IC con DDT para graficar.</p>
  const pasoX = g.xMax - g.xMin > 16 ? 2 : 1
  const etiquetasX: number[] = []
  for (let x = g.xMin; x <= g.xMax; x += pasoX) etiquetasX.push(x)
  const poner = g.reales.length <= 14
  const ultimo = g.reales[g.reales.length - 1]
  const ventanaX1 = g.cx(Math.max(VENTANA_IC.min, g.xMin)), ventanaX2 = g.cx(Math.min(VENTANA_IC.max, g.xMax))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={etiqueta} className="h-auto w-full" data-grafica-ic-plan>
      {/* Ventana preferida de medición (DDT 5–20) */}
      <rect x={ventanaX1} y={M.t} width={Math.max(0, ventanaX2 - ventanaX1)} height={H - M.t - M.b} className="fill-emerald-50" />
      <text x={ventanaX1 + 4} y={M.t + 10} fontSize={9} className="fill-emerald-700">Ventana de medición (DDT {VENTANA_IC.min}–{VENTANA_IC.max})</text>
      {/* Cuadrícula y eje Y */}
      {g.ys.map((v) => (
        <g key={v}>
          <line x1={M.l} x2={W - M.r} y1={g.cy(v)} y2={g.cy(v)} className="stroke-slate-200" strokeWidth={0.7} />
          <text x={M.l - 6} y={g.cy(v) + 3.5} textAnchor="end" fontSize={11} className="fill-slate-500">{v}</text>
        </g>
      ))}
      {etiquetasX.map((x) => (
        <g key={x}>
          <line x1={g.cx(x)} x2={g.cx(x)} y1={H - M.b} y2={H - M.b + 4} className="stroke-slate-300" />
          <text x={g.cx(x)} y={H - M.b + 17} textAnchor="middle" fontSize={11} className="fill-slate-500">{x}</text>
        </g>
      ))}
      <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} className="stroke-slate-400" />
      <text x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle" fontSize={11} className="fill-slate-600">DDT (días después del trasplante)</text>
      <text transform={`translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} className="fill-slate-600">Índice de crecimiento (IC)</text>
      {/* Curva completa del plan */}
      {g.curvaPlan.length > 1 && (
        <path d={g.curvaPlan.map((p, i) => `${i ? 'L' : 'M'}${g.cx(p.ddt)} ${g.cy(p.ic_plan)}`).join(' ')}
          fill="none" className="stroke-slate-500" strokeWidth={1.8} strokeDasharray="5 3" />
      )}
      {/* Tallos: distancia de cada lectura al plan */}
      {g.reales.map((r) => r.plan !== null && (
        <line key={`t${r.ddt}`} x1={g.cx(r.ddt)} x2={g.cx(r.ddt)} y1={g.cy(r.real)} y2={g.cy(r.plan)}
          className={r.real >= r.plan ? 'stroke-emerald-500' : 'stroke-amber-500'} strokeWidth={3} strokeOpacity={0.45} strokeLinecap="round" />
      ))}
      {/* IC real */}
      <path d={g.reales.map((r, i) => `${i ? 'L' : 'M'}${g.cx(r.ddt)} ${g.cy(r.real)}`).join(' ')} fill="none" className="stroke-emerald-600" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
      {g.reales.map((r) => {
        const sobre = r.plan === null || r.real >= r.plan
        const pct = r.plan ? Math.round((r.real / r.plan) * 100) : null
        return (
          <g key={`p${r.ddt}`}>
            <circle cx={g.cx(r.ddt)} cy={g.cy(r.real)} r={5} className={`stroke-white ${sobre ? 'fill-emerald-600' : 'fill-amber-500'}`} strokeWidth={1.5}>
              <title>{`DDT ${r.ddt} · ${r.fecha}\nIC real ${textoIC(r.real)}${r.plan !== null ? ` · plan ${textoIC(r.plan)}${pct !== null ? ` (${pct} % del plan)` : ''}` : ''}${r.hojas !== null ? `\n${r.hojas} hojas` : ''}`}</title>
            </circle>
            {poner && <text x={g.cx(r.ddt)} y={g.cy(r.real) - 10} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-slate-700">{textoIC(r.real, 2)}</text>}
          </g>
        )
      })}
      {/* Último punto: cuánto va del plan */}
      {ultimo.plan ? (
        <g data-ultimo-pct>
          <rect x={Math.min(g.cx(ultimo.ddt) - 26, W - M.r - 52)} y={g.cy(Math.max(ultimo.real, ultimo.plan)) - 38} width={52} height={18} rx={9}
            className={ultimo.real >= ultimo.plan ? 'fill-emerald-600' : 'fill-amber-500'} />
          <text x={Math.min(g.cx(ultimo.ddt), W - M.r - 26)} y={g.cy(Math.max(ultimo.real, ultimo.plan)) - 26} textAnchor="middle" fontSize={11} fontWeight={700} className="fill-white">
            {Math.round((ultimo.real / ultimo.plan) * 100)} %
          </text>
        </g>
      ) : null}
    </svg>
  )
}

export function BarrasHojas({ registros, etiqueta }: { registros: Registro[]; etiqueta: string }) {
  const filas = useMemo(() => registros
    .filter((r) => r.ddt != null && valorNumero(r, 'hojas') !== null)
    .map((r) => ({ ddt: r.ddt as number, hojas: valorNumero(r, 'hojas') as number, fecha: r.fecha }))
    .sort((a, b) => a.ddt - b.ddt), [registros])
  if (!filas.length) return <p className="text-sm text-slate-400">Sin conteos de hojas con DDT.</p>
  const Hh = 240, m = { l: 40, r: 12, t: 22, b: 44 }
  const max = Math.max(...filas.map((f) => f.hojas)) * 1.12
  const ys = ticksY(max)
  const yMax = ys[ys.length - 1]
  const ancho = (W - m.l - m.r) / filas.length
  const cy = (v: number) => m.t + (1 - v / yMax) * (Hh - m.t - m.b)
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label={etiqueta} className="h-auto w-full" data-grafica-hojas>
      {ys.map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={cy(v)} y2={cy(v)} className="stroke-slate-200" strokeWidth={0.7} />
          <text x={m.l - 6} y={cy(v) + 3.5} textAnchor="end" fontSize={11} className="fill-slate-500">{v}</text>
        </g>
      ))}
      {filas.map((f, i) => {
        const bw = Math.min(34, ancho * 0.7), x = m.l + ancho * i + (ancho - bw) / 2
        return (
          <g key={f.ddt}>
            <rect x={x} y={cy(f.hojas)} width={bw} height={Hh - m.b - cy(f.hojas)} rx={3} className="fill-sky-500/80">
              <title>{`DDT ${f.ddt} · ${f.fecha}: ${f.hojas} hojas`}</title>
            </rect>
            <text x={x + bw / 2} y={cy(f.hojas) - 5} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-slate-700">{f.hojas}</text>
            <text x={x + bw / 2} y={Hh - m.b + 15} textAnchor="middle" fontSize={11} className="fill-slate-500">{f.ddt}</text>
          </g>
        )
      })}
      <line x1={m.l} x2={W - m.r} y1={Hh - m.b} y2={Hh - m.b} className="stroke-slate-400" />
      <text x={(m.l + W - m.r) / 2} y={Hh - 6} textAnchor="middle" fontSize={11} className="fill-slate-600">DDT (días después del trasplante) · hojas contadas</text>
    </svg>
  )
}
