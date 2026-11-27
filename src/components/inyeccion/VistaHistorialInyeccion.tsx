'use client'

/**
 * Historial de Inyección de la estación (últimos 120 días): lo que ya llegó a la base y lo que todavía está por
 * enviar, con el detalle completo (lote «Nombre · código», producto y dosis, cantidad, DDT del plan contra el DDT real,
 * fecha del plan contra la de aplicación, quién y objetivo) y una vista «Plan contra real». Filtros contraídos.
 * Anular / Eliminar por completo aparecen solo dentro del detalle de la aplicación (al tocar la fila; con
 * confirmación); la base vuelve a comprobar el permiso. El cumplimiento de fondo y la tendencia son de AGL.
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Boton, Campo, Insignia } from '@/components/ui/Primitivos'
import type { OpcionSelector } from '@/components/ui/SelectorMultiple'
import { BandaLateral, InsigniaSobria } from '@/components/ui/Banda'
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
import { EncabezadoDia } from '@/components/campo/EncabezadoDia'

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
  const lotesCalendario = useMemo(() => opcionesLotes.map((o) => ({ id: o.valor, titulo: o.etiqueta })), [opcionesLotes])
  const fechaDia = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-HN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

  const detalle = (a: AplicacionInyeccion, lineas: AplicacionInyeccion['lineas']) => {
    const quien = nombreQuien(a.registrado_por)
    const puedeAnularA = puedeAnular && estacion.permisos.anular && !a.anulado_at
    const puedeEliminarA = puedeEliminar && Boolean(onEliminado)
    return (
      <div className="mx-3 mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200" data-detalle-aplicacion>
        <p>
          {formatearFechaHora(a.fecha_hora)} · {cantidad(a.area_mz)} mz · {quien ?? 'Persona sin nombre en este teléfono'}
        </p>
        {a.observaciones?.includes('REGISTRO_HISTORICO') && <p>Registro histórico</p>}
        {a.lineas.some((l) => !l.en_plan) && <p>Sin plan en alguna línea</p>}
        {lineas.map((l) => {
          const fila = indice.get(`${a.id}|${l.material_id}`)
          const u = unidad(l.material_id)
          const objetivos = objetivosDeLinea(a, l)
          return (
            <div key={l.material_id} className="mt-1">
              <strong className="text-slate-800">{nombreProducto(l.material_id)}</strong>
              {objetivos.length > 0 ? ` · Objetivo: ${objetivos.join(', ')}` : ''}
              {l.de_bodega === false && !a.observaciones?.includes('REGISTRO_HISTORICO') && <span className="ml-1 font-semibold text-slate-700" data-llego-directo> · Llegó directo (no salió de bodega)</span>}
              {fila && fila.tiempo !== 'sin_plan' && (
                <div className="mt-0.5">
                  Plan: {cantidad(fila.cantidad_plan)} {u} · DDT {fila.ddt ?? '—'}
                  {fila.fecha_plan ? ` · ${fila.fecha_estimada ? '≈ ' : ''}${fila.fecha_plan}` : ''}
                  <div className="mt-0.5">
                    <InsigniasCumplimiento fila={fila} unidad={u} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {a.comentario && <p className="mt-1">Observaciones: {a.comentario}</p>}
        {a.anulado_at && a.motivo_anulacion && <p className="mt-1 text-red-700">Motivo de la anulación: {a.motivo_anulacion}</p>}
        {(puedeAnularA || puedeEliminarA) && (
          <div className="mt-2 flex flex-wrap gap-2" data-acciones-aplicacion>
            {puedeAnularA && (
              <Boton tamano="md" variante="peligro" onClick={() => setAnulando(a)} data-anular-aplicacion-lote>
                Anular
              </Boton>
            )}
            {puedeEliminarA && (
              <Boton tamano="md" variante="peligro" onClick={() => setEliminando(a)} data-eliminar-por-completo-iny>
                Eliminar por completo
              </Boton>
            )}
          </div>
        )}
      </div>
    )
  }

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
                className={`min-h-11 rounded-lg px-1 text-sm font-semibold ${vista === v ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]' : 'text-slate-600'}`}
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
            <p className="text-sm font-semibold text-slate-800">{o.resumen}</p>
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
          <p className="text-xs text-slate-500">
            {filas.length} aplicación(es)
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
          <section key={dia} data-dia-historial={dia} data-destino={dia}>
            <EncabezadoDia derecha={`${items.length} aplicación(es)`}>{fechaDia(dia)}</EncabezadoDia>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200">
              {items.map(({ a, lineas }) => {
                const abierta = abiertas.has(a.id)
                const quien = nombreQuien(a.registrado_por)
                const historica = a.observaciones?.includes('REGISTRO_HISTORICO')
                return (
                  <div
                    key={a.id}
                    className={a.anulado_at ? 'opacity-60' : ''}
                    data-aplicacion-lote={a.id}
                  >
                    <button type="button" aria-expanded={abierta} onClick={() => alternarAbierta(a.id)} className="block w-full min-w-0 px-3 py-1.5 text-left" data-expandir-aplicacion>
                      {lineas.map((l) => {
                        const fila = indice.get(`${a.id}|${l.material_id}`)
                        const u = unidad(l.material_id)
                        const punto = fila ? PUNTO_TONO[TONO_TIEMPO[fila.tiempo].tono] : 'bg-slate-400'
                        return (
                          <span key={l.material_id} className="mb-1 flex items-stretch gap-2.5 last:mb-0" data-linea-aplicada={l.material_id}>
                            <BandaLateral clase={punto} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline justify-between gap-2">
                                <span className={`min-w-0 truncate text-[15px] font-medium leading-tight text-slate-900 ${a.anulado_at ? 'line-through' : ''}`}>{nombreProducto(l.material_id)}</span>
                                <span className="shrink-0 text-[15px] font-semibold leading-tight tabular-nums text-slate-900">{l.dosis_mz !== null ? `${cantidad(l.dosis_mz)} ${u}/mz` : 'sin dosis'}</span>
                              </span>
                              <span className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate text-xs font-normal tabular-nums text-slate-600">
                                  <span className="text-[13px] font-medium text-slate-800">{rotulo(a.lote)}</span> · {cantidad(l.cantidad)} {u}
                                  {l.ddt_plan !== null ? ` · DDT ${fila?.ddt_real ?? l.ddt_plan}` : ''}
                                </span>
                                {a.anulado_at ? (
                                  <InsigniaSobria tono="rojo">Anulada</InsigniaSobria>
                                ) : fila ? (
                                  <EstadoCompacto fila={fila} />
                                ) : null}
                              </span>
                            </span>
                          </span>
                        )
                      })}
                    </button>
                    {abierta && detalle(a, lineas)}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mostradas.flatMap(({ a, lineas }) => [
                ...lineas.map((l, i) => {
                  const fila = indice.get(`${a.id}|${l.material_id}`)
                  const u = unidad(l.material_id)
                  return (
                    <tr key={`${a.id}|${l.material_id}`} onClick={() => alternarAbierta(a.id)} className={`cursor-pointer ${a.anulado_at ? 'opacity-60' : ''}`} data-aplicacion-lote={i === 0 ? a.id : undefined} data-linea-aplicada={l.material_id}>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums">{a.fecha}</td>
                      <td className="max-w-[9rem] truncate px-2 py-1">{rotulo(a.lote)}</td>
                      <td className="max-w-[9rem] truncate px-2 py-1 font-semibold text-slate-900">{nombreProducto(l.material_id)}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{l.dosis_mz !== null ? `${cantidad(l.dosis_mz)} ${u}/mz` : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                        {cantidad(l.cantidad)} {u}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{l.ddt_plan !== null ? (fila?.ddt_real ?? l.ddt_plan) : '—'}</td>
                      <td className="px-2 py-1">{a.anulado_at ? 'Anulada' : fila ? <EstadoCompacto fila={fila} /> : '—'}</td>
                    </tr>
                  )
                }),
                ...(abiertas.has(a.id)
                  ? [
                      <tr key={`${a.id}|detalle`}>
                        <td colSpan={7} className="px-0 py-1">
                          {detalle(a, lineas)}
                        </td>
                      </tr>,
                    ]
                  : []),
              ])}
            </tbody>
          </table>
        </div>
      )}

      {vista === 'aplicaciones' && filas.length > limite && (
        <button type="button" onClick={() => setLimite((l) => l + 40)} className="min-h-11 rounded-xl bg-white text-sm font-semibold text-brand-700 ring-1 ring-inset ring-slate-300" data-ver-mas-historial>
          Ver más ({filas.length - limite})
        </button>
      )}

      {eliminando && (
        <EliminarPorCompleto
          tipo="iny_aplicacion"
          documentoId={eliminando.id}
          descripcion={`Inyección por lote · ${rotulo(eliminando.lote)} · ${eliminando.fecha}`}
          onCerrar={() => setEliminando(null)}
          onEliminado={(m) => {
            setEliminando(null)
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
            onGuardado(m)
          }}
        />
      )}
    </div>
  )
}
