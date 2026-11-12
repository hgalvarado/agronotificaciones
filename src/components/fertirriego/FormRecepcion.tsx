'use client'

/**
 * Recibir producto en la bodega de la estación: quién entregó (chofer y vehículo), cuándo y cuánto.
 * Chofer y vehículo se eligen de la lista o se crean aquí mismo, aun sin señal (quedan «por validar»).
 *
 * Pedidos del usuario (2026-11-12):
 *   - Sin «¿Dónde?»: siempre se recibe en la bodega de ESTA estación (se guarda su nombre).
 *   - Los productos vienen por defecto: los del plan de los turnos de la estación (lo que el plan nutricional usa),
 *     con lo planificado para los próximos días como guía. Se pueden quitar o agregar otros; lo que queda vacío no
 *     se registra.
 *   - Borrador: si se sale por error, al volver sigue donde iba.
 */

import { useMemo, useState } from 'react'
import { Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal, hoyIso } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { productosDelPlan } from '@/lib/fertirriego/calculos'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { Chofer, EstadoCampo, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import { EditorLineas, leerLineas, SIN_LINEAS, type LineaEditable } from './EditorLineas'
import { MarcoRegistro } from './MarcoRegistro'

/** Días de plan que se muestran como guía junto a cada producto. */
const DIAS_PLAN = 7

type DatosRecepcion = {
  fechaHora: string
  chofer: string
  vehiculo: string
  documento: string
  lineas: LineaEditable[]
  nuevos: Operacion[]
  choferesAqui: Chofer[]
  vehiculosAqui: Vehiculo[]
}

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
  // Lo que necesitan los turnos de ESTA estación: sus productos van por defecto, con lo de los próximos días
  const { materiales: materialesPlan, proximos } = useMemo(
    () => productosDelPlan(estado.plan, estado.turnos, estacion.id, hoyIso(), DIAS_PLAN),
    [estado.plan, estado.turnos, estacion.id]
  )
  const borrador = useBorrador<DatosRecepcion>(claveBorrador('recepcion', yo.id, estacion.id))
  const b = borrador.inicial
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [chofer, setChofer] = useState(b?.chofer ?? '')
  const [vehiculo, setVehiculo] = useState(b?.vehiculo ?? '')
  const [documento, setDocumento] = useState(b?.documento ?? '')
  const [lineas, setLineas] = useState<LineaEditable[]>(
    () =>
      b?.lineas ??
      (materialesPlan.length
        ? materialesPlan.map((material_id) => ({ clave: nuevoId(), material_id, cantidad: '' }))
        : [{ clave: nuevoId(), material_id: '', cantidad: '' }])
  )
  // Lo creado aquí antes de guardar (se manda junto con la recepción, en orden)
  const [nuevos, setNuevos] = useState<Operacion[]>(b?.nuevos ?? [])
  const [choferesAqui, setChoferesAqui] = useState<Chofer[]>(b?.choferesAqui ?? [])
  const [vehiculosAqui, setVehiculosAqui] = useState<Vehiculo[]>(b?.vehiculosAqui ?? [])
  useAutoguardado(borrador, { fechaHora, chofer, vehiculo, documento, lineas, nuevos, choferesAqui, vehiculosAqui })

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
      borrador={borrador}
      construir={({ ubicacion, enNombreDe }) => {
        if (!chofer) return 'Indica quién entregó (chofer).'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora de la entrega.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La entrega no puede ser en el futuro.'
        const r = leerLineas(lineas)
        if ('error' in r) {
          return r.error === SIN_LINEAS ? 'Escribe la cantidad de al menos un producto recibido (lo que no llegó, déjalo vacío).' : r.error
        }
        const recepcion = crearOperacion(
          'recepcion',
          {
            estacion_id: estacion.id,
            fecha_hora: fh,
            chofer_id: chofer,
            vehiculo_id: vehiculo || null,
            lugar: estacion.nombre, // siempre se recibe en la bodega de esta estación
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

      <Campo etiqueta="Documento (opcional)">
        <Entrada value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="Remisión / vale" data-documento />
      </Campo>

      <Campo etiqueta="Productos recibidos" requerido>
        {materialesPlan.length > 0 && (
          <p className="mb-2 text-xs text-slate-500" data-productos-del-plan>
            Vienen los productos del plan de los turnos de esta estación. Escribe lo que llegó; lo que no llegó, déjalo
            vacío o quítalo.
          </p>
        )}
        <EditorLineas
          materiales={estado.materiales}
          lineas={lineas}
          onCambiar={setLineas}
          saldos={saldos}
          plan={proximos}
          etiquetaPlan={`Plan ${DIAS_PLAN} días`}
          etiquetaCantidad="Recibido"
        />
      </Campo>
    </MarcoRegistro>
  )
}
