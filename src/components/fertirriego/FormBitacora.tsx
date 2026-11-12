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
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
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
  }>(claveBorrador('bitacora', yo.id, estacion.id, `${turno.id}@${fecha}`))
  const b = borrador.inicial
  const [hf, setHf] = useState(b?.hf ?? actual?.horas_fertilizacion?.toString() ?? '')
  const [hr, setHr] = useState(b?.hr ?? actual?.horas_riego?.toString() ?? '')
  const [inicio, setInicio] = useState(b?.inicio ?? aEntradaLocal(actual?.hora_inicio))
  const [fin, setFin] = useState(b?.fin ?? aEntradaLocal(actual?.hora_fin))
  const [ejecutor, setEjecutor] = useState(b?.ejecutor ?? actual?.ejecutor_id ?? yo.id)
  const [ejecutor2, setEjecutor2] = useState(b?.ejecutor2 ?? actual?.ejecutor2_id ?? '')
  // Piloto 1, punto 8 (sql/99): ppm de cloro en el cabezal de riego y en el campo (cinta)
  const [ppmCabezal, setPpmCabezal] = useState(b?.ppmCabezal ?? actual?.ppm_cloro_cabezal?.toString() ?? '')
  const [ppmCampo, setPpmCampo] = useState(b?.ppmCampo ?? actual?.ppm_cloro_campo?.toString() ?? '')
  useAutoguardado(borrador, { hf, hr, inicio, fin, ejecutor, ejecutor2, ppmCabezal, ppmCampo })

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
        const vhf = horas(hf)
        const vhr = horas(hr)
        for (const [n, v] of [['de fertilización', vhf], ['de riego', vhr]] as const) {
          if (v !== null && (!Number.isFinite(v) || v < 0 || v > 24)) return `Las horas ${n} deben estar entre 0 y 24.`
        }
        const vCab = horas(ppmCabezal)
        const vCampo = horas(ppmCampo)
        for (const [n, v] of [['del cabezal', vCab], ['del campo', vCampo]] as const) {
          if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1000)) return `Las ppm de cloro ${n} deben estar entre 0 y 1000.`
        }
        const ini = inicio ? deEntradaLocal(inicio) : null
        const fi = fin ? deEntradaLocal(fin) : null
        if (ini && fi && fi < ini) return 'La hora final no puede ser anterior a la inicial.'
        if (vhf === null && vhr === null && !ini && !fi && vCab === null && vCampo === null) {
          return 'Escribe al menos las horas de fertilización o de riego.'
        }
        const datos: Record<string, unknown> = {
          estacion_id: estacion.id,
          turno_ciclo_id: turno.id,
          fecha,
          horas_fertilizacion: vhf,
          horas_riego: vhr,
          hora_inicio: ini,
          hora_fin: fi,
          ejecutor_id: ejecutor || null,
          ejecutor2_id: ejecutor2 || null,
        }
        // Solo si se escribieron (lo vacío no borra lo que ya estaba; la base sin la 99 no los conoce)
        if (vCab !== null) datos.ppm_cloro_cabezal = vCab
        if (vCampo !== null) datos.ppm_cloro_campo = vCampo
        return [
          crearOperacion(
            'bitacora',
            datos,
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
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Ppm cloro (cabezal de riego)">
          <Entrada inputMode="decimal" value={ppmCabezal} onChange={(e) => setPpmCabezal(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="Opcional" data-ppm-cabezal />
        </Campo>
        <Campo etiqueta="Ppm cloro (campo, en cinta)">
          <Entrada inputMode="decimal" value={ppmCampo} onChange={(e) => setPpmCampo(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="Opcional" data-ppm-campo />
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
