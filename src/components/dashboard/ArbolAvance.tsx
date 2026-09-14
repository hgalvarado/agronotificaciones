'use client'

/**
 * El árbol de agrupación y su cuadrícula de hojas.
 *
 * Sólo dibuja. No consulta, no filtra y no decide el orden de los
 * niveles: recibe el árbol ya armado por `lib/tablero/agrupacion` —que
 * es quien impone Encargado > Zona > Lote— y lo abre y lo cierra.
 */

import { useState } from 'react'
import { IconChevronRight } from '@/components/ui/Icons'
import { colorAvance, dinero, numero, porcentaje } from '@/lib/tablero/formato'
import type { Nodo } from '@/lib/tablero/agrupacion'

export function ArbolAvance({ nodos, plano }: { nodos: Nodo[]; plano: boolean }) {
  if (nodos.length === 0) return null

  // Sin agrupación no hay ramas que abrir: la cuadrícula va sola.
  if (plano) return <Cuadricula filas={nodos[0].filas} conLote conLabor />

  return (
    <div className="flex flex-col gap-2">
      {nodos.map((n) => (
        <Rama key={n.clave} nodo={n} nivel={0} />
      ))}
    </div>
  )
}

function Rama({ nodo, nivel }: { nodo: Nodo; nivel: number }) {
  // El primer nivel arranca abierto y los de dentro cerrados: con tres
  // niveles abiertos de golpe la pantalla es ilegible en el celular.
  const [abierto, setAbierto] = useState(nivel === 0)

  const hojas = nodo.hijos.length === 0

  return (
    <div
      className={
        nivel === 0
          ? 'overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)]'
          : 'border-t border-slate-100'
      }
    >
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${
          nivel === 0 ? 'bg-slate-50/70' : ''
        }`}
        style={{ paddingLeft: `${12 + nivel * 14}px` }}
      >
        <IconChevronRight
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            abierto ? 'rotate-90' : ''
          }`}
        />

        <span className="min-w-0 flex-1">
          <span
            className={`block truncate ${
              nivel === 0
                ? 'text-sm font-bold text-slate-900'
                : 'text-sm font-semibold text-slate-700'
            }`}
          >
            {nodo.etiqueta}
          </span>
          {nodo.detalle && (
            <span className="block truncate text-[11px] text-slate-400">{nodo.detalle}</span>
          )}
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-xs tabular-nums text-slate-500">
            {numero(nodo.totales.mz)}
            {nodo.totales.plan > 0 ? ` / ${numero(nodo.totales.plan)}` : ''} mz
            {nodo.totales.pct !== null && (
              <strong className="ml-1.5 text-slate-900">{porcentaje(nodo.totales.pct)}</strong>
            )}
          </span>
          <span className="block text-[11px] font-semibold tabular-nums text-slate-400">
            {dinero(nodo.totales.gasto)}
          </span>
        </span>
      </button>

      {nodo.totales.pct !== null && (
        <div
          className="h-1 w-full bg-slate-100"
          style={{ paddingLeft: `${12 + nivel * 14}px` }}
          aria-hidden
        >
          <div
            className={`h-full ${colorAvance(nodo.totales.pct)}`}
            style={{ width: `${Math.min(nodo.totales.pct, 100)}%` }}
          />
        </div>
      )}

      {abierto &&
        (hojas ? (
          <Cuadricula
            filas={nodo.filas}
            conLote={nodo.dimension !== 'lote'}
            conLabor={nodo.dimension !== 'labor'}
          />
        ) : (
          nodo.hijos.map((h) => <Rama key={h.clave} nodo={h} nivel={nivel + 1} />)
        ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La vista de datos a nivel lote                                      */
/* ------------------------------------------------------------------ */

function Cuadricula({
  filas,
  conLote,
  conLabor,
}: {
  filas: import('@/lib/tablero/tipos').FilaLote[]
  /** Se esconde la columna por la que ya se agrupó: repetirla es ruido. */
  conLote: boolean
  conLabor: boolean
}) {
  if (filas.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-slate-400">Nada capturado aquí.</p>
  }

  return (
    <div className="scroll-suave overflow-x-auto border-t border-slate-100">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {conLote && <th className="px-3 py-2">Lote</th>}
            {conLabor && <th className="px-3 py-2">Labor</th>}
            <th className="px-2 py-2 text-right">Subtotal</th>
            <th className="px-2 py-2 text-right">Mz avanzadas</th>
            <th className="px-2 py-2 text-right">Plan</th>
            <th className="px-2 py-2 text-right">Costo total por actividad</th>
            <th className="px-3 py-2 text-right">Gasto total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr
              key={`${f.lote_temporada_id}-${f.labor_id}`}
              className="border-b border-slate-50 last:border-0"
            >
              {conLote && (
                <td className="px-3 py-2">
                  <span className="block whitespace-nowrap font-semibold text-slate-800">{f.ut}</span>
                  {f.lote_nombre && (
                    <span className="block truncate text-[11px] text-slate-400">
                      {f.lote_nombre}
                    </span>
                  )}
                </td>
              )}
              {conLabor && (
                <td className="px-3 py-2">
                  <span className="block text-slate-700">{f.labor_nombre}</span>
                  {f.categoria_labor && (
                    <span className="block truncate text-[11px] text-slate-400">
                      {f.categoria_labor}
                    </span>
                  )}
                </td>
              )}
              <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-slate-800">
                {dinero(f.subtotal)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600">
                {numero(f.mz_avance)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600">
                {numero(f.area_plan)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-500">
                {dinero(f.costo_actividad)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-500">
                {dinero(f.gasto_lote)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
