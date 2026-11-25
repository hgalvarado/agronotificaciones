'use client'

/**
 * Motores para quien solo tiene «Vista general» (suministro de combustible, taller): únicamente la vista General de solo lectura.
 * Sin estaciones, sin pestañas de trabajo y sin botones de registrar: no baja el estado de campo ni usa la cola de envíos.
 */

import { VistaGeneral } from './VistaGeneral'

export function MotoresSoloGeneral({ generadoPor }: { generadoPor: string }) {
  return (
    <div className="flex flex-col gap-3 pb-24" data-motores-solo-general>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Motores · General</h1>
        <span className="text-xs text-slate-600">Solo lectura</span>
      </div>
      <VistaGeneral generadoPor={generadoPor} />
    </div>
  )
}
