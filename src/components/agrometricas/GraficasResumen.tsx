'use client'

/**
 * Gráficas del Resumen de «Registros de la temporada» (mismo diseño que el Resumen de AGL, sin «Normal histórico»):
 * mapa de calor turnos × días, líneas contra el DDT y barras de turnos al mismo DDT. SVG propio (sin librerías); los colores son
 * clases de Tailwind (pasan por las variables del tema, así sirven en claro y en oscuro). Solo dibuja: los datos los arma resumenPura.
 */

import { marcasEje, type BarraDdt, type FilaMapa, type SerieLinea } from '@/lib/agrometricas/resumenPura'

const SERIE_TRAZO = ['stroke-sky-600', 'stroke-orange-500', 'stroke-emerald-600', 'stroke-amber-500', 'stroke-pink-500', 'stroke-violet-600', 'stroke-teal-600', 'stroke-red-500']
const SERIE_RELLENO = ['fill-sky-600', 'fill-orange-500', 'fill-emerald-600', 'fill-amber-500', 'fill-pink-500', 'fill-violet-600', 'fill-teal-600', 'fill-red-500']
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

const recorta = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t)
const fmt = (n: number | null, d = 2) => (n === null ? '–' : n.toLocaleString('es-HN', { maximumFractionDigits: d }))
const diaCorto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const diaSemana = (iso: string) => DIAS[new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))).getUTCDay()]

function Vacio({ texto }: { texto: string }) {
  return <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500" data-resumen-vacio>{texto}</p>
}

