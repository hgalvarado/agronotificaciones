'use client'

/**
 * Chofer, vehículo y envases de una entrega (Recibir producto y «Envases»). Se eligen de la lista o se crean aquí
 * mismo, aun sin señal (quedan «por validar»): cada creación devuelve su operación para mandarla ANTES del registro.
 */

import { useState } from 'react'
import { Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { Chofer, EnvaseTipo, EstadoCampo, Operacion, Vehiculo } from '@/lib/fertirriego/tipos'

export function SelectorChofer({
  valor,
  onCambiar,
  choferes,
  onNuevo,
}: {
  valor: string
  onCambiar: (id: string) => void
  choferes: Chofer[]
  /** Chofer creado aquí: su operación y cómo se ve en la lista. */
  onNuevo: (op: Operacion, chofer: Chofer) => void
}) {
  return (
    <div data-selector-chofer>
      <SelectorBuscable
        valor={valor}
        opciones={choferes.map((c) => ({ id: c.id, titulo: c.nombre, subtitulo: c.validado ? undefined : 'por validar' }))}
        onCambiar={onCambiar}
        placeholder="Elegir chofer…"
        etiquetaBusqueda="Buscar chofer"
        creacionRapida={{
          etiqueta: 'Agregar chofer',
          campos: [{ key: 'nombre', label: 'Nombre completo', requerido: true }, { key: 'telefono', label: 'Teléfono' }],
          onCrear: async (v) => {
            const id = nuevoId()
            onNuevo(
              crearOperacion('chofer', { chofer_id: id, nombre: v.nombre, telefono: v.telefono || null }, { id, ubicacion: null, resumen: `Chofer nuevo · ${v.nombre}` }),
              { id, nombre: v.nombre, validado: false, pendiente: true }
            )
            return { id, titulo: v.nombre, subtitulo: 'nuevo · por validar' }
          },
        }}
      />
    </div>
  )
}

export function SelectorVehiculo({
  valor,
  onCambiar,
  vehiculos,
  chofer,
  choferesVehiculos,
  onNuevo,
}: {
  valor: string
  onCambiar: (id: string) => void
  vehiculos: Vehiculo[]
  /** Primero los camiones en que ya vino este chofer. */
  chofer: string
  choferesVehiculos: EstadoCampo['choferes_vehiculos']
  onNuevo: (op: Operacion, vehiculo: Vehiculo) => void
}) {
  const deEsteChofer = new Set(choferesVehiculos.filter((cv) => cv.chofer_id === chofer).map((cv) => cv.vehiculo_id))
  return (
    <div data-selector-vehiculo>
      <SelectorBuscable
        valor={valor}
        opciones={[...vehiculos]
          .sort((a, b) => Number(deEsteChofer.has(b.id)) - Number(deEsteChofer.has(a.id)))
          .map((v) => ({
            id: v.id,
            titulo: v.placa,
            subtitulo: [v.tipo, v.marca, v.color, deEsteChofer.has(v.id) ? 'ya vino en este' : null, v.validado ? null : 'por validar'].filter(Boolean).join(' · '),
          }))}
        onCambiar={onCambiar}
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
            onNuevo(
              crearOperacion('vehiculo', { vehiculo_id: id, placa, tipo: v.tipo || null, marca: v.marca || null, color: v.color || null }, { id, ubicacion: null, resumen: `Vehículo nuevo · ${placa}` }),
              { id, placa, tipo: v.tipo || null, marca: v.marca || null, color: v.color || null, validado: false, pendiente: true }
            )
            return { id, titulo: placa, subtitulo: 'nuevo · por validar' }
          },
        }}
      />
    </div>
  )
}

export type ValoresEnvases = Record<string, { recibidos: string; entregados: string }>

const soloEnteros = (v: string) => v.replace(/\D/g, '').slice(0, 6)

