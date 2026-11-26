'use client'

import { useState } from 'react'
import { ListaAlertas } from './ListaAlertas'
import { ControlAlertas } from './ControlAlertas'
import { MiTelefono } from './MiTelefono'

type Pestana = 'alertas' | 'control' | 'telefono'

/** Centro de alertas: Alertas (las que me tocan) · Control (alcance «Todas») · Mi teléfono (avisos push). */
export function PanelAlertas({ esControl }: { esControl: boolean }) {
  const [pestana, setPestana] = useState<Pestana>('alertas')
  const pestanas: [Pestana, string][] = [
    ['alertas', 'Alertas'],
    ...(esControl ? ([['control', 'Control']] as [Pestana, string][]) : []),
    ['telefono', 'Mi teléfono'],
  ]
  return (
    <div className="flex flex-col gap-3" data-panel-alertas>
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Alertas</h1>
      <div role="tablist" aria-label="Alertas" className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {pestanas.map(([id, texto]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pestana === id}
            onClick={() => setPestana(id)}
            data-pestana-alertas={id}
            className={`min-h-11 flex-1 rounded-lg px-2 text-sm font-bold transition-colors ${pestana === id ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]' : 'text-slate-600'}`}
          >
            {texto}
          </button>
        ))}
      </div>
      {pestana === 'alertas' && <ListaAlertas />}
      {pestana === 'control' && esControl && <ControlAlertas />}
      {pestana === 'telefono' && <MiTelefono />}
    </div>
  )
}