/** Turnos (filas) × días (columnas). Color = intensidad relativa del valor; gris = sin registro; borde rojo = fuera de rango al guardar. */
export function MapaCalor({ dias, filas, unidad, decimales }: { dias: string[]; filas: FilaMapa[]; unidad: string; decimales: number }) {
  if (!filas.length || !dias.length) return <Vacio texto="No hay turnos con registros en estos días." />
  const valores = filas.flatMap((f) => f.celdas.map((c) => c.v)).filter((v): v is number => v !== null)
  const min = Math.min(...valores), max = Math.max(...valores)
  const intensidad = (v: number) => (max > min ? 0.2 + 0.6 * ((v - min) / (max - min)) : 0.5)
  const L = 92, cab = 40, h = 28, w = 36
  const ancho = L + dias.length * w, alto = cab + filas.length * h + 4
  return (
    <div data-mapa>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Mapa de calor: turnos por día" className="h-auto w-full" style={{ minWidth: ancho }}>
          {dias.map((d, i) => (
            <g key={d}>
              <text x={L + i * w + w / 2} y={16} textAnchor="middle" fontSize={11} fontWeight={600} className="fill-slate-700">{diaCorto(d)}</text>
              <text x={L + i * w + w / 2} y={30} textAnchor="middle" fontSize={10} fontWeight={diaSemana(d) === 'sáb' ? 700 : 400} className="fill-slate-500">{diaSemana(d)}</text>
            </g>
          ))}
          {filas.map((f, r) => {
            const y = cab + r * h
            return (
              <g key={f.turno} data-mapa-fila={f.turno}>
                <text x={0} y={y + h / 2 + 4} fontSize={12} fontWeight={600} className="fill-slate-900">{recorta(f.turno, 12)}</text>
                {f.celdas.map((c, i) => {
                  const x = L + i * w + 1
                  const tip = `${f.turno} · ${diaCorto(dias[i])}: ${c.v === null ? (c.estado === 'sin_medida' ? 'hubo registro sin esta medida' : 'sin registro') : `${fmt(c.v, decimales)}${unidad ? ` ${unidad}` : ''}${c.ddt !== null ? ` (DDT ${c.ddt})` : ''}${c.fuera ? ' · fuera de rango' : ''}`}`
                  return (
                    <g key={dias[i]}>
                      <title>{tip}</title>
                      {c.v === null
                        ? <rect x={x} y={y + 1} width={w - 2} height={h - 2} rx={4} className={c.estado === 'sin_medida' ? 'fill-slate-200' : 'fill-slate-100'} />
                        : <>
                            <rect x={x} y={y + 1} width={w - 2} height={h - 2} rx={4} className={c.fuera ? 'fill-emerald-500 stroke-red-600' : 'fill-emerald-500 stroke-transparent'} fillOpacity={intensidad(c.v)} strokeWidth={2} />
                            <text x={x + (w - 2) / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={10.5} fontWeight={600} className="fill-slate-900">{fmt(c.v, decimales)}</text>
                          </>}
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span>Más claro = menor, más intenso = mayor (dentro de lo mostrado)</span>
        <span className="inline-flex items-center gap-1"><svg width="12" height="12" aria-hidden><rect width="12" height="12" rx="3" className="fill-slate-100 stroke-slate-300" /></svg>Sin registro</span>
        <span className="inline-flex items-center gap-1"><svg width="12" height="12" aria-hidden><rect width="12" height="12" rx="3" className="fill-slate-200" /></svg>Sin esta medida</span>
        <span className="inline-flex items-center gap-1"><svg width="12" height="12" aria-hidden><rect x="1" y="1" width="10" height="10" rx="3" className="fill-emerald-500 stroke-red-600" strokeWidth={2} /></svg>Fuera de rango al guardar</span>
      </p>
    </div>
  )
}

/** Una línea por turno, contra los días después del trasplante (DDT). */
export function LineasDdt({ series, unidad, decimales }: { series: SerieLinea[]; unidad: string; decimales: number }) {
  if (!series.length) return <Vacio texto="No hay valores de esta medida para los turnos elegidos." />
  const ancho = 480, alto = 280, M = { l: 40, r: 14, t: 12, b: 42 }
  const xs = series.flatMap((s) => s.puntos.map((p) => p[0])), ys = series.flatMap((s) => s.puntos.map((p) => p[1]))
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const pad = (Math.max(...ys) - Math.min(...ys) || 1) * 0.08
  const marcasY = marcasEje(Math.min(...ys) >= 0 && Math.min(...ys) - pad < 0 ? 0 : Math.min(...ys) - pad, Math.max(...ys) + pad, 5)
  const ymin = marcasY[0], ymax = marcasY[marcasY.length - 1]
  const X = (v: number) => M.l + ((v - x0) / (x1 - x0 || 1)) * (ancho - M.l - M.r)
  const Y = (v: number) => alto - M.b - ((v - ymin) / (ymax - ymin || 1)) * (alto - M.b - M.t)
  return (
    <div data-lineas>
      <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Líneas contra el DDT" className="h-auto w-full">
        {marcasY.map((m) => (
          <g key={m}>
            <line x1={M.l} x2={ancho - M.r} y1={Y(m)} y2={Y(m)} className="stroke-slate-200" strokeWidth={1} />
            <text x={M.l - 6} y={Y(m) + 4} textAnchor="end" fontSize={11} className="fill-slate-500">{fmt(m, decimales)}</text>
          </g>
        ))}
        <line x1={M.l} x2={ancho - M.r} y1={alto - M.b} y2={alto - M.b} className="stroke-slate-300" strokeWidth={1} />
        {marcasEje(x0, x1, 6).filter((m) => m >= x0 && m <= x1).map((m) => (
          <text key={m} x={X(m)} y={alto - M.b + 16} textAnchor="middle" fontSize={11} className="fill-slate-500">{m}</text>
        ))}
        <text x={(M.l + ancho - M.r) / 2} y={alto - 8} textAnchor="middle" fontSize={11} className="fill-slate-600">Días después del trasplante (DDT)</text>
        {series.map((s, i) => (
          <g key={s.turno} data-linea={s.turno}>
            <polyline fill="none" className={SERIE_TRAZO[i % SERIE_TRAZO.length]} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round"
              points={s.puntos.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')} />
            {s.puntos.length <= 60 && s.puntos.map((p) => (
              <circle key={p[0]} cx={X(p[0])} cy={Y(p[1])} r={3} className={`${SERIE_RELLENO[i % SERIE_RELLENO.length]} stroke-white`} strokeWidth={1.2}>
                <title>{`${s.turno} · DDT ${p[0]}: ${fmt(p[1], decimales)}${unidad ? ` ${unidad}` : ''}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s, i) => (
          <li key={s.turno} className="flex items-center gap-1.5 text-xs text-slate-700">
            <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" className={SERIE_RELLENO[i % SERIE_RELLENO.length]} /></svg>{s.turno}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Barras de mayor a menor: cada turno a (casi) el mismo DDT. */
export function BarrasDdt({ barras, unidad, decimales }: { barras: BarraDdt[]; unidad: string; decimales: number }) {
  if (!barras.length) return <Vacio texto="No hay turnos con valores para comparar." />
  const ancho = 480, L = 92, R = 64, h = 28, top = 8
  const vmax = marcasEje(0, Math.max(...barras.map((b) => b.valor)) * 1.08 || 1, 4).slice(-1)[0] || 1
  const X = (v: number) => L + (Math.max(0, v) / vmax) * (ancho - L - R)
  const alto = top + barras.length * h + 4
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Turnos al mismo DDT" className="h-auto w-full" data-barras>
      {barras.map((b, i) => {
        const y = top + i * h
        return (
          <g key={b.turno}>
            <text x={0} y={y + h / 2 + 4} fontSize={12} fontWeight={600} className="fill-slate-900">{recorta(b.turno, 12)}</text>
            <rect x={L} y={y + 4} width={Math.max(2, X(b.valor) - L)} height={h - 8} rx={4} className="fill-sky-600">
              <title>{`${b.turno}: ${fmt(b.valor, decimales)}${unidad ? ` ${unidad}` : ''}`}</title>
            </rect>
            <text x={X(b.valor) + 6} y={y + h / 2 + 4} fontSize={12} fontWeight={600} className="fill-slate-900">{fmt(b.valor, decimales)}</text>
          </g>
        )
      })}
    </svg>
  )
}
