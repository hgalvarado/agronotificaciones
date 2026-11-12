'use client'

/**
 * Bitácora de riego de un turno en un día: horas de fertilización y horas de riego (son cosas distintas), quién
 * lo ejecutó y, si se quiere, la hora de inicio y fin. NO toca la bodega: la completa después quien sea
 * (el mismo estacionero, el del relevo o el jefe). Lo vacío no borra lo que ya estaba.
 */

import { useState } from 'react'
import { Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, deEntradaLocal } from '@/lib/fechas/zona'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { BitacoraRiego, Estacion, Operacion, Persona, Turno } from '@/lib/fertirriego/tipos'
import { MarcoRegistro } from './MarcoRegistro'

const horas = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

export function FormBitacora({
  estacion,
  yo,
  turno,
  fecha,
  actual,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estacion: Estacion
  yo: Persona
  turno: Turno
  fecha: string
  actual: BitacoraRiego | null
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [hf, setHf] = useState(actual?.horas_fertilizacion?.toString() ?? '')
  const [hr, setHr] = useState(actual?.horas_riego?.toString() ?? '')
  const [inicio, setInicio] = useState(aEntradaLocal(actual?.hora_inicio))
  const [fin, setFin] = useState(aEntradaLocal(actual?.hora_fin))
  const [ejecutor, setEjecutor] = useState(actual?.ejecutor_id ?? yo.id)
  const [ejecutor2, setEjecutor2] = useState(actual?.ejecutor2_id ?? '')

  const personas = [{ id: yo.id, titulo: `${yo.nombre} (yo)` }, ...estacion.personas.filter((p) => p.id !== yo.id).map((p) => ({ id: p.id, titulo: p.nombre }))]

  return (
    <MarcoRegistro
      titulo={`Bitácora de riego · ${turno.turno}`}
      estacion={estacion}
      yo={yo}
      sinCustodia
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      construir={({ ubicacion }) => {
        const vhf = horas(hf)
        const vhr = horas(hr)
        for (const [n, v] of [['de fertilización', vhf], ['de riego', vhr]] as const) {
          if (v !== null && (!Number.isFinite(v) || v < 0 || v > 24)) return `Las horas ${n} deben estar entre 0 y 24.`
        }
        const ini = inicio ? deEntradaLocal(inicio) : null
        const fi = fin ? deEntradaLocal(fin) : null
        if (ini && fi && fi < ini) return 'La hora final no puede ser anterior a la inicial.'
        if (vhf === null && vhr === null && !ini && !fi) return 'Escribe al menos las horas de fertilización o de riego.'
        return [
          crearOperacion(
            'bitacora',
            {
              estacion_id: estacion.id,
              turno_ciclo_id: turno.id,
              fecha,
              horas_fertilizacion: vhf,
              horas_riego: vhr,
              hora_inicio: ini,
              hora_fin: fi,
              ejecutor_id: ejecutor || null,
              ejecutor2_id: ejecutor2 || null,
            },
            { ubicacion, resumen: `Bitácora de riego · ${turno.turno} · ${fecha}` }
          ),
        ]
      }}
    >
      <p className="text-sm text-slate-500">Día {fecha}. No mueve la bodega: es el registro de horas del turno.</p>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Horas de fertilización">
          <Entrada inputMode="decimal" value={hf} onChange={(e) => setHf(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" data-horas-fert />
        </Campo>
        <Campo etiqueta="Horas de riego">
          <Entrada inputMode="decimal" value={hr} onChange={(e) => setHr(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" data-horas-riego />
        </Campo>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo etiqueta="Inicio (opcional)">
          <Entrada type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </Campo>
        <Campo etiqueta="Fin (opcional)">
          <Entrada type="datetime-local" value={fin} onChange={(e) => setFin(e.target.value)} />
        </Campo>
      </div>
      <Campo etiqueta="Estacionero que lo ejecutó">
        <SelectorBuscable valor={ejecutor} opciones={personas} onCambiar={setEjecutor} placeholder="Elegir…" etiquetaBusqueda="Buscar persona" />
      </Campo>
      <Campo etiqueta="Segundo estacionero (opcional)">
        <SelectorBuscable
          valor={ejecutor2}
          opciones={personas}
          onCambiar={setEjecutor2}
          placeholder="Nadie más"
          etiquetaBusqueda="Buscar persona"
          permitirVacio
          textoVacio="Nadie más"
        />
      </Campo>
    </MarcoRegistro>
  )
}
