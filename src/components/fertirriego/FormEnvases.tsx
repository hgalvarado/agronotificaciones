'use client'

/**
 * «Envases» (piloto 2, punto 4): el camión pasa a llevarse vacíos o a dejar envases SIN entregar producto. Queda con
 * chofer (obligatorio), vehículo, quién lo registró, la hora y la ubicación. Va a la base como una recepción sin
 * productos (`lineas: []`, `envases`, `solo_envases: true`; la base lo acepta desde la 99).
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo, Entrada } from '@/components/ui/Primitivos'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { leerEnvases } from '@/lib/fertirriego/envases'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Chofer, EnvaseTipo, EstadoCampo, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import { BloqueEnvases, SelectorChofer, SelectorVehiculo, type ValoresEnvases } from './ChoferVehiculo'
import { MarcoRegistro } from './MarcoRegistro'

type DatosEnvases = {
  fechaHora: string
  chofer: string
  vehiculo: string
  comentario: string
  envases: ValoresEnvases
  nuevos: Operacion[]
  choferesAqui: Chofer[]
  vehiculosAqui: Vehiculo[]
  envasesAqui: EnvaseTipo[]
}

export function FormEnvases({
  estado,
  estacion,
  yo,
  saldosEnvases,
  choferesPendientes,
  vehiculosPendientes,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  saldosEnvases?: Map<string, number>
  choferesPendientes: Chofer[]
  vehiculosPendientes: Vehiculo[]
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<DatosEnvases>(claveBorrador('envases', yo.id, estacion.id))
  const b = borrador.inicial
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [chofer, setChofer] = useState(b?.chofer ?? '')
  const [vehiculo, setVehiculo] = useState(b?.vehiculo ?? '')
  const [comentario, setComentario] = useState(b?.comentario ?? '')
  const [envases, setEnvases] = useState<ValoresEnvases>(b?.envases ?? {})
  const [nuevos, setNuevos] = useState<Operacion[]>(b?.nuevos ?? [])
  const [choferesAqui, setChoferesAqui] = useState<Chofer[]>(b?.choferesAqui ?? [])
  const [vehiculosAqui, setVehiculosAqui] = useState<Vehiculo[]>(b?.vehiculosAqui ?? [])
  const [envasesAqui, setEnvasesAqui] = useState<EnvaseTipo[]>(b?.envasesAqui ?? [])
  useAutoguardado(borrador, { fechaHora, chofer, vehiculo, comentario, envases, nuevos, choferesAqui, vehiculosAqui, envasesAqui })

  const choferes = useMemo(() => [...estado.choferes, ...choferesPendientes, ...choferesAqui], [estado.choferes, choferesPendientes, choferesAqui])
  const vehiculos = useMemo(() => [...estado.vehiculos, ...vehiculosPendientes, ...vehiculosAqui], [estado.vehiculos, vehiculosPendientes, vehiculosAqui])
  const tipos = useMemo(
    () => [...(estado.envases_tipos ?? []), ...envasesAqui.filter((e) => !(estado.envases_tipos ?? []).some((x) => x.id === e.id))],
    [estado.envases_tipos, envasesAqui]
  )

  return (
    <MarcoRegistro
      titulo="Envases"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      construir={({ ubicacion, enNombreDe }) => {
        if (!chofer) return 'Indica el chofer que se lleva o deja los envases.'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La fecha no puede ser en el futuro.'
        const e = leerEnvases(tipos.map((t) => ({ envase_id: t.id, recibidos: envases[t.id]?.recibidos ?? '', entregados: envases[t.id]?.entregados ?? '' })))
        if ('error' in e) return e.error
        if (e.envases.length === 0) return 'Escribe cuántos envases se entregaron o se recibieron.'
        const entregados = e.envases.reduce((s, x) => s + x.entregados, 0)
        const recibidos = e.envases.reduce((s, x) => s + x.recibidos, 0)
        const op = crearOperacion(
          'recepcion',
          {
            estacion_id: estacion.id,
            fecha_hora: fh,
            chofer_id: chofer,
            vehiculo_id: vehiculo || null,
            lugar: estacion.nombre,
            documento: null,
            comentario: comentario.trim() || null,
            turnos: [],
            lineas: [],
            envases: e.envases,
            solo_envases: true,
          },
          { ubicacion, enNombreDe, resumen: `Envases · ${entregados} entregado(s), ${recibidos} recibido(s)` }
        )
        // Choferes y vehículos nuevos van siempre; los tipos de envase nuevos, solo si se usan
        const usados = new Set(e.envases.map((x) => x.envase_id))
        const previos = nuevos.filter((n) => n.tipo !== 'envase_tipo' || usados.has(String(n.datos.envase_id)))
        return [...previos, op].map((n) => ({ ...n, ubicacion }))
      }}
    >
      <p className="text-sm text-slate-500" data-form-envases>
        Para cuando el camión solo se lleva vacíos o deja envases, sin entregar producto. Si también trae producto, usa
        <strong> Recibir</strong>.
      </p>
      <Campo etiqueta="Fecha y hora" requerido>
        <Entrada type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} data-fecha-hora />
      </Campo>
      <Campo etiqueta="Chofer" requerido>
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
          choferesVehiculos={estado.choferes_vehiculos}
          onNuevo={(op, v) => {
            setNuevos((n) => [...n, op])
            setVehiculosAqui((x) => [...x, v])
          }}
        />
      </Campo>
      <Campo etiqueta="Envases" requerido>
        <BloqueEnvases
          tipos={tipos}
          valores={envases}
          onCambiar={setEnvases}
          saldos={saldosEnvases}
          etiquetaEntregados="Entregados (vacíos que se llevan)"
          etiquetaRecibidos="Recibidos"
          primeroEntregados
          onNuevoTipo={(op, t) => {
            setNuevos((n) => [...n, op])
            setEnvasesAqui((x) => [...x, t])
          }}
        />
      </Campo>
      <Campo etiqueta="Comentario (opcional)">
        <AreaTexto value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Ej. se llevó 4 barriles vacíos y 1 roto" data-comentario-envases />
      </Campo>
    </MarcoRegistro>
  )
}
