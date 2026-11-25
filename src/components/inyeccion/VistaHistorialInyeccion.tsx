'use client'

/**
 * Historial de Inyección de la estación (últimos 120 días): lo que ya llegó a la base y lo que todavía está por
 * enviar, con el detalle completo (lote «Nombre · código», producto y dosis, cantidad, DDT del plan contra el DDT real,
 * fecha del plan contra la de aplicación, quién y objetivo) y una vista «Plan contra real». Filtros contraídos.
 * Anular / Eliminar por completo solo aparecen cuando hay un registro seleccionado (con «Quitar selección» y
 * confirmación); la base vuelve a comprobar el permiso. El cumplimiento de fondo y la tendencia son de AGL.
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Boton, Campo, Insignia } from '@/components/ui/Primitivos'
import type { OpcionSelector } from '@/components/ui/SelectorMultiple'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'
import { EliminarPorCompleto } from '@/components/fertirriego/EliminarPorCompleto'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import { hoyIso } from '@/lib/fechas/zona'
import type { Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { type AplicacionInyeccion, type EstadoInyeccion, historialDeEstacion, objetivosDeLinea } from '@/lib/inyeccion/estado'
import { comparativaPlanReal, indicePorAplicacion } from '@/lib/inyeccion/cumplimiento'
import { SIN_FILTROS_INY, filaCumple, lineaCumple, type FiltrosInyeccion } from '@/lib/inyeccion/filtrosInyeccion'
import { rotuloLote } from '@/lib/inyeccion/lotes'
import { planDeEstacion } from '@/lib/inyeccion/planGeneral'
import { FiltrosHistorialInyeccion } from './FiltrosHistorialInyeccion'
import { EstadoCompacto, InsigniasCumplimiento, PUNTO_TONO, TONO_TIEMPO } from './InsigniasCumplimiento'
import { VistaCalendarioLote } from './VistaCalendarioLote'
import { VistaPlanVsReal } from './VistaPlanVsReal'

function FormAnular({
  aplicacion,
  rotulo,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  aplicacion: AplicacionInyeccion
  rotulo: string
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  return (
    <MarcoRegistro
      titulo="Anular aplicación por lote"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      permiso="anular"
      sinCustodia
      textoGuardar="Anular"
      construir={({ ubicacion, enNombreDe }) => {
        if (!motivo.trim()) return 'Escribe por qué se anula.'
        return [
          crearOperacion(
            'anulacion',
            { estacion_id: estacion.id, documento_tipo: 'aplicacion_lote', documento_id: aplicacion.id, motivo: motivo.trim() },
            { ubicacion, enNombreDe, resumen: `Anulación · Inyección por lote · ${aplicacion.lote}` }
          ),
        ]
      }}
    >
      <p className="text-sm text-slate-700">
        Lote <strong>{rotulo}</strong> · {aplicacion.fecha}. Los productos vuelven al inventario de la estación.
      </p>
      <Campo etiqueta="Motivo" requerido>
        <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} data-motivo-anulacion />
      </Campo>
    </MarcoRegistro>
  )
}

export function VistaHistorialInyeccion({
  estado,
  cola,
  estacion,
  yo,
  puedeAnular,
  puedeEliminar = false,
  nombreProducto,
  unidadProducto,
  nombreQuien,
  registrar,
  onGuardado,
  onEliminado,
}: {
  estado: EstadoInyeccion
  cola: Operacion[]
  estacion: Estacion
  yo: Persona
  puedeAnular: boolean
  /** sql/140: «Eliminar por completo» (solo con el permiso; en línea). */
  puedeEliminar?: boolean
  nombreProducto: (id: string) => string
  unidadProducto: (id: string) => string
  /** Nombre de quien registró (el mismo de la bitácora). */
  nombreQuien: (id: string | null) => string | null
  registrar: (...ops: Operacion[]) => Promise<void>
  onGuardado: (m: string) => void
  onEliminado?: (mensaje: string) => void
}) {
  const [anulando, setAnulando] = useState<AplicacionInyeccion | null>(null)
  const [eliminando, setEliminando] = useState<AplicacionInyeccion | null>(null)
  const [seleccionId, setSeleccionId] = useState<string | null>(null)
  const [vista, setVista] = useState<'aplicaciones' | 'plan' | 'calendario'>('aplicaciones')
  const [filtros, setFiltros] = useState<FiltrosInyeccion>(SIN_FILTROS_INY)
  const hoy = hoyIso()

  const todas = useMemo(() => historialDeEstacion(estado, estacion.id), [estado, estacion.id])
  const rotulo = useMemo(() => {
    const m = new Map<string, string>()
    return (lote: string) => {
      const hit = m.get(lote)
      if (hit) return hit
      const r = rotuloLote(estado.lotes, lote)
      m.set(lote, r)
      return r
    }
  }, [estado.lotes])
  const unidad = unidadProducto

  const planDe = useMemo(() => planDeEstacion(estado.plan, estacion.id, new Set(estado.categorias.map((c) => c.clave))), [estado.plan, estado.categorias, estacion.id])
  const comparativa = useMemo(() => comparativaPlanReal(planDe, todas, hoy), [planDe, todas, hoy])
  const indice = useMemo(() => indicePorAplicacion(comparativa), [comparativa])

  const filasPlan = useMemo(() => comparativa.filter((f) => filaCumple(f, filtros)), [comparativa, filtros])
  // Cada aplicación con solo las líneas que pasan los filtros
  const filas = useMemo(
    () =>
      todas
        .map((a) => ({ a, lineas: a.lineas.filter((l) => lineaCumple(a, l, indice.get(`${a.id}|${l.material_id}`), filtros)) }))
        .filter((x) => x.lineas.length > 0),
    [todas, indice, filtros]
  )

  const opcionesProductos = useMemo<OpcionSelector[]>(() => {
    const ids = new Set<string>([...comparativa.map((f) => f.material_id), ...todas.flatMap((a) => a.lineas.map((l) => l.material_id))])
    return [...ids].map((id) => ({ valor: id, etiqueta: nombreProducto(id) })).sort((x, y) => x.etiqueta.localeCompare(y.etiqueta, 'es'))
  }, [comparativa, todas, nombreProducto])
  const opcionesLotes = useMemo<OpcionSelector[]>(() => {
    const ls = new Set<string>([...planDe.map((p) => p.lote), ...todas.map((a) => a.lote)])
    return [...ls].map((l) => ({ valor: l, etiqueta: rotulo(l) })).sort((x, y) => x.etiqueta.localeCompare(y.etiqueta, 'es', { numeric: true }))
  }, [planDe, todas, rotulo])
  const opcionesPersonas = useMemo<OpcionSelector[]>(() => {
    const ids = new Set(todas.map((a) => a.registrado_por).filter((x): x is string => Boolean(x)))
    return [...ids].map((id) => ({ valor: id, etiqueta: nombreQuien(id) ?? 'Persona sin nombre en este teléfono' })).sort((x, y) => x.etiqueta.localeCompare(y.etiqueta, 'es'))
  }, [todas, nombreQuien])

  const pendientes = cola.filter((o) => o.tipo === 'aplicacion_lote' && o.datos.estacion_id === estacion.id && o.estado_local !== 'ACEPTADO')
  const seleccionada = seleccionId ? (todas.find((a) => a.id === seleccionId) ?? null) : null
  const puedeAnularSel = Boolean(seleccionada && puedeAnular && estacion.permisos.anular && !seleccionada.anulado_at)
  const puedeEliminarSel = Boolean(seleccionada && puedeEliminar && onEliminado)

  const [modo, setModo] = useState<'lista' | 'tabla'>('lista')
  const [limite, setLimite] = useState(40)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const alternarAbierta = (id: string) =>
    setAbiertas((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const mostradas = filas.slice(0, limite)
  const porDia = useMemo(() => {
    const m = new Map<string, typeof mostradas>()
    for (const x of mostradas) {
      const d = x.a.fecha ?? x.a.fecha_hora.slice(0, 10)
      m.set(d, [...(m.get(d) ?? []), x])
    }
    return [...m.entries()]
  }, [mostradas])
  const puedeActuar = (puedeAnular && estacion.permisos.anular) || (puedeEliminar && Boolean(onEliminado))
  const lotesCalendario = useMemo(() => opcionesLotes.map((o) => ({ id: o.valor, titulo: o.etiqueta })), [opcionesLotes])
  const fechaDia = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-HN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

  const casilla = (a: AplicacionInyeccion, marcada: boolean) => (
    <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center" aria-label={`Marcar aplicación del ${a.fecha}`}>
      <input
        type="checkbox"
        checked={marcada}
        onChange={() => setSeleccionId(marcada ? null : a.id)}
        data-seleccionar-aplicacion
        className="h-5 w-5 accent-brand-600"
      />
    </label>
  )

  return (
    <div className="flex flex-col gap-2" data-historial-inyeccion>
      {todas.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Vista del historial" data-vista-historial>
            {(
              [
                ['aplicaciones', 'Aplicaciones'],
                ['plan', 'Plan vs real'],
                ['calendario', 'Calendario'],
              ] as const
            ).map(([v, t]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={vista === v}
                onClick={() => setVista(v)}
                data-vista-historial-opcion={v}
                className={`min-h-11 rounded-lg px-1 text-sm font-bold ${vista === v ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]' : 'text-slate-600'}`}
              >
                {t}
              </button>
            ))}
          </div>
          {vista !== 'calendario' && <FiltrosHistorialInyeccion filtros={filtros} onCambiar={setFiltros} productos={opcionesProductos} lotes={opcionesLotes} personas={opcionesPersonas} />}
        </>
      )}
      {pendientes.map((o) => (
        <div key={o.id} className="rounded-xl bg-white p-3 ring-1 ring-inset ring-amber-300" data-aplicacion-pendiente>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">{o.resumen}</p>
            <Insignia tono={o.estado_local === 'RECHAZADO' ? 'rojo' : 'ambar'}>{o.estado_local === 'RECHAZADO' ? 'Rechazado' : 'Por enviar'}</Insignia>
          </div>
          {o.estado_local === 'RECHAZADO' && o.mensaje && <p className="mt-1 text-xs text-red-700">{o.mensaje}</p>}
        </div>
      ))}
      {todas.length === 0 && pendientes.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">Todavía no hay aplicaciones por lote en esta estación.</p>
      )}

      {vista === 'plan' && todas.length > 0 && (
        <VistaPlanVsReal filas={filasPlan} producto={nombreProducto} unidad={unidad} rotuloLote={rotulo} quien={nombreQuien} categorias={estado.categorias} />
      )}
      {vista === 'calendario' && todas.length + planDe.length > 0 && (
        <VistaCalendarioLote filas={comparativa} lotes={lotesCalendario} producto={nombreProducto} unidad={unidad} rotuloLote={rotulo} quien={nombreQuien} />
      )}

      {vista === 'aplicaciones' && todas.length > 0 && filas.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">No hay aplicaciones con esos filtros.</p>
      )}
      {vista === 'aplicaciones' && filas.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500" data-ayuda-seleccion>
            {puedeActuar ? 'Marca una fila para anular o eliminar' : `${filas.length} aplicación(es)`}
          </p>
          <span className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Forma de ver" data-modo-historial>
            {(
              [
                ['lista', 'Lista'],
                ['tabla', 'Tabla'],
              ] as const
            ).map(([v, t]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={modo === v}
                onClick={() => setModo(v)}
                data-modo-historial-opcion={v}
                className={`min-h-9 rounded-md px-3 text-xs font-semibold ${modo === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {t}
              </button>
            ))}
          </span>
        </div>
      )}

      {vista === 'aplicaciones' && modo === 'lista' &&
        porDia.map(([dia, items]) => (
          <section key={dia} className="overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-dia-historial={dia}>
            <h3 className="sticky top-0 z-[1] flex items-baseline justify-between bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-600">
              <span>{fechaDia(dia)}</span>
              <span className="font-semibold normal-case">{items.length} aplicación(es)</span>
            </h3>
            <div className="divide-y divide-slate-100">
              {items.map(({ a, lineas }) => {
                const marcada = seleccionId === a.id
                const abierta = abiertas.has(a.id)
                const quien = nombreQuien(a.registrado_por)
                const historica = a.observaciones?.includes('REGISTRO_HISTORICO')
                return (
                  <div
                    key={a.id}
                    className={`grid grid-cols-[1fr_auto] items-start ${marcada ? 'bg-brand-50/60' : ''} ${a.anulado_at ? 'opacity-60' : ''}`}
                    data-aplicacion-lote={a.id}
                    data-seleccionada={marcada ? '' : undefined}
                  >
                    <button type="button" aria-expanded={abierta} onClick={() => alternarAbierta(a.id)} className="min-w-0 px-3 py-1.5 text-left" data-expandir-aplicacion>
                      {lineas.map((l) => {
                        const fila = indice.get(`${a.id}|${l.material_id}`)
                        const u = unidad(l.material_id)
                        const punto = fila ? PUNTO_TONO[TONO_TIEMPO[fila.tiempo].tono] : 'bg-slate-400'
                        return (
                          <span key={l.material_id} className="mb-1 grid min-h-11 grid-cols-[0.75rem_1fr] items-start gap-2 last:mb-0" data-linea-aplicada={l.material_id}>
                            <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${punto}`} aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className={`min-w-0 truncate text-sm font-extrabold text-slate-900 ${a.anulado_at ? 'line-through' : ''}`}>{nombreProducto(l.material_id)}</span>
                                <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{l.dosis_mz !== null ? `${cantidad(l.dosis_mz)} ${u}/mz` : 'sin dosis'}</span>
                              </span>
                              <span className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate text-xs tabular-nums text-slate-600">
                                  {rotulo(a.lote)} · <strong>{cantidad(l.cantidad)}</strong> {u}
                                  {l.ddt_plan !== null ? ` · DDT ${fila?.ddt_real ?? l.ddt_plan}` : ''}
                                </span>
                                {a.anulado_at ? (
                                  <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-red-700 ring-1 ring-inset ring-red-600/20">Anulada</span>
                                ) : fila ? (
                                  <EstadoCompacto fila={fila} />
                                ) : null}
                              </span>
                            </span>
                          </span>
                        )
                      })}
                      {abierta && (
                        <span className="mt-1 block rounded-lg bg-slate-50 p-2 pl-5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200" data-detalle-aplicacion>
                          <span className="block">
                            {formatearFechaHora(a.fecha_hora)} · {cantidad(a.area_mz)} mz · {quien ?? 'Persona sin nombre en este teléfono'}
                          </span>
                          {historica && <span className="block">Registro histórico</span>}
                          {a.lineas.some((l) => !l.en_plan) && <span className="block">Sin plan en alguna línea</span>}
                          {lineas.map((l) => {
                            const fila = indice.get(`${a.id}|${l.material_id}`)
                            const u = unidad(l.material_id)
                            const objetivos = objetivosDeLinea(a, l)
                            return (
                              <span key={l.material_id} className="mt-1 block">
                                <strong className="text-slate-800">{nombreProducto(l.material_id)}</strong>
                                {objetivos.length > 0 ? ` · Objetivo: ${objetivos.join(', ')}` : ''}
                                {fila && fila.tiempo !== 'sin_plan' && (
                                  <span className="mt-0.5 block">
                                    Plan: {cantidad(fila.cantidad_plan)} {u} · DDT {fila.ddt ?? '—'}
                                    {fila.fecha_plan ? ` · ${fila.fecha_estimada ? '≈ ' : ''}${fila.fecha_plan}` : ''}
                                    <span className="mt-0.5 block">
                                      <InsigniasCumplimiento fila={fila} unidad={u} />
                                    </span>
                                  </span>
                                )}
                              </span>
                            )
                          })}
                          {a.comentario && <span className="mt-1 block">Observaciones: {a.comentario}</span>}
                          {a.anulado_at && a.motivo_anulacion && <span className="mt-1 block text-red-700">Motivo de la anulación: {a.motivo_anulacion}</span>}
                        </span>
                      )}
                    </button>
                    {casilla(a, marcada)}
                  </div>
                )
              })}
            </div>
          </section>
        ))}

      {vista === 'aplicaciones' && modo === 'tabla' && filas.length > 0 && (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-tabla-historial>
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="sticky top-0 bg-slate-100 text-[11px] font-bold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-2 py-1.5">Fecha</th>
                <th className="px-2 py-1.5">Lote</th>
                <th className="px-2 py-1.5">Producto</th>
                <th className="px-2 py-1.5 text-right">Dosis</th>
                <th className="px-2 py-1.5 text-right">Cant.</th>
                <th className="px-2 py-1.5 text-right">DDT</th>
                <th className="px-2 py-1.5">Estado</th>
                <th className="w-11 px-0 py-1.5" aria-label="Marcar" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mostradas.flatMap(({ a, lineas }) =>
                lineas.map((l, i) => {
                  const marcada = seleccionId === a.id
                  const fila = indice.get(`${a.id}|${l.material_id}`)
                  const u = unidad(l.material_id)
                  return (
                    <tr key={`${a.id}|${l.material_id}`} className={`${marcada ? 'bg-brand-50/60' : ''} ${a.anulado_at ? 'opacity-60' : ''}`} data-aplicacion-lote={i === 0 ? a.id : undefined} data-linea-aplicada={l.material_id}>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums">{a.fecha}</td>
                      <td className="max-w-[9rem] truncate px-2 py-1">{rotulo(a.lote)}</td>
                      <td className="max-w-[9rem] truncate px-2 py-1 font-semibold text-slate-900">{nombreProducto(l.material_id)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{l.dosis_mz !== null ? `${cantidad(l.dosis_mz)} ${u}/mz` : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                        {cantidad(l.cantidad)} {u}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{l.ddt_plan !== null ? (fila?.ddt_real ?? l.ddt_plan) : '—'}</td>
                      <td className="px-2 py-1">{a.anulado_at ? 'Anulada' : fila ? <EstadoCompacto fila={fila} /> : '—'}</td>
                      <td className="px-0 py-0">{i === 0 ? casilla(a, marcada) : null}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {vista === 'aplicaciones' && filas.length > limite && (
        <button type="button" onClick={() => setLimite((l) => l + 40)} className="min-h-11 rounded-xl bg-white text-sm font-semibold text-brand-700 ring-1 ring-inset ring-slate-300" data-ver-mas-historial>
          Ver más ({filas.length - limite})
        </button>
      )}

      {seleccionada && (
        <div
          className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-30 mb-24 flex lg:bottom-2 lg:mb-0 flex-col gap-2 rounded-xl bg-white p-3 shadow-[var(--shadow-raised)] ring-2 ring-inset ring-brand-600"
          role="region"
          aria-label="Acciones del registro seleccionado"
          data-acciones-seleccion
        >
          <p className="text-sm font-semibold text-slate-800">
            Seleccionada: {rotulo(seleccionada.lote)} · {seleccionada.fecha}
          </p>
          <div className="flex flex-wrap gap-2">
            {puedeAnularSel && (
              <Boton tamano="md" variante="peligro" onClick={() => setAnulando(seleccionada)} data-anular-aplicacion-lote>
                Anular
              </Boton>
            )}
            {puedeEliminarSel && (
              <Boton tamano="md" variante="peligro" onClick={() => setEliminando(seleccionada)} data-eliminar-por-completo-iny>
                Eliminar por completo
              </Boton>
            )}
            <Boton tamano="md" variante="secundario" onClick={() => setSeleccionId(null)} data-quitar-seleccion className="min-h-11">
              Quitar selección
            </Boton>
          </div>
          {!puedeAnularSel && !puedeEliminarSel && <p className="text-xs text-slate-500">Tu rol no tiene acciones sobre este registro.</p>}
        </div>
      )}

      {eliminando && (
        <EliminarPorCompleto
          tipo="iny_aplicacion"
          documentoId={eliminando.id}
          descripcion={`Inyección por lote · ${rotulo(eliminando.lote)} · ${eliminando.fecha}`}
          onCerrar={() => setEliminando(null)}
          onEliminado={(m) => {
            setEliminando(null)
            setSeleccionId(null)
            onEliminado?.(m)
          }}
        />
      )}
      {anulando && (
        <FormAnular
          aplicacion={anulando}
          rotulo={rotulo(anulando.lote)}
          estacion={estacion}
          yo={yo}
          registrar={registrar}
          onCerrar={() => setAnulando(null)}
          onGuardado={(m) => {
            setSeleccionId(null)
            onGuardado(m)
          }}
        />
      )}
    </div>
  )
}
