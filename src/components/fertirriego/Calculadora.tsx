'use client'

/**
 * Calculadora junto a cada cantidad (piloto 2, punto 6). Un botón pequeño abre una hoja con:
 *   - «Bultos × kg por bulto» (9, 12.5, 25, 50, 100 con un toque, o el peso que escriba)
 *   - una calculadora simple (+ − × ÷)
 * «Usar resultado» pone el número en el campo por el mismo camino que escribirlo (onUsar = el onChange del campo).
 * La hoja va en un portal propio (no un Modal): así no cierra ni bloquea el formulario que está debajo.
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { PESOS_BULTO, evaluar, multiplicarBultos, textoParaCampo } from '@/lib/fertirriego/calculadora'
import { cantidad } from '@/lib/fertirriego/calculos'

const TECLAS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '⌫', '+']

export function BotonCalculadora({ onUsar, unidad, titulo = 'Calcular cantidad' }: { onUsar: (valor: string) => void; unidad?: string | null; titulo?: string }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        aria-label={titulo}
        title={titulo}
        data-calculadora
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg font-bold text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-200"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <rect x="5" y="2.5" width="14" height="19" rx="2" />
          <path d="M8 6.5h8M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01" />
        </svg>
      </button>
      {abierta && (
        <HojaCalculadora
          unidad={unidad}
          onCerrar={() => setAbierta(false)}
          onUsar={(v) => {
            onUsar(v)
            setAbierta(false)
          }}
        />
      )}
    </>
  )
}

function HojaCalculadora({ unidad, onCerrar, onUsar }: { unidad?: string | null; onCerrar: () => void; onUsar: (v: string) => void }) {
  const [modo, setModo] = useState<'bultos' | 'calculadora'>('bultos')
  const [bultos, setBultos] = useState('')
  const [kg, setKg] = useState('25')
  const [expr, setExpr] = useState('')

  const resultado = modo === 'bultos' ? multiplicarBultos(bultos, kg) : evaluar(expr)
  const valido = resultado !== null && resultado >= 0
  const limpiar = (v: string) => v.replace(/[^\d.,]/g, '').slice(0, 10)

  function tecla(t: string) {
    if (t === '⌫') return setExpr((e) => e.slice(0, -1))
    setExpr((e) => (e + t).slice(0, 40))
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-slate-900/40" onClick={onCerrar} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Calculadora" data-hoja-calculadora className="relative w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
          {(['bultos', 'calculadora'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={modo === m}
              data-modo-calculadora={m}
              onClick={() => setModo(m)}
              className={`min-h-11 flex-1 rounded-lg text-sm font-semibold ${modo === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              {m === 'bultos' ? 'Bultos × kg' : 'Calculadora'}
            </button>
          ))}
        </div>

        {modo === 'bultos' ? (
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700">Bultos</span>
              <input
                inputMode="decimal"
                value={bultos}
                onChange={(e) => setBultos(limpiar(e.target.value))}
                placeholder="0"
                autoFocus
                data-calc-bultos
                className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-right text-lg font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
              />
            </label>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">kg por bulto</p>
              <div className="flex flex-wrap gap-2">
                {PESOS_BULTO.map((p) => {
                  const marcado = kg === String(p)
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={marcado}
                      data-peso-bulto={p}
                      onClick={() => setKg(String(p))}
                      className={`min-h-11 min-w-12 rounded-full px-3 text-sm font-semibold ring-1 ring-inset ${marcado ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'}`}
                    >
                      {p}
                    </button>
                  )
                })}
                <input
                  inputMode="decimal"
                  value={kg}
                  onChange={(e) => setKg(limpiar(e.target.value))}
                  aria-label="Otro peso por bulto (kg)"
                  data-calc-kg
                  className="h-11 w-20 rounded-lg border border-slate-200 px-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="min-h-12 rounded-lg bg-slate-50 px-3 py-2 text-right font-mono text-xl tabular-nums text-slate-800 ring-1 ring-inset ring-slate-200" data-calc-expresion>
              {expr || '0'}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {TECLAS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => tecla(t)}
                  data-tecla={t}
                  className={`h-12 rounded-lg text-lg font-semibold ${/[\d.]/.test(t) ? 'bg-white text-slate-800 ring-1 ring-inset ring-slate-200' : 'bg-slate-100 text-brand-800'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setExpr('')} className="min-h-11 text-sm font-semibold text-slate-500 underline">
              Borrar todo
            </button>
          </div>
        )}

        <p className="mt-3 text-center text-sm text-slate-500" data-calc-resultado={valido ? textoParaCampo(resultado) : ''}>
          Resultado:{' '}
          <strong className="text-2xl tabular-nums text-slate-900">{valido ? cantidad(resultado) : '—'}</strong> {unidad ?? ''}
        </p>
        {resultado !== null && resultado < 0 && <p className="text-center text-xs text-red-700">El resultado es negativo: revisa la cuenta.</p>}

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onCerrar} className="min-h-12 flex-1 rounded-xl text-sm font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!valido}
            onClick={() => valido && onUsar(textoParaCampo(resultado))}
            data-usar-resultado
            className="min-h-12 flex-1 rounded-xl bg-brand-700 text-sm font-semibold text-white disabled:opacity-50"
          >
            Usar resultado
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
