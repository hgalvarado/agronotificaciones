'use client'

/**
 * Las decisiones sobre un traslado:
 *   autorizar / no autorizar (quien autoriza) · recibir con lo que llegó / rechazar (la estación de destino)
 *   · cancelar (quien lo creó, antes de que lo autoricen).
 * La base vuelve a revisar todo (quién, en qué estado está, cantidades).
 */

import { useState } from 'react'
import { AreaTexto, Campo } from '@/components/ui/Primitivos'
import { cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Estacion, Operacion, Persona, Traslado } from '@/lib/fertirriego/tipos'
import { MarcoRegistro } from './MarcoRegistro'

export type AccionTraslado = 'autorizar' | 'no_autorizar' | 'aceptar' | 'rechazar' | 'cancelar'

const TITULO: Record<AccionTraslado, string> = {
  autorizar: 'Autorizar traslado',
  no_autorizar: 'No autorizar traslado',
  aceptar: 'Recibir traslado',
  rechazar: 'Rechazar traslado',
  cancelar: 'Cancelar traslado',
}

export function ResolverTraslado({
  estado,
  estacion,
  yo,
  traslado,
  accion,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  /** La estación sobre la que se actúa (origen para autorizar/cancelar; destino para recibir/rechazar). */
  estacion: Estacion
  yo: Persona
  traslado: Traslado
  accion: AccionTraslado
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [nota, setNota] = useState('')
  const [recibido, setRecibido] = useState<Record<string, string>>(() =>
    Object.fromEntries((traslado.lineas ?? []).map((l) => [l.material_id, String(l.cantidad_enviada)]))
  )
  const material = (id: string) => estado.materiales.find((m) => m.id === id)
  const sinCustodia = accion === 'autorizar' || accion === 'no_autorizar' || accion === 'cancelar'

  return (
    <MarcoRegistro
      titulo={TITULO[accion]}
      estacion={estacion}
      yo={yo}
      sinCustodia={sinCustodia}
      permiso={accion === 'cancelar' ? 'trasladar' : 'autorizar_traslado'}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      textoGuardar={TITULO[accion]}
      construir={({ ubicacion, enNombreDe }) => {
        if ((accion === 'rechazar' || accion === 'no_autorizar') && !nota.trim()) return 'Escribe el motivo.'
        const base = { traslado_id: traslado.id, nota: nota.trim() || null }
        const resumen = `${TITULO[accion]} · ${traslado.origen} → ${traslado.destino}`
        switch (accion) {
          case 'autorizar':
          case 'no_autorizar':
            return [crearOperacion('traslado_autorizar', { ...base, aprobar: accion === 'autorizar' }, { ubicacion, resumen })]
          case 'cancelar':
            return [crearOperacion('traslado_cancelar', { ...base, motivo: nota.trim() || null }, { ubicacion, resumen })]
          case 'rechazar':
            return [crearOperacion('traslado_rechazar', { ...base, estacion_id: estacion.id }, { ubicacion, enNombreDe, resumen })]
          case 'aceptar': {
            const lineas = []
            for (const l of traslado.lineas ?? []) {
              const n = Number((recibido[l.material_id] ?? '').replace(',', '.'))
              if (!Number.isFinite(n) || n < 0 || n > l.cantidad_enviada) {
                return `Lo recibido de ${material(l.material_id)?.descripcion ?? 'un producto'} debe estar entre 0 y ${cantidad(l.cantidad_enviada)}.`
              }
              lineas.push({ material_id: l.material_id, cantidad_recibida: Math.round(n * 10000) / 10000 })
            }
            return [crearOperacion('traslado_aceptar', { ...base, estacion_id: estacion.id, lineas }, { ubicacion, enNombreDe, resumen })]
          }
        }
      }}
    >
      <div className="rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200" data-detalle-traslado>
        <p className="font-semibold text-slate-800">
          {traslado.origen} → {traslado.destino}
        </p>
        <p className="text-xs text-slate-600">Motivo: {traslado.motivo}</p>
        <p className="text-xs text-slate-500">
          Lo pidió {traslado.creador ?? '—'} · autoriza {traslado.autorizador ?? '—'}
        </p>
      </div>

      {accion === 'aceptar' ? (
        <Campo etiqueta="¿Cuánto llegó?" requerido>
          <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200">
            {(traslado.lineas ?? []).map((l, i) => (
              <div key={l.material_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-semibold text-slate-800">{material(l.material_id)?.descripcion}</span>
                  <span className="text-[11px] text-slate-500">
                    Enviado: {cantidad(l.cantidad_enviada)} {material(l.material_id)?.unidad}
                  </span>
                </span>
                <input
                  inputMode="decimal"
                  value={recibido[l.material_id] ?? ''}
                  onChange={(e) => setRecibido({ ...recibido, [l.material_id]: e.target.value.replace(/[^\d.,]/g, '') })}
                  data-recibido={i}
                  className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums"
                />
              </div>
            ))}
          </div>
        </Campo>
      ) : (
        <ul className="text-sm text-slate-700">
          {(traslado.lineas ?? []).map((l) => (
            <li key={l.material_id}>
              {material(l.material_id)?.descripcion}: {cantidad(l.cantidad_enviada)} {material(l.material_id)?.unidad}
            </li>
          ))}
        </ul>
      )}

      <Campo etiqueta={accion === 'rechazar' || accion === 'no_autorizar' ? 'Motivo' : 'Nota (opcional)'} requerido={accion === 'rechazar' || accion === 'no_autorizar'}>
        <AreaTexto value={nota} onChange={(e) => setNota(e.target.value)} rows={2} data-nota-traslado />
      </Campo>
    </MarcoRegistro>
  )
}
