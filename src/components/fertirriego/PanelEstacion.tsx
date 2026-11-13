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
import { NOMBRE_BORRADOR, useBorradoresEstacion } from '@/lib/fertirriego/borrador'
import { agruparPorClase } from '@/lib/fertirriego/productos'
import { puedeRegistrar } from './MarcoRegistro'

/** «Borrador» bajo el texto del botón cuando hay un registro a medias de ese tipo. */
function MarcaBorrador({ si }: { si: boolean }) {
  if (!si) return null
  return (
    <span className="mt-0.5 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800" data-marca-borrador>
      Borrador
    </span>
  )
}

export type Accion = 'recibir' | 'envases' | 'aplicar' | 'contar' | 'custodia' | 'entregar' | 'recibir_relevo' | 'codigo'

export function PanelEstacion({
  estado,
  estacion,
  yo,
  saldos,
  saldosEnvases,
  enLinea,
  tieneEntregaPendiente = false,
  onAccion,
  onAplicarTurno,
  onVerProducto,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  saldos: Map<string, number>
  /** Envases por tipo en esta estación (con lo pendiente de enviar). */
  saldosEnvases?: Map<string, number>
  enLinea: boolean
  /** Otra persona ya entregó la estación (está en la base): se ofrece recibirla. */
  tieneEntregaPendiente?: boolean
  onAccion: (a: Accion) => void
  onAplicarTurno: (turnoId: string) => void
  onVerProducto: (materialId: string) => void
}) {
  const regla = puedeRegistrar(estacion, yo)
  const borradores = useBorradoresEstacion(yo.id, estacion.id)
  const hoy = hoyIso()
  const turnos = estado.turnos.filter((t) => t.estacion_id === estacion.id)
  const planHoy = turnos.map((t) => ({ t, plan: planDelDia(estado.plan, t.id, hoy) })).filter((x) => x.plan.size > 0)
  const material = (id: string) => estado.materiales.find((m) => m.id === id)
  const nombreEnvase = (id: string) => estado.envases_tipos?.find((e) => e.id === id)?.nombre ?? 'Envase'
  const envases = [...(saldosEnvases ?? new Map<string, number>()).entries()]
    .filter(([, v]) => v !== 0)
    .sort((a, b) => nombreEnvase(a[0]).localeCompare(nombreEnvase(b[0]), 'es'))
  const productos = [...saldos.entries()].filter(([, v]) => v !== 0)
  // Piloto 2, punto 5: por grupo, Fertilizantes primero y destacados
  const grupos = agruparPorClase(productos, ([id]) => material(id))
  // La base tiene la 99 (envases) y la persona puede recibir: se ofrece «Envases» sin producto
  const conEnvases = estacion.permisos.recibir && Array.isArray(estado.envases_tipos)

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
        {/* ---- Relevo ---- */}
        <div className="mt-2 flex flex-wrap gap-2">
          {estacion.permisos.relevo && estacion.custodio_id === yo.id && estacion.custodia_estado === 'ACTIVA' && (
            <Boton tamano="sm" variante="secundario" onClick={() => onAccion('entregar')} data-entregar-estacion>
              Entregar estación{borradores.has('relevo') ? ' (borrador)' : ''}
            </Boton>
          )}
          {estacion.custodio_id === yo.id && estacion.custodia_estado === 'EN_ENTREGA' && (
            <Boton tamano="sm" onClick={() => onAccion('codigo')} data-ver-codigo>
              Mostrar mi código de entrega
            </Boton>
          )}
          {estacion.permisos.relevo && estacion.custodio_id !== yo.id && (
            <Boton tamano="sm" onClick={() => onAccion('recibir_relevo')} data-recibir-estacion>
              {tieneEntregaPendiente ? 'Recibir la estación (te la entregaron)' : 'Recibir estación'}
            </Boton>
          )}
        </div>
        {estacion.custodio_id === yo.id && estacion.custodia_estado === 'EN_ENTREGA' && (
          <p className="mt-1 text-xs text-amber-800">Entregaste la estación: ya no puedes registrar en ella hasta que la vuelvas a recibir.</p>
        )}
        {estacion.permisos.administrar && (
          <button type="button" disabled={!enLinea} onClick={() => onAccion('custodia')} data-asignar-custodia className="mt-2 text-xs font-bold text-brand-700 underline disabled:text-slate-400 disabled:no-underline">
            {enLinea ? 'Asignar la estación a una persona' : 'Asignar la estación (necesita señal)'}
          </button>
        )}
      </div>

      {/* ---- Acciones ---- */}
      <div className={`grid gap-2 ${conEnvases ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {estacion.permisos.recibir && (
          <Boton onClick={() => onAccion('recibir')} disabled={!regla.si} className="flex-col py-4" data-accion="recibir">
            Recibir
            <MarcaBorrador si={borradores.has('recepcion')} />
          </Boton>
        )}
        {conEnvases && (
          // Piloto 2, punto 4: entregar / recibir envases sin recibir producto
          <Boton variante="secundario" onClick={() => onAccion('envases')} disabled={!regla.si} className="flex-col py-4" data-accion="envases">
            Envases
            <MarcaBorrador si={borradores.has('envases')} />
          </Boton>
        )}
        {estacion.permisos.aplicar && (
          <Boton onClick={() => onAccion('aplicar')} disabled={!regla.si} className="flex-col py-4" data-accion="aplicar">
            Aplicar
            <MarcaBorrador si={borradores.has('aplicacion')} />
          </Boton>
        )}
        {estacion.permisos.contar && (
          <Boton variante="secundario" onClick={() => onAccion('contar')} disabled={!regla.si} className="flex-col py-4" data-accion="contar">
            Contar
            <MarcaBorrador si={borradores.has('conteo')} />
          </Boton>
        )}
      </div>
      {borradores.size > 0 && (
        <p className="-mt-2 text-xs text-sky-800" data-hay-borradores>
          Tienes {borradores.size === 1 ? 'un registro a medias' : `${borradores.size} registros a medias`} (
          {[...borradores].map((t) => NOMBRE_BORRADOR[t]).join(', ')}): ábrelo para terminarlo o descartarlo.
        </p>
      )}

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
          <div className="flex flex-col gap-3" data-saldos>
            {grupos.map((g) => (
              <div
                key={g.clase}
                data-grupo-bodega={g.clase}
                className={g.fertilizantes ? 'rounded-2xl bg-brand-50/60 p-2 ring-1 ring-inset ring-brand-200' : ''}
              >
                <p className={`mb-1 px-1 text-[11px] font-bold uppercase tracking-wide ${g.fertilizantes ? 'text-brand-800' : 'text-slate-400'}`}>
                  {g.fertilizantes ? '★ ' : ''}
                  {g.clase}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {g.items.map(([id, v]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onVerProducto(id)}
                      data-saldo={material(id)?.codigo}
                      className="flex min-h-14 items-center justify-between gap-2 rounded-xl bg-white p-3 text-left ring-1 ring-inset ring-slate-200 hover:ring-brand-300"
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
              </div>
            ))}
          </div>
        )}
        {productos.some(([, v]) => v < 0) && (
          <div className="mt-2">
            <Insignia tono="rojo">Hay productos en negativo: falta registrar una entrega o un conteo.</Insignia>
          </div>
        )}
      </div>

      {/* ---- Envases (sql/99; sin la 99 no se muestra) ---- */}
      {(estado.envases_tipos?.length ?? 0) > 0 && (
        <div data-envases-estacion>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Envases en la estación</p>
          {envases.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
              Sin envases registrados. Se cuentan al recibir producto, con «Envases» (cuando el camión solo lleva o trae envases) y en el conteo.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {envases.map(([id, v]) => (
                <span
                  key={id}
                  data-saldo-envase={nombreEnvase(id)}
                  className={`inline-flex items-baseline gap-1.5 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-inset ring-slate-200 ${v < 0 ? 'text-red-700' : 'text-slate-800'}`}
                >
                  <span className="font-semibold">{nombreEnvase(id)}</span>
                  <span className="text-base font-bold tabular-nums">{v}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
