'use client'

/**
 * Recibir diésel a la BODEGA de la estación (sql/144): el diésel es un producto más de la bodega y los motores lo consumen de
 * ahí en el registro diario (suministro). Operación `diesel_recibir`, a nivel estación (sin elegir motor). El chofer y el
 * vehículo son los del catálogo de campo (mismos selectores que Recibir producto).
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo, Entrada } from '@/components/ui/Primitivos'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Chofer, EstadoCampo, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import { armarRecepcionDiesel } from '@/lib/motores/registroDiario'
import { SelectorChofer, SelectorVehiculo } from '@/components/fertirriego/ChoferVehiculo'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'

type Datos = { fechaHora: string; galones: string; chofer: string; vehiculo: string; comentario: string; nuevos: Operacion[]; choferesAqui: Chofer[]; vehiculosAqui: Vehiculo[] }

export function FormRecibirDiesel({
  dieselMaterialId,
  saldoGal,
  campo,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  /** El diésel que publica AGL (producto de la bodega). Sin él no se puede recibir. */
  dieselMaterialId: string | null
  /** Lo que hay hoy en la bodega de la estación (con lo pendiente), para mostrarlo. */
  saldoGal: number | null
  campo: EstadoCampo
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<Datos>(claveBorrador('diesel_recibir', yo.id, estacion.id))
  const b = borrador.inicial
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [galones, setGalones] = useState(b?.galones ?? '')
  const [chofer, setChofer] = useState(b?.chofer ?? '')
  const [vehiculo, setVehiculo] = useState(b?.vehiculo ?? '')
  const [comentario, setComentario] = useState(b?.comentario ?? '')
  const [nuevos, setNuevos] = useState<Operacion[]>(b?.nuevos ?? [])
  const [choferesAqui, setChoferesAqui] = useState<Chofer[]>(b?.choferesAqui ?? [])
  const [vehiculosAqui, setVehiculosAqui] = useState<Vehiculo[]>(b?.vehiculosAqui ?? [])
  useAutoguardado(borrador, { fechaHora, galones, chofer, vehiculo, comentario, nuevos, choferesAqui, vehiculosAqui })

  const choferes = useMemo(() => [...campo.choferes, ...choferesAqui], [campo.choferes, choferesAqui])
  const vehiculos = useMemo(() => [...campo.vehiculos, ...vehiculosAqui], [campo.vehiculos, vehiculosAqui])
  const g = Number(galones.replace(',', '.'))

  return (
    <MarcoRegistro
      titulo={`Recibir diésel · ${estacion.nombre}`}
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      construir={({ ubicacion, enNombreDe }) => {
        if (!dieselMaterialId) return 'AGL todavía no publica el producto diésel. Avisa a la Torre de Control.'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora de la recepción.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La recepción no puede ser en el futuro.'
        const a = armarRecepcionDiesel({
          estacionId: estacion.id,
          galones: g,
          fechaHora: fh,
          choferId: chofer || null,
          vehiculoId: vehiculo || null,
          comentario,
          dieselMaterialId,
        })
        if ('error' in a) return a.error
        return [...nuevos, crearOperacion('diesel_recibir', a.datos, { ubicacion, enNombreDe, resumen: `Diésel recibido · ${estacion.nombre} · ${g} gal` })]
      }}
    >
      <p className="text-sm text-slate-700" data-bodega-recibir>
        Entra a la bodega de <strong>{estacion.nombre}</strong>
        {saldoGal !== null ? ` · ahora hay ${saldoGal} gal de diésel` : ''}. Los motores lo toman de ahí con el suministro del registro diario.
      </p>
      <Campo etiqueta="Galones recibidos" requerido>
        <input
          inputMode="decimal"
          value={galones}
          onChange={(e) => setGalones(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="0"
          data-galones
          className="min-h-11 w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
        />
      </Campo>
      <Campo etiqueta="Fecha y hora" requerido>
        <Entrada type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} className="w-60" data-fecha-hora />
      </Campo>
      <Campo etiqueta="¿Quién entregó? (chofer)">
        <SelectorChofer
          valor={chofer}
          onCambiar={setChofer}
          choferes={choferes}
          onNuevo={(op, c) => {
            setNuevos((n) => [...n, op])
            setChoferesAqui((x) => [...x, c])
          }}
        />
      </Campo>
      <Campo etiqueta="Vehículo">
        <SelectorVehiculo
          valor={vehiculo}
          onCambiar={setVehiculo}
          vehiculos={vehiculos}
          chofer={chofer}
          choferesVehiculos={campo.choferes_vehiculos}
          onNuevo={(op, v) => {
            setNuevos((n) => [...n, op])
            setVehiculosAqui((x) => [...x, v])
          }}
        />
      </Campo>
      <Campo etiqueta="Observaciones">
        <AreaTexto value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Opcional" data-comentario />
      </Campo>
    </MarcoRegistro>
  )
}
