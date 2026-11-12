'use client'

/**
 * Recibir producto en la bodega de la estación: quién entregó (chofer y vehículo), cuándo, dónde y cuánto.
 * Chofer y vehículo se eligen de la lista o se crean aquí mismo, aun sin señal (quedan «por validar»).
 */

import { useMemo, useState } from 'react'
import { Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { Chofer, EstadoCampo, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import { EditorLineas, leerLineas, type LineaEditable } from './EditorLineas'
import { MarcoRegistro } from './MarcoRegistro'

export function FormRecepcion({
  estado,
  estacion,
  yo,
  saldos,
  choferesPendientes,
  vehiculosPendientes,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  saldos: Map<string, number>
  /** Los creados en el teléfono que aún no llegan al servidor. */
  choferesPendientes: Chofer[]
  vehiculosPendientes: Vehiculo[]
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [fechaHora, setFechaHora] = useState(aEntradaLocal(ahoraIso()))
  const [chofer, setChofer] = useState('')
  const [vehiculo, setVehiculo] = useState('')
  const [lugar, setLugar] = useState(estacion.nombre)
  const [documento, setDocumento] = useState('')
  const [lineas, setLineas] = useState<LineaEditable[]>([{ clave: nuevoId(), material_id: '', cantidad: '' }])
  // Lo creado aquí antes de guardar (se manda junto con la recepción, en orden)
  const [nuevos, setNuevos] = useState<Operacion[]>([])
  const [choferesAqui, setChoferesAqui] = useState<Chofer[]>([])
  const [vehiculosAqui, setVehiculosAqui] = useState<Vehiculo[]>([])

  const choferes = useMemo(
    () => [...estado.choferes, ...choferesPendientes, ...choferesAqui],
    [estado.choferes, choferesPendientes, choferesAqui]
  )
  const vehiculos = useMemo(
    () => [...estado.vehiculos, ...vehiculosPendientes, ...vehiculosAqui],
    [estado.vehiculos, vehiculosPendientes, vehiculosAqui]
  )
  // Primero los camiones en que ya vino este chofer
  const deEsteChofer = new Set(estado.choferes_vehiculos.filter((cv) => cv.chofer_id === chofer).map((cv) => cv.vehiculo_id))

  return (
    <MarcoRegistro
      titulo="Recibir producto"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      construir={({ ubicacion, enNombreDe }) => {
        if (!chofer) return 'Indica quién entregó (chofer).'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora de la entrega.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La entrega no puede ser en el futuro.'
        const r = leerLineas(lineas)
        if ('error' in r) return r.error
        const recepcion = crearOperacion(
          'recepcion',
          {
            estacion_id: estacion.id,
            fecha_hora: fh,
            chofer_id: chofer,
            vehiculo_id: vehiculo || null,
            lugar: lugar.trim() || null,
            documento: documento.trim() || null,
            lineas: r.lineas,
          },
          { ubicacion, enNombreDe, resumen: `Recepción · ${r.lineas.length} producto(s)` }
        )
        // Los choferes/vehículos nuevos van ANTES (la recepción los necesita), con la misma ubicación
        return [...nuevos.map((n) => ({ ...n, ubicacion })), recepcion]
      }}
    >
      <Campo etiqueta="Fecha y hora de la entrega" requerido>
        <Entrada type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} data-fecha-hora />
      </Campo>

      <Campo etiqueta="¿Quién entregó? (chofer)" requerido>
        <div data-selector-chofer>
          <SelectorBuscable
            valor={chofer}
            opciones={choferes.map((c) => ({ id: c.id, titulo: c.nombre, subtitulo: c.validado ? undefined : 'por validar' }))}
            onCambiar={setChofer}
            placeholder="Elegir chofer…"
            etiquetaBusqueda="Buscar chofer"
            creacionRapida={{
              etiqueta: 'Agregar chofer',
              campos: [{ key: 'nombre', label: 'Nombre completo', requerido: true }, { key: 'telefono', label: 'Teléfono' }],
              onCrear: async (v) => {
                const id = nuevoId()
                setNuevos((n) => [
                  ...n,
                  crearOperacion('chofer', { chofer_id: id, nombre: v.nombre, telefono: v.telefono || null }, { id, ubicacion: null, resumen: `Chofer nuevo · ${v.nombre}` }),
                ])
                setChoferesAqui((c) => [...c, { id, nombre: v.nombre, validado: false, pendiente: true }])
                return { id, titulo: v.nombre, subtitulo: 'nuevo · por validar' }
              },
            }}
          />
        </div>
      </Campo>

      <Campo etiqueta="Vehículo">
        <div data-selector-vehiculo>
          <SelectorBuscable
            valor={vehiculo}
            opciones={[...vehiculos]
              .sort((a, b) => Number(deEsteChofer.has(b.id)) - Number(deEsteChofer.has(a.id)))
              .map((v) => ({
                id: v.id,
                titulo: v.placa,
                subtitulo: [v.tipo, v.marca, v.color, deEsteChofer.has(v.id) ? 'ya vino en este' : null, v.validado ? null : 'por validar']
                  .filter(Boolean)
                  .join(' · '),
              }))}
            onCambiar={setVehiculo}
            placeholder="Elegir vehículo…"
            etiquetaBusqueda="Buscar placa"
            permitirVacio
            textoVacio="Sin vehículo"
            creacionRapida={{
              etiqueta: 'Agregar vehículo',
              campos: [
                { key: 'placa', label: 'Placa', requerido: true },
                { key: 'tipo', label: 'Tipo (camión, pick-up…)' },
                { key: 'marca', label: 'Marca' },
                { key: 'color', label: 'Color' },
              ],
              onCrear: async (v) => {
                const id = nuevoId()
                const placa = v.placa.toUpperCase().replace(/\s+/g, '')
                setNuevos((n) => [
                  ...n,
                  crearOperacion(
                    'vehiculo',
                    { vehiculo_id: id, placa, tipo: v.tipo || null, marca: v.marca || null, color: v.color || null },
                    { id, ubicacion: null, resumen: `Vehículo nuevo · ${placa}` }
                  ),
                ])
                setVehiculosAqui((x) => [...x, { id, placa, tipo: v.tipo || null, marca: v.marca || null, color: v.color || null, validado: false, pendiente: true }])
                return { id, titulo: placa, subtitulo: 'nuevo · por validar' }
              },
            }}
          />
        </div>
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="¿Dónde?">
          <Entrada value={lugar} onChange={(e) => setLugar(e.target.value)} />
        </Campo>
        <Campo etiqueta="Documento (opcional)">
          <Entrada value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="Remisión / vale" />
        </Campo>
      </div>

      <Campo etiqueta="Productos recibidos" requerido>
        <EditorLineas materiales={estado.materiales} lineas={lineas} onCambiar={setLineas} saldos={saldos} etiquetaCantidad="Recibido" />
      </Campo>
    </MarcoRegistro>
  )
}
