'use client'

/**
 * «Mi estación»: quién la tiene a cargo, los botones de trabajo y la bodega (saldo por producto, con lo pendiente
 * de enviar), más lo planificado para hoy en sus turnos.
 */

import { Boton, Insignia } from '@/components/ui/Primitivos'
import { formatearFechaHora } from '@/lib/estados'
import { hoyIso } from '@/lib/fechas/zona'
import { cantidad, planDelDia } from '@/lib/fertirriego/calculos'
import type { EstadoCampo, Estacion, Persona } from '@/lib/fertirriego/tipos'
import { puedeRegistrar } from './MarcoRegistro'

export type Accion = 'recibir' | 'aplicar' | 'contar' | 'custodia'

export function PanelEstacion({
  estado,
  estacion,
  yo,
  saldos,
  enLinea,
  onAccion,
  onAplicarTurno,
  onVerProducto,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  saldos: Map<string, number>
  enLinea: boolean
  onAccion: (a: Accion) => void
  onAplicarTurno: (turnoId: string) => void
  onVerProducto: (materialId: string) => void
}) {
  const regla = puedeRegistrar(estacion, yo)
  const hoy = hoyIso()
  const turnos = estado.turnos.filter((t) => t.estacion_id === estacion.id)
  const planHoy = turnos.map((t) => ({ t, plan: planDelDia(estado.plan, t.id, hoy) })).filter((x) => x.plan.size > 0)
  const material = (id: string) => estado.materiales.find((m) => m.id === id)
  const productos = [...saldos.entries()].filter(([, v]) => v !== 0).sort((a, b) => (material(a[0])?.descripcion ?? '').localeCompare(material(b[0])?.descripcion ?? ''))

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Custodia ---- */}
      <div className={`rounded-2xl p-3.5 ring-1 ring-inset ${estacion.custodio_id === yo.id ? 'bg-brand-50 ring-brand-200' : 'bg-amber-50 ring-amber-200'}`} data-custodia>
        <p className="text-sm font-semibold text-slate-800">
          {estacion.custodio_id === yo.id
            ? 'La estación está a tu cargo'
            : estacion.custodio_id
              ? `A cargo de ${estacion.custodio}`
              : 'Nadie tiene la estación a cargo'}
        </p>
        {estacion.custodia_desde && <p className="text-xs text-slate-500">Desde {formatearFechaHora(estacion.custodia_desde)}</p>}
        {!regla.si && <p className="mt-1 text-xs text-amber-800">{regla.motivo}</p>}
        {regla.porOtro && <p className="mt-1 text-xs text-amber-800">Puedes registrar a nombre de un estacionero de la estación.</p>}
        {estacion.permisos.administrar && (
          <button type="button" disabled={!enLinea} onClick={() => onAccion('custodia')} data-asignar-custodia className="mt-2 text-xs font-bold text-brand-700 underline disabled:text-slate-400 disabled:no-underline">
            {enLinea ? 'Asignar la estación a una persona' : 'Asignar la estación (necesita señal)'}
          </button>
        )}
      </div>

      {/* ---- Acciones ---- */}
      <div className="grid grid-cols-3 gap-2">
        {estacion.permisos.recibir && (
          <Boton onClick={() => onAccion('recibir')} disabled={!regla.si} className="flex-col py-4" data-accion="recibir">
            Recibir
          </Boton>
        )}
        {estacion.permisos.aplicar && (
          <Boton onClick={() => onAccion('aplicar')} disabled={!regla.si} className="flex-col py-4" data-accion="aplicar">
            Aplicar
          </Boton>
        )}
        {estacion.permisos.contar && (
          <Boton variante="secundario" onClick={() => onAccion('contar')} disabled={!regla.si} className="flex-col py-4" data-accion="contar">
            Contar
          </Boton>
        )}
      </div>

      {/* ---- Plan de hoy ---- */}
      {planHoy.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Plan de hoy</p>
          <div className="flex flex-col gap-2">
            {planHoy.map(({ t, plan }) => (
              <button
                key={t.id}
                type="button"
                disabled={!regla.si || !estacion.permisos.aplicar}
                onClick={() => onAplicarTurno(t.id)}
                data-plan-turno={t.turno}
                className="rounded-xl bg-white p-3 text-left ring-1 ring-inset ring-slate-200 transition-colors hover:ring-brand-300 disabled:opacity-60"
              >
                <p className="text-sm font-bold text-slate-800">{t.turno}</p>
                <p className="text-xs text-slate-500">
                  {[...plan.entries()].map(([m, c]) => `${material(m)?.descripcion ?? '—'} ${cantidad(c)} ${material(m)?.unidad ?? ''}`).join(' · ')}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- Bodega ---- */}
      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">En bodega</p>
        {productos.length === 0 ? (
          <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
            Sin saldo registrado. Empieza con un <strong>Conteo</strong> (saldo inicial) o una <strong>Recepción</strong>.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-saldos>
            {productos.map(([id, v]) => (
              <button
                key={id}
                type="button"
                onClick={() => onVerProducto(id)}
                data-saldo={material(id)?.codigo}
                className="flex items-center justify-between gap-2 rounded-xl bg-white p-3 text-left ring-1 ring-inset ring-slate-200 hover:ring-brand-300"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-800">{material(id)?.descripcion ?? '—'}</span>
                  <span className="text-[11px] text-slate-400">{material(id)?.codigo}</span>
                </span>
                <span className={`shrink-0 text-lg font-bold tabular-nums ${v < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {cantidad(v)} <span className="text-xs font-semibold text-slate-500">{material(id)?.unidad}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {productos.some(([, v]) => v < 0) && (
          <div className="mt-2">
            <Insignia tono="rojo">Hay productos en negativo: falta registrar una entrega o un conteo.</Insignia>
          </div>
        )}
      </div>
    </div>
  )
}
