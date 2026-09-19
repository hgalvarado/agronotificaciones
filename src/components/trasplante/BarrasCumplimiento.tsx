'use client'

/**
 * Barras de plan contra real, en una escala común.
 *
 * SVG a mano y no una librería: el módulo se abre desde el campo, en
 * teléfono, y cuarenta kilobytes de gráficos para dibujar rectángulos se
 * notan en el primer pintado. Además el reporte de gerencia se imprime, y
 * lo que se imprime no puede depender de tener el ratón encima.
 *
 * Las dos barras de una fila comparten escala —el máximo de TODAS las
 * filas— porque si cada una se normalizara a lo suyo, un lote al 40 % se
 * vería igual de lleno que uno al 100 % y la comparación, que es lo único
 * que se busca, sería mentira.
 *
 * Es sólo dibujo: recibe filas ya sumadas y no sabe de dónde salen.
 */

import { AZUL } from '@/lib/trasplante/formato'

const GRIS = '#cbd5e1'
const VERDE = '#047857'
const AMBAR = '#b45309'

export type BarraCumplimiento = {
  /** Lo que va a la izquierda: la variedad, la UT, la zona. */
  etiqueta: string
  /** Segunda línea, más pequeña: el nombre del lote, el cultivo. */
  detalle?: string | null
  plan: number
  real: number
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString('es-HN')

function tono(pct: number | null): string {
  if (pct === null) return AZUL
  if (pct >= 99) return VERDE
  if (pct >= 50) return AZUL
  return AMBAR
}

export function BarrasCumplimiento({
  filas,
  tope = 12,
  unidad = 'mz',
}: {
  filas: BarraCumplimiento[]
  /** Cuántas barras caben antes de que el gráfico deje de leerse. */
  tope?: number
  unidad?: string
}) {
  if (filas.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-400">Todavía no hay nada que medir.</p>
  }

  // Las de más peso primero y el resto sumado: veinte barras de 8 px no
  // se leen, y las que importan son las grandes.
  const ordenadas = [...filas].sort((a, b) => Math.max(b.plan, b.real) - Math.max(a.plan, a.real))
  const visibles = ordenadas.slice(0, tope)
  const resto = ordenadas.slice(tope)

  const maximo = Math.max(...ordenadas.flatMap((f) => [f.plan, f.real]), 1)
  const ancho = (v: number) => `${Math.min((v / maximo) * 100, 100)}%`

  return (
    <div className="flex flex-col gap-2.5">
      {visibles.map((f) => {
        const pct = f.plan > 0 ? Math.round((f.real / f.plan) * 1000) / 10 : null
        return (
          <div key={f.etiqueta} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-semibold text-slate-700">
                {f.etiqueta}
                {f.detalle && (
                  <span className="ml-1.5 font-normal text-slate-400">{f.detalle}</span>
                )}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                {n2(f.real)} / {n2(f.plan)} {unidad}
                <strong className="ml-1.5" style={{ color: tono(pct) }}>
                  {pct === null ? '—' : `${pct.toFixed(0)}%`}
                </strong>
              </span>
            </div>

            {/* El plan detrás, en gris: es la referencia, no el logro. */}
            <div className="relative h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: ancho(f.plan), backgroundColor: GRIS }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-[width]"
                style={{ width: ancho(f.real), backgroundColor: tono(pct) }}
              />
            </div>
          </div>
        )
      })}

      {resto.length > 0 && (
        <p className="text-[11px] text-slate-400">
          Y {resto.length} más, con {n2(resto.reduce((a, f) => a + f.real, 0))} de{' '}
          {n2(resto.reduce((a, f) => a + f.plan, 0))} {unidad}. La tabla de abajo las trae todas.
        </p>
      )}
    </div>
  )
}
