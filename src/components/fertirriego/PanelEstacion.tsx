'use client'

/**
 * «Mi estación»: quién la tiene a cargo, los botones de trabajo y la bodega (saldo por producto, con lo pendiente
 * de enviar), más lo planificado para hoy en sus turnos.
 */

import { useState } from 'react'
import { Boton, Insignia } from '@/components/ui/Primitivos'
import { formatearFechaHora } from '@/lib/estados'
import { hoyIso } from '@/lib/fechas/zona'
import { cantidad, planDelDia } from '@/lib/fertirriego/calculos'
import type { EstadoCampo, Estacion, Persona, PermisoHistorico } from '@/lib/fertirriego/tipos'
import { NOMBRE_BORRADOR, useBorradoresEstacion } from '@/lib/fertirriego/borrador'
import { NOMBRE_TIPO, ORDEN_TIPOS, conteoPorTipo, type FilaBodega, type TipoBodega } from '@/lib/fertirriego/bodegaGeneral'
import { puedeRegistrar } from './MarcoRegistro'

/** Un renglón de la bodega: nombre, saldo, de dónde vino. Los productos abren su bitácora. */
function FilaDeBodega({ fila: f, onVerProducto }: { fila: FilaBodega; onVerProducto: (materialId: string) => void }) {
  const cuerpo = (
    <>
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold text-slate-800">{f.nombre}</span>
        <span className="block text-xs text-slate-400">{f.detalle ?? f.codigo ?? ''}</span>
        {(f.ultimaRecepcion || f.procedencia) && (
          <span className="mt-0.5 block text-xs text-slate-500" data-procedencia>
            {f.ultimaRecepcion ? `Última recepción ${formatearFechaHora(f.ultimaRecepcion)}` : ''}
            {f.ultimaRecepcion && f.procedencia ? ' · ' : ''}
            {f.procedencia ?? ''}
          </span>
        )}
      </span>
      <span className={`shrink-0 text-lg font-bold tabular-nums ${f.saldo < 0 ? 'text-red-600' : 'text-slate-900'}`}>
        {cantidad(f.saldo)} <span className="text-xs font-semibold text-slate-500">{f.unidad}</span>
      </span>
    </>
  )
  const clase = 'flex min-h-14 items-center justify-between gap-2 rounded-xl bg-white p-3 text-left ring-1 ring-inset ring-slate-200'
  const atributos = f.tipo === 'ENVASE' ? { 'data-saldo-envase': f.nombre } : f.tipo === 'DIESEL' ? { 'data-saldo-diesel': f.clave } : { 'data-saldo': f.codigo ?? '' }
  if (f.materialId) {
    const id = f.materialId
    return (
      <button type="button" onClick={() => onVerProducto(id)} {...atributos} className={`${clase} hover:ring-brand-300`}>
        {cuerpo}
      </button>
    )
  }
  return (
    <div {...atributos} className={clase}>
      {cuerpo}
    </div>
  )
}

/** «Borrador» bajo el texto del botón cuando hay un registro a medias de ese tipo. */
function MarcaBorrador({ si }: { si: boolean }) {
  if (!si) return null
  return (
    <span className="mt-0.5 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-sky-800" data-marca-borrador>
      Borrador
    </span>
  )
}

export type Accion = 'recibir' | 'envases' | 'aplicar' | 'historico' | 'contar' | 'custodia' | 'entregar' | 'recibir_relevo' | 'codigo' | 'devolver_bodega' | 'trasladar'

