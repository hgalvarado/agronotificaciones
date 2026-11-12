'use client'

/**
 * Entregar la estación (cambio de jornada). Bitácora de novedades OBLIGATORIA por turno de la estación: qué quedó
 * en aplicación, qué quedó preparado en tanques, qué falta. Al guardar, quien entrega QUEDA BLOQUEADO en la
 * estación y se le muestra su código para que el siguiente lo escriba en su teléfono.
 */

import { useState } from 'react'
import { AreaTexto, Campo } from '@/components/ui/Primitivos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import type { EstadoCampo, EstadoNovedad, Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { MarcoRegistro } from './MarcoRegistro'

export const ESTADOS_NOVEDAD: { valor: EstadoNovedad; nombre: string }[] = [
  { valor: 'EN_APLICACION', nombre: 'Todavía en aplicación' },
  { valor: 'PREPARADO', nombre: 'Preparado en tanques' },
  { valor: 'PENDIENTE', nombre: 'Pendiente (no se ha empezado)' },
  { valor: 'TERMINADO', nombre: 'Terminado' },
]

export function FormEntregarRelevo({
  estado,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const turnos = estado.turnos.filter((t) => t.estacion_id === estacion.id)
  type Novedades = Record<string, { estado: EstadoNovedad | ''; nota: string }>
  const borrador = useBorrador<{ novedades: Novedades; nota: string }>(claveBorrador('relevo', yo.id, estacion.id))
  const [novedades, setNovedades] = useState<Novedades>(borrador.inicial?.novedades ?? {})
  const [nota, setNota] = useState(borrador.inicial?.nota ?? '')
  useAutoguardado(borrador, { novedades, nota })

  return (
    <MarcoRegistro
      titulo="Entregar estación"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      textoGuardar="Entregar y mostrar mi código"
      construir={({ ubicacion }) => {
        const lista = turnos
          .map((t) => ({ turno_ciclo_id: t.id, estado: novedades[t.id]?.estado ?? '', nota: (novedades[t.id]?.nota ?? '').trim() }))
          .filter((n) => n.estado || n.nota)
        if (turnos.length && lista.some((n) => !n.estado)) return 'Indica el estado de cada turno donde escribiste algo.'
        if (!lista.length && !nota.trim()) return 'Escribe las novedades: cómo dejas los turnos y la estación.'
        return [
          crearOperacion(
            'relevo_entregar',
            { estacion_id: estacion.id, novedades: lista, nota: nota.trim() || null },
            { ubicacion, resumen: `Entrega de estación · ${estacion.nombre}` }
          ),
        ]
      }}
    >
      <p className="text-sm text-slate-600">
        Al entregar, ya no podrás registrar en esta estación hasta que la vuelvas a recibir. Tu compañero escribirá en su teléfono el
        código que te va a aparecer.
      </p>
      {turnos.length > 0 && (
        <Campo etiqueta="¿Cómo dejas cada turno?" requerido>
          <div className="flex flex-col gap-2" data-novedades>
            {turnos.map((t) => (
              <div key={t.id} className="rounded-xl p-2.5 ring-1 ring-inset ring-slate-200" data-novedad-turno={t.turno}>
                <p className="mb-1.5 text-sm font-bold text-slate-800">{t.turno}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ESTADOS_NOVEDAD.map((e) => (
                    <button
                      key={e.valor}
                      type="button"
                      aria-pressed={novedades[t.id]?.estado === e.valor}
                      data-estado-novedad={e.valor}
                      onClick={() => setNovedades({ ...novedades, [t.id]: { estado: e.valor, nota: novedades[t.id]?.nota ?? '' } })}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                        novedades[t.id]?.estado === e.valor ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'
                      }`}
                    >
                      {e.nombre}
                    </button>
                  ))}
                </div>
                <input
                  value={novedades[t.id]?.nota ?? ''}
                  onChange={(ev) => setNovedades({ ...novedades, [t.id]: { estado: novedades[t.id]?.estado ?? '', nota: ev.target.value } })}
                  placeholder="Nota (opcional): ej. va por la mitad del tanque"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
        </Campo>
      )}
      <Campo etiqueta="Novedades de la estación">
        <AreaTexto value={nota} onChange={(e) => setNota(e.target.value)} rows={3} placeholder="Bombas, tanques, fugas, lo que deba saber quien recibe…" data-nota-relevo />
      </Campo>
    </MarcoRegistro>
  )
}