/** Envases recibidos / entregados por tipo, con «Agregar otro envase» (sin señal). */
export function BloqueEnvases({
  tipos,
  valores,
  onCambiar,
  saldos,
  onNuevoTipo,
  etiquetaRecibidos = 'Recibidos',
  etiquetaEntregados = 'Entregados',
  primeroEntregados = false,
}: {
  tipos: EnvaseTipo[]
  valores: ValoresEnvases
  onCambiar: (v: ValoresEnvases) => void
  saldos?: Map<string, number>
  /** Tipo creado aquí: su operación y cómo se ve en la lista. */
  onNuevoTipo: (op: Operacion, tipo: EnvaseTipo) => void
  etiquetaRecibidos?: string
  etiquetaEntregados?: string
  /** «Envases»: lo primero es lo que se lleva el camión. */
  primeroEntregados?: boolean
}) {
  const [nuevo, setNuevo] = useState<string | null>(null)

  function cambiar(id: string, campo: 'recibidos' | 'entregados', valor: string) {
    onCambiar({ ...valores, [id]: { recibidos: valores[id]?.recibidos ?? '', entregados: valores[id]?.entregados ?? '', [campo]: soloEnteros(valor) } })
  }

  function agregar() {
    const nombre = (nuevo ?? '').trim()
    if (!nombre) return
    if (!tipos.some((e) => e.nombre.trim().toLowerCase() === nombre.toLowerCase())) {
      const id = nuevoId()
      onNuevoTipo(crearOperacion('envase_tipo', { envase_id: id, nombre }, { id, ubicacion: null, resumen: `Envase nuevo · ${nombre}` }), {
        id,
        nombre,
        validado: false,
        pendiente: true,
      })
    }
    setNuevo(null)
  }

  const campo = (t: EnvaseTipo, c: 'recibidos' | 'entregados') => (
    <label key={c} className="flex flex-col items-center gap-0.5">
      <span className="max-w-28 text-center text-[10px] font-semibold uppercase leading-tight text-slate-500">{c === 'recibidos' ? etiquetaRecibidos : etiquetaEntregados}</span>
      <input
        inputMode="numeric"
        value={valores[t.id]?.[c] ?? ''}
        onChange={(e) => cambiar(t.id, c, e.target.value)}
        placeholder="0"
        {...(c === 'recibidos' ? { 'data-envase-recibidos': '' } : { 'data-envase-entregados': '' })}
        className="h-11 w-20 rounded-lg border border-slate-200 bg-white px-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
      />
    </label>
  )

  return (
    <>
      <div className="flex flex-col divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200" data-envases-recepcion>
        {tipos.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5" data-envase={t.nombre}>
            <div className="min-w-0 flex-1 basis-28">
              <p className="truncate text-sm font-semibold text-slate-800">{t.nombre}</p>
              <p className="text-[11px] text-slate-500">
                {t.validado ? '' : 'por validar · '}En la estación: {saldos?.get(t.id) ?? 0}
              </p>
            </div>
            {primeroEntregados ? [campo(t, 'entregados'), campo(t, 'recibidos')] : [campo(t, 'recibidos'), campo(t, 'entregados')]}
          </div>
        ))}
        {tipos.length === 0 && <p className="px-3 py-3 text-sm text-slate-400">Agrega el tipo de envase.</p>}
      </div>
      {nuevo === null ? (
        <button
          type="button"
          data-agregar-envase
          onClick={() => setNuevo('')}
          className="mt-2 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          + Agregar otro envase
        </button>
      ) : (
        <div className="mt-2 flex gap-2">
          <Entrada
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                agregar()
              }
            }}
            placeholder="Nombre (ej. Tote, Saco)"
            autoFocus
            data-nombre-envase-nuevo
          />
          <button type="button" onClick={agregar} data-crear-envase className="shrink-0 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white">
            Agregar
          </button>
          <button type="button" onClick={() => setNuevo(null)} className="shrink-0 rounded-lg px-2 text-sm text-slate-500">
            No agregar
          </button>
        </div>
      )}
    </>
  )
}
