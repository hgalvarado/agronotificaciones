'use client'

/**
 * Recibir diésel directo al tanque del motor (§10 del diseño: no hay paso «bodega → tanque»). Operación `diesel_recibir`
 * (sql/130). El chofer y el vehículo son los del catálogo de campo (mismos selectores que Recibir producto).
 */

import { useMemo, useState } from 'react'
import { Alerta, AreaTexto, Campo, Entrada } from '@/components/ui/Primitivos'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Chofer, EstadoCampo, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import type { MotorEstacion } from '@/lib/motores/estado'
import { armarRecepcionDiesel } from '@/lib/motores/registroDiario'
import { SelectorChofer, SelectorVehiculo } from '@/components/fertirriego/ChoferVehiculo'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'

type Datos = { fechaHora: string; galones: string; chofer: string; vehiculo: string; comentario: string; nuevos: Operacion[]; choferesAqui: Chofer[]; vehiculosAqui: Vehiculo[] }

export function FormRecibirDiesel({
  motor,
  saldoGal,
  campo,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  motor: MotorEstacion
  saldoGal: number | null
  campo: EstadoCampo
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const tanque = motor.tanque
  const borrador = useBorrador<Datos>(claveBorrador('diesel_recibir', yo.id, estacion.id, motor.equipo_id))
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
  const pasa = tanque?.capacidad_gal && saldoGal !== null && Number.isFinite(g) && g > 0 && saldoGal + g > tanque.capacidad_gal + 0.0001

  return (
    <MarcoRegistro
      titulo={`Recibir diésel · ${motor.codigo}`}
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      construir={({ ubicacion, enNombreDe }) => {
        if (!tanque) return 'El motor no tiene tanque conectado.'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora de la recepción.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La recepción no puede ser en el futuro.'
        const a = armarRecepcionDiesel({
          tanqueId: tanque.id,
          galones: g,
          fechaHora: fh,
          choferId: chofer || null,
          vehiculoId: vehiculo || null,
          comentario,
          estacionId: estacion.id,
          capacidadGal: tanque.capacidad_gal,
          saldoActual: saldoGal ?? undefined,
        })
        if ('error' in a) return a.error
        return [...nuevos, crearOperacion('diesel_recibir', a.datos, { ubicacion, enNombreDe, resumen: `Diésel recibido · ${motor.codigo} · ${g} gal` })]
      }}
    >
      <p className="text-sm text-slate-700" data-tanque-recibir>
        Tanque <strong>{tanque?.nombre ?? '—'}</strong>
        {saldoGal !== null ? ` · ahora ${saldoGal} gal` : ''}
        {tanque?.capacidad_gal ? ` de ${tanque.capacidad_gal}` : ''}
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
        {pasa && <Alerta tono="ambar">Con esto el tanque pasa de su capacidad ({tanque?.capacidad_gal} gal). Se puede guardar igual.</Alerta>}
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
