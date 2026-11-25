'use client'

/**
 * Recibir diésel al TANQUE de la estación (sql/147): se elige el tanque (de los tanques fijos asignados a la estación; con uno solo
 * ya viene elegido) y no se toca la bodega. Operación `diesel_recibir`. El chofer y el vehículo son los del catálogo de campo
 * (mismos selectores que Recibir producto).
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Chofer, EstadoCampo, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import type { RecepcionMotor, TanqueFijo } from '@/lib/motores/estado'
import { armarRecepcionDiesel } from '@/lib/motores/registroDiario'
import { SelectorChofer, SelectorVehiculo } from '@/components/fertirriego/ChoferVehiculo'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'

type Datos = { tanque?: string; fechaHora: string; galones: string; chofer: string; vehiculo: string; comentario: string; nuevos: Operacion[]; choferesAqui: Chofer[]; vehiculosAqui: Vehiculo[] }

export function FormRecibirDiesel({
  tanques,
  tanqueInicial,
  fechaInicial,
  saldoDe,
  corregir,
  campo,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  /** Los tanques de la estación (fijos). */
  tanques: TanqueFijo[]
  /** El tanque que ya viene elegido (el del motor o el que se tocó). */
  tanqueInicial?: string
  /** Día (AAAA-MM-DD) con el que viene la recepción (el del registro que la pidió); sin esto, ahora. */
  fechaInicial?: string
  /** Saldo del tanque contando lo pendiente de enviar. */
  saldoDe: (tanqueId: string) => number
  /** Solo administrador: corrige una recepción ya guardada (se anula la vieja y se guarda la corregida, con motivo). */
  corregir?: RecepcionMotor
  campo: EstadoCampo
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<Datos>(claveBorrador('diesel_recibir', yo.id, estacion.id, corregir ? `corregir-${corregir.id}` : ''))
  const b = borrador.inicial
  const [tanque, setTanque] = useState(b?.tanque ?? corregir?.tanque_id ?? tanqueInicial ?? (tanques.length === 1 ? tanques[0].id : ''))
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? (corregir ? aEntradaLocal(corregir.fecha_hora) : fechaInicial ? `${fechaInicial}T12:00` : aEntradaLocal(ahoraIso())))
  const [galones, setGalones] = useState(b?.galones ?? (corregir ? String(corregir.galones) : ''))
  const [chofer, setChofer] = useState(b?.chofer ?? corregir?.chofer_id ?? '')
  const [vehiculo, setVehiculo] = useState(b?.vehiculo ?? corregir?.vehiculo_id ?? '')
  const [comentario, setComentario] = useState(b?.comentario ?? corregir?.comentario ?? '')
  const [motivo, setMotivo] = useState('')
  const [nuevos, setNuevos] = useState<Operacion[]>(b?.nuevos ?? [])
  const [choferesAqui, setChoferesAqui] = useState<Chofer[]>(b?.choferesAqui ?? [])
  const [vehiculosAqui, setVehiculosAqui] = useState<Vehiculo[]>(b?.vehiculosAqui ?? [])
  useAutoguardado(borrador, { tanque, fechaHora, galones, chofer, vehiculo, comentario, nuevos, choferesAqui, vehiculosAqui })

  const choferes = useMemo(() => [...campo.choferes, ...choferesAqui], [campo.choferes, choferesAqui])
  const vehiculos = useMemo(() => [...campo.vehiculos, ...vehiculosAqui], [campo.vehiculos, vehiculosAqui])
  const g = Number(galones.replace(',', '.'))

  return (
    <MarcoRegistro
      titulo={corregir ? `Corregir recepción · ${estacion.nombre}` : `Recibir combustible · ${estacion.nombre}`}
      {...(corregir ? { permiso: 'anular' as const, sinCustodia: true, textoGuardar: 'Guardar corrección' } : {})}
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      construir={({ ubicacion, enNombreDe }) => {
        if (tanques.length === 0) return 'Sin tanques. Pide uno a Torre de Control.'
        if (corregir && motivo.trim().length < 10) return 'Escribe por qué se corrige (mínimo 10 letras).'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Falta la fecha y hora.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La fecha no puede ser futura.'
        const a = armarRecepcionDiesel({
          estacionId: estacion.id,
          tanqueId: tanque || null,
          galones: g,
          fechaHora: fh,
          choferId: chofer || null,
          vehiculoId: vehiculo || null,
          comentario,
        })
        if ('error' in a) return a.error
        const nueva = crearOperacion('diesel_recibir', a.datos, { ubicacion, enNombreDe, resumen: `${corregir ? 'Recepción CORREGIDA' : 'Combustible recibido'} · ${tanques.find((t) => t.id === tanque)?.nombre ?? estacion.nombre} · ${g} gal` })
        if (!corregir) return [...nuevos, nueva]
        // Corregir = anular la recepción vieja y guardar la corregida, EN ESE ORDEN (la cola se ordena por creado_en, a segundos)
        const anula = crearOperacion('anulacion', { estacion_id: estacion.id, documento_tipo: 'diesel_recepcion', documento_id: corregir.id, motivo: `Corrección: ${motivo.trim()}` }, { ubicacion, enNombreDe, resumen: `Corrección · anula recepción de ${corregir.galones} gal` })
        nueva.creado_en = ahoraIso(new Date(Date.parse(anula.creado_en) + 1000))
        return [...nuevos, anula, nueva]
      }}
    >
      <p className="text-sm text-slate-700" data-bodega-recibir>
        Entra al <strong>tanque</strong>, no a la bodega.
      </p>
      <Campo etiqueta="Tanque" requerido>
        <div data-selector-tanque-diesel>
          <SelectorBuscable
            valor={tanque}
            opciones={tanques.map((t) => ({
              id: t.id,
              titulo: t.nombre,
              subtitulo: `${saldoDe(t.id)} gal${t.capacidad_gal ? ` de ${t.capacidad_gal}` : ''}${t.motor_equipo_id ? ' · con motor' : ' · sin motor'}`,
            }))}
            onCambiar={setTanque}
            placeholder="Elegir tanque…"
            etiquetaBusqueda="Buscar tanque"
            permitirVacio={false}
          />
        </div>
        {tanque && <p className="mt-1 text-xs text-slate-600">Hay {saldoDe(tanque)} gal.</p>}
      </Campo>
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
      {corregir && (
        <Campo etiqueta="Motivo de la corrección" requerido>
          <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Qué estaba mal" data-motivo-correccion />
        </Campo>
      )}
      <Campo etiqueta="Observaciones">
        <AreaTexto value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Opcional" data-comentario />
      </Campo>
    </MarcoRegistro>
  )
}
