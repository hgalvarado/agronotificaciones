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
import { InsigniasCumplimiento } from './InsigniasCumplimiento'
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
  const [vista, setVista] = useState<'aplicaciones' | 'plan'>('aplicaciones')
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

  return (
    <div className="flex flex-col gap-2" data-historial-inyeccion>
      {todas.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Vista del historial" data-vista-historial>
            {(
              [
                ['aplicaciones', 'Aplicaciones'],
                ['plan', 'Plan contra real'],
              ] as const
            ).map(([v, t]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={vista === v}
                onClick={() => setVista(v)}
                data-vista-historial-opcion={v}
                className={`min-h-11 rounded-lg px-2 text-sm font-bold ${vista === v ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]' : 'text-slate-600'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <FiltrosHistorialInyeccion filtros={filtros} onCambiar={setFiltros} productos={opcionesProductos} lotes={opcionesLotes} personas={opcionesPersonas} />
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

      {vista === 'plan' && todas.length > 0 && <VistaPlanVsReal filas={filasPlan} producto={nombreProducto} unidad={unidad} rotuloLote={rotulo} quien={nombreQuien} />}

      {vista === 'aplicaciones' && todas.length > 0 && filas.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">No hay aplicaciones con esos filtros.</p>
      )}
      {vista === 'aplicaciones' &&
        filas.map(({ a, lineas }) => {
          const marcada = seleccionId === a.id
          const quien = nombreQuien(a.registrado_por)
          return (
            <div
              key={a.id}
              className={`rounded-xl bg-white p-3 ring-2 ring-inset ${marcada ? 'ring-brand-600' : 'ring-slate-200'} ${a.anulado_at ? 'opacity-70' : ''}`}
              data-aplicacion-lote={a.id}
              data-seleccionada={marcada ? '' : undefined}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap gap-1">
                  {a.anulado_at && <Insignia tono="rojo">Anulada</Insignia>}
                  {a.observaciones?.includes('REGISTRO_HISTORICO') && <Insignia tono="azul">Histórico</Insignia>}
                  {a.lineas.some((l) => !l.en_plan) && <Insignia tono="ambar">Sin plan</Insignia>}
                </span>
                <button
                  type="button"
                  aria-pressed={marcada}
                  onClick={() => setSeleccionId(marcada ? null : a.id)}
                  data-seleccionar-aplicacion
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-inset ${marcada ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}
                >
                  {marcada ? '✓ Seleccionada' : 'Seleccionar'}
                </button>
              </div>
              <ul className="mt-1 flex flex-col gap-2.5">
                {lineas.map((l) => {
                  const fila = indice.get(`${a.id}|${l.material_id}`)
                  const u = unidad(l.material_id)
                  const objetivos = objetivosDeLinea(a, l)
                  return (
                    <li key={l.material_id} data-linea-aplicada={l.material_id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-base font-extrabold text-slate-900">{nombreProducto(l.material_id)}</p>
                        <p className="text-base font-bold tabular-nums text-slate-900">{l.dosis_mz !== null ? `${cantidad(l.dosis_mz)} ${u}/mz` : 'sin dosis'}</p>
                      </div>
                      <p className="text-sm tabular-nums text-slate-700">
                        <strong>{cantidad(l.cantidad)}</strong> {u}
                        {l.ddt_plan !== null ? (
                          <>
                            {' · '}DDT {fila?.ddt_real ?? l.ddt_plan}
                            {fila?.ddt_real !== null && fila?.ddt_real !== undefined && fila.ddt_real !== l.ddt_plan ? ` (plan ${l.ddt_plan})` : ''}
                          </>
                        ) : null}
                        {' · '}
                        {a.fecha}
                        {fila?.fecha_plan && fila.fecha_plan !== a.fecha ? ` (plan ${fila.fecha_plan})` : ''}
                      </p>
                      {fila && fila.tiempo !== 'sin_plan' ? (
                        <div className="mt-1">
                          <InsigniasCumplimiento fila={fila} unidad={u} />
                        </div>
                      ) : null}
                      {objetivos.length > 0 && <p className="text-xs text-slate-500">Objetivo: {objetivos.join(', ')}</p>}
                    </li>
                  )
                })}
              </ul>
              <div className="mt-2 border-t border-slate-100 pt-2">
                <p className="text-sm font-semibold text-slate-700">{rotulo(a.lote)}</p>
                <p className="text-xs text-slate-500">
                  {formatearFechaHora(a.fecha_hora)} · {cantidad(a.area_mz)} mz · {quien ?? 'Persona sin nombre en este teléfono'}
                </p>
                {a.comentario && <p className="text-xs text-slate-500">Observaciones: {a.comentario}</p>}
                {a.anulado_at && a.motivo_anulacion && <p className="mt-1 text-xs text-red-700">Motivo de la anulación: {a.motivo_anulacion}</p>}
              </div>
            </div>
          )
        })}

      {seleccionada && (
        <div
          className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-xl bg-white p-3 shadow-[var(--shadow-raised)] ring-2 ring-inset ring-brand-600"
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
            <Boton tamano="md" variante="secundario" onClick={() => setSeleccionId(null)} data-quitar-seleccion>
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
