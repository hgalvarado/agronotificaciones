'use client'

/**
 * Devolver diésel del TANQUE a bodega (sql/155). Las mismas opciones que «Devolver a bodega» de Fertirriego: a dónde (Suministros,
 * Bodega o Taller), fecha y hora, quién lo retiró y en qué vehículo (catálogos de campo, con tipo), motivo y galones. No se devuelve
 * más de lo que hay en el tanque. Operación `diesel_devolver` (cola sin señal); la base guarda el saldo antes y después.
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { cantidad } from '@/lib/fertirriego/calculos'
import { DESTINOS_DEVOLUCION, type DestinoDevolucion } from '@/lib/fertirriego/devolucionBodega'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Chofer, EstadoCampo, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import { armarDevolucionDiesel } from '@/lib/motores/devolucionDiesel'
import type { TanqueFijo } from '@/lib/motores/estado'
import { SelectorChofer, SelectorVehiculo } from '@/components/fertirriego/ChoferVehiculo'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'

type Datos = {
  tanque?: string
  fechaHora: string
  destino: DestinoDevolucion | ''
  galones: string
  motivo: string
  chofer: string
  vehiculo: string
  nuevos: Operacion[]
  choferesAqui: Chofer[]
  vehiculosAqui: Vehiculo[]
}

export function FormDevolverDiesel({
  tanques,
  tanqueInicial,
  saldoDe,
  campo,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  tanques: TanqueFijo[]
  tanqueInicial?: string
  /** Saldo del tanque contando lo pendiente de enviar. */
  saldoDe: (tanqueId: string) => number
  campo: EstadoCampo
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<Datos>(claveBorrador('diesel_devolver', yo.id, estacion.id))
  const b = borrador.inicial
  const conDiesel = tanques.filter((t) => saldoDe(t.id) > 0)
  const [tanque, setTanque] = useState(b?.tanque ?? tanqueInicial ?? (conDiesel.length === 1 ? conDiesel[0].id : ''))
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [destino, setDestino] = useState<DestinoDevolucion | ''>(b?.destino ?? '')
  const [galones, setGalones] = useState(b?.galones ?? '')
  const [motivo, setMotivo] = useState(b?.motivo ?? '')
  const [chofer, setChofer] = useState(b?.chofer ?? '')
  const [vehiculo, setVehiculo] = useState(b?.vehiculo ?? '')
  const [nuevos, setNuevos] = useState<Operacion[]>(b?.nuevos ?? [])
  const [choferesAqui, setChoferesAqui] = useState<Chofer[]>(b?.choferesAqui ?? [])
  const [vehiculosAqui, setVehiculosAqui] = useState<Vehiculo[]>(b?.vehiculosAqui ?? [])
  useAutoguardado(borrador, { tanque, fechaHora, destino, galones, motivo, chofer, vehiculo, nuevos, choferesAqui, vehiculosAqui })

  const choferes = useMemo(() => [...campo.choferes, ...choferesAqui], [campo.choferes, choferesAqui])
  const vehiculos = useMemo(() => [...campo.vehiculos, ...vehiculosAqui], [campo.vehiculos, vehiculosAqui])
  const vehiculoElegido = vehiculos.find((v) => v.id === vehiculo)
  const disponible = tanque ? saldoDe(tanque) : 0
  const g = Number(galones.replace(',', '.'))
  const nombreTanque = tanques.find((t) => t.id === tanque)?.nombre ?? ''

  return (
    <MarcoRegistro
      titulo={`Devolver diésel a bodega · ${estacion.nombre}`}
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      construir={({ ubicacion, enNombreDe }) => {
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora de la devolución.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La devolución no puede ser en el futuro.'
        const a = armarDevolucionDiesel({
          estacionId: estacion.id,
          tanqueId: tanque,
          galones: g,
          disponible,
          destino,
          motivo,
          fechaHora: fh,
          choferId: chofer,
          vehiculoId: vehiculo,
          vehiculoTipo: vehiculoElegido?.tipo ?? null,
        })
        if ('error' in a) return a.error
        const destinoNombre = DESTINOS_DEVOLUCION.find((d) => d.id === destino)?.nombre ?? destino
        const quien = choferes.find((c) => c.id === chofer)?.nombre ?? ''
        const op = crearOperacion('diesel_devolver', a.datos, {
          ubicacion,
          enNombreDe,
          resumen: `Diésel devuelto a ${destinoNombre.toUpperCase()} · ${nombreTanque} · ${cantidad(g)} gal · retiró ${quien}`,
        })
        // Chofer o vehículo nuevos van ANTES (la devolución los necesita), con la misma ubicación
        return [...nuevos, op].map((n) => ({ ...n, ubicacion }))
      }}
    >
      <Campo etiqueta="Tanque" requerido>
        <div data-selector-tanque-devolver>
          <SelectorBuscable
            valor={tanque}
            opciones={tanques.map((t) => ({
              id: t.id,
              titulo: t.nombre,
              subtitulo: `${cantidad(saldoDe(t.id))} gal${t.capacidad_gal ? ` de ${t.capacidad_gal}` : ''}`,
            }))}
            onCambiar={setTanque}
            placeholder="Elegir tanque…"
            etiquetaBusqueda="Buscar tanque"
            permitirVacio={false}
          />
        </div>
        {tanque && <p className="mt-1 text-xs text-slate-600" data-disponible-devolver>Hay {cantidad(disponible)} gal.</p>}
      </Campo>
      <Campo etiqueta="¿A dónde se devuelve?" requerido>
        <div className="grid grid-cols-3 gap-2" data-destinos-devolucion role="group" aria-label="Destino de la devolución">
          {DESTINOS_DEVOLUCION.map((d) => {
            const marcado = destino === d.id
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={marcado}
                data-destino={d.id}
                onClick={() => setDestino(d.id)}
                className={`min-h-12 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                  marcado ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'
                }`}
              >
                {marcado ? '✓ ' : ''}
                {d.nombre}
              </button>
            )
          })}
        </div>
      </Campo>
      <Campo etiqueta="Galones que se devuelven" requerido>
        <div className="flex items-center gap-2">
          <input
            inputMode="decimal"
            value={galones}
            onChange={(e) => setGalones(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="0"
            data-galones-devolver
            className="min-h-11 w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
          />
          {tanque && disponible > 0 && (
            <button
              type="button"
              onClick={() => setGalones(String(disponible))}
              className="min-h-11 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
              data-devolver-todo
            >
              Todo ({cantidad(disponible)})
            </button>
          )}
        </div>
        {tanque && Number.isFinite(g) && g > 0 && g <= disponible && (
          <p className="mt-1 text-xs text-slate-600" data-saldo-despues>
            Queda: {cantidad(Math.round((disponible - g) * 100) / 100)} gal.
          </p>
        )}
      </Campo>
      <Campo etiqueta="Fecha y hora" requerido>
        <Entrada type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} className="w-60" data-fecha-hora />
      </Campo>
      <Campo etiqueta="¿Quién retiró el diésel? (chofer o persona)" requerido>
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
      <Campo etiqueta="¿En qué vehículo se lo llevan?" requerido>
        <SelectorVehiculo
          valor={vehiculo}
          onCambiar={setVehiculo}
          vehiculos={vehiculos}
          chofer={chofer}
          choferesVehiculos={campo.choferes_vehiculos}
          obligatorio
          tipoRequerido
          etiquetaPlaca="Placa o identificación"
          onNuevo={(op, v) => {
            setNuevos((n) => [...n, op])
            setVehiculosAqui((x) => [...x, v])
          }}
        />
        {vehiculoElegido && (
          <p className="mt-1 text-xs text-slate-500" data-vehiculo-elegido>
            {vehiculoElegido.tipo ? `${vehiculoElegido.tipo} · ${vehiculoElegido.placa}` : `${vehiculoElegido.placa} · sin tipo en el catálogo (complétalo en Administración › Choferes y catálogos de campo)`}
          </p>
        )}
      </Campo>
      <Campo etiqueta="Motivo" requerido>
        <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej. Fin de temporada" data-motivo-devolucion />
        <button
          type="button"
          onClick={() => setMotivo((m) => (m.trim() ? m : 'Fin de temporada'))}
          className="mt-1 min-h-11 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
          data-motivo-sugerido
        >
          Usar «Fin de temporada»
        </button>
      </Campo>
    </MarcoRegistro>
  )
}