export function PanelEstacion({
  estado,
  estacion,
  yo,
  saldos,
  filasBodega,
  enLinea,
  tieneEntregaPendiente = false,
  permisoHistorico = null,
  onAccion,
  onAplicarTurno,
  onVerProducto,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  saldos: Map<string, number>
  /** Bodega general de la estación (sql/139): productos, envases y diésel, con lo pendiente de enviar. */
  filasBodega: FilaBodega[]
  enLinea: boolean
  /** Otra persona ya entregó la estación (está en la base): se ofrece recibirla. */
  tieneEntregaPendiente?: boolean
  /** sql/116: permiso vigente de «Registro histórico» en esta estación (null = sin permiso: no hay botón). */
  permisoHistorico?: PermisoHistorico | null
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
  const productos = [...saldos.entries()].filter(([, v]) => v !== 0)
  const [filtro, setFiltro] = useState<TipoBodega | 'TODO'>('TODO')
  const conteo = conteoPorTipo(filasBodega)
  // Si el filtro elegido ya no tiene nada (p. ej. se vació), se muestra todo
  const filtroActivo = filtro !== 'TODO' && !conteo.has(filtro) ? 'TODO' : filtro
  const visibles = filasBodega.filter((f) => filtroActivo === 'TODO' || f.tipo === filtroActivo)
  const tipos = ORDEN_TIPOS.filter((t) => visibles.some((f) => f.tipo === t))
  const opcionesFiltro: [TipoBodega | 'TODO', string, number][] = [
    ['TODO', 'Todo', filasBodega.length],
    ...ORDEN_TIPOS.filter((t) => conteo.has(t)).map((t): [TipoBodega, string, number] => [t, NOMBRE_TIPO[t], conteo.get(t) ?? 0]),
  ]
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
      {estacion.permisos.aplicar && productos.some(([, v]) => v > 0) && (
        <Boton variante="secundario" onClick={() => onAccion('devolver_bodega')} disabled={!regla.si} className="min-h-11 flex-col py-3" data-accion="devolver_bodega">
          Devolver a bodega
          <MarcaBorrador si={borradores.has('devolucion_bodega')} />
        </Boton>
      )}
      {permisoHistorico && (
        <div className="rounded-xl bg-sky-50 p-3 ring-1 ring-inset ring-sky-200" data-registro-historico-panel>
          <p className="text-xs text-sky-900">
            <strong>Registro histórico</strong> para lo que ya se aplicó antes de usar el sistema (no mueve el inventario).{' '}
            {permisoHistorico.dias_restantes <= 0 ? 'Vence hoy.' : `Te quedan ${permisoHistorico.dias_restantes} día(s) (hasta el ${permisoHistorico.hasta}).`}
          </p>
          <Boton tamano="sm" variante="secundario" className="mt-2" onClick={() => onAccion('historico')} data-accion="historico">
            Registrar histórico
            {borradores.has('aplicacion_historica') ? ' (borrador)' : ''}
          </Boton>
        </div>
      )}
      {borradores.size > 0 && (
        <p className="-mt-2 text-xs text-sky-800" data-hay-borradores>
          Tienes {borradores.size === 1 ? 'un registro a medias' : `${borradores.size} registros a medias`} (
          {[...borradores].map((t) => NOMBRE_BORRADOR[t]).join(', ')}): ábrelo para terminarlo o descartarlo.
        </p>
      )}

      {/* ---- Plan de hoy ---- */}
      {planHoy.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">Plan de hoy</p>
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

      {/* ---- Bodega general (139): todo lo que hay en la estación, en un solo lugar ---- */}
      <div data-bodega-general>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">En bodega</p>
          {estacion.permisos.trasladar && (
            <Boton tamano="sm" variante="secundario" onClick={() => onAccion('trasladar')} disabled={!regla.si} data-accion="trasladar">
              Trasladar
            </Boton>
          )}
        </div>
        {filasBodega.length === 0 ? (
          <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
            Sin saldo registrado. Empieza con un <strong>Conteo</strong> (saldo inicial) o una <strong>Recepción</strong>.
          </p>
        ) : (
          <>
            {opcionesFiltro.length > 2 && (
              <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Filtrar la bodega" data-filtros-bodega>
                {opcionesFiltro.map(([clave, nombre, n]) => (
                  <button
                    key={clave}
                    type="button"
                    aria-pressed={filtroActivo === clave}
                    data-filtro-bodega={clave}
                    onClick={() => setFiltro(clave)}
                    className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                      filtroActivo === clave ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'
                    }`}
                  >
                    {nombre} <span className="tabular-nums opacity-80">{n}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-3" data-saldos>
              {tipos.map((t) => (
                <div
                  key={t}
                  data-grupo-bodega={NOMBRE_TIPO[t]}
                  className={t === 'FERTILIZANTE' ? 'rounded-2xl bg-brand-50/60 p-2 ring-1 ring-inset ring-brand-200' : ''}
                >
                  <p className={`mb-1 px-1 text-xs font-bold uppercase tracking-wide ${t === 'FERTILIZANTE' ? 'text-brand-800' : 'text-slate-400'}`}>
                    {t === 'FERTILIZANTE' ? '★ ' : ''}
                    {NOMBRE_TIPO[t]}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {visibles
                      .filter((f) => f.tipo === t)
                      .map((f) => (
                        <FilaDeBodega key={`${f.tipo}|${f.clave}`} fila={f} onVerProducto={onVerProducto} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {filasBodega.some((f) => f.saldo < 0) && (
          <div className="mt-2">
            <Insignia tono="rojo">Hay productos en negativo: falta registrar una entrega o un conteo.</Insignia>
          </div>
        )}
      </div>
    </div>
  )
}
