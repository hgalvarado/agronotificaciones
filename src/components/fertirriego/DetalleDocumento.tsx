'use client'

/**
 * El detalle de un registro (recepción, envases, aplicación, conteo, devolución…).
 *
 * Piloto 2, punto 2: al tocar un registro se ve PRIMERO todo el detalle (quién, cuándo, chofer, vehículo, turnos,
 * DDT, productos, envases, comentario, ubicación y observaciones). Abajo, como acciones secundarias:
 *   - Anular (con motivo): el original queda visible; se asienta el movimiento contrario.
 *   - Devolver sobrante (solo aplicaciones): lo que no se usó vuelve a bodega.
 * Sus campos (motivo, cantidades) aparecen solo al tocar una; si no toca ninguna, el pie dice solo «Listo».
 * La base decide si se puede (autor en su jornada, o quien tiene «Anular»); aquí solo se ofrece lo posible.
 */

import { useState, type ReactNode } from 'react'
import { Alerta, AreaTexto, Boton, Campo } from '@/components/ui/Primitivos'
import { textoDdt } from '@/lib/fertirriego/ddt'
import { formatearFechaHora } from '@/lib/estados'
import { nombrePersona } from '@/lib/fertirriego/bitacora'
import { NOMBRE_MOVIMIENTO, cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Estacion, InfoOperacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { esTipoEliminable } from '@/lib/fertirriego/eliminar'
import { EditorLineas, leerLineas, type LineaEditable } from './EditorLineas'
import { EliminarPorCompleto } from './EliminarPorCompleto'
import { MarcoRegistro } from './MarcoRegistro'

const NOMBRE_DOC: Record<string, string> = {
  recepcion: 'Recepción',
  aplicacion: 'Aplicación',
  conteo: 'Conteo',
  devolucion: 'Devolución',
}

const NOMBRE_OTRO: Record<string, string> = {
  relevo: 'Relevo de estación',
  traslado: 'Traslado',
  // 102: lo que aplicó un turno terminado, en un solo renglón (el detalle quedó en AGL)
  archivo_turno: 'Turno terminado (archivado en AGL)',
}

/** Una fila «etiqueta: valor» del detalle (no se muestra si no hay valor). */
function Dato({ etiqueta, children, data }: { etiqueta: string; children: ReactNode; data?: string }) {
  if (children === null || children === undefined || children === '' || children === false) return null
  return (
    <div className="flex flex-wrap gap-x-2 py-1" data-dato={data}>
      <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{etiqueta}</dt>
      <dd className="min-w-0 flex-1 basis-40 break-words text-sm text-slate-800">{children}</dd>
    </div>
  )
}

function Seccion({ titulo, children, data }: { titulo: string; children: ReactNode; data?: string }) {
  return (
    <div className="border-t border-slate-200 pt-2" data-seccion-detalle={data}>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">{titulo}</p>
      {children}
    </div>
  )
}

export function DetalleDocumento({
  estado,
  estacion,
  yo,
  documentoTipo,
  documentoId,
  registrar,
  onCerrar,
  onGuardado,
  onEliminado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  documentoTipo: string
  documentoId: string
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
  /** sql/119: el registro se eliminó por completo (cierra el detalle y refresca). */
  onEliminado?: (m: string, documentoId: string) => void
}) {
  const [eliminando, setEliminando] = useState(false)
  // null = solo ver el detalle (el pie dice «Listo»)
  const [modo, setModo] = useState<'anular' | 'devolver' | null>(null)
  const [motivo, setMotivo] = useState('')
  const movs = estado.movimientos.filter((m) => m.documento_id === documentoId)
  const material = (id: string) => estado.materiales.find((m) => m.id === id)
  const envase = (id: string) => (estado.envases_tipos ?? []).find((e) => e.id === id)?.nombre ?? 'Envase'
  const turno = (id: string | null | undefined) => (id ? estado.turnos.find((t) => t.id === id)?.turno : undefined)
  const persona = (id: string | null | undefined) => nombrePersona(estado, id) ?? (id ? 'Persona sin nombre en este teléfono' : null)

  const recepcion = estado.recepciones.find((r) => r.id === documentoId)
  const aplicacion = estado.aplicaciones.find((a) => a.id === documentoId)
  const conteo = (estado.conteos ?? []).find((c) => c.id === documentoId)
  const envasesMovs = (estado.envases_movimientos ?? []).filter((m) => m.documento_id === documentoId)
  const anulado =
    movs.some((m) => estado.movimientos.some((x) => x.anula_id === m.id)) || Boolean(recepcion?.anulado_at || aplicacion?.anulado_at || conteo?.anulado_at)
  const motivoAnulacion = recepcion?.motivo_anulacion ?? aplicacion?.motivo_anulacion ?? conteo?.motivo_anulacion ?? null
  const autor = recepcion?.registrado_por ?? aplicacion?.registrado_por ?? conteo?.registrado_por ?? movs[0]?.registrado_por ?? envasesMovs[0]?.registrado_por ?? null
  const fechaHora = recepcion?.fecha_hora ?? aplicacion?.fecha_hora ?? conteo?.fecha_hora ?? movs[0]?.fecha_hora ?? envasesMovs[0]?.fecha_hora ?? null
  const operacion: InfoOperacion | null | undefined = recepcion?.operacion ?? aplicacion?.operacion ?? conteo?.operacion
  const suyo = autor === yo.id
  const soloEnvases = Boolean(recepcion && (recepcion.solo_envases || (movs.length === 0 && (recepcion.envases?.length ?? 0) > 0)))

  // Relevos y traslados no se anulan: tienen su propio camino (rechazar, cancelar)
  const anulable = documentoTipo in NOMBRE_DOC
  // Una recepción de solo envases no mueve producto: se anula igual (la base revierte sus envases)
  // sql/116: una aplicación histórica no tiene movimientos (no movió el inventario): se anula solo con «Anular» y no admite devolución
  const historica = Boolean(aplicacion?.historica)
  const tieneEfecto = movs.length > 0 || soloEnvases || historica
  const puedeAnular = anulable && !anulado && (estacion.permisos.anular || (suyo && !historica)) && tieneEfecto
  const puedeDevolver = documentoTipo === 'aplicacion' && !anulado && !!aplicacion && !historica
  const [lineas, setLineas] = useState<LineaEditable[]>(() =>
    (aplicacion?.lineas ?? []).map((l) => ({ clave: nuevoId(), material_id: l.material_id, cantidad: '' }))
  )

  const titulo = soloEnvases ? 'Envases' : (NOMBRE_DOC[documentoTipo] ?? NOMBRE_OTRO[documentoTipo] ?? 'Registro')

  // Envases del registro: los movimientos de la base (100) o lo que trae la recepción
  const envasesFilas: { envase_id: string; recibidos: number; entregados: number }[] =
    recepcion?.envases?.length
      ? recepcion.envases
      : envasesMovs.length
        ? Object.values(
            envasesMovs.reduce<Record<string, { envase_id: string; recibidos: number; entregados: number }>>((acc, m) => {
              const x = (acc[m.envase_id] ??= { envase_id: m.envase_id, recibidos: 0, entregados: 0 })
              if (m.cantidad > 0) x.recibidos += m.cantidad
              else x.entregados += -m.cantidad
              return acc
            }, {})
          )
        : []

  const puedeEliminar = Boolean(onEliminado) && Boolean(estacion.permisos.eliminar_definitivo) && esTipoEliminable(documentoTipo)
  if (eliminando && onEliminado) {
    return <EliminarPorCompleto tipo={documentoTipo as never} documentoId={documentoId} descripcion={titulo} onCerrar={() => setEliminando(false)} onEliminado={onEliminado} />
  }

  return (
    <MarcoRegistro
      titulo={titulo}
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      soloLectura={modo === null}
      textoCancelar="Volver"
      onCancelar={() => {
        setModo(null)
        setMotivo('')
      }}
      textoGuardar={modo === 'devolver' ? 'Devolver a bodega' : 'Anular'}
      // Quien tiene «Anular» anula sin tener la estación a cargo (como en la base); el autor, en su jornada
      sinCustodia={modo === 'anular' && estacion.permisos.anular}
      permiso="anular"
      construir={({ ubicacion, enNombreDe }) => {
        if (!modo) return 'Elige «Anular» o «Devolver sobrante».'
        if (!motivo.trim()) return modo === 'anular' ? 'Escribe por qué se anula.' : 'Escribe por qué sobró.'
        if (modo === 'anular') {
          if (!puedeAnular) return 'No puedes anular este registro.'
          return [
            crearOperacion(
              'anulacion',
              { estacion_id: estacion.id, documento_tipo: documentoTipo, documento_id: documentoId, motivo: motivo.trim() },
              { ubicacion, enNombreDe, resumen: `Anulación · ${titulo}` }
            ),
          ]
        }
        const r = leerLineas(lineas)
        if ('error' in r) return r.error
        return [
          crearOperacion(
            'devolucion',
            { estacion_id: estacion.id, aplicacion_id: documentoId, motivo: motivo.trim(), lineas: r.lineas },
            { ubicacion, enNombreDe, resumen: `Devolución a bodega · ${r.lineas.length} producto(s)` }
          ),
        ]
      }}
    >
      <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200" data-detalle-documento={documentoTipo}>
        {historica && (
          <p className="text-xs text-slate-500" data-detalle-historico>
            Registro histórico (registro inicial del proceso): no movió el inventario.
          </p>
        )}
        {anulado && (
          <p className="font-semibold text-red-700" data-detalle-anulado>
            Anulado{motivoAnulacion ? `: ${motivoAnulacion}` : ''}
          </p>
        )}
        <dl>
          <Dato etiqueta="Registró" data="quien">
            {autor ? <span data-detalle-quien>{persona(autor)}</span> : null}
          </Dato>
          <Dato etiqueta="Fecha y hora" data="fecha">
            {fechaHora ? formatearFechaHora(fechaHora) : null}
          </Dato>

          {recepcion && (
            <>
              <Dato etiqueta="Chofer" data="chofer">
                <span data-detalle-chofer>{recepcion.chofer ?? estado.choferes.find((c) => c.id === recepcion.chofer_id)?.nombre ?? '—'}</span>
              </Dato>
              <Dato etiqueta="Vehículo" data="vehiculo">
                {recepcion.vehiculo ?? (recepcion.vehiculo_id ? (estado.vehiculos.find((v) => v.id === recepcion.vehiculo_id)?.placa ?? '—') : 'Sin vehículo')}
              </Dato>
              <Dato etiqueta="Documento">{recepcion.documento}</Dato>
              <Dato etiqueta="Turnos" data="turnos">
                {(recepcion.turnos ?? []).map(turno).filter(Boolean).join(', ')}
              </Dato>
              <Dato etiqueta="Comentario" data="comentario">
                {recepcion.comentario}
              </Dato>
            </>
          )}

          {aplicacion && (
            <>
              <Dato etiqueta="Turno" data="turno">
                {turno(aplicacion.turno_ciclo_id) ?? '—'}
              </Dato>
              <Dato etiqueta="Día de aplicación">{aplicacion.fecha}</Dato>
              <Dato etiqueta="DDT" data="ddt">
                <span data-detalle-ddt>
                  {aplicacion.extra
                    ? 'Extra (fuera del plan)'
                    : aplicacion.ddt_plan != null
                      ? `Plan ${textoDdt(aplicacion.ddt_plan)}${aplicacion.fecha_plan ? ` (${aplicacion.fecha_plan})` : ''}`
                      : 'Sin DDT del plan'}
                  {aplicacion.ddt_real != null ? ` · real ${textoDdt(aplicacion.ddt_real)}` : ''}
                </span>
              </Dato>
              <Dato etiqueta="Ejecutó" data="ejecutor">
                {[aplicacion.ejecutor_id, aplicacion.ejecutor2_id].map(persona).filter(Boolean).join(' y ')}
              </Dato>
              <Dato etiqueta="Comentario" data="comentario">
                {aplicacion.comentario}
              </Dato>
            </>
          )}

          {conteo && (
            <Dato etiqueta="Comentario" data="comentario">
              {conteo.comentario}
            </Dato>
          )}
        </dl>

        {/* ---- Productos ---- */}
        {aplicacion?.lineas?.length ? (
          <Seccion titulo="Productos aplicados" data="lineas">
            <ul data-detalle-lineas>
              {aplicacion.lineas.map((l) => (
                <li key={l.material_id} className="flex justify-between gap-2 py-0.5">
                  <span className="min-w-0">
                    {material(l.material_id)?.descripcion ?? '—'}
                    {l.en_plan === false && !aplicacion.extra && <span className="ml-1 text-xs font-semibold text-amber-700">fuera del plan</span>}
                  </span>
                  <strong className="shrink-0 tabular-nums">
                    {cantidad(Number(l.cantidad))} {material(l.material_id)?.unidad ?? ''}
                  </strong>
                </li>
              ))}
            </ul>
          </Seccion>
        ) : null}

        {conteo?.lineas?.length ? (
          <Seccion titulo="Lo contado" data="conteo">
            <ul className="flex flex-col text-xs" data-detalle-conteo>
              {conteo.lineas.map((l) => (
                <li key={l.material_id} className="border-t border-slate-100 py-1.5">
                  <p className="break-words font-semibold text-slate-800">{material(l.material_id)?.descripcion ?? '—'}</p>
                  <p className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
                    <span className="text-slate-500">Sistema <strong>{cantidad(Number(l.saldo_sistema))}</strong></span>
                    <span className="text-slate-800">Real <strong>{cantidad(Number(l.cantidad_real))}</strong></span>
                    <span className={`font-bold ${Number(l.diferencia) < 0 ? 'text-red-700' : Number(l.diferencia) > 0 ? 'text-brand-700' : 'text-slate-500'}`}>
                      Dif. {Number(l.diferencia) > 0 ? '+' : ''}
                      {cantidad(Number(l.diferencia))}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </Seccion>
        ) : null}

        {movs.length > 0 && (
          <Seccion titulo="Movimientos en bodega" data="movimientos">
            <ul data-detalle-movimientos>
              {movs.map((m) => (
                <li key={m.id} className="flex justify-between gap-2 py-0.5">
                  <span className="min-w-0">
                    {NOMBRE_MOVIMIENTO[m.tipo]} · {material(m.material_id)?.descripcion ?? '—'}
                  </span>
                  <strong className={`shrink-0 tabular-nums ${m.cantidad < 0 ? 'text-red-700' : 'text-brand-700'}`}>
                    {m.cantidad > 0 ? '+' : ''}
                    {cantidad(m.cantidad)} {material(m.material_id)?.unidad ?? ''}
                  </strong>
                </li>
              ))}
            </ul>
          </Seccion>
        )}

        {envasesFilas.length > 0 && (
          <Seccion titulo="Envases" data="envases">
            <ul data-detalle-envases>
              {envasesFilas.map((e) => (
                <li key={e.envase_id} className="flex justify-between gap-2 py-0.5" data-detalle-envase={envase(e.envase_id)}>
                  <span>{envase(e.envase_id)}</span>
                  <span className="tabular-nums">
                    {e.recibidos > 0 && <strong className="text-brand-700">+{e.recibidos} recibidos</strong>}
                    {e.recibidos > 0 && e.entregados > 0 && ' · '}
                    {e.entregados > 0 && <strong className="text-red-700">−{e.entregados} entregados</strong>}
                  </span>
                </li>
              ))}
            </ul>
          </Seccion>
        )}

        {/* ---- La operación: cuándo se registró, cuándo llegó, ubicación, observaciones ---- */}
        {operacion && (
          <Seccion titulo="Registro" data="operacion">
            <dl data-detalle-operacion>
              <Dato etiqueta="En el teléfono">{operacion.creado_en ? formatearFechaHora(operacion.creado_en) : null}</Dato>
              <Dato etiqueta="Llegó al servidor">{operacion.recibido_en ? formatearFechaHora(operacion.recibido_en) : null}</Dato>
              <Dato etiqueta="Ubicación" data="ubicacion">
                {operacion.lat != null && operacion.lon != null ? 'Sí (con GPS)' : 'No (sin ubicación)'}
              </Dato>
              {(operacion.observaciones ?? []).length > 0 && (
                <Dato etiqueta="Observaciones" data="observaciones">
                  <ul className="list-disc pl-4 text-amber-800">
                    {(operacion.observaciones ?? []).map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </Dato>
              )}
            </dl>
          </Seccion>
        )}
      </div>

      {/* ---- Acciones secundarias: sus campos aparecen solo al tocar una ---- */}
      {modo === null && (puedeAnular || puedeDevolver || puedeEliminar) && (
        <div className="flex flex-wrap gap-2" data-acciones-detalle>
          {puedeDevolver && (
            <Boton variante="secundario" className="flex-1" onClick={() => setModo('devolver')} data-modo-devolver>
              Devolver sobrante
            </Boton>
          )}
          {puedeAnular && (
            <Boton variante="peligro" className="flex-1" onClick={() => setModo('anular')} data-modo-anular>
              Anular
            </Boton>
          )}
          {puedeEliminar && (
            <Boton variante="secundario" className="flex-1" onClick={() => setEliminando(true)} data-modo-eliminar>
              Eliminar por completo
            </Boton>
          )}
        </div>
      )}
      {modo === null && anulable && !puedeAnular && !puedeDevolver && !anulado && tieneEfecto && (
        <p className="text-xs text-slate-500">Solo quien lo registró (en su jornada) o quien tiene «Anular» puede anularlo.</p>
      )}

      {modo === 'anular' && (
        <Alerta tono="ambar">
          {historica
            ? 'Al anular, el registro queda visible con tu motivo. No se asienta ningún movimiento: no había movido el inventario.'
            : 'Al anular, el registro queda visible y se asienta el movimiento contrario en la bodega.'}
        </Alerta>
      )}
      {modo === 'devolver' && puedeDevolver && (
        <Campo etiqueta="Lo que vuelve a la bodega">
          <EditorLineas materiales={estado.materiales.filter((m) => aplicacion!.lineas?.some((l) => l.material_id === m.id))} lineas={lineas} onCambiar={setLineas} etiquetaCantidad="Devuelto" />
        </Campo>
      )}
      {modo !== null && (
        <Campo etiqueta={modo === 'anular' ? 'Motivo de la anulación' : 'Motivo (por qué sobró)'} requerido>
          <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} data-motivo />
        </Campo>
      )}
    </MarcoRegistro>
  )
}
