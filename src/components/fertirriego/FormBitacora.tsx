'use client'

/**
 * Bitácora de riego de un turno en un día: horas de fertilización y horas de riego (son cosas distintas), % de
 * fertilización (sql/112: sale de aquí y no de AgroMétricas › Parámetros), quién
 * lo ejecutó y, si se quiere, la hora de inicio y fin. NO toca la bodega: la completa después quien sea
 * (el mismo estacionero, el del relevo o el jefe). Lo vacío no borra lo que ya estaba.
 */

import { useState } from 'react'
import { Campo } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { armarBitacora, horasDesde, type DatosHoras } from '@/lib/fertirriego/horas'
import type { BitacoraRiego, Estacion, Operacion, Persona, Turno } from '@/lib/fertirriego/tipos'
import { CamposHoras } from './CamposHoras'
import { MarcoRegistro } from './MarcoRegistro'

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
  // Un borrador por turno y día
  const borrador = useBorrador<{
    hf: string
    hr: string
    inicio: string
    fin: string
    ejecutor: string
    ejecutor2: string
    ppmCabezal?: string
    ppmCampo?: string
    pct?: string
  }>(claveBorrador('bitacora', yo.id, estacion.id, `${turno.id}@${fecha}`))
  const b = borrador.inicial
  const previas = horasDesde(actual)
  // Piloto 1, punto 8 (sql/99): ppm de cloro; sql/112: % de fertilización (campos en CamposHoras)
  const [horas, setHoras] = useState<DatosHoras>({
    hf: b?.hf ?? previas.hf,
    hr: b?.hr ?? previas.hr,
    inicio: b?.inicio ?? previas.inicio,
    fin: b?.fin ?? previas.fin,
    ppmCabezal: b?.ppmCabezal ?? previas.ppmCabezal,
    ppmCampo: b?.ppmCampo ?? previas.ppmCampo,
    pct: b?.pct ?? previas.pct,
  })
  const [ejecutor, setEjecutor] = useState(b?.ejecutor ?? actual?.ejecutor_id ?? yo.id)
  const [ejecutor2, setEjecutor2] = useState(b?.ejecutor2 ?? actual?.ejecutor2_id ?? '')
  useAutoguardado(borrador, { ...horas, ejecutor, ejecutor2 })

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
      borrador={borrador}
      rapido
      construir={({ ubicacion }) => {
        const r = armarBitacora(horas, {
          estacion_id: estacion.id,
          turno_ciclo_id: turno.id,
          fecha,
          ejecutor_id: ejecutor || null,
          ejecutor2_id: ejecutor2 || null,
        })
        if ('error' in r) return r.error
        if ('vacio' in r) return 'Escribe al menos las horas de fertilización o de riego.'
        return [crearOperacion('bitacora', r.datos, { ubicacion, resumen: `Bitácora de riego · ${turno.turno} · ${fecha}` })]
      }}
    >
      <p className="text-sm text-slate-500">Día {fecha}. No mueve la bodega: es el registro de horas del turno.</p>
      <CamposHoras valor={horas} onCambiar={setHoras} />
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
